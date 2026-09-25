import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import Cookies from 'js-cookie';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Client } from '@stomp/stompjs';
import { RealtimeProvider, useRealtime } from '@/src/components/realtime-provider';

const mocks = vi.hoisted(() => ({
  clients: [] as unknown[],
  message: vi.fn(),
  friendship: vi.fn(),
  invite: vi.fn(),
  member: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock('@/src/services/runtime-config', () => ({
  getRuntimeConfig: async () => ({ apiUrl: 'https://api.example.invalid', brokerUrl: 'wss://ws.example.invalid/ws' }),
}));
vi.mock('@/src/services/api', () => ({ default: { get: mocks.apiGet } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('@stomp/stompjs', () => ({
  ReconnectionTimeMode: { EXPONENTIAL: 'EXPONENTIAL' },
  Client: class {
    connected = true;
    activate = vi.fn();
    deactivate = vi.fn();
    subscribe = vi.fn();
    connectHeaders = {};
    beforeConnect = vi.fn();
    onConnect = vi.fn();
    onWebSocketClose = vi.fn();
    onWebSocketError = vi.fn();
    onStompError = vi.fn();
    constructor() { mocks.clients.push(this); }
  },
}));

function Probe() {
  const realtime = useRealtime();
  useEffect(() => {
    const message = realtime.subscribeMessages(mocks.message);
    const first = realtime.subscribeFriendships(mocks.friendship);
    const second = realtime.subscribeServerInvites(mocks.invite);
    const third = realtime.subscribeServerMembers(mocks.member);
    return () => { message(); first(); second(); third(); };
  }, [realtime]);
  return <span>{realtime.connected ? `conectado-${realtime.connectionRevision}` : 'desconectado'}</span>;
}

beforeEach(() => {
  mocks.clients.length = 0;
  mocks.message.mockReset();
  mocks.friendship.mockReset();
  mocks.invite.mockReset();
  mocks.member.mockReset();
  mocks.apiGet.mockReset();
  Cookies.set('chat_token', 'token', { path: '/' });
});

it('assina todas as filas antes de publicar a revisão e entrega eventos sociais', async () => {
  render(<RealtimeProvider><Probe /></RealtimeProvider>);
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  const client = mocks.clients[0] as Client;

  await act(async () => { client.onConnect({} as never); });

  expect(vi.mocked(client.subscribe).mock.calls.map(call => call[0])).toEqual([
    '/user/queue/messages',
    '/user/queue/media-presence',
    '/user/queue/friendships',
    '/user/queue/server-invites',
    '/user/queue/server-members',
  ]);
  expect(screen.getByText('conectado-1')).toBeInTheDocument();

  const friendshipCallback = vi.mocked(client.subscribe).mock.calls.find(call => call[0] === '/user/queue/friendships')![1];
  act(() => friendshipCallback({ body: JSON.stringify({
    type: 'friendship.request.created',
    friendshipId: 10,
    requesterId: 'user-1',
    requesterName: 'Ana',
    addresseeId: 'user-2',
    addresseeName: 'Bruno',
    status: 'PENDING',
    createdAt: '2026-09-23T20:00:00Z',
  }) } as never));

  expect(mocks.friendship).toHaveBeenCalledWith(expect.objectContaining({
    type: 'friendship.request.created',
    friendshipId: 10,
  }));

  const messageCallback = vi.mocked(client.subscribe).mock.calls.find(call => call[0] === '/user/queue/messages')![1];
  act(() => messageCallback({ body: JSON.stringify({
    id: 20,
    channelId: 'channel-1',
    content: '',
    authorId: 'user-1',
    authorName: 'Ana',
    createdAt: '2026-09-25T20:00:00Z',
    attachments: [{
      id: 'attachment-1',
      originalName: 'foto.png',
      contentType: 'image/png',
      size: 100,
      width: 10,
      height: 10,
      downloadUrl: 'https://cdn.example/foto.png',
      downloadExpiresAt: '2026-09-25T20:05:00Z',
    }],
  }) } as never));

  expect(mocks.message).toHaveBeenCalledWith(expect.objectContaining({
    id: 20,
    attachments: [expect.objectContaining({ id: 'attachment-1' })],
  }));
});
