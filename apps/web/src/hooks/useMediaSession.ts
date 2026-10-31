import { useEffect } from 'react';
import { usePlayer } from '../store/player';

type SenroMediaBridge = {
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
};

declare global {
  interface Window {
    senroMedia?: SenroMediaBridge;
  }
}

export function useMediaSession(): void {
  const current = usePlayer((state) => state.current);
  const playing = usePlayer((state) => state.playing);

  useEffect(() => {
    window.senroMedia = {
      toggle: () => usePlayer.getState().toggle(),
      play: () => usePlayer.getState().play(),
      pause: () => usePlayer.getState().pause(),
      next: () => usePlayer.getState().next(),
      previous: () => usePlayer.getState().previous(),
    };
    return () => {
      delete window.senroMedia;
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork = current.coverUrl
      ? [{ src: new URL(current.coverUrl, window.location.origin).href }]
      : undefined;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork,
    });

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => usePlayer.getState().play()],
      ['pause', () => usePlayer.getState().pause()],
      ['previoustrack', () => usePlayer.getState().previous()],
      ['nexttrack', () => usePlayer.getState().next()],
      ['seekbackward', () => usePlayer.getState().seek(usePlayer.getState().currentTime - 10)],
      ['seekforward', () => usePlayer.getState().seek(usePlayer.getState().currentTime + 10)],
      ['seekto', (details) => usePlayer.getState().seek(details.seekTime ?? 0)],
      ['stop', () => usePlayer.getState().clearQueue()],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported actions are ignored by the browser.
      }
    }
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [current, playing]);
}
