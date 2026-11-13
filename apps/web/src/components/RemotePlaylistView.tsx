import { ArrowUpRight, Download, Loader2, Play, Shuffle } from 'lucide-react';
import { Cover } from './Cover';
import { TrackList } from './TrackList';
import { formatDuration, formatLongDuration } from '../lib/format';
import { usePlayer } from '../store/player';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { t } from '../lib/i18n';
import type { Track } from '../types';

type Props = {
  source: 'spotify' | 'youtube';
  title: string;
  description?: string | null;
  creator?: string | null;
  coverUrl?: string | null;
  sourceUrl?: string | null;
  tracks: Track[];
  totalDuration?: number | null;
  importLabel?: string;
  importing?: boolean;
  onImport?: () => void;
  /** The provider truncated the playlist before it reached us. */
  truncated?: boolean;
};

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/**
 * A pasted Spotify or YouTube playlist, rendered with the same hero + track list
 * as a Norie playlist so it can be read and played without importing it first.
 */
export function RemotePlaylistView({
  source,
  title,
  description,
  creator,
  coverUrl,
  sourceUrl,
  tracks,
  totalDuration,
  importLabel,
  importing,
  onImport,
  truncated,
}: Props) {
  const playQueue = usePlayer((state) => state.playQueue);
  // Imported playlists hand every row the playlist cover; fetch the real album
  // art per song so the list does not repeat one square a hundred times.
  const { tracks: tracksWithArtwork } = useTrackArtwork(tracks, coverUrl);
  const duration = totalDuration ?? tracks.reduce((total, track) => total + (track.duration || 0), 0);
  const sourceLabel = source === 'spotify' ? t('Spotify listesi', 'Spotify playlist') : t('YouTube listesi', 'YouTube playlist');

  return (
    <section className="content-section remote-playlist" aria-label={`${sourceLabel}: ${title}`}>
      <header className="detail-hero playlist-detail-hero">
        <div className="detail-art">
          <div className="detail-art-disc" aria-hidden="true" />
          <Cover
            src={coverUrl ?? tracksWithArtwork[0]?.coverUrl ?? null}
            alt={title}
            seed={title}
            className="detail-cover"
            iconSize={40}
            eager
          />
        </div>

        <div className="detail-copy">
          <span className="eyebrow">{sourceLabel}</span>
          <h1>{title}</h1>
          {creator ? <p className="detail-byline">{creator}</p> : null}
          {description ? <p className="detail-description">{description}</p> : null}
          <div className="detail-meta">
            <span>{tracksWithArtwork.length} {t('parça', 'tracks')}</span>
            {duration > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatLongDuration(duration)}</span>
              </>
            ) : null}
            <span className={`quality-tag ${source === 'spotify' ? '' : 'is-youtube'}`}>
              {source === 'spotify' ? 'Spotify' : 'YouTube'}
            </span>
          </div>

          {truncated ? (
            <p className="import-limit-note" role="status">
              {source === 'spotify'
                ? t(
                    'Spotify herkese açık bağlantılarda yalnızca ilk 100 parçayı veriyor; liste burada kesiliyor.',
                    'Spotify only exposes the first 100 tracks for public links, so the list stops there.',
                  )
                : t(
                    `Bu liste ${tracksWithArtwork.length} parçada kesildi; liste başına üst sınır 1000.`,
                    `This list was truncated at ${tracksWithArtwork.length} tracks; the limit is 1000 per playlist.`,
                  )}
            </p>
          ) : null}

          <div className="detail-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => playQueue(tracksWithArtwork)}
              disabled={tracksWithArtwork.length === 0}
            >
              <Play size={16} fill="currentColor" />
              {t('Çal', 'Play')}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => playQueue(shuffled(tracksWithArtwork))}
              disabled={tracksWithArtwork.length === 0}
            >
              <Shuffle size={16} />
              {t('Karıştır', 'Shuffle')}
            </button>
            {onImport ? (
              <button type="button" className="button ghost" onClick={onImport} disabled={importing}>
                {importing ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                {importing
                  ? t('Kaydediliyor…', 'Saving…')
                  : (importLabel ?? t('Çalma listesini oluştur', 'Create playlist'))}
              </button>
            ) : null}
            {sourceUrl ? (
              <a className="button ghost" href={sourceUrl} target="_blank" rel="noreferrer">
                <ArrowUpRight size={16} />
                {t('Kaynağı aç', 'Open source')}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <section className="detail-tracks" aria-label={t('Parçalar', 'Tracks')}>
        <div className="section-heading">
          <div>
            <h2>{t('Parçalar', 'Tracks')}</h2>
            <p>
              {tracksWithArtwork.length} {t('parça', 'tracks')} · {formatDuration(duration)}{' '}
              {t('toplam', 'total')}
            </p>
          </div>
        </div>
        <div className="surface-panel">
          <TrackList tracks={tracksWithArtwork} showAlbum={false} />
        </div>
      </section>
    </section>
  );
}
