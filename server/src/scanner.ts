import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { parseFile } from 'music-metadata';
import { AUDIO_EXTENSIONS, config } from './config.js';
import { cacheCoverBuffer, cacheCoverFile, findSidecarCover } from './covers.js';
import { getDb, getMeta, setMeta, type TrackRow } from './db.js';
import type { ScanResult } from './types.js';

type ParsedTrack = Omit<TrackRow, 'added_at'>;

let activeScan: Promise<ScanResult> | null = null;

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function normalizeRelPath(value: string): string {
  return value.split(sep).join('/');
}

function pathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.includes(`..${sep}`);
}

async function collectAudioFiles(dir: string, output: string[]): Promise<void> {
  if (output.length >= config.maxScanFiles) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`[scan] cannot read ${dir}:`, (error as Error).message);
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const entry of entries) {
    if (output.length >= config.maxScanFiles) return;
    if (entry.name.startsWith('.') || entry.name === '@eaDir' || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectAudioFiles(fullPath, output);
      continue;
    }
    if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      output.push(fullPath);
    }
  }
}

function fallbackMetadata(filePath: string): {
  title: string;
  artist: string;
  album: string;
  trackNo: number | null;
} {
  const folder = basename(dirname(filePath));
  const parent = basename(dirname(dirname(filePath)));
  const fileBase = basename(filePath, extname(filePath));
  const match = /^(\d{1,3})\s*[-._ ]\s*(.+)$/.exec(fileBase);
  const trackNo = match ? Number.parseInt(match[1], 10) : null;
  const title = (match?.[2] ?? fileBase).replace(/[_]+/g, ' ').trim();
  const artist = parent && parent !== folder ? parent : 'Unknown Artist';
  return { title, artist, album: folder, trackNo };
}

async function parseTrack(filePath: string, fileStat: Stats): Promise<ParsedTrack> {
  const relPath = normalizeRelPath(relative(config.musicDir, filePath));
  const fallback = fallbackMetadata(filePath);
  let title = fallback.title;
  let artist = fallback.artist;
  let album = fallback.album;
  let albumArtist = fallback.artist;
  let genre: string | null = null;
  let year: number | null = null;
  let trackNo: number | null = fallback.trackNo;
  let discNo: number | null = null;
  let duration = 0;
  let bitrate: number | null = null;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let format: string | null = extname(filePath).slice(1).toUpperCase() || null;
  let coverId: string | null = null;

  try {
    const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
    const common = metadata.common;
    const details = metadata.format;
    title = common.title?.trim() || title;
    artist = common.artist?.trim() || common.albumartist?.trim() || artist;
    album = common.album?.trim() || album;
    albumArtist = common.albumartist?.trim() || artist;
    genre = common.genre?.[0]?.trim() || null;
    year = common.year ?? null;
    trackNo = common.track?.no ?? trackNo;
    discNo = common.disk?.no ?? null;
    duration = Number.isFinite(details.duration) ? Number(details.duration) : 0;
    bitrate = details.bitrate ? Math.round(details.bitrate) : null;
    sampleRate = details.sampleRate ?? null;
    channels = details.numberOfChannels ?? null;
    format = details.container?.toUpperCase() || format;

    const picture = common.picture?.[0];
    if (picture?.data && picture.format) {
      coverId = await cacheCoverBuffer(Buffer.from(picture.data), picture.format);
    }
  } catch (error) {
    console.warn(`[scan] metadata failed for ${relPath}:`, (error as Error).message);
  }

  if (!coverId) {
    const sidecar = findSidecarCover(dirname(filePath));
    if (sidecar) {
      try {
        coverId = await cacheCoverFile(sidecar);
      } catch (error) {
        console.warn(`[scan] cover failed for ${relPath}:`, (error as Error).message);
      }
    }
  }

  const now = new Date().toISOString();
  return {
    id: stableId('t', relPath),
    path: filePath,
    rel_path: relPath,
    title,
    artist,
    album,
    album_artist: albumArtist,
    genre,
    year,
    track_no: trackNo,
    disc_no: discNo,
    duration,
    bitrate,
    sample_rate: sampleRate,
    channels,
    format,
    size: fileStat.size,
    mtime: Math.round(fileStat.mtimeMs),
    cover_id: coverId,
    updated_at: now,
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function isScanning(): boolean {
  return activeScan !== null;
}

export function scanLibrary(): Promise<ScanResult> {
  if (activeScan) return activeScan;
  activeScan = performScan().finally(() => {
    activeScan = null;
  });
  return activeScan;
}

async function performScan(): Promise<ScanResult> {
  const startedAt = Date.now();
  const db = getDb();
  const files: string[] = [];
  await collectAudioFiles(config.musicDir, files);
  if (files.length >= config.maxScanFiles) {
    console.warn(`[scan] file limit reached (${config.maxScanFiles}); remaining files were skipped`);
  }

  const existingRows = db.prepare('SELECT * FROM tracks').all() as TrackRow[];
  const existingByPath = new Map(existingRows.map((row) => [row.path, row]));
  const seenIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let failed = 0;

  const rows = await mapLimit(files, 4, async (filePath) => {
    if (!pathInside(config.musicDir, filePath)) {
      failed += 1;
      return null;
    }
    try {
      const fileStat = await stat(filePath);
      const existing = existingByPath.get(filePath);
      if (existing && existing.size === fileStat.size && existing.mtime === Math.round(fileStat.mtimeMs)) {
        seenIds.add(existing.id);
        return { ...existing, added_at: existing.added_at };
      }
      const parsed = await parseTrack(filePath, fileStat);
      seenIds.add(parsed.id);
      if (existing) updated += 1;
      else added += 1;
      return {
        ...parsed,
        added_at: existing?.added_at ?? parsed.updated_at,
      };
    } catch (error) {
      failed += 1;
      console.warn(`[scan] failed for ${filePath}:`, (error as Error).message);
      return null;
    }
  });

  const validRows = rows.filter((row): row is TrackRow => row !== null);
  const removedIds = existingRows.filter((row) => !seenIds.has(row.id)).map((row) => row.id);

  const upsert = db.prepare(`
    INSERT INTO tracks (
      id, path, rel_path, title, artist, album, album_artist, genre, year,
      track_no, disc_no, duration, bitrate, sample_rate, channels, format,
      size, mtime, cover_id, added_at, updated_at
    ) VALUES (
      @id, @path, @rel_path, @title, @artist, @album, @album_artist, @genre, @year,
      @track_no, @disc_no, @duration, @bitrate, @sample_rate, @channels, @format,
      @size, @mtime, @cover_id, @added_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      path = excluded.path,
      rel_path = excluded.rel_path,
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      album_artist = excluded.album_artist,
      genre = excluded.genre,
      year = excluded.year,
      track_no = excluded.track_no,
      disc_no = excluded.disc_no,
      duration = excluded.duration,
      bitrate = excluded.bitrate,
      sample_rate = excluded.sample_rate,
      channels = excluded.channels,
      format = excluded.format,
      size = excluded.size,
      mtime = excluded.mtime,
      cover_id = excluded.cover_id,
      updated_at = excluded.updated_at
  `);
  const remove = db.prepare('DELETE FROM tracks WHERE id = ?');
  const apply = db.transaction(() => {
    for (const row of validRows) upsert.run(row);
    for (const id of removedIds) remove.run(id);
  });
  apply();

  const lastScanAt = new Date().toISOString();
  setMeta('last_scan_at', lastScanAt);
  setMeta('track_count', String(validRows.length));

  // MySQL aynası (opsiyonel)
  import('./mysqldb.js')
    .then((m) => m.mirrorTracksPlaylists())
    .catch(() => undefined);

  return {
    scanned: files.length,
    added,
    updated,
    removed: removedIds.length,
    failed,
    durationMs: Date.now() - startedAt,
    lastScanAt,
  };
}

export function lastScanAt(): string | null {
  return getMeta('last_scan_at');
}
