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

// Stan ladowania jednego kanalu. Kazdy kanal jedzie osobnym zapytaniem, wiec
// wolny kanal nie blokuje pozostalych i wyniki pojawiaja sie stopniowo.
type ChannelState = {
  loading: boolean;
  error?: string;
  comments: Comment[];
  conversations: Conversation[];
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

const explain = (error: string) => {
  if (error === 'RELOGIN')
    return 'Kanal wymaga ponownego zalogowania w Ustawieniach.';
  if (error.startsWith('TIMEOUT'))
    return 'Platforma odpowiada zbyt wolno. Sprobuj odswiezyc.';
  if (error.includes('pages_messaging') || error.includes('(#200)'))
    return 'Brak uprawnienia do wiadomosci. Zaloguj kanal ponownie.';
  if (error.includes('(#3)') || error.includes('capability'))
    return 'Aplikacja Meta nie ma jeszcze zgody na wiadomosci na tym kanale.';
  return error;
};

const PROVIDER_DOT: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#E1306C',
  youtube: '#FF0000',
  discord: '#5865F2',
};

const Avatar: FC<{ channel: Channel; size?: number }> = ({
  channel,
  size = 34,
}) => (
  <div className="relative shrink-0" style={{ width: size, height: size }}>
    {channel.picture ? (
      <img
        src={channel.picture}
        alt=""
        className="rounded-full w-full h-full object-cover"
      />
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
  const [openThread, setOpenThread] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const loadChannels = useCallback(async () => {
    const list: Channel[] = await (await fetch('/inbox/channels')).json();
    setChannels(list);
    setSelected(new Set(list.map((c) => c.id)));
  }, [fetch]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Kazdy kanal osobno, zeby wynik pokazywal sie od razu po jego zakonczeniu.
  const loadChannel = useCallback(
    async (channel: Channel, which: 'comments' | 'chats') => {
      const supported =
        which === 'comments' ? channel.supportsComments : channel.supportsChats;
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
          await fetch(`/inbox/channels/${channel.id}/${which}`)
        ).json();
        setState((prev) => ({
          ...prev,
          [channel.id]: {
            loading: false,
            error: res.error,
            comments: res.comments || prev[channel.id]?.comments || [],
            conversations:
              res.conversations || prev[channel.id]?.conversations || [],
          },
        }));
      } catch (e: any) {
        setState((prev) => ({
          ...prev,
          [channel.id]: {
            loading: false,
            error: String(e?.message || e),
            comments: [],
            conversations: [],
          },
        }));
      }
    },
    [fetch]
  );

  useEffect(() => {
    channels.forEach((c) => loadChannel(c, tab));
  }, [channels, tab, loadChannel]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    channels.forEach((c) => {
      const s = state[c.id];
      out[c.id] =
        tab === 'comments'
          ? s?.comments?.length || 0
          : s?.conversations?.length || 0;
    });
    return out;
  }, [channels, state, tab]);

  const total = useMemo(
    () =>
      channels
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => sum + (counts[c.id] || 0), 0),
    [channels, selected, counts]
  );

  const anyLoading = channels.some((c) => state[c.id]?.loading);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
        setReplyTo('');
        setText('');
        loadChannel(channel, tab);
      } catch {
        toaster.show('Nie udalo sie wykonac akcji', 'warning');
      } finally {
        setBusy(false);
      }
    },
    [fetch, toaster, loadChannel, tab]
  );

  const visible = channels.filter((c) => selected.has(c.id));

  return (
    <div className="flex gap-[16px] h-[calc(100vh-120px)]">
      {/* Panel kanalow */}
      <div className="w-[240px] shrink-0 bg-customColor6 rounded-[12px] p-[12px] overflow-y-auto">
        <div className="flex items-center justify-between mb-[10px]">
          <span className="text-[13px] font-bold">Kanaly</span>
          <button
            className="text-[11px] text-customColor21"
            onClick={() =>
              setSelected(
                selected.size === channels.length
                  ? new Set()
                  : new Set(channels.map((c) => c.id))
              )
            }
          >
            {selected.size === channels.length ? 'odznacz' : 'zaznacz'}
          </button>
        </div>

        {channels.map((c) => {
          const supported =
            tab === 'comments' ? c.supportsComments : c.supportsChats;
          const s = state[c.id];
          const n = counts[c.id] || 0;
          return (
            <div
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`flex items-center gap-[9px] p-[7px] rounded-[8px] cursor-pointer mb-[3px] ${
                selected.has(c.id) ? 'bg-customColor2' : 'opacity-45'
              }`}
            >
              <Avatar channel={c} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] truncate">{c.name}</div>
                {!supported && (
                  <div className="text-[10px] text-[#8B8B8B]">niedostepne</div>
                )}
              </div>
              {s?.loading ? (
                <span className="text-[10px] text-[#8B8B8B]">...</span>
              ) : s?.error ? (
                <span className="text-[13px] text-[#B45309]" title={explain(s.error)}>
                  !
                </span>
              ) : n > 0 ? (
                <span className="text-[11px] bg-customColor21 rounded-full px-[7px] py-[1px] min-w-[20px] text-center">
                  {n}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Tresc */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-[8px] mb-[14px]">
          <div className="ms-auto text-[13px] text-[#8B8B8B]">
            {anyLoading ? 'wczytuje...' : `razem: ${total}`}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pe-[6px]">
          {visible.map((channel) => {
            const s = state[channel.id];
            const items =
              tab === 'comments' ? s?.comments || [] : s?.conversations || [];
            if (!s || (!items.length && !s.error && !s.loading)) return null;

            return (
              <div key={channel.id} className="mb-[18px]">
                <div className="flex items-center gap-[8px] mb-[8px]">
                  <Avatar channel={channel} size={24} />
                  <span className="text-[13px] font-bold">{channel.name}</span>
                  {s.loading && (
                    <span className="text-[11px] text-[#8B8B8B]">wczytuje...</span>
                  )}
                </div>

                {s.error && (
                  <div className="bg-customColor6 rounded-[8px] p-[11px] mb-[8px] border-s-[3px] border-[#B45309] text-[13px]">
                    {explain(s.error)}
                  </div>
                )}

                {tab === 'comments' &&
                  (items as Comment[]).map((c) => (
                    <div
                      key={c.id}
                      className="bg-customColor6 rounded-[10px] p-[12px] mb-[8px]"
                      style={c.parentId ? { marginInlineStart: 26 } : undefined}
                    >
                      <div className="flex gap-[8px] items-center text-[12px] text-[#8B8B8B] flex-wrap">
                        <span className="text-white font-bold">
                          {c.authorName || 'nieznany'}
                        </span>
                        <span>{when(c.createdAt)}</span>
                        {c.permalink && (
                          <a
                            href={c.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-customColor21 underline"
                          >
                            otworz
                          </a>
                        )}
                      </div>
                      <div className="text-[14px] my-[7px] whitespace-pre-wrap break-words">
                        {c.message || <i>bez tresci</i>}
                      </div>

                      {replyTo === c.id ? (
                        <div className="flex flex-col gap-[8px]">
                          <textarea
                            className="bg-customColor2 rounded-[6px] p-[9px] text-[14px] min-h-[70px]"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Twoja odpowiedz..."
                            autoFocus
                          />
                          <div className="flex gap-[8px]">
                            <button
                              className="bg-customColor21 rounded-[6px] px-[14px] py-[6px] text-[13px]"
                              disabled={busy || !text.trim()}
                              onClick={() =>
                                act(
                                  `/inbox/comments/${channel.id}/reply`,
                                  { commentId: c.id, message: text },
                                  'Odpowiedz wyslana',
                                  channel
                                )
                              }
                            >
                              {busy ? 'Wysylam...' : 'Wyslij'}
                            </button>
                            <button
                              className="px-[12px] py-[6px] text-[13px] text-[#8B8B8B]"
                              onClick={() => {
                                setReplyTo('');
                                setText('');
                              }}
                            >
                              Anuluj
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-[14px] text-[13px]">
                          <button
                            className="text-customColor21"
                            onClick={() => {
                              setReplyTo(c.id);
                              setText('');
                            }}
                          >
                            Odpowiedz
                          </button>
                          <button
                            className="text-[#8B8B8B]"
                            onClick={() =>
                              act(
                                `/inbox/comments/${channel.id}/moderate`,
                                { commentId: c.id, action: 'hide' },
                                'Komentarz ukryty',
                                channel
                              )
                            }
                          >
                            Ukryj
                          </button>
                          <button
                            className="text-[#B45309]"
                            onClick={() => {
                              if (
                                confirm(
                                  'Usunac komentarz na stale? Tego nie da sie cofnac.'
                                )
                              ) {
                                act(
                                  `/inbox/comments/${channel.id}/moderate`,
                                  { commentId: c.id, action: 'delete' },
                                  'Komentarz usuniety',
                                  channel
                                );
                              }
                            }}
                          >
                            Usun
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                {tab === 'chats' &&
                  (items as Conversation[]).map((conv) => (
                    <div
                      key={conv.id}
                      className="bg-customColor6 rounded-[10px] p-[12px] mb-[8px]"
                    >
                      <div
                        className="flex justify-between items-center cursor-pointer"
                        onClick={() =>
                          setOpenThread(openThread === conv.id ? '' : conv.id)
                        }
                      >
                        <span className="font-bold text-[13px]">
                          {conv.participantName || 'nieznany'}
                        </span>
                        <span className="text-[12px] text-[#8B8B8B]">
                          {when(conv.updatedAt)}
                        </span>
                      </div>

                      {openThread === conv.id && (
                        <div className="mt-[10px] flex flex-col gap-[6px]">
                          {conv.messages.map((m) => (
                            <div
                              key={m.id}
                              className={`text-[13px] p-[8px] rounded-[8px] max-w-[75%] ${
                                m.isFromUs
                                  ? 'bg-customColor21 self-end'
                                  : 'bg-customColor2 self-start'
                              }`}
                            >
                              {m.text}
                            </div>
                          ))}

                          {conv.canReplyFreely === false ? (
                            <div className="text-[12px] text-[#B45309] mt-[6px]">
                              Minelo 24h od ostatniej wiadomosci, Meta nie
                              pozwala juz na zwykla odpowiedz.
                            </div>
                          ) : (
                            <div className="flex gap-[8px] mt-[8px]">
                              <textarea
                                className="bg-customColor2 rounded-[6px] p-[8px] text-[14px] flex-1 min-h-[60px]"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                placeholder="Odpowiedz..."
                              />
                              <button
                                className="bg-customColor21 rounded-[6px] px-[14px] text-[13px]"
                                disabled={busy || !text.trim()}
                                onClick={() =>
                                  act(
                                    `/inbox/chats/${channel.id}/send`,
                                    {
                                      recipientId: conv.participantId,
                                      message: text,
                                    },
                                    'Wiadomosc wyslana',
                                    channel
                                  )
                                }
                              >
                                {busy ? '...' : 'Wyslij'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            );
          })}

          {!anyLoading && total === 0 && (
            <div className="text-center py-[50px] text-[#8B8B8B] text-[14px]">
              {tab === 'comments'
                ? 'Brak komentarzy do odpowiedzi. Wlasne komentarze sa pomijane.'
                : 'Brak rozmow.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
