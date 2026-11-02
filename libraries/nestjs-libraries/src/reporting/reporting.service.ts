import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReportingRepository } from './reporting.repository';
import { CreateReportCampaignDto, ReportQueryDto } from './reporting.dto';
import { buildMetrics, dayKey, reportWindow } from './reporting.math';
import { OrganicReport } from './reporting.types';
import { REPORTING_PROVIDERS } from './provider.metrics';
@Injectable()
export class ReportingService {
  constructor(private repo: ReportingRepository) {}
  async selection(
    org: string,
    customerId?: string,
    ids?: string[],
    historical = false
  ) {
    if (
      customerId &&
      customerId !== '__unassigned' &&
      !(await this.repo.customer(org, customerId))
    )
      throw new NotFoundException('Client not found');
    const channels = await this.repo.channels(org, customerId, ids, historical);
    if (ids && channels.length !== new Set(ids).size)
      throw new NotFoundException(
        'One or more channels are unavailable for this client'
      );
    if (channels.length > 50)
      throw new BadRequestException('Select at most 50 channels');
    return channels;
  }
  async metadata(org: string, customerId?: string) {
    if (
      customerId &&
      customerId !== '__unassigned' &&
      !(await this.repo.customer(org, customerId))
    )
      throw new NotFoundException('Client not found');
    const allChannels = await this.repo.channels(
      org,
      customerId,
      undefined,
      true
    );
    const channels = allChannels.slice(0, 1000);
    return {
      truncated: allChannels.length > 1000,
      collectionEnabled: process.env.REPORTING_COLLECTION_ENABLED === 'true',
      pdfEnabled: !!process.env.REPORT_CHROMIUM_EXECUTABLE_PATH,
      clients: await this.repo.clients(org),
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.providerIdentifier,
        customerId: c.customerId,
        supported:
          REPORTING_PROVIDERS.includes(c.providerIdentifier) &&
          !c.disabled &&
          (!customerId || (c.customerId || '__unassigned') === customerId),
      })),
      campaigns: await this.repo.campaigns(org, customerId),
    };
  }
  async posts(org: string, customerId?: string, ids?: string[]) {
    const channels = await this.selection(org, customerId, ids);
    const posts = await this.repo.posts(
      org,
      channels.map((c) => c.id)
    );
    return {
      items: posts.slice(0, 500).map((p) => ({
        id: p.id,
        integrationId: p.integrationId,
        title: p.title || p.content.slice(0, 100),
        publishedAt: p.publishDate,
      })),
      truncated: posts.length > 500,
    };
  }
  async createCampaign(org: string, input: CreateReportCampaignDto) {
    const window = reportWindow(input.from, input.to);
    const channels = await this.selection(org, input.customerId);
    const owner =
      input.customerId === '__unassigned' ? null : input.customerId || null;
    const eligible = channels.filter((c) => (c.customerId || null) === owner);
    const posts = await this.repo.posts(
      org,
      eligible.map((c) => c.id),
      input.postIds
    );
    if (posts.length !== input.postIds.length)
      throw new NotFoundException(
        'Campaign posts must belong to the selected client and organization'
      );
    return this.repo.createCampaign(org, {
      name: input.name.trim(),
      customerId: owner || undefined,
      from: window.start,
      to: window.end,
      postIds: input.postIds,
    });
  }
  async report(org: string, query: ReportQueryDto): Promise<OrganicReport> {
    const window = reportWindow(query.from, query.to);
    let customerId = query.customerId;
    let snapshotCustomer: string | null | undefined =
      customerId === '__unassigned' ? null : customerId;
    let campaign = null;
    if (query.campaignId) {
      campaign = await this.repo.campaign(org, query.campaignId);
      if (
        !campaign ||
        (customerId && customerId !== (campaign.customerId || '__unassigned'))
      )
        throw new NotFoundException('Campaign not found');
      customerId = campaign.customerId || '__unassigned';
      snapshotCustomer = campaign.customerId;
    }
    const channels = await this.selection(
      org,
      customerId,
      query.integrationIds,
      true
    );
    const scope = campaign ? 'POST' : query.scope || 'CHANNEL';
    const posts =
      scope === 'POST'
        ? await this.repo.posts(
            org,
            channels.map((c) => c.id),
            campaign?.posts.map((p) => p.postId)
          )
        : [];
    if (posts.length > 500)
      throw new BadRequestException(
        'Post reports support at most 500 posts; narrow your channel or campaign selection'
      );
    const entities =
      scope === 'CHANNEL'
        ? channels.map((c) => ({ integrationId: c.id, entityId: '' }))
        : posts.map((p) => ({
            integrationId: p.integrationId,
            entityId: p.id,
            publishedAt: p.publishDate,
          }));
    let rows;
    try {
      rows = await this.repo.snapshots(
        org,
        channels.map((c) => c.id),
        scope,
        window.previousStart,
        window.end,
        snapshotCustomer,
        scope === 'POST' ? posts.map((p) => p.id) : undefined
      );
    } catch (error) {
      if ((error as Error).message === 'REPORT_TOO_LARGE')
        throw new BadRequestException(
          'Report too large; narrow your range or channels'
        );
      throw error;
    }
    const states = await this.repo.states(org);
    const client =
      customerId && customerId !== '__unassigned'
        ? await this.repo.customer(org, customerId)
        : null;
    const channelName = (c: (typeof channels)[number]) =>
      customerId
        ? rows.filter((r) => r.integrationId === c.id).slice(-1)[0]
            ?.channelName || c.name
        : c.name;
    return {
      name:
        campaign?.name ||
        (client
          ? client.name + ' - Organic content report'
          : 'Organic content report'),
      generatedAt: new Date().toISOString(),
      from: query.from,
      to: query.to,
      previousFrom: dayKey(window.previousStart),
      previousTo: dayKey(window.previousEnd),
      scope,
      customerId: customerId === '__unassigned' ? null : customerId || null,
      customerName:
        client?.name ||
        (customerId === '__unassigned' ? 'Unassigned channels' : null),
      campaignId: campaign?.id || null,
      traffic: 'PLATFORM_TOTAL',
      metrics: buildMetrics(rows, entities, query.from, query.to),
      channels: channels.map((c) => ({
        id: c.id,
        name: channelName(c),
        provider: c.providerIdentifier,
        metrics: buildMetrics(
          rows.filter((r) => r.integrationId === c.id),
          entities.filter((e) => e.integrationId === c.id),
          query.from,
          query.to
        ),
      })),
      collection: states
        .filter((s) => channels.some((c) => c.id === s.integrationId))
        .map(({ postCursor, ...safe }) => safe),
      warnings: [
        'Platform-reported content metrics may include promoted activity. Paid Ads data is not connected or mixed into this report.',
        'Missing observations remain unknown. Comparisons are shown only when both windows have complete observations.',
        scope === 'POST'
          ? 'Post metrics show observed lifetime-counter changes, not lifetime totals attributed to the publication date. Missing baselines stay unknown; signed corrections are retained.'
          : 'Daily reach totals sum daily unique audiences and are not a deduplicated period audience. Averages are unweighted observations.',
        'Dates are UTC collection days or provider calendar labels, not a client-local timezone conversion.',
        ...(query.to >= new Date().toISOString().slice(0, 10)
          ? [
              'The current day is provisional and may change on later collection.',
            ]
          : []),
      ],
    };
  }
}
