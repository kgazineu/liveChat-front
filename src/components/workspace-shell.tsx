'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import toast from 'react-hot-toast';
import api from '@/src/services/api';
import { errorMessage } from '@/src/services/errors';
import { clearSession } from '@/src/services/session';
import type {
  ChannelType,
  DirectChannel,
  FriendRequest,
  MediaTarget,
  ServerChannel,
  ServerInvite,
  ServerMember,
  ServerSummary,
  TextTarget,
  User,
} from '@/src/types';
import { MediaRoom, prepareCallSounds } from './media-room';
import MessagePanel from './message-panel';
import { RealtimeProvider, useRealtime } from './realtime-provider';

type HomeView = 'friends' | 'directs' | 'requests' | 'invites';
type DirectCallTarget = { kind: 'DIRECT_CALL'; channelId: string; title: string };
type SelectedTarget = TextTarget | Extract<MediaTarget, { kind: 'SERVER_VOICE' }> | DirectCallTarget;
type ModalName = 'server' | 'channel' | 'invite' | null;

const inputClass =
  'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/15';
const primaryButtonClass =
  'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';

function initial(value: string) {
  return value.trim().charAt(0).toUpperCase() || '?';
}

function sortedByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<User>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' &&
    typeof candidate.email === 'string';
}

function userFromSearch(value: unknown): User | null {
  if (isUser(value)) return value;
  if (Array.isArray(value)) return value.find(isUser) ?? null;
  return null;
}

function isDirectChannel(value: unknown): value is DirectChannel {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DirectChannel>;
  return typeof candidate.id === 'string' && typeof candidate.participantId === 'string' &&
    typeof candidate.participantName === 'string';
}

export default function WorkspaceShell({ currentUser }: { currentUser: User }) {
  return (
    <RealtimeProvider>
      <Workspace currentUser={currentUser} />
    </RealtimeProvider>
  );
}

function Workspace({ currentUser }: { currentUser: User }) {
  const router = useRouter();
  const {
    connectionRevision,
    subscribeFriendships,
    subscribeServerInvites,
    subscribeServerMembers,
  } = useRealtime();
  const channelsRequestRef = useRef(0);
  const membersRequestRef = useRef(0);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [channels, setChannels] = useState<ServerChannel[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [invites, setInvites] = useState<ServerInvite[]>([]);
  const [directChannels, setDirectChannels] = useState<DirectChannel[]>([]);

  const [serversLoading, setServersLoading] = useState(true);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [serversError, setServersError] = useState<string | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [activeMediaTarget, setActiveMediaTarget] = useState<MediaTarget | null>(null);
  const [homeView, setHomeView] = useState<HomeView>('friends');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [modal, setModal] = useState<ModalName>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [serverName, setServerName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState<ChannelType>('TEXT');
  const [friendToInvite, setFriendToInvite] = useState('');
  const [searchEmail, setSearchEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<User | null>(null);
  const [searchComplete, setSearchComplete] = useState(false);
  const [accountName, setAccountName] = useState(currentUser.name);
  const [accountEmail, setAccountEmail] = useState(currentUser.email);
  const [profileUpdatePending, setProfileUpdatePending] = useState(false);

  const loadServers = useCallback(async () => {
    setServersLoading(true);
    setServersError(null);
    try {
      const response = await api.get<ServerSummary[]>('/servers');
      if (!Array.isArray(response.data)) throw new Error('Lista de servidores inválida');
      setServers(response.data);
      return response.data;
    } catch (error) {
      setServersError(errorMessage(error, 'Não foi possível carregar os servidores.'));
      return null;
    } finally {
      setServersLoading(false);
    }
  }, []);

  const loadCommunity = useCallback(async () => {
    setCommunityLoading(true);
    setCommunityError(null);
    try {
      const [friendsResponse, requestsResponse, invitesResponse, directsResponse] = await Promise.all([
        api.get<User[]>('/friendships'),
        api.get<FriendRequest[]>('/friendships/requests'),
        api.get<ServerInvite[]>('/servers/invites'),
        api.get<DirectChannel[]>('/direct-channels'),
      ]);
      if (!Array.isArray(friendsResponse.data) || !Array.isArray(requestsResponse.data) ||
        !Array.isArray(invitesResponse.data) || !Array.isArray(directsResponse.data)) {
        throw new Error('Dados da comunidade inválidos');
      }
      setFriends(friendsResponse.data);
      setRequests(requestsResponse.data);
      setInvites(invitesResponse.data);
      setDirectChannels(directsResponse.data);
      return { directChannels: directsResponse.data };
    } catch (error) {
      setCommunityError(errorMessage(error, 'Não foi possível carregar os dados da comunidade.'));
      return null;
    } finally {
      setCommunityLoading(false);
    }
  }, []);

  const loadChannels = useCallback(async (serverId: string) => {
    const requestId = ++channelsRequestRef.current;
    setChannelsLoading(true);
    setChannelsError(null);
    setChannels([]);
    try {
      const response = await api.get<ServerChannel[]>(`/servers/${serverId}/channels`);
      if (!Array.isArray(response.data)) throw new Error('Lista de canais inválida');
      if (requestId !== channelsRequestRef.current) return null;
      setChannels(response.data);
      return response.data;
    } catch (error) {
      if (requestId === channelsRequestRef.current) {
        setChannelsError(errorMessage(error, 'Não foi possível carregar os canais.'));
      }
      return null;
    } finally {
      if (requestId === channelsRequestRef.current) setChannelsLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (serverId: string) => {
    const requestId = ++membersRequestRef.current;
    setMembersLoading(true);
    setMembers([]);
    try {
      const response = await api.get<ServerMember[]>(`/servers/${serverId}/members`);
      if (!Array.isArray(response.data)) throw new Error('Lista de membros inválida');
      if (requestId !== membersRequestRef.current) return null;
      setMembers(response.data);
      return response.data;
    } catch (error) {
      if (requestId === membersRequestRef.current) {
        toast.error(errorMessage(error, 'Não foi possível carregar os membros do servidor.'));
      }
      return null;
    } finally {
      if (requestId === membersRequestRef.current) setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void Promise.all([loadServers(), loadCommunity()]);
    });
    return () => {
      active = false;
    };
  }, [loadCommunity, loadServers]);

  useEffect(() => {
    const unsubscribeFriendships = subscribeFriendships(() => void loadCommunity());
    const unsubscribeInvites = subscribeServerInvites(() => {
      void Promise.all([loadCommunity(), loadServers()]);
    });
    const unsubscribeMembers = subscribeServerMembers(event => {
      void loadServers();
      if (event.serverId === activeServerId) void loadMembers(event.serverId);
    });
    return () => {
      unsubscribeFriendships();
      unsubscribeInvites();
      unsubscribeMembers();
    };
  }, [activeServerId, loadCommunity, loadMembers, loadServers, subscribeFriendships, subscribeServerInvites, subscribeServerMembers]);

  useEffect(() => {
    if (connectionRevision === 0) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void Promise.all([
        loadCommunity(),
        loadServers(),
        ...(activeServerId ? [loadChannels(activeServerId), loadMembers(activeServerId)] : []),
      ]);
    });
    return () => {
      active = false;
    };
  }, [activeServerId, connectionRevision, loadChannels, loadCommunity, loadMembers, loadServers]);

  const activeServer = servers.find(server => server.id === activeServerId) ?? null;
  const pendingInvites = useMemo(
    () => invites.filter(invite => invite.status === 'PENDING'),
    [invites],
  );
  const orderedFriends = useMemo(() => sortedByName(friends), [friends]);
  const orderedDirects = useMemo(
    () => [...directChannels].sort((first, second) =>
      first.participantName.localeCompare(second.participantName, 'pt-BR')),
    [directChannels],
  );
  const textChannels = useMemo(
    () => channels.filter(channel => channel.type === 'TEXT').sort((first, second) =>
      first.position - second.position || first.name.localeCompare(second.name, 'pt-BR')),
    [channels],
  );
  const voiceChannels = useMemo(
    () => channels.filter(channel => channel.type === 'VOICE').sort((first, second) =>
      first.position - second.position || first.name.localeCompare(second.name, 'pt-BR')),
    [channels],
  );

  function showHome(view: HomeView = 'friends') {
    channelsRequestRef.current += 1;
    membersRequestRef.current += 1;
    setChannelsLoading(false);
    setMembersLoading(false);
    setMembers([]);
    setActiveServerId(null);
    setSelectedTarget(null);
    setHomeView(view);
    setMobileSidebarOpen(false);
  }

  function showServer(server: ServerSummary) {
    setActiveServerId(server.id);
    setSelectedTarget(null);
    setMobileSidebarOpen(true);
    void Promise.all([loadChannels(server.id), loadMembers(server.id)]);
  }

  function selectServerChannel(channel: ServerChannel) {
    if (!activeServer) return;
    if (channel.type === 'VOICE') {
      if (activeMediaTarget?.kind === 'SERVER_VOICE' &&
        activeMediaTarget.serverId === activeServer.id &&
        activeMediaTarget.channelId === channel.id) {
        setSelectedTarget(activeMediaTarget);
      } else {
        prepareCallSounds();
        const mediaTarget: MediaTarget = {
          kind: 'SERVER_VOICE',
          serverId: activeServer.id,
          channelId: channel.id,
          title: channel.name,
        };
        setActiveMediaTarget(mediaTarget);
        setSelectedTarget(mediaTarget);
      }
    } else {
      setSelectedTarget({
        kind: 'SERVER_TEXT',
        serverId: activeServer.id,
        channelId: channel.id,
        title: channel.name,
        subtitle: activeServer.name,
      });
    }
    setMobileSidebarOpen(false);
  }

  function selectDirect(channel: DirectChannel) {
    setActiveServerId(null);
    setSelectedTarget({
      kind: 'DIRECT',
      channelId: channel.id,
      title: channel.participantName,
      subtitle: 'Mensagem direta',
    });
    setMobileSidebarOpen(false);
  }

  async function createServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = serverName.trim();
    if (!name || busyAction) return;
    setBusyAction('create-server');
    try {
      const response = await api.post<ServerSummary>('/servers', { name });
      const refreshedServers = await loadServers();
      toast.success('Servidor criado com sucesso.');
      setServerName('');
      setModal(null);
      const createdServer = response.data?.id
        ? response.data
        : refreshedServers?.find(server => server.name === name);
      if (createdServer) showServer(createdServer);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível criar o servidor.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = channelName.trim();
    if (!activeServer || activeServer.role !== 'OWNER' || !name || busyAction) return;
    setBusyAction('create-channel');
    try {
      await api.post(`/servers/${activeServer.id}/channels`, { name, type: channelType });
      await loadChannels(activeServer.id);
      toast.success('Canal criado com sucesso.');
      setChannelName('');
      setChannelType('TEXT');
      setModal(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível criar o canal.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function inviteFriend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeServer || !friendToInvite || busyAction) return;
    setBusyAction('invite-friend');
    try {
      await api.post(`/servers/${activeServer.id}/invites`, { friendId: friendToInvite });
      await loadCommunity();
      toast.success('Convite enviado.');
      setFriendToInvite('');
      setModal(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível enviar o convite.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function acceptServerInvite(invite: ServerInvite) {
    const action = `accept-invite-${invite.id}`;
    if (busyAction) return;
    setBusyAction(action);
    try {
      await api.patch(`/servers/invites/${invite.id}/accept`);
      const [refreshedServers] = await Promise.all([loadServers(), loadCommunity()]);
      toast.success(`Você entrou em ${invite.serverName}.`);
      const joinedServer = refreshedServers?.find(server => server.id === invite.serverId);
      if (joinedServer) showServer(joinedServer);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível aceitar o convite.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function openFriend(friend: User) {
    if (busyAction) return;
    const existing = directChannels.find(channel => channel.participantId === friend.id);
    if (existing) {
      selectDirect(existing);
      return;
    }

    const action = `direct-${friend.id}`;
    setBusyAction(action);
    try {
      const response = await api.post<DirectChannel>('/direct-channels', { participantId: friend.id });
      const refreshedCommunity = await loadCommunity();
      const channel = isDirectChannel(response.data)
        ? response.data
        : refreshedCommunity?.directChannels.find(item => item.participantId === friend.id);
      if (!channel) throw new Error('Canal privado inválido');
      selectDirect(channel);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível abrir a conversa privada.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function searchUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = searchEmail.trim();
    if (!email || searching) return;
    setSearching(true);
    setFoundUser(null);
    setSearchComplete(false);
    try {
      const response = await api.get<unknown>('/users/search', { params: { email } });
      const user = userFromSearch(response.data);
      setFoundUser(user);
      setSearchComplete(true);
      if (!user) toast.error('Usuário não encontrado.');
    } catch (error) {
      setSearchComplete(true);
      toast.error(errorMessage(error, 'Não foi possível buscar o usuário.'));
    } finally {
      setSearching(false);
    }
  }

  async function sendFriendRequest() {
    if (!foundUser || busyAction) return;
    setBusyAction('send-friend-request');
    try {
      await api.post('/friendships/send', { targetUserId: foundUser.id });
      await loadCommunity();
      toast.success(`Pedido enviado para ${foundUser.name}.`);
      setFoundUser(null);
      setSearchEmail('');
      setSearchComplete(false);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível enviar o pedido.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function answerFriendRequest(request: FriendRequest, decision: 'accept' | 'reject') {
    const action = `${decision}-request-${request.id}`;
    if (busyAction) return;
    setBusyAction(action);
    try {
      await api.patch(`/friendships/${request.id}/${decision}`);
      await loadCommunity();
      toast.success(decision === 'accept' ? 'Pedido de amizade aceito.' : 'Pedido de amizade rejeitado.');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível responder ao pedido.'));
    } finally {
      setBusyAction(null);
    }
  }

  function logout() {
    clearSession();
    toast.success('Você saiu do chat.');
    router.replace('/');
  }

  async function requestPasswordChange() {
    if (busyAction) return;
    setBusyAction('password-reset');
    try {
      await api.post('/users/me/password-reset');
      toast.success('Enviamos um link seguro para alterar sua senha.');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível solicitar a alteração de senha.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function requestProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyAction) return;
    const name = accountName.trim();
    const email = accountEmail.trim().toLowerCase();
    if (!name || name.length > 100) {
      toast.error('O nome deve ter entre 1 e 100 caracteres.');
      return;
    }
    if (!email || email.length > 254) {
      toast.error('Informe um e-mail válido com até 254 caracteres.');
      return;
    }
    if (name === currentUser.name && email === currentUser.email.toLowerCase()) {
      toast.error('Altere ao menos um campo antes de continuar.');
      return;
    }

    setBusyAction('profile-update');
    try {
      await api.put('/users/me', { name, email });
      setProfileUpdatePending(true);
      toast.success('Enviamos a confirmação para seu e-mail atual.');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível solicitar a atualização do perfil.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteAccount() {
    if (busyAction || !window.confirm('Excluir sua conta permanentemente? Esta ação não pode ser desfeita.')) return;
    setBusyAction('delete-account');
    try {
      await api.delete(`/users/${currentUser.id}`);
      clearSession();
      toast.success('Sua conta foi excluída.');
      router.replace('/');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível excluir sua conta.'));
      setBusyAction(null);
    }
  }

  const mediaActive = activeMediaTarget !== null;
  const showingActiveMedia = activeMediaTarget !== null && (
    (selectedTarget?.kind === 'SERVER_VOICE' && activeMediaTarget.kind === 'SERVER_VOICE' &&
      selectedTarget.channelId === activeMediaTarget.channelId) ||
    (selectedTarget?.kind === 'DIRECT_CALL' && activeMediaTarget.kind === 'DIRECT' &&
      selectedTarget.channelId === activeMediaTarget.channelId)
  );

  function openActiveMedia() {
    if (!activeMediaTarget) return;
    if (activeMediaTarget.kind === 'SERVER_VOICE') {
      setActiveServerId(activeMediaTarget.serverId);
      setSelectedTarget(activeMediaTarget);
      void Promise.all([
        loadChannels(activeMediaTarget.serverId),
        loadMembers(activeMediaTarget.serverId),
      ]);
    } else {
      setActiveServerId(null);
      setSelectedTarget({
        kind: 'DIRECT_CALL',
        channelId: activeMediaTarget.channelId,
        title: activeMediaTarget.title,
      });
    }
    setMobileSidebarOpen(false);
  }

  function leaveActiveMedia() {
    if (!activeMediaTarget) return;
    if (selectedTarget?.kind === 'DIRECT_CALL' && activeMediaTarget.kind === 'DIRECT' &&
      selectedTarget.channelId === activeMediaTarget.channelId) {
      setSelectedTarget({
        kind: 'DIRECT',
        channelId: activeMediaTarget.channelId,
        title: activeMediaTarget.title,
        subtitle: 'Mensagem direta',
      });
    } else if (selectedTarget?.kind === 'SERVER_VOICE' && activeMediaTarget.kind === 'SERVER_VOICE' &&
      selectedTarget.channelId === activeMediaTarget.channelId) {
      setSelectedTarget(null);
    }
    setActiveMediaTarget(null);
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-950 text-slate-100">
      <ServerRail
        servers={servers}
        activeServerId={activeServerId}
        loading={serversLoading}
        error={serversError}
        onHome={() => showHome('friends')}
        onServer={showServer}
        onCreate={() => setModal('server')}
        onRetry={() => void loadServers()}
        onSettings={() => setSettingsMenuOpen(open => !open)}
      />

      {settingsMenuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setSettingsMenuOpen(false)}
            aria-label="Fechar menu de configurações"
          />
          <div className="fixed bottom-3 left-18 z-50 w-64 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 p-2 shadow-2xl shadow-black/50">
            <div className="border-b border-white/7 px-3 py-2">
              <p className="truncate text-sm font-semibold text-white">{currentUser.name}</p>
              <p className="truncate text-xs text-slate-500">{currentUser.email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSettingsMenuOpen(false);
                setAccountName(currentUser.name);
                setAccountEmail(currentUser.email);
                setProfileUpdatePending(false);
                setAccountSettingsOpen(true);
              }}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/7"
            >
              <span aria-hidden="true">⚙</span>
              Configurações da conta
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
            >
              <span aria-hidden="true">↪</span>
              Sair da conta
            </button>
          </div>
        </>
      )}

      {mobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Fechar navegação"
        />
      )}

      <aside className={`${mobileSidebarOpen ? 'flex' : 'hidden'} ${mediaActive ? 'pb-28' : ''} fixed inset-y-0 left-16 z-30 w-[min(20rem,calc(100vw-4rem))] flex-col border-r border-white/7 bg-slate-900 shadow-2xl md:static md:z-auto md:flex md:w-72 md:shrink-0 md:shadow-none`}>
        {activeServer ? (
          <ServerSidebar
            server={activeServer}
            channelsLoading={channelsLoading}
            channelsError={channelsError}
            textChannels={textChannels}
            voiceChannels={voiceChannels}
            members={members}
            membersLoading={membersLoading}
            selectedTarget={selectedTarget}
            activeMediaTarget={activeMediaTarget}
            onSelectChannel={selectServerChannel}
            onRetry={() => void loadChannels(activeServer.id)}
            onCreateChannel={() => setModal('channel')}
            onInvite={() => setModal('invite')}
            onClose={() => setMobileSidebarOpen(false)}
          />
        ) : (
          <HomeSidebar
            currentUser={currentUser}
            view={homeView}
            friends={orderedFriends}
            directs={orderedDirects}
            requests={requests}
            invites={pendingInvites}
            selectedTarget={selectedTarget}
            loading={communityLoading}
            error={communityError}
            busyAction={busyAction}
            searchEmail={searchEmail}
            foundUser={foundUser}
            searchComplete={searchComplete}
            searching={searching}
            onView={setHomeView}
            onSearchEmail={value => {
              setSearchEmail(value);
              setFoundUser(null);
              setSearchComplete(false);
            }}
            onSearch={searchUser}
            onSendRequest={() => void sendFriendRequest()}
            onFriend={friend => void openFriend(friend)}
            onDirect={selectDirect}
            onAnswerRequest={(request, decision) => void answerFriendRequest(request, decision)}
            onAcceptInvite={invite => void acceptServerInvite(invite)}
            onRetry={() => void loadCommunity()}
            onClose={() => setMobileSidebarOpen(false)}
          />
        )}
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col bg-slate-950">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="absolute left-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-slate-900/95 text-lg text-slate-200 shadow-lg backdrop-blur md:hidden"
          aria-label="Abrir navegação"
          aria-expanded={mobileSidebarOpen}
        >
          ☰
        </button>

        {!showingActiveMedia && (selectedTarget && selectedTarget.kind !== 'SERVER_VOICE' && selectedTarget.kind !== 'DIRECT_CALL' ? (
          <MessagePanel
            key={`${selectedTarget.kind}-${selectedTarget.channelId}`}
            currentUser={currentUser}
            target={selectedTarget}
            onStartCall={selectedTarget.kind === 'DIRECT' ? () => {
              if (activeMediaTarget?.kind !== 'DIRECT' ||
                activeMediaTarget.channelId !== selectedTarget.channelId) {
                prepareCallSounds();
                setActiveMediaTarget({
                  kind: 'DIRECT',
                  channelId: selectedTarget.channelId,
                  title: selectedTarget.title,
                });
              }
              setSelectedTarget({
                kind: 'DIRECT_CALL',
                channelId: selectedTarget.channelId,
                title: selectedTarget.title,
              });
            } : undefined}
          />
        ) : activeServer ? (
          <ServerWelcome server={activeServer} onOpenNavigation={() => setMobileSidebarOpen(true)} />
        ) : (
          <HomeWelcome
            currentUser={currentUser}
            friendsCount={friends.length}
            requestsCount={requests.length}
            invitesCount={pendingInvites.length}
            onNavigate={view => {
              setHomeView(view);
              setMobileSidebarOpen(true);
            }}
          />
        ))}

        {activeMediaTarget && (
          <MediaRoom
            key={`${activeMediaTarget.kind}-${activeMediaTarget.channelId}`}
            currentUser={currentUser}
            target={activeMediaTarget}
            visible={showingActiveMedia}
            onOpenAction={openActiveMedia}
            onLeaveAction={leaveActiveMedia}
          />
        )}
      </main>

      {modal === 'server' && (
        <Modal title="Criar servidor" description="Crie um novo espaço para sua comunidade." onClose={() => setModal(null)}>
          <form onSubmit={createServer} className="space-y-4">
            <Field label="Nome do servidor" htmlFor="server-name">
              <input
                id="server-name"
                className={inputClass}
                value={serverName}
                onChange={event => setServerName(event.target.value)}
                placeholder="Ex.: Comunidade Dev"
                maxLength={80}
                autoFocus
                required
              />
            </Field>
            <ModalActions busy={busyAction === 'create-server'} onCancel={() => setModal(null)} submitLabel="Criar servidor" />
          </form>
        </Modal>
      )}

      {modal === 'channel' && activeServer?.role === 'OWNER' && (
        <Modal title="Criar canal" description={`Adicione um canal a ${activeServer.name}.`} onClose={() => setModal(null)}>
          <form onSubmit={createChannel} className="space-y-4">
            <Field label="Nome do canal" htmlFor="channel-name">
              <input
                id="channel-name"
                className={inputClass}
                value={channelName}
                onChange={event => setChannelName(event.target.value)}
                placeholder="Ex.: geral"
                maxLength={80}
                autoFocus
                required
              />
            </Field>
            <Field label="Tipo" htmlFor="channel-type">
              <select
                id="channel-type"
                className={inputClass}
                value={channelType}
                onChange={event => setChannelType(event.target.value as ChannelType)}
              >
                <option value="TEXT">Texto</option>
                <option value="VOICE">Voz e vídeo</option>
              </select>
            </Field>
            <ModalActions busy={busyAction === 'create-channel'} onCancel={() => setModal(null)} submitLabel="Criar canal" />
          </form>
        </Modal>
      )}

      {modal === 'invite' && activeServer && (
        <Modal title="Convidar amigo" description={`Convide um amigo aceito para ${activeServer.name}.`} onClose={() => setModal(null)}>
          <form onSubmit={inviteFriend} className="space-y-4">
            <Field label="Amigo" htmlFor="invite-friend">
              <select
                id="invite-friend"
                className={inputClass}
                value={friendToInvite}
                onChange={event => setFriendToInvite(event.target.value)}
                autoFocus
                required
              >
                <option value="">Selecione um amigo</option>
                {orderedFriends.map(friend => (
                  <option key={friend.id} value={friend.id}>{friend.name} — {friend.email}</option>
                ))}
              </select>
            </Field>
            {orderedFriends.length === 0 && (
              <p className="rounded-xl border border-amber-400/15 bg-amber-400/8 p-3 text-sm text-amber-200">
                Você precisa ter um amigo aceito antes de enviar um convite.
              </p>
            )}
            <ModalActions
              busy={busyAction === 'invite-friend'}
              disabled={!friendToInvite}
              onCancel={() => setModal(null)}
              submitLabel="Enviar convite"
            />
          </form>
        </Modal>
      )}

      {accountSettingsOpen && (
        <Modal
          title="Configurações da conta"
          description="Gerencie seus dados de acesso e sua conta."
          onClose={() => setAccountSettingsOpen(false)}
        >
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 p-4">
              <Avatar name={currentUser.name} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{currentUser.name}</p>
                <p className="truncate text-sm text-slate-400">{currentUser.email}</p>
              </div>
            </div>

            <form onSubmit={requestProfileUpdate} className="grid gap-3">
              <Field label="Nome de usuário" htmlFor="account-name">
                <input
                  id="account-name"
                  className={inputClass}
                  value={accountName}
                  onChange={event => {
                    setAccountName(event.target.value);
                    setProfileUpdatePending(false);
                  }}
                  maxLength={100}
                  required
                />
              </Field>
              <Field label="E-mail" htmlFor="account-email">
                <input
                  id="account-email"
                  type="email"
                  className={inputClass}
                  value={accountEmail}
                  onChange={event => {
                    setAccountEmail(event.target.value);
                    setProfileUpdatePending(false);
                  }}
                  maxLength={254}
                  required
                />
              </Field>
              <p className="rounded-xl border border-cyan-400/15 bg-cyan-400/6 p-3 text-xs leading-relaxed text-cyan-100/75">
                A alteração só será aplicada após você confirmar o link enviado para <strong>{currentUser.email}</strong>.
              </p>
              {profileUpdatePending && (
                <p role="status" className="rounded-xl border border-emerald-400/15 bg-emerald-400/8 p-3 text-xs text-emerald-200">
                  Solicitação criada. Verifique o seu e-mail atual; o link expira em aproximadamente 15 minutos.
                </p>
              )}
              <button
                type="submit"
                disabled={busyAction !== null}
                className={primaryButtonClass}
              >
                {busyAction === 'profile-update' ? 'Enviando confirmação…' : 'Salvar alterações'}
              </button>
            </form>

            <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
              <h3 className="text-sm font-semibold text-white">Senha</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Enviaremos um link de uso único para seu e-mail. Ao concluir a troca, todas as sessões anteriores serão invalidadas.
              </p>
              <button
                type="button"
                onClick={() => void requestPasswordChange()}
                disabled={busyAction !== null}
                className={`${secondaryButtonClass} mt-3 w-full`}
              >
                {busyAction === 'password-reset' ? 'Enviando link…' : 'Alterar minha senha'}
              </button>
            </div>

            <div className="rounded-2xl border border-rose-400/15 bg-rose-500/5 p-4">
              <h3 className="text-sm font-semibold text-rose-200">Zona de perigo</h3>
              <p className="mt-1 text-xs text-rose-200/60">A exclusão da conta é permanente.</p>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                disabled={busyAction !== null}
                className="mt-3 w-full rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
              >
                {busyAction === 'delete-account' ? 'Excluindo…' : 'Excluir minha conta'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ServerRail({
  servers,
  activeServerId,
  loading,
  error,
  onHome,
  onServer,
  onCreate,
  onRetry,
  onSettings,
}: {
  servers: ServerSummary[];
  activeServerId: string | null;
  loading: boolean;
  error: string | null;
  onHome: () => void;
  onServer: (server: ServerSummary) => void;
  onCreate: () => void;
  onRetry: () => void;
  onSettings: () => void;
}) {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center border-r border-white/7 bg-slate-950 py-3" aria-label="Servidores">
      <button
        type="button"
        onClick={onHome}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl transition ${activeServerId === null ? 'bg-violet-500 text-white' : 'bg-slate-800 text-violet-300 hover:rounded-xl hover:bg-violet-500 hover:text-white'}`}
        aria-label="Início"
        title="Início"
      >
        ◈
      </button>
      <div className="my-3 h-px w-8 shrink-0 bg-white/10" />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2">
        {loading && <span className="block py-2 text-center text-xs text-slate-500" aria-label="Carregando servidores">…</span>}
        {!loading && error && (
          <button type="button" onClick={onRetry} className="grid h-11 w-11 place-items-center rounded-2xl bg-red-500/10 text-red-300" aria-label="Tentar carregar servidores novamente" title={error}>!</button>
        )}
        {!loading && !error && servers.length === 0 && (
          <span className="grid h-8 w-11 place-items-center text-xs text-slate-600" aria-label="Nenhum servidor" title="Nenhum servidor">—</span>
        )}
        {!loading && !error && servers.map(server => (
          <button
            key={server.id}
            type="button"
            onClick={() => onServer(server)}
            className={`grid h-11 w-11 place-items-center rounded-2xl text-sm font-bold transition ${activeServerId === server.id ? 'rounded-xl bg-violet-500 text-white' : 'bg-slate-800 text-slate-300 hover:rounded-xl hover:bg-violet-500 hover:text-white'}`}
            aria-label={server.name}
            title={server.name}
          >
            {initial(server.name)}
          </button>
        ))}
        <button
          type="button"
          onClick={onCreate}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-500/10 text-xl text-emerald-300 transition hover:rounded-xl hover:bg-emerald-500 hover:text-white"
          aria-label="Criar servidor"
          title="Criar servidor"
        >
          +
        </button>
      </div>
      <button
        type="button"
        onClick={onSettings}
        className="mt-3 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-base text-slate-400 transition hover:bg-violet-500/15 hover:text-violet-200"
        aria-label="Abrir configurações"
        title="Configurações"
      >
        ⚙
      </button>
    </nav>
  );
}

function ServerSidebar({
  server,
  channelsLoading,
  channelsError,
  textChannels,
  voiceChannels,
  members,
  membersLoading,
  selectedTarget,
  activeMediaTarget,
  onSelectChannel,
  onRetry,
  onCreateChannel,
  onInvite,
  onClose,
}: {
  server: ServerSummary;
  channelsLoading: boolean;
  channelsError: string | null;
  textChannels: ServerChannel[];
  voiceChannels: ServerChannel[];
  members: ServerMember[];
  membersLoading: boolean;
  selectedTarget: SelectedTarget | null;
  activeMediaTarget: MediaTarget | null;
  onSelectChannel: (channel: ServerChannel) => void;
  onRetry: () => void;
  onCreateChannel: () => void;
  onInvite: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <header className="border-b border-white/7 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-bold text-white">{server.name}</h1>
            <p className="mt-0.5 text-xs text-slate-500">{server.role === 'OWNER' ? 'Você é o dono' : 'Membro'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl text-slate-400 md:hidden" aria-label="Fechar navegação">×</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onInvite} className={secondaryButtonClass}>Convidar</button>
          {server.role === 'OWNER' && (
            <button type="button" onClick={onCreateChannel} className={primaryButtonClass}>Novo canal</button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {channelsLoading && <SidebarState title="Carregando canais" description="Organizando a comunidade…" />}
        {!channelsLoading && channelsError && <SidebarError message={channelsError} onRetry={onRetry} />}
        {!channelsLoading && !channelsError && textChannels.length === 0 && voiceChannels.length === 0 && (
          <SidebarState title="Nenhum canal" description={server.role === 'OWNER' ? 'Crie o primeiro canal deste servidor.' : 'O dono ainda não criou canais.'} />
        )}
        {!channelsLoading && !channelsError && textChannels.length > 0 && (
          <ChannelGroup title="Canais de texto">
            {textChannels.map(channel => (
              <ChannelButton
                key={channel.id}
                label={channel.name}
                icon="#"
                active={selectedTarget?.kind === 'SERVER_TEXT' && selectedTarget.channelId === channel.id}
                onClick={() => onSelectChannel(channel)}
              />
            ))}
          </ChannelGroup>
        )}
        {!channelsLoading && !channelsError && voiceChannels.length > 0 && (
          <ChannelGroup title="Canais de voz">
            {voiceChannels.map(channel => (
              <ChannelButton
                key={channel.id}
                label={channel.name}
                icon={activeMediaTarget?.kind === 'SERVER_VOICE' && activeMediaTarget.channelId === channel.id ? '◉' : '◖'}
                active={(selectedTarget?.kind === 'SERVER_VOICE' && selectedTarget.channelId === channel.id) ||
                  (activeMediaTarget?.kind === 'SERVER_VOICE' && activeMediaTarget.channelId === channel.id)}
                onClick={() => onSelectChannel(channel)}
              />
            ))}
          </ChannelGroup>
        )}
        <ChannelGroup title={`Membros — ${members.length}`}>
          {membersLoading && <p className="px-2 py-2 text-xs text-slate-500">Atualizando membros…</p>}
          {!membersLoading && members.map(member => (
            <div key={member.userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-400">
              <Avatar name={member.userName} small />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-300">{member.userName}</p>
                <p className="text-[10px] text-slate-600">{member.role === 'OWNER' ? 'Proprietário' : 'Membro'}</p>
              </div>
            </div>
          ))}
          {!membersLoading && members.length === 0 && <p className="px-2 py-2 text-xs text-slate-600">Nenhum membro disponível.</p>}
        </ChannelGroup>
      </div>
    </>
  );
}

function HomeSidebar({
  currentUser,
  view,
  friends,
  directs,
  requests,
  invites,
  selectedTarget,
  loading,
  error,
  busyAction,
  searchEmail,
  foundUser,
  searchComplete,
  searching,
  onView,
  onSearchEmail,
  onSearch,
  onSendRequest,
  onFriend,
  onDirect,
  onAnswerRequest,
  onAcceptInvite,
  onRetry,
  onClose,
}: {
  currentUser: User;
  view: HomeView;
  friends: User[];
  directs: DirectChannel[];
  requests: FriendRequest[];
  invites: ServerInvite[];
  selectedTarget: SelectedTarget | null;
  loading: boolean;
  error: string | null;
  busyAction: string | null;
  searchEmail: string;
  foundUser: User | null;
  searchComplete: boolean;
  searching: boolean;
  onView: (view: HomeView) => void;
  onSearchEmail: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSendRequest: () => void;
  onFriend: (friend: User) => void;
  onDirect: (channel: DirectChannel) => void;
  onAnswerRequest: (request: FriendRequest, decision: 'accept' | 'reject') => void;
  onAcceptInvite: (invite: ServerInvite) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <header className="border-b border-white/7 p-4">
        <div className="flex items-center gap-3">
          <Avatar name={currentUser.name} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-white">{currentUser.name}</h1>
            <p className="truncate text-xs text-slate-500">{currentUser.email}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl text-slate-400 md:hidden" aria-label="Fechar navegação">×</button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 border-b border-white/7 p-3">
        <HomeTab active={view === 'friends'} label="Amigos" count={friends.length} onClick={() => onView('friends')} />
        <HomeTab active={view === 'directs'} label="Mensagens" count={directs.length} onClick={() => onView('directs')} />
        <HomeTab active={view === 'requests'} label="Pedidos" count={requests.length} onClick={() => onView('requests')} />
        <HomeTab active={view === 'invites'} label="Convites" count={invites.length} onClick={() => onView('invites')} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <SidebarState title="Carregando" description="Buscando seus contatos e convites…" />}
        {!loading && error && <SidebarError message={error} onRetry={onRetry} />}

        {!loading && !error && view === 'friends' && (
          <div className="space-y-4">
            <form onSubmit={onSearch} className="space-y-2">
              <label htmlFor="friend-search" className="text-xs font-semibold uppercase tracking-wider text-slate-500">Adicionar amigo</label>
              <div className="flex gap-2">
                <input
                  id="friend-search"
                  type="email"
                  className={inputClass}
                  placeholder="email@exemplo.com"
                  value={searchEmail}
                  onChange={event => onSearchEmail(event.target.value)}
                  required
                />
                <button type="submit" className="rounded-xl bg-white/8 px-3 text-slate-200 hover:bg-white/12 disabled:opacity-50" disabled={searching} aria-label="Buscar usuário">
                  {searching ? '…' : '⌕'}
                </button>
              </div>
            </form>

            {foundUser && (
              <div className="rounded-xl border border-violet-400/20 bg-violet-400/8 p-3">
                <div className="flex items-center gap-3">
                  <Avatar name={foundUser.name} small />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{foundUser.name}</p>
                    <p className="truncate text-xs text-slate-400">{foundUser.email}</p>
                  </div>
                </div>
                <button type="button" onClick={onSendRequest} disabled={busyAction !== null || foundUser.id === currentUser.id} className={`${primaryButtonClass} mt-3 w-full`}>
                  {foundUser.id === currentUser.id ? 'Este é você' : busyAction === 'send-friend-request' ? 'Enviando…' : 'Enviar pedido'}
                </button>
              </div>
            )}
            {searchComplete && !foundUser && <p className="text-sm text-slate-500">Nenhum usuário encontrado.</p>}

            <ListHeading>Seus amigos</ListHeading>
            {friends.map(friend => (
              <PersonButton
                key={friend.id}
                name={friend.name}
                detail={friend.email}
                busy={busyAction === `direct-${friend.id}`}
                onClick={() => onFriend(friend)}
              />
            ))}
            {friends.length === 0 && <EmptyList text="Você ainda não tem amigos aceitos." />}
          </div>
        )}

        {!loading && !error && view === 'directs' && (
          <div className="space-y-2">
            <ListHeading>Mensagens diretas</ListHeading>
            {directs.map(channel => (
              <PersonButton
                key={channel.id}
                name={channel.participantName}
                detail="Conversa privada"
                active={(selectedTarget?.kind === 'DIRECT' || selectedTarget?.kind === 'DIRECT_CALL') && selectedTarget.channelId === channel.id}
                onClick={() => onDirect(channel)}
              />
            ))}
            {directs.length === 0 && <EmptyList text="Clique em um amigo para iniciar uma conversa." />}
          </div>
        )}

        {!loading && !error && view === 'requests' && (
          <div className="space-y-3">
            <ListHeading>Pedidos de amizade</ListHeading>
            {requests.map(request => (
              <article key={request.id} className="rounded-xl border border-white/7 bg-white/4 p-3">
                <div className="flex items-center gap-3">
                  <Avatar name={request.requesterName} small />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{request.requesterName}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" className={primaryButtonClass} disabled={busyAction !== null} onClick={() => onAnswerRequest(request, 'accept')}>
                    {busyAction === `accept-request-${request.id}` ? 'Aceitando…' : 'Aceitar'}
                  </button>
                  <button type="button" className={secondaryButtonClass} disabled={busyAction !== null} onClick={() => onAnswerRequest(request, 'reject')}>
                    {busyAction === `reject-request-${request.id}` ? 'Rejeitando…' : 'Rejeitar'}
                  </button>
                </div>
              </article>
            ))}
            {requests.length === 0 && <EmptyList text="Nenhum pedido de amizade pendente." />}
          </div>
        )}

        {!loading && !error && view === 'invites' && (
          <div className="space-y-3">
            <ListHeading>Convites de servidor</ListHeading>
            {invites.map(invite => (
              <article key={invite.id} className="rounded-xl border border-white/7 bg-white/4 p-3">
                <p className="truncate text-sm font-semibold text-white">{invite.serverName}</p>
                <p className="mt-1 text-xs text-slate-500">Convite de {invite.inviterName}</p>
                <button type="button" className={`${primaryButtonClass} mt-3 w-full`} disabled={busyAction !== null} onClick={() => onAcceptInvite(invite)}>
                  {busyAction === `accept-invite-${invite.id}` ? 'Entrando…' : 'Aceitar convite'}
                </button>
              </article>
            ))}
            {invites.length === 0 && <EmptyList text="Nenhum convite de servidor pendente." />}
          </div>
        )}
      </div>
    </>
  );
}

function HomeWelcome({
  currentUser,
  friendsCount,
  requestsCount,
  invitesCount,
  onNavigate,
}: {
  currentUser: User;
  friendsCount: number;
  requestsCount: number;
  invitesCount: number;
  onNavigate: (view: HomeView) => void;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-20 sm:px-10 md:py-12">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center">
        <span className="text-sm font-semibold text-violet-300">INÍCIO</span>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Olá, {currentUser.name}.</h2>
        <p className="mt-3 max-w-xl text-slate-400">Converse com amigos, acompanhe seus convites ou entre em uma comunidade.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <DashboardCard value={friendsCount} label="amigos" onClick={() => onNavigate('friends')} />
          <DashboardCard value={requestsCount} label="pedidos pendentes" onClick={() => onNavigate('requests')} />
          <DashboardCard value={invitesCount} label="convites de servidor" onClick={() => onNavigate('invites')} />
        </div>
        <div className="mt-8 rounded-2xl border border-white/7 bg-white/3 p-6">
          <h3 className="font-semibold text-white">Comece uma conversa</h3>
          <p className="mt-1 text-sm text-slate-400">Abra a navegação e clique em um amigo. O canal privado será encontrado ou criado automaticamente.</p>
          <button type="button" onClick={() => onNavigate('friends')} className={`${primaryButtonClass} mt-4`}>Ver amigos</button>
        </div>
      </div>
    </section>
  );
}

function ServerWelcome({ server, onOpenNavigation }: { server: ServerSummary; onOpenNavigation: () => void }) {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-20 text-center md:py-10">
      <div className="max-w-lg">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-violet-500/15 text-3xl font-bold text-violet-300">
          {initial(server.name)}
        </div>
        <h2 className="mt-6 text-3xl font-bold text-white">Bem-vindo a {server.name}</h2>
        <p className="mt-3 text-slate-400">Selecione um canal de texto ou voz para participar da comunidade.</p>
        <button type="button" onClick={onOpenNavigation} className={`${primaryButtonClass} mt-6 md:hidden`}>Ver canais</button>
      </div>
    </section>
  );
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title" aria-describedby="workspace-modal-description" className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="workspace-modal-title" className="text-lg font-bold text-white">{title}</h2>
            <p id="workspace-modal-description" className="mt-1 text-sm text-slate-400">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-xl text-slate-400 hover:bg-white/8 hover:text-white" aria-label="Fechar">×</button>
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
}

function ModalActions({ busy, disabled = false, onCancel, submitLabel }: { busy: boolean; disabled?: boolean; onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={busy}>Cancelar</button>
      <button type="submit" className={primaryButtonClass} disabled={busy || disabled}>{busy ? 'Aguarde…' : submitLabel}</button>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-200">{label}</label>
      {children}
    </div>
  );
}

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl bg-linear-to-br from-violet-500/30 to-cyan-500/20 font-bold text-violet-200 ${small ? 'h-9 w-9 text-sm' : 'h-11 w-11'}`} aria-hidden="true">
      {initial(name)}
    </span>
  );
}

function HomeTab({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium transition ${active ? 'bg-violet-500/15 text-violet-200' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
      <span>{label}</span>
      <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px]">{count}</span>
    </button>
  );
}

function ChannelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function ChannelButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
      <span className="w-5 text-center text-base text-slate-500" aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function PersonButton({ name, detail, active = false, busy = false, onClick }: { name: string; detail: string; active?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition disabled:opacity-60 ${active ? 'bg-violet-500/15' : 'hover:bg-white/5'}`}>
      <Avatar name={name} small />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-200">{name}</span>
        <span className="block truncate text-xs text-slate-500">{busy ? 'Abrindo conversa…' : detail}</span>
      </span>
    </button>
  );
}

function SidebarState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-3 py-10 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}

function SidebarError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-400/15 bg-red-400/8 p-3 text-center">
      <p className="text-sm text-red-200">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 text-xs font-semibold text-red-100 underline underline-offset-4">Tentar novamente</button>
    </div>
  );
}

function EmptyList({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">{text}</p>;
}

function ListHeading({ children }: { children: ReactNode }) {
  return <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{children}</h2>;
}

function DashboardCard({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-white/7 bg-white/3 p-5 text-left transition hover:-translate-y-0.5 hover:border-violet-400/20 hover:bg-violet-400/5">
      <span className="block text-3xl font-bold text-white">{value}</span>
      <span className="mt-1 block text-sm text-slate-400">{label}</span>
    </button>
  );
}
