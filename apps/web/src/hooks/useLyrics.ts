import { useEffect, useRef, useState } from 'react';

export type LyricLine = { time: number | null; text: string };

async function fetchLyrics(artist: string, title: string, duration: number): Promise<{ lines: LyricLine[]; synced: boolean; plain: string } | null> {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    ...(duration > 0 ? { duration: String(Math.round(duration)) } : {}),
  });
  const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string };
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
  if (json.syncedLyrics) return { lines: parseSynced(json.syncedLyrics), synced: true, plain: json.plainLyrics || '' };
  if (json.plainLyrics) {
    return {
      lines: json.plainLyrics.split('\n').map((t) => ({ time: null, text: t })).filter((l) => l.text),
      synced: false,
      plain: json.plainLyrics,
    };
  }
  return null;
}

export function useLyrics(artist: string, title: string, duration: number) {
  const [data, setData] = useState<{ lines: LyricLine[]; synced: boolean; plain: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef('');

  useEffect(() => {
    const key = `${artist}::${title}`;
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
    fetchLyrics(artist, title, duration)
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
  }, [artist, title, duration]);

  return { data, loading, error };
}
