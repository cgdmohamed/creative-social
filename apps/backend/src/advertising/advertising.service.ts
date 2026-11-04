import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { AdvertisingConnection, AdReportingProvider } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { MetaAdsProvider } from '@gitroom/nestjs-libraries/advertising/providers/meta.ads.provider';
import { GoogleAdsProvider } from '@gitroom/nestjs-libraries/advertising/providers/google.ads.provider';
import { AdsTokens, AdsProviderError, AdsAccount } from '@gitroom/nestjs-libraries/advertising/advertising.types';
import { randomSecret, stateHash, seal, unseal, encryptionConfigured } from '@gitroom/nestjs-libraries/advertising/advertising.crypto';

const providers = { meta: AdReportingProvider.META_ADS, google: AdReportingProvider.GOOGLE_ADS };
const context = (org: string, provider: string) => `advertising:${org}:${provider}`;
const accountSelect = { id: true, externalAccountId: true, name: true, currency: true, timezone: true,
  enabled: true, providerStatus: true } as const;

@Injectable()
export class AdvertisingService {
  constructor(private db: PrismaService, private meta: MetaAdsProvider, private google: GoogleAdsProvider) {}
  private provider(name: string) {
    if (name !== 'meta' && name !== 'google') throw new BadRequestException('Unsupported advertising provider');
    const type = providers[name];
    return { type: type as AdReportingProvider, api: name === 'meta' ? this.meta : this.google };
  }
  private async authorizeMember(org: string, user: string, db: Pick<PrismaService, 'userOrganization'> = this.db) {
    const membership = await db.userOrganization.findFirst({ where: {
      userId: user, organizationId: org, disabled: false, role: { in: ['ADMIN', 'SUPERADMIN'] },
      organization: { deletedAt: null }, user: { deletedAt: null, activated: true },
    }, select: { id: true } });
    if (!membership) throw new ForbiddenException('Workspace administrator access required');
  }
  async list(org: string, user: string) {
    await this.authorizeMember(org, user);
    const rows = await this.db.advertisingConnection.findMany({ where: { organizationId: org }, select: {
      provider: true, status: true, expiresAt: true, lastError: true, retryAfter: true,
      accounts: { select: accountSelect, orderBy: { name: 'asc' } },
    } });
    return Object.entries(providers).map(([id, provider]) => {
      const row = rows.find((item) => item.provider === provider);
      return { id, configured: this.provider(id).api.configured() && encryptionConfigured(),
        ...(row || { status: 'DISCONNECTED', accounts: [] }),
        ...(row?.status === 'CONNECTED' && row.expiresAt && row.expiresAt.getTime() <= Date.now() ? { status: 'EXPIRED' } : {}),
      };
    });
  }
  async start(org: string, user: string, name: string) {
    await this.authorizeMember(org, user);
    const { type, api } = this.provider(name);
    if (!encryptionConfigured()) throw new HttpException('Advertising encryption is not configured', 503);
    const state = randomSecret();
    const verifier = randomSecret();
    const url = api.authorize(state, verifier);
    const ciphertext = seal(verifier, `${context(org, type)}:state:${stateHash(state)}`);
    await this.db.advertisingConnection.upsert({ where: { organizationId_provider: { organizationId: org, provider: type } },
      create: { organizationId: org, provider: type }, update: {} });
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdvertisingConnection" WHERE "organizationId"=${org} AND provider=${type}::"AdReportingProvider" FOR UPDATE`;
      const connection = await tx.advertisingConnection.findUniqueOrThrow({ where: { organizationId_provider: { organizationId: org, provider: type } } });
      await tx.advertisingOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await tx.advertisingOAuthState.updateMany({ where: { organizationId: org, userId: user, provider: type, usedAt: null }, data: { usedAt: new Date() } });
      await tx.advertisingOAuthState.create({ data: { hash: stateHash(state), organizationId: org, userId: user,
        provider: type, verifierCiphertext: ciphertext, connectionRevision: connection.revision,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    });
    return { url };
  }
  async callback(org: string, user: string, name: string, body: { state: string; code?: string; error?: string }) {
    await this.authorizeMember(org, user);
    const { type, api } = this.provider(name);
    if (!/^[A-Za-z0-9_-]{43}$/.test(body.state || '')) throw new BadRequestException('Invalid or expired advertising authorization');
    const attempt = await this.db.advertisingOAuthState.findFirst({ where: {
      hash: stateHash(body.state), organizationId: org, userId: user, provider: type,
      usedAt: null, expiresAt: { gt: new Date() },
    } });
    if (!attempt) throw new BadRequestException('Invalid or expired advertising authorization');
    const consumed = await this.db.advertisingOAuthState.updateMany({ where: { hash: attempt.hash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!consumed.count) throw new BadRequestException('Invalid or expired advertising authorization');
    if (body.error || !body.code) throw new BadRequestException('Advertising authorization was not granted');
    const connection = await this.db.advertisingConnection.findUniqueOrThrow({ where: { organizationId_provider: { organizationId: org, provider: type } } });
    if (connection.revision !== attempt.connectionRevision) throw new HttpException('Connection changed; restart authorization', 409);
    let tokens: AdsTokens;
    try {
      const verifier = unseal<string>(attempt.verifierCiphertext, `${context(org, type)}:state:${attempt.hash}`);
      tokens = await api.exchange(body.code, verifier);
    } catch (failure) { throw this.providerException(failure); }
    const encrypted = seal(tokens, context(org, type));
    await this.db.$transaction(async (tx) => {
      await this.authorizeMember(org, user, tx);
      const result = await tx.advertisingConnection.updateMany({ where: { id: connection.id, organizationId: org, revision: attempt.connectionRevision },
        data: { credentialCiphertext: encrypted, status: 'CONNECTED', expiresAt: new Date(tokens.expiresAt),
          lastError: null, retryAfter: null, refreshLeaseUntil: null, revision: { increment: 1 } } });
      if (!result.count) throw new HttpException('Connection changed; restart authorization', 409);
      // Reconnection may be a different provider identity. Require fresh discovery
      // and selection instead of silently attaching old accounts to a new grant.
      await tx.adReportingAccount.updateMany({ where: { connectionId: connection.id, organizationId: org },
        data: { enabled: false, providerStatus: 'RESELECT_REQUIRED' } });
    });
    return { connected: true };
  }
  private providerException(failure: unknown) {
    const error = failure instanceof AdsProviderError ? failure : new AdsProviderError('UNAVAILABLE');
    return new HttpException({ message: `Advertising provider: ${error.code}`, code: error.code,
      ...(error.code === 'RATE_LIMITED' ? { retryAfter: error.retryAfter } : {}) }, error.code === 'RATE_LIMITED' ? 429 : error.code === 'REAUTH_REQUIRED' ? 409 : 503);
  }
  private async providerFailure(connection: AdvertisingConnection, failure: unknown, lease?: Date): Promise<never> {
    const error = failure instanceof AdsProviderError ? failure : new AdsProviderError('UNAVAILABLE');
    await this.db.$transaction(async (tx) => {
      const result = await tx.advertisingConnection.updateMany({ where: { id: connection.id, organizationId: connection.organizationId, revision: connection.revision,
        ...(lease ? { refreshLeaseUntil: lease } : {}),
      }, data: {
        lastError: error.code, refreshLeaseUntil: null,
        retryAfter: error.code === 'RATE_LIMITED' ? new Date(Date.now() + error.retryAfter * 1000) : null,
        ...(error.code === 'REAUTH_REQUIRED' ? { status: 'REAUTH_REQUIRED', credentialCiphertext: null, expiresAt: null, revision: { increment: 1 } } : {}),
      } });
      if (result.count && error.code === 'REAUTH_REQUIRED') await tx.adReportingAccount.updateMany({
        where: { connectionId: connection.id, organizationId: connection.organizationId }, data: { enabled: false, providerStatus: 'REAUTH_REQUIRED' },
      });
    });
    throw this.providerException(error);
  }
  private async credentials(org: string, name: string) {
    const { type, api } = this.provider(name);
    let connection = await this.db.advertisingConnection.findUnique({ where: { organizationId_provider: { organizationId: org, provider: type } } });
    if (!connection || connection.status !== 'CONNECTED' || !connection.credentialCiphertext) throw new HttpException('Reconnect advertising provider', 409);
    if (connection.retryAfter && connection.retryAfter.getTime() > Date.now()) throw new HttpException({ message: 'Advertising provider: RATE_LIMITED', code: 'RATE_LIMITED', retryAfter: Math.ceil((connection.retryAfter.getTime() - Date.now()) / 1000) }, 429);
    let tokens: AdsTokens;
    try { tokens = unseal<AdsTokens>(connection.credentialCiphertext, context(org, type)); }
    catch { throw new HttpException('Advertising credentials unavailable; check the encryption key', 503); }
    if (tokens.expiresAt > Date.now() + 60000) return { connection, tokens, api, type };
    const lease = new Date(Date.now() + 45000);
    const acquired = await this.db.advertisingConnection.updateMany({ where: { id: connection.id, organizationId: org, revision: connection.revision,
      OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lt: new Date() } }] }, data: { refreshLeaseUntil: lease } });
    if (!acquired.count) throw new HttpException('Advertising token refresh in progress; retry shortly', 409);
    try { tokens = await api.refresh(tokens); }
    catch (failure) { return this.providerFailure(connection, failure, lease); }
    const updated = await this.db.advertisingConnection.updateMany({ where: { id: connection.id, organizationId: org, revision: connection.revision, refreshLeaseUntil: lease },
      data: { credentialCiphertext: seal(tokens, context(org, type)), expiresAt: new Date(tokens.expiresAt), refreshLeaseUntil: null, lastError: null, retryAfter: null, revision: { increment: 1 } } });
    if (!updated.count) throw new HttpException('Advertising connection changed; retry', 409);
    connection = { ...connection, revision: connection.revision + 1, refreshLeaseUntil: null };
    return { connection, tokens, api, type };
  }
  private async discovered(org: string, name: string) {
    const grant = await this.credentials(org, name);
    let accounts: AdsAccount[];
    try { accounts = await grant.api.accounts(grant.tokens.accessToken, AbortSignal.timeout(60000)); }
    catch (failure) { return this.providerFailure(grant.connection, failure); }
    return { ...grant, accounts };
  }
  async discover(org: string, user: string, name: string) {
    await this.authorizeMember(org, user);
    const result = await this.discovered(org, name);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdvertisingConnection" WHERE id=${result.connection.id} FOR UPDATE`;
      await this.authorizeMember(org, user, tx);
      const current = await tx.advertisingConnection.findFirst({ where: { id: result.connection.id, organizationId: org,
        revision: result.connection.revision, status: 'CONNECTED' } });
      if (!current) throw new HttpException('Advertising connection changed; retry', 409);
      await tx.advertisingConnection.update({ where: { id: current.id }, data: { lastError: null, retryAfter: null } });
      await tx.adReportingAccount.updateMany({ where: { organizationId: org, connectionId: current.id,
        externalAccountId: { notIn: result.accounts.map((a) => a.id) } }, data: { enabled: false, providerStatus: 'UNAVAILABLE' } });
      const selected = await tx.adReportingAccount.findMany({ where: { organizationId: org, connectionId: current.id, enabled: true }, select: { externalAccountId: true } });
      for (const record of selected) {
        const account = result.accounts.find((a) => a.id === record.externalAccountId);
        if (account) await tx.adReportingAccount.updateMany({ where: { organizationId: org, connectionId: current.id, externalAccountId: account.id },
          data: { name: account.name, currency: account.currency, timezone: account.timezone,
            providerStatus: account.status, enabled: account.status === 'ENABLED' } });
      }
    });
    const selected = await this.db.adReportingAccount.findMany({ where: { organizationId: org, provider: result.type, enabled: true }, select: { externalAccountId: true } });
    return result.accounts.map((account) => ({ ...account, selected: selected.some((a) => a.externalAccountId === account.id) }));
  }
  async select(org: string, user: string, name: string, ids: string[]) {
    await this.authorizeMember(org, user);
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new BadRequestException('Select up to 100 distinct advertising accounts');
    const result = await this.discovered(org, name);
    const accounts = ids.map((id) => result.accounts.find((account) => account.id === id));
    if (accounts.some((account) => !account || account.status !== 'ENABLED')) throw new BadRequestException('An account is unavailable or not authorized for this connection');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdvertisingConnection" WHERE id=${result.connection.id} FOR UPDATE`;
      await this.authorizeMember(org, user, tx);
      const current = await tx.advertisingConnection.findFirst({ where: { id: result.connection.id, organizationId: org, revision: result.connection.revision, status: 'CONNECTED' } });
      if (!current) throw new HttpException('Advertising connection changed; retry', 409);
      await tx.adReportingAccount.updateMany({ where: { organizationId: org, provider: result.type }, data: { enabled: false } });
      for (const account of accounts) {
        const data = { connectionId: current.id, name: account!.name, currency: account!.currency, timezone: account!.timezone,
          loginCustomerId: account!.loginCustomerId || null, providerStatus: account!.status, enabled: true };
        await tx.adReportingAccount.upsert({ where: { organizationId_provider_externalAccountId: { organizationId: org, provider: result.type, externalAccountId: account!.id } },
          create: { organizationId: org, provider: result.type, externalAccountId: account!.id, ...data }, update: data });
      }
    });
    return { selected: ids.length };
  }
  async disconnect(org: string, user: string, name: string, revoke = false) {
    await this.authorizeMember(org, user);
    const { type, api } = this.provider(name);
    const connection = await this.db.advertisingConnection.findUnique({ where: { organizationId_provider: { organizationId: org, provider: type } } });
    if (!connection) return { disconnected: true, revocation: 'NOT_REQUESTED' };
    let tokens: AdsTokens | undefined;
    if (revoke && connection.credentialCiphertext) {
      try { tokens = unseal<AdsTokens>(connection.credentialCiphertext, context(org, type)); }
      catch { /* Local disconnect must still work if encryption configuration changed. */ }
    }
    await this.db.$transaction(async (tx) => {
      const cleared = await tx.advertisingConnection.updateMany({ where: { id: connection.id, organizationId: org, revision: connection.revision }, data: {
        credentialCiphertext: null, expiresAt: null, refreshLeaseUntil: null, retryAfter: null,
        status: 'DISCONNECTED', lastError: null, revision: { increment: 1 },
      } });
      if (!cleared.count) throw new HttpException('Advertising connection changed; retry disconnect', 409);
      await tx.adReportingAccount.updateMany({ where: { organizationId: org, connectionId: connection.id }, data: { enabled: false, providerStatus: 'DISCONNECTED' } });
      await tx.advertisingOAuthState.updateMany({ where: { organizationId: org, provider: type, usedAt: null }, data: { usedAt: new Date() } });
    });
    let revocation = revoke ? 'UNAVAILABLE' : 'NOT_REQUESTED';
    if (tokens) {
      try { await api.revoke(tokens); revocation = 'CONFIRMED'; }
      catch { revocation = 'UNCONFIRMED'; } // Credentials remain erased, even if provider is down.
    }
    return { disconnected: true, revocation };
  }
}
