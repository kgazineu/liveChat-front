'use client';

import { Crown, MessageCircle, UserPlus, Volume2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/src/services/api';
import { errorMessage } from '@/src/services/errors';
import type { ServerMember, ServerSummary, User } from '@/src/types';
import { Avatar, colorFor } from '../ui/avatar';
import { sectionLabelClass } from '../ui/styles';

type CardAnchor = { top: number; right: number };

export function MembersPanel({
  server,
  currentUserId,
  members,
  loading,
  friends,
  voiceChannelByUserId,
  onMessage,
  onClose,
}: {
  server: ServerSummary;
  currentUserId: string;
  members: ServerMember[];
  loading: boolean;
  friends: User[];
  /** Nome do canal de voz em que cada membro está, quando estiver em um. */
  voiceChannelByUserId: Record<string, string>;
  onMessage: (friend: User) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<{ id: string; anchor: CardAnchor | null } | null>(null);
  const selectedId = selected?.id ?? null;
  const [sendingToId, setSendingToId] = useState<string | null>(null);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const friendIds = useMemo(() => new Set(friends.map(friend => String(friend.id))), [friends]);
  const groups = useMemo(() => {
    const byName = (first: ServerMember, second: ServerMember) => first.userName.localeCompare(second.userName, 'pt-BR');
    return [
      { title: 'Proprietário', members: members.filter(member => member.role === 'OWNER').sort(byName) },
      { title: 'Membros', members: members.filter(member => member.role !== 'OWNER').sort(byName) },
    ].filter(group => group.members.length > 0);
  }, [members]);

  async function addFriend(member: ServerMember) {
    const userId = String(member.userId);
    if (userId === String(currentUserId) || friendIds.has(userId) || sentRequests.has(userId) || sendingToId) return;
    setSendingToId(userId);
    try {
      await api.post('/friendships/send', { targetUserId: member.userId });
      setSentRequests(previous => new Set(previous).add(userId));
      toast.success(`Solicitação enviada para ${member.userName}.`);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível enviar a solicitação de amizade.'));
    } finally {
      setSendingToId(null);
    }
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-sidebar" aria-label={`Membros de ${server.name}`}>
      <header className="flex h-12 shrink-0 items-center justify-between px-4 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05)]">
        <h2 className="text-[15px] font-semibold text-header">Membros — {members.length}</h2>
        <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-interactive hover:text-header lg:hidden" aria-label="Fechar lista de membros">
          <X size={18} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading && (
          <div className="space-y-3 px-2 pt-5" role="status" aria-label="Atualizando membros">
            {[65, 45, 70].map(width => (
              <div key={width} className="flex items-center gap-3">
                <span className="h-8 w-8 animate-pulse rounded-full bg-hover" />
                <span className="h-3 animate-pulse rounded bg-hover" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        )}
        {!loading && groups.map(group => (
          <section key={group.title}>
            <h3 className={`${sectionLabelClass} px-2 pb-1 pt-6`}>{group.title} — {group.members.length}</h3>
            {group.members.map(member => {
              const userId = String(member.userId);
              const mine = userId === String(currentUserId);
              const voiceChannel = voiceChannelByUserId[userId];
              return (
                <div key={member.userId} className="relative">
                  <button
                    type="button"
                    onClick={event => {
                      if (selectedId === userId) {
                        setSelected(null);
                        return;
                      }
                      // Em telas largas o cartão abre ao lado da lista; em telas estreitas, logo abaixo do membro.
                      const rect = event.currentTarget.getBoundingClientRect();
                      const wide = window.matchMedia?.('(min-width: 1024px)').matches ?? false;
                      setSelected({
                        id: userId,
                        anchor: wide
                          ? { top: Math.max(8, Math.min(rect.top, window.innerHeight - 380)), right: window.innerWidth - rect.left + 12 }
                          : null,
                      });
                    }}
                    className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition ${selectedId === userId ? 'bg-selected' : 'hover:bg-hover'}`}
                    aria-label={`Ver ${member.userName}`}
                    data-member-trigger
                    aria-expanded={selectedId === userId}
                  >
                    <Avatar
                      name={member.userName}
                      seed={userId}
                      size="sm"
                      status={voiceChannel ? 'in-call' : undefined}
                      statusRing={selectedId === userId ? 'border-selected' : 'border-sidebar'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-[15px] font-medium text-text">
                          {mine ? `${member.userName} (você)` : member.userName}
                        </span>
                        {member.role === 'OWNER' && <Crown size={14} className="shrink-0 text-warning" aria-label="Proprietário" />}
                      </span>
                      {voiceChannel && (
                        <span className="flex items-center gap-1 truncate text-xs text-muted">
                          <Volume2 size={12} className="shrink-0" /> {voiceChannel}
                        </span>
                      )}
                    </span>
                  </button>
                  {selectedId === userId && (
                    <MemberCard
                      member={member}
                      mine={mine}
                      friend={friendIds.has(userId)}
                      requestSent={sentRequests.has(userId)}
                      sending={sendingToId === userId}
                      busy={sendingToId !== null}
                      voiceChannel={voiceChannel}
                      onAddFriend={() => void addFriend(member)}
                      onMessage={() => onMessage({ id: userId, name: member.userName })}
                      anchor={selected?.anchor ?? null}
                      onClose={() => setSelected(null)}
                    />
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {!loading && members.length === 0 && <p className="px-2 py-6 text-center text-xs text-faint">Nenhum membro disponível.</p>}
      </div>
    </aside>
  );
}

function MemberCard({
  member,
  mine,
  friend,
  requestSent,
  sending,
  busy,
  voiceChannel,
  anchor,
  onAddFriend,
  onMessage,
  onClose,
}: {
  member: ServerMember;
  mine: boolean;
  friend: boolean;
  requestSent: boolean;
  sending: boolean;
  busy: boolean;
  voiceChannel?: string;
  anchor: CardAnchor | null;
  onAddFriend: () => void;
  onMessage: () => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (cardRef.current?.contains(target) || target?.closest?.('[data-member-trigger]')) return;
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnOutside);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnOutside);
    };
  }, [onClose]);

  const joined = new Date(member.joinedAt);
  const joinedLabel = Number.isNaN(joined.valueOf())
    ? null
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(joined);

  return (
    <section
      ref={cardRef}
      aria-label={`Detalhes de ${member.userName}`}
      className={`z-40 animate-pop-in overflow-hidden rounded-lg bg-panel shadow-2xl ${anchor ? 'fixed w-[300px]' : 'relative mt-1 w-full'}`}
      style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
    >
      <div className="h-[60px]" style={{ backgroundColor: colorFor(String(member.userId)) }} />
      <div className="px-4 pb-4">
        <div className="-mt-9 w-fit rounded-full border-[6px] border-panel">
          <Avatar name={member.userName} seed={String(member.userId)} size="lg" status={voiceChannel ? 'in-call' : undefined} statusRing="border-panel" />
        </div>
        <div className="mt-2 rounded-lg bg-floating p-3">
          <p className="truncate text-xl font-bold text-header">{member.userName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-text">
            {member.role === 'OWNER' ? <><Crown size={14} className="text-warning" /> Proprietário</> : 'Membro'}
          </p>
          <div className="my-3 h-px bg-divider/70" />
          {voiceChannel && (
            <p className="mb-3 flex items-center gap-1.5 text-sm text-success"><Volume2 size={14} /> Conectado a {voiceChannel}</p>
          )}
          {joinedLabel && (
            <>
              <p className={sectionLabelClass}>Membro desde</p>
              <p className="mt-1 text-sm text-text">{joinedLabel}</p>
            </>
          )}
          {!mine && (
            friend ? (
              <button
                type="button"
                onClick={onMessage}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[3px] bg-brand px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-hover"
              >
                <MessageCircle size={16} /> Enviar mensagem
              </button>
            ) : (
              <button
                type="button"
                onClick={onAddFriend}
                disabled={requestSent || busy}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[3px] bg-success px-3 py-2 text-sm font-medium text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserPlus size={16} />
                {requestSent ? 'Solicitação enviada' : sending ? 'Enviando…' : 'Adicionar amigo'}
              </button>
            )
          )}
          {mine && <p className="mt-4 rounded bg-sidebar px-3 py-2 text-center text-sm text-muted">Este é você</p>}
        </div>
      </div>
    </section>
  );
}
