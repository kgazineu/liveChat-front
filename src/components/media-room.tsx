'use client';

import {
  ExternalLink,
  Headphones,
  HeadphoneOff,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings2,
  Signal,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteAudioTrack,
  type RemoteTrack,
  type ScreenShareCaptureOptions,
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
import { Avatar, colorFor } from './ui/avatar';

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
  /** Verdadeiro depois que a lista foi conferida com o servidor e com o LiveKit: pode substituir a da barra lateral. */
  authoritative?: boolean;
}

interface RemoteParticipantView {
  identity: string;
  name: string;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
}

const PRESENCE_RECONCILE_INTERVAL_MS = 30_000;
const SYNTHETIC_TIMESTAMP = new Date(0).toISOString();

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

export const SCREEN_SHARE_CAPTURE_OPTIONS = {
  audio: true,
  video: {
    displaySurface: 'browser',
  },
  systemAudio: 'include',
  surfaceSwitching: 'include',
  selfBrowserSurface: 'exclude',
} satisfies ScreenShareCaptureOptions;

export const SCREEN_SHARE_WITHOUT_AUDIO_NOTICE =
  'O compartilhamento começou sem áudio. Use Chrome, Edge ou o aplicativo desktop, selecione uma aba e marque “Compartilhar áudio da guia”.';

let callAudioContext: AudioContext | null = null;

// A presença no backend é uma por usuário, não por montagem. Uma montagem descartada (React StrictMode,
// nova tentativa) não pode encerrar a sessão que a montagem seguinte do mesmo canal continua usando.
const mountedRooms = new Map<string, number>();

function retainRoom(endpoint: string) {
  mountedRooms.set(endpoint, (mountedRooms.get(endpoint) ?? 0) + 1);
}

function releaseRoom(endpoint: string) {
  const remaining = (mountedRooms.get(endpoint) ?? 1) - 1;
  if (remaining > 0) mountedRooms.set(endpoint, remaining);
  else mountedRooms.delete(endpoint);
}

function leaveRoomIfUnused(endpoint: string) {
  // Adiado para depois do commit: uma remontagem imediata já terá se registrado.
  window.setTimeout(() => {
    if (!mountedRooms.has(endpoint)) void api.delete(endpoint).catch(() => undefined);
  }, 0);
}

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

export function storedScreenShareVolume(userId: string) {
  if (typeof window === 'undefined') return 100;
  const rawVolume = window.localStorage.getItem(`screen-share-volume:${userId}`);
  if (rawVolume == null) return 100;
  const stored = Number(rawVolume);
  return Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : 100;
}

export function storeScreenShareVolume(userId: string, volume: number) {
  const normalized = Math.min(100, Math.max(0, volume));
  try {
    window.localStorage.setItem(`screen-share-volume:${userId}`, String(normalized));
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

function collectRemoteParticipants(room: Room | null): RemoteParticipantView[] {
  if (!room) return [];
  return [...room.remoteParticipants.values()].map(participant => ({
    identity: participant.identity,
    name: participant.name || participant.identity,
    microphoneEnabled: participant.isMicrophoneEnabled,
    cameraEnabled: participant.isCameraEnabled,
    screenShareEnabled: participant.isScreenShareEnabled,
  }));
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
  voicePanelTarget = null,
  microphoneMuted = false,
  deafened = false,
  onToggleMicrophoneAction,
  onToggleDeafenAction,
  onMicrophoneMutedChangeAction,
  headerStart,
}: {
  currentUser: CurrentUser;
  target: MediaTarget;
  visible: boolean;
  onOpenAction: () => void;
  onLeaveAction: () => void;
  onSummaryAction?: (summary: MediaRoomSummary) => void;
  showMetrics?: boolean;
  participantVolumes?: Record<string, number>;
  /** Área da barra lateral onde o painel “Voz conectada” é exibido. */
  voicePanelTarget?: HTMLElement | null;
  /** Preferências globais: o microfone só é publicado quando não está silenciado nem com áudio desativado. */
  microphoneMuted?: boolean;
  deafened?: boolean;
  onToggleMicrophoneAction?: () => void;
  onToggleDeafenAction?: () => void;
  onMicrophoneMutedChangeAction?: (muted: boolean) => void;
  headerStart?: ReactNode;
}) {
  const { connected: realtimeConnected, connectionRevision, subscribePresence } = useRealtime();
  const endpoint = useMemo(() => mediaSessionsEndpoint(target), [target]);
  const roomRef = useRef<Room | null>(null);
  const connectionRef = useRef<LiveKitConnection | null>(null);
  const endpointRef = useRef(endpoint);
  const localMediaRef = useRef<LocalMediaState>(EMPTY_MEDIA);
  const previousBytesRef = useRef(new Map<string, PreviousByteSample>());
  const joinedRef = useRef(false);
  const connectionRevisionRef = useRef(connectionRevision);
  const wantsMicrophoneRef = useRef(!microphoneMuted && !deafened);
  const onMicrophoneMutedChangeRef = useRef(onMicrophoneMutedChangeAction);
  const remoteAudioMuted = deafened;

  const [sessions, setSessions] = useState<MediaSession[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionUiState>('loading');
  const [localMedia, setLocalMedia] = useState<LocalMediaState>(EMPTY_MEDIA);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipantView[]>([]);
  const [presenceSynced, setPresenceSynced] = useState(false);
  const reconcilePresenceRef = useRef<() => void>(() => undefined);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [screenShareVolumes, setScreenShareVolumes] = useState<Record<string, number>>({});
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

    retainRoom(endpoint);
    localMediaRef.current = EMPTY_MEDIA;
    previousBytes.clear();
    queueMicrotask(() => {
      if (!active) return;
      setSessions([]);
      setConnectionState('loading');
      setLocalMedia(EMPTY_MEDIA);
      setActiveSpeakers(new Set());
      setScreenShareVolumes({});
      setDevices(EMPTY_DEVICES);
      setSelectedDevices(EMPTY_SELECTION);
      setTrackViews({ audio: [], video: [] });
      setAutoplayBlocked(false);
      setNotice(null);
      setFatalError(null);
      setMetrics(EMPTY_METRICS);
      setExpandedTrackId(null);
      setMicrophoneReady(false);
      setRemoteParticipants([]);
      setPresenceSynced(false);
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
      if (!active) return;
      setTrackViews(collectTracks(room));
      setRemoteParticipants(collectRemoteParticipants(room));
    };

    // Eventos STOMP podem se perder (conexão meio-aberta, queda durante a entrada de alguém). A lista do servidor é
    // conferida de novo quando o LiveKit avisa que alguém entrou ou saiu, após reconexões e periodicamente.
    let reconcileTimer: number | undefined;
    let reconcileController: AbortController | null = null;
    const reconcilePresence = () => {
      if (!active) return;
      window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(async () => {
        reconcileController?.abort();
        const requestController = new AbortController();
        reconcileController = requestController;
        try {
          const response = await api.get<MediaSession[]>(endpoint, { signal: requestController.signal });
          if (!active || requestController.signal.aborted || !Array.isArray(response.data)) return;
          const current = response.data.filter(session => belongsToTarget(session, target)).map(withoutConnection);
          current.forEach(session => removedParticipants.delete(String(session.userId)));
          setSessions(previous => mergeSessions(
            previous.filter(session => String(session.userId) === String(currentUser.id)),
            current,
          ));
          setPresenceSynced(true);
          // Ainda na sala de mídia, mas sem presença no servidor (expirou ou foi removida): entrar de novo a restaura.
          if (joined && room?.state === 'connected' && !current.some(session => String(session.userId) === String(currentUser.id))) {
            void api.post(endpoint).catch(() => undefined);
          }
        } catch {
          // A próxima conferência tenta de novo.
        }
      }, 250);
    };
    reconcilePresenceRef.current = reconcilePresence;
    const reconcileInterval = window.setInterval(reconcilePresence, PRESENCE_RECONCILE_INTERVAL_MS);

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
          setPresenceSynced(true);
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
        leaveRoomIfUnused(endpoint);
        return;
      }
      joinedRef.current = true;
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
        reconcilePresence();
        void patchFromRoom('ACTIVE');
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!active) return;
        joined = false;
        joinedRef.current = false;
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
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (
          track.kind === Track.Kind.Audio &&
          publication.source === Track.Source.ScreenShareAudio
        ) {
          (track as RemoteAudioTrack).setVolume(
            storedScreenShareVolume(participant.identity) / 100,
          );
        }
        refreshTrackViews();
      });
      room.on(RoomEvent.TrackUnsubscribed, refreshTrackViews);
      room.on(RoomEvent.TrackMuted, refreshTrackViews);
      room.on(RoomEvent.TrackUnmuted, refreshTrackViews);
      room.on(RoomEvent.ParticipantConnected, () => {
        if (!active) return;
        refreshTrackViews();
        reconcilePresence();
        playCallSound('join');
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (!active) return;
        refreshTrackViews();
        reconcilePresence();
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

        if (wantsMicrophoneRef.current) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (error) {
            if (active) {
              setNotice(friendlyMediaError(error, 'A sala foi conectada, mas o microfone não pôde ser publicado.'));
              onMicrophoneMutedChangeRef.current?.(true);
            }
          }
        }
        if (!active) return;
        await patchFromRoom('ACTIVE');
        if (active) setMicrophoneReady(true);
        await refreshDevices();
      } catch (error) {
        if (!active) return;
        joined = false;
        joinedRef.current = false;
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
      joinedRef.current = false;
      window.clearTimeout(reconcileTimer);
      window.clearInterval(reconcileInterval);
      reconcileController?.abort();
      reconcilePresenceRef.current = () => undefined;
      releaseRoom(endpoint);
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
        leaveRoomIfUnused(endpoint);
      }
    };
  }, [applyOwnPresence, currentUser.id, endpoint, retry, subscribePresence, target]);

  useEffect(() => {
    wantsMicrophoneRef.current = !microphoneMuted && !deafened;
    onMicrophoneMutedChangeRef.current = onMicrophoneMutedChangeAction;
  });

  const setMicrophone = useCallback(async (room: Room, enabled: boolean) => {
    setBusyControl('microphone');
    try {
      await room.localParticipant.setMicrophoneEnabled(
        enabled,
        enabled && selectedDevices.audioinput ? { deviceId: selectedDevices.audioinput } : undefined,
      );
      if (roomRef.current !== room) return;
      const nextMedia = localMediaFromRoom(room);
      localMediaRef.current = nextMedia;
      setLocalMedia(nextMedia);
      setTrackViews(collectTracks(room));
      await patchOwnPresence({ ...nextMedia, status: 'ACTIVE' });
    } catch (error) {
      if (roomRef.current === room) {
        setNotice(friendlyMediaError(error, 'Não foi possível alterar o microfone.'));
        if (enabled) onMicrophoneMutedChangeRef.current?.(true);
      }
    } finally {
      setBusyControl(null);
    }
  }, [patchOwnPresence, selectedDevices.audioinput]);

  // Aplica as preferências de microfone/áudio da barra do usuário à sala conectada.
  useEffect(() => {
    const wanted = !microphoneMuted && !deafened;
    const room = roomRef.current;
    if (!room || !microphoneReady || connectionState !== 'connected' || busyControl) return;
    if (localMediaRef.current.microphoneEnabled === wanted) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void setMicrophone(room, wanted);
    });
    return () => {
      cancelled = true;
    };
  }, [busyControl, connectionState, deafened, microphoneMuted, microphoneReady, setMicrophone]);

  // Uma queda só do STOMP marca a presença como reconectando; entrar de novo é idempotente e a reativa.
  useEffect(() => {
    if (connectionRevisionRef.current === connectionRevision) return;
    connectionRevisionRef.current = connectionRevision;
    if (!joinedRef.current) return;
    void api.post<MediaSession>(endpoint)
      .then(response => {
        if (joinedRef.current && response.data && typeof response.data === 'object') {
          applyOwnPresence({}, withoutConnection(response.data));
        }
      })
      .catch(() => undefined)
      // Eventos enviados enquanto o tempo real estava fora se perderam: confere a lista inteira.
      .finally(() => reconcilePresenceRef.current());
  }, [applyOwnPresence, connectionRevision, endpoint]);

  // O LiveKit é a fonte de verdade de quem está na sala: quem tem mídia conectada aparece mesmo que a presença
  // ainda não tenha chegado, e o estado de microfone/câmera vem do que está de fato publicado.
  const roomSessions = useMemo(() => {
    const remoteById = new Map(remoteParticipants.map(participant => [participant.identity, participant]));
    const merged = sessions.map(session => {
      const live = remoteById.get(String(session.userId));
      return live ? {
        ...session,
        microphoneEnabled: live.microphoneEnabled,
        cameraEnabled: live.cameraEnabled,
        screenShareEnabled: live.screenShareEnabled,
      } : session;
    });
    const known = new Set(merged.map(session => String(session.userId)));
    for (const participant of remoteParticipants) {
      if (known.has(participant.identity)) continue;
      merged.push({
        channelKind: target.kind,
        serverId: target.kind === 'SERVER_VOICE' ? target.serverId : null,
        channelId: target.channelId,
        userId: participant.identity,
        userName: participant.name,
        status: 'ACTIVE',
        microphoneEnabled: participant.microphoneEnabled,
        cameraEnabled: participant.cameraEnabled,
        screenShareEnabled: participant.screenShareEnabled,
        joinedAt: SYNTHETIC_TIMESTAMP,
        lastSeenAt: SYNTHETIC_TIMESTAMP,
      });
    }
    return merged;
  }, [remoteParticipants, sessions, target]);

  useEffect(() => {
    onSummaryAction?.({
      sessions: roomSessions,
      speakingUserIds: [...activeSpeakers],
      authoritative: presenceSynced,
    });
  }, [activeSpeakers, onSummaryAction, presenceSynced, roomSessions]);

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

  async function toggleMedia(kind: 'camera' | 'screen') {
    const room = roomRef.current;
    if (!room || connectionState !== 'connected' || busyControl) return;
    setBusyControl(kind);
    setNotice(null);

    try {
      if (kind === 'camera') {
        const enabled = !localMediaRef.current.cameraEnabled;
        await room.localParticipant.setCameraEnabled(
          enabled,
          selectedDevices.videoinput ? { deviceId: selectedDevices.videoinput } : undefined,
        );
      } else {
        const enabled = !localMediaRef.current.screenShareEnabled;
        await room.localParticipant.setScreenShareEnabled(
          enabled,
          enabled ? SCREEN_SHARE_CAPTURE_OPTIONS : undefined,
        );
        if (
          enabled &&
          !room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
        ) {
          setNotice(SCREEN_SHARE_WITHOUT_AUDIO_NOTICE);
        }
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

  function changeScreenShareVolume(userId: string, value: number) {
    const volume = storeScreenShareVolume(userId, value);
    setScreenShareVolumes(previous => ({ ...previous, [userId]: volume }));

    const audioTrack = roomRef.current?.remoteParticipants
      .get(userId)
      ?.getTrackPublication(Track.Source.ScreenShareAudio)
      ?.audioTrack as RemoteAudioTrack | undefined;
    audioTrack?.setVolume(remoteAudioMuted ? 0 : volume / 100);
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
  const screenShareAudioParticipantIds = new Set(
    trackViews.audio
      .filter(view => view.source === Track.Source.ScreenShareAudio)
      .map(view => view.participantId),
  );
  const visibleSessions = roomSessions.length
    ? roomSessions
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
  const screenShares = trackViews.video.filter(view => view.source === Track.Source.ScreenShare);
  const cameraByParticipant = new Map(
    trackViews.video
      .filter(view => view.source !== Track.Source.ScreenShare)
      .map(view => [view.participantId, view]),
  );
  const controlsDisabled = connectionState !== 'connected' || busyControl != null;
  // Em uma chamada privada, o outro lado aparece como “chamando” até entrar.
  const waitingForPeer = target.kind === 'DIRECT' && connectionState === 'connected' &&
    !visibleSessions.some(session => String(session.userId) !== String(currentUser.id));
  const micOff = !localMedia.microphoneEnabled;
  const screenShareVolumeFor = (view: TrackView) => (
    !view.local && view.source === Track.Source.ScreenShare && screenShareAudioParticipantIds.has(view.participantId)
      ? screenShareVolumes[view.participantId] ?? storedScreenShareVolume(view.participantId)
      : undefined
  );

  return (
    <>
      {visible && (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-black text-text">
          <header className="flex h-12 shrink-0 items-center gap-2 px-2 sm:px-4">
            {headerStart}
            <Volume2 size={22} className="shrink-0 text-faint" aria-hidden="true" />
            <h1 className="min-w-0 truncate text-base font-semibold text-header">{target.title}</h1>
            <span className="ml-1 hidden text-sm text-muted sm:inline">
              {visibleSessions.length} {visibleSessions.length === 1 ? 'participante' : 'participantes'}
            </span>
            <div className="ml-auto flex items-center gap-2 text-xs">
              {!realtimeConnected && (
                <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 font-semibold text-warning" role="status">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" /> Presença reconectando
                </span>
              )}
              <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${connectionToneClass(connectionState)}`}>
                <Signal size={14} /> {connectionLabel(connectionState)}
              </span>
            </div>
          </header>

          {autoplayBlocked && (
            <button
              type="button"
              onClick={() => void enablePlayback()}
              className="mx-3 mb-2 flex items-center gap-2 rounded-md bg-warning px-4 py-2 text-left text-sm font-medium text-black transition hover:brightness-110 sm:mx-4"
            >
              <VolumeX size={18} /> O navegador bloqueou o áudio. Clique para ouvir os participantes.
            </button>
          )}

          {notice && (
            <div className="mx-3 mb-2 flex items-start justify-between gap-3 rounded-md bg-[#2b2d31] px-4 py-3 text-sm text-text sm:mx-4" role="status">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="text-interactive hover:text-header" aria-label="Fechar aviso">
                <X size={16} />
              </button>
            </div>
          )}

          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 sm:px-4">
            {fatalError ? (
              <div className="grid flex-1 place-items-center">
                <div className="max-w-md rounded-lg bg-[#2b2d31] p-6 text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-danger/15 text-danger">
                    <PhoneOff size={26} />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-header">Sala indisponível</h2>
                  <p className="mt-2 text-sm text-muted">{fatalError}</p>
                  <button
                    type="button"
                    onClick={() => setRetry(value => value + 1)}
                    className="mt-5 rounded-[3px] bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover"
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            ) : (
              <div className={`flex flex-1 flex-col justify-center gap-3 ${screenShares.length ? '' : 'py-4'}`}>
                {screenShares.length > 0 && (
                  <div className={`grid gap-3 ${screenShares.length > 1 ? 'lg:grid-cols-2' : ''}`}>
                    {screenShares.map(view => (
                      <VideoTrackTile
                        key={`${view.participantId}:${view.id}`}
                        view={view}
                        featured
                        onExpand={() => setExpandedTrackId(view.id)}
                        screenShareVolume={screenShareVolumeFor(view)}
                        onScreenShareVolumeChange={value => changeScreenShareVolume(view.participantId, value)}
                      />
                    ))}
                  </div>
                )}
                {visibleSessions.length === 0 && (
                  <div className="grid place-items-center py-10 text-muted" role="status">
                    <Loader2 size={28} className="animate-spin" />
                    <p className="mt-3 text-sm">Entrando na sala…</p>
                  </div>
                )}
                <div className={`mx-auto grid w-full gap-3 ${participantGridClass(visibleSessions.length + (waitingForPeer ? 1 : 0), screenShares.length > 0)}`}>
                  {visibleSessions.map(session => {
                    const userId = String(session.userId);
                    const camera = cameraByParticipant.get(userId);
                    return camera ? (
                      <VideoTrackTile
                        key={`${userId}:${camera.id}`}
                        view={camera}
                        speaking={activeSpeakers.has(userId)}
                        microphoneOff={!session.microphoneEnabled}
                        onExpand={() => setExpandedTrackId(camera.id)}
                        onScreenShareVolumeChange={() => undefined}
                      />
                    ) : (
                      <ParticipantTile
                        key={userId}
                        session={session}
                        mine={userId === String(currentUser.id)}
                        speaking={activeSpeakers.has(userId)}
                        compact={screenShares.length > 0}
                      />
                    );
                  })}
                  {waitingForPeer && <CallingTile name={target.title} seed={target.kind === 'DIRECT' ? target.participantId : undefined} />}
                </div>
              </div>
            )}

            {showMetrics && <MetricsPanel metrics={metrics} />}
          </main>

          <div className="flex shrink-0 items-center justify-center gap-2 px-3 pb-5 pt-2 sm:gap-3" role="toolbar" aria-label="Controles da chamada">
            <RoomControl
              label={localMedia.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
              active={localMedia.cameraEnabled}
              busy={busyControl === 'camera'}
              disabled={controlsDisabled}
              onClick={() => void toggleMedia('camera')}
            >
              {localMedia.cameraEnabled ? <Video size={22} /> : <VideoOff size={22} />}
            </RoomControl>
            <RoomControl
              label={localMedia.screenShareEnabled ? 'Parar compartilhamento' : 'Compartilhar tela'}
              active={localMedia.screenShareEnabled}
              busy={busyControl === 'screen'}
              disabled={controlsDisabled}
              onClick={() => void toggleMedia('screen')}
            >
              <MonitorUp size={22} />
            </RoomControl>
            <span className="mx-1 h-8 w-px bg-white/10" aria-hidden="true" />
            <RoomControl
              label={micOff ? 'Ativar microfone' : 'Silenciar microfone'}
              active={false}
              danger={micOff}
              busy={busyControl === 'microphone'}
              disabled={connectionState !== 'connected'}
              onClick={() => onToggleMicrophoneAction?.()}
            >
              {micOff ? <MicOff size={22} /> : <Mic size={22} />}
            </RoomControl>
            <RoomControl
              label={deafened ? 'Ativar áudio' : 'Desativar áudio'}
              active={false}
              danger={deafened}
              busy={false}
              disabled={connectionState !== 'connected'}
              onClick={() => onToggleDeafenAction?.()}
            >
              {deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
            </RoomControl>
            <button
              type="button"
              onClick={onLeaveAction}
              className="has-tooltip relative grid h-14 w-[72px] place-items-center rounded-full bg-danger text-white transition hover:bg-danger-hover"
              aria-label="Sair da chamada"
            >
              <PhoneOff size={24} />
              <span className="tooltip tooltip-top text-xs">Desconectar</span>
            </button>
          </div>
        </section>
      )}

      {voicePanelTarget && createPortal(
        <section aria-label="Conexão de voz" className="relative border-b border-black/30 bg-panel px-2 pb-2 pt-2.5">
          {devicesOpen && (
            <MediaDevicePanel
              devices={devices}
              selectedDevices={selectedDevices}
              onChangeAction={changeDevice}
              onCloseAction={() => setDevicesOpen(false)}
            />
          )}
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1 pl-1">
              <p className={`flex items-center gap-1.5 text-sm font-semibold ${connectionTextClass(connectionState)}`}>
                <Signal size={16} strokeWidth={2.5} />
                {connectionState === 'connected' ? 'Voz conectada' : connectionLabel(connectionState)}
              </p>
              <button
                type="button"
                onClick={onOpenAction}
                className="block max-w-full truncate text-left text-xs text-muted hover:text-text hover:underline"
                aria-label={`Abrir chamada em ${target.title}`}
              >
                {target.kind === 'DIRECT' ? `Chamada com ${target.title}` : target.title}
              </button>
            </div>
            <PanelIconButton label="Dispositivos de mídia" pressed={devicesOpen} onClick={() => setDevicesOpen(open => !open)}>
              <Settings2 size={20} />
            </PanelIconButton>
            <PanelIconButton label="Sair da chamada" onClick={onLeaveAction}>
              <PhoneOff size={20} />
            </PanelIconButton>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PanelToggle
              label={localMedia.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
              active={localMedia.cameraEnabled}
              busy={busyControl === 'camera'}
              disabled={controlsDisabled}
              onClick={() => void toggleMedia('camera')}
            >
              {localMedia.cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
              <span>Câmera</span>
            </PanelToggle>
            <PanelToggle
              label={localMedia.screenShareEnabled ? 'Parar compartilhamento' : 'Compartilhar tela'}
              active={localMedia.screenShareEnabled}
              busy={busyControl === 'screen'}
              disabled={controlsDisabled}
              onClick={() => void toggleMedia('screen')}
            >
              <MonitorUp size={18} />
              <span>{localMedia.screenShareEnabled ? 'Parar' : 'Tela'}</span>
            </PanelToggle>
          </div>
          {!visible && (
            <button
              type="button"
              onClick={onOpenAction}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded py-1 text-xs font-medium text-muted transition hover:bg-hover hover:text-text"
            >
              <ExternalLink size={13} /> Voltar para a chamada
            </button>
          )}
        </section>,
        voicePanelTarget,
      )}

      {visible && expandedTrack && (
        <ScreenShareViewer
          view={expandedTrack}
          onCloseAction={() => setExpandedTrackId(null)}
          onErrorAction={message => setNotice(message)}
          screenShareVolume={screenShareVolumeFor(expandedTrack)}
          onScreenShareVolumeChangeAction={value => changeScreenShareVolume(expandedTrack.participantId, value)}
        />
      )}

      <div className="hidden" aria-hidden="true">
        {trackViews.audio.map(view => {
          const screenShareAudio = view.source === Track.Source.ScreenShareAudio;
          const volume = screenShareAudio
            ? (screenShareVolumes[view.participantId] ?? storedScreenShareVolume(view.participantId)) / 100
            : participantVolumes[view.participantId] ?? storedParticipantVolume(view.participantId);
          return (
            <RemoteAudioTrackElement
              key={`${view.participantId}:${view.id}`}
              track={view.track as RemoteTrack}
              muted={remoteAudioMuted}
              volume={volume}
              onBlocked={markAutoplayBlocked}
            />
          );
        })}
      </div>
    </>
  );
}

function participantGridClass(count: number, compact: boolean) {
  if (compact) return 'max-w-none grid-cols-[repeat(auto-fill,minmax(160px,1fr))]';
  if (count <= 1) return 'max-w-3xl grid-cols-1';
  if (count === 2) return 'max-w-5xl grid-cols-1 sm:grid-cols-2';
  if (count <= 4) return 'max-w-5xl grid-cols-2';
  return 'max-w-6xl grid-cols-2 lg:grid-cols-3';
}

function ParticipantTile({ session, mine, speaking, compact }: {
  session: MediaSession;
  mine: boolean;
  speaking: boolean;
  compact: boolean;
}) {
  const userId = String(session.userId);
  const reconnecting = session.status === 'RECONNECTING';
  return (
    <figure
      className={`relative grid aspect-video place-items-center overflow-hidden rounded-lg transition-shadow ${speaking ? 'ring-[3px] ring-success' : ''} ${reconnecting ? 'opacity-60' : ''}`}
      style={{ backgroundColor: `${colorFor(userId)}40` }}
    >
      <div className={`rounded-full transition-shadow ${speaking ? 'shadow-[0_0_0_4px_rgba(35,165,90,0.9)]' : ''}`}>
        <Avatar name={session.userName} seed={userId} size={compact ? 'md' : 'lg'} />
      </div>
      <figcaption className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-sm font-medium text-white">
        {!session.microphoneEnabled && <MicOff size={14} className="shrink-0 text-danger" aria-label="Microfone desligado" />}
        <span className="truncate">{mine ? `${session.userName} (você)` : session.userName}</span>
        {reconnecting && <span className="shrink-0 text-xs text-warning">reconectando…</span>}
      </figcaption>
      {session.screenShareEnabled && (
        <span className="absolute right-2 top-2 rounded bg-danger px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">Ao vivo</span>
      )}
    </figure>
  );
}

function CallingTile({ name, seed }: { name: string; seed?: string }) {
  return (
    <figure className="relative grid aspect-video place-items-center overflow-hidden rounded-lg bg-[#2b2d31]" aria-label={`Chamando ${name}`}>
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />
        <Avatar name={name} seed={seed} size="lg" />
      </div>
      <figcaption className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-sm font-medium text-white">
        {name} · Chamando…
      </figcaption>
    </figure>
  );
}

function RoomControl({ label, active, danger = false, busy, disabled, onClick, children }: {
  label: string;
  active: boolean;
  danger?: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active || danger}
      className={`has-tooltip relative grid h-14 w-14 place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-white text-black hover:bg-white/90' : danger ? 'bg-[#2b2d31] text-danger hover:bg-[#35373c]' : 'bg-[#2b2d31] text-white hover:bg-[#35373c]'}`}
    >
      {busy ? <Loader2 size={22} className="animate-spin" /> : children}
      <span className="tooltip tooltip-top text-xs">{label}</span>
    </button>
  );
}

function PanelIconButton({ label, pressed, onClick, children }: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={`has-tooltip relative grid h-8 w-8 shrink-0 place-items-center rounded transition hover:bg-hover ${pressed ? 'text-header' : 'text-interactive hover:text-text'}`}
    >
      {children}
      <span className="tooltip tooltip-top text-xs">{label}</span>
    </button>
  );
}

function PanelToggle({ label, active, busy, disabled, onClick, children }: {
  label: string;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 items-center justify-center gap-1.5 rounded text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-success text-white hover:bg-success-hover' : 'bg-[#2b2d31] text-text hover:bg-hover'}`}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : children}
    </button>
  );
}

function VideoTrackTile({
  view,
  onExpand,
  screenShareVolume,
  onScreenShareVolumeChange,
  featured = false,
  speaking = false,
  microphoneOff = false,
}: {
  view: TrackView;
  onExpand: () => void;
  screenShareVolume?: number;
  onScreenShareVolumeChange: (value: number) => void;
  featured?: boolean;
  speaking?: boolean;
  microphoneOff?: boolean;
}) {
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
    <figure className={`group relative overflow-hidden rounded-lg bg-[#111214] transition-shadow ${featured ? 'aspect-video max-h-[70vh] w-full' : 'aspect-video'} ${speaking ? 'ring-[3px] ring-success' : ''}`}>
      <video
        ref={elementRef}
        autoPlay
        playsInline
        muted={view.local}
        className={`h-full w-full ${isScreenShare ? 'object-contain' : 'object-cover'} ${view.local && !isScreenShare ? '-scale-x-100' : ''}`}
      />
      <button
        type="button"
        onClick={onExpand}
        className="absolute inset-0 z-10 grid place-items-center bg-black/0 opacity-0 transition hover:bg-black/30 hover:opacity-100 focus-visible:bg-black/30 focus-visible:opacity-100"
        aria-label={`Ampliar ${isScreenShare ? 'tela compartilhada' : 'câmera'} de ${view.local ? 'você' : view.participantName}`}
      >
        <span className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-2 text-sm font-semibold text-white">
          <Maximize2 size={16} /> {isScreenShare ? 'Ampliar transmissão' : 'Ampliar câmera'}
        </span>
      </button>
      {screenShareVolume != null && (
        <div className="absolute right-2 top-2 z-30 w-56 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <ScreenShareVolumeControl
            participantName={view.participantName}
            volume={screenShareVolume}
            onChangeAction={onScreenShareVolumeChange}
            compact
          />
        </div>
      )}
      <figcaption className="pointer-events-none absolute bottom-2 left-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-sm font-medium text-white">
        {microphoneOff && <MicOff size={14} className="shrink-0 text-danger" aria-hidden="true" />}
        {isScreenShare && <span className="shrink-0 rounded bg-danger px-1 text-[10px] font-bold uppercase">Ao vivo</span>}
        <span className="truncate">{view.local ? 'Você' : view.participantName}</span>
        <span className="sr-only">{isScreenShare ? 'Tela compartilhada' : 'Câmera'}</span>
      </figcaption>
    </figure>
  );
}

export function ScreenShareViewer({
  view,
  onCloseAction,
  onErrorAction,
  screenShareVolume,
  onScreenShareVolumeChangeAction,
}: {
  view: TrackView;
  onCloseAction: () => void;
  onErrorAction: (message: string) => void;
  screenShareVolume?: number;
  onScreenShareVolumeChangeAction?: (value: number) => void;
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
    <div className="fixed inset-0 z-70 flex animate-fade-in flex-col bg-black p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={`${mediaLabel} ampliada`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-lg bg-[#1e1f22] px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-header">{mediaLabel} de {view.local ? 'você' : view.participantName}</p>
          <p className="text-xs text-muted">Visualização ampliada · Esc para fechar</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isScreenShare && screenShareVolume != null && onScreenShareVolumeChangeAction && (
            <ScreenShareVolumeControl
              participantName={view.participantName}
              volume={screenShareVolume}
              onChangeAction={onScreenShareVolumeChangeAction}
            />
          )}
          <button
            type="button"
            onClick={() => void enterFullscreen()}
            className="flex items-center gap-1.5 rounded-[3px] bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover"
          >
            <Maximize2 size={15} /> Tela cheia
          </button>
          <button
            type="button"
            onClick={onCloseAction}
            className="grid h-8 w-8 place-items-center rounded text-interactive transition hover:bg-hover hover:text-header"
            aria-label="Fechar visualização ampliada"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} autoPlay playsInline muted={view.local} className="h-full w-full object-contain" />
      </div>
    </div>
  );
}

export function ScreenShareVolumeControl({
  participantName,
  volume,
  onChangeAction,
  compact = false,
}: {
  participantName: string;
  volume: number;
  onChangeAction: (value: number) => void;
  compact?: boolean;
}) {
  const normalized = Math.min(100, Math.max(0, volume));

  return (
    <label className={`block rounded-md bg-floating/95 shadow-lg ${compact ? 'px-3 py-2' : 'min-w-56 px-3 py-2'}`}>
      <span className="flex items-center justify-between gap-3 text-[11px] font-semibold text-text">
        <span className="truncate">Transmissão de {participantName}</span>
        <span className="shrink-0 tabular-nums text-muted">{Math.round(normalized)}%</span>
      </span>
      <span className="mt-1.5 flex items-center gap-2 text-interactive">
        <VolumeX size={14} aria-hidden="true" />
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={normalized}
          onChange={event => onChangeAction(Number(event.currentTarget.value))}
          className="h-1.5 min-w-24 flex-1 cursor-pointer"
          aria-label={`Volume da transmissão de ${participantName}`}
        />
        <Volume2 size={14} aria-hidden="true" />
      </span>
    </label>
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
    const normalized = muted ? 0 : Math.min(1, Math.max(0, volume));
    (track as RemoteAudioTrack).setVolume(normalized);
    applyRemoteAudioSettings(element, muted, volume);
  }, [muted, track, volume]);

  return <audio ref={elementRef} autoPlay />;
}

function MediaDevicePanel({
  devices,
  selectedDevices,
  onChangeAction,
  onCloseAction,
}: {
  devices: DeviceLists;
  selectedDevices: DeviceSelection;
  onChangeAction: (event: ChangeEvent<HTMLSelectElement>) => void;
  onCloseAction: () => void;
}) {
  return (
    <div className="absolute inset-x-2 bottom-[calc(100%+8px)] z-40 animate-slide-up rounded-lg bg-floating p-3 shadow-2xl" role="group" aria-label="Dispositivos de mídia">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold uppercase text-muted">Voz e vídeo</p>
        <button type="button" onClick={onCloseAction} className="text-interactive hover:text-header" aria-label="Fechar dispositivos de mídia">
          <X size={16} />
        </button>
      </div>
      <div className="grid gap-3">
        <DeviceSelect label="Microfone" kind="audioinput" devices={devices.audioinput} value={selectedDevices.audioinput} onChange={onChangeAction} />
        <DeviceSelect label="Câmera" kind="videoinput" devices={devices.videoinput} value={selectedDevices.videoinput} onChange={onChangeAction} />
        <DeviceSelect label="Saída de áudio" kind="audiooutput" devices={devices.audiooutput} value={selectedDevices.audiooutput} onChange={onChangeAction} />
      </div>
    </div>
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
    <label className="block text-xs font-semibold text-muted">
      <span>{label}</span>
      <select
        name={kind}
        value={value}
        onChange={onChange}
        disabled={devices.length === 0}
        className="mt-1.5 w-full rounded-[3px] bg-sidebar px-2.5 py-2 text-sm font-normal text-text outline-none focus:ring-2 focus:ring-link/60 disabled:cursor-not-allowed disabled:opacity-50"
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

function MetricsPanel({ metrics }: { metrics: WebRtcMetrics }) {
  const items = [
    ['RTT', formatMetric(metrics.rttMs, 'ms')],
    ['Jitter', formatMetric(metrics.jitterMs, 'ms')],
    ['Perda', formatMetric(metrics.packetLossPercent, '%')],
    ['Bitrate', formatMetric(metrics.bitrateKbps, 'kbps')],
    ['Jitter buffer', formatMetric(metrics.jitterBufferMs, 'ms')],
  ];

  return (
    <section className="mx-auto mt-4 w-full max-w-5xl rounded-lg bg-[#2b2d31] p-4" aria-label="Métricas WebRTC">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase text-muted">Qualidade WebRTC</h2>
        <span className="text-[11px] text-faint">
          {metrics.sampledAt ? `Atualizado ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(metrics.sampledAt)}` : 'Aguardando amostra'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md bg-floating/60 px-3 py-2">
            <dt className="text-[11px] text-muted">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-header">{value}</dd>
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

function connectionToneClass(state: ConnectionUiState) {
  if (state === 'connected') return 'bg-success/15 text-success';
  if (state === 'reconnecting' || state === 'connecting' || state === 'loading') return 'bg-warning/15 text-warning';
  return 'bg-danger/15 text-danger';
}

function connectionTextClass(state: ConnectionUiState) {
  if (state === 'connected') return 'text-success';
  if (state === 'reconnecting' || state === 'connecting' || state === 'loading') return 'text-warning';
  return 'text-danger';
}
