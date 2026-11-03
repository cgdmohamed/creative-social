'use client';

import React, { FC, FormEvent, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';

type Workspace = {
  id: string;
  name: string;
  users: { role: 'SUPERADMIN' | 'ADMIN' | 'USER' }[];
};

export async function switchWorkspace(
  fetch: ReturnType<typeof useFetch>, id: string,
  navigate: (url: string) => void = (url) => window.location.assign(new URL(url, window.location.origin).href)
) {
  const response = await fetch('/user/change-org', {
    method: 'POST', body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error('Could not switch workspace. Your access may have changed.');
  // Full navigation discards all tenant-specific client caches and editor state.
  // Start at the dashboard instead of retaining a previous workspace's resource URL.
  navigate('/');
}

export const WorkspaceForm: FC<{
  current?: Workspace;
  onSaved: () => void;
}> = ({ current, onSaved }) => {
  const fetch = useFetch();
  const [name, setName] = useState(current?.name || '');
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Workspace>();
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      let workspace = created;
      if (!workspace) {
        const response = await fetch(current ? '/user/organizations/name' : '/user/organizations', {
          method: 'POST', body: JSON.stringify({ name: name.trim() }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(Array.isArray(body.message) ? body.message.join('. ') : body.message || 'Could not save workspace');
        }
        workspace = await response.json();
        if (!current) setCreated(workspace);
      }
      if (!current) await switchWorkspace(fetch, workspace!.id);
      else onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save workspace');
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label htmlFor="workspace-name">Workspace name</label>
      <input id="workspace-name" autoFocus required maxLength={80}
        value={name} disabled={pending || !!created}
        onChange={(event) => setName(event.target.value)}
        className="border border-tableBorder bg-transparent rounded p-2" />
      <p>Social accounts, content and team access belong to this workspace.</p>
      {created && <p>Workspace created. Retry switching below; your workspace will not be created again.</p>}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={pending || !name.trim()}>
        {pending ? 'Saving…' : created ? 'Switch to workspace' : current ? 'Save name' : 'Create Workspace'}
      </Button>
    </form>
  );
};

export const OrganizationSelector: FC<{ asOpenSelect?: boolean }> = ({ asOpenSelect }) => {
  const fetch = useFetch();
  const user = useUser();
  const modals = useModals();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const { data, error: loadError, mutate } = useSWR<Workspace[]>(
    ['organizations', user?.id], async () => {
      const response = await fetch('/user/organizations');
      if (!response.ok) throw new Error('Could not load workspaces');
      return response.json();
    }
  );
  const current = data?.find((workspace) => workspace.id === user?.orgId);
  const canManage = ['SUPERADMIN', 'ADMIN'].includes(current?.users[0]?.role || '');
  const openForm = (editing = false) => modals.openModal({
    title: editing ? 'Edit workspace name' : 'Create Workspace',
    children: (close) => <WorkspaceForm current={editing ? current : undefined}
      onSaved={() => { void mutate(); close(); }} />,
  });
  const change = async (id: string) => {
    setPending(true);
    setError('');
    try { await switchWorkspace(fetch, id); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not switch workspace'); }
    finally { setPending(false); }
  };
  return (
    <div className="relative max-w-[240px] text-sm">
      <details open={asOpenSelect}>
        <summary className="cursor-pointer truncate" aria-label="Workspace Switcher">
          Workspace: {current?.name || 'Select workspace'}
        </summary>
        <div className="absolute end-0 z-50 flex flex-col gap-3 p-4 min-w-[220px] max-w-[320px] bg-third border border-tableBorder">
          <label htmlFor="workspace-select">Switch workspace</label>
          <select id="workspace-select" value={current?.id || ''}
            disabled={pending || !data} className="bg-third"
            onChange={(event) => { void change(event.target.value); }}>
            {!current && <option value="" disabled>Select workspace</option>}
            {data?.map((workspace) => <option key={workspace.id} value={workspace.id}>
              {workspace.name} ({workspace.users[0]?.role})
            </option>)}
          </select>
          <button type="button" onClick={() => openForm()}>Create Workspace</button>
          {canManage && <>
            <button type="button" onClick={() => openForm(true)}>Edit workspace name</button>
            <a href="/settings?tab=teams">Manage members</a>
          </>}
          {(error || loadError) && <p role="alert">{error || 'Could not load workspaces'}</p>}
        </div>
      </details>
    </div>
  );
};
