/**
 * The single official NorieMusic Community.
 *
 * There is no "server list": every registered account belongs to this one
 * community, roles live in `community_members`, and the feed is a single global
 * stream. Moderation is auditable, time-boxed and enforced here — never trusted
 * from the client.
 *
 * Broadcasting uses the shared SSE hub (`publishAll`), so one connection per tab
 * still serves presence, DMs, rooms, quiz and the community.
 */
import type { Database } from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { CommunityMessage, CommunityRole, MessageAttachment } from './presence.js';
import { presenceStore } from './presence.js';
import { presentFor, type PresenceStatus, type ActivitySnapshot } from './presence.js';
import { sanitizeBody, validateAttachment } from './messages.js';

export const COMMUNITY_NAME = 'NorieMusic Community';
export const DEFAULT_MAX_LENGTH = 2000;
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'other'] as const;

type MemberRow = {
  user_id: string;
  role: CommunityRole;
  joined_at: string;
  muted_until: string | null;
  suspended_until: string | null;
  suspension_reason: string | null;
};

type MessageRow = {
  id: string;
  user_id: string;
  body: string;
  client_id: string | null;
  attachment_json: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

export type CommunityAuthor = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  role: CommunityRole;
};

export type CommunityMessageView = CommunityMessage & { author: CommunityAuthor | null };

function nowIso(): string {
  return new Date().toISOString();
}

/* ---------- membership + roles ---------- */

export function ensureMembership(db: Database, userId: string): MemberRow | null {
  const existing = db.prepare('SELECT * FROM community_members WHERE user_id = ?').get(userId) as MemberRow | undefined;
  if (existing) return existing;
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as
    | { id: string; role: string }
    | undefined;
  if (!user) return null;
  const at = nowIso();
  // The configured administrator owns the community; nobody else is promoted.
  const role: CommunityRole = user.role === 'admin' ? 'owner' : 'member';
  db.prepare(
    'INSERT INTO community_members (user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(userId, role, at, at);
  return db.prepare('SELECT * FROM community_members WHERE user_id = ?').get(userId) as MemberRow;
}

export function ensureMembershipForAll(db: Database): number {
  const at = nowIso();
  const result = db
    .prepare(
      `INSERT INTO community_members (user_id, role, joined_at, updated_at)
       SELECT id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END, ?, ?
       FROM users WHERE id NOT IN (SELECT user_id FROM community_members)`,
    )
    .run(at, at);
  return result.changes;
}

export function communityRole(db: Database, userId: string): CommunityRole {
  const row = ensureMembership(db, userId);
  return row?.role ?? 'member';
}

export function isStaff(role: CommunityRole): boolean {
  return role === 'owner' || role === 'moderator';
}

export function restrictions(db: Database, userId: string, now = Date.now()): {
  mutedUntil: string | null;
  suspendedUntil: string | null;
  suspensionReason: string | null;
  canPost: boolean;
  reason: 'muted' | 'suspended' | null;
} {
  const row = ensureMembership(db, userId);
  if (!row) return { mutedUntil: null, suspendedUntil: null, suspensionReason: null, canPost: false, reason: 'suspended' };
  const suspended = row.suspended_until && Date.parse(row.suspended_until) > now;
  const muted = row.muted_until && Date.parse(row.muted_until) > now;
  return {
    mutedUntil: muted ? row.muted_until : null,
    suspendedUntil: suspended ? row.suspended_until : null,
    suspensionReason: suspended ? row.suspension_reason : null,
    canPost: !suspended && !muted,
    reason: suspended ? 'suspended' : muted ? 'muted' : null,
  };
}

/* ---------- messages ---------- */

function parseAttachment(raw: string | null): MessageAttachment | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as MessageAttachment;
    return value && typeof value === 'object' && value.kind ? value : null;
  } catch {
    return null;
  }
}

function authorOf(db: Database, userId: string): CommunityAuthor | null {
  const row = db
    .prepare(
      `SELECT u.id, u.display_name, u.username, u.avatar_url, COALESCE(m.role, 'member') AS role
       FROM users u LEFT JOIN community_members m ON m.user_id = u.id
       WHERE u.id = ?`,
    )
    .get(userId) as
    | { id: string; display_name: string; username: string | null; avatar_url: string | null; role: CommunityRole }
    | undefined;
  if (!row) return null;
  return { id: row.id, displayName: row.display_name, username: row.username, avatarUrl: row.avatar_url, role: row.role };
}

export function toMessageView(db: Database, row: MessageRow): CommunityMessageView {
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    userId: row.user_id,
    body: deleted ? '' : row.body,
    attachment: deleted ? null : parseAttachment(row.attachment_json),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    clientId: row.client_id,
    author: authorOf(db, row.user_id),
  };
}

export function listCommunityMessages(
  db: Database,
  viewerId: string,
  before?: string | null,
  limit = 40,
): { items: CommunityMessageView[]; hasMore: boolean } {
  ensureMembership(db, viewerId);
  const safeLimit = Math.min(Math.max(limit, 1), 80);
  const rows = before
    ? (db
        .prepare(
          `SELECT * FROM community_messages WHERE created_at < ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(before, safeLimit + 1) as MessageRow[])
    : (db
        .prepare(
          `SELECT * FROM community_messages
           ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(safeLimit + 1) as MessageRow[]);
  const hasMore = rows.length > safeLimit;
  return { items: rows.slice(0, safeLimit).reverse().map((row) => toMessageView(db, row)), hasMore };
}

export type SendOutcome =
  | { ok: true; message: CommunityMessageView; duplicate: boolean }
  | {
      ok: false;
      code: 'empty' | 'invalid_attachment' | 'muted' | 'suspended' | 'slow_mode' | 'duplicate' | 'too_long';
      retryAfterMs?: number;
    };

export function sendCommunityMessage(
  db: Database,
  userId: string,
  input: { body?: unknown; attachment?: unknown; clientId?: unknown },
  maxLength = DEFAULT_MAX_LENGTH,
  slowModeSeconds = 0,
  now = Date.now(),
): SendOutcome {
  ensureMembership(db, userId);
  const state = restrictions(db, userId, now);
  if (!state.canPost) return { ok: false, code: state.reason === 'suspended' ? 'suspended' : 'muted' };

  const body = sanitizeBody(input.body) ?? '';
  if (body.length > maxLength) return { ok: false, code: 'too_long' };
  const clientId = typeof input.clientId === 'string' ? input.clientId.slice(0, 80) : null;
  let attachment: MessageAttachment | null = null;
  if (input.attachment !== undefined && input.attachment !== null) {
    attachment = validateAttachment(db, userId, input.attachment);
    if (!attachment) return { ok: false, code: 'invalid_attachment' };
  }
  if (!body && !attachment) return { ok: false, code: 'empty' };

  if (clientId) {
    const existing = db
      .prepare('SELECT * FROM community_messages WHERE user_id = ? AND client_id = ?')
      .get(userId, clientId) as MessageRow | undefined;
    if (existing) return { ok: true, message: toMessageView(db, existing), duplicate: true };
  }

  const last = db
    .prepare('SELECT body, created_at FROM community_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId) as { body: string; created_at: string } | undefined;
  if (last && body && last.body === body && now - Date.parse(last.created_at) < 8000) {
    return { ok: false, code: 'duplicate' };
  }
  if (slowModeSeconds > 0 && last) {
    const elapsed = now - Date.parse(last.created_at);
    if (elapsed < slowModeSeconds * 1000) {
      return { ok: false, code: 'slow_mode', retryAfterMs: slowModeSeconds * 1000 - elapsed };
    }
  }

  const id = `cm_${randomBytes(9).toString('hex')}`;
  // Timestamps are the pagination cursor, so two messages in the same millisecond
  // must not share one: the older page would silently skip a message.
  const lastAt = db
    .prepare('SELECT created_at FROM community_messages ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get() as { created_at: string } | undefined;
  const previous = lastAt ? Date.parse(lastAt.created_at) : Number.NaN;
  const stamp = Number.isFinite(previous) && previous >= now ? previous + 1 : now;
  const at = new Date(stamp).toISOString();
  db.prepare(
    `INSERT INTO community_messages (id, user_id, body, client_id, attachment_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, body, clientId, attachment ? JSON.stringify(attachment) : null, at);
  const row = db.prepare('SELECT * FROM community_messages WHERE id = ?').get(id) as MessageRow;
  return { ok: true, message: toMessageView(db, row), duplicate: false };
}

export function editCommunityMessage(
  db: Database,
  userId: string,
  messageId: string,
  body: unknown,
  maxLength = DEFAULT_MAX_LENGTH,
): CommunityMessageView | null {
  const row = db.prepare('SELECT * FROM community_messages WHERE id = ?').get(messageId) as MessageRow | undefined;
  if (!row || row.deleted_at || row.user_id !== userId) return null;
  const clean = sanitizeBody(body);
  if (!clean || clean.length > maxLength) return null;
  db.prepare('UPDATE community_messages SET body = ?, edited_at = ? WHERE id = ?').run(clean, nowIso(), messageId);
  const updated = db.prepare('SELECT * FROM community_messages WHERE id = ?').get(messageId) as MessageRow;
  return toMessageView(db, updated);
}

export type DeleteOutcome =
  | { ok: true; message: CommunityMessageView; moderating: boolean }
  | { ok: false; code: 'not_found' | 'forbidden' };

export function deleteCommunityMessage(
  db: Database,
  userId: string,
  messageId: string,
  now = Date.now(),
): DeleteOutcome {
  const row = db.prepare('SELECT * FROM community_messages WHERE id = ?').get(messageId) as MessageRow | undefined;
  if (!row || row.deleted_at) return { ok: false, code: 'not_found' };
  const role = communityRole(db, userId);
  const author = row.user_id === userId;
  if (!author && !isStaff(role)) return { ok: false, code: 'forbidden' };
  const at = new Date(now).toISOString();
  db.prepare('UPDATE community_messages SET deleted_at = ?, deleted_by = ?, body = ? WHERE id = ?').run(
    at,
    userId,
    '',
    messageId,
  );
  const moderating = !author;
  if (moderating) {
    recordAudit(db, userId, 'delete_message', { messageId, targetUserId: row.user_id, reason: null }, at);
  }
  const updated = db.prepare('SELECT * FROM community_messages WHERE id = ?').get(messageId) as MessageRow;
  return { ok: true, message: toMessageView(db, updated), moderating };
}

/* ---------- members ---------- */

export type CommunityMemberView = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  role: CommunityRole;
  joinedAt: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
  activity: ActivitySnapshot | null;
  mutedUntil: string | null;
  suspendedUntil: string | null;
};

export function listCommunityMembers(
  db: Database,
  viewerId: string,
  input: { q?: string; limit?: number; offset?: number } = {},
  now = Date.now(),
): { items: CommunityMemberView[]; total: number; limit: number; offset: number } {
  ensureMembership(db, viewerId);
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = (input.q ?? '').trim().toLowerCase();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const filter = q ? 'WHERE lower(u.display_name) LIKE ? OR lower(COALESCE(u.username, \'\')) LIKE ?' : '';
  const params = q ? [like, like] : [];

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM users u JOIN community_members m ON m.user_id = u.id ${filter}`)
      .get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT u.id, u.display_name, u.username, u.avatar_url, m.role, m.joined_at,
              m.muted_until, m.suspended_until
       FROM users u JOIN community_members m ON m.user_id = u.id
       ${filter}
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                lower(u.display_name) ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<{
    id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    role: CommunityRole;
    joined_at: string;
    muted_until: string | null;
    suspended_until: string | null;
  }>;

  return {
    total,
    limit,
    offset,
    items: rows.map((row) => {
      const presence = presentFor(db, presenceStore, viewerId, row.id, now);
      const restriction = restrictions(db, row.id, now);
      return {
        userId: row.id,
        displayName: row.display_name,
        username: row.username,
        avatarUrl: row.avatar_url,
        role: row.role,
        joinedAt: row.joined_at,
        status: presence?.status ?? 'offline',
        lastSeenAt: presence?.lastSeenAt ?? null,
        activity: presence?.activity ?? null,
        mutedUntil: restriction.mutedUntil,
        suspendedUntil: restriction.suspendedUntil,
      };
    }),
  };
}

/* ---------- moderation ---------- */

function recordAudit(
  db: Database,
  actorId: string,
  action: string,
  detail: { targetUserId?: string | null; messageId?: string | null; reason?: string | null },
  at = nowIso(),
  expiresAt: string | null = null,
): void {
  db.prepare(
    `INSERT INTO community_moderation (actor_id, target_user_id, action, reason, message_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(actorId, detail.targetUserId ?? null, action, detail.reason ?? null, detail.messageId ?? null, at, expiresAt);
}

export type ModerationOutcome =
  | { ok: true; until: string | null }
  | { ok: false; code: 'forbidden' | 'not_found' | 'target_owner' | 'target_staff' | 'self' };

function moderationGuard(
  db: Database,
  actorId: string,
  targetId: string,
): { ok: true; actorRole: CommunityRole; targetRole: CommunityRole } | { ok: false; code: 'forbidden' | 'not_found' | 'target_owner' | 'target_staff' | 'self' } {
  if (actorId === targetId) return { ok: false, code: 'self' };
  const actorRole = communityRole(db, actorId);
  if (!isStaff(actorRole)) return { ok: false, code: 'forbidden' };
  const target = ensureMembership(db, targetId);
  if (!target) return { ok: false, code: 'not_found' };
  const targetRole = target.role;
  if (targetRole === 'owner') return { ok: false, code: 'target_owner' };
  if (actorRole === 'moderator' && targetRole === 'moderator') return { ok: false, code: 'target_staff' };
  return { ok: true, actorRole, targetRole };
}

export function restrictMember(
  db: Database,
  actorId: string,
  targetId: string,
  kind: 'mute' | 'suspend',
  minutes: number,
  reason: string | null,
  now = Date.now(),
): ModerationOutcome {
  const guard = moderationGuard(db, actorId, targetId);
  if (!guard.ok) return guard as ModerationOutcome;
  const safeMinutes = Math.min(Math.max(Math.round(minutes), 1), 7 * 24 * 60);
  const until = new Date(now + safeMinutes * 60_000).toISOString();
  if (kind === 'mute') {
    db.prepare('UPDATE community_members SET muted_until = ?, updated_at = ? WHERE user_id = ?').run(until, nowIso(), targetId);
  } else {
    db.prepare(
      'UPDATE community_members SET suspended_until = ?, suspension_reason = ?, updated_at = ? WHERE user_id = ?',
    ).run(until, reason, nowIso(), targetId);
  }
  recordAudit(db, actorId, kind, { targetUserId: targetId, reason }, nowIso(), until);
  return { ok: true, until };
}

export function clearRestriction(
  db: Database,
  actorId: string,
  targetId: string,
  kind: 'mute' | 'suspend',
): ModerationOutcome {
  const guard = moderationGuard(db, actorId, targetId);
  if (!guard.ok) return guard as ModerationOutcome;
  if (kind === 'mute') {
    db.prepare('UPDATE community_members SET muted_until = NULL, updated_at = ? WHERE user_id = ?').run(nowIso(), targetId);
  } else {
    db.prepare(
      'UPDATE community_members SET suspended_until = NULL, suspension_reason = NULL, updated_at = ? WHERE user_id = ?',
    ).run(nowIso(), targetId);
  }
  recordAudit(db, actorId, `un${kind}`, { targetUserId: targetId });
  return { ok: true, until: null };
}

export function setCommunityRole(
  db: Database,
  actorId: string,
  targetId: string,
  role: 'moderator' | 'member',
): { ok: true } | { ok: false; code: 'forbidden' | 'not_found' | 'self' } {
  if (communityRole(db, actorId) !== 'owner') return { ok: false, code: 'forbidden' };
  if (actorId === targetId) return { ok: false, code: 'self' };
  if (!ensureMembership(db, targetId)) return { ok: false, code: 'not_found' };
  db.prepare("UPDATE community_members SET role = ?, updated_at = ? WHERE user_id = ?").run(role, nowIso(), targetId);
  recordAudit(db, actorId, role === 'moderator' ? 'promote' : 'demote', { targetUserId: targetId });
  return { ok: true };
}

export type AuditEntry = {
  id: number;
  actorId: string;
  targetUserId: string | null;
  action: string;
  reason: string | null;
  messageId: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export function moderationLog(db: Database, limit = 50): AuditEntry[] {
  const rows = db
    .prepare('SELECT * FROM community_moderation ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 100)) as Array<{
    id: number;
    actor_id: string;
    target_user_id: string | null;
    action: string;
    reason: string | null;
    message_id: string | null;
    created_at: string;
    expires_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    targetUserId: row.target_user_id,
    action: row.action,
    reason: row.reason,
    messageId: row.message_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

/* ---------- reports ---------- */

export function reportMessage(
  db: Database,
  reporterId: string,
  messageId: string,
  reason: string,
): { ok: true } | { ok: false; code: 'not_found' | 'invalid_reason' | 'already_reported' } {
  const row = db.prepare('SELECT user_id, deleted_at FROM community_messages WHERE id = ?').get(messageId) as
    | { user_id: string; deleted_at: string | null }
    | undefined;
  if (!row || row.deleted_at) return { ok: false, code: 'not_found' };
  const clean = REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number]) ? reason : 'other';
  const existing = db
    .prepare("SELECT 1 FROM community_reports WHERE reporter_id = ? AND message_id = ? AND status = 'open'")
    .get(reporterId, messageId);
  if (existing) return { ok: false, code: 'already_reported' };
  db.prepare(
    `INSERT INTO community_reports (reporter_id, message_id, target_user_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)`,
  ).run(reporterId, messageId, row.user_id, clean, nowIso());
  recordAudit(db, reporterId, 'report', { targetUserId: row.user_id, messageId, reason: clean });
  return { ok: true };
}

export type ReportEntry = {
  id: number;
  reporterId: string;
  reporterName: string;
  messageId: string | null;
  targetUserId: string | null;
  targetName: string | null;
  reason: string;
  status: string;
  createdAt: string;
};

export function listReports(db: Database, status = 'open', limit = 50): ReportEntry[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.reporter_id, r.message_id, r.target_user_id, r.reason, r.status, r.created_at,
              u.display_name AS reporter_name, t.display_name AS target_name
       FROM community_reports r
       LEFT JOIN users u ON u.id = r.reporter_id
       LEFT JOIN users t ON t.id = r.target_user_id
       WHERE (? = 'all' OR r.status = ?)
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .all(status, status, Math.min(Math.max(limit, 1), 100)) as Array<{
    id: number;
    reporter_id: string;
    message_id: string | null;
    target_user_id: string | null;
    reason: string;
    status: string;
    created_at: string;
    reporter_name: string | null;
    target_name: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name ?? '',
    messageId: row.message_id,
    targetUserId: row.target_user_id,
    targetName: row.target_name ?? '',
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function resolveReport(
  db: Database,
  actorId: string,
  reportId: number,
  action: 'resolved' | 'dismissed',
): { ok: true } | { ok: false; code: 'forbidden' | 'not_found' } {
  if (!isStaff(communityRole(db, actorId))) return { ok: false, code: 'forbidden' };
  const row = db.prepare('SELECT id, status FROM community_reports WHERE id = ?').get(reportId) as
    | { id: number; status: string }
    | undefined;
  if (!row) return { ok: false, code: 'not_found' };
  db.prepare('UPDATE community_reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?').run(
    action,
    nowIso(),
    actorId,
    reportId,
  );
  recordAudit(db, actorId, `report_${action}`, { messageId: null });
  return { ok: true };
}

/* ---------- settings ---------- */

export type CommunitySettings = { slowModeSeconds: number; maxMessageLength: number };

export function readCommunitySettings(db: Database): CommunitySettings {
  const rows = db.prepare('SELECT key, value FROM community_settings').all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((row) => [row.key, Number(row.value)]));
  return {
    slowModeSeconds: Number.isFinite(map.get('slowModeSeconds')) ? Number(map.get('slowModeSeconds')) : 0,
    maxMessageLength: Number.isFinite(map.get('maxMessageLength')) ? Number(map.get('maxMessageLength')) : DEFAULT_MAX_LENGTH,
  };
}

export function writeCommunitySettings(db: Database, actorId: string, input: Partial<CommunitySettings>): CommunitySettings {
  if (communityRole(db, actorId) !== 'owner') return readCommunitySettings(db);
  const at = nowIso();
  const write = db.prepare(
    `INSERT INTO community_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  if (input.slowModeSeconds !== undefined) write.run('slowModeSeconds', String(Math.min(Math.max(Math.round(input.slowModeSeconds), 0), 300)), at);
  if (input.maxMessageLength !== undefined) {
    write.run('maxMessageLength', String(Math.min(Math.max(Math.round(input.maxMessageLength), 100), 2000)), at);
  }
  recordAudit(db, actorId, 'settings', { reason: null });
  return readCommunitySettings(db);
}

/* ---------- broadcast ---------- */

export function publishCommunityMessage(message: CommunityMessageView): void {
  presenceStore.publishAll({ type: 'community_message', message, at: nowIso() });
}

export function publishCommunityMessageUpdate(message: CommunityMessageView): void {
  presenceStore.publishAll({ type: 'community_message_update', message, at: nowIso() });
}

export function publishCommunityMemberUpdate(userId: string, role: CommunityRole): void {
  presenceStore.publishAll({ type: 'community_member_update', userId, role, at: nowIso() });
}

export function publishCommunityModeration(action: string, targetUserId: string | null): void {
  presenceStore.publishAll({ type: 'community_moderation', action, targetUserId, at: nowIso() });
}
