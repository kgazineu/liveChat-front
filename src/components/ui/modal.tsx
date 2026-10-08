'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { linkButtonClass, primaryButtonClass, sectionLabelClass } from './styles';

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.contains(document.activeElement)) return;
    dialog.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/70 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`relative w-full animate-pop-in overflow-hidden rounded-md bg-main shadow-2xl ${size === 'lg' ? 'max-w-2xl' : 'max-w-[440px]'}`}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded text-interactive transition hover:text-header"
          aria-label="Fechar"
        >
          <X size={22} />
        </button>
        <header className="px-4 pb-2 pt-6 text-center">
          <h2 id={titleId} className="text-2xl font-bold text-header">{title}</h2>
          {description && <p id={descriptionId} className="mt-2 text-[15px] leading-5 text-muted">{description}</p>}
        </header>
        <div className="px-4 pb-4 pt-2">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 bg-sidebar p-4">{footer}</footer>}
      </section>
    </div>
  );
}

export function ModalActions({
  busy,
  disabled = false,
  onCancel,
  submitLabel,
  submitClassName = primaryButtonClass,
}: {
  busy: boolean;
  disabled?: boolean;
  onCancel: () => void;
  submitLabel: string;
  submitClassName?: string;
}) {
  return (
    <div className="-mx-4 -mb-4 mt-4 flex items-center justify-end gap-2 bg-sidebar p-4">
      <button type="button" className={linkButtonClass} onClick={onCancel} disabled={busy}>Cancelar</button>
      <button type="submit" className={`${submitClassName} min-w-24`} disabled={busy || disabled}>
        {busy ? 'Aguarde…' : submitLabel}
      </button>
    </div>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={`mb-2 block ${sectionLabelClass}`}>{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
