import { api } from '../api';
import { usePlayer } from '../store/player';
import { shareToTrack } from './presenceTrack';
import type { RoomDetail, RoomState, RoomTrack, Track } from '../types';

/**
 * Room playback bridge.
 *
 * The room owns the timeline; the global player is only a renderer for it.
 * Controllers push their real player state up (track change, play/pause, seek),
 * listeners extrapolate the position locally and only correct real drift.
 *
 * Nothing here streams seconds between users: a single revisioned state plus a
 * clock offset is enough, and reconnects simply refetch the same state.
 */

const TICK_MS = 1_000;
const LISTENER_DRIFT_MS = 2_500;

type Session = {
  roomId: string;
  state: RoomState;
  canControl: boolean;
  offsetMs: number;
};

let session: Session | null = null;
let timer: number | null = null;
let pushing = false;
/** Revision the controller still has to mirror locally (e.g. a server 'next'). */
let pendingRevision: number | null = null;
/** No controller pushes right after a server-driven change; the element needs a beat. */
let suppressUntil = 0;
/** Last observed player position, used to spot a real seek by the controller. */
let lastHostPosition = 0;

export function roomTrackToTrack(track: RoomTrack): Track {
  return shareToTrack({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverUrl: track.coverUrl,
    source: track.source,
    duration: track.duration,
  });
}

export function trackToRoomTrack(track: Track): RoomTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album || null,
    coverUrl: track.coverUrl,
    source: track.format ?? null,
    duration: track.duration ?? null,
  };
}

export function expectedPosition(state: RoomState, offsetMs: number): number {
  if (!state.playing) return state.position;
  const elapsed = (Date.now() + offsetMs - Date.parse(state.updatedAt)) / 1000;
  const duration = state.current?.track.duration ?? null;
  const value = state.position + Math.max(0, elapsed);
  return duration && duration > 0 ? Math.min(value, duration) : value;
}

function roomQueue(state: RoomState): Track[] {
  const items = state.current ? [state.current, ...state.queue] : state.queue;
  return items.map((item) => roomTrackToTrack(item.track));
}

function applyState(state: RoomState, offsetMs: number): void {
  const player = usePlayer.getState();
  // Video mode: the room watches the official embed instead of the audio
  // element, so local audio must stay silent.
  if (state.videoMode) {
    if (player.playing) player.pause();
    return;
  }
  if (!state.current) {
    if (player.current) player.clearQueue();
    return;
  }
  const track = roomTrackToTrack(state.current.track);
  const position = expectedPosition(state, offsetMs);
  if (!player.current || player.current.id !== track.id) {
    player.playFrom(track, position, roomQueue(state));
    if (!state.playing) usePlayer.getState().pause();
    return;
  }
  if (!state.playing && player.playing) player.pause();
  if (state.playing && !player.playing) player.play();
  if (Math.abs(player.currentTime - position) > LISTENER_DRIFT_MS / 1000) player.seek(position);
}

async function push(payload: Parameters<typeof api.roomPlayback>[1]): Promise<void> {
  if (!session || pushing) return;
  pushing = true;
  const roomId = session.roomId;
  try {
    const result = await api.roomPlayback(roomId, payload);
    if (session && session.roomId === roomId) {
      session.state = result.state;
      session.offsetMs = Date.parse(result.serverNow) - Date.now();
    }
  } catch {
    // The next tick retries; SSE keeps listeners honest meanwhile.
  } finally {
    pushing = false;
  }
}

function tick(): void {
  if (!session) return;
  const { state, canControl, offsetMs } = session;
  // Video sessions are driven by the embedded player, not the audio element.
  if (state.videoMode) return;
  if (!state.current) return;
  const player = usePlayer.getState();
  const targetId = state.current.track.id;
  const expected = expectedPosition(state, offsetMs);

  if (canControl) {
    if (pushing || !player.current) return;
    if (Date.now() < suppressUntil) return;
    // A server-driven change (skip, queue promotion, another moderator) is
    // applied locally instead of being pushed back as if the host had chosen it.
    if (pendingRevision === state.revision) {
      pendingRevision = null;
      applyState(state, offsetMs);
      lastHostPosition = usePlayer.getState().currentTime;
      return;
    }
    if (player.current.id !== targetId) {
      const upcoming = state.queue[0]?.track.id ?? null;
      if (upcoming && player.current.id === upcoming) void push({ action: 'next' });
      else void push({ action: 'play-track', track: trackToRoomTrack(player.current) });
      return;
    }
    if (player.playing !== state.playing) {
      void push({ action: state.playing ? 'play' : 'pause', position: player.currentTime });
      lastHostPosition = player.currentTime;
      return;
    }
    if (player.loading) {
      // The element is still resolving; a position here says nothing.
      lastHostPosition = player.currentTime;
      return;
    }
    // The controller's own clock is authoritative, so only a genuine jump counts
    // as a seek; playing slightly behind the extrapolated timeline catches up
    // locally instead of dragging every listener back.
    const delta = player.currentTime - lastHostPosition;
    lastHostPosition = player.currentTime;
    if (player.currentTime + 1.5 < expected) {
      player.seek(expected);
      lastHostPosition = expected;
      return;
    }
    if (Math.abs(delta) > 2.5) {
      void push({ action: 'seek', position: player.currentTime });
    }
    return;
  }

  if (!player.current || player.current.id !== targetId) {
    applyState(state, offsetMs);
    return;
  }
  // The track already reached its end locally. Playing again here would restart
  // the same song on every tick until the room promotes the next one.
  if (player.duration > 0 && player.currentTime >= player.duration - 0.75 && !player.loading) return;
  if (state.playing && !player.playing) player.play();
  else if (!state.playing && player.playing) player.pause();
  else if (state.playing && !player.loading && Math.abs(player.currentTime - expected) > LISTENER_DRIFT_MS / 1000) {
    player.seek(expected);
  }
}

function startTimer(): void {
  if (timer !== null) return;
  timer = window.setInterval(tick, TICK_MS);
}

function stopTimer(): void {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
}

/** Called when the room detail arrives (initial load, join, reconnect). */
export function beginRoomSync(detail: RoomDetail): void {
  const offsetMs = Date.parse(detail.serverNow) - Date.now();
  session = {
    roomId: detail.room.id,
    state: detail.state,
    canControl: detail.canControl,
    offsetMs,
  };
  applyState(detail.state, offsetMs);
  lastHostPosition = usePlayer.getState().currentTime;
  suppressUntil = Date.now() + 1_500;
  usePlayer.setState({ roomControl: detail.canControl });
  startTimer();
}

/** Fresh state from SSE or an API response while the room is open. */
export function updateRoomSync(state: RoomState, serverNow?: string): void {
  if (!session) return;
  if (serverNow) session.offsetMs = Date.parse(serverNow) - Date.now();
  const previousRevision = session.state.revision;
  session.state = state;
  if (state.revision !== previousRevision) {
    pendingRevision = state.revision;
    suppressUntil = Date.now() + 1_500;
    applyState(state, session.offsetMs);
    lastHostPosition = usePlayer.getState().currentTime;
  }
}

export function setRoomControl(canControl: boolean): void {
  if (session) session.canControl = canControl;
  usePlayer.setState({ roomControl: canControl });
}

export function endRoomSync(): void {
  session = null;
  stopTimer();
}

export function activeRoomId(): string | null {
  return session?.roomId ?? null;
}

export function isRoomController(): boolean {
  return Boolean(session?.canControl);
}
