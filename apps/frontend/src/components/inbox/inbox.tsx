'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';

type Channel = {
  id: string;
  name: string;
  picture?: string;
  provider: string;
  supportsComments: boolean;
  supportsChats: boolean;
};

type Comment = {
  id: string;
  message: string;
  createdAt: string;
  authorName?: string;
  permalink?: string;
  parentId?: string;
  postText?: string;
  postUrl?: string;
};

type Message = {
  id: string;
  text: string;
  createdAt: string;
  fromName?: string;
  isFromUs: boolean;
};

type Conversation = {
  id: string;
  participantId?: string;
  participantName?: string;
  updatedAt: string;
  canReplyFreely?: boolean;
  messages: Message[];
};

// Jedna pozycja listy srodkowej, niezaleznie od tego, czy to komentarz,
// czy rozmowa - dzieki temu lista i panel szczegolow maja jeden ksztalt.
type Item = {
  id: string;
  channel: Channel;
  who: string;
  preview: string;
  at: string;
  comment?: Comment;
  conversation?: Conversation;
};

const when = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
};

const explain = (error: any): string => {
  if (error && typeof error === 'object') {
    error = error.message || JSON.stringify(error);
  }
  const e = String(error || '');
  if (e === 'RELOGIN') return 'This channel needs to be reconnected in Settings.';
  if (e.startsWith('TIMEOUT')) return 'The platform is responding too slowly. Try refreshing.';
  if (e.includes('pages_messaging') || e.includes('(#200)'))
    return 'Missing messaging permission. Reconnect this channel.';
  if (e.includes('(#3)') || e.includes('capability'))
    return 'The Meta app is not approved for messaging on this channel yet.';
  return e;
};

const PROVIDER_DOT: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#E1306C',
  youtube: '#FF0000',
  discord: '#5865F2',
};

const Avatar: FC<{ channel: Channel; size?: number }> = ({ channel, size = 32 }) => (
  <div className="relative shrink-0" style={{ width: size, height: size }}>
    {channel.picture ? (
      <img src={channel.picture} alt="" className="rounded-full w-full h-full object-cover" />
    ) : (
      <div className="rounded-full w-full h-full bg-customColor2 flex items-center justify-center text-[12px]">
        {channel.name.slice(0, 1)}
      </div>
    )}
    <span
      className="absolute -bottom-[2px] -end-[2px] rounded-full border-2 border-customColor6"
      style={{
        width: size / 2.6,
        height: size / 2.6,
        background: PROVIDER_DOT[channel.provider] || '#888',
      }}
    />
  </div>
);

export const Inbox: FC<{ mode: 'comments' | 'chats' }> = ({ mode }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const tab = mode;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<any[]>([]);
  const [sync, setSync] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const loadChannels = useCallback(async () => {
    const [list, readIds] = await Promise.all([
      (await fetch('/inbox/channels')).json(),
      (await fetch('/inbox/read')).json().catch(() => []),
    ]);
    setChannels(list);
    setSelected(new Set(list.map((c: Channel) => c.id)));
    setRead(new Set(readIds || []));
  }, [fetch]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Wszystko jednym zapytaniem do naszej bazy. Platformy odpytuje cron w tle,
  // wiec panel otwiera sie natychmiast, niezaleznie od tego, ile kanalow jest
  // podpietych i jak wolno odpowiada dzis Meta.
  const loadData = useCallback(
    async (sync = false) => {
      setLoading(true);
      try {
        const kind = tab === 'comments' ? 'comment' : 'conversation';
        const res = sync
          ? await (await fetch(`/inbox/sync/${kind}`, { method: 'POST' })).json()
          : await (await fetch(`/inbox/db/${kind}`)).json();

        setRows(res.items || []);
        setSync(res.sync || []);
        setRead(
          new Set((res.items || []).filter((i: any) => i.isRead).map((i: any) => i.id))
        );
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [fetch, tab]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Jedna plaska lista pozycji ze wszystkich zaznaczonych kanalow, najnowsze na gorze.
  const items: Item[] = useMemo(() => {
    const byId = new Map(channels.map((c) => [c.id, c]));
    return rows
      .filter((r) => selected.has(r.integrationId))
      .map((r) => {
        const channel = byId.get(r.integrationId);
        if (!channel) return null;
        const conv = r.conversation;
        return {
          id: r.id,
          channel,
          who: r.authorName || 'unknown',
          preview: r.message || '(no content)',
          at: r.createdAt,
          comment: tab === 'comments' ? r : undefined,
          conversation: conv || undefined,
        } as Item;
      })
      .filter(Boolean) as Item[];
  }, [rows, channels, selected, tab]);

  const shown = onlyUnread ? items.filter((i) => !read.has(i.id)) : items;
  const unreadCount = items.filter((i) => !read.has(i.id)).length;
  const active = shown.find((i) => i.id === activeId) || null;
  const anyLoading = loading;

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    rows.forEach((r) => {
      if (!r.isRead && !read.has(r.id)) {
        out[r.integrationId] = (out[r.integrationId] || 0) + 1;
      }
    });
    return out;
  }, [rows, read]);

  // Blad synchronizacji kanalu pokazujemy przy kanale, zeby bylo widac,
  // ktore konto wymaga uwagi.
  const syncError = useCallback(
    (integrationId: string) =>
      sync.find(
        (x) =>
          x.integrationId === integrationId &&
          x.kind === (tab === 'comments' ? 'comment' : 'conversation')
      )?.lastError,
    [sync, tab]
  );

  const setReadState = useCallback(
    async (ids: string[], value: boolean) => {
      setRead((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => (value ? next.add(id) : next.delete(id)));
        return next;
      });
      try {
        await fetch('/inbox/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, read: value }),
        });
      } catch {
        // stan lokalny juz zmieniony, ponowna proba przy nastepnej akcji
      }
    },
    [fetch]
  );

  // Otwarcie pozycji oznacza ja jako przeczytana - tak dziala kazda skrzynka.
  const open = useCallback(
    (item: Item) => {
      setActiveId(item.id);
      setText('');
      if (!read.has(item.id)) setReadState([item.id], true);
    },
    [read, setReadState]
  );

  const act = useCallback(
    async (url: string, body: any, ok: string, channel: Channel) => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        toaster.show(ok, 'success');
        setText('');
        loadData(true);
      } catch {
        toaster.show('Action failed', 'warning');
      } finally {
        setBusy(false);
      }
    },
    [fetch, toaster, loadData]
  );

  return (
    <div className="flex gap-[12px] h-[calc(100vh-130px)]">
      {/* Channels */}
      <div className="w-[250px] shrink-0 border-e border-[#2a3040] pe-[12px] overflow-y-auto">
        <div className="flex items-center justify-between mb-[14px] px-[4px]">
          <span className="text-[18px] font-bold">Channels</span>
          <button
            className="text-[11px] text-customColor21"
            onClick={() =>
              setSelected(
                selected.size === channels.length ? new Set() : new Set(channels.map((c) => c.id))
              )
            }
          >
            {selected.size === channels.length ? 'none' : 'all'}
          </button>
        </div>

        {channels.map((c) => {
          const supported = tab === 'comments' ? c.supportsComments : c.supportsChats;
          const err = syncError(c.id);
          const n = counts[c.id] || 0;
          const on = selected.has(c.id);
          return (
            <div
              key={c.id}
              title={on ? 'Click to hide' : 'Click to show'}
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                  return next;
                })
              }
              // Aktywny kanal jest w pelni widoczny, wylaczony przygaszony -
              // ten sam jezyk wizualny co panel kanalow w Analytics.
              className={`flex items-center gap-[12px] py-[9px] px-[4px] cursor-pointer transition-opacity ${
                on ? 'opacity-100' : 'opacity-35 hover:opacity-60'
              }`}
            >
              <Avatar channel={c} size={36} />
              <div className="flex-1 min-w-0">
                <div className={`text-[14px] truncate ${on ? '' : 'text-[#8B8B8B]'}`}>
                  {c.name}
                </div>
                {!supported && <div className="text-[11px] text-[#6f7889]">not available</div>}
              </div>
              {err ? (
                <span className="text-[13px] text-[#B45309]" title={explain(err)}>!</span>
              ) : n > 0 ? (
                <span className="text-[11px] bg-customColor21 rounded-full px-[7px] min-w-[20px] text-center">
                  {n}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Lista */}
      <div className="w-[340px] shrink-0 border-e border-[#2a3040] pe-[12px] flex flex-col overflow-hidden">
        <div className="flex items-center gap-[8px] pb-[10px] mb-[4px] border-b border-[#2a3040]">
          <button
            onClick={() => setOnlyUnread(!onlyUnread)}
            className={`text-[12px] px-[10px] py-[5px] rounded-[7px] ${
              onlyUnread ? 'bg-customColor21' : 'bg-customColor2'
            }`}
          >
            {onlyUnread ? 'Unread only' : 'All'}
          </button>
          <span className="text-[12px] text-[#8B8B8B]">
            {anyLoading ? 'loading...' : `${unreadCount} unread`}
          </span>
          <button
            className="ms-auto text-[12px] text-customColor21"
            onClick={() => loadData(true)}
            disabled={anyLoading}
          >
            Refresh
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {shown.map((item) => {
            const isRead = read.has(item.id);
            const isActive = item.id === activeId;
            return (
              <div
                key={item.id}
                onClick={() => open(item)}
                className={`flex gap-[10px] py-[11px] px-[6px] cursor-pointer border-b border-[#232936] transition-colors ${
                  isActive ? 'bg-customColor2/60' : 'hover:bg-customColor2/30'
                } ${isRead ? 'opacity-60' : ''}`}
              >
                <Avatar channel={item.channel} size={26} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[6px]">
                    <span className={`text-[12px] truncate ${isRead ? '' : 'font-bold'}`}>
                      {item.who}
                    </span>
                    <span className="text-[10px] text-[#8B8B8B] ms-auto shrink-0">
                      {when(item.at)}
                    </span>
                  </div>
                  <div className={`text-[12px] truncate ${isRead ? 'text-[#8B8B8B]' : ''}`}>
                    {item.preview}
                  </div>
                  <div className="text-[10px] text-[#6f7889] truncate">{item.channel.name}</div>
                </div>
              </div>
            );
          })}

          {!anyLoading && !shown.length && (
            <div className="text-center py-[40px] text-[#8B8B8B] text-[13px] px-[16px]">
              {onlyUnread
                ? 'Nothing unread. Switch to "All".'
                : tab === 'comments'
                ? 'No comments. Your own are filtered out.'
                : 'No conversations.'}
            </div>
          )}
        </div>
      </div>

      {/* Szczegoly */}
      <div className="flex-1 min-w-0 ps-[6px] overflow-y-auto">
        {!active ? (
          <div className="h-full flex items-center justify-center text-[#8B8B8B] text-[14px]">
            Select a {tab === 'comments' ? 'comment' : 'conversation'} from the list
          </div>
        ) : (
          <div className="flex flex-col gap-[14px]">
            <div className="flex items-center gap-[10px] pb-[12px] border-b border-[#2a3040]">
              <Avatar channel={active.channel} size={34} />
              <div className="min-w-0">
                <div className="text-[14px] font-bold truncate">{active.who}</div>
                <div className="text-[11px] text-[#8B8B8B] truncate">
                  {active.channel.name} &middot; {active.channel.provider} &middot;{' '}
                  {when(active.at)}
                </div>
              </div>
              <button
                className="ms-auto text-[12px] text-[#8B8B8B] hover:text-white shrink-0"
                onClick={() => setReadState([active.id], !read.has(active.id))}
              >
                {read.has(active.id) ? 'Mark as unread' : 'Mark as read'}
              </button>
            </div>

            {active.comment && (
              <>
                {active.comment.postText && (
                  <div className="text-[12px] text-[#8B8B8B] bg-customColor2 rounded-[8px] p-[10px]">
                    Under post: {active.comment.postText.slice(0, 160)}
                  </div>
                )}
                <div className="text-[15px] whitespace-pre-wrap break-words">
                  {active.comment.message || <i>no content</i>}
                </div>

                <div className="flex gap-[14px] text-[13px]">
                  {active.comment.permalink && (
                    <a
                      href={active.comment.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-customColor21 underline"
                    >
                      open on platform
                    </a>
                  )}
                  <button
                    className="text-[#8B8B8B] hover:text-white"
                    onClick={() =>
                      act(
                        `/inbox/comments/${active.channel.id}/moderate`,
                        { commentId: active.id, action: 'hide' },
                        'Comment hidden',
                        active.channel
                      )
                    }
                  >
                    Hide
                  </button>
                  <button
                    className="text-[#B45309]"
                    onClick={() => {
                      if (confirm('Deleteac komentarz na stale? Tego nie da sie cofnac.')) {
                        act(
                          `/inbox/comments/${active.channel.id}/moderate`,
                          { commentId: active.id, action: 'delete' },
                          'Comment deleted',
                          active.channel
                        );
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>

                <div className="flex flex-col gap-[8px]">
                  <textarea
                    className="bg-customColor2 rounded-[8px] p-[10px] text-[14px] min-h-[90px]"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Your reply..."
                  />
                  <button
                    className="bg-customColor21 rounded-[8px] px-[18px] py-[8px] text-[13px] self-start disabled:opacity-40"
                    disabled={busy || !text.trim()}
                    onClick={() =>
                      act(
                        `/inbox/comments/${active.channel.id}/reply`,
                        { commentId: active.id, message: text },
                        'Reply sent',
                        active.channel
                      )
                    }
                  >
                    {busy ? 'Sending...' : 'Odpowiedz'}
                  </button>
                </div>
              </>
            )}

            {active.conversation && (
              <>
                <div className="flex flex-col gap-[7px]">
                  {active.conversation.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`text-[14px] p-[10px] rounded-[12px] max-w-[80%] ${
                        m.isFromUs ? 'bg-customColor21 self-end' : 'bg-customColor2 self-start'
                      }`}
                    >
                      {m.text}
                      <div className="text-[10px] opacity-60 mt-[3px]">{when(m.createdAt)}</div>
                    </div>
                  ))}
                </div>

                {active.conversation.canReplyFreely === false ? (
                  <div className="text-[13px] text-[#B45309] bg-customColor2 rounded-[8px] p-[11px]">
                    More than 24h since their last message. Meta no longer allows a plain reply.
                  </div>
                ) : (
                  <div className="flex flex-col gap-[8px]">
                    <textarea
                      className="bg-customColor2 rounded-[8px] p-[10px] text-[14px] min-h-[90px]"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Write a message..."
                    />
                    <button
                      className="bg-customColor21 rounded-[8px] px-[18px] py-[8px] text-[13px] self-start disabled:opacity-40"
                      disabled={busy || !text.trim()}
                      onClick={() =>
                        act(
                          `/inbox/chats/${active.channel.id}/send`,
                          {
                            recipientId: active.conversation!.participantId,
                            message: text,
                          },
                          'Message sent',
                          active.channel
                        )
                      }
                    >
                      {busy ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
