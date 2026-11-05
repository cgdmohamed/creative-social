'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

type Account = { id: string; externalAccountId?: string; name: string; currency: string; timezone: string;
  status?: string; providerStatus?: string; enabled?: boolean; selected?: boolean };
type Connection = { id: 'meta' | 'google'; configured: boolean; status: string; expiresAt?: string;
  lastError?: string; managementAuthorized?: boolean; accounts: Account[] };
async function result(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'The request did not go through. Try again, or reconnect the account.');
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
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The request did not go through. Try again.'); }
    finally { setBusy(false); }
  };
  const connect = (management = false) => action(async () => {
    if (management && !(await deleteDialog('Allow this workspace to manage your ad campaigns? Nothing is sent to the ad platform until an owner reviews and confirms each change. Reconnecting cancels earlier approvals, and you will need to choose your accounts again.', 'Allow management', 'Allow campaign management?', 'Cancel'))) return;
    const { url } = await result(await fetch(`/advertising/${connection.id}/authorize`, { method: 'POST', ...(management ? { body: JSON.stringify({ management: true }) } : {}) }));
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['www.facebook.com', 'accounts.google.com'].includes(target.hostname)) throw new Error('Could not open the sign-in page. Try again.');
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
    return action(async () => {
      if (revoke && !(await deleteDialog('Remove access for this ad account? This can also disconnect other workspaces or apps that use the same access. Your campaigns are not changed.', 'Remove access', 'Remove access?', 'Cancel', true))) return;
      const response = await result(await fetch(`/advertising/${connection.id}/disconnect`, { method: 'POST', body: JSON.stringify({ revoke }) }));
      setDiscovered(undefined); refresh();
      if (revoke && response.revocation !== 'CONFIRMED') setError('Disconnected from this workspace. Access could not be removed on the ad platform. Remove it in your ad platform settings.');
    });
  };
  const title = connection.id === 'meta' ? 'Meta Ads' : 'Google Ads';
  return <section aria-label={title} className="flex flex-col gap-4 bg-sixth border border-fifth rounded-[4px] text-textColor p-[24px]">
    <h3>{title}</h3>
    <p>Status: {connection.status}{connection.expiresAt ? ` · Access expires: ${new Date(connection.expiresAt).toLocaleString()}` : ''}</p>
    <p>Campaign management: {connection.managementAuthorized ? 'Allowed' : 'Not allowed. You can view results only. Allow campaign management to create or change campaigns.'}</p>
    {connection.lastError && <p>Last connection issue: {connection.lastError}</p>}
    {!connection.configured && <p>This connection is not set up yet. Ask your administrator to set it up.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || !connection.configured} onClick={() => connect()}>
        {connection.status === 'DISCONNECTED' ? 'Connect' : 'Reconnect'} {title}
      </Button>
      <Button type="button" disabled={busy || !connection.configured} onClick={() => connect(true)}>Allow {title} campaign management</Button>
      {['CONNECTED', 'EXPIRED'].includes(connection.status) && <Button type="button" disabled={busy} onClick={discover}>Find accounts</Button>}
      {connection.status !== 'DISCONNECTED' && <>
        <Button type="button" disabled={busy} onClick={() => disconnect(false)}>Disconnect</Button>
        <Button type="button" disabled={busy} onClick={() => disconnect(true)}>Disconnect and remove access</Button>
      </>}
    </div>
    {error && <p role="alert">{error}</p>}
    {discovered && <>
      <p>Choose the accounts to use in this workspace. Saving replaces your current selection and checks access again.</p>
      {!discovered.length && <p>No advertising accounts were found. Check that you have access to an account on the ad platform.</p>}
      {discovered.map((account) => <label key={account.id} className="flex gap-2">
        <input type="checkbox" disabled={busy || account.status !== 'ENABLED'} checked={selected.includes(account.id)}
          onChange={(event) => setSelected(event.target.checked ? [...selected, account.id] : selected.filter((id) => id !== account.id))} />
        <span>{account.name} · {account.id} · {account.currency} · {account.timezone} · {account.status}</span>
      </label>)}
      <Button type="button" disabled={busy} onClick={save}>Save accounts</Button>
    </>}
    {!!connection.accounts.length && <div className="overflow-x-auto"><table>
      <caption>Workspace advertising accounts</caption>
      <thead><tr><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Name</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Account ID</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Currency</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Timezone</th><th className="border-b border-fifth p-3 text-left text-sm font-semibold">Status</th></tr></thead>
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
  if (!manager) return <p>Only workspace administrators can manage advertising connections.</p>;
  return <div className="flex flex-col gap-[24px] text-textColor">
    <h2>Advertising Accounts</h2>
    <p>Connect Meta Ads and Google Ads to see paid results in this workspace. These connections are separate from your social channels. Connecting does not create or change any campaigns.</p>
    <p>When you connect Google, it asks for general access to Google Ads. To keep access limited, sign in with a Google Ads user that has read-only access.</p>
    {error && <p role="alert">Could not load your advertising connections. Refresh the page and try again.</p>}
    {!data && !error && <p>Loading advertising connections…</p>}
    {data?.map((connection) => <ProviderAccounts key={`${user?.orgId}:${connection.id}`} connection={connection} refresh={() => { void mutate(); }} />)}
  </div>;
};
