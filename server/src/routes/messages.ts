/**
 * Direct message endpoints + real-time fan-out.
 *
 * Identity comes from the session; the body never names the sender. Membership is
 * re-checked inside the database layer on every call, so a stale client cannot
 * read a thread it no longer belongs to.
 *
 * Delivery uses the presence SSE hub: a message is written to SQLite first and
 * only then published, so a reconnect replays history instead of losing it.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { pushNotification } from '../friends.js';
import { publishNotificationCount } from '../friendsRealtime.js';
import { presenceStore } from '../presence.js';
import { findUserById, toPublicUser } from '../users.js';
import {
  deleteMessage,
  editMessage,
  findConversation,
  getMessages,
  listConversations,
  markRead,
  messagingPermission,
  openConversation,
  peerOf,
  peerReadAt,
  sendMessage,
  unreadTotal,
} from '../messages.js';
import type { RealtimeEvent } from '../presence.js';

const sendLimit = rateLimit({ name: 'dm-send', max: 60, windowMs: 60_000, keyBy: 'user' });
const editLimit = rateLimit({ name: 'dm-edit', max: 60, windowMs: 60_000, keyBy: 'user' });
const readLimit = rateLimit({ name: 'dm-read', max: 240, windowMs: 60_000, keyBy: 'user' });
const listLimit = rateLimit({ name: 'dm-list', max: 180, windowMs: 60_000, keyBy: 'user' });
const typingLimit = rateLimit({ name: 'dm-typing', max: 400, windowMs: 60_000, keyBy: 'user' });

const MESSAGE_ID_RE = /^msg_[a-f0-9]{18}$/;
const CONVERSATION_ID_RE = /^cv_[a-f0-9]{18}$/;

function error(reply: FastifyReply, code: string, message: string, status = 400) {
  return reply.code(status).send({ error: { code, message } });
}

function permissionStatus(code: string): number {
  if (code === 'not_found') return 404;
  if (code === 'forbidden' || code === 'blocked' || code === 'self') return 403;
  if (code === 'not_friends') return 403;
  return 400;
}

function publish(userIds: string[], event: RealtimeEvent): void {
  try {
    presenceStore.publish(userIds, event);
  } catch {
    // A dead stream must never fail the write that already happened.
  }
}

export async function messagesRoutes(app: FastifyInstance): Promise<void> {
  /* ---------- conversations ---------- */

  app.get<{ Querystring: { limit?: string; offset?: string; q?: string } }>(
    '/api/messages/conversations',
    { preHandler: [requireAuth, listLimit] },
    async (request) => {
      const limit = Number.parseInt(String(request.query.limit ?? ''), 10);
      const offset = Number.parseInt(String(request.query.offset ?? ''), 10);
      const page = listConversations(
        getDb(),
        request.user!.id,
        Number.isFinite(limit) ? limit : 30,
        Number.isFinite(offset) ? offset : 0,
      );
      const search = String(request.query.q ?? '').trim().toLowerCase();
      const items = search
        ? page.items.filter(
            (item) =>
              item.peer.displayName.toLowerCase().includes(search) ||
              (item.peer.username ?? '').toLowerCase().includes(search),
          )
        : page.items;
      return { ...page, items, unreadTotal: unreadTotal(getDb(), request.user!.id) };
    },
  );

  app.post<{ Body: { userId?: unknown } }>(
    '/api/messages/conversations',
    { preHandler: [requireAuth, sendLimit] },
    async (request, reply) => {
      const peerId = String(request.body?.userId ?? '').trim();
      if (!peerId) return error(reply, 'invalid_user', 'Kullanıcı gerekli.');
      if (!findUserById(peerId)) return error(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const result = openConversation(getDb(), request.user!.id, peerId);
      if (!result.ok) {
        const message =
          result.code === 'blocked'
            ? 'Bu kullanıcıyla mesajlaşamazsın.'
            : result.code === 'self'
              ? 'Kendine mesaj gönderemezsin.'
              : 'Mesajlaşmak için arkadaş olmanız gerekir.';
        return error(reply, result.code, message, permissionStatus(result.code));
      }
      return { conversationId: result.conversationId, created: result.created };
    },
  );

  /* ---------- one conversation ---------- */

  app.get<{ Params: { conversationId: string }; Querystring: { before?: string; limit?: string } }>(
    '/api/messages/conversations/:conversationId',
    { preHandler: [requireAuth, listLimit] },
    async (request, reply) => {
      const { conversationId } = request.params;
      if (!CONVERSATION_ID_RE.test(conversationId)) return error(reply, 'invalid_conversation', 'Geçersiz konuşma.');
      const db = getDb();
      const userId = request.user!.id;
      const conversation = findConversation(db, userId, conversationId);
      if (!conversation) return error(reply, 'not_found', 'Konuşma bulunamadı.', 404);
      const peerId = peerOf(conversation, userId);
      const limit = Number.parseInt(String(request.query.limit ?? ''), 10);
      const before = typeof request.query.before === 'string' ? request.query.before : null;
      const page = getMessages(db, userId, conversationId, Number.isFinite(limit) ? limit : 40, before);
      if (!page) return error(reply, 'forbidden', 'Bu konuşmaya erişemezsin.', 403);
      const peerRow = findUserById(peerId);
      const peer = peerRow ? toPublicUser(peerRow) : null;
      const permission = messagingPermission(db, userId, peerId);
      return {
        conversation: {
          id: conversationId,
          peer: peer
            ? {
                id: peer.id,
                username: peer.username,
                displayName: peer.displayName,
                avatarUrl: peer.avatarUrl,
              }
            : null,
          canSend: permission === 'ok',
          reason: permission === 'ok' ? null : permission,
          lastMessageAt: conversation.last_message_at,
        },
        messages: page.items,
        hasMore: page.hasMore,
        peerReadAt: peerReadAt(db, conversationId, peerId),
      };
    },
  );

  /* ---------- send ---------- */

  app.post<{
    Params: { conversationId: string };
    Body: { body?: unknown; clientId?: unknown; attachment?: unknown };
  }>(
    '/api/messages/conversations/:conversationId',
    { preHandler: [requireAuth, sendLimit] },
    async (request, reply) => {
      const { conversationId } = request.params;
      if (!CONVERSATION_ID_RE.test(conversationId)) return error(reply, 'invalid_conversation', 'Geçersiz konuşma.');
      const db = getDb();
      const userId = request.user!.id;
      const result = sendMessage(db, userId, conversationId, request.body ?? {});
      if (!result.ok) {
        const message =
          result.code === 'empty'
            ? 'Boş mesaj gönderilemez.'
            : result.code === 'invalid_attachment'
              ? 'Geçersiz paylaşım.'
              : result.code === 'not_found'
                ? 'Konuşma bulunamadı.'
                : 'Mesaj gönderme iznin yok.';
        return error(reply, result.code, message, permissionStatus(result.code));
      }

      const conversation = findConversation(db, userId, conversationId);
      const peerId = conversation ? peerOf(conversation, userId) : null;
      if (peerId) {
        publish([userId, peerId], {
          type: 'message',
          conversationId,
          message: result.message,
          at: new Date().toISOString(),
        });
        if (!result.duplicate) {
          // One notification per unread burst: the dedupe key changes when the
          // recipient reads, so the next burst notifies again.
          const readMarker = peerReadAt(db, conversationId, peerId) ?? 'unread';
          pushNotification(db, {
            userId: peerId,
            kind: 'message',
            actorId: userId,
            entityId: conversationId,
            dedupeKey: `message:${conversationId}:${readMarker}`,
          });
          publishNotificationCount(db, peerId, 'message');
        }
      }
      return { message: result.message, duplicate: result.duplicate };
    },
  );

  /* ---------- edit / delete ---------- */

  app.patch<{ Params: { conversationId: string; messageId: string }; Body: { body?: unknown } }>(
    '/api/messages/conversations/:conversationId/:messageId',
    { preHandler: [requireAuth, editLimit] },
    async (request, reply) => {
      const { conversationId, messageId } = request.params;
      if (!CONVERSATION_ID_RE.test(conversationId) || !MESSAGE_ID_RE.test(messageId)) {
        return error(reply, 'invalid_message', 'Geçersiz mesaj.');
      }
      const db = getDb();
      const userId = request.user!.id;
      const updated = editMessage(db, userId, conversationId, messageId, request.body?.body);
      if (!updated) return error(reply, 'forbidden', 'Bu mesajı düzenleyemezsin.', 403);
      const conversation = findConversation(db, userId, conversationId);
      const peerId = conversation ? peerOf(conversation, userId) : null;
      publish(peerId ? [userId, peerId] : [userId], {
        type: 'message_update',
        conversationId,
        message: updated,
        at: new Date().toISOString(),
      });
      return { message: updated };
    },
  );

  app.delete<{ Params: { conversationId: string; messageId: string } }>(
    '/api/messages/conversations/:conversationId/:messageId',
    { preHandler: [requireAuth, editLimit] },
    async (request, reply) => {
      const { conversationId, messageId } = request.params;
      if (!CONVERSATION_ID_RE.test(conversationId) || !MESSAGE_ID_RE.test(messageId)) {
        return error(reply, 'invalid_message', 'Geçersiz mesaj.');
      }
      const db = getDb();
      const userId = request.user!.id;
      const deleted = deleteMessage(db, userId, conversationId, messageId);
      if (!deleted) return error(reply, 'forbidden', 'Bu mesajı silemezsin.', 403);
      const conversation = findConversation(db, userId, conversationId);
      const peerId = conversation ? peerOf(conversation, userId) : null;
      publish(peerId ? [userId, peerId] : [userId], {
        type: 'message_update',
        conversationId,
        message: deleted,
        at: new Date().toISOString(),
      });
      return { message: deleted };
    },
  );

  /* ---------- read state ---------- */

  app.post<{ Params: { conversationId: string }; Body: { messageId?: unknown } }>(
    '/api/messages/conversations/:conversationId/read',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const { conversationId } = request.params;
      if (!CONVERSATION_ID_RE.test(conversationId)) return error(reply, 'invalid_conversation', 'Geçersiz konuşma.');
      const db = getDb();
      const userId = request.user!.id;
      const conversation = findConversation(db, userId, conversationId);
      if (!conversation) return error(reply, 'not_found', 'Konuşma bulunamadı.', 404);
      const latest = getMessages(db, userId, conversationId, 1, null);
      const messageId =
        typeof request.body?.messageId === 'string' && MESSAGE_ID_RE.test(request.body.messageId)
          ? request.body.messageId
          : (latest?.items[0]?.id ?? null);
      markRead(db, userId, conversationId, messageId);
      const peerId = peerOf(conversation, userId);
      publish([peerId], {
        type: 'read',
        conversationId,
        userId,
        messageId,
        at: new Date().toISOString(),
      });
      return { ok: true, unreadTotal: unreadTotal(db, userId) };
    },
  );

  app.post<{ Params: { conversationId: string }; Body: { typing?: unknown } }>(
    '/api/messages/conversations/:conversationId/typing',
    { preHandler: [requireAuth, typingLimit] },
    async (request, reply) => {
      const { conversationId } = request.params;
      if (!CONVERSATION_ID_RE.test(conversationId)) return error(reply, 'invalid_conversation', 'Geçersiz konuşma.');
      const db = getDb();
      const userId = request.user!.id;
      const conversation = findConversation(db, userId, conversationId);
      if (!conversation) return error(reply, 'not_found', 'Konuşma bulunamadı.', 404);
      const peerId = peerOf(conversation, userId);
      // Typing is ephemeral: never stored, only relayed.
      publish([peerId], {
        type: 'typing',
        conversationId,
        userId,
        typing: Boolean(request.body?.typing),
        at: new Date().toISOString(),
      });
      return { ok: true };
    },
  );

  app.get('/api/messages/unread', { preHandler: [requireAuth, listLimit] }, async (request) => ({
    unreadTotal: unreadTotal(getDb(), request.user!.id),
  }));
}
