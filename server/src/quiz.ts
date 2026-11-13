/**
 * Music Quiz.
 *
 * Competitive scoring lives entirely here: the client never learns the track
 * before the round is resolved, never sees a score it can change, and cannot
 * replay a daily challenge. Quiz previews are cut on the fly from the user's own
 * library files with ffmpeg — no third-party audio is re-hosted and nothing is
 * written to disk.
 *
 * Provider note: Spotify preview URLs are no longer issued for new apps, Deezer
 * previews are only licensed for their own player, and re-streaming arbitrary
 * YouTube segments is outside the provider's terms. Quiz audio therefore comes
 * from the local NorieMusic library only, which is a file the user already owns.
 */
import type { Database } from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { presenceStore } from './presence.js';
import type { RealtimeEvent } from './presence.js';
import { listFriends } from './friends.js';

export const STAGE_DURATIONS = [1, 2, 4, 8, 16] as const;
export const STAGE_POINTS = [10, 8, 6, 4, 3] as const;
export const MAX_GUESSES = 5;
export const MIN_TRACK_DURATION = 20;
export const DAILY_TIMEZONE = 'Europe/Istanbul';

const PREVIEW_TOKEN_TTL_MS = 15 * 60_000;
const PREVIEW_MAX_PLAYS = 40;
const PARTY_ROUND_MS = 60_000;
export const PARTY_ROUNDS = 5;

export type QuizCategory = 'tr' | 'intl' | 'mixed';

export type QuizResult = {
  title: string;
  artist: string;
  coverUrl: string | null;
};

export type QuizAttemptView = {
  attemptId: string;
  mode: 'daily' | 'practice';
  category: QuizCategory;
  stage: number;
  stageCount: number;
  guesses: number;
  attemptsLeft: number;
  possiblePoints: number;
  previewDuration: number;
  previewUrl: string | null;
  status: 'active' | 'won' | 'lost';
  score: number;
  startedAt: string;
  result: QuizResult | null;
};

/* ---------- time ---------- */

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function quizDay(at: Date = new Date()): string {
  return dayFormatter.format(at);
}

export function shiftDay(day: string, days: number): string {
  const base = Date.parse(`${day}T12:00:00.000Z`);
  return quizDay(new Date(base + days * 86_400_000));
}

/** Next midnight in the quiz timezone, as an ISO timestamp. */
export function nextResetAt(now = new Date()): string {
  const today = quizDay(now);
  const tomorrow = shiftDay(today, 1);
  // Europe/Istanbul is UTC+3 all year; the boundary is explicit in the payload.
  return `${tomorrow}T00:00:00.000+03:00`;
}

/* ---------- pool ---------- */

const TURKISH_MARKERS = /[çğıöşüÇĞİÖŞÜ]/;
/** Latin-script-only metadata; anything else is classified as unknown. */
const LATIN_SCRIPT = /^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]+$/u;
const UNKNOWN_ARTISTS = new Set(['unknown', 'various artists', 'various', '—', '-']);

function guessLanguage(
  title: string,
  artist: string,
  stored: string | null,
): { language: 'tr' | 'intl' | 'unknown'; source: 'tag' | 'script' | 'unknown' } {
  // Only verified signals: an explicit tag, or Turkish-specific characters in
  // the metadata (high precision). Anything else in Latin script is treated as
  // international; other scripts stay unknown and are excluded from the
  // language-specific categories.
  if (stored === 'tr' || stored === 'intl') return { language: stored, source: 'tag' };
  const text = `${title} ${artist}`;
  if (TURKISH_MARKERS.test(text)) return { language: 'tr', source: 'script' };
  if (LATIN_SCRIPT.test(text)) return { language: 'intl', source: 'script' };
  return { language: 'unknown', source: 'unknown' };
}

/** Removes provider noise so the expected answer is just the song name. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*[([][^)\]]*\b(official|lyric|lyrics|video|audio|remaster(ed)?|visualizer|mv|from)\b[^)\]]*[)\]]/gi, ' ')
    .replace(/\s*[|]\s*official.*$/i, '')
    .replace(/\s*-\s*(official|lyrics?|audio|video|visualizer)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Refreshes the eligible pool from the real library. Returns the pool size. */
export function syncQuizPool(db: Database, now = new Date()): number {
  const rows = db
    .prepare('SELECT id, title, artist, language, duration, path FROM tracks')
    .all() as Array<{ id: string; title: string; artist: string; language: string | null; duration: number; path: string }>;
  const at = now.toISOString();
  const upsert = db.prepare(
    `INSERT INTO quiz_tracks (track_id, title, artist, language, language_source, duration, active, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET
       title = excluded.title, artist = excluded.artist, language = excluded.language,
       language_source = excluded.language_source,
       duration = excluded.duration, active = excluded.active, synced_at = excluded.synced_at`,
  );
  let eligible = 0;
  const keep = new Set<string>();
  for (const row of rows) {
    const usable =
      Number(row.duration) >= MIN_TRACK_DURATION && Boolean(row.path) && existsSync(row.path) && Boolean(cleanTitle(row.title));
    if (usable) {
      eligible += 1;
      keep.add(row.id);
    }
    const classified = guessLanguage(row.title, row.artist, row.language);
    upsert.run(
      row.id,
      cleanTitle(row.title) || row.title,
      row.artist,
      classified.language,
      classified.source,
      Number(row.duration) || 0,
      usable ? 1 : 0,
      at,
    );
  }
  const activeRows = db.prepare('SELECT track_id FROM quiz_tracks WHERE active = 1').all() as Array<{ track_id: string }>;
  const deactivate = db.prepare('UPDATE quiz_tracks SET active = 0 WHERE track_id = ?');
  for (const row of activeRows) if (!keep.has(row.track_id)) deactivate.run(row.track_id);
  return eligible;
}

type PoolRow = { track_id: string; title: string; artist: string; language: string; duration: number };

/**
 * Rows imported before language metadata existed carry the migration default
 * (`language_source = 'unknown'`). Re-derive their classification from the stored
 * title/artist so the language pools are populated without touching any quiz
 * score, streak or daily history.
 */
export function reclassifyStoredLanguages(db: Database): number {
  const rows = db
    .prepare("SELECT track_id, title, artist, language FROM quiz_tracks WHERE language_source = 'unknown'")
    .all() as Array<{ track_id: string; title: string; artist: string; language: string }>;
  const update = db.prepare('UPDATE quiz_tracks SET language = ?, language_source = ? WHERE track_id = ?');
  let changed = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      const classified = guessLanguage(row.title, row.artist, null);
      if (classified.source === 'unknown' && row.language !== 'unknown') {
        // No reliable signal: keep it out of both language pools.
        update.run('unknown', 'unknown', row.track_id);
        changed += 1;
        continue;
      }
      if (classified.language === row.language && classified.source === 'unknown') continue;
      update.run(classified.language, classified.source, row.track_id);
      changed += 1;
    }
  });
  run();
  return changed;
}

function poolRows(db: Database, category: QuizCategory): PoolRow[] {
  if (category === 'mixed') {
    return db.prepare('SELECT * FROM quiz_tracks WHERE active = 1').all() as PoolRow[];
  }
  return db
    .prepare("SELECT * FROM quiz_tracks WHERE active = 1 AND language = ? AND language_source <> 'unknown'")
    .all(category) as PoolRow[];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic pick: same seed, same track, for everyone. */
export function pickTrack(db: Database, seed: string, category: QuizCategory): PoolRow | null {
  const rows = poolRows(db, category);
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => hashString(`${seed}:${a.track_id}`) - hashString(`${seed}:${b.track_id}`))[0] ?? null;
}

export function poolSize(db: Database, category: QuizCategory): number {
  return poolRows(db, category).length;
}

/** Start offset that always leaves room for the longest preview window. */
export function pickStart(duration: number, seed: string): number {
  const maxStart = Math.max(2, Math.floor(duration - 18));
  const span = Math.max(1, maxStart - 2);
  return 2 + (hashString(seed) % span);
}

/* ---------- matching ---------- */

export function normalizeAnswer(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\bfeat\b.*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j] ?? 0;
      previous[j] = Math.min((previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return previous[b.length] ?? 99;
}

function matches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const tolerance = Math.max(a.length, b.length) >= 6 ? 1 : 0;
  return tolerance > 0 && distance(a, b) <= tolerance;
}

export type GuessCheck = 'correct' | 'wrong' | 'ambiguous' | 'invalid';

export function checkAnswer(
  db: Database,
  track: { trackId: string; title: string; artist: string },
  rawGuess: string,
): { verdict: GuessCheck; normalized: string } {
  const normalized = normalizeAnswer(rawGuess);
  if (normalized.length < 3) return { verdict: 'invalid', normalized };
  const title = normalizeAnswer(track.title);
  const artist = normalizeAnswer(track.artist);
  if (matches(normalized, title)) return { verdict: 'correct', normalized };
  if (artist && !UNKNOWN_ARTISTS.has(artist) && matches(normalized, artist)) {
    // An artist with several eligible songs would be a shortcut, not an answer.
    const count = (
      db
        .prepare('SELECT COUNT(*) AS c FROM quiz_tracks WHERE active = 1 AND lower(artist) = lower(?)')
        .get(track.artist) as { c: number }
    ).c;
    if (count > 1) return { verdict: 'ambiguous', normalized };
    return { verdict: 'correct', normalized };
  }
  return { verdict: 'wrong', normalized };
}

/* ---------- previews ---------- */

type PreviewGrant = {
  trackId: string;
  start: number;
  duration: number;
  attemptId: string | null;
  partyId: string | null;
  roundNo: number | null;
  expires: number;
  plays: number;
};

const previewGrants = new Map<string, PreviewGrant>();

export function issuePreview(grant: Omit<PreviewGrant, 'expires' | 'plays'>): string {
  const token = randomBytes(18).toString('base64url');
  previewGrants.set(token, { ...grant, expires: Date.now() + PREVIEW_TOKEN_TTL_MS, plays: 0 });
  if (previewGrants.size > 2000) {
    const cutoff = Date.now();
    for (const [key, value] of previewGrants) if (value.expires < cutoff) previewGrants.delete(key);
  }
  return `/api/quiz/preview/${token}`;
}

export function takePreview(token: string): PreviewGrant | null {
  const grant = previewGrants.get(token);
  if (!grant) return null;
  if (grant.expires < Date.now()) {
    previewGrants.delete(token);
    return null;
  }
  if (grant.plays >= PREVIEW_MAX_PLAYS) return null;
  grant.plays += 1;
  return grant;
}

export function previewTrackPath(db: Database, trackId: string): string | null {
  const row = db.prepare('SELECT path FROM tracks WHERE id = ?').get(trackId) as { path: string } | undefined;
  return row?.path ?? null;
}

const PYTHON = process.env.PYTHON_PATH || 'python';
let ffmpegPath: string | null = null;

function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegPath) return ffmpegPath;
  try {
    const stdout = execFileSync(
      PYTHON,
      ['-c', 'import imageio_ffmpeg,sys; sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    const candidate = stdout.trim();
    if (candidate) {
      ffmpegPath = candidate;
      return candidate;
    }
  } catch {
    // fall through
  }
  ffmpegPath = 'ffmpeg';
  return ffmpegPath;
}

/** One ffmpeg process per preview; the clip is streamed, never written. */
export function cutPreview(path: string, start: number, duration: number): ReturnType<typeof spawn> {
  return spawn(
    resolveFfmpeg(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(Math.max(0, start)),
      '-t',
      String(Math.max(0.5, duration)),
      '-i',
      path,
      '-vn',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-f',
      'mp3',
      'pipe:1',
    ],
    { windowsHide: true },
  );
}

export function ffmpegAvailable(): boolean {
  try {
    execFileSync(resolveFfmpeg(), ['-version'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/* ---------- attempts ---------- */

type AttemptRow = {
  id: string;
  user_id: string;
  mode: string;
  category: QuizCategory;
  challenge_id: string | null;
  party_id: string | null;
  track_id: string;
  preview_start: number;
  stage: number;
  guesses: number;
  status: string;
  score: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function trackInfo(db: Database, trackId: string): { title: string; artist: string; coverUrl: string | null } | null {
  const row = db.prepare('SELECT title, artist, cover_id FROM tracks WHERE id = ?').get(trackId) as
    | { title: string; artist: string; cover_id: string | null }
    | undefined;
  // The pool holds the cleaned metadata used for answers; prefer it for display
  // so reveals match what was accepted as correct.
  const pool = db.prepare('SELECT title, artist FROM quiz_tracks WHERE track_id = ?').get(trackId) as
    | { title: string; artist: string }
    | undefined;
  if (pool) {
    return { title: pool.title, artist: pool.artist, coverUrl: row?.cover_id ? `/api/covers/${row.cover_id}` : null };
  }
  if (row) return { title: row.title, artist: row.artist, coverUrl: row.cover_id ? `/api/covers/${row.cover_id}` : null };
  return null;
}

function view(db: Database, attempt: AttemptRow): QuizAttemptView {
  const result =
    attempt.status === 'active' ? null : (trackInfo(db, attempt.track_id) ?? { title: '', artist: '', coverUrl: null });
  const previewUrl =
    attempt.status === 'active'
      ? issuePreview({
          trackId: attempt.track_id,
          start: attempt.preview_start,
          duration: STAGE_DURATIONS[attempt.stage] ?? 1,
          attemptId: attempt.id,
          partyId: null,
          roundNo: null,
        })
      : null;
  return {
    attemptId: attempt.id,
    mode: attempt.mode === 'practice' ? 'practice' : 'daily',
    category: attempt.category,
    stage: attempt.stage,
    stageCount: STAGE_DURATIONS.length,
    guesses: attempt.guesses,
    attemptsLeft: MAX_GUESSES - attempt.guesses,
    possiblePoints: STAGE_POINTS[attempt.stage] ?? 0,
    previewDuration: STAGE_DURATIONS[attempt.stage] ?? 1,
    previewUrl,
    status: (attempt.status as QuizAttemptView['status']) ?? 'active',
    score: attempt.score,
    startedAt: attempt.created_at,
    result,
  };
}

function getAttempt(db: Database, id: string): AttemptRow | null {
  return (db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(id) as AttemptRow | undefined) ?? null;
}

export function ensureChallenge(
  db: Database,
  day: string,
  category: QuizCategory,
): { id: string; trackId: string } | null {
  const id = `dq_${day}_${category}`;
  const existing = db.prepare('SELECT id, track_id FROM quiz_challenges WHERE id = ?').get(id) as
    | { id: string; track_id: string }
    | undefined;
  if (existing) return { id: existing.id, trackId: existing.track_id };
  const picked = pickTrack(db, id, category);
  if (!picked) return null;
  db.prepare('INSERT INTO quiz_challenges (id, day, category, track_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    day,
    category,
    picked.track_id,
    nowIso(),
  );
  return { id, trackId: picked.track_id };
}

export function openDaily(
  db: Database,
  userId: string,
  category: QuizCategory,
): { ok: true; view: QuizAttemptView; day: string; resetsAt: string } | { ok: false; code: 'no_tracks' } {
  if (poolRows(db, category).length === 0) return { ok: false, code: 'no_tracks' };
  const day = quizDay();
  const challenge = ensureChallenge(db, day, category);
  if (!challenge) return { ok: false, code: 'no_tracks' };
  const existing = db
    .prepare('SELECT * FROM quiz_attempts WHERE user_id = ? AND challenge_id = ?')
    .get(userId, challenge.id) as AttemptRow | undefined;
  const attempt = existing ?? createAttempt(db, userId, 'daily', category, challenge.id, challenge.trackId, challenge.id);
  return { ok: true, view: view(db, attempt), day, resetsAt: nextResetAt() };
}

function createAttempt(
  db: Database,
  userId: string,
  mode: 'daily' | 'practice',
  category: QuizCategory,
  challengeId: string | null,
  trackId: string,
  seed: string,
): AttemptRow {
  const duration = (
    db.prepare('SELECT duration FROM quiz_tracks WHERE track_id = ?').get(trackId) as { duration: number } | undefined
  )?.duration ?? 30;
  const start = pickStart(duration, `${seed}:${userId}`);
  const id = `qa_${randomBytes(9).toString('hex')}`;
  const at = nowIso();
  db.prepare(
    `INSERT INTO quiz_attempts
       (id, user_id, mode, category, challenge_id, party_id, track_id, preview_start, stage, guesses, status, score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 'active', 0, ?, ?)`,
  ).run(id, userId, mode, category, challengeId, trackId, start, at, at);
  return getAttempt(db, id)!;
}

export function openPractice(
  db: Database,
  userId: string,
  category: QuizCategory,
  fresh = false,
): { ok: true; view: QuizAttemptView } | { ok: false; code: 'no_tracks' } {
  if (poolRows(db, category).length === 0) return { ok: false, code: 'no_tracks' };
  if (!fresh) {
    const active = db
      .prepare(
        `SELECT * FROM quiz_attempts
         WHERE user_id = ? AND mode = 'practice' AND status = 'active' AND category = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId, category) as AttemptRow | undefined;
    if (active) return { ok: true, view: view(db, active) };
  }
  // Never hand out the track the user just practised.
  const last = db
    .prepare("SELECT track_id FROM quiz_attempts WHERE user_id = ? AND mode = 'practice' ORDER BY created_at DESC LIMIT 1")
    .get(userId) as { track_id: string } | undefined;
  const picked = pickTrack(db, `practice:${userId}:${Date.now()}:${randomBytes(4).toString('hex')}`, category);
  if (!picked) return { ok: false, code: 'no_tracks' };
  let chosen = picked;
  if (last && picked.track_id === last.track_id) {
    const again = pickTrack(db, `practice:${userId}:${Date.now()}:alt`, category);
    if (again && again.track_id !== last.track_id) chosen = again;
  }
  const attempt = createAttempt(db, userId, 'practice', category, null, chosen.track_id, `practice:${chosen.track_id}`);
  return { ok: true, view: view(db, attempt) };
}

function completeAttempt(
  db: Database,
  attempt: AttemptRow,
  status: 'won' | 'lost',
  score: number,
): void {
  const at = nowIso();
  db.prepare(
    `UPDATE quiz_attempts SET status = ?, score = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(status, score, at, at, attempt.id);
  if (attempt.mode === 'daily' && attempt.challenge_id) {
    // The result belongs to the challenge's own day, even if the answer landed
    // a few seconds after midnight.
    const match = /^dq_(\d{4}-\d{2}-\d{2})_/.exec(attempt.challenge_id);
    const day = match?.[1] ?? quizDay(new Date(at));
    const previewSeconds = status === 'won' ? STAGE_DURATIONS[Math.min(attempt.stage, 4)] : null;
    db.prepare(
      `INSERT INTO quiz_daily_results (day, category, user_id, attempt_id, score, correct, preview_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    ).run(day, attempt.category, attempt.user_id, attempt.id, score, status === 'won' ? 1 : 0, previewSeconds ?? null, at);
    updateStreak(db, attempt.user_id, day);
  }
}

export function updateStreak(db: Database, userId: string, day: string): void {
  const row = db.prepare('SELECT * FROM quiz_streaks WHERE user_id = ?').get(userId) as
    | { current: number; best: number; last_day: string | null }
    | undefined;
  const yesterday = shiftDay(day, -1);
  if (!row) {
    db.prepare('INSERT INTO quiz_streaks (user_id, current, best, last_day, updated_at) VALUES (?, 1, 1, ?, ?)').run(
      userId,
      day,
      nowIso(),
    );
    return;
  }
  if (row.last_day === day) return;
  const current = row.last_day === yesterday ? row.current + 1 : 1;
  db.prepare('UPDATE quiz_streaks SET current = ?, best = ?, last_day = ?, updated_at = ? WHERE user_id = ?').run(
    current,
    Math.max(row.best, current),
    day,
    nowIso(),
    userId,
  );
}

export type GuessOutcome =
  | { ok: true; kind: 'correct'; points: number; view: QuizAttemptView }
  | { ok: true; kind: 'wrong'; view: QuizAttemptView }
  | { ok: true; kind: 'ambiguous' | 'invalid'; message: string; view: QuizAttemptView }
  | { ok: false; code: 'not_found' | 'not_owner' | 'finished' };

export function submitGuess(
  db: Database,
  userId: string,
  attemptId: string,
  rawGuess: string,
): GuessOutcome {
  const attempt = getAttempt(db, attemptId);
  if (!attempt) return { ok: false, code: 'not_found' };
  if (attempt.user_id !== userId) return { ok: false, code: 'not_owner' };
  if (attempt.status !== 'active') return { ok: false, code: 'finished' };

  const track = db.prepare('SELECT track_id, title, artist FROM quiz_tracks WHERE track_id = ?').get(attempt.track_id) as
    | { track_id: string; title: string; artist: string }
    | undefined;
  if (!track) return { ok: false, code: 'not_found' };

  const check = checkAnswer(db, { trackId: track.track_id, title: track.title, artist: track.artist }, String(rawGuess ?? ''));
  if (check.verdict === 'invalid') {
    return {
      ok: true,
      kind: 'invalid',
      message: 'En az 3 karakterlik bir tahmin yaz.',
      view: view(db, attempt),
    };
  }
  if (check.verdict === 'ambiguous') {
    return {
      ok: true,
      kind: 'ambiguous',
      message: 'Bu sanatçının birden fazla şarkısı var; şarkı adını dene.',
      view: view(db, attempt),
    };
  }

  const stage = attempt.stage;
  const correct = check.verdict === 'correct';
  const points = correct ? (STAGE_POINTS[stage] ?? 0) : 0;
  const guesses = attempt.guesses + 1;
  const at = nowIso();
  db.prepare(
    'INSERT INTO quiz_guesses (attempt_id, stage, guess, normalized, correct, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(attempt.id, stage, String(rawGuess).slice(0, 120), check.normalized, correct ? 1 : 0, at);

  if (correct) {
    const updated = { ...attempt, score: points, status: 'won' as const };
    completeAttempt(db, updated, 'won', points);
    return { ok: true, kind: 'correct', points, view: view(db, getAttempt(db, attempt.id)!) };
  }

  const nextStage = Math.min(STAGE_DURATIONS.length - 1, stage + 1);
  const lost = guesses >= MAX_GUESSES;
  db.prepare('UPDATE quiz_attempts SET guesses = ?, stage = ?, updated_at = ? WHERE id = ?').run(
    guesses,
    nextStage,
    at,
    attempt.id,
  );
  if (lost) {
    completeAttempt(db, { ...attempt, stage: nextStage }, 'lost', 0);
  }
  return { ok: true, kind: 'wrong', view: view(db, getAttempt(db, attempt.id)!) };
}

export function skipStage(db: Database, userId: string, attemptId: string): GuessOutcome {
  const attempt = getAttempt(db, attemptId);
  if (!attempt) return { ok: false, code: 'not_found' };
  if (attempt.user_id !== userId) return { ok: false, code: 'not_owner' };
  if (attempt.status !== 'active') return { ok: false, code: 'finished' };
  const nextStage = Math.min(STAGE_DURATIONS.length - 1, attempt.stage + 1);
  db.prepare('UPDATE quiz_attempts SET stage = ?, updated_at = ? WHERE id = ?').run(nextStage, nowIso(), attempt.id);
  return { ok: true, kind: 'wrong', view: view(db, getAttempt(db, attempt.id)!) };
}

/* ---------- stats ---------- */

export type QuizStats = {
  totalCorrect: number;
  totalPoints: number;
  averagePreviewSeconds: number | null;
  currentStreak: number;
  bestStreak: number;
  dailyPlayed: number;
  achievements: Array<{ key: string; unlocked: boolean }>;
};

export function quizStats(db: Database, userId: string): QuizStats {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(score), 0) AS points,
              COALESCE(AVG(CASE WHEN correct = 1 THEN preview_seconds END), 0) AS avgSeconds,
              COUNT(*) AS played
       FROM quiz_daily_results WHERE user_id = ?`,
    )
    .get(userId) as { correct: number; points: number; avgSeconds: number; played: number };
  const streak = db.prepare('SELECT current, best FROM quiz_streaks WHERE user_id = ?').get(userId) as
    | { current: number; best: number }
    | undefined;
  const perfect = db
    .prepare("SELECT COUNT(*) AS c FROM quiz_daily_results WHERE user_id = ? AND preview_seconds = 1")
    .get(userId) as { c: number };
  const achievements = [
    { key: 'first_correct', unlocked: totals.correct >= 1 },
    { key: 'five_correct', unlocked: totals.correct >= 5 },
    { key: 'perfect_clip', unlocked: perfect.c >= 1 },
    { key: 'streak_3', unlocked: (streak?.current ?? 0) >= 3 },
    { key: 'streak_7', unlocked: (streak?.best ?? 0) >= 7 },
  ];
  return {
    totalCorrect: totals.correct,
    totalPoints: totals.points,
    averagePreviewSeconds: totals.avgSeconds > 0 ? Math.round(totals.avgSeconds * 10) / 10 : null,
    currentStreak: streak?.current ?? 0,
    bestStreak: streak?.best ?? 0,
    dailyPlayed: totals.played,
    achievements,
  };
}

export type DailyHistoryEntry = {
  day: string;
  category: string;
  score: number;
  correct: boolean;
  previewSeconds: number | null;
  title: string;
  artist: string;
};

export function dailyHistory(db: Database, userId: string, limit = 14): DailyHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT r.day, r.category, r.score, r.correct, r.preview_seconds, c.track_id
       FROM quiz_daily_results r
       JOIN quiz_attempts a ON a.id = r.attempt_id
       JOIN quiz_challenges c ON c.id = a.challenge_id
       WHERE r.user_id = ?
       ORDER BY r.day DESC LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    day: string;
    category: string;
    score: number;
    correct: number;
    preview_seconds: number | null;
    track_id: string;
  }>;
  return rows.map((row) => {
    const info = trackInfo(db, row.track_id);
    return {
      day: row.day,
      category: row.category,
      score: row.score,
      correct: Boolean(row.correct),
      previewSeconds: row.preview_seconds,
      title: info?.title ?? '',
      artist: info?.artist ?? '',
    };
  });
}

/* ---------- leaderboard ---------- */

export type LeaderboardRow = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  points: number;
  correct: number;
  averagePreviewSeconds: number | null;
  streak: number;
  rank: number;
};

export function leaderboard(
  db: Database,
  viewerId: string,
  range: 'daily' | 'weekly' | 'monthly' | 'all' | 'friends',
  limit = 50,
): LeaderboardRow[] {
  const day = quizDay();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (range === 'daily') {
    clauses.push('r.day = ?');
    params.push(day);
  } else if (range === 'weekly') {
    clauses.push('r.day >= ?');
    params.push(shiftDay(day, -6));
  } else if (range === 'monthly') {
    clauses.push('r.day >= ?');
    params.push(shiftDay(day, -29));
  }
  if (range === 'friends') {
    const friends = listFriends(db, viewerId, 200, 0).items.map((friend) => friend.id);
    const ids = [viewerId, ...friends];
    clauses.push(`r.user_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT u.id, u.display_name, u.username, u.avatar_url,
              SUM(r.score) AS points, SUM(r.correct) AS correct,
              AVG(CASE WHEN r.correct = 1 THEN r.preview_seconds END) AS avg_seconds,
              COALESCE(s.current, 0) AS streak
       FROM quiz_daily_results r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN quiz_streaks s ON s.user_id = u.id
       ${where}
       GROUP BY u.id
       ORDER BY points DESC, correct DESC, u.display_name ASC
       LIMIT ?`,
    )
    .all(...params, Math.min(Math.max(limit, 1), 100)) as Array<{
    id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    points: number;
    correct: number;
    avg_seconds: number | null;
    streak: number;
  }>;
  return rows.map((row, index) => ({
    userId: row.id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    points: row.points ?? 0,
    correct: row.correct ?? 0,
    averagePreviewSeconds: row.avg_seconds ? Math.round(row.avg_seconds * 10) / 10 : null,
    streak: row.streak ?? 0,
    rank: index + 1,
  }));
}

/* ---------- parties ---------- */

export type PartyMember = { userId: string; displayName: string; username: string | null; avatarUrl: string | null; score: number };
export type PartyState = {
  id: string;
  hostId: string;
  category: QuizCategory;
  status: 'open' | 'playing' | 'finished';
  roundNo: number;
  roundStartedAt: string | null;
  roundEndsAt: string | null;
  members: PartyMember[];
  reveal: (QuizResult & { roundNo: number }) | null;
  yourAnswers: number;
  yourScore: number;
  code: string;
  finished: boolean;
};

function partyRow(db: Database, id: string): PartyRow | null {
  return (db.prepare('SELECT * FROM quiz_parties WHERE id = ?').get(id) as PartyRow | undefined) ?? null;
}

type PartyRow = {
  id: string;
  host_id: string;
  category: QuizCategory;
  status: string;
  round_no: number;
  round_started_at: string | null;
  round_ends_at: string | null;
  code: string;
  created_at: string;
  closed_at: string | null;
};

export function partyMembers(db: Database, partyId: string): PartyMember[] {
  const rows = db
    .prepare(
      `SELECT m.user_id, m.score, u.display_name, u.username, u.avatar_url
       FROM quiz_party_members m JOIN users u ON u.id = m.user_id
       WHERE m.party_id = ? ORDER BY m.score DESC, m.joined_at ASC`,
    )
    .all(partyId) as Array<{ user_id: string; score: number; display_name: string; username: string | null; avatar_url: string | null }>;
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    score: row.score,
  }));
}

export function isPartyMember(db: Database, partyId: string, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM quiz_party_members WHERE party_id = ? AND user_id = ?').get(partyId, userId));
}

export function createParty(db: Database, hostId: string, category: QuizCategory): { id: string; code: string } {
  const id = `qp_${randomBytes(8).toString('hex')}`;
  const code = randomBytes(3).toString('hex').toUpperCase();
  db.prepare(
    `INSERT INTO quiz_parties (id, host_id, category, status, round_no, code, created_at)
     VALUES (?, ?, ?, 'open', 0, ?, ?)`,
  ).run(id, hostId, category, code, nowIso());
  db.prepare("INSERT INTO quiz_party_members (party_id, user_id, score, joined_at) VALUES (?, ?, 0, ?)").run(
    id,
    hostId,
    nowIso(),
  );
  return { id, code };
}

export function joinParty(
  db: Database,
  userId: string,
  partyId: string,
  code: string | null,
): { ok: true } | { ok: false; code: 'not_found' | 'forbidden' | 'code' | 'full' | 'started' } {
  const party = partyRow(db, partyId);
  if (!party || party.closed_at) return { ok: false, code: 'not_found' };
  if (isPartyMember(db, partyId, userId)) return { ok: true };
  const invited = db.prepare('SELECT 1 FROM quiz_party_invites WHERE party_id = ? AND user_id = ?').get(partyId, userId);
  if (!invited && (!code || code.toUpperCase() !== party.code)) return { ok: false, code: 'code' };
  const count = (db.prepare('SELECT COUNT(*) AS c FROM quiz_party_members WHERE party_id = ?').get(partyId) as { c: number }).c;
  if (count >= 12) return { ok: false, code: 'full' };
  db.prepare("INSERT INTO quiz_party_members (party_id, user_id, score, joined_at) VALUES (?, ?, 0, ?)").run(
    partyId,
    userId,
    nowIso(),
  );
  return { ok: true };
}

export function inviteToParty(
  db: Database,
  partyId: string,
  inviterId: string,
  targetId: string,
): { ok: true } | { ok: false; code: 'forbidden' | 'not_friend' } {
  if (!isPartyMember(db, partyId, inviterId)) return { ok: false, code: 'forbidden' };
  const friends = listFriends(db, inviterId, 200, 0).items.map((friend) => friend.id);
  if (!friends.includes(targetId)) return { ok: false, code: 'not_friend' };
  db.prepare(
    `INSERT INTO quiz_party_invites (party_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(partyId, targetId, inviterId, nowIso());
  return { ok: true };
}

function partyRecipients(db: Database, partyId: string): string[] {
  return (db.prepare('SELECT user_id FROM quiz_party_members WHERE party_id = ?').all(partyId) as Array<{ user_id: string }>).map(
    (row) => row.user_id,
  );
}

function publishParty(db: Database, partyId: string, event: string, extra: Record<string, unknown> = {}): void {
  presenceStore.publish(partyRecipients(db, partyId), {
    type: 'quiz_party',
    partyId,
    event,
    at: nowIso(),
    ...extra,
  } as RealtimeEvent);
}

export function partyState(db: Database, partyId: string, userId: string, now = Date.now()): PartyState | null {
  const party = partyRow(db, partyId);
  if (!party) return null;
  if (!isPartyMember(db, partyId, userId)) return null;
  const round = db
    .prepare('SELECT * FROM quiz_party_rounds WHERE party_id = ? AND round_no = ?')
    .get(partyId, party.round_no) as
    | { round_no: number; track_id: string; started_at: string; ends_at: string; revealed_at: string | null }
    | undefined;
  const ended = Boolean(round && Date.parse(round.ends_at) <= now);
  let reveal: (QuizResult & { roundNo: number }) | null = null;
  if (round && ended && round.revealed_at) {
    const info = trackInfo(db, round.track_id);
    if (info) reveal = { ...info, roundNo: round.round_no };
  }
  const mine = db
    .prepare('SELECT COUNT(*) AS c FROM quiz_party_answers WHERE party_id = ? AND round_no = ? AND user_id = ?')
    .get(partyId, party.round_no, userId) as { c: number };
  const scoreRow = db
    .prepare('SELECT score FROM quiz_party_members WHERE party_id = ? AND user_id = ?')
    .get(partyId, userId) as { score: number } | undefined;
  return {
    id: party.id,
    hostId: party.host_id,
    category: party.category,
    status: party.status as PartyState['status'],
    roundNo: party.round_no,
    roundStartedAt: party.round_started_at,
    roundEndsAt: party.round_ends_at,
    members: partyMembers(db, partyId),
    reveal,
    yourAnswers: mine.c,
    yourScore: scoreRow?.score ?? 0,
    code: party.code,
    finished: party.status === 'finished',
  };
}

export function startRound(
  db: Database,
  partyId: string,
  hostId: string,
  now = Date.now(),
): { ok: true; roundNo: number } | { ok: false; code: 'not_found' | 'forbidden' | 'busy' | 'finished' | 'empty' } {
  const party = partyRow(db, partyId);
  if (!party) return { ok: false, code: 'not_found' };
  if (party.host_id !== hostId) return { ok: false, code: 'forbidden' };
  if (party.status === 'finished') return { ok: false, code: 'finished' };
  if (party.round_ends_at && Date.parse(party.round_ends_at) > now) return { ok: false, code: 'busy' };
  const nextRound = party.round_no + 1;
  if (nextRound > PARTY_ROUNDS) return { ok: false, code: 'finished' };
  const picked = pickTrack(db, `party:${partyId}:${nextRound}`, party.category);
  if (!picked) return { ok: false, code: 'empty' };
  const startsAt = new Date(now);
  const endsAt = new Date(now + PARTY_ROUND_MS);
  db.prepare(
    `INSERT OR REPLACE INTO quiz_party_rounds
       (party_id, round_no, track_id, preview_start, started_at, ends_at, revealed_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    partyId,
    nextRound,
    picked.track_id,
    pickStart(picked.duration, `${partyId}:${nextRound}`),
    startsAt.toISOString(),
    endsAt.toISOString(),
  );
  db.prepare(
    "UPDATE quiz_parties SET status = 'playing', round_no = ?, round_started_at = ?, round_ends_at = ? WHERE id = ?",
  ).run(nextRound, startsAt.toISOString(), endsAt.toISOString(), partyId);
  publishParty(db, partyId, 'round', { roundNo: nextRound, endsAt: endsAt.toISOString() });
  return { ok: true, roundNo: nextRound };
}

export type PartyAnswerOutcome =
  | { ok: true; kind: 'correct'; points: number; answered: number }
  | { ok: true; kind: 'wrong' | 'ambiguous' | 'invalid'; message?: string; answered: number }
  | { ok: false; code: 'not_found' | 'not_member' | 'no_round' | 'late' | 'done' };

export function answerParty(
  db: Database,
  partyId: string,
  userId: string,
  guess: string,
  now = Date.now(),
): PartyAnswerOutcome {
  const party = partyRow(db, partyId);
  if (!party) return { ok: false, code: 'not_found' };
  if (!isPartyMember(db, partyId, userId)) return { ok: false, code: 'not_member' };
  const round = db
    .prepare('SELECT * FROM quiz_party_rounds WHERE party_id = ? AND round_no = ?')
    .get(partyId, party.round_no) as
    | { round_no: number; track_id: string; ends_at: string }
    | undefined;
  if (!round) return { ok: false, code: 'no_round' };
  if (now > Date.parse(round.ends_at)) return { ok: false, code: 'late' };
  const answered = (
    db
      .prepare('SELECT COUNT(*) AS c FROM quiz_party_answers WHERE party_id = ? AND round_no = ? AND user_id = ?')
      .get(partyId, round.round_no, userId) as { c: number }
  ).c;
  if (answered >= MAX_GUESSES) return { ok: false, code: 'done' };

  const track = db.prepare('SELECT track_id, title, artist FROM quiz_tracks WHERE track_id = ?').get(round.track_id) as
    | { track_id: string; title: string; artist: string }
    | undefined;
  if (!track) return { ok: false, code: 'no_round' };
  const check = checkAnswer(db, { trackId: track.track_id, title: track.title, artist: track.artist }, String(guess ?? ''));
  if (check.verdict === 'invalid' || check.verdict === 'ambiguous') {
    return {
      ok: true,
      kind: check.verdict,
      message:
        check.verdict === 'invalid'
          ? 'En az 3 karakterlik bir tahmin yaz.'
          : 'Bu sanatçının birden fazla şarkısı var; şarkı adını dene.',
      answered,
    };
  }
  const correct = check.verdict === 'correct';
  const points = correct ? (STAGE_POINTS[Math.min(answered, STAGE_POINTS.length - 1)] ?? 0) : 0;
  db.prepare(
    `INSERT INTO quiz_party_answers (party_id, round_no, user_id, guess_no, value, correct, points, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(partyId, round.round_no, userId, answered + 1, String(guess).slice(0, 120), correct ? 1 : 0, points, nowIso());
  if (correct) {
    db.prepare('UPDATE quiz_party_members SET score = score + ? WHERE party_id = ? AND user_id = ?').run(
      points,
      partyId,
      userId,
    );
    publishParty(db, partyId, 'solved', { userId, roundNo: round.round_no });
  }
  return { ok: true, kind: correct ? 'correct' : 'wrong', ...(correct ? { points } : {}), answered: answered + 1 } as PartyAnswerOutcome;
}

/** Marks ended rounds as revealed and finishes a party after the last round. */
export function closeDueRounds(db: Database, now = Date.now()): string[] {
  const rows = db
    .prepare(
      `SELECT r.party_id, r.round_no, r.track_id, r.ends_at, r.revealed_at, p.host_id, p.status
       FROM quiz_party_rounds r JOIN quiz_parties p ON p.id = r.party_id
       WHERE r.revealed_at IS NULL AND r.ends_at <= ? AND p.closed_at IS NULL`,
    )
    .all(new Date(now).toISOString()) as Array<{
    party_id: string;
    round_no: number;
    track_id: string;
    ends_at: string;
    revealed_at: string | null;
    host_id: string;
    status: string;
  }>;
  const touched: string[] = [];
  for (const row of rows) {
    const at = nowIso();
    db.prepare('UPDATE quiz_party_rounds SET revealed_at = ? WHERE party_id = ? AND round_no = ?').run(
      at,
      row.party_id,
      row.round_no,
    );
    const info = trackInfo(db, row.track_id);
    publishParty(db, row.party_id, 'reveal', { roundNo: row.round_no, result: info });
    touched.push(row.party_id);
    if (row.round_no >= PARTY_ROUNDS) {
      db.prepare("UPDATE quiz_parties SET status = 'finished' WHERE id = ?").run(row.party_id);
      publishParty(db, row.party_id, 'finished', { podium: partyMembers(db, row.party_id) });
    }
  }
  return touched;
}

export function previewForParty(
  db: Database,
  partyId: string,
  userId: string,
  now = Date.now(),
): { ok: true; url: string; duration: number } | { ok: false; code: 'not_member' | 'no_round' | 'late' } {
  if (!isPartyMember(db, partyId, userId)) return { ok: false, code: 'not_member' };
  const party = partyRow(db, partyId);
  if (!party) return { ok: false, code: 'no_round' };
  const round = db
    .prepare('SELECT * FROM quiz_party_rounds WHERE party_id = ? AND round_no = ?')
    .get(partyId, party.round_no) as
    | { round_no: number; track_id: string; preview_start: number; ends_at: string }
    | undefined;
  if (!round) return { ok: false, code: 'no_round' };
  if (now > Date.parse(round.ends_at)) return { ok: false, code: 'late' };
  const answered = (
    db
      .prepare('SELECT COUNT(*) AS c FROM quiz_party_answers WHERE party_id = ? AND round_no = ? AND user_id = ?')
      .get(partyId, round.round_no, userId) as { c: number }
  ).c;
  const stage = Math.min(answered, STAGE_DURATIONS.length - 1);
  const url = issuePreview({
    trackId: round.track_id,
    start: round.preview_start,
    duration: STAGE_DURATIONS[stage] ?? 1,
    attemptId: null,
    partyId,
    roundNo: round.round_no,
  });
  return { ok: true, url, duration: STAGE_DURATIONS[stage] ?? 1 };
}

/** Finds an open party by its short code, for the "join with code" flow. */
export function findPartyByCode(db: Database, code: string): PartyRow | null {
  return (
    (db
      .prepare("SELECT * FROM quiz_parties WHERE code = ? AND closed_at IS NULL AND status <> 'finished' ORDER BY created_at DESC LIMIT 1")
      .get(code.trim().toUpperCase()) as PartyRow | undefined) ?? null
  );
}

export function partyForUser(db: Database, userId: string): PartyRow | null {  return (
    (db
      .prepare(
        `SELECT p.* FROM quiz_parties p JOIN quiz_party_members m ON m.party_id = p.id
         WHERE m.user_id = ? AND p.closed_at IS NULL AND p.status <> 'finished'
         ORDER BY p.created_at DESC LIMIT 1`,
      )
      .get(userId) as PartyRow | undefined) ?? null
  );
}

export function partyInvites(db: Database, userId: string): Array<{ id: string; hostId: string; category: string; code: string }> {
  return db
    .prepare(
      `SELECT p.id, p.host_id AS hostId, p.category, p.code
       FROM quiz_party_invites i JOIN quiz_parties p ON p.id = i.party_id
       WHERE i.user_id = ? AND p.closed_at IS NULL AND p.status = 'open'
       AND NOT EXISTS (SELECT 1 FROM quiz_party_members m WHERE m.party_id = p.id AND m.user_id = ?)`,
    )
    .all(userId, userId) as Array<{ id: string; hostId: string; category: string; code: string }>;
}

export function suggestions(db: Database, query: string, limit = 8): string[] {
  const needle = query.trim();
  if (needle.length < 2) return [];
  const like = `%${needle.replace(/[%_]/g, '')}%`;
  const rows = db
    .prepare(
      `SELECT title, artist FROM quiz_tracks WHERE active = 1 AND (title LIKE ? OR artist LIKE ?)
       ORDER BY title ASC LIMIT 40`,
    )
    .all(like, like) as Array<{ title: string; artist: string }>;
  const out = new Set<string>();
  for (const row of rows) {
    if (row.title.toLowerCase().includes(needle.toLowerCase())) out.add(row.title);
    if (row.artist.toLowerCase().includes(needle.toLowerCase())) out.add(row.artist);
    if (out.size >= limit) break;
  }
  return [...out].slice(0, limit);
}

export function quizStatsVisible(db: Database, viewerId: string, targetId: string): boolean {
  if (viewerId === targetId) return true;
  const target = db.prepare('SELECT profile_visibility FROM users WHERE id = ?').get(targetId) as
    | { profile_visibility: string | null }
    | undefined;
  if (!target) return false;
  const friend = db
    .prepare('SELECT status FROM friendships WHERE pair_key = ?')
    .get([viewerId, targetId].sort().join(':')) as { status: string } | undefined;
  if ((target.profile_visibility ?? 'public') === 'private') return friend?.status === 'accepted';
  return true;
}
