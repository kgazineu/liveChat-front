import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import MessagePanel from '@/src/components/message-panel';
import type { ChannelMessage, CurrentUser, PageResponse } from '@/src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  startCall: vi.fn(),
  uploadAttachmentFile: vi.fn(),
  listener: null as ((message: ChannelMessage) => void) | null,
}));

vi.mock('@/src/services/api', () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock('@/src/services/attachments', async importOriginal => {
  const original = await importOriginal<typeof import('@/src/services/attachments')>();
  return { ...original, uploadAttachmentFile: mocks.uploadAttachmentFile };
});
vi.mock('@/src/components/realtime-provider', () => {
  const subscribeMessages = (listener: (message: ChannelMessage) => void) => {
    mocks.listener = listener;
    return () => { mocks.listener = null; };
  };
  return {
    useRealtime: () => ({ connected: true, subscribeMessages }),
  };
});
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

const me: CurrentUser = { id: 'user-1', name: 'Ana', email: 'ana@example.com' };

function page(content: ChannelMessage[], pageNumber = 0, last = true): PageResponse<ChannelMessage> {
  return {
    content,
    page: pageNumber,
    size: 50,
    totalElements: content.length,
    totalPages: last ? pageNumber + 1 : pageNumber + 2,
    last,
  };
}
const directTarget = { kind: 'DIRECT' as const, channelId: 'direct-1', title: 'Bruno', subtitle: 'Mensagem direta' };

function message(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: 1,
    channelId: 'direct-1',
    content: 'Olá',
    authorId: 'user-2',
    authorName: 'Bruno',
    createdAt: '2026-09-22T18:00:00Z',
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ data: page([]) });
  mocks.post.mockReset();
  mocks.startCall.mockReset();
  mocks.uploadAttachmentFile.mockReset().mockImplementation((
    _authorization: unknown,
    _file: File,
    options: { onProgress?: (progress: number) => void },
  ) => {
    options.onProgress?.(100);
    return Promise.resolve();
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  mocks.listener = null;
});

it('usa o canal privado para histórico, envio e início de chamada', async () => {
  mocks.post.mockResolvedValue({ data: message({ id: 2, content: 'Mensagem enviada', authorId: me.id, authorName: me.name }) });
  render(<MessagePanel currentUser={me} target={directTarget} onStartCall={mocks.startCall} />);

  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(
    '/direct-channels/direct-1/messages',
    expect.objectContaining({
      params: { page: 0, size: 50 },
      signal: expect.any(AbortSignal),
    }),
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

it('carrega páginas anteriores e mantém a ordem cronológica do histórico', async () => {
  const recent = message({ id: 2, content: 'Recente', createdAt: '2026-09-22T18:01:00Z' });
  const older = message({ id: 1, content: 'Antiga', createdAt: '2026-09-22T18:00:00Z' });
  mocks.get
    .mockResolvedValueOnce({ data: page([recent], 0, false) })
    .mockResolvedValueOnce({ data: page([older], 1, true) });

  render(<MessagePanel currentUser={me} target={directTarget} />);
  expect(await screen.findByText('Recente')).toBeInTheDocument();
  const history = screen.getByLabelText('Histórico de mensagens');
  Object.defineProperties(history, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollHeight: { configurable: true, get: () => screen.queryByText('Antiga') ? 1300 : 1000 },
    clientHeight: { configurable: true, value: 500 },
  });
  fireEvent.scroll(history);

  expect(await screen.findByText('Antiga')).toBeInTheDocument();
  expect(mocks.get).toHaveBeenLastCalledWith('/direct-channels/direct-1/messages', {
    params: { page: 1, size: 50 },
  });
  expect(screen.queryByText('Carregando mensagens anteriores…')).not.toBeInTheDocument();
  expect(history.scrollTop).toBe(300);
  expect(screen.getAllByRole('article').map(article => article.textContent)).toEqual([
    expect.stringContaining('Antiga'),
    expect.stringContaining('Recente'),
  ]);
});

it('renderiza links externos com segurança sem interpretar HTML da mensagem', async () => {
  mocks.get.mockResolvedValue({
    data: page([message({ content: 'Veja https://example.com e <img src=x onerror=alert(1)>' })]),
  });
  render(<MessagePanel currentUser={me} target={directTarget} />);

  const link = await screen.findByRole('link', { name: 'https://example.com' });
  expect(link).toHaveAttribute('href', 'https://example.com');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
});

it('reserva, envia ao armazenamento e associa um anexo mesmo sem texto', async () => {
  const reservation = {
    attachmentId: 'attachment-1',
    uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
    uploadMethod: 'POST' as const,
    formFields: { api_key: 'public-key', signature: 'signed' },
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const sentMessage = message({
    id: 2,
    content: '',
    authorId: me.id,
    authorName: me.name,
    attachments: [{
      id: 'attachment-1',
      originalName: 'foto.png',
      contentType: 'image/png',
      size: 4,
      width: null,
      height: null,
      downloadUrl: 'https://api.cloudinary.com/download/foto.png',
      downloadExpiresAt: '2099-01-01T00:00:00Z',
    }],
  });
  mocks.post.mockImplementation((url: string) => {
    if (url === '/direct-channels/direct-1/attachments/uploads') return Promise.resolve({ data: reservation });
    if (url === '/direct-channels/direct-1/messages') return Promise.resolve({ data: sentMessage });
    throw new Error(`POST inesperado: ${url}`);
  });

  render(<MessagePanel currentUser={me} target={directTarget} />);
  const file = new File(['data'], 'foto.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Selecionar anexos'), { target: { files: [file] } });

  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
    '/direct-channels/direct-1/attachments/uploads',
    { originalName: 'foto.png', contentType: 'image/png', size: 4 },
    { signal: expect.any(AbortSignal) },
  ));
  await waitFor(() => expect(mocks.uploadAttachmentFile).toHaveBeenCalledWith(
    reservation,
    file,
    expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }),
  ));
  expect(await screen.findByText(/Pronto/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
    '/direct-channels/direct-1/messages',
    { attachmentIds: ['attachment-1'] },
  ));
  expect(await screen.findByRole('button', { name: 'Ampliar foto.png' })).toBeInTheDocument();
});

it('renderiza imagem, vídeo e documento conforme o MIME retornado pelo backend', async () => {
  mocks.get.mockResolvedValue({
    data: page([message({
      content: 'Arquivos',
      attachments: [
        {
          id: 'image-1', originalName: 'imagem.gif', contentType: 'image/gif', size: 100,
          width: 20, height: 20, downloadUrl: 'https://cdn.example/imagem.gif', downloadExpiresAt: '2099-01-01T00:00:00Z',
        },
        {
          id: 'video-1', originalName: 'video.webm', contentType: 'video/webm', size: 200,
          width: null, height: null, downloadUrl: 'https://cdn.example/video.webm', downloadExpiresAt: '2099-01-01T00:00:00Z',
        },
        {
          id: 'doc-1', originalName: 'relatorio.pdf', contentType: 'application/pdf', size: 300,
          width: null, height: null, downloadUrl: 'https://cdn.example/relatorio.pdf', downloadExpiresAt: '2099-01-01T00:00:00Z',
        },
      ],
    })]),
  });
  render(<MessagePanel currentUser={me} target={directTarget} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Ampliar imagem.gif' }));
  expect(screen.getByRole('dialog', { name: 'Visualização de imagem.gif' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fechar visualização do anexo' }));
  expect(screen.getByLabelText('video.webm')).toHaveAttribute('preload', 'metadata');
  const documentLink = screen.getByRole('link', { name: /relatorio.pdf/ });
  expect(documentLink).toHaveAttribute('href', 'https://cdn.example/relatorio.pdf');
  expect(documentLink).toHaveAttribute('rel', 'noopener noreferrer');
});

it('renova URLs temporárias expiradas recarregando as páginas já consultadas', async () => {
  const expired = message({
    attachments: [{
      id: 'image-1',
      originalName: 'foto.png',
      contentType: 'image/png',
      size: 100,
      width: 20,
      height: 20,
      downloadUrl: 'https://cdn.example/expirada.png',
      downloadExpiresAt: new Date(Date.now() - 1000).toISOString(),
    }],
  });
  const renewed = message({
    attachments: [{
      ...expired.attachments[0],
      downloadUrl: 'https://cdn.example/renovada.png',
      downloadExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }],
  });
  mocks.get
    .mockResolvedValueOnce({ data: page([expired]) })
    .mockResolvedValueOnce({ data: page([renewed]) });

  render(<MessagePanel currentUser={me} target={directTarget} />);

  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  expect(mocks.get).toHaveBeenLastCalledWith('/direct-channels/direct-1/messages', {
    params: { page: 0, size: 50 },
  });
  await waitFor(() => expect(screen.getByAltText('foto.png')).toHaveAttribute(
    'src',
    'https://cdn.example/renovada.png',
  ));
});

it('recebe somente eventos do canal selecionado e deduplica o eco', async () => {
  mocks.get.mockResolvedValue({ data: page([message()]) });
  render(<MessagePanel currentUser={me} target={directTarget} />);
  expect(await screen.findByText('Olá')).toBeInTheDocument();

  act(() => {
    mocks.listener?.(message());
    mocks.listener?.(message({ id: 3, channelId: 'outro-canal', content: 'Outra conversa' }));
  });

  expect(screen.getAllByText('Olá')).toHaveLength(1);
  expect(screen.queryByText('Outra conversa')).not.toBeInTheDocument();
});
