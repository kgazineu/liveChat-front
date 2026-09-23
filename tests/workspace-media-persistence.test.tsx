import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceShell from '@/src/components/workspace-shell';
import type { MediaTarget, TextTarget, User } from '@/src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  prepareCallSounds: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/src/services/api', () => ({
  default: {
    get: mocks.get,
    post: vi.fn(),
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
    subscribeServerInvites: () => () => undefined,
    subscribeServerMembers: () => () => undefined,
  }),
}));

vi.mock('@/src/components/media-room', () => ({
  prepareCallSounds: mocks.prepareCallSounds,
  MediaRoom: ({ target, visible }: { target: MediaTarget; visible: boolean }) => (
    <div data-testid="media-room" data-visible={String(visible)}>
      Chamada em {target.title}
    </div>
  ),
}));

vi.mock('@/src/components/message-panel', () => ({
  default: ({ target }: { target: TextTarget }) => (
    <div data-testid="message-panel">Mensagens em {target.title}</div>
  ),
}));

const currentUser: User = {
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
        data: [
          { id: 'text-1', name: 'geral', type: 'TEXT', position: 0, createdAt: '2026-09-23T12:00:00Z' },
          { id: 'voice-1', name: 'Sala de voz', type: 'VOICE', position: 1, createdAt: '2026-09-23T12:00:00Z' },
        ],
      });
    }
    if (url === '/servers/server-1/members') return Promise.resolve({ data: [] });
    if (url === '/friendships' || url === '/friendships/requests' ||
      url === '/servers/invites' || url === '/direct-channels') {
      return Promise.resolve({ data: [] });
    }
    throw new Error(`GET inesperado: ${url}`);
  });
  mocks.prepareCallSounds.mockReset();
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
