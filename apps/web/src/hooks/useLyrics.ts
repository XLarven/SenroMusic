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
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    ...(album ? { album_name: album } : {}),
    ...(duration > 0 ? { duration: String(Math.round(duration)) } : {}),
  });
  const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean };
  if (json.instrumental) return { lines: [], synced: false, plain: '' };
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
  const result = json.syncedLyrics
    ? { lines: parseSynced(json.syncedLyrics), synced: true, plain: json.plainLyrics || '' }
    : json.plainLyrics
      ? {
          lines: json.plainLyrics.split('\n').map((t) => ({ time: null, text: t })).filter((l) => l.text),
          synced: false,
          plain: json.plainLyrics,
        }
      : null;
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

  useEffect(() => {
    const key = `${artist}::${title}::${album ?? ''}`;
    if (!title.trim()) {
      setData(null);
      return;
    }
    if (keyRef.current === key) return;
    keyRef.current = key;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchLyrics(artist, title, duration, album)
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
  }, [artist, title, duration, album]);

  return { data, loading, error };
}
