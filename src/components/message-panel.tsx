'use client';

import Image from 'next/image';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import toast from 'react-hot-toast';
import api from '@/src/services/api';
import {
  ATTACHMENT_INPUT_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentRequestFor,
  attachmentReservationEndpoint,
  formatAttachmentSize,
  uploadAttachmentFile,
} from '@/src/services/attachments';
import { errorMessage } from '@/src/services/errors';
import { parsePageResponse } from '@/src/services/pagination';
import type {
  AttachmentUploadResponse,
  ChannelMessage,
  CurrentUser,
  PageResponse,
  TextTarget,
} from '@/src/types';
import { MessageAttachments } from './message-attachments';
import { useRealtime } from './realtime-provider';

const HISTORY_PAGE_SIZE = 50;
const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;

type QueuedAttachmentStatus = 'reserving' | 'uploading' | 'uploaded' | 'error';

interface QueuedAttachment {
  localId: string;
  file: File;
  previewUrl: string | null;
  status: QueuedAttachmentStatus;
  progress: number;
  attachmentId: string | null;
  error: string | null;
}

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
  currentUser: CurrentUser;
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
  const [nextHistoryPage, setNextHistoryPage] = useState(1);
  const [historyComplete, setHistoryComplete] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [queuedAttachments, setQueuedAttachments] = useState<QueuedAttachment[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queuedAttachmentsRef = useRef<QueuedAttachment[]>([]);
  const attachmentControllersRef = useRef(new Map<string, AbortController>());
  const refreshingAttachmentsRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const pendingScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const targetEndpoint = useMemo(() => endpoint(target), [target]);

  function commitQueuedAttachments(update: (current: QueuedAttachment[]) => QueuedAttachment[]) {
    const next = update(queuedAttachmentsRef.current);
    queuedAttachmentsRef.current = next;
    setQueuedAttachments(next);
  }

  function updateQueuedAttachment(localId: string, patch: Partial<QueuedAttachment>) {
    commitQueuedAttachments(current => current.map(attachment =>
      attachment.localId === localId ? { ...attachment, ...patch } : attachment));
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    api.get<PageResponse<ChannelMessage>>(targetEndpoint, {
      params: { page: 0, size: HISTORY_PAGE_SIZE },
      signal: controller.signal,
    })
      .then(response => {
        if (!active) return;
        const page = parsePageResponse<ChannelMessage>(response.data, 'Histórico inválido');
        shouldStickToBottomRef.current = true;
        setMessages(previous => mergeMessages(page.content, previous));
        setNextHistoryPage(page.page + 1);
        setHistoryComplete(page.last);
      })
      .catch(error => {
        if (!active || controller.signal.aborted) return;
        setHistoryError(true);
        toast.error(errorMessage(error, 'Não foi possível carregar o histórico.'));
      })
      .finally(() => active && setLoading(false));

    const unsubscribe = subscribeMessages(message => {
      if (message.channelId === target.channelId) {
        const container = scrollContainerRef.current;
        shouldStickToBottomRef.current = !container ||
          container.scrollHeight - container.scrollTop - container.clientHeight < 120;
        setMessages(previous => mergeMessages(previous, [message]));
      }
    });
    return () => {
      active = false;
      controller.abort();
      unsubscribe();
    };
  }, [subscribeMessages, target.channelId, targetEndpoint]);

  useEffect(() => () => {
    attachmentControllersRef.current.forEach(controller => controller.abort());
    queuedAttachmentsRef.current.forEach(attachment => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
  }, []);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const pendingRestore = pendingScrollRestoreRef.current;
    if (pendingRestore) {
      container.scrollTop = pendingRestore.top + (container.scrollHeight - pendingRestore.height);
      pendingScrollRestoreRef.current = null;
      return;
    }
    if (shouldStickToBottomRef.current) container.scrollTop = container.scrollHeight;
    shouldStickToBottomRef.current = false;
  }, [messages]);

  async function loadOlderMessages() {
    if (loadingOlderRef.current || historyComplete) return;
    const container = scrollContainerRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    if (container) {
      pendingScrollRestoreRef.current = { height: container.scrollHeight, top: container.scrollTop };
    }
    try {
      const response = await api.get<PageResponse<ChannelMessage>>(targetEndpoint, {
        params: { page: nextHistoryPage, size: HISTORY_PAGE_SIZE },
      });
      const page = parsePageResponse<ChannelMessage>(response.data, 'Histórico inválido');
      setMessages(previous => mergeMessages(page.content, previous));
      setNextHistoryPage(page.page + 1);
      setHistoryComplete(page.last);
    } catch (error) {
      pendingScrollRestoreRef.current = null;
      toast.error(errorMessage(error, 'Não foi possível carregar mensagens anteriores.'));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  function handleHistoryScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    shouldStickToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (container.scrollTop <= 80 && !loadingOlderRef.current && !historyComplete) {
      void loadOlderMessages();
    }
  }

  async function uploadQueuedAttachment(attachment: QueuedAttachment) {
    const controller = new AbortController();
    attachmentControllersRef.current.set(attachment.localId, controller);
    updateQueuedAttachment(attachment.localId, {
      status: 'reserving',
      progress: 0,
      attachmentId: null,
      error: null,
    });

    try {
      const metadata = attachmentRequestFor(attachment.file);
      const reservation = await api.post<AttachmentUploadResponse>(
        attachmentReservationEndpoint(target),
        metadata,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      updateQueuedAttachment(attachment.localId, { status: 'uploading', progress: 1 });
      await uploadAttachmentFile(reservation.data, attachment.file, {
        signal: controller.signal,
        onProgress: progress => updateQueuedAttachment(attachment.localId, { progress }),
      });
      if (controller.signal.aborted) return;
      updateQueuedAttachment(attachment.localId, {
        status: 'uploaded',
        progress: 100,
        attachmentId: reservation.data.attachmentId,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      updateQueuedAttachment(attachment.localId, {
        status: 'error',
        error: errorMessage(error, error instanceof Error ? error.message : 'Não foi possível enviar o arquivo.'),
      });
    } finally {
      if (attachmentControllersRef.current.get(attachment.localId) === controller) {
        attachmentControllersRef.current.delete(attachment.localId);
      }
    }
  }

  function addFiles(files: File[]) {
    const available = MAX_ATTACHMENTS_PER_MESSAGE - queuedAttachmentsRef.current.length;
    if (available <= 0) {
      toast.error(`Cada mensagem aceita no máximo ${MAX_ATTACHMENTS_PER_MESSAGE} anexos.`);
      return;
    }
    if (files.length > available) {
      toast.error(`Somente ${available} ${available === 1 ? 'arquivo foi adicionado' : 'arquivos foram adicionados'}; o limite é quatro.`);
    }

    const additions: QueuedAttachment[] = [];
    for (const file of files.slice(0, available)) {
      try {
        attachmentRequestFor(file);
        additions.push({
          localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/')
            ? URL.createObjectURL(file)
            : null,
          status: 'reserving',
          progress: 0,
          attachmentId: null,
          error: null,
        });
      } catch (error) {
        toast.error(`${file.name}: ${error instanceof Error ? error.message : 'arquivo inválido'}`);
      }
    }
    if (additions.length === 0) return;
    commitQueuedAttachments(current => [...current, ...additions]);
    additions.forEach(attachment => void uploadQueuedAttachment(attachment));
  }

  function removeQueuedAttachment(attachment: QueuedAttachment) {
    attachmentControllersRef.current.get(attachment.localId)?.abort();
    attachmentControllersRef.current.delete(attachment.localId);
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    commitQueuedAttachments(current => current.filter(item => item.localId !== attachment.localId));
  }

  const refreshAttachmentUrls = useCallback(async () => {
    if (refreshingAttachmentsRef.current) return;
    refreshingAttachmentsRef.current = true;
    try {
      const pages = await Promise.all(Array.from({ length: Math.max(1, nextHistoryPage) }, (_, pageNumber) =>
        api.get<PageResponse<ChannelMessage>>(targetEndpoint, {
          params: { page: pageNumber, size: HISTORY_PAGE_SIZE },
        })));
      const refreshed = pages.flatMap(response =>
        parsePageResponse<ChannelMessage>(response.data, 'Histórico inválido').content);
      setMessages(previous => mergeMessages(previous, refreshed));
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível renovar o acesso aos anexos.'));
    } finally {
      refreshingAttachmentsRef.current = false;
    }
  }, [nextHistoryPage, targetEndpoint]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    const unfinished = queuedAttachments.some(attachment => attachment.status !== 'uploaded' || !attachment.attachmentId);
    const attachmentIds = queuedAttachments
      .map(attachment => attachment.attachmentId)
      .filter((attachmentId): attachmentId is string => !!attachmentId);
    if ((!content && attachmentIds.length === 0) || sending) return;
    if (unfinished) {
      toast.error('Aguarde os uploads ou remova os arquivos com erro antes de enviar.');
      return;
    }

    setSending(true);
    try {
      const payload = attachmentIds.length
        ? { ...(content ? { content } : {}), attachmentIds }
        : { content };
      const response = await api.post<ChannelMessage>(targetEndpoint, payload);
      shouldStickToBottomRef.current = true;
      setMessages(previous => mergeMessages(previous, [response.data]));
      setDraft('');
      queuedAttachments.forEach(attachment => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      queuedAttachmentsRef.current = [];
      setQueuedAttachments([]);
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

      <div
        ref={scrollContainerRef}
        onScroll={handleHistoryScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
        aria-label="Histórico de mensagens"
      >
        {loadingOlder && (
          <p className="mb-4 text-center text-xs text-slate-500" role="status">Carregando mensagens anteriores…</p>
        )}
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
                  {message.content && (
                    <p className={`message-bubble ${mine ? 'message-bubble-mine' : ''}`}><LinkifiedText text={message.content} /></p>
                  )}
                  <MessageAttachments
                    attachments={message.attachments ?? []}
                    onExpiredAction={refreshAttachmentUrls}
                  />
                </div>
              </article>
            );
          })}

        </div>
      </div>

      <form
        onSubmit={sendMessage}
        onDragEnter={event => {
          event.preventDefault();
          setDraggingFiles(true);
        }}
        onDragOver={event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDraggingFiles(true);
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false);
        }}
        onDrop={event => {
          event.preventDefault();
          setDraggingFiles(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className="shrink-0 px-4 pb-5 sm:px-8"
      >
        <div className={`relative mx-auto max-w-4xl rounded-2xl border bg-white/5 p-2 shadow-2xl shadow-black/10 transition focus-within:border-violet-400/50 ${draggingFiles ? 'border-violet-400 bg-violet-500/10' : 'border-white/8'}`}>
          {draggingFiles && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-violet-300 bg-slate-950/90 text-sm font-semibold text-violet-100">
              Solte os arquivos para anexar
            </div>
          )}
          {queuedAttachments.length > 0 && (
            <QueuedAttachmentTray
              attachments={queuedAttachments}
              onRemoveAction={removeQueuedAttachment}
              onRetryAction={attachment => void uploadQueuedAttachment(attachment)}
            />
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_INPUT_ACCEPT}
              className="hidden"
              aria-label="Selecionar anexos"
              onChange={event => {
                addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={queuedAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg text-slate-400 transition hover:bg-white/8 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Anexar arquivos"
              title="Anexar arquivos"
            >
              +
            </button>
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onPaste={event => {
                const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
                if (images.length === 0) return;
                event.preventDefault();
                addFiles(images);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              maxLength={4000}
              className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-500"
              placeholder={`Mensagem para ${target.kind === 'SERVER_TEXT' ? '#' : ''}${target.title}`}
              aria-label="Mensagem"
            />
            <button
              className="icon-button icon-button-primary"
              type="submit"
              disabled={(!draft.trim() && !queuedAttachments.some(attachment => attachment.status === 'uploaded')) ||
                sending || queuedAttachments.some(attachment => attachment.status !== 'uploaded')}
              aria-label="Enviar mensagem"
            >
              {sending ? '…' : '➤'}
            </button>
          </div>
          <p className="px-2 pt-1 text-[10px] text-slate-600">
            Até 4 arquivos de 10 MiB. Imagens, GIFs, vídeos e documentos compatíveis; áudio não é aceito.
          </p>
        </div>
      </form>
    </section>
  );
}

function QueuedAttachmentTray({
  attachments,
  onRemoveAction,
  onRetryAction,
}: {
  attachments: QueuedAttachment[];
  onRemoveAction: (attachment: QueuedAttachment) => void;
  onRetryAction: (attachment: QueuedAttachment) => void;
}) {
  return (
    <div className="mb-2 grid gap-2 border-b border-white/7 pb-2 sm:grid-cols-2" aria-label="Anexos selecionados">
      {attachments.map(attachment => (
        <article key={attachment.localId} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-950/55 p-2">
          {attachment.previewUrl && attachment.file.type.startsWith('image/') ? (
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black/30">
              <Image src={attachment.previewUrl} alt="" fill unoptimized sizes="48px" className="object-cover" />
            </div>
          ) : attachment.previewUrl && attachment.file.type.startsWith('video/') ? (
            <video src={attachment.previewUrl} muted preload="metadata" className="h-12 w-12 shrink-0 rounded-lg bg-black object-cover" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-xl" aria-hidden="true">▤</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-200">{attachment.file.name}</p>
            <p className={`mt-0.5 truncate text-[10px] ${attachment.status === 'error' ? 'text-rose-300' : 'text-slate-500'}`}>
              {attachment.status === 'reserving' && 'Preparando upload…'}
              {attachment.status === 'uploading' && `Enviando… ${attachment.progress}%`}
              {attachment.status === 'uploaded' && `Pronto · ${formatAttachmentSize(attachment.file.size)}`}
              {attachment.status === 'error' && attachment.error}
            </p>
            {(attachment.status === 'uploading' || attachment.status === 'reserving') && (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/7">
                <div className="h-full bg-violet-400 transition-all" style={{ width: `${Math.max(4, attachment.progress)}%` }} />
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {attachment.status === 'error' && (
              <button
                type="button"
                onClick={() => onRetryAction(attachment)}
                className="grid h-6 w-6 place-items-center rounded-md text-xs text-violet-300 hover:bg-violet-500/15"
                aria-label={`Tentar enviar ${attachment.file.name} novamente`}
                title="Tentar novamente"
              >
                ↻
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemoveAction(attachment)}
              className="grid h-6 w-6 place-items-center rounded-md text-sm text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
              aria-label={`Remover ${attachment.file.name}`}
              title={attachment.status === 'uploading' || attachment.status === 'reserving' ? 'Cancelar upload' : 'Remover anexo'}
            >
              ×
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function LinkifiedText({ text }: { text: string }) {
  return text.split(URL_PATTERN).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return part;
    return (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-300 underline decoration-cyan-300/40 underline-offset-2 hover:text-cyan-200"
      >
        {part}
      </a>
    );
  });
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
