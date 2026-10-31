import { Link } from 'react-router-dom';
import { Cover } from './Cover';
import { PlayButton } from './PlayButton';
import { useMusicData } from '../MusicDataContext';
import { tracksForAlbum } from '../lib/format';
import type { Album } from '../types';

export function AlbumCard({ album }: { album: Album }) {
  const { library } = useMusicData();
  const tracks = tracksForAlbum(library, album);

  return (
    <article className="album-card">
      <div className="album-cover-shell">
        <Link to={`/album/${album.id}`} className="album-cover-link" aria-label={`${album.name} albümünü aç`}>
          <Cover src={album.coverUrl} alt={album.name} seed={`${album.artist}-${album.name}`} className="album-cover" />
        </Link>
        <div className="album-play">
          <PlayButton tracks={tracks} size="sm" label={`${album.name} albümünü çal`} />
        </div>
      </div>
      <Link to={`/album/${album.id}`} className="album-card-copy">
        <h3>{album.name}</h3>
        <p>
          {album.artist}
          <span> · {album.year ?? `${album.trackCount} parça`}</span>
        </p>
      </Link>
    </article>
  );
}
