import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { getPlaylist, getPlaylists, playlistExists } from '../library.js';

type PlaylistBody = { name?: unknown; description?: unknown };
type AddTrackBody = { trackId?: unknown };
type ReorderBody = { entryIds?: unknown };

function now(): string {
  return new Date().toISOString();
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: { code: 'invalid_request', message } });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'playlist_not_found', message: 'Çalma listesi bulunamadı.' } });
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

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playlists', { preHandler: requireAuth }, async () => ({
    playlists: getPlaylists(),
  }));

  app.get<{ Params: { id: string } }>(
    '/api/playlists/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const playlist = getPlaylist(request.params.id);
      return playlist ?? notFound(reply);
    },
  );

  app.post<{ Body: PlaylistBody }>(
    '/api/playlists',
    { preHandler: requireAuth },
    async (request, reply) => {
      const name = cleanName(request.body?.name);
      const description = cleanDescription(request.body?.description);
      if (!name) return badRequest(reply, 'Çalma listesi adı 1-80 karakter olmalı.');
      if (description === null) return badRequest(reply, 'Açıklama en fazla 500 karakter olabilir.');

      const id = `pl_${randomBytes(8).toString('hex')}`;
      const timestamp = now();
      getDb()
        .prepare(
          `INSERT INTO playlists (id, name, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, name, description, timestamp, timestamp);
      return reply.code(201).send(getPlaylist(id));
    },
  );

  app.patch<{ Params: { id: string }; Body: PlaylistBody }>(
    '/api/playlists/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!playlistExists(request.params.id)) return notFound(reply);
      const current = getPlaylist(request.params.id);
      if (!current) return notFound(reply);

      const name = request.body?.name === undefined ? current.name : cleanName(request.body.name);
      const description =
        request.body?.description === undefined
          ? current.description
          : cleanDescription(request.body.description);
      if (!name) return badRequest(reply, 'Çalma listesi adı 1-80 karakter olmalı.');
      if (description === null) return badRequest(reply, 'Açıklama en fazla 500 karakter olabilir.');

      getDb()
        .prepare('UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?')
        .run(name, description, now(), request.params.id);
      return getPlaylist(request.params.id);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/playlists/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const result = getDb().prepare('DELETE FROM playlists WHERE id = ?').run(request.params.id);
      if (result.changes === 0) return notFound(reply);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: AddTrackBody }>(
    '/api/playlists/:id/tracks',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!playlistExists(request.params.id)) return notFound(reply);
      const trackId = typeof request.body?.trackId === 'string' ? request.body.trackId : '';
      if (!trackId) return badRequest(reply, 'trackId gerekli.');
      const track = getDb().prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId);
      if (!track) return reply.code(404).send({ error: { code: 'track_not_found', message: 'Parça bulunamadı.' } });

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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!playlistExists(request.params.id)) return notFound(reply);
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

  app.put<{ Params: { id: string }; Body: ReorderBody }>(
    '/api/playlists/:id/order',
    { preHandler: requireAuth },
    async (request, reply) => {
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
