import { NavLink } from 'react-router-dom';
import { Home, LibraryBig, Search, Settings2 } from 'lucide-react';
import clsx from 'clsx';

const ITEMS = [
  { to: '/', label: 'Ana sayfa', icon: Home, end: true },
  { to: '/search', label: 'Ara', icon: Search, end: false },
  { to: '/library', label: 'Kitaplık', icon: LibraryBig, end: false },
  { to: '/settings', label: 'Ayarlar', icon: Settings2, end: false },
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
