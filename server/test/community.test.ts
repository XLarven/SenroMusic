import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  clearRestriction,
  communityRole,
  deleteCommunityMessage,
  editCommunityMessage,
  ensureMembership,
  ensureMembershipForAll,
  isStaff,
  listCommunityMembers,
  listCommunityMessages,
  listReports,
  moderationLog,
  readCommunitySettings,
  reportMessage,
  resolveReport,
  restrictMember,
  restrictions,
  sendCommunityMessage,
  setCommunityRole,
  writeCommunitySettings,
} from '../src/community.js';
import { presenceStore } from '../src/presence.js';

const OWNER = 'a1b2c3d4e5f60718293a4b5c';
const MOD = 'b2c3d4e5f60718293a4b5ca1';
const USER = 'c3d4e5f60718293a4b5ca1b2';
const OTHER = 'd4e5f60718293a4b5ca1b2c3';
const QUIET = 'e5f60718293a4b5ca1b2c3d4';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, display_name TEXT, username TEXT,
      avatar_url TEXT, bio TEXT, profile_visibility TEXT DEFAULT 'public',
      role TEXT DEFAULT 'user', created_at TEXT
    );
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, duration REAL DEFAULT 0,
      path TEXT, language TEXT, cover_id TEXT, format TEXT, album TEXT DEFAULT ''
    );
    CREATE TABLE playlists (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private', cover_url TEXT
    );
    CREATE TABLE user_settings (
      user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE user_presence (
      user_id TEXT PRIMARY KEY, status TEXT, last_seen_at TEXT, updated_at TEXT
    );
    CREATE TABLE community_members (
      user_id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'member', joined_at TEXT NOT NULL,
      muted_until TEXT, suspended_until TEXT, suspension_reason TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE community_messages (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL, client_id TEXT,
      attachment_json TEXT, created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT, deleted_by TEXT,
      UNIQUE (user_id, client_id)
    );
    CREATE TABLE community_moderation (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, target_user_id TEXT,
      action TEXT NOT NULL, reason TEXT, message_id TEXT, created_at TEXT NOT NULL, expires_at TEXT
    );
    CREATE TABLE community_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL, message_id TEXT,
      target_user_id TEXT, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT
    );
    CREATE TABLE community_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, display_name, username, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertUser.run(OWNER, 'owner@x', 'Ada', 'ada', 'admin', '2026-01-01');
  insertUser.run(MOD, 'mod@x', 'Bea', 'bea', 'user', '2026-01-01');
  insertUser.run(USER, 'user@x', 'Cem', 'cem', 'user', '2026-01-01');
  insertUser.run(OTHER, 'other@x', 'Deniz', 'deniz', 'user', '2026-01-01');
  insertUser.run(QUIET, 'quiet@x', 'Ece', 'ece', 'user', '2026-01-01');
  const write = db.prepare('INSERT INTO community_settings (key, value, updated_at) VALUES (?, ?, ?)');
  write.run('slowModeSeconds', '0', '2026-01-01');
  write.run('maxMessageLength', '2000', '2026-01-01');
  ensureMembershipForAll(db);
  return db;
}

test('every existing account joins and the admin owns the community', () => {
  const db = makeDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM community_members').get() as { c: number }).c;
  assert.equal(count, 5);
  assert.equal(communityRole(db, OWNER), 'owner');
  assert.equal(communityRole(db, USER), 'member');
  assert.equal(isStaff('owner'), true);
  assert.equal(isStaff('member'), false);
});

test('a new account is added on first access', () => {
  const db = makeDb();
  db.prepare("INSERT INTO users (id, email, display_name, username, created_at) VALUES ('zzz', 'z@x', 'Zed', 'zed', '2026-01-02')").run();
  assert.equal(db.prepare("SELECT 1 FROM community_members WHERE user_id = 'zzz'").get(), undefined);
  ensureMembership(db, 'zzz');
  assert.equal(communityRole(db, 'zzz'), 'member');
});

test('messages persist, paginate and keep their author', () => {
  const db = makeDb();
  for (let index = 0; index < 5; index += 1) {
    const sent = sendCommunityMessage(db, USER, { body: `mesaj ${index}`, clientId: `c${index}` });
    assert.equal(sent.ok, true);
  }
  const first = listCommunityMessages(db, OTHER, null, 2);
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[1]?.body, 'mesaj 4');
  assert.equal(first.items[0]?.author?.displayName, 'Cem');
  const older = listCommunityMessages(db, OTHER, first.items[0]?.createdAt ?? null, 2);
  assert.equal(older.items.length, 2);
  assert.equal(older.items[0]?.body, 'mesaj 1');
});

test('a repeated client id is idempotent', () => {
  const db = makeDb();
  const first = sendCommunityMessage(db, USER, { body: 'tek', clientId: 'same' });
  const second = sendCommunityMessage(db, USER, { body: 'tek', clientId: 'same' });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.duplicate, true);
  assert.equal(first.message.id, second.message.id);
  assert.equal(listCommunityMessages(db, USER, null, 10).items.length, 1);
});

test('empty messages and unsafe attachments are refused', () => {
  const db = makeDb();
  const empty = sendCommunityMessage(db, USER, { body: '   ' });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, 'empty');
  const bad = sendCommunityMessage(db, USER, {
    body: 'x',
    attachment: { kind: 'track', title: 'x', trackId: 'javascript:alert(1)' },
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'invalid_attachment');
  const good = sendCommunityMessage(db, USER, {
    body: 'bunu dinle',
    attachment: { kind: 'track', title: 'Kesariya', subtitle: 'Arijit Singh', trackId: 'yt_brnIlxX_XKs' },
  });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.message.attachment?.title, 'Kesariya');
});

test('only the author edits, but staff can delete', () => {
  const db = makeDb();
  const sent = sendCommunityMessage(db, USER, { body: 'ilk' });
  if (!sent.ok) throw new Error('send failed');
  assert.equal(editCommunityMessage(db, OTHER, sent.message.id, 'hack'), null);
  const edited = editCommunityMessage(db, USER, sent.message.id, 'ikinci');
  assert.equal(edited?.body, 'ikinci');
  assert.ok(edited?.editedAt);

  assert.equal(deleteCommunityMessage(db, OTHER, sent.message.id).ok, false);
  setCommunityRole(db, OWNER, MOD, 'moderator');
  const deleted = deleteCommunityMessage(db, MOD, sent.message.id);
  assert.equal(deleted.ok, true);
  if (deleted.ok) {
    assert.equal(deleted.message.deletedAt !== null, true);
    assert.equal(deleted.message.body, '');
    assert.equal(deleted.moderating, true);
  }
  const audit = moderationLog(db);
  assert.equal(audit[0]?.action, 'delete_message');
  assert.equal(audit[0]?.targetUserId, USER);
});

test('mutes and suspensions block posting until they expire', () => {
  const db = makeDb();
  setCommunityRole(db, OWNER, MOD, 'moderator');
  const muted = restrictMember(db, MOD, USER, 'mute', 10, 'spam');
  assert.equal(muted.ok, true);
  const blocked = sendCommunityMessage(db, USER, { body: 'hi' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'muted');
  assert.equal(restrictions(db, USER).canPost, false);
  assert.equal(restrictions(db, USER, Date.now() + 11 * 60_000).canPost, true);

  clearRestriction(db, MOD, USER, 'mute');
  assert.equal(sendCommunityMessage(db, USER, { body: 'back' }).ok, true);

  restrictMember(db, MOD, OTHER, 'suspend', 30, 'harassment');
  const suspended = sendCommunityMessage(db, OTHER, { body: 'hey' });
  assert.equal(suspended.ok, false);
  if (!suspended.ok) assert.equal(suspended.code, 'suspended');
});

test('moderators cannot moderate staff or the owner', () => {
  const db = makeDb();
  setCommunityRole(db, OWNER, MOD, 'moderator');
  setCommunityRole(db, OWNER, OTHER, 'moderator');
  const againstMod = restrictMember(db, MOD, OTHER, 'mute', 10, null);
  assert.equal(againstMod.ok, false);
  if (!againstMod.ok) assert.equal(againstMod.code, 'target_staff');
  const againstOwner = restrictMember(db, MOD, OWNER, 'mute', 10, null);
  assert.equal(againstOwner.ok, false);
  if (!againstOwner.ok) assert.equal(againstOwner.code, 'target_owner');
  const self = restrictMember(db, MOD, MOD, 'mute', 10, null);
  assert.equal(self.ok, false);
});

test('only the owner manages roles and settings', () => {
  const db = makeDb();
  const byMember = setCommunityRole(db, USER, OTHER, 'moderator');
  assert.equal(byMember.ok, false);
  const byOwner = setCommunityRole(db, OWNER, USER, 'moderator');
  assert.equal(byOwner.ok, true);
  assert.equal(communityRole(db, USER), 'moderator');
  const demote = setCommunityRole(db, OWNER, USER, 'member');
  assert.equal(demote.ok, true);

  const settings = writeCommunitySettings(db, USER, { slowModeSeconds: 30 });
  assert.equal(settings.slowModeSeconds, 0, 'member cannot change settings');
  const ownerSettings = writeCommunitySettings(db, OWNER, { slowModeSeconds: 30, maxMessageLength: 500 });
  assert.equal(ownerSettings.slowModeSeconds, 30);
  assert.equal(ownerSettings.maxMessageLength, 500);
  assert.equal(readCommunitySettings(db).maxMessageLength, 500);
});

test('slow mode and duplicate floods are rejected', () => {
  const db = makeDb();
  writeCommunitySettings(db, OWNER, { slowModeSeconds: 30 });
  const now = Date.now();
  const first = sendCommunityMessage(db, USER, { body: 'bir' }, 2000, 30, now);
  assert.equal(first.ok, true);
  const quick = sendCommunityMessage(db, USER, { body: 'iki' }, 2000, 30, now + 2000);
  assert.equal(quick.ok, false);
  if (!quick.ok) assert.equal(quick.code, 'slow_mode');
  const later = sendCommunityMessage(db, USER, { body: 'iki' }, 2000, 30, now + 31_000);
  assert.equal(later.ok, true);

  writeCommunitySettings(db, OWNER, { slowModeSeconds: 0 });
  const firstDup = sendCommunityMessage(db, OTHER, { body: 'aynı' }, 2000, 0, now);
  assert.equal(firstDup.ok, true);
  const dup = sendCommunityMessage(db, OTHER, { body: 'aynı' }, 2000, 0, now + 1000);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.code, 'duplicate');
});

test('reports are one-per-member and resolvable by staff', () => {
  const db = makeDb();
  const sent = sendCommunityMessage(db, USER, { body: 'kötü mesaj' });
  if (!sent.ok) throw new Error('send failed');
  assert.equal(reportMessage(db, OTHER, sent.message.id, 'spam').ok, true);
  const again = reportMessage(db, OTHER, sent.message.id, 'spam');
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.code, 'already_reported');
  const reports = listReports(db, 'open');
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.targetUserId, USER);

  const byMember = resolveReport(db, USER, reports[0]!.id, 'resolved');
  assert.equal(byMember.ok, false);
  setCommunityRole(db, OWNER, MOD, 'moderator');
  assert.equal(resolveReport(db, MOD, reports[0]!.id, 'resolved').ok, true);
  assert.equal(listReports(db, 'open').length, 0);
});

test('the member list respects presence privacy', () => {
  const db = makeDb();
  const now = Date.now();
  presenceStore.heartbeat(OTHER, 's1', false, now);
  db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'invisible', 'true')").run(QUIET);
  presenceStore.heartbeat(QUIET, 's1', false, now);

  const page = listCommunityMembers(db, USER, { limit: 10, offset: 0 }, now);
  assert.equal(page.total, 5);
  const deniz = page.items.find((item) => item.userId === OTHER);
  const ece = page.items.find((item) => item.userId === QUIET);
  assert.equal(deniz?.status, 'online');
  assert.equal(ece?.status, 'offline', 'invisible members look offline');
  assert.equal(page.items[0]?.role, 'owner', 'owner sorts first');

  const search = listCommunityMembers(db, USER, { q: 'ce', limit: 10 }, now);
  assert.equal(search.items.some((item) => item.username === 'cem'), true);
});

test('staff see the audit trail of restrictions', () => {
  const db = makeDb();
  setCommunityRole(db, OWNER, MOD, 'moderator');
  restrictMember(db, MOD, USER, 'mute', 5, 'spam');
  clearRestriction(db, MOD, USER, 'mute');
  const log = moderationLog(db);
  assert.ok(log.length >= 2);
  assert.equal(log[0]?.action, 'unmute');
  assert.equal(log[1]?.action, 'mute');
});

test('suspended members cannot read the feed', () => {
  const db = makeDb();
  setCommunityRole(db, OWNER, MOD, 'moderator');
  restrictMember(db, MOD, USER, 'suspend', 30, null);
  assert.equal(restrictions(db, USER).reason, 'suspended');
  assert.equal(restrictions(db, OTHER).canPost, true);
});
