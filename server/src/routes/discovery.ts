/**
 * Discovery endpoints: the home page's real recommendation feed, taste feedback
 * and the "play similar" seed lookup.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { findSimilarTracks } from '../audio/similar.js';
import { buildDiscovery, recordFeedback, removeFeedback, trackIdentity } from '../discovery.js';
import { normalizeText } from '../searchQuality.js';

const readLimit = rateLimit({ name: 'discovery-read', max: 60, windowMs: 60_000, keyBy: 'user' });
const feedbackLimit = rateLimit({ name: 'discovery-feedback', max: 40, windowMs: 60_000, keyBy: 'user' });

function fail(reply: FastifyReply, code: string, message: string, status = 400) {
  return reply.code(status).send({ error: { code, message } });
}

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>(
    '/api/discovery',
    { preHandler: [requireAuth, readLimit] },
    async (request) => {
      const payload = await buildDiscovery(getDb(), request.user!.id, {
        refresh: request.query.refresh === '1',
      });
      return payload;
    },
  );

  app.get<{ Querystring: { title?: string; artist?: string; exclude?: string; limit?: string } }>(
    '/api/discovery/similar',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const title = String(request.query.title ?? '').trim();
      const artist = String(request.query.artist ?? '').trim();
      const exclude = String(request.query.exclude ?? '').trim();
      if (!title && !artist) return fail(reply, 'invalid_seed', 'Parça veya sanatçı gerekli.');
      const limit = Math.min(Math.max(Number(request.query.limit) || 12, 1), 20);
      const items = await findSimilarTracks(
        { title, artist, excludeVideoId: /^[\w-]{11}$/.test(exclude) ? exclude : null },
        limit,
      );
      return { items };
    },
  );

  app.post<{ Body: { kind?: unknown; title?: unknown; artist?: unknown; undo?: unknown } }>(
    '/api/discovery/feedback',
    { preHandler: [requireAuth, feedbackLimit] },
    async (request, reply) => {
      const kind = request.body?.kind === 'artist' ? 'artist' : 'track';
      const title = typeof request.body?.title === 'string' ? request.body.title : '';
      const artist = typeof request.body?.artist === 'string' ? request.body.artist : '';
      if (!title.trim() && !artist.trim()) return fail(reply, 'invalid_value', 'Değer gerekli.');
      const value =
        kind === 'artist' ? normalizeText(artist || title) : trackIdentity({ title, artist });
      if (!value || value === '|') return fail(reply, 'invalid_value', 'Değer gerekli.');
      if (request.body?.undo === true) {
        removeFeedback(getDb(), request.user!.id, kind, value);
        return { ok: true, removed: true };
      }
      recordFeedback(getDb(), request.user!.id, kind, value);
      return { ok: true, removed: false };
    },
  );

  app.delete<{ Querystring: { kind?: string; title?: string; artist?: string } }>(
    '/api/discovery/feedback',
    { preHandler: [requireAuth, feedbackLimit] },
    async (request, reply) => {
      const kind = request.query.kind === 'artist' ? 'artist' : 'track';
      const title = String(request.query.title ?? '');
      const artist = String(request.query.artist ?? '');
      const value = kind === 'artist' ? normalizeText(artist || title) : trackIdentity({ title, artist });
      if (!value || value === '|') return fail(reply, 'invalid_value', 'Değer gerekli.');
      removeFeedback(getDb(), request.user!.id, kind, value);
      return { ok: true };
    },
  );
}
