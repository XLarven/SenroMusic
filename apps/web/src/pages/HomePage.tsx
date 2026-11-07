import { Link } from 'react-router-dom';
import { ArrowRight, Clock3, Disc3, HardDrive, LibraryBig, Plus, Search, Sparkles } from 'lucide-react';
import { AlbumCard } from '../components/AlbumCard';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { PlayButton } from '../components/PlayButton';
import { PlaylistCard } from '../components/PlaylistCard';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { usePlayer } from '../store/player';
import { useUiStore } from '../store/ui';
import {
  formatBytes,
  formatCount,
  formatLongDuration,
  greeting,
  recentAlbums,
  shuffle,
} from '../lib/format';

export function HomePage() {
  const { library, playlists } = useMusicData();
  const playQueue = usePlayer((state) => state.playQueue);
  const openCreatePlaylist = useUiStore((state) => state.openCreatePlaylist);

  const albums = recentAlbums(library, 10);
  const featured = albums[0] ?? library.albums[0] ?? null;
  const recentTracks = [...library.tracks]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .slice(0, 6);

  const today = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  if (library.tracks.length === 0) {
    return (
      <div className="page">
        <header className="page-heading">
          <div>
            <span className="eyebrow">{today}</span>
            <h1>{greeting()}.</h1>
            <p>Kütüphanen henüz boş.</p>
          </div>
        </header>
        <EmptyState
          icon={LibraryBig}
          title="İlk parçanı ekle"
          description="Sunucundaki müzik klasörüne dosyalarını koy, ardından kitaplığı yeniden tara. Norie Music metadata ve kapakları otomatik hazırlar."
          action={
            <Link to="/settings" className="button primary">
              <HardDrive size={16} />
              Kuruluma git
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page home-page">
      <div className="home-topline">
        <span className="eyebrow">{today}</span>
        <span className="home-topline-status">
          <span className="status-dot" />
          Çevrimiçi
        </span>
      </div>

      <Link
        to="/search"
        aria-label="Ara"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          margin: '4px 0 16px',
          padding: '14px 18px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--muted)',
          fontSize: '0.9rem',
        }}
      >
        <Search size={18} />
        <span>Şarkı, albüm veya sanatçı ara…</span>
      </Link>

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="eyebrow">
            <Sparkles size={14} />
            Senin kütüphanen
          </span>
          <h1>
            {greeting()}.
            <br />
            <span>Müziğin seni bekliyor.</span>
          </h1>
          <p>
            {formatCount(library.stats.tracks)} parça, {formatCount(library.stats.albums)} albüm ve{' '}
            {formatCount(library.stats.artists)} sanatçı. Kendi arşivinden bir seçim yap ya da bırak,
            karışık çalsın.
          </p>
          <div className="home-hero-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => playQueue(shuffle(library.tracks))}
            >
              <Sparkles size={17} />
              Karışık çal
            </button>
            <Link to="/library" className="button secondary">
              Kitaplığı keşfet
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="home-stats">
            <span>
              <Clock3 size={15} />
              {formatLongDuration(library.stats.totalDuration)}
            </span>
            <span>
              <HardDrive size={15} />
              {formatBytes(library.stats.totalSize)}
            </span>
            <span>
              <Disc3 size={15} />
              Kayıpsız arşiv
            </span>
          </div>
        </div>

        {featured ? (
          <div className="home-feature">
            <div className="home-feature-disc" aria-hidden="true" />
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
                <span className="home-feature-shine" aria-hidden="true" />
              </Link>
              <div className="home-feature-play">
                <PlayButton
                  tracks={library.tracks.filter(
                    (track) =>
                      track.albumArtist === featured.artist && track.album === featured.name,
                  )}
                  size="lg"
                  label={`${featured.name} albümünü çal`}
                />
              </div>
              <div className="home-feature-meta">
                <span>Son eklenen</span>
                <strong>{featured.name}</strong>
                <small>{featured.artist}</small>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Son eklenenler</h2>
            <p>Arşivine en son katılan albümler.</p>
          </div>
          <Link to="/library?tab=albums" className="section-link">
            Tümünü gör
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="card-grid album-grid">
          {albums.slice(0, 5).map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Kitaplığından</h2>
            <p>Son eklenen parçalarla hızlı bir başlangıç.</p>
          </div>
          <Link to="/library?tab=tracks" className="section-link">
            Tüm parçalar
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="surface-panel">
          <TrackList tracks={recentTracks} />
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Çalma listelerin</h2>
            <p>Kendi ritmini yakalayan seçkiler.</p>
          </div>
          {playlists.length > 0 ? (
            <Link to="/library?tab=playlists" className="section-link">
              Tümünü gör
              <ArrowRight size={15} />
            </Link>
          ) : null}
        </div>

        {playlists.length > 0 ? (
          <div className="card-grid playlist-grid">
            {playlists.slice(0, 4).map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
            <button type="button" className="create-playlist-card" onClick={openCreatePlaylist}>
              <span>
                <Plus size={22} />
              </span>
              <strong>Yeni çalma listesi</strong>
              <small>Bir isim ver, parçaları eklemeye başla.</small>
            </button>
          </div>
        ) : (
          <div className="playlist-empty-banner">
            <div>
              <span className="eyebrow">İlk listen</span>
              <h3>Kendi seçkini oluştur.</h3>
              <p>Albümlerden ve aramadan parça ekleyerek kendi dinleme sıranı hazırla.</p>
            </div>
            <button type="button" className="button secondary" onClick={openCreatePlaylist}>
              <Plus size={16} />
              Çalma listesi oluştur
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
