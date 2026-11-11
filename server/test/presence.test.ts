import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  AWAY_AFTER_MS,
  ACTIVITY_TTL_MS,
  OFFLINE_AFTER_MS,
  PresenceStore,
  canViewPresence,
  friendsPresence,
  presentFor,
  readPresenceSettings,
  recordOffline,
} from '../src/presence.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, display_name TEXT, username TEXT,
      avatar_url TEXT, bio TEXT, profile_visibility TEXT DEFAULT 'public'
    );
    CREATE TABLE friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      pair_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE user_blocks (
      blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE TABLE user_settings (
      user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE user_presence (
      user_id TEXT PRIMARY KEY, status TEXT, last_seen_at TEXT, updated_at TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO users (id, email, display_name, username) VALUES (?, ?, ?, ?)');
  insert.run('u_a', 'a@x', 'A', 'a');
  insert.run('u_b', 'b@x', 'B', 'b');
  insert.run('u_c', 'c@x', 'C', 'c');
  const friend = db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, pair_key, status, created_at, updated_at)
     VALUES (?, ?, ?, 'accepted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
  friend.run('u_a', 'u_b', 'u_a:u_b');
  return db;
}

const activity = (title: string) => ({
  trackId: 't_1',
  title,
  artist: 'Artist',
  album: 'Album',
  coverUrl: null,
  source: 'spotify',
  duration: 200,
  position: 10,
  playing: true,
  updatedAt: new Date().toISOString(),
});

test('presence goes online, away then offline', () => {
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 's1', false, t0);
  assert.equal(store.status('u_a', t0), 'online');
  assert.equal(store.status('u_a', t0 + AWAY_AFTER_MS + 1), 'away');
  assert.equal(store.status('u_a', t0 + OFFLINE_AFTER_MS + 1), 'offline');
});

test('one active session keeps the user online', () => {
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 's1', false, t0);
  store.heartbeat('u_a', 's2', false, t0 + AWAY_AFTER_MS);
  assert.equal(store.status('u_a', t0 + AWAY_AFTER_MS + 10), 'online');
});

test('closing every session makes the user offline immediately', () => {
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 's1', false, t0);
  store.heartbeat('u_a', 's2', false, t0);
  store.dropSession('u_a', 's1');
  assert.equal(store.status('u_a', t0), 'online');
  store.dropSession('u_a', 's2');
  assert.equal(store.status('u_a', t0), 'offline');
});

test('sweep expires stale sessions', () => {
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 's1', false, t0);
  assert.deepEqual(store.sweep(t0 + OFFLINE_AFTER_MS + 1), ['u_a']);
  assert.equal(store.status('u_a', t0 + OFFLINE_AFTER_MS + 2), 'offline');
});

test('newest playback wins across devices', () => {
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 'desktop', false, t0);
  store.heartbeat('u_a', 'phone', false, t0);
  store.setActivity('u_a', 'desktop', activity('Old song'), t0);
  store.setActivity('u_a', 'phone', activity('New song'), t0 + 5_000);
  assert.equal(store.activity('u_a', t0 + 6_000)?.title, 'New song');
  // A late pause on the idle tab must not overwrite the newer device.
  store.setActivity('u_a', 'desktop', activity('Old song'), t0 + 1_000);
  assert.equal(store.activity('u_a', t0 + 7_000)?.title, 'New song');
});

test('stale playback is dropped', () => {
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 's1', false, t0);
  store.setActivity('u_a', 's1', activity('Song'), t0);
  assert.equal(store.activity('u_a', t0 + ACTIVITY_TTL_MS + 1), null);
});

test('invisible users look offline and hide everything', () => {
  const db = makeDb();
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 's1', false, t0);
  store.setActivity('u_a', 's1', activity('Secret song'), t0);
  db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES ('u_a','invisible','true')").run();
  recordOffline(db, 'u_a', new Date(t0).toISOString());
  const seen = presentFor(db, store, 'u_b', 'u_a', t0 + 1000);
  assert.equal(seen?.status, 'offline');
  assert.equal(seen?.activity, null);
  assert.equal(seen?.lastSeenAt, null);
});

test('hiding activity keeps presence visible', () => {
  const db = makeDb();
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_a', 's1', false, t0);
  store.setActivity('u_a', 's1', activity('Song'), t0);
  db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES ('u_a','activityVisible','false')").run();
  const seen = presentFor(db, store, 'u_b', 'u_a', t0 + 1000);
  assert.equal(seen?.status, 'online');
  assert.equal(seen?.activity, null);
});

test('hiding presence hides last seen too', () => {
  const db = makeDb();
  const store = new PresenceStore();
  const t0 = 1_000_000;
  recordOffline(db, 'u_a', new Date(t0).toISOString());
  db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES ('u_a','presenceVisible','false')").run();
  const seen = presentFor(db, store, 'u_b', 'u_a', t0 + 1000);
  assert.equal(seen?.status, 'offline');
  assert.equal(seen?.lastSeenAt, null);
});

test('friends list applies privacy per friend', () => {
  const db = makeDb();
  const store = new PresenceStore();
  const t0 = 1_000_000;
  store.heartbeat('u_b', 's1', false, t0);
  store.setActivity('u_b', 's1', activity('B song'), t0);
  const list = friendsPresence(db, store, 'u_a', t0 + 1000);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.status, 'online');
  assert.equal(list[0]?.activity?.title, 'B song');
});

test('blocked pairs are not friends and cannot view presence', () => {
  const db = makeDb();
  assert.equal(canViewPresence(db, 'u_a', 'u_b'), true);
  db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES ('u_b','u_a','2026-01-01T00:00:00.000Z')").run();
  assert.equal(canViewPresence(db, 'u_a', 'u_b'), false);
  const store = new PresenceStore();
  assert.equal(friendsPresence(db, store, 'u_a', 1_000_000).length, 0);
});

test('non-friends cannot view presence', () => {
  const db = makeDb();
  assert.equal(canViewPresence(db, 'u_a', 'u_c'), false);
});

test('privacy defaults are privacy-preserving but functional', () => {
  const db = makeDb();
  const settings = readPresenceSettings(db, 'u_a');
  assert.deepEqual(settings, {
    presenceVisible: true,
    lastSeenVisible: true,
    activityVisible: true,
    invisible: false,
  });
});

test('subscribers receive published events and can unsubscribe', () => {
  const store = new PresenceStore();
  const received: string[] = [];
  const off = store.subscribe('u_a', { send: (event) => received.push(event.type) });
  store.publish(['u_a'], { type: 'presence', userId: 'u_b', status: 'online', lastSeenAt: null, at: '' });
  assert.deepEqual(received, ['presence']);
  off();
  store.publish(['u_a'], { type: 'activity', userId: 'u_b', activity: null, at: '' });
  assert.deepEqual(received, ['presence']);
});
