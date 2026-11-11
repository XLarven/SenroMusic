/**
 * Per-song artwork lookup.
 *
 * Spotify only exposes the playlist cover through its embed endpoint, so an
 * imported playlist would show the same square on every row. This resolves a
 * real album cover per track from Deezer (fast) with iTunes as a fallback, and
 * keeps an in-memory cache so a revisited playlist costs nothing.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { normalizeText } from '../searchQuality.js';
import { rateLimit } from '../ratelimit.js';

type ArtworkItem = { key?: unknown; title?: unknown; artist?: unknown };
type ArtworkBody = { items?: unknown };

const CACHE_LIMIT = 1500;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_ITEMS = 24;
const CONCURRENCY = 6;
const LOOKUP_TIMEOUT_MS = 4500;

const cache = new Map<string, { url: string | null; at: number }>();

function cacheKey(title: string, artist: string): string {
  return `${normalizeText(artist)}::${normalizeText(title)}`;
}

function readCache(key: string): { hit: true; url: string | null } | { hit: false } {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, url: entry.url };
}

function writeCache(key: string, url: string | null): void {
  cache.set(key, { url, at: Date.now() });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Loose check that the result really is the requested song, not a cover band. */
function sameSong(resultTitle: string, wantedTitle: string, resultArtist: string, wantedArtist: string): boolean {
  const wanted = normalizeText(wantedTitle);
  const got = normalizeText(resultTitle);
  if (!wanted || !got) return false;
  const titleMatch = got.includes(wanted) || wanted.includes(got);
  if (!titleMatch) return false;
  const wantedArtistText = normalizeText(wantedArtist);
  if (!wantedArtistText) return true;
  const gotArtist = normalizeText(resultArtist);
  return gotArtist.includes(wantedArtistText) || wantedArtistText.includes(gotArtist);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'NorieMusic/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type DeezerTrack = { title?: string; artist?: { name?: string }; album?: { cover_xl?: string; cover_big?: string; cover_medium?: string } };

async function fromDeezer(title: string, artist: string): Promise<string | null> {
  const query = [artist, title].filter(Boolean).join(' ').trim();
  if (!query) return null;
  const payload = (await fetchJson(
    `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`,
  )) as { data?: DeezerTrack[] } | null;
  for (const track of payload?.data ?? []) {
    if (!track?.title) continue;
    if (!sameSong(track.title, title, track.artist?.name ?? '', artist)) continue;
    const cover = track.album?.cover_xl ?? track.album?.cover_big ?? track.album?.cover_medium;
    if (cover) return cover;
  }
  return null;
}

type ITunesTrack = { trackName?: string; artistName?: string; artworkUrl100?: string };

async function fromItunes(title: string, artist: string): Promise<string | null> {
  const query = [artist, title].filter(Boolean).join(' ').trim();
  if (!query) return null;
  const payload = (await fetchJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=5`,
  )) as { results?: ITunesTrack[] } | null;
  for (const track of payload?.results ?? []) {
    if (!track?.trackName) continue;
    if (!sameSong(track.trackName, title, track.artistName ?? '', artist)) continue;
    const art = track.artworkUrl100;
    if (art) return art.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/600x600bb.$1');
  }
  return null;
}

async function lookup(item: { title: string; artist: string }): Promise<string | null> {
  const key = cacheKey(item.title, item.artist);
  const cached = readCache(key);
  if (cached.hit) return cached.url;
  const url = (await fromDeezer(item.title, item.artist)) ?? (await fromItunes(item.title, item.artist));
  writeCache(key, url);
  return url;
}

/** Runs `lookup` over the batch with a small worker pool. */
async function mapLimited<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function artworkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ArtworkBody }>(
    '/api/media/artwork',
    { preHandler: [requireAuth, rateLimit({ name: 'artwork', max: 60, windowMs: 60_000, keyBy: 'user' })] },
    async (request) => {
      const raw = Array.isArray(request.body?.items) ? request.body.items : [];
      const items = raw
        .slice(0, MAX_ITEMS)
        .map((entry: ArtworkItem) => ({
          key: String(entry?.key ?? '').slice(0, 80),
          title: String(entry?.title ?? '').slice(0, 200).trim(),
          artist: String(entry?.artist ?? '').slice(0, 200).trim(),
        }))
        .filter((entry) => entry.key && entry.title);

      const urls = await mapLimited(items, CONCURRENCY, (item) => lookup(item));
      const artworks: Record<string, string | null> = {};
      items.forEach((item, index) => {
        artworks[item.key] = urls[index] ?? null;
      });
      return { artworks };
    },
  );
}
