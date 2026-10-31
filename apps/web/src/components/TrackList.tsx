import { Link } from 'react-router-dom';
import { Pause, Play, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Cover } from './Cover';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { formatDuration } from '../lib/format';
import { usePlayer } from '../store/player';
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

export function TrackList({
  tracks,
  showAlbum = true,
  showCover = true,
  showHeader = true,
  className,
  onRemove,
  removeLabel = 'Listeden çıkar',
}: TrackListProps) {
  const current = usePlayer((state) => state.current);
  const playing = usePlayer((state) => state.playing);
  const playQueue = usePlayer((state) => state.playQueue);
  const toggle = usePlayer((state) => state.toggle);

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
                <span className="track-artist">{track.artist}</span>
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
              <AddToPlaylistMenu track={track} className="track-action" />
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
