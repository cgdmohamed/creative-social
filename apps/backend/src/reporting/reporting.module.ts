import { Module, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ReportingRepository } from '@gitroom/nestjs-libraries/reporting/reporting.repository';
import { ReportingService } from '@gitroom/nestjs-libraries/reporting/reporting.service';
import { ReportingCollector } from '@gitroom/nestjs-libraries/reporting/reporting.collector';
import { ReportingPdf } from '@gitroom/nestjs-libraries/reporting/reporting.pdf';
@Injectable()
export class ReportingSchedule {
  private logger = new Logger(ReportingSchedule.name);
  constructor(
    private db: PrismaService,
    private repo: ReportingRepository,
    private collector: ReportingCollector
  ) {}
  @Cron('*/30 * * * * *', {
    timeZone: 'UTC',
    waitForCompletion: true,
    disabled: process.env.REPORTING_COLLECTION_ENABLED !== 'true',
  })
  async requested() {
    const jobs = await this.repo.pendingRequests();
    // Bounded worker concurrency; leases coordinate scheduled and manual work.
    for (let i = 0; i < jobs.length; i += 2) {
      await Promise.all(
        jobs.slice(i, i + 2).map(async (job) => {
          try {
            const channel = (
              await this.repo.channels(job.organizationId, undefined, [
                job.integrationId,
              ])
            )[0];
            let status = 'unavailable';
            if (
              channel &&
              (!job.requestedFor ||
                (channel.customerId || '__unassigned') === job.requestedFor)
            ) {
              status = (
                await this.collector.channel(job.organizationId, channel)
              ).status;
            } else {
              await this.repo.state(
                job.organizationId,
                job.integrationId,
                status,
                'Channel is unavailable or client ownership has changed'
              );
            }
            if (status !== 'busy' && job.requestKey)
              await this.repo.acknowledge(
                job.organizationId,
                job.integrationId,
                job.requestKey
              );
          } catch {
            this.logger.warn(
              'Queued report collection will retry on the next worker poll'
            );
          }
        })
      );
    }
  }
  @Cron('23 * * * *', {
    timeZone: 'UTC',
    waitForCompletion: true,
    disabled: process.env.REPORTING_COLLECTION_ENABLED !== 'true',
  })
  async run() {
    let cursor: string | undefined;
    do {
      const orgs = await this.db.organization.findMany({
        where: cursor ? { id: { gt: cursor } } : {},
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const org of orgs) {
        try {
          for (const channel of await this.repo.channels(org.id))
            await this.collector.channel(org.id, channel);
        } catch {
          this.logger.warn(
            'Reporting sweep failed for an organization; retrying on the next schedule'
          );
        }
      }
      cursor = orgs.length === 100 ? orgs[orgs.length - 1].id : undefined;
    } while (cursor);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [
    ReportingRepository,
    ReportingService,
    ReportingCollector,
    ReportingPdf,
    ReportingSchedule,
  ],
  exports: [ReportingService, ReportingCollector, ReportingPdf],
})
export class ReportingModule {}
