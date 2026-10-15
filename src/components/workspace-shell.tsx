'use client';

import { useRouter } from 'next/navigation';
import { Hash, MessageSquarePlus, UserPlus, Users } from 'lucide-react';
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
import {
  installDesktopUpdate,
  subscribeDesktopCallOpen,
  subscribeDesktopUpdateReady,
  updateDesktopCallState,
} from '@/src/services/desktop';
import { errorMessage } from '@/src/services/errors';
import { clearSession } from '@/src/services/session';
import { fetchAllPages } from '@/src/services/pagination';
import type {
  ChannelType,
  CurrentUser,
  DirectChannel,
  FriendRequest,
  MediaPresenceEvent,
  MediaSession,
  MediaTarget,
  ServerChannel,
  ServerInvite,
  ServerMember,
  ServerSummary,
  TextTarget,
  User,
} from '@/src/types';
import {
  MediaRoom,
  prepareCallSounds,
  storeParticipantVolume,
  type MediaRoomSummary,
} from './media-room';
import MessagePanel from './message-panel';
import { RealtimeProvider, useRealtime } from './realtime-provider';
import { AccountSettings } from './workspace/account-settings';
import { FriendsView, HomeSidebar, NavigationButton, type FriendsTab } from './workspace/home';
import { MembersPanel } from './workspace/members-panel';
import { QuickSwitcher, type SwitcherItem } from './workspace/quick-switcher';
import { ServerRail } from './workspace/server-rail';
import { ServerSidebar } from './workspace/server-sidebar';
import { UserPanel } from './workspace/user-panel';
import { Avatar, colorFor, initials } from './ui/avatar';
import { Field, Modal, ModalActions } from './ui/modal';
import { inputClass } from './ui/styles';

type DirectCallTarget = { kind: 'DIRECT_CALL'; channelId: string; title: string };
type SelectedTarget = TextTarget | Extract<MediaTarget, { kind: 'SERVER_VOICE' }> | DirectCallTarget;
type ModalName = 'server' | 'channel' | 'invite' | null;
type VoicePreferences = { microphoneMuted: boolean; deafened: boolean };

const VOICE_PREFERENCES_KEY = 'ui:voice-preferences';
const MEMBERS_OPEN_KEY = 'ui:members-open';
const LAST_CHANNEL_KEY = 'ui:last-channel:';

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferências de interface são opcionais quando o armazenamento local está indisponível.
  }
}

function readVoicePreferences(): VoicePreferences {
  if (typeof window === 'undefined') return { microphoneMuted: false, deafened: false };
  try {
    const parsed = JSON.parse(readStorage(VOICE_PREFERENCES_KEY) ?? '{}') as Partial<VoicePreferences>;
    return { microphoneMuted: parsed.microphoneMuted === true, deafened: parsed.deafened === true };
  } catch {
    return { microphoneMuted: false, deafened: false };
  }
}

function sortedByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<User>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string';
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

function safeMediaSession(session: MediaSession): MediaSession {
  const { connection: _discarded, ...safeSession } = session;
  void _discarded;
  return safeSession;
}

function mergeVoiceSessions(...groups: MediaSession[][]) {
  const sessions = new Map<string, MediaSession>();
  for (const session of groups.flat()) {
    const safeSession = safeMediaSession(session);
    const userId = String(safeSession.userId);
    const previous = sessions.get(userId);
    const previousTime = previous ? Date.parse(previous.lastSeenAt) : Number.NEGATIVE_INFINITY;
    const nextTime = Date.parse(safeSession.lastSeenAt);
    if (!previous || !Number.isFinite(previousTime) || !Number.isFinite(nextTime) || nextTime >= previousTime) {
      sessions.set(userId, safeSession);
    }
  }
  return [...sessions.values()].sort((first, second) =>
    Date.parse(first.joinedAt) - Date.parse(second.joinedAt) ||
    first.userName.localeCompare(second.userName, 'pt-BR'));
}

function belongsToServerVoice(event: MediaPresenceEvent) {
  return event.participant.channelKind === 'SERVER_VOICE' && event.participant.serverId != null;
}

export default function WorkspaceShell({ currentUser }: { currentUser: CurrentUser }) {
  return (
    <RealtimeProvider currentUserId={currentUser.id}>
      <Workspace currentUser={currentUser} />
    </RealtimeProvider>
  );
}

function Workspace({ currentUser }: { currentUser: CurrentUser }) {
  const router = useRouter();
  const {
    connectionRevision,
    subscribeFriendships,
    subscribePresence,
    subscribeServerInvites,
    subscribeServerMembers,
  } = useRealtime();
  const channelsRequestRef = useRef(0);
  const membersRequestRef = useRef(0);
  const voicePresenceRequestRef = useRef(0);
  const voicePresenceTombstonesRef = useRef(new Map<string, Set<string>>());
  const autoSelectServerRef = useRef<{ serverId: string; serverName: string } | null>(null);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [channels, setChannels] = useState<ServerChannel[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [invites, setInvites] = useState<ServerInvite[]>([]);
  const [directChannels, setDirectChannels] = useState<DirectChannel[]>([]);
  const [voiceSessionsByChannel, setVoiceSessionsByChannel] = useState<Record<string, MediaSession[]>>({});
  const [speakingUserIds, setSpeakingUserIds] = useState<string[]>([]);
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
  const [showWebRtcMetrics, setShowWebRtcMetrics] = useState(false);
  const [voicePanelTarget, setVoicePanelTarget] = useState<HTMLDivElement | null>(null);
  const [voicePreferences, setVoicePreferences] = useState<VoicePreferences>(readVoicePreferences);
  const [membersOpen, setMembersOpen] = useState(() => typeof window === 'undefined' || readStorage(MEMBERS_OPEN_KEY) !== 'false');
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false);

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
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('all');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [modal, setModal] = useState<ModalName>(null);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [serverName, setServerName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState<ChannelType>('TEXT');
  const [invitedFriendIds, setInvitedFriendIds] = useState<Set<string>>(new Set());
  const [inviteQuery, setInviteQuery] = useState('');
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
      const [friendsPage, requestsPage, invitesResponse, directsResponse] = await Promise.all([
        fetchAllPages<User>('/friendships'),
        fetchAllPages<FriendRequest>('/friendships/requests'),
        api.get<ServerInvite[]>('/servers/invites'),
        api.get<DirectChannel[]>('/direct-channels'),
      ]);
      if (!Array.isArray(invitesResponse.data) || !Array.isArray(directsResponse.data)) {
        throw new Error('Dados da comunidade inválidos');
      }
      setFriends(friendsPage);
      setRequests(requestsPage);
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

  const loadVoicePresence = useCallback(async (serverId: string, serverChannels: ServerChannel[]) => {
    const requestId = ++voicePresenceRequestRef.current;
    const voiceChannels = serverChannels.filter(channel => channel.type === 'VOICE');
    voiceChannels.forEach(channel => voicePresenceTombstonesRef.current.set(channel.id, new Set()));
    setVoiceSessionsByChannel(previous => Object.fromEntries(
      voiceChannels.map(channel => [channel.id, previous[channel.id] ?? []]),
    ));
    if (voiceChannels.length === 0) return;

    const snapshots = await Promise.all(voiceChannels.map(async channel => {
      try {
        const response = await api.get<MediaSession[]>(`/servers/${serverId}/channels/${channel.id}/media-sessions`);
        if (!Array.isArray(response.data)) throw new Error('Lista de participantes inválida');
        return { channelId: channel.id, sessions: response.data, failed: false, error: null };
      } catch (error) {
        return { channelId: channel.id, sessions: [] as MediaSession[], failed: true, error };
      }
    }));
    if (requestId !== voicePresenceRequestRef.current) return;

    const failedSnapshot = snapshots.find(snapshot => snapshot.failed);
    if (failedSnapshot) {
      toast.error(errorMessage(failedSnapshot.error, 'Não foi possível atualizar todos os participantes dos canais de voz.'));
    }
    setVoiceSessionsByChannel(previous => {
      const next: Record<string, MediaSession[]> = {};
      for (const snapshot of snapshots) {
        const tombstones = voicePresenceTombstonesRef.current.get(snapshot.channelId);
        const sessions = snapshot.sessions
          .filter(session => session.channelKind === 'SERVER_VOICE' &&
            String(session.serverId) === String(serverId) &&
            String(session.channelId) === String(snapshot.channelId))
          .filter(session => !tombstones?.has(String(session.userId)));
        next[snapshot.channelId] = snapshot.failed
          ? previous[snapshot.channelId] ?? []
          : mergeVoiceSessions(previous[snapshot.channelId] ?? [], sessions);
      }
      return next;
    });
  }, []);

  const loadChannels = useCallback(async (serverId: string) => {
    const requestId = ++channelsRequestRef.current;
    setChannelsLoading(true);
    setChannelsError(null);
    setChannels([]);
    try {
      const page = await fetchAllPages<ServerChannel>(`/servers/${serverId}/channels`);
      if (requestId !== channelsRequestRef.current) return null;
      setChannels(page);
      void loadVoicePresence(serverId, page);
      const pendingSelection = autoSelectServerRef.current;
      if (pendingSelection?.serverId === serverId) {
        autoSelectServerRef.current = null;
        const channel = preferredTextChannel(page, serverId);
        if (channel) {
          setSelectedTarget(current => current ?? {
            kind: 'SERVER_TEXT',
            serverId,
            channelId: channel.id,
            title: channel.name,
            subtitle: pendingSelection.serverName,
          });
        }
      }
      return page;
    } catch (error) {
      if (requestId === channelsRequestRef.current) {
        setChannelsError(errorMessage(error, 'Não foi possível carregar os canais.'));
      }
      return null;
    } finally {
      if (requestId === channelsRequestRef.current) setChannelsLoading(false);
    }
  }, [loadVoicePresence]);

  const loadMembers = useCallback(async (serverId: string) => {
    const requestId = ++membersRequestRef.current;
    setMembersLoading(true);
    setMembers([]);
    try {
      const page = await fetchAllPages<ServerMember>(`/servers/${serverId}/members`);
      if (requestId !== membersRequestRef.current) return null;
      setMembers(page);
      return page;
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
    const unsubscribePresence = subscribePresence(event => {
      if (!belongsToServerVoice(event)) return;
      const channelId = String(event.participant.channelId);
      const userId = String(event.participant.userId);
      let tombstones = voicePresenceTombstonesRef.current.get(channelId);
      if (!tombstones) {
        tombstones = new Set<string>();
        voicePresenceTombstonesRef.current.set(channelId, tombstones);
      }

      if (event.type === 'media.participant.left') {
        tombstones.add(userId);
        setVoiceSessionsByChannel(previous => ({
          ...previous,
          [channelId]: (previous[channelId] ?? []).filter(session => String(session.userId) !== userId),
        }));
        return;
      }

      tombstones.delete(userId);
      setVoiceSessionsByChannel(previous => ({
        ...previous,
        [channelId]: mergeVoiceSessions(previous[channelId] ?? [], [event.participant]),
      }));
    });
    return unsubscribePresence;
  }, [subscribePresence]);

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

  useEffect(() => {
    writeStorage(VOICE_PREFERENCES_KEY, JSON.stringify(voicePreferences));
  }, [voicePreferences]);

  useEffect(() => {
    const openSwitcher = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickSwitcherOpen(open => !open);
      }
    };
    window.addEventListener('keydown', openSwitcher);
    return () => window.removeEventListener('keydown', openSwitcher);
  }, []);

  function showHome(tab?: FriendsTab) {
    channelsRequestRef.current += 1;
    membersRequestRef.current += 1;
    voicePresenceRequestRef.current += 1;
    autoSelectServerRef.current = null;
    setChannelsLoading(false);
    setMembersLoading(false);
    setMembers([]);
    setVoiceSessionsByChannel({});
    setSpeakingUserIds([]);
    setActiveServerId(null);
    setSelectedTarget(null);
    if (tab) setFriendsTab(tab);
    setMobileSidebarOpen(false);
  }

  function showServer(server: ServerSummary) {
    voicePresenceRequestRef.current += 1;
    autoSelectServerRef.current = { serverId: server.id, serverName: server.name };
    setVoiceSessionsByChannel({});
    setSpeakingUserIds([]);
    setActiveServerId(server.id);
    setSelectedTarget(null);
    setMobileSidebarOpen(true);
    void Promise.all([loadChannels(server.id), loadMembers(server.id)]);
  }

  function selectServerChannel(channel: ServerChannel) {
    if (!activeServer) return;
    autoSelectServerRef.current = null;
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
        setSpeakingUserIds([]);
        setActiveMediaTarget(mediaTarget);
        setSelectedTarget(mediaTarget);
      }
    } else {
      writeStorage(`${LAST_CHANNEL_KEY}${activeServer.id}`, channel.id);
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
    if (activeServerId !== null) showHome();
    setSelectedTarget({
      kind: 'DIRECT',
      channelId: channel.id,
      title: channel.participantName,
      subtitle: 'Mensagem direta',
      participantId: channel.participantId,
    });
    setMobileSidebarOpen(false);
  }

  function openCreateChannel(type: ChannelType) {
    setChannelType(type);
    setChannelName('');
    setModal('channel');
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
      setModal(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível criar o canal.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function inviteFriend(friend: User) {
    if (!activeServer || busyAction) return;
    setBusyAction(`invite-${friend.id}`);
    try {
      await api.post(`/servers/${activeServer.id}/invites`, { friendId: friend.id });
      setInvitedFriendIds(previous => new Set(previous).add(friend.id));
      toast.success(`Convite enviado para ${friend.name}.`);
      void loadCommunity();
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

  async function addFriendByEmail(email: string) {
    try {
      const response = await api.get<unknown>('/users/search', { params: { email } });
      const user = userFromSearch(response.data);
      if (!user) return { ok: false, message: 'Hmm, não encontramos ninguém com esse e-mail. Confira se ele está correto.' };
      if (user.id === currentUser.id) return { ok: false, message: 'Esse é você! Tente o e-mail de um amigo.' };
      if (friends.some(friend => friend.id === user.id)) return { ok: false, message: `Você já é amigo de ${user.name}.` };
      await api.post('/friendships/send', { targetUserId: user.id });
      await loadCommunity();
      return { ok: true, message: `Tudo certo! Seu pedido de amizade para ${user.name} foi enviado.` };
    } catch (error) {
      return { ok: false, message: errorMessage(error, 'Não foi possível enviar o pedido de amizade.') };
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

  const showingActiveMedia = activeMediaTarget !== null && (
    (selectedTarget?.kind === 'SERVER_VOICE' && activeMediaTarget.kind === 'SERVER_VOICE' &&
      selectedTarget.channelId === activeMediaTarget.channelId) ||
    (selectedTarget?.kind === 'DIRECT_CALL' && activeMediaTarget.kind === 'DIRECT' &&
      selectedTarget.channelId === activeMediaTarget.channelId)
  );

  const openActiveMedia = useCallback(() => {
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
  }, [activeMediaTarget, loadChannels, loadMembers]);

  useEffect(() => {
    updateDesktopCallState(activeMediaTarget !== null, activeMediaTarget?.title);
    return () => updateDesktopCallState(false);
  }, [activeMediaTarget]);

  useEffect(() => subscribeDesktopCallOpen(openActiveMedia), [openActiveMedia]);

  useEffect(() => subscribeDesktopUpdateReady(version => {
    toast((toastInstance) => (
      <div className="flex items-center gap-3">
        <span>Atualização desktop {version} pronta.</span>
        <button
          type="button"
          onClick={() => {
            toast.dismiss(toastInstance.id);
            void installDesktopUpdate();
          }}
          className="rounded-[3px] bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
        >
          Reiniciar
        </button>
      </div>
    ), { duration: Infinity });
  }), []);

  const handleMediaSummary = useCallback((summary: MediaRoomSummary) => {
    if (!activeMediaTarget || activeMediaTarget.kind !== 'SERVER_VOICE') {
      setSpeakingUserIds([]);
      return;
    }
    const channelId = activeMediaTarget.channelId;
    const tombstones = voicePresenceTombstonesRef.current.get(channelId);
    const roomSessions = summary.sessions.filter(session => session.channelKind === 'SERVER_VOICE' &&
      session.channelId === channelId);
    setVoiceSessionsByChannel(previous => ({
      ...previous,
      // Depois de conferida com o servidor e o LiveKit, a lista da sala substitui a da barra lateral
      // (remove quem saiu sem o evento chegar); antes disso, só acrescenta.
      [channelId]: summary.authoritative
        ? mergeVoiceSessions(roomSessions)
        : mergeVoiceSessions(
          previous[channelId] ?? [],
          roomSessions.filter(session => !tombstones?.has(String(session.userId))),
        ),
    }));
    setSpeakingUserIds(summary.speakingUserIds.map(String));
  }, [activeMediaTarget]);

  const changeParticipantVolume = useCallback((userId: string, volume: number) => {
    const normalized = storeParticipantVolume(userId, volume);
    setParticipantVolumes(previous => ({ ...previous, [userId]: normalized }));
  }, []);

  const toggleMicrophone = useCallback(() => {
    setVoicePreferences(previous => previous.deafened
      ? { microphoneMuted: false, deafened: false }
      : { ...previous, microphoneMuted: !previous.microphoneMuted });
  }, []);

  const toggleDeafen = useCallback(() => {
    setVoicePreferences(previous => ({ ...previous, deafened: !previous.deafened }));
  }, []);

  const setMicrophoneMuted = useCallback((microphoneMuted: boolean) => {
    setVoicePreferences(previous => ({ ...previous, microphoneMuted }));
  }, []);

  function leaveActiveMedia() {
    if (!activeMediaTarget) return;
    if (selectedTarget?.kind === 'DIRECT_CALL' && activeMediaTarget.kind === 'DIRECT' &&
      selectedTarget.channelId === activeMediaTarget.channelId) {
      setSelectedTarget({
        kind: 'DIRECT',
        channelId: activeMediaTarget.channelId,
        title: activeMediaTarget.title,
        subtitle: 'Mensagem direta',
        participantId: directChannels.find(channel => channel.id === activeMediaTarget.channelId)?.participantId,
      });
    } else if (selectedTarget?.kind === 'SERVER_VOICE' && activeMediaTarget.kind === 'SERVER_VOICE' &&
      selectedTarget.channelId === activeMediaTarget.channelId) {
      setSelectedTarget(null);
    }
    if (activeMediaTarget.kind === 'SERVER_VOICE') {
      const channelId = activeMediaTarget.channelId;
      setVoiceSessionsByChannel(previous => ({
        ...previous,
        [channelId]: (previous[channelId] ?? []).filter(session => String(session.userId) !== String(currentUser.id)),
      }));
    }
    setSpeakingUserIds([]);
    setShowWebRtcMetrics(false);
    setActiveMediaTarget(null);
  }

  function toggleMembers() {
    if (typeof window !== 'undefined' && !(window.matchMedia?.('(min-width: 1024px)').matches ?? true)) {
      setMobileMembersOpen(open => !open);
      return;
    }
    const next = !membersOpen;
    setMembersOpen(next);
    writeStorage(MEMBERS_OPEN_KEY, String(next));
  }

  function selectSwitcherItem(item: SwitcherItem) {
    setQuickSwitcherOpen(false);
    if (item.kind === 'friend') {
      const friend = friends.find(candidate => candidate.id === item.id);
      if (friend) void openFriend(friend);
    } else if (item.kind === 'server') {
      const server = servers.find(candidate => candidate.id === item.id);
      if (server) showServer(server);
      setMobileSidebarOpen(false);
    } else {
      const channel = channels.find(candidate => candidate.id === item.id);
      if (channel) selectServerChannel(channel);
    }
  }

  const voiceServerId = activeMediaTarget?.kind === 'SERVER_VOICE' ? activeMediaTarget.serverId : null;
  const voiceChannelByUserId = useMemo(() => {
    const result: Record<string, string> = {};
    for (const channel of voiceChannels) {
      for (const session of voiceSessionsByChannel[channel.id] ?? []) result[String(session.userId)] = channel.name;
    }
    return result;
  }, [voiceChannels, voiceSessionsByChannel]);
  const switcherItems = useMemo<SwitcherItem[]>(() => [
    ...orderedFriends.map(friend => ({ kind: 'friend' as const, id: friend.id, name: friend.name, hint: 'Amigo' })),
    ...[...textChannels, ...voiceChannels].map(channel => ({
      kind: 'channel' as const,
      id: channel.id,
      name: channel.name,
      hint: activeServer?.name ?? '',
      channelType: channel.type,
    })),
    ...sortedByName(servers).map(server => ({ kind: 'server' as const, id: server.id, name: server.name, hint: 'Servidor' })),
  ], [activeServer?.name, orderedFriends, servers, textChannels, voiceChannels]);
  const invitableFriends = useMemo(() => {
    const query = inviteQuery.trim().toLocaleLowerCase('pt-BR');
    const memberIds = new Set(members.map(member => String(member.userId)));
    return orderedFriends
      .filter(friend => !memberIds.has(friend.id))
      .filter(friend => !query || friend.name.toLocaleLowerCase('pt-BR').includes(query));
  }, [inviteQuery, members, orderedFriends]);

  const navigationButton = <NavigationButton onClick={() => setMobileSidebarOpen(true)} />;
  const showingTextChannel = selectedTarget?.kind === 'SERVER_TEXT';
  const membersVisible = activeServer !== null && !showingActiveMedia && (showingTextChannel || selectedTarget === null);
  const membersToggle = activeServer ? (
    <button
      type="button"
      onClick={toggleMembers}
      aria-label={membersOpen ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
      aria-pressed={membersOpen}
      className={`has-tooltip relative grid h-8 w-8 place-items-center rounded transition ${membersOpen ? 'text-header' : 'text-interactive hover:text-text'}`}
    >
      <Users size={22} />
      <span className="tooltip tooltip-top text-xs">{membersOpen ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}</span>
    </button>
  ) : null;

  const membersPanel = activeServer ? (
    <MembersPanel
      key={activeServer.id}
      server={activeServer}
      currentUserId={currentUser.id}
      members={members}
      loading={membersLoading}
      friends={friends}
      voiceChannelByUserId={voiceChannelByUserId}
      onMessage={friend => {
        setMobileMembersOpen(false);
        void openFriend(friend);
      }}
      onClose={() => setMobileMembersOpen(false)}
    />
  ) : null;

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-main text-text">
      {mobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 animate-fade-in bg-black/60 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Fechar navegação"
        />
      )}

      <div className={`${mobileSidebarOpen ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-30 max-w-[calc(100vw-3rem)] shadow-2xl md:static md:z-auto md:flex md:shadow-none`}>
        <ServerRail
          servers={servers}
          activeServerId={activeServerId}
          loading={serversLoading}
          error={serversError}
          homeBadge={requests.length + pendingInvites.length}
          voiceServerId={voiceServerId}
          onHome={() => showHome()}
          onServer={showServer}
          onCreate={() => setModal('server')}
          onRetry={() => void loadServers()}
        />
        <aside className="flex w-60 min-w-0 flex-col bg-sidebar" aria-label={activeServer ? `Canais de ${activeServer.name}` : 'Conversas'}>
          {activeServer ? (
            <ServerSidebar
              server={activeServer}
              channelsLoading={channelsLoading}
              channelsError={channelsError}
              textChannels={textChannels}
              voiceChannels={voiceChannels}
              voiceSessionsByChannel={voiceSessionsByChannel}
              speakingUserIds={speakingUserIds}
              participantVolumes={participantVolumes}
              currentUserId={currentUser.id}
              selectedTarget={selectedTarget}
              activeMediaTarget={activeMediaTarget}
              onSelectChannel={selectServerChannel}
              onRetry={() => void loadChannels(activeServer.id)}
              onCreateChannel={openCreateChannel}
              onInvite={() => {
                setInviteQuery('');
                setInvitedFriendIds(new Set());
                setModal('invite');
              }}
              onParticipantVolumeChange={changeParticipantVolume}
              onClose={() => setMobileSidebarOpen(false)}
            />
          ) : (
            <HomeSidebar
              directs={orderedDirects}
              pendingCount={requests.length}
              selectedTarget={selectedTarget}
              friendsActive={selectedTarget === null}
              loading={communityLoading}
              error={communityError}
              onFriends={() => showHome()}
              onDirect={selectDirect}
              onNewDirect={() => showHome('all')}
              onSearch={() => setQuickSwitcherOpen(true)}
              onRetry={() => void loadCommunity()}
              onClose={() => setMobileSidebarOpen(false)}
            />
          )}
          <div ref={setVoicePanelTarget} className="shrink-0" />
          <UserPanel
            currentUser={currentUser}
            inCall={activeMediaTarget !== null}
            microphoneMuted={voicePreferences.microphoneMuted}
            deafened={voicePreferences.deafened}
            showMetricsToggle={activeMediaTarget !== null}
            metricsVisible={showWebRtcMetrics}
            onToggleMicrophone={toggleMicrophone}
            onToggleDeafen={toggleDeafen}
            onOpenAccount={() => {
              setAccountName(currentUser.name);
              setAccountEmail(currentUser.email);
              setProfileUpdatePending(false);
              setAccountSettingsOpen(true);
            }}
            onToggleMetrics={() => setShowWebRtcMetrics(visible => !visible)}
            onLogout={logout}
          />
        </aside>
      </div>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-main">
        {!showingActiveMedia && (selectedTarget && selectedTarget.kind !== 'SERVER_VOICE' && selectedTarget.kind !== 'DIRECT_CALL' ? (
          <MessagePanel
            key={`${selectedTarget.kind}-${selectedTarget.channelId}`}
            currentUser={currentUser}
            target={selectedTarget}
            headerStart={navigationButton}
            headerActions={selectedTarget.kind === 'SERVER_TEXT' ? membersToggle : null}
            onStartCall={selectedTarget.kind === 'DIRECT' ? () => {
              if (activeMediaTarget?.kind !== 'DIRECT' ||
                activeMediaTarget.channelId !== selectedTarget.channelId) {
                prepareCallSounds();
                setActiveMediaTarget({
                  kind: 'DIRECT',
                  channelId: selectedTarget.channelId,
                  title: selectedTarget.title,
                  participantId: selectedTarget.participantId,
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
          <ServerWelcome
            server={activeServer}
            navigationButton={navigationButton}
            membersToggle={membersToggle}
            hasChannels={channels.length > 0}
            onInvite={() => {
              setInviteQuery('');
              setInvitedFriendIds(new Set());
              setModal('invite');
            }}
            onCreateChannel={() => openCreateChannel('TEXT')}
            onOpenNavigation={() => setMobileSidebarOpen(true)}
          />
        ) : (
          <FriendsView
            tab={friendsTab}
            friends={orderedFriends}
            requests={requests}
            invites={pendingInvites}
            busyAction={busyAction}
            navigationButton={navigationButton}
            onTab={setFriendsTab}
            onFriend={friend => void openFriend(friend)}
            onAnswerRequest={(request, decision) => void answerFriendRequest(request, decision)}
            onAcceptInvite={invite => void acceptServerInvite(invite)}
            onAddFriend={addFriendByEmail}
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
            onSummaryAction={handleMediaSummary}
            showMetrics={showWebRtcMetrics}
            participantVolumes={participantVolumes}
            voicePanelTarget={voicePanelTarget}
            microphoneMuted={voicePreferences.microphoneMuted}
            deafened={voicePreferences.deafened}
            onToggleMicrophoneAction={toggleMicrophone}
            onToggleDeafenAction={toggleDeafen}
            onMicrophoneMutedChangeAction={setMicrophoneMuted}
            headerStart={navigationButton}
          />
        )}
      </main>

      {membersVisible && membersOpen && <div className="hidden lg:flex">{membersPanel}</div>}
      {membersVisible && mobileMembersOpen && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <button type="button" className="absolute inset-0 animate-fade-in bg-black/60" onClick={() => setMobileMembersOpen(false)} aria-label="Fechar lista de membros" />
          <div className="relative h-full animate-slide-up">{membersPanel}</div>
        </div>
      )}

      {quickSwitcherOpen && (
        <QuickSwitcher items={switcherItems} onSelect={selectSwitcherItem} onClose={() => setQuickSwitcherOpen(false)} />
      )}

      {modal === 'server' && (
        <Modal
          title="Crie seu servidor"
          description="Seu servidor é onde você e seus amigos se reúnem. Crie o seu e comece a conversar."
          onClose={() => setModal(null)}
        >
          <form onSubmit={createServer} className="space-y-4">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-interactive text-2xl font-semibold text-header" style={serverName.trim() ? { backgroundColor: colorFor(serverName.trim()), borderStyle: 'solid', borderColor: 'transparent' } : undefined} aria-hidden="true">
              {serverName.trim() ? initials(serverName, 2) : '+'}
            </div>
            <Field label="Nome do servidor" htmlFor="server-name" hint="Você pode convidar amigos assim que ele for criado.">
              <input
                id="server-name"
                className={inputClass}
                value={serverName}
                onChange={event => setServerName(event.target.value)}
                placeholder={`Servidor de ${currentUser.name}`}
                maxLength={80}
                autoFocus
                required
              />
            </Field>
            <ModalActions busy={busyAction === 'create-server'} disabled={!serverName.trim()} onCancel={() => setModal(null)} submitLabel="Criar" />
          </form>
        </Modal>
      )}

      {modal === 'channel' && activeServer?.role === 'OWNER' && (
        <Modal title="Criar canal" description={`em ${activeServer.name}`} onClose={() => setModal(null)}>
          <form onSubmit={createChannel} className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-xs font-bold uppercase text-muted">Tipo de canal</legend>
              <div className="space-y-2">
                {([
                  ['TEXT', 'Texto', 'Envie mensagens, imagens, GIFs e arquivos.'],
                  ['VOICE', 'Voz', 'Converse por voz, vídeo e compartilhe a tela.'],
                ] as const).map(([value, label, description]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center gap-3 rounded px-3 py-2.5 transition ${channelType === value ? 'bg-selected' : 'bg-sidebar hover:bg-hover'}`}
                  >
                    <span className="text-interactive" aria-hidden="true">{value === 'TEXT' ? <Hash size={24} /> : <VolumeIcon />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-header">{label}</span>
                      <span className="block text-sm text-muted">{description}</span>
                    </span>
                    <input
                      type="radio"
                      name="channel-type"
                      value={value}
                      checked={channelType === value}
                      onChange={() => setChannelType(value)}
                      className="h-5 w-5 accent-brand"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Nome do canal" htmlFor="channel-name">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-interactive" aria-hidden="true">
                  {channelType === 'TEXT' ? <Hash size={16} /> : <VolumeIcon small />}
                </span>
                <input
                  id="channel-name"
                  className={`${inputClass} pl-8`}
                  value={channelName}
                  onChange={event => setChannelName(channelType === 'TEXT' ? event.target.value.toLowerCase().replace(/\s+/g, '-') : event.target.value)}
                  placeholder={channelType === 'TEXT' ? 'novo-canal' : 'Sala de voz'}
                  maxLength={80}
                  autoFocus
                  required
                />
              </div>
            </Field>
            <ModalActions busy={busyAction === 'create-channel'} disabled={!channelName.trim()} onCancel={() => setModal(null)} submitLabel="Criar canal" />
          </form>
        </Modal>
      )}

      {modal === 'invite' && activeServer && (
        <Modal title={`Convide amigos para ${activeServer.name}`} onClose={() => setModal(null)}>
          {orderedFriends.length > 0 && (
            <input
              className={inputClass}
              value={inviteQuery}
              onChange={event => setInviteQuery(event.target.value)}
              placeholder="Buscar amigos"
              aria-label="Buscar amigos"
              autoFocus
            />
          )}
          <ul className="-mx-2 mt-3 max-h-72 overflow-y-auto" aria-label="Amigos para convidar">
            {invitableFriends.map(friend => {
              const invited = invitedFriendIds.has(friend.id);
              return (
                <li key={friend.id} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-hover">
                  <Avatar name={friend.name} seed={friend.id} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium text-header">{friend.name}</span>
                  <button
                    type="button"
                    onClick={() => void inviteFriend(friend)}
                    disabled={invited || busyAction !== null}
                    className={`min-w-20 rounded-[3px] border px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${invited ? 'border-transparent text-muted' : 'border-success text-white hover:bg-success'}`}
                  >
                    {invited ? 'Enviado' : busyAction === `invite-${friend.id}` ? '…' : 'Convidar'}
                  </button>
                </li>
              );
            })}
          </ul>
          {orderedFriends.length === 0 && (
            <div className="py-6 text-center">
              <p className="font-medium text-header">Você ainda não tem amigos para convidar</p>
              <p className="mt-1 text-sm text-muted">Adicione amigos pelo e-mail e depois convide-os para cá.</p>
              <button
                type="button"
                onClick={() => {
                  setModal(null);
                  showHome('add');
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-[3px] bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
              >
                <UserPlus size={16} /> Adicionar amigo
              </button>
            </div>
          )}
          {orderedFriends.length > 0 && invitableFriends.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              {inviteQuery.trim() ? `Nenhum amigo com “${inviteQuery.trim()}” para convidar.` : 'Todos os seus amigos já estão neste servidor.'}
            </p>
          )}
        </Modal>
      )}

      {accountSettingsOpen && (
        <AccountSettings
          currentUser={currentUser}
          accountName={accountName}
          accountEmail={accountEmail}
          profileUpdatePending={profileUpdatePending}
          busyAction={busyAction}
          onAccountNameChange={value => {
            setAccountName(value);
            setProfileUpdatePending(false);
          }}
          onAccountEmailChange={value => {
            setAccountEmail(value);
            setProfileUpdatePending(false);
          }}
          onSubmitProfile={requestProfileUpdate}
          onRequestPasswordChange={() => void requestPasswordChange()}
          onDeleteAccount={() => void deleteAccount()}
          onLogout={logout}
          onClose={() => setAccountSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function preferredTextChannel(page: ServerChannel[], serverId: string) {
  const textChannels = page
    .filter(channel => channel.type === 'TEXT')
    .sort((first, second) => first.position - second.position || first.name.localeCompare(second.name, 'pt-BR'));
  const rememberedId = typeof window === 'undefined' ? null : readStorage(`${LAST_CHANNEL_KEY}${serverId}`);
  return textChannels.find(channel => channel.id === rememberedId) ?? textChannels[0] ?? null;
}

function VolumeIcon({ small = false }: { small?: boolean }) {
  return (
    <svg width={small ? 16 : 24} height={small ? 16 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5Z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.4 18.4a9 9 0 0 0 0-12.8" />
    </svg>
  );
}

function ServerWelcome({
  server,
  navigationButton,
  membersToggle,
  hasChannels,
  onInvite,
  onCreateChannel,
  onOpenNavigation,
}: {
  server: ServerSummary;
  navigationButton: ReactNode;
  membersToggle: ReactNode;
  hasChannels: boolean;
  onInvite: () => void;
  onCreateChannel: () => void;
  onOpenNavigation: () => void;
}) {
  const owner = server.role === 'OWNER';
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-2 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05)] sm:px-4">
        {navigationButton}
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-header">{server.name}</h1>
        {membersToggle}
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-12">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-[28px] text-3xl font-semibold text-white" style={{ backgroundColor: colorFor(server.id) }} aria-hidden="true">
            {initials(server.name, 2)}
          </div>
          <h2 className="mt-6 text-[28px] font-bold leading-tight text-header">Boas-vindas a {server.name}</h2>
          <p className="mt-2 text-muted">
            {hasChannels ? 'Escolha um canal na barra lateral para começar a conversar.' : 'Este é o começo do seu servidor. Siga os passos abaixo para deixá-lo pronto.'}
          </p>
          <div className="mt-8 space-y-2 text-left">
            <WelcomeStep icon={<UserPlus size={22} />} title="Convide seus amigos" onClick={onInvite} />
            {owner && <WelcomeStep icon={<MessageSquarePlus size={22} />} title="Crie um canal" onClick={onCreateChannel} />}
            <WelcomeStep icon={<Hash size={22} />} title="Ver canais" className="md:hidden" onClick={onOpenNavigation} />
          </div>
        </div>
      </div>
    </section>
  );
}

function WelcomeStep({ icon, title, className = '', onClick }: { icon: ReactNode; title: string; className?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-4 rounded-lg bg-sidebar p-4 text-left transition hover:bg-hover ${className}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/20 text-[#949cf7]">{icon}</span>
      <span className="flex-1 font-semibold text-header">{title}</span>
      <span className="text-interactive" aria-hidden="true">›</span>
    </button>
  );
}
