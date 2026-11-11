import { useEffect, useState } from 'react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { t } from '../lib/i18n';
import { Disc3, Link2, Loader2, Music, Play, Search, SearchX, Sparkles, X, ArrowUpRight } from 'lucide-react';
import clsx from 'clsx';
import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { Cover } from '../components/Cover';
import { DownloadButton } from '../components/DownloadButton';
import { EmptyState } from '../components/EmptyState';
import { RemotePlaylistView } from '../components/RemotePlaylistView';
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
import type { Track, YouTubeResult, SpotifyResolved, SpotifyCatalogSearch, UserSearchResult } from '../types';
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
  const { library, playlists, refreshPlaylists } = useMusicData();
  const pushToast = useToastStore((state) => state.push);
  const downloadTrack = useDownloads((state) => state.download);
  const playTrack = usePlayer((state) => state.playTrack);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const rawTab = params.get('tab');
  const tab: SearchTab = TABS.some((item) => item.id === rawTab) ? (rawTab as SearchTab) : 'all';
  // Search runs while typing, but only after the input settles: every provider
  // call is a network round trip (YouTube shells out to yt-dlp), so firing one
  // per keystroke floods the server and starves the answer.
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 420);
    return () => window.clearTimeout(timer);
  }, [query]);
  const deferredQuery = debouncedQuery;

  const navigate = useNavigate();
  const [ytResults, setYtResults] = useState<YouTubeResult[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
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
  const [spotifyRetry, setSpotifyRetry] = useState(0);
  const [people, setPeople] = useState<UserSearchResult[]>([]);
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

  // A pasted Spotify playlist becomes a playable queue: tracks that carry a
  // YouTube id play from that upload, the rest are resolved from metadata.
  const spotifyTracks = useMemo<Track[]>(() => {
    if (!spotify) return [];
    const seen = new Map<string, number>();
    return spotify.items.map((item, index) => {
      const videoId = item.providerTrackId && /^[\w-]{11}$/.test(item.providerTrackId) ? item.providerTrackId : null;
      const key = videoId ?? `${normalize(item.title)}::${normalize(item.artist)}`;
      const repeat = seen.get(key) ?? 0;
      seen.set(key, repeat + 1);
      const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || `parca-${index}`;
      return {
        id: videoId ? `yt_${videoId}` : `sp_${slug}-${repeat}`,
        title: item.title,
        artist: item.artist,
        album: item.album ?? spotify.title,
        albumArtist: item.artist,
        genre: null,
        year: null,
        trackNo: index + 1,
        discNo: null,
        duration: item.duration ?? 0,
        bitrate: null,
        sampleRate: null,
        channels: null,
        format: videoId ? 'youtube' : 'spotify',
        size: 0,
        coverUrl: item.artworkUrl ?? spotify.artworkUrl ?? null,
        streamUrl: videoId ? `youtube:${videoId}` : `spotify:${slug}-${repeat}`,
        addedAt: new Date().toISOString(),
      } satisfies Track;
    });
  }, [spotify]);

  const ytPlaylistTracks = useMemo<Track[]>(
    () => (ytPlaylist?.items ?? []).map((item) => youtubeResultToTrack(item)),
    [ytPlaylist],
  );

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
      if (!/(?:youtube\.com|youtu\.be)/i.test(needle)) return;
      let cancelled = false;
      setYtPlaylistLoading(true);
      setYtPlaylistError(null);
      setYtPlaylist(null);
      api
        .youtubePlaylist(needle)
        .then((payload) => {
          if (cancelled) return;
          setYtPlaylist({ title: payload.title, items: payload.items, total: payload.total });
        })
        .catch((error) => {
          if (cancelled) return;
          setYtPlaylistError(error instanceof Error ? error.message : 'Liste okunamadı.');
        })
        .finally(() => {
          if (!cancelled) setYtPlaylistLoading(false);
        });
      return () => {
        cancelled = true;
      };
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
          // Never swallow this: a missing Spotify section used to look like
          // "no results" when the real cause was a failed or unconfigured API.
          setSpotifyCatalogError(error instanceof Error ? error.message : 'Spotify sonuçları alınamadı.');
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
  }, [deferredQuery, spotifyRetry]);

  // People search: skipped for URLs and very short queries.
  useEffect(() => {
    const needle = deferredQuery;
    if (!needle || needle.length < 2 || needle.includes('open.spotify.com') || /(?:youtube\.com|youtu\.be)/.test(needle)) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .searchUsers(needle)
        .then((result) => {
          if (!cancelled) setPeople(result.users ?? []);
        })
        .catch(() => {
          if (!cancelled) setPeople([]);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deferredQuery]);

  useEffect(() => {
    if (!spotify || !isPlaylistUrl(deferredQuery) || !deferredQuery.includes('open.spotify.com')) return;    const items = withMatches(
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
      // Server-side import keeps every reference, so the new playlist lists the
      // whole album/playlist instead of only the tracks already in the library.
      const result = await api.importPlaylist({
        provider: 'spotify',
        sourceUrl: deferredQuery,
        sourcePlaylistId: deferredQuery.match(/(?:playlist|album)\/([^?/]+)/)?.[1] ?? null,
        title: spotify.title.slice(0, 80) || 'Spotify listesi',
        description: spotify.description ?? undefined,
        artworkUrl: spotify.artworkUrl ?? null,
        skipDuplicates: true,
        items: spotify.items.map((item) => ({
          providerTrackId: item.providerTrackId ?? null,
          title: item.title,
          artist: item.artist,
          album: item.album ?? null,
          duration: item.duration ?? null,
          artworkUrl: item.artworkUrl ?? null,
          sourceUrl: item.sourceUrl ?? deferredQuery,
        })),
      });
      await refreshPlaylists();
      pushToast(
        `“${result.playlist.name}” kaydedildi: ${result.importedCount} parça eklendi.`,
        'success',
      );
      navigate(`/playlist/${result.playlist.id}`);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'İçe aktarma başarısız.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const importYtPlaylist = async () => {
    if (!ytPlaylist || ytPlaylistImporting) return;
    setYtPlaylistImporting(true);
    try {
      const result = await api.importPlaylist({
        provider: 'youtube',
        sourceUrl: deferredQuery,
        sourcePlaylistId: (() => {
          try {
            return new URL(deferredQuery).searchParams.get('list');
          } catch {
            return null;
          }
        })(),
        title: ytPlaylist.title.slice(0, 80) || 'YouTube listesi',
        artworkUrl: ytPlaylist.items[0]?.thumbnail ?? null,
        skipDuplicates: true,
        items: ytPlaylist.items.map((item) => ({
          providerTrackId: item.id,
          title: item.title,
          artist: item.uploader,
          album: 'YouTube',
          duration: item.duration ?? null,
          artworkUrl: item.thumbnail ?? null,
          sourceUrl: item.url ?? `https://www.youtube.com/watch?v=${item.id}`,
        })),
      });
      await refreshPlaylists();
      pushToast(
        `“${result.playlist.name}” kaydedildi: ${result.importedCount} parça eklendi.`,
        'success',
      );
      navigate(`/playlist/${result.playlist.id}`);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'İçe aktarma başarısız.', 'error');
    } finally {
      setYtPlaylistImporting(false);
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
          <div className="surface-panel source-error">
            <p>{spotifyCatalogError || t('Spotify sonuçları alınamadı.', 'Spotify results could not be loaded.')}</p>
            <button
              type="button"
              className="button secondary compact"
              onClick={() => setSpotifyRetry((value) => value + 1)}
            >
              <Loader2 size={15} className={spotifyCatalogLoading ? 'spin' : undefined} />
              {t('Yeniden dene', 'Try again')}
            </button>
          </div>
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
                    <DownloadButton track={spotifyCatalogTrackToTrack(track)} />
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

  const renderSpotify = () => {
    if (spotifyLoading) {
      return (
        <section className="content-section">
          <div className="section-heading"><div><h2>Spotify listesi</h2><p>Bağlantı çözülüyor…</p></div></div>
          <div className="surface-panel remote-loading">
            <Loader2 size={18} className="spin" />
            <span>Spotify bağlantısı okunuyor…</span>
          </div>
        </section>
      );
    }
    if (spotifyError) {
      return <EmptyState icon={SearchX} title="Spotify bağlantısı okunamadı" description={spotifyError} />;
    }
    if (!spotify) return null;
    return (
      <RemotePlaylistView
        source="spotify"
        title={spotify.title}
        description={spotify.description}
        creator={spotify.creator}
        coverUrl={spotify.artworkUrl}
        sourceUrl={deferredQuery}
        tracks={spotifyTracks}
        totalDuration={spotify.totalDuration}
        importing={importing}
        onImport={() => void handleSpotifyImport()}
        importLabel="Çalma listesini oluştur"
      />
    );
  };

  const renderYouTubePlaylist = () => {
    if (ytPlaylistLoading) {
      return (
        <section className="content-section">
          <div className="section-heading"><div><h2>YouTube listesi</h2><p>Bağlantı çözülüyor…</p></div></div>
          <div className="surface-panel remote-loading">
            <Loader2 size={18} className="spin" />
            <span>YouTube listesi okunuyor…</span>
          </div>
        </section>
      );
    }
    if (ytPlaylistError) {
      return <EmptyState icon={SearchX} title="YouTube listesi okunamadı" description={ytPlaylistError} />;
    }
    if (!ytPlaylist) return null;
    return (
      <RemotePlaylistView
        source="youtube"
        title={ytPlaylist.title}
        coverUrl={ytPlaylist.items[0]?.thumbnail ?? null}
        sourceUrl={deferredQuery}
        tracks={ytPlaylistTracks}
        importing={ytPlaylistImporting}
        onImport={() => void importYtPlaylist()}
        importLabel="Çalma listesini oluştur"
      />
    );
  };

  const renderPeople = () => {
    if (people.length === 0) return null;
    return (
      <section className="content-section people-section" aria-label={t('NorieMusic kullanıcıları', 'NorieMusic users')}>
        <div className="section-heading">
          <div>
            <h2>{t('NorieMusic Kullanıcıları', 'NorieMusic Users')}</h2>
            <p>{t('Profilleri eşleşen kişiler.', 'People whose profiles match.')}</p>
          </div>
        </div>
        <div className="surface-panel people-list">
          {people.map((person) => (
            <Link
              key={person.id}
              className="person-row"
              to={person.username ? `/u/${person.username}` : `/profile/${person.id}`}
            >
              {person.avatarUrl ? (
                <img className="person-avatar" src={person.avatarUrl} alt="" loading="lazy" />
              ) : (
                <span className="person-avatar person-avatar-fallback" aria-hidden="true">
                  {person.displayName.slice(0, 2).toLocaleUpperCase('tr')}
                </span>
              )}
              <span className="person-copy">
                <strong>{person.displayName}</strong>
                <small>{person.username ? `@${person.username}` : t('Profil', 'Profile')}</small>
              </span>
              {person.bio ? <span className="person-bio">{person.bio}</span> : null}
              <ArrowUpRight size={16} className="person-arrow" />
            </Link>
          ))}
        </div>
      </section>
    );
  };

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
                <DownloadButton track={youtubeResultToTrack(item)} />
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

      {isPlaylistUrl(deferredQuery) && !/(?:youtube\.com|youtu\.be|open\.spotify\.com)/i.test(deferredQuery) ? (
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
                <h2>Bağlantıyla aç</h2>
                <p>Spotify veya YouTube çalma listesi bağlantısını yukarıdaki arama kutusuna yapıştır; içerik görsel olarak açılır ve doğrudan çalar.</p>
              </div>
            </div>
            <div className="surface-panel import-panel">
              <input
                type="url"
                value={ytPlaylistUrl}
                onChange={(event) => setYtPlaylistUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    setQuery(ytPlaylistUrl.trim());
                  }
                }}
                placeholder="https://open.spotify.com/playlist/… veya https://www.youtube.com/playlist?list=…"
                aria-label="Çalma listesi bağlantısı"
              />
              <button
                type="button"
                className="button secondary"
                onClick={() => setQuery(ytPlaylistUrl.trim())}
                disabled={!ytPlaylistUrl.trim()}
              >
                <Link2 size={16} />
                Aç
              </button>
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
          {isSpotifyUrl ? (
            renderSpotify()
          ) : isPlaylistUrl(deferredQuery) ? (
            renderYouTubePlaylist()
          ) : (
            <>
              {renderSpotifyCatalog()}
              {renderYouTube()}

              {renderPeople()}

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