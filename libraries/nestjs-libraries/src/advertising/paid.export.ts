// Reuse the existing Postmill-attributed escaping helpers and offline PDF renderer.
import { escapeHtml as e, sanitizeCsvCell } from '../reporting/reporting.export';
export const paidMetricNames = ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'conversions', 'conversionRate', 'cpa', 'leads', 'cpl', 'purchaseValue', 'roas'];
export function paidCsv(report: any) {
  const rows: unknown[][] = [['traffic', 'client_id', 'client_name', 'from', 'to', 'level', 'provider', 'account', 'currency', 'timezone', 'attribution', 'attribution_fingerprint', 'attribution_details_first_group_row',
    'entity_id', 'entity_name', 'metric', 'current', 'previous', 'unit', 'complete', 'previous_complete', 'last_sync']];
  for (const group of report.groups) {
    const entities = group.entities.length ? group.entities : [{ id: '', name: 'No provider rows', current: group.current, previous: group.previous }];
    let detailsEmitted = false;
    for (const entity of entities) for (const metric of paidMetricNames) { rows.push([
      'PAID', report.customerId || '', report.customerName || 'All workspace clients', report.from, report.to, report.level, group.provider, group.accountName, group.currency,
      group.timezone, group.attribution, group.attributionFingerprint || '', detailsEmitted ? '' : JSON.stringify(group.attributionDetails || {}), entity.id, entity.name, metric, entity.current[metric] ?? 'UNAVAILABLE', entity.previous[metric] ?? 'UNAVAILABLE',
      ['spend', 'cpc', 'cpm', 'cpa', 'cpl', 'purchaseValue'].includes(metric) ? group.currency : ['ctr', 'conversionRate'].includes(metric) ? 'percent' : metric === 'roas' ? 'multiple' : 'count',
      group.complete, group.previousComplete, group.lastSync || 'NEVER',
    ]); detailsEmitted = true; }
  }
  return rows.map((row) => row.map(sanitizeCsvCell).join(',')).join('\r\n');
}
export function paidHtml(report: any) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:11px Arial;color:#172033}h1{font-size:22px}h2{font-size:16px}section{page-break-before:auto;margin:22px 0}
    table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccd2dd;padding:5px;text-align:left;overflow-wrap:anywhere}
    p{line-height:1.5}small{color:#48536a}</style></head><body>
    <h1>Creative Social · Paid advertising report</h1><p>${e(report.from)} – ${e(report.to)} · ${e(report.level)} · Client: ${e(report.customerName || 'All workspace clients')}</p>
    <p>Previous period: ${e(report.previous.from)} – ${e(report.previous.to)}. Generated ${e(report.generatedAt)}.</p>
    ${report.groups.length ? '' : '<p>No paid snapshots are available for this selection.</p>'}
    ${report.groups.map((group: any) => `<section><h2>${e(group.accountName)} · ${e(group.provider)} · ${e(group.currency)}</h2>
      <p>${e(group.timezone)} · ${e(group.attribution)}<br>Attribution fingerprint ${e(group.attributionFingerprint || 'unknown')}; observed action settings are preserved in CSV.
      <br>${e(group.attributionDetails?.actions ? 'Click windows: ' + [...new Set(group.attributionDetails.actions.map((a: any) => a.clickDays ?? 'unknown'))].join(', ') + ' days; view windows: ' + [...new Set(group.attributionDetails.actions.map((a: any) => a.viewDays ?? 'unknown'))].join(', ') + ' days' : '')}
      <br>Coverage: ${group.complete ? 'complete' : 'INCOMPLETE'}; previous: ${group.previousComplete ? 'complete' : 'INCOMPLETE'}.
      Freshness: ${group.fresh ? 'recent' : 'STALE / NOT SYNCHRONIZED'} · Last sync ${e(group.lastSync || 'never')}.</p>
      <table><thead><tr><th>Metric</th><th>Current</th><th>Previous</th><th>Change %</th></tr></thead><tbody>
      ${paidMetricNames.map((metric) => `<tr><td>${e(metric)}</td><td>${e(group.current[metric] ?? 'Unavailable')}</td><td>${e(group.previous[metric] ?? 'Unavailable')}</td><td>${e(group.changes[metric].percent ?? 'Unavailable')}</td></tr>`).join('')}</tbody></table>
      <p>Entity detail: first ${Math.min(100, group.entities.length)} of ${group.entities.length}; use CSV for all detail.</p>
      <table><thead><tr><th>Entity</th><th>Spend (${e(group.currency)})</th><th>Impressions</th><th>Clicks</th><th>Conversions</th><th>Purchase value</th></tr></thead><tbody>
      ${group.entities.slice(0, 100).map((entity: any) => `<tr><td>${e(entity.name)} (${e(entity.id)})</td><td>${e(entity.current.spend ?? 'Unavailable')}</td><td>${e(entity.current.impressions ?? 'Unavailable')}</td><td>${e(entity.current.clicks ?? 'Unavailable')}</td><td>${e(entity.current.conversions ?? 'Unavailable')}</td><td>${e(entity.current.purchaseValue ?? 'Unavailable')}</td></tr>`).join('')}</tbody></table></section>`).join('')}
    <h2>Definitions and limitations</h2>${Object.values(report.definitions).map((text) => `<p>${e(text)}</p>`).join('')}
    <p>No cross-provider/account/currency grand total. Unavailable is not zero. Conversion data may be delayed, modeled or subsequently adjusted by the provider.</p></body></html>`;
}
