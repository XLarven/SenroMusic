import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  acceptRequest,
  blockUser,
  cancelRequest,
  declineRequest,
  friendCounts,
  getRelationship,
  listFriends,
  listNotifications,
  listRequests,
  pairKey,
  pushNotification,
  removeFriend,
  sendRequest,
  unblockUser,
} from '../src/friends.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      username TEXT,
      avatar_url TEXT,
      bio TEXT,
      profile_visibility TEXT NOT NULL DEFAULT 'public'
    );
    CREATE TABLE friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pair_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (requester_id <> addressee_id),
      CHECK (status IN ('pending', 'accepted')),
      UNIQUE (pair_key)
    );
    CREATE TABLE user_blocks (
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      actor_id TEXT,
      entity_id TEXT,
      dedupe_key TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_notifications_dedupe
      ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
  `);
  const insert = db.prepare(
    'INSERT INTO users (id, email, display_name, username, profile_visibility) VALUES (?, ?, ?, ?, ?)',
  );
  insert.run('u_alice', 'a@x', 'Alice', 'alice', 'public');
  insert.run('u_bob', 'b@x', 'Bob', 'bob', 'public');
  insert.run('u_carol', 'c@x', 'Carol', 'carol', 'private');
  return db;
}

test('pair key is order independent', () => {
  assert.equal(pairKey('u_a', 'u_b'), pairKey('u_b', 'u_a'));
});

test('request lifecycle: send, duplicate, accept', () => {
  const db = makeDb();
  const sent = sendRequest(db, 'u_alice', 'u_bob');
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'pending_out');
  assert.equal(getRelationship(db, 'u_bob', 'u_alice').state, 'pending_in');

  const duplicate = sendRequest(db, 'u_alice', 'u_bob');
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, 'already_requested');

  const accepted = acceptRequest(db, 'u_bob', sent.value.requestId);
  assert.equal(accepted.ok, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'friends');
  assert.equal(friendCounts(db, 'u_alice').friends, 1);
});

test('mirrored request auto-accepts instead of creating a second row', () => {
  const db = makeDb();
  sendRequest(db, 'u_alice', 'u_bob');
  const reverse = sendRequest(db, 'u_bob', 'u_alice');
  assert.equal(reverse.ok, true);
  if (reverse.ok) assert.equal(reverse.value.autoAccepted, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'friends');
  const rows = db.prepare('SELECT COUNT(*) AS c FROM friendships').get() as { c: number };
  assert.equal(rows.c, 1);
});

test('self requests are refused', () => {
  const db = makeDb();
  const result = sendRequest(db, 'u_alice', 'u_alice');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'self');
});

test('only the addressee may accept', () => {
  const db = makeDb();
  const sent = sendRequest(db, 'u_alice', 'u_bob');
  if (!sent.ok) throw new Error('setup failed');
  const wrong = acceptRequest(db, 'u_carol', sent.value.requestId);
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.code, 'forbidden');
  const second = acceptRequest(db, 'u_bob', sent.value.requestId);
  assert.equal(second.ok, true);
  const again = acceptRequest(db, 'u_bob', sent.value.requestId);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.code, 'already_friends');
});

test('decline and cancel remove the request', () => {
  const db = makeDb();
  const first = sendRequest(db, 'u_alice', 'u_bob');
  if (!first.ok) throw new Error('setup failed');
  assert.equal(declineRequest(db, 'u_bob', first.value.requestId).ok, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'none');

  const second = sendRequest(db, 'u_alice', 'u_bob');
  if (!second.ok) throw new Error('setup failed');
  assert.equal(cancelRequest(db, 'u_alice', second.value.requestId).ok, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'none');

  const wrongCancel = sendRequest(db, 'u_alice', 'u_bob');
  if (!wrongCancel.ok) throw new Error('setup failed');
  const byOther = cancelRequest(db, 'u_bob', wrongCancel.value.requestId);
  assert.equal(byOther.ok, false);
});

test('removing a friend clears the pair', () => {
  const db = makeDb();
  const sent = sendRequest(db, 'u_alice', 'u_bob');
  if (!sent.ok) throw new Error('setup failed');
  acceptRequest(db, 'u_bob', sent.value.requestId);
  assert.equal(removeFriend(db, 'u_alice', 'u_bob').ok, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'none');
  const again = removeFriend(db, 'u_alice', 'u_bob');
  assert.equal(again.ok, false);
});

test('blocking ends the relationship and refuses requests both ways', () => {
  const db = makeDb();
  const sent = sendRequest(db, 'u_alice', 'u_bob');
  if (!sent.ok) throw new Error('setup failed');
  acceptRequest(db, 'u_bob', sent.value.requestId);

  assert.equal(blockUser(db, 'u_alice', 'u_bob').ok, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'blocked');
  assert.equal(getRelationship(db, 'u_bob', 'u_alice').state, 'blocked');

  const fromAlice = sendRequest(db, 'u_alice', 'u_bob');
  assert.equal(fromAlice.ok, false);
  const fromBob = sendRequest(db, 'u_bob', 'u_alice');
  assert.equal(fromBob.ok, false);

  assert.equal(unblockUser(db, 'u_alice', 'u_bob').ok, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'none');
});

test('private profiles are not discoverable for requests', () => {
  const db = makeDb();
  const result = sendRequest(db, 'u_alice', 'u_carol');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'not_found');
});

test('lists paginate and filter blocked accounts', () => {
  const db = makeDb();
  // Carol is private by default; open her profile for this data-set.
  db.prepare("UPDATE users SET profile_visibility = 'public' WHERE id = 'u_carol'").run();
  for (const other of ['u_bob', 'u_carol']) {
    const sent = sendRequest(db, 'u_alice', other);
    if (!sent.ok) continue;
    acceptRequest(db, other, sent.value.requestId);
  }
  const page = listFriends(db, 'u_alice', 1, 0);
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  const second = listFriends(db, 'u_alice', 1, 1);
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0]?.id, page.items[0]?.id);

  blockUser(db, 'u_alice', 'u_bob');
  const afterBlock = listFriends(db, 'u_alice', 10, 0);
  assert.equal(afterBlock.total, 1);
  assert.equal(afterBlock.items[0]?.id, 'u_carol');
});

test('notifications dedupe on the same key', () => {
  const db = makeDb();
  pushNotification(db, { userId: 'u_bob', kind: 'friend_request', actorId: 'u_alice', entityId: '1', dedupeKey: 'friend_request:1' });
  pushNotification(db, { userId: 'u_bob', kind: 'friend_request', actorId: 'u_alice', entityId: '1', dedupeKey: 'friend_request:1' });
  const list = listNotifications(db, 'u_bob');
  assert.equal(list.total, 1);
  assert.equal(list.unread, 1);
});

test('pending request lists split by direction', () => {
  const db = makeDb();
  sendRequest(db, 'u_alice', 'u_bob');
  const incoming = listRequests(db, 'u_bob', 'in');
  assert.equal(incoming.items.length, 1);
  assert.equal(incoming.items[0]?.user.id, 'u_alice');
  const outgoing = listRequests(db, 'u_alice', 'out');
  assert.equal(outgoing.items.length, 1);
  assert.equal(outgoing.items[0]?.user.id, 'u_bob');
  const bobOut = listRequests(db, 'u_bob', 'out');
  assert.equal(bobOut.items.length, 0);
});

test('two simultaneous accepts cannot both win', () => {
  const db = makeDb();
  const sent = sendRequest(db, 'u_alice', 'u_bob');
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const requestId = sent.value.requestId;

  // The first accept flips the row; the second must lose the compare-and-set
  // instead of re-notifying or resurrecting the request.
  const first = acceptRequest(db, 'u_bob', requestId);
  const second = acceptRequest(db, 'u_bob', requestId);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) assert.ok(['conflict', 'already_friends'].includes(second.code));

  const rows = db.prepare('SELECT * FROM friendships WHERE pair_key = ?').all(pairKey('u_alice', 'u_bob'));
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { status: string }).status, 'accepted');
  assert.equal(getRelationship(db, 'u_bob', 'u_alice').state, 'friends');
});

test('a declined request cannot then be accepted', () => {
  const db = makeDb();
  const sent = sendRequest(db, 'u_alice', 'u_bob');
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(declineRequest(db, 'u_bob', sent.value.requestId).ok, true);
  const late = acceptRequest(db, 'u_bob', sent.value.requestId);
  assert.equal(late.ok, false);
  if (!late.ok) assert.ok(['not_found', 'conflict'].includes(late.code));
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'none');
});

test('a removed friend can be re-added once', () => {
  const db = makeDb();
  const first = sendRequest(db, 'u_alice', 'u_bob');
  if (!first.ok) return;
  acceptRequest(db, 'u_bob', first.value.requestId);
  assert.equal(removeFriend(db, 'u_alice', 'u_bob').ok, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'none');

  const again = sendRequest(db, 'u_alice', 'u_bob');
  assert.equal(again.ok, true);
  if (!again.ok) return;
  const duplicate = sendRequest(db, 'u_alice', 'u_bob');
  assert.equal(duplicate.ok, false);
  const reverse = sendRequest(db, 'u_bob', 'u_alice');
  assert.equal(reverse.ok, true, 'the mirrored request auto-accepts the pair');
  if (reverse.ok) assert.equal(reverse.value.autoAccepted, true);
  assert.equal(getRelationship(db, 'u_alice', 'u_bob').state, 'friends');
});
