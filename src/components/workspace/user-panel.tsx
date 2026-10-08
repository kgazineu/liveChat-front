'use client';

import { Activity, Headphones, HeadphoneOff, LogOut, Mic, MicOff, Settings, UserCog } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CurrentUser } from '@/src/types';
import { Avatar } from '../ui/avatar';

export function UserPanel({
  currentUser,
  inCall,
  microphoneMuted,
  deafened,
  showMetricsToggle,
  metricsVisible,
  onToggleMicrophone,
  onToggleDeafen,
  onOpenAccount,
  onToggleMetrics,
  onLogout,
}: {
  currentUser: CurrentUser;
  inCall: boolean;
  microphoneMuted: boolean;
  deafened: boolean;
  showMetricsToggle: boolean;
  metricsVisible: boolean;
  onToggleMicrophone: () => void;
  onToggleDeafen: () => void;
  onOpenAccount: () => void;
  onToggleMetrics: () => void;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const micOff = microphoneMuted || deafened;

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div ref={panelRef} className="relative shrink-0 bg-panel">
      {menuOpen && (
        <div role="menu" aria-label="Configurações" className="absolute bottom-[calc(100%+8px)] left-2 right-2 z-40 animate-slide-up overflow-hidden rounded-lg bg-floating p-1.5 shadow-2xl">
          <div className="mb-1 flex items-center gap-3 rounded-md px-2 py-2">
            <Avatar name={currentUser.name} seed={currentUser.id} size="md" status="online" statusRing="border-floating" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-header">{currentUser.name}</p>
              <p className="truncate text-xs text-muted">{currentUser.email}</p>
            </div>
          </div>
          <div className="mx-1 mb-1 h-px bg-[#2e2f34]" />
          <MenuButton icon={<UserCog size={18} />} onClick={() => {
            setMenuOpen(false);
            onOpenAccount();
          }}>
            Configurações da conta
          </MenuButton>
          {showMetricsToggle && (
            <MenuButton icon={<Activity size={18} />} onClick={() => {
              setMenuOpen(false);
              onToggleMetrics();
            }}>
              {metricsVisible ? 'Ocultar qualidade WebRTC' : 'Mostrar qualidade WebRTC'}
            </MenuButton>
          )}
          <div className="mx-1 my-1 h-px bg-[#2e2f34]" />
          <MenuButton icon={<LogOut size={18} />} danger onClick={() => {
            setMenuOpen(false);
            onLogout();
          }}>
            Sair da conta
          </MenuButton>
        </div>
      )}

      <div className="flex h-[52px] items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded px-0.5 py-1">
          <Avatar name={currentUser.name} seed={currentUser.id} size="sm" status="online" statusRing="border-panel" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-header">{currentUser.name}</p>
            <p className={`truncate text-xs ${inCall ? 'text-success' : 'text-muted'}`}>{inCall ? 'Em chamada' : 'Online'}</p>
          </div>
        </div>
        <PanelButton
          label={micOff ? 'Ativar microfone' : 'Silenciar microfone'}
          pressed={micOff}
          danger={micOff}
          onClick={onToggleMicrophone}
        >
          {micOff ? <MicOff size={20} /> : <Mic size={20} />}
        </PanelButton>
        <PanelButton
          label={deafened ? 'Ativar áudio' : 'Desativar áudio'}
          pressed={deafened}
          danger={deafened}
          onClick={onToggleDeafen}
        >
          {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
        </PanelButton>
        <PanelButton
          label="Abrir configurações"
          pressed={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          <Settings size={20} />
        </PanelButton>
      </div>
    </div>
  );
}

function PanelButton({ label, pressed, danger = false, onClick, children }: {
  label: string;
  pressed: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={`has-tooltip relative grid h-8 w-8 shrink-0 place-items-center rounded transition hover:bg-hover ${danger ? 'text-danger' : 'text-interactive hover:text-text'}`}
    >
      {children}
      <span className="tooltip tooltip-top text-xs">{label}</span>
    </button>
  );
}

function MenuButton({ icon, danger = false, onClick, children }: {
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm font-medium transition ${danger ? 'text-danger hover:bg-danger hover:text-white' : 'text-interactive hover:bg-brand hover:text-white'}`}
    >
      <span>{children}</span>
      {icon}
    </button>
  );
}
