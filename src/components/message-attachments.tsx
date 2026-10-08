'use client';

import Image from 'next/image';
import { Download, FileText, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatAttachmentSize } from '@/src/services/attachments';
import type { MessageAttachment } from '@/src/types';

export function MessageAttachments({
  attachments,
  onExpiredAction,
}: {
  attachments: MessageAttachment[];
  onExpiredAction: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = attachments.find(attachment => attachment.id === expandedId) ?? null;
  if (attachments.length === 0) return null;

  return (
    <>
      <div className="mt-1 grid max-w-[550px] gap-2 sm:grid-cols-2">
        {attachments.map(attachment => (
          <AttachmentCard
            key={attachment.id}
            attachment={attachment}
            onExpandAction={() => setExpandedId(attachment.id)}
            onExpiredAction={onExpiredAction}
          />
        ))}
      </div>
      {expanded && (
        <AttachmentViewer attachment={expanded} onCloseAction={() => setExpandedId(null)} onExpiredAction={onExpiredAction} />
      )}
    </>
  );
}

function AttachmentCard({
  attachment,
  onExpandAction,
  onExpiredAction,
}: {
  attachment: MessageAttachment;
  onExpandAction: () => void;
  onExpiredAction: () => void;
}) {
  const expirationReportedRef = useRef<string | null>(null);
  const isImage = attachment.contentType.startsWith('image/');
  const isVideo = attachment.contentType.startsWith('video/');

  const reportExpired = useCallback(() => {
    if (expirationReportedRef.current === attachment.downloadUrl) return;
    expirationReportedRef.current = attachment.downloadUrl;
    onExpiredAction();
  }, [attachment.downloadUrl, onExpiredAction]);

  useEffect(() => {
    expirationReportedRef.current = null;
    const expiration = Date.parse(attachment.downloadExpiresAt);
    if (!Number.isFinite(expiration)) return;
    let timer: number | undefined;
    const scheduleRefresh = () => {
      const remaining = expiration - Date.now() - 5000;
      if (remaining <= 0) {
        reportExpired();
        return;
      }
      timer = window.setTimeout(scheduleRefresh, Math.min(remaining, 2_147_000_000));
    };
    scheduleRefresh();
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [attachment.downloadExpiresAt, attachment.downloadUrl, reportExpired]);

  if (isImage) {
    return (
      <figure className="overflow-hidden rounded-lg bg-sidebar">
        <button
          type="button"
          onClick={onExpandAction}
          className="group relative block h-56 w-full overflow-hidden bg-black/20"
          aria-label={`Ampliar ${attachment.originalName}`}
        >
          <Image
            src={attachment.downloadUrl}
            alt={attachment.originalName}
            fill
            unoptimized
            loading="lazy"
            sizes="(max-width: 640px) 100vw, 320px"
            className="object-contain transition group-hover:scale-[1.02]"
            onError={reportExpired}
          />
        </button>
        <AttachmentCaption attachment={attachment} />
      </figure>
    );
  }

  if (isVideo) {
    return (
      <figure className="overflow-hidden rounded-lg bg-sidebar">
        <video
          src={attachment.downloadUrl}
          controls
          playsInline
          preload="metadata"
          className="h-56 w-full bg-black object-contain"
          aria-label={attachment.originalName}
          onError={reportExpired}
        />
        <AttachmentCaption attachment={attachment} />
      </figure>
    );
  }

  return (
    <a
      href={attachment.downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.originalName}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-black/20 bg-sidebar p-3 text-left transition hover:bg-hover"
      onClick={() => {
        if (Date.parse(attachment.downloadExpiresAt) <= Date.now()) reportExpired();
      }}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center text-[#949cf7]" aria-hidden="true"><FileText size={34} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-link">{attachment.originalName}</span>
        <span className="block text-xs text-muted">{formatAttachmentSize(attachment.size)} · Abrir arquivo</span>
      </span>
      <Download size={20} className="shrink-0 text-interactive" aria-hidden="true" />
    </a>
  );
}

function AttachmentCaption({ attachment }: { attachment: MessageAttachment }) {
  return (
    <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
      <span className="truncate">{attachment.originalName}</span>
      <span className="shrink-0">{formatAttachmentSize(attachment.size)}</span>
    </figcaption>
  );
}

function AttachmentViewer({
  attachment,
  onCloseAction,
  onExpiredAction,
}: {
  attachment: MessageAttachment;
  onCloseAction: () => void;
  onExpiredAction: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseAction();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCloseAction]);

  return (
    <div className="fixed inset-0 z-70 flex animate-fade-in flex-col bg-black/90 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={`Visualização de ${attachment.originalName}`}>
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-[#1e1f22] px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-header">{attachment.originalName}</p>
          <p className="text-xs text-muted">{formatAttachmentSize(attachment.size)}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={attachment.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.originalName}
            className="flex items-center gap-1.5 rounded-[3px] bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover"
          >
            <Download size={15} aria-hidden="true" /> Baixar
          </a>
          <button
            type="button"
            onClick={onCloseAction}
            className="grid h-8 w-8 place-items-center rounded text-interactive transition hover:bg-hover hover:text-header"
            aria-label="Fechar visualização do anexo"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg">
        <Image
          src={attachment.downloadUrl}
          alt={attachment.originalName}
          fill
          unoptimized
          priority
          sizes="100vw"
          className="object-contain"
          onError={onExpiredAction}
        />
      </div>
    </div>
  );
}
