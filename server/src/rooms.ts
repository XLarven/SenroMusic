/**
 * Listening rooms.
 *
 * The room is server-authoritative: a single `state_json` holds the current
 * track, the upcoming queue, the position at `updatedAt` and a revision counter.
 * Clients never stream seconds to each other — they extrapolate the position from
 * the timeline and only correct when drift crosses a threshold.
 *
 * Access, roles and queue permissions are resolved here, never trusted from the
 * client. Private rooms are invisible in listings and joining requires either the
 * join code or an existing invitation.
 */
import type { Database } from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type {
  RoomChatMessage,
  RoomMember,
  RoomQueueItem,
  RoomRole,
  RoomState,
  RoomSummary,
  RoomTrack,
} from './presence.js';
import { presenceStore } from './presence.js';
import { sanitizeBody } from './messages.js';

export const ROOM_NAME_MAX = 60;
export const ROOM_QUEUE_MAX = 100;
export const ROOM_MEMBER_MAX = 50;
export const ROOM_CHAT_MAX = 1000;
/** Owner is considered gone after this long with the room untouched. */
export const OWNER_STALE_MS = 5 * 60_000;

const TRACK_ID_RE = /^(yt_[\w-]{11}|sp_[\w-]{1,80}|t_[a-f0-9]{8,32}|presence_[\w-]{1,60})$/;
const ALLOWED_IMAGE_HOSTS = new Set([
  'i.ytimg.com',
  'i.scdn.co',
  'image-cdn-fa.spotifycdn.com',
  'cdn-images.dzcdn.net',
  'is1-ssl.mzstatic.com',
  'lh3.googleusercontent.com',
]);

export type RoomRow = {
  id: string;
  owner_id: string;
  name: string;
  visibility: 'public' | 'private';
  join_code: string | null;
  queue_mode: 'owner' | 'collab';
  state_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
  owner_seen_at: string;
  closed_at: string | null;
};

export type RoomAccess =
  | { ok: true; room: RoomRow; role: RoomRole }
  | { ok: false; code: 'not_found' | 'closed' | 'not_member' | 'blocked' };

function nowIso(): string {
  return new Date().toISOString();
}

function newRoomId(): string {
  return `rm_${randomBytes(8).toString('hex')}`;
}

function newCode(): string {
  // 8 chars, unambiguous alphabet.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function emptyState(): RoomState {
  return { current: null, queue: [], position: 0, playing: false, revision: 0, updatedAt: nowIso(), videoMode: false };
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/api/covers/')) return value.slice(0, 300);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function safeText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Client-submitted track metadata, validated to the same allowlist as DMs. */
export function normalizeRoomTrack(raw: unknown): RoomTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : typeof value.trackId === 'string' ? value.trackId : '';
  if (!TRACK_ID_RE.test(id)) return null;
  const title = safeText(value.title, 200);
  const artist = safeText(value.artist, 200);
  if (!title || !artist) return null;
  const duration = Number(value.duration);
  return {
    id,
    title,
    artist,
    album: safeText(value.album, 200),
    coverUrl: safeImageUrl(value.coverUrl),
    source: safeText(value.source, 40),
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
  };
}

export function isBlockedPair(db: Database, a: string, b: string): boolean {
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      )
      .get(a, b, b, a),
  );
}

function areFriends(db: Database, a: string, b: string): boolean {
  const row = db
    .prepare('SELECT status FROM friendships WHERE pair_key = ?')
    .get([a, b].sort().join(':')) as { status: string } | undefined;
  return row?.status === 'accepted';
}

/* ---------- state ---------- */

export function parseState(row: RoomRow): RoomState {
  try {
    const parsed = JSON.parse(row.state_json) as RoomState;
    if (!parsed || typeof parsed !== 'object') return emptyState();
    return {
      current: parsed.current ?? null,
      queue: Array.isArray(parsed.queue) ? parsed.queue.slice(0, ROOM_QUEUE_MAX) : [],
      position: Number.isFinite(parsed.position) ? Math.max(0, parsed.position) : 0,
      playing: Boolean(parsed.playing),
      videoMode: Boolean(parsed.videoMode),
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  } catch {
    return emptyState();
  }
}

function writeState(
  db: Database,
  roomId: string,
  state: Omit<RoomState, 'revision' | 'updatedAt' | 'videoMode'> & { videoMode?: boolean },
): RoomState {
  const at = nowIso();
  const row = db.prepare('SELECT revision, state_json FROM listening_rooms WHERE id = ?').get(roomId) as
    | { revision: number; state_json: string }
    | undefined;
  let previousVideo = false;
  try {
    previousVideo = Boolean((JSON.parse(row?.state_json ?? '{}') as { videoMode?: boolean }).videoMode);
  } catch {
    previousVideo = false;
  }
  const videoMode = state.videoMode ?? previousVideo;
  const revision = (row?.revision ?? 0) + 1;
  db.prepare(
    `UPDATE listening_rooms SET state_json = ?, revision = ?, updated_at = ?, owner_seen_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify({
      current: state.current,
      queue: state.queue,
      position: state.position,
      playing: state.playing,
      videoMode,
    }),
    revision,
    at,
    at,
    roomId,
  );
  return { ...state, videoMode, revision, updatedAt: at };
}

/* ---------- reads ---------- */

export function getRoomRow(db: Database, roomId: string): RoomRow | null {
  const row = db.prepare('SELECT * FROM listening_rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  return row ?? null;
}

export function listMembers(db: Database, roomId: string): RoomMember[] {
  const rows = db
    .prepare(
      `SELECT m.user_id, m.role, m.joined_at, u.display_name, u.username, u.avatar_url
       FROM room_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, m.joined_at ASC`,
    )
    .all(roomId) as Array<{
    user_id: string;
    role: RoomRole;
    joined_at: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
  }>;
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: row.joined_at,
  }));
}

export function roleOf(db: Database, roomId: string, userId: string): RoomRole | null {
  const row = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as
    | { role: RoomRole }
    | undefined;
  return row?.role ?? null;
}

export function canControl(role: RoomRole | null): boolean {
  return role === 'owner' || role === 'moderator';
}

export function canEditQueue(room: RoomRow, role: RoomRole | null): boolean {
  if (!role) return false;
  if (role === 'owner' || role === 'moderator') return true;
  return room.queue_mode === 'collab';
}

/** Membership, room state and block rules in one place. */
export function accessRoom(db: Database, roomId: string, userId: string): RoomAccess {
  const room = getRoomRow(db, roomId);
  if (!room) return { ok: false, code: 'not_found' };
  if (room.closed_at) return { ok: false, code: 'closed' };
  if (isBlockedPair(db, userId, room.owner_id)) return { ok: false, code: 'blocked' };
  const role = roleOf(db, roomId, userId);
  if (!role) return { ok: false, code: 'not_member' };
  return { ok: true, room, role };
}

export function memberIds(db: Database, roomId: string): string[] {
  return (db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(roomId) as Array<{ user_id: string }>).map(
    (row) => row.user_id,
  );
}

/* ---------- summaries ---------- */

export function toSummary(db: Database, room: RoomRow, invited = false): RoomSummary {
  const state = parseState(room);
  const owner = db.prepare('SELECT display_name FROM users WHERE id = ?').get(room.owner_id) as
    | { display_name: string }
    | undefined;
  const count = (db.prepare('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?').get(room.id) as { c: number }).c;
  return {
    id: room.id,
    name: room.name,
    visibility: room.visibility,
    queueMode: room.queue_mode,
    ownerId: room.owner_id,
    ownerName: owner?.display_name ?? '',
    memberCount: count,
    nowPlaying: state.current
      ? { title: state.current.track.title, artist: state.current.track.artist, coverUrl: state.current.track.coverUrl }
      : null,
    createdAt: room.created_at,
    updatedAt: room.updated_at,
    ...(invited ? { invited: true } : {}),
  };
}

export function listRooms(db: Database, viewerId: string, limit = 20, offset = 0): RoomSummary[] {
  const publicRows = db
    .prepare(
      `SELECT r.* FROM listening_rooms r
       JOIN room_members m ON m.room_id = r.id
       WHERE r.visibility = 'public' AND r.closed_at IS NULL
       GROUP BY r.id
       ORDER BY r.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as RoomRow[];
  return publicRows
    .filter((room) => !isBlockedPair(db, viewerId, room.owner_id))
    .map((room) => toSummary(db, room));
}

export function listMyRooms(db: Database, viewerId: string): RoomSummary[] {
  const rows = db
    .prepare(
      `SELECT r.* FROM listening_rooms r
       JOIN room_members m ON m.room_id = r.id AND m.user_id = ?
       WHERE r.closed_at IS NULL
       ORDER BY r.updated_at DESC`,
    )
    .all(viewerId) as RoomRow[];
  return rows.map((room) => toSummary(db, room));
}

export function listInvites(db: Database, userId: string): RoomSummary[] {
  const rows = db
    .prepare(
      `SELECT r.* FROM room_invites i
       JOIN listening_rooms r ON r.id = i.room_id
       WHERE i.user_id = ? AND r.closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = r.id AND m.user_id = ?)
       ORDER BY i.created_at DESC`,
    )
    .all(userId, userId) as RoomRow[];
  return rows
    .filter((room) => !isBlockedPair(db, userId, room.owner_id))
    .map((room) => toSummary(db, room, true));
}

/* ---------- lifecycle ---------- */

export function createRoom(
  db: Database,
  ownerId: string,
  input: { name?: unknown; visibility?: unknown; queueMode?: unknown },
): { ok: true; roomId: string } | { ok: false; code: 'invalid_name' | 'too_many_rooms' } {
  const name = safeText(input.name, ROOM_NAME_MAX);
  if (!name) return { ok: false, code: 'invalid_name' };
  const open = db
    .prepare('SELECT COUNT(*) AS c FROM listening_rooms WHERE owner_id = ? AND closed_at IS NULL')
    .get(ownerId) as { c: number };
  if (open.c >= 3) return { ok: false, code: 'too_many_rooms' };
  const visibility = input.visibility === 'private' ? 'private' : 'public';
  const queueMode = input.queueMode === 'collab' ? 'collab' : 'owner';
  const id = newRoomId();
  const at = nowIso();
  db.prepare(
    `INSERT INTO listening_rooms
       (id, owner_id, name, visibility, join_code, queue_mode, state_json, revision, created_at, updated_at, owner_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    id,
    ownerId,
    name,
    visibility,
    visibility === 'private' ? newCode() : null,
    queueMode,
    JSON.stringify(emptyState()),
    at,
    at,
    at,
  );
  db.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(
    id,
    ownerId,
    at,
  );
  return { ok: true, roomId: id };
}

export type JoinResult =
  | { ok: true; roomId: string; alreadyMember: boolean }
  | { ok: false; code: 'not_found' | 'closed' | 'blocked' | 'invite_required' | 'full' };

export function joinRoom(db: Database, userId: string, roomId: string, code?: string | null): JoinResult {
  const room = getRoomRow(db, roomId);
  if (!room) return { ok: false, code: 'not_found' };
  if (room.closed_at) return { ok: false, code: 'closed' };
  if (isBlockedPair(db, userId, room.owner_id)) return { ok: false, code: 'blocked' };
  const existing = roleOf(db, roomId, userId);
  if (existing) return { ok: true, roomId, alreadyMember: true };
  if (room.visibility === 'private') {
    const invited = db
      .prepare('SELECT 1 FROM room_invites WHERE room_id = ? AND user_id = ?')
      .get(roomId, userId);
    const codeOk = typeof code === 'string' && room.join_code && code.toUpperCase() === room.join_code;
    if (!invited && !codeOk) return { ok: false, code: 'invite_required' };
  }
  const count = (db.prepare('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?').get(roomId) as { c: number }).c;
  if (count >= ROOM_MEMBER_MAX) return { ok: false, code: 'full' };
  db.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'listener', ?)").run(
    roomId,
    userId,
    nowIso(),
  );
  db.prepare('DELETE FROM room_invites WHERE room_id = ? AND user_id = ?').run(roomId, userId);
  return { ok: true, roomId, alreadyMember: false };
}

function transferOwnership(db: Database, roomId: string, newOwnerId: string): void {
  const at = nowIso();
  db.prepare("UPDATE room_members SET role = 'listener' WHERE room_id = ? AND role = 'owner'").run(roomId);
  db.prepare("UPDATE room_members SET role = 'owner' WHERE room_id = ? AND user_id = ?").run(roomId, newOwnerId);
  db.prepare('UPDATE listening_rooms SET owner_id = ?, owner_seen_at = ?, updated_at = ? WHERE id = ?').run(
    newOwnerId,
    at,
    at,
    roomId,
  );
}

function pickSuccessor(db: Database, roomId: string, exclude: string): string | null {
  const row = db
    .prepare(
      `SELECT user_id FROM room_members
       WHERE room_id = ? AND user_id <> ?
       ORDER BY CASE role WHEN 'moderator' THEN 0 ELSE 1 END, joined_at ASC
       LIMIT 1`,
    )
    .get(roomId, exclude) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

export function leaveRoom(db: Database, roomId: string, userId: string): { closed: boolean; newOwnerId: string | null } {
  const role = roleOf(db, roomId, userId);
  if (!role) return { closed: false, newOwnerId: null };
  db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, userId);
  const remaining = memberIds(db, roomId);
  if (remaining.length === 0) {
    db.prepare('UPDATE listening_rooms SET closed_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), roomId);
    return { closed: true, newOwnerId: null };
  }
  if (role === 'owner') {
    const successor = pickSuccessor(db, roomId, userId);
    if (successor) {
      transferOwnership(db, roomId, successor);
      return { closed: false, newOwnerId: successor };
    }
  }
  return { closed: false, newOwnerId: null };
}

export function closeRoom(db: Database, roomId: string, ownerId: string): boolean {
  const room = getRoomRow(db, roomId);
  if (!room || room.owner_id !== ownerId || room.closed_at) return false;
  const at = nowIso();
  db.prepare('UPDATE listening_rooms SET closed_at = ?, updated_at = ? WHERE id = ?').run(at, at, roomId);
  db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
  db.prepare('DELETE FROM room_invites WHERE room_id = ?').run(roomId);
  return true;
}

export function updateRoom(
  db: Database,
  roomId: string,
  ownerId: string,
  input: { name?: unknown; visibility?: unknown; queueMode?: unknown },
): RoomRow | null {
  const room = getRoomRow(db, roomId);
  if (!room || room.owner_id !== ownerId || room.closed_at) return null;
  const name = input.name === undefined ? room.name : safeText(input.name, ROOM_NAME_MAX) ?? room.name;
  const visibility =
    input.visibility === 'private' ? 'private' : input.visibility === 'public' ? 'public' : room.visibility;
  const queueMode = input.queueMode === 'collab' ? 'collab' : input.queueMode === 'owner' ? 'owner' : room.queue_mode;
  const joinCode = visibility === 'private' ? (room.join_code ?? newCode()) : null;
  db.prepare(
    `UPDATE listening_rooms SET name = ?, visibility = ?, queue_mode = ?, join_code = ?, updated_at = ?
     WHERE id = ?`,
  ).run(name, visibility, queueMode, joinCode, nowIso(), roomId);
  return getRoomRow(db, roomId);
}

/* ---------- roles ---------- */

export type MemberActionResult = { ok: true } | { ok: false; code: 'forbidden' | 'not_found' | 'owner' };

export function setMemberRole(
  db: Database,
  roomId: string,
  actorId: string,
  targetId: string,
  role: 'moderator' | 'listener',
): MemberActionResult {
  const room = getRoomRow(db, roomId);
  if (!room) return { ok: false, code: 'not_found' };
  if (room.owner_id !== actorId) return { ok: false, code: 'forbidden' };
  if (!roleOf(db, roomId, targetId)) return { ok: false, code: 'not_found' };
  if (targetId === room.owner_id) return { ok: false, code: 'owner' };
  db.prepare('UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?').run(role, roomId, targetId);
  return { ok: true };
}

export function kickMember(
  db: Database,
  roomId: string,
  actorId: string,
  targetId: string,
): MemberActionResult {
  const actorRole = roleOf(db, roomId, actorId);
  const targetRole = roleOf(db, roomId, targetId);
  if (!actorRole || !targetRole) return { ok: false, code: 'not_found' };
  if (targetRole === 'owner') return { ok: false, code: 'owner' };
  if (actorRole === 'listener') return { ok: false, code: 'forbidden' };
  if (actorRole === 'moderator' && targetRole === 'moderator') return { ok: false, code: 'forbidden' };
  db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, targetId);
  return { ok: true };
}

export function inviteToRoom(
  db: Database,
  roomId: string,
  inviterId: string,
  targetId: string,
): { ok: true } | { ok: false; code: 'forbidden' | 'not_friend' | 'blocked' | 'not_found' } {
  const room = getRoomRow(db, roomId);
  if (!room || room.closed_at) return { ok: false, code: 'not_found' };
  if (!roleOf(db, roomId, inviterId)) return { ok: false, code: 'forbidden' };
  if (isBlockedPair(db, targetId, room.owner_id)) return { ok: false, code: 'blocked' };
  if (roleOf(db, roomId, targetId)) return { ok: true };
  if (!areFriends(db, inviterId, targetId) && !areFriends(db, room.owner_id, targetId)) {
    return { ok: false, code: 'not_friend' };
  }
  db.prepare(
    `INSERT INTO room_invites (room_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(roomId, targetId, inviterId, nowIso());
  return { ok: true };
}

/* ---------- playback ---------- */

export type PlaybackInput = {
  action: 'play' | 'pause' | 'seek' | 'next' | 'play-track' | 'video';
  position?: unknown;
  track?: unknown;
  enabled?: unknown;
};

function clampPosition(state: RoomState, position: number): number {
  const duration = state.current?.track.duration ?? null;
  const max = duration && duration > 0 ? duration : 86_400;
  return Math.max(0, Math.min(position, max));
}

export function applyPlayback(
  db: Database,
  roomId: string,
  userId: string,
  input: PlaybackInput,
): { ok: true; state: RoomState } | { ok: false; code: 'forbidden' | 'not_found' | 'invalid_track' | 'empty' } {
  const access = accessRoom(db, roomId, userId);
  if (!access.ok) return { ok: false, code: 'not_found' };
  if (!canControl(access.role)) return { ok: false, code: 'forbidden' };
  const state = parseState(access.room);
  const position = Number(input.position);

  if (input.action === 'play') {
    const next = writeState(db, roomId, {
      current: state.current,
      queue: state.queue,
      position: Number.isFinite(position) ? clampPosition(state, position) : state.position,
      playing: Boolean(state.current),
    });
    return { ok: true, state: next };
  }
  if (input.action === 'pause') {
    const next = writeState(db, roomId, {
      current: state.current,
      queue: state.queue,
      position: Number.isFinite(position) ? clampPosition(state, position) : state.position,
      playing: false,
    });
    return { ok: true, state: next };
  }
  if (input.action === 'seek') {
    if (!Number.isFinite(position)) return { ok: false, code: 'not_found' };
    const next = writeState(db, roomId, {
      current: state.current,
      queue: state.queue,
      position: clampPosition(state, position),
      playing: state.playing,
    });
    return { ok: true, state: next };
  }
  if (input.action === 'video') {
    const next = writeState(db, roomId, {
      current: state.current,
      queue: state.queue,
      position: state.position,
      playing: state.playing,
      videoMode: Boolean(input.enabled),
    });
    return { ok: true, state: next };
  }
  if (input.action === 'next') {
    const [head, ...rest] = state.queue;
    if (!head) return { ok: false, code: 'empty' };
    const next = writeState(db, roomId, {
      current: head,
      queue: rest,
      position: 0,
      playing: true,
    });
    return { ok: true, state: next };
  }
  // play-track
  const track = normalizeRoomTrack(input.track);
  if (!track) return { ok: false, code: 'invalid_track' };
  const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as
    | { display_name: string }
    | undefined;
  const next = writeState(db, roomId, {
    current: { track, addedBy: userId, addedByName: name?.display_name ?? null },
    queue: state.queue,
    position: 0,
    playing: true,
    // Video mode only survives if the new track can actually be watched.
    videoMode: state.videoMode && track.id.startsWith('yt_'),
  });
  return { ok: true, state: next };
}

/* ---------- queue ---------- */

export function addToQueue(
  db: Database,
  roomId: string,
  userId: string,
  rawTrack: unknown,
): { ok: true; state: RoomState; atFront: boolean } | { ok: false; code: 'forbidden' | 'invalid_track' | 'full' } {
  const access = accessRoom(db, roomId, userId);
  if (!access.ok) return { ok: false, code: 'forbidden' };
  if (!canEditQueue(access.room, access.role)) return { ok: false, code: 'forbidden' };
  const track = normalizeRoomTrack(rawTrack);
  if (!track) return { ok: false, code: 'invalid_track' };
  const state = parseState(access.room);
  const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as
    | { display_name: string }
    | undefined;
  const item: RoomQueueItem = { track, addedBy: userId, addedByName: name?.display_name ?? null };
  if (!state.current) {
    const next = writeState(db, roomId, { current: item, queue: state.queue, position: 0, playing: true });
    return { ok: true, state: next, atFront: true };
  }
  if (state.queue.length >= ROOM_QUEUE_MAX) return { ok: false, code: 'full' };
  const next = writeState(db, roomId, {
    current: state.current,
    queue: [...state.queue, item],
    position: state.position,
    playing: state.playing,
  });
  return { ok: true, state: next, atFront: false };
}

export function removeFromQueue(
  db: Database,
  roomId: string,
  userId: string,
  index: number,
): { ok: true; state: RoomState } | { ok: false; code: 'forbidden' | 'invalid_index' } {
  const access = accessRoom(db, roomId, userId);
  if (!access.ok) return { ok: false, code: 'forbidden' };
  if (!canEditQueue(access.room, access.role)) return { ok: false, code: 'forbidden' };
  const state = parseState(access.room);
  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) {
    return { ok: false, code: 'invalid_index' };
  }
  const queue = state.queue.filter((_, itemIndex) => itemIndex !== index);
  const next = writeState(db, roomId, {
    current: state.current,
    queue,
    position: state.position,
    playing: state.playing,
  });
  return { ok: true, state: next };
}

export function reorderQueue(
  db: Database,
  roomId: string,
  userId: string,
  from: number,
  to: number,
): { ok: true; state: RoomState } | { ok: false; code: 'forbidden' | 'invalid_index' } {
  const access = accessRoom(db, roomId, userId);
  if (!access.ok) return { ok: false, code: 'forbidden' };
  if (!canEditQueue(access.room, access.role)) return { ok: false, code: 'forbidden' };
  const state = parseState(access.room);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= state.queue.length) {
    return { ok: false, code: 'invalid_index' };
  }
  if (to < 0 || to >= state.queue.length) return { ok: false, code: 'invalid_index' };
  const queue = [...state.queue];
  const [moved] = queue.splice(from, 1);
  if (!moved) return { ok: false, code: 'invalid_index' };
  queue.splice(to, 0, moved);
  const next = writeState(db, roomId, {
    current: state.current,
    queue,
    position: state.position,
    playing: state.playing,
  });
  return { ok: true, state: next };
}

/* ---------- chat ---------- */

export function listRoomMessages(
  db: Database,
  roomId: string,
  limit = 40,
  before?: string | null,
): RoomChatMessage[] {
  const safeLimit = Math.min(Math.max(limit, 1), 80);
  const rows = before
    ? (db
        .prepare(
          `SELECT * FROM room_messages WHERE room_id = ? AND created_at < ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(roomId, before, safeLimit) as Array<RoomMessageRow>)
    : (db
        .prepare(
          `SELECT * FROM room_messages WHERE room_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(roomId, safeLimit) as Array<RoomMessageRow>);
  return rows.reverse().map(toRoomMessage);
}

type RoomMessageRow = {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

function toRoomMessage(row: RoomMessageRow): RoomChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    body: row.deleted_at ? '' : row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export function postRoomMessage(
  db: Database,
  roomId: string,
  userId: string,
  raw: unknown,
): { ok: true; message: RoomChatMessage } | { ok: false; code: 'empty' | 'forbidden' } {
  const access = accessRoom(db, roomId, userId);
  if (!access.ok) return { ok: false, code: 'forbidden' };
  const body = sanitizeBody(raw);
  if (!body) return { ok: false, code: 'empty' };
  const id = `rmm_${randomBytes(8).toString('hex')}`;
  const at = nowIso();
  db.prepare('INSERT INTO room_messages (id, room_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    roomId,
    userId,
    body.slice(0, ROOM_CHAT_MAX),
    at,
  );
  db.prepare('UPDATE listening_rooms SET updated_at = ? WHERE id = ?').run(at, roomId);
  return {
    ok: true,
    message: { id, roomId, userId, body: body.slice(0, ROOM_CHAT_MAX), createdAt: at, deletedAt: null },
  };
}

export function deleteRoomMessage(
  db: Database,
  roomId: string,
  userId: string,
  messageId: string,
): RoomChatMessage | null {
  const access = accessRoom(db, roomId, userId);
  if (!access.ok) return null;
  const row = db
    .prepare('SELECT * FROM room_messages WHERE id = ? AND room_id = ?')
    .get(messageId, roomId) as RoomMessageRow | undefined;
  if (!row || row.deleted_at) return null;
  const staff = access.role === 'owner' || access.role === 'moderator';
  if (row.user_id !== userId && !staff) return null;
  const at = nowIso();
  db.prepare('UPDATE room_messages SET deleted_at = ?, deleted_by = ?, body = ? WHERE id = ?').run(
    at,
    userId,
    '',
    messageId,
  );
  const updated = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(messageId) as RoomMessageRow;
  return toRoomMessage(updated);
}

/* ---------- broadcast ---------- */

export function publishRoomState(db: Database, roomId: string, state: RoomState): void {
  presenceStore.publish(memberIds(db, roomId), {
    type: 'room_state',
    roomId,
    state,
    at: nowIso(),
  });
}

export function publishRoomMembers(db: Database, roomId: string): void {
  presenceStore.publish(memberIds(db, roomId), {
    type: 'room_members',
    roomId,
    members: listMembers(db, roomId),
    at: nowIso(),
  });
}

export function publishRoomChat(db: Database, roomId: string, message: RoomChatMessage): void {
  presenceStore.publish(memberIds(db, roomId), {
    type: 'room_chat',
    roomId,
    message,
    at: nowIso(),
  });
}

export function publishRoomInvite(userId: string, room: RoomSummary): void {
  presenceStore.publish([userId], { type: 'room_invite', room, at: nowIso() });
}

export function publishRoomClosed(db: Database, roomId: string, reason: string): void {
  presenceStore.publish(memberIds(db, roomId), {
    type: 'room_closed',
    roomId,
    reason,
    at: nowIso(),
  });
}

/* ---------- housekeeping ---------- */

/**
 * Closes empty rooms and hands ownership over when the owner has been gone long
 * enough. Runs on a timer; never touches rooms that still have an active owner.
 */
export function sweepRooms(db: Database, now = Date.now()): string[] {
  const touched: string[] = [];
  const rows = db.prepare('SELECT * FROM listening_rooms WHERE closed_at IS NULL').all() as RoomRow[];
  for (const room of rows) {
    const members = memberIds(db, room.id);
    if (members.length === 0) {
      db.prepare('UPDATE listening_rooms SET closed_at = ?, updated_at = ? WHERE id = ?').run(
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        room.id,
      );
      touched.push(room.id);
      continue;
    }
    if (!members.includes(room.owner_id)) {
      const successor = pickSuccessor(db, room.id, room.owner_id);
      if (successor) {
        transferOwnership(db, room.id, successor);
        publishRoomMembers(db, room.id);
        touched.push(room.id);
      }
      continue;
    }
    const stale = now - Date.parse(room.owner_seen_at) > OWNER_STALE_MS;
    const ownerOnline = presenceStore.status(room.owner_id, now) !== 'offline';
    if (stale && !ownerOnline) {
      if (members.length > 1) {
        const successor = pickSuccessor(db, room.id, room.owner_id);
        if (successor) {
          transferOwnership(db, room.id, successor);
          publishRoomMembers(db, room.id);
          touched.push(room.id);
        }
      } else {
        // The owner abandoned a room nobody else joined: close it quietly.
        db.prepare('UPDATE listening_rooms SET closed_at = ?, updated_at = ? WHERE id = ?').run(
          new Date(now).toISOString(),
          new Date(now).toISOString(),
          room.id,
        );
        db.prepare('DELETE FROM room_members WHERE room_id = ?').run(room.id);
        touched.push(room.id);
      }
    }
  }
  return touched;
}

/** Confirms the two accounts may share a room at all. */
export function canShareRoom(db: Database, a: string, b: string): boolean {
  return !isBlockedPair(db, a, b);
}
