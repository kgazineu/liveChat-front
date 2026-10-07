'use client';

import {
  ChevronDown,
  ChevronRight,
  Hash,
  MicOff,
  Plus,
  PlusCircle,
  UserPlus,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChannelType, MediaSession, MediaTarget, ServerChannel, ServerSummary } from '@/src/types';
import { storedParticipantVolume } from '../media-room';
import { Avatar } from '../ui/avatar';

type SidebarSelection = { kind: string; channelId: string } | null;

export function ServerSidebar({
  server,
  channelsLoading,
  channelsError,
  textChannels,
  voiceChannels,
  voiceSessionsByChannel,
  speakingUserIds,
  participantVolumes,
  currentUserId,
  selectedTarget,
  activeMediaTarget,
  onSelectChannel,
  onRetry,
  onCreateChannel,
  onInvite,
  onParticipantVolumeChange,
  onClose,
}: {
  server: ServerSummary;
  channelsLoading: boolean;
  channelsError: string | null;
  textChannels: ServerChannel[];
  voiceChannels: ServerChannel[];
  voiceSessionsByChannel: Record<string, MediaSession[]>;
  speakingUserIds: string[];
  participantVolumes: Record<string, number>;
  currentUserId: string;
  selectedTarget: SidebarSelection;
  activeMediaTarget: MediaTarget | null;
  onSelectChannel: (channel: ServerChannel) => void;
  onRetry: () => void;
  onCreateChannel: (type: ChannelType) => void;
  onInvite: () => void;
  onParticipantVolumeChange: (userId: string, volume: number) => void;
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<ChannelType, boolean>>({ TEXT: false, VOICE: false });
  const [selectedVoiceParticipant, setSelectedVoiceParticipant] = useState<string | null>(null);
  const owner = server.role === 'OWNER';
  const empty = !channelsLoading && !channelsError && textChannels.length === 0 && voiceChannels.length === 0;

  const selectedText = (channel: ServerChannel) =>
    selectedTarget?.kind === 'SERVER_TEXT' && selectedTarget.channelId === channel.id;
  const connectedVoice = (channel: ServerChannel) =>
    activeMediaTarget?.kind === 'SERVER_VOICE' && activeMediaTarget.channelId === channel.id;
  const selectedVoice = (channel: ServerChannel) =>
    (selectedTarget?.kind === 'SERVER_VOICE' && selectedTarget.channelId === channel.id) || connectedVoice(channel);

  return (
    <>
      <ServerMenu
        server={server}
        open={menuOpen}
        onToggle={() => setMenuOpen(open => !open)}
        onCloseMenu={() => setMenuOpen(false)}
        onInvite={onInvite}
        onCreateChannel={() => onCreateChannel('TEXT')}
        onCloseNavigation={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-3">
        {channelsLoading && <ChannelSkeleton />}
        {!channelsLoading && channelsError && (
          <div className="mx-1 rounded-md bg-danger/10 p-3 text-center">
            <p className="text-sm text-text">{channelsError}</p>
            <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold text-link hover:underline">Tentar novamente</button>
          </div>
        )}
        {empty && (
          <div className="mx-1 rounded-md bg-panel p-4 text-center">
            <p className="text-sm font-semibold text-header">Nenhum canal ainda</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {owner ? 'Crie o primeiro canal para a conversa começar.' : 'O dono do servidor ainda não criou canais.'}
            </p>
            {owner && (
              <button type="button" onClick={() => onCreateChannel('TEXT')} className="mt-3 rounded-[3px] bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                Criar canal
              </button>
            )}
          </div>
        )}

        {!channelsLoading && !channelsError && textChannels.length > 0 && (
          <ChannelCategory
            title="Canais de texto"
            collapsed={collapsed.TEXT}
            onToggle={() => setCollapsed(state => ({ ...state, TEXT: !state.TEXT }))}
            onCreate={owner ? () => onCreateChannel('TEXT') : undefined}
            createLabel="Criar canal de texto"
          >
            {textChannels
              .filter(channel => !collapsed.TEXT || selectedText(channel))
              .map(channel => (
                <ChannelButton
                  key={channel.id}
                  label={channel.name}
                  icon={<Hash size={20} />}
                  active={selectedText(channel)}
                  onClick={() => onSelectChannel(channel)}
                />
              ))}
          </ChannelCategory>
        )}

        {!channelsLoading && !channelsError && voiceChannels.length > 0 && (
          <ChannelCategory
            title="Canais de voz"
            collapsed={collapsed.VOICE}
            onToggle={() => setCollapsed(state => ({ ...state, VOICE: !state.VOICE }))}
            onCreate={owner ? () => onCreateChannel('VOICE') : undefined}
            createLabel="Criar canal de voz"
          >
            {voiceChannels.map(channel => {
              const sessions = voiceSessionsByChannel[channel.id] ?? [];
              if (collapsed.VOICE && !selectedVoice(channel) && sessions.length === 0) return null;
              return (
                <div key={channel.id}>
                  <ChannelButton
                    label={channel.name}
                    icon={<Volume2 size={20} />}
                    active={selectedVoice(channel)}
                    connected={connectedVoice(channel)}
                    onClick={() => onSelectChannel(channel)}
                  />
                  {sessions.length > 0 && (
                    <ul className="mb-1 ml-6 mt-0.5 space-y-px" aria-label={`Participantes em ${channel.name}`}>
                      {sessions.map(session => (
                        <VoiceParticipant
                          key={session.userId}
                          session={session}
                          channelId={channel.id}
                          mine={String(session.userId) === String(currentUserId)}
                          speaking={connectedVoice(channel) && speakingUserIds.includes(String(session.userId))}
                          selected={selectedVoiceParticipant === `${channel.id}:${session.userId}`}
                          volume={participantVolumes[String(session.userId)]}
                          onToggle={key => setSelectedVoiceParticipant(current => current === key ? null : key)}
                          onVolumeChange={onParticipantVolumeChange}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </ChannelCategory>
        )}
      </div>
    </>
  );
}

function ServerMenu({
  server,
  open,
  onToggle,
  onCloseMenu,
  onInvite,
  onCreateChannel,
  onCloseNavigation,
}: {
  server: ServerSummary;
  open: boolean;
  onToggle: () => void;
  onCloseMenu: () => void;
  onInvite: () => void;
  onCreateChannel: () => void;
  onCloseNavigation: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onCloseMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMenu();
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onCloseMenu, open]);

  return (
    <div ref={menuRef} className="relative z-20 shrink-0">
      <div className="flex h-12 items-center shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05),0_2px_0_rgba(4,4,5,0.05)]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-haspopup="menu"
          className={`flex h-full min-w-0 flex-1 items-center gap-2 px-4 text-left transition ${open ? 'bg-hover' : 'hover:bg-hover'}`}
        >
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-header">{server.name}</span>
          {open ? <X size={18} className="shrink-0 text-interactive" /> : <ChevronDown size={18} className="shrink-0 text-interactive" />}
        </button>
        <button type="button" onClick={onCloseNavigation} className="mr-2 grid h-8 w-8 place-items-center rounded text-interactive hover:text-header md:hidden" aria-label="Fechar navegação">
          <X size={18} />
        </button>
      </div>
      {open && (
        <div role="menu" className="absolute inset-x-2 top-[52px] animate-pop-in rounded-md bg-floating p-1.5 shadow-2xl">
          <MenuItem
            icon={<UserPlus size={18} />}
            label="Convidar pessoas"
            className="text-[#949cf7] hover:bg-brand hover:text-white"
            onClick={() => {
              onCloseMenu();
              onInvite();
            }}
          />
          {server.role === 'OWNER' && (
            <MenuItem
              icon={<PlusCircle size={18} />}
              label="Criar canal"
              onClick={() => {
                onCloseMenu();
                onCreateChannel();
              }}
            />
          )}
          <div className="mx-1 my-1 h-px bg-[#2e2f34]" />
          <p className="px-2 py-1.5 text-xs text-muted">
            {server.role === 'OWNER' ? 'Você é o dono deste servidor' : 'Você é membro deste servidor'}
          </p>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, className = 'text-interactive hover:bg-brand hover:text-white' }: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm font-medium transition ${className}`}>
      <span>{label}</span>
      {icon}
    </button>
  );
}

function ChannelCategory({
  title,
  collapsed,
  onToggle,
  onCreate,
  createLabel,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  onCreate?: () => void;
  createLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="group flex items-center pr-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-0.5 py-1.5 pl-0.5 text-left text-xs font-semibold uppercase tracking-[0.02em] text-muted transition hover:text-text"
        >
          {collapsed ? <ChevronRight size={12} strokeWidth={3} /> : <ChevronDown size={12} strokeWidth={3} />}
          <h2 className="truncate">{title}</h2>
        </button>
        {onCreate && (
          <button type="button" onClick={onCreate} className="has-tooltip relative grid h-5 w-5 place-items-center text-muted transition hover:text-text" aria-label={createLabel}>
            <Plus size={16} />
            <span className="tooltip tooltip-top text-xs">{createLabel}</span>
          </button>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function ChannelButton({ label, icon, active, connected = false, onClick }: {
  label: string;
  icon: ReactNode;
  active: boolean;
  connected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[15px] font-medium leading-5 transition ${active ? 'bg-selected text-header' : 'text-muted hover:bg-hover hover:text-text'}`}
    >
      <span className={`shrink-0 ${connected ? 'text-success' : active ? 'text-header' : 'text-faint'}`} aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function VoiceParticipant({
  session,
  channelId,
  mine,
  speaking,
  selected,
  volume,
  onToggle,
  onVolumeChange,
}: {
  session: MediaSession;
  channelId: string;
  mine: boolean;
  speaking: boolean;
  selected: boolean;
  volume: number | undefined;
  onToggle: (key: string) => void;
  onVolumeChange: (userId: string, volume: number) => void;
}) {
  const userId = String(session.userId);
  const key = `${channelId}:${userId}`;
  const currentVolume = volume ?? storedParticipantVolume(userId);
  const reconnecting = session.status === 'RECONNECTING';

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (!mine) onToggle(key);
        }}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition ${selected ? 'bg-hover text-text' : 'text-muted hover:bg-hover hover:text-text'} ${reconnecting ? 'opacity-60' : ''}`}
        aria-label={mine ? `${session.userName} (você)` : `Configurar áudio de ${session.userName}`}
        aria-expanded={mine ? undefined : selected}
        title={reconnecting ? 'Reconectando…' : undefined}
      >
        <span className="relative shrink-0">
          <Avatar name={session.userName} seed={userId} size="xs" speaking={speaking} />
          <span className="sr-only" aria-label={speaking ? `${session.userName} está falando` : `${session.userName} não está falando`} />
        </span>
        <span className={`min-w-0 flex-1 truncate ${speaking ? 'text-header' : ''}`}>{session.userName}</span>
        {session.screenShareEnabled && (
          <span className="rounded-full bg-danger px-1.5 py-px text-[10px] font-bold uppercase leading-4 text-white">Ao vivo</span>
        )}
        {session.cameraEnabled && <Video size={14} className="shrink-0 text-interactive" aria-label="Câmera ligada" />}
        {!session.microphoneEnabled && <MicOff size={14} className="shrink-0 text-interactive" aria-label="Microfone desligado" />}
      </button>
      {selected && (
        <label className="mx-1 mb-1 mt-1 flex items-center gap-2 rounded-md bg-floating px-2.5 py-2 text-[11px] text-muted">
          <span className="shrink-0 font-semibold uppercase">Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={currentVolume}
            onChange={event => onVolumeChange(userId, Number(event.currentTarget.value))}
            className="h-1 min-w-0 flex-1"
            aria-label={`Volume de ${session.userName}`}
          />
          <span className="w-8 text-right tabular-nums">{Math.round(currentVolume * 100)}%</span>
        </label>
      )}
    </li>
  );
}

function ChannelSkeleton() {
  return (
    <div className="space-y-2 px-2 pt-1" aria-label="Carregando canais" role="status">
      {[70, 55, 80, 45].map(width => (
        <div key={width} className="flex items-center gap-2">
          <span className="h-4 w-4 animate-pulse rounded bg-hover" />
          <span className="h-3 animate-pulse rounded bg-hover" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}
