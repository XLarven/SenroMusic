import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Disc3,
  HardDrive,
  LayoutGrid,
  LibraryBig,
  List,
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
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { PlaylistCard } from '../components/PlaylistCard';
import { PlayButton } from '../components/PlayButton';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { useDownloads } from '../store/downloads';
import { useFavorites } from '../store/favorites';
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
  const favoriteIds = useFavorites((state) => state.ids);
  const downloadRecords = useDownloads((state) => state.records);
  const [lastScanLabel, setLastScanLabel] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [trackFilter, setTrackFilter] = useState<'all' | 'downloaded' | 'available' | 'favorites'>('all');
  const [playlistFilter, setPlaylistFilter] = useState<'all' | 'pinned' | 'public' | 'private'>('all');
  const [sort, setSort] = useState<'new' | 'title' | 'artist' | 'duration'>('new');

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

  const visibleTracks = useMemo(() => {
    const filtered = library.tracks.filter((track) => {
      if (trackFilter === 'downloaded') return downloadRecords[track.id]?.state === 'downloaded';
      if (trackFilter === 'available') return downloadRecords[track.id]?.state !== 'downloaded';
      if (trackFilter === 'favorites') return favoriteIds.includes(track.id);
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'tr');
      if (sort === 'artist') return a.artist.localeCompare(b.artist, 'tr') || a.title.localeCompare(b.title, 'tr');
      if (sort === 'duration') return b.duration - a.duration;
      return b.addedAt.localeCompare(a.addedAt);
    });
  }, [downloadRecords, favoriteIds, library.tracks, sort, trackFilter]);

  const visiblePlaylists = useMemo(() => {
    const own = playlists.filter((playlist) => playlist.isOwner);
    const filtered = own.filter((playlist) => {
      if (playlistFilter === 'pinned') return playlist.pinned;
      if (playlistFilter === 'public') return playlist.visibility === 'public';
      if (playlistFilter === 'private') return playlist.visibility === 'private';
      return true;
    });
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [playlistFilter, playlists]);
  const pinnedPlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.isOwner && playlist.pinned),
    [playlists],
  );

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

      <div className="library-controls">
        <div className="view-toggle" role="group" aria-label="Görünüm biçimi">
          <button type="button" className={clsx('icon-button', view === 'list' && 'is-active')} onClick={() => setView('list')} aria-label="Liste görünümü" title="Liste görünümü"><List size={16} /></button>
          <button type="button" className={clsx('icon-button', view === 'grid' && 'is-active')} onClick={() => setView('grid')} aria-label="Izgara görünümü" title="Izgara görünümü"><LayoutGrid size={16} /></button>
        </div>
        {tab === 'tracks' ? (
          <div className="filter-pills" role="group" aria-label="Parça filtreleri">
            <button type="button" className={clsx('filter-pill', trackFilter === 'all' && 'is-active')} onClick={() => setTrackFilter('all')}>Tümü</button>
            <button type="button" className={clsx('filter-pill', trackFilter === 'downloaded' && 'is-active')} onClick={() => setTrackFilter('downloaded')}>Bu cihazda indirilen</button>
            <button type="button" className={clsx('filter-pill', trackFilter === 'available' && 'is-active')} onClick={() => setTrackFilter('available')}>Akış için uygun</button>
            <button type="button" className={clsx('filter-pill', trackFilter === 'favorites' && 'is-active')} onClick={() => setTrackFilter('favorites')}>Favoriler</button>
          </div>
        ) : null}
        {tab === 'playlists' ? (
          <div className="filter-pills" role="group" aria-label="Liste filtreleri">
            <button type="button" className={clsx('filter-pill', playlistFilter === 'all' && 'is-active')} onClick={() => setPlaylistFilter('all')}>Tümü</button>
            <button type="button" className={clsx('filter-pill', playlistFilter === 'pinned' && 'is-active')} onClick={() => setPlaylistFilter('pinned')}>Sabitlenen</button>
            <button type="button" className={clsx('filter-pill', playlistFilter === 'public' && 'is-active')} onClick={() => setPlaylistFilter('public')}>Herkese açık</button>
            <button type="button" className={clsx('filter-pill', playlistFilter === 'private' && 'is-active')} onClick={() => setPlaylistFilter('private')}>Özel</button>
          </div>
        ) : null}
        <label className="library-sort">
          <span>Sırala</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="new">En yeni</option>
            <option value="title">Başlık A-Z</option>
            <option value="artist">Sanatçı A-Z</option>
            <option value="duration">En uzun</option>
          </select>
        </label>
      </div>

      {tab === 'tracks' ? (
        visibleTracks.length > 0 ? (
          <div className="surface-panel">
            {view === 'grid' ? (
              <div className="card-grid track-grid">
                {visibleTracks.map((track) => (
                  <article className="track-card" key={track.id}>
                    <div className="track-card-cover">
                      <Cover src={track.coverUrl} alt="" seed={track.id} className="track-card-img" />
                      <PlayButton tracks={[track]} size="sm" label={`${track.title} çal`} />
                    </div>
                    <div className="track-card-copy">
                      <strong>{track.title}</strong>
                      <span>{track.artist}</span>
                      <small>{downloadRecords[track.id]?.state === 'downloaded' ? 'Bu cihazda indirildi' : 'Akış için uygun'}</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <TrackList tracks={visibleTracks} />
            )}
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
        view === 'list' ? (
          <div className="surface-panel album-list">
            {library.albums.map((album) => {
              const albumTracks = library.tracks.filter((track) => track.albumArtist === album.artist && track.album === album.name);
              return (
                <article className="album-row" key={album.id}>
                  <Cover src={album.coverUrl} alt="" seed={album.id} className="album-row-cover" />
                  <div className="album-row-copy">
                    <strong>{album.name}</strong>
                    <span><Link to={`/search?q=${encodeURIComponent(album.artist)}`}>{album.artist}</Link> · {album.trackCount} parça</span>
                  </div>
                  <PlayButton tracks={albumTracks} size="sm" label={`${album.name} çal`} />
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card-grid album-grid">
            {library.albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )
      ) : null}

      {tab === 'artists' ? (
        view === 'list' ? (
          <div className="surface-panel album-list">
            {library.artists.map((artist) => {
              const artistTracks = library.tracks.filter((track) => track.artist === artist.name);
              return (
                <article className="album-row" key={artist.id}>
                  <Cover src={artist.coverUrl} alt="" seed={artist.id} className="album-row-cover" />
                  <div className="album-row-copy">
                    <strong>{artist.name}</strong>
                    <span>{artist.trackCount} parça · {artist.albumCount} albüm</span>
                  </div>
                  <PlayButton tracks={artistTracks} size="sm" label={`${artist.name} çal`} />
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card-grid artist-grid">
            {library.artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        )
      ) : null}

      {tab === 'playlists' && pinnedPlaylists.length > 0 ? (
        <section className="content-section">
          <div className="section-heading"><div><h2>Sabitlenenler</h2><p>Her zaman üstte görünür.</p></div></div>
          <div className="card-grid playlist-grid">
            {pinnedPlaylists.map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} />)}
          </div>
        </section>
      ) : null}

      {tab === 'playlists' ? (
        view === 'list' ? (
          <div className="surface-panel album-list">
            {visiblePlaylists.map((playlist) => (
              <article className="album-row" key={playlist.id}>
                <Cover src={playlist.coverUrl} alt="" seed={playlist.id} className="album-row-cover" />
                <div className="album-row-copy">
                  <strong>{playlist.name}</strong>
                  <span>
                    {playlist.trackCount} parça · {playlist.visibility === 'public' ? 'Herkese açık' : 'Özel'}
                    {playlist.sourceProvider ? ` · ${playlist.sourceProvider === 'spotify' ? 'Spotify' : playlist.sourceProvider === 'youtube' ? 'YouTube' : playlist.sourceProvider === 'youtube-music' ? 'YouTube Music' : 'NorieMusic'} kaynağı` : ''}
                  </span>
                </div>
                <Link className="button secondary compact" to={`/playlist/${playlist.id}`}>Aç</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="card-grid playlist-grid">
            <button type="button" className="create-playlist-card" onClick={openCreatePlaylist}>
              <span>
                <Plus size={22} />
              </span>
              <strong>Yeni çalma listesi</strong>
              <small>Kendi seçkini oluştur.</small>
            </button>
            {visiblePlaylists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        )
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
