/**
 * Official community endpoints: one global chat, one member list, audited
 * moderation. Everything is authenticated and every permission is resolved here.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { findUserById, toPublicUser } from '../users.js';
import {
  COMMUNITY_NAME,
  clearRestriction,
  communityRole,
  deleteCommunityMessage,
  editCommunityMessage,
  ensureMembership,
  isStaff,
  listCommunityMembers,
  listCommunityMessages,
  listReports,
  moderationLog,
  publishCommunityMemberUpdate,
  publishCommunityMessage,
  publishCommunityMessageUpdate,
  publishCommunityModeration,
  readCommunitySettings,
  reportMessage,
  resolveReport,
  restrictMember,
  restrictions,
  sendCommunityMessage,
  setCommunityRole,
  writeCommunitySettings,
} from '../community.js';

const readLimit = rateLimit({ name: 'community-read', max: 240, windowMs: 60_000, keyBy: 'user' });
const sendLimit = rateLimit({ name: 'community-send', max: 20, windowMs: 60_000, keyBy: 'user' });
const editLimit = rateLimit({ name: 'community-edit', max: 40, windowMs: 60_000, keyBy: 'user' });
const modLimit = rateLimit({ name: 'community-mod', max: 60, windowMs: 60_000, keyBy: 'user' });
const reportLimit = rateLimit({ name: 'community-report', max: 10, windowMs: 60_000, keyBy: 'user' });

const MESSAGE_ID_RE = /^cm_[a-f0-9]{18}$/;

const STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  muted: 403,
  suspended: 403,
  slow_mode: 429,
  duplicate: 409,
  too_long: 400,
  empty: 400,
  invalid_attachment: 400,
  target_owner: 409,
  target_staff: 403,
  self: 400,
  already_reported: 409,
  invalid_reason: 400,
};

function fail(reply: FastifyReply, code: string, message: string, status = STATUS[code] ?? 400) {
  return reply.code(status).send({ error: { code, message } });
}

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/community/me', { preHandler: [requireAuth, readLimit] }, async (request) => {
    const db = getDb();
    const userId = request.user!.id;
    ensureMembership(db, userId);
    const role = communityRole(db, userId);
    const state = restrictions(db, userId);
    const staff = isStaff(role);
    return {
      name: COMMUNITY_NAME,
      role,
      canModerate: staff,
      canManage: role === 'owner',
      restrictions: state,
      settings: readCommunitySettings(db),
      // Directory size is part of the staff-only member data.
      memberCount: staff
        ? (db.prepare('SELECT COUNT(*) AS c FROM community_members').get() as { c: number }).c
        : null,
      canViewDirectory: staff,
    };
  });

  /* ---------- messages ---------- */

  app.get<{ Querystring: { before?: string; limit?: string } }>(
    '/api/community/messages',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      const userId = request.user!.id;
      ensureMembership(db, userId);
      if (restrictions(db, userId).reason === 'suspended') {
        return fail(reply, 'suspended', 'Topluluktan geçici olarak uzaklaştırıldın.');
      }
      const limit = Number.parseInt(String(request.query.limit ?? ''), 10);
      const before = typeof request.query.before === 'string' ? request.query.before : null;
      const page = listCommunityMessages(db, userId, before, Number.isFinite(limit) ? limit : 40);
      return { ...page, role: communityRole(db, userId) };
    },
  );

  app.post<{ Body: { body?: unknown; attachment?: unknown; clientId?: unknown } }>(
    '/api/community/messages',
    { preHandler: [requireAuth, sendLimit] },
    async (request, reply) => {
      const db = getDb();
      const settings = readCommunitySettings(db);
      const result = sendCommunityMessage(
        db,
        request.user!.id,
        request.body ?? {},
        settings.maxMessageLength,
        settings.slowModeSeconds,
      );
      if (!result.ok) {
        if (result.code === 'slow_mode') {
          return reply
            .code(429)
            .header('Retry-After', String(Math.ceil((result.retryAfterMs ?? 1000) / 1000)))
            .send({ error: { code: 'slow_mode', message: 'Yavaş mod açık; biraz bekle.', retryAfterMs: result.retryAfterMs } });
        }
        const message =
          result.code === 'muted'
            ? 'Susturulmuşsun; şu an mesaj gönderemezsin.'
            : result.code === 'suspended'
              ? 'Topluluktan geçici olarak uzaklaştırıldın.'
              : result.code === 'duplicate'
                ? 'Aynı mesajı tekrar gönderme.'
                : 'Mesaj gönderilemedi.';
        return fail(reply, result.code, message);
      }
      if (!result.duplicate) publishCommunityMessage(result.message);
      return { message: result.message, duplicate: result.duplicate };
    },
  );

  app.patch<{ Params: { messageId: string }; Body: { body?: unknown } }>(
    '/api/community/messages/:messageId',
    { preHandler: [requireAuth, editLimit] },
    async (request, reply) => {
      if (!MESSAGE_ID_RE.test(request.params.messageId)) return fail(reply, 'not_found', 'Mesaj bulunamadı.');
      const db = getDb();
      const settings = readCommunitySettings(db);
      const updated = editCommunityMessage(db, request.user!.id, request.params.messageId, request.body?.body, settings.maxMessageLength);
      if (!updated) return fail(reply, 'forbidden', 'Bu mesajı düzenleyemezsin.', 403);
      publishCommunityMessageUpdate(updated);
      return { message: updated };
    },
  );

  app.delete<{ Params: { messageId: string } }>(
    '/api/community/messages/:messageId',
    { preHandler: [requireAuth, editLimit] },
    async (request, reply) => {
      if (!MESSAGE_ID_RE.test(request.params.messageId)) return fail(reply, 'not_found', 'Mesaj bulunamadı.');
      const result = deleteCommunityMessage(getDb(), request.user!.id, request.params.messageId);
      if (!result.ok) {
        return result.code === 'forbidden'
          ? fail(reply, 'forbidden', 'Bu mesajı silemezsin.', 403)
          : fail(reply, 'not_found', 'Mesaj bulunamadı.', 404);
      }
      publishCommunityMessageUpdate(result.message);
      if (result.moderating) publishCommunityModeration('delete_message', result.message.userId);
      return { message: result.message };
    },
  );

  /* ---------- members ---------- */

  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    '/api/community/members',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      // The full registered-member directory is staff-only. Regular members keep
      // profile search, friends and messaging; only this directory is restricted.
      if (!isStaff(communityRole(db, request.user!.id))) {
        return fail(reply, 'forbidden', 'Üye dizini yalnızca yetkililere açıktır.', 403);
      }
      const limit = Number.parseInt(String(request.query.limit ?? ''), 10);
      const offset = Number.parseInt(String(request.query.offset ?? ''), 10);
      return listCommunityMembers(db, request.user!.id, {
        q: typeof request.query.q === 'string' ? request.query.q : '',
        limit: Number.isFinite(limit) ? limit : 30,
        offset: Number.isFinite(offset) ? offset : 0,
      });
    },
  );

  /* ---------- moderation ---------- */

  app.get('/api/community/moderation', { preHandler: [requireAuth, modLimit] }, async (request, reply) => {
    const db = getDb();
    if (!isStaff(communityRole(db, request.user!.id))) return fail(reply, 'forbidden', 'Yetkin yok.', 403);
    return {
      actions: moderationLog(db),
      reports: listReports(db, 'open'),
    };
  });

  app.post<{ Body: { userId?: unknown; minutes?: unknown; reason?: unknown } }>(
    '/api/community/moderation/mute',
    { preHandler: [requireAuth, modLimit] },
    async (request, reply) => {
      const targetId = String(request.body?.userId ?? '').trim();
      const minutes = Number(request.body?.minutes);
      if (!targetId || !findUserById(targetId)) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const result = restrictMember(
        getDb(),
        request.user!.id,
        targetId,
        'mute',
        Number.isFinite(minutes) ? minutes : 10,
        typeof request.body?.reason === 'string' ? request.body.reason.slice(0, 200) : null,
      );
      if (!result.ok) return fail(reply, result.code, 'Susturma uygulanamadı.');
      publishCommunityMemberUpdate(targetId, communityRole(getDb(), targetId));
      publishCommunityModeration('mute', targetId);
      return { ok: true, until: result.until };
    },
  );

  app.post<{ Body: { userId?: unknown; minutes?: unknown; reason?: unknown } }>(
    '/api/community/moderation/suspend',
    { preHandler: [requireAuth, modLimit] },
    async (request, reply) => {
      const targetId = String(request.body?.userId ?? '').trim();
      const minutes = Number(request.body?.minutes);
      if (!targetId || !findUserById(targetId)) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const result = restrictMember(
        getDb(),
        request.user!.id,
        targetId,
        'suspend',
        Number.isFinite(minutes) ? minutes : 60,
        typeof request.body?.reason === 'string' ? request.body.reason.slice(0, 200) : null,
      );
      if (!result.ok) return fail(reply, result.code, 'Uzaklaştırma uygulanamadı.');
      publishCommunityMemberUpdate(targetId, communityRole(getDb(), targetId));
      publishCommunityModeration('suspend', targetId);
      return { ok: true, until: result.until };
    },
  );

  app.post<{ Body: { userId?: unknown; kind?: unknown } }>(
    '/api/community/moderation/clear',
    { preHandler: [requireAuth, modLimit] },
    async (request, reply) => {
      const targetId = String(request.body?.userId ?? '').trim();
      const kind = request.body?.kind === 'suspend' ? 'suspend' : 'mute';
      if (!targetId) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const result = clearRestriction(getDb(), request.user!.id, targetId, kind);
      if (!result.ok) return fail(reply, result.code, 'İşlem yapılamadı.');
      publishCommunityMemberUpdate(targetId, communityRole(getDb(), targetId));
      publishCommunityModeration(`un${kind}`, targetId);
      return { ok: true };
    },
  );

  app.post<{ Body: { userId?: unknown; role?: unknown } }>(
    '/api/community/roles',
    { preHandler: [requireAuth, modLimit] },
    async (request, reply) => {
      const targetId = String(request.body?.userId ?? '').trim();
      const role = request.body?.role === 'moderator' ? 'moderator' : 'member';
      if (!targetId) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const result = setCommunityRole(getDb(), request.user!.id, targetId, role);
      if (!result.ok) return fail(reply, result.code, 'Rol değiştirilemedi.');
      publishCommunityMemberUpdate(targetId, role as 'moderator' | 'member');
      publishCommunityModeration(role === 'moderator' ? 'promote' : 'demote', targetId);
      return { ok: true, role };
    },
  );

  /* ---------- reports ---------- */

  app.post<{ Body: { messageId?: unknown; reason?: unknown } }>(
    '/api/community/reports',
    { preHandler: [requireAuth, reportLimit] },
    async (request, reply) => {
      const messageId = String(request.body?.messageId ?? '').trim();
      const reason = typeof request.body?.reason === 'string' ? request.body.reason : 'other';
      if (!MESSAGE_ID_RE.test(messageId)) return fail(reply, 'not_found', 'Mesaj bulunamadı.', 404);
      const result = reportMessage(getDb(), request.user!.id, messageId, reason);
      if (!result.ok) {
        return result.code === 'already_reported'
          ? fail(reply, 'already_reported', 'Bu mesajı zaten bildirdin.')
          : fail(reply, 'not_found', 'Mesaj bulunamadı.', 404);
      }
      return { ok: true };
    },
  );

  app.get<{ Querystring: { status?: string } }>(
    '/api/community/reports',
    { preHandler: [requireAuth, modLimit] },
    async (request, reply) => {
      const db = getDb();
      if (!isStaff(communityRole(db, request.user!.id))) return fail(reply, 'forbidden', 'Yetkin yok.', 403);
      const status = request.query.status === 'all' ? 'all' : 'open';
      return { reports: listReports(db, status) };
    },
  );

  app.post<{ Params: { reportId: string }; Body: { action?: unknown } }>(
    '/api/community/reports/:reportId/resolve',
    { preHandler: [requireAuth, modLimit] },
    async (request, reply) => {
      const reportId = Number.parseInt(request.params.reportId, 10);
      if (!Number.isFinite(reportId)) return fail(reply, 'not_found', 'Bildirim bulunamadı.', 404);
      const action = request.body?.action === 'dismissed' ? 'dismissed' : 'resolved';
      const result = resolveReport(getDb(), request.user!.id, reportId, action);
      if (!result.ok) return fail(reply, result.code, 'Bildirim kapatılamadı.');
      return { ok: true };
    },
  );

  /* ---------- settings ---------- */

  app.get('/api/community/settings', { preHandler: [requireAuth, readLimit] }, async () => ({
    settings: readCommunitySettings(getDb()),
  }));

  app.put<{ Body: { slowModeSeconds?: unknown; maxMessageLength?: unknown } }>(
    '/api/community/settings',
    { preHandler: [requireAuth, modLimit] },
    async (request, reply) => {
      const db = getDb();
      if (communityRole(db, request.user!.id) !== 'owner') return fail(reply, 'forbidden', 'Yalnız kurucu ayar değiştirebilir.', 403);
      const slow = Number(request.body?.slowModeSeconds);
      const maxLength = Number(request.body?.maxMessageLength);
      const settings = writeCommunitySettings(db, request.user!.id, {
        ...(Number.isFinite(slow) ? { slowModeSeconds: slow } : {}),
        ...(Number.isFinite(maxLength) ? { maxMessageLength: maxLength } : {}),
      });
      return { settings };
    },
  );

  /* ---------- member lookup for the profile links ---------- */

  app.get<{ Params: { userId: string } }>(
    '/api/community/member/:userId',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      const target = findUserById(request.params.userId);
      if (!target) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const user = toPublicUser(target);
      ensureMembership(db, user.id);
      return {
        member: {
          userId: user.id,
          displayName: user.displayName,
          username: user.username,
          avatarUrl: user.avatarUrl,
          role: communityRole(db, user.id),
        },
      };
    },
  );
}
