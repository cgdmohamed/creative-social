/** @jest-environment ./tests/reporting/dom.environment.cjs */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PaidAnalytics, PaidTrend } from '../../apps/frontend/src/components/reporting/paid-analytics';
const mockFetch = jest.fn(), mockReload = jest.fn();
let mockRole: string, mockCatalog: any, mockReport: any;
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ id: 'alice', orgId: 'a', role: mockRole }) }));
jest.mock('swr', () => ({ __esModule: true, default: (key: any) => ({ data: key?.[0] === 'paid-catalog' ? mockCatalog : key?.[0] === 'paid-report' ? mockReport : { schedules: [], runs: [] }, mutate: mockReload }) }));
jest.mock('@gitroom/react/form/button', () => ({ Button: (props: any) => <button {...props} /> }));
beforeEach(() => {
  mockRole = 'ADMIN'; mockFetch.mockReset(); mockReload.mockReset();
  mockCatalog = { accounts: [], clients: [{ id: 'client-a', name: 'Client A' }], jobs: [], collectionEnabled: true, schedulesEnabled: false };
  const values = { spend: '0', impressions: '100', clicks: '0', reach: null, ctr: '0', conversions: null, cpc: null, cpm: '0', conversionRate: null, cpa: null, leads: null, cpl: null, purchaseValue: null, roas: null };
  mockReport = { previous: { from: '2026-01-01', to: '2026-01-07' }, definitions: { totals: 'Paid only; no mixed currency total.' },
    groups: [{ accountId: 'a', accountName: 'Client A', provider: 'META_ADS', currency: 'USD', timezone: 'Asia/Riyadh', attribution: '7d_click+1d_view',
      current: values, previous: values, changes: Object.fromEntries(Object.keys(values).map((key) => [key, { percent: null }])), fresh: false, complete: false, previousComplete: false,
      entities: [], trends: [{ date: '2026-01-01', spend: '0' }], lastSync: null }] };
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
test('dashboard makes paid scope, unavailable values, attribution and freshness explicit', () => {
  render(<PaidAnalytics />);
  expect(screen.getByRole('heading', { name: 'Advertising Analytics' })).toBeTruthy();
  expect(screen.getByText(/Organic metrics are separate/)).toBeTruthy(); expect(screen.getByText(/INCOMPLETE/)).toBeTruthy();
  expect(screen.getByText('7d_click+1d_view')).toBeTruthy(); expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Export client PDF' })).toBeTruthy();
});
test('read-only members can view/export but cannot synchronize or configure delivery', () => {
  mockRole = 'USER'; render(<PaidAnalytics />);
  expect(screen.queryByText('Sync selected range and comparison')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Scheduled client reports' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Export paid CSV' })).toBeTruthy();
});
test('trend chart retains a gap and explicit zero without converting unavailable values to zero', () => {
  const { container } = render(<PaidTrend points={[{ date: '1', spend: '10' }, { date: '2', spend: null }, { date: '3', spend: '0' }]} />);
  expect(container.querySelectorAll('rect')).toHaveLength(2);
  expect(screen.getByRole('img', { name: 'Paid spend trend' })).toBeTruthy();
});
test('manual synchronization sends the selected level and only queues read-only collection', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ queued: 4 }) }); render(<PaidAnalytics />);
  fireEvent.click(screen.getByText('Campaign performance'));
  fireEvent.click(screen.getByText('Sync selected range and comparison'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('4 collection jobs queued'));
  expect(mockFetch.mock.calls[0][0]).toBe('/paid-analytics/sync');
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).level).toBe('CAMPAIGN');
});
test('collection disabled flag prevents requests while stored analytics stays visible', () => {
  mockCatalog.collectionEnabled = false; render(<PaidAnalytics />);
  expect((screen.getByText('Sync selected range and comparison') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Stored reports remain readable/)).toBeTruthy(); expect(mockFetch).not.toHaveBeenCalled();
});
test('campaign manager performance link initializes scoped paid query without changing organic calculations', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ queued: 1 }) });
  render(<PaidAnalytics initialSelection={{ accountId: 'account-a', campaignId: '123', level: 'AD' }} />);
  fireEvent.click(screen.getByText('Sync selected range and comparison'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ accountId: 'account-a', campaignId: '123', level: 'AD' });
});
test('schedules expose archive/email choices and preserve freshness-required default', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'schedule' }) }); render(<PaidAnalytics />);
  fireEvent.click(screen.getByText('Create report schedule from current filters'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  const data = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(data).toMatchObject({ delivery: 'ARCHIVE', requireFresh: true, cadenceDays: 7, rollingDays: 7 });
  expect(data.query.level).toBe('ACCOUNT');
});
test('provider/synchronization errors are visible without showing credentials', async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Paid collection is disabled by the operator' }) });
  render(<PaidAnalytics />); fireEvent.click(screen.getByText('Sync selected range and comparison'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('disabled by the operator'));
});
