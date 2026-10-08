import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MediaRoom } from '@/src/components/media-room';
import type { CurrentUser, MediaTarget } from '@/src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  realtime: { connected: true, connectionRevision: 1 },
  subscribePresence: () => () => undefined,
}));

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
    on() { return this; }
    connect = vi.fn(async () => undefined);
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
