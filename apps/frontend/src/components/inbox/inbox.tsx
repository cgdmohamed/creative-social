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

type ChannelState = {
  loading: boolean;
  error?: any;
  cached?: boolean;
  comments: Comment[];
  conversations: Conversation[];
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
  const [state, setState] = useState<Record<string, ChannelState>>({});
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

  const loadChannel = useCallback(
    async (channel: Channel, which: 'comments' | 'chats', force = false) => {
      const supported = which === 'comments' ? channel.supportsComments : channel.supportsChats;
      if (!supported) return;

      setState((prev) => ({
        ...prev,
        [channel.id]: {
          loading: true,
          comments: prev[channel.id]?.comments || [],
          conversations: prev[channel.id]?.conversations || [],
        },
      }));

      try {
        const res = await (
          await fetch(`/inbox/channels/${channel.id}/${which}${force ? '?refresh=true' : ''}`)
        ).json();

        setState((prev) => ({
          ...prev,
          [channel.id]: {
            loading: false,
            error: res.error,
            cached: !!res.cached,
            comments: res.comments || [],
            conversations: res.conversations || [],
          },
        }));

        // Cache pokazujemy od razu, swieze dane dociagamy w tle.
        if (res.cached) {
          fetch(`/inbox/channels/${channel.id}/${which}?refresh=true`)
            .then((r) => r.json())
            .then((fresh) =>
              setState((prev) => ({
                ...prev,
                [channel.id]: {
                  loading: false,
                  error: fresh.error,
                  cached: false,
                  comments: fresh.comments || [],
                  conversations: fresh.conversations || [],
                },
              }))
            )
            .catch(() => undefined);
        }
      } catch (e: any) {
        setState((prev) => ({
          ...prev,
          [channel.id]: { loading: false, error: e, comments: [], conversations: [] },
        }));
      }
    },
    [fetch]
  );

  useEffect(() => {
    channels.forEach((c) => loadChannel(c, tab));
  }, [channels, tab, loadChannel]);

  // Jedna plaska lista pozycji ze wszystkich zaznaczonych kanalow, najnowsze na gorze.
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    channels
      .filter((c) => selected.has(c.id))
      .forEach((channel) => {
        const s = state[channel.id];
        if (!s) return;
        if (tab === 'comments') {
          s.comments.forEach((c) =>
            out.push({
              id: c.id,
              channel,
              who: c.authorName || 'unknown',
              preview: c.message || '(no content)',
              at: c.createdAt,
              comment: c,
            })
          );
        } else {
          s.conversations.forEach((conv) => {
            const last = conv.messages[conv.messages.length - 1];
            out.push({
              id: conv.id,
              channel,
              who: conv.participantName || 'unknown',
              preview: last ? `${last.isFromUs ? 'Ty: ' : ''}${last.text}` : '',
              at: conv.updatedAt,
              conversation: conv,
            });
          });
        }
      });
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [channels, selected, state, tab]);

  const shown = onlyUnread ? items.filter((i) => !read.has(i.id)) : items;
  const unreadCount = items.filter((i) => !read.has(i.id)).length;
  const active = shown.find((i) => i.id === activeId) || null;
  const anyLoading = channels.some((c) => state[c.id]?.loading);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    channels.forEach((c) => {
      const s = state[c.id];
      const list = tab === 'comments' ? s?.comments || [] : s?.conversations || [];
      out[c.id] = list.filter((x: any) => !read.has(x.id)).length;
    });
    return out;
  }, [channels, state, tab, read]);

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
        loadChannel(channel, tab, true);
      } catch {
        toaster.show('Action failed', 'warning');
      } finally {
        setBusy(false);
      }
    },
    [fetch, toaster, loadChannel, tab]
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
          const st = state[c.id];
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
              {st?.loading ? (
                <span className="text-[10px] text-[#8B8B8B]">...</span>
              ) : st?.error ? (
                <span className="text-[13px] text-[#B45309]" title={explain(st.error)}>!</span>
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
            onClick={() => channels.forEach((c) => loadChannel(c, tab, true))}
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
