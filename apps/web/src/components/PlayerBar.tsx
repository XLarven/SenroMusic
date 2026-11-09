import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  Heart,
  ListMusic,
  Loader2,
  Maximize2,
  Moon,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import clsx from 'clsx';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { Cover } from './Cover';
import { DownloadButton } from './DownloadButton';
import { NMLyricsPanel } from './norie/NMLyricsPanel';
import { destroyYouTubePlayer, playYouTubeVideo, youtubeVideoId } from '../lib/youtubeEngine';
import { usePlayer } from '../store/player';
import { useFavorites } from '../store/favorites';
import { formatDuration } from '../lib/format';

export function PlayerBar() {
  const current = usePlayer((state) => state.current);
  const provider = usePlayer((state) => state.provider);
  const queue = usePlayer((state) => state.queue);
  const playing = usePlayer((state) => state.playing);
  const loading = usePlayer((state) => state.loading);
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  const volume = usePlayer((state) => state.volume);
  const muted = usePlayer((state) => state.muted);
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);
  const queueOpen = usePlayer((state) => state.queueOpen);
  const sleepTimer = usePlayer((state) => state.sleepTimer);

  const toggle = usePlayer((state) => state.toggle);
  const next = usePlayer((state) => state.next);
  const previous = usePlayer((state) => state.previous);
  const seek = usePlayer((state) => state.seek);
  const setVolume = usePlayer((state) => state.setVolume);
  const toggleMute = usePlayer((state) => state.toggleMute);
  const toggleShuffle = usePlayer((state) => state.toggleShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);
  const setQueueOpen = usePlayer((state) => state.setQueueOpen);
  const setSleepTimer = usePlayer((state) => state.setSleepTimer);
  const [expanded, setExpanded] = useState(false);
  const favIds = useFavorites((state) => state.ids);
  const toggleFav = useFavorites((state) => state.toggle);
  const liked = current ? favIds.includes(current.id) : false;
  const [accent, setAccent] = useState<[number, number, number] | null>(null);
  const youtubeHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (provider !== 'youtube' || !current || !youtubeHostRef.current) {
      if (provider !== 'youtube') destroyYouTubePlayer();
      return;
    }
    const videoId = youtubeVideoId(current);
    let cancelled = false;
    const state = usePlayer.getState();
    void playYouTubeVideo(videoId, youtubeHostRef.current, {
      onStateChange: (nextPlaying, buffering) => {
        if (!cancelled) usePlayer.setState({ playing: nextPlaying, loading: buffering });
      },
      onTimeUpdate: (time, dur) => {
        if (!cancelled) usePlayer.setState({ currentTime: time, duration: dur, loading: false });
      },
      onEnded: () => {
        if (!cancelled) usePlayer.getState().handleEnded();
      },
      onError: (message) => {
        if (!cancelled) usePlayer.setState({ playing: false, loading: false, error: message });
      },
      onReady: () => {
        if (!cancelled) usePlayer.setState({ loading: false, error: null });
      },
    }, {
      autoplay: state.playing,
      startTime: state.currentTime,
    });
    return () => {
      cancelled = true;
    };
  }, [current, expanded, provider]);

  useEffect(() => {
    if (!current?.coverUrl || document.documentElement.classList.contains('dynamic-colors-off')) {
      setAccent(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 5;
        canvas.height = 5;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(img, 0, 0, 5, 5);
        const data = context.getImageData(0, 0, 5, 5).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if ((data[i + 3] ?? 0) < 128) continue;
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          count += 1;
        }
        if (!count || cancelled) return;
        setAccent([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
      } catch {
        // Tainted or unsupported images simply keep the default accent.
      }
    };
    img.src = current.coverUrl;
    return () => {
      cancelled = true;
    };
  }, [current?.coverUrl]);

  const accentCss = accent ? `rgb(${accent[0]}, ${accent[1]}, ${accent[2]})` : null;
  const npSheetStyle = accentCss
    ? { background: `radial-gradient(circle at 50% 0%, ${accentCss}33, transparent 56%), var(--nm-bg)` } as CSSProperties
    : undefined;

  const safeDuration = Math.max(duration || current?.duration || 0, 0);
  const progress = safeDuration > 0 ? Math.min(100, (currentTime / safeDuration) * 100) : 0;
  const volumeValue = muted ? 0 : volume;
  const cycleSleep = () => {
    const options = [null, 15, 30, 45, 60] as const;
    const idx = options.indexOf(sleepTimer as (typeof options)[number]);
    const next = options[(idx + 1) % options.length];
    setSleepTimer(next);
  };
  const progressStyle = { '--fill': `${progress}%` } as CSSProperties;
  const volumeStyle = { '--fill': `${volumeValue * 100}%` } as CSSProperties;

  return (
    <>
    <section className={clsx('player-bar', !current && 'is-empty')} aria-label="Müzik oynatıcı">
      <div className="player-track">
        {provider === 'youtube' && current && !expanded ? (
          <div ref={youtubeHostRef} className="player-youtube-host" aria-label={`YouTube oynatıcı: ${current.title}`} />
        ) : null}
        {current ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Şimdi çalınıyor'u büyüt"
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
          >
            <Cover
              src={current.coverUrl}
              alt=""
              seed={`${current.albumArtist}-${current.album}`}
              className="player-cover"
              iconSize={18}
              eager
            />
          </button>
        ) : (
          <div className="player-cover player-cover-empty" aria-hidden="true">
            <ListMusic size={18} />
          </div>
        )}
        <div className="player-meta">
          <span className="player-title">{current?.title ?? 'Bir şarkı seç'}</span>
          <span className="player-artist">{current?.artist ?? 'Kitaplığın seni bekliyor'}</span>
        </div>
        {current ? (
          <button
            type="button"
            className={clsx('player-heart', liked && 'is-liked')}
            onClick={() => toggleFav(current.id)}
            aria-label={liked ? 'Favorilerden kaldır' : 'Favorilere ekle'}
            title={liked ? 'Favorilerden kaldır' : 'Favorilere ekle'}
          >
            <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
          </button>
        ) : null}
        {current ? <AddToPlaylistMenu track={current} className="player-add" /> : null}
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button
            type="button"
            className={clsx('player-tool', shuffle && 'is-active')}
            onClick={toggleShuffle}
            aria-label="Karıştır"
            aria-pressed={shuffle}
            title="Karıştır"
          >
            <Shuffle size={17} />
          </button>
          <button
            type="button"
            className="player-tool"
            onClick={previous}
            disabled={!current}
            aria-label="Önceki parça"
            title="Önceki"
          >
            <SkipBack size={19} fill="currentColor" />
          </button>
          <button
            type="button"
            className="player-play"
            onClick={toggle}
            disabled={!current}
            aria-label={playing ? 'Duraklat' : 'Oynat'}
          >
            {current && loading ? (
              <Loader2 size={22} className="spin" />
            ) : playing ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="player-tool"
            onClick={next}
            disabled={!current}
            aria-label="Sonraki parça"
            title="Sonraki"
          >
            <SkipForward size={19} fill="currentColor" />
          </button>
          <button
            type="button"
            className={clsx('player-tool', repeat !== 'off' && 'is-active')}
            onClick={cycleRepeat}
            aria-label={
              repeat === 'off' ? 'Tekrar kapalı' : repeat === 'all' ? 'Tümünü tekrar et' : 'Tek parçayı tekrar et'
            }
            aria-pressed={repeat !== 'off'}
            title={repeat === 'off' ? 'Tekrar kapalı' : repeat === 'all' ? 'Tümünü tekrar et' : 'Tek parça'}
          >
            {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>

        <div className="player-progress">
          <span className="player-time">{formatDuration(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(safeDuration, 0.1)}
            step={0.1}
            value={Math.min(currentTime, Math.max(safeDuration, 0.1))}
            onChange={(event) => seek(Number(event.target.value))}
            className="range player-range"
            style={progressStyle}
            disabled={!current || safeDuration <= 0}
            aria-label="Parça ilerlemesi"
          />
          <span className="player-time">{formatDuration(safeDuration)}</span>
        </div>
      </div>

      <div className="player-right">
        {current ? (
          <button
            type="button"
            className="player-tool"
            onClick={() => setExpanded(true)}
            aria-label="Şimdi çalınıyor'u genişlet"
            title="Büyüt"
          >
            <Maximize2 size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className={clsx('player-tool', sleepTimer && 'is-active')}
          onClick={cycleSleep}
          aria-label={sleepTimer ? `Uyku zamanlayıcı: ${sleepTimer} dakika` : 'Uyku zamanlayıcı kapalı'}
          title={sleepTimer ? `Uyku: ${sleepTimer} dk` : 'Uyku zamanlayıcı'}
        >
          <Moon size={18} />
          {sleepTimer ? <span className="queue-count">{sleepTimer}</span> : null}
        </button>
        <button
          type="button"
          className={clsx('player-tool queue-toggle', queueOpen && 'is-active')}
          onClick={() => setQueueOpen(!queueOpen)}
          aria-label={`Sırayı aç (${queue.length} parça)`}
          aria-pressed={queueOpen}
          title="Sırada ne var?"
        >
          <ListMusic size={18} />
          {queue.length > 0 ? <span className="queue-count">{queue.length}</span> : null}
        </button>
        <div className="volume-control">
          <button
            type="button"
            className="player-tool"
            onClick={toggleMute}
            aria-label={muted ? 'Sesi aç' : 'Sesi kapat'}
            title={muted ? 'Sesi aç' : 'Sesi kapat'}
          >
            {muted || volumeValue === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volumeValue}
            onChange={(event) => setVolume(Number(event.target.value))}
            className="range volume-range"
            style={volumeStyle}
            aria-label="Ses seviyesi"
          />
        </div>
      </div>
    </section>

    {expanded && current ? (
      <div className="np-sheet" role="dialog" aria-label="Şimdi çalınıyor" style={npSheetStyle}>
        <div className="np-top">
          <button
            type="button"
            className="icon-button"
            onClick={() => setExpanded(false)}
            aria-label="Kapat"
          >
            <ChevronDown size={20} />
          </button>
          <span className="np-label">Şimdi çalınıyor</span>
          <span style={{ width: 36 }} />
        </div>

        <div className="np-art">
          {provider === 'youtube' ? (
            <div ref={youtubeHostRef} className="np-youtube-host" aria-label={`YouTube oynatıcı: ${current.title}`} />
          ) : (
            <Cover
              src={current.coverUrl}
              alt=""
              seed={`${current.albumArtist}-${current.album}`}
              className="np-art-cover"
              iconSize={64}
              eager
            />
          )}
        </div>

        <div className="np-meta">
          <div className="np-title">{current.title}</div>
          <div className="np-artist">{current.artist}</div>
          <button
            type="button"
            className={clsx('np-heart', liked && 'is-liked')}
            onClick={() => current && toggleFav(current.id)}
            aria-label={liked ? 'Favorilerden kaldır' : 'Favorilere ekle'}
          >
            <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
          </button>
          <DownloadButton track={current} />
          <AddToPlaylistMenu track={current} className="player-add" />
        </div>

        <div className="np-controls">
          <div className="np-progress">
            <span>{formatDuration(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(safeDuration, 0.1)}
              step={0.1}
              value={Math.min(currentTime, Math.max(safeDuration, 0.1))}
              onChange={(event) => seek(Number(event.target.value))}
              className="range player-range"
              style={progressStyle}
              disabled={!current || safeDuration <= 0}
              aria-label="Parça ilerlemesi"
            />
            <span>{formatDuration(safeDuration)}</span>
          </div>

          <div className="np-buttons">
            <button type="button" className="np-skip" onClick={previous} disabled={!current} aria-label="Önceki">
              <SkipBack size={28} fill="currentColor" />
            </button>
            <button
              type="button"
              className="np-play"
              onClick={toggle}
              disabled={!current}
              aria-label={playing ? 'Duraklat' : 'Oynat'}
            >
              {current && loading ? (
                <Loader2 size={30} className="spin" />
              ) : playing ? (
                <Pause size={30} fill="currentColor" />
              ) : (
                <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />
              )}
            </button>
            <button type="button" className="np-skip" onClick={next} disabled={!current} aria-label="Sonraki">
              <SkipForward size={28} fill="currentColor" />
            </button>
          </div>
        </div>

        <div style={{ width: 'min(92vw, 560px)', margin: '18px auto 0', border: '1px solid var(--nm-border)', borderRadius: 18, background: 'rgba(0,0,0,0.25)' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--nm-border)', fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--nm-text-secondary)' }}>
            Sözler
          </div>
          <NMLyricsPanel artist={current.artist} title={current.title} duration={safeDuration} album={current.album} />
        </div>
      </div>
    ) : null}
    </>
  );
}
