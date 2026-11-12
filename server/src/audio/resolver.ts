/**
 * Provider chain + cache for audio streams.
 *
 * Order for a known upload: YouTube direct -> Piped (if configured) -> JioSaavn
 * by metadata. Order for a bare song: JioSaavn (fast, 320 kbps) -> YouTube
 * search -> extract. Every provider is optional: the chain returns the first
 * usable URL and `null` only when every source genuinely failed.
 */
import { normalizeText, rankCandidates, songTitle } from '../searchQuality.js';
import { resolveByMetadata } from './jiosaavn.js';
import { pipedAvailable, resolveVideo } from './piped.js';
import { extractAudio, searchVideoCandidates } from './youtube.js';
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
        // Score every raw hit and try the plausible ones in order: the top raw
        // result is often karaoke or a reaction upload.
        const candidates = await searchVideoCandidates(query, 8);
        const ranked = rankCandidates(candidates, query, 4);
        for (const candidate of ranked) {
          const stream = await extractAudio(candidate.id);
          if (stream) return stream;
        }
        return null;
      },
    });
  }

  return attempts;
}

/** Failed resolutions are remembered briefly so a dead track cannot hammer providers. */
const negative = new Map<string, number>();
const NEGATIVE_TTL_MS = 60_000;
const ATTEMPT_TIMEOUT_MS = 22_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveUncached(request: StreamRequest): Promise<ResolvedStream | null> {
  const attempts = attemptsFor(request);
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!;
    try {
      const stream = await withTimeout(attempt.run(), ATTEMPT_TIMEOUT_MS);
      if (stream) {
        console.info('[audio] resolved via', attempt.label, '->', stream.label);
        return stream;
      }
    } catch (error) {
      console.warn('[audio] provider failed:', attempt.label, (error as Error).message.slice(0, 120));
    }
    // Small bounded pause between providers: enough for a transient hiccup to
    // clear, never a retry storm.
    if (index < attempts.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (index + 1)));
    }
  }
  return null;
}

export async function resolveStream(request: StreamRequest): Promise<ResolvedStream | null> {
  if (!request.videoId && !request.title) return null;

  const key = cacheKey(request);
  const cached = readCache(key);
  if (cached) return cached;

  const blockedUntil = negative.get(key);
  if (blockedUntil && blockedUntil > Date.now()) return null;

  const running = inflight.get(key);
  if (running) return running;

  const task = resolveUncached(request)
    .then((stream) => {
      if (stream) {
        writeCache(key, stream);
        negative.delete(key);
      } else {
        negative.set(key, Date.now() + NEGATIVE_TTL_MS);
        if (negative.size > 500) {
          const now = Date.now();
          for (const [entry, until] of negative) if (until <= now) negative.delete(entry);
        }
      }
      return stream;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}

/** Diagnostics for /api/media/sources. */
export function sourceStatus(): { cached: number; inflight: number; negative: number; piped: boolean } {
  return { cached: cache.size, inflight: inflight.size, negative: negative.size, piped: pipedAvailable() };
}
