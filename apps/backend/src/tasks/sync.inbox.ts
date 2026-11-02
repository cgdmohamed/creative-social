// Ported from erykkruk/postiz-app 98f0fc08671d (AGPL-3.0).
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

@Injectable()
export class SyncInbox {
  private logger = new Logger(SyncInbox.name);
  constructor(
    private _integrationService: IntegrationService,
    private _organizations: PrismaRepository<'organization'>
  ) {}

  @Cron('7 * * * *', {
    timeZone: 'UTC',
    waitForCompletion: true,
    disabled: process.env.INBOX_COLLECTION_ENABLED !== 'true',
  })
  async handleCron() {
    const owner = randomUUID();
    // One organization at a time; a lease prevents duplicate work across replicas.
    const organizations = await this._organizations.model.organization.findMany(
      { select: { id: true } }
    );
    for (const org of organizations) {
      const key = `inbox:sync:${org.id}`;
      if ((await ioRedis.set(key, owner, 'EX', 300, 'NX')) !== 'OK') continue;
      try {
        await this._integrationService.syncOrganization(org.id, 'comment');
        await this._integrationService.syncOrganization(org.id, 'conversation');
      } catch {
        this.logger.warn(
          'Inbox sweep failed for an organization; retrying on the next schedule'
        );
      } finally {
        await ioRedis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          owner
        );
      }
    }
  }
}
