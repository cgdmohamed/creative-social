// Collection adapted from Postmill's idempotent daily snapshot activity and
// keyset batching, without its Inngest/provider-registry/AI dependencies (AGPL-3.0).
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { ReportingRepository } from './reporting.repository';
import { ReportingService } from './reporting.service';
import {
  normalizeProviderMetrics,
  REPORTING_PROVIDERS,
} from './provider.metrics';
@Injectable()
export class ReportingCollector {
  constructor(
    private repo: ReportingRepository,
    private reports: ReportingService,
    private manager: IntegrationManager,
    private refresh: RefreshIntegrationService
  ) {}
  private async bounded<T>(promise: Promise<T>, ms = 20000): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('REPORT_TIMEOUT')), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  async request(org: string, ids: string[], customerId?: string) {
    if (process.env.REPORTING_COLLECTION_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Data collection is disabled on this server. Contact an administrator.'
      );
    const channels = await this.reports.selection(org, customerId, ids, true);
    const results = [];
    for (const channel of channels) {
      const status =
        channel.disabled ||
        (customerId && (channel.customerId || '__unassigned') !== customerId)
          ? 'historical_only'
          : !REPORTING_PROVIDERS.includes(channel.providerIdentifier)
          ? 'unsupported'
          : 'queued';
      if (status === 'queued')
        await this.repo.request(org, channel.id, customerId, randomUUID());
      results.push({ integrationId: channel.id, status });
    }
    return results;
  }
  async channel(
    org: string,
    channel: Awaited<ReturnType<ReportingRepository['channels']>>[number]
  ) {
    if (channel.organizationId !== org || channel.disabled || channel.deletedAt)
      return { integrationId: channel.id, status: 'unavailable' };
    const id = channel.id;
    if (!REPORTING_PROVIDERS.includes(channel.providerIdentifier)) {
      await this.repo.state(
        org,
        id,
        'unsupported',
        'No audited reporting adapter for this provider'
      );
      return { integrationId: id, status: 'unsupported' };
    }
    const lease = randomUUID(),
      key = `reports:collect:${org}:${id}`;
    if ((await ioRedis.set(key, lease, 'EX', 600, 'NX')) !== 'OK')
      return { integrationId: id, status: 'busy' };
    const started = Date.now();
    let cursor: string | null | undefined;
    let samples = 0;
    let failures = 0;
    try {
      cursor = (await this.repo.states(org)).find(
        (s) => s.integrationId === id
      )?.postCursor;
      const provider = this.manager.getSocialIntegration(
        channel.providerIdentifier
      );
      let token = channel.token;
      if (
        channel.tokenExpiration &&
        channel.tokenExpiration.getTime() < Date.now()
      ) {
        const fresh = await this.bounded(this.refresh.refresh(channel));
        if (!fresh) {
          await this.repo.state(
            org,
            id,
            'relogin',
            'Reconnect the channel to collect analytics'
          );
          return { integrationId: id, status: 'relogin' };
        }
        token = fresh.accessToken;
      }
      if (provider.analytics) {
        try {
          // Request real dailies over seven days for late corrections. Instagram's
          // rolling total_value entries are intentionally excluded by normalization.
          const data = await this.bounded(
            provider.analytics(channel.internalId, token, 7)
          );
          const points = normalizeProviderMetrics(
            channel.providerIdentifier,
            'CHANNEL',
            data,
            id,
            '',
            new Date()
          );
          await this.repo.save(
            org,
            channel.customerId,
            'CHANNEL',
            points,
            channel.name
          );
          samples += points.length;
        } catch {
          failures++;
        }
      }
      if (provider.postAnalytics) {
        const posts = await this.repo.collectPosts(org, id, cursor);
        for (const post of posts) {
          if (Date.now() - started > 90000) {
            failures++;
            break;
          }
          try {
            const data = await this.bounded(
              provider.postAnalytics(
                channel.internalId,
                token,
                post.releaseId!,
                1
              )
            );
            const points = normalizeProviderMetrics(
              channel.providerIdentifier,
              'POST',
              data,
              id,
              post.id,
              new Date()
            );
            await this.repo.save(
              org,
              channel.customerId,
              'POST',
              points,
              channel.name
            );
            samples += points.length;
          } catch {
            failures++;
          } finally {
            cursor = post.id;
          }
        }
        if (
          (posts.length < 20 && cursor === posts[posts.length - 1]?.id) ||
          posts.length === 0
        )
          cursor = null;
      }
      const status = failures
        ? samples
          ? 'partial'
          : 'error'
        : samples
        ? 'ok'
        : 'no_data';
      await this.repo.state(
        org,
        id,
        status,
        failures
          ? 'Some metrics could not be collected; available observations were saved. Check permissions or retry later.'
          : samples
          ? undefined
          : 'No usable observations; the platform may not expose metrics or may require renewed permissions',
        cursor
      );
      return { integrationId: id, status, samples };
    } catch (error) {
      // Never persist arbitrary provider errors/URLs which can contain credentials.
      const status =
        (error as Error).message === 'REPORT_TIMEOUT' ? 'timeout' : 'error';
      await this.repo.state(
        org,
        id,
        status,
        status === 'timeout'
          ? 'Platform timed out; retry later'
          : 'Collection failed; check channel permissions and reconnect if needed',
        cursor
      );
      return { integrationId: id, status };
    } finally {
      await ioRedis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        lease
      );
    }
  }
}
