import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  Heart,
  Home,
  LibraryBig,
  Loader2,
  LogOut,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { Cover } from './Cover';
import { Logo } from './Logo';
import { useMusicData } from '../MusicDataContext';
import { useUiStore } from '../store/ui';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { formatCount } from '../lib/format';

const NAV_ITEMS = [
  { to: '/', label: 'Ana sayfa', icon: Home, end: true },
  { to: '/search', label: 'Ara', icon: Search, end: false },
  { to: '/library', label: 'Kütüphane', icon: LibraryBig, end: false },
  { to: '/favorites', label: 'Favoriler', icon: Heart, end: false },
  { to: '/notifications', label: 'Bildirimler', icon: Bell, end: false },
];

export function Sidebar() {
  const { library, playlists } = useMusicData();
  const user = useAuthStore((state) => state.user);
  const openCreatePlaylist = useUiStore((state) => state.openCreatePlaylist);
  const logout = useAuthStore((state) => state.logout);
  const pushToast = useToastStore((state) => state.push);
  const [loggingOut, setLoggingOut] = useState(false);

  const userName = user?.displayName || user?.email?.split('@')[0] || 'misafir';
  const initials = (user?.displayName || user?.email || 'N').slice(0, 2).toUpperCase();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      pushToast('Oturum kapatılırken bir sorun oluştu.', 'error');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <aside className="sidebar shell-sidebar">
      <div className="sidebar-brand">
        <Logo asLink />
      </div>

      <nav className="side-nav" aria-label="Ana gezinme">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => clsx('side-nav-link', isActive && 'is-active')}
          >
            <Icon size={19} strokeWidth={1.9} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-playlists">
        <div className="side-section-heading">
          <span>Çalma listelerin</span>
          <button
            type="button"
            className="icon-button small"
            onClick={openCreatePlaylist}
            aria-label="Yeni çalma listesi"
            title="Yeni çalma listesi"
          >
            <Plus size={16} />
          </button>
        </div>

        {playlists.length === 0 ? (
          <div className="side-empty">
            <p>İlk listeni oluştur, kendi sıralamanı kur.</p>
            <button type="button" className="text-button" onClick={openCreatePlaylist}>
              Liste oluştur
              <ArrowUpRight size={14} />
            </button>
          </div>
        ) : (
          <div className="side-playlist-list">
            {playlists.slice(0, 10).map((playlist) => (
              <NavLink
                key={playlist.id}
                to={`/playlist/${playlist.id}`}
                className={({ isActive }) => clsx('side-playlist', isActive && 'is-active')}
              >
                <Cover
                  src={playlist.coverUrl}
                  alt=""
                  seed={playlist.id}
                  className="side-playlist-cover"
                  iconSize={13}
                />
                <span>
                  <strong>{playlist.name}</strong>
                  <small>{playlist.trackCount} parça</small>
                </span>
              </NavLink>
            ))}
            {playlists.length > 10 ? (
              <Link to="/library?tab=playlists" className="side-more">
                Tüm listeleri gör
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <Link to="/settings" className="server-card">
          <span className="server-card-top">
            <span className="status-pill">
              <span className="status-dot" />
              Sunucu bağlı
            </span>
            <ArrowUpRight size={14} />
          </span>
          <span className="server-card-stats">
            <strong>{formatCount(library.stats.tracks)}</strong> parça
            <span aria-hidden="true">·</span>
            <strong>{formatCount(library.stats.albums)}</strong> albüm
          </span>
        </Link>

        <div className="side-user-card">
          <Link to="/profile" className="side-user">
            <span className="side-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="side-user-copy">
              <strong>{userName}</strong>
              <small className={clsx('side-user-badge', user?.role === 'admin' && 'is-admin')}>
                {user?.role === 'admin' ? 'Yönetici' : 'Üye'}
              </small>
            </span>
          </Link>
          <div className="side-user-actions">
            <NavLink
              to="/settings"
              className={({ isActive }) => clsx('side-icon-button', isActive && 'is-active')}
              aria-label="Ayarlar"
              title="Ayarlar"
            >
              <Settings2 size={16} />
            </NavLink>
            {user?.role === 'admin' ? (
              <NavLink
                to="/admin"
                className={({ isActive }) => clsx('side-icon-button', isActive && 'is-active')}
                aria-label="Kullanıcılar"
                title="Kullanıcılar"
              >
                <ShieldCheck size={16} />
              </NavLink>
            ) : null}
            <button
              type="button"
              className="side-icon-button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              aria-label="Çıkış yap"
              title="Çıkış"
            >
              {loggingOut ? <Loader2 size={16} className="spin" /> : <LogOut size={16} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
