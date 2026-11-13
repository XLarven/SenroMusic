import { useEffect, useRef, useState } from 'react';

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  getCurrentTime: () => number;
  destroy: () => void;
  getPlayerState: () => number;
};

type YTNamespace = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; BUFFERING: number; ENDED: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the official IFrame Player API exactly once per tab. */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const existing = document.querySelector('script[data-yt-iframe-api]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ytIframeApi = 'true';
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

/**
 * Synchronized YouTube surface.
 *
 * The official IFrame Player API is the only supported way to drive the embed;
 * the room timeline stays authoritative and this component reconciles the player
 * towards it (play/pause/seek), seeking only when drift is meaningful.
 */
export function VideoStage({
  videoId,
  position,
  playing,
  canControl,
  onLocalSeek,
}: {
  videoId: string;
  position: number;
  playing: boolean;
  canControl: boolean;
  onLocalSeek: (seconds: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          disablekb: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            loadedIdRef.current = videoId;
            setReady(true);
            const player = playerRef.current;
            if (!player) return;
            player.seekTo(position, true);
            if (playing) player.playVideo();
            else player.pauseVideo();
          },
          onStateChange: (event: { data: number }) => {
            const YTState = window.YT?.PlayerState;
            if (!YTState) return;
            setBuffering(event.data === YTState.BUFFERING);
            // A user cannot pause through the hidden controls, so play state is
            // always driven by the room timeline below.
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      loadedIdRef.current = null;
      setReady(false);
    };
    // The player is created once; video changes are handled by loadVideoById.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile with the room timeline: new video, play/pause, or a real seek.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;
    if (loadedIdRef.current !== videoId) {
      loadedIdRef.current = videoId;
      player.loadVideoById({ videoId, startSeconds: position });
      if (!playing) player.pauseVideo();
      return;
    }
    const state = player.getPlayerState();
    const YTState = window.YT?.PlayerState;
    if (YTState) {
      if (playing && state !== YTState.PLAYING && state !== YTState.BUFFERING) player.playVideo();
      if (!playing && state === YTState.PLAYING) player.pauseVideo();
    }
    const drif = Math.abs(player.getCurrentTime() - position);
    if (playing && drif > 2.5) player.seekTo(position, true);
  }, [position, playing, ready, videoId]);

  const seek = (value: number) => {
    playerRef.current?.seekTo(value, true);
    if (canControl) onLocalSeek(value);
  };

  return (
    <div className="room-video-shell">
      <div className="room-video-frame-host">
        <div ref={hostRef} className="room-video-frame" />
      </div>
      {buffering && ready ? <span className="room-video-status">Buffering…</span> : null}
      {canControl ? (
        <input
          type="range"
          className="room-video-seek"
          min={0}
          max={Math.max(1, position + 600)}
          value={position}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Video position"
        />
      ) : null}
    </div>
  );
}
