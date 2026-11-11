import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Cloud, CloudDownload, Copy, ImagePlus, Link2, ListMusic, Pencil, Pin, PinOff, Play, Search, ShieldCheck, Shuffle, TriangleAlert } from 'lucide-react';
import { ApiError, api } from '../api';
import { Cover } from '../components/Cover';
import { DownloadButton } from '../components/DownloadButton';
import { EditPlaylistDialog } from '../components/EditPlaylistDialog';
import { EmptyState } from '../components/EmptyState';
import { PlayButton } from '../components/PlayButton';
import { Skeleton, TrackListSkeleton } from '../components/Skeleton';
import { resizeImage } from '../lib/image';
import { externalProviderLabel, externalToTrack } from '../lib/externalTrack';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { useMemo } from 'react';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import { formatBytes, formatDate, formatDuration, formatLongDuration, shuffle } from '../lib/format';
import type { Track } from '../types';

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
  const downloadRecords = useDownloads((state) => state.records);
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

  const removeExternalMutation = useMutation({
    mutationFn: ({ entryId }: { entryId: number; title: string }) => api.removeExternalTrack(id ?? '', entryId),
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

  // Artwork must be requested before the early returns so the hook order stays
  // stable while the playlist is loading.
  const baseTracks = useMemo<Track[]>(() => {
    const data = playlistQuery.data;
    if (!data) return [];
    return [
      ...data.tracks.map((track) => ({ position: track.position, track })),
      ...(data.externalTracks ?? []).map((external) => ({
        position: external.position,
        track: externalToTrack(external),
      })),
    ]
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.track);
  }, [playlistQuery.data]);
  const { tracks: artworkTracks } = useTrackArtwork(baseTracks, playlistQuery.data?.coverUrl ?? null);
  const artworkById = useMemo(
    () => new Map(artworkTracks.map((track) => [track.id, track.coverUrl])),
    [artworkTracks],
  );

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
  const externalTracks = playlist.externalTracks ?? [];
  const entries = [
    ...tracks.map((track) => ({
      position: track.position,
      kind: 'track' as const,
      track,
      external: undefined,
    })),
    ...externalTracks.map((external) => ({
      position: external.position,
      kind: 'external' as const,
      track: undefined,
      external,
    })),
  ].sort((a, b) => a.position - b.position);

  // Imported references are playable too: an upload id streams directly, the
  // rest resolve from metadata at play time, exactly like a search result.
  const orderedTracks: Track[] = entries.map((entry) => {
    const track = entry.kind === 'track' && entry.track ? entry.track : externalToTrack(entry.external!);
    const art = artworkById.get(track.id);
    return art ? { ...track, coverUrl: art } : track;
  });
  const totalDuration =
    orderedTracks.reduce((sum, track) => sum + (track.duration || 0), 0) || playlist.duration;
  const eligibleDownloads = orderedTracks.filter((track) => downloadRecords[track.id]?.state !== 'downloaded');
  const eligibleBytes = eligibleDownloads.reduce((sum, track) => sum + track.size, 0);
  const downloadingCount = orderedTracks.filter((track) => ['downloading', 'queued'].includes(downloadRecords[track.id]?.state ?? '')).length;
  const downloadedCount = orderedTracks.length - eligibleDownloads.length;
  const sourceLabel = playlist.sourceProvider
    ? playlist.sourceProvider === 'spotify'
      ? 'Spotify'
      : playlist.sourceProvider === 'youtube-music'
        ? 'YouTube Music'
        : playlist.sourceProvider === 'youtube'
          ? 'YouTube'
          : 'NorieMusic'
    : null;

  const removeTrack = (track: Track & { entryId: number }) => {
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
            <span>{orderedTracks.length} parça</span>
            <span aria-hidden="true">·</span>
            <span>{formatLongDuration(totalDuration)}</span>
            <span aria-hidden="true">·</span>
            <span>Güncellendi {formatDate(playlist.updatedAt)}</span>
            {sourceLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{sourceLabel} kaynağı</span>
              </>
            ) : null}
          </div>
          <div className="import-status-row" aria-label="Liste durumu">
            <span className="status-pill"><Cloud size={13} /> Hesaba kaydedildi</span>
            <span className="status-pill"><ShieldCheck size={13} /> {orderedTracks.length} çalınabilir</span>
            {downloadedCount ? (
              <span className="status-pill is-success">✓ {downloadedCount} bu cihazda indirildi</span>
            ) : null}
            {downloadingCount ? (
              <span className="status-pill">{downloadingCount} indiriliyor</span>
            ) : null}
            {eligibleDownloads.length && tracks.length ? (
              <span className="status-pill"><CloudDownload size={13} /> {eligibleDownloads.length} indirilebilir · {formatBytes(eligibleBytes)}</span>
            ) : null}
          </div>
          {playlist.sourceUrl ? (
            <a className="detail-source" href={playlist.sourceUrl} target="_blank" rel="noreferrer">
              Kaynak listeyi aç
            </a>
          ) : null}

          <div className="detail-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => playQueue(orderedTracks)}
              disabled={orderedTracks.length === 0}
            >
              <Play size={17} fill="currentColor" />
              Listeyi çal
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => playQueue(shuffle(orderedTracks))}
              disabled={orderedTracks.length === 0}
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
                if (eligibleDownloads.length === 0) {
                  pushToast('Çalınabilir tüm parçalar zaten bu cihazda indirili.', 'info');
                  return;
                }
                void Promise.all(eligibleDownloads.map((track) => downloadTrack(track).catch(() => undefined))).then(() =>
                  pushToast('Liste indirme tamamlandı.', 'success'),
                );
                pushToast(`${eligibleDownloads.length} parça indiriliyor…`, 'info');
              }}
              disabled={orderedTracks.length === 0}
            >
              <CloudDownload size={16} />
              Tümünü indir
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
            <p>
              {orderedTracks.length > 0
                ? `${orderedTracks.length} parça · ${formatLongDuration(totalDuration)}`
                : 'Liste henüz boş'}
            </p>
          </div>
          <Link to="/search" className="section-link">
            <Search size={15} />
            Şarkı ekle
          </Link>
        </div>

        {entries.length > 0 ? (
          <div className="surface-panel import-track-list">
            {entries.map((entry, displayIndex) => {
              if (entry.kind === 'track' && entry.track) {
                const track = entry.track;
                const trackIndex = orderedTracks.findIndex((candidate) => candidate.id === track.id);
                return (
                  <article className="import-track-row is-playable" key={`track-${track.entryId}`}>
                    <span className="import-order">{displayIndex + 1}</span>
                    <Cover src={track.coverUrl} alt="" seed={track.id} className="import-cover" iconSize={16} />
                    <div className="import-copy">
                      <strong>{track.title}</strong>
                      <span>{track.artist}{track.album ? ` · ${track.album}` : ''}</span>
                      <small>Kütüphanende · {formatDuration(track.duration)}</small>
                    </div>
                    <PlayButton tracks={orderedTracks} index={trackIndex} size="sm" label={`${track.title} çal`} />
                    <DownloadButton track={track} />
                    <div className="import-row-actions">
                      {playlist.isOwner ? (
                        <>
                          <button type="button" className="icon-button subtle" onClick={() => moveTrack(trackIndex, -1)} disabled={trackIndex <= 0} aria-label="Yukarı taşı">↑</button>
                          <button type="button" className="icon-button subtle" onClick={() => moveTrack(trackIndex, 1)} disabled={trackIndex >= tracks.length - 1} aria-label="Aşağı taşı">↓</button>
                          <button type="button" className="icon-button subtle" onClick={() => removeTrack(track)} aria-label="Parçayı listeden çıkar">×</button>
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              }
              const external = entry.external!;
              const externalTrack = externalToTrack(external);
              return (
                <article className="import-track-row is-playable" key={`external-${external.entryId}`}>
                  <span className="import-order">{displayIndex + 1}</span>
                  <Cover src={artworkById.get(externalToTrack(external).id) ?? external.artworkUrl} alt="" seed={`${external.title}-${external.artist}`} className="import-cover" iconSize={16} />
                  <div className="import-copy">
                    <strong>{external.title}</strong>
                    <span>{external.artist}{external.album ? ` · ${external.album}` : ''}</span>
                    <small>
                      {externalProviderLabel(external.provider)}
                      {external.duration ? ` · ${formatDuration(external.duration)}` : ''}
                    </small>
                  </div>
                  <PlayButton tracks={orderedTracks} index={displayIndex} size="sm" label={`${external.title} çal`} />
                  <DownloadButton track={externalTrack} />
                  <div className="import-row-actions">
                    {playlist.isOwner ? (
                      <button
                        type="button"
                        className="icon-button subtle"
                        onClick={() => removeExternalMutation.mutate({ entryId: external.entryId, title: external.title })}
                        aria-label="Parçayı listeden çıkar"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
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
