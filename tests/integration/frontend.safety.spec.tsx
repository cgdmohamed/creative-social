/** @jest-environment ./tests/reporting/dom.environment.cjs */
import React from 'react';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  renderHook,
} from '@testing-library/react';
import {
  FetchWrapperComponent,
  useFetch,
} from '../../libraries/helpers/src/utils/custom.fetch';
import {
  useMoveToIntegration,
  useMoveToIntegrationListener,
} from '../../apps/frontend/src/components/launches/helpers/use.move.to.integration';
import { PickPlatforms } from '../../apps/frontend/src/components/launches/helpers/pick.platform.component';
import { OAuthAuthorize } from '../../apps/frontend/src/components/oauth/authorize.component';
let mockSecured = true;
let mockSearch = new URLSearchParams(
  'client_id=a&response_type=code&redirect_uri=https%3A%2F%2Fa.invalid'
);
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ isSecured: mockSecured }),
}));
jest.mock('@copilotkit/react-core', () => ({
  useCopilotAction: () => {},
  useCopilotReadable: () => {},
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(async () => true),
}));
jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('next/navigation', () => ({ useSearchParams: () => mockSearch }));
jest.mock('@gitroom/frontend/components/new-layout/logo', () => ({
  Logo: () => null,
}));
jest.mock('@gitroom/frontend/components/oauth/self.hosted.component', () => ({
  OAuthSelfHosted: () => null,
}));
const mockNetwork = jest.fn();
const deferred = () => {
  let resolve: (value: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  return { promise, resolve: resolve! };
};
let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockNetwork;
  mockNetwork.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    headers: new Headers(),
  });
  mockSecured = true;
  mockSearch = new URLSearchParams(
    'client_id=a&response_type=code&redirect_uri=https%3A%2F%2Fa.invalid'
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function Consumer() {
  const fetch = useFetch();
  return <button onClick={() => void fetch('/inbox/channels')}>Request</button>;
}

test('fetch context uses updated backend/security mode and request hooks after rerender', async () => {
  const beforeRequest = jest.fn(async (_url, options) => options);
  const firstAfter = jest.fn(async () => true);
  const nextAfter = jest.fn(async () => true);
  const tree = (baseUrl: string, afterRequest: any) => (
    <FetchWrapperComponent
      baseUrl={baseUrl}
      beforeRequest={beforeRequest}
      afterRequest={afterRequest}
    >
      <Consumer />
    </FetchWrapperComponent>
  );
  const view = render(tree('/api-a', firstAfter));
  fireEvent.click(screen.getByText('Request'));
  await waitFor(() => expect(firstAfter).toHaveBeenCalledTimes(1));
  expect(mockNetwork.mock.calls[0][0]).toBe('/api-a/inbox/channels');
  expect(mockNetwork.mock.calls[0][1].credentials).toBe('include');
  mockSecured = false;
  view.rerender(tree('/api-b', nextAfter));
  fireEvent.click(screen.getByText('Request'));
  await waitFor(() => expect(nextAfter).toHaveBeenCalledTimes(1));
  expect(mockNetwork.mock.calls[1][0]).toBe('/api-b/inbox/channels');
  expect(mockNetwork.mock.calls[1][1].credentials).toBeUndefined();
  expect(firstAfter).toHaveBeenCalledTimes(1);
});

test('publishing event listener updates its callback, disables and cleans up without duplicate listeners', () => {
  const first = jest.fn(),
    second = jest.fn();
  const hook = renderHook(
    ({ enabled, callback }) => {
      useMoveToIntegrationListener(enabled, callback);
      return useMoveToIntegration();
    },
    { initialProps: { enabled: true, callback: first } }
  );
  act(() => hook.result.current({ identifier: 'channel-a' }));
  expect(first).toHaveBeenCalledTimes(1);
  hook.rerender({ enabled: true, callback: second });
  act(() => hook.result.current({ identifier: 'channel-b' }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledWith({
    identifier: 'channel-b',
    toPreview: undefined,
  });
  hook.rerender({ enabled: false, callback: second });
  act(() => hook.result.current({ identifier: 'disabled' }));
  expect(second).toHaveBeenCalledTimes(1);
  const emit = hook.result.current;
  hook.unmount();
  act(() => emit({ identifier: 'unmounted' }));
  expect(second).toHaveBeenCalledTimes(1);
});

test('OAuth consent cannot show an older app while authorizing a different request', async () => {
  const first = deferred(),
    second = deferred();
  mockNetwork.mockImplementation((url: string) =>
    url.includes('client_id=a') ? first.promise : second.promise
  );
  const view = render(
    <FetchWrapperComponent baseUrl="/api">
      <OAuthAuthorize logged />
    </FetchWrapperComponent>
  );
  await waitFor(() => expect(mockNetwork).toHaveBeenCalledTimes(1));
  mockSearch = new URLSearchParams(
    'client_id=b&response_type=code&redirect_uri=https%3A%2F%2Fb.invalid'
  );
  view.rerender(
    <FetchWrapperComponent baseUrl="/api">
      <OAuthAuthorize logged />
    </FetchWrapperComponent>
  );
  await waitFor(() => expect(mockNetwork).toHaveBeenCalledTimes(2));
  await act(async () => {
    first.resolve({
      status: 200,
      json: async () => ({ app: { name: 'Older app A' } }),
      headers: new Headers(),
    });
  });
  expect(screen.queryByText('Older app A')).toBeNull();
  expect(
    screen.queryByRole('button', { name: /authorize|approve/i })
  ).toBeNull();
  await act(async () => {
    second.resolve({
      status: 200,
      json: async () => ({ app: { name: 'Current app B' } }),
      headers: new Headers(),
    });
  });
  expect(await screen.findByText('Current app B')).toBeTruthy();
  expect(mockNetwork.mock.calls[0][1].signal.aborted).toBe(true);
});

test('invalid OAuth inputs show a validation error without calling the API', async () => {
  mockSearch = new URLSearchParams('client_id=a&response_type=token');
  render(
    <FetchWrapperComponent baseUrl="/api">
      <OAuthAuthorize logged />
    </FetchWrapperComponent>
  );
  expect(screen.getByText('Only response_type=code is supported')).toBeTruthy();
  expect(mockNetwork).not.toHaveBeenCalled();
});

test('single-channel composer preserves a selected channel across cloned objects and list refreshes', async () => {
  const channels: any[] = [
    { id: 'first', name: 'First client', identifier: 'facebook' },
    { id: 'selected', name: 'Selected client', identifier: 'facebook' },
  ];
  const change = jest.fn((_values, done) => done());
  const tree = (values: any[]) => (
    <PickPlatforms
      integrations={values}
      selectedIntegrations={[{ ...channels[1] }]}
      onChange={change}
      singleSelect
      isMain
    />
  );
  const view = render(tree(channels));
  await act(async () => {});
  expect(change).not.toHaveBeenCalled();
  view.rerender(tree(channels.map((channel) => ({ ...channel }))));
  await act(async () => {});
  expect(change).not.toHaveBeenCalled();
  view.rerender(tree([]));
  await act(async () => {});
  expect(change).not.toHaveBeenCalled();
});
