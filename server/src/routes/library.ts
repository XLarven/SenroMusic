import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { coverMime, resolveCoverPath } from '../covers.js';
import { getLibrary } from '../library.js';
import { getTrackRow } from '../db.js';
import { parseRange } from '../range.js';
import { isScanning, scanLibrary } from '../scanner.js';

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  wave: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  wma: 'audio/x-ms-wma',
};

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !rel.includes('..\\') && !rel.includes('../');
}

function audioMime(filePath: string): string {
  return AUDIO_MIME[extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

function etagFor(id: string, size: number, mtimeMs: number): string {
  return `"${id}-${size}-${Math.round(mtimeMs)}"`;
}

function contentDisposition(filePath: string): string {
  const name = basename(filePath).replace(/["\r\n]/g, '_');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const library = getLibrary();
    return {
      status: 'ok',
      name: 'Norie Music',
      version: '0.10.0',
      tracks: library.stats.tracks,
      scanning: isScanning(),
      demoToken: config.demoToken,
      lastScanAt: library.stats.lastScanAt,
    };
  });

  app.get('/api/library', { preHandler: requireAuth }, async () => getLibrary());

  app.post('/api/scan', { preHandler: requireAuth }, async () => {
    const alreadyRunning = isScanning();
    const result = await scanLibrary();
    return { ...result, alreadyRunning };
  });

  app.get<{ Params: { id: string } }>('/api/covers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const filePath = resolveCoverPath(request.params.id);
    if (!filePath) {
      return reply.code(404).send({ error: { code: 'cover_not_found', message: 'Kapak bulunamadı.' } });
    }
    return reply
      .type(coverMime(request.params.id))
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(createReadStream(filePath));
  });

  app.get<{ Params: { id: string } }>(
    '/api/tracks/:id/stream',
    { preHandler: requireAuth },
    async (request, reply) => {
      const row = getTrackRow(request.params.id);
      if (!row || !isInside(config.musicDir, row.path)) {
        return reply.code(404).send({ error: { code: 'track_not_found', message: 'Parça bulunamadı.' } });
      }
      let fileStat;
      try {
        fileStat = await stat(row.path);
      } catch {
        return reply.code(404).send({ error: { code: 'file_missing', message: 'Dosya sunucuda bulunamadı.' } });
      }

      const etag = etagFor(row.id, fileStat.size, fileStat.mtimeMs);
      reply
        .header('Accept-Ranges', 'bytes')
        .header('ETag', etag)
        .header('Cache-Control', 'private, max-age=0, must-revalidate')
        .header('X-Content-Type-Options', 'nosniff');

      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }

      const parsed = parseRange(request.headers.range, fileStat.size);
      if (parsed.kind === 'invalid') {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${fileStat.size}`)
          .send({ error: { code: 'invalid_range', message: 'Geçersiz Range isteği.' } });
      }

      reply.type(audioMime(row.path));
      if (parsed.kind === 'none') {
        return reply
          .header('Content-Length', fileStat.size)
          .send(createReadStream(row.path));
      }

      const { start, end } = parsed.range;
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${fileStat.size}`)
        .header('Content-Length', end - start + 1)
        .send(createReadStream(row.path, { start, end }));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/tracks/:id/download',
    { preHandler: requireAuth },
    async (request, reply) => {
      const row = getTrackRow(request.params.id);
      if (!row || !isInside(config.musicDir, row.path)) {
        return reply.code(404).send({ error: { code: 'track_not_found', message: 'Parça bulunamadı.' } });
      }
      try {
        const fileStat = await stat(row.path);
        return reply
          .type(audioMime(row.path))
          .header('Content-Length', fileStat.size)
          .header('Content-Disposition', contentDisposition(row.path))
          .header('Cache-Control', 'private, max-age=0')
          .send(createReadStream(row.path));
      } catch {
        return reply.code(404).send({ error: { code: 'file_missing', message: 'Dosya sunucuda bulunamadı.' } });
      }
    },
  );
}
