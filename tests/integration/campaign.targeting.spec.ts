import { keywordChanges, campaignTargetChanges } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.targeting';
import { campaignSpecification } from './campaign.fixture';
const account = { externalAccountId: '123' };
test('keyword replacement preserves unchanged targets and unselected negatives without restarting them', async () => {
  const api: any = { googleSearch: async () => [
    { adGroupCriterion: { resourceName: 'customers/123/adGroupCriteria/2~1', keyword: { text: 'EXAMPLE', matchType: 'EXACT' } } },
    { adGroupCriterion: { resourceName: 'customers/123/adGroupCriteria/2~2', negative: true, keyword: { text: 'free', matchType: 'PHRASE' } } },
    { adGroupCriterion: { resourceName: 'customers/123/adGroupCriteria/2~3', keyword: { text: 'old', matchType: 'EXACT' } } },
  ] };
  const result = await keywordChanges(api, account, { ...campaignSpecification(true), updateFields: ['keywords'], keywords: ['example', 'new'] }, 'customers/123/adGroups/2');
  expect(result.operations).toEqual([
    { adGroupCriterionOperation: { remove: 'customers/123/adGroupCriteria/2~3' } },
    { adGroupCriterionOperation: { create: { adGroup: 'customers/123/adGroups/2', status: 'ENABLED', keyword: { text: 'new', matchType: 'EXACT' } } } },
  ]);
  expect(result.verification.negative).toBe(false);
});
test('keyword replacement rejects foreign provider resources before any mutation', async () => {
  const api: any = { googleSearch: async () => [{ adGroupCriterion: { resourceName: 'customers/999/adGroupCriteria/2~1', keyword: { text: 'example', matchType: 'EXACT' } } }] };
  await expect(keywordChanges(api, account, { ...campaignSpecification(true), updateFields: ['keywords'] }, 'customers/123/adGroups/2')).rejects.toThrow('ownership');
});
test('campaign audience replacement preserves geographic exclusions, legacy languages and retained criteria', async () => {
  const api: any = { googleTargeting: async () => ({ locationResources: ['geoTargetConstants/2840'], languageResources: ['languageConstants/1000'] }), googleSearch: async () => [
    { campaignCriterion: { resourceName: 'customers/123/campaignCriteria/1~1', location: { geoTargetConstant: 'geoTargetConstants/2840' } } },
    { campaignCriterion: { resourceName: 'customers/123/campaignCriteria/1~2', negative: true, location: { geoTargetConstant: 'geoTargetConstants/999' } } },
    { campaignCriterion: { resourceName: 'customers/123/campaignCriteria/1~3', language: { languageConstant: 'languageConstants/1000' } } },
  ] };
  const result = await campaignTargetChanges(api, account, { ...campaignSpecification(true), campaignId: '1' });
  expect(result.operations).toEqual([]);
});
