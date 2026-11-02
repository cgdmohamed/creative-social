/** @jest-environment ./tests/reporting/dom.environment.cjs */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Reports } from '../../apps/frontend/src/components/reporting/reports';
const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
let options: any;
beforeEach(() => {
  options = {
    clients: [{ id: 'client-a', name: 'Client A' }],
    channels: [
      {
        id: 'channel',
        name: 'Historical channel',
        provider: 'youtube',
        customerId: 'client-a',
        supported: true,
      },
    ],
    campaigns: [],
    collectionEnabled: true,
    pdfEnabled: false,
  };
  mockFetch.mockReset().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.startsWith('/reports/options')
        ? options
        : {
            name: 'Test report',
            metrics: [],
            channels: [],
            collection: [],
            warnings: [],
            from: '2026-10-01',
            to: '2026-10-31',
            previousFrom: '2026-09-01',
            previousTo: '2026-09-30',
          },
  }));
});
test('client filters reach the reporting API and operator capability flags update the UI', async () => {
  render(React.createElement(Reports));
  await screen.findByText('Historical channel');
  expect(
    (
      screen.getByRole('button', {
        name: 'Collect recent data',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  fireEvent.change(screen.getByLabelText('Client'), {
    target: { value: 'client-a' },
  });
  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/reports/options?customerId=client-a',
      undefined
    )
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Build report',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Build report' }));
  await screen.findByRole('heading', { name: 'Test report' });
  expect(
    mockFetch.mock.calls.some(
      ([url]) =>
        String(url).startsWith('/reports/organic?') &&
        String(url).includes('customerId=client-a')
    )
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'PDF report' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
test('read-only reporting remains available when live collection is disabled', async () => {
  options.collectionEnabled = false;
  render(React.createElement(Reports));
  await screen.findByText('Historical channel');
  expect(
    (
      screen.getByRole('button', {
        name: 'Collect recent data',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Build report' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
  expect(
    screen.getByText(/Collection is disabled on this server/)
  ).toBeTruthy();
});
test('unassigned history remains selectable after current ownership changes', async () => {
  render(React.createElement(Reports));
  await screen.findByText('Historical channel');
  options = {
    ...options,
    channels: [
      {
        id: 'former',
        name: 'Former unassigned channel',
        provider: 'youtube',
        customerId: 'new-client',
        supported: false,
      },
    ],
  };
  fireEvent.change(screen.getByLabelText('Client'), {
    target: { value: '__unassigned' },
  });
  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/reports/options?customerId=__unassigned',
      undefined
    )
  );
  expect(await screen.findByText('Former unassigned channel')).toBeTruthy();
});
