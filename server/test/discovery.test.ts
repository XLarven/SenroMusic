import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildDiscovery, recordFeedback, removeFeedback, trackIdentity, resetDiscoveryCache } from '../src/discovery.js';
import type { SimilarTrack } from '../src/audio/similar.js';

const USER = 'a1b2c3d4e5f60718293a4b5c';

function makeDb() {
  resetDiscoveryCache();
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT, username TEXT);
    CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT);
    CREATE TABLE listening_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, track_id TEXT,
      played_at TEXT, ms_played INTEGER DEFAULT 180000, source TEXT DEFAULT 'player'
    );
    CREATE TABLE favorites (
      user_id TEXT NOT NULL, track_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, track_id)
    );
    CREATE TABLE discovery_feedback (
      user_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (user_id, kind, value)
    );
  `);
  db.prepare("INSERT INTO users (id, display_name, username) VALUES (?, 'Ada', 'ada')").run(USER);
  const insertTrack = db.prepare('INSERT INTO tracks (id, title, artist) VALUES (?, ?, ?)');
  insertTrack.run('t_a', 'Midnight Drive', 'Nova Lane');
  insertTrack.run('t_b', 'Golden Hour', 'Mira Sol');
  insertTrack.run('t_c', 'Paper Skies', 'Kite & Echo');
  const play = db.prepare(
    "INSERT INTO listening_history (user_id, track_id, played_at, ms_played, source) VALUES (?, ?, ?, 180000, 'player')",
  );
  play.run(USER, 't_a', new Date(Date.now() - 60_000).toISOString());
  play.run(USER, 't_b', new Date(Date.now() - 3_600_000).toISOString());
  play.run(USER, 't_c', new Date(Date.now() - 7_200_000).toISOString());
  db.prepare("INSERT INTO favorites (user_id, track_id, created_at) VALUES (?, 't_b', '2026-01-01')").run(USER);
  return db;
}

function candidate(n: number, artist = 'Nova Lane'): SimilarTrack {
  return {
    id: `yt_vid${String(n).padStart(8, '0')}`,
    title: `Song ${n}`,
    artist,
    thumbnail: `https://i.ytimg.com/vi/vid${n}/hqdefault.jpg`,
    duration: 200,
    url: `https://www.youtube.com/watch?v=vid${n}`,
  };
}

function fetcher(items: SimilarTrack[]) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return items;
  };
  return { fn, calls: () => calls };
}

test('seeds come from real listening history', async () => {
  const db = makeDb();
  const stub = fetcher([candidate(1), candidate(2, 'Mira Sol')]);
  const payload = await buildDiscovery(db, USER, { fetcher: stub.fn });
  assert.equal(payload.personalized, true);
  assert.equal(payload.degraded, false);
  assert.ok(payload.sections.length > 0);
  const titles = payload.sections.map((section) => section.key);
  assert.ok(titles.includes('becauseYouListened'));
});

test('sections never repeat the same track', async () => {
  const db = makeDb();
  const items = [candidate(1), candidate(2), candidate(3), candidate(4), candidate(5, 'Mira Sol')];
  const payload = await buildDiscovery(db, USER, { fetcher: async () => items });
  const ids = payload.sections.flatMap((section) => section.items.map((item) => item.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('a brand-new account still gets real library-based seeds', async () => {
  const db = makeDb();
  db.prepare('DELETE FROM listening_history').run();
  db.prepare('DELETE FROM favorites').run();
  const payload = await buildDiscovery(db, USER, { fetcher: async () => [candidate(1)] });
  assert.equal(payload.personalized, false);
  assert.ok(payload.sections.length > 0);
});

test('feedback removes a track and an artist from later builds', async () => {
  const db = makeDb();
  const items = [candidate(1), candidate(2), candidate(3, 'Kite & Echo')];
  const first = await buildDiscovery(db, USER, { fetcher: async () => items });
  assert.ok(first.sections.some((section) => section.items.length > 0));

  recordFeedback(db, USER, 'track', trackIdentity(items[0]!));
  recordFeedback(db, USER, 'artist', 'kite & echo');
  const second = await buildDiscovery(db, USER, { refresh: true, fetcher: async () => items });
  const remaining = second.sections.flatMap((section) => section.items);
  assert.equal(remaining.some((item) => item.id === items[0]!.id), false);
  assert.equal(remaining.some((item) => item.artist === 'Kite & Echo'), false);

  removeFeedback(db, USER, 'track', trackIdentity(items[0]!));
  removeFeedback(db, USER, 'artist', 'kite & echo');
  const third = await buildDiscovery(db, USER, { refresh: true, fetcher: async () => items });
  assert.ok(third.sections.flatMap((section) => section.items).length > 0);
});

test('the payload is cached until refreshed', async () => {
  const db = makeDb();
  const stub = fetcher([candidate(1)]);
  await buildDiscovery(db, USER, { fetcher: stub.fn });
  const callsAfterFirst = stub.calls();
  assert.ok(callsAfterFirst > 0);
  await buildDiscovery(db, USER, { fetcher: stub.fn });
  assert.equal(stub.calls(), callsAfterFirst, 'cached call must not hit the provider');
  await buildDiscovery(db, USER, { refresh: true, fetcher: stub.fn });
  assert.ok(stub.calls() > callsAfterFirst, 'refresh must query the provider again');
});

test('provider failure degrades instead of inventing rows', async () => {
  const db = makeDb();
  const payload = await buildDiscovery(db, USER, { fetcher: async () => [] });
  assert.equal(payload.degraded, true);
  assert.equal(payload.sections.length, 0);
});

test('refresh rotates the random section', async () => {
  const db = makeDb();
  const items = Array.from({ length: 24 }, (_, index) => candidate(index + 1, `Artist ${index % 6}`));
  const first = await buildDiscovery(db, USER, { fetcher: async () => items });
  const second = await buildDiscovery(db, USER, { refresh: true, fetcher: async () => items });
  const firstRandom = first.sections.find((section) => section.key === 'randomDiscovery')?.items.map((item) => item.id) ?? [];
  const secondRandom = second.sections.find((section) => section.key === 'randomDiscovery')?.items.map((item) => item.id) ?? [];
  assert.ok(firstRandom.length > 0);
  assert.notDeepEqual(firstRandom, secondRandom);
});
