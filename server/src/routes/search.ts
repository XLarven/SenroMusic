import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../ratelimit.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PYTHON = process.env.PYTHON_PATH || 'python';

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>(
    '/api/search/suggestions',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'search-suggest', max: 120, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request) => {
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) return { texts: [], songs: [] };

      try {
        const { stdout } = await execFileAsync(PYTHON, ['-m', 'yt_dlp', '--dump-json', '--flat-playlist', '-I', '1:8', '-J', `ytsearch8:${q}`], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 8_000,
        });
        const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
        const songs: Array<{ id: string; title: string; artist: string; thumbnail: string; duration: number | null }> = [];
        const seen = new Set<string>();
        for (const line of lines) {
          try {
            const item = JSON.parse(line) as any;
            if (!item.id || !item.title || seen.has(item.id)) continue;
            seen.add(item.id);
            songs.push({
              id: item.id,
              title: item.title,
              artist: item.uploader || item.channel || 'Unknown',
              thumbnail: item.thumbnails?.[item.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
              duration: typeof item.duration === 'number' ? Math.round(item.duration) : null,
            });
            if (songs.length >= 6) break;
          } catch {
            // ignore
          }
        }
        const texts = songs.map((s) => s.title).slice(0, 5);
        return { texts, songs };
      } catch {
        return { texts: [], songs: [] };
      }
    },
  );

  app.get<{ Querystring: { id?: string } }>(
    '/api/youtube/similar',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'youtube-similar', max: 30, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request) => {
      const id = (request.query.id ?? '').trim();
      if (!id) return { results: [] };

      try {
        const { stdout } = await execFileAsync(PYTHON, ['-m', 'yt_dlp', '--dump-json', '--flat-playlist', '-I', '1:10', '-J', `https://www.youtube.com/watch?v=${id}`], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 15_000,
        });
        const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
        const results: Array<{ id: string; title: string; uploader: string; duration: number | null; thumbnail: string }> = [];
        const seen = new Set<string>([id]);
        for (const line of lines) {
          try {
            const item = JSON.parse(line) as any;
            if (!item.id || !item.title || seen.has(item.id)) continue;
            seen.add(item.id);
            results.push({
              id: item.id,
              title: item.title,
              uploader: item.uploader || item.channel || 'Unknown',
              duration: typeof item.duration === 'number' ? Math.round(item.duration) : null,
              thumbnail: item.thumbnails?.[item.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
            });
            if (results.length >= 8) break;
          } catch {
            // ignore
          }
        }
        return { results };
      } catch {
        return { results: [] };
      }
    },
  );
}