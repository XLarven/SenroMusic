/**
 * Persistent song -> upload map.
 *
 * A Spotify row only knows title and artist, so the resolver has to search for a
 * YouTube upload every time. The first successful match is stored here and reused,
 * which keeps the same recording across server restarts and removes the search
 * step from later plays.
 */
import { getDb } from '../db.js';
import type { ResolvedStream, StreamRequest } from './types.js';

const YOUTUBE_LABEL = /^youtube:([\w-]{11})$/;
/** Older rows are dropped instead of trusted forever. */
const MAX_AGE_DAYS = 120;

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Stable key for a metadata-only request; known uploads keep their own cache. */
export function songKey(title: string | null | undefined, artist: string | null | undefined): string | null {
  const cleanTitle = normalize(title);
  if (!cleanTitle) return null;
  return `${normalize(artist)}::${cleanTitle}`;
}

export function lookupVideoId(request: StreamRequest): string | null {
  if (request.videoId) return null;
  const key = songKey(request.title, request.artist);
  if (!key) return null;
  try {
    const row = getDb()
      .prepare('SELECT video_id, updated_at FROM stream_resolutions WHERE key = ?')
      .get(key) as { video_id: string; updated_at: string } | undefined;
    if (!row) return null;
    const age = Date.now() - Date.parse(row.updated_at);
    if (!Number.isFinite(age) || age > MAX_AGE_DAYS * 86_400_000) {
      getDb().prepare('DELETE FROM stream_resolutions WHERE key = ?').run(key);
      return null;
    }
    return /^[\w-]{11}$/.test(row.video_id) ? row.video_id : null;
  } catch {
    return null;
  }
}

export function rememberVideoId(
  request: StreamRequest,
  stream: ResolvedStream,
): void {
  if (request.videoId) return;
  const match = YOUTUBE_LABEL.exec(stream.label);
  if (!match) return;
  const key = songKey(request.title, request.artist);
  if (!key) return;
  try {
    getDb()
      .prepare(
        `INSERT INTO stream_resolutions (key, video_id, label, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           video_id = excluded.video_id, label = excluded.label, updated_at = excluded.updated_at`,
      )
      .run(key, match[1]!, stream.label, new Date().toISOString());
  } catch {
    // A missing table or a locked database must never break playback.
  }
}

export function forgetVideoId(request: StreamRequest): void {
  const key = songKey(request.title, request.artist);
  if (!key) return;
  try {
    getDb().prepare('DELETE FROM stream_resolutions WHERE key = ?').run(key);
  } catch {
    // Ignore: the retry still works without the map.
  }
}
