import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Disc3, Shuffle, Sparkles, Users } from 'lucide-react';
import { AlbumCard } from '../components/AlbumCard';
import { ArtistAvatar } from '../components/ArtistAvatar';
import { EmptyState } from '../components/EmptyState';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { usePlayer } from '../store/player';
import {
  albumsForArtist,
  artistById,
  formatLongDuration,
  shuffle,
  tracksForArtist,
} from '../lib/format';

export function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { library } = useMusicData();
  const playQueue = usePlayer((state) => state.playQueue);

  const artist = id ? artistById(library, id) : null;

  if (!artist) {
    return (
      <div className="page">
        <EmptyState
          icon={Users}
          title="Sanatçı bulunamadı"
          description="Bu sanatçı kütüphanede yok olabilir ya da sunucudan kaldırılmış olabilir."
          action={
            <Link to="/library?tab=artists" className="button primary">
              Sanatçılara dön
            </Link>
          }
        />
      </div>
    );
  }

  const tracks = tracksForArtist(library, artist);
  const albums = albumsForArtist(library, artist);
  const duration = tracks.reduce((sum, track) => sum + track.duration, 0);

  return (
    <div className="page detail-page">
      <button type="button" className="detail-back" onClick={() => navigate(-1)}>
        <ChevronLeft size={17} />
        Geri
      </button>

      <header className="artist-detail-hero">
        <div className="artist-detail-art">
          <ArtistAvatar artist={artist} className="artist-detail-cover" />
        </div>
        <div className="detail-copy">
          <span className="eyebrow">Sanatçı</span>
          <h1>{artist.name}</h1>
          <div className="detail-meta">
            <span>{artist.trackCount} parça</span>
            <span aria-hidden="true">·</span>
            <span>{artist.albumCount} albüm</span>
            <span aria-hidden="true">·</span>
            <span>{formatLongDuration(duration)}</span>
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => playQueue(tracks)}
              disabled={tracks.length === 0}
            >
              <Sparkles size={17} />
              Tümünü çal
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => playQueue(shuffle(tracks))}
              disabled={tracks.length === 0}
            >
              <Shuffle size={16} />
              Karıştır
            </button>
          </div>
        </div>
      </header>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Albümler</h2>
            <p>{artist.name} tarafından kütüphanende bulunan albümler.</p>
          </div>
        </div>
        <div className="card-grid album-grid">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Şarkılar</h2>
            <p>{tracks.length} parça</p>
          </div>
          <span className="section-icon">
            <Disc3 size={16} />
          </span>
        </div>
        <div className="surface-panel">
          <TrackList tracks={tracks} />
        </div>
      </section>
    </div>
  );
}
