'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type {
  OrganicReport,
  MetricResult,
} from '@gitroom/nestjs-libraries/reporting/reporting.types';
type Channel = {
  id: string;
  name: string;
  provider: string;
  customerId: string | null;
  supported: boolean;
};
type Campaign = { id: string; name: string; from: string; to: string };
type Post = {
  id: string;
  title: string;
  integrationId: string;
  publishedAt: string;
};
const day = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
const field =
  'rounded-lg border border-newTableBorder bg-newTableHeader p-2 text-sm';
const button =
  'rounded-lg bg-customColor21 px-4 py-2 text-sm disabled:opacity-40';
function Trend({ metric }: { metric: MetricResult }) {
  const t = useT();
  const known = metric.series.flatMap((p) =>
    p.value === null ? [] : [p.value]
  );
  if (known.length < 2)
    return (
      <p className="text-sm opacity-60">
        {t('reports_collect_more_observations', 'Not enough data for a trend yet. Collect data over more days.')}
      </p>
    );
  const min = Math.min(0, ...known),
    max = Math.max(1, ...known);
  const path = metric.series
    .map((point, index) => {
      if (point.value === null) {
        return '';
      }
      const part = `${
        index > 0 && metric.series[index - 1].value !== null ? 'L' : 'M'
      }${((index / Math.max(1, metric.series.length - 1)) * 700).toFixed(1)},${(
        140 -
        ((point.value - min) / (max - min)) * 135
      ).toFixed(1)}`;
      return part;
    })
    .join(' ');
  return (
    <div>
      <svg
        viewBox="0 0 700 150"
        className="h-40 w-full"
        role="img"
        aria-label={t('reports_metric_observed_history', '{{metric}} observed history', {
          metric: metric.label,
          interpolation: { escapeValue: false },
        })}
      >
        <path d={path} fill="none" stroke="#9581ff" strokeWidth="2" />
      </svg>
      <p className="flex justify-between text-xs opacity-60">
        <span>{metric.series[0]?.date}</span>
        <span>{t('reports_gaps_not_interpolated', 'Days without data are left blank')}</span>
        <span>{metric.series[metric.series.length - 1]?.date}</span>
      </p>
    </div>
  );
}
export function Reports() {
  const t = useT();
  const fetch = useFetch();
  const value = (number: number | null) =>
    number === null
      ? t('reports_not_available', 'Not available')
      : number.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const semantics = {
    FLOW: t('reports_semantics_flow', 'Daily total'),
    STOCK: t('reports_semantics_stock', 'Latest reading'),
    LEVEL: t('reports_semantics_level', 'Observed change'),
    AVERAGE: t('reports_semantics_average', 'Unweighted average'),
  };
  const [client, setClient] = useState('');
  const [collectionEnabled, setCollectionEnabled] = useState(false);
  const [pdfEnabled, setPdfEnabled] = useState(false);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState('');
  const [from, setFrom] = useState(() => day(Date.now() - 30 * 86400000));
  const [to, setTo] = useState(() => day(Date.now() - 86400000));
  const [scope, setScope] = useState<'CHANNEL' | 'POST'>('CHANNEL');
  const [reportResult, setReportResult] = useState<{
    query: string;
    report: OrganicReport;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [metric, setMetric] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [postIds, setPostIds] = useState<string[]>([]);
  const [campaignName, setCampaignName] = useState('');
  const customer = client;
  const request = useCallback(
    async (url: string, init?: RequestInit) => {
      const result = await fetch(url, init);
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        throw new Error(
          Array.isArray(body.message)
            ? body.message.join('; ')
            : body.message ||
                t('reports_request_failed', 'The request did not go through. Check your connection and try again.')
        );
      }
      return result;
    },
    [fetch, t]
  );
  useEffect(() => {
    let active = true;
    request(
      '/reports/options' +
        (customer ? '?customerId=' + encodeURIComponent(customer) : '')
    )
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        const available = data.channels;
        if (data.truncated)
          setNotice(
            t(
              'reports_first_channels_shown',
              'Showing the first 1,000 channels. Choose a client to narrow the selection.'
            )
          );
        setCollectionEnabled(data.collectionEnabled);
        setPdfEnabled(data.pdfEnabled);
        setClients(data.clients);
        setChannels(available);
        setSelected(available.map((c: Channel) => c.id));
        setCampaigns(
          client === '__unassigned'
            ? data.campaigns.filter(
                (c: { customerId: string | null }) => !c.customerId
              )
            : data.campaigns
        );
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [request, customer, client, t]);
  const query = useMemo(() => {
    const params = new URLSearchParams({
      from,
      to,
      scope,
      integrationIds: selected.join(','),
    });
    if (customer) params.set('customerId', customer);
    if (campaign) params.set('campaignId', campaign);
    return params.toString();
  }, [from, to, scope, selected, customer, campaign]);
  // A response for an older client/filter selection cannot label the current view.
  const report = reportResult?.query === query ? reportResult.report : null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error
          ? err.message
          : t('reports_request_failed', 'The request did not go through. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };
  const generate = () =>
    run(async () => {
      const next = await (await request('/reports/organic?' + query)).json();
      setReportResult({ query, report: next });
      setMetric(next.metrics[0]?.metric || '');
    });
  const download = (format: 'csv' | 'pdf') =>
    run(async () => {
      const response = await request(`/reports/organic.${format}?${query}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `creative-social-report.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const collect = () =>
    run(async () => {
      const results = await (
        await request('/reports/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrationIds: selected,
            ...(customer ? { customerId: customer } : {}),
          }),
        })
      ).json();
      setNotice(
        results
          .map(
            (r: { integrationId: string; status: string }) =>
              `${
                channels.find((c) => c.id === r.integrationId)?.name ||
                t('reports_channel', 'Channel')
              }: ${r.status.replace('_', ' ')}`
          )
          .join(' / ') +
          ' - ' +
          t(
            'reports_collection_queued',
            'Data collection has started in the background. Build the report again when it finishes to see the new data.'
          )
      );
    });
  const selectedMetric = report?.metrics.find((m) => m.metric === metric);
  return (
    <div className="app-form mx-auto flex max-w-7xl flex-col gap-6 p-3 lg:p-6">
      <header>
        <p className="text-xs uppercase tracking-widest opacity-60">
          {t('reports_brand', 'Creative Social')}
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          {t('reports_title', 'Client reports')}
        </h1>
        <p className="mt-2 text-sm opacity-70">
          {t(
            'reports_subtitle',
            'Historical content performance, equal-period comparisons, and client-ready exports.'
          )}
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="flex flex-col gap-4 rounded-xl border border-newTableBorder p-4">
          <label className="flex flex-col gap-2 text-sm">
            {t('reports_client', 'Client')}
            <select
              className={field}
              value={client}
              onChange={(e) => {
                setReportResult(null);
                setCampaign('');
                setPosts([]);
                setPostIds([]);
                setError('');
                setClient(e.target.value);
              }}
            >
              <option value="">{t('reports_all_clients', 'All clients')}</option>
              <option value="__unassigned">
                {t('reports_unassigned_channels', 'Unassigned channels')}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t('reports_channels', 'Channels')}</h2>
            <button
              className="text-xs underline"
              onClick={() =>
                setSelected(selected.length ? [] : channels.map((c) => c.id))
              }
            >
              {selected.length
                ? t('reports_clear', 'Clear')
                : t('reports_select_all', 'Select all')}
            </button>
          </div>
          {channels.map((c) => (
            <label className="flex items-start gap-2 text-sm" key={c.id}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => {
                  setSelected((prev) =>
                    prev.includes(c.id)
                      ? prev.filter((id) => id !== c.id)
                      : [...prev, c.id]
                  );
                  setReportResult(null);
                }}
              />
              <span>
                {c.name}
                <span className="block text-xs opacity-60">
                  {c.provider}
                  {!c.supported
                    ? ' - ' +
                      t('reports_collection_unavailable', 'collection unavailable')
                    : ''}
                </span>
              </span>
            </label>
          ))}
          {!channels.length && (
            <p className="text-sm opacity-60">
              {t(
                'reports_no_connected_channels',
                'No connected channels for this client.'
              )}
            </p>
          )}
          <button
            className={button}
            disabled={
              busy ||
              !collectionEnabled ||
              !selected.length ||
              selected.length > 10
            }
            onClick={collect}
          >
            {t('reports_collect_recent_data', 'Collect recent data')}
          </button>
          <p className="text-xs opacity-60">
            {!collectionEnabled &&
              t(
                'reports_collection_disabled',
                'Data collection is turned off. You can still view saved data. Ask an administrator to turn it on.'
              ) + ' '}
            {t(
              'reports_collection_limits',
              'You can update up to 10 channels at a time. Existing history stays available. Paid ads are not included.'
            )}
          </p>
        </aside>
        <main className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-newTableBorder p-4">
            <label className="flex flex-col gap-1 text-sm">
              {t('reports_from', 'From')}
              <input
                className={field}
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setReportResult(null);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('reports_to', 'To')}
              <input
                className={field}
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setReportResult(null);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('reports_performance', 'Performance')}
              <select
                className={field}
                value={scope}
                disabled={!!campaign}
                onChange={(e) => {
                  setScope(e.target.value as 'CHANNEL' | 'POST');
                  setReportResult(null);
                }}
              >
                <option value="CHANNEL">
                  {t('reports_channel_metrics', 'Channel metrics')}
                </option>
                <option value="POST">
                  {t('reports_post_counter_changes', 'Change in post totals')}
                </option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('reports_campaign', 'Campaign')}
              <select
                className={field}
                value={campaign}
                onChange={(e) => {
                  const found = campaigns.find((c) => c.id === e.target.value);
                  setCampaign(e.target.value);
                  if (found) {
                    setFrom(found.from.slice(0, 10));
                    setTo(found.to.slice(0, 10));
                    setScope('POST');
                  }
                  setReportResult(null);
                }}
              >
                <option value="">
                  {t('reports_no_campaign_filter', 'No campaign filter')}
                </option>
                {campaigns.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={button}
              disabled={busy || !selected.length}
              onClick={generate}
            >
              {busy
                ? t('reports_working', 'Working...')
                : t('reports_build_report', 'Build report')}
            </button>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-400/50 p-3 text-sm text-red-300"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-lg border border-newTableBorder p-3 text-sm"
            >
              {notice}
            </p>
          )}
          {!report && (
            <div className="rounded-xl bg-newTableHeader p-8">
              <h2 className="text-xl">
                {t(
                  'reports_build_from_stored',
                  'Build a report'
                )}
              </h2>
              <p className="mt-3 text-sm opacity-70">
                {t(
                  'reports_build_from_stored_hint',
                  'Choose a client, channels and dates. A new account has no history until data is collected. Missing data is not counted as zero.'
                )}
              </p>
            </div>
          )}
          {report && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{report.name}</h2>
                  <p className="text-xs opacity-60">
                    {t(
                      'reports_period_comparison',
                      '{{from}} to {{to}} / Compared with {{previousFrom}} to {{previousTo}}',
                      {
                        from: report.from,
                        to: report.to,
                        previousFrom: report.previousFrom,
                        previousTo: report.previousTo,
                        interpolation: { escapeValue: false },
                      }
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => download('csv')}
                  >
                    {t('reports_csv', 'CSV')}
                  </button>
                  <button
                    className={button}
                    disabled={busy || !pdfEnabled}
                    title={
                      pdfEnabled
                        ? undefined
                        : t(
                            'reports_pdf_not_enabled',
                            'PDF export is turned off. Ask an administrator to turn it on.'
                          )
                    }
                    onClick={() => download('pdf')}
                  >
                    {t('reports_pdf_report', 'PDF report')}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-newTableBorder">
                <table className="w-full text-left text-sm">
                  <thead className="bg-newTableHeader">
                    <tr>
                      {[
                        t('reports_col_metric', 'Metric'),
                        t('reports_col_current', 'Current'),
                        t('reports_col_previous', 'Previous'),
                        t('reports_col_change', 'Change'),
                        t('reports_col_coverage', 'Coverage'),
                      ].map((h) => (
                        <th className="p-3" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.metrics.map((m) => (
                      <tr
                        className="border-t border-newTableBorder"
                        key={m.metric}
                      >
                        <td className="p-3">
                          {m.label}
                          <small className="block opacity-60">
                            {semantics[m.kind]} / {m.unit}
                          </small>
                        </td>
                        <td className="p-3">{value(m.current)}</td>
                        <td className="p-3">{value(m.previous)}</td>
                        <td className="p-3">
                          {m.change === null
                            ? '-'
                            : value(m.change) +
                              (m.unit === 'percent' ? ' pp' : '%')}
                        </td>
                        <td className="p-3">
                          {m.observed}/{m.expected}
                          <small className="block opacity-60">
                            {m.complete
                              ? t('reports_complete_windows', 'Complete windows')
                              : t(
                                  'reports_partial_data',
                                  'Partial / missing data'
                                )}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.metrics.length && (
                  <p className="p-5 text-sm opacity-60">
                    {t(
                      'reports_no_observations_selection',
                      'No saved data for this selection. Collect recent data and check the channel permissions.'
                    )}
                  </p>
                )}
              </div>
              {!!report.metrics.length && (
                <section className="rounded-xl border border-newTableBorder p-4">
                  <label className="flex items-center justify-between gap-2">
                    <h3>{t('reports_observed_history', 'Observed history')}</h3>
                    <select
                      className={field}
                      value={metric}
                      onChange={(e) => setMetric(e.target.value)}
                    >
                      {report.metrics.map((m) => (
                        <option value={m.metric} key={m.metric}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedMetric && (
                    <>
                      <Trend metric={selectedMetric} />
                      <details className="mt-4 text-xs">
                        <summary>{t('reports_daily_observations', 'Daily observations')}</summary>
                        <div className="mt-2 max-h-48 overflow-auto">
                          <table className="w-full">
                            <tbody>
                              {selectedMetric.series.map((p) => (
                                <tr key={p.date}>
                                  <td>{p.date}</td>
                                  <td>{value(p.value)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  )}
                </section>
              )}
              <section>
                <h3 className="mb-2 font-medium">
                  {t('reports_by_channel', 'By channel')}
                </h3>
                {report.channels.map((c) => (
                  <details
                    key={c.id}
                    className="mb-2 rounded-lg border border-newTableBorder p-3"
                  >
                    <summary>
                      {c.name}{' '}
                      <span className="text-xs opacity-60">{c.provider}</span>
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {c.metrics.map((m) => (
                        <p className="text-sm" key={m.metric}>
                          {m.label}: <strong>{value(m.current)}</strong>
                        </p>
                      ))}
                      {!c.metrics.length && (
                        <p className="text-sm opacity-60">
                          {t(
                            'reports_no_stored_observations',
                            'No stored observations.'
                          )}
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </section>
              <section className="rounded-xl bg-newTableHeader p-4">
                <h3 className="font-medium">
                  {t('reports_reading_this_report', 'Reading this report')}
                </h3>
                {report.warnings.map((w) => (
                  <p key={w} className="mt-2 text-xs opacity-70">
                    {w}
                  </p>
                ))}
                {report.collection.map((c) => (
                  <p key={c.integrationId} className="mt-3 text-xs">
                    {
                      report.channels.find((ch) => ch.id === c.integrationId)
                        ?.name
                    }
                    : {c.status.replace('_', ' ')} /{' '}
                    {t('reports_last_success', 'Last success:')}{' '}
                    {c.lastSuccessAt
                      ? new Date(c.lastSuccessAt).toLocaleString()
                      : t('reports_never', 'Never')}
                    {c.detail ? ' / ' + c.detail : ''}
                  </p>
                ))}
              </section>
            </>
          )}
          <details className="rounded-xl border border-newTableBorder p-4">
            <summary className="cursor-pointer font-medium">
              {t('reports_create_campaign_report', 'Create a campaign report')}
            </summary>
            <p className="my-3 text-xs opacity-60">
              {t(
                'reports_create_campaign_hint',
                'Group published posts for one client. The dates you choose become the default for the report. Pick a client or unassigned channels first, then select posts.'
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                className={field}
                placeholder={t('reports_campaign_name', 'Campaign name')}
                aria-label={t('reports_campaign_name', 'Campaign name')}
                maxLength={150}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
              <button
                className={button}
                disabled={busy || !selected.length}
                onClick={() =>
                  run(async () => {
                    const result = await (
                      await request(
                        '/reports/posts?' +
                          new URLSearchParams({
                            ...(customer ? { customerId: customer } : {}),
                            integrationIds: selected.join(','),
                          })
                      )
                    ).json();
                    setPosts(result.items);
                    setPostIds([]);
                    if (result.truncated)
                      setNotice(
                        t(
                          'reports_first_posts_shown',
                          'Showing the first 500 posts. Narrow channels to find older posts.'
                        )
                      );
                  })
                }
              >
                {t('reports_load_published_posts', 'Load published posts')}
              </button>
            </div>
            <div className="my-3 max-h-64 overflow-auto">
              {posts.map((p) => (
                <label className="mb-2 flex gap-2 text-sm" key={p.id}>
                  <input
                    type="checkbox"
                    checked={postIds.includes(p.id)}
                    onChange={() =>
                      setPostIds((prev) =>
                        prev.includes(p.id)
                          ? prev.filter((id) => id !== p.id)
                          : [...prev, p.id]
                      )
                    }
                  />
                  <span>
                    {p.title}
                    <small className="block opacity-60">
                      {channels.find((c) => c.id === p.integrationId)?.name} /{' '}
                      {p.publishedAt.slice(0, 10)}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <button
              className={button}
              disabled={
                busy ||
                !campaignName.trim() ||
                !postIds.length ||
                postIds.length > 200
              }
              onClick={() =>
                run(async () => {
                  const result = await (
                    await request('/reports/campaigns', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: campaignName,
                        from,
                        to,
                        postIds,
                        ...(customer ? { customerId: customer } : {}),
                      }),
                    })
                  ).json();
                  setCampaigns((prev) => [result, ...prev]);
                  setCampaign(result.id);
                  setScope('POST');
                  setReportResult(null);
                  setNotice(
                    t(
                      'reports_campaign_saved',
                      'Campaign saved. Build the report to compare its observed post performance.'
                    )
                  );
                })
              }
            >
              {t('reports_save_campaign', 'Save campaign ({{postCount}} posts)', {
                postCount: postIds.length,
              })}
            </button>
          </details>
        </main>
      </div>
    </div>
  );
}
