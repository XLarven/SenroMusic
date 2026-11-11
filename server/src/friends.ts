/**
 * Friendship core.
 *
 * Every function takes the database handle so the logic can be tested against an
 * in-memory schema. Nothing here trusts a status or a pair supplied by a client:
 * the pair key, the direction and the state transitions are all derived from the
 * authenticated owner plus the row in the database.
 */
import type { Database } from 'better-sqlite3';

export type FriendshipState = 'none' | 'self' | 'pending_out' | 'pending_in' | 'friends' | 'blocked';

export type RelationshipView = {
  state: FriendshipState;
  /** Friendship row id for pending requests / accepted friendships. */
  requestId: number | null;
  /** True when the viewer blocked the other account. */
  blockedByMe: boolean;
  /** True when the other account blocked the viewer. */
  blockedMe: boolean;
};

export type FriendUser = {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
};

export type FriendEntry = {
  friendshipId: number;
  user: FriendUser;
  since: string;
};

export type FriendRequestEntry = {
  friendshipId: number;
  user: FriendUser;
  createdAt: string;
};

export type FriendListResult = {
  items: FriendUser[];
  total: number;
  limit: number;
  offset: number;
};

type UserRowLike = {
  id: string;
  username?: string | null;
  display_name: string;
  avatar_url?: string | null;
  bio?: string | null;
  profile_visibility?: string | null;
};

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function now(): string {
  return new Date().toISOString();
}

function toFriendUser(row: UserRowLike): FriendUser {
  return {
    id: row.id,
    username: row.username ?? null,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
  };
}

/** True when the target account is visible to `viewerId`. */
export function canViewUser(db: Database, viewerId: string, targetId: string): boolean {
  const row = db
    .prepare('SELECT id, profile_visibility FROM users WHERE id = ?')
    .get(targetId) as { id: string; profile_visibility: string | null } | undefined;
  if (!row) return false;
  if (targetId === viewerId) return true;
  return (row.profile_visibility ?? 'public') !== 'private';
}

export function isBlockedEitherWay(db: Database, a: string, b: string): { byMe: boolean; byThem: boolean } {
  const mine = db
    .prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?')
    .get(a, b);
  const theirs = db
    .prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?')
    .get(b, a);
  return { byMe: Boolean(mine), byThem: Boolean(theirs) };
}

type FriendshipRow = {
  id: number;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
};

function findFriendship(db: Database, a: string, b: string): FriendshipRow | undefined {
  return db
    .prepare('SELECT id, requester_id, addressee_id, status, created_at FROM friendships WHERE pair_key = ?')
    .get(pairKey(a, b)) as FriendshipRow | undefined;
}

export function getRelationship(db: Database, viewerId: string, targetId: string): RelationshipView {
  const blocked = isBlockedEitherWay(db, viewerId, targetId);
  if (targetId === viewerId) {
    return { state: 'self', requestId: null, blockedByMe: blocked.byMe, blockedMe: blocked.byThem };
  }
  if (blocked.byMe || blocked.byThem) {
    return { state: 'blocked', requestId: null, blockedByMe: blocked.byMe, blockedMe: blocked.byThem };
  }
  const row = findFriendship(db, viewerId, targetId);
  if (!row) {
    return { state: 'none', requestId: null, blockedByMe: false, blockedMe: false };
  }
  if (row.status === 'accepted') {
    return { state: 'friends', requestId: row.id, blockedByMe: false, blockedMe: false };
  }
  return {
    state: row.requester_id === viewerId ? 'pending_out' : 'pending_in',
    requestId: row.id,
    blockedByMe: false,
    blockedMe: false,
  };
}

type ActionResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export type SendResult = { requestId: number; autoAccepted: boolean };

/**
 * Creates a request, or accepts the mirrored request when the other side already
 * asked first. Self-friending, duplicates and blocked pairs are refused.
 */
export function sendRequest(db: Database, requesterId: string, targetId: string): ActionResult<SendResult> {
  if (requesterId === targetId) return { ok: false, code: 'self', message: 'Kendine istek gönderemezsin.' };
  if (!canViewUser(db, requesterId, targetId)) {
    return { ok: false, code: 'not_found', message: 'Kullanıcı bulunamadı.' };
  }
  const blocked = isBlockedEitherWay(db, requesterId, targetId);
  if (blocked.byMe || blocked.byThem) {
    return { ok: false, code: 'blocked', message: 'Bu kullanıcıyla etkileşim kapalı.' };
  }

  const existing = findFriendship(db, requesterId, targetId);
  if (existing) {
    if (existing.status === 'accepted') {
      return { ok: false, code: 'already_friends', message: 'Zaten arkadaşsınız.' };
    }
    if (existing.requester_id === requesterId) {
      return { ok: false, code: 'already_requested', message: 'İstek zaten gönderildi.' };
    }
    // The other side asked first: accept instead of creating the mirror row.
    const accepted = acceptRequest(db, requesterId, existing.id);
    if (!accepted.ok) return accepted;
    return { ok: true, value: { requestId: existing.id, autoAccepted: true } };
  }

  const timestamp = now();
  const info = db
    .prepare(
      `INSERT INTO friendships (requester_id, addressee_id, pair_key, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .run(requesterId, targetId, pairKey(requesterId, targetId), timestamp, timestamp);
  return { ok: true, value: { requestId: Number(info.lastInsertRowid), autoAccepted: false } };
}

/** Accept an incoming request. Owner-checked and status-checked in one statement. */
export function acceptRequest(db: Database, userId: string, requestId: number): ActionResult<{ requesterId: string }> {
  const apply = db.transaction(() => {
    const row = db
      .prepare('SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = ?')
      .get(requestId) as FriendshipRow | undefined;
    if (!row) return { ok: false as const, code: 'not_found', message: 'İstek bulunamadı.' };
    if (row.addressee_id !== userId) {
      return { ok: false as const, code: 'forbidden', message: 'Bu istek sana ait değil.' };
    }
    if (row.status === 'accepted') {
      return { ok: false as const, code: 'already_friends', message: 'Bu istek zaten kabul edilmiş.' };
    }
    // Compare-and-set: two simultaneous accepts cannot both win.
    const result = db
      .prepare(
        `UPDATE friendships SET status = 'accepted', updated_at = ?
         WHERE id = ? AND addressee_id = ? AND status = 'pending'`,
      )
      .run(now(), requestId, userId);
    if (result.changes !== 1) {
      return { ok: false as const, code: 'conflict', message: 'İstek durumu değişti; yenile.' };
    }
    return { ok: true as const, value: { requesterId: row.requester_id } };
  });
  return apply();
}

/** Addressee declines an incoming request. */
export function declineRequest(db: Database, userId: string, requestId: number): ActionResult<{ requesterId: string }> {
  const row = db
    .prepare('SELECT requester_id, addressee_id, status FROM friendships WHERE id = ?')
    .get(requestId) as FriendshipRow | undefined;
  if (!row) return { ok: false, code: 'not_found', message: 'İstek bulunamadı.' };
  if (row.addressee_id !== userId) return { ok: false, code: 'forbidden', message: 'Bu istek sana ait değil.' };
  const result = db
    .prepare(`DELETE FROM friendships WHERE id = ? AND addressee_id = ? AND status = 'pending'`)
    .run(requestId, userId);
  if (result.changes !== 1) return { ok: false, code: 'conflict', message: 'İstek bulunamadı.' };
  return { ok: true, value: { requesterId: row.requester_id } };
}

/** Requester cancels their own outgoing request. */
export function cancelRequest(db: Database, userId: string, requestId: number): ActionResult<{ addresseeId: string }> {
  const row = db
    .prepare('SELECT requester_id, addressee_id, status FROM friendships WHERE id = ?')
    .get(requestId) as FriendshipRow | undefined;
  if (!row) return { ok: false, code: 'not_found', message: 'İstek bulunamadı.' };
  if (row.requester_id !== userId) return { ok: false, code: 'forbidden', message: 'Bu istek sana ait değil.' };
  const result = db
    .prepare(`DELETE FROM friendships WHERE id = ? AND requester_id = ? AND status = 'pending'`)
    .run(requestId, userId);
  if (result.changes !== 1) return { ok: false, code: 'conflict', message: 'İstek bulunamadı.' };
  return { ok: true, value: { addresseeId: row.addressee_id } };
}

/** Remove an accepted friendship from either side. */
export function removeFriend(db: Database, userId: string, otherId: string): ActionResult<{ removed: boolean }> {
  const row = findFriendship(db, userId, otherId);
  if (!row || row.status !== 'accepted') {
    return { ok: false, code: 'not_friends', message: 'Arkadaşlık bulunamadı.' };
  }
  const result = db
    .prepare(
      `DELETE FROM friendships
       WHERE id = ? AND status = 'accepted'
         AND (requester_id IN (?, ?) AND addressee_id IN (?, ?))`,
    )
    .run(row.id, userId, otherId, userId, otherId);
  if (result.changes !== 1) return { ok: false, code: 'conflict', message: 'Arkadaşlık bulunamadı.' };
  return { ok: true, value: { removed: true } };
}

function clampPaging(limit: number | undefined, offset: number | undefined): { limit: number; offset: number } {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit as number), 1), 50) : 20;
  const safeOffset = Number.isFinite(offset) ? Math.max(Math.trunc(offset as number), 0) : 0;
  return { limit: safeLimit, offset: safeOffset };
}

/**
 * Friends of `userId`, newest first. Blocked accounts are filtered out of both
 * directions so a blocked user disappears from the list immediately.
 */
export function listFriends(
  db: Database,
  userId: string,
  limit?: number,
  offset?: number,
): FriendListResult {
  const paging = clampPaging(limit, offset);
  const rows = db
    .prepare(
      `SELECT f.id AS friendship_id, f.updated_at AS since,
              u.id, u.username, u.display_name, u.avatar_url, u.bio
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = ?)
         )
       ORDER BY f.updated_at DESC, f.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, userId, userId, userId, paging.limit, paging.offset) as Array<
    UserRowLike & { friendship_id: number; since: string }
  >;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM friendships f
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END)
              OR (b.blocker_id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END AND b.blocked_id = ?)
         )`,
    )
    .get(userId, userId, userId, userId, userId, userId) as { c: number };

  return {
    items: rows.map(toFriendUser),
    total: totalRow.c,
    limit: paging.limit,
    offset: paging.offset,
  };
}

export function listRequests(
  db: Database,
  userId: string,
  direction: 'in' | 'out',
  limit?: number,
  offset?: number,
): { items: FriendRequestEntry[]; total: number; limit: number; offset: number } {
  const paging = clampPaging(limit, offset);
  const ownerColumn = direction === 'in' ? 'addressee_id' : 'requester_id';
  const otherColumn = direction === 'in' ? 'requester_id' : 'addressee_id';

  const rows = db
    .prepare(
      `SELECT f.id AS friendship_id, f.created_at,
              u.id, u.username, u.display_name, u.avatar_url, u.bio
       FROM friendships f
       JOIN users u ON u.id = f.${otherColumn}
       WHERE f.${ownerColumn} = ? AND f.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = ?)
         )
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, userId, paging.limit, paging.offset) as Array<
    UserRowLike & { friendship_id: number; created_at: string }
  >;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM friendships
       WHERE ${ownerColumn} = ? AND status = 'pending'`,
    )
    .get(userId) as { c: number };

  return {
    items: rows.map((row) => ({
      friendshipId: row.friendship_id,
      user: toFriendUser(row),
      createdAt: row.created_at,
    })),
    total: totalRow.c,
    limit: paging.limit,
    offset: paging.offset,
  };
}

export function friendCounts(db: Database, userId: string): { friends: number; incoming: number; outgoing: number } {
  const friends = listFriends(db, userId, 1, 0).total;
  const incoming = (db
    .prepare(`SELECT COUNT(*) AS c FROM friendships WHERE addressee_id = ? AND status = 'pending'`)
    .get(userId) as { c: number }).c;
  const outgoing = (db
    .prepare(`SELECT COUNT(*) AS c FROM friendships WHERE requester_id = ? AND status = 'pending'`)
    .get(userId) as { c: number }).c;
  return { friends, incoming, outgoing };
}

/* ---------- blocks ---------- */

export function blockUser(db: Database, blockerId: string, targetId: string): ActionResult<{ blocked: true }> {
  if (blockerId === targetId) return { ok: false, code: 'self', message: 'Kendini engelleyemezsin.' };
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId);
  if (!exists) return { ok: false, code: 'not_found', message: 'Kullanıcı bulunamadı.' };

  const apply = db.transaction(() => {
    db.prepare(
      `INSERT INTO user_blocks (blocker_id, blocked_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    ).run(blockerId, targetId, now());
    // A block ends any friendship or pending request in either direction.
    db.prepare('DELETE FROM friendships WHERE pair_key = ?').run(pairKey(blockerId, targetId));
  });
  apply();
  return { ok: true, value: { blocked: true } };
}

export function unblockUser(db: Database, blockerId: string, targetId: string): ActionResult<{ blocked: false }> {
  db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, targetId);
  return { ok: true, value: { blocked: false } };
}

export function listBlocks(db: Database, userId: string): FriendUser[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio
       FROM user_blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
    )
    .all(userId) as UserRowLike[];
  return rows.map(toFriendUser);
}

/* ---------- notifications ---------- */

export type NotificationRow = {
  id: number;
  kind: string;
  actorId: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Writes a notification once per dedupe key, so a repeated accept or a retried
 * request cannot create duplicates.
 */
export function pushNotification(
  db: Database,
  input: { userId: string; kind: string; actorId?: string | null; entityId?: string | null; dedupeKey?: string | null },
): void {
  if (input.userId === input.actorId) return;
  db.prepare(
    `INSERT INTO notifications (user_id, kind, actor_id, entity_id, dedupe_key, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT DO NOTHING`,
  ).run(
    input.userId,
    input.kind,
    input.actorId ?? null,
    input.entityId ?? null,
    input.dedupeKey ?? null,
    now(),
  );
}

export function listNotifications(
  db: Database,
  userId: string,
  limit = 30,
  offset = 0,
): { items: Array<NotificationRow & { actor: FriendUser | null }>; total: number; unread: number } {
  const paging = clampPaging(limit, offset);
  const rows = db
    .prepare(
      `SELECT n.id, n.kind, n.actor_id, n.entity_id AS entity_id, n.read_at, n.created_at,
              u.id AS uid, u.username, u.display_name, u.avatar_url, u.bio
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, paging.limit, paging.offset) as Array<{
    id: number;
    kind: string;
    actor_id: string | null;
    entity_id: string | null;
    read_at: string | null;
    created_at: string;
    uid: string | null;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
  }>;

  const total = (db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?').get(userId) as { c: number }).c;
  const unread = (
    db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { c: number }
  ).c;

  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actorId: row.actor_id,
      entityId: row.entity_id,
      readAt: row.read_at,
      createdAt: row.created_at,
      actor:
        row.uid && row.display_name
          ? {
              id: row.uid,
              username: row.username,
              displayName: row.display_name,
              avatarUrl: row.avatar_url,
              bio: row.bio,
            }
          : null,
    })),
    total,
    unread,
  };
}

export function markNotificationsRead(db: Database, userId: string, ids?: number[]): void {
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${placeholders}) AND read_at IS NULL`).run(
      now(),
      userId,
      ...ids,
    );
    return;
  }
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), userId);
}
