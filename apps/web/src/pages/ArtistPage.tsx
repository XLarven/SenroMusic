import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Disc3, Shuffle, Sparkles, UserPlus, UserCheck, Users } from 'lucide-react';
import { api } from '../api';
import { AlbumCard } from '../components/AlbumCard';
import { ArtistAvatar } from '../components/ArtistAvatar';
import { EmptyState } from '../components/EmptyState';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
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
  const pushToast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  const artist = id ? artistById(library, id) : null;
  const followsQuery = useQuery({
    queryKey: ['artist-follows'],
    queryFn: api.artistFollows,
    staleTime: 30_000,
  });
  const followed = Boolean(artist && followsQuery.data?.follows.some((follow) => follow.artistId === artist.id));
  const followMutation = useMutation({
    mutationFn: async () => {
      if (!artist) throw new Error('Sanatçı bulunamadı.');
      return followed ? api.unfollowArtist(artist.id) : api.followArtist(artist.id, artist.name);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['artist-follows'] });
      pushToast(followed ? 'Takip bırakıldı.' : 'Sanatçı takip ediliyor.', 'success');
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : 'Takip güncellenemedi.', 'error'),
  });

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
  const albums = useMemo(
    () =>
      [...albumsForArtist(library, artist)].sort((a, b) =>
        sort === 'newest' ? (b.year ?? 0) - (a.year ?? 0) : (a.year ?? 0) - (b.year ?? 0),
      ),
    [artist, library, sort],
  );
  const popularTracks = useMemo(
    () => [...tracks].sort((a, b) => b.duration - a.duration).slice(0, 10),
    [tracks],
  );
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
          <p className="detail-description">
            {artist.name} hakkında doğrulanmış biyografi bulunamadı. Kütüphanendeki albüm ve parçalar aşağıda listeleniyor.
          </p>
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
            <button
              type="button"
              className={followed ? 'button ghost' : 'button secondary'}
              onClick={() => followMutation.mutate()}
              disabled={followMutation.isPending}
            >
              {followed ? <UserCheck size={16} /> : <UserPlus size={16} />}
              {followed ? 'Takip ediliyor' : 'Takip et'}
            </button>
          </div>
        </div>
      </header>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Popüler parçalar</h2>
            <p>Kütüphanendeki en uzun kayıtlara göre sıralandı.</p>
          </div>
        </div>
        <div className="surface-panel">
          <TrackList tracks={popularTracks} />
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Diskografi</h2>
            <p>{artist.name} tarafından kütüphanende bulunan albümler.</p>
          </div>
          <label className="library-sort">
            <span>Sırala</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')}>
              <option value="newest">En yeni</option>
              <option value="oldest">En eski</option>
            </select>
          </label>
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
