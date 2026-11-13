import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  MAX_GUESSES,
  PARTY_ROUNDS,
  STAGE_POINTS,
  answerParty,
  checkAnswer,
  cleanTitle,
  closeDueRounds,
  createParty,
  dailyHistory,
  ensureChallenge,
  inviteToParty,
  joinParty,
  leaderboard,
  normalizeAnswer,
  openDaily,
  openPractice,
  partyState,
  pickStart,
  pickTrack,
  poolSize,
  quizDay,
  quizStats,
  shiftDay,
  skipStage,
  startRound,
  submitGuess,
  suggestions,
  syncQuizPool,
  updateStreak,
} from '../src/quiz.js';

const USER_A = 'a1b2c3d4e5f60718293a4b5c';
const USER_B = 'b2c3d4e5f60718293a4b5ca1';
const USER_C = 'c3d4e5f60718293a4b5ca1b2';

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
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0, path TEXT, language TEXT,
      cover_id TEXT, format TEXT
    );
    CREATE TABLE quiz_tracks (
      track_id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'intl', language_source TEXT NOT NULL DEFAULT 'unknown',
      duration REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, synced_at TEXT NOT NULL
    );
    CREATE TABLE quiz_challenges (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, category TEXT NOT NULL,
      track_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (day, category)
    );
    CREATE TABLE quiz_attempts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mode TEXT NOT NULL, category TEXT NOT NULL,
      challenge_id TEXT, party_id TEXT, track_id TEXT NOT NULL, preview_start REAL NOT NULL,
      stage INTEGER NOT NULL DEFAULT 0, guesses INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE (user_id, challenge_id)
    );
    CREATE TABLE quiz_guesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL, stage INTEGER NOT NULL,
      guess TEXT NOT NULL, normalized TEXT NOT NULL, correct INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE quiz_daily_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, category TEXT NOT NULL,
      user_id TEXT NOT NULL, attempt_id TEXT NOT NULL UNIQUE, score INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0, preview_seconds REAL, created_at TEXT NOT NULL,
      UNIQUE (user_id, day, category)
    );
    CREATE TABLE quiz_streaks (
      user_id TEXT PRIMARY KEY, current INTEGER NOT NULL DEFAULT 0,
      best INTEGER NOT NULL DEFAULT 0, last_day TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE quiz_parties (
      id TEXT PRIMARY KEY, host_id TEXT NOT NULL, category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', round_no INTEGER NOT NULL DEFAULT 0,
      round_started_at TEXT, round_ends_at TEXT, code TEXT NOT NULL,
      created_at TEXT NOT NULL, closed_at TEXT
    );
    CREATE TABLE quiz_party_members (
      party_id TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL, PRIMARY KEY (party_id, user_id)
    );
    CREATE TABLE quiz_party_rounds (
      party_id TEXT NOT NULL, round_no INTEGER NOT NULL, track_id TEXT NOT NULL,
      preview_start REAL NOT NULL, started_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      revealed_at TEXT, PRIMARY KEY (party_id, round_no)
    );
    CREATE TABLE quiz_party_answers (
      party_id TEXT NOT NULL, round_no INTEGER NOT NULL, user_id TEXT NOT NULL,
      guess_no INTEGER NOT NULL, value TEXT NOT NULL, correct INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      PRIMARY KEY (party_id, round_no, user_id, guess_no)
    );
    CREATE TABLE quiz_party_invites (
      party_id TEXT NOT NULL, user_id TEXT NOT NULL, invited_by TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (party_id, user_id)
    );
  `);
  const insertUser = db.prepare('INSERT INTO users (id, email, display_name, username) VALUES (?, ?, ?, ?)');
  insertUser.run(USER_A, 'a@x', 'Ada', 'ada');
  insertUser.run(USER_B, 'b@x', 'Bea', 'bea');
  insertUser.run(USER_C, 'c@x', 'Cem', 'cem');
  db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, pair_key, status, created_at, updated_at)
     VALUES (?, ?, ?, 'accepted', '2026-01-01', '2026-01-01')`,
  ).run(USER_A, USER_B, [USER_A, USER_B].sort().join(':'));

  const insertTrack = db.prepare(
    `INSERT INTO quiz_tracks (track_id, title, artist, language, language_source, duration, active, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, '2026-01-01')`,
  );
  // language_source = 'script' marks a metadata-verified row; 'unknown' rows are
  // deliberately excluded from the Turkish/International pools.
  insertTrack.run('t_aaa111', 'Kesariya', 'Arijit Singh', 'intl', 'script', 200);
  insertTrack.run('t_bbb222', 'Tum Hi Ho', 'Arijit Singh', 'intl', 'script', 210);
  insertTrack.run('t_ccc333', 'Nereden Bileceksiniz', 'Ahmet Kaya', 'tr', 'script', 240);
  insertTrack.run('t_ddd444', 'Midnight Drive', 'Nova Lane', 'intl', 'script', 180);
  insertTrack.run('t_eee555', 'Golden Hour', 'Mira Sol', 'intl', 'script', 190);
  return db;
}

test('answers are normalised before comparing', () => {
  assert.equal(normalizeAnswer('Kesariya (From "Brahmastra")'), 'kesariya');
  assert.equal(normalizeAnswer('  Şebnem   Ferah '), 'sebnem ferah');
  assert.equal(normalizeAnswer('The Weeknd'), 'weeknd');
  assert.equal(cleanTitle('Brek - İlaç Gibi | Official Music Video'), 'Brek - İlaç Gibi');
});

test('title or specific artist both count', () => {
  const db = makeDb();
  const track = { trackId: 't_ccc333', title: 'Nereden Bileceksiniz', artist: 'Ahmet Kaya' };
  assert.equal(checkAnswer(db, track, 'nereden bileceksiniz').verdict, 'correct');
  assert.equal(checkAnswer(db, track, 'AHMET KAYA').verdict, 'correct');
  assert.equal(checkAnswer(db, track, 'ahmet kya').verdict, 'correct');
});

test('a broad artist guess is ambiguous, not a win', () => {
  const db = makeDb();
  const track = { trackId: 't_aaa111', title: 'Kesariya', artist: 'Arijit Singh' };
  assert.equal(checkAnswer(db, track, 'Arijit Singh').verdict, 'ambiguous');
  assert.equal(checkAnswer(db, track, 'Kesariya').verdict, 'correct');
  assert.equal(checkAnswer(db, track, 'ra').verdict, 'invalid');
});

test('the daily challenge is deterministic and shared', () => {
  const db = makeDb();
  const day = quizDay();
  const first = ensureChallenge(db, day, 'mixed');
  const second = ensureChallenge(db, day, 'mixed');
  assert.equal(first?.id, second?.id);
  assert.equal(first?.trackId, second?.trackId);
  assert.equal(pickTrack(db, first!.id, 'mixed')?.track_id, first?.trackId);
});

test('the daily attempt survives a refresh', () => {
  const db = makeDb();
  const first = openDaily(db, USER_A, 'mixed');
  const second = openDaily(db, USER_A, 'mixed');
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.view.attemptId, second.view.attemptId);
  assert.equal(second.view.status, 'active');
});

test('a correct answer at the first stage scores 10', () => {
  const db = makeDb();
  const opened = openDaily(db, USER_A, 'mixed');
  if (!opened.ok) throw new Error('no daily');
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(opened.view.attemptId) as { track_id: string };
  const track = db.prepare('SELECT title FROM quiz_tracks WHERE track_id = ?').get(attempt.track_id) as { title: string };
  const result = submitGuess(db, USER_A, opened.view.attemptId, track.title);
  assert.equal(result.ok, true);
  if (!result.ok || result.kind !== 'correct') throw new Error('expected correct');
  assert.equal(result.points, STAGE_POINTS[0]);
  assert.equal(result.view.status, 'won');
  assert.ok(result.view.result?.title);
  assert.equal(quizStats(db, USER_A).totalPoints, 10);
  assert.equal(quizStats(db, USER_A).currentStreak, 1);
});

test('five wrong guesses lose the round and reveal the song', () => {
  const db = makeDb();
  const opened = openPractice(db, USER_A, 'intl');
  if (!opened.ok) throw new Error('no practice');
  let view = opened.view;
  for (let index = 0; index < MAX_GUESSES; index += 1) {
    const result = submitGuess(db, USER_A, view.attemptId, `yanlis ${index}`);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    view = result.view;
  }
  assert.equal(view.status, 'lost');
  assert.equal(view.score, 0);
  assert.ok(view.result?.title);
  const retry = submitGuess(db, USER_A, view.attemptId, 'anything');
  assert.equal(retry.ok, false);
});

test('skipping advances the stage but never scores', () => {
  const db = makeDb();
  const opened = openPractice(db, USER_B, 'intl');
  if (!opened.ok) throw new Error('no practice');
  const skipped = skipStage(db, USER_B, opened.view.attemptId);
  assert.equal(skipped.ok, true);
  if (!skipped.ok) return;
  assert.equal(skipped.view.stage, 1);
  assert.equal(skipped.view.guesses, 0);
  assert.equal(skipped.view.possiblePoints, STAGE_POINTS[1]);
  const fourth = [0, 1, 2].reduce((current, _index) => {
    const step = skipStage(db, USER_B, opened.view.attemptId);
    return step.ok ? step.view : current;
  }, skipped.view);
  assert.equal(fourth.stage, STAGE_POINTS.length - 1);
  assert.equal(fourth.possiblePoints, STAGE_POINTS[4]);
});

test('daily scoring records one result and a streak', () => {
  const db = makeDb();
  const opened = openDaily(db, USER_A, 'mixed');
  if (!opened.ok) throw new Error('no daily');
  const row = db.prepare('SELECT track_id FROM quiz_attempts WHERE id = ?').get(opened.view.attemptId) as { track_id: string };
  const title = (db.prepare('SELECT title FROM quiz_tracks WHERE track_id = ?').get(row.track_id) as { title: string }).title;
  submitGuess(db, USER_A, opened.view.attemptId, title);
  const results = db.prepare('SELECT * FROM quiz_daily_results WHERE user_id = ?').all(USER_A);
  assert.equal(results.length, 1);
  const history = dailyHistory(db, USER_A);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.correct, true);
});

test('streaks grow on consecutive days and reset after a gap', () => {
  const db = makeDb();
  const today = quizDay();
  updateStreak(db, USER_C, shiftDay(today, -3));
  updateStreak(db, USER_C, shiftDay(today, -2));
  updateStreak(db, USER_C, shiftDay(today, -1));
  const three = db.prepare('SELECT current, best FROM quiz_streaks WHERE user_id = ?').get(USER_C) as {
    current: number;
    best: number;
  };
  assert.equal(three.current, 3);
  updateStreak(db, USER_C, today);
  assert.equal((db.prepare('SELECT current FROM quiz_streaks WHERE user_id = ?').get(USER_C) as { current: number }).current, 4);
  updateStreak(db, USER_C, shiftDay(today, 5));
  const reset = db.prepare('SELECT current, best FROM quiz_streaks WHERE user_id = ?').get(USER_C) as {
    current: number;
    best: number;
  };
  assert.equal(reset.current, 1);
  assert.equal(reset.best, 4);
});

test('leaderboard orders by points and respects scopes', () => {
  const db = makeDb();
  const day = quizDay();
  const insert = db.prepare(
    `INSERT INTO quiz_daily_results (day, category, user_id, attempt_id, score, correct, preview_seconds, created_at)
     VALUES (?, 'mixed', ?, ?, ?, 1, 4, '2026-01-01')`,
  );
  insert.run(day, USER_A, 'qa_a', 20);
  insert.run(day, USER_B, 'qa_b', 30);
  insert.run(shiftDay(day, -20), USER_C, 'qa_c', 50);
  const daily = leaderboard(db, USER_A, 'daily');
  assert.equal(daily[0]?.userId, USER_B);
  assert.equal(daily.length, 2);
  const all = leaderboard(db, USER_A, 'all');
  assert.equal(all[0]?.userId, USER_C);
  assert.equal(all.length, 3);
  const friends = leaderboard(db, USER_A, 'friends');
  assert.equal(friends.length, 2, 'self plus one friend');
  assert.equal(friends.some((row) => row.userId === USER_C), false);
  assert.equal(daily[0]?.averagePreviewSeconds, 4);
});

test('preview starts always leave room for the longest clip', () => {
  for (const duration of [20, 26, 180, 360]) {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const start = pickStart(duration, seed);
      assert.ok(start >= 2);
      assert.ok(start + 16 <= duration + 0.001, `${start} + 16 > ${duration}`);
    }
  }
});

test('language categories only use verified metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norie-quiz-lang-'));
  const file = join(dir, 'song.wav');
  writeFileSync(file, 'x');
  const db = makeDb();
  db.prepare('DELETE FROM quiz_tracks').run();
  const insert = db.prepare('INSERT INTO tracks (id, title, artist, duration, path) VALUES (?, ?, ?, 150, ?)');
  insert.run('t_tr', 'Şımarık', 'Tarkan', file);
  insert.run('t_intl', 'Blinding Lights', 'The Weeknd', file);
  insert.run('t_cyr', 'Звезда по имени Солнце', 'Кино', file);

  syncQuizPool(db);
  const rows = db
    .prepare('SELECT track_id, language, language_source FROM quiz_tracks ORDER BY track_id')
    .all() as Array<{ track_id: string; language: string; language_source: string }>;
  assert.equal(rows.find((row) => row.track_id === 't_tr')?.language, 'tr');
  assert.equal(rows.find((row) => row.track_id === 't_tr')?.language_source, 'script');
  assert.equal(rows.find((row) => row.track_id === 't_intl')?.language, 'intl');
  assert.equal(rows.find((row) => row.track_id === 't_cyr')?.language, 'unknown');
  assert.equal(rows.find((row) => row.track_id === 't_cyr')?.language_source, 'unknown');

  // Unknown-script rows stay out of both language pools but remain in mixed.
  assert.equal(poolSize(db, 'tr'), 1);
  assert.equal(poolSize(db, 'intl'), 1);
  assert.equal(poolSize(db, 'mixed'), 3);
});

test('the pool only holds tracks with a long enough local file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norie-quiz-'));
  const good = join(dir, 'good.wav');
  const short = join(dir, 'short.wav');
  writeFileSync(good, 'x');
  writeFileSync(short, 'x');
  const db = makeDb();
  db.prepare("DELETE FROM quiz_tracks").run();
  db.prepare("INSERT INTO tracks (id, title, artist, duration, path) VALUES ('t_good', 'Good Song', 'Artist', 120, ?)").run(good);
  db.prepare("INSERT INTO tracks (id, title, artist, duration, path) VALUES ('t_short', 'Short', 'Artist', 10, ?)").run(short);
  db.prepare("INSERT INTO tracks (id, title, artist, duration, path) VALUES ('t_missing', 'Missing', 'Artist', 120, '/nope/x.wav')").run();
  const size = syncQuizPool(db);
  assert.equal(size, 1);
  const rows = db.prepare('SELECT track_id, active FROM quiz_tracks ORDER BY track_id').all() as Array<{
    track_id: string;
    active: number;
  }>;
  assert.equal(rows.find((row) => row.track_id === 't_good')?.active, 1);
  assert.equal(rows.find((row) => row.track_id === 't_short')?.active, 0);
  assert.equal(rows.find((row) => row.track_id === 't_missing')?.active, 0);
});

test('suggestions never include the current answer marker', () => {
  const db = makeDb();
  const list = suggestions(db, 'kes');
  assert.ok(list.includes('Kesariya'));
  const artists = suggestions(db, 'arijit');
  assert.ok(artists.includes('Arijit Singh'));
  assert.deepEqual(suggestions(db, 'k'), []);
});

test('parties gate joins behind a code or an invite', () => {
  const db = makeDb();
  const party = createParty(db, USER_A, 'mixed');
  const wrong = joinParty(db, USER_C, party.id, 'WRONGCODE');
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.code, 'code');
  const withCode = joinParty(db, USER_C, party.id, party.code.toLowerCase());
  assert.equal(withCode.ok, true);

  const second = createParty(db, USER_A, 'mixed');
  assert.equal(inviteToParty(db, second.id, USER_A, USER_B).ok, true);
  assert.equal(joinParty(db, USER_B, second.id, null).ok, true);
  assert.equal(joinParty(db, USER_C, second.id, null).ok, false);
});

test('party rounds are server-timed and reject late answers', () => {
  const db = makeDb();
  const party = createParty(db, USER_A, 'mixed');
  joinParty(db, USER_B, party.id, party.code);
  const now = Date.now();
  const started = startRound(db, party.id, USER_A, now);
  assert.equal(started.ok, true);
  const state = partyState(db, party.id, USER_A, now + 1000);
  assert.equal(state?.roundNo, 1);
  assert.equal(state?.reveal, null);

  const late = answerParty(db, party.id, USER_B, 'anything', now + 120_000);
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.code, 'late');

  const allowed = answerParty(db, party.id, USER_B, 'yanlis', now + 1000);
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.kind, 'wrong');
});

test('a party round reveals after the clock and closes after the last round', () => {
  const db = makeDb();
  const party = createParty(db, USER_A, 'tr');
  joinParty(db, USER_B, party.id, party.code);
  let now = Date.now();
  for (let round = 1; round <= PARTY_ROUNDS; round += 1) {
    const started = startRound(db, party.id, USER_A, now);
    assert.equal(started.ok, true);
    now += 61_000;
    closeDueRounds(db, now);
    const state = partyState(db, party.id, USER_A, now);
    assert.equal(state?.reveal?.roundNo, round);
    assert.ok(state?.reveal?.title);
  }
  const final = partyState(db, party.id, USER_A, now);
  assert.equal(final?.finished, true);
  assert.equal(final?.status, 'finished');
});

test('party scoring follows the same point table', () => {
  const db = makeDb();
  const party = createParty(db, USER_A, 'mixed');
  joinParty(db, USER_B, party.id, party.code);
  const now = Date.now();
  startRound(db, party.id, USER_A, now);
  const round = db.prepare('SELECT track_id FROM quiz_party_rounds WHERE party_id = ? AND round_no = 1').get(party.id) as {
    track_id: string;
  };
  const title = (db.prepare('SELECT title FROM quiz_tracks WHERE track_id = ?').get(round.track_id) as { title: string }).title;
  const firstWrong = answerParty(db, party.id, USER_B, 'nope', now + 1000);
  assert.equal(firstWrong.ok, true);
  const correct = answerParty(db, party.id, USER_B, title, now + 2000);
  assert.equal(correct.ok, true);
  if (!correct.ok || correct.kind !== 'correct') throw new Error('expected correct');
  assert.equal(correct.points, STAGE_POINTS[1]);
  const state = partyState(db, party.id, USER_B, now + 3000);
  assert.equal(state?.yourScore, STAGE_POINTS[1]);
});

test('party answers stop at five per round', () => {
  const db = makeDb();
  const party = createParty(db, USER_A, 'mixed');
  const now = Date.now();
  startRound(db, party.id, USER_A, now);
  for (let index = 0; index < MAX_GUESSES; index += 1) {
    const result = answerParty(db, party.id, USER_A, `tahmin ${index}`, now + 1000);
    assert.equal(result.ok, true);
  }
  const extra = answerParty(db, party.id, USER_A, 'final', now + 2000);
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.code, 'done');
});

test('non-members cannot read a party', () => {
  const db = makeDb();
  const party = createParty(db, USER_A, 'mixed');
  assert.equal(partyState(db, party.id, USER_C), null);
  assert.equal(partyState(db, party.id, USER_A)?.hostId, USER_A);
});
