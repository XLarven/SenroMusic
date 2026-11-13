/**
 * Audio streaming proxy.
 *
 * The browser never sees a provider URL: `<audio src>` points here, and this
 * route resolves the track through the provider chain and pipes the bytes
 * through. That keeps signed/expiring provider URLs server-side, makes seeking
 * work (Range is forwarded verbatim), and removes the need to embed a player
 * iframe at all.
 */
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { BROWSER_UA } from '../audio/types.js';
import { forgetRequest, invalidateUrl, resolveStream, sourceStatus } from '../audio/resolver.js';
import { forgetVideoId, lookupVideoId, rememberVideoId } from '../audio/map.js';
import type { ResolvedStream } from '../audio/types.js';

type StreamQuery = {
  videoId?: string;
  title?: string;
  artist?: string;
  duration?: string;
  fresh?: string;
};

const PASSTHROUGH = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified'];

/** Header timeout only: the body must be allowed to stream for minutes. */
async function openUpstream(
  stream: ResolvedStream,
  range: string | undefined,
): Promise<{ response: Response; controller: AbortController }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(stream.url, {
      headers: {
        'user-agent': BROWSER_UA,
        accept: '*/*',
        ...(range ? { range } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    return { response, controller };
  } finally {
    clearTimeout(timer);
  }
}

function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 && seconds < 36_000 ? Math.round(seconds) : null;
}

function buildRequest(query: StreamQuery) {
  return {
    videoId: query.videoId?.trim() || null,
    title: query.title?.trim() || null,
    artist: query.artist?.trim() || null,
    duration: parseDuration(query.duration),
  };
}

type StreamWanted = ReturnType<typeof buildRequest>;

/**
 * Resolves a request, reusing the remembered upload for metadata-only songs.
 * A remembered id that no longer streams is forgotten and the search runs again
 * exactly once, so the map can never wedge a track.
 */
async function resolveForRequest(wanted: StreamWanted, fresh = false) {
  if (fresh) {
    forgetRequest(wanted);
    forgetVideoId(wanted);
  }
  const remembered = lookupVideoId(wanted);
  let resolved = await resolveStream(remembered ? { ...wanted, videoId: remembered } : wanted);
  if (!resolved && remembered) {
    forgetVideoId(wanted);
    resolved = await resolveStream(wanted);
  }
  if (resolved) rememberVideoId(wanted, resolved);
  return { resolved, remembered: Boolean(remembered) };
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: StreamQuery }>(
    '/api/media/stream',
    { preHandler: requireAuth },
    async (request, reply) => {
      const wanted = buildRequest(request.query);
      if (!wanted.videoId && !wanted.title) {
        return reply
          .code(400)
          .send({ error: { code: 'bad_request', message: 'videoId veya title gerekli.' } });
      }

      // `fresh=1` is the player's retry: drop the cached URL, the remembered
      // upload and the failure memory so a dead stream is not replayed.
      const { resolved } = await resolveForRequest(wanted, Boolean(request.query.fresh));
      if (!resolved) {
        return reply.code(502).send({
          error: {
            code: 'source_unavailable',
            message: 'Bu parça için hiçbir ses kaynağı yanıt vermedi.',
          },
        });
      }

      reply
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'private, max-age=1800')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Audio-Source', resolved.source)
        .header('X-Audio-Label', encodeURIComponent(resolved.label).slice(0, 200));

      if (request.method === 'HEAD') {
        return reply.code(200).header('Content-Type', resolved.mimeType).send();
      }

      const range = request.headers.range;
      const sourceKey = (stream: ResolvedStream): string | null => {
        if (stream.source === 'youtube' && wanted.videoId) return `youtube:${wanted.videoId}`;
        if (stream.source === 'piped' && wanted.videoId) return `piped:${wanted.videoId}`;
        if (stream.source === 'jiosaavn') return 'jiosaavn';
        return null;
      };

      let current = resolved;
      let opened = await openUpstream(current, range);

      // A cached signed URL can expire between resolution and playback. One
      // re-resolve is enough: the resolver drops the dead entry first.
      if (opened.response.status === 403 || opened.response.status === 404 || opened.response.status === 410) {
        opened.controller.abort();
        invalidateUrl(current.url);
        const failed = sourceKey(current);
        const retried = await resolveStream({ ...wanted, exclude: failed ? [failed] : [] });
        if (retried) {
          current = retried;
          opened = await openUpstream(current, range);
          reply.header('X-Audio-Source', current.source);
        }
      }

      const upstream = opened.response;

      if (upstream.status === 416) {
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) reply.header('Content-Range', contentRange);
        return reply.code(416).send();
      }

      if (!upstream.ok && upstream.status !== 206) {
        opened.controller.abort();
        return reply.code(502).send({
          error: {
            code: 'upstream_error',
            message: `Kaynak ses akışını reddetti (${upstream.status}).`,
          },
        });
      }

      for (const header of PASSTHROUGH) {
        const value = upstream.headers.get(header);
        if (value) reply.header(header, value);
      }
      if (!upstream.headers.get('content-type')) {
        reply.header('Content-Type', resolved.mimeType);
      }

      reply.code(upstream.status);

      if (!upstream.body) {
        return reply.code(502).send({
          error: { code: 'empty_body', message: 'Kaynak boş yanıt döndürdü.' },
        });
      }

      const body = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      body.on('close', () => opened.controller.abort());
      body.on('error', () => opened.controller.abort());
      return reply.send(body);
    },
  );

  /** Resolve without streaming — used by the player for source diagnostics. */
  app.get<{ Querystring: StreamQuery }>(
    '/api/media/resolve',
    { preHandler: requireAuth },
    async (request, reply) => {
      const wanted = buildRequest(request.query);
      if (!wanted.videoId && !wanted.title) {
        return reply
          .code(400)
          .send({ error: { code: 'bad_request', message: 'videoId veya title gerekli.' } });
      }
      const { resolved } = await resolveForRequest(wanted);
      if (!resolved) {
        return reply
          .code(502)
          .send({ error: { code: 'source_unavailable', message: 'Ses kaynağı bulunamadı.' } });
      }
      return {
        source: resolved.source,
        mimeType: resolved.mimeType,
        bitrate: resolved.bitrate,
        label: resolved.label,
        expiresAt: new Date(resolved.expiresAt).toISOString(),
      };
    },
  );

  app.get('/api/media/sources', { preHandler: requireAuth }, async () => sourceStatus());

  /**
   * Warm the resolver cache for an upcoming track without streaming any bytes.
   * The player calls this for the next queue item so pressing play there does not
   * pay the cold provider extraction.
   */
  app.get<{ Querystring: StreamQuery }>('/api/media/warm', { preHandler: requireAuth }, async (request) => {
    const wanted = buildRequest(request.query);
    if (!wanted.videoId && !wanted.title) return { ready: false };
    const started = Date.now();
    const { resolved } = await resolveForRequest(wanted);
    return { ready: Boolean(resolved), source: resolved?.source ?? null, ms: Date.now() - started };
  });
}
