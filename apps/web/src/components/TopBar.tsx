import { Bell, Search, X } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../store/auth';
import { useNotificationStore } from '../store/notifications';
import { usePlayer } from '../store/player';
import { greeting } from '../lib/format';
import { t } from '../lib/i18n';
import { SearchSuggestions, songToTrack, type SuggestionSong } from './SearchSuggestions';

export function TopBar() {
  const [q, setQ] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const unread = useNotificationStore((s) => s.unread);
  const playTrack = usePlayer((state) => state.playTrack);
  // The search page owns its own (larger) input, so the global one steps aside
  // there: one query box per screen, never two.
  const onSearchPage = location.pathname === '/search';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const target = q.trim();
    setSuggestOpen(false);
    navigate(target ? `/search?q=${encodeURIComponent(target)}` : '/search');
  };

  const playSuggestion = (song: SuggestionSong) => {
    playTrack(songToTrack(song));
    setSuggestOpen(false);
  };

  const initials = (user?.displayName || user?.email || 'N').slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar__mobile-copy">
        <small>{greeting()},</small>
        <strong>{user?.displayName || user?.email?.split('@')[0] || t('müziksever', 'music lover')} 👋</strong>
      </div>
      {onSearchPage ? null : (
        <form onSubmit={submit} className="topbar__search" role="search">
          <Search size={17} aria-hidden="true" style={{ color: 'var(--nm-text-secondary)' }} />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSuggestOpen(e.target.value.trim().length >= 2);
            }}
            onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
            placeholder={t('Şarkı, sanatçı, albüm ara…', 'Search songs, artists, albums…')}
            aria-label={t('Ara', 'Search')}
            autoComplete="off"
            spellCheck={false}
            type="search"
          />
          {q ? (
            <button
              type="button"
              className="topbar__clear"
              onClick={() => {
                setQ('');
                setSuggestOpen(false);
              }}
              aria-label={t('Aramayı temizle', 'Clear search')}
            >
              <X size={15} />
            </button>
          ) : null}
          <SearchSuggestions
            query={q}
            open={suggestOpen}
            onClose={() => setSuggestOpen(false)}
            onPickSong={(song) => {
              playSuggestion(song);
            }}
            onPlaySong={playSuggestion}
          />
        </form>
      )}
      <div className="topbar__actions">
        <NavLink to="/notifications" className="topbar__icon" aria-label={t('Bildirimler', 'Notifications')} title={t('Bildirimler', 'Notifications')}>
          <Bell size={17} />
          {unread > 0 ? (
            <span className="topbar__badge" aria-label={`${unread}`}>
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </NavLink>
        <NavLink to="/profile" className="topbar__avatar" aria-label={t('Profil', 'Profile')}>
          {initials}
        </NavLink>
      </div>
    </header>
  );
}
