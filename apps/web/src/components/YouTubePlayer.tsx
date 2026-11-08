import { useEffect, useRef, useState } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { formatDuration } from '../lib/format';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;

function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function YouTubePlayerModal({
  videoId,
  title,
  onClose,
}: {
  videoId: string;
  title: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: { autoplay: 1, playsinline: 1 },
        events: {
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onStateChange: (event: { data: number }) => {
            if (!cancelled) setPlaying(event.data === 1);
          },
        },
      });
    });
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player?.getCurrentTime) return;
      try {
        setCurrentTime(player.getCurrentTime());
        setDuration(player.getDuration());
      } catch {
        // Player may be destroyed or unavailable.
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      try {
        playerRef.current?.destroy();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, [videoId]);

  const toggle = () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (playing) player.pauseVideo();
      else player.playVideo();
    } catch {
      // ignore
    }
  };

  const seek = (value: number) => {
    try {
      playerRef.current?.seekTo(value, true);
      setCurrentTime(value);
    } catch {
      // ignore
    }
  };

  return (
    <div className="youtube-modal" role="dialog" aria-label={title}>
      <div className="youtube-modal-card">
        <div className="youtube-modal-head">
          <strong>{title}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
            <X size={16} />
          </button>
        </div>
        <div ref={hostRef} className="youtube-player-host" aria-label={`YouTube oynatıcı: ${title}`} />
        <div className="youtube-modal-controls">
          <button type="button" className="button primary" onClick={toggle} disabled={!ready}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
            {playing ? 'Duraklat' : 'Oynat'}
          </button>
          <span>{formatDuration(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            value={Math.min(currentTime, Math.max(duration, 0.1))}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!ready || duration <= 0}
            aria-label="İlerleme"
            className="range"
            style={{ '--fill': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
          />
          <span>{formatDuration(duration)}</span>
        </div>
        <small className="settings-hint">Resmi YouTube oynatıcısı; reklam ve kısıtlamalar YouTube kurallarına tabidir.</small>
      </div>
    </div>
  );
}
