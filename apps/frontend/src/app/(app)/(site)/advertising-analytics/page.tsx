import { PaidAnalytics } from '@gitroom/frontend/components/reporting/paid-analytics';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selection: Record<string, string> = {};
  if (typeof params.accountId === 'string' && typeof params.campaignId === 'string' && typeof params.level === 'string' && ['CAMPAIGN', 'AD_GROUP', 'AD'].includes(params.level)) {
    selection.accountId = params.accountId; selection.campaignId = params.campaignId; selection.level = params.level;
  }
  return <PaidAnalytics initialSelection={selection} />;
}
