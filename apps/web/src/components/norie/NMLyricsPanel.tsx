import { Loader2, Music } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLyrics } from '../../hooks/useLyrics';
import { usePlayer } from '../../store/player';
import { t } from '../../lib/i18n';

type Props = {
  artist: string;
  title: string;
  duration: number;
  album?: string;
};

export function NMLyricsPanel({ artist, title, duration, album }: Props) {
  const currentTime = usePlayer((s) => s.currentTime);
  const seek = usePlayer((s) => s.seek);
  const { data, loading, error } = useLyrics(artist, title, duration, album);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(-1);
  const holdUntilRef = useRef(0);
  const [following, setFollowing] = useState(true);

  // Auto-scroll the active line **inside this container**. scrollIntoView would
  // walk up every scrollable ancestor and push the whole expanded player off
  // screen, so the offset is computed and clamped here instead.
  useEffect(() => {
    if (!data?.synced || !listRef.current) return;
    const container = listRef.current;
    let idx = -1;
    data.lines.forEach((line, index) => {
      if (line.time !== null && line.time <= currentTime) idx = index;
    });
    if (idx === activeIndexRef.current) return;
    activeIndexRef.current = idx;
    if (idx < 0) return;
    if (Date.now() < holdUntilRef.current) return;
    const el = container.children[idx] as HTMLElement | undefined;
    if (!el) return;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    const top = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight));
    container.scrollTo({ top, behavior: 'smooth' });
  }, [currentTime, data]);

  // Manual scrolling pauses follow mode briefly instead of fighting the user.
  const holdFollow = () => {
    holdUntilRef.current = Date.now() + 7000;
    setFollowing(false);
  };

  const resumeFollow = () => {
    holdUntilRef.current = 0;
    setFollowing(true);
    activeIndexRef.current = -1;
    const container = listRef.current;
    if (!container) return;
    let idx = -1;
    data?.lines.forEach((line, index) => {
      if (line.time !== null && line.time <= currentTime) idx = index;
    });
    const el = idx >= 0 ? (container.children[idx] as HTMLElement | undefined) : undefined;
    if (!el) return;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight)),
      behavior: 'smooth',
    });
  };


  if (loading) {
    return (
      <div className="lyrics-viewport lyrics-loading">
        <Loader2 size={18} className="spin" /> {t('Sözler yükleniyor…', 'Loading lyrics…')}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="lyrics-empty">
        <Music size={22} />
        {error || t('Söz bulunamadı', 'No lyrics found')}
      </div>
    );
  }

  let activeIdx = -1;
  if (data.synced) {
    data.lines.forEach((l, i) => {
      if (l.time !== null && l.time <= currentTime) activeIdx = i;
    });
  }

  return (
    <div className="lyrics-shell">
      {!following && data.synced ? (
        <button type="button" className="lyrics-follow" onClick={resumeFollow}>
          {t('Aktif satıra dön', 'Back to active line')}
        </button>
      ) : null}
      <div
        className="lyrics-viewport"
        ref={listRef}
        aria-live="polite"
        onWheel={holdFollow}
        onTouchMove={holdFollow}
        onPointerDown={holdFollow}
      >
      {!data.synced ? (
        <p className="lyrics-note">Zamanlama uydurulmadı — statik sözler</p>
      ) : null}
      {data.lines.map((line, i) => (
        <div
          key={i}
          data-index={i}
          data-time={line.time ?? undefined}
          className={`lyrics-line ${i === activeIdx ? 'is-active' : ''} ${i < activeIdx ? 'is-past' : ''}`}
          onClick={() => {
            if (line.time !== null) seek(line.time);
          }}
          style={{ cursor: line.time !== null ? 'pointer' : 'default' }}
        >
          {line.text.trim() || '♪'}
        </div>
      ))}
      </div>
    </div>
  );
}
