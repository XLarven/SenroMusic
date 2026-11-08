import type { FastifyReply, FastifyRequest } from 'fastify';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Sweep stale buckets so the map cannot grow without bound under rotation.
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function clientKey(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return (first || request.ip || 'unknown').slice(0, 128);
}

/** Returns null when allowed, or the retry-after seconds when the limit is hit. */
export function consume(key: string, max: number, windowMs: number): number | null {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (bucket.count >= max) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  bucket.count += 1;
  return null;
}

export function resetBuckets(): void {
  buckets.clear();
}

type RateLimitOptions = {
  name: string;
  max: number;
  windowMs: number;
  /** 'user' keys by session user (falls back to IP when unauthenticated). */
  keyBy?: 'ip' | 'user';
};

export function rateLimit(options: RateLimitOptions) {
  return async function limiter(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (options.keyBy === 'user' && !request.user) return;
    const identity =
      options.keyBy === 'user' && request.user ? `u:${request.user.id}` : `ip:${clientKey(request)}`;
    const retryAfter = consume(`${options.name}:${identity}`, options.max, options.windowMs);
    if (retryAfter !== null) {
      reply.header('Retry-After', String(retryAfter));
      await reply.code(429).send({
        error: {
          code: 'too_many_requests',
          message: 'Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.',
        },
      });
    }
  };
}
