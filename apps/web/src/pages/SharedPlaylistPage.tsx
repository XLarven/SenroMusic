import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Link2, ListMusic } from 'lucide-react';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { TrackList } from '../components/TrackList';
import { PlayButton } from '../components/PlayButton';
import { api } from '../api';

export function SharedPlaylistPage() {
  const { slug = '' } = useParams();
  const query = useQuery({
    queryKey: ['public-playlist', slug],
    queryFn: () => api.publicPlaylistBySlug(slug),
    staleTime: 30_000,
  });

  if (query.isPending) {
    return (
      <section className="page shared-page" aria-busy="true">
        <div className="skeleton hero-skeleton" />
        <div className="skeleton line-skeleton" />
        <div className="skeleton line-skeleton short" />
      </section>
    );
  }

  if (query.error || !query.data) {
    return (
      <section className="page shared-page">
        <EmptyState
          icon={Link2}
          title="Paylaşım bulunamadı."
          description="Bu bağlantı kaldırılmış olabilir veya liste artık herkese açık değil."
          action={<Link className="button primary" to="/">Ana sayfaya dön</Link>}
        />
      </section>
    );
  }

  const playlist = query.data;

  return (
    <section className="page playlist-page shared-page">
      <header className="detail-hero">
        <Cover src={playlist.coverUrl} alt="" seed={playlist.id} className="detail-cover" />
        <div className="detail-copy">
          <span className="eyebrow">Herkese açık çalma listesi</span>
          <h1>{playlist.name}</h1>
          {playlist.description ? <p>{playlist.description}</p> : null}
          <small>{playlist.trackCount} parça</small>
          <div className="detail-actions">
            <PlayButton tracks={playlist.tracks} />
            <Link className="button secondary" to="/">NorieMusic'te dinle</Link>
          </div>
        </div>
      </header>
      {playlist.tracks.length ? (
        <TrackList tracks={playlist.tracks} />
      ) : (
        <EmptyState icon={ListMusic} title="Bu listede henüz parça yok." description="Liste sahibi parça eklediğinde burada görünecek." />
      )}
    </section>
  );
}
