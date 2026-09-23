import { fireEvent, render, screen } from '@testing-library/react';
import { Track, type RemoteVideoTrack } from 'livekit-client';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenShareViewer } from '@/src/components/media-room';

const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;

afterEach(() => {
  if (originalRequestFullscreen) {
    HTMLElement.prototype.requestFullscreen = originalRequestFullscreen;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  }
});

it('anexa o compartilhamento, permite tela cheia e remove a faixa ao fechar', () => {
  const fullscreen = vi.fn().mockResolvedValue(undefined);
  HTMLElement.prototype.requestFullscreen = fullscreen;
  const track = {
    attach: vi.fn(),
    detach: vi.fn(),
  } as unknown as RemoteVideoTrack;
  const close = vi.fn();
  const error = vi.fn();

  const { unmount } = render(
    <ScreenShareViewer
      view={{
        id: 'screen-track',
        track,
        participantId: 'user-2',
        participantName: 'Bruno',
        source: Track.Source.ScreenShare,
        local: false,
      }}
      onCloseAction={close}
      onErrorAction={error}
    />,
  );

  expect(track.attach).toHaveBeenCalledWith(expect.any(HTMLVideoElement));
  fireEvent.click(screen.getByRole('button', { name: /tela cheia/i }));
  expect(fullscreen).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Fechar visualização ampliada' }));
  expect(close).toHaveBeenCalledOnce();
  unmount();
  expect(track.detach).toHaveBeenCalledWith(expect.any(HTMLVideoElement));
});

it('fecha a visualização ampliada com Escape quando não está em fullscreen', () => {
  const track = { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteVideoTrack;
  const close = vi.fn();

  render(
    <ScreenShareViewer
      view={{
        id: 'screen-track',
        track,
        participantId: 'user-2',
        participantName: 'Bruno',
        source: Track.Source.ScreenShare,
        local: false,
      }}
      onCloseAction={close}
      onErrorAction={vi.fn()}
    />,
  );

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('usa o mesmo visualizador ampliado para uma câmera', () => {
  const track = { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteVideoTrack;

  render(
    <ScreenShareViewer
      view={{
        id: 'camera-track',
        track,
        participantId: 'user-2',
        participantName: 'Bruno',
        source: Track.Source.Camera,
        local: false,
      }}
      onCloseAction={vi.fn()}
      onErrorAction={vi.fn()}
    />,
  );

  expect(screen.getByRole('dialog', { name: 'Câmera ampliada' })).toBeInTheDocument();
  expect(screen.getByText('Câmera de Bruno')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /tela cheia/i })).toBeInTheDocument();
  expect(track.attach).toHaveBeenCalledWith(expect.any(HTMLVideoElement));
});
