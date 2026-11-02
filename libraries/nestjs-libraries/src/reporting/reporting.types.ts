export type Scope = 'CHANNEL' | 'POST';
export type Kind = 'FLOW' | 'STOCK' | 'LEVEL' | 'AVERAGE';
export interface MetricPoint {
  integrationId: string;
  entityId: string;
  metric: string;
  kind: Kind;
  unit: string;
  value: number;
  date: Date;
  customerId?: string | null;
  channelName?: string;
  collectedAt?: Date;
}
export interface MetricResult {
  metric: string;
  label: string;
  unit: string;
  kind: Kind;
  current: number | null;
  previous: number | null;
  change: number | null;
  complete: boolean;
  observed: number;
  expected: number;
  series: Array<{ date: string; value: number | null }>;
}
export interface OrganicReport {
  name: string;
  generatedAt: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  scope: Scope;
  customerId: string | null;
  customerName: string | null;
  campaignId: string | null;
  traffic: 'PLATFORM_TOTAL';
  channels: Array<{
    id: string;
    name: string;
    provider: string;
    metrics: MetricResult[];
  }>;
  metrics: MetricResult[];
  collection: Array<{
    integrationId: string;
    status: string;
    lastSuccessAt: Date | null;
    detail: string | null;
  }>;
  warnings: string[];
}
// Future connectors must preserve these dimensions rather than folding paid
// metrics into organic snapshots or mixing currencies / attribution windows.
export interface AdsReportingAdapter {
  provider: 'META_ADS' | 'GOOGLE_ADS';
  collect(input: {
    accountId: string;
    from: string;
    to: string;
    timezone: string;
    currency: string;
  }): Promise<
    Array<{
      date: string;
      level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP' | 'AD';
      externalEntityId: string;
      attributionWindow: string;
      impressions?: bigint;
      clicks?: bigint;
      spend?: string;
      conversions?: string;
      conversionValue?: string;
    }>
  >;
}
