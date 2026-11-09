import { Loader2, Music, Play, Search, TrendingUp } from 'lucide-react';
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
  onPickText: (text: string) => void;
  onPickSong: (song: SuggestionSong) => void;
  onPlaySong: (song: SuggestionSong) => void;
};

function songToTrack(song: SuggestionSong): Track {
  return {
    id: `yt_${song.id}`,
    title: song.title,
    artist: song.artist,
    album: 'YouTube',
    albumArtist: song.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: song.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: 'youtube',
    size: 0,
    coverUrl: song.thumbnail,
    streamUrl: `youtube:${song.id}`,
    addedAt: new Date().toISOString(),
  };
}

export function SearchSuggestions({ query, open, onClose, onPickText, onPickSong, onPlaySong }: Props) {
  const [texts, setTexts] = useState<string[]>([]);
  const [songs, setSongs] = useState<SuggestionSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, { texts: string[]; songs: SuggestionSong[] }>>(new Map());

  const rows = [
    ...songs.map((song) => ({ kind: 'song' as const, song })),
    ...texts.map((text) => ({ kind: 'text' as const, text })),
  ];

  useEffect(() => {
    const needle = query.trim();
    if (!needle || needle.length < 2 || needle.includes('open.spotify.com') || needle.includes('youtube.com/')) {
      setTexts([]);
      setSongs([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }
    const cached = cacheRef.current.get(needle);
    if (cached) {
      setTexts(cached.texts);
      setSongs(cached.songs);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      api
        .searchSuggestions(needle)
        .then((payload) => {
          if (cancelled) return;
          const nextTexts = payload.texts ?? [];
          const nextSongs = payload.songs ?? [];
          cacheRef.current.set(needle, { texts: nextTexts, songs: nextSongs });
          if (cacheRef.current.size > 60) {
            const first = cacheRef.current.keys().next().value;
            if (first) cacheRef.current.delete(first);
          }
          setTexts(nextTexts);
          setSongs(nextSongs);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (!cancelled) {
            setTexts([]);
            setSongs([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
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
      if (!open || rows.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % rows.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + rows.length) % rows.length);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        const row = rows[activeIndex];
        if (!row) return;
        if (row.kind === 'song') onPlaySong(row.song);
        else onPickText(row.text);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, activeIndex, rows, onClose, onPickText, onPlaySong]);

  if (!open || query.trim().length < 2) return null;
  if (!loading && rows.length === 0) return null;

  return (
    <div className="search-suggestions" role="listbox" aria-label="Arama önerileri">
      {loading ? (
        <div className="search-suggestion-status">
          <Loader2 size={15} className="spin" /> Öneriler aranıyor…
        </div>
      ) : null}
      {rows.map((row, index) => {
        const active = index === activeIndex;
        if (row.kind === 'song') {
          return (
            <button
              type="button"
              key={`song-${row.song.id}`}
              role="option"
              aria-selected={active}
              className={`search-suggestion-row ${active ? 'is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onPickSong(row.song)}
            >
              {row.song.thumbnail ? (
                <img className="search-suggestion-art" src={row.song.thumbnail} alt="" width={40} height={40} loading="lazy" />
              ) : (
                <span className="search-suggestion-art search-suggestion-art-empty"><Music size={16} /></span>
              )}
              <span className="search-suggestion-copy">
                <strong>{row.song.title}</strong>
                <small>{row.song.artist} · YouTube</small>
              </span>
              <span
                className="search-suggestion-play"
                role="button"
                tabIndex={-1}
                aria-label={`${row.song.title} oynat`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPlaySong(row.song);
                }}
              >
                <Play size={14} fill="currentColor" />
              </span>
            </button>
          );
        }
        return (
          <button
            type="button"
            key={`text-${row.text}-${index}`}
            role="option"
            aria-selected={active}
            className={`search-suggestion-row search-suggestion-text ${active ? 'is-active' : ''}`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onPickText(row.text)}
          >
            <span className="search-suggestion-icon"><Search size={15} /></span>
            <span className="search-suggestion-copy"><strong>{row.text}</strong></span>
          </button>
        );
      })}
      <div className="search-suggestion-hint">
        <TrendingUp size={13} /> ↑↓ gez · Enter seç · Esc kapat
      </div>
    </div>
  );
}

export { songToTrack };
