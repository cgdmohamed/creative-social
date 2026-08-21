import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  AuthTokenDetails,
  SocialComment,
  SocialConversation,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration, Organization } from '@prisma/client';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  NotEnoughScopes,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { difference, uniq } from 'lodash';
import utc from 'dayjs/plugin/utc';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { TemporalService } from 'nestjs-temporal-core';

dayjs.extend(utc);

@Injectable()
export class IntegrationService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integrationRepository: IntegrationRepository,
    private _autopostsRepository: AutopostRepository,
    private _integrationManager: IntegrationManager,
    private _notificationService: NotificationService,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
    private _temporalService: TemporalService
  ) {}

  async changeActiveCron(orgId: string) {
    const data = await this._autopostsRepository.getAutoposts(orgId);

    for (const item of data.filter((f) => f.active)) {
      try {
        await this._temporalService.terminateWorkflow(`autopost-${item.id}`);
      } catch (err) {}
    }

    return true;
  }

  getMentions(platform: string, q: string) {
    return this._integrationRepository.getMentions(platform, q);
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    return this._integrationRepository.insertMentions(platform, mentions);
  }

  async setTimes(
    orgId: string,
    integrationId: string,
    times: IntegrationTimeDto
  ) {
    return this._integrationRepository.setTimes(orgId, integrationId, times);
  }

  updateProviderSettings(org: string, id: string, additionalSettings: string) {
    return this._integrationRepository.updateProviderSettings(
      org,
      id,
      additionalSettings
    );
  }

  checkPreviousConnections(org: string, id: string) {
    return this._integrationRepository.checkPreviousConnections(org, id);
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string
  ) {
    const uploadedPicture = picture
      ? picture?.indexOf('imagedelivery.net') > -1
        ? picture
        : await this.storage.uploadSimple(picture).catch((err) => {
            console.log('Failed to upload profile picture:', picture, err);
            return undefined;
          })
      : undefined;

    return this._integrationRepository.createOrUpdateIntegration(
      additionalSettings,
      oneTimeToken,
      org,
      name,
      uploadedPicture,
      type,
      internalId,
      provider,
      token,
      refreshToken,
      expiresIn,
      username,
      isBetweenSteps,
      refresh,
      timezone,
      customInstanceDetails
    );
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integrationRepository.updateIntegrationGroup(org, id, group);
  }

  updateOnCustomerName(org: string, id: string, name: string) {
    return this._integrationRepository.updateOnCustomerName(org, id, name);
  }

  getIntegrationsList(org: string) {
    return this._integrationRepository.getIntegrationsList(org);
  }

  getChannelHealth(org: string, includeDeleted = false) {
    return this._integrationRepository.getChannelHealth(org, includeDeleted);
  }

  getIntegrationForOrder(id: string, order: string, user: string, org: string) {
    return this._integrationRepository.getIntegrationForOrder(
      id,
      order,
      user,
      org
    );
  }

  updateCustomName(org: string, id: string, name: string) {
    return this._integrationRepository.updateCustomName(org, id, name);
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integrationRepository.updateNameAndUrl(id, name, url);
  }

  getIntegrationById(org: string, id: string) {
    return this._integrationRepository.getIntegrationById(org, id);
  }

  getIntegrationByInternalId(org: string, internalId: string) {
    return this._integrationRepository.getIntegrationByInternalId(
      org,
      internalId
    );
  }

  async refreshToken(provider: SocialProvider, refresh: string) {
    try {
      const { refreshToken, accessToken, expiresIn } =
        await provider.refreshToken(refresh);

      if (!refreshToken || !accessToken || !expiresIn) {
        return false;
      }

      return { refreshToken, accessToken, expiresIn };
    } catch (e) {
      return false;
    }
  }

  async disconnectChannel(orgId: string, integration: Integration, err = '') {
    await this._integrationRepository.disconnectChannel(orgId, integration.id);
    await this.informAboutRefreshError(orgId, integration, err);
  }

  // A reconnect that came back from a different provider (MIGRATE_PROVIDERS):
  // match the disconnected channel by profile and move it to the new provider
  // in place, so scheduled posts, settings and customers survive. Throws the
  // same error as a mismatched reconnect when the migration is not configured
  // or the user connected a different account.
  async migrateIntegration(
    org: string,
    oldInternalId: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const existing = await this._integrationRepository.getIntegrationByInternalId(
      org,
      oldInternalId
    );

    if (
      !existing ||
      this._integrationManager.getMigrationTarget(
        existing.providerIdentifier
      ) !== newProvider
    ) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    const oldProvider = this._integrationManager.getSocialIntegration(
      existing.providerIdentifier
    );

    if (!oldProvider.migrationMatch(auth, existing)) {
      throw new NotEnoughScopes(
        `Please connect the same account (@${existing.profile}) that needs to be refreshed`
      );
    }

    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      throw new NotEnoughScopes(
        'This account is already connected as another channel, please delete one of them first'
      );
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  // A fresh connect of a migration target (MIGRATE_PROVIDERS) for an account
  // the org already has on the source provider: adopt that channel instead of
  // creating a confusing duplicate - the channel is migrated in place exactly
  // like a reconnect, and the follow-up upsert stores the fresh tokens. A no-op
  // when nothing matches, so a genuinely new account still creates a channel.
  async migrateIntegrationOnConnect(
    org: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const sources = this._integrationManager.getMigrationSources(newProvider);
    if (
      !sources.length ||
      this._integrationManager.getSocialIntegration(newProvider).isBetweenSteps
    ) {
      return;
    }

    // the account already exists on the new provider: the normal upsert
    // updates it, nothing to adopt
    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      return;
    }

    const existing = (
      await this._integrationRepository.getIntegrationsList(org)
    ).find(
      (p) =>
        sources.includes(p.providerIdentifier) &&
        this._integrationManager
          .getSocialIntegration(p.providerIdentifier)
          .migrationMatch(auth, p)
    );

    if (!existing) {
      return;
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  async informAboutRefreshError(
    orgId: string,
    integration: Integration,
    err = ''
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      `Could not refresh your ${integration.providerIdentifier} channel`,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}. Please go back to the system and connect it again ${process.env.FRONTEND_URL}/launches`,
      true,
      false,
      'info'
    );
  }

  async refreshNeeded(org: string, id: string) {
    return this._integrationRepository.refreshNeeded(org, id);
  }

  async setBetweenRefreshSteps(id: string) {
    return this._integrationRepository.setBetweenRefreshSteps(id);
  }

  async refreshTokens() {
    const integrations = await this._integrationRepository.needsToBeRefreshed();
    for (const integration of integrations) {
      const provider = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );

      const data = await this.refreshToken(provider, integration.refreshToken!);

      if (!data) {
        const flagged = await this._integrationRepository.refreshNeeded(
          integration.organizationId,
          integration.id
        );
        if (flagged) {
          await this.informAboutRefreshError(
            integration.organizationId,
            integration
          );
        }
        continue;
      }

      const { refreshToken, accessToken, expiresIn } = data;

      await this.createOrUpdateIntegration(
        undefined,
        !!provider.oneTimeToken,
        integration.organizationId,
        integration.name,
        undefined,
        'social',
        integration.internalId,
        integration.providerIdentifier,
        accessToken,
        refreshToken,
        expiresIn
      );
    }
  }

  async disableChannel(org: string, id: string) {
    return this._integrationRepository.disableChannel(org, id);
  }

  async enableChannel(org: string, totalChannels: number, id: string) {
    const integrations = (
      await this._integrationRepository.getIntegrationsList(org)
    ).filter((f) => !f.disabled);
    if (
      !!process.env.STRIPE_PUBLISHABLE_KEY &&
      integrations.length >= totalChannels
    ) {
      throw new Error('You have reached the maximum number of channels');
    }

    return this._integrationRepository.enableChannel(org, id);
  }

  async getPostsForChannel(org: string, id: string) {
    return this._integrationRepository.getPostsForChannel(org, id);
  }

  async deleteChannel(org: string, id: string) {
    return this._integrationRepository.deleteChannel(org, id);
  }

  async disableIntegrations(org: string, totalChannels: number) {
    return this._integrationRepository.disableIntegrations(org, totalChannels);
  }

  async enableAllIntegrations(org: string) {
    return this._integrationRepository.enableAllIntegrations(org);
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integrationRepository.checkForDeletedOnceAndUpdate(org, page);
  }

  async saveProviderPage(org: string, id: string, data: any) {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );
    if (!getIntegration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }
    if (!getIntegration.inBetweenSteps) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    const provider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (!provider.fetchPageInformation) {
      throw new HttpException(
        'Provider does not support page selection',
        HttpStatus.BAD_REQUEST
      );
    }

    const getIntegrationInformation = await provider.fetchPageInformation(
      getIntegration.token,
      data
    );

    await this.checkForDeletedOnceAndUpdate(
      org,
      String(getIntegrationInformation.id)
    );
    await this._integrationRepository.updateIntegration(id, {
      picture: getIntegrationInformation.picture,
      internalId: String(getIntegrationInformation.id),
      organizationId: org,
      name: getIntegrationInformation.name,
      inBetweenSteps: false,
      token: getIntegrationInformation.access_token,
      profile: getIntegrationInformation.username,
    });

    return { success: true };
  }

  // --- Inbox: komentarze i wiadomosci ---

  /**
   * Twardy limit czasu na jeden kanal. Bez tego zakladka wisi w nieskonczonosc:
   * SocialAbstract.fetch ponawia nieudane wywolania z odczekiwaniem, wiec kanal
   * bez uprawnien potrafi odpowiadac minutami zamiast od razu zglosic blad.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms)
      ),
    ]);
  }

  /** Token kanalu, odswiezony jesli wygasl. Null = kanal wymaga ponownego logowania. */
  private async freshToken(org: Organization, integration: any) {
    if (!dayjs(integration?.tokenExpiration).isBefore(dayjs())) {
      return integration.token;
    }
    const data = await this._refreshIntegrationService.refresh(integration);
    // refresh zwraca false, gdy kanal wymaga ponownego zalogowania.
    if (!data || typeof data === 'boolean' || !data.accessToken) {
      return null;
    }
    return data.accessToken;
  }

  /** Ukrywa albo odkrywa komentarz. Lagodniejsze od usuniecia. */
  async moderateComment(
    org: Organization,
    id: string,
    commentId: string,
    action: 'hide' | 'unhide' | 'delete'
  ) {
    const integration = await this.getIntegrationById(org.id, id);
    if (!integration) {
      throw new Error('Invalid integration');
    }
    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    const token = await this.freshToken(org, integration);
    if (!token) {
      throw new Error('RELOGIN');
    }

    if (action === 'delete') {
      if (!provider?.deleteComment) {
        throw new Error('Provider does not support deleting comments');
      }
      return provider.deleteComment(commentId, token);
    }

    if (!provider?.hideComment) {
      throw new Error('Provider does not support hiding comments');
    }
    return provider.hideComment(commentId, action === 'hide', token);
  }

  /** Lista kanalow do panelu inboxa. Szybka - bez wywolan do platform. */
  async getInboxChannels(org: Organization) {
    const integrations = await this._integrationRepository.getIntegrationsList(
      org.id
    );

    return integrations
      .filter((i: any) => i.type === 'social' && !i.disabled)
      .map((i: any) => {
        const provider = this._integrationManager.getSocialIntegration(
          i.providerIdentifier
        );
        return {
          id: i.id,
          name: i.name,
          picture: i.picture,
          provider: i.providerIdentifier,
          profile: i.profile,
          supportsComments: !!provider?.recentComments,
          supportsChats: !!provider?.conversations,
        };
      });
  }

  // --- Oznaczenia "przeczytane" ---
  // Trzymane w Redisie, nie w bazie: nie wymaga migracji Prisma na produkcji,
  // a przezywa restarty, bo Redis ma wlasny wolumen. Zbior per organizacja,
  // wiec oznaczenie widzi caly zespol, nie tylko jedna przegladarka.
  private readKey(org: string) {
    return `inbox:read:${org}`;
  }

  async getReadItems(org: Organization): Promise<string[]> {
    try {
      return await ioRedis.smembers(this.readKey(org.id));
    } catch {
      return [];
    }
  }

  async markRead(org: Organization, ids: string[], read: boolean) {
    if (!ids?.length) {
      return { success: true };
    }
    try {
      if (read) {
        await ioRedis.sadd(this.readKey(org.id), ...ids);
        // Bez wygasania zbior rosnie w nieskonczonosc; 90 dni to znacznie
        // wiecej niz okno, w ktorym wracamy do starych komentarzy.
        await ioRedis.expire(this.readKey(org.id), 60 * 60 * 24 * 90);
      } else {
        await ioRedis.srem(this.readKey(org.id), ...ids);
      }
    } catch {
      // brak Redisa nie moze blokowac odpowiadania
    }
    return { success: true };
  }

  /** Czytelny opis bledu. Providery rzucaja rozne ksztalty: Error, obiekt
   *  Graph API, czasem goly string - bez tego w UI ladowalo "[object Object]". */
  private describeError(err: any): string {
    if (!err) return 'Nieznany blad';
    if (typeof err === 'string') return err.slice(0, 200);
    const direct = err.message || err.error?.message || err.body?.error?.message;
    if (typeof direct === 'string' && direct) return direct.slice(0, 200);
    try {
      return JSON.stringify(err).slice(0, 200);
    } catch {
      return 'Nieznany blad';
    }
  }

  /**
   * Wynik z cache'u, jesli jest swiezy.
   *
   * Inbox odpytuje platformy przy kazdym wejsciu na zakladke, a Graph API
   * potrafi odpowiadac kilkanascie sekund na kanal. Cache sprawia, ze widok
   * pojawia sie natychmiast, a swieze dane dociagaja sie w tle.
   */
  private inboxCacheKey(org: string, id: string, kind: string) {
    return `inbox:${org}:${id}:${kind}`;
  }

  private async readInboxCache(org: string, id: string, kind: string) {
    try {
      const raw = await ioRedis.get(this.inboxCacheKey(org, id, kind));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async writeInboxCache(
    org: string,
    id: string,
    kind: string,
    value: any
  ) {
    try {
      // 10 minut: dluzej niz typowa sesja przegladania, krocej niz okno
      // publikacji, wiec nowe komentarze i tak zostana zauwazone.
      await ioRedis.set(
        this.inboxCacheKey(org, id, kind),
        JSON.stringify(value),
        'EX',
        600
      );
    } catch {
      // brak cache nie moze psuc odpowiedzi
    }
  }

  /** Komentarze JEDNEGO kanalu. Frontend odpytuje kanaly osobno, dzieki czemu
   *  wolny kanal nie blokuje calego widoku i wyniki pojawiaja sie stopniowo.
   *  `force` pomija cache (przycisk odswiezania). */
  async getChannelComments(org: Organization, id: string, force = false) {
    const integration = await this.getIntegrationById(org.id, id);
    if (!integration) {
      throw new Error('Invalid integration');
    }

    const integrations = await this._integrationRepository.getIntegrationsList(
      org.id
    );
    const ownIds = new Set(
      integrations.map((i: any) => String(i.internalId)).filter(Boolean)
    );
    const ownHandles = new Set(
      integrations
        .map((i: any) => String(i.profile || '').replace(/^@/, '').toLowerCase())
        .filter(Boolean)
    );

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.recentComments) {
      return { comments: [] as SocialComment[] };
    }

    if (!force) {
      const cached = await this.readInboxCache(org.id, id, 'comments');
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    const token = await this.freshToken(org, integration);
    if (!token) {
      return { error: 'RELOGIN', comments: [] as SocialComment[] };
    }

    try {
      const comments = await this.withTimeout(
        provider.recentComments(integration.internalId, token, { limit: 6 }),
        50000,
        integration.name
      );
      const result = {
        comments: comments.filter(
          (c) =>
            !(c.authorId && ownIds.has(String(c.authorId))) &&
            !(
              c.authorName &&
              ownHandles.has(c.authorName.replace(/^@/, '').toLowerCase())
            )
        ),
      };
      await this.writeInboxCache(org.id, id, 'comments', result);
      return result;
    } catch (err: any) {
      return { error: this.describeError(err), comments: [] };
    }
  }

  /** Rozmowy JEDNEGO kanalu. `force` pomija cache. */
  async getChannelConversations(org: Organization, id: string, force = false) {
    const integration = await this.getIntegrationById(org.id, id);
    if (!integration) {
      throw new Error('Invalid integration');
    }
    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.conversations) {
      return { conversations: [] as SocialConversation[] };
    }

    if (!force) {
      const cached = await this.readInboxCache(org.id, id, 'chats');
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    const token = await this.freshToken(org, integration);
    if (!token) {
      return { error: 'RELOGIN', conversations: [] as SocialConversation[] };
    }
    try {
      const conversations = await this.withTimeout(
        provider.conversations(integration.internalId, token, { limit: 25 }),
        50000,
        integration.name
      );
      const result = { conversations };
      await this.writeInboxCache(org.id, id, 'chats', result);
      return result;
    } catch (err: any) {
      return {
        error: this.describeError(err),
        conversations: [],
      };
    }
  }

  /**
   * Zbiera komentarze ze wszystkich kanalow organizacji.
   *
   * Komentarze napisane z naszych wlasnych kanalow (np. pierwszy komentarz
   * z linkiem, ktory Postiz dodaje przy publikacji) sa odsiewane - inbox ma
   * pokazywac tylko to, na co trzeba odpowiedziec.
   */
  async getInboxComments(org: Organization) {
    const integrations = await this._integrationRepository.getIntegrationsList(
      org.id
    );

    const ownIds = new Set(
      integrations.map((i: any) => String(i.internalId)).filter(Boolean)
    );
    const ownHandles = new Set(
      integrations
        .map((i: any) => String(i.profile || '').replace(/^@/, '').toLowerCase())
        .filter(Boolean)
    );

    // Kanaly odpytujemy rownolegle - sekwencyjnie 13 kanalow trwalo minuty
    // i zakladka wisiala na "Wczytuje...".
    const usable = integrations.filter(
      (i: any) =>
        i.type === 'social' &&
        !i.disabled &&
        this._integrationManager.getSocialIntegration(i.providerIdentifier)
          ?.recentComments
    );

    return Promise.all(
      usable.map(async (integration: any) => {
        const base = {
          channel: integration.name,
          channelId: integration.id,
          picture: integration.picture,
          provider: integration.providerIdentifier,
        };

        try {
          const token = await this.freshToken(org, integration);
          if (!token) {
            return { ...base, error: 'RELOGIN', comments: [] };
          }

          const provider = this._integrationManager.getSocialIntegration(
            integration.providerIdentifier
          );

          const comments = await this.withTimeout(
            provider.recentComments!(integration.internalId, token, {
              limit: 8,
            }),
            25000,
            integration.name
          );

          return {
            ...base,
            comments: comments.filter(
              (c) =>
                !(c.authorId && ownIds.has(String(c.authorId))) &&
                !(
                  c.authorName &&
                  ownHandles.has(c.authorName.replace(/^@/, '').toLowerCase())
                )
            ),
          };
        } catch (err: any) {
          return {
            ...base,
            error: this.describeError(err),
            comments: [],
          };
        }
      })
    );
  }

  async replyToComment(
    org: Organization,
    id: string,
    commentId: string,
    message: string
  ) {
    const integration = await this.getIntegrationById(org.id, id);
    if (!integration) {
      throw new Error('Invalid integration');
    }
    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.reply) {
      throw new Error('Provider does not support replies');
    }
    const token = await this.freshToken(org, integration);
    if (!token) {
      throw new Error('RELOGIN');
    }
    return provider.reply(integration.internalId, commentId, message, token);
  }

  /** Prywatne rozmowy. Kanaly bez uprawnien zwracaja wpis z polem error. */
  async getInboxConversations(org: Organization) {
    const integrations = await this._integrationRepository.getIntegrationsList(
      org.id
    );

    const usable = integrations.filter(
      (i: any) =>
        i.type === 'social' &&
        !i.disabled &&
        this._integrationManager.getSocialIntegration(i.providerIdentifier)
          ?.conversations
    );

    return Promise.all(
      usable.map(async (integration: any) => {
        const base = {
          channel: integration.name,
          channelId: integration.id,
          picture: integration.picture,
          provider: integration.providerIdentifier,
        };

        try {
          const token = await this.freshToken(org, integration);
          if (!token) {
            return { ...base, error: 'RELOGIN', conversations: [] };
          }

          const provider = this._integrationManager.getSocialIntegration(
            integration.providerIdentifier
          );

          const conversations = await this.withTimeout(
            provider.conversations!(integration.internalId, token, {
              limit: 25,
            }),
            25000,
            integration.name
          );

          return { ...base, conversations };
        } catch (err: any) {
          return {
            ...base,
            error: this.describeError(err),
            conversations: [],
          };
        }
      })
    );
  }

  async sendInboxMessage(
    org: Organization,
    id: string,
    recipientId: string,
    message: string
  ) {
    const integration = await this.getIntegrationById(org.id, id);
    if (!integration) {
      throw new Error('Invalid integration');
    }
    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.sendMessage) {
      throw new Error('Provider does not support messages');
    }
    const token = await this.freshToken(org, integration);
    if (!token) {
      throw new Error('RELOGIN');
    }
    return provider.sendMessage(
      integration.internalId,
      recipientId,
      message,
      token
    );
  }

  async checkAnalytics(
    org: Organization,
    integration: string,
    date: string,
    forceRefresh = false
  ): Promise<AnalyticsData[]> {
    // Days to load, missing or invalid on some public API calls (same default as the app)
    const days = Number(date) > 0 ? Number(date) : 7;
    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    if (getIntegration.type !== 'social') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        return [];
      }
    }

    const getIntegrationData = await ioRedis.get(
      `integration:${org.id}:${integration}:${days}`
    );
    if (getIntegrationData) {
      return JSON.parse(getIntegrationData);
    }

    if (integrationProvider.analytics) {
      try {
        const loadAnalytics = await integrationProvider.analytics(
          getIntegration.internalId,
          getIntegration.token,
          days
        );
        await ioRedis.set(
          `integration:${org.id}:${integration}:${days}`,
          JSON.stringify(loadAnalytics),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 1
            : 3600
        );
        return loadAnalytics;
      } catch (e) {
        if (e instanceof RefreshToken) {
          return this.checkAnalytics(org, integration, date, true);
        }
      }
    }

    return [];
  }

  customers(orgId: string) {
    return this._integrationRepository.customers(orgId);
  }

  async updateCustomerName(orgId: string, id: string, name: string) {
    const exists = await this._integrationRepository.getCustomerByName(
      orgId,
      name
    );
    if (exists && exists.id !== id) {
      throw new HttpException(
        'A group with this name already exists',
        HttpStatus.BAD_REQUEST
      );
    }
    return this._integrationRepository.updateCustomerName(orgId, id, name);
  }

  getPlugsByIntegrationId(org: string, integrationId: string) {
    return this._integrationRepository.getPlugsByIntegrationId(
      org,
      integrationId
    );
  }

  async processInternalPlug(
    data: {
      post: string;
      originalIntegration: string;
      integration: string;
      plugName: string;
      orgId: string;
      delay: number;
      information: any;
    },
    forceRefresh = false
  ): Promise<any> {
    const originalIntegration =
      await this._integrationRepository.getIntegrationById(
        data.orgId,
        data.originalIntegration
      );

    const getIntegration = await this._integrationRepository.getIntegrationById(
      data.orgId,
      data.integration
    );

    if (!getIntegration || !originalIntegration) {
      return;
    }

    const getAllInternalPlugs = this._integrationManager
      .getInternalPlugs(getIntegration.providerIdentifier)
      .internalPlugs.find((p: any) => p.identifier === data.plugName);

    if (!getAllInternalPlugs) {
      return;
    }

    const getSocialIntegration = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    // @ts-ignore
    await getSocialIntegration?.[getAllInternalPlugs.methodName]?.(
      getIntegration,
      originalIntegration,
      data.post,
      data.information
    );

    return;
  }

  async processPlugs(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    const getPlugById = await this._integrationRepository.getPlug(data.plugId);
    if (!getPlugById) {
      return true;
    }

    const integration = this._integrationManager.getSocialIntegration(
      getPlugById.integration.providerIdentifier
    );

    // @ts-ignore
    const process = await integration[getPlugById.plugFunction](
      getPlugById.integration,
      data.postId,
      JSON.parse(getPlugById.data).reduce((all: any, current: any) => {
        all[current.name] = current.value;
        return all;
      }, {})
    );

    if (process) {
      return true;
    }

    if (data.totalRuns === data.currentRun) {
      return true;
    }

    return false;
  }

  async createOrUpdatePlug(
    orgId: string,
    integrationId: string,
    body: PlugDto
  ) {
    const { activated } = await this._integrationRepository.createOrUpdatePlug(
      orgId,
      integrationId,
      body
    );

    return {
      activated,
    };
  }

  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { id, integrationId, plugFunction } =
      await this._integrationRepository.changePlugActivation(
        orgId,
        plugId,
        status
      );

    return { id };
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._integrationRepository.getPlugs(orgId, integrationId);
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    const exisingData = await this._integrationRepository.loadExisingData(
      methodName,
      integrationId,
      id
    );
    const loadOnlyIds = exisingData.map((p) => p.value);
    return difference(id, loadOnlyIds);
  }

  async findFreeDateTime(
    orgId: string,
    integrationsId?: string
  ): Promise<number[]> {
    const findTimes = await this._integrationRepository.getPostingTimes(
      orgId,
      integrationsId
    );
    return uniq(
      findTimes.reduce((all: any, current: any) => {
        return [
          ...all,
          ...JSON.parse(current.postingTimes).map(
            (p: { time: number }) => p.time
          ),
        ];
      }, [] as number[])
    );
  }
}
