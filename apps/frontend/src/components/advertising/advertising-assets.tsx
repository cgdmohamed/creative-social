'use client';
import React, { useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
export const AdvertisingAssets = ({ account, enabled, selected, onSelect, media = [], onChoosePage, onChooseImage }: any) => {
  const fetch = useFetch(), user = useUser(), [file, setFile] = useState<File>(), [pending, setPending] = useState(false), [error, setError] = useState('');
  const key = useRef(''), [discovery, setDiscovery] = useState<any>();
  const [mediaId, setMediaId] = useState(''), mediaKey = useRef('');
  const importKeys = useRef(new Map<string, string>());
  const read = async (response: Response) => { const body = await response.json(); if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'Advertising asset request failed'); return body; };
  const { data, mutate } = useSWR(account ? ['advertising-assets', user?.orgId, account.id] : null, () => fetch(`/campaign-manager/assets/${account.id}`).then(read), { revalidateOnFocus: false });
  const action = async (operation: () => Promise<void>) => { setPending(true); setError(''); try { await operation(); await mutate(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Asset request failed'); } finally { setPending(false); } };
  const importAsset = (providerId: string, kind: string) => action(async () => {
    let attempt = importKeys.current.get(providerId);
    if (!attempt) { attempt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''); importKeys.current.set(providerId, attempt); }
    await read(await fetch('/campaign-manager/assets/import', { method: 'POST', body: JSON.stringify({ accountId: account.id, providerId, kind, key: attempt }) }));
    importKeys.current.delete(providerId);
  });
  if (!account) return <p>Select an advertising account to manage its creative assets.</p>;
  return <section className="bg-sixth border border-fifth rounded-[4px] text-textColor p-[24px] space-y-4"><h3>Advertising assets · {account.name}</h3>
    <p>Uploads go to this provider account. Meta videos must finish processing before use. Google Search accepts image assets; Google binary video upload is not available.</p>
    <Button type="button" disabled={pending || !account.enabled} onClick={() => action(async () => { setDiscovery(await read(await fetch(`/campaign-manager/assets/${account.id}?discover=true`))); })}>Discover provider assets and Pages</Button>
    {user?.role === 'SUPERADMIN' && <div><label>Advertising image/video<input type="file" accept={account.provider === 'META_ADS' ? 'image/jpeg,image/png,image/webp,video/mp4' : 'image/jpeg,image/png,image/webp'} onChange={(e) => { setFile(e.target.files?.[0]); key.current = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''); }} /></label>
      <Button type="button" disabled={!file || pending || !enabled || !account.enabled} onClick={() => action(async () => {
        if (!file || !window.confirm(`Upload ${file.name} to ${account.name} (${account.externalAccountId})? This creates a provider asset and does not publish an ad.`)) return;
        const body = new FormData(); body.set('accountId', account.id); body.set('key', key.current); body.set('name', file.name.slice(0, 100)); body.set('file', file);
        const result = await read(await fetch('/campaign-manager/assets/upload', { method: 'POST', body }));
        if (['UNKNOWN', 'SENDING', 'REJECTED'].includes(result.status)) setError(`Asset ${result.status}: ${result.error?.code || 'Use refresh/reconcile before another upload.'}`);
      })}>Upload advertising asset</Button>{!enabled && <p>Operator advertising execution is not enabled.</p>}</div>}
    {user?.role === 'SUPERADMIN' && <div><label>Existing workspace Media<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" value={mediaId} onChange={(e) => { setMediaId(e.target.value); mediaKey.current = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''); }}><option value="">Select an owned image/video</option>{media.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</select></label>
      <Button type="button" disabled={!mediaId || !enabled || pending || !account.enabled} onClick={() => action(async () => {
        if (!window.confirm(`Upload the selected workspace media to ${account.name} (${account.externalAccountId})? This creates a provider asset, not an advertisement.`)) return;
        const result = await read(await fetch('/campaign-manager/assets/from-media', { method: 'POST', body: JSON.stringify({ accountId: account.id, mediaId, key: mediaKey.current }) }));
        if (['UNKNOWN', 'SENDING', 'REJECTED'].includes(result.status)) setError(`Asset ${result.status}: ${result.error?.code || 'Refresh/reconcile before another upload.'}`);
      })}>Upload selected workspace media to provider</Button></div>}
    {error && <p role="alert">{error}</p>}
    {onSelect && <label>Ready advertising asset<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" value={selected || ''} onChange={(e) => onSelect(e.target.value)}><option value="">None / select existing provider image hash</option>{data?.assets?.filter((asset: any) => asset.status === 'READY').map((asset: any) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.kind}</option>)}</select></label>}
    {data?.assets?.map((asset: any) => <div key={asset.id}>{asset.name} · {asset.kind} · {asset.status} · {asset.providerId || 'Provider ID unconfirmed'}
      {asset.error && <span> · {asset.error.code}</span>}<button type="button" disabled={pending} onClick={() => action(async () => { await read(await fetch(`/campaign-manager/assets/${asset.id}/refresh`, { method: 'POST', body: '{}' })); })}>Refresh / reconcile asset</button></div>)}
    {discovery && <details open><summary>Provider-owned Pages and assets</summary><p>Only assets returned by this advertising account can be used. Image hashes and Page IDs below may be selected in the campaign builder.</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(discovery, null, 2)}</pre></details>}
    {discovery?.pages && onChoosePage && <label>Provider-eligible Page<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" defaultValue="" onChange={(e) => { if (e.target.value) onChoosePage(e.target.value); }}><option value="">Select Page</option>{discovery.pages.map((page: any) => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}</select></label>}
    {discovery?.images && onChooseImage && <label>Existing provider image<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" defaultValue="" onChange={(e) => { if (e.target.value) onChooseImage(e.target.value); }}><option value="">Select image</option>{discovery.images.map((image: any) => <option key={image.hash} value={image.hash}>{image.name} · {image.hash}</option>)}</select></label>}
    {user?.role === 'SUPERADMIN' && discovery?.videos?.map((video: any) => <div key={video.id}>{video.name} · {video.id}<Button type="button" disabled={pending} onClick={() => importAsset(video.id, 'VIDEO')}>Use existing provider video</Button></div>)}
    {user?.role === 'SUPERADMIN' && discovery?.images?.map((image: any) => <div key={image.hash}>{image.name}<Button type="button" disabled={pending} onClick={() => importAsset(image.hash, 'IMAGE')}>Import provider image into creative library</Button></div>)}
    {user?.role === 'SUPERADMIN' && discovery?.providerAssets?.filter((asset: any) => asset.type === 'IMAGE').map((asset: any) => <div key={asset.resourceName}>{asset.name}<Button type="button" disabled={pending} onClick={() => importAsset(asset.resourceName, 'IMAGE')}>Import Google image into creative library</Button></div>)}
  </section>;
};
