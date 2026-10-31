import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ListMusic, Pencil, Play, Search, Shuffle } from 'lucide-react';
import { ApiError, api } from '../api';
import { Cover } from '../components/Cover';
import { EditPlaylistDialog } from '../components/EditPlaylistDialog';
import { EmptyState } from '../components/EmptyState';
import { Skeleton, TrackListSkeleton } from '../components/Skeleton';
import { TrackList, type TrackListItem } from '../components/TrackList';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import { formatDate, formatLongDuration, shuffle } from '../lib/format';

function PlaylistSkeleton() {
  return (
    <div className="page detail-page">
      <Skeleton className="skeleton-detail-back" />
      <div className="detail-hero">
        <Skeleton className="skeleton-detail-cover" />
        <div className="detail-copy">
          <Skeleton className="skeleton-eyebrow" />
          <Skeleton className="skeleton-detail-title" />
          <Skeleton className="skeleton-subtitle wide" />
          <Skeleton className="skeleton-actions" />
        </div>
      </div>
      <TrackListSkeleton rows={6} />
    </div>
  );
}

export function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const playQueue = usePlayer((state) => state.playQueue);
  const pushToast = useToastStore((state) => state.push);
  const [editing, setEditing] = useState(false);

  const playlistQuery = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.playlist(id ?? ''),
    enabled: Boolean(id),
    staleTime: 10_000,
    retry: false,
  });

  const removeMutation = useMutation({
    mutationFn: ({ entryId }: { entryId: number; title: string }) => api.removeTrack(id ?? '', entryId),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['playlist', id] }),
        queryClient.invalidateQueries({ queryKey: ['playlists'] }),
      ]);
      pushToast(`“${variables.title}” listeden çıkarıldı.`, 'info');
    },
    onError: (error) => {
      pushToast(error instanceof Error ? error.message : 'Parça listeden çıkarılamadı.', 'error');
    },
  });

  if (playlistQuery.isPending) return <PlaylistSkeleton />;

  if (playlistQuery.isError || !playlistQuery.data) {
    const notFound =
      playlistQuery.error instanceof ApiError && playlistQuery.error.status === 404;
    return (
      <div className="page">
        <EmptyState
          icon={ListMusic}
          title={notFound ? 'Çalma listesi bulunamadı' : 'Liste yüklenemedi'}
          description={
            notFound
              ? 'Bu liste silinmiş olabilir ya da bağlantı geçersiz.'
              : playlistQuery.error instanceof Error
                ? playlistQuery.error.message
                : 'Çalma listesi yüklenirken bir sorun oluştu.'
          }
          action={
            <Link to="/library?tab=playlists" className="button primary">
              Çalma listelerine dön
            </Link>
          }
        />
      </div>
    );
  }

  const playlist = playlistQuery.data;
  const tracks = playlist.tracks;

  const removeTrack = (track: TrackListItem) => {
    if (!track.entryId) return;
    removeMutation.mutate({ entryId: track.entryId, title: track.title });
  };

  return (
    <div className="page detail-page">
      <button type="button" className="detail-back" onClick={() => navigate(-1)}>
        <ChevronLeft size={17} />
        Geri
      </button>

      <header className="detail-hero playlist-detail-hero">
        <div className="detail-art">
          <div className="detail-art-disc" aria-hidden="true" />
          <Cover
            src={playlist.coverUrl}
            alt={playlist.name}
            seed={playlist.id}
            className="detail-cover"
            eager
            iconSize={42}
          />
        </div>
        <div className="detail-copy">
          <span className="eyebrow">Çalma listesi</span>
          <h1>{playlist.name}</h1>
          <p className="detail-byline detail-description">
            {playlist.description || 'Kendi seçtiğin parçalardan oluşan kişisel bir liste.'}
          </p>
          <div className="detail-meta">
            <span>{playlist.trackCount} parça</span>
            <span aria-hidden="true">·</span>
            <span>{formatLongDuration(playlist.duration)}</span>
            <span aria-hidden="true">·</span>
            <span>Güncellendi {formatDate(playlist.updatedAt)}</span>
          </div>

          <div className="detail-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => playQueue(tracks)}
              disabled={tracks.length === 0}
            >
              <Play size={17} fill="currentColor" />
              Listeyi çal
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
            <button type="button" className="button ghost" onClick={() => setEditing(true)}>
              <Pencil size={16} />
              Düzenle
            </button>
          </div>
        </div>
      </header>

      <section className="detail-tracks">
        <div className="section-heading">
          <div>
            <h2>Parçalar</h2>
            <p>{tracks.length > 0 ? `${tracks.length} parça sırada` : 'Liste henüz boş'}</p>
          </div>
          <Link to="/search" className="section-link">
            <Search size={15} />
            Şarkı ekle
          </Link>
        </div>

        {tracks.length > 0 ? (
          <div className="surface-panel">
            <TrackList
              tracks={tracks}
              onRemove={removeTrack}
              removeLabel="Parçayı listeden çıkar"
            />
          </div>
        ) : (
          <EmptyState
            icon={ListMusic}
            title="Bu liste henüz boş"
            description="Arama sayfasından parça bulup “Çalma listesine ekle” düğmesiyle bu listeyi doldurabilirsin."
            action={
              <Link to="/search" className="button primary">
                <Search size={16} />
                Şarkı ara
              </Link>
            }
          />
        )}
      </section>

      {editing ? (
        <EditPlaylistDialog playlist={playlist} open={editing} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
