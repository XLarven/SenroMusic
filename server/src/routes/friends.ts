/**
 * Friendship + block + notification endpoints.
 *
 * Identity always comes from the session; the body only ever names the *other*
 * account. Every state transition is re-checked inside the database layer.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import {
  acceptRequest,
  blockUser,
  cancelRequest,
  declineRequest,
  friendCounts,
  getRelationship,
  listBlocks,
  listFriends,
  listNotifications,
  listRequests,
  markNotificationsRead,
  pushNotification,
  removeFriend,
  sendRequest,
  unblockUser,
} from '../friends.js';
import { findUserById } from '../users.js';

const writeLimit = rateLimit({ name: 'friends-write', max: 40, windowMs: 60_000, keyBy: 'user' });

function parseId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parsePaging(query: { limit?: string; offset?: string }): { limit?: number; offset?: number } {
  const limit = Number.parseInt(String(query.limit ?? ''), 10);
  const offset = Number.parseInt(String(query.offset ?? ''), 10);
  return {
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  };
}

export async function friendsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/friends',
    { preHandler: [requireAuth] },
    async (request) => {
      const paging = parsePaging(request.query);
      const db = getDb();
      return {
        friends: listFriends(db, request.user!.id, paging.limit, paging.offset),
        counts: friendCounts(db, request.user!.id),
      };
    },
  );

  app.get<{ Querystring: { direction?: string; limit?: string; offset?: string } }>(
    '/api/friends/requests',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const direction = request.query.direction === 'out' ? 'out' : 'in';
      const paging = parsePaging(request.query);
      const list = listRequests(getDb(), request.user!.id, direction, paging.limit, paging.offset);
      return reply.send({ direction, requests: list, counts: friendCounts(getDb(), request.user!.id) });
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/api/friends/status/:userId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const target = String(request.params.userId ?? '').trim();
      if (!target) return reply.code(400).send({ error: { code: 'invalid_user', message: 'Kullanıcı gerekli.' } });
      if (!findUserById(target)) return reply.code(404).send({ error: { code: 'not_found', message: 'Kullanıcı bulunamadı.' } });
      return { relationship: getRelationship(getDb(), request.user!.id, target) };
    },
  );

  app.post<{ Body: { userId?: unknown } }>(
    '/api/friends/requests',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const targetId = String(request.body?.userId ?? '').trim();
      if (!targetId) return reply.code(400).send({ error: { code: 'invalid_user', message: 'Kullanıcı gerekli.' } });
      const me = request.user!.id;
      if (targetId === me) return reply.code(400).send({ error: { code: 'self', message: 'Kendine istek gönderemezsin.' } });
      const result = sendRequest(getDb(), me, targetId);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'blocked' ? 403 : 409;
        return reply.code(status).send({ error: { code: result.code, message: result.message } });
      }
      if (!result.value.autoAccepted) {
        pushNotification(getDb(), {
          userId: targetId,
          kind: 'friend_request',
          actorId: me,
          entityId: String(result.value.requestId),
          dedupeKey: `friend_request:${result.value.requestId}`,
        });
      } else {
        // The other side had already asked: both sides hear about the friendship.
        pushNotification(getDb(), {
          userId: targetId,
          kind: 'friend_accept',
          actorId: me,
          entityId: String(result.value.requestId),
          dedupeKey: `friend_accept:${result.value.requestId}`,
        });
      }
      return {
        relationship: getRelationship(getDb(), me, targetId),
        counts: friendCounts(getDb(), me),
      };
    },
  );

  app.post<{ Params: { requestId: string } }>(
    '/api/friends/requests/:requestId/accept',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const requestId = parseId(request.params.requestId);
      if (!requestId) return reply.code(400).send({ error: { code: 'invalid_request', message: 'Geçersiz istek.' } });
      const me = request.user!.id;
      const result = acceptRequest(getDb(), me, requestId);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'forbidden' ? 403 : 409;
        return reply.code(status).send({ error: { code: result.code, message: result.message } });
      }
      pushNotification(getDb(), {
        userId: result.value.requesterId,
        kind: 'friend_accept',
        actorId: me,
        entityId: String(requestId),
        dedupeKey: `friend_accept:${requestId}`,
      });
      return { ok: true, counts: friendCounts(getDb(), me) };
    },
  );

  app.post<{ Params: { requestId: string } }>(
    '/api/friends/requests/:requestId/decline',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const requestId = parseId(request.params.requestId);
      if (!requestId) return reply.code(400).send({ error: { code: 'invalid_request', message: 'Geçersiz istek.' } });
      const result = declineRequest(getDb(), request.user!.id, requestId);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'forbidden' ? 403 : 409;
        return reply.code(status).send({ error: { code: result.code, message: result.message } });
      }
      return { ok: true, counts: friendCounts(getDb(), request.user!.id) };
    },
  );

  app.delete<{ Params: { requestId: string } }>(
    '/api/friends/requests/:requestId',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const requestId = parseId(request.params.requestId);
      if (!requestId) return reply.code(400).send({ error: { code: 'invalid_request', message: 'Geçersiz istek.' } });
      const result = cancelRequest(getDb(), request.user!.id, requestId);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'forbidden' ? 403 : 409;
        return reply.code(status).send({ error: { code: result.code, message: result.message } });
      }
      return { ok: true, counts: friendCounts(getDb(), request.user!.id) };
    },
  );

  app.delete<{ Params: { userId: string } }>(
    '/api/friends/:userId',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const otherId = String(request.params.userId ?? '').trim();
      if (!otherId) return reply.code(400).send({ error: { code: 'invalid_user', message: 'Kullanıcı gerekli.' } });
      const result = removeFriend(getDb(), request.user!.id, otherId);
      if (!result.ok) {
        return reply.code(result.code === 'not_friends' ? 404 : 409).send({
          error: { code: result.code, message: result.message },
        });
      }
      return { ok: true, counts: friendCounts(getDb(), request.user!.id) };
    },
  );

  /* ---------- blocks ---------- */

  app.get('/api/blocks', { preHandler: [requireAuth] }, async (request) => ({
    blocked: listBlocks(getDb(), request.user!.id),
  }));

  app.post<{ Body: { userId?: unknown } }>(
    '/api/blocks',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const targetId = String(request.body?.userId ?? '').trim();
      if (!targetId) return reply.code(400).send({ error: { code: 'invalid_user', message: 'Kullanıcı gerekli.' } });
      const result = blockUser(getDb(), request.user!.id, targetId);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : 400;
        return reply.code(status).send({ error: { code: result.code, message: result.message } });
      }
      return { ok: true, relationship: getRelationship(getDb(), request.user!.id, targetId) };
    },
  );

  app.delete<{ Params: { userId: string } }>(
    '/api/blocks/:userId',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const targetId = String(request.params.userId ?? '').trim();
      if (!targetId) return reply.code(400).send({ error: { code: 'invalid_user', message: 'Kullanıcı gerekli.' } });
      unblockUser(getDb(), request.user!.id, targetId);
      return { ok: true, relationship: getRelationship(getDb(), request.user!.id, targetId) };
    },
  );

  /* ---------- notifications ---------- */

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/notifications',
    { preHandler: [requireAuth] },
    async (request) => {
      const paging = parsePaging(request.query);
      return listNotifications(getDb(), request.user!.id, paging.limit ?? 30, paging.offset ?? 0);
    },
  );

  app.post<{ Body: { ids?: unknown } }>(
    '/api/notifications/read',
    { preHandler: [requireAuth] },
    async (request) => {
      const raw = request.body?.ids;
      const ids = Array.isArray(raw)
        ? raw.map((value) => parseId(value)).filter((value): value is number => value !== null).slice(0, 100)
        : undefined;
      markNotificationsRead(getDb(), request.user!.id, ids);
      return { ok: true };
    },
  );
}
