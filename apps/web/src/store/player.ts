import { create } from 'zustand';
import { api } from '../api';
import { destroyYouTubePlayer, youtubePause, youtubePlay, youtubeSeek, youtubeSetMuted, youtubeSetVolume } from '../lib/youtubeEngine';
import type { Track } from '../types';
import { useDownloads } from './downloads';

export type RepeatMode = 'off' | 'all' | 'one';
export type PlaybackProvider = 'local' | 'youtube';

export function isYouTubeTrack(track: Track | null | undefined): boolean {
  return Boolean(track && (track.id.startsWith('yt_') || track.streamUrl.startsWith('youtube:')));
}

type PlayerState = {
  provider: PlaybackProvider;
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

  playTrack: (track: Track, sourceTracks?: Track[]) => void;
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
  restoreSession: () => void;
};

let audio: HTMLAudioElement | null = null;
let listenersAttached = false;
let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;
let lastRecordedTrackId: string | null = null;
let lastSessionSave = 0;

const SESSION_KEY = 'Norie.player.session';
const GRACEFUL_NETWORK_MESSAGE = 'Bağlantı kesildi. Yerel dosya yoksa parça burada duraklatıldı.';

type SavedSession = {
  provider: PlaybackProvider;
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
    provider: state.provider,
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

async function startTrack(track: Track, startTime = 0): Promise<void> {
  attachAudioListeners();
  const element = getAudio();
  const source = await useDownloads
    .getState()
    .resolveSource(track)
    .catch(() => track.streamUrl);
  if (usePlayer.getState().current?.id !== track.id) return;
  element.src = source;
  if (Number.isFinite(startTime) && startTime > 0) {
    element.currentTime = startTime;
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
  });
  element.addEventListener('durationchange', () => {
    if (Number.isFinite(element.duration)) update({ duration: element.duration });
  });
  element.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(element.duration)) update({ duration: element.duration, loading: false });
  });
  element.addEventListener('play', () => update({ playing: true, error: null }));
  element.addEventListener('pause', () => {
    update({ playing: false });
    saveSession(usePlayer.getState());
  });
  element.addEventListener('waiting', () => update({ loading: true }));
  element.addEventListener('canplay', () => update({ loading: false }));
  element.addEventListener('error', () => {
    update({
      playing: false,
      loading: false,
      error: GRACEFUL_NETWORK_MESSAGE,
    });
  });
  element.addEventListener('ended', () => usePlayer.getState().handleEnded());
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
  provider: 'local',
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

  playTrack: (track, sourceTracks) => {
    const queue = sourceTracks && sourceTracks.length > 0 ? sourceTracks : [track];
    const index = Math.max(0, queue.findIndex((item) => item.id === track.id));
    const provider: PlaybackProvider = isYouTubeTrack(track) ? 'youtube' : 'local';
    const nextState = {
      provider,
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
    if (provider === 'local') void startTrack(track);
  },

  playQueue: (tracks, startIndex = 0) => {
    if (tracks.length === 0) return;
    const index = Math.max(0, Math.min(startIndex, tracks.length - 1));
    get().playTrack(tracks[index], tracks);
  },

  playAt: (index) => {
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    const provider: PlaybackProvider = isYouTubeTrack(track) ? 'youtube' : 'local';
    const nextState = {
      provider,
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
    if (provider === 'local') void startTrack(track);
  },

  toggle: () => {
    const element = getAudio();
    const { current, queue, index, currentTime, playing, provider } = get();
    if (!current && queue.length > 0) {
      get().playAt(index);
      return;
    }
    if (!current) return;
    if (provider === 'youtube') {
      if (playing) youtubePause();
      else youtubePlay();
      saveSession(get());
      return;
    }
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
    const { current, provider } = get();
    if (!current) return;
    if (provider === 'youtube') {
      youtubePlay();
      return;
    }
    attachAudioListeners();
    playElement();
  },

  pause: () => {
    if (get().provider === 'youtube') youtubePause();
    else getAudio().pause();
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
    const { provider, currentTime: stateTime, duration: stateDuration } = get();
    if (provider === 'youtube') {
      const target = Math.max(0, Math.min(time, stateDuration || 0));
      youtubeSeek(target);
      set({ currentTime: target });
      return;
    }
    const element = getAudio();
    const duration = Number.isFinite(element.duration) ? element.duration : get().duration;
    const target = Math.max(0, Math.min(time, duration || 0));
    if (Number.isFinite(target)) element.currentTime = target;
    set({ currentTime: target ?? stateTime });
  },

  setVolume: (value) => {
    const element = getAudio();
    const volume = Math.max(0, Math.min(1, value));
    element.volume = volume;
    element.muted = volume === 0;
    youtubeSetVolume(volume);
    localStorage.setItem('Norie.volume', String(volume));
    set({ volume, muted: volume === 0 });
    saveSession(get());
  },

  toggleMute: () => {
    const element = getAudio();
    const muted = !element.muted;
    element.muted = muted;
    youtubeSetMuted(muted);
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
    destroyYouTubePlayer();
    set({
      provider: 'local',
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
    const { repeat } = get();
    if (repeat === 'one') {
      get().seek(0);
      playElement();
      return;
    }
    const { queue, index, shuffle } = get();
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

  restoreSession: () => {
    const saved = loadSession();
    if (!saved?.current) return;
    const queue = Array.isArray(saved.queue) && saved.queue.length > 0 ? saved.queue : [saved.current];
    const index = Math.max(0, Math.min(saved.index ?? 0, queue.length - 1));
    const provider = saved.provider ?? (isYouTubeTrack(saved.current) ? 'youtube' : 'local');
    set({
      provider,
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
    if (provider !== 'local') return;
    void useDownloads
      .getState()
      .resolveSource(saved.current)
      .then((url) => {
        if (get().current?.id !== saved.current?.id) return;
        element.src = url;
        if (Number.isFinite(saved.currentTime) && saved.currentTime > 0) {
          element.currentTime = saved.currentTime;
        }
      })
      .catch(() => undefined);
  },
}));
