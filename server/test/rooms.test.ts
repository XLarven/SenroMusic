import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
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
  listMembers,
  normalizeRoomTrack,
  parseState,
  postRoomMessage,
  removeFromQueue,
  reorderQueue,
  roleOf,
  setMemberRole,
  sweepRooms,
  toSummary,
  updateRoom,
} from '../src/rooms.js';

const OWNER = 'a1b2c3d4e5f60718293a4b5c';
const MOD = 'b2c3d4e5f60718293a4b5ca1';
const LISTENER = 'c3d4e5f60718293a4b5ca1b2';
const OUTSIDER = 'd4e5f60718293a4b5ca1b2c3';
const BLOCKED = 'e5f60718293a4b5ca1b2c3d4';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, display_name TEXT, username TEXT,
      avatar_url TEXT, bio TEXT, profile_visibility TEXT DEFAULT 'public'
    );
    CREATE TABLE friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT, requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL, pair_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE user_blocks (
      blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE TABLE listening_rooms (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      join_code TEXT,
      queue_mode TEXT NOT NULL DEFAULT 'owner',
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_seen_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE room_members (
      room_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'listener', joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE room_invites (
      room_id TEXT NOT NULL, user_id TEXT NOT NULL, invited_by TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE room_messages (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT, deleted_by TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO users (id, email, display_name, username) VALUES (?, ?, ?, ?)');
  insert.run(OWNER, 'a@x', 'Ada', 'ada');
  insert.run(MOD, 'b@x', 'Bea', 'bea');
  insert.run(LISTENER, 'c@x', 'Cem', 'cem');
  insert.run(OUTSIDER, 'd@x', 'Deniz', 'deniz');
  insert.run(BLOCKED, 'e@x', 'Ece', 'ece');
  const friend = db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, pair_key, status, created_at, updated_at)
     VALUES (?, ?, ?, 'accepted', '2026-01-01', '2026-01-01')`,
  );
  friend.run(OWNER, MOD, `${OWNER}:${MOD}`.split(':').sort().join(':'));
  friend.run(OWNER, LISTENER, [OWNER, LISTENER].sort().join(':'));
  return db;
}

function room(db: Database, visibility: 'public' | 'private' = 'public'): string {
  const created = createRoom(db, OWNER, { name: 'Gece odası', visibility });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('room not created');
  return created.roomId;
}

const track = (id = 'yt_brnIlxX_XKs', title = 'Kesariya') => ({
  id,
  title,
  artist: 'Arijit Singh',
  album: 'Brahmastra',
  coverUrl: 'https://i.ytimg.com/vi/brnIlxX_XKs/hqdefault.jpg',
  source: 'youtube',
  duration: 268,
});

test('a room starts with its owner and an empty timeline', () => {
  const db = makeDb();
  const id = room(db);
  const row = db.prepare('SELECT * FROM listening_rooms WHERE id = ?').get(id) as never;
  assert.equal(roleOf(db, id, OWNER), 'owner');
  const state = parseState(row);
  assert.equal(state.current, null);
  assert.deepEqual(state.queue, []);
  assert.equal(state.revision, 0);
  assert.equal(listMembers(db, id).length, 1);
});

test('public rooms accept anyone, private rooms need a code or an invite', () => {
  const db = makeDb();
  const open = room(db);
  assert.deepEqual(joinRoom(db, LISTENER, open), { ok: true, roomId: open, alreadyMember: false });

  const secret = room(db, 'private');
  const denied = joinRoom(db, OUTSIDER, secret);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, 'invite_required');

  const code = (db.prepare('SELECT join_code FROM listening_rooms WHERE id = ?').get(secret) as { join_code: string })
    .join_code;
  assert.equal(joinRoom(db, OUTSIDER, secret, code.toLowerCase()).ok, true);

  const other = room(db, 'private');
  assert.equal(inviteToRoom(db, other, OWNER, MOD).ok, true);
  assert.equal(joinRoom(db, MOD, other).ok, true);
});

test('blocked users cannot join and lose access afterwards', () => {
  const db = makeDb();
  const id = room(db, 'private');
  db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, '2026-01-01')").run(
    OWNER,
    BLOCKED,
  );
  const code = (db.prepare('SELECT join_code FROM listening_rooms WHERE id = ?').get(id) as { join_code: string })
    .join_code;
  const result = joinRoom(db, BLOCKED, id, code);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'blocked');

  joinRoom(db, LISTENER, id, code);
  db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, '2026-01-01')").run(
    OWNER,
    LISTENER,
  );
  const access = accessRoom(db, id, LISTENER);
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.code, 'blocked');
});

test('non-members cannot read a room', () => {
  const db = makeDb();
  const id = room(db, 'private');
  const access = accessRoom(db, id, OUTSIDER);
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.code, 'not_member');
});

test('only owner and moderators control playback', () => {
  const db = makeDb();
  const id = room(db);
  joinRoom(db, MOD, id);
  joinRoom(db, LISTENER, id);
  assert.equal(setMemberRole(db, id, OWNER, MOD, 'moderator').ok, true);

  const byListener = applyPlayback(db, id, LISTENER, { action: 'play-track', track: track() });
  assert.equal(byListener.ok, false);
  if (!byListener.ok) assert.equal(byListener.code, 'forbidden');

  const byMod = applyPlayback(db, id, MOD, { action: 'play-track', track: track() });
  assert.equal(byMod.ok, true);
  if (byMod.ok) {
    assert.equal(byMod.state.current?.track.title, 'Kesariya');
    assert.equal(byMod.state.playing, true);
    assert.equal(byMod.state.revision, 1);
  }
});

test('play, pause and seek keep a server timeline with revisions', () => {
  const db = makeDb();
  const id = room(db);
  const play = applyPlayback(db, id, OWNER, { action: 'play-track', track: track() });
  assert.equal(play.ok, true);
  const pause = applyPlayback(db, id, OWNER, { action: 'pause', position: 42.5 });
  assert.equal(pause.ok, true);
  if (!pause.ok) return;
  assert.equal(pause.state.playing, false);
  assert.equal(pause.state.position, 42.5);
  assert.ok(pause.state.revision > play.ok ? play.state.revision : 0);
  assert.ok(pause.state.updatedAt);

  const seek = applyPlayback(db, id, OWNER, { action: 'seek', position: 10_000 });
  assert.equal(seek.ok, true);
  if (seek.ok) assert.equal(seek.state.position, 268, 'seek is clamped to the duration');
});

test('next shifts the queue into the current slot', () => {
  const db = makeDb();
  const id = room(db);
  applyPlayback(db, id, OWNER, { action: 'play-track', track: track() });
  addToQueue(db, id, OWNER, track('yt_aaaaaaaaaaa', 'Second'));
  addToQueue(db, id, OWNER, track('yt_bbbbbbbbbbb', 'Third'));
  const next = applyPlayback(db, id, OWNER, { action: 'next' });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.state.current?.track.title, 'Second');
  assert.equal(next.state.queue.length, 1);
  assert.equal(next.state.position, 0);
});

test('queue editing follows the room mode', () => {
  const db = makeDb();
  const id = room(db);
  joinRoom(db, LISTENER, id);
  applyPlayback(db, id, OWNER, { action: 'play-track', track: track() });

  const denied = addToQueue(db, id, LISTENER, track('yt_aaaaaaaaaaa', 'Nope'));
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, 'forbidden');

  updateRoom(db, id, OWNER, { queueMode: 'collab' });
  const allowed = addToQueue(db, id, LISTENER, track('yt_aaaaaaaaaaa', 'Second'));
  assert.equal(allowed.ok, true);
  if (!allowed.ok) return;
  assert.equal(allowed.state.queue.length, 1);
  assert.equal(allowed.state.queue[0]?.addedBy, LISTENER);

  const reordered = reorderQueue(db, id, LISTENER, 0, 0);
  assert.equal(reordered.ok, true);
  const removed = removeFromQueue(db, id, LISTENER, 0);
  assert.equal(removed.ok, true);
  if (removed.ok) assert.equal(removed.state.queue.length, 0);

  const badIndex = removeFromQueue(db, id, LISTENER, 5);
  assert.equal(badIndex.ok, false);
});

test('an empty room starts playback when the first track is queued', () => {
  const db = makeDb();
  const id = room(db);
  const result = addToQueue(db, id, OWNER, track());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.atFront, true);
  assert.equal(result.state.current?.track.title, 'Kesariya');
  assert.equal(result.state.playing, true);
});

test('invalid track metadata is refused', () => {
  assert.equal(normalizeRoomTrack({ id: 'javascript:alert(1)', title: 'x', artist: 'y' }), null);
  assert.equal(normalizeRoomTrack({ id: 'yt_brnIlxX_XKs', title: '', artist: 'y' }), null);
  const clean = normalizeRoomTrack({
    id: 'yt_brnIlxX_XKs',
    title: 'Kesariya',
    artist: 'Arijit Singh',
    coverUrl: 'https://evil.example.com/x.jpg',
    duration: 268,
  });
  assert.equal(clean?.coverUrl, null);
});

test('leaving transfers ownership, the last member closes the room', () => {
  const db = makeDb();
  const id = room(db);
  joinRoom(db, MOD, id);
  joinRoom(db, LISTENER, id);

  const left = leaveRoom(db, id, OWNER);
  assert.equal(left.closed, false);
  assert.ok(left.newOwnerId);
  assert.equal(roleOf(db, id, left.newOwnerId!), 'owner');

  leaveRoom(db, id, MOD);
  const last = leaveRoom(db, id, LISTENER);
  assert.equal(last.closed, true);
  const row = db.prepare('SELECT closed_at FROM listening_rooms WHERE id = ?').get(id) as { closed_at: string | null };
  assert.ok(row.closed_at);
});

test('one account can only be a member of one active room', () => {
  const db = makeDb();
  const first = room(db);
  const second = room(db);

  assert.deepEqual(joinRoom(db, LISTENER, first), { ok: true, roomId: first, alreadyMember: false });
  const blocked = joinRoom(db, LISTENER, second);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.code, 'already_in_room');
    assert.equal(blocked.roomId, first);
    assert.equal(blocked.roomName, 'Gece odası');
  }
  assert.equal(roleOf(db, second, LISTENER), null);

  leaveRoom(db, first, LISTENER);
  assert.deepEqual(joinRoom(db, LISTENER, second), { ok: true, roomId: second, alreadyMember: false });
});

test('a stale duplicate membership is released by the sweep', () => {
  const db = makeDb();
  const first = room(db);
  const second = room(db);
  db.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'listener', ?)").run(
    first,
    LISTENER,
    '2026-01-01T00:00:00.000Z',
  );
  db.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'listener', ?)").run(
    second,
    LISTENER,
    '2026-01-02T00:00:00.000Z',
  );
  db.prepare("UPDATE listening_rooms SET updated_at = '2026-01-02T00:00:00.000Z' WHERE id = ?").run(second);
  db.prepare("UPDATE listening_rooms SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(first);

  sweepRooms(db);
  const memberships = db.prepare('SELECT room_id FROM room_members WHERE user_id = ?').all(LISTENER) as Array<{
    room_id: string;
  }>;
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0]?.room_id, second);
});

test('only the owner closes or renames a room', () => {  const db = makeDb();
  const id = room(db);
  joinRoom(db, MOD, id);
  assert.equal(closeRoom(db, id, MOD), false);
  assert.equal(updateRoom(db, id, MOD, { name: 'hack' }), null);
  const renamed = updateRoom(db, id, OWNER, { name: 'Yeni ad', visibility: 'private' });
  assert.equal(renamed?.name, 'Yeni ad');
  assert.equal(renamed?.visibility, 'private');
  assert.ok(renamed?.join_code);
  assert.equal(closeRoom(db, id, OWNER), true);
  assert.equal(accessRoom(db, id, OWNER).ok, false);
});

test('moderators can kick listeners but not other moderators', () => {
  const db = makeDb();
  const id = room(db);
  joinRoom(db, MOD, id);
  joinRoom(db, LISTENER, id);
  setMemberRole(db, id, OWNER, MOD, 'moderator');
  setMemberRole(db, id, OWNER, LISTENER, 'moderator');
  const sameLevel = kickMember(db, id, MOD, LISTENER);
  assert.equal(sameLevel.ok, false);
  setMemberRole(db, id, OWNER, LISTENER, 'listener');
  assert.equal(kickMember(db, id, MOD, LISTENER).ok, true);
  assert.equal(roleOf(db, id, LISTENER), null);
  assert.equal(kickMember(db, id, MOD, OWNER).ok, false);
});

test('room chat is sanitised and moderated', () => {
  const db = makeDb();
  const id = room(db);
  joinRoom(db, MOD, id);
  joinRoom(db, LISTENER, id);
  const posted = postRoomMessage(db, id, LISTENER, '  merhaba  ');
  assert.equal(posted.ok, true);
  if (!posted.ok) return;
  assert.equal(posted.message.body, 'merhaba');

  const empty = postRoomMessage(db, id, LISTENER, '   ');
  assert.equal(empty.ok, false);

  const outsider = postRoomMessage(db, id, OUTSIDER, 'hey');
  assert.equal(outsider.ok, false);

  assert.equal(deleteRoomMessage(db, id, MOD, posted.message.id), null, 'plain member cannot moderate');
  setMemberRole(db, id, OWNER, MOD, 'moderator');
  const deleted = deleteRoomMessage(db, id, MOD, posted.message.id);
  assert.ok(deleted?.deletedAt);
  assert.equal(deleted?.body, '');
});

test('invitations need a friendship and respect blocks', () => {
  const db = makeDb();
  const id = room(db, 'private');
  const notFriend = inviteToRoom(db, id, OWNER, OUTSIDER);
  assert.equal(notFriend.ok, false);
  if (!notFriend.ok) assert.equal(notFriend.code, 'not_friend');

  assert.equal(inviteToRoom(db, id, OWNER, MOD).ok, true);
  db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, '2026-01-01')").run(
    OWNER,
    LISTENER,
  );
  const blocked = inviteToRoom(db, id, OWNER, LISTENER);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'blocked');
});

test('sweep closes empty rooms and hands over stale ownership', () => {
  const db = makeDb();
  const empty = room(db);
  const stale = room(db);
  joinRoom(db, MOD, stale);
  const past = new Date(Date.now() - 60 * 60_000).toISOString();
  db.prepare('UPDATE listening_rooms SET owner_seen_at = ? WHERE id = ?').run(past, stale);
  db.prepare('UPDATE listening_rooms SET owner_seen_at = ? WHERE id = ?').run(past, empty);

  const touched = sweepRooms(db, Date.now());
  assert.ok(touched.includes(empty));
  assert.ok(touched.includes(stale));
  const closed = db.prepare('SELECT closed_at FROM listening_rooms WHERE id = ?').get(empty) as { closed_at: string | null };
  assert.ok(closed.closed_at);
  assert.equal(roleOf(db, stale, MOD), 'owner');
});

test('summaries expose real room data only', () => {
  const db = makeDb();
  const id = room(db);
  joinRoom(db, MOD, id);
  applyPlayback(db, id, OWNER, { action: 'play-track', track: track() });
  const row = db.prepare('SELECT * FROM listening_rooms WHERE id = ?').get(id) as never;
  const summary = toSummary(db, row);
  assert.equal(summary.memberCount, 2);
  assert.equal(summary.nowPlaying?.title, 'Kesariya');
  assert.equal(summary.ownerName, 'Ada');
});
