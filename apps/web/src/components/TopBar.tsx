import { Bell, Search } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../store/auth';
import { greeting } from '../lib/format';

export function TopBar() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const target = q.trim();
    navigate(target ? `/search?q=${encodeURIComponent(target)}` : '/search');
  };

  const initials = (user?.displayName || user?.email || 'N').slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar__mobile-copy">
        <small>{greeting()},</small>
        <strong>{user?.displayName || user?.email?.split('@')[0] || 'müziksever'} 👋</strong>
      </div>
      <form onSubmit={submit} className="topbar__search" role="search">
        <Search size={17} aria-hidden="true" style={{ color: 'var(--nm-text-secondary)' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Şarkı, sanatçı, albüm ara…"
          aria-label="Ara"
          autoComplete="off"
          spellCheck={false}
          type="search"
        />
      </form>
      <span style={{ flex: 1 }} />
      <NavLink to="/notifications" className="topbar__icon" aria-label="Bildirimler" title="Bildirimler">
        <Bell size={17} />
      </NavLink>
      <NavLink to="/profile" className="topbar__avatar" aria-label="Profil">
        {initials}
      </NavLink>
    </header>
  );
}
