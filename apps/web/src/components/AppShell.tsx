import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, LogOut, RefreshCw, WifiOff } from 'lucide-react';
import { api } from '../api';
import { MusicDataContext, type MusicData } from '../MusicDataContext';
import { useAuthStore } from '../store/auth';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import { Logo } from './Logo';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { PlayerBar } from './PlayerBar';
import { QueuePanel } from './QueuePanel';
import { CreatePlaylistDialog } from './CreatePlaylistDialog';
import { Toaster } from './Toaster';

function AppBoot() {
  return (
    <div className="app-boot">
      <div className="boot-orbit boot-orbit-one" aria-hidden="true" />
      <div className="boot-orbit boot-orbit-two" aria-hidden="true" />
      <div className="boot-content">
        <Logo />
        <div className="boot-loader" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <p>Kütüphanen hazırlanıyor</p>
      </div>
    </div>
  );
}

function AppError({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const logout = useAuthStore((state) => state.logout);

  return (
    <main className="app-error">
      <Logo />
      <div className="app-error-card">
        <span className="app-error-icon">
          <WifiOff size={26} />
        </span>
        <span className="eyebrow">Bağlantı sorunu</span>
        <h1>Sunucuya ulaşılamıyor.</h1>
        <p>{message}</p>
        <div className="app-error-actions">
          <button type="button" className="button primary" onClick={onRetry} disabled={retrying}>
            {retrying ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Yeniden dene
          </button>
          <button type="button" className="button ghost" onClick={() => void logout()}>
            <LogOut size={16} />
            Çıkış yap
          </button>
        </div>
        <small>
          Norie Music sunucusunun çalıştığından ve bu cihazın aynı ağda olduğundan emin ol. Sunucu adresi:{' '}
          <code>{window.location.host}</code>
        </small>
      </div>
    </main>
  );
}

export function AppShell() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const pushToast = useToastStore((state) => state.push);
  const playerError = usePlayer((state) => state.error);

  const libraryQuery = useQuery({
    queryKey: ['library'],
    queryFn: api.library,
    staleTime: 30_000,
    retry: 1,
  });

  const playlistsQuery = useQuery({
    queryKey: ['playlists'],
    queryFn: api.playlists,
    staleTime: 15_000,
    retry: 1,
  });

  const refetchLibrary = libraryQuery.refetch;
  const refetchPlaylists = playlistsQuery.refetch;

  const refreshLibrary = useCallback(async () => {
    await refetchLibrary();
  }, [refetchLibrary]);

  const refreshPlaylists = useCallback(async () => {
    await refetchPlaylists();
  }, [refetchPlaylists]);

  const library = libraryQuery.data;
  const playlistPayload = playlistsQuery.data;

  const data = useMemo<MusicData | null>(() => {
    if (!library || !playlistPayload) return null;
    return {
      library,
      playlists: playlistPayload.playlists,
      refreshLibrary,
      refreshPlaylists,
    };
  }, [library, playlistPayload, refreshLibrary, refreshPlaylists]);

  useEffect(() => {
    void useDownloads.getState().init();
    usePlayer.getState().restoreSession();
  }, []);

  useEffect(() => {
    if (!library) return;
    void useDownloads.getState().validateTracks(library.tracks);
  }, [library]);

  useEffect(() => {
    if (!mainRef.current) return;
    mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    if (playerError) pushToast(playerError, 'error');
  }, [playerError, pushToast]);

  useEffect(() => {
    const onOnline = () => pushToast('Bağlantı yeniden kuruldu.', 'success');
    const onOffline = () => pushToast('Bağlantı kesildi. Çevrimdışı moddasın.', 'error');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [pushToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, button, a, [contenteditable="true"]')
      ) {
        return;
      }
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        usePlayer.getState().toggle();
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        usePlayer.getState().next();
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        usePlayer.getState().previous();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (libraryQuery.isPending || playlistsQuery.isPending) return <AppBoot />;

  const error = libraryQuery.error ?? playlistsQuery.error;
  if (error || !data) {
    const message =
      error instanceof Error ? error.message : 'Kütüphane yüklenirken beklenmeyen bir sorun oluştu.';
    return (
      <AppError
        message={message}
        retrying={libraryQuery.isFetching || playlistsQuery.isFetching}
        onRetry={() => {
          void Promise.all([libraryQuery.refetch(), playlistsQuery.refetch()]);
        }}
      />
    );
  }

  return (
    <MusicDataContext.Provider value={data}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          İçeriğe geç
        </a>
        <Sidebar />
        <main id="main-content" className="shell-main" ref={mainRef} tabIndex={-1}>
          <TopBar />
          <Outlet />
        </main>
        <div className="shell-player">
          <PlayerBar />
        </div>
        <MobileNav />
        <QueuePanel />
        <CreatePlaylistDialog />
        <Toaster />
      </div>
    </MusicDataContext.Provider>
  );
}
