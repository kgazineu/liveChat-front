import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceShell from '@/src/components/workspace-shell';
import type { CurrentUser, MediaSession, MediaTarget, TextTarget } from '@/src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  prepareCallSounds: vi.fn(),
  presenceListener: null as ((event: unknown) => void) | null,
  mediaSummarySessions: [] as MediaSession[],
  speakingUserIds: [] as string[],
  summaryEmitted: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/src/services/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/src/components/realtime-provider', () => ({
  RealtimeProvider: ({ children }: { children: ReactNode }) => children,
  useRealtime: () => ({
    connectionRevision: 0,
    subscribeFriendships: () => () => undefined,
    subscribePresence: (listener: (event: unknown) => void) => {
      mocks.presenceListener = listener;
      return () => { mocks.presenceListener = null; };
    },
    subscribeServerInvites: () => () => undefined,
    subscribeServerMembers: () => () => undefined,
  }),
}));

vi.mock('@/src/components/media-room', () => ({
  prepareCallSounds: mocks.prepareCallSounds,
  storedParticipantVolume: (userId: string) => {
    const raw = window.localStorage.getItem(`volume:${userId}`);
    if (raw == null) return 1;
    const stored = Number(raw);
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 1;
  },
  storeParticipantVolume: (userId: string, volume: number) => {
    const normalized = Math.min(1, Math.max(0, volume));
    window.localStorage.setItem(`volume:${userId}`, String(normalized));
    return normalized;
  },
  MediaRoom: ({
    target,
    visible,
    onSummaryAction,
    showMetrics,
    participantVolumes,
    devicePanelTarget,
  }: {
    target: MediaTarget;
    visible: boolean;
    onSummaryAction?: (summary: { sessions: MediaSession[]; speakingUserIds: string[] }) => void;
    showMetrics?: boolean;
    participantVolumes?: Record<string, number>;
    devicePanelTarget?: HTMLElement | null;
  }) => {
    useEffect(() => {
      if (target.kind !== 'SERVER_VOICE') return;
      onSummaryAction?.({
        sessions: mocks.mediaSummarySessions,
        speakingUserIds: mocks.speakingUserIds,
      });
      mocks.summaryEmitted();
    }, [onSummaryAction, target]);
    return (
      <>
        <div
          data-testid="media-room"
          data-visible={String(visible)}
          data-metrics={String(showMetrics)}
          data-volumes={JSON.stringify(participantVolumes ?? {})}
        >
          Chamada em {target.title}
        </div>
        {devicePanelTarget && createPortal(<button type="button">Dispositivos de mídia</button>, devicePanelTarget)}
      </>
    );
  },
}));

vi.mock('@/src/components/message-panel', () => ({
  default: ({ target }: { target: TextTarget }) => (
    <div data-testid="message-panel">Mensagens em {target.title}</div>
  ),
}));

const currentUser: CurrentUser = {
  id: 'user-1',
  name: 'Kaian',
  email: 'kaian@example.com',
};

beforeEach(() => {
  mocks.get.mockReset().mockImplementation((url: string) => {
    if (url === '/servers') {
      return Promise.resolve({
        data: [{
          id: 'server-1',
          name: 'Comunidade',
          ownerId: currentUser.id,
          role: 'OWNER',
          createdAt: '2026-09-23T12:00:00Z',
        }],
      });
    }
    if (url === '/servers/server-1/channels') {
      return Promise.resolve({
        data: {
          content: [
            { id: 'text-1', name: 'geral', type: 'TEXT', position: 0, createdAt: '2026-09-23T12:00:00Z' },
            { id: 'voice-1', name: 'Sala de voz', type: 'VOICE', position: 1, createdAt: '2026-09-23T12:00:00Z' },
          ],
          page: 0,
          size: 100,
          totalElements: 2,
          totalPages: 1,
          last: true,
        },
      });
    }
    if (url === '/servers/server-1/members') {
      return Promise.resolve({
        data: {
          content: [{
            userId: 'user-2',
            userName: 'Bruno',
            role: 'MEMBER',
            joinedAt: '2026-09-23T12:00:00Z',
          }],
          page: 0,
          size: 100,
          totalElements: 1,
          totalPages: 1,
          last: true,
        },
      });
    }
    if (url === '/friendships' || url === '/friendships/requests') {
      return Promise.resolve({
        data: { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0, last: true },
      });
    }
    if (url === '/servers/server-1/channels/voice-1/media-sessions') {
      return Promise.resolve({
        data: [{
          channelKind: 'SERVER_VOICE',
          serverId: 'server-1',
          channelId: 'voice-1',
          userId: 'user-2',
          userName: 'Bruno',
          status: 'ACTIVE',
          microphoneEnabled: true,
          cameraEnabled: false,
          screenShareEnabled: false,
          joinedAt: '2026-09-23T12:00:00Z',
          lastSeenAt: '2026-09-23T12:00:00Z',
        }],
      });
    }
    if (url === '/servers/invites' || url === '/direct-channels') return Promise.resolve({ data: [] });
    throw new Error(`GET inesperado: ${url}`);
  });
  mocks.post.mockReset().mockResolvedValue({ data: {} });
  mocks.prepareCallSounds.mockReset();
  mocks.summaryEmitted.mockReset();
  mocks.mediaSummarySessions = [{
    channelKind: 'SERVER_VOICE',
    serverId: 'server-1',
    channelId: 'voice-1',
    userId: 'user-2',
    userName: 'Bruno',
    status: 'ACTIVE',
    microphoneEnabled: true,
    cameraEnabled: false,
    screenShareEnabled: false,
    joinedAt: '2026-09-23T12:00:00Z',
    lastSeenAt: '2026-09-23T12:00:01Z',
  }];
  mocks.speakingUserIds = ['user-2'];
  mocks.presenceListener = null;
  window.localStorage.clear();
});

it('mantém a sala de mídia ativa enquanto o usuário envia mensagens em outro canal', async () => {
  render(<WorkspaceShell currentUser={currentUser} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Comunidade' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sala de voz' }));

  expect(screen.getByTestId('media-room')).toHaveAttribute('data-visible', 'true');
  expect(mocks.prepareCallSounds).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole('button', { name: 'geral' }));

  await waitFor(() => {
    expect(screen.getByTestId('message-panel')).toHaveTextContent('Mensagens em geral');
  });
  expect(screen.getByTestId('media-room')).toHaveAttribute('data-visible', 'false');

  fireEvent.click(screen.getByRole('button', { name: 'Sala de voz' }));
  expect(screen.getByTestId('media-room')).toHaveAttribute('data-visible', 'true');
  expect(mocks.prepareCallSounds).toHaveBeenCalledOnce();
});

it('preserva participantes do snapshot quando a segunda conta entra na chamada', async () => {
  mocks.mediaSummarySessions = [{
    channelKind: 'SERVER_VOICE',
    serverId: 'server-1',
    channelId: 'voice-1',
    userId: currentUser.id,
    userName: currentUser.name,
    status: 'ACTIVE',
    microphoneEnabled: true,
    cameraEnabled: false,
    screenShareEnabled: false,
    joinedAt: '2026-09-23T12:01:00Z',
    lastSeenAt: '2026-09-23T12:01:01Z',
  }];
  mocks.speakingUserIds = [];
  render(<WorkspaceShell currentUser={currentUser} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Comunidade' }));
  const voiceChannel = await screen.findByRole('button', { name: 'Sala de voz' });
  await waitFor(() => expect(voiceChannel.parentElement).toHaveTextContent('Bruno'));
  fireEvent.click(voiceChannel);

  await waitFor(() => expect(mocks.summaryEmitted).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: 'Kaian (você)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Configurar áudio de Bruno' })).toBeInTheDocument();
});

it('abre o volume do participante sob o canal somente após o clique e persiste o ajuste', async () => {
  render(<WorkspaceShell currentUser={currentUser} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Comunidade' }));
  const voiceChannel = await screen.findByRole('button', { name: 'Sala de voz' });
  await waitFor(() => expect(voiceChannel.parentElement).toHaveTextContent('Bruno'));
  expect(screen.queryByRole('slider', { name: 'Volume de Bruno' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Configurar áudio de Bruno' }));
  const volume = screen.getByRole('slider', { name: 'Volume de Bruno' });
  expect(screen.queryByText('Participantes da chamada')).not.toBeInTheDocument();
  fireEvent.change(volume, { target: { value: '0.4' } });

  expect(window.localStorage.getItem('volume:user-2')).toBe('0.4');
  expect(volume).toHaveValue('0.4');
});

it('controla a qualidade WebRTC pela engrenagem e mantém dispositivos sob os membros', async () => {
  render(<WorkspaceShell currentUser={currentUser} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Comunidade' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sala de voz' }));
  const devices = await screen.findByRole('button', { name: 'Dispositivos de mídia' });
  expect(devices.closest('aside')).toHaveAttribute('aria-label', 'Membros de Comunidade');

  expect(screen.getByTestId('media-room')).toHaveAttribute('data-metrics', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Abrir configurações' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar qualidade WebRTC' }));
  expect(screen.getByTestId('media-room')).toHaveAttribute('data-metrics', 'true');
});

it('mostra participantes sob o canal de voz e envia amizade pelo painel de membros sem depender de e-mail', async () => {
  render(<WorkspaceShell currentUser={currentUser} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Comunidade' }));
  const voiceChannel = await screen.findByRole('button', { name: 'Sala de voz' });
  await waitFor(() => expect(voiceChannel.parentElement).toHaveTextContent('Bruno'));

  fireEvent.click(voiceChannel);
  expect(await screen.findByLabelText('Bruno está falando')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: 'Ver Bruno' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar amigo' }));

  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/friendships/send', { targetUserId: 'user-2' }));
  expect(await screen.findByRole('button', { name: 'Solicitação enviada' })).toBeDisabled();
  expect(screen.queryByText(/@/)).not.toBeInTheDocument();
});
