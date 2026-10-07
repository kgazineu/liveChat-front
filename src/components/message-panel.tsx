'use client';

import Image from 'next/image';
import {
  AtSign,
  FileText,
  Hash,
  Loader2,
  Phone,
  PlusCircle,
  RotateCw,
  SendHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
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
import { Avatar } from './ui/avatar';
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

const GROUP_WINDOW_MS = 7 * 60 * 1000;

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function sameDay(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();
}

function formatTime(value: string) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date) : '';
}

/** “Hoje às 14:32”, “Ontem às 09:10” ou a data completa, como nos clientes de chat. */
function formatTimestamp(value: string) {
  const date = validDate(value);
  if (!date) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return `Hoje às ${formatTime(value)}`;
  if (sameDay(date, yesterday)) return `Ontem às ${formatTime(value)}`;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDay(value: string) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date) : '';
}

/** Mensagens seguidas do mesmo autor em poucos minutos viram um grupo; uma mudança de dia abre um divisor. */
function buildTimeline(messages: ChannelMessage[]) {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const current = validDate(message.createdAt);
    const before = previous ? validDate(previous.createdAt) : null;
    const newDay = !!current && (!before || !sameDay(before, current));
    const grouped = !newDay && previous != null &&
      String(previous.authorId) === String(message.authorId) &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS;
    return { message, grouped, newDay };
  });
}

interface MessagePanelProps {
  currentUser: CurrentUser;
  target: TextTarget;
  onStartCall?: () => void;
  /** Elemento exibido antes do título, como o botão de navegação no celular. */
  headerStart?: ReactNode;
  /** Ações extras à direita do cabeçalho, como a lista de membros. */
  headerActions?: ReactNode;
}

export default function MessagePanel(props: MessagePanelProps) {
  return <MessagePanelContent key={`${props.target.kind}-${props.target.channelId}`} {...props} />;
}

function MessagePanelContent({ currentUser, target, onStartCall, headerStart, headerActions }: MessagePanelProps) {
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

  const timeline = buildTimeline(messages);
  const isServerChannel = target.kind === 'SERVER_TEXT';
  const placeholder = isServerChannel ? `Conversar em #${target.title}` : `Conversar com @${target.title}`;
  const remainingCharacters = 4000 - draft.length;

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-main"
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDraggingFiles(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
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
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-2 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05),0_2px_0_rgba(4,4,5,0.05)] sm:px-4">
        {headerStart}
        {isServerChannel
          ? <Hash size={24} className="shrink-0 text-faint" aria-hidden="true" />
          : <AtSign size={22} className="shrink-0 text-faint" aria-hidden="true" />}
        <h1 className="min-w-0 truncate text-base font-semibold text-header">{target.title}</h1>
        {isServerChannel && target.subtitle && (
          <>
            <span className="mx-2 hidden h-6 w-px shrink-0 bg-divider md:block" aria-hidden="true" />
            <p className="hidden min-w-0 truncate text-sm text-muted md:block">{target.subtitle}</p>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!connected && (
            <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning" role="status">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
              Reconectando…
            </span>
          )}
          {target.kind === 'DIRECT' && onStartCall && (
            <button
              type="button"
              onClick={onStartCall}
              className="has-tooltip relative grid h-8 w-8 place-items-center rounded text-interactive transition hover:text-header"
              aria-label="Iniciar chamada"
            >
              <Phone size={22} />
              <span className="tooltip tooltip-top text-xs">Iniciar chamada de voz</span>
            </button>
          )}
          {headerActions}
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        onScroll={handleHistoryScroll}
        className="min-h-0 flex-1 overflow-y-auto pb-6"
        aria-label="Histórico de mensagens"
      >
        {loadingOlder && (
          <p className="py-3 text-center text-xs text-muted" role="status">Carregando mensagens anteriores…</p>
        )}
        {loading && <HistorySkeleton />}
        {!loading && historyError && messages.length === 0 && (
          <div className="mx-4 mt-6 rounded-md bg-danger/10 px-4 py-3 text-sm text-text">
            Não foi possível carregar o histórico. Você ainda pode enviar uma nova mensagem.
          </div>
        )}
        {!loading && !historyError && historyComplete && (
          <ConversationStart target={target} />
        )}
        <div className="flex flex-col">
          {timeline.map(({ message, grouped, newDay }) => (
            <div key={message.id}>
              {newDay && (
                <div role="separator" className="mx-4 my-2 flex items-center gap-1 pt-2">
                  <span className="h-px flex-1 bg-divider" />
                  <span className="px-1 text-xs font-semibold text-faint">{formatDay(message.createdAt)}</span>
                  <span className="h-px flex-1 bg-divider" />
                </div>
              )}
              <article
                className={`message-line relative pl-[72px] pr-4 ${grouped ? 'py-0.5' : 'mt-[17px] min-h-11 py-0.5'}`}
                aria-label={`${message.authorName}, ${formatTimestamp(message.createdAt)}`}
              >
                {grouped ? (
                  <time className="message-hover-time absolute left-0 top-1 w-[56px] text-right text-[11px] leading-[1.375rem] text-faint" dateTime={message.createdAt}>
                    {formatTime(message.createdAt)}
                  </time>
                ) : (
                  <>
                    <span className="absolute left-4 top-0.5">
                      <Avatar name={message.authorName} seed={String(message.authorId)} size="md" />
                    </span>
                    <h3 className="flex items-baseline gap-2 leading-[1.375rem]">
                      <span className={`truncate text-base font-medium ${String(message.authorId) === String(currentUser.id) ? 'text-[#c9c3ff]' : 'text-header'}`}>
                        {message.authorName}
                      </span>
                      <time className="shrink-0 text-xs text-faint" dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
                    </h3>
                  </>
                )}
                {message.content && (
                  <p className="whitespace-pre-wrap text-base leading-[1.375rem] text-text [overflow-wrap:anywhere]">
                    <LinkifiedText text={message.content} />
                  </p>
                )}
                <MessageAttachments
                  attachments={message.attachments ?? []}
                  onExpiredAction={refreshAttachmentUrls}
                />
              </article>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={sendMessage}
        className="relative z-10 shrink-0 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="rounded-lg bg-input">
          {queuedAttachments.length > 0 && (
            <QueuedAttachmentTray
              attachments={queuedAttachments}
              onRemoveAction={removeQueuedAttachment}
              onRetryAction={attachment => void uploadQueuedAttachment(attachment)}
            />
          )}
          <div className="flex items-start">
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
              className="has-tooltip relative grid h-11 w-14 shrink-0 place-items-center text-interactive transition hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Anexar arquivos"
            >
              <PlusCircle size={24} />
              <span className="tooltip tooltip-top text-xs">Até 4 arquivos de 10 MiB</span>
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
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              maxLength={4000}
              className="max-h-[50vh] min-h-11 flex-1 resize-none bg-transparent py-[11px] pr-2 text-base leading-[1.375rem] text-text outline-none [field-sizing:content] placeholder:text-faint"
              placeholder={placeholder}
              aria-label="Mensagem"
            />
            {remainingCharacters <= 500 && (
              <span className={`self-end pb-3 pr-1 text-xs tabular-nums ${remainingCharacters <= 100 ? 'text-danger' : 'text-faint'}`}>
                {remainingCharacters}
              </span>
            )}
            <button
              type="submit"
              disabled={(!draft.trim() && !queuedAttachments.some(attachment => attachment.status === 'uploaded')) ||
                sending || queuedAttachments.some(attachment => attachment.status !== 'uploaded')}
              aria-label="Enviar mensagem"
              className="grid h-11 w-12 shrink-0 place-items-center text-interactive transition enabled:hover:text-brand disabled:cursor-not-allowed disabled:opacity-30"
            >
              {sending ? <Loader2 size={20} className="animate-spin" /> : <SendHorizontal size={20} />}
            </button>
          </div>
        </div>
      </form>

      {draggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-30 grid animate-fade-in place-items-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-brand p-2 shadow-2xl">
            <div className="rounded-xl border-2 border-dashed border-white/60 px-6 py-10 text-center text-white">
              <Upload size={40} className="mx-auto" />
              <p className="mt-3 text-xl font-bold">Carregar para {isServerChannel ? `#${target.title}` : target.title}</p>
              <p className="mt-1 text-sm text-white/80">Imagens, GIFs, vídeos e documentos até 10 MiB.</p>
            </div>
          </div>
        </div>
      )}
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
    <div className="flex gap-3 overflow-x-auto border-b border-black/20 px-3 pb-3 pt-4" aria-label="Anexos selecionados">
      {attachments.map(attachment => (
        <article key={attachment.localId} className="relative flex w-[200px] shrink-0 flex-col rounded-md bg-sidebar p-2">
          {attachment.previewUrl && attachment.file.type.startsWith('image/') ? (
            <div className="relative h-32 w-full overflow-hidden rounded bg-black/30">
              <Image src={attachment.previewUrl} alt="" fill unoptimized sizes="200px" className="object-contain" />
            </div>
          ) : attachment.previewUrl && attachment.file.type.startsWith('video/') ? (
            <video src={attachment.previewUrl} muted preload="metadata" className="h-32 w-full rounded bg-black object-contain" />
          ) : (
            <span className="grid h-32 w-full place-items-center rounded bg-floating/60 text-interactive" aria-hidden="true">
              <FileText size={40} />
            </span>
          )}
          <p className="mt-2 truncate text-sm text-text">{attachment.file.name}</p>
          <p className={`truncate text-xs ${attachment.status === 'error' ? 'text-danger' : 'text-muted'}`}>
            {attachment.status === 'reserving' && 'Preparando upload…'}
            {attachment.status === 'uploading' && `Enviando… ${attachment.progress}%`}
            {attachment.status === 'uploaded' && `Pronto · ${formatAttachmentSize(attachment.file.size)}`}
            {attachment.status === 'error' && attachment.error}
          </p>
          {(attachment.status === 'uploading' || attachment.status === 'reserving') && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-floating">
              <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(4, attachment.progress)}%` }} />
            </div>
          )}
          <div className="absolute -right-2 -top-2 flex overflow-hidden rounded-md bg-main shadow-lg ring-1 ring-black/30">
            {attachment.status === 'error' && (
              <button
                type="button"
                onClick={() => onRetryAction(attachment)}
                className="grid h-8 w-8 place-items-center text-interactive transition hover:bg-hover hover:text-text"
                aria-label={`Tentar enviar ${attachment.file.name} novamente`}
                title="Tentar novamente"
              >
                <RotateCw size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemoveAction(attachment)}
              className="grid h-8 w-8 place-items-center text-danger transition hover:bg-hover"
              aria-label={`Remover ${attachment.file.name}`}
              title={attachment.status === 'uploading' || attachment.status === 'reserving' ? 'Cancelar upload' : 'Remover anexo'}
            >
              <X size={16} />
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
        className="text-link hover:underline"
      >
        {part}
      </a>
    );
  });
}

function ConversationStart({ target }: { target: TextTarget }) {
  if (target.kind === 'SERVER_TEXT') {
    return (
      <div className="mx-4 mb-2 mt-6">
        <div className="grid h-[68px] w-[68px] place-items-center rounded-full bg-[#41434a] text-header">
          <Hash size={42} />
        </div>
        <h2 className="mt-2 text-[32px] font-bold leading-10 text-header">Boas-vindas a #{target.title}!</h2>
        <p className="text-muted">Este é o começo do canal #{target.title}.</p>
      </div>
    );
  }
  return (
    <div className="mx-4 mb-2 mt-6">
      <Avatar name={target.title} seed={target.participantId ?? target.title} size="lg" />
      <h2 className="mt-2 text-[32px] font-bold leading-10 text-header">{target.title}</h2>
      <p className="text-muted">
        Este é o começo do seu histórico de mensagens diretas com <strong className="font-semibold text-text">{target.title}</strong>.
      </p>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-6 px-4 pt-6" role="status" aria-label="Carregando mensagens">
      {[[38, 72], [24, 55], [31, 80]].map(([nameWidth, lineWidth]) => (
        <div key={`${nameWidth}-${lineWidth}`} className="flex gap-4">
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-hover" />
          <div className="flex-1 space-y-2 pt-1">
            <span className="block h-3 animate-pulse rounded bg-hover" style={{ width: `${nameWidth}%` }} />
            <span className="block h-3 animate-pulse rounded bg-hover/70" style={{ width: `${lineWidth}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
