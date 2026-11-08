import Database from 'better-sqlite3';
import { ensureRuntimeDirs, paths } from './config.js';
import { applyMigrations } from './migrations.js';
import type { Track } from './types.js';

export type TrackRow = {
  id: string;
  path: string;
  rel_path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  genre: string | null;
  year: number | null;
  track_no: number | null;
  disc_no: number | null;
  duration: number;
  bitrate: number | null;
  sample_rate: number | null;
  channels: number | null;
  format: string | null;
  size: number;
  mtime: number;
  cover_id: string | null;
  added_at: string;
  updated_at: string;
};

export type PlaylistRow = {
  id: string;
  name: string;
  description: string;
  owner_id: string | null;
  visibility: 'private' | 'public';
  pinned: number;
  share_slug: string | null;
  cover_id: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
};

let database: Database.Database | null = null;

export function getDb(): Database.Database {
  if (database) return database;
  ensureRuntimeDirs();
  database = new Database(paths.db);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('synchronous = NORMAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      rel_path TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      album_artist TEXT NOT NULL,
      genre TEXT,
      year INTEGER,
      track_no INTEGER,
      disc_no INTEGER,
      duration REAL NOT NULL DEFAULT 0,
      bitrate INTEGER,
      sample_rate INTEGER,
      channels INTEGER,
      format TEXT,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      cover_id TEXT,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_artist, album);
    CREATE INDEX IF NOT EXISTS idx_tracks_added ON tracks(added_at DESC);

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist
      ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track
      ON playlist_tracks(track_id);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT,
      last_active_at TEXT,
      last_ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
  `);
  applyMigrations(database);
  return database;
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function trackToDto(row: TrackRow): Track {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumArtist: row.album_artist,
    genre: row.genre,
    year: row.year,
    trackNo: row.track_no,
    discNo: row.disc_no,
    duration: row.duration,
    bitrate: row.bitrate,
    sampleRate: row.sample_rate,
    channels: row.channels,
    format: row.format,
    size: row.size,
    coverUrl: row.cover_id ? `/api/covers/${row.cover_id}` : null,
    streamUrl: `/api/tracks/${row.id}/stream`,
    addedAt: row.added_at,
  };
}

export function getTrackRow(id: string): TrackRow | null {
  const row = getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(id) as
    | TrackRow
    | undefined;
  return row ?? null;
}

export function closeDb(): void {
  database?.close();
  database = null;
}
