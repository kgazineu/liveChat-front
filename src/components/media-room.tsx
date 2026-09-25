'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from 'livekit-client';
import api from '@/src/services/api';
import { errorMessage } from '@/src/services/errors';
import type {
  CurrentUser,
  LiveKitConnection,
  MediaPresenceEvent,
  MediaSession,
  MediaSessionStatus,
  MediaTarget,
} from '@/src/types';
import { useRealtime } from './realtime-provider';

type ConnectionUiState =
  | 'loading'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

type LocalMediaState = Pick<
  MediaSession,
  'microphoneEnabled' | 'cameraEnabled' | 'screenShareEnabled'
>;

type PresencePatch = Partial<LocalMediaState> & { status?: MediaSessionStatus };

type DeviceLists = Record<MediaDeviceKind, MediaDeviceInfo[]>;
type DeviceSelection = Record<MediaDeviceKind, string>;

interface TrackView {
  id: string;
  track: Track;
  participantId: string;
  participantName: string;
  source: Track.Source;
  local: boolean;
}

interface WebRtcMetrics {
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  bitrateKbps: number | null;
  jitterBufferMs: number | null;
  sampledAt: number | null;
}

interface PreviousByteSample {
  bytes: number;
  timestamp: number;
}

export interface MediaRoomSummary {
  sessions: MediaSession[];
  speakingUserIds: string[];
}

const EMPTY_MEDIA: LocalMediaState = {
  microphoneEnabled: false,
  cameraEnabled: false,
  screenShareEnabled: false,
};

const EMPTY_DEVICES: DeviceLists = {
  audioinput: [],
  videoinput: [],
  audiooutput: [],
};

const EMPTY_SELECTION: DeviceSelection = {
  audioinput: '',
  videoinput: '',
  audiooutput: '',
};

const EMPTY_METRICS: WebRtcMetrics = {
  rttMs: null,
  jitterMs: null,
  packetLossPercent: null,
  bitrateKbps: null,
  jitterBufferMs: null,
  sampledAt: null,
};

let callAudioContext: AudioContext | null = null;

export function prepareCallSounds() {
  if (typeof window === 'undefined' || !window.AudioContext) return null;

  try {
    const context = callAudioContext ?? new window.AudioContext();
    callAudioContext = context;
    void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

function playCallSound(kind: 'join' | 'leave') {
  const context = prepareCallSounds();
  if (!context) return;

  try {
    const start = context.currentTime;
    const frequencies = kind === 'join' ? [440, 660] : [660, 440];

    void context.resume().then(() => {
      frequencies.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const toneStart = start + index * 0.1;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, toneStart);
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(0.12, toneStart + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.12);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + 0.13);
      });
    }).catch(() => undefined);
  } catch {
    // Voice audio keeps its own unblock prompt when the browser rejects Web Audio.
  }
}

export function storedParticipantVolume(userId: string) {
  if (typeof window === 'undefined') return 1;
  const rawVolume = window.localStorage.getItem(`volume:${userId}`);
  if (rawVolume == null) return 1;
  const stored = Number(rawVolume);
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 1;
}

export function storeParticipantVolume(userId: string, volume: number) {
  const normalized = Math.min(1, Math.max(0, volume));
  try {
    window.localStorage.setItem(`volume:${userId}`, String(normalized));
  } catch {
    // O áudio continua funcional mesmo quando o armazenamento local está indisponível.
  }
  return normalized;
}

export function applyRemoteAudioSettings(element: HTMLAudioElement, muted: boolean, volume: number) {
  element.muted = muted;
  element.volume = muted ? 0 : Math.min(1, Math.max(0, volume));
}

function mediaSessionsEndpoint(target: MediaTarget) {
  return target.kind === 'DIRECT'
    ? `/direct-channels/${target.channelId}/media-sessions`
    : `/servers/${target.serverId}/channels/${target.channelId}/media-sessions`;
}


function belongsToTarget(session: MediaSession, target: MediaTarget) {
  return session.channelId === target.channelId &&
    session.channelKind === target.kind &&
    (target.kind === 'DIRECT' || String(session.serverId) === String(target.serverId));
}

function withoutConnection(session: MediaSession): MediaSession {
  const { connection: _discarded, ...safeSession } = session;
  void _discarded;
  return safeSession;
}

function mergeSessions(...groups: MediaSession[][]) {
  const merged = new Map<string, MediaSession>();
  for (const session of groups.flat()) {
    const safeSession = withoutConnection(session);
    const previous = merged.get(String(safeSession.userId));
    const previousTime = previous ? Date.parse(previous.lastSeenAt) : Number.NEGATIVE_INFINITY;
    const nextTime = Date.parse(safeSession.lastSeenAt);
    if (!previous || !Number.isFinite(previousTime) || !Number.isFinite(nextTime) || nextTime >= previousTime) {
      merged.set(String(safeSession.userId), safeSession);
    }
  }
  return [...merged.values()].sort((first, second) => {
    if (first.joinedAt !== second.joinedAt) {
      return Date.parse(first.joinedAt) - Date.parse(second.joinedAt);
    }
    return first.userName.localeCompare(second.userName, 'pt-BR');
  });
}

function friendlyMediaError(error: unknown, fallback: string) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Permissão de câmera ou microfone negada. Libere o acesso nas configurações do navegador.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'Nenhum dispositivo de mídia compatível foi encontrado.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'O dispositivo de mídia está ocupado ou não pôde ser iniciado.';
    }
  }
  return errorMessage(error, fallback);
}

function localMediaFromRoom(room: Room): LocalMediaState {
  return {
    microphoneEnabled: room.localParticipant.isMicrophoneEnabled,
    cameraEnabled: room.localParticipant.isCameraEnabled,
    screenShareEnabled: room.localParticipant.isScreenShareEnabled,
  };
}

async function enumerateDevices(room: Room) {
  const [audioinput, videoinput, audiooutput] = await Promise.all([
    Room.getLocalDevices('audioinput', false),
    Room.getLocalDevices('videoinput', false),
    Room.getLocalDevices('audiooutput', false),
  ]);
  const devices: DeviceLists = { audioinput, videoinput, audiooutput };
  const selected: DeviceSelection = {
    audioinput: room.getActiveDevice('audioinput') || audioinput[0]?.deviceId || '',
    videoinput: room.getActiveDevice('videoinput') || videoinput[0]?.deviceId || '',
    audiooutput: room.getActiveDevice('audiooutput') || audiooutput[0]?.deviceId || '',
  };
  return { devices, selected };
}

function collectTracks(room: Room | null) {
  const audio: TrackView[] = [];
  const video: TrackView[] = [];
  if (!room) return { audio, video };

  for (const publication of room.localParticipant.trackPublications.values()) {
    const track = publication.track;
    if (!track || track.isMuted || track.kind !== Track.Kind.Video) continue;
    video.push({
      id: track.sid || track.mediaStreamTrack.id,
      track,
      participantId: room.localParticipant.identity,
      participantName: room.localParticipant.name || 'Você',
      source: publication.source,
      local: true,
    });
  }

  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      const track = publication.track;
      if (!track || track.isMuted) continue;
      const view: TrackView = {
        id: track.sid || track.mediaStreamTrack.id,
        track,
        participantId: participant.identity,
        participantName: participant.name || participant.identity,
        source: publication.source,
        local: false,
      };
      if (track.kind === Track.Kind.Audio) audio.push(view);
      if (track.kind === Track.Kind.Video) video.push(view);
    }
  }

  return { audio, video };
}

function allPublishedTracks(room: Room) {
  const tracks: Track[] = [];
  for (const publication of room.localParticipant.trackPublications.values()) {
    if (publication.track) tracks.push(publication.track);
  }
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) tracks.push(publication.track);
    }
  }
  return tracks;
}

function statNumber(stat: RTCStats, field: string) {
  const value = (stat as unknown as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

async function readWebRtcMetrics(
  room: Room,
  previousBytes: Map<string, PreviousByteSample>,
): Promise<WebRtcMetrics> {
  const tracks = allPublishedTracks(room);
  const rttValues: number[] = [];
  const jitterValues: number[] = [];
  const jitterBufferValues: number[] = [];
  let lostPackets = 0;
  let totalPackets = 0;
  let bitrate = 0;
  let bitrateSamples = 0;
  const now = performance.now();

  await Promise.all(tracks.map(async track => {
    const report = await track.getRTCStatsReport();
    if (!report) return;

    let bytes = 0;
    report.forEach(stat => {
      if (stat.type === 'inbound-rtp' || stat.type === 'outbound-rtp') {
        bytes += statNumber(stat, stat.type === 'inbound-rtp' ? 'bytesReceived' : 'bytesSent') || 0;
      }

      if (stat.type === 'inbound-rtp' || stat.type === 'remote-inbound-rtp') {
        const jitter = statNumber(stat, 'jitter');
        if (jitter != null) jitterValues.push(jitter * 1000);

        const lost = Math.max(0, statNumber(stat, 'packetsLost') || 0);
        const received = Math.max(0, statNumber(stat, 'packetsReceived') || 0);
        if (lost || received) {
          lostPackets += lost;
          totalPackets += lost + received;
        }

        const roundTripTime = statNumber(stat, 'roundTripTime');
        if (roundTripTime != null) rttValues.push(roundTripTime * 1000);
      }

      if (stat.type === 'candidate-pair') {
        const roundTripTime = statNumber(stat, 'currentRoundTripTime');
        if (roundTripTime != null) rttValues.push(roundTripTime * 1000);
      }

      if (stat.type === 'inbound-rtp') {
        const delay = statNumber(stat, 'jitterBufferDelay');
        const emitted = statNumber(stat, 'jitterBufferEmittedCount');
        if (delay != null && emitted && emitted > 0) {
          jitterBufferValues.push((delay / emitted) * 1000);
        }
      }
    });

    const id = track.sid || track.mediaStreamTrack.id;
    const previous = previousBytes.get(id);
    if (previous && bytes >= previous.bytes && now > previous.timestamp) {
      bitrate += ((bytes - previous.bytes) * 8) / ((now - previous.timestamp) / 1000) / 1000;
      bitrateSamples += 1;
    }
    previousBytes.set(id, { bytes, timestamp: now });
  }));

  const activeTrackIds = new Set(tracks.map(track => track.sid || track.mediaStreamTrack.id));
  for (const id of previousBytes.keys()) {
    if (!activeTrackIds.has(id)) previousBytes.delete(id);
  }

  return {
    rttMs: average(rttValues),
    jitterMs: average(jitterValues),
    packetLossPercent: totalPackets ? (lostPackets / totalPackets) * 100 : null,
    bitrateKbps: bitrateSamples ? bitrate : null,
    jitterBufferMs: average(jitterBufferValues),
    sampledAt: Date.now(),
  };
}

export function MediaRoom({
  currentUser,
  target,
  visible,
  onOpenAction,
  onLeaveAction,
  onSummaryAction,
  showMetrics = false,
  participantVolumes = {},
  devicePanelTarget = null,
}: {
  currentUser: CurrentUser;
  target: MediaTarget;
  visible: boolean;
  onOpenAction: () => void;
  onLeaveAction: () => void;
  onSummaryAction?: (summary: MediaRoomSummary) => void;
  showMetrics?: boolean;
  participantVolumes?: Record<string, number>;
  devicePanelTarget?: HTMLElement | null;
}) {
  const { connected: realtimeConnected, subscribePresence } = useRealtime();
  const endpoint = useMemo(() => mediaSessionsEndpoint(target), [target]);
  const roomRef = useRef<Room | null>(null);
  const connectionRef = useRef<LiveKitConnection | null>(null);
  const endpointRef = useRef(endpoint);
  const localMediaRef = useRef<LocalMediaState>(EMPTY_MEDIA);
  const previousBytesRef = useRef(new Map<string, PreviousByteSample>());

  const [sessions, setSessions] = useState<MediaSession[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionUiState>('loading');
  const [localMedia, setLocalMedia] = useState<LocalMediaState>(EMPTY_MEDIA);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [remoteAudioMuted, setRemoteAudioMuted] = useState(false);
  const [devices, setDevices] = useState<DeviceLists>(EMPTY_DEVICES);
  const [selectedDevices, setSelectedDevices] = useState<DeviceSelection>(EMPTY_SELECTION);
  const [trackViews, setTrackViews] = useState<{ audio: TrackView[]; video: TrackView[] }>({ audio: [], video: [] });
  const [busyControl, setBusyControl] = useState<'microphone' | 'camera' | 'screen' | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<WebRtcMetrics>(EMPTY_METRICS);
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    endpointRef.current = endpoint;
  }, [endpoint]);

  const applyOwnPresence = useCallback((patch: PresencePatch, response?: MediaSession) => {
    if (endpointRef.current !== endpoint) return;
    setSessions(previous => {
      if (response) return mergeSessions(previous, [withoutConnection(response)]);
      return previous.map(session => String(session.userId) === String(currentUser.id)
        ? { ...session, ...patch, lastSeenAt: new Date().toISOString() }
        : session);
    });
  }, [currentUser.id, endpoint]);

  const patchOwnPresence = useCallback(async (patch: PresencePatch) => {
    const mediaPatch: Partial<LocalMediaState> = {
      ...(patch.microphoneEnabled != null ? { microphoneEnabled: patch.microphoneEnabled } : {}),
      ...(patch.cameraEnabled != null ? { cameraEnabled: patch.cameraEnabled } : {}),
      ...(patch.screenShareEnabled != null ? { screenShareEnabled: patch.screenShareEnabled } : {}),
    };
    const response = await api.patch<MediaSession | undefined>(`${endpoint}/me`, mediaPatch);
    if (endpointRef.current !== endpoint) return;
    const session = response.data;
    applyOwnPresence(patch, session && typeof session === 'object' ? session : undefined);
  }, [applyOwnPresence, endpoint]);

  const markAutoplayBlocked = useCallback(() => setAutoplayBlocked(true), []);

  useEffect(() => {
    let active = true;
    let joined = false;
    let room: Room | null = null;
    let credential: LiveKitConnection | null = null;
    const controller = new AbortController();
    const seenEvents = new Set<string>();
    const removedParticipants = new Set<string>();
    const previousBytes = previousBytesRef.current;
    const speakerClearTimers = new Map<string, number>();
    let leaveSoundPlayed = false;

    localMediaRef.current = EMPTY_MEDIA;
    previousBytes.clear();
    queueMicrotask(() => {
      if (!active) return;
      setSessions([]);
      setConnectionState('loading');
      setLocalMedia(EMPTY_MEDIA);
      setActiveSpeakers(new Set());
      setDevices(EMPTY_DEVICES);
      setSelectedDevices(EMPTY_SELECTION);
      setTrackViews({ audio: [], video: [] });
      setAutoplayBlocked(false);
      setNotice(null);
      setFatalError(null);
      setMetrics(EMPTY_METRICS);
      setExpandedTrackId(null);
    });

    const upsertPresence = (event: MediaPresenceEvent) => {
      if (!belongsToTarget(event.participant, target)) return;
      const participantId = String(event.participant.userId);
      const signature = [
        event.type,
        participantId,
        event.participant.lastSeenAt,
        event.participant.status,
        event.participant.microphoneEnabled,
        event.participant.cameraEnabled,
        event.participant.screenShareEnabled,
      ].join(':');
      if (seenEvents.has(signature)) return;
      if (seenEvents.size > 500) seenEvents.clear();
      seenEvents.add(signature);

      if (event.type === 'media.participant.left') {
        removedParticipants.add(participantId);
        setSessions(previous => previous.filter(session => String(session.userId) !== participantId));
        return;
      }
      removedParticipants.delete(participantId);
      setSessions(previous => mergeSessions(previous, [event.participant]));
    };

    const unsubscribePresence = subscribePresence(upsertPresence);

    const refreshTrackViews = () => {
      if (active) setTrackViews(collectTracks(room));
    };

    const updateSpeakers = (speakers: Participant[]) => {
      if (!active) return;
      const incoming = new Set(speakers.map(participant => participant.identity));
      setActiveSpeakers(previous => {
        const next = new Set(previous);
        incoming.forEach(id => {
          const timer = speakerClearTimers.get(id);
          if (timer) window.clearTimeout(timer);
          speakerClearTimers.delete(id);
          next.add(id);
        });
        previous.forEach(id => {
          if (incoming.has(id) || speakerClearTimers.has(id)) return;
          const timer = window.setTimeout(() => {
            speakerClearTimers.delete(id);
            setActiveSpeakers(current => {
              const updated = new Set(current);
              updated.delete(id);
              return updated;
            });
          }, 350);
          speakerClearTimers.set(id, timer);
        });
        return next;
      });
    };

    const patchFromRoom = async (status?: MediaSessionStatus) => {
      if (!active || !room) return;
      const nextMedia = localMediaFromRoom(room);
      localMediaRef.current = nextMedia;
      setLocalMedia(nextMedia);
      applyOwnPresence({ ...nextMedia, ...(status ? { status } : {}) });
      try {
        await api.patch(`${endpoint}/me`, nextMedia);
      } catch (error) {
        if (active) setNotice(errorMessage(error, 'Sua presença de mídia não pôde ser atualizada.'));
      }
    };

    const refreshDevices = async () => {
      if (!room) return;
      try {
        const result = await enumerateDevices(room);
        if (!active) return;
        setDevices(result.devices);
        setSelectedDevices(previous => ({
          audioinput: previous.audioinput || result.selected.audioinput,
          videoinput: previous.videoinput || result.selected.videoinput,
          audiooutput: previous.audiooutput || result.selected.audiooutput,
        }));
      } catch (error) {
        if (active) setNotice(friendlyMediaError(error, 'Não foi possível listar os dispositivos de mídia.'));
      }
    };

    async function join() {
      void api.get<MediaSession[]>(endpoint, { signal: controller.signal })
        .then(response => {
          if (!active) return;
          if (!Array.isArray(response.data)) throw new Error('Lista de participantes inválida');
          const incoming = response.data
            .filter(session => belongsToTarget(session, target))
            .filter(session => !removedParticipants.has(String(session.userId)));
          setSessions(previous => mergeSessions(previous, incoming));
        })
        .catch(error => {
          if (!active || controller.signal.aborted) return;
          setNotice(errorMessage(error, 'Não foi possível carregar todos os participantes.'));
        });

      setConnectionState('connecting');
      let joinedSession: MediaSession;
      try {
        const response = await api.post<MediaSession>(endpoint);
        joinedSession = response.data;
      } catch (error) {
        if (!active) return;
        setConnectionState('error');
        setFatalError(errorMessage(error, 'Não foi possível entrar nesta sala de mídia.'));
        return;
      }

      joined = true;
      credential = joinedSession.connection || null;
      joinedSession = withoutConnection(joinedSession);
      if (!active) {
        joined = false;
        credential = null;
        void api.delete(endpoint).catch(() => undefined);
        return;
      }
      if (!credential?.url || !credential.token) {
        joined = false;
        credential = null;
        void api.delete(endpoint).catch(() => undefined);
        setConnectionState('error');
        setFatalError('O servidor não forneceu uma credencial de mídia válida.');
        return;
      }

      connectionRef.current = credential;
      setSessions(previous => mergeSessions(previous, [joinedSession]));

      room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.Reconnecting, () => {
        if (!active) return;
        setConnectionState('reconnecting');
        applyOwnPresence({ status: 'RECONNECTING' });
      });
      room.on(RoomEvent.Reconnected, () => {
        if (!active) return;
        setConnectionState('connected');
        void patchFromRoom('ACTIVE');
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!active) return;
        joined = false;
        if (!leaveSoundPlayed) {
          leaveSoundPlayed = true;
          playCallSound('leave');
        }
        connectionRef.current = null;
        credential = null;
        setConnectionState('disconnected');
        setActiveSpeakers(new Set());
        setFatalError('A conexão com o servidor de mídia foi encerrada. Você pode tentar entrar novamente.');
        setSessions(previous => previous.filter(session => String(session.userId) !== String(currentUser.id)));
        void api.delete(endpoint).catch(() => undefined);
        refreshTrackViews();
      });
      room.on(RoomEvent.TrackSubscribed, refreshTrackViews);
      room.on(RoomEvent.TrackUnsubscribed, refreshTrackViews);
      room.on(RoomEvent.TrackMuted, refreshTrackViews);
      room.on(RoomEvent.TrackUnmuted, refreshTrackViews);
      room.on(RoomEvent.ParticipantConnected, () => {
        if (!active) return;
        refreshTrackViews();
        playCallSound('join');
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (!active) return;
        refreshTrackViews();
        playCallSound('leave');
      });
      room.on(RoomEvent.ActiveSpeakersChanged, updateSpeakers);
      room.on(RoomEvent.AudioPlaybackStatusChanged, playing => {
        if (active) setAutoplayBlocked(!playing);
      });
      room.on(RoomEvent.MediaDevicesChanged, () => void refreshDevices());
      room.on(RoomEvent.LocalTrackPublished, () => {
        refreshTrackViews();
        void patchFromRoom('ACTIVE');
      });
      room.on(RoomEvent.LocalTrackUnpublished, () => {
        refreshTrackViews();
        void patchFromRoom('ACTIVE');
      });
      room.on(RoomEvent.MediaDevicesError, error => {
        if (active) setNotice(friendlyMediaError(error, 'Um dispositivo de mídia falhou.'));
      });

      try {
        await room.connect(credential.url, credential.token);
        if (!active) return;
        playCallSound('join');
        setConnectionState('connected');
        setAutoplayBlocked(!room.canPlaybackAudio);
        refreshTrackViews();

        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (error) {
          if (active) setNotice(friendlyMediaError(error, 'A sala foi conectada, mas o microfone não pôde ser publicado.'));
        }
        if (!active) return;
        await patchFromRoom('ACTIVE');
        await refreshDevices();
      } catch (error) {
        if (!active) return;
        joined = false;
        connectionRef.current = null;
        credential = null;
        if (roomRef.current === room) roomRef.current = null;
        await room.disconnect(true).catch(() => undefined);
        void api.delete(endpoint).catch(() => undefined);
        setConnectionState('error');
        setFatalError(friendlyMediaError(error, 'Não foi possível conectar ao servidor de mídia.'));
      }
    }

    void join();

    return () => {
      active = false;
      controller.abort();
      unsubscribePresence();
      connectionRef.current = null;
      credential = null;
      previousBytes.clear();
      speakerClearTimers.forEach(timer => window.clearTimeout(timer));
      speakerClearTimers.clear();
      if (roomRef.current === room) roomRef.current = null;
      if (room) void room.disconnect(true);
      if (joined) {
        if (!leaveSoundPlayed) playCallSound('leave');
        void api.delete(endpoint).catch(() => undefined);
      }
    };
  }, [applyOwnPresence, currentUser.id, endpoint, retry, subscribePresence, target]);

  useEffect(() => {
    onSummaryAction?.({
      sessions,
      speakingUserIds: [...activeSpeakers],
    });
  }, [activeSpeakers, onSummaryAction, sessions]);

  useEffect(() => {
    if (connectionState !== 'connected') return;
    const room = roomRef.current;
    if (!room) return;
    let active = true;
    let collecting = false;

    const collect = async () => {
      if (collecting) return;
      collecting = true;
      try {
        const nextMetrics = await readWebRtcMetrics(room, previousBytesRef.current);
        if (active && roomRef.current === room) setMetrics(nextMetrics);
      } catch {
        if (active && roomRef.current === room) setMetrics(previous => ({ ...previous, sampledAt: Date.now() }));
      } finally {
        collecting = false;
      }
    };

    void collect();
    const timer = window.setInterval(() => void collect(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [connectionState]);

  async function toggleMedia(kind: 'microphone' | 'camera' | 'screen') {
    const room = roomRef.current;
    if (!room || connectionState !== 'connected' || busyControl) return;
    setBusyControl(kind);
    setNotice(null);

    try {
      if (kind === 'microphone') {
        const enabled = !localMediaRef.current.microphoneEnabled;
        await room.localParticipant.setMicrophoneEnabled(
          enabled,
          selectedDevices.audioinput ? { deviceId: selectedDevices.audioinput } : undefined,
        );
      } else if (kind === 'camera') {
        const enabled = !localMediaRef.current.cameraEnabled;
        await room.localParticipant.setCameraEnabled(
          enabled,
          selectedDevices.videoinput ? { deviceId: selectedDevices.videoinput } : undefined,
        );
      } else {
        await room.localParticipant.setScreenShareEnabled(!localMediaRef.current.screenShareEnabled);
      }

      if (roomRef.current !== room) return;
      const nextMedia = localMediaFromRoom(room);
      localMediaRef.current = nextMedia;
      setLocalMedia(nextMedia);
      setTrackViews(collectTracks(room));
      await patchOwnPresence({ ...nextMedia, status: 'ACTIVE' });
    } catch (error) {
      if (roomRef.current === room) {
        setNotice(friendlyMediaError(error, 'Não foi possível alterar este controle de mídia.'));
      }
    } finally {
      setBusyControl(null);
    }
  }

  async function changeDevice(event: ChangeEvent<HTMLSelectElement>) {
    const kind = event.currentTarget.name as MediaDeviceKind;
    const deviceId = event.currentTarget.value;
    setSelectedDevices(previous => ({ ...previous, [kind]: deviceId }));
    const room = roomRef.current;
    if (!room || !deviceId) return;

    const hasActiveTrack = kind === 'audiooutput' ||
      (kind === 'audioinput' && localMediaRef.current.microphoneEnabled) ||
      (kind === 'videoinput' && localMediaRef.current.cameraEnabled);
    if (!hasActiveTrack) return;

    try {
      const switched = await room.switchActiveDevice(kind, deviceId, true);
      if (roomRef.current === room && !switched) {
        setNotice('O navegador não conseguiu ativar o dispositivo selecionado.');
      }
    } catch (error) {
      if (roomRef.current === room) {
        setNotice(friendlyMediaError(error, 'Não foi possível trocar o dispositivo de mídia.'));
      }
    }
  }


  async function enablePlayback() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      if (roomRef.current === room) setAutoplayBlocked(false);
    } catch (error) {
      if (roomRef.current === room) {
        setNotice(friendlyMediaError(error, 'O navegador ainda bloqueou a reprodução de áudio.'));
      }
    }
  }

  const expandedTrack = expandedTrackId
    ? trackViews.video.find(view => view.id === expandedTrackId) ?? null
    : null;
  const visibleSessions = sessions.length
    ? sessions
    : connectionState === 'loading' || connectionState === 'connecting'
      ? []
      : [{
          channelKind: target.kind,
          serverId: target.kind === 'SERVER_VOICE' ? target.serverId : null,
          channelId: target.channelId,
          userId: currentUser.id,
          userName: currentUser.name,
          status: connectionState === 'reconnecting' ? 'RECONNECTING' : 'ACTIVE',
          ...localMedia,
          joinedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        } satisfies MediaSession];

  return (
    <>
      {visible && (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-(--surface-main) text-slate-100">
          <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-violet-300" aria-hidden="true">◉</span>
            <h1 className="truncate text-base font-semibold">{target.title}</h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {visibleSessions.length} {visibleSessions.length === 1 ? 'participante' : 'participantes'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${connectionBadgeClass(connectionState)}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {connectionLabel(connectionState)}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${realtimeConnected ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/20 bg-amber-400/10 text-amber-300'}`}>
            Presença {realtimeConnected ? 'ativa' : 'reconectando'}
          </span>
        </div>
      </header>

      {autoplayBlocked && (
        <button
          type="button"
          onClick={() => void enablePlayback()}
          className="mx-4 mt-3 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-left text-sm text-amber-100 hover:bg-amber-300/15 sm:mx-6"
        >
          🔊 O navegador bloqueou o áudio. Clique para ouvir os participantes.
        </button>
      )}

      {notice && (
        <div className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm text-amber-100 sm:mx-6" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-amber-200/70 hover:text-amber-100" aria-label="Fechar aviso">×</button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {fatalError ? (
            <div className="grid min-h-72 place-items-center">
              <div className="max-w-md rounded-2xl border border-rose-400/20 bg-rose-400/8 p-6 text-center">
                <div className="text-3xl" aria-hidden="true">!</div>
                <h2 className="mt-2 font-semibold text-rose-100">Sala indisponível</h2>
                <p className="mt-2 text-sm text-rose-200/80">{fatalError}</p>
                <button
                  type="button"
                  onClick={() => setRetry(value => value + 1)}
                  className="mt-5 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : trackViews.video.length ? (
            <div className="grid auto-rows-[minmax(220px,1fr)] grid-cols-1 gap-3 md:grid-cols-2">
              {trackViews.video.map(view => (
                <VideoTrackTile
                  key={`${view.participantId}:${view.id}`}
                  view={view}
                  onExpand={() => setExpandedTrackId(view.id)}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/2 p-8 text-center">
              <div>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-violet-500/10 text-3xl" aria-hidden="true">♫</div>
                <h2 className="mt-4 font-semibold">Conversa por voz</h2>
                <p className="mt-1 max-w-sm text-sm text-slate-400">
                  Câmeras e compartilhamentos de tela aparecerão aqui quando forem ativados.
                </p>
              </div>
            </div>
          )}

          {showMetrics && <MetricsPanel metrics={metrics} />}
      </main>
        </section>
      )}

      <CallControlDock
        currentUser={currentUser}
        roomTitle={target.title}
        connectionState={connectionState}
        localMedia={localMedia}
        busyControl={busyControl}
        remoteAudioMuted={remoteAudioMuted}
        onToggle={kind => void toggleMedia(kind)}
        onToggleRemoteAudio={() => setRemoteAudioMuted(muted => !muted)}
        onOpen={onOpenAction}
        onLeave={onLeaveAction}
      />

      {devicePanelTarget && createPortal(
        <MediaDevicePanel
          devices={devices}
          selectedDevices={selectedDevices}
          onChangeAction={changeDevice}
        />,
        devicePanelTarget,
      )}

      {visible && expandedTrack && (
        <ScreenShareViewer
          view={expandedTrack}
          onCloseAction={() => setExpandedTrackId(null)}
          onErrorAction={message => setNotice(message)}
        />
      )}

      <div className="hidden" aria-hidden="true">
        {trackViews.audio.map(view => (
          <RemoteAudioTrackElement
            key={`${view.participantId}:${view.id}`}
            track={view.track as RemoteTrack}
            muted={remoteAudioMuted}
            volume={participantVolumes[view.participantId] ?? storedParticipantVolume(view.participantId)}
            onBlocked={markAutoplayBlocked}
          />
        ))}
      </div>
    </>
  );
}

function VideoTrackTile({ view, onExpand }: { view: TrackView; onExpand: () => void }) {
  const elementRef = useRef<HTMLVideoElement>(null);
  const isScreenShare = view.source === Track.Source.ScreenShare;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    view.track.attach(element);
    return () => {
      view.track.detach(element);
    };
  }, [view.track]);

  return (
    <figure className={`group relative min-h-56 overflow-hidden rounded-2xl border bg-slate-950 shadow-xl shadow-black/20 ${isScreenShare ? 'border-violet-400/25' : 'border-white/10'}`}>
      <video ref={elementRef} autoPlay playsInline muted={view.local} className="h-full w-full object-contain" />
      <button
        type="button"
        onClick={onExpand}
        className="absolute inset-0 z-10 grid place-items-center bg-black/0 transition hover:bg-black/35 focus-visible:bg-black/35"
        aria-label={`Ampliar ${isScreenShare ? 'tela compartilhada' : 'câmera'} de ${view.local ? 'você' : view.participantName}`}
      >
        <span className="translate-y-2 rounded-xl border border-white/15 bg-slate-950/85 px-4 py-2 text-sm font-semibold text-white opacity-0 shadow-xl backdrop-blur transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
          ⛶ {isScreenShare ? 'Ampliar compartilhamento' : 'Ampliar câmera'}
        </span>
      </button>
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 bg-linear-to-t from-black/80 to-transparent px-3 pb-3 pt-8 text-xs">
        <span className="truncate font-medium">{view.local ? 'Você' : view.participantName}</span>
        <span className="rounded-full bg-black/50 px-2 py-1 text-slate-300">
          {isScreenShare ? 'Tela compartilhada' : 'Câmera'}
        </span>
      </figcaption>
    </figure>
  );
}

export function ScreenShareViewer({
  view,
  onCloseAction,
  onErrorAction,
}: {
  view: TrackView;
  onCloseAction: () => void;
  onErrorAction: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    view.track.attach(video);
    return () => {
      view.track.detach(video);
    };
  }, [view.track]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) onCloseAction();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCloseAction]);

  async function enterFullscreen() {
    const container = containerRef.current;
    if (!container?.requestFullscreen) {
      onErrorAction('Este navegador não oferece modo de tela cheia para este vídeo.');
      return;
    }
    try {
      await container.requestFullscreen();
    } catch {
      onErrorAction('Não foi possível abrir o vídeo em tela cheia.');
    }
  }

  const isScreenShare = view.source === Track.Source.ScreenShare;
  const mediaLabel = isScreenShare ? 'Tela' : 'Câmera';

  return (
    <div className="fixed inset-0 z-70 flex flex-col bg-black/95 p-3 backdrop-blur-md sm:p-5" role="dialog" aria-modal="true" aria-label={`${mediaLabel} ampliada`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{mediaLabel} de {view.local ? 'você' : view.participantName}</p>
          <p className="text-xs text-slate-500">Visualização ampliada</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void enterFullscreen()}
            className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20"
          >
            ⛶ Tela cheia
          </button>
          <button
            type="button"
            onClick={onCloseAction}
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-xl text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Fechar visualização ampliada"
          >
            ×
          </button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black">
        <video ref={videoRef} autoPlay playsInline muted={view.local} className="h-full w-full object-contain" />
      </div>
    </div>
  );
}

function RemoteAudioTrackElement({
  track,
  muted,
  volume,
  onBlocked,
}: {
  track: RemoteTrack;
  muted: boolean;
  volume: number;
  onBlocked: () => void;
}) {
  const elementRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    track.attach(element);
    void element.play().catch(onBlocked);
    return () => {
      track.detach(element);
    };
  }, [onBlocked, track]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    applyRemoteAudioSettings(element, muted, volume);
  }, [muted, volume]);

  return <audio ref={elementRef} autoPlay />;
}

function MediaDevicePanel({
  devices,
  selectedDevices,
  onChangeAction,
}: {
  devices: DeviceLists;
  selectedDevices: DeviceSelection;
  onChangeAction: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <details className="border-t border-white/7 p-3">
      <summary className="cursor-pointer rounded-xl px-2 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 transition hover:bg-white/5 hover:text-slate-200">
        Dispositivos de mídia
      </summary>
      <div className="mt-3 grid gap-3">
        <DeviceSelect label="Microfone" kind="audioinput" devices={devices.audioinput} value={selectedDevices.audioinput} onChange={onChangeAction} />
        <DeviceSelect label="Câmera" kind="videoinput" devices={devices.videoinput} value={selectedDevices.videoinput} onChange={onChangeAction} />
        <DeviceSelect label="Saída de áudio" kind="audiooutput" devices={devices.audiooutput} value={selectedDevices.audiooutput} onChange={onChangeAction} />
      </div>
    </details>
  );
}

function DeviceSelect({
  label,
  kind,
  devices,
  value,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span>{label}</span>
      <select
        name={kind}
        value={value}
        onChange={onChange}
        disabled={devices.length === 0}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {devices.length === 0 && <option value="">Nenhum dispositivo</option>}
        {devices.map((device, index) => (
          <option key={device.deviceId || `${kind}-${index}`} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function CallControlDock({
  currentUser,
  roomTitle,
  connectionState,
  localMedia,
  busyControl,
  remoteAudioMuted,
  onToggle,
  onToggleRemoteAudio,
  onOpen,
  onLeave,
}: {
  currentUser: CurrentUser;
  roomTitle: string;
  connectionState: ConnectionUiState;
  localMedia: LocalMediaState;
  busyControl: 'microphone' | 'camera' | 'screen' | null;
  remoteAudioMuted: boolean;
  onToggle: (kind: 'microphone' | 'camera' | 'screen') => void;
  onToggleRemoteAudio: () => void;
  onOpen: () => void;
  onLeave: () => void;
}) {
  const disabled = connectionState !== 'connected' || busyControl != null;
  return (
    <section className="fixed bottom-0 left-16 z-40 w-[min(20rem,calc(100vw-4rem))] border-t border-white/10 bg-slate-950/96 p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.35)] backdrop-blur md:w-72" aria-label="Controles da chamada">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/20 text-xs font-bold text-violet-200" aria-hidden="true">
          {currentUser.name.charAt(0).toUpperCase()}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition hover:bg-white/5"
          aria-label={`Abrir chamada em ${roomTitle}`}
          title="Abrir chamada"
        >
          <p className="truncate text-xs font-semibold text-white">{currentUser.name}</p>
          <p className="truncate text-[10px] text-emerald-300">◉ {connectionLabel(connectionState)} em {roomTitle}</p>
          <p className="truncate text-[10px] text-slate-500">
            Microfone {localMedia.microphoneEnabled ? 'ligado' : 'desligado'} · áudio {remoteAudioMuted ? 'silenciado' : 'ativo'}
          </p>
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-500/12 text-sm text-rose-300 transition hover:bg-rose-500/25"
          aria-label="Sair da chamada"
          title="Sair da chamada"
        >
          ↪
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <CallControlButton
          label={localMedia.microphoneEnabled ? 'Desligar microfone' : 'Ligar microfone'}
          active={localMedia.microphoneEnabled}
          busy={busyControl === 'microphone'}
          disabled={disabled}
          onClick={() => onToggle('microphone')}
          icon={localMedia.microphoneEnabled ? '🎙' : '🔇'}
        />
        <CallControlButton
          label={remoteAudioMuted ? 'Ativar áudio recebido' : 'Silenciar áudio recebido'}
          active={!remoteAudioMuted}
          busy={false}
          disabled={connectionState !== 'connected'}
          onClick={onToggleRemoteAudio}
          icon={remoteAudioMuted ? '🔈' : '🔊'}
        />
        <CallControlButton
          label={localMedia.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          active={localMedia.cameraEnabled}
          busy={busyControl === 'camera'}
          disabled={disabled}
          onClick={() => onToggle('camera')}
          icon="📷"
        />
        <CallControlButton
          label={localMedia.screenShareEnabled ? 'Parar compartilhamento' : 'Compartilhar tela'}
          active={localMedia.screenShareEnabled}
          busy={busyControl === 'screen'}
          disabled={disabled}
          onClick={() => onToggle('screen')}
          icon="▣"
        />
      </div>
      {localMedia.screenShareEnabled && (
        <button
          type="button"
          onClick={() => onToggle('screen')}
          disabled={disabled}
          className="mt-2 w-full rounded-lg border border-rose-400/25 bg-rose-500/12 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/22 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyControl === 'screen' ? 'Parando compartilhamento…' : '■ Parar compartilhamento de tela'}
        </button>
      )}
    </section>
  );
}

function CallControlButton({
  label,
  active,
  busy,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-9 place-items-center rounded-lg border text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-violet-400/30 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30' : 'border-white/8 bg-white/5 text-slate-300 hover:bg-white/10'}`}
    >
      <span aria-hidden="true">{busy ? '…' : icon}</span>
    </button>
  );
}

function MetricsPanel({ metrics }: { metrics: WebRtcMetrics }) {
  const items = [
    ['RTT', formatMetric(metrics.rttMs, 'ms')],
    ['Jitter', formatMetric(metrics.jitterMs, 'ms')],
    ['Perda', formatMetric(metrics.packetLossPercent, '%')],
    ['Bitrate', formatMetric(metrics.bitrateKbps, 'kbps')],
    ['Jitter buffer', formatMetric(metrics.jitterBufferMs, 'ms')],
  ];

  return (
    <section className="mt-4 rounded-2xl border border-white/8 bg-white/2.5 p-4" aria-label="Métricas WebRTC">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Qualidade WebRTC</h2>
        <span className="text-[10px] text-slate-600">
          {metrics.sampledAt ? `Atualizado ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(metrics.sampledAt)}` : 'Aguardando amostra'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-black/15 px-3 py-2">
            <dt className="text-[10px] text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatMetric(value: number | null, unit: string) {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = unit === '%' ? 2 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${unit}`;
}

function connectionLabel(state: ConnectionUiState) {
  const labels: Record<ConnectionUiState, string> = {
    loading: 'Preparando',
    connecting: 'Conectando',
    connected: 'Conectado',
    reconnecting: 'Reconectando',
    disconnected: 'Desconectado',
    error: 'Falha na conexão',
  };
  return labels[state];
}

function connectionBadgeClass(state: ConnectionUiState) {
  if (state === 'connected') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  if (state === 'reconnecting' || state === 'connecting' || state === 'loading') {
    return 'border-amber-400/20 bg-amber-400/10 text-amber-300';
  }
  return 'border-rose-400/20 bg-rose-400/10 text-rose-300';
}
