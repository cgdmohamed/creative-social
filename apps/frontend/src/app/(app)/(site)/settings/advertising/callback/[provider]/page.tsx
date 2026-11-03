import { AdvertisingCallback } from '@gitroom/frontend/components/settings/advertising.callback';
import { Metadata } from 'next';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Advertising authorization', referrer: 'no-referrer' };
export default async function Page({ params, searchParams }: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ state?: string; code?: string; error?: string }>;
}) {
  const { provider } = await params;
  const query = await searchParams;
  const text = (value: unknown) => typeof value === 'string' ? value : undefined;
  return <AdvertisingCallback provider={provider} state={text(query.state)} code={text(query.code)} error={text(query.error)} />;
}
