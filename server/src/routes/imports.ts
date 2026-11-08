import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { getDb, getTrackRow } from '../db.js';
import { getPlaylist } from '../library.js';
import { rateLimit } from '../ratelimit.js';

type ImportItem = {
  providerTrackId?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  duration?: unknown;
  artworkUrl?: unknown;
  sourceUrl?: unknown;
  matchedTrackId?: unknown;
};

type ImportBody = {
  provider?: unknown;
  sourceUrl?: unknown;
  sourcePlaylistId?: unknown;
  title?: unknown;
  description?: unknown;
  artworkUrl?: unknown;
  existingPlaylistId?: unknown;
  skipDuplicates?: unknown;
  selectedIndexes?: unknown;
  items?: unknown;
};

type CleanItem = {
  providerTrackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  artworkUrl: string | null;
  sourceUrl: string | null;
  matchedTrackId: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: { code: 'invalid_request', message } });
}

function conflict(reply: FastifyReply, code: string, message: string) {
  return reply.code(409).send({ error: { code, message } });
}

function cleanString(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean : null;
}

function cleanUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const url = value.trim().slice(0, 2048);
  return url.startsWith('http://') || url.startsWith('https://') ? url : undefined;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('tr').trim().replace(/\s+/g, ' ');
}

function findMatchingTrack(db: ReturnType<typeof getDb>, item: CleanItem): string | null {
  if (item.matchedTrackId && getTrackRow(item.matchedTrackId)) return item.matchedTrackId;
  const title = normalize(item.title);
  const artist = normalize(item.artist);
  const rows = db.prepare('SELECT id, title, artist, duration FROM tracks').all() as Array<{
    id: string;
    title: string;
    artist: string;
    duration: number;
  }>;
  let best: { id: string; score: number } | null = null;
  for (const row of rows) {
    const trackTitle = normalize(row.title);
    const trackArtist = normalize(row.artist);
    if (trackTitle !== title) continue;
    const artistMatches = !artist || artist === trackArtist || artist.includes(trackArtist) || trackArtist.includes(artist);
    if (!artistMatches) continue;
    if (item.duration !== null && row.duration > 0 && Math.abs(row.duration - item.duration) > 3) continue;
    const score = item.duration === null ? 0 : Math.abs(row.duration - item.duration);
    if (!best || score < best.score) best = { id: row.id, score };
  }
  return best?.id ?? null;
}

function cleanItem(value: unknown): CleanItem | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as ImportItem;
  const title = cleanString(body.title, 300);
  const artist = cleanString(body.artist, 300);
  if (!title || !artist) return null;
  const providerTrackId = cleanString(body.providerTrackId, 200);
  const album = cleanString(body.album, 300);
  const artworkUrl = cleanUrl(body.artworkUrl);
  const sourceUrl = cleanUrl(body.sourceUrl);
  const matchedTrackId = cleanString(body.matchedTrackId, 128);
  const duration = typeof body.duration === 'number' && Number.isFinite(body.duration) && body.duration >= 0 && body.duration <= 24 * 60 * 60
    ? body.duration
    : body.duration === null || body.duration === undefined
      ? null
      : undefined;
  if (providerTrackId === undefined || artworkUrl === undefined || sourceUrl === undefined || duration === undefined) {
    return null;
  }
  return {
    providerTrackId,
    title,
    artist,
    album,
    duration,
    artworkUrl,
    sourceUrl,
    matchedTrackId,
  };
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ImportBody }>(
    '/api/imports/playlist',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'playlist-import', max: 20, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body ?? {};
      const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
      const sourceUrl = cleanUrl(body.sourceUrl);
      const sourcePlaylistId = cleanString(body.sourcePlaylistId, 200);
      const title = cleanString(body.title, 80);
      const description = cleanString(body.description, 500) ?? '';
      const artworkUrl = cleanUrl(body.artworkUrl);
      const existingPlaylistId = cleanString(body.existingPlaylistId, 128);
      const skipDuplicates = body.skipDuplicates !== false;
      const allowedProviders = new Set(['spotify', 'youtube', 'youtube-music', 'norie']);

      if (!allowedProviders.has(provider)) return badRequest(reply, 'Desteklenmeyen sağlayıcı.');
      if (!sourceUrl) return badRequest(reply, 'Kaynak bağlantısı gerekli.');
      if (artworkUrl === undefined) return badRequest(reply, 'Kapak bağlantısı geçersiz.');
      if (!Array.isArray(body.items) || body.items.length === 0) return badRequest(reply, 'İçe aktarılacak parça listesi gerekli.');
      if (body.items.length > config.maxPlaylistTracks) {
        return conflict(reply, 'playlist_track_limit', `Liste en fazla ${config.maxPlaylistTracks} parça içerebilir.`);
      }

      const cleanedItems = body.items.map(cleanItem);
      if (cleanedItems.some((item) => item === null)) return badRequest(reply, 'Parça verileri eksik veya geçersiz.');
      let items: CleanItem[] = cleanedItems.filter((item): item is CleanItem => item !== null);

      if (Array.isArray(body.selectedIndexes)) {
        const selected = new Set(
          body.selectedIndexes
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < items.length),
        );
        items = items.filter((_, index) => selected.has(index));
        if (items.length === 0) return badRequest(reply, 'Seçilen parça yok.');
      }

      const db = getDb();
      let playlistId: string | null = null;
      let playlistName = title ?? '';

      if (existingPlaylistId) {
        const existing = getPlaylist(existingPlaylistId, user);
        if (!existing) return reply.code(404).send({ error: { code: 'playlist_not_found', message: 'Çalma listesi bulunamadı.' } });
        if (!existing.isOwner && user.role !== 'admin') {
          return reply.code(403).send({ error: { code: 'forbidden', message: 'Bu listeye parça ekleme yetkiniz yok.' } });
        }
        playlistId = existingPlaylistId;
        playlistName = existing.name;
      } else {
        if (!title) return badRequest(reply, 'Liste adı gerekli.');
        const duplicate = db
          .prepare(
            `SELECT id FROM playlists
             WHERE owner_id = ? AND source_provider = ? AND source_url = ?
             LIMIT 1`,
          )
          .get(user.id, provider, sourceUrl) as { id: string } | undefined;
        if (duplicate) {
          const playlist = getPlaylist(duplicate.id, user);
          const current = playlist ? playlist.tracks.length + playlist.externalTracks.length : 0;
          return {
            playlist,
            importedCount: 0,
            matchedCount: playlist?.tracks.length ?? 0,
            unmatchedCount: playlist?.externalTracks.length ?? 0,
            skippedCount: current,
            alreadyImported: true,
          };
        }
        const ownedCount = (db.prepare('SELECT COUNT(*) AS c FROM playlists WHERE owner_id = ?').get(user.id) as { c: number }).c;
        if (ownedCount >= config.maxPlaylistsPerAccount) {
          return conflict(
            reply,
            'playlist_limit',
            `Hesap başına en fazla ${config.maxPlaylistsPerAccount} liste oluşturabilirsiniz.`,
          );
        }
        playlistId = `pl_${randomBytes(8).toString('hex')}`;
        const timestamp = now();
        db.prepare(
          `INSERT INTO playlists (
             id, name, description, owner_id, visibility, pinned,
             source_provider, source_url, source_playlist_id, cover_url, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'private', 0, ?, ?, ?, ?, ?, ?)`,
        ).run(
          playlistId,
          playlistName,
          description,
          user.id,
          provider,
          sourceUrl,
          sourcePlaylistId,
          artworkUrl,
          timestamp,
          timestamp,
        );
      }

      const currentTrackCount = (
        db.prepare('SELECT COUNT(*) AS c FROM playlist_tracks WHERE playlist_id = ?').get(playlistId) as { c: number }
      ).c;
      const currentExternalCount = (
        db.prepare('SELECT COUNT(*) AS c FROM playlist_external_tracks WHERE playlist_id = ?').get(playlistId) as { c: number }
      ).c;
      if (currentTrackCount + currentExternalCount + items.length > config.maxPlaylistTracks) {
        return conflict(reply, 'playlist_track_limit', `Liste en fazla ${config.maxPlaylistTracks} parça içerebilir.`);
      }

      const maxPositionRows = [
        db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_tracks WHERE playlist_id = ?').get(playlistId) as { p: number },
        db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_external_tracks WHERE playlist_id = ?').get(playlistId) as { p: number },
      ];
      let nextPosition = Math.max(...maxPositionRows.map((row) => row.p)) + 1;
      let importedCount = 0;
      let matchedCount = 0;
      let unmatchedCount = 0;
      let skippedCount = 0;
      const timestamp = now();

      const existingTrackIds = new Set(
        (db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?').all(playlistId) as Array<{ track_id: string }>).map(
          (row) => row.track_id,
        ),
      );
      const existingExternalKeys = new Set(
        (
          db.prepare(
            `SELECT provider, provider_track_id, lower(title) AS title, lower(artist) AS artist
             FROM playlist_external_tracks WHERE playlist_id = ?`,
          ).all(playlistId) as Array<{
            provider: string;
            provider_track_id: string | null;
            title: string;
            artist: string;
          }>
        ).map((row) => `${row.provider}\0${row.provider_track_id ?? ''}\0${row.title}\0${row.artist}`),
      );

      const insertTrack = db.prepare(
        `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)`,
      );
      const insertExternal = db.prepare(
        `INSERT INTO playlist_external_tracks (
           playlist_id, provider, provider_track_id, title, artist, album, duration,
           artwork_url, source_url, position, matched_track_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const apply = db.transaction(() => {
        for (const item of items) {
          const matchedTrackId = findMatchingTrack(db, item);
          if (matchedTrackId) {
            if (skipDuplicates && existingTrackIds.has(matchedTrackId)) {
              skippedCount += 1;
              continue;
            }
            insertTrack.run(playlistId, matchedTrackId, nextPosition, timestamp);
            existingTrackIds.add(matchedTrackId);
            matchedCount += 1;
          } else {
            const externalKey = `${provider}\0${item.providerTrackId ?? ''}\0${normalize(item.title)}\0${normalize(item.artist)}`;
            if (skipDuplicates && existingExternalKeys.has(externalKey)) {
              skippedCount += 1;
              continue;
            }
            insertExternal.run(
              playlistId,
              provider,
              item.providerTrackId,
              item.title,
              item.artist,
              item.album,
              item.duration,
              item.artworkUrl,
              item.sourceUrl ?? sourceUrl,
              nextPosition,
              null,
              timestamp,
            );
            existingExternalKeys.add(externalKey);
            unmatchedCount += 1;
          }
          nextPosition += 1;
          importedCount += 1;
        }
        db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(timestamp, playlistId);
      });
      apply();

      return {
        playlist: getPlaylist(playlistId, user),
        importedCount,
        matchedCount,
        unmatchedCount,
        skippedCount,
        alreadyImported: false,
        playlistName,
      };
    },
  );
}
