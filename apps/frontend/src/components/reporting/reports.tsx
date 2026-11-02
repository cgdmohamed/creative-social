'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
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
const value = (number: number | null) =>
  number === null
    ? 'Not available'
    : number.toLocaleString(undefined, { maximumFractionDigits: 2 });
const semantics = {
  FLOW: 'Daily total',
  STOCK: 'Latest reading',
  LEVEL: 'Observed change',
  AVERAGE: 'Unweighted average',
};
const field =
  'rounded-lg border border-newTableBorder bg-newTableHeader p-2 text-sm';
const button =
  'rounded-lg bg-customColor21 px-4 py-2 text-sm disabled:opacity-40';
function Trend({ metric }: { metric: MetricResult }) {
  const known = metric.series.flatMap((p) =>
    p.value === null ? [] : [p.value]
  );
  if (known.length < 2)
    return (
      <p className="text-sm opacity-60">
        Collect more observations to see a trend.
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
        aria-label={`${metric.label} observed history`}
      >
        <path d={path} fill="none" stroke="#9581ff" strokeWidth="2" />
      </svg>
      <p className="flex justify-between text-xs opacity-60">
        <span>{metric.series[0]?.date}</span>
        <span>Gaps are not interpolated</span>
        <span>{metric.series[metric.series.length - 1]?.date}</span>
      </p>
    </div>
  );
}
export function Reports() {
  const fetch = useFetch();
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
  const [report, setReport] = useState<OrganicReport | null>(null);
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
            : body.message || 'Request failed'
        );
      }
      return result;
    },
    [fetch]
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
            'Showing the first 1,000 channels. Choose a client to narrow the selection.'
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
  }, [request, customer, client]);
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
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };
  const generate = () =>
    run(async () => {
      const next = await (await request('/reports/organic?' + query)).json();
      setReport(next);
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
                'Channel'
              }: ${r.status.replace('_', ' ')}`
          )
          .join(' / ') +
          ' - Queued collection runs in the background. Build the report again to refresh stored data.'
      );
    });
  const selectedMetric = report?.metrics.find((m) => m.metric === metric);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-3 lg:p-6">
      <header>
        <p className="text-xs uppercase tracking-widest opacity-60">
          Creative Social
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Client reports</h1>
        <p className="mt-2 text-sm opacity-70">
          Historical content performance, equal-period comparisons, and
          client-ready exports.
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="flex flex-col gap-4 rounded-xl border border-newTableBorder p-4">
          <label className="flex flex-col gap-2 text-sm">
            Client
            <select
              className={field}
              value={client}
              onChange={(e) => {
                setReport(null);
                setCampaign('');
                setPosts([]);
                setPostIds([]);
                setError('');
                setClient(e.target.value);
              }}
            >
              <option value="">All clients</option>
              <option value="__unassigned">Unassigned channels</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Channels</h2>
            <button
              className="text-xs underline"
              onClick={() =>
                setSelected(selected.length ? [] : channels.map((c) => c.id))
              }
            >
              {selected.length ? 'Clear' : 'Select all'}
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
                  setReport(null);
                }}
              />
              <span>
                {c.name}
                <span className="block text-xs opacity-60">
                  {c.provider}
                  {!c.supported ? ' - collection unavailable' : ''}
                </span>
              </span>
            </label>
          ))}
          {!channels.length && (
            <p className="text-sm opacity-60">
              No connected channels for this client.
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
            Collect recent data
          </button>
          <p className="text-xs opacity-60">
            {!collectionEnabled &&
              'Collection is disabled on this server. Contact an administrator. '}
            Collect up to 10 channels at a time. Existing history stays
            available. Paid Ads connectors are not connected.
          </p>
        </aside>
        <main className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-newTableBorder p-4">
            <label className="flex flex-col gap-1 text-sm">
              From
              <input
                className={field}
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setReport(null);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <input
                className={field}
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setReport(null);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Performance
              <select
                className={field}
                value={scope}
                disabled={!!campaign}
                onChange={(e) => {
                  setScope(e.target.value as 'CHANNEL' | 'POST');
                  setReport(null);
                }}
              >
                <option value="CHANNEL">Channel metrics</option>
                <option value="POST">Post-counter changes</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Campaign
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
                  setReport(null);
                }}
              >
                <option value="">No campaign filter</option>
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
              {busy ? 'Working...' : 'Build report'}
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
                Build a report from stored observations
              </h2>
              <p className="mt-3 text-sm opacity-70">
                Choose a client, channels and dates. A new installation has no
                history until collection runs. Missing metrics are not treated
                as zero.
              </p>
            </div>
          )}
          {report && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{report.name}</h2>
                  <p className="text-xs opacity-60">
                    {report.from} to {report.to} / Compared with{' '}
                    {report.previousFrom} to {report.previousTo}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => download('csv')}
                  >
                    CSV
                  </button>
                  <button
                    className={button}
                    disabled={busy || !pdfEnabled}
                    title={
                      pdfEnabled
                        ? undefined
                        : 'PDF export is not enabled on this server'
                    }
                    onClick={() => download('pdf')}
                  >
                    PDF report
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-newTableBorder">
                <table className="w-full text-left text-sm">
                  <thead className="bg-newTableHeader">
                    <tr>
                      {[
                        'Metric',
                        'Current',
                        'Previous',
                        'Change',
                        'Coverage',
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
                              ? 'Complete windows'
                              : 'Partial / missing data'}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.metrics.length && (
                  <p className="p-5 text-sm opacity-60">
                    No stored observations for this selection. Collect data and
                    check channel permissions.
                  </p>
                )}
              </div>
              {!!report.metrics.length && (
                <section className="rounded-xl border border-newTableBorder p-4">
                  <label className="flex items-center justify-between gap-2">
                    <h3>Observed history</h3>
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
                        <summary>Daily observations</summary>
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
                <h3 className="mb-2 font-medium">By channel</h3>
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
                          No stored observations.
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </section>
              <section className="rounded-xl bg-newTableHeader p-4">
                <h3 className="font-medium">Reading this report</h3>
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
                    : {c.status.replace('_', ' ')} / Last success:{' '}
                    {c.lastSuccessAt
                      ? new Date(c.lastSuccessAt).toLocaleString()
                      : 'Never'}
                    {c.detail ? ' / ' + c.detail : ''}
                  </p>
                ))}
              </section>
            </>
          )}
          <details className="rounded-xl border border-newTableBorder p-4">
            <summary className="cursor-pointer font-medium">
              Create a campaign report
            </summary>
            <p className="my-3 text-xs opacity-60">
              Group published posts for one client. The chosen dates become the
              report default. Choose a client or unassigned channels before
              selecting posts.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                className={field}
                placeholder="Campaign name"
                aria-label="Campaign name"
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
                        'Showing the first 500 posts. Narrow channels to find older posts.'
                      );
                  })
                }
              >
                Load published posts
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
                  setReport(null);
                  setNotice(
                    'Campaign saved. Build the report to compare its observed post performance.'
                  );
                })
              }
            >
              Save campaign ({postIds.length} posts)
            </button>
          </details>
        </main>
      </div>
    </div>
  );
}
