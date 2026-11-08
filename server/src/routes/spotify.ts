import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin, requireAuth } from '../auth.js';
import { rateLimit } from '../ratelimit.js';
import { getSpotifyAccessToken, getSpotifyPlaylist, isSpotifyConfigured, searchSpotify, type SpotifyItem } from '../spotifyApi.js';

const execFileAsync = promisify(execFile);
const PYTHON = process.env.PYTHON_PATH || 'python';

async function runYtDlp(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(PYTHON, ['-m', 'yt_dlp', ...args], {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout + (stderr ? `\n${stderr}` : '');
}

type Item = SpotifyItem;

function sanitizeSpotifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <redacted>')
    .replace(/grant_type=[^&\\s]+/gi, 'grant_type=<redacted>')
    .slice(0, 500);
}

function extractPlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'open.spotify.com') return null;
    const match = parsed.pathname.match(/\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function thumbnailOf(entry: Record<string, unknown>): string | null {
  const thumbnails = entry.thumbnails as Array<{ url?: string }> | undefined;
  return thumbnails?.[thumbnails.length - 1]?.url ?? null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function resolveViaYtDlp(url: string): Promise<{ type: string; title: string; items: Item[] } | null> {
  try {
    const output = await runYtDlp([url, '--dump-json', '--flat-playlist', '--no-warnings']);
    const lines = output.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
    if (lines.length === 0) return null;
    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    const type = String(first._type || '');
    const title = String(first.title || first.playlist_title || 'Spotify');
    const items: Item[] = [];

    // yt-dlp may return a playlist with entries, or a single track
    const entries = (first.entries as Array<Record<string, unknown>> | undefined) || [];
    if (entries.length > 0) {
      for (const e of entries) {
        const t = String(e.title || '').trim();
        if (!t) continue;
        const artist = String(e.uploader || e.channel || e.artist || 'Unknown').trim();
        items.push({
          title: t,
          artist,
          youtubeQuery: `${artist} ${t}`.trim(),
          providerTrackId: stringOrNull(e.id),
          duration: numberOrNull(e.duration),
          artworkUrl: thumbnailOf(e),
          sourceUrl: stringOrNull(e.webpage_url) ?? stringOrNull(e.url),
          album: stringOrNull(e.album || e.album_title),
        });
      }
    } else if (first.title) {
      const t = String(first.title);
      const artist = String(first.uploader || first.channel || 'Unknown');
      items.push({
        title: t,
        artist,
        youtubeQuery: `${artist} ${t}`.trim(),
        providerTrackId: stringOrNull(first.id),
        duration: numberOrNull(first.duration),
        artworkUrl: thumbnailOf(first),
        sourceUrl: stringOrNull(first.webpage_url) ?? stringOrNull(first.url),
        album: stringOrNull(first.album || first.album_title),
      });
    }

    if (items.length === 0) {
      // Fallback: each line is an entry (search-like)
      for (const line of lines) {
        try {
          const j = JSON.parse(line) as Record<string, unknown>;
          const t = String(j.title || '').trim();
          if (!t) continue;
          const artist = String(j.uploader || j.channel || 'Unknown').trim();
          items.push({
            title: t,
            artist,
            youtubeQuery: `${artist} ${t}`.trim(),
            providerTrackId: stringOrNull(j.id),
            duration: numberOrNull(j.duration),
            artworkUrl: thumbnailOf(j),
            sourceUrl: stringOrNull(j.webpage_url) ?? stringOrNull(j.url),
            album: stringOrNull(j.album || j.album_title),
          });
        } catch {
          // ignore
        }
      }
    }

    if (items.length === 0) return null;
    return { type: type === 'playlist' ? 'playlist' : 'track', title, items: items.slice(0, 100) };
  } catch {
    return null;
  }
}

async function resolveViaOembed(url: string): Promise<{ type: string; title: string; items: Item[] } | null> {
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl);
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string; provider_name?: string };
    const raw = String(json.title || '').trim();
    if (!raw) return null;
    // oEmbed title is usually "Song Title by Artist" or "Playlist by By Artist"
    const byMatch = raw.split(' by ');
    const artist = byMatch.length > 1 ? byMatch[byMatch.length - 1] : 'Unknown';
    const titlePart = byMatch[0];
    return {
      type: url.includes('/playlist/') ? 'playlist' : 'track',
      title: raw,
      items: [
        {
          title: titlePart,
          artist,
          youtubeQuery: `${artist} ${titlePart}`.trim(),
          providerTrackId: null,
          duration: null,
          artworkUrl: null,
          sourceUrl: url,
          album: null,
        },
      ],
    };
  } catch {
    return null;
  }
}

export async function spotifyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/spotify/diagnostics',
    {
      preHandler: [
        requireAdmin,
        rateLimit({ name: 'spotify-diagnostics', max: 10, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request, reply: FastifyReply) => {
      const credentialsLoaded = isSpotifyConfigured();
      let tokenIssued = false;
      let catalogAccessible = false;
      let playlistMetadataAccessible = false;
      let rateLimited = false;
      let upstreamUnavailable = false;
      let lastError: string | null = null;

      if (credentialsLoaded) {
        try {
          tokenIssued = Boolean(await getSpotifyAccessToken());
        } catch (error) {
          lastError = sanitizeSpotifyError(error);
        }
      }
      if (tokenIssued) {
        try {
          const result = await searchSpotify('test', 1);
          catalogAccessible = result.tracks.length > 0;
        } catch (error) {
          lastError = sanitizeSpotifyError(error);
          rateLimited = /429|rate/i.test(lastError);
          upstreamUnavailable = /5\\d\\d|fetch failed|ECONNRESET|ETIMEDOUT/i.test(lastError);
        }
      }
      if (tokenIssued) {
        try {
          await getSpotifyPlaylist('1kP7p1pYQ8SBixphVEpTWI');
          playlistMetadataAccessible = true;
        } catch (error) {
          lastError = lastError ?? sanitizeSpotifyError(error);
          rateLimited = rateLimited || /429|rate/i.test(lastError);
        }
      }

      return {
        configured: credentialsLoaded,
        tokenIssued,
        catalogSearchAccessible: catalogAccessible,
        playlistMetadataAccessible,
        rateLimited,
        upstreamUnavailable,
        lastError,
      };
    },
  );

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/spotify/search',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'spotify-search', max: 60, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request, reply) => {
      if (!isSpotifyConfigured()) {
        return reply.code(503).send({
          error: { code: 'spotify_not_configured', message: 'Spotify API kimlik bilgileri yapılandırılmadı.' },
        });
      }
      const q = (request.query.q ?? '').trim();
      if (!q) return reply.code(400).send({ error: { code: 'invalid_query', message: 'Arama sorgusu gerekli.' } });
      try {
        return await searchSpotify(q, Number(request.query.limit) || 10);
      } catch (error) {
        request.log.warn({ err: error }, 'spotify search failed');
        return reply.code(502).send({
          error: {
            code: 'spotify_unavailable',
            message: 'Spotify araması şu anda kullanılamıyor. Diğer müzik kaynaklarında arama yapabilirsiniz.',
          },
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/spotify/playlists/:id',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'spotify-playlist', max: 20, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request, reply) => {
      if (!isSpotifyConfigured()) {
        return reply.code(503).send({
          error: { code: 'spotify_not_configured', message: 'Spotify API kimlik bilgileri yapılandırılmadı.' },
        });
      }
      const id = request.params.id.trim();
      if (!/^[A-Za-z0-9]{22}$/.test(id)) {
        return reply.code(400).send({ error: { code: 'invalid_playlist', message: 'Geçersiz Spotify çalma listesi kimliği.' } });
      }
      try {
        return await getSpotifyPlaylist(id);
      } catch (error) {
        request.log.warn({ err: error }, 'spotify playlist failed');
        return reply.code(502).send({
          error: {
            code: 'spotify_unavailable',
            message: 'Spotify çalma listesi şu anda kullanılamıyor. Bağlantıyı daha sonra tekrar deneyin.',
          },
        });
      }
    },
  );

  app.post<{ Body: { url?: string } }>(
    '/api/spotify/resolve',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'spotify-resolve', max: 20, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request, reply) => {
      const url = (request.body?.url ?? '').trim();
      if (!url || !url.includes('open.spotify.com')) {
        return reply.code(400).send({ error: { code: 'bad_request', message: 'Geçerli bir Spotify bağlantısı yapıştırın (open.spotify.com).' } });
      }
      const playlistId = extractPlaylistId(url);
      if (playlistId && isSpotifyConfigured()) {
        try {
          const playlist = await getSpotifyPlaylist(playlistId);
          if (playlist.items.length > 0) {
            return {
              type: playlist.type,
              title: playlist.title,
              description: playlist.description,
              artworkUrl: playlist.artworkUrl,
              creator: playlist.creator,
              totalDuration: playlist.totalDuration,
              totalTracks: playlist.totalTracks,
              items: playlist.items,
            };
          }
          request.log.warn({ playlistId }, 'spotify web api returned no tracks; falling back');
        } catch (error) {
          request.log.warn({ err: error }, 'spotify web api playlist failed; falling back');
        }
      }
      const viaYt = await resolveViaYtDlp(url);
      if (viaYt) return viaYt;
      const viaOembed = await resolveViaOembed(url);
      if (viaOembed) return viaOembed;
      return reply.code(422).send({
        error: {
          code: 'unresolvable',
          message:
            'Spotify bağlantısı çözülemedi. Bağlantının herkese açık olduğundan ve Spotify\'ın bölge kısıtlaması olmadığından emin olun. (yt-dlp + oEmbed ikisi de başarısız oldu.)',
        },
      });
    },
  );
}
