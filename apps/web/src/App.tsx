import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Logo } from './components/Logo';
import { useMediaSession } from './hooks/useMediaSession';
import { useAuthStore } from './store/auth';
import { AdminPage } from './pages/AdminPage';
import { AlbumPage } from './pages/AlbumPage';
import { ArtistPage } from './pages/ArtistPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaylistPage } from './pages/PlaylistPage';
import { SearchPage } from './pages/SearchPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { SharedPlaylistPage } from './pages/SharedPlaylistPage';

function Splash() {
  return (
    <div className="splash-screen">
      <div className="splash-rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <Logo />
      <div className="splash-loader" aria-hidden="true">
        <span />
      </div>
      <p>Oturum kontrol ediliyor</p>
    </div>
  );
}

export function App() {
  const status = useAuthStore((state) => state.status);
  const check = useAuthStore((state) => state.check);
  const setAnonymous = useAuthStore((state) => state.setAnonymous);

  useMediaSession();

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const onUnauthorized = () => setAnonymous();
    window.addEventListener('Norie:unauthorized', onUnauthorized);
    return () => window.removeEventListener('Norie:unauthorized', onUnauthorized);
  }, [setAnonymous]);

  if (status === 'checking') return <Splash />;
  if (status === 'anonymous') return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="album/:id" element={<AlbumPage />} />
        <Route path="artist/:id" element={<ArtistPage />} />
        <Route path="playlist/:id" element={<PlaylistPage />} />
        <Route path="p/:slug" element={<SharedPlaylistPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="downloads" element={<DownloadsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="profile/:id" element={<ProfilePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
