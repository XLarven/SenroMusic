import { Link } from 'react-router-dom';
import { PlayButton } from './PlayButton';
import { ArtistAvatar } from './ArtistAvatar';
import { useMusicData } from '../MusicDataContext';
import { tracksForArtist } from '../lib/format';
import type { Artist } from '../types';

export function ArtistCard({ artist }: { artist: Artist }) {
  const { library } = useMusicData();
  const tracks = tracksForArtist(library, artist);

  return (
    <article className="artist-card">
      <div className="artist-cover-shell">
        <Link to={`/artist/${artist.id}`} className="artist-cover-link" aria-label={`${artist.name} sanatçısını aç`}>
          <ArtistAvatar artist={artist} className="artist-cover" />
        </Link>
        <div className="artist-play">
          <PlayButton tracks={tracks} size="sm" label={`${artist.name} sanatçısını çal`} />
        </div>
      </div>
      <Link to={`/artist/${artist.id}`} className="artist-card-copy">
        <h3>{artist.name}</h3>
        <p>
          {artist.albumCount} albüm · {artist.trackCount} parça
        </p>
      </Link>
    </article>
  );
}
