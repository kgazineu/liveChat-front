import { afterEach, describe, expect, it } from 'vitest';
import {
  applyRemoteAudioSettings,
  SCREEN_SHARE_CAPTURE_OPTIONS,
  SCREEN_SHARE_WITHOUT_AUDIO_NOTICE,
  storedParticipantVolume,
  storedScreenShareVolume,
  storeParticipantVolume,
  storeScreenShareVolume,
} from '@/src/components/media-room';

describe('controles de áudio remoto', () => {
  afterEach(() => window.localStorage.clear());

  it('silencia apenas o elemento remoto e restaura seu volume individual', () => {
    const audio = document.createElement('audio');
    const microphoneEnabled = true;

    applyRemoteAudioSettings(audio, true, 0.65);
    expect(audio.muted).toBe(true);
    expect(audio.volume).toBe(0);
    expect(microphoneEnabled).toBe(true);

    applyRemoteAudioSettings(audio, false, 0.65);
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(0.65);
    expect(microphoneEnabled).toBe(true);
  });

  it('usa volume máximo por padrão e persiste o ajuste por usuário', () => {
    expect(storedParticipantVolume('user-2')).toBe(1);
    expect(storeParticipantVolume('user-2', 0.4)).toBe(0.4);
    expect(window.localStorage.getItem('volume:user-2')).toBe('0.4');
    expect(storedParticipantVolume('user-2')).toBe(0.4);

    expect(storeParticipantVolume('user-2', 2)).toBe(1);
    expect(storedParticipantVolume('user-2')).toBe(1);
  });

  it('mantém o volume da transmissão separado do volume do microfone', () => {
    expect(storedScreenShareVolume('user-2')).toBe(100);
    expect(storeScreenShareVolume('user-2', 70)).toBe(70);
    expect(window.localStorage.getItem('screen-share-volume:user-2')).toBe('70');
    expect(storedScreenShareVolume('user-2')).toBe(70);
    expect(window.localStorage.getItem('volume:user-2')).toBeNull();

    expect(storeScreenShareVolume('user-2', -10)).toBe(0);
    expect(storeScreenShareVolume('user-2', 120)).toBe(100);
  });

  it('solicita vídeo e áudio ao iniciar o compartilhamento', () => {
    expect(SCREEN_SHARE_CAPTURE_OPTIONS).toEqual({
      audio: true,
      video: { displaySurface: 'browser' },
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
    });
    expect(SCREEN_SHARE_WITHOUT_AUDIO_NOTICE).toContain('Compartilhar áudio da guia');
  });
});
