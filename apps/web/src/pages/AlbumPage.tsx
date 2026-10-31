import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Disc3, Music2, Shuffle, Sparkles } from 'lucide-react';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { usePlayer } from '../store/player';
import {
  albumById,
  artistIdByName,
  formatLongDuration,
  shuffle,
  tracksForAlbum,
} from '../lib/format';

export function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { library } = useMusicData();
  const playQueue = usePlayer((state) => state.playQueue);

  const album = id ? albumById(library, id) : null;

  if (!album) {
    return (
      <div className="page">
        <EmptyState
          icon={Disc3}
          title="Albüm bulunamadı"
          description="Bu albüm kütüphanede yok olabilir ya da sunucudan kaldırılmış olabilir."
          action={
            <Link to="/library?tab=albums" className="button primary">
              Albümlere dön
            </Link>
          }
        />
      </div>
    );
  }

  const tracks = tracksForAlbum(library, album);
  const artistId = artistIdByName(library, album.artist);
  const firstTrack = tracks[0];
  const quality = [
    firstTrack?.format,
    firstTrack?.sampleRate ? `${(firstTrack.sampleRate / 1000).toFixed(1)} kHz` : null,
    firstTrack?.bitrate ? `${Math.round(firstTrack.bitrate / 1000)} kbps` : null,
  ].filter(Boolean);

  return (
    <div className="page detail-page">
      <button type="button" className="detail-back" onClick={() => navigate(-1)}>
        <ChevronLeft size={17} />
        Geri
      </button>

      <header className="detail-hero album-detail-hero">
        <div className="detail-art">
          <div className="detail-art-disc" aria-hidden="true" />
          <Cover
            src={album.coverUrl}
            alt={album.name}
            seed={`${album.artist}-${album.name}`}
            className="detail-cover"
            eager
            iconSize={42}
          />
        </div>
        <div className="detail-copy">
          <span className="eyebrow">Albüm</span>
          <h1>{album.name}</h1>
          <p className="detail-byline">
            {artistId ? <Link to={`/artist/${artistId}`}>{album.artist}</Link> : album.artist}
            {album.year ? <span> · {album.year}</span> : null}
          </p>
          <div className="detail-meta">
            <span>{album.trackCount} parça</span>
            <span aria-hidden="true">·</span>
            <span>{formatLongDuration(album.duration)}</span>
            {quality.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="quality-tag">
                  <Music2 size={13} />
                  {quality.join(' · ')}
                </span>
              </>
            ) : null}
          </div>

          <div className="detail-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => playQueue(tracks)}
              disabled={tracks.length === 0}
            >
              <Sparkles size={17} />
              Albümü çal
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

      <section className="detail-tracks">
        <TrackList tracks={tracks} showAlbum={false} />
      </section>
    </div>
  );
}
