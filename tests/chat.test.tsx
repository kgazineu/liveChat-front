import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ChatWindow from '@/src/components/chatWindow';
import type { Message, User } from '@/src/types';
import type { Client } from '@stomp/stompjs';

const mocks = vi.hoisted(() => ({ get: vi.fn(), clients: [] as unknown[], publish: vi.fn(), error: vi.fn() }));
vi.mock('@/src/services/api', () => ({ default: { get: mocks.get } }));
vi.mock('@/src/services/runtime-config', () => ({ getRuntimeConfig: async () => ({ brokerUrl: 'wss://example.invalid/ws' }) }));
vi.mock('js-cookie', () => ({ default: { get: () => 'token' } }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: mocks.error }) }));
vi.mock('@stomp/stompjs', () => ({ Client: class {
  connected = true;
  activate = vi.fn();
  deactivate = vi.fn();
  publish = mocks.publish;
  subscribe = vi.fn();
  constructor() { mocks.clients.push(this); }
} }));

const me: User = { id: '1', name: 'Eu', email: 'me@example.invalid' };
const friend: User = { id: '2', name: 'Amigo', email: 'friend@example.invalid' };
const another: User = { id: '3', name: 'Outro', email: 'other@example.invalid' };
function message(id: number, content: string): Message {
  return { id, content, senderId: '2', senderEmail: friend.email, senderName: friend.name, receiverId: '1', receiverEmail: me.email, timestamp: `2026-09-05T12:00:0${id}Z` };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function connect() {
  await waitFor(() => expect(mocks.clients.length).toBeGreaterThan(0));
  const client = mocks.clients.at(-1) as Client;
  await act(async () => { client.onConnect({} as never); });
  const receive = vi.mocked(client.subscribe).mock.calls.at(-1)![1];
  return { client, receive };
}
beforeEach(() => {
  mocks.clients.length = 0;
  mocks.get.mockReset().mockResolvedValue({ data: [] });
  mocks.publish.mockReset(); mocks.error.mockReset();
});

it('preserva mensagens ao vivo quando o histórico chega depois e deduplica o eco', async () => {
  const history = deferred<{ data: Message[] }>();
  mocks.get.mockReturnValue(history.promise);
  render(<ChatWindow currentUser={me} selectedUser={friend} />);
  const { receive } = await connect();
  await act(async () => { receive({ body: JSON.stringify(message(2, 'Ao vivo')) } as never); });
  await act(async () => { history.resolve({ data: [message(1, 'Histórico'), message(2, 'Ao vivo')] }); });
  expect(screen.getByText('Histórico')).toBeInTheDocument();
  expect(screen.getAllByText('Ao vivo')).toHaveLength(1);
});

it('ignora resposta atrasada da conversa anterior e limpa o rascunho ao trocar contato', async () => {
  const old = deferred<{ data: Message[] }>();
  mocks.get.mockReturnValueOnce(old.promise).mockResolvedValue({ data: [] });
  const { rerender } = render(<ChatWindow key={friend.id} currentUser={me} selectedUser={friend} />);
  fireEvent.change(screen.getByPlaceholderText('Digite sua mensagem...'), { target: { value: 'Rascunho para amigo' } });
  rerender(<ChatWindow key={another.id} currentUser={me} selectedUser={another} />);
  await act(async () => { old.resolve({ data: [message(1, 'Conversa antiga')] }); });
  expect(screen.queryByText('Conversa antiga')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('Digite sua mensagem...')).toHaveValue('');
});

it('preserva o texto quando publish falha e não permite envio desconectado', async () => {
  render(<ChatWindow currentUser={me} selectedUser={friend} />);
  const { client } = await connect();
  mocks.publish.mockImplementation(() => { throw new Error('Disconnected'); });
  const input = screen.getByPlaceholderText('Digite sua mensagem...');
  fireEvent.change(input, { target: { value: 'Não perder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  expect(input).toHaveValue('Não perder');
  expect(mocks.publish).toHaveBeenCalledWith({ destination: '/app/chat', body: JSON.stringify({ receiverId: '2', content: 'Não perder' }) });
  act(() => { client.onWebSocketClose({} as CloseEvent); });
  expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();
});

it('trata frame inválido e recupera histórico após reconectar', async () => {
  render(<ChatWindow currentUser={me} selectedUser={friend} />);
  const { client, receive } = await connect();
  act(() => { receive({ body: 'invalid-json' } as never); });
  expect(mocks.error).toHaveBeenCalledWith('Mensagem recebida em formato inválido.');
  mocks.get.mockResolvedValue({ data: [message(3, 'Recebida offline')] });
  await act(async () => { client.onConnect({} as never); });
  expect(await screen.findByText('Recebida offline')).toBeInTheDocument();
});
