import { Link } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import { Cover } from './Cover';
import { formatLongDuration } from '../lib/format';
import type { PlaylistSummary } from '../types';

type PlaylistCardProps = {
  playlist: PlaylistSummary;
};

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  return (
    <Link to={`/playlist/${playlist.id}`} className="album-card playlist-card">
      <div className="album-cover-shell">
        <Cover
          src={playlist.coverUrl}
          alt={playlist.name}
          seed={playlist.id}
          className="album-cover"
          iconSize={36}
        />
        <span className="playlist-badge" aria-hidden="true">
          <ListMusic size={13} />
        </span>
      </div>
      <div className="album-card-copy">
        <h3>{playlist.name}</h3>
        <p>
          {playlist.trackCount} parça · {formatLongDuration(playlist.duration)}
        </p>
      </div>
    </Link>
  );
}
