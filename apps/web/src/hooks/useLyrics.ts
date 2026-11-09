import { useEffect, useRef, useState } from 'react';

export type LyricLine = { time: number | null; text: string };

const CACHE_PREFIX = 'Norie.lyrics.';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

async function fetchLyrics(artist: string, title: string, duration: number, album?: string): Promise<{ lines: LyricLine[]; synced: boolean; plain: string } | null> {
  const cacheKey = `${CACHE_PREFIX}${encodeURIComponent(`${artist}::${title}::${album ?? ''}::${Math.round(duration)}`)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { at: number; value: { lines: LyricLine[]; synced: boolean; plain: string } };
      if (Date.now() - parsed.at < CACHE_TTL) return parsed.value;
    }
  } catch {
    // cache is optional
  }
  const parseSynced = (raw: string): LyricLine[] =>
    raw
      .split('\n')
      .map((l) => {
        const m = /\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)/.exec(l.trim());
        if (!m) return { time: null, text: l.trim() };
        const time = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 ** m[3].length : 0);
        return { time, text: m[4] };
      })
      .filter((l) => l.text);
  const fromPayload = (json: { syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean }) => {
    if (json.instrumental) return { lines: [], synced: false, plain: '' };
    if (json.syncedLyrics) return { lines: parseSynced(json.syncedLyrics), synced: true, plain: json.plainLyrics || '' };
    if (json.plainLyrics) {
      return {
        lines: json.plainLyrics.split('\n').map((t) => ({ time: null, text: t })).filter((l) => l.text),
        synced: false,
        plain: json.plainLyrics,
      };
    }
    return null;
  };
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    ...(album ? { album_name: album } : {}),
    ...(duration > 0 ? { duration: String(Math.round(duration)) } : {}),
  });
  let result: { lines: LyricLine[]; synced: boolean; plain: string } | null = null;
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) result = fromPayload((await res.json()) as { syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean });
  } catch {
    result = null;
  }
  // /api/get is strict about duration/album; fall back to /api/search and
  // prefer the first candidate with synced lyrics for this artist + title.
  if (!result || !result.synced) {
    try {
      const q = `${artist} ${title}`.trim();
      const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
      });
      if (searchRes.ok) {
        const candidates = (await searchRes.json()) as Array<{
          trackName?: string;
          artistName?: string;
          syncedLyrics?: string;
          plainLyrics?: string;
          instrumental?: boolean;
        }>;
        const titleNorm = title.toLocaleLowerCase('tr');
        const artistNorm = artist.toLocaleLowerCase('tr');
        const ranked = candidates.filter(
          (c) =>
            (c.trackName?.toLocaleLowerCase('tr').includes(titleNorm.slice(0, 12)) ?? false) &&
            (artistNorm === 'unknown' || (c.artistName?.toLocaleLowerCase('tr').includes(artistNorm.slice(0, 6)) ?? true)),
        );
        const best = ranked.find((c) => c.syncedLyrics) ?? ranked[0] ?? null;
        if (best) {
          const fallback = fromPayload(best as unknown as { syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean });
          if (fallback && (!result || fallback.synced || result.lines.length === 0)) result = fallback;
        }
      }
    } catch {
      // keep the /api/get result
    }
  }
  if (result) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), value: result }));
    } catch {
      // cache is optional
    }
  }
  return result;
}

export function useLyrics(artist: string, title: string, duration: number, album?: string) {
  const [data, setData] = useState<{ lines: LyricLine[]; synced: boolean; plain: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef('');
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    const key = `${artist}::${title}::${album ?? ''}`;
    if (!title.trim()) {
      setData(null);
      return;
    }
    // No keyRef guard: effect deps already gate re-runs. A guard would break
    // React StrictMode remounts (first run cancelled, second run skipped,
    // loading stuck). keyRef above is kept only for debugging history.
    keyRef.current = key;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchLyrics(artist, title, durationRef.current, album)
      .then((r) => {
        if (cancelled) return;
        if (!r) setError('Şarkı sözü bulunamadı.');
        setData(r);
      })
      .catch(() => {
        if (!cancelled) setError('Sözler yüklenemedi.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // duration is intentionally excluded: it updates as playback progresses
    // and must not cancel an in-flight lyrics fetch. durationRef carries the
    // latest value for the next cache key / fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist, title, album]);

  return { data, loading, error };
}
