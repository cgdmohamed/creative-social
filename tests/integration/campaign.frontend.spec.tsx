/** @jest-environment ./tests/reporting/dom.environment.cjs */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CampaignManager, CampaignPreview } from '../../apps/frontend/src/components/advertising/campaign-manager';
import { campaignAccount, campaignSpecification } from './campaign.fixture';
const mockFetch = jest.fn(), mockReload = jest.fn();
let mockRole: string, mockOrg: string, mockData: any;
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ id: 'alice', orgId: mockOrg, role: mockRole }) }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: mockData, mutate: mockReload }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('@gitroom/react/form/button', () => ({ Button: (props: any) => <button {...props} /> }));
beforeEach(() => {
  mockFetch.mockReset(); mockReload.mockReset(); mockRole = 'SUPERADMIN'; mockOrg = 'a';
  mockData = { accounts: [campaignAccount], drafts: [], reviews: [], media: [], history: [], objectives: { META_ADS: ['OUTCOME_TRAFFIC'], GOOGLE_ADS: ['SEARCH'] } };
});
afterEach(() => cleanup());
test('advertising navigation exposes all sections and makes disabled live writes explicit', () => {
  render(<CampaignManager />);
  for (const label of ['Campaigns', 'Ad Sets / Ad Groups', 'Ads', 'Creative Library', 'Drafts', 'Campaign Builder', 'Approval Queue', 'Change History']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
  expect(screen.getByText(/Live provider submissions and changes are disabled/)).toBeTruthy(); expect(mockFetch).not.toHaveBeenCalled();
});
test('read-only users cannot create drafts or approve reviews', () => {
  mockRole = 'USER'; render(<CampaignManager />); fireEvent.click(screen.getByRole('button', { name: 'Campaign Builder' }));
  expect(screen.getByText('Workspace administrators can create and edit drafts.')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
});
test('creative preview escapes text and never runs ad markup or loads arbitrary media', () => {
  const { container } = render(<CampaignPreview name="Preview" spec={{ ...campaignSpecification(), headlines: ['<script>alert(1)</script>'], mediaId: 'asset-1' }} />);
  expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('img')).toBeNull(); expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
});
test('provider refresh is an explicit read and performance links keep account/campaign scope', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ fetchedAt: '2026-11-04', rows: [{ id: '123', campaignId: '123', name: 'Campaign', status: 'PAUSED', approval: 'PENDING_REVIEW', validationErrors: [] }] }) });
  render(<CampaignManager />); fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'account-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh provider list' }));
  await waitFor(() => expect(screen.getByText('PENDING_REVIEW')).toBeTruthy());
  expect(mockFetch.mock.calls[0][0]).toContain('accountId=account-a&level=CAMPAIGN'); expect(screen.getByRole('link', { name: 'View performance' }).getAttribute('href')).toContain('campaignId=123');
});
test('workspace changes clear previous workspace resources and draft editor state', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ fetchedAt: '', rows: [{ id: '1', campaignId: '1', name: 'Private campaign A', status: 'PAUSED', approval: 'UNKNOWN', validationErrors: [] }] }) });
  const { rerender } = render(<CampaignManager />); fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'account-a' } }); fireEvent.click(screen.getByRole('button', { name: 'Refresh provider list' }));
  await waitFor(() => expect(screen.getByText('Private campaign A')).toBeTruthy()); mockOrg = 'b'; mockData = { ...mockData, accounts: [] }; rerender(<CampaignManager />);
  expect(screen.queryByText('Private campaign A')).toBeNull(); expect((screen.getByLabelText('Advertising account') as HTMLSelectElement).value).toBe('');
});
test('final review requires exact typed confirmation before approval button is enabled', async () => {
  mockData.reviews = [{ id: 'review-a', status: 'PENDING', expiresAt: '2027-01-01', digest: 'abc', snapshot: { name: 'Client A review', account: campaignAccount, spec: campaignSpecification(), plan: { blockers: [] }, confirmation: 'CREATE act_123 USD 12.34/day schedule' } }];
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'APPROVED_BLOCKED' }) });
  render(<CampaignManager />); fireEvent.click(screen.getByRole('button', { name: 'Approval Queue' }));
  const button = screen.getByRole('button', { name: 'Approve intent · no provider submission' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true); fireEvent.change(screen.getByLabelText('Final campaign confirmation'), { target: { value: 'yes' } }); expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Final campaign confirmation'), { target: { value: mockData.reviews[0].snapshot.confirmation } }); expect(button.disabled).toBe(false); fireEvent.click(button);
  await waitFor(() => expect(mockFetch).toHaveBeenCalled()); expect(mockFetch.mock.calls[0][0]).toBe('/campaign-manager/reviews/review-a/approve'); expect(mockFetch.mock.calls.some(([url]) => url.includes('/submit'))).toBe(false);
});
test('retrying a failed draft save reuses its creation key and never submits a provider request', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Temporary storage failure' }) }).mockResolvedValueOnce({ ok: true,
    json: async () => ({ id: 'draft-a', accountId: 'account-a', name: 'New campaign', revision: 0, creationKey: 'stable-key-1234567', spec: campaignSpecification() }) });
  render(<CampaignManager />); fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'account-a' } }); fireEvent.click(screen.getByRole('button', { name: 'Campaign Builder' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Temporary storage failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); await waitFor(() => expect(screen.getByRole('status').textContent).toContain('No provider campaign was changed'));
  expect(mockFetch.mock.calls).toHaveLength(2); const bodies = mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(bodies[0].key).toHaveLength(32); expect(bodies[0].key).toBe(bodies[1].key); expect(bodies[0].spec.operation).toBe('CREATE');
  expect(mockFetch.mock.calls.every(([url]) => url === '/campaign-manager/drafts')).toBe(true);
});

test('duplicate retries reuse one idempotency key after an ambiguous response failure', async () => {
  mockData.drafts = [{ id: 'draft-a', accountId: 'account-a', revision: 1, name: 'First draft', creationKey: 'original', spec: campaignSpecification(), status: 'DRAFT' }];
  mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Network outcome unknown' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'copy-a' }) });
  render(<CampaignManager />);
  fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate draft' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network outcome unknown'));
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate draft' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  const requests = mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(requests[0].key).toHaveLength(32);
  expect(requests[1].key).toBe(requests[0].key);
});

test('late save response cannot overwrite an editor reset to another account', async () => {
  let complete!: (value: any) => void;
  mockData.accounts = [campaignAccount, { ...campaignAccount, id: 'account-b', name: 'Another account', currency: 'EUR' }];
  mockFetch.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  render(<CampaignManager />);
  fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'account-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Campaign Builder' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'account-b' } });
  complete({ ok: true, json: async () => ({ id: 'old-draft', accountId: 'account-a', revision: 1, creationKey: 'old', name: 'Old campaign', spec: campaignSpecification() }) });
  await waitFor(() => expect(mockReload).toHaveBeenCalled());
  expect((screen.getByLabelText('Advertising account') as HTMLSelectElement).value).toBe('account-b');
  expect(screen.getByText('Create draft')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Campaign Builder' }).getAttribute('aria-pressed')).toBe('true');
});
