import { BadRequestException } from '@nestjs/common';
import { campaignId, CampaignSpec } from './campaign.specification';
import type { CampaignManagementApi } from './campaign.management-api';
export const keywordKey = (text: string, matchType: string, negative: boolean) => `${negative ? 'NEGATIVE' : 'POSITIVE'}:${matchType}:${text.toLowerCase().trim().replace(/\s+/g, ' ')}`;
export async function keywordChanges(api: CampaignManagementApi, account: any, spec: CampaignSpec, groupResource: string) {
  const groupId = campaignId(groupResource.split('/').pop()), prefix = `customers/${campaignId(account.externalAccountId)}`;
  const rows = await api.googleSearch(`SELECT ad_group_criterion.resource_name, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group.id = ${groupId} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`);
  if (rows.length > 1000) throw new BadRequestException('Keyword replacement is limited to 1000 existing targets per reviewed change');
  const positive = spec.updateFields?.includes('keywords'), negative = spec.updateFields?.includes('negativeKeywords');
  const targets = [
    ...(positive ? spec.keywords.map((text) => ({ text, matchType: spec.keywordMatchType || 'EXACT', negative: false })) : []),
    ...(negative ? (spec.negativeKeywords || []).map((text) => ({ text, matchType: spec.negativeMatchType || 'PHRASE', negative: true })) : []),
  ];
  const desired = new Map(targets.map((target) => [keywordKey(target.text, target.matchType, target.negative), target]));
  const retained = new Set<string>(), operations: any[] = [];
  for (const row of rows) {
    const criterion = row.adGroupCriterion;
    if (!criterion || typeof criterion.keyword?.text !== 'string' || !['EXACT', 'PHRASE', 'BROAD'].includes(criterion.keyword?.matchType) || !new RegExp(`^${prefix}/adGroupCriteria/${groupId}~\\d+$`).test(criterion.resourceName || '')) throw new BadRequestException('Invalid keyword target ownership');
    const isNegative = criterion.negative === true;
    if (isNegative ? !negative : !positive) continue;
    const key = keywordKey(criterion.keyword.text, criterion.keyword.matchType, isNegative);
    if (desired.has(key) && !retained.has(key)) { retained.add(key); continue; }
    operations.push({ adGroupCriterionOperation: { remove: criterion.resourceName } });
  }
  for (const [key, target] of desired) if (!retained.has(key)) operations.push({ adGroupCriterionOperation: { create: { adGroup: groupResource, ...(target.negative ? { negative: true } : { status: 'ENABLED' }), keyword: { text: target.text, matchType: target.matchType } } } });
  return { operations, verification: { groupId, positive: !!positive, negative: !!negative, keys: [...desired.keys()].sort() } };
}
export async function campaignTargetChanges(api: CampaignManagementApi, account: any, spec: CampaignSpec) {
  const prefix = `customers/${campaignId(account.externalAccountId)}`, campaign = `${prefix}/campaigns/${campaignId(spec.campaignId)}`;
  const targets = await api.googleTargeting(spec);
  const rows = await api.googleSearch(`SELECT campaign_criterion.resource_name, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id = ${spec.campaignId} AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE') AND campaign_criterion.status != 'REMOVED'`);
  if (rows.length > 1000) throw new BadRequestException('Location/language replacement is limited to 1000 existing targets per reviewed change');
  const desired = new Set(targets.locationResources), retained = new Set<string>(), operations: any[] = [];
  for (const row of rows) {
    const criterion = row.campaignCriterion;
    if (!criterion || !new RegExp(`^${prefix}/campaignCriteria/${spec.campaignId}~\\d+$`).test(criterion.resourceName || '')) throw new BadRequestException('Invalid campaign target ownership');
    if (criterion.negative === true) continue; // Never silently remove geographic exclusions.
    if (criterion.language) continue; // Preserve legacy language records; Search no longer accepts setting them.
    const key = criterion.location?.geoTargetConstant || criterion.language?.languageConstant;
    if (desired.has(key) && !retained.has(key)) { retained.add(key); continue; }
    operations.push({ campaignCriterionOperation: { remove: criterion.resourceName } });
  }
  for (const target of desired) if (!retained.has(target)) operations.push({ campaignCriterionOperation: { create: { campaign, ...(target.startsWith('geoTargetConstants/') ? { location: { geoTargetConstant: target } } : { language: { languageConstant: target } }) } } });
  return { operations, verification: { campaignId: spec.campaignId!, keys: [...desired].sort() } };
}
