import { BadRequestException } from '@nestjs/common';
import { MetaCampaignAdapter } from './meta.campaign.adapter';
import { GoogleCampaignAdapter } from './google.campaign.adapter';
import { CampaignSpec, budgetUnits, campaignId } from './campaign.specification';
import { CampaignManagementApi, CampaignStep } from './campaign.management-api';
import { googleBidding } from './campaign.bidding';
import { campaignTargetChanges, keywordChanges } from './campaign.targeting';

export async function executionPlan(api: CampaignManagementApi, account: any, name: string, spec: CampaignSpec, executionId: string, asset?: { kind: string; imageHash?: string | null; providerId?: string | null; thumbnailUrl?: string | null }): Promise<CampaignStep[]> {
  const marker = `CS-${executionId}`;
  const uniqueName = `${name.slice(0, 50)} · ${marker}`;
  if (account.provider === 'META_ADS') {
    if (spec.operation !== 'CREATE') {
      const level = spec.resourceType || 'CAMPAIGN';
      const target = level === 'CAMPAIGN' ? campaignId(spec.campaignId) : campaignId(spec.resourceId);
      const resource = await api.metaRead(target, { fields: level === 'CAMPAIGN' ? 'id,account_id,name,status,daily_budget,lifetime_budget,start_time,stop_time' : level === 'AD_GROUP' ? 'id,account_id,campaign_id,name,status,daily_budget,lifetime_budget,start_time,end_time,targeting' : 'id,account_id,campaign_id,adset_id,name,status,creative{id}' });
      if (String(resource.account_id) !== account.externalAccountId.replace(/^act_/, '')) throw new BadRequestException('Campaign does not belong to selected account');
      if (level !== 'CAMPAIGN' && String(resource.campaign_id) !== spec.campaignId) throw new BadRequestException('Child does not belong to selected campaign');
      if (spec.operation === 'DUPLICATE') {
        const groups = level === 'CAMPAIGN' ? await api.metaCollection(`${target}/adsets`, 'id') : [];
        const ads = level !== 'AD' ? await api.metaCollection(`${target}/ads`, 'id') : [];
        return [{ name: 'provider-copy', edge: `${target}/copies`, body: { ...(level === 'AD' ? {} : { deep_copy: true }), status_option: 'PAUSED', rename_options: { rename_suffix: ` · ${marker}`, rename_strategy: 'DEEP_RENAME' } }, response: 'META_COPY',
          reconcile: { edge: `${account.externalAccountId}/${level === 'CAMPAIGN' ? 'campaigns' : level === 'AD_GROUP' ? 'adsets' : 'ads'}`, suffix: ` · ${marker}`, expectedGroups: groups.length, expectedAds: ads.length, ...(level !== 'CAMPAIGN' ? { parentCampaignId: spec.campaignId } : {}) } }];
      }
      let body: any;
      if (spec.operation === 'UPDATE') {
        body = {}; const fields = spec.updateFields || [];
        if (fields.includes('name')) body.name = name;
        if (fields.includes('budget')) {
          if (!resource.daily_budget || resource.lifetime_budget && resource.lifetime_budget !== '0') throw new BadRequestException('Select a resource that owns a daily budget; lifetime-budget conversion is not implicit');
          body.daily_budget = budgetUnits(spec.dailyBudget, spec.currency, false);
        }
        if (fields.includes('end')) body.end_time = spec.end;
        if (fields.includes('targeting')) body.targeting = { geo_locations: { countries: spec.countries }, ...(spec.placements === 'FACEBOOK_FEED' ? { publisher_platforms: ['facebook'], facebook_positions: ['feed'] } : {}) };
        if (fields.includes('bid')) { body.bid_strategy = spec.bidStrategy; if (spec.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP') body.bid_amount = budgetUnits(spec.maxBid!, spec.currency, false); }
        if (fields.includes('creative')) {
          const imageHash = asset?.kind === 'IMAGE' ? asset.imageHash : spec.providerImageHash;
          if (!spec.pageId || !imageHash && asset?.kind !== 'VIDEO') throw new BadRequestException('Select a Page and account-owned ready image/video for the replacement creative');
          const pages = await api.metaCollection(`${account.externalAccountId}/promote_pages`, 'id');
          if (!pages.some((page) => page.id === spec.pageId)) throw new BadRequestException('Page is outside selected advertising account');
          if (imageHash) {
            const images = await api.metaRead(`${account.externalAccountId}/adimages`, { fields: 'hash', hashes: JSON.stringify([imageHash]) });
            if (!images.data?.some((image: any) => image.hash === imageHash)) throw new BadRequestException('Image is outside selected advertising account');
          }
          const createPlan = new MetaCampaignAdapter().plan(account, uniqueName, { ...spec, operation: 'CREATE', providerImageHash: imageHash || undefined });
          if (asset?.kind === 'VIDEO') {
            if (!asset.providerId || !asset.thumbnailUrl) throw new BadRequestException('Video must finish processing before replacing an ad creative');
            (createPlan.operations[2] as any).body.object_story_spec = { page_id: spec.pageId, video_data: { video_id: asset.providerId, image_url: asset.thumbnailUrl, title: spec.headlines[0], message: spec.descriptions[0], call_to_action: { type: 'LEARN_MORE', value: { link: spec.destinationUrl } } } };
          }
          return [
            { name: 'creative', edge: `${account.externalAccountId}/adcreatives`, body: (createPlan.operations[2] as any).body, response: 'META_ID' },
            { name: 'ad-update', edge: target, body: { ...body, creative: { creative_id: '$creative.id' } }, response: 'META_SUCCESS' },
          ];
        }
      } else body = { status: spec.operation === 'PAUSE' ? 'PAUSED' : 'ACTIVE' };
      return [{ name: 'resource-update', edge: target, body, response: 'META_SUCCESS' }];
    }
    const imageHash = asset?.kind === 'IMAGE' ? asset.imageHash : spec.providerImageHash;
    if (!spec.pageId || !imageHash && asset?.kind !== 'VIDEO') throw new BadRequestException('Select a Page and a ready image/video advertising asset before submission');
    const pages = await api.metaCollection(`${account.externalAccountId}/promote_pages`, 'id');
    if (!pages.some((page) => page.id === spec.pageId)) throw new BadRequestException('Page is not available to the selected advertising account');
    if (spec.pixelId) {
      const pixels = await api.metaCollection(`${account.externalAccountId}/adspixels`, 'id');
      if (!pixels.some((pixel) => pixel.id === spec.pixelId)) throw new BadRequestException('Pixel is not available to the selected advertising account');
    }
    if (imageHash) {
      const images = await api.metaRead(`${account.externalAccountId}/adimages`, { fields: 'hash', hashes: JSON.stringify([imageHash]) });
      if (!images.data?.some((image: any) => image.hash === imageHash)) throw new BadRequestException('Image is not available to the selected advertising account');
    }
    const plan = new MetaCampaignAdapter().plan(account, uniqueName, { ...spec, providerImageHash: imageHash || undefined });
    const level = spec.resourceType || 'CAMPAIGN';
    let parent: any;
    if (level !== 'CAMPAIGN') {
      parent = await api.metaRead(campaignId(spec.campaignId), { fields: 'id,account_id,objective,daily_budget,lifetime_budget' });
      if (String(parent.account_id) !== account.externalAccountId.replace(/^act_/, '') || parent.objective !== spec.objective) throw new BadRequestException('Select the existing campaign objective and an account-owned campaign');
      if (level === 'AD') {
        const group = await api.metaRead(campaignId(spec.resourceId), { fields: 'id,account_id,campaign_id' });
        if (String(group.account_id) !== account.externalAccountId.replace(/^act_/, '') || group.campaign_id !== spec.campaignId) throw new BadRequestException('Ad set is outside selected account/campaign');
      }
    }
    if (asset?.kind === 'VIDEO') {
      if (!asset.providerId || !asset.thumbnailUrl) throw new BadRequestException('Video processing and thumbnail generation must finish before submission');
      (plan.operations[2] as any).body.object_story_spec = { page_id: spec.pageId, video_data: { video_id: asset.providerId, image_url: asset.thumbnailUrl,
        title: spec.headlines[0], message: spec.descriptions[0], call_to_action: { type: spec.objective === 'OUTCOME_APP_PROMOTION' ? 'INSTALL_MOBILE_APP' : 'LEARN_MORE', value: { link: spec.destinationUrl } } } };
    }
    const steps: CampaignStep[] = plan.operations.map((operation: any, index: number) => ({ name: ['campaign', 'adset', 'creative', 'ad'][index], edge: `${account.externalAccountId}/${operation.edge}`, body: operation.body, response: 'META_ID' }));
    if (level === 'AD_GROUP') {
      steps[1].body.campaign_id = spec.campaignId;
      if (Number(parent.daily_budget) > 0 || Number(parent.lifetime_budget) > 0) { delete steps[1].body.daily_budget; delete steps[1].body.bid_strategy; }
      return steps.slice(1);
    }
    if (level === 'AD') { steps[3].body.adset_id = spec.resourceId; return steps.slice(2); }
    return steps;
  }
  if (spec.operation !== 'CREATE') {
    if (spec.resourceType && spec.resourceType !== 'CAMPAIGN') {
      const level = spec.resourceType, prefix = `customers/${campaignId(account.externalAccountId)}`;
      const [group, ad] = (spec.resourceId || '').split('~');
      const rows = await api.googleSearch(level === 'AD_GROUP'
        ? `SELECT ad_group.resource_name, ad_group.id, campaign.bidding_strategy_type FROM ad_group WHERE ad_group.id = ${campaignId(group)} AND campaign.id = ${campaignId(spec.campaignId)} AND ad_group.status != 'REMOVED'`
        : `SELECT ad_group_ad.resource_name, ad_group_ad.ad.resource_name FROM ad_group_ad WHERE ad_group.id = ${campaignId(group)} AND ad_group_ad.ad.id = ${campaignId(ad)} AND campaign.id = ${campaignId(spec.campaignId)} AND ad_group_ad.status != 'REMOVED'`);
      if (rows.length !== 1) throw new BadRequestException('Child resource unavailable in selected account/campaign');
      const operationKey = level === 'AD_GROUP' ? 'adGroupOperation' : 'adGroupAdOperation';
      const resourceName = level === 'AD_GROUP' ? rows[0].adGroup?.resourceName : rows[0].adGroupAd?.resourceName;
      if (typeof resourceName !== 'string' || !resourceName.startsWith(`${prefix}/`)) throw new BadRequestException('Invalid child resource ownership');
      if (spec.operation !== 'UPDATE') return [{ name: 'child-status', edge: 'googleAds:mutate', body: { mutateOperations: [{ [operationKey]: { update: { resourceName, status: spec.operation === 'PAUSE' ? 'PAUSED' : 'ENABLED' }, updateMask: 'status' } }] }, response: 'GOOGLE_MUTATE' }];
      const fields = spec.updateFields || [];
      if (level === 'AD_GROUP') {
        const update: any = { resourceName }, mask: string[] = [];
        if (fields.includes('name')) { update.name = name; mask.push('name'); }
        if (fields.includes('bid')) { if (rows[0].campaign?.biddingStrategyType !== 'MANUAL_CPC') throw new BadRequestException('Automated campaign bidding does not support a manual ad-group CPC change'); update.cpcBidMicros = budgetUnits(spec.maxCpc!, spec.currency, true); mask.push('cpc_bid_micros'); }
        const keywordChange = fields.includes('keywords') || fields.includes('negativeKeywords') ? await keywordChanges(api, account, spec, resourceName) : null;
        const operations = [...(mask.length ? [{ adGroupOperation: { update, updateMask: mask.join(',') } }] : []), ...keywordChange?.operations || []];
        return operations.length ? [{ name: 'ad-group-update', edge: 'googleAds:mutate', body: { mutateOperations: operations }, ...(keywordChange ? { verification: { keywords: keywordChange.verification } } : {}), response: 'GOOGLE_MUTATE' }] : [];
      }
      const references = await api.googleSearch(`SELECT ad_group_ad.resource_name FROM ad_group_ad WHERE ad_group_ad.ad.id = ${campaignId(ad)} AND ad_group_ad.status != 'REMOVED'`);
      if (references.length !== 1) throw new BadRequestException('This ad is shared by multiple ad groups; editing it would affect other groups');
      return [{ name: 'search-ad-update', edge: 'googleAds:mutate', body: { mutateOperations: [{ adOperation: { update: { resourceName: rows[0].adGroupAd.ad.resourceName,
        finalUrls: [spec.destinationUrl], responsiveSearchAd: { headlines: spec.headlines.map((text) => ({ text })), descriptions: spec.descriptions.map((text) => ({ text })) } },
        updateMask: 'final_urls,responsive_search_ad.headlines,responsive_search_ad.descriptions' } }] }, response: 'GOOGLE_MUTATE' }];
    }
    const rows = await api.googleSearch(`SELECT campaign.id, campaign.campaign_budget, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaignId(spec.campaignId)} AND campaign.status != 'REMOVED'`);
    if (rows.length !== 1) throw new BadRequestException('Campaign unavailable in selected account');
    const prefix = `customers/${campaignId(account.externalAccountId)}`;
    let operations: any[]; let verification: CampaignStep['verification'];
    if (spec.operation === 'UPDATE') {
      const fields = spec.updateFields || [];
      if (fields.includes('budget') && rows[0].campaignBudget?.explicitlyShared === true && !spec.allowSharedBudgetChange) throw new BadRequestException('Shared budget changes require explicitly acknowledging all affected campaigns in the reviewed budget context');
      const budget = rows[0].campaign?.campaignBudget;
      if (fields.includes('budget') && (typeof budget !== 'string' || !budget.startsWith(`${prefix}/campaignBudgets/`) || !/^\d+$/.test(budget.split('/').pop()!))) throw new BadRequestException('Invalid campaign budget ownership');
      const localDate = (value: string) => value.length === 10 ? value.replace(/-/g, '') : new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replace(/-/g, '');
      operations = [];
      if (fields.includes('budget')) operations.push({ campaignBudgetOperation: { update: { resourceName: budget, amountMicros: budgetUnits(spec.dailyBudget, spec.currency, true) }, updateMask: 'amount_micros' } });
      const update: any = { resourceName: `${prefix}/campaigns/${spec.campaignId}` }, mask: string[] = [];
      if (fields.includes('name')) { update.name = name; mask.push('name'); } if (fields.includes('end')) { update.endDate = localDate(spec.end); mask.push('end_date'); }
      if (fields.includes('bid')) { const bidding = googleBidding(spec); Object.assign(update, bidding); mask.push(...Object.keys(bidding).map((key) => key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase()))); }
      if (fields.includes('targeting')) {
        const targets = await campaignTargetChanges(api, account, spec); operations.push(...targets.operations); verification = { targeting: targets.verification };
        update.geoTargetTypeSetting = { positiveGeoTargetType: 'PRESENCE' }; mask.push('geo_target_type_setting.positive_geo_target_type');
      }
      if (mask.length) operations.push({ campaignOperation: { update, updateMask: mask.join(',') } });
    } else operations = [{ campaignOperation: { update: { resourceName: `${prefix}/campaigns/${spec.campaignId}`, status: spec.operation === 'PAUSE' ? 'PAUSED' : 'ENABLED' }, updateMask: 'status' } }];
    return [{ name: 'campaign-update', edge: 'googleAds:mutate', body: { mutateOperations: operations }, ...(verification ? { verification } : {}), response: 'GOOGLE_MUTATE' }];
  }
  if (spec.resourceType && spec.resourceType !== 'CAMPAIGN') {
    const prefix = `customers/${campaignId(account.externalAccountId)}`;
    const parents = await api.googleSearch(`SELECT campaign.id, campaign.advertising_channel_type, campaign.bidding_strategy_type FROM campaign WHERE campaign.id = ${campaignId(spec.campaignId)} AND campaign.status != 'REMOVED'`);
    if (parents.length !== 1 || parents[0].campaign?.advertisingChannelType !== 'SEARCH') throw new BadRequestException('Select an account-owned Search campaign for these responsive search resources');
    const original: any[] = new GoogleCampaignAdapter().plan(account, uniqueName, spec).request.mutateOperations;
    if (spec.resourceType === 'AD_GROUP') {
      const operations = original.filter((item) => !item.campaignBudgetOperation && !item.campaignOperation);
      const group = operations.find((item) => item.adGroupOperation).adGroupOperation.create;
      group.campaign = `${prefix}/campaigns/${spec.campaignId}`;
      if ((parents[0].campaign.biddingStrategyType === 'MANUAL_CPC') !== (spec.bidStrategy === 'MANUAL_CPC')) throw new BadRequestException('Select the parent campaign bidding strategy: manual groups need CPC; automated groups inherit automation without a manual cap');
      if (parents[0].campaign.biddingStrategyType !== 'MANUAL_CPC') delete group.cpcBidMicros;
      return [{ name: 'google-ad-group', edge: 'googleAds:mutate', body: { mutateOperations: operations }, response: 'GOOGLE_MUTATE' }];
    }
    const groups = await api.googleSearch(`SELECT ad_group.resource_name FROM ad_group WHERE campaign.id = ${campaignId(spec.campaignId)} AND ad_group.id = ${campaignId(spec.resourceId)} AND ad_group.status != 'REMOVED'`);
    if (groups.length !== 1) throw new BadRequestException('Ad group is outside the selected campaign/account');
    if (groups[0].adGroup?.resourceName !== `${prefix}/adGroups/${spec.resourceId}`) throw new BadRequestException('Invalid parent ad-group ownership');
    const ad = original.find((item) => item.adGroupAdOperation).adGroupAdOperation.create;
    ad.adGroup = groups[0].adGroup.resourceName; ad.labels = [`${prefix}/labels/-4`];
    return [{ name: 'google-ad', edge: 'googleAds:mutate', body: { mutateOperations: [
      { labelOperation: { create: { resourceName: `${prefix}/labels/-4`, name: marker } } }, { adGroupAdOperation: { create: ad } },
    ] }, response: 'GOOGLE_MUTATE' }];
  }
  const targeting = await api.googleTargeting(spec);
  const request = new GoogleCampaignAdapter().plan(account, uniqueName, spec).request;
  const prefix = `customers/${campaignId(account.externalAccountId)}`;
  const operations: any[] = [...request.mutateOperations];
  operations[1].campaignOperation.create.geoTargetTypeSetting = { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' };
  for (const geoTargetConstant of targeting.locationResources) operations.push({ campaignCriterionOperation: { create: { campaign: `${prefix}/campaigns/-2`, location: { geoTargetConstant } } } });
  for (const languageConstant of targeting.languageResources) operations.push({ campaignCriterionOperation: { create: { campaign: `${prefix}/campaigns/-2`, language: { languageConstant } } } });
  return [{ name: 'google-hierarchy', edge: 'googleAds:mutate', body: { mutateOperations: operations }, response: 'GOOGLE_MUTATE' }];
}

export function materialize(step: CampaignStep, resources: Record<string, any>): CampaignStep {
  const replace = (value: any): any => {
    if (typeof value === 'string' && /^\$[a-z]+\.id$/.test(value)) {
      const id = resources[value.slice(1).split('.')[0]]?.id;
      if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) throw new BadRequestException('Required parent resource has not been confirmed');
      return id;
    }
    if (Array.isArray(value)) return value.map(replace);
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)])) : value;
  };
  return { ...step, body: replace(step.body) };
}
