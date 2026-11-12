/**
 * Direct messages.
 *
 * Conversations are strictly one-to-one, keyed by a canonical pair so the same
 * two people can never end up with two threads. Sending requires an accepted
 * friendship and no block in either direction; history stays readable to the two
 * participants, and every query is membership-checked.
 */
import type { Database } from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { pairKey } from './friends.js';
import type { MessageAttachment, MessageView } from './presence.js';

export const MAX_BODY = 2000;
const MAX_ATTACHMENT_LABEL = 200;

const ID_PATTERNS: Record<string, RegExp> = {
  track: /^(yt_[\w-]{11}|sp_[\w-]{1,80}|t_[a-f0-9]{8,32}|presence_[\w-]{1,60})$/,
  playlist: /^pl_[\w-]{4,40}$/,
  profile: /^[a-f0-9]{16,40}$/i,
};

const ALLOWED_IMAGE_HOSTS = new Set([
  'i.ytimg.com',
  'i.scdn.co',
  'image-cdn-fa.spotifycdn.com',
  'cdn-images.dzcdn.net',
  'is1-ssl.mzstatic.com',
  'lh3.googleusercontent.com',
]);

export type ConversationView = {
  id: string;
  peer: {
    id: string;
    username: string | null;
    displayName: string;
    avatarUrl: string | null;
  };
  lastMessage: { id: string; body: string; senderId: string; createdAt: string; deleted: boolean } | null;
  lastMessageAt: string;
  unread: number;
};

export type ConversationPage = {
  items: ConversationView[];
  total: number;
  limit: number;
  offset: number;
};

type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  client_id: string | null;
  attachment_json: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function newConversationId(): string {
  return `cv_${randomBytes(9).toString('hex')}`;
}

function newMessageId(): string {
  return `msg_${randomBytes(9).toString('hex')}`;
}

/** Normalises text without destroying the user's line breaks. */
export function sanitizeBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip control characters except tab/newline; collapse the rest.
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_BODY);
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return trimmed ? trimmed.slice(0, MAX_ATTACHMENT_LABEL) : null;
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/api/covers/')) return value.slice(0, 300);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (!ALLOWED_IMAGE_HOSTS.has(url.hostname)) return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Attachments are an allowlist, not a URL passthrough: a track id must match a
 * known shape, a playlist must exist and be visible, a profile must be public.
 */
export function validateAttachment(
  db: Database,
  senderId: string,
  raw: unknown,
): MessageAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  if (kind === 'track') {
    const trackId = typeof value.trackId === 'string' ? value.trackId : null;
    if (trackId && !ID_PATTERNS.track?.test(trackId)) return null;
    const title = safeText(value.title);
    const artist = safeText(value.subtitle) ?? safeText(value.artist);
    if (!title || !trackId) return null;
    return {
      kind: 'track',
      title,
      subtitle: artist,
      coverUrl: safeImageUrl(value.coverUrl),
      trackId,
      source: safeText(value.source),
    };
  }
  if (kind === 'playlist') {
    const playlistId = typeof value.playlistId === 'string' ? value.playlistId : '';
    if (!ID_PATTERNS.playlist?.test(playlistId)) return null;
    const row = db
      .prepare('SELECT id, name, visibility, owner_id, cover_url FROM playlists WHERE id = ?')
      .get(playlistId) as
      | { id: string; name: string; visibility: string; owner_id: string | null; cover_url: string | null }
      | undefined;
    if (!row) return null;
    const visible = row.visibility === 'public' || row.owner_id === senderId;
    if (!visible) return null;
    return {
      kind: 'playlist',
      title: row.name.slice(0, MAX_ATTACHMENT_LABEL),
      subtitle: null,
      coverUrl: safeImageUrl(row.cover_url),
      playlistId: row.id,
    };
  }
  if (kind === 'profile') {
    const userId = typeof value.userId === 'string' ? value.userId : '';
    if (!ID_PATTERNS.profile?.test(userId)) return null;
    const row = db
      .prepare('SELECT id, display_name, username, avatar_url, profile_visibility FROM users WHERE id = ?')
      .get(userId) as
      | { id: string; display_name: string; username: string | null; avatar_url: string | null; profile_visibility: string | null }
      | undefined;
    if (!row) return null;
    if ((row.profile_visibility ?? 'public') === 'private' && row.id !== senderId) return null;
    return {
      kind: 'profile',
      title: row.display_name.slice(0, MAX_ATTACHMENT_LABEL),
      subtitle: row.username ? `@${row.username}` : null,
      coverUrl: safeImageUrl(row.avatar_url),
      userId: row.id,
    };
  }
  return null;
}

function parseAttachment(raw: string | null): MessageAttachment | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as MessageAttachment;
    if (!value || typeof value !== 'object' || !value.kind) return null;
    return value;
  } catch {
    return null;
  }
}

function toMessageView(row: MessageRow): MessageView {
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: deleted ? '' : row.body,
    attachment: deleted ? null : parseAttachment(row.attachment_json),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    clientId: row.client_id,
  };
}

export function conversationPairKey(a: string, b: string): string {
  return pairKey(a, b);
}

export function findConversation(db: Database, userId: string, conversationId: string): ConversationRow | null {
  const row = db
    .prepare('SELECT id, user_a, user_b, last_message_at FROM conversations WHERE id = ?')
    .get(conversationId) as ConversationRow | undefined;
  if (!row) return null;
  if (row.user_a !== userId && row.user_b !== userId) return null;
  return row;
}

export function peerOf(row: ConversationRow, userId: string): string {
  return row.user_a === userId ? row.user_b : row.user_a;
}

function isBlocked(db: Database, a: string, b: string): boolean {
  const row = db
    .prepare(
      'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    )
    .get(a, b, b, a);
  return Boolean(row);
}

function areFriends(db: Database, a: string, b: string): boolean {
  const row = db
    .prepare(`SELECT status FROM friendships WHERE pair_key = ?`)
    .get(conversationPairKey(a, b)) as { status: string } | undefined;
  return row?.status === 'accepted';
}

export type Permission = 'ok' | 'not_friends' | 'blocked' | 'self';

export function messagingPermission(db: Database, a: string, b: string): Permission {
  if (a === b) return 'self';
  if (isBlocked(db, a, b)) return 'blocked';
  if (!areFriends(db, a, b)) return 'not_friends';
  return 'ok';
}

/** Creates the thread on first contact; idempotent for the same pair. */
export function openConversation(
  db: Database,
  userId: string,
  peerId: string,
): { ok: true; conversationId: string; created: boolean } | { ok: false; code: Permission } {
  if (userId === peerId) return { ok: false, code: 'self' };
  const pair = conversationPairKey(userId, peerId);
  const existing = db
    .prepare('SELECT id FROM conversations WHERE pair_key = ?')
    .get(pair) as { id: string } | undefined;
  if (existing) {
    const permission = messagingPermission(db, userId, peerId);
    if (permission !== 'ok' && permission !== 'not_friends') return { ok: false, code: permission };
    return { ok: true, conversationId: existing.id, created: false };
  }
  const permission = messagingPermission(db, userId, peerId);
  if (permission !== 'ok') return { ok: false, code: permission };
  const id = newConversationId();
  const [a, b] = userId < peerId ? [userId, peerId] : [peerId, userId];
  const timestamp = now();
  db.prepare(
    `INSERT INTO conversations (id, user_a, user_b, pair_key, created_at, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, a, b, pair, timestamp, timestamp);
  return { ok: true, conversationId: id, created: true };
}

export function listConversations(db: Database, userId: string, limit = 30, offset = 0): ConversationPage {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safeOffset = Math.max(offset, 0);
  const rows = db
    .prepare(
      `SELECT c.id, u.id AS peer_id, u.username, u.display_name, u.avatar_url,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_body,
              (SELECT m.id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_id,
              (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_sender,
              (SELECT m.deleted_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_deleted,
              (SELECT m.attachment_json FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_attachment,
              (SELECT r.last_read_at FROM conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = ?) AS last_read_at,
              (SELECT COUNT(*) FROM messages m
                 WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
                   AND m.created_at > COALESCE((SELECT r.last_read_at FROM conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = ?), '')
              ) AS unread,
              c.last_message_at
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
       WHERE (c.user_a = ? OR c.user_b = ?)
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)
         )
       ORDER BY c.last_message_at DESC, c.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, userId, userId, userId, userId, userId, userId, safeLimit, safeOffset) as Array<{
    id: string;
    peer_id: string;
    username: string | null;
    display_name: string;
    avatar_url: string | null;
    last_body: string | null;
    last_id: string | null;
    last_sender: string | null;
    last_deleted: string | null;
    last_attachment: string | null;
    unread: number;
    last_message_at: string;
  }>;

  const total = (
    db
      .prepare('SELECT COUNT(*) AS c FROM conversations WHERE user_a = ? OR user_b = ?')
      .get(userId, userId) as { c: number }
  ).c;

  return {
    items: rows.map((row) => ({
      id: row.id,
      peer: {
        id: row.peer_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      },
      lastMessage: row.last_id
        ? {
            id: row.last_id,
            body: row.last_deleted
              ? ''
              : ((row.last_body ?? '').slice(0, 140) ||
                (parseAttachment(row.last_attachment)?.title ?? '').slice(0, 140)),
            senderId: row.last_sender ?? '',
            createdAt: row.last_message_at,
            deleted: Boolean(row.last_deleted),
          }
        : null,
      lastMessageAt: row.last_message_at,
      unread: row.unread ?? 0,
    })),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export function getMessages(
  db: Database,
  userId: string,
  conversationId: string,
  limit = 40,
  before?: string | null,
): { items: MessageView[]; hasMore: boolean } | null {
  const conversation = findConversation(db, userId, conversationId);
  if (!conversation) return null;
  const peerId = peerOf(conversation, userId);
  if (isBlocked(db, userId, peerId)) return null;

  const safeLimit = Math.min(Math.max(limit, 1), 80);
  // The cursor is a message id so equal timestamps cannot drop or repeat rows.
  // A raw timestamp is still accepted for older clients and is strictly exclusive.
  let cursor: { createdAt: string; rowid: number | null } | null = null;
  if (before) {
    const anchor = db
      .prepare('SELECT rowid AS rid, created_at FROM messages WHERE id = ? AND conversation_id = ?')
      .get(before, conversationId) as { rid: number; created_at: string } | undefined;
    cursor = anchor ? { createdAt: anchor.created_at, rowid: anchor.rid } : { createdAt: before, rowid: null };
  }
  const rows = cursor
    ? cursor.rowid === null
      ? (db
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ? AND created_at < ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(conversationId, cursor.createdAt, safeLimit + 1) as MessageRow[])
      : (db
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ?
               AND (created_at < ? OR (created_at = ? AND rowid < ?))
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(conversationId, cursor.createdAt, cursor.createdAt, cursor.rowid, safeLimit + 1) as MessageRow[])
    : (db
        .prepare(
          `SELECT * FROM messages WHERE conversation_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(conversationId, safeLimit + 1) as MessageRow[]);

  const hasMore = rows.length > safeLimit;
  return {
    items: rows.slice(0, safeLimit).map(toMessageView).reverse(),
    hasMore,
  };
}

export type SendResult =
  | { ok: true; message: MessageView; duplicate: boolean }
  | { ok: false; code: 'not_found' | 'forbidden' | Permission | 'empty' | 'invalid_attachment' };

export function sendMessage(
  db: Database,
  userId: string,
  conversationId: string,
  input: { body?: unknown; clientId?: unknown; attachment?: unknown },
): SendResult {
  const conversation = findConversation(db, userId, conversationId);
  if (!conversation) return { ok: false, code: 'not_found' };
  const peerId = peerOf(conversation, userId);
  const permission = messagingPermission(db, userId, peerId);
  if (permission !== 'ok') return { ok: false, code: permission };

  const body = sanitizeBody(input.body) ?? '';
  const clientId = typeof input.clientId === 'string' ? input.clientId.slice(0, 80) : null;
  let attachment: MessageAttachment | null = null;
  if (input.attachment !== undefined && input.attachment !== null) {
    attachment = validateAttachment(db, userId, input.attachment);
    if (!attachment) return { ok: false, code: 'invalid_attachment' };
  }
  if (!body && !attachment) return { ok: false, code: 'empty' };

  // Idempotency: the same client id in the same thread returns the first copy.
  if (clientId) {
    const existing = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? AND client_id = ?')
      .get(conversationId, clientId) as MessageRow | undefined;
    if (existing) return { ok: true, message: toMessageView(existing), duplicate: true };
  }

  const id = newMessageId();
  const createdAt = now();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_id, body, client_id, attachment_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, conversationId, userId, body, clientId, attachment ? JSON.stringify(attachment) : null, createdAt);
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(createdAt, conversationId);
  // The sender has read their own message by definition.
  markRead(db, userId, conversationId, id);

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow;
  return { ok: true, message: toMessageView(row), duplicate: false };
}

export function editMessage(
  db: Database,
  userId: string,
  conversationId: string,
  messageId: string,
  body: unknown,
): MessageView | null {
  const conversation = findConversation(db, userId, conversationId);
  if (!conversation) return null;
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as MessageRow | undefined;
  if (!row || row.sender_id !== userId || row.deleted_at) return null;
  const clean = sanitizeBody(body);
  if (!clean) return null;
  db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(clean, now(), messageId);
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRow;
  return toMessageView(updated);
}

export function deleteMessage(
  db: Database,
  userId: string,
  conversationId: string,
  messageId: string,
): MessageView | null {
  const conversation = findConversation(db, userId, conversationId);
  if (!conversation) return null;
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as MessageRow | undefined;
  if (!row || row.sender_id !== userId || row.deleted_at) return null;
  db.prepare('UPDATE messages SET deleted_at = ?, body = ? WHERE id = ?').run(now(), '', messageId);
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRow;
  return toMessageView(updated);
}

export function markRead(db: Database, userId: string, conversationId: string, messageId: string | null): void {
  const conversation = findConversation(db, userId, conversationId);
  if (!conversation) return;
  db.prepare(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, last_read_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET
       last_read_message_id = excluded.last_read_message_id,
       last_read_at = excluded.last_read_at`,
  ).run(conversationId, userId, messageId, now());
}

export function unreadTotal(db: Database, userId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE (c.user_a = ? OR c.user_b = ?)
         AND m.sender_id <> ?
         AND m.deleted_at IS NULL
         AND m.created_at > COALESCE((
           SELECT r.last_read_at FROM conversation_reads r
           WHERE r.conversation_id = c.id AND r.user_id = ?
         ), '')`,
    )
    .get(userId, userId, userId, userId) as { c: number };
  return row.c;
}

/** Last read timestamp of the other side, for read receipts. */
export function peerReadAt(db: Database, conversationId: string, peerId: string): string | null {
  const row = db
    .prepare('SELECT last_read_at FROM conversation_reads WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, peerId) as { last_read_at: string } | undefined;
  return row?.last_read_at ?? null;
}
