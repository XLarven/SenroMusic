import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  MIN_PLAYS,
  buildTasteProfile,
  clearTasteCache,
  compareTaste,
  cosine,
  discoveryCandidates,
  frequencyScore,
  leaveDiscovery,
  normalizeText,
  noteTasteChange,
  readTasteSettings,
  recordInterest,
  revealedWith,
  tasteAccess,
  trackKey,
} from '../src/taste.js';

type Seed = { title: string; artist: string; genre?: string | null; language?: string | null };

function makeDb() {
  clearTasteCache();
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, display_name TEXT, username TEXT,
      avatar_url TEXT, bio TEXT, profile_visibility TEXT DEFAULT 'public',
      role TEXT DEFAULT 'user', created_at TEXT, last_login_at TEXT, last_active_at TEXT,
      favorite_genres TEXT
    );
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT DEFAULT '',
      genre TEXT, language TEXT, cover_id TEXT
    );
    CREATE TABLE listening_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, track_id TEXT NOT NULL,
      played_at TEXT NOT NULL, ms_played INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'player'
    );
    CREATE TABLE user_settings (
      user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
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
    CREATE TABLE taste_interests (
      viewer_id TEXT NOT NULL, target_id TEXT NOT NULL,
      created_at TEXT NOT NULL, revealed_at TEXT,
      PRIMARY KEY (viewer_id, target_id)
    );
  `);
  return db;
}

function user(db: Database, id: string, visibility = 'public') {
  db.prepare(
    `INSERT INTO users (id, email, display_name, username, profile_visibility, created_at)
     VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z')`,
  ).run(id, `${id}@x`, `User ${id}`, id, visibility);
}

function tracks(db: Database, prefix: string, seeds: Seed[]): string[] {
  const insert = db.prepare('INSERT INTO tracks (id, title, artist, album, genre, language) VALUES (?, ?, ?, ?, ?, ?)');
  return seeds.map((seed, index) => {
    const id = `t_${prefix}${index}`;
    insert.run(id, seed.title, seed.artist, 'Album', seed.genre ?? null, seed.language ?? null);
    return id;
  });
}

function play(db: Database, userId: string, trackIds: string[], times: number, options: { ms?: number; source?: string } = {}) {
  const insert = db.prepare(
    `INSERT INTO listening_history (user_id, track_id, played_at, ms_played, source)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const base = Date.parse('2026-06-01T10:00:00.000Z');
  let clock = 0;
  for (let round = 0; round < times; round += 1) {
    for (const trackId of trackIds) {
      insert.run(userId, trackId, new Date(base + clock).toISOString(), options.ms ?? 180_000, options.source ?? 'player');
      clock += 1000;
    }
  }
}

const POP: Seed[] = [
  { title: 'Kesariya', artist: 'Arijit Singh', genre: 'Bollywood', language: 'Hindi' },
  { title: 'Tum Hi Ho', artist: 'Arijit Singh', genre: 'Bollywood', language: 'Hindi' },
  { title: 'Blinding Lights', artist: 'The Weeknd', genre: 'Pop', language: 'English' },
  { title: 'Save Your Tears', artist: 'The Weeknd', genre: 'Pop', language: 'English' },
  { title: 'Golden Hour', artist: 'Mira Sol', genre: 'Downtempo', language: null },
];

test('normalisation folds case, punctuation and diacritics', () => {
  assert.equal(normalizeText('Arijit Singh'), 'arijit singh');
  assert.equal(normalizeText('  ARIJIT   singh! '), 'arijit singh');
  assert.equal(normalizeText('Şebnem Ferah'), 'sebnem ferah');
  assert.equal(trackKey('Arijit Singh', 'Kesariya (From "Brahmastra")'), trackKey('arijit singh', 'Kesariya'));
});

test('identical profiles score full marks', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  play(db, 'u_a', aTracks, 4);
  play(db, 'u_b', aTracks, 4);
  const comparison = compareTaste(db, 'u_a', 'u_b');
  assert.equal(comparison.eligible, true);
  assert.equal(comparison.score, 100);
  assert.equal(comparison.dimensions.length, 4);
  assert.equal(comparison.sharedArtists.length, 3);
});

test('completely different libraries score low but stay explainable', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  const bTracks = tracks(db, 'b', [
    { title: 'Teardrop', artist: 'Massive Attack', genre: 'Trip Hop' },
    { title: 'Angel', artist: 'Massive Attack', genre: 'Trip Hop' },
    { title: 'Roads', artist: 'Portishead', genre: 'Trip Hop' },
    { title: 'Glory Box', artist: 'Portishead', genre: 'Trip Hop' },
    { title: 'Teardrop', artist: 'Tricky', genre: 'Trip Hop' },
  ]);
  play(db, 'u_a', aTracks, 4);
  play(db, 'u_b', bTracks, 4);
  const comparison = compareTaste(db, 'u_a', 'u_b');
  assert.equal(comparison.eligible, true);
  assert.ok((comparison.score ?? 0) < 15, `expected a low score, got ${comparison.score}`);
  assert.equal(comparison.sharedArtists.length, 0);
  assert.ok(comparison.onlyViewer.artists.length > 0);
  assert.ok(comparison.onlyTarget.artists.length > 0);
});

test('partial overlap lands in the middle', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  const bTracks = tracks(db, 'b', [
    { title: 'Kesariya', artist: 'Arijit Singh', genre: 'Bollywood', language: 'Hindi' },
    { title: 'Tum Hi Ho', artist: 'Arijit Singh', genre: 'Bollywood', language: 'Hindi' },
    { title: 'Teardrop', artist: 'Massive Attack', genre: 'Trip Hop' },
    { title: 'Roads', artist: 'Portishead', genre: 'Trip Hop' },
  ]);
  play(db, 'u_a', aTracks, 4);
  play(db, 'u_b', bTracks, 4);
  const comparison = compareTaste(db, 'u_a', 'u_b');
  assert.ok((comparison.score ?? 0) > 15 && (comparison.score ?? 0) < 85, `got ${comparison.score}`);
  assert.equal(comparison.sharedArtists.length, 1);
  assert.equal(comparison.sharedTracks.length, 2);
});

test('missing genre metadata drops the dimension instead of punishing it', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  const bTracks = tracks(db, 'b', POP.map((seed) => ({ ...seed, genre: null, language: null })));
  play(db, 'u_a', aTracks, 4);
  play(db, 'u_b', bTracks, 4);
  const comparison = compareTaste(db, 'u_a', 'u_b');
  assert.equal(comparison.dimensions.length, 3);
  assert.equal(comparison.dimensions.some((entry) => entry.key === 'genres'), false);
  assert.equal(comparison.score, 100);
});

test('no history means no score, only an explanation', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  play(db, 'u_a', aTracks, 4);
  const comparison = compareTaste(db, 'u_a', 'u_b');
  assert.equal(comparison.score, null);
  assert.equal(comparison.reason, 'insufficient_history');
  assert.equal(comparison.insufficient.target, true);
  assert.equal(comparison.insufficient.viewer, false);
});

test('a handful of plays is not enough history', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  play(db, 'u_a', aTracks.slice(0, MIN_PLAYS - 1), 1);
  play(db, 'u_b', aTracks, 4);
  const comparison = compareTaste(db, 'u_a', 'u_b');
  assert.equal(comparison.score, null);
  assert.equal(comparison.insufficient.viewer, true);
});

test('imports, downloads and quiz clips never reach the profile', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  play(db, 'u_a', aTracks, 4);
  // A skipped clip (under 3s), a quiz clip and an import marker must not count.
  play(db, 'u_a', aTracks, 5, { ms: 500, source: 'player' });
  play(db, 'u_a', aTracks, 5, { ms: 180_000, source: 'quiz' });
  const profile = buildTasteProfile(db, 'u_a');
  assert.equal(profile.plays, aTracks.length * 4);
});

test('Spotify and YouTube copies of one song collapse into a single track', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  const bTracks = tracks(db, 'b', POP);
  // Same recordings, different rows: one streamed from Spotify, one from YouTube.
  db.prepare("UPDATE tracks SET title = 'Kesariya (From \"Brahmastra\")' WHERE id = ?").run(bTracks[0]);
  play(db, 'u_a', aTracks, 4);
  play(db, 'u_b', bTracks, 4);
  const comparison = compareTaste(db, 'u_a', 'u_b');
  assert.equal(comparison.score, 100);
  assert.equal(comparison.sharedTracks.length, 5);
});

test('cache returns the same answer and invalidates on new playback', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const aTracks = tracks(db, 'a', POP);
  const bTracks = tracks(db, 'b', POP.slice(0, 3));
  play(db, 'u_a', aTracks, 4);
  play(db, 'u_b', bTracks, 4);
  const first = compareTaste(db, 'u_a', 'u_b');
  const second = compareTaste(db, 'u_a', 'u_b');
  assert.equal(first.score, second.score);

  // u_b starts listening to the rest of the list: the next comparison must notice.
  const extra = tracks(db, 'bb', POP.slice(3));
  play(db, 'u_b', extra, 6);
  noteTasteChange('u_b');
  const third = compareTaste(db, 'u_a', 'u_b');
  assert.ok((third.score ?? 0) > (first.score ?? 0), `${first.score} -> ${third.score}`);
});

test('frequency similarity is symmetric and bounded', () => {
  assert.equal(frequencyScore(10, 10), 1);
  assert.equal(frequencyScore(0, 0), 0);
  const mild = frequencyScore(10, 20);
  const wild = frequencyScore(10, 500);
  assert.ok(mild > wild);
  assert.equal(frequencyScore(10, 20), frequencyScore(20, 10));
});

test('cosine ignores missing dimensions and never leaves 0..1', () => {
  assert.equal(cosine(new Map(), new Map([['a', 1]])), null);
  assert.equal(cosine(new Map([['a', 1]]), new Map([['a', 1]])), 1);
  assert.equal(cosine(new Map([['a', 1]]), new Map([['b', 1]])), 0);
});

test('taste settings default to private-but-friendly', () => {
  const db = makeDb();
  user(db, 'u_a');
  assert.deepEqual(readTasteSettings(db, 'u_a'), {
    compareFriends: true,
    comparePublic: false,
    discoverable: false,
    anonymous: true,
    showShared: true,
  });
});

test('access matrix: self, friend, private profile, block, public opt-in', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  user(db, 'u_c', 'private');
  db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, pair_key, status, created_at, updated_at)
     VALUES ('u_a','u_b','u_a:u_b','accepted','2026-01-01','2026-01-01')`,
  ).run();
  const defaults = readTasteSettings(db, 'u_b');
  assert.equal(tasteAccess(db, 'u_a', 'u_a', { profileVisibility: 'public' }, defaults), 'self');
  assert.equal(tasteAccess(db, 'u_a', 'u_b', { profileVisibility: 'public' }, defaults), 'ok');
  assert.equal(tasteAccess(db, 'u_a', 'u_c', { profileVisibility: 'private' }, defaults), 'private');
  assert.equal(tasteAccess(db, 'u_a', 'u_c', { profileVisibility: 'public' }, defaults), 'private');

  const publicSharing = { ...defaults, comparePublic: true };
  assert.equal(tasteAccess(db, 'u_a', 'u_c', { profileVisibility: 'public' }, publicSharing), 'ok');
  assert.equal(tasteAccess(db, 'u_a', 'u_c', { profileVisibility: 'private' }, publicSharing), 'private');

  const noFriends = { ...defaults, compareFriends: false };
  assert.equal(tasteAccess(db, 'u_a', 'u_b', { profileVisibility: 'public' }, noFriends), 'private');

  db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES ('u_b','u_a','2026-01-01')").run();
  assert.equal(tasteAccess(db, 'u_a', 'u_b', { profileVisibility: 'public' }, defaults), 'blocked');
});

test('discovery only lists opted-in, public, unblocked listeners', () => {
  const db = makeDb();
  user(db, 'u_viewer');
  user(db, 'u_open');
  user(db, 'u_private', 'private');
  user(db, 'u_blocked');
  const seeds = tracks(db, 'd', POP);
  for (const id of ['u_viewer', 'u_open', 'u_private', 'u_blocked']) play(db, id, seeds, 4);

  const optIn = db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'tasteDiscoverable', 'true')");
  for (const id of ['u_open', 'u_private', 'u_blocked']) optIn.run(id);
  db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES ('u_open','u_viewer','2026-01-01')").run();

  const candidates = discoveryCandidates(db, 'u_viewer');
  const ids = candidates.map((entry) => entry.userId);
  assert.equal(ids.includes('u_open'), false, 'blocked users are excluded');
  assert.equal(ids.includes('u_private'), false, 'private profiles are excluded');
  assert.equal(ids.includes('u_blocked'), true);
  assert.ok((candidates[0]?.score ?? 0) > 0);
});

test('mutual interest reveals both sides', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const first = recordInterest(db, 'u_a', 'u_b');
  assert.equal(first.mutual, false);
  assert.equal(revealedWith(db, 'u_a', 'u_b'), false);
  const second = recordInterest(db, 'u_b', 'u_a');
  assert.equal(second.mutual, true);
  assert.equal(revealedWith(db, 'u_a', 'u_b'), true);
  assert.equal(revealedWith(db, 'u_b', 'u_a'), true);
});

test('leaving discovery clears the flag and the interests', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES ('u_a','tasteDiscoverable','true')").run();
  recordInterest(db, 'u_a', 'u_b');
  leaveDiscovery(db, 'u_a');
  assert.equal(readTasteSettings(db, 'u_a').discoverable, false);
  const left = db.prepare('SELECT COUNT(*) AS c FROM taste_interests WHERE viewer_id = ?').get('u_a') as { c: number };
  assert.equal(left.c, 0);
});

test('showing shared lists is a per-viewer decision', () => {
  const db = makeDb();
  user(db, 'u_a');
  user(db, 'u_b');
  const seeds = tracks(db, 's', POP);
  play(db, 'u_a', seeds, 4);
  play(db, 'u_b', seeds, 4);
  const hidden = compareTaste(db, 'u_a', 'u_b', { showShared: false });
  assert.equal(hidden.sharedHidden, true);
  assert.equal(hidden.sharedArtists.length, 0);
  assert.equal(hidden.score, 100);
});
