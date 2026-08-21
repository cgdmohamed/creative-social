'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';

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

type ChannelComments = {
  channel: string;
  channelId?: string;
  picture?: string;
  provider: string;
  error?: string;
  comments: Comment[];
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

type ChannelChats = {
  channel: string;
  channelId?: string;
  provider: string;
  error?: string;
  conversations: Conversation[];
};

const when = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

// Kanal, ktoremu wygasl token, wymaga ponownego zalogowania w Ustawieniach.
// Brak uprawnienia po stronie Meta to inna sprawa i inny komunikat.
const explain = (error: string) => {
  if (error === 'RELOGIN') {
    return 'Kanal wymaga ponownego zalogowania w ustawieniach.';
  }
  if (error.includes('pages_messaging') || error.includes('(#200)')) {
    return 'Brak uprawnienia do wiadomosci. Zaloguj kanal ponownie, zeby token je obejmowal.';
  }
  if (error.includes('(#3)') || error.includes('capability')) {
    return 'Aplikacja Meta nie ma jeszcze zgody na wiadomosci (App Review).';
  }
  return error;
};

const Empty: FC<{ text: string }> = ({ text }) => (
  <div className="text-center py-[40px] text-[#8B8B8B]">{text}</div>
);

const ErrorBox: FC<{ channel: string; error: string }> = ({ channel, error }) => (
  <div className="bg-customColor6 rounded-[8px] p-[12px] mb-[10px] border-l-[3px] border-[#B45309]">
    <div className="text-[12px] text-[#8B8B8B]">{channel}</div>
    <div className="text-[13px]">{explain(error)}</div>
  </div>
);

const CommentsTab: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [replyTo, setReplyTo] = useState<string>('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    return (await (await fetch('/inbox/comments')).json()) as ChannelComments[];
  }, [fetch]);

  const { data, isLoading, mutate } = useSWR('inbox-comments', load, {
    revalidateOnFocus: false,
  });

  const send = useCallback(
    async (channelId: string, commentId: string) => {
      if (!text.trim()) return;
      setSending(true);
      try {
        const res = await fetch(`/inbox/comments/${channelId}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commentId, message: text }),
        });
        if (!res.ok) throw new Error(String(res.status));
        toaster.show('Odpowiedz wyslana', 'success');
        setReplyTo('');
        setText('');
        mutate();
      } catch (e) {
        toaster.show('Nie udalo sie wyslac odpowiedzi', 'warning');
      } finally {
        setSending(false);
      }
    },
    [fetch, text, toaster, mutate]
  );

  if (isLoading) return <Empty text="Wczytuje komentarze..." />;

  const groups = (data || []).filter((g) => g.comments?.length || g.error);
  const total = groups.reduce((sum, g) => sum + (g.comments?.length || 0), 0);

  if (!total && !groups.some((g) => g.error)) {
    return <Empty text="Brak nowych komentarzy. Wlasne komentarze sa pomijane." />;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="text-[14px] text-[#8B8B8B]">
        Komentarzy do odpowiedzi: {total}
      </div>
      {groups.map((group) => (
        <div key={`${group.provider}-${group.channel}`}>
          {group.error ? (
            <ErrorBox channel={group.channel} error={group.error} />
          ) : (
            <>
              <div className="text-[13px] font-bold mb-[8px]">
                {group.channel}
                <span className="text-[#8B8B8B] font-normal ms-[8px]">
                  {group.provider} &middot; {group.comments.length}
                </span>
              </div>
              {group.comments.map((c) => (
                <div
                  key={c.id}
                  className="bg-customColor6 rounded-[8px] p-[12px] mb-[8px]"
                  style={c.parentId ? { marginInlineStart: 24 } : undefined}
                >
                  <div className="flex gap-[8px] items-center text-[12px] text-[#8B8B8B]">
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
                  <div className="text-[14px] my-[6px] whitespace-pre-wrap break-words">
                    {c.message || <i>bez tresci</i>}
                  </div>

                  {replyTo === c.id ? (
                    <div className="flex flex-col gap-[8px] mt-[8px]">
                      <textarea
                        className="bg-customColor2 rounded-[6px] p-[8px] text-[14px] min-h-[70px]"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Twoja odpowiedz..."
                        autoFocus
                      />
                      <div className="flex gap-[8px]">
                        <button
                          className="bg-customColor21 rounded-[6px] px-[14px] py-[6px] text-[13px]"
                          disabled={sending || !text.trim()}
                          onClick={() => send(group.channelId!, c.id)}
                        >
                          {sending ? 'Wysylam...' : 'Wyslij'}
                        </button>
                        <button
                          className="px-[14px] py-[6px] text-[13px] text-[#8B8B8B]"
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
                    <button
                      className="text-[13px] text-customColor21"
                      onClick={() => {
                        setReplyTo(c.id);
                        setText('');
                      }}
                    >
                      Odpowiedz
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
};

const ChatsTab: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [openThread, setOpenThread] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    return (await (await fetch('/inbox/chats')).json()) as ChannelChats[];
  }, [fetch]);

  const { data, isLoading, mutate } = useSWR('inbox-chats', load, {
    revalidateOnFocus: false,
  });

  const send = useCallback(
    async (channelId: string, recipientId: string) => {
      if (!text.trim()) return;
      setSending(true);
      try {
        const res = await fetch(`/inbox/chats/${channelId}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientId, message: text }),
        });
        if (!res.ok) throw new Error(String(res.status));
        toaster.show('Wiadomosc wyslana', 'success');
        setText('');
        mutate();
      } catch (e) {
        toaster.show('Nie udalo sie wyslac wiadomosci', 'warning');
      } finally {
        setSending(false);
      }
    },
    [fetch, text, toaster, mutate]
  );

  if (isLoading) return <Empty text="Wczytuje rozmowy..." />;

  const groups = data || [];
  const total = groups.reduce((s, g) => s + (g.conversations?.length || 0), 0);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="text-[14px] text-[#8B8B8B]">Rozmow: {total}</div>
      {groups.map((group) => (
        <div key={`${group.provider}-${group.channel}`}>
          {group.error ? (
            <ErrorBox channel={group.channel} error={group.error} />
          ) : (
            <>
              <div className="text-[13px] font-bold mb-[8px]">
                {group.channel}
                <span className="text-[#8B8B8B] font-normal ms-[8px]">
                  {group.provider} &middot; {group.conversations.length}
                </span>
              </div>
              {group.conversations.map((conv) => (
                <div
                  key={conv.id}
                  className="bg-customColor6 rounded-[8px] p-[12px] mb-[8px]"
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
                          className={`text-[13px] p-[8px] rounded-[6px] max-w-[75%] ${
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
                          Minelo 24h od ostatniej wiadomosci, Meta nie pozwala
                          juz na zwykla odpowiedz.
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
                            disabled={sending || !text.trim()}
                            onClick={() =>
                              send(group.channelId!, conv.participantId!)
                            }
                          >
                            {sending ? '...' : 'Wyslij'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!group.conversations.length && (
                <div className="text-[13px] text-[#8B8B8B]">Brak rozmow.</div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
};

export const Inbox: FC = () => {
  const [tab, setTab] = useState<'comments' | 'chats'>('comments');

  return (
    <div className="flex flex-col gap-[20px] p-[20px]">
      <h1 className="text-[24px]">Inbox</h1>

      <div className="flex gap-[8px]">
        {(
          [
            ['comments', 'Komentarze'],
            ['chats', 'Czaty'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-[16px] py-[8px] rounded-[8px] text-[14px] ${
              tab === key ? 'bg-customColor21' : 'bg-customColor6'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'comments' ? <CommentsTab /> : <ChatsTab />}
    </div>
  );
};
