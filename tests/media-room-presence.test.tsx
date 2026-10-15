import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ALONE_IN_CALL_TIMEOUT_MS, MEDIA_QUOTA_MESSAGE, MediaRoom, mediaServerRejectsForQuota } from '@/src/components/media-room';
import type { CurrentUser, MediaTarget } from '@/src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  realtime: { connected: true, connectionRevision: 1 },
  subscribePresence: () => () => undefined,
  rooms: [] as Array<{ emit: (event: string) => void; remoteParticipants: Map<string, unknown> }>,
  connectError: null as Error | null,
  toast: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

vi.mock('@/src/services/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete },
}));

vi.mock('@/src/components/realtime-provider', () => ({
  useRealtime: () => ({
    connected: mocks.realtime.connected,
    connectionRevision: mocks.realtime.connectionRevision,
    subscribePresence: mocks.subscribePresence,
  }),
}));

vi.mock('livekit-client', () => {
  class FakeRoom {
    static getLocalDevices = vi.fn(async () => []);
    localParticipant = {
      isMicrophoneEnabled: true,
      isCameraEnabled: false,
      isScreenShareEnabled: false,
      trackPublications: new Map(),
      setMicrophoneEnabled: vi.fn(async () => undefined),
      getTrackPublication: () => undefined,
    };
    remoteParticipants = new Map();
    canPlaybackAudio = true;
    state = 'connected';
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor() { mocks.rooms.push(this); }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string) { this.handlers.get(event)?.forEach(handler => handler()); }
    connect = vi.fn(async () => {
      if (!mocks.connectError) return;
      // Como o SDK real: avisa a desconexão antes de rejeitar a conexão.
      this.emit('Disconnected');
      throw mocks.connectError;
    });
    disconnect = vi.fn(async () => undefined);
    getActiveDevice() { return ''; }
  }
  return {
    Room: FakeRoom,
    RoomEvent: new Proxy({}, { get: (_target, name) => String(name) }),
    Track: { Kind: { Audio: 'audio', Video: 'video' }, Source: { ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' } },
  };
});

const currentUser: CurrentUser = { id: 'user-1', name: 'Kaian', email: 'kaian@example.com' };
const target: MediaTarget = { kind: 'SERVER_VOICE', serverId: 'server-1', channelId: 'voice-1', title: 'Sala de voz' };
const endpoint = '/servers/server-1/channels/voice-1/media-sessions';

function session() {
  return {
    channelKind: 'SERVER_VOICE',
    serverId: 'server-1',
    channelId: 'voice-1',
    userId: currentUser.id,
    userName: currentUser.name,
    status: 'ACTIVE',
    microphoneEnabled: true,
    cameraEnabled: false,
    screenShareEnabled: false,
    joinedAt: '2026-10-07T12:00:00Z',
    lastSeenAt: '2026-10-07T12:00:00Z',
    connection: { url: 'wss://media.example.test', roomName: 'server-voice-voice-1', token: 'token', expiresAt: '2026-10-07T12:05:00Z' },
  };
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ data: [] });
  mocks.post.mockReset().mockImplementation(async () => ({ data: session() }));
  mocks.patch.mockReset().mockResolvedValue({ data: session() });
  mocks.delete.mockReset().mockResolvedValue({});
  mocks.realtime.connectionRevision = 1;
  mocks.rooms.length = 0;
  mocks.connectError = null;
  mocks.toast.mockReset();
});

function room() {
  return (
    <MediaRoom
      currentUser={currentUser}
      target={target}
      visible
      onOpenAction={() => undefined}
      onLeaveAction={() => undefined}
    />
  );
}

it('não encerra a presença compartilhada quando o StrictMode descarta a primeira montagem', async () => {
  render(<StrictMode>{room()}</StrictMode>);

  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(mocks.delete).not.toHaveBeenCalled();
});

it('sai da sala quando o componente é realmente desmontado', async () => {
  const { unmount } = render(room());
  await waitFor(() => expect(mocks.patch).toHaveBeenCalled());

  unmount();

  await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith(endpoint));
});

it('entra de novo para reativar a presença quando o tempo real reconecta', async () => {
  const { rerender } = render(room());
  await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
  expect(mocks.post).toHaveBeenCalledTimes(1);

  mocks.realtime.connectionRevision = 2;
  rerender(room());

  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post).toHaveBeenLastCalledWith(endpoint);
});

it('mostra quem já está na sala de mídia mesmo quando o evento de presença não chegou', async () => {
  const onSummary = vi.fn();
  render(
    <MediaRoom
      currentUser={currentUser}
      target={target}
      visible
      onOpenAction={() => undefined}
      onLeaveAction={() => undefined}
      onSummaryAction={onSummary}
    />,
  );
  await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
  const getsBefore = mocks.get.mock.calls.length;

  const room = mocks.rooms.at(-1)!;
  room.remoteParticipants.set('user-2', {
    identity: 'user-2',
    name: 'Bruno',
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    trackPublications: new Map(),
  });
  act(() => room.emit('ParticipantConnected'));

  expect(await screen.findByText('Bruno')).toBeInTheDocument();
  await waitFor(() => expect(onSummary).toHaveBeenLastCalledWith(expect.objectContaining({
    sessions: expect.arrayContaining([expect.objectContaining({ userId: 'user-2', microphoneEnabled: false })]),
  })));
  // A entrada vista pelo LiveKit dispara uma nova conferência da lista no servidor.
  await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(getsBefore));
});

it('identifica a recusa por cota do servidor de mídia no endpoint de validação', async () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(mediaServerRejectsForQuota({ url: 'wss://media.example.test', token: 'abc' })).resolves.toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://media.example.test/rtc/v1/validate?access_token=abc');

    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(mediaServerRejectsForQuota({ url: 'wss://media.example.test', token: 'abc' })).resolves.toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('explica a falha quando o servidor de mídia atingiu o limite do plano', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
  mocks.connectError = new Error('could not establish signal connection');
  try {
    render(room());
    expect(await screen.findByText(MEDIA_QUOTA_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith(endpoint));
  } finally {
    vi.unstubAllGlobals();
  }
});

it('sai da chamada depois de ficar sozinho por muito tempo, mas não enquanto há companhia', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onLeave = vi.fn();
  try {
    render(
      <MediaRoom
        currentUser={currentUser}
        target={target}
        visible
        onOpenAction={() => undefined}
        onLeaveAction={onLeave}
      />,
    );
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    const fakeRoom = mocks.rooms.at(-1)!;
    fakeRoom.remoteParticipants.set('user-2', {
      identity: 'user-2', name: 'Bruno', isMicrophoneEnabled: true, isCameraEnabled: false, isScreenShareEnabled: false,
      trackPublications: new Map(),
    });
    act(() => fakeRoom.emit('ParticipantConnected'));
    await act(async () => { vi.advanceTimersByTime(ALONE_IN_CALL_TIMEOUT_MS + 1000); });
    expect(onLeave).not.toHaveBeenCalled();

    fakeRoom.remoteParticipants.clear();
    act(() => fakeRoom.emit('ParticipantDisconnected'));
    await act(async () => { vi.advanceTimersByTime(ALONE_IN_CALL_TIMEOUT_MS + 1000); });
    expect(onLeave).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('ficou sozinho'), expect.anything());
  } finally {
    vi.useRealTimers();
  }
});
