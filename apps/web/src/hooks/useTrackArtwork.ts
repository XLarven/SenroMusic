import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { Track } from '../types';

const CHUNK = 20;

/**
 * Fills in per-song covers for tracks that only know the playlist artwork.
 *
 * A Spotify import hands every entry the playlist cover, so a 100-track list
 * looks like the same square repeated. This asks the server for a real album
 * cover per song, chunk by chunk, and returns patched tracks — the queue and the
 * player then carry the right image too.
 */
export function useTrackArtwork(tracks: Track[], sharedCoverUrl?: string | null) {
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const requested = useRef<Set<string>>(new Set());

  const missing = useMemo(
    () =>
      tracks.filter((track) => {
        if (!track.coverUrl) return true;
        if (sharedCoverUrl && track.coverUrl === sharedCoverUrl) return true;
        return false;
      }),
    [tracks, sharedCoverUrl],
  );

  const missingIds = missing.map((track) => track.id).join('|');

  useEffect(() => {
    if (!missingIds) return;
    const pending = missingIds
      .split('|')
      .map((id) => tracks.find((track) => track.id === id))
      .filter((track): track is Track => Boolean(track))
      .filter((track) => !requested.current.has(track.id));
    if (pending.length === 0) return;
    for (const track of pending) requested.current.add(track.id);

    let cancelled = false;
    void (async () => {
      for (let index = 0; index < pending.length; index += CHUNK) {
        if (cancelled) return;
        const slice = pending.slice(index, index + CHUNK);
        try {
          const result = await api.trackArtwork(
            slice.map((track) => ({ key: track.id, title: track.title, artist: track.artist })),
          );
          if (cancelled) return;
          const found: Record<string, string> = {};
          for (const [id, url] of Object.entries(result.artworks)) {
            if (url) found[id] = url;
          }
          if (Object.keys(found).length > 0) {
            setArtwork((previous) => ({ ...previous, ...found }));
          }
        } catch {
          // No artwork is a cosmetic miss, never a playback failure.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `missingIds` is the stable summary of the list we are about to request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingIds]);

  const withArtwork = useMemo(
    () => tracks.map((track) => (artwork[track.id] ? { ...track, coverUrl: artwork[track.id]! } : track)),
    [tracks, artwork],
  );

  return { tracks: withArtwork, artwork };
}
