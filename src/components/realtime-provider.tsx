'use client';

import { Client } from '@stomp/stompjs';
import Cookies from 'js-cookie';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import toast from 'react-hot-toast';
import api from '@/src/services/api';
import { getRuntimeConfig } from '@/src/services/runtime-config';
import type {
  ChannelMessage,
  FriendshipEvent,
  MediaPresenceEvent,
  ServerInviteEvent,
  ServerMemberEvent,
} from '@/src/types';

type Listener<T> = (event: T) => void;

interface RealtimeContextValue {
  connected: boolean;
  connectionRevision: number;
  subscribeMessages: (listener: Listener<ChannelMessage>) => () => void;
  subscribePresence: (listener: Listener<MediaPresenceEvent>) => () => void;
  subscribeFriendships: (listener: Listener<FriendshipEvent>) => () => void;
  subscribeServerInvites: (listener: Listener<ServerInviteEvent>) => () => void;
  subscribeServerMembers: (listener: Listener<ServerMemberEvent>) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isChannelMessage(value: unknown): value is ChannelMessage {
  if (!isObject(value)) return false;
  return value.id != null && typeof value.channelId === 'string' &&
    typeof value.content === 'string' && typeof value.authorId === 'string' &&
    typeof value.authorName === 'string' && typeof value.createdAt === 'string';
}

function isPresenceEvent(value: unknown): value is MediaPresenceEvent {
  if (!isObject(value) || !isObject(value.participant)) return false;
  return typeof value.type === 'string' && typeof value.participant.channelId === 'string' &&
    typeof value.participant.userId === 'string';
}

function isFriendshipEvent(value: unknown): value is FriendshipEvent {
  return isObject(value) && typeof value.type === 'string' && value.type.startsWith('friendship.request.') &&
    typeof value.friendshipId === 'number' && typeof value.requesterId === 'string' &&
    typeof value.addresseeId === 'string';
}

function isServerInviteEvent(value: unknown): value is ServerInviteEvent {
  return isObject(value) && typeof value.type === 'string' && value.type.startsWith('server.invite.') &&
    typeof value.inviteId === 'number' && typeof value.serverId === 'string';
}

function isServerMemberEvent(value: unknown): value is ServerMemberEvent {
  return isObject(value) && value.type === 'server.member.joined' && typeof value.serverId === 'string' &&
    isObject(value.member) && typeof value.member.userId === 'string';
}

function parseFrame<T>(body: string, guard: (value: unknown) => value is T): T | null {
  try {
    const value: unknown = JSON.parse(body);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

function notify<T>(body: string, guard: (value: unknown) => value is T, listeners: Set<Listener<T>>) {
  const event = parseFrame(body, guard);
  if (event) listeners.forEach(listener => listener(event));
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const messageListeners = useRef(new Set<Listener<ChannelMessage>>());
  const presenceListeners = useRef(new Set<Listener<MediaPresenceEvent>>());
  const friendshipListeners = useRef(new Set<Listener<FriendshipEvent>>());
  const serverInviteListeners = useRef(new Set<Listener<ServerInviteEvent>>());
  const serverMemberListeners = useRef(new Set<Listener<ServerMemberEvent>>());

  useEffect(() => {
    let active = true;
    let client: Client | undefined;

    async function connect() {
      try {
        const config = await getRuntimeConfig();
        const token = Cookies.get('chat_token');
        if (!active || !token) return;

        client = new Client({
          brokerURL: config.brokerUrl,
          connectHeaders: { Authorization: `Bearer ${token}` },
          reconnectDelay: 3000,
          connectionTimeout: 10000,
          heartbeatIncoming: 10000,
          heartbeatOutgoing: 10000,
        });
        client.beforeConnect = () => {
          const currentToken = Cookies.get('chat_token');
          if (!currentToken) {
            void client?.deactivate();
            return;
          }
          client!.connectHeaders = { Authorization: `Bearer ${currentToken}` };
        };
        client.onConnect = () => {
          if (!active) return;
          client!.subscribe('/user/queue/messages', frame => {
            const message = parseFrame(frame.body, isChannelMessage);
            if (!message) {
              toast.error('Uma mensagem em formato inválido foi ignorada.');
              return;
            }
            messageListeners.current.forEach(listener => listener(message));
          });
          client!.subscribe('/user/queue/media-presence', frame =>
            notify(frame.body, isPresenceEvent, presenceListeners.current));
          client!.subscribe('/user/queue/friendships', frame =>
            notify(frame.body, isFriendshipEvent, friendshipListeners.current));
          client!.subscribe('/user/queue/server-invites', frame =>
            notify(frame.body, isServerInviteEvent, serverInviteListeners.current));
          client!.subscribe('/user/queue/server-members', frame =>
            notify(frame.body, isServerMemberEvent, serverMemberListeners.current));

          // As assinaturas são registradas antes de liberar a reconciliação REST nos consumidores.
          setConnected(true);
          setConnectionRevision(revision => revision + 1);
        };
        client.onWebSocketClose = () => active && setConnected(false);
        client.onWebSocketError = () => active && setConnected(false);
        client.onStompError = () => {
          if (!active) return;
          setConnected(false);
          void api.get('/users/me').catch(() => undefined);
          toast.error('A conexão em tempo real foi recusada pelo servidor.');
        };
        client.activate();
      } catch {
        if (active) toast.error('Não foi possível iniciar a conexão em tempo real.');
      }
    }

    void connect();
    return () => {
      active = false;
      setConnected(false);
      void client?.deactivate();
    };
  }, []);

  const subscribeMessages = useCallback((listener: Listener<ChannelMessage>) => {
    messageListeners.current.add(listener);
    return () => messageListeners.current.delete(listener);
  }, []);
  const subscribePresence = useCallback((listener: Listener<MediaPresenceEvent>) => {
    presenceListeners.current.add(listener);
    return () => presenceListeners.current.delete(listener);
  }, []);
  const subscribeFriendships = useCallback((listener: Listener<FriendshipEvent>) => {
    friendshipListeners.current.add(listener);
    return () => friendshipListeners.current.delete(listener);
  }, []);
  const subscribeServerInvites = useCallback((listener: Listener<ServerInviteEvent>) => {
    serverInviteListeners.current.add(listener);
    return () => serverInviteListeners.current.delete(listener);
  }, []);
  const subscribeServerMembers = useCallback((listener: Listener<ServerMemberEvent>) => {
    serverMemberListeners.current.add(listener);
    return () => serverMemberListeners.current.delete(listener);
  }, []);

  const value = useMemo(() => ({
    connected,
    connectionRevision,
    subscribeMessages,
    subscribePresence,
    subscribeFriendships,
    subscribeServerInvites,
    subscribeServerMembers,
  }), [
    connected,
    connectionRevision,
    subscribeFriendships,
    subscribeMessages,
    subscribePresence,
    subscribeServerInvites,
    subscribeServerMembers,
  ]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime deve ser usado dentro de RealtimeProvider');
  return context;
}
