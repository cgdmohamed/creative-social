'use client';
import React, { useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import Image from 'next/image';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { AdvertisingAssets } from './advertising-assets';

const tabs = ['Campaigns', 'Ad Sets / Ad Groups', 'Ads', 'Creative Library', 'Drafts', 'Campaign Builder', 'Approval Queue', 'Change History'];
const creationKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const fresh = (google = false) => ({ operation: 'CREATE', objective: google ? 'SEARCH' : 'OUTCOME_TRAFFIC', currency: 'USD', dailyBudget: '10',
  start: google ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : new Date(Date.now() + 86400000).toISOString().slice(0, 16) + ':00Z', end: google ? new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10) : new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 16) + ':00Z',
  bidStrategy: google ? 'MANUAL_CPC' : 'LOWEST_COST_WITHOUT_CAP', countries: ['US'], placements: 'AUTOMATIC',
  headlines: google ? ['Your first headline', 'Your second headline', 'Your third headline'] : ['Your headline'],
  descriptions: google ? ['Your first description', 'Your second description'] : ['Your advertising message'], destinationUrl: 'https://example.com/', keywords: google ? ['example'] : [], ...(google ? { maxCpc: '1' } : {}) });
async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error([typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join('; ') : 'Advertising request failed', ...(Array.isArray(body.issues) ? body.issues.map((issue: any) => [issue.code, issue.field, issue.message].filter(Boolean).join(': ')) : [])].join(' · '));
  return body;
}
const ProviderAssetPreview = ({ accountId, assetId }: { accountId: string; assetId: string }) => {
  const fetch = useFetch(), user = useUser();
  const { data } = useSWR(['advertising-assets', user?.orgId, accountId], () => fetch(`/campaign-manager/assets/${accountId}`).then(json), { revalidateOnFocus: false });
  const asset = data?.assets?.find((item: any) => item.id === assetId && item.accountId === accountId);
  if (!asset?.thumbnailUrl) return <p>Asset thumbnail is unavailable or still processing. Inspect the original file before submitting.</p>;
  return <Image src={asset.thumbnailUrl} alt={asset.name || 'Advertising creative'} width={500} height={300} unoptimized referrerPolicy="no-referrer" />;
};
export const CampaignPreview = ({ name, spec, accountId }: { name: string; spec: any; accountId?: string }) => <figure className="border border-tableBorder rounded p-4 max-w-lg">
  <figcaption>Creative preview · illustrative, not a provider approval</figcaption><small>Sponsored · {name}</small>
  <h3 className="text-xl">{spec.headlines?.join(' | ')}</h3><p>{spec.descriptions?.join(' ')}</p><p>{spec.destinationUrl}</p>
  {spec.mediaId && <p>Workspace asset: {spec.mediaId} · provider upload and processing still required</p>}
  {spec.advertisingAssetId && accountId && <ProviderAssetPreview accountId={accountId} assetId={spec.advertisingAssetId} />}
  <strong>Learn more</strong>
</figure>;
const Review = ({ review, canApprove, act, execution, enabled }: any) => {
  const [confirmation, setConfirmation] = useState(''), [reason, setReason] = useState('');
  const snapshot = review.snapshot;
  const [submission, setSubmission] = useState(''), [authorizeSubmission, setAuthorizeSubmission] = useState(false);
  const [abandon, setAbandon] = useState(''), [evidence, setEvidence] = useState<Record<string, string>>({});
  const phrase = execution ? `${snapshot.confirmation} RECOVER ${execution.id}` : snapshot.confirmation;
  return <article className="border border-tableBorder p-4 space-y-3">
    <h3>{snapshot.name} · {review.status}</h3><p>{snapshot.account.name} · {snapshot.account.externalAccountId} · {snapshot.account.provider}</p>
    <p>Draft daily budget: {snapshot.spec.currency} {snapshot.spec.dailyBudget} (only applied when creating a budget-owning resource or explicitly changing budget). {snapshot.spec.startImmediately ? 'Immediate on submission' : snapshot.spec.start || 'Inherited start'} to {snapshot.spec.noEndDate ? 'Ongoing / provider limit' : snapshot.spec.end || 'Inherited end'} · account timezone {snapshot.account.timezone}</p>
    <p>Requested action: {snapshot.spec.operation}. New campaign resources are planned PAUSED. Resume would enable delivery and spend.</p>
    {snapshot.source && <p>Observed provider campaign: {snapshot.source.name} · {snapshot.source.status} · observed budget {snapshot.source.dailyBudgetMinor || snapshot.source.dailyBudgetMicros || 'Unavailable'} provider units</p>}
    {snapshot.financial?.length > 0 && <div><h4>Existing budget owners and schedules</h4>{snapshot.financial.map((budget: any) => <div key={budget.owner}><p>{budget.owner}: {budget.currency} {budget.amount} · {budget.period} · {budget.shared ? 'Shared budget' : 'Dedicated budget'} · {budget.start || 'No start supplied'} to {budget.end || 'No end supplied'}</p>{budget.shared && <p>All affected campaigns: {budget.affectedCampaigns.map((campaign: any) => `${campaign.name} (${campaign.id})`).join(', ')}</p>}</div>)}</div>}
    <CampaignPreview name={snapshot.name} spec={snapshot.spec} accountId={snapshot.account.id} />
    {snapshot.plan.blockers?.map((text: string) => <p key={text}>{text}</p>)}
    {snapshot.warnings?.map((text: string) => <p key={text}>{text}</p>)}
    <p>Approval does not submit. Final submission requires operator enablement and explicit confirmation. Approval expires: {review.expiresAt}</p>
    <details><summary>Provider request plan and review context</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(snapshot, null, 2)}</pre></details>
    {canApprove && <Button type="button" onClick={() => act(`/reviews/${review.id}/validate`, {})}>Validate with provider without submitting</Button>}
    {review.validation && <div><h4>Provider validation · {review.validatedAt}</h4><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(review.validation, null, 2)}</pre></div>}
    {canApprove && review.status === 'PENDING' && <div><label className="block">Type this exact confirmation:<code className="block break-all">{snapshot.confirmation}</code>
      <input aria-label="Final campaign confirmation" className="w-full bg-third p-2" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
      <Button type="button" disabled={confirmation !== snapshot.confirmation} onClick={() => act(`/reviews/${review.id}/approve`, { digest: review.digest, confirmation })}>Approve intent · no provider submission</Button>
      <label className="block">Rejection reason<input maxLength={100} className="bg-third p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button type="button" disabled={!reason.trim()} onClick={() => act(`/reviews/${review.id}/reject`, { reason })}>Reject review</Button></div>}
    {execution && <div><h4>Provider execution: {execution.status}</h4><p>Execution ID: {execution.id}. Confirmed IDs below are provider evidence, not policy approval or delivery guarantees.</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({ resources: execution.resources, steps: execution.steps }, null, 2)}</pre>
      {!['CONFIRMED', 'ABANDONED', 'NO_CHANGE'].includes(execution.status) && canApprove && <div>{execution.steps?.filter((step: any) => ['UNKNOWN', 'SENDING'].includes(step.status)).map((step: any) => <label className="block" key={step.id}>Optional verified Meta provider ID for {step.name}<input className="bg-third p-2" value={evidence[step.name] || ''} onChange={(e) => { const next = { ...evidence }; if (e.target.value) next[step.name] = e.target.value; else delete next[step.name]; setEvidence(next); }} /></label>)}<Button type="button" onClick={() => act(`/executions/${execution.id}/reconcile`, { evidence })}>Reconcile provider outcome</Button></div>}
      {execution.status === 'REJECTED' && canApprove && <div><p>To change a rejected child specification, abandon the remaining steps, keep all confirmed resources, then create a new child/change draft using those provider IDs. No provider resource is deleted or enabled by abandonment.</p><label>Type ABANDON {execution.id}<input className="bg-third p-2" value={abandon} onChange={(e) => setAbandon(e.target.value)} /></label><Button type="button" disabled={abandon !== `ABANDON ${execution.id}`} onClick={() => act(`/executions/${execution.id}/abandon`, { confirmation: abandon })}>Abandon remaining steps and retain provider IDs</Button></div>}
    </div>}
    {canApprove && ['APPROVED', 'APPROVED_BLOCKED', 'SUBMITTED'].includes(review.status) && !['CONFIRMED', 'ABANDONED', 'NO_CHANGE'].includes(execution?.status) && <div className="space-y-2">
      <p>Final provider submission for {snapshot.account.name}, {snapshot.spec.currency} {snapshot.spec.dailyBudget}/day, {snapshot.spec.start} to {snapshot.spec.end}. Resume can start spending.</p>
      <code className="block break-all">{phrase}</code><label className="block">Final submission confirmation<input className="bg-third p-2 w-full" value={submission} onChange={(e) => setSubmission(e.target.value)} /></label>
      <label><input type="checkbox" checked={authorizeSubmission} onChange={(e) => setAuthorizeSubmission(e.target.checked)} /> I authorize this provider operation for the account, budget, currency and schedule shown above.</label>
      <Button type="button" disabled={!enabled || submission !== phrase || !authorizeSubmission || execution?.status === 'UNKNOWN' || execution?.status === 'RUNNING'} onClick={() => {
        if (window.confirm(`${snapshot.confirmation}${snapshot.financialSummary ? `\nExisting budgets: ${snapshot.financialSummary}` : ''}\nSubmit this operation to ${snapshot.account.name}?`)) void act(`/reviews/${review.id}/submit`, { digest: review.digest, confirmation: submission });
      }}>{execution ? 'Recover remaining confirmed-safe steps' : 'Submit confirmed change to provider'}</Button>
      {!enabled && <p>The operator must enable advertising writes after configuring the integration.</p>}
    </div>}
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
  const editorGeneration = useRef(0);
  // Preserve a duplication idempotency key through an ambiguous network failure.
  const duplicateKeys = useRef(new Map<string, string>());
  const { data, error: loadError, mutate } = useSWR(['campaign-manager', user?.orgId], () => fetch('/campaign-manager/catalog').then(json), { revalidateOnFocus: false });
  const account = data?.accounts.find((a: any) => a.id === accountId), google = account?.provider === 'GOOGLE_ADS';
  const inheritsParent = spec.operation === 'CREATE' && (spec.resourceType === 'AD' || google && spec.resourceType === 'AD_GROUP');
  const updateChoices = (spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN' ? google ? ['name', 'budget', 'end', 'bid', 'targeting'] : ['name', 'budget'] : spec.resourceType === 'AD_GROUP' ? google ? ['name', 'bid', 'keywords', 'negativeKeywords'] : ['name', 'budget', 'end', 'targeting', 'bid'] : google ? ['creative'] : ['name', 'creative'];
  const act = async (path: string, body: any) => {
    setPending(true); setError(''); setNotice('');
    try { const result = await json(await fetch('/campaign-manager' + path, { method: 'POST', body: JSON.stringify(body) })); await mutate(); setNotice(path.endsWith('/submit') || path.endsWith('/reconcile') ? `Provider execution result: ${result.status}. Inspect confirmed resource IDs and audit history.` : 'Saved locally. No provider campaign was changed.'); return result; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Advertising request failed'); void mutate(); }
    finally { setPending(false); }
  };
  const edit = (draft: any) => { editorGeneration.current++; setDraftId(draft.id); setRevision(draft.revision); setKey(draft.creationKey); setName(draft.name); setSpec(draft.spec); setAccount(draft.accountId); setTab('Campaign Builder'); };
  const propose = (row: any, operation: string, child = false) => {
    editorGeneration.current++; setDraftId(''); setRevision(0); setKey(creationKey());
    const level = tab === 'Campaigns' ? 'CAMPAIGN' : tab === 'Ads' ? 'AD' : 'AD_GROUP';
    const next: any = { ...fresh(google), currency: account.currency, operation, campaignId: row.campaignId,
      resourceType: child ? level === 'CAMPAIGN' ? 'AD_GROUP' : 'AD' : level };
    if (child && level === 'AD_GROUP' || !child && level !== 'CAMPAIGN') next.resourceId = row.id;
    if (row.objective && data?.objectives[account.provider]?.includes(row.objective)) next.objective = row.objective;
    if (operation === 'UPDATE') next.updateFields = [];
    setName(child ? `New ${level === 'CAMPAIGN' ? 'group' : 'ad'}` : String(row.name).slice(0, 100)); setSpec(next); setTab('Campaign Builder');
  };
  const reset = (id: string) => {
    editorGeneration.current++; resourceRequest.current++; const a = data?.accounts.find((item: any) => item.id === id); setAccount(id); setResources(undefined); setDraftId(''); setRevision(0); setKey(creationKey());
    setSpec({ ...fresh(a?.provider === 'GOOGLE_ADS'), currency: a?.currency || 'USD' }); setName('New campaign');
  };
  const list = async () => {
    const request = ++resourceRequest.current;
    setPending(true); setResources(undefined); setResourceError('');
    try { const level = tab === 'Campaigns' ? 'CAMPAIGN' : tab === 'Ads' ? 'AD' : 'AD_GROUP'; const result = await json(await fetch('/campaign-manager/resources?' + new URLSearchParams({ accountId, level }))); if (request === resourceRequest.current) setResources(result); }
    catch (failure) { if (request === resourceRequest.current) setResourceError(failure instanceof Error ? failure.message : 'Provider unavailable'); } finally { setPending(false); }
  };
  const field = (label: string, prop: string, type = 'text') => <label className="block">{label}<input className="block w-full bg-third p-2" type={type} value={type === 'date' && spec[prop]?.length > 10 ? new Intl.DateTimeFormat('en-CA', { timeZone: account?.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(spec[prop])) : spec[prop] || ''} onChange={(e) => setSpec({ ...spec, [prop]: e.target.value })} /></label>;
  const lines = (label: string, prop: string) => <label className="block">{label}<textarea className="block w-full bg-third p-2" value={(spec[prop] || []).join('\n')} onChange={(e) => setSpec({ ...spec, [prop]: e.target.value.split('\n').filter((line) => line.trim()) })} /></label>;
  return <main className="p-4 space-y-5"><h1 className="text-2xl">Advertising</h1>
    <p>Campaign drafts, review and provider execution. Saving or approving never submits a campaign. {data?.liveWritesEnabled ? 'Final confirmed provider submission is enabled by the operator.' : 'Provider execution requires operator enablement.'}</p>
    <Link href="/settings/advertising">Manage advertising connections</Link> · <Link href="/advertising-analytics">Advertising Analytics</Link>
    {(error || loadError) && <p role="alert">{error || 'Campaign workspace could not be loaded.'}</p>}{notice && <p role="status">{notice}</p>}
    <nav aria-label="Advertising sections" className="flex flex-wrap gap-3">{tabs.map((name) => <button type="button" key={name} aria-pressed={tab === name} onClick={() => { resourceRequest.current++; setTab(name); setResources(undefined); setResourceError(''); }}>{name}</button>)}</nav>
    <label>Advertising account<select aria-label="Advertising account" className="bg-third p-2 ml-2" value={accountId} onChange={(e) => reset(e.target.value)}><option value="">Select account</option>{data?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} · {a.externalAccountId} · {a.currency} · {a.provider}</option>)}</select></label>
    {account && <p>{account.timezone} · {account.providerStatus} · {account.enabled ? 'Selected' : 'Disconnected or not selected; local drafts only'}</p>}
    {['Campaigns', 'Ad Sets / Ad Groups', 'Ads'].includes(tab) && <section className="space-y-3"><h2>{tab}</h2><Button type="button" disabled={!accountId || pending || !account?.enabled} onClick={list}>Refresh provider list</Button>
      {resourceError && <p role="alert">{resourceError}. Reconnect or retry later; no campaign was changed.</p>}
      {resources && <><p>Fetched {resources.fetchedAt}</p><div className="overflow-auto"><table className="w-full text-left"><thead><tr><th>Name / ID</th><th>Status</th><th>Provider approval</th><th>Performance / management</th></tr></thead><tbody>{resources.rows.map((row: any) => <tr key={row.id}><td>{row.name}<small className="block">{row.id}</small><details><summary>Budgets, targeting, creatives and policy details</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(row, null, 2)}</pre></details></td><td>{row.status}</td><td>{row.approval} {row.validationErrors.map((e: any) => e.code).join(', ')}</td><td><Link href={'/advertising-analytics?' + new URLSearchParams({ accountId, campaignId: row.campaignId, level: tab === 'Campaigns' ? 'CAMPAIGN' : tab === 'Ads' ? 'AD' : 'AD_GROUP' })}>View performance</Link>{manager && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => propose(row, 'PAUSE')}>Propose pause</button><button type="button" onClick={() => propose(row, 'RESUME')}>Propose resume</button><button type="button" onClick={() => propose(row, 'UPDATE')}>Propose edit</button>{!google && <button type="button" onClick={() => propose(row, 'DUPLICATE')}>Propose provider copy</button>}{tab !== 'Ads' && <button type="button" onClick={() => propose(row, 'CREATE', true)}>Add child resources</button>}</div>}</td></tr>)}</tbody></table></div>{!resources.rows.length && <p>No provider resources returned.</p>}
      {tab === 'Campaigns' && manager && <div><p>To propose pause/resume, use the Campaign Builder with the listed campaign ID. Account ownership is rechecked during review.</p></div>}</>}
    </section>}
    {tab === 'Drafts' && <section><h2>Drafts</h2>{manager && <Button type="button" onClick={() => { reset(accountId); setTab('Campaign Builder'); }}>New draft</Button>}{data?.drafts.map((draft: any) => <article key={draft.id} className="border border-tableBorder p-3"><h3>{draft.name} · {draft.status} · revision {draft.revision}</h3>{manager && <div className="flex gap-3"><Button type="button" disabled={pending} onClick={() => edit(draft)}>Edit draft</Button><Button type="button" disabled={pending} onClick={async () => {
        let attemptKey = duplicateKeys.current.get(draft.id);
        if (!attemptKey) { attemptKey = creationKey(); duplicateKeys.current.set(draft.id, attemptKey); }
        if (await act(`/drafts/${draft.id}/duplicate`, { key: attemptKey })) duplicateKeys.current.delete(draft.id);
      }}>Duplicate draft</Button><Button type="button" disabled={pending} onClick={async () => { if (await act(`/drafts/${draft.id}/review`, { revision: draft.revision })) setTab('Approval Queue'); }}>Request final review</Button></div>}</article>)}</section>}
    {tab === 'Campaign Builder' && (manager ? <form className="space-y-3 max-w-3xl" onSubmit={async (e) => { e.preventDefault(); const generation = editorGeneration.current; const result = await act('/drafts' + (draftId ? '/' + draftId : ''), { accountId, name, key: key || creationKey(), spec, ...(draftId ? { revision } : {}) }); if (result && generation === editorGeneration.current) { edit(result); setTab('Drafts'); } }}>
      <h2>{draftId ? 'Edit draft' : 'Create draft'}</h2><label className="block">Campaign name<input className="bg-third p-2 block w-full" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block">Action<select className="bg-third p-2" value={spec.operation} onChange={(e) => { const value = { ...spec, operation: e.target.value }; if (e.target.value === 'CREATE') { delete value.campaignId; delete value.resourceId; delete value.resourceType; } delete value.allowSharedBudgetChange; delete value.startImmediately; delete value.noEndDate; if (!value.start) value.start = fresh(google).start; if (!value.end) value.end = fresh(google).end; if (e.target.value !== 'UPDATE') delete value.updateFields; else value.updateFields = []; setSpec(value); }}><option>CREATE</option><option>PAUSE</option><option>RESUME</option><option>UPDATE</option>{!google && <option>DUPLICATE</option>}</select></label>
      <label className="block">Resource type<select className="bg-third p-2" value={spec.resourceType || 'CAMPAIGN'} onChange={(e) => { const next = { ...spec, resourceType: e.target.value }; delete next.resourceId; delete next.allowSharedBudgetChange; delete next.startImmediately; delete next.noEndDate; if (!next.start) next.start = fresh(google).start; if (!next.end) next.end = fresh(google).end; if (e.target.value === 'CAMPAIGN' && spec.operation === 'CREATE') delete next.campaignId; if (spec.operation === 'UPDATE') next.updateFields = []; if (google && spec.operation === 'CREATE' && e.target.value === 'AD') next.keywords = []; setSpec(next); }}><option value="CAMPAIGN">Campaign (new hierarchy for CREATE)</option><option value="AD_GROUP">Ad set / Ad group in existing campaign</option><option value="AD">Ad in existing ad set / ad group</option></select></label>
      {(spec.operation !== 'CREATE' || spec.resourceType && spec.resourceType !== 'CAMPAIGN') && field('Existing provider campaign ID', 'campaignId')}
      {spec.resourceType && spec.resourceType !== 'CAMPAIGN' && (spec.operation !== 'CREATE' || spec.resourceType === 'AD') && field(spec.operation === 'CREATE' ? 'Parent ad set / ad group ID' : google && spec.resourceType === 'AD' ? 'Ad resource ID (adGroupId~adId)' : 'Child resource ID', 'resourceId')}
      {spec.operation === 'UPDATE' && <fieldset><legend>Fields to change (all others stay unchanged)</legend>{updateChoices.map((value) => <label key={value} className="mr-3"><input type="checkbox" checked={(spec.updateFields || []).includes(value)} onChange={(e) => { const next = { ...spec, updateFields: e.target.checked ? [...spec.updateFields || [], value] : (spec.updateFields || []).filter((item: string) => item !== value) }; if (!e.target.checked && value === 'budget') delete next.allowSharedBudgetChange; setSpec(next); }} />{value}</label>)}{spec.updateFields?.includes('targeting') && <p>Targeting replaces the selected positive countries and languages (Google preserves exclusions) or Meta audience/placements with this draft.</p>}</fieldset>}
      {google && spec.operation === 'UPDATE' && (spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN' && spec.updateFields?.includes('budget') && <label className="block"><input type="checkbox" checked={spec.allowSharedBudgetChange === true} onChange={(e) => setSpec({ ...spec, allowSharedBudgetChange: e.target.checked })} />If this budget is shared, I acknowledge that the budget amount changes for every campaign listed in final review.</label>}
      <label className="block">Creation / creative workflow<select className="bg-third p-2" value={spec.objective} onChange={(e) => { const next = { ...spec, objective: e.target.value }; if (!['OUTCOME_SALES', 'OUTCOME_LEADS'].includes(e.target.value)) delete next.pixelId; if (e.target.value !== 'OUTCOME_APP_PROMOTION') { delete next.applicationId; delete next.objectStoreUrl; } setSpec(next); }}>{(data?.objectives[account?.provider] || []).map((objective: string) => <option key={objective}>{objective}</option>)}</select></label>
      {!google && ['OUTCOME_LEADS', 'OUTCOME_SALES'].includes(spec.objective) && <><p>This workflow optimizes website {spec.objective === 'OUTCOME_SALES' ? 'purchases' : 'leads'} using an account-owned Meta Pixel. Instant-form, shop/catalog and messaging destinations are separate provider workflows.</p>{field('Meta Pixel ID (must be assigned to selected advertising account)', 'pixelId')}</>}
      {!google && spec.objective === 'OUTCOME_APP_PROMOTION' && <>{field('Meta Application ID', 'applicationId')}{field('Official Apple/Google app store URL (must match destination URL)', 'objectStoreUrl', 'url')}<p>The connected advertiser must be authorized for this app and its app-install tracking configuration.</p></>}
      {!inheritsParent && <>{field(`Daily budget (${account?.currency || 'select account currency'})`, 'dailyBudget')}
        {spec.operation === 'CREATE' && <><label className="block"><input type="checkbox" checked={spec.startImmediately === true} onChange={(e) => setSpec({ ...spec, startImmediately: e.target.checked, start: e.target.checked ? '' : fresh(google).start })} />Start immediately when submitted (resources are still created paused)</label><label className="block"><input type="checkbox" checked={spec.noEndDate === true} onChange={(e) => setSpec({ ...spec, noEndDate: e.target.checked, end: e.target.checked ? '' : fresh(google).end })} />Ongoing daily budget until paused / provider end-date limit</label></>}
        {!spec.startImmediately && field(google ? `Start calendar date (${account?.timezone || 'account timezone'})` : 'Start (UTC, YYYY-MM-DDTHH:mm:00Z)', 'start', google ? 'date' : 'text')}
        {!spec.noEndDate && field(google ? `End calendar date, inclusive (${account?.timezone || 'account timezone'})` : 'End (UTC, YYYY-MM-DDTHH:mm:00Z)', 'end', google ? 'date' : 'text')}
      </>}
      {inheritsParent && <p>This resource inherits its existing parent budget, dates and targeting. Final review displays verified parent budget owners and schedules; this operation does not change them.</p>}
      <label className="block">Bid strategy<select className="bg-third p-2" value={spec.bidStrategy} onChange={(e) => { const next = { ...spec, bidStrategy: e.target.value }; delete next.maxCpc; delete next.maxBid; delete next.targetCpa; delete next.targetRoas; if (['MANUAL_CPC', 'MAXIMIZE_CLICKS'].includes(e.target.value)) next.maxCpc = '1'; if (['LOWEST_COST_WITH_BID_CAP', 'COST_CAP'].includes(e.target.value)) next.maxBid = '1'; if (e.target.value === 'TARGET_CPA') next.targetCpa = '10'; if (e.target.value === 'TARGET_ROAS') next.targetRoas = '3'; setSpec(next); }}>{(data?.bidStrategies?.[account?.provider] || [spec.bidStrategy]).map((strategy: string) => <option key={strategy}>{strategy}</option>)}</select></label>
      {google && ['MANUAL_CPC', 'MAXIMIZE_CLICKS'].includes(spec.bidStrategy) && field('Maximum CPC (account currency)', 'maxCpc')}
      {!google && spec.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP' && field('Bid / cost cap (account currency per Meta optimization billing unit)', 'maxBid')}
      {spec.bidStrategy === 'TARGET_CPA' && field('Target CPA (account currency)', 'targetCpa')}{spec.bidStrategy === 'TARGET_ROAS' && field('Target ROAS multiple (3 = 300%)', 'targetRoas')}
      <p>Account timezone: {account?.timezone || 'Select account'}. Daily budgets are not total spend caps; provider overdelivery rules apply. Automated bidding requires correctly configured conversion goals. Child resources inherit the parent campaign strategy; manual group CPC is only applicable to manual-CPC campaigns.</p>
      {google && <p>Google campaign schedules use account-local calendar dates, inclusive of the end date. Intraday start/stop timestamps are not supported by the campaign date API. The exact effective calendar dates are included in final confirmation.</p>}
      {!inheritsParent && <label className="block">Countries (ISO codes, comma separated)<input className="block bg-third p-2" value={spec.countries.join(',')} onChange={(e) => setSpec({ ...spec, countries: e.target.value.split(',').map((v) => v.trim().toUpperCase()) })} /></label>}
      {google && <p>Google Search matches languages from ad text and user signals; manual campaign language targeting is no longer supported.{spec.languages?.length > 0 && <button type="button" onClick={() => { const next = { ...spec }; delete next.languages; setSpec(next); }}>Remove legacy language selection before review</button>}</p>}
      {!google && <>{!inheritsParent && <label className="block">Placements<select className="bg-third p-2" value={spec.placements} onChange={(e) => setSpec({ ...spec, placements: e.target.value })}><option value="AUTOMATIC">Automatic</option><option value="FACEBOOK_FEED">Facebook Feed</option></select></label>}{field('Meta Page ID (provider verification required)', 'pageId')}{field('Meta account image hash (provider verification required)', 'providerImageHash')}</>}
      {!google && <label className="block">Workspace creative<select className="bg-third p-2" value={spec.mediaId || ''} onChange={(e) => { const next = { ...spec }; if (e.target.value) next.mediaId = e.target.value; else delete next.mediaId; setSpec(next); }}><option value="">None</option>{data?.media.map((m: any) => <option key={m.id} value={m.id}>{m.name} · {m.type}</option>)}</select></label>}
      {lines(google ? 'Headlines: 3–15, one per line, max 30 characters' : 'Headline: max 40 characters', 'headlines')}{lines(google ? 'Descriptions: 2–4, one per line, max 90 characters' : 'Advertising text: max 500 characters', 'descriptions')}{field('Destination HTTPS URL', 'destinationUrl', 'url')}
      {google && !(spec.operation === 'CREATE' && spec.resourceType === 'AD') && <>{lines('Keywords, one per line (1–20)', 'keywords')}<label className="block">Keyword match<select value={spec.keywordMatchType || 'EXACT'} onChange={(e) => setSpec({ ...spec, keywordMatchType: e.target.value })}>{['EXACT', 'PHRASE', 'BROAD'].map((match) => <option key={match}>{match}</option>)}</select></label>{lines('Negative keywords, one per line (up to 20)', 'negativeKeywords')}<label className="block">Negative keyword match<select value={spec.negativeMatchType || 'PHRASE'} onChange={(e) => setSpec({ ...spec, negativeMatchType: e.target.value })}>{['EXACT', 'PHRASE', 'BROAD'].map((match) => <option key={match}>{match}</option>)}</select></label></>}
      {!google && <AdvertisingAssets key={accountId} account={account} media={data?.media} enabled={data?.liveWritesEnabled} selected={spec.advertisingAssetId}
        onChoosePage={(id: string) => setSpec({ ...spec, pageId: id })} onChooseImage={(hash: string) => { const next = { ...spec, providerImageHash: hash }; delete next.advertisingAssetId; setSpec(next); }}
        onSelect={(id: string) => { const next = { ...spec }; if (id) { next.advertisingAssetId = id; delete next.providerImageHash; } else delete next.advertisingAssetId; setSpec(next); }} />}
      <CampaignPreview name={name} spec={spec} accountId={accountId} /><p>Save creates a local draft. Only final confirmed submission executes provider changes.</p><Button type="submit" disabled={!accountId || pending}>Save draft</Button>
    </form> : <p>Workspace administrators can create and edit drafts.</p>)}
    {tab === 'Creative Library' && <section><h2>Workspace Creative Library</h2><Link href="/media">Workspace Media</Link><AdvertisingAssets key={accountId} account={account} media={data?.media} enabled={data?.liveWritesEnabled} /></section>}
    {tab === 'Approval Queue' && <section className="space-y-4"><h2>Approval Queue</h2><p>Only workspace owners (SUPERADMIN) may approve and submit. Approval and provider submission are separate explicit actions.</p>{data?.reviews.map((r: any) => <Review key={r.id} review={r} canApprove={approver && !pending} act={act} execution={data?.executions?.find((run: any) => run.reviewId === r.id)} enabled={data?.liveWritesEnabled} />)}</section>}
    {tab === 'Change History' && <section><h2>Change History</h2><p>Latest 200 workspace audit events. Review records retain the immutable proposed changes.</p>{data?.history.map((event: any) => <p key={event.id}>{event.createdAt} · {event.action} · actor {event.actorId} · draft {event.draftId}</p>)}</section>}
  </main>;
};
