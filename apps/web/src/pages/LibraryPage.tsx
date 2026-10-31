import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Disc3,
  HardDrive,
  LibraryBig,
  ListMusic,
  Loader2,
  Plus,
  RefreshCw,
  Clock3,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { EmptyState } from '../components/EmptyState';
import { PlaylistCard } from '../components/PlaylistCard';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { useUiStore } from '../store/ui';
import { useToastStore } from '../store/toast';
import {
  formatBytes,
  formatCount,
  formatDate,
  formatLongDuration,
} from '../lib/format';

type LibraryTab = 'tracks' | 'albums' | 'artists' | 'playlists';

const TABS: Array<{ id: LibraryTab; label: string; icon: typeof ListMusic }> = [
  { id: 'tracks', label: 'Şarkılar', icon: ListMusic },
  { id: 'albums', label: 'Albümler', icon: Disc3 },
  { id: 'artists', label: 'Sanatçılar', icon: Users },
  { id: 'playlists', label: 'Çalma listeleri', icon: LibraryBig },
];

export function LibraryPage() {
  const { library, playlists, refreshLibrary, refreshPlaylists } = useMusicData();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: LibraryTab = TABS.some((item) => item.id === rawTab) ? (rawTab as LibraryTab) : 'tracks';
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const openCreatePlaylist = useUiStore((state) => state.openCreatePlaylist);
  const [lastScanLabel, setLastScanLabel] = useState<string | null>(null);

  const setTab = (value: LibraryTab) => {
    const next = new URLSearchParams(params);
    if (value === 'tracks') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };

  const scanMutation = useMutation({
    mutationFn: () => {
      setLastScanLabel(null);
      return api.scan();
    },
    onSuccess: async (result) => {
      await refreshLibrary();
      await refreshPlaylists();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['playlist'] }),
        queryClient.invalidateQueries({ queryKey: ['health'] }),
      ]);
      const bits = [
        `${result.scanned} dosya tarandı`,
        result.added > 0 ? `${result.added} yeni` : null,
        result.updated > 0 ? `${result.updated} güncellendi` : null,
        result.removed > 0 ? `${result.removed} kaldırıldı` : null,
        result.failed > 0 ? `${result.failed} hata` : null,
      ].filter(Boolean);
      const message = bits.join(' · ');
      setLastScanLabel(message);
      pushToast(
        result.failed > 0 ? `${message}. Ayrıntılar sunucu günlüğünde.` : 'Kitaplık güncellendi.',
        result.failed > 0 ? 'info' : 'success',
      );
    },
    onError: (error) => {
      pushToast(error instanceof Error ? error.message : 'Kitaplık taranamadı.', 'error');
    },
  });

  const subtitle = useMemo(() => {
    const parts = [
      `${formatCount(library.stats.tracks)} parça`,
      `${formatCount(library.stats.albums)} albüm`,
      `${formatCount(library.stats.artists)} sanatçı`,
    ];
    return parts.join(' · ');
  }, [library.stats]);

  return (
    <div className="page library-page">
      <header className="page-heading library-heading">
        <div className="library-heading-copy">
          <span className="eyebrow">Koleksiyonun</span>
          <h1>Kitaplık</h1>
          <p>{subtitle}</p>
        </div>
        <div className="library-heading-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            {scanMutation.isPending ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            {scanMutation.isPending ? 'Taranıyor…' : 'Yeniden tara'}
          </button>
        </div>
      </header>

      <div className="library-stats">
        <div className="library-stat">
          <span className="library-stat-icon">
            <ListMusic size={17} />
          </span>
          <span>
            <strong>{formatCount(library.stats.tracks)}</strong>
            <small>parça</small>
          </span>
        </div>
        <div className="library-stat">
          <span className="library-stat-icon">
            <Clock3 size={17} />
          </span>
          <span>
            <strong>{formatLongDuration(library.stats.totalDuration)}</strong>
            <small>toplam süre</small>
          </span>
        </div>
        <div className="library-stat">
          <span className="library-stat-icon">
            <HardDrive size={17} />
          </span>
          <span>
            <strong>{formatBytes(library.stats.totalSize)}</strong>
            <small>disk kullanımı</small>
          </span>
        </div>
        <div className="library-stat library-stat-scan">
          <span className="status-dot" />
          <span>
            <strong>Son tarama</strong>
            <small>{formatDate(library.stats.lastScanAt)}</small>
          </span>
        </div>
      </div>

      {lastScanLabel ? <p className="scan-note">{lastScanLabel}</p> : null}

      <div className="library-tabs" role="tablist" aria-label="Kitaplık görünümü">
        {TABS.map(({ id, label, icon: Icon }) => {
          const count =
            id === 'tracks'
              ? library.tracks.length
              : id === 'albums'
                ? library.albums.length
                : id === 'artists'
                  ? library.artists.length
                  : playlists.length;
          return (
            <button
              type="button"
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={clsx('library-tab', tab === id && 'is-active')}
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
              {label}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {tab === 'tracks' ? (
        library.tracks.length > 0 ? (
          <div className="surface-panel">
            <TrackList tracks={library.tracks} />
          </div>
        ) : (
          <EmptyState
            icon={ListMusic}
            title="Henüz parça yok"
            description="Sunucundaki müzik klasörüne dosya ekleyip kitaplığı yeniden tara."
            action={
              <button type="button" className="button primary" onClick={() => scanMutation.mutate()}>
                <RefreshCw size={16} />
                Şimdi tara
              </button>
            }
          />
        )
      ) : null}

      {tab === 'albums' ? (
        <div className="card-grid album-grid">
          {library.albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      ) : null}

      {tab === 'artists' ? (
        <div className="card-grid artist-grid">
          {library.artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </div>
      ) : null}

      {tab === 'playlists' ? (
        <div className="card-grid playlist-grid">
          <button type="button" className="create-playlist-card" onClick={openCreatePlaylist}>
            <span>
              <Plus size={22} />
            </span>
            <strong>Yeni çalma listesi</strong>
            <small>Kendi seçkini oluştur.</small>
          </button>
          {playlists.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </div>
      ) : null}

      {tab === 'playlists' && playlists.length === 0 ? (
        <p className="library-empty-note">
          Henüz çalma listen yok. Yukarıdaki kartla ilk listeni oluşturabilir veya{' '}
          <Link to="/search">arama sayfasından</Link> parça ekleyebilirsin.
        </p>
      ) : null}
    </div>
  );
}
