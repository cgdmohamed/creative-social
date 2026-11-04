'use client';
import React, { useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';

const tabs = ['Campaigns', 'Ad Sets / Ad Groups', 'Ads', 'Creative Library', 'Drafts', 'Campaign Builder', 'Approval Queue', 'Change History'];
const creationKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const fresh = (google = false) => ({ operation: 'CREATE', objective: google ? 'SEARCH' : 'OUTCOME_TRAFFIC', currency: 'USD', dailyBudget: '10',
  start: new Date(Date.now() + 86400000).toISOString().slice(0, 16) + ':00Z', end: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 16) + ':00Z',
  bidStrategy: google ? 'MANUAL_CPC' : 'LOWEST_COST_WITHOUT_CAP', countries: ['US'], placements: 'AUTOMATIC',
  headlines: google ? ['Your first headline', 'Your second headline', 'Your third headline'] : ['Your headline'],
  descriptions: google ? ['Your first description', 'Your second description'] : ['Your advertising message'], destinationUrl: 'https://example.com/', keywords: google ? ['example'] : [], ...(google ? { maxCpc: '1' } : {}) });
async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join('; ') : 'Advertising request failed');
  return body;
}
export const CampaignPreview = ({ name, spec }: { name: string; spec: any }) => <figure className="border border-tableBorder rounded p-4 max-w-lg">
  <figcaption>Creative preview · illustrative, not a provider approval</figcaption><small>Sponsored · {name}</small>
  <h3 className="text-xl">{spec.headlines?.join(' | ')}</h3><p>{spec.descriptions?.join(' ')}</p><p>{spec.destinationUrl}</p>
  {spec.mediaId && <p>Workspace asset: {spec.mediaId} · provider upload and processing still required</p>}
  <strong>Learn more</strong>
</figure>;
const Review = ({ review, canApprove, act }: any) => {
  const [confirmation, setConfirmation] = useState(''), [reason, setReason] = useState('');
  const snapshot = review.snapshot;
  return <article className="border border-tableBorder p-4 space-y-3">
    <h3>{snapshot.name} · {review.status}</h3><p>{snapshot.account.name} · {snapshot.account.externalAccountId} · {snapshot.account.provider}</p>
    <p>{snapshot.spec.currency} {snapshot.spec.dailyBudget} per day · {snapshot.spec.start} to {snapshot.spec.end} · account timezone {snapshot.account.timezone}</p>
    <p>Requested action: {snapshot.spec.operation}. New campaign resources are planned PAUSED. Resume would enable delivery and spend.</p>
    {snapshot.source && <p>Observed provider campaign: {snapshot.source.name} · {snapshot.source.status} · observed budget {snapshot.source.dailyBudgetMinor || snapshot.source.dailyBudgetMicros || 'Unavailable'} provider units</p>}
    <CampaignPreview name={snapshot.name} spec={snapshot.spec} />
    {snapshot.plan.blockers?.map((text: string) => <p key={text}>{text}</p>)}
    {snapshot.warnings?.map((text: string) => <p key={text}>{text}</p>)}
    <p>Live submission is disabled. Approval records intent only. Expires: {review.expiresAt}</p>
    <details><summary>Provider request plan and review context</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(snapshot, null, 2)}</pre></details>
    {canApprove && review.status === 'PENDING' && <div><label className="block">Type this exact confirmation:<code className="block break-all">{snapshot.confirmation}</code>
      <input aria-label="Final campaign confirmation" className="w-full bg-third p-2" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
      <Button type="button" disabled={confirmation !== snapshot.confirmation} onClick={() => act(`/reviews/${review.id}/approve`, { digest: review.digest, confirmation })}>Approve intent · no provider submission</Button>
      <label className="block">Rejection reason<input maxLength={100} className="bg-third p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button type="button" disabled={!reason.trim()} onClick={() => act(`/reviews/${review.id}/reject`, { reason })}>Reject review</Button></div>}
  </article>;
};
export const CampaignManager = () => {
  const user = useUser();
  return <CampaignWorkspace key={user?.orgId} />;
};
const CampaignWorkspace = () => {
  const fetch = useFetch(), user = useUser(), manager = ['ADMIN', 'SUPERADMIN'].includes(user?.role), approver = user?.role === 'SUPERADMIN';
  const [tab, setTab] = useState('Campaigns'), [accountId, setAccount] = useState(''), [resources, setResources] = useState<any>(), [resourceError, setResourceError] = useState('');
  const [draftId, setDraftId] = useState(''), [revision, setRevision] = useState(0), [key, setKey] = useState(''), [name, setName] = useState('New campaign'), [spec, setSpec] = useState<any>(fresh());
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(false);
  const resourceRequest = useRef(0);
  const { data, error: loadError, mutate } = useSWR(['campaign-manager', user?.orgId], () => fetch('/campaign-manager/catalog').then(json), { revalidateOnFocus: false });
  const account = data?.accounts.find((a: any) => a.id === accountId), google = account?.provider === 'GOOGLE_ADS';
  const act = async (path: string, body: any) => {
    setPending(true); setError(''); setNotice('');
    try { const result = await json(await fetch('/campaign-manager' + path, { method: 'POST', body: JSON.stringify(body) })); await mutate(); setNotice('Saved locally. No provider campaign was changed.'); return result; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Advertising request failed'); }
    finally { setPending(false); }
  };
  const edit = (draft: any) => { setDraftId(draft.id); setRevision(draft.revision); setKey(draft.creationKey); setName(draft.name); setSpec(draft.spec); setAccount(draft.accountId); setTab('Campaign Builder'); };
  const reset = (id: string) => {
    resourceRequest.current++; const a = data?.accounts.find((item: any) => item.id === id); setAccount(id); setResources(undefined); setDraftId(''); setRevision(0); setKey(creationKey());
    setSpec({ ...fresh(a?.provider === 'GOOGLE_ADS'), currency: a?.currency || 'USD' }); setName('New campaign');
  };
  const list = async () => {
    const request = ++resourceRequest.current;
    setPending(true); setResources(undefined); setResourceError('');
    try { const level = tab === 'Campaigns' ? 'CAMPAIGN' : tab === 'Ads' ? 'AD' : 'AD_GROUP'; const result = await json(await fetch('/campaign-manager/resources?' + new URLSearchParams({ accountId, level }))); if (request === resourceRequest.current) setResources(result); }
    catch (failure) { if (request === resourceRequest.current) setResourceError(failure instanceof Error ? failure.message : 'Provider unavailable'); } finally { setPending(false); }
  };
  const field = (label: string, prop: string, type = 'text') => <label className="block">{label}<input className="block w-full bg-third p-2" type={type} value={spec[prop] || ''} onChange={(e) => setSpec({ ...spec, [prop]: e.target.value })} /></label>;
  const lines = (label: string, prop: string) => <label className="block">{label}<textarea className="block w-full bg-third p-2" value={spec[prop].join('\n')} onChange={(e) => setSpec({ ...spec, [prop]: e.target.value.split('\n') })} /></label>;
  return <main className="p-4 space-y-5"><h1 className="text-2xl">Advertising</h1>
    <p>Campaign management preview. Live provider submissions and changes are disabled. Approvals record intent only.</p>
    <Link href="/settings/advertising">Manage advertising connections</Link> · <Link href="/advertising-analytics">Advertising Analytics</Link>
    {(error || loadError) && <p role="alert">{error || 'Campaign workspace could not be loaded.'}</p>}{notice && <p role="status">{notice}</p>}
    <nav aria-label="Advertising sections" className="flex flex-wrap gap-3">{tabs.map((name) => <button type="button" key={name} aria-pressed={tab === name} onClick={() => { resourceRequest.current++; setTab(name); setResources(undefined); setResourceError(''); }}>{name}</button>)}</nav>
    <label>Advertising account<select aria-label="Advertising account" className="bg-third p-2 ml-2" value={accountId} onChange={(e) => reset(e.target.value)}><option value="">Select account</option>{data?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} · {a.externalAccountId} · {a.currency} · {a.provider}</option>)}</select></label>
    {account && <p>{account.timezone} · {account.providerStatus} · {account.enabled ? 'Selected' : 'Disconnected or not selected; local drafts only'}</p>}
    {['Campaigns', 'Ad Sets / Ad Groups', 'Ads'].includes(tab) && <section className="space-y-3"><h2>{tab}</h2><Button type="button" disabled={!accountId || pending || !account?.enabled} onClick={list}>Refresh provider list</Button>
      {resourceError && <p role="alert">{resourceError}. Reconnect or retry later; no campaign was changed.</p>}
      {resources && <><p>Fetched {resources.fetchedAt}</p><div className="overflow-auto"><table className="w-full text-left"><thead><tr><th>Name / ID</th><th>Status</th><th>Provider approval</th><th>Performance</th></tr></thead><tbody>{resources.rows.map((row: any) => <tr key={row.id}><td>{row.name}<small className="block">{row.id}</small></td><td>{row.status}</td><td>{row.approval} {row.validationErrors.map((e: any) => e.code).join(', ')}</td><td><Link href={'/advertising-analytics?' + new URLSearchParams({ accountId, campaignId: row.campaignId, level: tab === 'Campaigns' ? 'CAMPAIGN' : tab === 'Ads' ? 'AD' : 'AD_GROUP' })}>View performance</Link></td></tr>)}</tbody></table></div>{!resources.rows.length && <p>No provider resources returned.</p>}
      {tab === 'Campaigns' && manager && <div><p>To propose pause/resume, use the Campaign Builder with the listed campaign ID. Account ownership is rechecked during review.</p></div>}</>}
    </section>}
    {tab === 'Drafts' && <section><h2>Drafts</h2>{manager && <Button type="button" onClick={() => { reset(accountId); setTab('Campaign Builder'); }}>New draft</Button>}{data?.drafts.map((draft: any) => <article key={draft.id} className="border border-tableBorder p-3"><h3>{draft.name} · {draft.status} · revision {draft.revision}</h3>{manager && <div className="flex gap-3"><Button type="button" disabled={pending} onClick={() => edit(draft)}>Edit draft</Button><Button type="button" disabled={pending} onClick={() => act(`/drafts/${draft.id}/duplicate`, { key: creationKey() })}>Duplicate draft</Button><Button type="button" disabled={pending} onClick={async () => { if (await act(`/drafts/${draft.id}/review`, { revision: draft.revision })) setTab('Approval Queue'); }}>Request final review</Button></div>}</article>)}</section>}
    {tab === 'Campaign Builder' && (manager ? <form className="space-y-3 max-w-3xl" onSubmit={async (e) => { e.preventDefault(); const result = await act('/drafts' + (draftId ? '/' + draftId : ''), { accountId, name, key: key || creationKey(), spec, ...(draftId ? { revision } : {}) }); if (result) { edit(result); setTab('Drafts'); } }}>
      <h2>{draftId ? 'Edit draft' : 'Create draft'}</h2><label className="block">Campaign name<input className="bg-third p-2 block w-full" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block">Action<select className="bg-third p-2" value={spec.operation} onChange={(e) => { const value = { ...spec, operation: e.target.value }; if (e.target.value === 'CREATE') delete value.campaignId; setSpec(value); }}><option>CREATE</option><option>PAUSE</option><option>RESUME</option><option>UPDATE</option></select></label>
      {spec.operation !== 'CREATE' && field('Existing provider campaign ID', 'campaignId')}
      <label className="block">Provider workflow<select className="bg-third p-2" value={spec.objective} onChange={(e) => setSpec({ ...spec, objective: e.target.value })}>{(data?.objectives[account?.provider] || []).map((objective: string) => <option key={objective}>{objective}</option>)}</select></label>
      {field(`Daily budget (${account?.currency || 'select account currency'})`, 'dailyBudget')}{field('Start (UTC, YYYY-MM-DDTHH:mm:00Z)', 'start')}{field('End (UTC, YYYY-MM-DDTHH:mm:00Z)', 'end')}
      {google && field('Maximum CPC (account currency)', 'maxCpc')}<p>Account timezone: {account?.timezone || 'Select account'}. Daily budgets are not total spend caps; provider overdelivery rules apply. Bid strategy: {spec.bidStrategy}.</p>
      <label className="block">Countries (ISO codes, comma separated)<input className="block bg-third p-2" value={spec.countries.join(',')} onChange={(e) => setSpec({ ...spec, countries: e.target.value.split(',').map((v) => v.trim().toUpperCase()) })} /></label>
      {!google && <><label className="block">Placements<select className="bg-third p-2" value={spec.placements} onChange={(e) => setSpec({ ...spec, placements: e.target.value })}><option value="AUTOMATIC">Automatic</option><option value="FACEBOOK_FEED">Facebook Feed</option></select></label>{field('Meta Page ID (provider verification required)', 'pageId')}{field('Meta account image hash (provider verification required)', 'providerImageHash')}</>}
      <label className="block">Workspace creative<select className="bg-third p-2" value={spec.mediaId || ''} onChange={(e) => { const next = { ...spec }; if (e.target.value) next.mediaId = e.target.value; else delete next.mediaId; setSpec(next); }}><option value="">None</option>{data?.media.map((m: any) => <option key={m.id} value={m.id}>{m.name} · {m.type}</option>)}</select></label>
      {lines(google ? 'Headlines: 3–15, one per line, max 30 characters' : 'Headline: max 40 characters', 'headlines')}{lines(google ? 'Descriptions: 2–4, one per line, max 90 characters' : 'Advertising text: max 500 characters', 'descriptions')}{field('Destination HTTPS URL', 'destinationUrl', 'url')}{google && lines('Exact-match keywords, one per line (1–20)', 'keywords')}
      <CampaignPreview name={name} spec={spec} /><p>Only local draft data is saved. Local video/media selection does not upload a provider asset. Existing budget/date changes are not supported for provider execution.</p><Button type="submit" disabled={!accountId || pending}>Save draft</Button>
    </form> : <p>Workspace administrators can create and edit drafts.</p>)}
    {tab === 'Creative Library' && <section><h2>Workspace Creative Library</h2><Link href="/media">Upload images and videos in Media</Link><p>Workspace assets can be selected in drafts. Provider asset uploading and video ad execution are not enabled.</p>{data?.media.map((m: any) => <p key={m.id}>{m.name} · {m.type} · {m.id}</p>)}</section>}
    {tab === 'Approval Queue' && <section className="space-y-4"><h2>Approval Queue</h2><p>Only workspace owners (SUPERADMIN) may approve. Exact confirmation is required; no provider write follows.</p>{data?.reviews.map((r: any) => <Review key={r.id} review={r} canApprove={approver && !pending} act={act} />)}</section>}
    {tab === 'Change History' && <section><h2>Change History</h2><p>Latest 200 workspace audit events. Review records retain the immutable proposed changes.</p>{data?.history.map((event: any) => <p key={event.id}>{event.createdAt} · {event.action} · actor {event.actorId} · draft {event.draftId}</p>)}</section>}
  </main>;
};
