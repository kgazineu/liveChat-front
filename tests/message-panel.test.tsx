import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import MessagePanel from '@/src/components/message-panel';
import type { ChannelMessage, User } from '@/src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  startCall: vi.fn(),
  listener: null as ((message: ChannelMessage) => void) | null,
}));

vi.mock('@/src/services/api', () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock('@/src/components/realtime-provider', () => ({
  useRealtime: () => ({
    connected: true,
    subscribeMessages: (listener: (message: ChannelMessage) => void) => {
      mocks.listener = listener;
      return () => { mocks.listener = null; };
    },
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

const me: User = { id: 'user-1', name: 'Ana', email: 'ana@example.com' };
const directTarget = { kind: 'DIRECT' as const, channelId: 'direct-1', title: 'Bruno', subtitle: 'Mensagem direta' };

function message(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: 1,
    channelId: 'direct-1',
    content: 'Olá',
    authorId: 'user-2',
    authorName: 'Bruno',
    createdAt: '2026-09-22T18:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ data: [] });
  mocks.post.mockReset();
  mocks.startCall.mockReset();
  mocks.listener = null;
});

it('usa o canal privado para histórico, envio e início de chamada', async () => {
  mocks.post.mockResolvedValue({ data: message({ id: 2, content: 'Mensagem enviada', authorId: me.id, authorName: me.name }) });
  render(<MessagePanel currentUser={me} target={directTarget} onStartCall={mocks.startCall} />);

  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(
    '/direct-channels/direct-1/messages',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  ));
  fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Mensagem enviada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
    '/direct-channels/direct-1/messages',
    { content: 'Mensagem enviada' },
  ));
  expect(await screen.findByText('Mensagem enviada')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar chamada' }));
  expect(mocks.startCall).toHaveBeenCalledOnce();
});

it('recebe somente eventos do canal selecionado e deduplica o eco', async () => {
  mocks.get.mockResolvedValue({ data: [message()] });
  render(<MessagePanel currentUser={me} target={directTarget} />);
  expect(await screen.findByText('Olá')).toBeInTheDocument();

  act(() => {
    mocks.listener?.(message());
    mocks.listener?.(message({ id: 3, channelId: 'outro-canal', content: 'Outra conversa' }));
  });

  expect(screen.getAllByText('Olá')).toHaveLength(1);
  expect(screen.queryByText('Outra conversa')).not.toBeInTheDocument();
});
