import { create } from 'zustand';
import type { Track } from '../types';

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
};

let audio: HTMLAudioElement | null = null;
let listenersAttached = false;
let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'metadata';
    const stored = Number(localStorage.getItem('senro.volume'));
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
  });
  element.addEventListener('durationchange', () => {
    if (Number.isFinite(element.duration)) update({ duration: element.duration });
  });
  element.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(element.duration)) update({ duration: element.duration, loading: false });
  });
  element.addEventListener('play', () => update({ playing: true, error: null }));
  element.addEventListener('pause', () => update({ playing: false }));
  element.addEventListener('waiting', () => update({ loading: true }));
  element.addEventListener('canplay', () => update({ loading: false }));
  element.addEventListener('error', () => {
    update({
      playing: false,
      loading: false,
      error: 'Parça oynatılamadı. Dosyanın sunucuda erişilebilir olduğundan emin ol.',
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

  playTrack: (track, sourceTracks) => {
    attachAudioListeners();
    const queue = sourceTracks && sourceTracks.length > 0 ? sourceTracks : [track];
    const index = Math.max(0, queue.findIndex((item) => item.id === track.id));
    const element = getAudio();
    element.src = track.streamUrl;
    element.currentTime = 0;
    set({
      current: track,
      queue,
      index,
      playing: true,
      loading: true,
      currentTime: 0,
      duration: track.duration || 0,
      error: null,
    });
    playElement();
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
    attachAudioListeners();
    const element = getAudio();
    element.src = track.streamUrl;
    element.currentTime = 0;
    set({
      current: track,
      index,
      playing: true,
      loading: true,
      currentTime: 0,
      duration: track.duration || 0,
      error: null,
    });
    playElement();
  },

  toggle: () => {
    const element = getAudio();
    const { current, queue, index } = get();
    if (!current && queue.length > 0) {
      get().playAt(index);
      return;
    }
    if (!current) return;
    if (element.paused) {
      attachAudioListeners();
      playElement();
    } else {
      element.pause();
    }
  },

  play: () => {
    if (!get().current) return;
    attachAudioListeners();
    playElement();
  },

  pause: () => {
    getAudio().pause();
  },

  next: () => {
    const { queue, index, repeat } = get();
    if (queue.length === 0) return;
    let nextIndex = index + 1;
    if (nextIndex >= queue.length) nextIndex = repeat === 'all' ? 0 : queue.length - 1;
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
    if (Number.isFinite(target)) element.currentTime = target;
    set({ currentTime: target });
  },

  setVolume: (value) => {
    const element = getAudio();
    const volume = Math.max(0, Math.min(1, value));
    element.volume = volume;
    element.muted = volume === 0;
    localStorage.setItem('senro.volume', String(volume));
    set({ volume, muted: volume === 0 });
  },

  toggleMute: () => {
    const element = getAudio();
    const muted = !element.muted;
    element.muted = muted;
    set({ muted });
  },

  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),

  cycleRepeat: () =>
    set((state) => ({
      repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off',
    })),

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
      if (repeat === 'all') get().playAt(0);
      else set({ playing: false });
      return;
    }
    get().playAt(nextIndex);
  },
}));
