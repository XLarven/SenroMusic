import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  cleanRemoteTrack,
  listHistory,
  recordRemotePlay,
  recentPlaySeeds,
  topHistoryArtists,
  type HistoryTrackDto,
} from '../src/history.js';

const USER = 'a1b2c3d4e5f60718293a4b5c';

function makeDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT, username TEXT);
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT,
      album_artist TEXT, duration REAL, path TEXT
    );
    CREATE TABLE listening_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, track_id TEXT NOT NULL,
      played_at TEXT NOT NULL, ms_played INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'player'
    );
    CREATE TABLE remote_plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, track_id TEXT NOT NULL,
      provider TEXT, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT, cover_url TEXT,
      duration REAL, stream_url TEXT, played_at TEXT NOT NULL,
      ms_played INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'stream'
    );
  `);
  db.prepare("INSERT INTO users (id, display_name) VALUES (?, 'Ada')").run(USER);
  db.prepare("INSERT INTO tracks (id, title, artist, album, duration) VALUES ('t_local', 'Yerel', 'Ada', 'Ilk', 200)").run();
  return db;
}

const localMapper = (row: Record<string, unknown>): HistoryTrackDto => ({
  id: String(row.id),
  title: String(row.title),
  artist: String(row.artist),
  album: String(row.album ?? ''),
  albumArtist: String(row.album_artist ?? row.artist ?? ''),
  genre: null,
  year: null,
  trackNo: null,
  discNo: null,
  duration: Number(row.duration ?? 0),
  bitrate: null,
  sampleRate: null,
  channels: null,
  format: null,
  size: 0,
  coverUrl: null,
  streamUrl: `/api/tracks/${row.id}/stream`,
  addedAt: '2026-01-01T00:00:00.000Z',
});

test('a remote track needs a title and an artist', () => {
  assert.equal(cleanRemoteTrack('yt_abcdefghijk', null), null);
  assert.equal(cleanRemoteTrack('yt_abcdefghijk', { title: '', artist: 'X' }), null);
  const cleaned = cleanRemoteTrack('yt_abcdefghijk', {
    id: 'yt_abcdefghijk',
    title: '  Sana Ne ',
    artist: ' Mabel Matiz ',
    album: 'Album',
    duration: 215,
    coverUrl: 'javascript:alert(1)',
  });
  assert.equal(cleaned?.title, 'Sana Ne');
  assert.equal(cleaned?.artist, 'Mabel Matiz');
  assert.equal(cleaned?.provider, 'youtube');
  // Non-http artwork is dropped, and the stream identity is derived from the id.
  assert.equal(cleaned?.coverUrl, null);
  assert.equal(cleaned?.streamUrl, 'youtube:abcdefghijk');
});

test('history merges local and streamed plays, newest first and without repeats', () => {
  const db = makeDb();
  db.prepare("INSERT INTO listening_history (user_id, track_id, played_at, ms_played) VALUES (?, 't_local', '2026-01-01T10:00:00.000Z', 90000)").run(USER);
  const remote = cleanRemoteTrack('yt_abcdefghijk', { title: 'Sana Ne', artist: 'Mabel Matiz' })!;
  recordRemotePlay(db, USER, remote, 45000, 'stream', '2026-01-02T10:00:00.000Z');
  recordRemotePlay(db, USER, remote, 60000, 'stream', '2026-01-03T10:00:00.000Z');

  const items = listHistory(db, USER, 10, localMapper);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.track.id, 'yt_abcdefghijk');
  assert.equal(items[0]?.remote, true);
  assert.equal(items[0]?.playedAt, '2026-01-03T10:00:00.000Z');
  assert.equal(items[1]?.track.id, 't_local');

  // The same track is only listed once even though it was played twice.
  assert.equal(items.filter((item) => item.track.id === 'yt_abcdefghijk').length, 1);
});

test('discovery seeds and top artists include streamed plays', () => {
  const db = makeDb();
  db.prepare("INSERT INTO listening_history (user_id, track_id, played_at, ms_played) VALUES (?, 't_local', '2026-01-01T10:00:00.000Z', 90000)").run(USER);
  const remote = cleanRemoteTrack('yt_abcdefghijk', { title: 'Sana Ne', artist: 'Mabel Matiz' })!;
  recordRemotePlay(db, USER, remote, 45000, 'stream', '2026-01-05T10:00:00.000Z');

  const seeds = recentPlaySeeds(db, USER, 10);
  assert.equal(seeds[0]?.title, 'Sana Ne');
  assert.equal(seeds[1]?.title, 'Yerel');

  const artists = topHistoryArtists(db, USER, 5);
  const names = artists.map((entry) => entry.artist);
  assert.ok(names.includes('Mabel Matiz'));
  assert.ok(names.includes('Ada'));
});
