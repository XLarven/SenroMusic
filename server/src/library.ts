import { createHash } from 'node:crypto';
import { getDb, getMeta, trackToDto, type PlaylistRow, type TrackRow } from './db.js';
import type { Album, Artist, ExternalPlaylistTrack, Library, LibraryStats, Playlist, PlaylistSummary, Track } from './types.js';
import type { UserRow } from './users.js';

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
  external_count: number | null;
  aggregate_cover_id: string | null;
};

function playlistSummary(row: PlaylistAggregateRow, user?: UserRow | null): PlaylistSummary {
  const isOwner = Boolean(user && row.owner_id === user.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackCount: row.track_count + (row.external_count ?? 0),
    duration: row.duration ?? 0,
    coverUrl: row.cover_url ?? coverUrl(row.cover_id) ?? coverUrl(row.aggregate_cover_id),
    visibility: row.visibility,
    pinned: row.pinned === 1,
    isOwner,
    sourceProvider: row.source_provider,
    sourceUrl: row.source_url,
    sourcePlaylistId: row.source_playlist_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PLAYLIST_AGGREGATE = `
  SELECT p.*,
    COUNT(pt.entry_id) AS track_count,
    COALESCE(SUM(t.duration), 0)
      + COALESCE((
          SELECT SUM(pet.duration)
          FROM playlist_external_tracks pet
          WHERE pet.playlist_id = p.id
        ), 0) AS duration,
    (
      SELECT COUNT(*)
      FROM playlist_external_tracks pet
      WHERE pet.playlist_id = p.id
    ) AS external_count,
    (
      SELECT t2.cover_id
      FROM playlist_tracks pt2
      JOIN tracks t2 ON t2.id = pt2.track_id
      WHERE pt2.playlist_id = p.id AND t2.cover_id IS NOT NULL
      ORDER BY pt2.position
      LIMIT 1
    ) AS aggregate_cover_id
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
`;

export function getPlaylists(user?: UserRow | null): PlaylistSummary[] {
  const db = getDb();
  const rows = (user
    ? db
        .prepare(
          `${PLAYLIST_AGGREGATE}
           WHERE p.owner_id = ? OR p.visibility = 'public' OR p.owner_id IS NULL
           GROUP BY p.id ORDER BY p.updated_at DESC`,
        )
        .all(user.id)
    : db
        .prepare(`${PLAYLIST_AGGREGATE} GROUP BY p.id ORDER BY p.updated_at DESC`)
        .all()) as PlaylistAggregateRow[];
  return rows.map((row) => playlistSummary(row, user));
}

export function getPublicPlaylists(ownerId: string): PlaylistSummary[] {
  const rows = getDb()
    .prepare(
      `${PLAYLIST_AGGREGATE}
       WHERE p.owner_id = ? AND p.visibility = 'public'
       GROUP BY p.id ORDER BY p.updated_at DESC`,
    )
    .all(ownerId) as PlaylistAggregateRow[];
  return rows.map((row) => playlistSummary(row));
}

export function getPlaylist(id: string, user?: UserRow | null): Playlist | null {
  const db = getDb();
  const row = db
    .prepare(`${PLAYLIST_AGGREGATE} WHERE p.id = ? GROUP BY p.id`)
    .get(id) as PlaylistAggregateRow | undefined;
  if (!row) return null;
  const canView = Boolean(
    !user || row.owner_id === user.id || row.owner_id === null || row.visibility === 'public' || user.role === 'admin',
  );
  if (!canView) return null;

  const entries = db
    .prepare(
      `SELECT pt.entry_id, pt.position, t.*
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position, pt.entry_id`,
    )
    .all(id) as Array<TrackRow & { entry_id: number; position: number }>;

  const externalRows = db
    .prepare(
      `SELECT entry_id, provider, provider_track_id, title, artist, album, duration,
              artwork_url, source_url, position, matched_track_id, created_at
       FROM playlist_external_tracks
       WHERE playlist_id = ?
       ORDER BY position, entry_id`,
    )
    .all(id) as Array<{
      entry_id: number;
      provider: string;
      provider_track_id: string | null;
      title: string;
      artist: string;
      album: string | null;
      duration: number | null;
      artwork_url: string | null;
      source_url: string | null;
      position: number;
      matched_track_id: string | null;
      created_at: string;
    }>;

  return {
    ...playlistSummary(row, user),
    tracks: entries.map((entry) => ({
      ...trackToDto(entry),
      entryId: entry.entry_id,
      position: entry.position,
    })),
    externalTracks: externalRows.map(
      (entry): ExternalPlaylistTrack => ({
        entryId: entry.entry_id,
        provider: entry.provider,
        providerTrackId: entry.provider_track_id,
        title: entry.title,
        artist: entry.artist,
        album: entry.album,
        duration: entry.duration,
        artworkUrl: entry.artwork_url,
        sourceUrl: entry.source_url,
        position: entry.position,
        matchedTrackId: entry.matched_track_id,
        status: entry.matched_track_id ? 'playable' : 'unavailable',
        createdAt: entry.created_at,
      }),
    ),
  };
}

export function playlistExists(id: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM playlists WHERE id = ?').get(id));
}

export function searchCatalog(
  query: string,
  limit = 20,
): { tracks: Track[]; albums: Album[]; artists: Artist[] } {
  const escaped = query.replace(/[%_\\]/g, (match) => `\\${match}`);
  const pattern = `%${escaped}%`;
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks
        WHERE lower(title) LIKE lower(?) ESCAPE '\\'
           OR lower(artist) LIKE lower(?) ESCAPE '\\'
           OR lower(album) LIKE lower(?) ESCAPE '\\'
           OR lower(album_artist) LIKE lower(?) ESCAPE '\\'
           OR lower(COALESCE(genre, '')) LIKE lower(?) ESCAPE '\\'
        ORDER BY added_at DESC
        LIMIT ?`,
    )
    .all(pattern, pattern, pattern, pattern, pattern, limit * 2) as TrackRow[];
  const tracks = rows.map(trackToDto).slice(0, limit);
  const library = getLibrary();
  const needle = query.toLocaleLowerCase('tr');
  return {
    tracks,
    albums: library.albums
      .filter((album) => album.name.toLocaleLowerCase('tr').includes(needle) || album.artist.toLocaleLowerCase('tr').includes(needle))
      .slice(0, limit),
    artists: library.artists
      .filter((artist) => artist.name.toLocaleLowerCase('tr').includes(needle))
      .slice(0, limit),
  };
}
