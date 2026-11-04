export const paidLevels = ['ACCOUNT', 'CAMPAIGN', 'AD_GROUP', 'AD'] as const;
export type PaidLevel = typeof paidLevels[number];
export const definitionVersion = 'paid-v1';
export const attribution = (provider: string) => provider === 'META_ADS'
  ? 'meta:7d_click+1d_view:impression-date:omni_purchase:lead:v1'
  : 'google:primary:interaction-date:provider-configured-window:PURCHASE:SUBMIT_LEAD_FORM:v1';
export const paidContext = (account: { provider: string; currency: string; timezone: string }) =>
  `${attribution(account.provider)};currency=${account.currency};timezone=${account.timezone}`;
export type PaidPoint = {
  attributionDetails?: Record<string, any>;
  valueReliable?: boolean;
  date: string; externalEntityId: string; entityName: string;
  externalCampaignId: string | null; externalAdGroupId: string | null;
  spend: string | null; impressions: string | null; clicks: string | null;
  conversions: string | null; conversionValue: string | null;
  leads: string | null; purchaseConversionValue: string | null; reach: string | null;
};
export type PaidQuery = { from: string; to: string; level: PaidLevel;
  customerId?: string; provider?: 'META_ADS' | 'GOOGLE_ADS'; accountId?: string; campaignId?: string };
