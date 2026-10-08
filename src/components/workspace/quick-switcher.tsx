'use client';

import { Hash, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar, colorFor, initials } from '../ui/avatar';

export type SwitcherItem =
  | { kind: 'friend'; id: string; name: string; hint: string }
  | { kind: 'server'; id: string; name: string; hint: string }
  | { kind: 'channel'; id: string; name: string; hint: string; channelType: 'TEXT' | 'VOICE' };

/** Atalho Ctrl/⌘+K para pular para amigos, servidores e canais, como em clientes de comunidade. */
export function QuickSwitcher({
  items,
  onSelect,
  onClose,
}: {
  items: SwitcherItem[];
  onSelect: (item: SwitcherItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const normalized = query.trim().replace(/^[#@*]/, '').toLocaleLowerCase('pt-BR');
    const prefix = query.trim().charAt(0);
    const kind = prefix === '@' ? 'friend' : prefix === '#' ? 'channel' : prefix === '*' ? 'server' : null;
    return items
      .filter(item => !kind || item.kind === kind)
      .filter(item => !normalized || item.name.toLocaleLowerCase('pt-BR').includes(normalized))
      .slice(0, 12);
  }, [items, query]);
  const clampedIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${clampedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-black/70 p-4 pt-[15vh]"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-label="Buscar conversa" className="w-full max-w-[570px] animate-pop-in rounded-lg bg-sidebar p-4 shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex(Math.min(clampedIndex + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(Math.max(clampedIndex - 1, 0));
            }
            if (event.key === 'Enter' && results[clampedIndex]) {
              event.preventDefault();
              onSelect(results[clampedIndex]);
            }
          }}
          placeholder="Para onde você gostaria de ir?"
          aria-label="Para onde você gostaria de ir?"
          className="h-[70px] w-full rounded-md bg-floating px-4 text-lg text-text outline-none placeholder:text-faint"
        />
        <ul ref={listRef} className="mt-3 max-h-80 overflow-y-auto" role="listbox" aria-label="Resultados">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nada encontrado para “{query}”.</li>}
          {results.map((item, index) => (
            <li key={`${item.kind}-${item.id}`} role="option" aria-selected={index === clampedIndex} data-index={index}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(item)}
                className={`flex h-10 w-full items-center gap-2.5 rounded px-2 text-left transition ${index === clampedIndex ? 'bg-selected text-header' : 'text-muted'}`}
              >
                <ItemIcon item={item} />
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                <span className="shrink-0 truncate text-xs font-semibold uppercase text-faint">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          <span className="font-bold text-success">DICA:</span> comece com <Kbd>@</Kbd> para amigos, <Kbd>#</Kbd> para canais e <Kbd>*</Kbd> para servidores.
        </p>
      </section>
    </div>
  );
}

function ItemIcon({ item }: { item: SwitcherItem }) {
  if (item.kind === 'friend') return <Avatar name={item.name} seed={item.id} size="xs" />;
  if (item.kind === 'channel') {
    return item.channelType === 'VOICE' ? <Volume2 size={18} className="text-faint" /> : <Hash size={18} className="text-faint" />;
  }
  return (
    <span className="grid h-6 w-6 place-items-center rounded-lg text-[10px] font-semibold text-white" style={{ backgroundColor: colorFor(item.id) }} aria-hidden="true">
      {initials(item.name, 2)}
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded bg-floating px-1 font-mono text-[11px] text-text">{children}</kbd>;
}
