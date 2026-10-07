'use client';

import { AlertTriangle, MessageCircle, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ServerSummary } from '@/src/types';
import { colorFor, initials } from '../ui/avatar';

/**
 * Coluna de servidores: ícones circulares que viram “squircle” no hover/seleção, com a pílula branca
 * à esquerda indicando o servidor ativo (maior) ou o hover (menor).
 */
export function ServerRail({
  servers,
  activeServerId,
  loading,
  error,
  homeBadge,
  voiceServerId,
  onHome,
  onServer,
  onCreate,
  onRetry,
}: {
  servers: ServerSummary[];
  activeServerId: string | null;
  loading: boolean;
  error: string | null;
  homeBadge: number;
  voiceServerId: string | null;
  onHome: () => void;
  onServer: (server: ServerSummary) => void;
  onCreate: () => void;
  onRetry: () => void;
}) {
  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center bg-rail pt-3" aria-label="Servidores">
      <RailItem label="Início" tooltip="Mensagens diretas" active={activeServerId === null} badge={homeBadge} onClick={onHome}>
        <span className={`grid h-12 w-12 place-items-center transition-all duration-150 ${activeServerId === null ? 'rounded-2xl bg-brand text-white' : 'rounded-3xl bg-main text-text group-hover:rounded-2xl group-hover:bg-brand group-hover:text-white'}`}>
          <MessageCircle size={26} strokeWidth={2.2} />
        </span>
      </RailItem>
      <div className="mx-auto my-2 h-0.5 w-8 shrink-0 rounded-full bg-[#35363c]" />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto pb-3 [scrollbar-width:none]">
        {loading && Array.from({ length: 3 }, (_, index) => (
          <span key={index} className="h-12 w-12 shrink-0 animate-pulse rounded-3xl bg-main" aria-hidden="true" />
        ))}
        {loading && <span className="sr-only">Carregando servidores</span>}
        {!loading && error && (
          <RailItem label="Tentar carregar servidores novamente" tooltip={error} onClick={onRetry}>
            <span className="grid h-12 w-12 place-items-center rounded-3xl bg-danger/15 text-danger transition-all group-hover:rounded-2xl">
              <AlertTriangle size={22} />
            </span>
          </RailItem>
        )}
        {!loading && !error && servers.map(server => {
          const active = activeServerId === server.id;
          return (
            <RailItem
              key={server.id}
              label={server.name}
              tooltip={server.name}
              active={active}
              inVoice={voiceServerId === server.id}
              onClick={() => onServer(server)}
            >
              <span
                className={`grid h-12 w-12 place-items-center text-[15px] font-semibold transition-all duration-150 ${active ? 'rounded-2xl bg-(--server-color) text-white' : 'rounded-3xl bg-main text-text group-hover:rounded-2xl group-hover:bg-(--server-color) group-hover:text-white'}`}
                style={{ ['--server-color' as string]: colorFor(server.id) }}
              >
                {initials(server.name, 2)}
              </span>
            </RailItem>
          );
        })}
        {!loading && (
          <RailItem label="Criar servidor" tooltip="Adicionar um servidor" onClick={onCreate}>
            <span className="grid h-12 w-12 place-items-center rounded-3xl bg-main text-success transition-all duration-150 group-hover:rounded-2xl group-hover:bg-success group-hover:text-white">
              <Plus size={24} />
            </span>
          </RailItem>
        )}
      </div>
    </nav>
  );
}

function RailItem({
  label,
  tooltip,
  active = false,
  badge = 0,
  inVoice = false,
  onClick,
  children,
}: {
  label: string;
  tooltip: string;
  active?: boolean;
  badge?: number;
  inVoice?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative flex w-full shrink-0 justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className="has-tooltip group relative"
      >
        <span
          className={`pointer-events-none absolute -left-3 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white transition-all duration-150 ${active ? 'h-10' : 'h-0 group-hover:h-5'}`}
          aria-hidden="true"
        />
        {children}
        {badge > 0 && (
          <span className="absolute -bottom-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full border-4 border-rail bg-danger px-1 text-[11px] font-bold leading-none text-white box-content">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {inVoice && (
          <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-[3px] border-rail bg-success" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
        )}
        <span className="tooltip tooltip-right" role="presentation">{tooltip}</span>
      </button>
    </div>
  );
}
