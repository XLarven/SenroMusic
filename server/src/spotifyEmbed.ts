// Spotify embed-page resolver + YouTube Music search, adapted from SONORA.
// Uses Spotify's public embed page HTML (no official API credentials needed)
// and yt-dlp for YouTube Music search (reliable, no undocumented endpoints).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const PYTHON = process.env.PYTHON_PATH || 'python';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAX_PLAYLIST = 100;

function parseClock(text: string): number | null {
  if (!/^\d+(:\d{2}){1,2}$/.test(text)) return null;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function norm(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function runYtDlpJson(args: string[], timeoutMs = 30_000): Promise<any> {
  return new Promise((resolve) => {
    execFileAsync(PYTHON, ['-m', 'yt_dlp', ...args], { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs })
      .then(({ stdout }) => {
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      })
      .catch(() => resolve(null));
  });
}

// --- Spotify embed scraping ---

async function spotifyEmbed(kind: string, id: string): Promise<any | null> {
  const url = `https://open.spotify.com/embed/${kind}/${id}`;
  const res = await fetch(url, {
    headers: { 'user-agent': BROWSER_UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  try {
    return json ? JSON.parse(json)?.props?.pageProps?.state?.data?.entity ?? null : null;
  } catch {
    return null;
  }
}

function biggestImage(entity: any): string | null {
  const sources = [...(entity?.coverArt?.sources ?? entity?.visualIdentity?.image ?? [])];
  return sources.sort((a: any, b: any) => (b.maxWidth ?? b.width ?? 0) - (a.maxWidth ?? a.width ?? 0))[0]?.url ?? null;
}

// --- YouTube Music search via yt-dlp ---

function parseYtTrack(entry: any, requestedBy: string | null = null): any | null {
  const url = entry.webpage_url ?? (entry.url?.startsWith('http') ? entry.url : null) ?? (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
  if (!url) return null;
  const videoId = url.match(/[?&]v=([\w-]{11})/)?.[1] ?? entry.id ?? null;
  return {
    title: entry.title ?? url,
    url,
    videoId,
    duration: Number.isFinite(entry.duration) ? Math.round(entry.duration) : null,
    live: false,
    uploader: entry.channel ?? entry.uploader ?? null,
    album: entry.album ?? null,
    thumbnail: entry.thumbnail ?? (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
    requestedBy,
    source: 'youtube',
  };
}

async function searchYtm(query: string, count: number = 5, requestedBy: string | null = null): Promise<any[]> {
  try {
    const data = await runYtDlpJson(['--flat-playlist', '-I', `1:${count}`, '-J', `ytsearch${count}:${query} audio`]);
    const entries = data?.entries ?? (data?.id ? [data] : []);
    return entries.map((e: any) => parseYtTrack(e, requestedBy)).filter(Boolean).slice(0, count);
  } catch {
    return [];
  }
}

async function matchSong({ title, artist, duration }: { title: string; artist: string; duration: number | null }, requestedBy: string | null = null): Promise<any | null> {
  const artists = String(artist ?? '').split(/,|&| x | feat\.? | ft\.? | and /i).map(norm).filter(Boolean);
  const results = await searchYtm(`${title} ${artists[0] ?? ''}`.trim(), 5, requestedBy);
  if (!results.length) return null;
  const score = (t: any) =>
    (norm(t.title) === norm(title) ? 2 : norm(t.title).includes(norm(title)) ? 1 : 0) +
    (artists.some((a: string) => norm(t.uploader).includes(a)) ? 2 : 0) +
    (duration && t.duration && Math.abs(t.duration - duration) <= 10 ? 1 : 0);
  return results.reduce((a: any, b: any) => (score(b) > score(a) ? b : a));
}

// --- Spotify resolution ---

export async function resolveSpotify(url: string, requestedBy: string | null = null): Promise<{ tracks: any[]; playlistTitle: string | null; source: string; capped?: boolean }> {
  let target = url;
  if (!/open\.spotify\.com/i.test(target)) {
    const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    target = res.url;
  }
  const m = target.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/i);
  if (!m) throw new Error("That doesn't look like a Spotify link.");
  const kind = m[1].toLowerCase();
  if (!['track', 'album', 'playlist'].includes(kind)) {
    throw new Error("Spotify artist and podcast links aren't supported. Paste a song, album or playlist link.");
  }
  const entity = await spotifyEmbed(kind, m[2]);
  if (!entity) throw new Error("I couldn't read that Spotify link. Is the playlist public?");

  if (kind === 'track') {
    const artists = (entity.artists ?? []).map((a: any) => a.name).filter(Boolean);
    const best = await matchSong(
      { title: entity.name, artist: artists.join(', '), duration: entity.duration ? entity.duration / 1000 : null },
      requestedBy,
    );
    if (!best) throw new Error(`I couldn't find "${entity.name}" on YouTube.`);
    return { tracks: [best], playlistTitle: null, source: 'Spotify' };
  }

  const cover = biggestImage(entity);
  const rawTracks = (entity.trackList ?? []).filter((t: any) => t.title).slice(0, MAX_PLAYLIST);
  const tracks = rawTracks.map((t: any) => ({
    title: t.title,
    url: null,
    pending: true,
    duration: t.duration ? Math.round(t.duration / 1000) : null,
    live: false,
    uploader: (t.subtitle ?? '').trim() || null,
    thumbnail: cover,
    requestedBy,
    source: 'Spotify',
  }));
  if (!tracks.length) throw new Error('That Spotify playlist looks empty or private.');
  return {
    tracks,
    playlistTitle: entity.name ?? entity.title ?? 'Spotify playlist',
    source: 'Spotify',
    capped: (entity.trackList ?? []).length >= MAX_PLAYLIST,
  };
}

export async function resolvePending(track: any): Promise<any> {
  const found = await matchSong({ title: track.title, artist: track.uploader, duration: track.duration });
  if (!found) throw new Error("couldn't find it on YouTube Music");
  Object.assign(track, {
    url: found.url,
    videoId: found.videoId,
    title: found.title,
    uploader: found.uploader ?? track.uploader,
    album: found.album,
    duration: found.duration ?? track.duration,
    thumbnail: found.thumbnail ?? track.thumbnail,
    pending: false,
  });
  return track;
}

export { searchYtm, matchSong };
