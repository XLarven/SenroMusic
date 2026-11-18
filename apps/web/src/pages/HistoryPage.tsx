import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock3, Music4, Play, Radio, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { t } from '../lib/i18n';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import type { HistoryItem } from '../types';

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(date, today)) return t('Bugün', 'Today');
  if (same(date, yesterday)) return t('Dün', 'Yesterday');
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Listening history across library plays and songs streamed from search. */
export function HistoryPage() {
  const queryClient = useQueryClient();
  const playQueue = usePlayer((state) => state.playQueue);
  const pushToast = useToastStore((state) => state.push);
  const [clearing, setClearing] = useState(false);

  const history = useQuery({
    queryKey: ['history-page'],
    queryFn: () => api.history(200),
    staleTime: 0,
  });

  const items = history.data?.items ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, HistoryItem[]>();
    for (const item of items) {
      const key = dayLabel(item.playedAt);
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return [...map.entries()];
  }, [items]);

  const clear = async () => {
    setClearing(true);
    try {
      await api.clearHistory();
      await queryClient.invalidateQueries({ queryKey: ['history-page'] });
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      pushToast(t('Dinleme geçmişi temizlendi.', 'Listening history cleared.'), 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Geçmiş temizlenemedi.', 'Could not clear history.'), 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="page history-page">
      <header className="page-heading">
        <span className="eyebrow">{t('Senin müziğin', 'Your music')}</span>
        <h1>{t('Dinleme geçmişi', 'Listening history')}</h1>
        <p>
          {items.length > 0
            ? t(`${items.length} parça · en yeniden en eskiye`, `${items.length} tracks · newest first`)
            : t('Henüz bir şey dinlemedin.', 'Nothing played yet.')}
        </p>
      </header>

      {items.length === 0 && !history.isLoading ? (
        <EmptyState
          icon={Clock3}
          title={t('Geçmiş boş', 'History is empty')}
          description={t(
            'Bir şarkı çaldığında burada listelenir — kütüphaneden de, aramadan da.',
            'Play a song from the library or from search and it shows up here.',
          )}
          action={
            <Link to="/search" className="button primary">
              {t('Müzik ara', 'Search music')}
            </Link>
          }
        />
      ) : null}

      {items.length > 0 ? (
        <div className="history-actions">
          <button type="button" className="button ghost compact" onClick={() => void clear()} disabled={clearing}>
            <Trash2 size={15} /> {clearing ? t('Temizleniyor…', 'Clearing…') : t('Geçmişi temizle', 'Clear history')}
          </button>
        </div>
      ) : null}

      {groups.map(([label, entries]) => (
        <section className="content-section" key={label} aria-label={label}>
          <div className="section-heading">
            <div>
              <h2>{label}</h2>
              <p>{entries.length} parça</p>
            </div>
          </div>
          <div className="surface-panel">
            <ul className="history-list">
              {entries.map((entry, index) => (
                <li className="history-row" key={`${entry.track.id}-${entry.playedAt}`}>
                  <button
                    type="button"
                    className="history-play"
                    aria-label={t(`${entry.track.title} çal`, `Play ${entry.track.title}`)}
                    onClick={() =>
                      playQueue(
                        entries.map((item) => item.track),
                        index,
                      )
                    }
                  >
                    <Cover src={entry.track.coverUrl} alt="" seed={entry.track.id} className="history-cover" iconSize={16} />
                    <span className="history-play-icon"><Play size={15} fill="currentColor" /></span>
                  </button>
                  <div className="history-copy">
                    <strong>{entry.track.title}</strong>
                    <small>{entry.track.artist}</small>
                  </div>
                  {entry.remote ? (
                    <span className="history-badge" title={t('Aramadan çalındı', 'Played from search')}>
                      <Radio size={12} /> {t('arama', 'search')}
                    </span>
                  ) : (
                    <span className="history-badge is-library" title={t('Kütüphaneden çalındı', 'Played from library')}>
                      <Music4 size={12} /> {t('kitaplık', 'library')}
                    </span>
                  )}
                  <span className="history-time">{timeLabel(entry.playedAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
