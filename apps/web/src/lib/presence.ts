import { api } from '../api';
import { getServerUrl } from './serverUrl';
import type { PresenceEvent, RealtimeEvent, Track } from '../types';

/**
 * Client side of presence.
 *
 * Each browser tab owns a session id (sessionStorage), so ten tabs are ten
 * sessions that all keep the user online, and closing one does not log them out.
 * Heartbeats are cheap REST calls; live updates arrive over SSE.
 */

const SESSION_KEY = 'Norie.presence.session';
const HEARTBEAT_MS = 25_000;
const POSITION_STEP = 15;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function presenceSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = randomId();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    // Private mode without sessionStorage: an in-memory id still works.
    return randomId();
  }
}

let sessionId = '';
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastActivityKey = '';
let lastPositionSentAt = 0;
let lastReportedAt = 0;
let away = false;

function beat(): void {
  void api.presenceHeartbeat(sessionId, away).catch(() => undefined);
}

export function setPresenceAway(next: boolean): void {
  if (away === next) return;
  away = next;
  beat();
}

/** Starts heartbeats + visibility tracking. Returns the cleanup. */
export function startPresence(): () => void {
  sessionId = presenceSessionId();
  away = false;
  beat();
  heartbeatTimer = setInterval(beat, HEARTBEAT_MS);

  const onVisibility = () => setPresenceAway(document.visibilityState === 'hidden');
  const onPageHide = () => {
    // Keepalive beacon: works even when the page is being torn down.
    try {
      const url = `${getServerUrl()}/api/presence/offline`;
      const body = new Blob([JSON.stringify({ sessionId })], { type: 'application/json' });
      navigator.sendBeacon?.(url, body);
    } catch {
      // best effort
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    void api.presenceOffline(sessionId).catch(() => undefined);
  };
}

/**
 * Reports what is actually playing. Only real player events reach this: a track
 * change, a play/pause, or a meaningful position jump.
 */
export function reportPlayback(track: Track | null, playing: boolean, position: number): void {
  if (!sessionId) return;
  const key = track ? `${track.id}:${playing ? 'play' : 'pause'}` : 'idle';
  const moved = Math.abs(position - lastReportedAt) >= POSITION_STEP;
  const changed = key !== lastActivityKey;
  if (!changed && !moved) return;
  if (changed && position < 1) lastPositionSentAt = Date.now();
  if (!changed && Date.now() - lastPositionSentAt < 5_000) return;
  lastActivityKey = key;
  lastPositionSentAt = Date.now();
  lastReportedAt = position;

  if (!track) {
    void api.presenceActivity(sessionId, null).catch(() => undefined);
    return;
  }
  void api
    .presenceActivity(sessionId, {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album ?? null,
      coverUrl: track.coverUrl ?? null,
      source: track.format ?? null,
      duration: track.duration ?? null,
      position: Math.max(0, Math.round(position)),
      playing,
    })
    .catch(() => undefined);
}

export type PresenceListener = (event: PresenceEvent) => void;
export type RealtimeListener = (event: RealtimeEvent) => void;

/**
 * One EventSource per tab, shared by every consumer.
 *
 * Presence, profile cards and the message panel all read from the same stream —
 * opening a second subscription would double every event and burn the server's
 * six-connection budget. The socket opens with the first subscriber and closes
 * with the last one; EventSource handles reconnects itself.
 */
const listeners = new Set<RealtimeListener>();
let stream: EventSource | null = null;

const REALTIME_TYPES = [
  'presence',
  'activity',
  'message',
  'message_update',
  'typing',
  'read',
  'room_state',
  'room_members',
  'room_chat',
  'room_invite',
  'room_closed',
  'quiz_party',
] as const;

function ensureStream(): void {
  if (stream || typeof EventSource === 'undefined') return;
  const source = new EventSource(`${getServerUrl()}/api/presence/stream`, { withCredentials: true });
  stream = source;
  for (const type of REALTIME_TYPES) {
    source.addEventListener(type, (event) => {
      const message = event as MessageEvent<string>;
      let payload: RealtimeEvent;
      try {
        payload = JSON.parse(message.data) as RealtimeEvent;
      } catch {
        return;
      }
      if (!payload || typeof payload.type !== 'string') return;
      for (const listener of [...listeners]) {
        try {
          listener(payload);
        } catch {
          // A broken consumer must not kill the stream for the others.
        }
      }
    });
  }
}

export function subscribeRealtime(listener: RealtimeListener): () => void {
  listeners.add(listener);
  ensureStream();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stream) {
      stream.close();
      stream = null;
    }
  };
}

/** Presence-only view of the shared stream. */
export function subscribePresence(listener: PresenceListener): () => void {
  return subscribeRealtime((event) => {
    if (event.type === 'presence' || event.type === 'activity') listener(event);
  });
}
