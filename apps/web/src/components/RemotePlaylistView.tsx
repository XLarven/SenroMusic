import { ArrowUpRight, Download, Loader2, Play, Shuffle } from 'lucide-react';
import { Cover } from './Cover';
import { TrackList } from './TrackList';
import { formatDuration, formatLongDuration } from '../lib/format';
import { usePlayer } from '../store/player';
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
}: Props) {
  const playQueue = usePlayer((state) => state.playQueue);
  const duration = totalDuration ?? tracks.reduce((total, track) => total + (track.duration || 0), 0);
  const sourceLabel = source === 'spotify' ? 'Spotify listesi' : 'YouTube listesi';

  return (
    <section className="content-section remote-playlist" aria-label={`${sourceLabel}: ${title}`}>
      <header className="detail-hero playlist-detail-hero">
        <div className="detail-art">
          <div className="detail-art-disc" aria-hidden="true" />
          <Cover
            src={coverUrl ?? tracks[0]?.coverUrl ?? null}
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
            <span>{tracks.length} parça</span>
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

          <div className="detail-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => playQueue(tracks)}
              disabled={tracks.length === 0}
            >
              <Play size={16} fill="currentColor" />
              Çal
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => playQueue(shuffled(tracks))}
              disabled={tracks.length === 0}
            >
              <Shuffle size={16} />
              Karıştır
            </button>
            {onImport ? (
              <button type="button" className="button ghost" onClick={onImport} disabled={importing}>
                {importing ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                {importing ? 'Kaydediliyor…' : (importLabel ?? 'Norie listesine kaydet')}
              </button>
            ) : null}
            {sourceUrl ? (
              <a className="button ghost" href={sourceUrl} target="_blank" rel="noreferrer">
                <ArrowUpRight size={16} />
                Kaynağı aç
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <section className="detail-tracks" aria-label="Parçalar">
        <div className="section-heading">
          <div>
            <h2>Parçalar</h2>
            <p>
              {tracks.length} parça · {formatDuration(duration)} toplam
            </p>
          </div>
        </div>
        <div className="surface-panel">
          <TrackList tracks={tracks} showAlbum={false} />
        </div>
      </section>
    </section>
  );
}
