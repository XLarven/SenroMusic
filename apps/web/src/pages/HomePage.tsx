import { Link } from 'react-router-dom';
import { ArrowRight, Clock3, HardDrive, Heart, Play } from 'lucide-react';
import clsx from 'clsx';
import { AlbumCard } from '../components/AlbumCard';
import { Cover } from '../components/Cover';
import { PlayButton } from '../components/PlayButton';
import { useMusicData } from '../MusicDataContext';
import { usePlayer } from '../store/player';
import { useFavorites } from '../store/favorites';
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
  const { library } = useMusicData();
  const playQueue = usePlayer((state) => state.playQueue);
  const favIds = useFavorites((state) => state.ids);
  const toggleFav = useFavorites((state) => state.toggle);

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

  const today = new Intl.DateTimeFormat('tr-TR', {
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
          {greeting()} · {today}
        </span>
        <span className="home-topline-status">
          <span className="status-dot" />
          Çevrimiçi
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
