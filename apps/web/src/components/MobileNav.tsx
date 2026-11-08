import { NavLink } from 'react-router-dom';
import { Compass, Heart, Home, LibraryBig, UserRound } from 'lucide-react';
import clsx from 'clsx';

const ITEMS = [
  { to: '/', label: 'Ana sayfa', icon: Home, end: true },
  { to: '/search', label: 'Ara', icon: Compass, end: false },
  { to: '/library', label: 'Liste', icon: LibraryBig, end: false },
  { to: '/favorites', label: 'Favoriler', icon: Heart, end: false },
  { to: '/profile', label: 'Profil', icon: UserRound, end: false },
];

export function MobileNav() {
  return (
    <nav className="mobile-nav shell-mobile-nav" aria-label="Mobil gezinme">
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => clsx('mobile-nav-link', isActive && 'is-active')}
        >
          <Icon size={20} strokeWidth={1.9} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
