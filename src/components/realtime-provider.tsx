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
import type { ChannelMessage, MediaPresenceEvent } from '@/src/types';

type MessageListener = (message: ChannelMessage) => void;
type PresenceListener = (event: MediaPresenceEvent) => void;

interface RealtimeContextValue {
  connected: boolean;
  subscribeMessages: (listener: MessageListener) => () => void;
  subscribePresence: (listener: PresenceListener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function isChannelMessage(value: unknown): value is ChannelMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChannelMessage>;
  return message.id != null && typeof message.channelId === 'string' &&
    typeof message.content === 'string' && typeof message.authorId === 'string' &&
    typeof message.authorName === 'string' && typeof message.createdAt === 'string';
}

function isPresenceEvent(value: unknown): value is MediaPresenceEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<MediaPresenceEvent>;
  return typeof event.type === 'string' && !!event.participant &&
    typeof event.participant.channelId === 'string' && typeof event.participant.userId === 'string';
}

function parseFrame<T>(body: string, guard: (value: unknown) => value is T): T | null {
  try {
    const value: unknown = JSON.parse(body);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const messageListeners = useRef(new Set<MessageListener>());
  const presenceListeners = useRef(new Set<PresenceListener>());

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
          setConnected(true);
          client!.subscribe('/user/queue/messages', frame => {
            const message = parseFrame(frame.body, isChannelMessage);
            if (!message) {
              toast.error('Uma mensagem em formato inválido foi ignorada.');
              return;
            }
            messageListeners.current.forEach(listener => listener(message));
          });
          client!.subscribe('/user/queue/media-presence', frame => {
            const event = parseFrame(frame.body, isPresenceEvent);
            if (!event) return;
            presenceListeners.current.forEach(listener => listener(event));
          });
        };
        client.onWebSocketClose = () => active && setConnected(false);
        client.onWebSocketError = () => active && setConnected(false);
        client.onStompError = () => {
          if (!active) return;
          setConnected(false);
          // Força a renovação do JWT, quando necessária, antes da próxima tentativa STOMP.
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

  const subscribeMessages = useCallback((listener: MessageListener) => {
    messageListeners.current.add(listener);
    return () => messageListeners.current.delete(listener);
  }, []);

  const subscribePresence = useCallback((listener: PresenceListener) => {
    presenceListeners.current.add(listener);
    return () => presenceListeners.current.delete(listener);
  }, []);

  const value = useMemo(
    () => ({ connected, subscribeMessages, subscribePresence }),
    [connected, subscribeMessages, subscribePresence],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime deve ser usado dentro de RealtimeProvider');
  return context;
}
