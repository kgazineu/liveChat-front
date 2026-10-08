'use client';

import {
  Check,
  Mail,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { DirectChannel, FriendRequest, ServerInvite, User } from '@/src/types';
import { Avatar, colorFor, initials } from '../ui/avatar';
import { sectionLabelClass } from '../ui/styles';

export type FriendsTab = 'all' | 'pending' | 'invites' | 'add';

type HomeSelection = { kind: string; channelId: string } | null;

export function HomeSidebar({
  directs,
  pendingCount,
  selectedTarget,
  friendsActive,
  loading,
  error,
  onFriends,
  onDirect,
  onNewDirect,
  onSearch,
  onRetry,
  onClose,
}: {
  directs: DirectChannel[];
  pendingCount: number;
  selectedTarget: HomeSelection;
  friendsActive: boolean;
  loading: boolean;
  error: string | null;
  onFriends: () => void;
  onDirect: (channel: DirectChannel) => void;
  onNewDirect: () => void;
  onSearch: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 px-2.5 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05)]">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-7 min-w-0 flex-1 items-center justify-between rounded bg-floating/60 px-2 text-left text-[13px] font-medium text-muted transition hover:text-text"
        >
          <span className="truncate">Encontrar uma conversa</span>
          <kbd className="ml-2 hidden shrink-0 rounded bg-sidebar px-1 font-sans text-[10px] text-faint lg:inline">Ctrl K</kbd>
        </button>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-interactive hover:text-header md:hidden" aria-label="Fechar navegação">
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <button
          type="button"
          onClick={onFriends}
          aria-current={friendsActive ? 'page' : undefined}
          className={`flex h-[42px] w-full items-center gap-3 rounded px-3 text-[15px] font-medium transition ${friendsActive ? 'bg-selected text-header' : 'text-muted hover:bg-hover hover:text-text'}`}
        >
          <Users size={22} />
          <span className="flex-1 text-left">Amigos</span>
          {pendingCount > 0 && <CountBadge value={pendingCount} />}
        </button>

        <div className="group mt-4 flex items-center justify-between px-2 pb-1">
          <h2 className={`${sectionLabelClass} transition group-hover:text-text`}>Mensagens diretas</h2>
          <button type="button" onClick={onNewDirect} className="has-tooltip relative text-muted transition hover:text-header" aria-label="Nova mensagem direta">
            <Plus size={16} />
            <span className="tooltip tooltip-top text-xs">Criar DM</span>
          </button>
        </div>

        {loading && (
          <div className="space-y-2 px-2 pt-1" role="status" aria-label="Carregando conversas">
            {[60, 75, 50].map(width => (
              <div key={width} className="flex items-center gap-3 py-1">
                <span className="h-8 w-8 animate-pulse rounded-full bg-hover" />
                <span className="h-3 animate-pulse rounded bg-hover" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="mx-1 rounded-md bg-danger/10 p-3 text-center">
            <p className="text-sm text-text">{error}</p>
            <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold text-link hover:underline">Tentar novamente</button>
          </div>
        )}
        {!loading && !error && directs.length === 0 && (
          <p className="px-2 py-3 text-xs leading-relaxed text-faint">
            Suas conversas privadas aparecem aqui. Abra um amigo para começar.
          </p>
        )}
        {!loading && !error && directs.map(channel => {
          const active = (selectedTarget?.kind === 'DIRECT' || selectedTarget?.kind === 'DIRECT_CALL') &&
            selectedTarget.channelId === channel.id;
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => onDirect(channel)}
              aria-current={active ? 'page' : undefined}
              className={`mb-0.5 flex h-[42px] w-full items-center gap-3 rounded px-2 text-left transition ${active ? 'bg-selected text-header' : 'text-muted hover:bg-hover hover:text-text'}`}
            >
              <Avatar name={channel.participantName} seed={channel.participantId} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{channel.participantName}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function FriendsView({
  tab,
  friends,
  requests,
  invites,
  busyAction,
  navigationButton,
  onTab,
  onFriend,
  onAnswerRequest,
  onAcceptInvite,
  onAddFriend,
}: {
  tab: FriendsTab;
  friends: User[];
  requests: FriendRequest[];
  invites: ServerInvite[];
  busyAction: string | null;
  navigationButton: ReactNode;
  onTab: (tab: FriendsTab) => void;
  onFriend: (friend: User) => void;
  onAnswerRequest: (request: FriendRequest, decision: 'accept' | 'reject') => void;
  onAcceptInvite: (invite: ServerInvite) => void;
  onAddFriend: (email: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [query, setQuery] = useState('');
  const filteredFriends = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return normalized ? friends.filter(friend => friend.name.toLocaleLowerCase('pt-BR').includes(normalized)) : friends;
  }, [friends, query]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-main">
      <header className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-2 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05)] [scrollbar-width:none] sm:px-4">
        {navigationButton}
        <div className="flex shrink-0 items-center gap-2 pr-2 text-header">
          <Users size={22} className="text-faint" />
          <h1 className="text-base font-semibold">Amigos</h1>
        </div>
        <span className="mx-1 h-6 w-px shrink-0 bg-divider" aria-hidden="true" />
        <nav className="flex shrink-0 items-center gap-1 sm:gap-2" aria-label="Seções de amigos">
          <TabButton active={tab === 'all'} onClick={() => onTab('all')}>Todos</TabButton>
          <TabButton active={tab === 'pending'} onClick={() => onTab('pending')} badge={requests.length}>Pendentes</TabButton>
          <TabButton active={tab === 'invites'} onClick={() => onTab('invites')} badge={invites.length}>Convites</TabButton>
          <button
            type="button"
            onClick={() => onTab('add')}
            aria-current={tab === 'add' ? 'page' : undefined}
            className={`shrink-0 rounded px-2 py-0.5 text-[15px] font-medium transition ${tab === 'add' ? 'bg-transparent text-success' : 'bg-success text-white hover:bg-success-hover'}`}
          >
            Adicionar amigo
          </button>
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'all' && (
          <div className="px-4 pt-4 sm:px-8">
            {friends.length > 0 && (
              <label className="relative block">
                <span className="sr-only">Buscar amigos</span>
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Buscar"
                  className="h-9 w-full rounded bg-floating/70 pl-3 pr-9 text-[15px] text-text outline-none placeholder:text-faint focus:ring-2 focus:ring-link/50"
                />
                <Search size={18} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
              </label>
            )}
            <ListTitle>Todos os amigos — {filteredFriends.length}</ListTitle>
            {filteredFriends.map(friend => (
              <PersonRow
                key={friend.id}
                name={friend.name}
                seed={friend.id}
                detail={busyAction === `direct-${friend.id}` ? 'Abrindo conversa…' : 'Amigo'}
                onClick={() => onFriend(friend)}
                actions={(
                  <RoundAction label={`Conversar com ${friend.name}`} onClick={() => onFriend(friend)}>
                    <MessageCircle size={20} />
                  </RoundAction>
                )}
              />
            ))}
            {friends.length === 0 && (
              <EmptyIllustration
                title="Ninguém por aqui ainda"
                description="Adicione amigos pelo e-mail para conversar, ligar e convidá-los para servidores."
                action={{ label: 'Adicionar amigo', onClick: () => onTab('add') }}
              />
            )}
            {friends.length > 0 && filteredFriends.length === 0 && (
              <EmptyIllustration title="Nenhum amigo encontrado" description={`Ninguém com “${query}” no nome.`} />
            )}
          </div>
        )}

        {tab === 'pending' && (
          <div className="px-4 pt-4 sm:px-8">
            <ListTitle>Pendentes — {requests.length}</ListTitle>
            {requests.map(request => (
              <PersonRow
                key={request.id}
                name={request.requesterName}
                seed={request.requesterId}
                detail="Pedido de amizade recebido"
                actions={(
                  <>
                    <RoundAction
                      label={`Aceitar pedido de ${request.requesterName}`}
                      tone="success"
                      disabled={busyAction !== null}
                      onClick={() => onAnswerRequest(request, 'accept')}
                    >
                      <Check size={20} />
                    </RoundAction>
                    <RoundAction
                      label={`Recusar pedido de ${request.requesterName}`}
                      tone="danger"
                      disabled={busyAction !== null}
                      onClick={() => onAnswerRequest(request, 'reject')}
                    >
                      <X size={20} />
                    </RoundAction>
                  </>
                )}
              />
            ))}
            {requests.length === 0 && (
              <EmptyIllustration title="Nenhum pedido pendente" description="Quando alguém quiser ser seu amigo, o pedido aparece aqui." />
            )}
          </div>
        )}

        {tab === 'invites' && (
          <div className="px-4 pt-4 sm:px-8">
            <ListTitle>Convites de servidor — {invites.length}</ListTitle>
            {invites.map(invite => (
              <div key={invite.id} className="flex items-center gap-3 border-t border-divider/60 py-3">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-semibold text-white"
                  style={{ backgroundColor: colorFor(invite.serverId) }}
                  aria-hidden="true"
                >
                  {initials(invite.serverName, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-header">{invite.serverName}</p>
                  <p className="truncate text-sm text-muted">Convite de {invite.inviterName}</p>
                </div>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => onAcceptInvite(invite)}
                  className="rounded-[3px] bg-success px-4 py-1.5 text-sm font-medium text-white transition hover:bg-success-hover disabled:opacity-50"
                >
                  {busyAction === `accept-invite-${invite.id}` ? 'Entrando…' : 'Aceitar convite'}
                </button>
              </div>
            ))}
            {invites.length === 0 && (
              <EmptyIllustration
                icon={<Mail size={40} />}
                title="Nenhum convite pendente"
                description="Peça para um amigo convidar você para o servidor dele."
              />
            )}
          </div>
        )}

        {tab === 'add' && <AddFriend onAddFriend={onAddFriend} />}
      </div>
    </section>
  );
}

function AddFriend({
  onAddFriend,
}: {
  onAddFriend: (email: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setResult(null);
    const outcome = await onAddFriend(value);
    setBusy(false);
    setResult(outcome);
    if (outcome.ok) setEmail('');
  }

  return (
    <div className="border-b border-divider/60 px-4 py-5 sm:px-8">
      <h2 className="text-base font-semibold uppercase text-header">Adicionar amigo</h2>
      <p className="mt-2 text-sm text-muted">Você pode adicionar amigos usando o e-mail da conta deles.</p>
      <form onSubmit={submit} className="mt-4">
        <div className={`flex flex-col gap-2 rounded-lg bg-floating/70 p-2 ring-1 transition focus-within:ring-link sm:flex-row sm:items-center sm:pl-3 ${result ? (result.ok ? 'ring-success' : 'ring-danger') : 'ring-black/30'}`}>
          <label htmlFor="friend-search" className="sr-only">E-mail do amigo</label>
          <input
            id="friend-search"
            type="email"
            value={email}
            onChange={event => {
              setEmail(event.target.value);
              setResult(null);
            }}
            placeholder="Digite o e-mail da conta"
            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-base text-text outline-none placeholder:text-faint"
            autoFocus
            required
          />
          <button
            type="submit"
            disabled={!email.trim() || busy}
            className="h-9 shrink-0 rounded-[3px] bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Enviando…' : 'Enviar pedido de amizade'}
          </button>
        </div>
        {result && (
          <p role="status" className={`mt-2 text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>{result.message}</p>
        )}
      </form>
    </div>
  );
}

function TabButton({ active, badge = 0, onClick, children }: { active: boolean; badge?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[15px] font-medium transition ${active ? 'bg-selected text-header' : 'text-muted hover:bg-hover hover:text-text'}`}
    >
      {children}
      {badge > 0 && <CountBadge value={badge} />}
    </button>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white">
      {value > 99 ? '99+' : value}
    </span>
  );
}

function ListTitle({ children }: { children: ReactNode }) {
  return <h2 className={`${sectionLabelClass} mb-2 mt-4`}>{children}</h2>;
}

function PersonRow({ name, seed, detail, actions, onClick }: {
  name: string;
  seed: string;
  detail: string;
  actions: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="group -mx-2.5 flex h-[62px] items-center gap-3 rounded-lg border-t border-divider/60 px-2.5 transition hover:border-transparent hover:bg-hover">
      <button type="button" onClick={onClick} disabled={!onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
        <Avatar name={name} seed={seed} size="sm" statusRing="border-main" />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-header">{name}</span>
          <span className="block truncate text-sm text-muted">{detail}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
    </div>
  );
}

function RoundAction({ label, tone = 'neutral', disabled = false, onClick, children }: {
  label: string;
  tone?: 'neutral' | 'success' | 'danger';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const toneClass = tone === 'success' ? 'hover:text-success' : tone === 'danger' ? 'hover:text-danger' : 'hover:text-header';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-full bg-sidebar text-interactive transition group-hover:bg-floating disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function EmptyIllustration({ icon, title, description, action }: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-16 text-center">
      <div className="grid h-24 w-24 place-items-center rounded-full bg-sidebar text-faint">{icon ?? <Users size={40} />}</div>
      <h3 className="mt-5 font-semibold text-header">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="mt-4 rounded-[3px] bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover">
          {action.label}
        </button>
      )}
    </div>
  );
}

export function NavigationButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="grid h-8 w-8 shrink-0 place-items-center rounded text-interactive transition hover:text-header md:hidden" aria-label="Abrir navegação">
      <Menu size={22} />
    </button>
  );
}
