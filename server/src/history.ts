/**
 * Listening history for both kinds of track.
 *
 * Library items live in `listening_history` (foreign-keyed to `tracks`). Songs
 * played from search are YouTube/Spotify records that never enter the library, so
 * they are stored in `remote_plays` with enough metadata to render and replay
 * them. Both feed the home feed, discovery seeds and the history page.
 */
import type { Database } from 'better-sqlite3';

export type HistorySource = 'player' | 'stream' | 'download';

export type RemoteTrackInput = {
  id?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  duration?: unknown;
  coverUrl?: unknown;
  streamUrl?: unknown;
};

export type HistoryTrackDto = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string | null;
  year: number | null;
  trackNo: number | null;
  discNo: number | null;
  duration: number;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  format: string | null;
  size: number;
  coverUrl: string | null;
  streamUrl: string;
  addedAt: string;
};

export type HistoryEntry = {
  track: HistoryTrackDto;
  playedAt: string;
  msPlayed: number;
  source: string;
  remote: boolean;
};

type RemoteRow = {
  track_id: string;
  provider: string | null;
  title: string;
  artist: string;
  album: string | null;
  cover_url: string | null;
  duration: number | null;
  stream_url: string | null;
  played_at: string;
  ms_played: number;
  source: string;
};

function providerFor(trackId: string): 'youtube' | 'spotify' | 'external' {
  if (trackId.startsWith('yt_')) return 'youtube';
  if (trackId.startsWith('sp_')) return 'spotify';
  return 'external';
}

/** Stream URL the client can hand straight to `<audio>` through the resolver. */
function remoteStreamUrl(trackId: string, value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 2048);
  if (trackId.startsWith('yt_')) return `youtube:${trackId.slice(3)}`;
  if (trackId.startsWith('sp_')) return `spotify:${trackId.slice(3)}`;
  return `external:${trackId}`;
}

export function remoteTrackDto(row: RemoteRow): HistoryTrackDto {
  return {
    id: row.track_id,
    title: row.title,
    artist: row.artist,
    album: row.album ?? '',
    albumArtist: row.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: Number(row.duration) || 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: row.provider,
    size: 0,
    coverUrl: row.cover_url,
    streamUrl: remoteStreamUrl(row.track_id, row.stream_url),
    addedAt: row.played_at,
  };
}

export function cleanRemoteTrack(trackId: string, input: RemoteTrackInput | null | undefined): {
  trackId: string;
  provider: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  duration: number | null;
  streamUrl: string;
} | null {
  if (!input || typeof input !== 'object') return null;
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 300) : '';
  const artist = typeof input.artist === 'string' ? input.artist.trim().slice(0, 300) : '';
  if (!title || !artist) return null;
  const duration = Number(input.duration);
  const coverUrl =
    typeof input.coverUrl === 'string' && /^https?:\/\//.test(input.coverUrl) ? input.coverUrl.slice(0, 2048) : null;
  return {
    trackId,
    provider: providerFor(trackId),
    title,
    artist,
    album: typeof input.album === 'string' ? input.album.trim().slice(0, 300) || null : null,
    coverUrl,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    streamUrl: remoteStreamUrl(trackId, input.streamUrl),
  };
}

export function recordRemotePlay(
  db: Database,
  userId: string,
  track: NonNullable<ReturnType<typeof cleanRemoteTrack>>,
  msPlayed: number,
  source: HistorySource,
  at = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO remote_plays
     (user_id, track_id, provider, title, artist, album, cover_url, duration, stream_url, played_at, ms_played, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    track.trackId,
    track.provider,
    track.title,
    track.artist,
    track.album,
    track.coverUrl,
    track.duration,
    track.streamUrl,
    at,
    Math.max(0, Math.round(msPlayed)),
    source,
  );

  // Keep the table bounded: history is a feed, not an archive.
  const count = (db.prepare('SELECT COUNT(*) AS c FROM remote_plays WHERE user_id = ?').get(userId) as { c: number }).c;
  if (count > 2_500) {
    db.prepare(
      `DELETE FROM remote_plays WHERE user_id = ? AND id NOT IN (
         SELECT id FROM remote_plays WHERE user_id = ? ORDER BY played_at DESC LIMIT 2000
       )`,
    ).run(userId, userId);
  }
}

/**
 * Recent plays, newest first, one row per track.
 * `localMapper` converts a joined `tracks` row into the same DTO shape.
 */
export function listHistory(
  db: Database,
  userId: string,
  limit: number,
  localMapper: (row: Record<string, unknown>) => HistoryTrackDto,
): HistoryEntry[] {
  const localRows = db
    .prepare(
      `SELECT t.*, h.played_at, h.ms_played, h.source
       FROM listening_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.user_id = ?
       ORDER BY h.played_at DESC
       LIMIT ?`,
    )
    .all(userId, limit * 3) as Array<Record<string, unknown> & { played_at: string; ms_played: number; source: string }>;
  const remoteRows = db
    .prepare(
      `SELECT track_id, provider, title, artist, album, cover_url, duration, stream_url, played_at, ms_played, source
       FROM remote_plays WHERE user_id = ?
       ORDER BY played_at DESC
       LIMIT ?`,
    )
    .all(userId, limit * 3) as RemoteRow[];

  const entries: HistoryEntry[] = [
    ...localRows.map((row) => ({
      track: localMapper(row),
      playedAt: String(row.played_at),
      msPlayed: Number(row.ms_played) || 0,
      source: String(row.source),
      remote: false,
    })),
    ...remoteRows.map((row) => ({
      track: remoteTrackDto(row),
      playedAt: row.played_at,
      msPlayed: Number(row.ms_played) || 0,
      source: row.source,
      remote: true,
    })),
  ];

  entries.sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
  const seen = new Set<string>();
  const unique: HistoryEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.track.id)) continue;
    seen.add(entry.track.id);
    unique.push(entry);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Recent seeds for discovery, local and remote in one list. */
export function recentPlaySeeds(
  db: Database,
  userId: string,
  limit = 20,
): Array<{ id: string; title: string; artist: string; played_at: string }> {
  const rows = db
    .prepare(
      `SELECT id, title, artist, played_at FROM (
         SELECT t.id AS id, t.title AS title, t.artist AS artist, h.played_at AS played_at
         FROM listening_history h JOIN tracks t ON t.id = h.track_id
         WHERE h.user_id = ? AND h.ms_played >= 3000
         UNION ALL
         SELECT track_id AS id, title, artist, played_at
         FROM remote_plays WHERE user_id = ? AND ms_played >= 3000
       )
       ORDER BY played_at DESC
       LIMIT ?`,
    )
    .all(userId, userId, limit) as Array<{ id: string; title: string; artist: string; played_at: string }>;
  return rows;
}

/** Most played artists across both histories. */
export function topHistoryArtists(
  db: Database,
  userId: string,
  limit = 5,
): Array<{ artist: string; plays: number }> {
  return db
    .prepare(
      `SELECT MAX(artist) AS artist, COUNT(*) AS plays FROM (
         SELECT t.artist AS artist FROM listening_history h JOIN tracks t ON t.id = h.track_id
         WHERE h.user_id = ?
         UNION ALL
         SELECT artist FROM remote_plays WHERE user_id = ?
       )
       GROUP BY lower(artist) ORDER BY plays DESC LIMIT ?`,
    )
    .all(userId, userId, limit) as Array<{ artist: string; plays: number }>;
}
