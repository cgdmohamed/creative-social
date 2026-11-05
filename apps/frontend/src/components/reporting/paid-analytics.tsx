'use client';
import React, { useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const initialDates = () => { const to = new Date(Date.now() - 86400000); return { to: isoDay(to), from: isoDay(new Date(to.getTime() - 6 * 86400000)) }; };
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
  const t = useT();
  const known = points.filter((p) => p.spend !== null && Number.isFinite(Number(p.spend)));
  if (!known.length) return <p>{t('paid_no_spend_trend', 'No spend data to show yet.')}</p>;
  const max = Math.max(1, ...known.map((p) => Number(p.spend))), min = Math.min(0, ...known.map((p) => Number(p.spend)));
  const span = max - min;
  return <figure><figcaption>{t('paid_spend_trend_caption', 'Spend trend in the account currency. Days without data are left blank.')}</figcaption>
    <svg viewBox="0 0 600 140" role="img" aria-label={t('paid_spend_trend', 'Paid spend trend')} className="w-full max-h-48">
      {points.map((point, i) => point.spend === null ? null : <rect key={point.date} x={i * 600 / Math.max(points.length, 1)}
        y={130 - (Math.max(0, Number(point.spend)) - min) / span * 120} width={Math.max(1, 560 / points.length)} height={Math.abs(Number(point.spend)) / span * 120} fill="currentColor">
        <title>{point.date}: {point.spend}</title></rect>)}
    </svg><div className="flex justify-between"><small>{points[0]?.date}</small><small>{points[points.length - 1]?.date}</small></div></figure>;
};
const AccountConfiguration = ({ account, clients, saved }: any) => {
  const t = useT();
  const fetch = useFetch(), [client, setClient] = useState(account.customerId || ''), [verified, setVerified] = useState(account.valueTrackingVerified);
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const save = async () => { setPending(true); setError(''); try {
    await json(await fetch(`/paid-analytics/accounts/${account.id}`, { method: 'POST', body: JSON.stringify({ customerId: client || null, valueTrackingVerified: verified }) })); saved();
  } catch (failure) { setError(failure instanceof Error ? failure.message : t('paid_could_not_save', 'Could not save. Try again.')); } finally { setPending(false); } };
  return <div className="border border-fifth bg-sixth text-textColor rounded-[4px] p-3 flex flex-wrap gap-3 items-center"><span>{account.name} · {account.currency} · {account.timezone}</span>
    <label>{t('paid_client', 'Client')} <select value={client} onChange={(event) => setClient(event.target.value)} className="bg-third text-textColor border border-fifth rounded-[4px] p-2"><option value="">{t('paid_unassigned', 'Unassigned')}</option>{clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /> {t('paid_values_verified', 'Purchase values are correct (needed to show ROAS)')}</label>
    <Button type="button" disabled={pending} onClick={save}>{t('paid_save_account_settings', 'Save account settings')}</Button>{error && <p role="alert">{error}</p>}
  </div>;
};
export const PaidAnalytics = ({ initialSelection = {} }: { initialSelection?: Record<string, string> } = {}) => {
  const t = useT();
  const names: Record<string, string> = { spend: t('paid_metric_spend', 'Spend'), impressions: t('paid_metric_impressions', 'Impressions'), reach: t('paid_metric_reach', 'Reach'), clicks: t('paid_metric_clicks', 'Clicks'), ctr: t('paid_metric_ctr', 'CTR %'), cpc: t('paid_metric_cpc', 'CPC'), cpm: t('paid_metric_cpm', 'CPM'),
    conversions: t('paid_metric_conversions', 'Conversions'), conversionRate: t('paid_metric_conversion_rate', 'Conversions / clicks %'), cpa: t('paid_metric_cpa', 'CPA'), leads: t('paid_metric_leads', 'Leads'), cpl: t('paid_metric_cpl', 'CPL'), purchaseValue: t('paid_metric_purchase_value', 'Purchase value'), roas: t('paid_metric_roas', 'ROAS') };
  const text = (value: unknown) => value === null || value === undefined ? t('paid_unavailable', 'Unavailable') : String(value);
  const fetch = useFetch(), user = useUser(), manager = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const [query, setQuery] = useState<Record<string, string>>({ ...initialDates(), level: 'ACCOUNT', ...initialSelection });
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [notice, setNotice] = useState('');
  const [schedule, setSchedule] = useState({ name: t('paid_default_report_name', 'Client paid advertising report'), rollingDays: 7, cadenceDays: 7, format: 'PDF', delivery: 'ARCHIVE', recipient: '', requireFresh: true });
  const [editing, setEditing] = useState<string>();
  const request = new URLSearchParams(Object.entries(query).filter(([, value]) => value)).toString();
  const { data: catalog, mutate: reloadCatalog } = useSWR(['paid-catalog', user?.orgId], async () => json(await fetch('/paid-analytics/catalog')), { refreshInterval: 30000 });
  const { data: report, error: reportError, mutate: reloadReport } = useSWR(['paid-report', user?.orgId, request], async () => json(await fetch('/paid-analytics/report?' + request)), { revalidateOnFocus: false });
  const { data: schedules, mutate: reloadSchedules } = useSWR(manager ? ['paid-schedules', user?.orgId] : null, async () => json(await fetch('/paid-analytics/schedules')), { refreshInterval: 30000 });
  const action = async (work: () => Promise<void>) => { setPending(true); setError(''); setNotice(''); try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('paid_request_failed', 'The report request did not go through. Check your connection and try again.')); } finally { setPending(false); } };
  const change = (key: string, value: string) => setQuery((old) => ({ ...old, [key]: value, ...(key === 'level' && value === 'ACCOUNT' ? { campaignId: '' } : {}) }));
  const sync = () => action(async () => {
    const result = await json(await fetch('/paid-analytics/sync', { method: 'POST', body: JSON.stringify(Object.fromEntries(Object.entries(query).filter(([, value]) => value))) }));
    setNotice(t('paid_collection_queued', '{{queued}} data collection jobs started. Only days that have ended in the account time zone are collected. Reload when they finish.', { queued: result.queued, interpolation: { escapeValue: false } })); void reloadCatalog();
  });
  const exportReport = (format: string) => action(async () => saveBlob(await fetch(`/paid-analytics/export?${request}&format=${format}`), `paid-advertising.${format.toLowerCase()}`));
  const saveSchedule = () => action(async () => {
    await json(await fetch(`/paid-analytics/schedules${editing ? '/' + editing : ''}`, { method: 'POST', body: JSON.stringify({ ...schedule,
      query: Object.fromEntries(Object.entries(query).filter(([, value]) => value)), nextRunAt: new Date(Date.now() + 60000).toISOString() }) }));
    setEditing(undefined); setNotice(t('paid_schedule_saved', 'Schedule saved. The first report is created in about a minute if scheduled reports are turned on.')); void reloadSchedules();
  });
  return <main className="app-form flex flex-col gap-[24px] p-[24px] text-textColor">
    <h1>{t('paid_title', 'Advertising Analytics')}</h1><p>{t('paid_intro', 'Paid results from Meta Ads and Google Ads. Organic results are shown separately. Totals are shown separately for each account, currency, time zone and attribution setting.')}</p>
    <nav aria-label={t('paid_analysis', 'Advertising analysis')} className="flex flex-wrap gap-2">{[['ACCOUNT', t('paid_level_overview', 'Overview')], ['CAMPAIGN', t('paid_level_campaign', 'Campaign performance')], ['AD_GROUP', t('paid_level_ad_group', 'Ad set / ad group analysis')], ['AD', t('paid_level_ad', 'Individual ad performance')]].map(([value, label]) =>
      <Button type="button" key={value} onClick={() => change('level', value)} aria-pressed={query.level === value}>{label}</Button>)}</nav>
    <div className="flex flex-wrap items-end gap-4">
      <label>{t('paid_from', 'From')} <input type="date" value={query.from} onChange={(event) => change('from', event.target.value)} /></label>
      <label>{t('paid_to', 'To')} <input type="date" value={query.to} onChange={(event) => change('to', event.target.value)} /></label>
      <label>{t('paid_client', 'Client')} <select value={query.customerId || ''} onChange={(event) => change('customerId', event.target.value)} className="bg-third text-textColor border border-fifth rounded-[4px] p-2"><option value="">{t('paid_all_clients', 'All clients')}</option>{catalog?.clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{t('paid_provider', 'Provider')} <select value={query.provider || ''} onChange={(event) => change('provider', event.target.value)} className="bg-third text-textColor border border-fifth rounded-[4px] p-2"><option value="">{t('paid_both_providers', 'Both providers')}</option><option value="META_ADS">{t('paid_meta_ads', 'Meta Ads')}</option><option value="GOOGLE_ADS">{t('paid_google_ads', 'Google Ads')}</option></select></label>
      <label>{t('paid_account', 'Account')} <select value={query.accountId || ''} onChange={(event) => change('accountId', event.target.value)} className="bg-third text-textColor border border-fifth rounded-[4px] p-2"><option value="">{t('paid_all_accounts', 'All workspace accounts')}</option>{catalog?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} · {a.provider}</option>)}</select></label>
      <Button type="button" disabled={!query.accountId} onClick={() => { const account = catalog?.accounts.find((item: any) => item.id === query.accountId); if (account) { const today = new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); setQuery({ ...query, from: today, to: today }); } }}>{t('paid_today_in_timezone', 'Today (account time zone)')}</Button>
      {query.level !== 'ACCOUNT' && <label>{t('paid_campaign_id', 'Campaign ID')} <input value={query.campaignId || ''} onChange={(event) => change('campaignId', event.target.value)} /></label>}
    </div>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} onClick={() => { void reloadReport(); void reloadCatalog(); }}>{t('paid_reload', 'Reload saved data')}</Button>
      {manager && <Button type="button" disabled={pending || !catalog?.collectionEnabled} onClick={sync}>{t('paid_sync', 'Update data for the selected dates and comparison period')}</Button>}
      <Button type="button" disabled={pending} onClick={() => exportReport('CSV')}>{t('paid_export_csv', 'Download CSV')}</Button><Button type="button" disabled={pending} onClick={() => exportReport('PDF')}>{t('paid_export_pdf', 'Download client PDF')}</Button></div>
    {!catalog?.collectionEnabled && <p>{t('paid_collection_disabled', 'Data collection is turned off. You can still view saved reports. Ask an administrator to turn it on.')}</p>}
    {error && <p role="alert">{error}</p>}{reportError && <p role="alert">{reportError.message}</p>}{notice && <p role="status">{notice}</p>}
    {!report?.groups.length && <p>{t('paid_no_snapshots', 'No paid data for this selection yet. Connect an advertising account, select it, assign it to a client, then update the data for these dates.')}</p>}
    {report?.groups.map((group: any) => <section key={`${group.accountId}:${group.currency}:${group.timezone}:${group.attribution}:${group.attributionFingerprint}`} className="border border-fifth bg-sixth text-textColor rounded-[4px] p-4 flex flex-col gap-4">
      <h2>{group.accountName} · {group.provider} · {group.currency} · {group.timezone}</h2><small>{group.attribution}</small>
      <details><summary>{t('paid_attribution_settings', 'Attribution settings in this data')} · {group.attributionFingerprint?.slice(0, 12)}</summary><pre className="whitespace-pre-wrap">{JSON.stringify(group.attributionDetails || {}, null, 2)}</pre></details>
      <p>{t('paid_group_status', 'Last sync: {{lastSync}} · {{freshness}} · Coverage: {{coverage}} · Previous: {{previousCoverage}} · {{connection}} {{lastError}}', { lastSync: group.lastSync || t('paid_never', 'never'), freshness: group.fresh ? t('paid_recent', 'Recent') : t('paid_stale', 'Out of date'), coverage: group.complete ? t('paid_complete', 'complete') : t('paid_incomplete', 'Incomplete'), previousCoverage: group.previousComplete ? t('paid_complete', 'complete') : t('paid_incomplete', 'Incomplete'), connection: group.connection?.status || t('paid_disconnected', 'Disconnected'), lastError: group.connection?.lastError || '', interpolation: { escapeValue: false } })}</p>
      {group.provisional && <p>{t('paid_provisional', 'Preliminary data. Numbers for today, and for days that were not collected after they ended, can still change. The ad platforms also report some results late.')}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Object.entries(names).map(([key, label]) => <div key={key} className="bg-third border border-fifth text-textColor p-3 rounded-[4px]"><h3>{label}</h3><strong>{text(group.current[key])}</strong><small className="block">{t('paid_previous', 'Previous')} {text(group.previous[key])} · Δ {text(group.changes[key].percent)}%</small></div>)}</div>
      <PaidTrend points={group.trends} />
      <h3>{t('paid_period_comparison', 'Period comparison')} · {report.previous.from} – {report.previous.to}</h3>
      <div className="overflow-x-auto"><table><thead><tr><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{t('paid_col_entity', 'Entity')}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{t('paid_col_spend', 'Spend ({{currency}})', { currency: group.currency, interpolation: { escapeValue: false } })}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{t('paid_col_previous_spend', 'Previous spend')}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{names.impressions}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{names.clicks}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{names.conversions}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{names.cpa}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{names.leads}</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">{names.roas}</th></tr></thead>
        <tbody>{group.entities.map((entity: any) => <tr key={entity.id}><td className="border-b border-fifth p-3 align-top text-sm">{entity.name} ({entity.id})</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.current.spend)}</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.previous.spend)}</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.current.impressions)}</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.current.clicks)}</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.current.conversions)}</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.current.cpa)}</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.current.leads)}</td><td className="border-b border-fifth p-3 align-top text-sm">{text(entity.current.roas)}</td></tr>)}</tbody></table></div>
    </section>)}
    {report && <details><summary>{t('paid_definitions', 'How metrics are defined and attribution limits')}</summary>{Object.values(report.definitions).map((definition: any) => <p key={definition}>{definition}</p>)}</details>}
    {manager && <details><summary>{t('paid_client_assignment', 'Client and purchase value settings')}</summary>{catalog?.accounts.map((account: any) => <AccountConfiguration key={`${account.id}:${account.customerId}:${account.valueTrackingVerified}`} account={account} clients={catalog.clients} saved={() => { void reloadCatalog(); void reloadReport(); }} />)}</details>}
    <details><summary>{t('paid_jobs_errors', 'Data collection runs and connection errors')}</summary>{catalog?.jobs.map((job: any) => <p key={job.id}>{job.accountId} · {job.level} · {job.kind} · {job.status} · {job.errorCode || t('paid_no_error', 'No error')} · {job.completedAt || t('paid_not_completed', 'not completed')}</p>)}</details>
    {manager && <section className="border border-fifth bg-sixth text-textColor rounded-[4px] p-4 flex flex-col gap-3"><h2>{t('paid_scheduled_reports', 'Scheduled client reports')}</h2>
      <p>{catalog?.schedulesEnabled ? t('paid_scheduler_enabled', 'Scheduled reports are on') : t('paid_scheduler_paused', 'Scheduled reports are turned off')}. {t('paid_scheduler_notice', 'Reports are saved to a private archive or sent as a secure download link to a workspace member. Reports never have a public link.')}</p>
      <label>{t('paid_report_name', 'Report name')} <input value={schedule.name} onChange={(event) => setSchedule({ ...schedule, name: event.target.value })} /></label>
      <label>{t('paid_rolling_days', 'Days to include')} <input type="number" min={1} max={93} value={schedule.rollingDays} onChange={(event) => setSchedule({ ...schedule, rollingDays: Number(event.target.value) })} /></label>
      <label>{t('paid_cadence', 'Cadence')} <select value={schedule.cadenceDays} onChange={(event) => setSchedule({ ...schedule, cadenceDays: Number(event.target.value) })} className="bg-third text-textColor border border-fifth rounded-[4px] p-2"><option value={1}>{t('paid_daily', 'Daily')}</option><option value={7}>{t('paid_weekly', 'Weekly')}</option><option value={30}>{t('paid_every_30_days', 'Every 30 days')}</option></select></label>
      <label>{t('paid_format', 'Format')} <select value={schedule.format} onChange={(event) => setSchedule({ ...schedule, format: event.target.value })} className="bg-third text-textColor border border-fifth rounded-[4px] p-2"><option>PDF</option><option>CSV</option></select></label>
      <label>{t('paid_delivery', 'Delivery')} <select value={schedule.delivery} onChange={(event) => setSchedule({ ...schedule, delivery: event.target.value })} className="bg-third text-textColor border border-fifth rounded-[4px] p-2"><option value="ARCHIVE">{t('paid_private_archive', 'Private archive')}</option><option value="EMAIL">{t('paid_email_link', 'Email a secure download link')}</option></select></label>
      {schedule.delivery === 'EMAIL' && <label>{t('paid_member_email', 'Workspace member email')} <input type="email" value={schedule.recipient} onChange={(event) => setSchedule({ ...schedule, recipient: event.target.value })} /></label>}
      <label><input type="checkbox" checked={schedule.requireFresh} onChange={(event) => setSchedule({ ...schedule, requireFresh: event.target.checked })} /> {t('paid_require_fresh', 'Only run when recent and comparison data are complete')}</label>
      <Button type="button" disabled={pending} onClick={saveSchedule}>{editing ? t('paid_update_schedule', 'Update schedule') : t('paid_create_schedule', 'Create schedule from current filters')}</Button>
      {schedules?.schedules.map((item: any) => <div key={item.id}><span>{item.name} · {item.delivery} · {item.enabled ? t('paid_enabled', 'Enabled') : t('paid_paused', 'Paused')} · {t('paid_next_run', 'Next {{date}}', { date: item.nextRunAt, interpolation: { escapeValue: false } })}</span>
        <button type="button" className="rounded-[4px] border border-fifth bg-sixth px-3 py-2 text-sm text-textColor hover:bg-forth focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { setEditing(item.id); setSchedule({ name: item.name, rollingDays: item.rollingDays, cadenceDays: item.cadenceDays, format: item.format, delivery: item.delivery, recipient: item.recipient || '', requireFresh: item.requireFresh }); setQuery({ ...initialDates(), ...item.query }); }}>{t('paid_edit', 'Edit')}</button>
        <button type="button" className="rounded-[4px] border border-fifth bg-sixth px-3 py-2 text-sm text-textColor hover:bg-forth focus-visible:outline-2 focus-visible:outline-primary" onClick={() => action(async () => { await json(await fetch(`/paid-analytics/schedules/${item.id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled: !item.enabled }) })); void reloadSchedules(); })}>{item.enabled ? t('paid_pause', 'Pause') : t('paid_enable', 'Enable')}</button></div>)}
      {schedules?.runs.map((run: any) => <div key={run.id}>{run.format} · {run.status} · {t('paid_delivery_status', 'Delivery {{status}}', { status: run.deliveryStatus, interpolation: { escapeValue: false } })} · {run.errorCode || t('paid_no_error', 'No error')} {run.status === 'READY' && <button type="button" className="rounded-[4px] border border-fifth bg-sixth px-3 py-2 text-sm text-textColor hover:bg-forth focus-visible:outline-2 focus-visible:outline-primary" onClick={() => action(async () => saveBlob(await fetch(`/paid-analytics/runs/${run.id}/download`), `paid-report.${run.format.toLowerCase()}`))}>{t('paid_download_report', 'Download report')}</button>}</div>)}
    </section>}
  </main>;
};
