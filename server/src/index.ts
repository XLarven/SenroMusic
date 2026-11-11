import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config, paths } from './config.js';
import { closeDb } from './db.js';
import { closeMysql, initMysqlSchema, mirrorAll } from './mysqldb.js';
import { authRoutes } from './routes/auth.js';
import { importRoutes } from './routes/imports.js';
import { libraryRoutes } from './routes/library.js';
import { meRoutes } from './routes/me.js';
import { playlistRoutes } from './routes/playlists.js';
import { youtubeRoutes } from './routes/youtube.js';
import { spotifyRoutes } from './routes/spotify.js';
import { searchRoutes } from './routes/search.js';
import { mediaRoutes } from './routes/media.js';
import { artworkRoutes } from './routes/artwork.js';
import { localeRoutes } from './routes/locale.js';
import { scanLibrary } from './scanner.js';

export async function buildServer() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Geliştirme: localhost/127.0.0.1 her portu (5173, 5174, ...) izin ver
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed'), false);
    },
    credentials: true,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // Playback goes through /api/media/stream, so no third-party script or
    // frame is needed anywhere in the app.
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    );
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (request.protocol === 'https' || config.secureCookies) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    else request.log.warn({ err: error }, 'request rejected');
    reply.code(status).send({
      error: {
        code: status === 500 ? 'internal_error' : 'bad_request',
        message: status === 500 ? 'Beklenmeyen bir sunucu hatası oluştu.' : message,
      },
    });
  });

  await app.register(authRoutes);
  await app.register(libraryRoutes);
  await app.register(meRoutes);
  await app.register(importRoutes);
  await app.register(playlistRoutes);
  await app.register(youtubeRoutes);
  await app.register(spotifyRoutes);
  await app.register(searchRoutes);
  await app.register(mediaRoutes);
  await app.register(artworkRoutes);
  await app.register(localeRoutes);

  if (existsSync(paths.webIndex)) {
    await app.register(fastifyStatic, {
      root: paths.webAssets,
      prefix: '/',
      wildcard: false,
      index: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Uç nokta bulunamadı.' } });
    }
    if (existsSync(paths.webIndex)) {
      return reply.sendFile('index.html');
    }
    return reply
      .code(503)
      .type('text/plain')
      .send('Norie Music web arayüzü henüz derlenmedi. `pnpm build` çalıştırın.');
  });

  return app;
}

async function main(): Promise<void> {
  mkdirSync(config.musicDir, { recursive: true });
  const app = await buildServer();

  if (config.mysqlHost) {
    const ok = await initMysqlSchema();
    app.log.info(`MySQL ${ok ? 'bağlantısı kuruldu' : 'bağlanamadı'} (${config.mysqlHost}:${config.mysqlPort}/${config.mysqlDatabase})`);
    if (ok) void mirrorAll();
  }

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Music directory: ${resolve(config.musicDir)}`);
  app.log.info(`Data directory: ${resolve(config.dataDir)}`);

  if (config.scanOnStart) {
    void scanLibrary()
      .then((result) => {
        app.log.info(
          `Library scan complete: ${result.scanned} files, ${result.added} added, ` +
            `${result.updated} updated, ${result.removed} removed, ${result.failed} failed ` +
            `in ${result.durationMs} ms`,
        );
      })
      .catch((error) => app.log.error({ err: error }, 'initial library scan failed'));
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    try {
      await app.close();
    } finally {
      await closeMysql();
      closeDb();
    }
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
