import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../ratelimit.js';
import { artistOf, rankCandidates } from '../searchQuality.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PYTHON = process.env.PYTHON_PATH || 'python';

type YtItem = {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnails?: Array<{ url?: string }>;
  webpage_url?: string;
  url?: string;
};

function toSong(item: YtItem) {
  if (!item.id || !item.title) return null;
  return {
    id: item.id,
    title: item.title,
    artist: artistOf({ title: item.title, uploader: item.uploader, artist: item.channel }),
    thumbnail:
      item.thumbnails?.[item.thumbnails.length - 1]?.url ||
      `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    duration: typeof item.duration === 'number' ? Math.round(item.duration) : null,
    url: item.webpage_url || item.url || `https://www.youtube.com/watch?v=${item.id}`,
  };
}

async function ytSearchJson(query: string, count: number, timeoutMs = 9000) {
  const { stdout } = await execFileAsync(
    PYTHON,
    ['-m', 'yt_dlp', '--dump-json', '--flat-playlist', '--no-warnings', '-I', `1:${count}`, '-J', query],
    { maxBuffer: 12 * 1024 * 1024, timeout: timeoutMs },
  );
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  const items: YtItem[] = [];
  for (const line of lines) {
    try {
      items.push(JSON.parse(line) as YtItem);
    } catch {
      // skip malformed
    }
  }
  return items;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // Search-as-you-type suggestions: real song matches + text phrases.
  app.get<{ Querystring: { q?: string } }>(
    '/api/search/suggestions',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'search-suggest', max: 180, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request) => {
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) return { texts: [], songs: [] };

      try {
        const items = await ytSearchJson(`ytsearch16:${q}`, 16);
        const songs = items
          .map((item) => toSong(item))
          .filter((song): song is NonNullable<ReturnType<typeof toSong>> => song !== null);
        const ranked = rankCandidates(songs, q, 6);
        const texts = ranked.map((s) => s.title).slice(0, 5);
        return { texts, songs: ranked };
      } catch {
        return { texts: [], songs: [] };
      }
    },
  );

  // Related songs for autoplay. Accepts either an explicit query or title+artist.
  // Uses a music-weighted search instead of undocumented radio endpoints.
  app.get<{ Querystring: { q?: string; title?: string; artist?: string; exclude?: string; limit?: string } }>(
    '/api/youtube/similar',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'youtube-similar', max: 60, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request) => {
      const limit = Math.min(Math.max(Number(request.query.limit) || 8, 1), 15);
      const exclude = (request.query.exclude ?? '').trim();
      const explicit = (request.query.q ?? '').trim();
      const title = (request.query.title ?? '').trim();
      const artist = (request.query.artist ?? '').trim();
      const hasArtist = artist && !/^unknown$/i.test(artist);
      // Recommendations favour more from the same artist, which is what
      // listeners expect after a track ends; fall back to title+artist.
      const query = explicit || (hasArtist ? artist : `${artist} ${title}`.trim());
      if (!query) return { results: [] };

      try {
        const fetchCount = Math.min(limit * 3, 40);
        const items = await ytSearchJson(`ytsearch${fetchCount}:${query}`, fetchCount);
        const songs = items
          .map((item) => toSong(item))
          .filter((song): song is NonNullable<ReturnType<typeof toSong>> => song !== null);
        const ranked = rankCandidates(songs, hasArtist ? title : query, limit + 2, { strict: false });
        const results = ranked.filter((song) => song.id !== exclude).slice(0, limit);
        return { results };
      } catch {
        return { results: [] };
      }
    },
  );
}
