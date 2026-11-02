// Escaping helpers selectively ported/adapted from Postmill AI's campaign report
// service/template at 564569110b267562a21bc662a8d30ea77786ea6e, AGPL-3.0.
import { OrganicReport, MetricResult } from './reporting.types';
export function escapeHtml(value: unknown): string {
  const str = String(value ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export function sanitizeCsvCell(value: unknown): string {
  let cell = String(value ?? '');
  if (/^\s*[+=\-@]/.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}
export function reportCsv(report: OrganicReport): string {
  const headers = [
    'client',
    'report',
    'from',
    'to',
    'scope',
    'traffic',
    'channel',
    'provider',
    'metric',
    'unit',
    'kind',
    'current',
    'previous',
    'change',
    'complete',
    'observed',
    'expected',
  ];
  const rows = report.channels.flatMap((channel) =>
    channel.metrics.map((m) => [
      report.customerName || 'All clients',
      report.name,
      report.from,
      report.to,
      report.scope,
      report.traffic,
      channel.name,
      channel.provider,
      m.label,
      m.unit,
      m.kind,
      m.current,
      m.previous,
      m.change,
      m.complete,
      m.observed,
      m.expected,
    ])
  );
  return [headers, ...rows]
    .map((row) => row.map(sanitizeCsvCell).join(','))
    .join('\r\n');
}
const number = (value: number | null) =>
  value === null
    ? 'Not available'
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
function trend(metric: MetricResult): string {
  const known = metric.series
    .filter((p) => p.value !== null)
    .map((p) => p.value!);
  if (known.length < 2) return '';
  const low = Math.min(0, ...known),
    high = Math.max(1, ...known);
  let open = false;
  const path = metric.series
    .map((point, i) => {
      if (point.value === null) {
        open = false;
        return '';
      }
      const part = `${open ? 'L' : 'M'}${(
        (i / Math.max(1, metric.series.length - 1)) *
        500
      ).toFixed(1)},${(70 - ((point.value - low) / (high - low)) * 65).toFixed(
        1
      )}`;
      open = true;
      return part;
    })
    .join(' ');
  return `<svg viewBox="0 0 500 78" role="img" aria-label="Observed trend"><path d="${path}" fill="none" stroke="#5942d6" stroke-width="2" /></svg>`;
}
export function reportHtml(report: OrganicReport): string {
  const e = escapeHtml;
  const metrics = report.metrics
    .map(
      (m) =>
        `<tr><td><strong>${e(m.label)}</strong><small>${e(
          {
            FLOW: 'Daily total',
            STOCK: 'Latest reading',
            LEVEL: 'Observed change',
            AVERAGE: 'Unweighted average',
          }[m.kind]
        )} / ${e(m.unit)}</small></td><td>${number(m.current)}</td><td>${number(
          m.previous
        )}</td><td>${
          m.change === null
            ? '-'
            : number(m.change) + (m.unit === 'percent' ? ' pp' : '%')
        }</td><td>${m.observed}/${m.expected}<small>${
          m.complete ? 'Complete windows' : 'Partial / missing data'
        }</small></td></tr>`
    )
    .join('');
  const channels = report.channels
    .map(
      (c) =>
        `<section class="channel"><h2>${e(c.name)} <small>${e(
          c.provider
        )}</small></h2><table><thead><tr><th>Metric</th><th>Current</th><th>Previous</th><th>Observed</th></tr></thead><tbody>${
          c.metrics
            .map(
              (m) =>
                `<tr><td>${e(m.label)}</td><td>${number(
                  m.current
                )}</td><td>${number(m.previous)}</td><td>${m.observed}/${
                  m.expected
                }</td></tr>`
            )
            .join('') ||
          '<tr><td colspan="4">No stored observations. Connect permissions and collect data.</td></tr>'
        }</tbody></table></section>`
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(
    report.name
  )}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'"><style>
  * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color:#202535; margin:0; font-size:11px; line-height:1.45; }
  header { border-top:8px solid #5942d6; padding:24px 0 18px; } .brand { font-size:10px; text-transform:uppercase; letter-spacing:2px; color:#5942d6; } h1 { font-size:26px; line-height:1.15; margin:12px 0; overflow-wrap:anywhere; } h2 { break-after:avoid; font-size:16px; margin:20px 0 9px; } p { margin:6px 0; } small { display:block; color:#616a7c; font-size:9px; font-weight:normal; } section { margin-top:18px; } .channel { break-inside:avoid; } table { border-collapse:collapse; width:100%; table-layout:fixed; } thead { display:table-header-group; } th { background:#f0edf9; text-align:left; color:#45378c; } td, th { padding:9px 7px; border-bottom:1px solid #e3e5eb; vertical-align:top; overflow-wrap:anywhere; } td:first-child, th:first-child { width:36%; } tr { break-inside:avoid; } .note { border-left:3px solid #b8abea; padding:6px 10px; background:#f7f6fb; margin:5px 0; } .trend { break-inside:avoid; margin:16px 0; } svg { display:block; width:100%; height:90px; } .empty { padding:20px; background:#f7f6fb; }
  </style></head><body><header><div class="brand">Creative Social / Creative Code</div><h1>${e(
    report.name
  )}</h1><p>${e(
    report.customerName || 'All clients in this organization'
  )} / ${e(
    report.scope === 'POST' ? 'Post-counter changes' : 'Channel metrics'
  )}</p><p><strong>${e(report.from)} to ${e(
    report.to
  )}</strong></p><small>Compared with ${e(report.previousFrom)} to ${e(
    report.previousTo
  )} / Generated ${e(report.generatedAt.slice(0, 10))}</small></header>
  <section><h2>Period comparison</h2>${
    metrics
      ? `<table><thead><tr><th>Metric / semantics</th><th>Current</th><th>Previous</th><th>Change</th><th>Coverage</th></tr></thead><tbody>${metrics}</tbody></table>`
      : '<p class="empty">No stored observations for this selection. Missing data is not zero performance.</p>'
  }</section>
  <section><h2>Reading this report</h2>${report.warnings
    .map((w) => `<p class="note">${e(w)}</p>`)
    .join('')}</section>
  <section><h2>Observed trends</h2>${report.metrics
    .map(
      (m) =>
        `<div class="trend"><strong>${e(m.label)}</strong><small>${e(
          m.unit
        )} / Gaps are not interpolated</small>${
          trend(m) || '<p>Not enough observations for a trend.</p>'
        }</div>`
    )
    .join('')}</section>
  ${channels}<section><h2>Collection status</h2>${
    report.collection
      .map(
        (c) =>
          `<p>${e(
            report.channels.find((ch) => ch.id === c.integrationId)?.name ||
              'Channel'
          )}: ${e(c.status)} <small>Last successful collection: ${
            c.lastSuccessAt
              ? e(new Date(c.lastSuccessAt).toISOString())
              : 'Never'
          }${c.detail ? ' / ' + e(c.detail) : ''}</small></p>`
      )
      .join('') || '<p>No collection has run yet.</p>'
  }</section></body></html>`;
}
