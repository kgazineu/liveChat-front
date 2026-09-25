import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceShell from '@/src/components/workspace-shell';
import type { CurrentUser, MediaTarget, TextTarget } from '@/src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  prepareCallSounds: vi.fn(),
  presenceListener: null as ((event: unknown) => void) | null,
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
  MediaRoom: ({
    target,
    visible,
    onSummaryAction,
  }: {
    target: MediaTarget;
    visible: boolean;
    onSummaryAction?: (summary: { sessions: unknown[]; speakingUserIds: string[] }) => void;
  }) => {
    useEffect(() => {
      if (target.kind !== 'SERVER_VOICE') return;
      onSummaryAction?.({
        sessions: [{
          channelKind: 'SERVER_VOICE',
          serverId: target.serverId,
          channelId: target.channelId,
          userId: 'user-2',
          userName: 'Bruno',
          status: 'ACTIVE',
          microphoneEnabled: true,
          cameraEnabled: false,
          screenShareEnabled: false,
          joinedAt: '2026-09-23T12:00:00Z',
          lastSeenAt: '2026-09-23T12:00:01Z',
        }],
        speakingUserIds: ['user-2'],
      });
    }, [onSummaryAction, target]);
    return (
      <div data-testid="media-room" data-visible={String(visible)}>
        Chamada em {target.title}
      </div>
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
  mocks.presenceListener = null;
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
