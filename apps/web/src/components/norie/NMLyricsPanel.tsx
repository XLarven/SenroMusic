import { Loader2, Music } from 'lucide-react';
import { useEffect, useRef } from 'react';
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

  // Auto-scroll active synced line
  useEffect(() => {
    if (!data?.synced || !listRef.current) return;
    let idx = -1;
    data.lines.forEach((l, i) => {
      if (l.time !== null && l.time <= currentTime) idx = i;
    });
    if (idx === activeIndexRef.current) return;
    activeIndexRef.current = idx;
    if (idx >= 0) {
      const el = listRef.current.children[idx] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentTime, data]);

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
    <div className="lyrics-viewport" ref={listRef} aria-live="polite">
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
  );
}
