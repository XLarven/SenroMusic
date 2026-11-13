/**
 * Listening room endpoints.
 *
 * Every mutation returns the new revision, broadcasts it to the members over the
 * shared SSE stream, and is guarded by membership + role checks on the server.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { findUserById, toPublicUser } from '../users.js';
import {
  accessRoom,
  addToQueue,
  applyPlayback,
  closeRoom,
  createRoom,
  deleteRoomMessage,
  inviteToRoom,
  joinRoom,
  kickMember,
  leaveRoom,
  listInvites,
  listMembers,
  listMyRooms,
  listRoomMessages,
  listRooms,
  parseState,
  postRoomMessage,
  publishRoomChat,
  publishRoomClosed,
  publishRoomInvite,
  publishRoomMembers,
  publishRoomState,
  removeFromQueue,
  reorderQueue,
  setMemberRole,
  toSummary,
  updateRoom,
  type PlaybackInput,
} from '../rooms.js';

const createLimit = rateLimit({ name: 'rooms-create', max: 10, windowMs: 60_000, keyBy: 'user' });
const writeLimit = rateLimit({ name: 'rooms-write', max: 60, windowMs: 60_000, keyBy: 'user' });
const playLimit = rateLimit({ name: 'rooms-playback', max: 240, windowMs: 60_000, keyBy: 'user' });
const chatLimit = rateLimit({ name: 'rooms-chat', max: 40, windowMs: 60_000, keyBy: 'user' });
const readLimit = rateLimit({ name: 'rooms-read', max: 180, windowMs: 60_000, keyBy: 'user' });

function fail(reply: FastifyReply, code: string, message: string, status = 400) {
  return reply.code(status).send({ error: { code, message } });
}

const STATUS: Record<string, number> = {
  not_found: 404,
  closed: 410,
  not_member: 403,
  blocked: 403,
  forbidden: 403,
  invite_required: 403,
  not_friend: 403,
  full: 409,
  owner: 409,
  invalid_track: 400,
  invalid_index: 400,
  invalid_name: 400,
  too_many_rooms: 409,
  empty: 400,
};

function deny(reply: FastifyReply, code: string) {
  return fail(reply, code, 'Bu işlem yapılamadı.', STATUS[code] ?? 400);
}

/** Keeps the owner from being swept while they are actively using the room. */
function touchOwner(roomId: string, userId: string, ownerId: string): void {
  if (userId !== ownerId) return;
  getDb().prepare('UPDATE listening_rooms SET owner_seen_at = ? WHERE id = ?').run(new Date().toISOString(), roomId);
}

export async function roomsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/rooms', { preHandler: [requireAuth, readLimit] }, async (request) => {
    const db = getDb();
    const userId = request.user!.id;
    return {
      publicRooms: listRooms(db, userId, 20, 0),
      mine: listMyRooms(db, userId),
      invites: listInvites(db, userId),
    };
  });

  app.post<{ Body: { name?: unknown; visibility?: unknown; queueMode?: unknown } }>(
    '/api/rooms',
    { preHandler: [requireAuth, createLimit] },
    async (request, reply) => {
      const result = createRoom(getDb(), request.user!.id, request.body ?? {});
      if (!result.ok) return deny(reply, result.code);
      const db = getDb();
      const row = db.prepare('SELECT * FROM listening_rooms WHERE id = ?').get(result.roomId);
      return { roomId: result.roomId, room: row ? toSummary(db, row as never) : null };
    },
  );

  app.get<{ Params: { roomId: string } }>(
    '/api/rooms/:roomId',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      const userId = request.user!.id;
      const access = accessRoom(db, request.params.roomId, userId);
      if (!access.ok) return deny(reply, access.code);
      touchOwner(access.room.id, userId, access.room.owner_id);
      const state = parseState(access.room);
      return {
        room: toSummary(db, access.room),
        state,
        serverNow: new Date().toISOString(),
        members: listMembers(db, access.room.id),
        role: access.role,
        canControl: access.role === 'owner' || access.role === 'moderator',
        canEditQueue:
          access.role === 'owner' || access.role === 'moderator' || access.room.queue_mode === 'collab',
        joinCode: access.room.owner_id === userId ? access.room.join_code : undefined,
      };
    },
  );

  app.patch<{ Params: { roomId: string }; Body: { name?: unknown; visibility?: unknown; queueMode?: unknown } }>(
    '/api/rooms/:roomId',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const updated = updateRoom(db, request.params.roomId, request.user!.id, request.body ?? {});
      if (!updated) return deny(reply, 'forbidden');
      publishRoomMembers(db, updated.id);
      return { room: toSummary(db, updated) };
    },
  );

  app.delete<{ Params: { roomId: string } }>(
    '/api/rooms/:roomId',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      if (!closeRoom(db, request.params.roomId, request.user!.id)) return deny(reply, 'forbidden');
      publishRoomClosed(db, request.params.roomId, 'closed');
      return { ok: true };
    },
  );

  app.post<{ Params: { roomId: string }; Body: { code?: unknown } }>(
    '/api/rooms/:roomId/join',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const userId = request.user!.id;
      const code = typeof request.body?.code === 'string' ? request.body.code : null;
      const result = joinRoom(db, userId, request.params.roomId, code);
      if (!result.ok) {
        if (result.code === 'already_in_room') {
          return reply.code(409).send({
            error: {
              code: 'already_in_room',
              message: 'Zaten başka bir dinleme odasındasın.',
              roomId: result.roomId,
              roomName: result.roomName,
            },
          });
        }
        const message =
          result.code === 'invite_required'
            ? 'Bu oda özel. Davet veya bağlantı kodu gerekli.'
            : result.code === 'blocked'
              ? 'Bu odaya katılamazsın.'
              : 'Oda bulunamadı.';
        return fail(reply, result.code, message, STATUS[result.code] ?? 400);
      }
      publishRoomMembers(db, request.params.roomId);
      const access = accessRoom(db, request.params.roomId, userId);
      return {
        ok: true,
        alreadyMember: result.alreadyMember,
        state: access.ok ? parseState(access.room) : null,
        serverNow: new Date().toISOString(),
      };
    },
  );

  app.post<{ Params: { roomId: string } }>(
    '/api/rooms/:roomId/leave',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const userId = request.user!.id;
      const access = accessRoom(db, request.params.roomId, userId);
      if (!access.ok) return deny(reply, access.code);
      const result = leaveRoom(db, request.params.roomId, userId);
      publishRoomMembers(db, request.params.roomId);
      if (result.closed) publishRoomClosed(db, request.params.roomId, 'empty');
      return { ok: true, closed: result.closed, newOwnerId: result.newOwnerId };
    },
  );

  app.post<{ Params: { roomId: string }; Body: { userId?: unknown } }>(
    '/api/rooms/:roomId/invite',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const targetId = String(request.body?.userId ?? '').trim();
      if (!targetId) return fail(reply, 'invalid_user', 'Kullanıcı gerekli.');
      if (!findUserById(targetId)) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const result = inviteToRoom(db, request.params.roomId, request.user!.id, targetId);
      if (!result.ok) return deny(reply, result.code);
      const access = accessRoom(db, request.params.roomId, request.user!.id);
      if (access.ok) publishRoomInvite(targetId, toSummary(db, access.room));
      return { ok: true };
    },
  );

  /* ---------- playback ---------- */

  app.post<{ Params: { roomId: string }; Body: Partial<PlaybackInput> }>(
    '/api/rooms/:roomId/playback',
    { preHandler: [requireAuth, playLimit] },
    async (request, reply) => {
      const db = getDb();
      const body = request.body ?? {};
      const action = body.action;
      if (!['play', 'pause', 'seek', 'next', 'play-track', 'video'].includes(String(action))) {
        return fail(reply, 'invalid_action', 'Geçersiz oynatma komutu.');
      }
      const result = applyPlayback(db, request.params.roomId, request.user!.id, {
        action: action as PlaybackInput['action'],
        position: body.position,
        track: body.track,
        enabled: (body as { enabled?: unknown }).enabled,
      });
      if (!result.ok) return deny(reply, result.code);
      publishRoomState(db, request.params.roomId, result.state);
      return { state: result.state, serverNow: new Date().toISOString() };
    },
  );

  /* ---------- queue ---------- */

  app.post<{ Params: { roomId: string }; Body: { track?: unknown } }>(
    '/api/rooms/:roomId/queue',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const result = addToQueue(db, request.params.roomId, request.user!.id, request.body?.track);
      if (!result.ok) return deny(reply, result.code);
      publishRoomState(db, request.params.roomId, result.state);
      return { state: result.state, atFront: result.atFront };
    },
  );

  app.delete<{ Params: { roomId: string; index: string } }>(
    '/api/rooms/:roomId/queue/:index',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const index = Number.parseInt(request.params.index, 10);
      const result = removeFromQueue(db, request.params.roomId, request.user!.id, index);
      if (!result.ok) return deny(reply, result.code);
      publishRoomState(db, request.params.roomId, result.state);
      return { state: result.state };
    },
  );

  app.post<{ Params: { roomId: string }; Body: { from?: unknown; to?: unknown } }>(
    '/api/rooms/:roomId/queue/reorder',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const from = Number(request.body?.from);
      const to = Number(request.body?.to);
      const result = reorderQueue(db, request.params.roomId, request.user!.id, from, to);
      if (!result.ok) return deny(reply, result.code);
      publishRoomState(db, request.params.roomId, result.state);
      return { state: result.state };
    },
  );

  /* ---------- members ---------- */

  app.post<{ Params: { roomId: string; userId: string }; Body: { role?: unknown } }>(
    '/api/rooms/:roomId/members/:userId/role',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const role = request.body?.role === 'moderator' ? 'moderator' : 'listener';
      const db = getDb();
      const result = setMemberRole(db, request.params.roomId, request.user!.id, request.params.userId, role);
      if (!result.ok) return deny(reply, result.code);
      publishRoomMembers(db, request.params.roomId);
      return { ok: true, members: listMembers(db, request.params.roomId) };
    },
  );

  app.post<{ Params: { roomId: string; userId: string } }>(
    '/api/rooms/:roomId/members/:userId/kick',
    { preHandler: [requireAuth, writeLimit] },
    async (request, reply) => {
      const db = getDb();
      const result = kickMember(db, request.params.roomId, request.user!.id, request.params.userId);
      if (!result.ok) return deny(reply, result.code);
      publishRoomMembers(db, request.params.roomId);
      return { ok: true, members: listMembers(db, request.params.roomId) };
    },
  );

  /* ---------- chat ---------- */

  app.get<{ Params: { roomId: string }; Querystring: { before?: string; limit?: string } }>(
    '/api/rooms/:roomId/messages',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      const access = accessRoom(db, request.params.roomId, request.user!.id);
      if (!access.ok) return deny(reply, access.code);
      const limit = Number.parseInt(String(request.query.limit ?? ''), 10);
      const before = typeof request.query.before === 'string' ? request.query.before : null;
      return {
        messages: listRoomMessages(db, request.params.roomId, Number.isFinite(limit) ? limit : 40, before),
      };
    },
  );

  app.post<{ Params: { roomId: string }; Body: { body?: unknown } }>(
    '/api/rooms/:roomId/messages',
    { preHandler: [requireAuth, chatLimit] },
    async (request, reply) => {
      const db = getDb();
      const result = postRoomMessage(db, request.params.roomId, request.user!.id, request.body?.body);
      if (!result.ok) return deny(reply, result.code);
      publishRoomChat(db, request.params.roomId, result.message);
      return { message: result.message };
    },
  );

  app.delete<{ Params: { roomId: string; messageId: string } }>(
    '/api/rooms/:roomId/messages/:messageId',
    { preHandler: [requireAuth, chatLimit] },
    async (request, reply) => {
      const db = getDb();
      const message = deleteRoomMessage(db, request.params.roomId, request.user!.id, request.params.messageId);
      if (!message) return deny(reply, 'forbidden');
      publishRoomChat(db, request.params.roomId, message);
      return { message };
    },
  );

  /* ---------- invite lookup (for the picker) ---------- */

  app.get<{ Params: { roomId: string } }>(
    '/api/rooms/:roomId/invitable',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      const access = accessRoom(db, request.params.roomId, request.user!.id);
      if (!access.ok) return deny(reply, access.code);
      const rows = db
        .prepare(
          `SELECT u.id FROM friendships f
           JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
           WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
           ORDER BY u.display_name ASC
           LIMIT 100`,
        )
        .all(request.user!.id, request.user!.id, request.user!.id) as Array<{ id: string }>;
      const members = new Set(listMembers(db, request.params.roomId).map((member) => member.userId));
      const friends = rows
        .filter((row) => !members.has(row.id))
        .map((row) => {
          const user = findUserById(row.id);
          if (!user) return null;
          const publicUser = toPublicUser(user);
          return {
            id: publicUser.id,
            displayName: publicUser.displayName,
            username: publicUser.username,
            avatarUrl: publicUser.avatarUrl,
          };
        })
        .filter(Boolean);
      return { friends };
    },
  );
}
