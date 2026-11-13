import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Heart, Pause, Play, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import clsx from 'clsx';
import { Cover } from './Cover';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { DownloadButton } from './DownloadButton';
import { formatDuration } from '../lib/format';
import { useMusicData } from '../MusicDataContext';
import { usePlayer } from '../store/player';
import { useFavorites } from '../store/favorites';
import type { Track } from '../types';

export type TrackListItem = Track & { entryId?: number };

type TrackListProps = {
  tracks: TrackListItem[];
  showAlbum?: boolean;
  showCover?: boolean;
  showHeader?: boolean;
  className?: string;
  onRemove?: (track: TrackListItem) => void;
  removeLabel?: string;
  onMove?: (index: number, direction: -1 | 1) => void;
};

function Equalizer() {
  return (
    <span className="equalizer" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function FavoriteAction({ track }: { track: Track }) {
  const isFav = useFavorites((state) => state.ids.includes(track.id));
  const toggleFav = useFavorites((state) => state.toggle);
  return (
    <button
      type="button"
      className={clsx('icon-button subtle track-action favorite-button', isFav && 'is-active')}
      title={isFav ? 'Favorilerden kaldır' : 'Favorilere ekle'}
      aria-label={isFav ? 'Favorilerden kaldır' : 'Favorilere ekle'}
      aria-pressed={isFav}
      onClick={(event) => {
        event.stopPropagation();
        void toggleFav(track.id).catch(() => undefined);
      }}
    >
      <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
    </button>
  );
}

export function TrackList({
  tracks,
  showAlbum = true,
  showCover = true,
  showHeader = true,
  className,
  onRemove,
  removeLabel = 'Listeden çıkar',
  onMove,
}: TrackListProps) {
  const current = usePlayer((state) => state.current);
  const playing = usePlayer((state) => state.playing);
  const playQueue = usePlayer((state) => state.playQueue);
  const toggle = usePlayer((state) => state.toggle);
  const { library } = useMusicData();

  // Name -> id once per library change instead of a scan per rendered row.
  const artistIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const artist of library.artists) map.set(artist.name, artist.id);
    return map;
  }, [library.artists]);

  const startTrack = (index: number) => {
    const track = tracks[index];
    if (!track) return;
    if (current?.id === track.id) {
      toggle();
      return;
    }
    playQueue(tracks, index);
  };

  return (
    <div className={clsx('track-list', !showAlbum && 'no-album', className)}>
      {showHeader ? (
        <div className="track-list-header" aria-hidden="true">
          <span>#</span>
          <span>Başlık</span>
          {showAlbum ? <span>Albüm</span> : null}
          <span className="track-duration-head">Süre</span>
          <span />
        </div>
      ) : null}

      {tracks.map((track, index) => {
        const isCurrent = current?.id === track.id;
        const isPlaying = isCurrent && playing;
        return (
          <div
            className={clsx('track-row', isCurrent && 'is-current', isPlaying && 'is-playing')}
            key={track.entryId ?? track.id}
            onClick={() => startTrack(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                startTrack(index);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`${track.title} — ${track.artist}`}
          >
            <div className="track-index">
              <span className="track-number">{String(index + 1).padStart(2, '0')}</span>
              <button
                type="button"
                className="track-play"
                aria-label={isPlaying ? `${track.title} parçasını duraklat` : `${track.title} parçasını çal`}
                onClick={(event) => {
                  event.stopPropagation();
                  startTrack(index);
                }}
              >
                {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
              </button>
              {isPlaying ? <Equalizer /> : null}
            </div>

            <div className="track-main">
              {showCover ? (
                <Cover
                  src={track.coverUrl}
                  alt=""
                  seed={`${track.albumArtist}-${track.album}`}
                  className="track-cover"
                  iconSize={15}
                />
              ) : null}
              <div className="track-copy">
                <span className="track-title">{track.title}</span>
                {artistIds.has(track.artist) ? (
                  <Link
                    to={`/artist/${artistIds.get(track.artist)}`}
                    className="track-artist track-artist-link"
                    onClick={(event) => event.stopPropagation()}
                    tabIndex={-1}
                    title={`${track.artist} sayfası`}
                  >
                    {track.artist}
                  </Link>
                ) : (
                  <Link
                    to={`/search?q=${encodeURIComponent(track.artist)}`}
                    className="track-artist track-artist-link"
                    onClick={(event) => event.stopPropagation()}
                    tabIndex={-1}
                    title={`${track.artist} ara`}
                  >
                    {track.artist}
                  </Link>
                )}
              </div>
            </div>

            {showAlbum ? (
              <Link
                to={`/search?q=${encodeURIComponent(track.album)}`}
                className="track-album"
                onClick={(event) => event.stopPropagation()}
                tabIndex={-1}
              >
                {track.album}
              </Link>
            ) : null}

            <span className="track-duration">{formatDuration(track.duration)}</span>

            <div className="track-actions">
              <FavoriteAction track={track} />
              <DownloadButton track={track} />
              <AddToPlaylistMenu track={track} className="track-action" />
              {onMove ? (
                <>
                  <button
                    type="button"
                    className="icon-button subtle track-action"
                    title="Yukarı taşı"
                    aria-label="Yukarı taşı"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(index, -1);
                    }}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button subtle track-action"
                    title="Aşağı taşı"
                    aria-label="Aşağı taşı"
                    disabled={index === tracks.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(index, 1);
                    }}
                  >
                    <ChevronDown size={16} />
                  </button>
                </>
              ) : null}
              {onRemove ? (
                <button
                  type="button"
                  className="icon-button subtle track-action track-remove"
                  title={removeLabel}
                  aria-label={removeLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(track);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
