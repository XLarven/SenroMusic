import { createHash } from 'node:crypto';
import { getDb, getMeta, trackToDto, type PlaylistRow, type TrackRow } from './db.js';
import type { Album, Artist, Library, LibraryStats, Playlist, PlaylistSummary } from './types.js';

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function coverUrl(coverId: string | null): string | null {
  return coverId ? `/api/covers/${coverId}` : null;
}

export function getLibrary(): Library {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM tracks ORDER BY added_at DESC, artist, album, disc_no, track_no, title')
    .all() as TrackRow[];
  const tracks = rows.map(trackToDto);

  const albums = new Map<string, Album>();
  const artists = new Map<string, { name: string; trackCount: number; albums: Set<string>; coverId: string | null }>();

  for (const row of rows) {
    const albumKey = `${row.album_artist}\u0000${row.album}`;
    const albumId = stableId('al', albumKey);
    const existingAlbum = albums.get(albumId);
    if (existingAlbum) {
      existingAlbum.trackCount += 1;
      existingAlbum.duration += row.duration;
      existingAlbum.year ??= row.year;
      existingAlbum.coverUrl ??= coverUrl(row.cover_id);
    } else {
      albums.set(albumId, {
        id: albumId,
        name: row.album,
        artist: row.album_artist,
        year: row.year,
        trackCount: 1,
        duration: row.duration,
        coverUrl: coverUrl(row.cover_id),
      });
    }

    const artistId = stableId('ar', row.artist);
    const existingArtist = artists.get(artistId);
    if (existingArtist) {
      existingArtist.trackCount += 1;
      existingArtist.albums.add(albumKey);
      existingArtist.coverId ??= row.cover_id;
    } else {
      artists.set(artistId, {
        name: row.artist,
        trackCount: 1,
        albums: new Set([albumKey]),
        coverId: row.cover_id,
      });
    }
  }

  const stats: LibraryStats = {
    tracks: rows.length,
    albums: albums.size,
    artists: artists.size,
    totalDuration: rows.reduce((sum, row) => sum + row.duration, 0),
    totalSize: rows.reduce((sum, row) => sum + row.size, 0),
    lastScanAt: getMeta('last_scan_at'),
  };

  return {
    tracks,
    albums: [...albums.values()].sort((a, b) =>
      a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name),
    ),
    artists: [...artists.entries()]
      .map<Artist>(([id, value]) => ({
        id,
        name: value.name,
        trackCount: value.trackCount,
        albumCount: value.albums.size,
        coverUrl: coverUrl(value.coverId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stats,
  };
}

type PlaylistAggregateRow = PlaylistRow & {
  track_count: number;
  duration: number | null;
  cover_id: string | null;
};

function playlistSummary(row: PlaylistAggregateRow): PlaylistSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackCount: row.track_count,
    duration: row.duration ?? 0,
    coverUrl: coverUrl(row.cover_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PLAYLIST_AGGREGATE = `
  SELECT p.*,
    COUNT(pt.entry_id) AS track_count,
    COALESCE(SUM(t.duration), 0) AS duration,
    (
      SELECT t2.cover_id
      FROM playlist_tracks pt2
      JOIN tracks t2 ON t2.id = pt2.track_id
      WHERE pt2.playlist_id = p.id AND t2.cover_id IS NOT NULL
      ORDER BY pt2.position
      LIMIT 1
    ) AS cover_id
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
`;

export function getPlaylists(): PlaylistSummary[] {
  const rows = getDb()
    .prepare(`${PLAYLIST_AGGREGATE} GROUP BY p.id ORDER BY p.updated_at DESC`)
    .all() as PlaylistAggregateRow[];
  return rows.map(playlistSummary);
}

export function getPlaylist(id: string): Playlist | null {
  const db = getDb();
  const row = db
    .prepare(`${PLAYLIST_AGGREGATE} WHERE p.id = ? GROUP BY p.id`)
    .get(id) as PlaylistAggregateRow | undefined;
  if (!row) return null;

  const entries = db
    .prepare(
      `SELECT pt.entry_id, t.*
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position, pt.entry_id`,
    )
    .all(id) as Array<TrackRow & { entry_id: number }>;

  return {
    ...playlistSummary(row),
    tracks: entries.map((entry) => ({
      ...trackToDto(entry),
      entryId: entry.entry_id,
    })),
  };
}

export function playlistExists(id: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM playlists WHERE id = ?').get(id));
}
