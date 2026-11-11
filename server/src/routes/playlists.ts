import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb, getTrackRow } from '../db.js';
import { cacheCoverBuffer } from '../covers.js';
import { getPlaylist, getPlaylists, playlistExists } from '../library.js';
import { rateLimit } from '../ratelimit.js';
import type { UserRow } from '../users.js';

type PlaylistBody = {
  name?: unknown;
  description?: unknown;
  visibility?: unknown;
};
type AddTrackBody = { trackId?: unknown };
type ReorderBody = { entryIds?: unknown };
type CoverBody = { imageDataUrl?: unknown; dataUrl?: unknown };

function now(): string {
  return new Date().toISOString();
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: { code: 'invalid_request', message } });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'playlist_not_found', message: 'Çalma listesi bulunamadı.' } });
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ error: { code: 'forbidden', message: 'Bu listeyi değiştirme yetkiniz yok.' } });
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 80 ? name : null;
}

function cleanDescription(value: unknown): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;
  const description = value.trim();
  return description.length <= 500 ? description : null;
}

function cleanVisibility(
  value: unknown,
  fallback: 'private' | 'public' = 'private',
): 'private' | 'public' | null {
  if (value === undefined) return fallback;
  return value === 'private' || value === 'public' ? value : null;
}

function isAllowedMutate(user: UserRow, profile: { isOwner: boolean; visibility: 'private' | 'public' }): boolean {
  return profile.isOwner || user.role === 'admin';
}

function parseImageBody(value: unknown): { bytes: Buffer; mime: string } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1] === 'jpeg' ? 'image/jpeg' : 'image/png';
  const bytes = Buffer.from(match[2] ?? '', 'base64');
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) return null;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngHeader = bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  return (mime === 'image/jpeg' && isJpeg) || (mime === 'image/png' && pngHeader)
    ? { bytes, mime }
    : null;
}

const writeLimiter = rateLimit({ name: 'playlist-write', max: 60, windowMs: 60_000, keyBy: 'user' });

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playlists', { preHandler: requireAuth }, async (request) => ({
    playlists: getPlaylists(request.user),
  }));

  app.get<{ Params: { id: string } }>(
    '/api/playlists/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const playlist = getPlaylist(request.params.id, request.user);
      return playlist ?? notFound(reply);
    },
  );

  app.get<{ Params: { slug: string } }>(
    '/api/public-playlists/:slug',
    {
      preHandler: rateLimit({ name: 'public-playlist', max: 60, windowMs: 60_000 }),
    },
    async (request, reply) => {
      const row = getDb()
        .prepare('SELECT id FROM playlists WHERE share_slug = ? AND visibility = ?')
        .get(request.params.slug, 'public') as { id: string } | undefined;
      if (!row) return notFound(reply);
      const user = request.user ?? null;
      const playlist = getPlaylist(row.id, user);
      return playlist ?? notFound(reply);
    },
  );

  app.post<{ Body: PlaylistBody }>(
    '/api/playlists',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const name = cleanName(request.body?.name);
      const description = cleanDescription(request.body?.description);
      const visibility = cleanVisibility(request.body?.visibility);
      if (!name) return badRequest(reply, 'Çalma listesi adı 1-80 karakter olmalı.');
      if (description === null) return badRequest(reply, 'Açıklama en fazla 500 karakter olabilir.');
      if (!visibility) return badRequest(reply, 'Görünürlük private veya public olmalı.');

      const id = `pl_${randomBytes(8).toString('hex')}`;
      const timestamp = now();
      getDb()
        .prepare(
          `INSERT INTO playlists (id, name, description, owner_id, visibility, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(id, name, description, request.user!.id, visibility, timestamp, timestamp);
      return reply.code(201).send(getPlaylist(id, request.user));
    },
  );

  app.patch<{ Params: { id: string }; Body: PlaylistBody }>(
    '/api/playlists/:id',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!isAllowedMutate(user, profile)) return forbidden(reply);

      const name = request.body?.name === undefined ? profile.name : cleanName(request.body.name);
      const description =
        request.body?.description === undefined
          ? profile.description
          : cleanDescription(request.body.description);
      const visibility = cleanVisibility(request.body?.visibility, profile.visibility);
      if (!name) return badRequest(reply, 'Çalma listesi adı 1-80 karakter olmalı.');
      if (description === null) return badRequest(reply, 'Açıklama en fazla 500 karakter olabilir.');
      if (!visibility) return badRequest(reply, 'Görünürlük private veya public olmalı.');

      getDb()
        .prepare('UPDATE playlists SET name = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?')
        .run(name, description, visibility, now(), request.params.id);
      return getPlaylist(request.params.id, user);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/playlists/:id',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!isAllowedMutate(user, profile)) return forbidden(reply);
      const result = getDb().prepare('DELETE FROM playlists WHERE id = ?').run(request.params.id);
      if (result.changes === 0) return notFound(reply);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/playlists/:id/duplicate',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const source = getPlaylist(request.params.id, user);
      if (!source) return notFound(reply);
      const id = `pl_${randomBytes(8).toString('hex')}`;
      const timestamp = now();
      const copyName = `${source.name.slice(0, 68)} kopyası`.slice(0, 80);
      const run = getDb().transaction(() => {
        getDb()
          .prepare(
            `INSERT INTO playlists (id, name, description, owner_id, visibility, pinned, cover_id, cover_url, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'private', 0, ?, ?, ?, ?)`,
          )
          .run(id, copyName, source.description, user.id, null, null, timestamp, timestamp);
        const entries = getDb()
          .prepare(
            `SELECT track_id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, entry_id`,
          )
          .all(request.params.id) as Array<{ track_id: string; position: number }>;
        const insert = getDb()
          .prepare(
            `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
             VALUES (?, ?, ?, ?)`,
          );
        for (const entry of entries) insert.run(id, entry.track_id, entry.position, timestamp);
      });
      run();
      return reply.code(201).send(getPlaylist(id, user));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/playlists/:id/pin',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!profile.isOwner) return forbidden(reply);
      const row = getDb().prepare('SELECT pinned FROM playlists WHERE id = ?').get(request.params.id) as { pinned: number };
      const pinned = row.pinned ? 0 : 1;
      getDb().prepare('UPDATE playlists SET pinned = ?, updated_at = ? WHERE id = ?').run(pinned, now(), request.params.id);
      return { ok: true, pinned: Boolean(pinned) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/playlists/:id/share',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!profile.isOwner) return forbidden(reply);
      const row = getDb().prepare('SELECT share_slug FROM playlists WHERE id = ?').get(request.params.id) as { share_slug: string | null };
      const slug = row.share_slug ?? randomBytes(8).toString('hex');
      getDb()
        .prepare('UPDATE playlists SET visibility = ?, share_slug = ?, updated_at = ? WHERE id = ?')
        .run('public', slug, now(), request.params.id);
      return { ok: true, shareSlug: slug, shareUrl: `/p/${slug}` };
    },
  );

  app.post<{ Params: { id: string }; Body: CoverBody }>(
    '/api/playlists/:id/cover',
    { preHandler: [requireAuth, writeLimiter], bodyLimit: 5_800_000 },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!isAllowedMutate(user, profile)) return forbidden(reply);
      const parsed = parseImageBody(request.body?.imageDataUrl ?? request.body?.dataUrl);
      if (!parsed) return badRequest(reply, 'JPEG veya PNG görsel gerekli (en fazla 4 MB).');
      const coverId = await cacheCoverBuffer(parsed.bytes, parsed.mime);
      if (!coverId) return badRequest(reply, 'Görsel saklanamadı.');
      getDb()
        .prepare('UPDATE playlists SET cover_id = ?, cover_url = NULL, updated_at = ? WHERE id = ?')
        .run(coverId, now(), request.params.id);
      return getPlaylist(request.params.id, user);
    },
  );

  app.post<{ Params: { id: string }; Body: AddTrackBody }>(
    '/api/playlists/:id/tracks',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!isAllowedMutate(user, profile)) return forbidden(reply);
      const trackId = typeof request.body?.trackId === 'string' ? request.body.trackId : '';
      if (!trackId) return badRequest(reply, 'trackId gerekli.');
      if (!getTrackRow(trackId)) return reply.code(404).send({ error: { code: 'track_not_found', message: 'Parça bulunamadı.' } });

      const positionRow = getDb()
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM playlist_tracks WHERE playlist_id = ?')
        .get(request.params.id) as { position: number };
      const info = getDb()
        .prepare(
          `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(request.params.id, trackId, positionRow.position, now());
      getDb().prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), request.params.id);
      return reply.code(201).send({ ok: true, entryId: Number(info.lastInsertRowid) });
    },
  );

  app.delete<{ Params: { id: string; entryId: string } }>(
    '/api/playlists/:id/tracks/:entryId',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!isAllowedMutate(user, profile)) return forbidden(reply);
      const entryId = Number.parseInt(request.params.entryId, 10);
      if (!Number.isInteger(entryId) || entryId <= 0) return badRequest(reply, 'Geçersiz kayıt kimliği.');
      const result = getDb()
        .prepare('DELETE FROM playlist_tracks WHERE entry_id = ? AND playlist_id = ?')
        .run(entryId, request.params.id);
      if (result.changes === 0) {
        return reply.code(404).send({ error: { code: 'entry_not_found', message: 'Liste kaydı bulunamadı.' } });
      }
      getDb().prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), request.params.id);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; entryId: string } }>(
    '/api/playlists/:id/external/:entryId',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!isAllowedMutate(user, profile)) return forbidden(reply);
      const entryId = Number.parseInt(request.params.entryId, 10);
      if (!Number.isInteger(entryId) || entryId <= 0) return badRequest(reply, 'Geçersiz kayıt kimliği.');
      const result = getDb()
        .prepare('DELETE FROM playlist_external_tracks WHERE entry_id = ? AND playlist_id = ?')
        .run(entryId, request.params.id);
      if (result.changes === 0) {
        return reply.code(404).send({ error: { code: 'entry_not_found', message: 'Liste kaydı bulunamadı.' } });
      }
      getDb().prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), request.params.id);
      return { ok: true };
    },
  );

  app.put<{ Params: { id: string }; Body: ReorderBody }>(
    '/api/playlists/:id/order',
    { preHandler: [requireAuth, writeLimiter] },
    async (request, reply) => {
      const user = request.user!;
      const profile = getPlaylist(request.params.id, user);
      if (!profile) return notFound(reply);
      if (!isAllowedMutate(user, profile)) return forbidden(reply);
      if (!playlistExists(request.params.id)) return notFound(reply);
      if (!Array.isArray(request.body?.entryIds)) return badRequest(reply, 'entryIds dizisi gerekli.');
      const entryIds = request.body.entryIds.map((value) => Number(value));
      if (entryIds.some((value) => !Number.isInteger(value) || value <= 0)) {
        return badRequest(reply, 'entryIds yalnızca pozitif tam sayı içermeli.');
      }

      const existing = getDb()
        .prepare('SELECT entry_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, entry_id')
        .all(request.params.id) as Array<{ entry_id: number }>;
      const existingIds = existing.map((row) => row.entry_id);
      if (
        entryIds.length !== existingIds.length ||
        new Set(entryIds).size !== entryIds.length ||
        !entryIds.every((id) => existingIds.includes(id))
      ) {
        return badRequest(reply, 'entryIds mevcut liste kayıtlarıyla birebir eşleşmeli.');
      }

      const update = getDb().prepare('UPDATE playlist_tracks SET position = ? WHERE entry_id = ?');
      const apply = getDb().transaction(() => {
        entryIds.forEach((entryId, index) => update.run(index, entryId));
        getDb().prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), request.params.id);
      });
      apply();
      return { ok: true };
    },
  );
}
