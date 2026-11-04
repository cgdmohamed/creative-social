import { budgetUnits, CampaignSpec } from './campaign.specification';
export function googleBidding(spec: CampaignSpec): Record<string, any> {
  switch (spec.bidStrategy) {
    case 'MANUAL_CPC': return { manualCpc: {} };
    case 'MAXIMIZE_CLICKS': return { targetSpend: { cpcBidCeilingMicros: budgetUnits(spec.maxCpc!, spec.currency, true) } };
    case 'MAXIMIZE_CONVERSIONS': return { maximizeConversions: {} };
    case 'TARGET_CPA': return { maximizeConversions: { targetCpaMicros: budgetUnits(spec.targetCpa!, spec.currency, true) } };
    case 'MAXIMIZE_CONVERSION_VALUE': return { maximizeConversionValue: {} };
    case 'TARGET_ROAS': return { maximizeConversionValue: { targetRoas: Number(spec.targetRoas) } };
    default: throw new Error('Unsupported Google bidding strategy');
  }
}
