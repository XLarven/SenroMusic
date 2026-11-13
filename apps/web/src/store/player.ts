import { create } from 'zustand';
import { api } from '../api';
import { mediaUrl, warmTrack } from '../lib/media';
import type { Track } from '../types';
import { useDownloads } from './downloads';

export type RepeatMode = 'off' | 'all' | 'one';

type PlayerState = {
  current: Track | null;
  queue: Track[];
  index: number;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  queueOpen: boolean;
  error: string | null;
  sleepTimer: number | null;
  roomMode: boolean;
  /** True when this tab owns the listening-room timeline. */
  roomControl: boolean;

  playTrack: (track: Track, sourceTracks?: Track[]) => void;
  playFrom: (track: Track, startTime: number, sourceTracks?: Track[]) => void;
  playQueue: (tracks: Track[], startIndex?: number) => void;
  playAt: (index: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setQueueOpen: (open: boolean) => void;
  setSleepTimer: (minutes: number | null) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  handleEnded: () => void;
  prefetchRelated: () => void;
  retryCurrent: () => void;
  setRoomMode: (active: boolean) => void;
  restoreSession: () => void;
};

let audio: HTMLAudioElement | null = null;
let listenersAttached = false;
let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;
let lastRecordedTrackId: string | null = null;
let lastSessionSave = 0;
/** Tracks that already burned their one automatic stream retry. */
const failedRetries = new Set<string>();

const SESSION_KEY = 'Norie.player.session';
const GRACEFUL_NETWORK_MESSAGE = 'Bağlantı kesildi. Yerel dosya yoksa parça burada duraklatıldı.';
const SOURCE_UNAVAILABLE_MESSAGE = 'Bu parça için ses kaynağı bulunamadı. Sonraki parçaya geçebilirsin.';
/** No metadata within this window means the stream never started. */
const LOAD_WATCHDOG_MS = 18_000;

let loadWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearLoadWatchdog(): void {
  if (loadWatchdog) {
    clearTimeout(loadWatchdog);
    loadWatchdog = null;
  }
}

/**
 * A resolved stream that never reaches `canplay` would otherwise spin forever.
 * One fresh resolution is attempted (server side cache bypassed), then the track
 * reports a real error so the queue can move on.
 */
function armLoadWatchdog(track: Track): void {
  clearLoadWatchdog();
  loadWatchdog = setTimeout(() => {
    loadWatchdog = null;
    const state = usePlayer.getState();
    if (state.current?.id !== track.id || !state.loading) return;
    const element = getAudio();
    if (element.readyState >= 2) {
      usePlayer.setState({ loading: false });
      return;
    }
    if (!failedRetries.has(track.id)) {
      failedRetries.add(track.id);
      void startTrack(track, state.currentTime, true);
      return;
    }
    usePlayer.setState({ playing: false, loading: false, error: SOURCE_UNAVAILABLE_MESSAGE });
  }, LOAD_WATCHDOG_MS);
}

/** Adds a cache-bypass marker so a retry cannot be answered by the same URL. */
function withFresh(source: string): string {
  if (!source.startsWith('/api/')) return source;
  return `${source}${source.includes('?') ? '&' : '?'}fresh=${Date.now()}`;
}

type SavedSession = {
  current: Track | null;
  queue: Track[];
  index: number;
  currentTime: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
};

function saveSession(state: PlayerState): void {
  if (!state.current) {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
    return;
  }
  const payload: SavedSession = {
    current: state.current,
    queue: state.queue,
    index: state.index,
    currentTime: state.currentTime,
    shuffle: state.shuffle,
    repeat: state.repeat,
    volume: state.volume,
    muted: state.muted,
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch { /* private mode */ }
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!parsed.current || !Array.isArray(parsed.queue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function startTrack(track: Track, startTime = 0, forceFresh = false): Promise<void> {
  attachAudioListeners();
  const element = getAudio();
  // Downloaded tracks play from their stored blob; everything else is streamed
  // through the backend resolver, which proxies whatever provider answers.
  const isDownloaded = useDownloads.getState().records[track.id]?.state === 'downloaded';
  const resolved = isDownloaded
    ? await useDownloads
        .getState()
        .resolveSource(track)
        .catch(() => mediaUrl(track))
    : mediaUrl(track);
  if (usePlayer.getState().current?.id !== track.id) return;
  const source = forceFresh ? withFresh(resolved) : resolved;
  element.src = source;
  armLoadWatchdog(track);
  if (Number.isFinite(startTime) && startTime > 0) {
    // `currentTime` is only writable once the element knows its duration.
    const applySeek = () => {
      element.removeEventListener('loadedmetadata', applySeek);
      try {
        element.currentTime = startTime;
      } catch {
        // Seeking before metadata is a no-op, not a playback failure.
      }
    };
    if (element.readyState >= 1) applySeek();
    else element.addEventListener('loadedmetadata', applySeek);
  }
  playElement();
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'metadata';
    const stored = Number(localStorage.getItem('Norie.volume'));
    audio.volume = Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.8;
  }
  return audio;
}

function attachAudioListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  const element = getAudio();
  const update = usePlayer.setState;

  element.addEventListener('timeupdate', () => {
    update({ currentTime: element.currentTime });
    const state = usePlayer.getState();
    const stamp = Date.now();
    if (state.current && stamp - lastSessionSave > 5000) {
      lastSessionSave = stamp;
      saveSession(state);
    }
    if (state.current && element.currentTime >= 3 && lastRecordedTrackId !== state.current.id) {
      if (localStorage.getItem('Norie.historyEnabled') === 'false') return;
      lastRecordedTrackId = state.current.id;
      const source =
        useDownloads.getState().records[state.current.id]?.state === 'downloaded'
          ? 'download'
          : 'stream';
      void api
        .recordPlay(state.current.id, Math.round(element.currentTime * 1000), source)
        .catch(() => undefined);
    }
    // Rolling autoplay: queue the next related track before this one ends.
    if (
      Number.isFinite(element.duration) &&
      element.duration > 0 &&
      element.duration - element.currentTime < 25 &&
      state.playing
    ) {
      usePlayer.getState().prefetchRelated();
    }
  });
  element.addEventListener('durationchange', () => {
    if (Number.isFinite(element.duration)) update({ duration: element.duration });
  });
  element.addEventListener('loadedmetadata', () => {
    clearLoadWatchdog();
    if (Number.isFinite(element.duration)) update({ duration: element.duration, loading: false });
  });
  element.addEventListener('play', () => {
    update({ playing: true, error: null });
    warmUpcoming(usePlayer.getState());
  });
  element.addEventListener('pause', () => {
    update({ playing: false });
    saveSession(usePlayer.getState());
  });
  element.addEventListener('waiting', () => update({ loading: true }));
  element.addEventListener('canplay', () => {
    clearLoadWatchdog();
    update({ loading: false });
  });
  element.addEventListener('error', () => {
    clearLoadWatchdog();
    const state = usePlayer.getState();
    const code = element.error?.code;
    // MEDIA_ERR_SRC_NOT_SUPPORTED on a remote track usually means the proxied
    // stream never started. One retry with a fresh resolution is worth it; a
    // second failure is a genuinely dead track and gets reported.
    if (code === 4 && state.current && !failedRetries.has(state.current.id)) {
      failedRetries.add(state.current.id);
      const track = state.current;
      const time = state.currentTime;
      setTimeout(() => {
        if (usePlayer.getState().current?.id !== track.id) return;
        void startTrack(track, time, true);
      }, 600);
      return;
    }
    update({
      playing: false,
      loading: false,
      error: code === 4 ? SOURCE_UNAVAILABLE_MESSAGE : GRACEFUL_NETWORK_MESSAGE,
    });
  });
  element.addEventListener('ended', () => usePlayer.getState().handleEnded());
}

function warmUpcoming(state: PlayerState): void {
  const next = state.queue[state.index + 1];
  if (!next) return;
  warmTrack(next);
}

function playElement(): void {
  const element = getAudio();
  void element.play().catch((error: unknown) => {
    const message =
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Tarayıcı otomatik oynatmayı engelledi. Oynat düğmesine tekrar bas.'
        : 'Parça başlatılamadı.';
    usePlayer.setState({ playing: false, loading: false, error: message });
  });
}

// Autoplay support: when the queue runs out, ask the server for songs similar to
// the last track and append them. Guards against repeats and failure loops.
let autoplayInFlight = false;
/** Prefetch bookkeeping: one request per track, and a hard stop after success. */
let prefetchingFor: string | null = null;
let lastPrefetchedFor: string | null = null;

async function extendWithSimilar(get: () => PlayerState): Promise<void> {
  if (autoplayInFlight) return;
  const { current, queue } = get();
  if (!current) {
    usePlayer.setState({ playing: false });
    return;
  }
  autoplayInFlight = true;
  usePlayer.setState({ loading: true });
  try {
    const exclude = current.id.startsWith('yt_') ? current.id.slice(3) : '';
    const payload = await api.youtubeSimilar({
      title: current.title,
      artist: current.artist,
      exclude,
      limit: 8,
    });
    const existing = new Set(queue.map((t) => t.id));
    const additions: Track[] = (payload.results ?? [])
      .filter((item) => item.id && !existing.has(`yt_${item.id}`))
      .map((item) => ({
        id: `yt_${item.id}`,
        title: item.title,
        artist: item.artist,
        album: 'YouTube',
        albumArtist: item.artist,
        genre: null,
        year: null,
        trackNo: null,
        discNo: null,
        duration: item.duration ?? 0,
        bitrate: null,
        sampleRate: null,
        channels: null,
        format: 'youtube',
        size: 0,
        coverUrl: item.thumbnail,
        streamUrl: `youtube:${item.id}`,
        addedAt: new Date().toISOString(),
      }));
    if (additions.length === 0) {
      usePlayer.setState({ playing: false, loading: false });
      return;
    }
    usePlayer.setState({ queue: [...queue, ...additions] });
    get().playAt(queue.length);
  } catch {
    usePlayer.setState({ playing: false, loading: false });
  } finally {
    autoplayInFlight = false;
  }
}

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  queue: [],
  index: 0,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: getAudio().volume,
  muted: false,
  shuffle: false,
  repeat: 'off',
  queueOpen: false,
  error: null,
  sleepTimer: null,
  roomMode: false,
  roomControl: false,

  playTrack: (track, sourceTracks) => {
    const queue = sourceTracks && sourceTracks.length > 0 ? sourceTracks : [track];
    const index = Math.max(0, queue.findIndex((item) => item.id === track.id));
    const nextState = {
      current: track,
      queue,
      index,
      playing: true,
      loading: true,
      currentTime: 0,
      duration: track.duration || 0,
      error: null,
    };
    set(nextState);
    saveSession({ ...get(), ...nextState });
    void startTrack(track);
  },

  playQueue: (tracks, startIndex = 0) => {
    if (tracks.length === 0) return;
    const index = Math.max(0, Math.min(startIndex, tracks.length - 1));
    get().playTrack(tracks[index], tracks);
  },

  playFrom: (track, startTime, sourceTracks) => {
    // Room playback: same pipeline as playTrack, but the element starts at the
    // room's timeline position instead of 0.
    const queue = sourceTracks && sourceTracks.length > 0 ? sourceTracks : [track];
    const index = Math.max(0, queue.findIndex((item) => item.id === track.id));
    const nextState = {
      current: track,
      queue,
      index,
      playing: true,
      loading: true,
      currentTime: Math.max(0, startTime),
      duration: track.duration || 0,
      error: null,
    };
    set(nextState);
    saveSession({ ...get(), ...nextState });
    void startTrack(track, Math.max(0, startTime));
  },

  playAt: (index) => {
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    const nextState = {
      current: track,
      index,
      playing: true,
      loading: true,
      currentTime: 0,
      duration: track.duration || 0,
      error: null,
    };
    set(nextState);
    saveSession({ ...get(), ...nextState });
    void startTrack(track);
  },

  toggle: () => {
    const element = getAudio();
    const { current, queue, index, currentTime } = get();
    if (!current && queue.length > 0) {
      get().playAt(index);
      return;
    }
    if (!current) return;
    // The element keeps its source across pause/play, so a stopped track only
    // needs a fresh resolve when it never got one in the first place.
    if (!element.currentSrc) {
      void startTrack(current, currentTime);
      return;
    }
    if (element.paused) {
      attachAudioListeners();
      playElement();
    } else {
      element.pause();
    }
    saveSession(get());
  },

  play: () => {
    const { current, currentTime } = get();
    if (!current) return;
    if (!getAudio().currentSrc) {
      void startTrack(current, currentTime);
      return;
    }
    attachAudioListeners();
    playElement();
  },

  pause: () => {
    getAudio().pause();
  },

  next: () => {
    const { queue, index, repeat, shuffle } = get();
    if (queue.length === 0) return;
    let nextIndex = index + 1;
    if (shuffle && queue.length > 1) {
      while (nextIndex === index) nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      nextIndex = repeat === 'all' ? 0 : queue.length - 1;
    }
    if (nextIndex === index && repeat !== 'all') {
      get().seek(getAudio().duration || get().duration);
      get().pause();
      return;
    }
    get().playAt(nextIndex);
  },

  previous: () => {
    const { currentTime, queue, index } = get();
    if (currentTime > 3 || queue.length === 0) {
      get().seek(0);
      return;
    }
    const previousIndex = index - 1 < 0 ? 0 : index - 1;
    get().playAt(previousIndex);
  },

  seek: (time) => {
    const element = getAudio();
    const duration = Number.isFinite(element.duration) ? element.duration : get().duration;
    const target = Math.max(0, Math.min(time, duration || 0));
    if (Number.isFinite(target) && element.readyState >= 1) element.currentTime = target;
    set({ currentTime: target });
  },

  setVolume: (value) => {
    const element = getAudio();
    const volume = Math.max(0, Math.min(1, value));
    element.volume = volume;
    element.muted = volume === 0;
    localStorage.setItem('Norie.volume', String(volume));
    set({ volume, muted: volume === 0 });
    saveSession(get());
  },

  toggleMute: () => {
    const element = getAudio();
    const muted = !element.muted;
    element.muted = muted;
    set({ muted });
    saveSession(get());
  },

  toggleShuffle: () => {
    set((state) => ({ shuffle: !state.shuffle }));
    saveSession(get());
  },

  cycleRepeat: () => {
    set((state) => ({
      repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off',
    }));
    saveSession(get());
  },

  setQueueOpen: (open) => set({ queueOpen: open }),

  setSleepTimer: (minutes) => {
    if (sleepTimerHandle) {
      clearTimeout(sleepTimerHandle);
      sleepTimerHandle = null;
    }
    if (minutes === null) {
      set({ sleepTimer: null });
      return;
    }
    const ms = Math.max(1, minutes) * 60 * 1000;
    sleepTimerHandle = setTimeout(() => {
      const element = getAudio();
      element.pause();
      usePlayer.setState({ playing: false, sleepTimer: null });
      sleepTimerHandle = null;
    }, ms);
    set({ sleepTimer: minutes });
  },

  removeFromQueue: (index) => {
    const { queue, index: currentIndex } = get();
    if (index < 0 || index >= queue.length) return;
    const nextQueue = queue.filter((_, itemIndex) => itemIndex !== index);
    if (nextQueue.length === 0) {
      get().clearQueue();
      return;
    }
    if (index === currentIndex) {
      const nextIndex = Math.min(index, nextQueue.length - 1);
      set({ queue: nextQueue, index: nextIndex });
      get().playAt(nextIndex);
      return;
    }
    set({
      queue: nextQueue,
      index: index < currentIndex ? currentIndex - 1 : currentIndex,
    });
    saveSession(get());
  },

  clearQueue: () => {
    const element = getAudio();
    element.pause();
    element.removeAttribute('src');
    element.load();
    set({
      current: null,
      queue: [],
      index: 0,
      playing: false,
      loading: false,
      currentTime: 0,
      duration: 0,
      error: null,
    });
    saveSession(get());
  },

  handleEnded: () => {
    const { repeat, roomMode, roomControl, queue, index, shuffle } = get();
    // A listening-room listener never advances on its own: the room timeline
    // decides the next track, and a local advance here made the last track
    // restart over and over on every listener.
    if (roomMode && !roomControl) return;
    if (roomMode && roomControl) {
      // The controller promotes the room queue; repeat modes stay out of it.
      if (queue.length === 0) return;
      const nextIndex = shuffle && queue.length > 1
        ? (() => {
            let candidate = index;
            while (candidate === index) candidate = Math.floor(Math.random() * queue.length);
            return candidate;
          })()
        : index + 1;
      if (nextIndex >= queue.length) {
        set({ playing: false });
        return;
      }
      get().playAt(nextIndex);
      return;
    }
    if (repeat === 'one') {
      get().seek(0);
      playElement();
      return;
    }
    if (queue.length === 0) return;
    if (shuffle && queue.length > 1) {
      let nextIndex = index;
      while (nextIndex === index) nextIndex = Math.floor(Math.random() * queue.length);
      get().playAt(nextIndex);
      return;
    }
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (repeat === 'all') {
        get().playAt(0);
        return;
      }
      // Autoplay: last track in the queue ended — extend the queue with related
      // songs so playback continues. Opt-in via localStorage flag.
      if (localStorage.getItem('Norie.autoplay') === 'true') {
        void extendWithSimilar(get);
        return;
      }
      set({ playing: false });
      return;
    }
    get().playAt(nextIndex);
  },

  /**
   * Rolling recommendations: while the last queued track is still playing, ask the
   * server for similar real tracks and append them. Never touches the current
   * track, never runs in a listening room, and stops when playback stops.
   */
  prefetchRelated: () => {
    const state = get();
    if (state.roomMode) return;
    if (!state.current || !state.playing) return;
    if (state.repeat === 'one') return;
    if (localStorage.getItem('Norie.autoplay') !== 'true') return;
    // Only when the queue has nothing else waiting.
    if (state.index < state.queue.length - 1) return;
    if (prefetchingFor === state.current.id || lastPrefetchedFor === state.current.id) return;

    const seed = state.current;
    prefetchingFor = seed.id;
    const exclude = seed.id.startsWith('yt_') ? seed.id.slice(3) : undefined;
    void api
      .discoverySimilar({ title: seed.title, artist: seed.artist, exclude, limit: 5 })
      .then((payload) => {
        const current = usePlayer.getState();
        if (current.current?.id !== seed.id) return;
        const existing = new Set(current.queue.map((track) => track.id));
        const additions: Track[] = (payload.items ?? [])
          .filter((item) => item.id && !existing.has(item.id))
          .map((item) => {
            const videoId = item.id.startsWith('yt_') ? item.id.slice(3) : item.id;
            return {
              id: item.id,
              title: item.title,
              artist: item.artist,
              album: 'YouTube',
              albumArtist: item.artist,
              genre: null,
              year: null,
              trackNo: null,
              discNo: null,
              duration: item.duration ?? 0,
              bitrate: null,
              sampleRate: null,
              channels: null,
              format: 'youtube',
              size: 0,
              coverUrl: item.thumbnail,
              streamUrl: `youtube:${videoId}`,
              addedAt: new Date().toISOString(),
            };
          });
        if (additions.length === 0) return;
        usePlayer.setState({ queue: [...current.queue, ...additions] });
        lastPrefetchedFor = seed.id;
      })
      .catch(() => undefined)
      .finally(() => {
        prefetchingFor = null;
      });
  },

  /** Retry the current track with a fresh resolution (cache bypassed). */
  retryCurrent: () => {
    const { current, currentTime } = get();
    if (!current) return;
    failedRetries.delete(current.id);
    set({ loading: true, error: null, playing: true });
    void startTrack(current, currentTime, true);
  },

  setRoomMode: (active) => set({ roomMode: active, roomControl: active ? get().roomControl : false }),

  restoreSession: () => {
    const saved = loadSession();
    if (!saved?.current) return;
    const queue = Array.isArray(saved.queue) && saved.queue.length > 0 ? saved.queue : [saved.current];
    const index = Math.max(0, Math.min(saved.index ?? 0, queue.length - 1));
    set({
      current: saved.current,
      queue,
      index,
      playing: false,
      loading: false,
      currentTime: saved.currentTime ?? 0,
      duration: saved.current.duration || 0,
      shuffle: Boolean(saved.shuffle),
      repeat: saved.repeat ?? 'off',
      volume: saved.volume ?? getAudio().volume,
      muted: Boolean(saved.muted),
      error: null,
    });
    const element = getAudio();
    element.volume = saved.volume ?? element.volume;
    element.muted = Boolean(saved.muted);
    // Restore the source only, never autoplay: the page has no user gesture yet.
    const track = saved.current;
    const isDownloaded = useDownloads.getState().records[track.id]?.state === 'downloaded';
    const attachSource = (src: string) => {
      if (get().current?.id !== track.id) return;
      element.src = src;
      if (Number.isFinite(saved.currentTime) && saved.currentTime > 0) {
        const applySeek = () => {
          element.removeEventListener('loadedmetadata', applySeek);
          try {
            element.currentTime = saved.currentTime;
          } catch {
            // A stale position is not a failure.
          }
        };
        element.addEventListener('loadedmetadata', applySeek);
      }
    };
    if (isDownloaded) {
      void useDownloads
        .getState()
        .resolveSource(track)
        .then(attachSource)
        .catch(() => attachSource(mediaUrl(track)));
    } else {
      attachSource(mediaUrl(track));
    }
  },
}));
