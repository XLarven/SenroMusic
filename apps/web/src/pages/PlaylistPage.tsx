import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CloudDownload, Copy, ImagePlus, Link2, ListMusic, Pencil, Pin, PinOff, Play, Search, Shuffle } from 'lucide-react';
import { ApiError, api } from '../api';
import { Cover } from '../components/Cover';
import { EditPlaylistDialog } from '../components/EditPlaylistDialog';
import { EmptyState } from '../components/EmptyState';
import { Skeleton, TrackListSkeleton } from '../components/Skeleton';
import { TrackList, type TrackListItem } from '../components/TrackList';
import { resizeImage } from '../lib/image';
import { useDownloads } from '../store/downloads';
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
  const downloadTrack = useDownloads((state) => state.download);
  const [editing, setEditing] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const playlistQuery = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.playlist(id ?? ''),
    enabled: Boolean(id),
    staleTime: 10_000,
    retry: false,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['playlist', id] }),
      queryClient.invalidateQueries({ queryKey: ['playlists'] }),
    ]);
  };

  const removeMutation = useMutation({
    mutationFn: ({ entryId }: { entryId: number; title: string }) => api.removeTrack(id ?? '', entryId),
    onSuccess: async (_result, variables) => {
      await invalidate();
      pushToast(`“${variables.title}” listeden çıkarıldı.`, 'info');
    },
    onError: (error) => {
      pushToast(error instanceof Error ? error.message : 'Parça listeden çıkarılamadı.', 'error');
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => api.duplicatePlaylist(id ?? ''),
    onSuccess: async (copy) => {
      await invalidate();
      pushToast('Liste çoğaltıldı.', 'success');
      navigate(`/playlist/${copy.id}`);
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : 'Liste çoğaltılamadı.', 'error'),
  });

  const pinMutation = useMutation({
    mutationFn: () => api.pinPlaylist(id ?? ''),
    onSuccess: async (result) => {
      await invalidate();
      pushToast(result.pinned ? 'Liste sabitlendi.' : 'Sabitleme kaldırıldı.', 'success');
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : 'Sabitleme güncellenemedi.', 'error'),
  });

  const shareMutation = useMutation({
    mutationFn: () => api.sharePlaylist(id ?? ''),
    onSuccess: async (result) => {
      await invalidate();
      const url = `${window.location.origin}/p/${result.shareSlug}`;
      try {
        await navigator.clipboard.writeText(url);
        pushToast('Herkese açık paylaşım bağlantısı kopyalandı.', 'success');
      } catch {
        pushToast('Liste herkese açık yapıldı. Bağlantıyı yeniden oluşturmayı dene.', 'info');
      }
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : 'Bağlantı oluşturulamadı.', 'error'),
  });

  const coverMutation = useMutation({
    mutationFn: (imageDataUrl: string) => api.uploadPlaylistCover(id ?? '', imageDataUrl),
    onSuccess: async () => {
      await invalidate();
      pushToast('Liste kapağı güncellendi.', 'success');
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : 'Kapak güncellenemedi.', 'error'),
  });

  const reorderMutation = useMutation({
    mutationFn: (entryIds: number[]) => api.reorderPlaylist(id ?? '', entryIds),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (error) => pushToast(error instanceof Error ? error.message : 'Sıra güncellenemedi.', 'error'),
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

  const moveTrack = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= tracks.length) return;
    const entryIds = tracks.map((track) => track.entryId).filter((entryId): entryId is number => typeof entryId === 'number');
    if (entryIds.length !== tracks.length) return;
    const moved = entryIds[index];
    entryIds[index] = entryIds[target];
    entryIds[target] = moved;
    reorderMutation.mutate(entryIds);
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
            {playlist.isOwner ? (
              <>
                <button type="button" className="button ghost" onClick={() => setEditing(true)}>
                  <Pencil size={16} />
                  Düzenle
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => duplicateMutation.mutate()}
                  disabled={duplicateMutation.isPending}
                >
                  <Copy size={16} />
                  Çoğalt
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => pinMutation.mutate()}
                  disabled={pinMutation.isPending}
                >
                  {playlist.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  Sabitle
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => shareMutation.mutate()}
                  disabled={shareMutation.isPending}
                >
                  <Link2 size={16} />
                  Paylaş
                </button>
                <button type="button" className="button ghost" onClick={() => coverInputRef.current?.click()}>
                  <ImagePlus size={16} />
                  Kapak
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                void Promise.all(tracks.map((track) => downloadTrack(track))).then(() =>
                  pushToast('Liste indirildi.', 'success'),
                );
              }}
              disabled={tracks.length === 0}
            >
              <CloudDownload size={16} />
              İndir
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file || !id) return;
                void resizeImage(file, 640)
                  .then((dataUrl) => coverMutation.mutate(dataUrl))
                  .catch((error) => pushToast(error instanceof Error ? error.message : 'Görsel işlenemedi.', 'error'));
              }}
            />
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
              onMove={playlist.isOwner ? moveTrack : undefined}
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
