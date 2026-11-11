import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  deleteMessage,
  editMessage,
  getMessages,
  listConversations,
  markRead,
  messagingPermission,
  openConversation,
  sanitizeBody,
  sendMessage,
  unreadTotal,
  validateAttachment,
} from '../src/messages.js';

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
    CREATE TABLE playlists (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private', cover_url TEXT
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL, user_b TEXT NOT NULL,
      pair_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      CHECK (user_a <> user_b)
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      client_id TEXT,
      attachment_json TEXT,
      created_at TEXT NOT NULL,
      edited_at TEXT,
      deleted_at TEXT,
      UNIQUE (conversation_id, client_id)
    );
    CREATE TABLE conversation_reads (
      conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
      last_read_message_id TEXT, last_read_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    );
  `);
  const insert = db.prepare(
    'INSERT INTO users (id, email, display_name, username, profile_visibility) VALUES (?, ?, ?, ?, ?)',
  );
  insert.run('a1b2c3d4e5f60718293a4b5c', 'a@x', 'Ada', 'ada', 'public');
  insert.run('b2c3d4e5f60718293a4b5ca1', 'b@x', 'Bea', 'bea', 'public');
  insert.run('c3d4e5f60718293a4b5ca1b2', 'c@x', 'Cem', 'cem', 'private');
  const friend = db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, pair_key, status, created_at, updated_at)
     VALUES (?, ?, ?, 'accepted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
  friend.run('a1b2c3d4e5f60718293a4b5c', 'b2c3d4e5f60718293a4b5ca1', 'a1b2c3d4e5f60718293a4b5c:b2c3d4e5f60718293a4b5ca1');
  return db;
}

function pair(db: Database) {
  const opened = openConversation(db, 'a1b2c3d4e5f60718293a4b5c', 'b2c3d4e5f60718293a4b5ca1');
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error('conversation not opened');
  return opened.conversationId;
}

test('text is normalised, not trusted', () => {
  assert.equal(sanitizeBody('  hi  '), 'hi');
  assert.equal(sanitizeBody('a\u0000b'), 'ab');
  assert.equal(sanitizeBody('line1\r\nline2'), 'line1\nline2');
  assert.equal(sanitizeBody('   '), null);
  assert.equal(sanitizeBody(42), null);
  assert.equal(sanitizeBody('x'.repeat(5000))?.length, 2000);
});

test('only friends can open a conversation', () => {
  const db = makeDb();
  const denied = openConversation(db, 'a1b2c3d4e5f60718293a4b5c', 'c3d4e5f60718293a4b5ca1b2');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, 'not_friends');
  assert.equal(openConversation(db, 'a1b2c3d4e5f60718293a4b5c', 'a1b2c3d4e5f60718293a4b5c').ok, false);
});

test('a pair always maps to one conversation', () => {
  const db = makeDb();
  const first = openConversation(db, 'a1b2c3d4e5f60718293a4b5c', 'b2c3d4e5f60718293a4b5ca1');
  const second = openConversation(db, 'b2c3d4e5f60718293a4b5ca1', 'a1b2c3d4e5f60718293a4b5c');
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.conversationId, second.conversationId);
    assert.equal(second.created, false);
  }
});

test('sending stores a message both can read', () => {
  const db = makeDb();
  const id = pair(db);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'selam' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.message.body, 'selam');
  assert.equal(sent.message.senderId, 'a1b2c3d4e5f60718293a4b5c');

  const asPeer = getMessages(db, 'b2c3d4e5f60718293a4b5ca1', id);
  assert.equal(asPeer?.items.length, 1);
  assert.equal(asPeer?.items[0]?.body, 'selam');
});

test('a stable client id cannot create a duplicate', () => {
  const db = makeDb();
  const id = pair(db);
  const first = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'tek', clientId: 'c1' });
  const second = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'tek', clientId: 'c1' });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.duplicate, true);
  assert.equal(first.message.id, second.message.id);
  assert.equal(getMessages(db, 'a1b2c3d4e5f60718293a4b5c', id)?.items.length, 1);
});

test('empty messages are refused', () => {
  const db = makeDb();
  const id = pair(db);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: '   ' });
  assert.equal(sent.ok, false);
  if (!sent.ok) assert.equal(sent.code, 'empty');
});

test('outsiders cannot read or write a thread', () => {
  const db = makeDb();
  const id = pair(db);
  assert.equal(getMessages(db, 'c3d4e5f60718293a4b5ca1b2', id), null);
  const sent = sendMessage(db, 'c3d4e5f60718293a4b5ca1b2', id, { body: 'hey' });
  assert.equal(sent.ok, false);
  if (!sent.ok) assert.equal(sent.code, 'not_found');
});

test('only the author can edit or delete', () => {
  const db = makeDb();
  const id = pair(db);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'first' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(editMessage(db, 'b2c3d4e5f60718293a4b5ca1', id, sent.message.id, 'hacked'), null);
  const edited = editMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, sent.message.id, 'second');
  assert.equal(edited?.body, 'second');
  assert.ok(edited?.editedAt);
  assert.equal(deleteMessage(db, 'b2c3d4e5f60718293a4b5ca1', id, sent.message.id), null);
  const deleted = deleteMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, sent.message.id);
  assert.ok(deleted?.deletedAt);
  assert.equal(deleted?.body, '');
});

test('deleted messages are not counted as unread', () => {
  const db = makeDb();
  const id = pair(db);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'x' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(unreadTotal(db, 'b2c3d4e5f60718293a4b5ca1'), 1);
  deleteMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, sent.message.id);
  assert.equal(unreadTotal(db, 'b2c3d4e5f60718293a4b5ca1'), 0);
});

test('unread counts reset when the peer reads', () => {
  const db = makeDb();
  const id = pair(db);
  sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'one' });
  sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'two' });
  assert.equal(unreadTotal(db, 'b2c3d4e5f60718293a4b5ca1'), 2);
  assert.equal(unreadTotal(db, 'a1b2c3d4e5f60718293a4b5c'), 0);
  markRead(db, 'b2c3d4e5f60718293a4b5ca1', id, null);
  assert.equal(unreadTotal(db, 'b2c3d4e5f60718293a4b5ca1'), 0);
});

test('conversation list carries the peer, the last message and unread', () => {
  const db = makeDb();
  const id = pair(db);
  sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'merhaba' });
  const page = listConversations(db, 'b2c3d4e5f60718293a4b5ca1');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.peer.displayName, 'Ada');
  assert.equal(page.items[0]?.lastMessage?.body, 'merhaba');
  assert.equal(page.items[0]?.unread, 1);
});

test('history paginates newest-first then reverses for display', () => {
  const db = makeDb();
  const id = pair(db);
  for (let index = 0; index < 5; index += 1) {
    sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: `m${index}`, clientId: `c${index}` });
  }
  const first = getMessages(db, 'a1b2c3d4e5f60718293a4b5c', id, 2);
  assert.equal(first?.items.length, 2);
  assert.equal(first?.hasMore, true);
  assert.equal(first?.items[1]?.body, 'm4');
  const older = getMessages(db, 'a1b2c3d4e5f60718293a4b5c', id, 2, first?.items[0]?.createdAt ?? null);
  assert.equal(older?.items.length, 2);
  assert.equal(older?.hasMore, true);
});

test('blocking hides the thread and stops delivery', () => {
  const db = makeDb();
  const id = pair(db);
  sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'before' });
  db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES ('b2c3d4e5f60718293a4b5ca1','a1b2c3d4e5f60718293a4b5c','2026-01-01T00:00:00.000Z')").run();
  assert.equal(messagingPermission(db, 'a1b2c3d4e5f60718293a4b5c', 'b2c3d4e5f60718293a4b5ca1'), 'blocked');
  assert.equal(getMessages(db, 'a1b2c3d4e5f60718293a4b5c', id), null);
  assert.equal(listConversations(db, 'a1b2c3d4e5f60718293a4b5c').items.length, 0);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'after' });
  assert.equal(sent.ok, false);
  if (!sent.ok) assert.equal(sent.code, 'blocked');
});

test('removed friendship keeps history readable but blocks new messages', () => {
  const db = makeDb();
  const id = pair(db);
  sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'old' });
  db.prepare("UPDATE friendships SET status = 'ended' WHERE pair_key = 'a1b2c3d4e5f60718293a4b5c:b2c3d4e5f60718293a4b5ca1'").run();
  assert.equal(messagingPermission(db, 'a1b2c3d4e5f60718293a4b5c', 'b2c3d4e5f60718293a4b5ca1'), 'not_friends');
  assert.equal(getMessages(db, 'a1b2c3d4e5f60718293a4b5c', id)?.items[0]?.body, 'old');
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, { body: 'new' });
  assert.equal(sent.ok, false);
  if (!sent.ok) assert.equal(sent.code, 'not_friends');
});

test('track attachments need a known id and a known image host', () => {
  const db = makeDb();
  const good = validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', {
    kind: 'track',
    title: 'Kesariya',
    subtitle: 'Arijit Singh',
    trackId: 'yt_brnIlxX_XKs',
    coverUrl: 'https://i.ytimg.com/vi/brnIlxX_XKs/hqdefault.jpg',
    source: 'youtube',
  });
  assert.equal(good?.kind, 'track');
  assert.equal(
    validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', { kind: 'track', title: 'x', trackId: 'javascript:alert(1)' }),
    null,
  );
  const badHost = validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', {
    kind: 'track',
    title: 'x',
    trackId: 'yt_brnIlxX_XKs',
    coverUrl: 'https://evil.example.com/a.png',
  });
  assert.equal(badHost?.coverUrl, null);
  const scripted = validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', {
    kind: 'track',
    title: '<img src=x onerror=alert(1)>',
    trackId: 't_abcdef12',
    coverUrl: 'http://i.ytimg.com/x.jpg',
  });
  // Plain text is kept verbatim (the client escapes it); non-https images drop.
  assert.equal(scripted?.title.includes('<img'), true);
  assert.equal(scripted?.coverUrl, null);
});

test('playlist attachments require a visible, real playlist', () => {
  const db = makeDb();
  db.prepare("INSERT INTO playlists (id, name, owner_id, visibility) VALUES ('pl_aaaa1111','Gece',NULL,'private')").run();
  assert.equal(validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', { kind: 'playlist', playlistId: 'pl_aaaa1111' }), null);
  db.prepare("UPDATE playlists SET visibility = 'public' WHERE id = 'pl_aaaa1111'").run();
  assert.equal(validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', { kind: 'playlist', playlistId: 'pl_aaaa1111' })?.kind, 'playlist');
  assert.equal(validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', { kind: 'playlist', playlistId: 'pl_missing' }), null);
});

test('profile attachments respect private profiles', () => {
  const db = makeDb();
  const self = validateAttachment(db, 'c3d4e5f60718293a4b5ca1b2', { kind: 'profile', userId: 'c3d4e5f60718293a4b5ca1b2' });
  assert.equal(self?.kind, 'profile');
  assert.equal(validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', { kind: 'profile', userId: 'c3d4e5f60718293a4b5ca1b2' }), null);
  const pub = validateAttachment(db, 'a1b2c3d4e5f60718293a4b5c', { kind: 'profile', userId: 'b2c3d4e5f60718293a4b5ca1' });
  assert.equal(pub?.title, 'Bea');
});

test('an invalid attachment fails the whole send', () => {
  const db = makeDb();
  const id = pair(db);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, {
    body: 'look',
    attachment: { kind: 'track', title: 'x', trackId: '${injection}' },
  });
  assert.equal(sent.ok, false);
  if (!sent.ok) assert.equal(sent.code, 'invalid_attachment');
});

test('a message can carry text plus a track', () => {
  const db = makeDb();
  const id = pair(db);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, {
    body: 'bunu dinle',
    attachment: { kind: 'track', title: 'Kesariya', subtitle: 'Arijit Singh', trackId: 'sp_abc123' },
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.message.attachment?.title, 'Kesariya');
  assert.equal(sent.message.attachment?.trackId, 'sp_abc123');
});

test('an attachment alone is a valid message', () => {
  const db = makeDb();
  const id = pair(db);
  const sent = sendMessage(db, 'a1b2c3d4e5f60718293a4b5c', id, {
    attachment: { kind: 'profile', userId: 'b2c3d4e5f60718293a4b5ca1' },
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.message.body, '');
});
