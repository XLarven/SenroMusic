import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock3, HardDrive, Heart, Play, Search, Upload } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import { AlbumCard } from '../components/AlbumCard';
import { DiscoveryFeed } from '../features/discovery/DiscoveryFeed';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { PlayButton } from '../components/PlayButton';
import { useMusicData } from '../MusicDataContext';
import { useAuthStore } from '../store/auth';
import { usePlayer } from '../store/player';
import { useFavorites } from '../store/favorites';
import { getAppLanguage, localeForLanguage } from '../lib/i18n';
import type { Track } from '../types';
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatLongDuration,
  greeting,
  recentAlbums,
  shuffle,
} from '../lib/format';

export function HomePage() {
  const { library, playlists } = useMusicData();
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const playQueue = usePlayer((state) => state.playQueue);
  const favIds = useFavorites((state) => state.ids);
  const toggleFav = useFavorites((state) => state.toggle);
  const historyQuery = useQuery({
    queryKey: ['history', 12],
    queryFn: () => api.history(12),
    staleTime: 30_000,
  });

  const albums = recentAlbums(library, 10);
  const featured = albums[0] ?? library.albums[0] ?? null;
  const featuredTracks = featured
    ? library.tracks.filter(
        (track) => track.albumArtist === featured.artist && track.album === featured.name,
      )
    : [];
  const featuredFaved = featuredTracks.length > 0 && featuredTracks.every((t) => favIds.includes(t.id));
  const recentTracks = [...library.tracks]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .slice(0, 6);

  type QuickItem = {
    id: string;
    title: string;
    subtitle: string;
    coverUrl: string | null;
    tracks?: Track[];
    to?: string;
  };

  const historyTracks = useMemo(
    () => (historyQuery.data?.items ?? []).map((item) => item.track),
    [historyQuery.data],
  );
  const favoriteTracks = useMemo(
    () => library.tracks.filter((track) => favIds.includes(track.id)),
    [favIds, library.tracks],
  );
  const pinnedPlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.isOwner && playlist.pinned),
    [playlists],
  );
  const ownPlaylists = useMemo(() => playlists.filter((playlist) => playlist.isOwner), [playlists]);

  const quickItems = useMemo<QuickItem[]>(() => {
    const items: QuickItem[] = [
      ...pinnedPlaylists.map((playlist) => ({
        id: `pl-${playlist.id}`,
        title: playlist.name,
        subtitle: 'Sabitlenen liste',
        coverUrl: playlist.coverUrl,
        to: `/playlist/${playlist.id}`,
      })),
      ...historyTracks.map((track) => ({
        id: `history-${track.id}`,
        title: track.title,
        subtitle: `${track.artist} · Son dinlenen`,
        coverUrl: track.coverUrl,
        tracks: [track],
      })),
      ...favoriteTracks.slice(0, 4).map((track) => ({
        id: `fav-${track.id}`,
        title: track.title,
        subtitle: `${track.artist} · Favori`,
        coverUrl: track.coverUrl,
        tracks: [track],
      })),
      ...ownPlaylists.slice(0, 4).map((playlist) => ({
        id: `own-${playlist.id}`,
        title: playlist.name,
        subtitle: `${playlist.trackCount} parça`,
        coverUrl: playlist.coverUrl,
        to: `/playlist/${playlist.id}`,
      })),
    ];
    return items.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 8);
  }, [favoriteTracks, historyTracks, ownPlaylists, pinnedPlaylists]);

  const personalEmpty = pinnedPlaylists.length === 0 && ownPlaylists.length === 0 && favoriteTracks.length === 0 && historyTracks.length === 0;
  const jumpBackIn = historyTracks.length > 0 ? historyTracks : recentTracks.slice(0, 6);
  const favoriteArtists = useMemo(() => {
    const artists = [...new Set(favoriteTracks.map((track) => track.artist))];
    return library.albums.filter((album) => artists.includes(album.artist)).slice(0, 5);
  }, [favoriteTracks, library.albums]);
  const newReleases = useMemo(
    () => [...library.albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 5),
    [library.albums],
  );
  const genreCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of library.tracks) {
      if (!track.genre) continue;
      map.set(track.genre, (map.get(track.genre) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  }, [library.tracks]);

  const today = new Intl.DateTimeFormat(localeForLanguage(getAppLanguage()), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const toggleFeaturedFav = () => {
    for (const track of featuredTracks) {
      const has = favIds.includes(track.id);
      if (featuredFaved === has) toggleFav(track.id);
    }
  };

  return (
    <div className="page home-page">
      <div className="home-topline">
        <span className="eyebrow">
          {greeting()}{user?.displayName ? `, ${user.displayName}` : ''} · {today}
        </span>
        <span className="home-topline-status">
          <span>Kişisel keşif</span>
        </span>
      </div>

      <div className="home-layout">
        <div className="home-main">
          <section className="home-hero">
          <div className="home-hero-copy">
            <span className="eyebrow">Öne Çıkan</span>
            <h1>{featured ? featured.name : 'Müziğin seni bekliyor'}</h1>
            <p>{featured ? featured.artist : 'Kütüphaneni keşfet'}</p>
            {featured ? (
              <div className="home-hero-meta">
                {featured.year ? <span>{featured.year}</span> : null}
                <span>{featuredTracks.length || formatCount(library.stats.tracks)} parça</span>
                <span>{formatCount(library.stats.artists)} sanatçı</span>
              </div>
            ) : null}
            <div className="home-hero-actions">
              <button
                type="button"
                className="button primary"
                onClick={() =>
                  playQueue(featuredTracks.length > 0 ? shuffle(featuredTracks) : shuffle(library.tracks))
                }
              >
                <Play size={16} fill="currentColor" />
                Şimdi Dinle
              </button>
              <button
                type="button"
                className={clsx('glass-icon-button', featuredFaved && 'is-active')}
                onClick={toggleFeaturedFav}
                disabled={featuredTracks.length === 0}
                aria-label={featuredFaved ? 'Favorilerden kaldır' : 'Favorilere ekle'}
                title="Favorilere ekle"
              >
                <Heart size={18} fill={featuredFaved ? 'currentColor' : 'none'} />
              </button>
              {featured ? (
                <Link to={`/album/${featured.id}`} className="glass-icon-button" aria-label="Albümü aç" title="Albümü aç">
                  <ArrowRight size={18} />
                </Link>
              ) : null}
            </div>
          </div>

          {featured ? (
            <div className="home-feature">
              <div className="home-feature-card">
                <Link to={`/album/${featured.id}`} className="home-feature-link">
                  <Cover
                    src={featured.coverUrl}
                    alt={featured.name}
                    seed={`${featured.artist}-${featured.name}`}
                    className="home-feature-cover"
                    eager
                    iconSize={40}
                  />
                </Link>
                <div className="home-feature-play">
                  <PlayButton tracks={featuredTracks} size="lg" label={`${featured.name} albümünü çal`} />
                </div>
              </div>
            </div>
          ) : null}
        </section>

          <DiscoveryFeed />

          <section className="content-section home-quick" aria-label="Hızlı erişim">
            <div className="section-heading">
              <div>
                <h2>Hızlı erişim</h2>
                <p>Son dinlediğin, favorilerin ve sabitlenen listeler.</p>
              </div>
            </div>
            {personalEmpty ? (
              <EmptyState
                icon={Search}
                title="Müziğin kütüphanen boş."
                description="Müzik ara, bir çalma listesi içe aktar veya kendi dosyalarını ekleyerek başla."
                action={
                  <div className="empty-state-actions">
                    <Link to="/search" className="button primary"><Search size={16} /> Müzik ara</Link>
                    <Link to="/search" className="button secondary"><Upload size={16} /> İçe aktar</Link>
                    <Link to="/library" className="button ghost"><Upload size={16} /> Yerel müzik ekle</Link>
                  </div>
                }
              />
            ) : (
              <div className="quick-grid">
                {quickItems.map((item) => {
                  const content = (
                    <>
                      <Cover src={item.coverUrl} alt="" seed={item.id} className="quick-cover" iconSize={18} />
                      <span className="quick-copy">
                        <strong>{item.title}</strong>
                        <small>{item.subtitle}</small>
                      </span>
                    </>
                  );
                  return (
                    <div className="quick-item" key={item.id}>
                      {item.to ? (
                        <Link to={item.to} className="quick-link">{content}</Link>
                      ) : (
                        <button type="button" className="quick-link" onClick={() => item.tracks && playQueue(item.tracks)}>{content}</button>
                      )}
                      {item.tracks ? <PlayButton tracks={item.tracks} size="sm" label={`${item.title} çal`} /> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

        <div className="home-bottom">
          <section className="content-section">
            <div className="section-heading">
              <div>
                <h2>Trend albümler</h2>
                <p>Arşivine en son katılanlar.</p>
              </div>
              <Link to="/library?tab=albums" className="section-link">
                Tümünü gör <ArrowRight size={15} />
              </Link>
            </div>
            <div className="card-grid album-grid home-album-grid">
              {albums.slice(0, 5).map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-heading">
              <div><h2>Senin için</h2><p>{historyTracks.length > 0 ? 'Dinleme geçmişine göre sıralandı.' : 'Kişiselleştirilmiş öneriler yerine keşif listeleri gösteriliyor.'}</p></div>
            </div>
            {jumpBackIn.length > 0 ? (
              <div className="carousel-row">
                {jumpBackIn.slice(0, 5).map((track) => (
                  <button type="button" key={track.id} className="carousel-card" onClick={() => playQueue(jumpBackIn, jumpBackIn.indexOf(track))}>
                    <Cover src={track.coverUrl} alt="" seed={track.id} className="carousel-cover" />
                    <span><strong>{track.title}</strong><small>{track.artist}</small></span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {favoriteArtists.length > 0 ? (
            <section className="content-section">
              <div className="section-heading"><div><h2>Favori sanatçılarından daha fazlası</h2><p>Favori parçalarına göre önerildi.</p></div></div>
              <div className="carousel-row">
                {favoriteArtists.map((album) => <AlbumCard key={album.id} album={album} />)}
              </div>
            </section>
          ) : null}

          <section className="content-section">
            <div className="section-heading"><div><h2>Yeni çıkanlar</h2><p>Arşivindeki son albümler.</p></div></div>
            <div className="carousel-row">
              {newReleases.map((album) => <AlbumCard key={album.id} album={album} />)}
            </div>
          </section>

          {genreCounts.length > 0 ? (
            <section className="content-section">
              <div className="section-heading"><div><h2>Türlere göre keşfet</h2><p>Kütüphanendeki türlerden seç.</p></div></div>
              <div className="genre-grid">
                {genreCounts.map((genre) => (
                  <button type="button" key={genre.name} className="genre-card" onClick={() => void navigate(`/search?q=${encodeURIComponent(genre.name)}`)}>
                    <span><strong>{genre.name}</strong><small>{genre.count} parça</small></span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        </div>

        <div className="home-rail">
          <section className="home-queue rail-card" aria-label="Sıradaki parçalar">
            <h3>Şimdi Dinle</h3>
            <p>Kuyruğa alınan son parçalar</p>
            {recentTracks.slice(0, 4).map((t, index) => {
              const faved = favIds.includes(t.id);
              return (
                <div key={t.id} className="home-queue__row">
                  <button
                    type="button"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                    onClick={() => playQueue(recentTracks, index)}
                    aria-label={`${t.title} çal`}
                  >
                    <Cover src={t.coverUrl} alt="" seed={t.id} className="home-queue__cover" iconSize={16} />
                  </button>
                  <div className="meta">
                    <strong>{t.title}</strong>
                    <small>{t.artist}</small>
                  </div>
                  <span className="home-queue__time">{formatDuration(t.duration)}</span>
                  <button
                    type="button"
                    className={clsx('home-queue__fav', faved && 'is-active')}
                    onClick={() => toggleFav(t.id)}
                    aria-label={faved ? 'Favorilerden kaldır' : 'Favorilere ekle'}
                    title={faved ? 'Favorilerden kaldır' : 'Favorilere ekle'}
                  >
                    <Heart size={15} fill={faved ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    className="home-queue__play"
                    onClick={() => playQueue(recentTracks, index)}
                    aria-label={`${t.title} çal`}
                  >
                    <Play size={13} fill="currentColor" />
                  </button>
                </div>
              );
            })}
          </section>

          <aside className="analytics-card" aria-label="İstatistiklerin">
            <h3>İstatistiklerin</h3>
            <div className="vinyl" aria-hidden="true">
              ♫
            </div>
            <div className="analytics-hours">{formatLongDuration(library.stats.totalDuration)}</div>
            <small>Toplam arşiv süresi</small>
            <div className="analytics-chips">
              <span>{formatCount(library.stats.tracks)} parça</span>
              <span>{formatCount(library.stats.albums)} albüm</span>
              <span>{formatCount(library.stats.artists)} sanatçı</span>
            </div>
            <div className="analytics-footnote">
              <Clock3 size={13} /> {formatBytes(library.stats.totalSize)}
              <HardDrive size={13} /> Arşiv
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
