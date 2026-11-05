'use client';
import React, { useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const AdvertisingAssets = ({ account, enabled, selected, onSelect, media = [], onChoosePage, onChooseImage }: any) => {
  const t = useT();
  const fetch = useFetch(), user = useUser(), [file, setFile] = useState<File>(), [pending, setPending] = useState(false), [error, setError] = useState('');
  const key = useRef(''), [discovery, setDiscovery] = useState<any>();
  const [mediaId, setMediaId] = useState(''), mediaKey = useRef('');
  const importKeys = useRef(new Map<string, string>());
  const read = async (response: Response) => { const body = await response.json(); if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : t('advertising_asset_request_failed', 'The request did not go through. Try again.')); return body; };
  const { data, mutate } = useSWR(account ? ['advertising-assets', user?.orgId, account.id] : null, () => fetch(`/campaign-manager/assets/${account.id}`).then(read), { revalidateOnFocus: false });
  const action = async (operation: () => Promise<void>) => { setPending(true); setError(''); try { await operation(); await mutate(); } catch (failure) { setError(failure instanceof Error ? failure.message : t('advertising_asset_request_failed_short', 'Could not complete the request. Try again.')); } finally { setPending(false); } };
  const importAsset = (providerId: string, kind: string) => action(async () => {
    let attempt = importKeys.current.get(providerId);
    if (!attempt) { attempt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''); importKeys.current.set(providerId, attempt); }
    await read(await fetch('/campaign-manager/assets/import', { method: 'POST', body: JSON.stringify({ accountId: account.id, providerId, kind, key: attempt }) }));
    importKeys.current.delete(providerId);
  });
  if (!account) return <p>{t('advertising_select_account_for_assets', 'Choose an advertising account to manage its creative files.')}</p>;
  return <section className="bg-sixth border border-fifth rounded-[4px] text-textColor p-[24px] space-y-4"><h3>{t('advertising_assets_title', 'Advertising assets')} · {account.name}</h3>
    <p>{t('advertising_assets_upload_notice', 'Files are uploaded to the selected ad account. Meta videos must finish processing before you can use them. Google Search accepts images only. Video upload is not available for Google.')}</p>
    <Button type="button" disabled={pending || !account.enabled} onClick={() => action(async () => { setDiscovery(await read(await fetch(`/campaign-manager/assets/${account.id}?discover=true`))); })}>{t('advertising_discover_assets', 'Find Pages and files on the ad account')}</Button>
    {user?.role === 'SUPERADMIN' && <div><label>{t('advertising_image_video', 'Image or video file')}<input type="file" accept={account.provider === 'META_ADS' ? 'image/jpeg,image/png,image/webp,video/mp4' : 'image/jpeg,image/png,image/webp'} onChange={(e) => { setFile(e.target.files?.[0]); key.current = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''); }} /></label>
      <Button type="button" disabled={!file || pending || !enabled || !account.enabled} onClick={() => action(async () => {
        if (!file || !(await deleteDialog(t('advertising_confirm_upload_file', 'Upload {{file}} to {{account}} ({{externalId}})? This adds the file to the ad account. It does not publish an ad.', { file: file.name, account: account.name, externalId: account.externalAccountId, interpolation: { escapeValue: false } }), t('advertising_upload_confirm_button', 'Upload'), t('advertising_upload_confirm_title', 'Upload to ad account?'), t('cancel', 'Cancel')))) return;
        const body = new FormData(); body.set('accountId', account.id); body.set('key', key.current); body.set('name', file.name.slice(0, 100)); body.set('file', file);
        const result = await read(await fetch('/campaign-manager/assets/upload', { method: 'POST', body }));
        if (['UNKNOWN', 'SENDING', 'REJECTED'].includes(result.status)) setError(t('advertising_asset_status_error', 'The upload did not finish ({{status}}: {{detail}}).', { status: result.status, detail: result.error?.code || t('advertising_use_refresh_reconcile', 'Refresh the file status before you upload again.'), interpolation: { escapeValue: false } }));
      })}>{t('advertising_upload_asset', 'Upload file')}</Button>{!enabled && <p>{t('advertising_execution_not_enabled', 'Uploads are turned off. Ask an administrator to turn on advertising changes.')}</p>}</div>}
    {user?.role === 'SUPERADMIN' && <div><label>{t('advertising_existing_workspace_media', 'Media library file')}<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" value={mediaId} onChange={(e) => { setMediaId(e.target.value); mediaKey.current = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''); }}><option value="">{t('advertising_select_owned_media', 'Choose an image or video')}</option>{media.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</select></label>
      <Button type="button" disabled={!mediaId || !enabled || pending || !account.enabled} onClick={() => action(async () => {
        if (!(await deleteDialog(t('advertising_confirm_upload_media', 'Upload the selected media library file to {{account}} ({{externalId}})? This adds the file to the ad account. It does not create an ad.', { account: account.name, externalId: account.externalAccountId, interpolation: { escapeValue: false } }), t('advertising_upload_confirm_button', 'Upload'), t('advertising_upload_confirm_title', 'Upload to ad account?'), t('cancel', 'Cancel')))) return;
        const result = await read(await fetch('/campaign-manager/assets/from-media', { method: 'POST', body: JSON.stringify({ accountId: account.id, mediaId, key: mediaKey.current }) }));
        if (['UNKNOWN', 'SENDING', 'REJECTED'].includes(result.status)) setError(t('advertising_asset_status_error', 'The upload did not finish ({{status}}: {{detail}}).', { status: result.status, detail: result.error?.code || t('advertising_refresh_reconcile', 'Refresh the file status before you upload again.'), interpolation: { escapeValue: false } }));
      })}>{t('advertising_upload_workspace_media', 'Upload to ad account')}</Button></div>}
    {error && <p role="alert">{error}</p>}
    {onSelect && <label>{t('advertising_ready_asset', 'Ready file')}<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" value={selected || ''} onChange={(e) => onSelect(e.target.value)}><option value="">{t('advertising_none_select_hash', 'None, or choose an existing image from the ad account')}</option>{data?.assets?.filter((asset: any) => asset.status === 'READY').map((asset: any) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.kind}</option>)}</select></label>}
    {data?.assets?.map((asset: any) => <div key={asset.id}>{asset.name} · {asset.kind} · {asset.status} · {asset.providerId || t('advertising_provider_id_unconfirmed', 'Not yet confirmed by the ad platform')}
      {asset.error && <span> · {asset.error.code}</span>}<button type="button" disabled={pending} onClick={() => action(async () => { await read(await fetch(`/campaign-manager/assets/${asset.id}/refresh`, { method: 'POST', body: '{}' })); })}>{t('advertising_refresh_reconcile_asset', 'Refresh status')}</button></div>)}
    {discovery && <details open><summary>{t('advertising_provider_pages_assets', 'Pages and files on the ad account')}</summary><p>{t('advertising_provider_assets_notice', 'Only items from this ad account can be used. You can pick the image IDs and Page IDs below in the Campaign Builder.')}</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(discovery, null, 2)}</pre></details>}
    {discovery?.pages && onChoosePage && <label>{t('advertising_eligible_page', 'Page')}<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" defaultValue="" onChange={(e) => { if (e.target.value) onChoosePage(e.target.value); }}><option value="">{t('advertising_select_page', 'Select Page')}</option>{discovery.pages.map((page: any) => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}</select></label>}
    {discovery?.images && onChooseImage && <label>{t('advertising_existing_provider_image', 'Image on the ad account')}<select className="bg-third text-textColor border border-fifth rounded-[4px] p-2" defaultValue="" onChange={(e) => { if (e.target.value) onChooseImage(e.target.value); }}><option value="">{t('advertising_select_image', 'Select image')}</option>{discovery.images.map((image: any) => <option key={image.hash} value={image.hash}>{image.name} · {image.hash}</option>)}</select></label>}
    {user?.role === 'SUPERADMIN' && discovery?.videos?.map((video: any) => <div key={video.id}>{video.name} · {video.id}<Button type="button" disabled={pending} onClick={() => importAsset(video.id, 'VIDEO')}>{t('advertising_use_provider_video', 'Use this video')}</Button></div>)}
    {user?.role === 'SUPERADMIN' && discovery?.images?.map((image: any) => <div key={image.hash}>{image.name}<Button type="button" disabled={pending} onClick={() => importAsset(image.hash, 'IMAGE')}>{t('advertising_import_provider_image', 'Add image to creative library')}</Button></div>)}
    {user?.role === 'SUPERADMIN' && discovery?.providerAssets?.filter((asset: any) => asset.type === 'IMAGE').map((asset: any) => <div key={asset.resourceName}>{asset.name}<Button type="button" disabled={pending} onClick={() => importAsset(asset.resourceName, 'IMAGE')}>{t('advertising_import_google_image', 'Add Google image to creative library')}</Button></div>)}
  </section>;
};
