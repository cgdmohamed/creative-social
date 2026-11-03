/** @jest-environment ./tests/reporting/dom.environment.cjs */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OrganizationSelector, WorkspaceForm, switchWorkspace } from '../../apps/frontend/src/components/layout/organization.selector';

const mockFetch = jest.fn();
const mockOpen = jest.fn();
let mockData: any[];
const mockMutate = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ id: 'alice', orgId: 'a' }) }));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({ useModals: () => ({ openModal: mockOpen }) }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: mockData, mutate: mockMutate }) }));
jest.mock('@gitroom/react/form/button', () => ({ Button: (props: any) => <button {...props} /> }));
beforeEach(() => {
  mockFetch.mockReset();
  mockOpen.mockReset();
  mockData = [{ id: 'a', name: 'Client A', users: [{ role: 'SUPERADMIN' }] }];
});
afterEach(cleanup);

test('switcher and creation action are available with a single workspace', () => {
  render(<OrganizationSelector />);
  expect(screen.getByLabelText('Workspace Switcher')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Workspace Switcher'));
  fireEvent.click(screen.getByText('Create Workspace'));
  expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Create Workspace' }));
  expect(screen.getByText('Manage members').getAttribute('href')).toBe('/settings?tab=teams');
});

test('ordinary members do not see rename or team management actions', () => {
  mockData[0].users[0].role = 'USER';
  render(<OrganizationSelector asOpenSelect />);
  expect(screen.queryByText('Edit workspace name')).toBeNull();
  expect(screen.queryByText('Manage members')).toBeNull();
  expect(screen.getByText('Create Workspace')).toBeTruthy();
});

test('failed switch never navigates; successful switch starts fresh at dashboard', async () => {
  const navigate = jest.fn();
  mockFetch.mockResolvedValueOnce({ ok: false });
  await expect(switchWorkspace(mockFetch, 'foreign', navigate)).rejects.toThrow();
  expect(navigate).not.toHaveBeenCalled();
  mockFetch.mockResolvedValueOnce({ ok: true });
  await switchWorkspace(mockFetch, 'b', navigate);
  expect(mockFetch).toHaveBeenLastCalledWith('/user/change-org', expect.objectContaining({ body: JSON.stringify({ id: 'b' }) }));
  expect(navigate).toHaveBeenCalledWith('/');
});

test('creation failure displays the API error without attempting to switch', async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Workspace ownership quota reached' }) });
  render(<WorkspaceForm onSaved={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'New client' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('quota'));
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('successful creation immediately attempts switching and retry does not create a duplicate', async () => {
  mockFetch.mockImplementation(async (url) => url === '/user/organizations'
    ? { ok: true, json: async () => ({ id: 'b', name: 'New client' }) }
    : { ok: false });
  render(<WorkspaceForm onSaved={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: ' New client ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('switch'));
  expect(mockFetch.mock.calls[0]).toEqual(['/user/organizations', expect.objectContaining({ body: JSON.stringify({ name: 'New client' }) })]);
  expect(mockFetch.mock.calls[1][0]).toBe('/user/change-org');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to workspace' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  expect(mockFetch.mock.calls.filter(([url]) => url === '/user/organizations')).toHaveLength(1);
});

test('rename uses current workspace endpoint and refreshes selector without switching', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'a', name: 'Renamed' }) });
  const saved = jest.fn();
  render(<WorkspaceForm current={mockData[0]} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mockFetch.mock.calls[0][0]).toBe('/user/organizations/name');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
