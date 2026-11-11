import { Loader2, Music, Play, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Track } from '../types';

export type SuggestionSong = {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number | null;
  url: string;
};

type Props = {
  query: string;
  open: boolean;
  onClose: () => void;
  onPickSong: (song: SuggestionSong) => void;
  onPlaySong: (song: SuggestionSong) => void;
};

function songToTrack(song: SuggestionSong): Track {
  return {
    id: `sp_${song.id}`,
    title: song.title,
    artist: song.artist,
    album: 'Spotify',
    albumArtist: song.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: song.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: 'spotify',
    size: 0,
    coverUrl: song.thumbnail || null,
    // Metadata identity: the resolver picks the audio source at play time.
    streamUrl: `spotify:${song.id}`,
    addedAt: new Date().toISOString(),
  };
}

/**
 * Live suggestions for the search boxes.
 *
 * Spotify is the catalogue that matters here, so the list is built from Spotify
 * tracks (with artwork). The old autocomplete text rows came from YouTube's
 * suggestion feed and filled the panel with noise, so they are gone: no matches
 * means no panel, not a list of guesses.
 */
export function SearchSuggestions({ query, open, onClose, onPickSong, onPlaySong }: Props) {
  const [songs, setSongs] = useState<SuggestionSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const cacheRef = useRef<Map<string, SuggestionSong[]>>(new Map());

  useEffect(() => {
    const needle = query.trim();
    if (!needle || needle.length < 2 || needle.includes('open.spotify.com') || /(?:youtube\.com|youtu\.be)/.test(needle)) {
      setSongs([]);
      setLoading(false);
      setFailed(false);
      setActiveIndex(-1);
      return;
    }
    const cached = cacheRef.current.get(needle);
    if (cached) {
      setSongs(cached);
      setLoading(false);
      setFailed(false);
      setActiveIndex(-1);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      void api
        .spotifySearch(needle, 6)
        .then((result) => {
          if (cancelled) return;
          const next = (result.tracks ?? []).slice(0, 6).map((track) => ({
            id: track.id,
            title: track.title,
            artist: track.artist,
            thumbnail: track.artworkUrl ?? '',
            duration: track.duration ?? null,
            url: track.sourceUrl ?? '',
          }));
          cacheRef.current.set(needle, next);
          if (cacheRef.current.size > 60) {
            const first = cacheRef.current.keys().next().value;
            if (first) cacheRef.current.delete(first);
          }
          setSongs(next);
        })
        .catch(() => {
          if (cancelled) return;
          setSongs([]);
          setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (!open || songs.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % songs.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + songs.length) % songs.length);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        const song = songs[activeIndex];
        if (!song) return;
        event.preventDefault();
        onPlaySong(song);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, activeIndex, songs, onClose, onPlaySong]);

  if (!open || query.trim().length < 2) return null;
  if (!loading && songs.length === 0 && !failed) return null;

  return (
    <div className="search-suggestions" role="listbox" aria-label="Spotify önerileri">
      {loading ? (
        <div className="search-suggestion-status">
          <Loader2 size={15} className="spin" /> Spotify'da aranıyor…
        </div>
      ) : null}
      {failed ? (
        <div className="search-suggestion-status">
          <Search size={15} /> Spotify önerileri alınamadı.
        </div>
      ) : null}
      {songs.map((song, index) => {
        const active = index === activeIndex;
        return (
          <button
            type="button"
            key={`spotify-${song.id}`}
            role="option"
            aria-selected={active}
            className={`search-suggestion-row ${active ? 'is-active' : ''}`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onPickSong(song)}
          >
            {song.thumbnail ? (
              <img className="search-suggestion-art" src={song.thumbnail} alt="" width={40} height={40} loading="lazy" />
            ) : (
              <span className="search-suggestion-art search-suggestion-art-empty">
                <Music size={16} />
              </span>
            )}
            <span className="search-suggestion-copy">
              <strong>{song.title}</strong>
              <small>{song.artist} · Spotify</small>
            </span>
            <span
              className="search-suggestion-play"
              role="button"
              tabIndex={-1}
              aria-label={`${song.title} oynat`}
              onClick={(event) => {
                event.stopPropagation();
                onPlaySong(song);
              }}
            >
              <Play size={14} fill="currentColor" />
            </span>
          </button>
        );
      })}
      {songs.length > 0 ? (
        <div className="search-suggestion-hint">↑↓ gez · Enter çal · Esc kapat</div>
      ) : null}
    </div>
  );
}

export { songToTrack };
