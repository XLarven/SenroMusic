/**
 * Music taste matching.
 *
 * Everything here is derived from real playback rows (`listening_history`) that
 * the player itself wrote. Imported playlists, downloads and quiz clips never
 * reach this module.
 *
 * The score is a weighted cosine similarity over four vectors — artists, tracks,
 * genres and listening frequency — with two hard rules:
 *   1. a dimension that either side lacks is *dropped and renormalised*, so missing
 *      genre metadata can never lower a score;
 *   2. no history means no score, only an explanation.
 *
 * Results are cached per pair and invalidated by a per-user version counter that
 * bumps whenever new playback is recorded.
 */
import type { Database } from 'better-sqlite3';

export const MIN_PLAYS = 5;
export const MIN_ARTISTS = 3;
export const MIN_MS_PLAYED = 3_000;

const TOP_ARTISTS = 25;
const TOP_TRACKS = 25;
const TOP_GENRES = 12;
const TOP_LANGUAGES = 8;
const MAX_TRACK_ROWS = 400;
const DISCOVERY_POOL = 200;

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 600;

/** Sources that represent genuine playback. `quiz` and future non-listening rows stay out. */
const PLAYBACK_SOURCES = new Set(['player', 'stream', 'download']);

export type TasteTag = { name: string; plays: number };

export type TasteTrack = {
  key: string;
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  plays: number;
};

export type TasteProfile = {
  userId: string;
  plays: number;
  totalMs: number;
  lastPlayedAt: string | null;
  artists: TasteTag[];
  tracks: TasteTrack[];
  genres: TasteTag[];
  languages: TasteTag[];
  eligible: boolean;
  reason: 'insufficient_history' | null;
  computedAt: string;
};

export type TasteDimension = {
  key: 'artists' | 'tracks' | 'genres' | 'frequency';
  weight: number;
  score: number;
};

export type TasteComparison = {
  viewerId: string;
  targetId: string;
  score: number | null;
  eligible: boolean;
  reason: 'insufficient_history' | 'no_dimensions' | null;
  insufficient: { viewer: boolean; target: boolean };
  dimensions: TasteDimension[];
  sharedArtists: Array<TasteTag & { otherPlays: number }>;
  sharedTracks: Array<Omit<TasteTrack, 'plays'> & { plays: number; otherPlays: number }>;
  sharedGenres: Array<TasteTag & { otherPlays: number }>;
  sharedLanguages: Array<TasteTag & { otherPlays: number }>;
  onlyViewer: { artists: TasteTag[]; genres: TasteTag[] };
  onlyTarget: { artists: TasteTag[]; genres: TasteTag[] };
  sharedHidden: boolean;
};

/* ---------- normalisation ---------- */

const TITLE_NOISE =
  /\s*[([][^)\]]*\b(official|lyric|lyrics|video|audio|remaster(ed)?|live|hd|hq|explicit|visualizer|mv|from)\b[^)\]]*[)\]]/gi;

/** Lowercase, strip diacritics and punctuation so "Arijit Singh" === "arijit singh". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Identity of a recording, used to fold Spotify and YouTube copies of the same
 * song together. Only applied when the cleaned artist+title actually match, so a
 * live version with a different name is not silently merged.
 */
export function trackKey(artist: string, title: string): string {
  const cleanedTitle = title
    .replace(TITLE_NOISE, ' ')
    .replace(/\s*-\s*(official|lyrics?|audio|video|visualizer|from)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${normalizeText(artist)}|${normalizeText(cleanedTitle)}`;
}

function splitTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/* ---------- settings ---------- */

export type TasteSettings = {
  /** Friends may compare with me. */
  compareFriends: boolean;
  /** Anyone signed in may compare with my public profile. */
  comparePublic: boolean;
  /** I appear in global discovery. */
  discoverable: boolean;
  /** Discovery hides my name until we both show interest. */
  anonymous: boolean;
  /** Shared artist/track lists are visible in comparisons. */
  showShared: boolean;
};

export const TASTE_SETTING_KEYS = {
  compareFriends: 'tasteCompareFriends',
  comparePublic: 'tasteComparePublic',
  discoverable: 'tasteDiscoverable',
  anonymous: 'tasteAnonymous',
  showShared: 'tasteShowShared',
} as const;

export const DEFAULT_TASTE_SETTINGS: TasteSettings = {
  compareFriends: true,
  comparePublic: false,
  discoverable: false,
  anonymous: true,
  showShared: true,
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {
    // fall through
  }
  return fallback;
}

export function readTasteSettings(db: Database, userId: string): TasteSettings {
  const rows = db
    .prepare(
      `SELECT key, value FROM user_settings
       WHERE user_id = ? AND key IN ('tasteCompareFriends','tasteComparePublic','tasteDiscoverable','tasteAnonymous','tasteShowShared')`,
    )
    .all(userId) as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    compareFriends: parseBool(map.get(TASTE_SETTING_KEYS.compareFriends), DEFAULT_TASTE_SETTINGS.compareFriends),
    comparePublic: parseBool(map.get(TASTE_SETTING_KEYS.comparePublic), DEFAULT_TASTE_SETTINGS.comparePublic),
    discoverable: parseBool(map.get(TASTE_SETTING_KEYS.discoverable), DEFAULT_TASTE_SETTINGS.discoverable),
    anonymous: parseBool(map.get(TASTE_SETTING_KEYS.anonymous), DEFAULT_TASTE_SETTINGS.anonymous),
    showShared: parseBool(map.get(TASTE_SETTING_KEYS.showShared), DEFAULT_TASTE_SETTINGS.showShared),
  };
}

/* ---------- cache ---------- */

const versions = new Map<string, number>();
const profileCache = new Map<string, { version: number; expires: number; profile: TasteProfile }>();
const comparisonCache = new Map<string, { a: number; b: number; expires: number; value: TasteComparison }>();

/** Called whenever a user's playback changes. */
export function noteTasteChange(userId: string): void {
  versions.set(userId, (versions.get(userId) ?? 0) + 1);
  profileCache.delete(userId);
  for (const key of [...comparisonCache.keys()]) {
    if (key.split('|').includes(userId)) comparisonCache.delete(key);
  }
}

function versionOf(userId: string): number {
  return versions.get(userId) ?? 0;
}

function trimCache(): void {
  if (comparisonCache.size <= CACHE_MAX) return;
  const entries = [...comparisonCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
  for (const [key] of entries.slice(0, entries.length - CACHE_MAX)) comparisonCache.delete(key);
}

export function clearTasteCache(): void {
  versions.clear();
  profileCache.clear();
  comparisonCache.clear();
}

/* ---------- profile ---------- */

type TrackRow = {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string | null;
  language: string | null;
  cover_id: string | null;
  plays: number;
  ms: number;
  last_played: string | null;
};

export function buildTasteProfile(db: Database, userId: string, now = Date.now()): TasteProfile {
  const version = versionOf(userId);
  const hit = profileCache.get(userId);
  if (hit && hit.version === version && hit.expires > now) return hit.profile;

  const sources = [...PLAYBACK_SOURCES];
  const sourceList = sources.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.artist, t.album, t.genre, t.language, t.cover_id,
              COUNT(*) AS plays, COALESCE(SUM(h.ms_played), 0) AS ms,
              MAX(h.played_at) AS last_played
       FROM listening_history h
       JOIN tracks t ON t.id = h.track_id
       WHERE h.user_id = ?
         AND h.ms_played >= ?
         AND h.source IN (${sourceList})
       GROUP BY t.id
       ORDER BY plays DESC, last_played DESC
       LIMIT ?`,
    )
    .all(userId, MIN_MS_PLAYED, ...sources, MAX_TRACK_ROWS) as TrackRow[];

  const plays = rows.reduce((sum, row) => sum + row.plays, 0);
  const totalMs = rows.reduce((sum, row) => sum + row.ms, 0);

  const artistMap = new Map<string, { name: string; plays: number }>();
  const genreMap = new Map<string, number>();
  const languageMap = new Map<string, number>();
  const trackMap = new Map<string, TasteTrack>();

  for (const row of rows) {
    const artistNorm = normalizeText(row.artist) || 'unknown';
    const artist = artistMap.get(artistNorm);
    if (artist) artist.plays += row.plays;
    else artistMap.set(artistNorm, { name: row.artist.trim(), plays: row.plays });

    const key = trackKey(row.artist, row.title);
    const existingTrack = trackMap.get(key);
    if (existingTrack) {
      // Spotify and YouTube copies of the same recording collapse into one entry.
      existingTrack.plays += row.plays;
    } else {
      trackMap.set(key, {
        key,
        id: row.id,
        title: row.title,
        artist: row.artist,
        album: row.album || null,
        coverUrl: row.cover_id ? `/api/covers/${row.cover_id}` : null,
        plays: row.plays,
      });
    }

    for (const genre of splitTags(row.genre)) {
      const normalized = normalizeText(genre);
      if (!normalized) continue;
      genreMap.set(normalized, (genreMap.get(normalized) ?? 0) + row.plays);
    }
    for (const language of splitTags(row.language)) {
      const normalized = normalizeText(language);
      if (!normalized) continue;
      languageMap.set(normalized, (languageMap.get(normalized) ?? 0) + row.plays);
    }
  }

  const artists = [...artistMap.values()].sort((a, b) => b.plays - a.plays).slice(0, TOP_ARTISTS);
  const tracks = [...trackMap.values()].sort((a, b) => b.plays - a.plays).slice(0, TOP_TRACKS);
  const toTags = (map: Map<string, number>, limit: number): TasteTag[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, plays: count }));

  const eligible = plays >= MIN_PLAYS && artists.length >= MIN_ARTISTS;
  const profile: TasteProfile = {
    userId,
    plays,
    totalMs,
    lastPlayedAt: rows[0]?.last_played ?? null,
    artists,
    tracks,
    genres: toTags(genreMap, TOP_GENRES),
    languages: toTags(languageMap, TOP_LANGUAGES),
    eligible,
    reason: eligible ? null : 'insufficient_history',
    computedAt: new Date(now).toISOString(),
  };

  profileCache.set(userId, { version, expires: now + CACHE_TTL_MS, profile });
  return profile;
}

/* ---------- scoring ---------- */

function shareVector(entries: Array<{ key: string; plays: number }>): Map<string, number> {
  const total = entries.reduce((sum, entry) => sum + entry.plays, 0);
  const vector = new Map<string, number>();
  if (total <= 0) return vector;
  for (const entry of entries) vector.set(entry.key, entry.plays / total);
  return vector;
}

/** Cosine similarity of two normalised weight vectors, or null when either is empty. */
export function cosine(a: Map<string, number>, b: Map<string, number>): number | null {
  if (a.size === 0 || b.size === 0) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [key, value] of a) {
    na += value * value;
    const other = b.get(key);
    if (other !== undefined) dot += value * other;
  }
  for (const value of b.values()) nb += value * value;
  if (na === 0 || nb === 0) return null;
  return Math.max(0, Math.min(1, dot / Math.sqrt(na * nb)));
}

/** Log-scale closeness of two listening volumes; 1 when equal. */
export function frequencyScore(playsA: number, playsB: number): number {
  const a = Math.log1p(Math.max(playsA, 0));
  const b = Math.log1p(Math.max(playsB, 0));
  const top = Math.max(a, b);
  if (top === 0) return 0;
  return Math.max(0, Math.min(1, 1 - Math.abs(a - b) / top));
}

const WEIGHTS: Array<{ key: TasteDimension['key']; weight: number }> = [
  { key: 'artists', weight: 0.42 },
  { key: 'tracks', weight: 0.28 },
  { key: 'genres', weight: 0.2 },
  { key: 'frequency', weight: 0.1 },
];

function intersect(
  a: Array<{ name: string; plays: number }>,
  b: Array<{ name: string; plays: number }>,
  limit: number,
): Array<TasteTag & { otherPlays: number }> {
  const map = new Map(b.map((entry) => [normalizeText(entry.name), entry]));
  return a
    .map((entry) => {
      const other = map.get(normalizeText(entry.name));
      return other ? { name: entry.name, plays: entry.plays, otherPlays: other.plays } : null;
    })
    .filter((entry): entry is TasteTag & { otherPlays: number } => entry !== null)
    .sort((x, y) => Math.min(y.plays, y.otherPlays) - Math.min(x.plays, x.otherPlays))
    .slice(0, limit);
}

function onlyIn(a: TasteTag[], b: TasteTag[], limit: number): TasteTag[] {
  const seen = new Set(b.map((entry) => normalizeText(entry.name)));
  return a.filter((entry) => !seen.has(normalizeText(entry.name))).slice(0, limit);
}

export function compareTaste(
  db: Database,
  viewerId: string,
  targetId: string,
  options: { showShared?: boolean } = {},
  now = Date.now(),
): TasteComparison {
  const cached = comparisonCache.get(`${viewerId}|${targetId}`);
  if (
    cached &&
    cached.a === versionOf(viewerId) &&
    cached.b === versionOf(targetId) &&
    cached.expires > now
  ) {
    return options.showShared === false ? { ...cached.value, sharedHidden: true, sharedArtists: [], sharedTracks: [], sharedGenres: [], sharedLanguages: [] } : cached.value;
  }

  const a = buildTasteProfile(db, viewerId, now);
  const b = buildTasteProfile(db, targetId, now);
  const showShared = options.showShared !== false;

  const artistA = shareVector(a.artists.map((entry) => ({ key: normalizeText(entry.name), plays: entry.plays })));
  const artistB = shareVector(b.artists.map((entry) => ({ key: normalizeText(entry.name), plays: entry.plays })));
  const trackA = shareVector(a.tracks.map((entry) => ({ key: entry.key, plays: entry.plays })));
  const trackB = shareVector(b.tracks.map((entry) => ({ key: entry.key, plays: entry.plays })));
  const genreA = shareVector(a.genres.map((entry) => ({ key: normalizeText(entry.name), plays: entry.plays })));
  const genreB = shareVector(b.genres.map((entry) => ({ key: normalizeText(entry.name), plays: entry.plays })));

  const dimensions: TasteDimension[] = [];
  const push = (key: TasteDimension['key'], value: number | null) => {
    const weight = WEIGHTS.find((entry) => entry.key === key)?.weight ?? 0;
    if (value === null) return;
    dimensions.push({ key, weight, score: Number(value.toFixed(4)) });
  };
  push('artists', cosine(artistA, artistB));
  push('tracks', cosine(trackA, trackB));
  push('genres', cosine(genreA, genreB));
  if (a.eligible && b.eligible) push('frequency', frequencyScore(a.plays, b.plays));

  const weightSum = dimensions.reduce((sum, entry) => sum + entry.weight, 0);
  const raw = weightSum > 0 ? dimensions.reduce((sum, entry) => sum + entry.weight * entry.score, 0) / weightSum : null;
  const eligible = a.eligible && b.eligible;
  const score = eligible && raw !== null ? Math.round(raw * 100) : null;

  const sharedArtists = showShared ? intersect(a.artists, b.artists, 6) : [];
  const sharedGenres = showShared ? intersect(a.genres, b.genres, 6) : [];
  const sharedLanguages = showShared ? intersect(a.languages, b.languages, 4) : [];
  const bTracksByKey = new Map(b.tracks.map((entry) => [entry.key, entry]));
  const sharedTracks = showShared
    ? a.tracks
        .map((entry) => {
          const other = bTracksByKey.get(entry.key);
          return other
            ? { ...entry, otherPlays: other.plays }
            : null;
        })
        .filter((entry): entry is TasteTrack & { otherPlays: number } => entry !== null)
        .sort((x, y) => Math.min(y.plays, y.otherPlays) - Math.min(x.plays, x.otherPlays))
        .slice(0, 6)
    : [];

  const value: TasteComparison = {
    viewerId,
    targetId,
    score,
    eligible,
    reason: !eligible ? 'insufficient_history' : raw === null ? 'no_dimensions' : null,
    insufficient: { viewer: !a.eligible, target: !b.eligible },
    dimensions,
    sharedArtists,
    sharedTracks,
    sharedGenres,
    sharedLanguages,
    onlyViewer: {
      artists: onlyIn(a.artists, b.artists, 3),
      genres: onlyIn(a.genres, b.genres, 3),
    },
    onlyTarget: {
      artists: onlyIn(b.artists, a.artists, 3),
      genres: onlyIn(b.genres, a.genres, 3),
    },
    sharedHidden: !showShared,
  };

  comparisonCache.set(`${viewerId}|${targetId}`, {
    a: versionOf(viewerId),
    b: versionOf(targetId),
    expires: now + CACHE_TTL_MS,
    value,
  });
  trimCache();
  return value;
}

/* ---------- permissions ---------- */

export type TasteAccess = 'ok' | 'self' | 'blocked' | 'not_friends' | 'private';

export function isBlockedPair(db: Database, a: string, b: string): boolean {
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      )
      .get(a, b, b, a),
  );
}

export function areFriends(db: Database, a: string, b: string): boolean {
  const pair = [a, b].sort().join(':');
  const row = db.prepare('SELECT status FROM friendships WHERE pair_key = ?').get(pair) as
    | { status: string }
    | undefined;
  return row?.status === 'accepted';
}

export function tasteAccess(
  db: Database,
  viewerId: string,
  targetId: string,
  target: { profileVisibility: 'public' | 'private' },
  targetSettings: TasteSettings,
): TasteAccess {
  if (viewerId === targetId) return 'self';
  if (isBlockedPair(db, viewerId, targetId)) return 'blocked';
  if (areFriends(db, viewerId, targetId)) {
    return targetSettings.compareFriends ? 'ok' : 'private';
  }
  if (!targetSettings.comparePublic || target.profileVisibility === 'private') return 'private';
  return 'ok';
}

/* ---------- discovery ---------- */

export type DiscoveryCandidate = {
  userId: string;
  score: number;
  sharedArtists: number;
  sharedGenres: number;
};

type CandidateRow = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  profile_visibility: string | null;
  plays: number;
  last_played: string | null;
};

/** Users who opted in, have enough history and are not blocked with the viewer. */
export function discoveryCandidates(db: Database, viewerId: string, now = Date.now()): Array<DiscoveryCandidate & { row: CandidateRow }> {
  const rows = db
    .prepare(
      `SELECT u.id, u.display_name, u.username, u.avatar_url, u.profile_visibility,
              COUNT(h.id) AS plays, MAX(h.played_at) AS last_played
       FROM users u
       JOIN user_settings s ON s.user_id = u.id AND s.key = 'tasteDiscoverable' AND s.value = 'true'
       JOIN listening_history h ON h.user_id = u.id
       WHERE u.id <> ?
         AND COALESCE(u.profile_visibility, 'public') <> 'private'
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)
         )
       GROUP BY u.id
       HAVING COUNT(h.id) >= ?
       ORDER BY last_played DESC
       LIMIT ?`,
    )
    .all(viewerId, viewerId, viewerId, MIN_PLAYS, DISCOVERY_POOL) as CandidateRow[];

  const out: Array<DiscoveryCandidate & { row: CandidateRow }> = [];
  for (const row of rows) {
    const comparison = compareTaste(db, viewerId, row.id, {}, now);
    if (comparison.score === null) continue;
    out.push({
      userId: row.id,
      score: comparison.score,
      sharedArtists: comparison.sharedArtists.length,
      sharedGenres: comparison.sharedGenres.length,
      row,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ---------- mutual interest ---------- */

export function recordInterest(db: Database, viewerId: string, targetId: string): { mutual: boolean } {
  const at = new Date().toISOString();
  db.prepare(
    `INSERT INTO taste_interests (viewer_id, target_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(viewerId, targetId, at);
  const reciprocal = db
    .prepare('SELECT 1 FROM taste_interests WHERE viewer_id = ? AND target_id = ?')
    .get(targetId, viewerId);
  if (!reciprocal) return { mutual: false };
  db.prepare(
    `UPDATE taste_interests SET revealed_at = COALESCE(revealed_at, ?)
     WHERE (viewer_id = ? AND target_id = ?) OR (viewer_id = ? AND target_id = ?)`,
  ).run(at, viewerId, targetId, targetId, viewerId);
  return { mutual: true };
}

export function revealedWith(db: Database, viewerId: string, targetId: string): boolean {
  const row = db
    .prepare(
      `SELECT revealed_at FROM taste_interests
       WHERE viewer_id = ? AND target_id = ?`,
    )
    .get(viewerId, targetId) as { revealed_at: string | null } | undefined;
  return Boolean(row?.revealed_at);
}

export function likedBefore(db: Database, viewerId: string, targetId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM taste_interests WHERE viewer_id = ? AND target_id = ?').get(viewerId, targetId),
  );
}

/** Removes the user from discovery: setting off plus cleared likes. */
export function leaveDiscovery(db: Database, userId: string): void {
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'tasteDiscoverable', 'false')
     ON CONFLICT (user_id, key) DO UPDATE SET value = 'false'`,
  ).run(userId);
  db.prepare('DELETE FROM taste_interests WHERE viewer_id = ? OR target_id = ?').run(userId, userId);
}
