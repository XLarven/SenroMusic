import { NavLink } from 'react-router-dom';
import { CloudDownload, Compass, Home, LibraryBig, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../lib/i18n';

const ITEMS = [
  { to: '/', labelTr: 'Ana sayfa', labelEn: 'Home', icon: Home, end: true },
  { to: '/search', labelTr: 'Ara', labelEn: 'Search', icon: Compass, end: false },
  { to: '/library', labelTr: 'Kütüphane', labelEn: 'Library', icon: LibraryBig, end: false },
  { to: '/downloads', labelTr: 'İndirilenler', labelEn: 'Downloads', icon: CloudDownload, end: false },
  { to: '/profile', labelTr: 'Profil', labelEn: 'Profile', icon: UserRound, end: false },
];

export function MobileNav() {
  return (
    <nav className="mobile-nav shell-mobile-nav" aria-label={t('Mobil gezinme', 'Mobile navigation')}>
      {ITEMS.map(({ to, labelTr, labelEn, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => clsx('mobile-nav-link', isActive && 'is-active')}
        >
          <Icon size={20} strokeWidth={1.9} />
          <span>{t(labelTr, labelEn)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
