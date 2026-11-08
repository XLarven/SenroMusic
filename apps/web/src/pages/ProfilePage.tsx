import { Link } from 'react-router-dom';
import { ArrowRight, LogOut, Settings2 } from 'lucide-react';
import { Cover } from '../components/Cover';
import { PlaylistCard } from '../components/PlaylistCard';
import { useMusicData } from '../MusicDataContext';
import { useAuthStore } from '../store/auth';
import { formatCount } from '../lib/format';

export function ProfilePage() {
  const { library, playlists } = useMusicData();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const name = user?.displayName || user?.email?.split('@')[0] || 'kullanıcı';
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="page">
      <header className="page-heading">
        <span className="eyebrow">Profil</span>
        <h1>Profilin</h1>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, margin: '18px 0 22px' }}>
        <div style={{
          width: 112, height: 112, borderRadius: '50%',
          background: 'linear-gradient(135deg, #780103, #C8102E)',
          display: 'grid', placeItems: 'center', fontSize: '2rem', fontWeight: 800, color: '#fff',
          boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        }}>
          {initials}
        </div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 750, letterSpacing: '-0.02em' }}>{name}</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>@{user?.email?.split('@')[0] || 'kullanıcı'} · {user?.role === 'admin' ? 'Yönetici' : 'Üye'}</p>
        <div style={{ display: 'flex', gap: 18, marginTop: 6 }}>
          <span><strong>{formatCount(playlists.length)}</strong><br /><small style={{ color: 'var(--muted)' }}>Liste</small></span>
          <span><strong>{formatCount(library.stats.tracks)}</strong><br /><small style={{ color: 'var(--muted)' }}>Şarkı</small></span>
          <span><strong>{formatCount(library.stats.artists)}</strong><br /><small style={{ color: 'var(--muted)' }}>Sanatçı</small></span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
          <Link to="/settings" className="button secondary"><Settings2 size={16} /> Profili Düzenle</Link>
          <button type="button" className="button ghost" onClick={() => void logout()}>
            <LogOut size={16} /> Çıkış yap
          </button>
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div><h2>Çalma Listelerim</h2><p>Senin oluşturduğun listeler.</p></div>
          <Link to="/library?tab=playlists" className="section-link">Tümünü gör <ArrowRight size={15} /></Link>
        </div>
        {playlists.length > 0 ? (
          <div className="card-grid playlist-grid">
            {playlists.slice(0, 4).map((p) => <PlaylistCard key={p.id} playlist={p} />)}
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Henüz playlist yok — kütüphaneden oluştur.</p>
        )}
      </section>
    </div>
  );
}
