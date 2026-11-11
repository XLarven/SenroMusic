/**
 * Provider chain + cache for audio streams.
 *
 * Order for a known upload: YouTube direct -> Piped (if configured) -> JioSaavn
 * by metadata. Order for a bare song: JioSaavn (fast, 320 kbps) -> YouTube
 * search -> extract. Every provider is optional: the chain returns the first
 * usable URL and `null` only when every source genuinely failed.
 */
import { normalizeText, songTitle } from '../searchQuality.js';
import { resolveByMetadata } from './jiosaavn.js';
import { pipedAvailable, resolveVideo } from './piped.js';
import { extractAudio, searchVideoId } from './youtube.js';
import type { ResolvedStream, StreamRequest } from './types.js';

type Attempt = { key: string; label: string; run: () => Promise<ResolvedStream | null> };

const CACHE_LIMIT = 400;
const MAX_CACHE_MS = 30 * 60_000;
/** Refuse to cache a URL that dies sooner than this. */
const MIN_REMAINING_MS = 90_000;

const cache = new Map<string, ResolvedStream>();
const inflight = new Map<string, Promise<ResolvedStream | null>>();

function cacheKey(request: StreamRequest): string {
  if (request.videoId) return `video:${request.videoId}`;
  const title = normalizeText(songTitle(request.title ?? ''));
  const artist = normalizeText(request.artist ?? '');
  return `song:${artist}::${title}`;
}

function readCache(key: string): ResolvedStream | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt - Date.now() < MIN_REMAINING_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh recency so frequently played tracks survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function writeCache(key: string, stream: ResolvedStream): void {
  const ttl = Math.min(stream.expiresAt, Date.now() + MAX_CACHE_MS);
  if (ttl - Date.now() < MIN_REMAINING_MS) return;
  cache.set(key, { ...stream, expiresAt: ttl });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Drop every cached entry pointing at a URL that just stopped working. */
export function invalidateUrl(url: string): void {
  for (const [key, stream] of cache) {
    if (stream.url === url) cache.delete(key);
  }
}

function attemptsFor(request: StreamRequest): Attempt[] {
  const attempts: Attempt[] = [];
  const excluded = new Set(request.exclude ?? []);
  const videoId = request.videoId ?? null;

  const add = (attempt: Attempt) => {
    if (excluded.has(attempt.key)) return;
    attempts.push(attempt);
  };

  if (videoId) {
    add({
      key: `youtube:${videoId}`,
      label: 'youtube-direct',
      run: () => extractAudio(videoId),
    });
    if (pipedAvailable()) {
      add({
        key: `piped:${videoId}`,
        label: 'piped',
        run: () => resolveVideo(videoId),
      });
    }
  }

  if (request.title) {
    add({
      key: 'jiosaavn',
      label: 'jiosaavn',
      run: () =>
        resolveByMetadata({
          title: request.title ?? '',
          artist: request.artist ?? null,
          duration: request.duration ?? null,
        }),
    });
  }

  if (!videoId && request.title) {
    add({
      key: 'youtube-search',
      label: 'youtube-search',
      run: async () => {
        const query = [request.artist, songTitle(request.title ?? '')].filter(Boolean).join(' ').trim();
        const found = await searchVideoId(query);
        return found ? extractAudio(found) : null;
      },
    });
  }

  return attempts;
}

async function resolveUncached(request: StreamRequest): Promise<ResolvedStream | null> {
  const attempts = attemptsFor(request);
  for (const attempt of attempts) {
    try {
      const stream = await attempt.run();
      if (stream) {
        console.info('[audio] resolved via', attempt.label, '->', stream.label);
        return stream;
      }
    } catch (error) {
      console.warn('[audio] provider failed:', attempt.label, (error as Error).message.slice(0, 120));
    }
  }
  return null;
}

export async function resolveStream(request: StreamRequest): Promise<ResolvedStream | null> {
  if (!request.videoId && !request.title) return null;

  const key = cacheKey(request);
  const cached = readCache(key);
  if (cached) return cached;

  const running = inflight.get(key);
  if (running) return running;

  const task = resolveUncached(request)
    .then((stream) => {
      if (stream) writeCache(key, stream);
      return stream;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}

/** Diagnostics for /api/media/sources. */
export function sourceStatus(): { cached: number; inflight: number; piped: boolean } {
  return { cached: cache.size, inflight: inflight.size, piped: pipedAvailable() };
}
