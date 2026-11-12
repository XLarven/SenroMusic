/**
 * Presence + listening activity.
 *
 * Presence is aggregated from real sessions: a user is online while at least one
 * session heartbeats inside the window, away when every session went quiet but
 * not long enough to expire, offline after the timeout. Activity is the newest
 * playback event across sessions, so a paused tab cannot override the device the
 * user actually started a song on.
 *
 * Nothing here trusts a client for identity or privacy: the caller passes the
 * authenticated user id, and the privacy settings are read from the database.
 */
import type { Database } from 'better-sqlite3';
import { listFriends } from './friends.js';

export type PresenceStatus = 'online' | 'away' | 'offline';

export type ActivitySnapshot = {
  trackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  source: string | null;
  duration: number | null;
  position: number;
  playing: boolean;
  updatedAt: string;
};

export type PresenceSettings = {
  presenceVisible: boolean;
  lastSeenVisible: boolean;
  activityVisible: boolean;
  invisible: boolean;
};

export type FriendPresence = {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
  activity: ActivitySnapshot | null;
};

export const DEFAULT_PRESENCE_SETTINGS: PresenceSettings = {
  presenceVisible: true,
  lastSeenVisible: true,
  activityVisible: true,
  invisible: false,
};

/** A session that misses this many ms is considered away. */
export const AWAY_AFTER_MS = 75_000;
/** A session that misses this many ms no longer keeps the user online. */
export const OFFLINE_AFTER_MS = 180_000;
/** Playback older than this is dropped, so a finished song does not linger. */
export const ACTIVITY_TTL_MS = 12 * 60_000;

type Session = {
  lastBeat: number;
  away: boolean;
  activity: ActivitySnapshot | null;
  activityAt: number;
};

export type PresenceEvent =
  | { type: 'presence'; userId: string; status: PresenceStatus; lastSeenAt: string | null; at: string }
  | { type: 'activity'; userId: string; activity: ActivitySnapshot | null; at: string };

export type MessageAttachment = {
  kind: 'track' | 'playlist' | 'profile';
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  trackId?: string | null;
  playlistId?: string | null;
  userId?: string | null;
  source?: string | null;
};

export type MessageView = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachment: MessageAttachment | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientId: string | null;
};

export type RealtimeEvent =
  | PresenceEvent
  | { type: 'message'; conversationId: string; message: MessageView; at: string }
  | { type: 'message_update'; conversationId: string; message: MessageView; at: string }
  | { type: 'typing'; conversationId: string; userId: string; typing: boolean; at: string }
  | { type: 'read'; conversationId: string; userId: string; messageId: string | null; at: string }
  | { type: 'room_state'; roomId: string; state: RoomState; at: string }
  | { type: 'room_members'; roomId: string; members: RoomMember[]; at: string }
  | { type: 'room_chat'; roomId: string; message: RoomChatMessage; at: string }
  | { type: 'room_invite'; room: RoomSummary; at: string }
  | { type: 'room_closed'; roomId: string; reason: string; at: string }
  | {
      type: 'quiz_party';
      partyId: string;
      event: string;
      at: string;
      roundNo?: number;
      endsAt?: string;
      userId?: string;
      result?: { title: string; artist: string; coverUrl: string | null } | null;
      podium?: unknown;
    }
  | { type: 'community_message'; message: CommunityMessage; at: string }
  | { type: 'community_message_update'; message: CommunityMessage; at: string }
  | { type: 'community_member_update'; userId: string; role: CommunityRole; at: string }
  | { type: 'community_moderation'; action: string; targetUserId: string | null; at: string }
  | {
      type: 'friendship';
      event: 'request' | 'accepted' | 'declined' | 'cancelled' | 'removed' | 'blocked' | 'unblocked';
      userId: string;
      peerId: string;
      at: string;
    }
  | { type: 'notification'; unread: number; kind: string | null; at: string };

export type CommunityRole = 'owner' | 'moderator' | 'member';

export type CommunityMessage = {
  id: string;
  userId: string;
  body: string;
  attachment: MessageAttachment | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientId: string | null;
};

export type RoomTrack = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  source: string | null;
  duration: number | null;
};

export type RoomQueueItem = {
  track: RoomTrack;
  addedBy: string | null;
  addedByName: string | null;
};

export type RoomState = {
  current: RoomQueueItem | null;
  queue: RoomQueueItem[];
  position: number;
  playing: boolean;
  revision: number;
  updatedAt: string;
};

export type RoomRole = 'owner' | 'moderator' | 'listener';

export type RoomMember = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  role: RoomRole;
  joinedAt: string;
};

export type RoomChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
};

export type RoomSummary = {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  queueMode: 'owner' | 'collab';
  ownerId: string;
  ownerName: string;
  memberCount: number;
  nowPlaying: { title: string; artist: string; coverUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
  invited?: boolean;
};

type Sink = { send: (event: RealtimeEvent) => void };

export class PresenceStore {
  private sessions = new Map<string, Map<string, Session>>();
  private sinks = new Map<string, Set<Sink>>();

  constructor(private readonly iso = (ms: number) => new Date(ms).toISOString()) {}

  heartbeat(userId: string, sessionId: string, away: boolean, now: number): void {
    const perUser = this.sessions.get(userId) ?? new Map<string, Session>();
    const existing = perUser.get(sessionId);
    perUser.set(sessionId, {
      lastBeat: now,
      away,
      activity: existing?.activity ?? null,
      activityAt: existing?.activityAt ?? 0,
    });
    this.sessions.set(userId, perUser);
  }

  dropSession(userId: string, sessionId: string): void {
    const perUser = this.sessions.get(userId);
    if (!perUser) return;
    perUser.delete(sessionId);
    if (perUser.size === 0) this.sessions.delete(userId);
  }

  /** Playback from one device. The newest event wins across sessions. */
  setActivity(userId: string, sessionId: string, activity: ActivitySnapshot | null, now: number): void {
    const perUser = this.sessions.get(userId) ?? new Map<string, Session>();
    const existing = perUser.get(sessionId);
    if (!existing) return;
    perUser.set(sessionId, { ...existing, activity, activityAt: now, lastBeat: existing.lastBeat });
    this.sessions.set(userId, perUser);
  }

  status(userId: string, now: number): PresenceStatus {
    const perUser = this.sessions.get(userId);
    if (!perUser || perUser.size === 0) return 'offline';
    let newest = 0;
    let anyActive = false;
    for (const session of perUser.values()) {
      newest = Math.max(newest, session.lastBeat);
      if (!session.away && now - session.lastBeat <= AWAY_AFTER_MS) anyActive = true;
    }
    if (anyActive) return 'online';
    if (now - newest <= OFFLINE_AFTER_MS) return 'away';
    return 'offline';
  }

  /** Newest playback across all sessions, ignoring stale entries. */
  activity(userId: string, now: number): ActivitySnapshot | null {
    const perUser = this.sessions.get(userId);
    if (!perUser) return null;
    let best: { activity: ActivitySnapshot; at: number } | null = null;
    for (const session of perUser.values()) {
      if (!session.activity) continue;
      if (now - session.activityAt > ACTIVITY_TTL_MS) continue;
      if (!best || session.activityAt > best.at) best = { activity: session.activity, at: session.activityAt };
    }
    return best?.activity ?? null;
  }

  /** Removes expired sessions; returns the users that went fully offline. */
  sweep(now: number): string[] {
    const offline: string[] = [];
    for (const [userId, perUser] of this.sessions) {
      for (const [sessionId, session] of perUser) {
        if (now - session.lastBeat > OFFLINE_AFTER_MS) perUser.delete(sessionId);
      }
      if (perUser.size === 0) {
        this.sessions.delete(userId);
        offline.push(userId);
      }
    }
    return offline;
  }

  subscribe(userId: string, sink: Sink): () => void {
    const set = this.sinks.get(userId) ?? new Set<Sink>();
    set.add(sink);
    this.sinks.set(userId, set);
    return () => {
      const current = this.sinks.get(userId);
      if (!current) return;
      current.delete(sink);
      if (current.size === 0) this.sinks.delete(userId);
    };
  }

  publish(userIds: Iterable<string>, event: RealtimeEvent): void {
    for (const userId of userIds) {
      const set = this.sinks.get(userId);
      if (!set) continue;
      for (const sink of [...set]) {
        try {
          sink.send(event);
        } catch {
          set.delete(sink);
        }
      }
    }
  }

  /** Sends to every open stream. Used by the single official community feed. */
  publishAll(event: RealtimeEvent): number {
    let delivered = 0;
    for (const set of this.sinks.values()) {
      for (const sink of [...set]) {
        try {
          sink.send(event);
          delivered += 1;
        } catch {
          set.delete(sink);
        }
      }
    }
    return delivered;
  }

  connectionCount(userId: string): number {
    return this.sinks.get(userId)?.size ?? 0;
  }
}

export const presenceStore = new PresenceStore();

/* ---------- privacy ---------- */

function parseSetting(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {
    // fall through to the default
  }
  return fallback;
}

export function readPresenceSettings(db: Database, userId: string): PresenceSettings {
  const rows = db
    .prepare(
      `SELECT key, value FROM user_settings
       WHERE user_id = ? AND key IN ('presenceVisible','lastSeenVisible','activityVisible','invisible')`,
    )
    .all(userId) as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    presenceVisible: parseSetting(map.get('presenceVisible'), DEFAULT_PRESENCE_SETTINGS.presenceVisible),
    lastSeenVisible: parseSetting(map.get('lastSeenVisible'), DEFAULT_PRESENCE_SETTINGS.lastSeenVisible),
    activityVisible: parseSetting(map.get('activityVisible'), DEFAULT_PRESENCE_SETTINGS.activityVisible),
    invisible: parseSetting(map.get('invisible'), DEFAULT_PRESENCE_SETTINGS.invisible),
  };
}

function readPresenceSettingsBatch(db: Database, userIds: string[]): Map<string, PresenceSettings> {
  const out = new Map<string, PresenceSettings>();
  if (userIds.length === 0) return out;
  const placeholders = userIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT user_id, key, value FROM user_settings
       WHERE user_id IN (${placeholders})
         AND key IN ('presenceVisible','lastSeenVisible','activityVisible','invisible')`,
    )
    .all(...userIds) as Array<{ user_id: string; key: string; value: string }>;
  const byUser = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const target = byUser.get(row.user_id) ?? new Map<string, string>();
    target.set(row.key, row.value);
    byUser.set(row.user_id, target);
  }
  for (const id of userIds) {
    const map = byUser.get(id);
    out.set(id, {
      presenceVisible: parseSetting(map?.get('presenceVisible'), DEFAULT_PRESENCE_SETTINGS.presenceVisible),
      lastSeenVisible: parseSetting(map?.get('lastSeenVisible'), DEFAULT_PRESENCE_SETTINGS.lastSeenVisible),
      activityVisible: parseSetting(map?.get('activityVisible'), DEFAULT_PRESENCE_SETTINGS.activityVisible),
      invisible: parseSetting(map?.get('invisible'), DEFAULT_PRESENCE_SETTINGS.invisible),
    });
  }
  return out;
}

function storedLastSeen(db: Database, userId: string): string | null {
  const row = db.prepare('SELECT last_seen_at FROM user_presence WHERE user_id = ?').get(userId) as
    | { last_seen_at: string | null }
    | undefined;
  return row?.last_seen_at ?? null;
}

/** Applies privacy rules to one user's presence for a viewer. */
export function presentFor(
  db: Database,
  store: PresenceStore,
  viewerId: string,
  targetId: string,
  now: number,
  settings?: PresenceSettings,
): FriendPresence | null {
  if (viewerId === targetId) {
    const own = readPresenceSettings(db, targetId);
    return {
      userId: targetId,
      status: store.status(targetId, now),
      lastSeenAt: own.lastSeenVisible ? (storedLastSeen(db, targetId) ?? null) : null,
      activity: own.activityVisible ? store.activity(targetId, now) : null,
    };
  }
  const config = settings ?? readPresenceSettings(db, targetId);
  if (config.invisible || !config.presenceVisible) {
    return { userId: targetId, status: 'offline', lastSeenAt: null, activity: null };
  }
  const status = store.status(targetId, now);
  return {
    userId: targetId,
    status,
    lastSeenAt: config.lastSeenVisible ? storedLastSeen(db, targetId) : null,
    activity: config.activityVisible && status !== 'offline' ? store.activity(targetId, now) : null,
  };
}

/** Presence for every friend of `viewerId`, privacy- and block-filtered. */
export function friendsPresence(
  db: Database,
  store: PresenceStore,
  viewerId: string,
  now: number,
  limit = 100,
): FriendPresence[] {
  const friends = listFriends(db, viewerId, limit, 0).items;
  const settings = readPresenceSettingsBatch(
    db,
    friends.map((friend) => friend.id),
  );
  return friends.map((friend) =>
    presentFor(db, store, viewerId, friend.id, now, settings.get(friend.id)),
  ).filter((entry): entry is FriendPresence => entry !== null);
}

/** True when `viewerId` may see `targetId`'s presence at all (self or friends). */
export function canViewPresence(db: Database, viewerId: string, targetId: string): boolean {
  if (viewerId === targetId) return true;
  const row = db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE pair_key = ? AND status = 'accepted'`,
    )
    .get([viewerId, targetId].sort().join(':')) as unknown;
  if (!row) return false;
  const blocked = db
    .prepare(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    )
    .get(viewerId, targetId, targetId, viewerId);
  return !blocked;
}

/** Persists offline timestamps, throttled: only on the offline transition. */
export function recordOffline(db: Database, userId: string, at: string): void {
  db.prepare(
    `INSERT INTO user_presence (user_id, status, last_seen_at, updated_at)
     VALUES (?, 'offline', ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET status = 'offline', last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`,
  ).run(userId, at, at);
}

export function recordOnline(db: Database, userId: string, at: string): void {
  db.prepare(
    `INSERT INTO user_presence (user_id, status, last_seen_at, updated_at)
     VALUES (?, 'online', NULL, ?)
     ON CONFLICT (user_id) DO UPDATE SET status = 'online', updated_at = excluded.updated_at`,
  ).run(userId, at);
}

/* ---------- broadcasting ---------- */

function friendIds(db: Database, userId: string): string[] {
  return listFriends(db, userId, 200, 0).items.map((friend) => friend.id);
}

/** Pushes one user's privacy-filtered presence to their friends. */
export function publishPresence(db: Database, store: PresenceStore, userId: string): void {
  const settings = readPresenceSettings(db, userId);
  const recipients = friendIds(db, userId);
  if (recipients.length === 0) return;
  const hidden = settings.invisible || !settings.presenceVisible;
  const status: PresenceStatus = hidden ? 'offline' : store.status(userId, Date.now());
  store.publish(recipients, {
    type: 'presence',
    userId,
    status,
    lastSeenAt: hidden || !settings.lastSeenVisible ? null : storedLastSeen(db, userId),
    at: new Date().toISOString(),
  });
}

/** Pushes the user's current (or hidden) activity to their friends. */
export function publishActivity(db: Database, store: PresenceStore, userId: string): void {
  const settings = readPresenceSettings(db, userId);
  const recipients = friendIds(db, userId);
  if (recipients.length === 0) return;
  const hidden = settings.invisible || !settings.presenceVisible || !settings.activityVisible;
  store.publish(recipients, {
    type: 'activity',
    userId,
    activity: hidden ? null : store.activity(userId, Date.now()),
    at: new Date().toISOString(),
  });
}
