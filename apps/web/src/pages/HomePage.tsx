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

      <div className="home-top">
        <section className="home-hero">
          <div className="home-hero-copy">
            <span className="eyebrow">Norie Music</span>
            <h1>{featured ? featured.name : 'Müziğin seni bekliyor'}</h1>
            <p>{featured ? featured.artist : 'Kütüphaneni keşfet'}</p>
            <div className="home-hero-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => playQueue(shuffle(library.tracks))}
              >
                <Sparkles size={16} />
                Şimdi Dinle
              </button>
              <Link to="/library" className="button secondary">
                Göz At <ArrowRight size={15} />
              </Link>
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
                  <PlayButton
                    tracks={library.tracks.filter(
                      (track) =>
                        track.albumArtist === featured.artist && track.album === featured.name,
                    )}
                    size="lg"
                    label={`${featured.name} albümünü çal`}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="home-queue" aria-label="Şimdi çalınıyor">
          <h3>Şimdi çalınıyor</h3>
          <p>Çalma kuyruğu</p>
          {recentTracks.slice(0, 3).map((t) => (
            <div key={t.id} className="home-queue__row">
              <Cover src={t.coverUrl} alt="" seed={t.id} className="home-queue__cover" iconSize={16} />
              <div className="meta">
                <strong>{t.title}</strong>
                <small>{t.artist}</small>
              </div>
              <button type="button" className="home-queue__play" onClick={() => playQueue([t])} aria-label={`${t.title} çal`}>
                ▶
              </button>
            </div>
          ))}
        </aside>
      </div>

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

      <div className="home-bottom">
        <section className="content-section" style={{ marginTop: 0 }}>
          <div className="section-heading">
            <div><h2>Çalma listelerin</h2><p>Seçkilerin.</p></div>
            <Link to="/library?tab=playlists" className="section-link">Tümünü gör <ArrowRight size={15} /></Link>
          </div>
          <div className="card-grid playlist-grid">
            {playlists.slice(0, 4).map((p) => <PlaylistCard key={p.id} playlist={p} />)}
            <button type="button" className="create-playlist-card" onClick={openCreatePlaylist}>
              <span><Plus size={22} /></span>
              <strong>Yeni liste</strong>
            </button>
          </div>
        </section>
        <aside className="analytics-card" aria-label="İstatistiklerin">
          <h3 style={{ fontSize: '0.9rem' }}>İstatistiklerin</h3>
          <div className="vinyl" aria-hidden="true">♫</div>
          <div className="analytics-hours">{formatLongDuration(library.stats.totalDuration)}</div>
          <small style={{ color: 'var(--muted)' }}>Toplam Dinleme Süresi</small>
          <div className="analytics-chips">
            <span>{formatCount(library.stats.tracks)} parça</span>
            <span>{formatCount(library.stats.albums)} albüm</span>
            <span>{formatCount(library.stats.artists)} sanatçı</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.68rem', color: 'var(--muted)' }}>
            <Clock3 size={13} /> {formatBytes(library.stats.totalSize)}
            <HardDrive size={13} /> Arşiv
          </div>
        </aside>
      </div>


    </div>
  );
}
