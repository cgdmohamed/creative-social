/** @jest-environment ./tests/reporting/dom.environment.cjs */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AdvertisingAccounts } from '../../apps/frontend/src/components/settings/advertising.accounts';
import { AdvertisingCallback } from '../../apps/frontend/src/components/settings/advertising.callback';

const mockFetch = jest.fn(), mockMutate = jest.fn();
let mockRole: string, mockData: any[];
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ id: 'alice', orgId: 'a', role: mockRole }) }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: mockData, mutate: mockMutate }) }));
jest.mock('@gitroom/react/form/button', () => ({ Button: (props: any) => <button {...props} /> }));
jest.mock('next/link', () => ({ __esModule: true, default: (props: any) => <a {...props} /> }));
const ok = (body: any) => ({ ok: true, json: async () => body });
beforeEach(() => {
  mockFetch.mockReset(); mockMutate.mockReset(); mockRole = 'ADMIN';
  mockData = [{ id: 'google', configured: true, status: 'CONNECTED', accounts: [
    { id: 'local', externalAccountId: '123', name: 'Client A', currency: 'USD', timezone: 'Asia/Riyadh', enabled: true, providerStatus: 'ENABLED' },
  ] }];
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('management shows account metadata and distinguishes advertising from organic accounts', () => {
  render(<AdvertisingAccounts />);
  expect(screen.getByText('Advertising Accounts')).toBeTruthy();
  expect(screen.getByText('Client A')).toBeTruthy(); expect(screen.getByText('123')).toBeTruthy();
  expect(screen.getByText('USD')).toBeTruthy(); expect(screen.getByText('Asia/Riyadh')).toBeTruthy();
  expect(screen.getByText(/separate from organic/)).toBeTruthy();
});
test('ordinary workspace members cannot see account data or management controls', () => {
  mockRole = 'USER'; render(<AdvertisingAccounts />);
  expect(screen.getByText(/administrator access required/)).toBeTruthy();
  expect(screen.queryByText('Client A')).toBeNull(); expect(screen.queryByText('Discover accounts')).toBeNull();
});
test('unconfigured providers cannot start authorization', () => {
  mockData[0] = { id: 'meta', configured: false, status: 'DISCONNECTED', accounts: [] };
  render(<AdvertisingAccounts />);
  expect((screen.getByRole('button', { name: 'Connect Meta Ads' }) as HTMLButtonElement).disabled).toBe(true);
});
test('discover and select multiple accounts submits only provider IDs', async () => {
  mockFetch.mockImplementation(async (url) => url.endsWith('/discover') ? ok([
    { id: '123', name: 'Client A', currency: 'USD', timezone: 'UTC', status: 'ENABLED', selected: true },
    { id: '456', name: 'Client B', currency: 'EUR', timezone: 'Europe/Paris', status: 'ENABLED', selected: false },
  ]) : ok({ selected: 2 }));
  render(<AdvertisingAccounts />); fireEvent.click(screen.getByText('Discover accounts'));
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  fireEvent.click(screen.getByText('Save selected accounts'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/advertising/google/accounts', expect.objectContaining({ body: JSON.stringify({ accountIds: ['123', '456'] }) })));
  expect(mockMutate).toHaveBeenCalled();
});
test('rate-limited discovery displays safe error without exposing account selections', async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Advertising provider: RATE_LIMITED' }) });
  render(<AdvertisingAccounts />); fireEvent.click(screen.getByText('Discover accounts'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('RATE_LIMITED'));
  expect(screen.queryByText('Save selected accounts')).toBeNull();
});
test('local disconnect is separate from explicit provider-wide revocation', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  mockFetch.mockResolvedValue(ok({ disconnected: true, revocation: 'NOT_REQUESTED' }));
  render(<AdvertisingAccounts />); fireEvent.click(screen.getByText('Disconnect and revoke grant'));
  expect(confirm).toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Disconnect locally'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/advertising/google/disconnect', expect.objectContaining({ body: JSON.stringify({ revoke: false }) })));
});
test('unconfirmed revocation explains local disconnect without claiming remote success', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  mockFetch.mockResolvedValue(ok({ disconnected: true, revocation: 'UNCONFIRMED' }));
  render(<AdvertisingAccounts />); fireEvent.click(screen.getByText('Disconnect and revoke grant'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not confirmed'));
});
test('callback strips code/state from browser history and submits exactly once in StrictMode', async () => {
  window.history.replaceState(null, '', '/settings/advertising/callback/google?code=private&state=nonce');
  mockFetch.mockResolvedValue(ok({ connected: true }));
  render(<React.StrictMode><AdvertisingCallback provider="google" state="nonce" code="private" /></React.StrictMode>);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Connected.'));
  expect(window.location.search).toBe(''); expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith('/advertising/google/callback', expect.objectContaining({ body: JSON.stringify({ state: 'nonce', code: 'private' }) }));
  expect(screen.getByText('Return to Advertising Accounts').getAttribute('href')).toBe('/settings?tab=advertising');
});
test('invalid and failed callbacks prompt reconnection without showing provider error details', async () => {
  const { unmount } = render(<AdvertisingCallback provider="unknown" state="nonce" code="private" />);
  expect(screen.getByRole('status').textContent).toContain('invalid'); expect(mockFetch).not.toHaveBeenCalled();
  unmount(); mockFetch.mockResolvedValue({ ok: false });
  render(<AdvertisingCallback provider="meta" state="nonce" error="private-provider-error" />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('could not be completed'));
  expect(screen.queryByText('private-provider-error')).toBeNull();
});
