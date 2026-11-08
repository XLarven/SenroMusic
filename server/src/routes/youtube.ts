import { execFile, execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { rateLimit } from '../ratelimit.js';
import { scanLibrary } from '../scanner.js';

const execFileAsync = promisify(execFile);

const PYTHON = process.env.PYTHON_PATH || 'python';
function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const stdout = execFileSync(PYTHON, ['-c', 'import imageio_ffmpeg,sys; sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const candidate = stdout.trim();
    if (candidate) return candidate;
  } catch {
    // fall through
  }
  return 'ffmpeg';
}

const FFMPEG = resolveFfmpeg();

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'track';
}

async function runYtDlp(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(PYTHON, ['-m', 'yt_dlp', ...args], {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout + (stderr ? `\n${stderr}` : '');
}

type YouTubeVideo = {
  id: string;
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string;
  url: string;
};

function parseYouTubeJsonLines(output: string): YouTubeVideo[] {
  const results: YouTubeVideo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const item = JSON.parse(trimmed) as {
        id?: string;
        title?: string;
        uploader?: string;
        channel?: string;
        duration?: number;
        thumbnails?: Array<{ url?: string }>;
        webpage_url?: string;
        url?: string;
      };
      if (!item.id || !item.title) continue;
      const thumb =
        item.thumbnails?.[item.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
      results.push({
        id: item.id,
        title: item.title,
        uploader: item.uploader || item.channel || 'Unknown',
        duration: typeof item.duration === 'number' ? item.duration : null,
        thumbnail: thumb,
        url: item.webpage_url || item.url || `https://www.youtube.com/watch?v=${item.id}`,
      });
    } catch {
      // ignore non-json lines
    }
  }
  const seen = new Set<string>();
  return results.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function extractPlaylistId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) return null;
    const list = url.searchParams.get('list');
    return list && list.length <= 128 ? list : null;
  } catch {
    return null;
  }
}

export async function youtubeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/youtube/search',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'youtube-search', max: 60, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request) => {
      const q = (request.query.q ?? '').trim();
      const limit = Math.min(Math.max(Number(request.query.limit) || 10, 1), 25);
      if (!q) return { results: [] };

      const output = await runYtDlp([
        `ytsearch${limit}:${q}`,
        '--dump-json',
        '--flat-playlist',
        '--no-warnings',
        '--no-playlist',
      ]);

      const results: Array<{
        id: string;
        title: string;
        uploader: string;
        duration: number | null;
        thumbnail: string;
        url: string;
      }> = [];

      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const item = JSON.parse(trimmed) as {
            id?: string;
            title?: string;
            uploader?: string;
            channel?: string;
            duration?: number;
            thumbnails?: Array<{ url?: string }>;
            webpage_url?: string;
            url?: string;
          };
          if (!item.id || !item.title) continue;
          const thumb =
            item.thumbnails?.[item.thumbnails.length - 1]?.url ||
            `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
          results.push({
            id: item.id,
            title: item.title,
            uploader: item.uploader || item.channel || 'Unknown',
            duration: typeof item.duration === 'number' ? item.duration : null,
            thumbnail: thumb,
            url: item.webpage_url || item.url || `https://www.youtube.com/watch?v=${item.id}`,
          });
        } catch {
          // ignore non-json lines
        }
      }

      // de-dupe by id
      const seen = new Set<string>();
      const unique = results.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });

      return { results: unique };
    },
  );

  app.get<{ Querystring: { url?: string } }>(
    '/api/youtube/playlist',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'youtube-playlist', max: 20, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request, reply) => {
      const rawUrl = (request.query.url ?? '').trim();
      const playlistId = extractPlaylistId(rawUrl);
      if (!playlistId) {
        return reply.code(400).send({
          error: { code: 'invalid_playlist_url', message: 'Geçerli bir YouTube çalma listesi bağlantısı girin.' },
        });
      }
      try {
        const output = await runYtDlp([
          `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
          '--dump-json',
          '--flat-playlist',
          '--no-warnings',
        ]);
        const items = parseYouTubeJsonLines(output).slice(0, 500);
        const title = items[0] ? `${items[0].uploader} öğeleri` : 'YouTube çalma listesi';
        return { title, items, total: items.length };
      } catch (error) {
        request.log.warn({ err: error }, 'youtube playlist metadata failed');
        return reply.code(502).send({
          error: { code: 'playlist_unavailable', message: 'Liste alınamadı. Özel veya kaldırılmış olabilir.' },
        });
      }
    },
  );

  app.post<{ Body: { id?: string; title?: string; uploader?: string; thumbnail?: string } }>(
    '/api/youtube/download',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'youtube-download', max: 20, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request, reply) => {
      const id = (request.body?.id ?? '').trim();
      if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) {
        return reply.code(400).send({ error: { code: 'bad_request', message: 'Geçersiz video kimliği.' } });
      }
      const title = request.body?.title?.trim() || id;
      const uploader = request.body?.uploader?.trim() || 'Unknown';
      const thumbnail =
        request.body?.thumbnail?.trim() || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

      const targetDir = join(config.musicDir, 'YouTube');
      await mkdir(targetDir, { recursive: true });

      const tmpDir = join(config.dataDir, 'tmp', `yt-${id}-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });

      try {
        const url = `https://www.youtube.com/watch?v=${id}`;
        await runYtDlp([
          url,
          '-f',
          'bestaudio',
          '--no-playlist',
          '--no-warnings',
          '-o',
          join(tmpDir, '%(id)s.%(ext)s'),
        ]);

        const files = await readdir(tmpDir);
        const audioFile = files.find((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (!audioFile) {
          return reply.code(500).send({ error: { code: 'download_failed', message: 'İndirilen dosya bulunamadı.' } });
        }
        const inputPath = join(tmpDir, audioFile);

        // Download thumbnail for cover art (best effort)
        let thumbPath: string | null = null;
        try {
          const res = await fetch(thumbnail);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            thumbPath = join(tmpDir, 'cover.jpg');
            await writeFile(thumbPath, buf);
          }
        } catch {
          thumbPath = null;
        }

        const safeBase = sanitizeFileName(`${uploader} - ${title}`);
        const outputPath = join(targetDir, `${safeBase}.mp3`);

        const ffmpegArgs: string[] = ['-y', '-i', inputPath];
        if (thumbPath) ffmpegArgs.push('-i', thumbPath);
        ffmpegArgs.push(
          '-map', '0:a',
        );
        if (thumbPath) {
          ffmpegArgs.push('-map', '1:v');
        }
        ffmpegArgs.push(
          '-c:a', 'libmp3lame',
          '-q:a', '2',
        );
        if (thumbPath) {
          ffmpegArgs.push('-c:v', 'mjpeg', '-id3v2_version', '3');
        }
        ffmpegArgs.push(
          '-metadata', `title=${title}`,
          '-metadata', `artist=${uploader}`,
          '-metadata', 'album=YouTube',
        );
        if (thumbPath) {
          ffmpegArgs.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover');
        }
        ffmpegArgs.push(outputPath);

        await execFileAsync(FFMPEG, ffmpegArgs, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });

        const scanResult = await scanLibrary();

        return { ok: true, path: outputPath, scan: scanResult };
      } catch (error) {
        request.log.error({ err: error }, 'youtube download failed');
        return reply.code(500).send({
          error: { code: 'download_failed', message: (error as Error).message || 'İndirme başarısız.' },
        });
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  );
}
