import { useEffect, useRef, useState } from 'react';
import { useDeferredValue, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Disc3, Download, Link2, Loader2, Music, Play, Search, SearchX, Sparkles, Video, X } from 'lucide-react';
import clsx from 'clsx';
import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { Cover } from '../components/Cover';
import { DownloadButton } from '../components/DownloadButton';
import { EmptyState } from '../components/EmptyState';
import { ImportPreviewPanel, type PlaylistPreview, type PreviewItem } from '../components/ImportPreviewPanel';
import { PlayButton } from '../components/PlayButton';
import { SearchSuggestions, songToTrack, type SuggestionSong } from '../components/SearchSuggestions';
import { TrackList } from '../components/TrackList';
import { useMusicData } from '../MusicDataContext';
import { api } from '../api';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import { coverGradient } from '../lib/gradient';
import { formatCount, formatDuration } from '../lib/format';
import type { Track, YouTubeResult, SpotifyResolved, SpotifyCatalogSearch } from '../types';
import { useNavigate } from 'react-router-dom';

type SearchTab = 'all' | 'tracks' | 'albums' | 'artists';
const TABS: Array<{ id: SearchTab; label: string }> = [
  { id: 'all', label: 'Tümü' },
  { id: 'tracks', label: 'Şarkılar' },
  { id: 'albums', label: 'Albümler' },
  { id: 'artists', label: 'Sanatçılar' },
];

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLocaleLowerCase('tr');
}

function isPlaylistUrl(value: string): boolean {
  return (
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\//.test(value) ||
    /(?:youtube\.com|music\.youtube\.com)\/playlist\?list=/.test(value) ||
    /youtu\.be\/[^?\s]+[?&]list=/.test(value) ||
    /(?:^|\/)p\/[A-Za-z0-9_-]+/.test(value) ||
    /(?:^|\/)playlist\/[A-Za-z0-9_-]+/.test(value)
  );
}

function norieSlug(value: string): string | null {
  const match = value.match(/(?:^|\/)p\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function noriePlaylistId(value: string): string | null {
  if (value.includes('open.spotify.com') || value.includes('youtube.com') || value.includes('youtu.be')) return null;
  const match = value.match(/(?:^|\/)playlist\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function matchTrack(item: { title: string; artist: string; duration?: number | null }, tracks: Track[]): Track | null {
  const title = normalize(item.title);
  const artist = normalize(item.artist);
  let best: Track | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const track of tracks) {
    if (normalize(track.title) !== title) continue;
    const trackArtist = normalize(track.artist);
    if (artist && artist !== trackArtist && !artist.includes(trackArtist) && !trackArtist.includes(artist)) continue;
    if (item.duration != null && track.duration > 0 && Math.abs(track.duration - item.duration) > 3) continue;
    const score = item.duration == null ? 0 : Math.abs(track.duration - item.duration);
    if (score < bestScore) {
      best = track;
      bestScore = score;
    }
  }
  return best;
}

function withMatches(
  items: Array<Omit<PreviewItem, 'matchedTrack'>>,
  tracks: Track[],
): PreviewItem[] {
  return items.map((item) => ({ ...item, matchedTrack: matchTrack(item, tracks) }));
}

function youtubeResultToTrack(item: YouTubeResult): Track {
  return {
    id: `yt_${item.id}`,
    title: item.title,
    artist: item.uploader,
    album: 'YouTube',
    albumArtist: item.uploader,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: item.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: 'youtube',
    size: 0,
    coverUrl: item.thumbnail,
    streamUrl: `youtube:${item.id}`,
    addedAt: new Date().toISOString(),
  };
}

export function SearchPage() {
  const { library, playlists, refreshLibrary, refreshPlaylists } = useMusicData();
  const pushToast = useToastStore((state) => state.push);
  const downloadTrack = useDownloads((state) => state.download);
  const playTrack = usePlayer((state) => state.playTrack);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const rawTab = params.get('tab');
  const tab: SearchTab = TABS.some((item) => item.id === rawTab) ? (rawTab as SearchTab) : 'all';
  const deferredQuery = useDeferredValue(query.trim());

  const navigate = useNavigate();
  const [ytResults, setYtResults] = useState<YouTubeResult[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const isSpotifyUrl = deferredQuery.includes('open.spotify.com');
  const [spotify, setSpotify] = useState<SpotifyResolved | null>(null);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [ytPlaylistUrl, setYtPlaylistUrl] = useState('');
  const [ytPlaylist, setYtPlaylist] = useState<{ title: string; items: YouTubeResult[]; total: number } | null>(null);
  const [ytPlaylistLoading, setYtPlaylistLoading] = useState(false);
  const [ytPlaylistError, setYtPlaylistError] = useState<string | null>(null);
  const [ytPlaylistImporting, setYtPlaylistImporting] = useState(false);
  const [catalogResults, setCatalogResults] = useState<{ tracks: import('../types').Track[]; albums: import('../types').Album[]; artists: import('../types').Artist[] } | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [spotifyCatalog, setSpotifyCatalog] = useState<import('../types').SpotifyCatalogSearch | null>(null);
  const [spotifyCatalogLoading, setSpotifyCatalogLoading] = useState(false);
  const [spotifyCatalogError, setSpotifyCatalogError] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const spotifyCatalogTrackToTrack = (track: SpotifyCatalogSearch['tracks'][number]): Track => ({
    id: `sp_${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album ?? 'Spotify',
    albumArtist: track.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: track.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: 'spotify',
    size: 0,
    coverUrl: track.artworkUrl,
    // Spotify can only supply the identity of the song; the audio is resolved
    // per play by the media proxy (JioSaavn first, YouTube search after).
    streamUrl: `spotify:${track.id}`,
    addedAt: new Date().toISOString(),
  });

  const [history, setHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('Norie.searchHistory');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    let cancelled = false;
    void api
      .searchHistory(50)
      .then((result) => {
        if (cancelled) return;
        const queries = result.items.map((item) => item.query);
        setHistory(queries);
        try { localStorage.setItem('Norie.searchHistory', JSON.stringify(queries)); } catch { /* private mode */ }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  const setTab = (value: SearchTab) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };

  const localResults = useMemo(() => {
    const needle = normalize(deferredQuery);
    if (!needle) {
      return { tracks: [], albums: [], artists: [] };
    }
    return {
      tracks: library.tracks.filter((track) =>
        [track.title, track.artist, track.album, track.albumArtist, track.genre].some((value) =>
          normalize(value).includes(needle),
        ),
      ),
      albums: library.albums.filter((album) =>
        [album.name, album.artist].some((value) => normalize(value).includes(needle)),
      ),
      artists: library.artists.filter((artist) => normalize(artist.name).includes(needle)),
    };
  }, [deferredQuery, library]);

  const results = catalogResults ?? localResults;

  const total = results.tracks.length + results.albums.length + results.artists.length;

  useEffect(() => {
    const needle = deferredQuery;
    if (isSpotifyUrl) {
      setYtResults([]);
      setYtError(null);
      let cancelled = false;
      setSpotifyLoading(true);
      setSpotifyError(null);
      setSpotify(null);
      api.spotifyResolve(needle)
        .then((r) => { if (!cancelled) setSpotify(r); })
        .catch((e) => { if (!cancelled) setSpotifyError(e instanceof Error ? e.message : 'Spotify çözülemedi.'); })
        .finally(() => { if (!cancelled) setSpotifyLoading(false); });
      return () => { cancelled = true; };
    }
    if (isPlaylistUrl(needle)) {
      setYtResults([]);
      setYtError(null);
      return;
    }
    if (!needle || needle.length < 2) {
      setYtResults([]);
      setYtError(null);
      return;
    }
    let cancelled = false;
    setYtLoading(true);
    setYtError(null);
    api
      .youtubeSearch(needle, 12)
      .then((payload) => {
        if (cancelled) return;
        setYtResults(payload.results);
      })
      .catch((error) => {
        if (cancelled) return;
        setYtError(error instanceof Error ? error.message : 'YouTube araması başarısız.');
      })
      .finally(() => {
        if (!cancelled) setYtLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deferredQuery, isSpotifyUrl]);

  useEffect(() => {
    if (!deferredQuery || deferredQuery.length < 2 || isSpotifyUrl || isPlaylistUrl(deferredQuery)) {
      setCatalogResults(null);
      setCatalogLoading(false);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .search(deferredQuery, 30)
        .then((found) => {
          if (!cancelled) setCatalogResults(found);
        })
        .catch(() => {
          if (!cancelled) setCatalogResults(null);
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deferredQuery, isSpotifyUrl]);

  useEffect(() => {
    if (!deferredQuery || deferredQuery.length < 2 || isPlaylistUrl(deferredQuery)) {
      setSpotifyCatalog(null);
      setSpotifyCatalogLoading(false);
      setSpotifyCatalogError(null);
      return;
    }
    let cancelled = false;
    setSpotifyCatalogLoading(true);
    setSpotifyCatalogError(null);
    const timer = window.setTimeout(() => {
      void api
        .spotifySearch(deferredQuery, 10)
        .then((result) => {
          if (!cancelled) setSpotifyCatalog(result);
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : 'Spotify kataloğu alınamadı.';
          setSpotifyCatalogError(message.includes('yapılandırılmadı') ? null : message);
          setSpotifyCatalog(null);
        })
        .finally(() => {
          if (!cancelled) setSpotifyCatalogLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deferredQuery]);

  useEffect(() => {
    if (!spotify || !isPlaylistUrl(deferredQuery) || !deferredQuery.includes('open.spotify.com')) return;
    const items = withMatches(
      spotify.items.map((item) => ({
        providerTrackId: item.providerTrackId ?? null,
        title: item.title,
        artist: item.artist,
        album: item.album ?? null,
        duration: item.duration ?? null,
        artworkUrl: item.artworkUrl ?? null,
        sourceUrl: item.sourceUrl ?? deferredQuery,
      })),
      library.tracks,
    );
    setPreview({
      provider: 'spotify',
      title: spotify.title,
      description: null,
      artworkUrl: items.find((item) => item.artworkUrl)?.artworkUrl ?? null,
      creator: null,
      totalDuration: items.reduce((sum, item) => sum + (item.duration ?? 0), 0) || null,
      sourceUrl: deferredQuery,
      sourcePlaylistId: deferredQuery.match(/playlist\/([^?/]+)/)?.[1] ?? null,
      items,
    });
    setPreviewError(null);
    setPreviewLoading(false);
  }, [spotify, deferredQuery, library.tracks]);

  useEffect(() => {
    const url = deferredQuery;
    if (!isPlaylistUrl(url) || url.includes('open.spotify.com')) {
      if (!isPlaylistUrl(url)) {
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(false);
      }
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    const slug = norieSlug(url);
    const playlistId = noriePlaylistId(url);
    const isYouTube = /youtube\.com|youtu\.be/.test(url);
    const sourcePlaylistId = (() => {
      try {
        return new URL(url).searchParams.get('list');
      } catch {
        return null;
      }
    })();

    const load = async () => {
      if (playlistId) {
        const playlist = await api.playlist(playlistId);
        const entries = [
          ...playlist.tracks.map((track) => ({
            position: track.position,
            item: {
              providerTrackId: track.id,
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration,
              artworkUrl: track.coverUrl,
              sourceUrl: track.streamUrl,
              matchedTrack: track,
            },
          })),
          ...playlist.externalTracks.map((track) => ({
            position: track.position,
            item: {
              providerTrackId: track.providerTrackId,
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration,
              artworkUrl: track.artworkUrl,
              sourceUrl: track.sourceUrl,
              matchedTrack: track.matchedTrackId ? library.tracks.find((candidate) => candidate.id === track.matchedTrackId) ?? null : null,
            },
          })),
        ].sort((a, b) => a.position - b.position).map((entry) => entry.item);
        return {
          provider: 'norie' as const,
          title: playlist.name,
          description: playlist.description || null,
          artworkUrl: playlist.coverUrl,
          creator: null,
          totalDuration: playlist.duration || null,
          sourceUrl: url,
          sourcePlaylistId: playlistId,
          items: entries,
        } satisfies PlaylistPreview;
      }
      if (slug) {
        const playlist = await api.publicPlaylistBySlug(slug);
        const entries = [
          ...playlist.tracks.map((track) => ({
            position: track.position,
            item: {
              providerTrackId: track.id,
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration,
              artworkUrl: track.coverUrl,
              sourceUrl: track.streamUrl,
              matchedTrack: track,
            },
          })),
          ...playlist.externalTracks.map((track) => ({
            position: track.position,
            item: {
              providerTrackId: track.providerTrackId,
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration,
              artworkUrl: track.artworkUrl,
              sourceUrl: track.sourceUrl,
              matchedTrack: track.matchedTrackId ? library.tracks.find((candidate) => candidate.id === track.matchedTrackId) ?? null : null,
            },
          })),
        ].sort((a, b) => a.position - b.position).map((entry) => entry.item);
        return {
          provider: 'norie' as const,
          title: playlist.name,
          description: playlist.description || null,
          artworkUrl: playlist.coverUrl,
          creator: null,
          totalDuration: playlist.duration || null,
          sourceUrl: url,
          sourcePlaylistId: slug,
          items: entries,
        } satisfies PlaylistPreview;
      }
      if (isYouTube) {
        const result = await api.youtubePlaylist(url);
        const items = withMatches(
          result.items.map((item) => ({
            providerTrackId: item.id,
            title: item.title,
            artist: item.uploader,
            album: null,
            duration: item.duration,
            artworkUrl: item.thumbnail,
            sourceUrl: item.url,
          })),
          library.tracks,
        );
        return {
          provider: url.includes('music.youtube.com') ? ('youtube-music' as const) : ('youtube' as const),
          title: result.title,
          description: null,
          artworkUrl: items[0]?.artworkUrl ?? null,
          creator: null,
          totalDuration: items.reduce((sum, item) => sum + (item.duration ?? 0), 0) || null,
          sourceUrl: url,
          sourcePlaylistId,
          items,
        } satisfies PlaylistPreview;
      }
      throw new Error('Desteklenmeyen çalma listesi bağlantısı.');
    };

    const timer = window.setTimeout(() => {
      void load()
        .then((next) => {
          if (!cancelled) setPreview(next);
        })
        .catch((error) => {
          if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Çalma listesi önizlenemedi.');
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deferredQuery, library.tracks]);

  const pushHistory = (value: string, record = true) => {
    const clean = value.trim();
    if (clean.length < 2) return;
    setHistory((current) => {
      const next = [clean, ...current.filter((item) => item.toLocaleLowerCase('tr') !== clean.toLocaleLowerCase('tr'))].slice(0, 8);
      try { localStorage.setItem('Norie.searchHistory', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    if (record) {
      void api.recordSearch(clean).catch(() => undefined);
    }
  };

  const importPreview = async (selectedIndexes: number[], existingPlaylistId?: string) => {
    if (!preview) return;
    const result = await api.importPlaylist({
      provider: preview.provider,
      sourceUrl: preview.sourceUrl,
      sourcePlaylistId: preview.sourcePlaylistId,
      title: preview.title,
      description: preview.description ?? undefined,
      artworkUrl: preview.artworkUrl,
      existingPlaylistId,
      skipDuplicates: true,
      selectedIndexes,
      items: preview.items.map((item) => ({
        providerTrackId: item.providerTrackId,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration: item.duration,
        artworkUrl: item.artworkUrl,
        sourceUrl: item.sourceUrl,
      })),
    });
    await refreshPlaylists();
    pushToast(
      result.alreadyImported
        ? 'Bu liste zaten kütüphanende.'
        : `İçe aktarma bitti: ${result.importedCount} eklendi, ${result.unmatchedCount} referans korundu, ${result.skippedCount} atlandı.`,
      'success',
    );
    navigate(`/playlist/${result.playlist.id}`);
  };

  const downloadAllPreview = () => {
    if (!preview) return;
    const tracks = preview.items.map((item) => item.matchedTrack).filter((track): track is Track => Boolean(track));
    if (tracks.length === 0) {
      pushToast('İndirilebilir parça yok; referanslar korunacak.', 'info');
      return;
    }
    void Promise.all(tracks.map((track) => downloadTrack(track).catch(() => undefined))).then(() =>
      pushToast('İndirme tamamlandı.', 'success'),
    );
    pushToast(`${tracks.length} parça indiriliyor…`, 'info');
  };

  const handleSpotifyImport = async () => {
    if (!spotify || importing) return;
    setImporting(true);
    try {
      const playlist = await api.createPlaylist({ name: spotify.title.slice(0, 80) || 'Spotify İçe Aktarma' });
      let ok = 0;
      let fail = 0;
      for (const item of spotify.items) {
        const needle = normalize(item.title);
        const artist = normalize(item.artist);
        const match = library.tracks.find(
          (track) =>
            normalize(track.title).includes(needle) &&
            (artist === '' || normalize(track.artist).includes(artist) || normalize(track.albumArtist).includes(artist)),
        );
        if (!match) {
          fail += 1;
          continue;
        }
        try {
          await api.addTrack(playlist.id, match.id);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      pushToast(
        `İçe aktarma bitti: ${ok} parça listeye eklendi${fail ? `, ${fail} bulunamadı` : ''}.`,
        fail > 0 ? 'info' : 'success',
      );
      navigate(`/playlist/${playlist.id}`);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'İçe aktarma başarısız.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const fetchYtPlaylist = async () => {
    if (!ytPlaylistUrl.trim()) return;
    setYtPlaylistLoading(true);
    setYtPlaylistError(null);
    setYtPlaylist(null);
    try {
      const result = await api.youtubePlaylist(ytPlaylistUrl.trim());
      setYtPlaylist(result);
    } catch (error) {
      setYtPlaylistError(error instanceof Error ? error.message : 'Çalma listesi alınamadı.');
    } finally {
      setYtPlaylistLoading(false);
    }
  };

  const importYtPlaylist = async () => {
    if (!ytPlaylist || ytPlaylistImporting) return;
    setYtPlaylistImporting(true);
    try {
      const playlist = await api.createPlaylist({ name: ytPlaylist.title.slice(0, 80) || 'YouTube İçe Aktarma' });
      let ok = 0;
      let fail = 0;
      for (const item of ytPlaylist.items) {
        const needle = normalize(item.title);
        const artist = normalize(item.uploader);
        const match = library.tracks.find(
          (track) =>
            normalize(track.title).includes(needle) &&
            (artist === '' || normalize(track.artist).includes(artist)),
        );
        if (!match) {
          fail += 1;
          continue;
        }
        try {
          await api.addTrack(playlist.id, match.id);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      pushToast(
        `İçe aktarma bitti: ${ok} parça listeye eklendi${fail ? `, ${fail} bulunamadı` : ''}.`,
        fail > 0 ? 'info' : 'success',
      );
      navigate(`/playlist/${playlist.id}`);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'İçe aktarma başarısız.', 'error');
    } finally {
      setYtPlaylistImporting(false);
    }
  };

  const handleDownload = async (item: YouTubeResult) => {
    setDownloadingId(item.id);
    try {
      await api.youtubeDownload({ id: item.id, title: item.title, uploader: item.uploader, thumbnail: item.thumbnail });
      pushToast(`“${item.title}” indirildi ve kütüphaneye eklendi.`, 'success');
      await refreshLibrary();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'İndirme başarısız.', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const genres = useMemo(() => {
    const map = new Map<string, { count: number; coverUrl: string | null }>();
    for (const track of library.tracks) {
      if (!track.genre) continue;
      const current = map.get(track.genre);
      if (current) current.count += 1;
      else map.set(track.genre, { count: 1, coverUrl: track.coverUrl });
    }
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([name, value]) => ({ name, ...value }));
  }, [library.tracks]);

  const counts: Record<SearchTab, number> = {
    all: total,
    tracks: results.tracks.length,
    albums: results.albums.length,
    artists: results.artists.length,
  };

  // The empty state is only honest once every provider has answered: Spotify
  // and YouTube results arrive after the local catalogue.
  const spotifyHits = spotifyCatalog?.tracks.length ?? 0;
  const remoteLoading = ytLoading || spotifyCatalogLoading;
  const showEmptyState = total === 0 && ytResults.length === 0 && spotifyHits === 0 && !remoteLoading;

  const renderSpotifyCatalog = () => {
    if (spotifyCatalogLoading) {
      return (
        <section className="content-section">
          <div className="section-heading"><div><h2>Spotify</h2><p>Spotify'da aranıyor…</p></div></div>
          <div className="surface-panel" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Loader2 size={18} className="spin" /><span>Spotify'da aranıyor…</span>
          </div>
        </section>
      );
    }
    if (spotifyCatalogError) {
      return (
        <section className="content-section">
          <div className="section-heading"><div><h2>Spotify</h2></div></div>
          <EmptyState icon={SearchX} title="Spotify sonuçları alınamadı" description={spotifyCatalogError} compact />
        </section>
      );
    }
    if (!spotifyCatalog || (spotifyCatalog.tracks.length === 0 && spotifyCatalog.artists.length === 0 && spotifyCatalog.albums.length === 0 && spotifyCatalog.playlists.length === 0)) {
      return null;
    }
    return (
      <section className="content-section" aria-label="Spotify kataloğu">
        <div className="section-heading">
          <div>
            <h2>Spotify</h2>
            <p>Spotify'da bulunan şarkılar. Abonelik gerekmez; dokun ve dinle.</p>
          </div>
        </div>
        {spotifyCatalog.tracks.length ? (
          <div className="surface-panel import-track-list">
            {spotifyCatalog.tracks.slice(0, 8).map((track) => {
              const local = matchTrack(track, library.tracks);
              return (
                <article className={`import-track-row ${local ? 'is-playable' : 'is-unavailable'}`} key={`spotify-${track.id}`}>
                  <Cover
                    src={track.artworkUrl}
                    alt=""
                    seed={track.id}
                    className="import-cover"
                    iconSize={16}
                  />
                  <div className="import-copy">
                    <strong>{track.title}</strong>
                    <span>{track.artist}{track.album && track.album !== track.title ? ` · ${track.album}` : ''}</span>
                    <small>
                      {local ? 'Kütüphanende var' : ''}
                      {local && track.duration ? ' · ' : ''}
                      {track.duration ? formatDuration(track.duration) : ''}
                    </small>
                  </div>
                  {local ? (
                    <>
                      <PlayButton tracks={[local]} size="sm" label={`${track.title} çal`} />
                      <DownloadButton track={local} />
                    </>
                  ) : (
                    <>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ flexShrink: 0, padding: '4px 12px', fontSize: '0.8rem' }}
                      onClick={() => {
                        const queue = spotifyCatalog.tracks
                          .filter((entry) => !matchTrack(entry, library.tracks))
                          .map(spotifyCatalogTrackToTrack);
                        playTrack(spotifyCatalogTrackToTrack(track), queue);
                      }}
                      title="Çal"
                    >
                      <Play size={14} fill="currentColor" /> Çal
                    </button>
                    <a className="icon-button subtle import-source" href={track.sourceUrl ?? undefined} target="_blank" rel="noreferrer" title="Spotify'da aç" aria-label="Spotify'da aç">
                      <Link2 size={16} />
                    </a>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}
        {spotifyCatalog.playlists.length ? (
          <div className="card-grid playlist-grid">
            {spotifyCatalog.playlists.slice(0, 4).map((playlist) => (
              <a key={playlist.id} className="album-card" href={playlist.sourceUrl ?? undefined} target="_blank" rel="noreferrer">
                <Cover src={playlist.imageUrl} alt="" seed={playlist.id} className="album-cover" />
                <span className="album-copy"><strong>{playlist.name}</strong><small>{playlist.owner}{playlist.trackCount ? ` · ${playlist.trackCount} parça` : ''}</small></span>
              </a>
            ))}
          </div>
        ) : null}
      </section>
    );
  };

  const renderSpotify = () => (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <h2>Spotify içe aktar</h2>
          <p>Bağlantıyı algıladık — yalnızca kütüphanende bulunan parçalar listeye eklenir.</p>
        </div>
      </div>
      {spotifyLoading ? (
        <div className="surface-panel" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader2 size={18} className="spin" />
          <span>Spotify bağlantısı çözülüyor…</span>
        </div>
      ) : spotifyError ? (
        <EmptyState icon={SearchX} title="Spotify çözülemedi" description={spotifyError} />
      ) : spotify ? (
        <div className="surface-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong style={{ fontSize: '1rem' }}>{spotify.title}</strong>
              <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 4 }}>
                {spotify.items.length} şarkı — yalnızca kütüphanende bulunanlar eşleştirilecek.
              </div>
            </div>
            <button type="button" className="button primary" disabled={importing} onClick={() => void handleSpotifyImport()}>
              {importing ? <><Loader2 size={16} className="spin" /> İçe aktarılıyor…</> : <><Download size={16} /> Playlist oluştur</>}
            </button>
          </div>
          <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
            {spotify.items.slice(0, 8).map((item, i) => (
              <li key={i} style={{ padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <strong>{item.title}</strong> <span style={{ color: 'var(--muted)' }}>· {item.artist}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );

  const renderYouTube = () => (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <h2>YouTube</h2>
          <p>YouTube'da bulunan sonuçlar. Oynat ya da indir.</p>
        </div>
      </div>

      {ytLoading ? (
        <div className="surface-panel" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader2 size={18} className="spin" />
          <span>YouTube'da aranıyor…</span>
        </div>
      ) : ytError ? (
        <EmptyState icon={SearchX} title="YouTube araması başarısız" description={ytError} />
      ) : ytResults.length === 0 ? (
        <EmptyState icon={Music} title="Sonuç yok" description="Farklı bir ifade deneyebilirsin." />
      ) : (
        <div className="surface-panel">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {ytResults.map((item) => (
              <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border, #333)' }}>
                <button
                  type="button"
                  onClick={() => playTrack(youtubeResultToTrack(item), ytResults.map(youtubeResultToTrack))}
                  aria-label={`${item.title} oynat`}
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', flexShrink: 0 }}
                >
                  <img
                    src={item.thumbnail}
                    alt=""
                    width={48}
                    height={48}
                    style={{ borderRadius: 6, objectFit: 'cover', display: 'block' }}
                    loading="lazy"
                  />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.uploader}
                    {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => playTrack(youtubeResultToTrack(item), ytResults.map(youtubeResultToTrack))}
                  style={{ flexShrink: 0 }}
                >
                  <Play size={16} />
                  Oynat
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={downloadingId === item.id}
                  onClick={() => void handleDownload(item)}
                  style={{ flexShrink: 0 }}
                >
                  {downloadingId === item.id ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      İndiriliyor…
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      İndir
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );

  return (
    <div className="page search-page">
      <header className="page-heading search-heading">
        <span className="eyebrow">Keşfet</span>
        <h1>Ne dinlemek istiyorsun?</h1>
        <p>Şarkı, sanatçı veya albüm ara.</p>
      </header>

      <div className="search-box">
        {catalogLoading ? <Loader2 size={22} className="spin" aria-hidden="true" /> : <Search size={22} aria-hidden="true" />}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSuggestOpen(event.target.value.trim().length >= 2);
          }}
          onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              pushHistory(query);
              setSuggestOpen(false);
            }
          }}
          placeholder="Şarkı, albüm, sanatçı veya Spotify linki yapıştır…"
          autoFocus
          aria-label="Kitaplıkta ara"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="search-clear" onClick={() => { setQuery(''); setSuggestOpen(false); }} aria-label="Aramayı temizle">
            <X size={17} />
          </button>
        ) : (
          <span className="search-hint">Kitaplığında {formatCount(library.stats.tracks)} parça</span>
        )}
        <SearchSuggestions
          query={query}
          open={suggestOpen}
          onClose={() => setSuggestOpen(false)}
          onPickText={(text) => {
            setQuery(text);
            pushHistory(text);
            setSuggestOpen(false);
          }}
          onPickSong={(song: SuggestionSong) => {
            playTrack(songToTrack(song));
            pushHistory(song.title);
            setSuggestOpen(false);
          }}
          onPlaySong={(song: SuggestionSong) => {
            playTrack(songToTrack(song));
            setSuggestOpen(false);
          }}
        />
      </div>

      {isPlaylistUrl(deferredQuery) ? (
        previewLoading ? (
          <div className="surface-panel" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Loader2 size={18} className="spin" />
            <span>Çalma listesi okunuyor…</span>
          </div>
        ) : previewError || (!preview && !isSpotifyUrl) ? (
          <EmptyState icon={SearchX} title="Çalma listesi önizlenemedi" description={previewError ?? 'Bağlantı desteklenmiyor veya liste gizli olabilir.'} />
        ) : preview ? (
          <ImportPreviewPanel
            preview={preview}
            playlists={playlists}
            onImport={importPreview}
            onDownloadAll={downloadAllPreview}
          />
        ) : null
      ) : null}

      {!query.trim() ? (
        <>
          <section className="content-section">
            <div className="section-heading">
              <div>
                <h2>YouTube çalma listesi içe aktar</h2>
                <p>Bağlantıyı yapıştır; yalnızca kütüphanende bulunan parçalar listeye eklenir.</p>
              </div>
            </div>
            <div className="surface-panel import-panel">
              <input
                type="url"
                value={ytPlaylistUrl}
                onChange={(event) => setYtPlaylistUrl(event.target.value)}
                placeholder="https://www.youtube.com/playlist?list=…"
                aria-label="YouTube çalma listesi bağlantısı"
              />
              <button type="button" className="button secondary" onClick={() => void fetchYtPlaylist()} disabled={ytPlaylistLoading || !ytPlaylistUrl.trim()}>
                {ytPlaylistLoading ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
                {ytPlaylistLoading ? 'Okunuyor…' : 'Önizle'}
              </button>
              {ytPlaylistError ? <p className="form-error">{ytPlaylistError}</p> : null}
              {ytPlaylist ? (
                <div className="import-preview">
                  <strong>{ytPlaylist.title}</strong>
                  <span>{ytPlaylist.items.length} öğe</span>
                  <ul>
                    {ytPlaylist.items.slice(0, 6).map((item) => (
                      <li key={item.id}><strong>{item.title}</strong> <span>{item.uploader}</span></li>
                    ))}
                  </ul>
                  <button type="button" className="button primary" onClick={() => void importYtPlaylist()} disabled={ytPlaylistImporting}>
                    {ytPlaylistImporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                    {ytPlaylistImporting ? 'İçe aktarılıyor…' : 'Playlist oluştur'}
                  </button>
                </div>
              ) : null}
            </div>
          </section>
          {history.length > 0 ? (
            <section className="content-section recent-searches" aria-label="Son aramalar">
              <div className="section-heading">
                <div><h2>Son aramalar</h2><p>Tek dokunuşla devam et.</p></div>
                <button type="button" className="text-button" onClick={() => { setHistory([]); void api.clearSearchHistory().catch(() => undefined); try { localStorage.removeItem('Norie.searchHistory'); } catch { /* private mode */ } }}>Temizle</button>
              </div>
              <div className="filter-pills">
                {history.map((item) => (
                  <button type="button" key={item} className="filter-pill" onClick={() => { setQuery(item); pushHistory(item, false); }}>{item}</button>
                ))}
              </div>
            </section>
          ) : null}
          {genres.length > 0 ? (
            <section className="content-section">
              <div className="section-heading">
                <div>
                  <h2>Türlere göz at</h2>
                  <p>Kütüphanendeki renklere göre keşfet.</p>
                </div>
              </div>
              <div className="genre-grid">
                {genres.map((genre) => (
                  <button
                    type="button"
                    key={genre.name}
                    className="genre-card"
                    style={coverGradient(genre.name)}
                    onClick={() => setQuery(genre.name)}
                  >
                    <span className="genre-icon">
                      <Sparkles size={19} />
                    </span>
                    <span>
                      <strong>{genre.name}</strong>
                      <small>{genre.count} parça</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="content-section">
            <div className="section-heading">
              <div>
                <h2>Albümlerde keşfet</h2>
                <p>Arşivindeki tüm albümler.</p>
              </div>
            </div>
            <div className="card-grid album-grid">
              {library.albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-heading">
              <div>
                <h2>Sanatçılar</h2>
                <p>Kütüphanende yer alan sanatçılar.</p>
              </div>
            </div>
            <div className="card-grid artist-grid">
              {library.artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          {isPlaylistUrl(deferredQuery) ? null : isSpotifyUrl ? (
            renderSpotify()
          ) : (
            <>
              {renderSpotifyCatalog()}
              {renderYouTube()}

              {total > 0 ? (
                <div className="search-results">
                  <div className="search-tabs" role="tablist" aria-label="Kütüphane sonuçları">
                    {TABS.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        role="tab"
                        aria-selected={tab === item.id}
                        className={clsx('filter-chip', tab === item.id && 'is-active')}
                        onClick={() => setTab(item.id)}
                      >
                        {item.label}
                        <span>{counts[item.id]}</span>
                      </button>
                    ))}
                  </div>
              {results.tracks.length > 0 && (tab === 'all' || tab === 'tracks') ? (
                <section className="content-section">
                  <div className="section-heading">
                    <div>
                      <h2>Şarkılar</h2>
                      <p>{results.tracks.length} eşleşme</p>
                    </div>
                  </div>
                  <div className="surface-panel">
                    <TrackList tracks={tab === 'all' ? results.tracks.slice(0, 6) : results.tracks} />
                  </div>
                </section>
              ) : null}

              {results.albums.length > 0 && (tab === 'all' || tab === 'albums') ? (
                <section className="content-section">
                  <div className="section-heading">
                    <div>
                      <h2>Albümler</h2>
                      <p>{results.albums.length} eşleşme</p>
                    </div>
                  </div>
                  <div className="card-grid album-grid">
                    {results.albums.map((album) => (
                      <AlbumCard key={album.id} album={album} />
                    ))}
                  </div>
                </section>
              ) : null}

              {results.artists.length > 0 && (tab === 'all' || tab === 'artists') ? (
                <section className="content-section">
                  <div className="section-heading">
                    <div>
                      <h2>Sanatçılar</h2>
                      <p>{results.artists.length} eşleşme</p>
                    </div>
                  </div>
                  <div className="card-grid artist-grid">
                    {results.artists.map((artist) => (
                      <ArtistCard key={artist.id} artist={artist} />
                    ))}
                  </div>
                </section>
              ) : null}

              {tab !== 'all' && counts[tab] === 0 ? (
                <EmptyState
                  icon={Disc3}
                  title="Bu kategoride sonuç yok"
                  description="Diğer sonuç türlerine göz atabilir veya aramayı değiştirebilirsin."
                  action={
                    <button type="button" className="button secondary" onClick={() => setTab('all')}>
                      Tüm sonuçları göster
                    </button>
                  }
                />
              ) : null}
                </div>
              ) : null}

              {showEmptyState ? (
                <EmptyState
                  icon={SearchX}
                  title="Sonuç bulunamadı."
                  description="Başka bir şarkı, sanatçı veya albüm deneyin."
                  compact
                />
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}