'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';

type Account = { id: string; externalAccountId?: string; name: string; currency: string; timezone: string;
  status?: string; providerStatus?: string; enabled?: boolean; selected?: boolean };
type Connection = { id: 'meta' | 'google'; configured: boolean; status: string; expiresAt?: string;
  lastError?: string; managementAuthorized?: boolean; accounts: Account[] };
async function result(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'Advertising request failed. Please retry or reconnect.');
  return body;
}

const ProviderAccounts = ({ connection, refresh }: { connection: Connection; refresh: () => void }) => {
  const fetch = useFetch();
  const [discovered, setDiscovered] = useState<Account[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Advertising request failed'); }
    finally { setBusy(false); }
  };
  const connect = (management = false) => action(async () => {
    if (management && !window.confirm('Authorize advertising management for this workspace? Provider writes still require operator enablement, owner review and explicit final submission. Reconnecting invalidates older approvals and requires account reselection.')) return;
    const { url } = await result(await fetch(`/advertising/${connection.id}/authorize`, { method: 'POST', ...(management ? { body: JSON.stringify({ management: true }) } : {}) }));
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['www.facebook.com', 'accounts.google.com'].includes(target.hostname)) throw new Error('Invalid authorization destination');
    window.location.assign(target.href);
  });
  const discover = () => action(async () => {
    const accounts: Account[] = await result(await fetch(`/advertising/${connection.id}/discover`, { method: 'POST' }));
    setDiscovered(accounts);
    setSelected(accounts.filter((a) => a.selected && a.status === 'ENABLED').map((a) => a.id));
    refresh();
  });
  const save = () => action(async () => {
    await result(await fetch(`/advertising/${connection.id}/accounts`, { method: 'POST', body: JSON.stringify({ accountIds: selected }) }));
    setDiscovered(undefined); refresh();
  });
  const disconnect = (revoke: boolean) => {
    if (revoke && !window.confirm('Revoke this provider grant? Provider revocation can also disconnect other workspaces or apps sharing this authorization. Campaigns will not be modified.')) return;
    return action(async () => {
      const response = await result(await fetch(`/advertising/${connection.id}/disconnect`, { method: 'POST', body: JSON.stringify({ revoke }) }));
      setDiscovered(undefined); refresh();
      if (revoke && response.revocation !== 'CONFIRMED') setError('Disconnected locally. Provider revocation was not confirmed; remove access in your provider settings.');
    });
  };
  const title = connection.id === 'meta' ? 'Meta Ads' : 'Google Ads';
  return <section aria-label={title} className="flex flex-col gap-4 bg-sixth border border-fifth rounded-[4px] text-textColor p-[24px]">
    <h3>{title}</h3>
    <p>Status: {connection.status}{connection.expiresAt ? ` · Token expiry: ${new Date(connection.expiresAt).toLocaleString()}` : ''}</p>
    <p>Workspace campaign management consent: {connection.managementAuthorized ? 'Authorized' : 'Read-only; explicit management authorization required for writes'}</p>
    {connection.lastError && <p>Last connection issue: {connection.lastError}</p>}
    {!connection.configured && <p>This provider has not been configured by the server administrator.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || !connection.configured} onClick={() => connect()}>
        {connection.status === 'DISCONNECTED' ? 'Connect' : 'Reconnect'} {title}
      </Button>
      <Button type="button" disabled={busy || !connection.configured} onClick={() => connect(true)}>Authorize {title} campaign management</Button>
      {['CONNECTED', 'EXPIRED'].includes(connection.status) && <Button type="button" disabled={busy} onClick={discover}>Discover accounts</Button>}
      {connection.status !== 'DISCONNECTED' && <>
        <Button type="button" disabled={busy} onClick={() => disconnect(false)}>Disconnect locally</Button>
        <Button type="button" disabled={busy} onClick={() => disconnect(true)}>Disconnect and revoke grant</Button>
      </>}
    </div>
    {error && <p role="alert">{error}</p>}
    {discovered && <>
      <p>Select accounts for this workspace. Saving replaces the selected set and rechecks access with the provider.</p>
      {!discovered.length && <p>No accessible advertising accounts were returned.</p>}
      {discovered.map((account) => <label key={account.id} className="flex gap-2">
        <input type="checkbox" disabled={busy || account.status !== 'ENABLED'} checked={selected.includes(account.id)}
          onChange={(event) => setSelected(event.target.checked ? [...selected, account.id] : selected.filter((id) => id !== account.id))} />
        <span>{account.name} · {account.id} · {account.currency} · {account.timezone} · {account.status}</span>
      </label>)}
      <Button type="button" disabled={busy} onClick={save}>Save selected accounts</Button>
    </>}
    {!!connection.accounts.length && <div className="overflow-x-auto"><table>
      <caption>Workspace advertising accounts</caption>
      <thead><tr><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Name</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Account ID</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Currency</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Timezone</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Selection / availability</th></tr></thead>
      <tbody>{connection.accounts.map((account) => <tr key={account.id}>
        <td className="border-b border-fifth p-3 align-top text-sm">{account.name}</td><td className="border-b border-fifth p-3 align-top text-sm">{account.externalAccountId}</td><td className="border-b border-fifth p-3 align-top text-sm">{account.currency}</td><td className="border-b border-fifth p-3 align-top text-sm">{account.timezone}</td>
        <td className="border-b border-fifth p-3 align-top text-sm">{account.enabled ? 'Selected' : 'Not selected'} · {account.providerStatus}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
};

export const AdvertisingAccounts = () => {
  const fetch = useFetch();
  const user = useUser();
  const manager = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const { data, error, mutate } = useSWR<Connection[]>(manager ? ['advertising', user?.orgId] : null,
    async () => result(await fetch('/advertising')), { revalidateOnFocus: false });
  if (!manager) return <p>Workspace administrator access required.</p>;
  return <div className="flex flex-col gap-[24px] text-textColor">
    <h2>Advertising Accounts</h2>
    <p>Read-only advertising access for this workspace. These connections are separate from organic social accounts. No campaigns are created or changed.</p>
    <p>Google uses its general Ads OAuth scope; use a Google Ads user with a read-only account role. Prefer dedicated advertising developer apps.</p>
    {error && <p role="alert">Could not load advertising connections.</p>}
    {!data && !error && <p>Loading advertising connections…</p>}
    {data?.map((connection) => <ProviderAccounts key={`${user?.orgId}:${connection.id}`} connection={connection} refresh={() => { void mutate(); }} />)}
  </div>;
};
