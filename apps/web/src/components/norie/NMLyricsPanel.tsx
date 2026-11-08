import { Loader2, Music } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLyrics } from '../../hooks/useLyrics';
import { usePlayer } from '../../store/player';

type Props = {
  artist: string;
  title: string;
  duration: number;
};

export function NMLyricsPanel({ artist, title, duration }: Props) {
  const currentTime = usePlayer((s) => s.currentTime);
  const seek = usePlayer((s) => s.seek);
  const { data, loading, error } = useLyrics(artist, title, duration);
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
      <div className="lyrics-viewport" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', minHeight: 160 }}>
        <Loader2 size={18} className="spin" /> Sözler yükleniyor…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--nm-text-secondary)' }}>
        <Music size={22} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.6 }} />
        {error || 'Söz bulunamadı'}
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
    <div className="lyrics-viewport" ref={listRef} style={{ maxHeight: 340, textAlign: 'center' }} aria-live="polite">
      {!data.synced ? (
        <p style={{ color: 'var(--nm-text-secondary)', fontSize: '0.78rem', marginBottom: 8 }}>Zamanlama uydurulmadı — statik sözler</p>
      ) : null}
      {data.lines.map((line, i) => (
        <div
          key={i}
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
