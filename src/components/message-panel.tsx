'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/src/services/api';
import { errorMessage } from '@/src/services/errors';
import type { ChannelMessage, TextTarget, User } from '@/src/types';
import { useRealtime } from './realtime-provider';

function mergeMessages(first: ChannelMessage[], second: ChannelMessage[]) {
  const merged = new Map<string, ChannelMessage>();
  for (const message of [...first, ...second]) merged.set(String(message.id), message);
  return [...merged.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function endpoint(target: TextTarget) {
  return target.kind === 'DIRECT'
    ? `/direct-channels/${target.channelId}/messages`
    : `/servers/${target.serverId}/channels/${target.channelId}/messages`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

interface MessagePanelProps {
  currentUser: User;
  target: TextTarget;
  onStartCall?: () => void;
}

export default function MessagePanel(props: MessagePanelProps) {
  return <MessagePanelContent key={`${props.target.kind}-${props.target.channelId}`} {...props} />;
}

function MessagePanelContent({ currentUser, target, onStartCall }: MessagePanelProps) {
  const { connected, subscribeMessages } = useRealtime();
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const targetEndpoint = useMemo(() => endpoint(target), [target]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    api.get<ChannelMessage[]>(targetEndpoint, { signal: controller.signal })
      .then(response => {
        if (!active) return;
        if (!Array.isArray(response.data)) throw new Error('Histórico inválido');
        setMessages(previous => mergeMessages(response.data, previous));
      })
      .catch(error => {
        if (!active || controller.signal.aborted) return;
        setHistoryError(true);
        toast.error(errorMessage(error, 'Não foi possível carregar o histórico.'));
      })
      .finally(() => active && setLoading(false));

    const unsubscribe = subscribeMessages(message => {
      if (message.channelId === target.channelId) {
        setMessages(previous => mergeMessages(previous, [message]));
      }
    });
    return () => {
      active = false;
      controller.abort();
      unsubscribe();
    };
  }, [subscribeMessages, target.channelId, targetEndpoint]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const response = await api.post<ChannelMessage>(targetEndpoint, { content });
      setMessages(previous => mergeMessages(previous, [response.data]));
      setDraft('');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível enviar a mensagem.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-(--surface-main)">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/6 px-5">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-white">
            {target.kind === 'SERVER_TEXT' ? '# ' : ''}{target.title}
          </h1>
          <p className="truncate text-xs text-slate-400">{target.subtitle || 'Conversa em tempo real'}</p>
        </div>
        <div className="flex items-center gap-2">
          {target.kind === 'DIRECT' && onStartCall && (
            <button
              type="button"
              onClick={onStartCall}
              className="inline-flex items-center gap-1 rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20"
              aria-label="Iniciar chamada"
            >
              <span aria-hidden="true">◉</span><span className="hidden sm:inline">Iniciar chamada</span>
            </button>
          )}
          <span className={`status-pill ${connected ? 'status-online' : 'status-warning'}`}>
            <span className="status-dot" />
            {connected ? 'Tempo real ativo' : 'Reconectando'}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {loading && <EmptyState icon="…" title="Carregando mensagens" description="Buscando o histórico desta conversa." />}
        {!loading && historyError && messages.length === 0 && (
          <EmptyState icon="!" title="Histórico indisponível" description="Você ainda pode tentar enviar uma nova mensagem." />
        )}
        {!loading && !historyError && messages.length === 0 && (
          <EmptyState icon="✦" title={`Início de ${target.title}`} description="Envie a primeira mensagem desta conversa." />
        )}
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-1">
          {messages.map((message, index) => {
            const mine = String(message.authorId) === String(currentUser.id);
            const previous = messages[index - 1];
            const grouped = previous?.authorId === message.authorId &&
              Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60 * 1000;
            return (
              <article key={message.id} className={`message-row ${mine ? 'message-row-mine' : ''} ${grouped ? 'mt-1' : 'mt-5'}`}>
                {!grouped && (
                  <div className="message-avatar" aria-hidden="true">{message.authorName.charAt(0).toUpperCase()}</div>
                )}
                <div className={`min-w-0 ${grouped ? 'ml-11' : ''}`}>
                  {!grouped && (
                    <div className={`mb-1 flex items-baseline gap-2 ${mine ? 'justify-end' : ''}`}>
                      <strong className="text-sm text-slate-100">{mine ? 'Você' : message.authorName}</strong>
                      <time className="text-[11px] text-slate-500">{formatTimestamp(message.createdAt)}</time>
                    </div>
                  )}
                  <p className={`message-bubble ${mine ? 'message-bubble-mine' : ''}`}>{message.content}</p>
                </div>
              </article>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={sendMessage} className="shrink-0 px-4 pb-5 sm:px-8">
        <div className="mx-auto flex max-w-4xl items-end gap-3 rounded-2xl border border-white/8 bg-white/5 p-2 shadow-2xl shadow-black/10 focus-within:border-violet-400/50">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            maxLength={4000}
            className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
            placeholder={`Mensagem para ${target.kind === 'SERVER_TEXT' ? '#' : ''}${target.title}`}
            aria-label="Mensagem"
          />
          <button className="icon-button icon-button-primary" type="submit" disabled={!draft.trim() || sending} aria-label="Enviar mensagem">
            {sending ? '…' : '➤'}
          </button>
        </div>
      </form>
    </section>
  );
}

function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/12 text-2xl text-violet-300">{icon}</div>
      <h2 className="font-semibold text-slate-200">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}
