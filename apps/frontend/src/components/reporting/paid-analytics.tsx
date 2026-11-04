'use client';
import React, { useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
const names: Record<string, string> = { spend: 'Spend', impressions: 'Impressions', reach: 'Reach', clicks: 'Clicks', ctr: 'CTR %', cpc: 'CPC', cpm: 'CPM',
  conversions: 'Conversions', conversionRate: 'Conversions / clicks %', cpa: 'CPA', leads: 'Leads', cpl: 'CPL', purchaseValue: 'Purchase value', roas: 'ROAS' };
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const initialDates = () => { const to = new Date(Date.now() - 86400000); return { to: isoDay(to), from: isoDay(new Date(to.getTime() - 6 * 86400000)) }; };
const text = (value: unknown) => value === null || value === undefined ? 'Unavailable' : String(value);
async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'Paid reporting request failed');
  return body;
}
async function saveBlob(response: Response, name: string) {
  if (!response.ok) throw new Error('Export unavailable. Check report size and PDF configuration.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
export const PaidTrend = ({ points }: { points: any[] }) => {
  const known = points.filter((p) => p.spend !== null && Number.isFinite(Number(p.spend)));
  if (!known.length) return <p>No spend trend data available.</p>;
  const max = Math.max(1, ...known.map((p) => Number(p.spend))), min = Math.min(0, ...known.map((p) => Number(p.spend)));
  const span = max - min;
  return <figure><figcaption>Spend trend · account currency; gaps stay unavailable</figcaption>
    <svg viewBox="0 0 600 140" role="img" aria-label="Paid spend trend" className="w-full max-h-48">
      {points.map((point, i) => point.spend === null ? null : <rect key={point.date} x={i * 600 / Math.max(points.length, 1)}
        y={130 - (Math.max(0, Number(point.spend)) - min) / span * 120} width={Math.max(1, 560 / points.length)} height={Math.abs(Number(point.spend)) / span * 120} fill="currentColor">
        <title>{point.date}: {point.spend}</title></rect>)}
    </svg><div className="flex justify-between"><small>{points[0]?.date}</small><small>{points[points.length - 1]?.date}</small></div></figure>;
};
const AccountConfiguration = ({ account, clients, saved }: any) => {
  const fetch = useFetch(), [client, setClient] = useState(account.customerId || ''), [verified, setVerified] = useState(account.valueTrackingVerified);
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const save = async () => { setPending(true); setError(''); try {
    await json(await fetch(`/paid-analytics/accounts/${account.id}`, { method: 'POST', body: JSON.stringify({ customerId: client || null, valueTrackingVerified: verified }) })); saved();
  } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save'); } finally { setPending(false); } };
  return <div className="border border-tableBorder p-3 flex flex-wrap gap-3 items-center"><span>{account.name} · {account.currency} · {account.timezone}</span>
    <label>Client <select value={client} onChange={(event) => setClient(event.target.value)} className="bg-third"><option value="">Unassigned</option>{clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /> Purchase values verified for ROAS</label>
    <Button type="button" disabled={pending} onClick={save}>Save account reporting settings</Button>{error && <p role="alert">{error}</p>}
  </div>;
};
export const PaidAnalytics = ({ initialSelection = {} }: { initialSelection?: Record<string, string> } = {}) => {
  const fetch = useFetch(), user = useUser(), manager = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const [query, setQuery] = useState<Record<string, string>>({ ...initialDates(), level: 'ACCOUNT', ...initialSelection });
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [notice, setNotice] = useState('');
  const [schedule, setSchedule] = useState({ name: 'Client paid advertising report', rollingDays: 7, cadenceDays: 7, format: 'PDF', delivery: 'ARCHIVE', recipient: '', requireFresh: true });
  const [editing, setEditing] = useState<string>();
  const request = new URLSearchParams(Object.entries(query).filter(([, value]) => value)).toString();
  const { data: catalog, mutate: reloadCatalog } = useSWR(['paid-catalog', user?.orgId], async () => json(await fetch('/paid-analytics/catalog')), { refreshInterval: 30000 });
  const { data: report, error: reportError, mutate: reloadReport } = useSWR(['paid-report', user?.orgId, request], async () => json(await fetch('/paid-analytics/report?' + request)), { revalidateOnFocus: false });
  const { data: schedules, mutate: reloadSchedules } = useSWR(manager ? ['paid-schedules', user?.orgId] : null, async () => json(await fetch('/paid-analytics/schedules')), { refreshInterval: 30000 });
  const action = async (work: () => Promise<void>) => { setPending(true); setError(''); setNotice(''); try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Request failed'); } finally { setPending(false); } };
  const change = (key: string, value: string) => setQuery((old) => ({ ...old, [key]: value, ...(key === 'level' && value === 'ACCOUNT' ? { campaignId: '' } : {}) }));
  const sync = () => action(async () => {
    const result = await json(await fetch('/paid-analytics/sync', { method: 'POST', body: JSON.stringify(Object.fromEntries(Object.entries(query).filter(([, value]) => value))) }));
    setNotice(`${result.queued} collection jobs queued. Completed account-local days only; reload after collection finishes.`); void reloadCatalog();
  });
  const exportReport = (format: string) => action(async () => saveBlob(await fetch(`/paid-analytics/export?${request}&format=${format}`), `paid-advertising.${format.toLowerCase()}`));
  const saveSchedule = () => action(async () => {
    await json(await fetch(`/paid-analytics/schedules${editing ? '/' + editing : ''}`, { method: 'POST', body: JSON.stringify({ ...schedule,
      query: Object.fromEntries(Object.entries(query).filter(([, value]) => value)), nextRunAt: new Date(Date.now() + 60000).toISOString() }) }));
    setEditing(undefined); setNotice('Schedule saved. First run is in one minute when the operator enables report scheduling.'); void reloadSchedules();
  });
  return <main className="flex flex-col gap-5 p-5">
    <h1>Advertising Analytics</h1><p>Paid Meta Ads and Google Ads reporting. Organic metrics are separate. Each account/currency/timezone/attribution group has its own totals.</p>
    <nav aria-label="Advertising analysis" className="flex flex-wrap gap-2">{[['ACCOUNT', 'Overview'], ['CAMPAIGN', 'Campaign performance'], ['AD_GROUP', 'Ad set / ad group analysis'], ['AD', 'Individual ad performance']].map(([value, label]) =>
      <Button type="button" key={value} onClick={() => change('level', value)} aria-pressed={query.level === value}>{label}</Button>)}</nav>
    <div className="flex flex-wrap gap-3">
      <label>From <input type="date" value={query.from} onChange={(event) => change('from', event.target.value)} /></label>
      <label>To <input type="date" value={query.to} onChange={(event) => change('to', event.target.value)} /></label>
      <label>Client <select value={query.customerId || ''} onChange={(event) => change('customerId', event.target.value)} className="bg-third"><option value="">All clients</option>{catalog?.clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Provider <select value={query.provider || ''} onChange={(event) => change('provider', event.target.value)} className="bg-third"><option value="">Both providers</option><option value="META_ADS">Meta Ads</option><option value="GOOGLE_ADS">Google Ads</option></select></label>
      <label>Account <select value={query.accountId || ''} onChange={(event) => change('accountId', event.target.value)} className="bg-third"><option value="">All workspace accounts</option>{catalog?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} · {a.provider}</option>)}</select></label>
      {query.level !== 'ACCOUNT' && <label>Campaign ID <input value={query.campaignId || ''} onChange={(event) => change('campaignId', event.target.value)} /></label>}
    </div>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} onClick={() => { void reloadReport(); void reloadCatalog(); }}>Reload stored analytics</Button>
      {manager && <Button type="button" disabled={pending || !catalog?.collectionEnabled} onClick={sync}>Sync selected range and comparison</Button>}
      <Button type="button" disabled={pending} onClick={() => exportReport('CSV')}>Export paid CSV</Button><Button type="button" disabled={pending} onClick={() => exportReport('PDF')}>Export client PDF</Button></div>
    {!catalog?.collectionEnabled && <p>Automatic/manual collection is disabled by the server operator. Stored reports remain readable.</p>}
    {error && <p role="alert">{error}</p>}{reportError && <p role="alert">{reportError.message}</p>}{notice && <p role="status">{notice}</p>}
    {!report?.groups.length && <p>No paid snapshots are available for this selection. Connect/select advertising accounts, assign a client and synchronize the required dates.</p>}
    {report?.groups.map((group: any) => <section key={`${group.accountId}:${group.currency}:${group.timezone}:${group.attribution}:${group.attributionFingerprint}`} className="border border-tableBorder p-4 flex flex-col gap-4">
      <h2>{group.accountName} · {group.provider} · {group.currency} · {group.timezone}</h2><small>{group.attribution}</small>
      <details><summary>Observed attribution settings · {group.attributionFingerprint?.slice(0, 12)}</summary><pre className="whitespace-pre-wrap">{JSON.stringify(group.attributionDetails || {}, null, 2)}</pre></details>
      <p>Last sync: {group.lastSync || 'never'} · {group.fresh ? 'Recent' : 'Stale / unsynchronized'} · Coverage: {group.complete ? 'complete' : 'INCOMPLETE'} · Previous: {group.previousComplete ? 'complete' : 'INCOMPLETE'} · {group.connection?.status || 'Disconnected'} {group.connection?.lastError || ''}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Object.entries(names).map(([key, label]) => <div key={key} className="bg-third p-3 rounded"><h3>{label}</h3><strong>{text(group.current[key])}</strong><small className="block">Previous {text(group.previous[key])} · Δ {text(group.changes[key].percent)}%</small></div>)}</div>
      <PaidTrend points={group.trends} />
      <h3>Period comparison · {report.previous.from} – {report.previous.to}</h3>
      <div className="overflow-x-auto"><table><thead><tr><th>Entity</th><th>Spend ({group.currency})</th><th>Previous spend</th><th>Impressions</th><th>Clicks</th><th>Conversions</th><th>CPA</th><th>Leads</th><th>ROAS</th></tr></thead>
        <tbody>{group.entities.map((entity: any) => <tr key={entity.id}><td>{entity.name} ({entity.id})</td><td>{text(entity.current.spend)}</td><td>{text(entity.previous.spend)}</td><td>{text(entity.current.impressions)}</td><td>{text(entity.current.clicks)}</td><td>{text(entity.current.conversions)}</td><td>{text(entity.current.cpa)}</td><td>{text(entity.current.leads)}</td><td>{text(entity.current.roas)}</td></tr>)}</tbody></table></div>
    </section>)}
    {report && <details><summary>Metric definitions and attribution limitations</summary>{Object.values(report.definitions).map((definition: any) => <p key={definition}>{definition}</p>)}</details>}
    {manager && <details><summary>Client assignment and purchase-value verification</summary>{catalog?.accounts.map((account: any) => <AccountConfiguration key={`${account.id}:${account.customerId}:${account.valueTrackingVerified}`} account={account} clients={catalog.clients} saved={() => { void reloadCatalog(); void reloadReport(); }} />)}</details>}
    <details><summary>Collection jobs and integration errors</summary>{catalog?.jobs.map((job: any) => <p key={job.id}>{job.accountId} · {job.level} · {job.kind} · {job.status} · {job.errorCode || 'No error'} · {job.completedAt || 'not completed'}</p>)}</details>
    {manager && <section className="border border-tableBorder p-4 flex flex-col gap-3"><h2>Scheduled client reports</h2>
      <p>{catalog?.schedulesEnabled ? 'Scheduler enabled' : 'Scheduler paused by operator'}. Archive or send an authenticated download link to a workspace member. No public report URLs.</p>
      <label>Report name <input value={schedule.name} onChange={(event) => setSchedule({ ...schedule, name: event.target.value })} /></label>
      <label>Rolling days <input type="number" min={1} max={93} value={schedule.rollingDays} onChange={(event) => setSchedule({ ...schedule, rollingDays: Number(event.target.value) })} /></label>
      <label>Cadence <select value={schedule.cadenceDays} onChange={(event) => setSchedule({ ...schedule, cadenceDays: Number(event.target.value) })} className="bg-third"><option value={1}>Daily</option><option value={7}>Weekly</option><option value={30}>Every 30 days</option></select></label>
      <label>Format <select value={schedule.format} onChange={(event) => setSchedule({ ...schedule, format: event.target.value })} className="bg-third"><option>PDF</option><option>CSV</option></select></label>
      <label>Delivery <select value={schedule.delivery} onChange={(event) => setSchedule({ ...schedule, delivery: event.target.value })} className="bg-third"><option value="ARCHIVE">Private archive</option><option value="EMAIL">Email authenticated link</option></select></label>
      {schedule.delivery === 'EMAIL' && <label>Workspace member email <input type="email" value={schedule.recipient} onChange={(event) => setSchedule({ ...schedule, recipient: event.target.value })} /></label>}
      <label><input type="checkbox" checked={schedule.requireFresh} onChange={(event) => setSchedule({ ...schedule, requireFresh: event.target.checked })} /> Require complete recent data and comparison</label>
      <Button type="button" disabled={pending} onClick={saveSchedule}>{editing ? 'Update report schedule' : 'Create report schedule from current filters'}</Button>
      {schedules?.schedules.map((item: any) => <div key={item.id}><span>{item.name} · {item.delivery} · {item.enabled ? 'Enabled' : 'Paused'} · Next {item.nextRunAt}</span>
        <button type="button" onClick={() => { setEditing(item.id); setSchedule({ name: item.name, rollingDays: item.rollingDays, cadenceDays: item.cadenceDays, format: item.format, delivery: item.delivery, recipient: item.recipient || '', requireFresh: item.requireFresh }); setQuery({ ...initialDates(), ...item.query }); }}>Edit</button>
        <button type="button" onClick={() => action(async () => { await json(await fetch(`/paid-analytics/schedules/${item.id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled: !item.enabled }) })); void reloadSchedules(); })}>{item.enabled ? 'Pause' : 'Enable'}</button></div>)}
      {schedules?.runs.map((run: any) => <div key={run.id}>{run.format} · {run.status} · Delivery {run.deliveryStatus} · {run.errorCode || 'No error'} {run.status === 'READY' && <button type="button" onClick={() => action(async () => saveBlob(await fetch(`/paid-analytics/runs/${run.id}/download`), `paid-report.${run.format.toLowerCase()}`))}>Download generated report</button>}</div>)}
    </section>}
  </main>;
};
