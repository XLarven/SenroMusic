import type { FastifyInstance, FastifyReply } from 'fastify';
import { clearSessionCookie, requireAuth } from '../auth.js';
import { cacheCoverBuffer } from '../covers.js';
import { config } from '../config.js';
import { getDb, getTrackRow, trackToDto } from '../db.js';
import { getPublicPlaylists } from '../library.js';
import { getRelationship } from '../friends.js';
import { presenceStore, publishActivity, publishPresence } from '../presence.js';
import { noteTasteChange } from '../taste.js';
import { rateLimit } from '../ratelimit.js';
import {
  findUserById,
  findUserByUsername,
  hashPassword,
  toPublicProfile,
  toPublicUser,
  updateUserProfile,
  verifyPassword,
} from '../users.js';

type ProfileBody = {
  displayName?: unknown;
  username?: unknown;
  bio?: unknown;
  avatarUrl?: unknown;
  bannerUrl?: unknown;
  profileVisibility?: unknown;
  favoriteGenres?: unknown;
};
type SettingsBody = { key?: unknown; value?: unknown };
type FavoriteBody = { trackId?: unknown };
type HistoryBody = { trackId?: unknown; msPlayed?: unknown; source?: unknown };
type ArtistFollowBody = { artistId?: unknown; artistName?: unknown };
type PasswordBody = { currentPassword?: unknown; newPassword?: unknown; password?: unknown };

const SETTINGS_KEYS = new Set([
  'autoplay',
  'shuffle',
  'repeat',
  'volume',
  'crossfade',
  'gapless',
  'normalization',
  'appLanguage',
  'theme',
  'dynamicColors',
  'reducedMotion',
  'glassEffects',
  'explicitContent',
  'wifiOnly',
  'downloadQuality',
  'streamingQuality',
  'historyEnabled',
  // Presence / listening privacy (Phase 3)
  'presenceVisible',
  'lastSeenVisible',
  'activityVisible',
  'invisible',
  // Taste match privacy (Phase 5)
  'tasteCompareFriends',
  'tasteComparePublic',
  'tasteDiscoverable',
  'tasteAnonymous',
  'tasteShowShared',
]);

const PRESENCE_SETTING_KEYS = new Set(['presenceVisible', 'lastSeenVisible', 'activityVisible', 'invisible']);

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: { code: 'invalid_request', message } });
}

function notFound(reply: FastifyReply, code = 'not_found', message = 'Kayıt bulunamadı.') {
  return reply.code(404).send({ error: { code, message } });
}

function cleanString(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.trim().slice(0, max) : null;
}

function parseImageDataUrl(value: string): { bytes: Buffer; mime: string } | null {
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1] === 'jpeg' ? 'image/jpeg' : match[1] === 'webp' ? 'image/webp' : 'image/png';
  const bytes = Buffer.from(match[2] ?? '', 'base64');
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) return null;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngHeader =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const webpHeader =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return (mime === 'image/jpeg' && isJpeg) || (mime === 'image/png' && pngHeader) || (mime === 'image/webp' && webpHeader)
    ? { bytes, mime }
    : null;
}

async function normalizeImageField(value: unknown): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('/api/covers/c_')) return value.slice(0, 2048);
  const parsed = parseImageDataUrl(value);
  if (!parsed) return undefined;
  const coverId = await cacheCoverBuffer(parsed.bytes, parsed.mime);
  return coverId ? `/api/covers/${coverId}` : undefined;
}

function parseStoredSetting(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readSettings(userId: string): Record<string, unknown> {
  const rows = getDb()
    .prepare('SELECT key, value FROM user_settings WHERE user_id = ?')
    .all(userId) as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, parseStoredSetting(row.value)]));
}

function getSetting(userId: string, key: string): unknown {
  const row = getDb()
    .prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined;
  return row ? parseStoredSetting(row.value) : undefined;
}

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.patch<{ Body: ProfileBody }>(
    '/api/auth/me',
    { preHandler: [requireAuth, rateLimit({ name: 'profile-update', max: 30, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body ?? {};

      const displayName = body.displayName === undefined ? undefined : cleanString(body.displayName, 80);
      const bio = body.bio === undefined ? undefined : cleanString(body.bio, 500);
      const avatarUrl = await normalizeImageField(body.avatarUrl);
      const bannerUrl = await normalizeImageField(body.bannerUrl);
      const profileVisibility =
        body.profileVisibility === undefined
          ? undefined
          : body.profileVisibility === 'public' || body.profileVisibility === 'private'
            ? body.profileVisibility
            : null;
      const username =
        body.username === undefined
          ? undefined
          : body.username === null || body.username === ''
            ? null
            : typeof body.username === 'string'
              ? body.username.trim().toLocaleLowerCase('tr')
              : undefined;
      const favoriteGenres =
        body.favoriteGenres === undefined
          ? undefined
          : Array.isArray(body.favoriteGenres) && body.favoriteGenres.every((item) => typeof item === 'string')
            ? body.favoriteGenres.map((item) => item.trim()).filter(Boolean).slice(0, 10)
            : null;

      if (displayName !== undefined && (!displayName || displayName.length < 1)) {
        return badRequest(reply, 'Görünen ad 1-80 karakter olmalı.');
      }
      if (bio !== undefined && bio === null) return badRequest(reply, 'Biyografi metin olmalı.');
      if (profileVisibility === null) return badRequest(reply, 'Profil görünürlüğü public veya private olmalı.');
      if (username !== undefined && username !== null && !/^[a-z0-9_.]{3,30}$/.test(username)) {
        return badRequest(reply, 'Kullanıcı adı 3-30 karakter olmalı: küçük harfler, rakamlar, alt çizgi veya nokta.');
      }
      if (body.avatarUrl !== undefined && avatarUrl === undefined) return badRequest(reply, 'Avatar görseli JPEG veya PNG olmalı.');
      if (body.bannerUrl !== undefined && bannerUrl === undefined) return badRequest(reply, 'Banner görseli JPEG veya PNG olmalı.');
      if (favoriteGenres === null) return badRequest(reply, 'Favori türler metin listesi olmalı.');

      if (username) {
        const occupied = getDb()
          .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
          .get(username, user.id) as { id: string } | undefined;
        if (occupied) return reply.code(409).send({ error: { code: 'username_taken', message: 'Bu kullanıcı adı alınmış.' } });
      }

      const updated = updateUserProfile(user.id, {
        displayName,
        username: username ?? undefined,
        bio,
        avatarUrl: avatarUrl ?? undefined,
        bannerUrl: bannerUrl ?? undefined,
        profileVisibility,
        favoriteGenres,
      });
      if (!updated) return notFound(reply, 'user_not_found', 'Kullanıcı bulunamadı.');

      if (body.username === null || body.username === '') {
        getDb().prepare('UPDATE users SET username = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
      }
      if (body.avatarUrl === null || body.avatarUrl === '') {
        getDb().prepare('UPDATE users SET avatar_url = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
      }
      if (body.bannerUrl === null || body.bannerUrl === '') {
        getDb().prepare('UPDATE users SET banner_url = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
      }
      return { ok: true, user: toPublicUser(findUserById(user.id) ?? updated) };
    },
  );

  app.post<{ Body: PasswordBody }>(
    '/api/auth/change-password',
    { preHandler: [requireAuth, rateLimit({ name: 'password-change', max: 10, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const user = request.user!;
      const currentPassword = typeof request.body?.currentPassword === 'string' ? request.body.currentPassword : '';
      const newPassword = typeof request.body?.newPassword === 'string' ? request.body.newPassword : '';
      if (!currentPassword || newPassword.length < 8 || newPassword.length > 200) {
        return badRequest(reply, 'Yeni parola en az 8 karakter olmalı.');
      }
      if (!verifyPassword(currentPassword, user.password_hash)) {
        return reply.code(401).send({ error: { code: 'invalid_password', message: 'Mevcut parola hatalı.' } });
      }
      getDb()
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hashPassword(newPassword), new Date().toISOString(), user.id);
      return { ok: true };
    },
  );

  app.delete<{ Body: PasswordBody }>(
    '/api/auth/me',
    { preHandler: [requireAuth, rateLimit({ name: 'account-delete', max: 5, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const user = request.user!;
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!password || !verifyPassword(password, user.password_hash)) {
        return reply.code(401).send({ error: { code: 'invalid_password', message: 'Parola hatalı.' } });
      }
      const run = getDb().transaction(() => {
        getDb().prepare('DELETE FROM playlists WHERE owner_id = ?').run(user.id);
        getDb().prepare('DELETE FROM users WHERE id = ?').run(user.id);
      });
      run();
      clearSessionCookie(reply);
      return { ok: true };
    },
  );

  app.get('/api/me/favorites', { preHandler: requireAuth }, async (request) => {
    const rows = getDb()
      .prepare(
        `SELECT t.* FROM favorites f
         JOIN tracks t ON t.id = f.track_id
         WHERE f.user_id = ?
         ORDER BY f.created_at DESC, t.title ASC`,
      )
      .all(request.user!.id) as Array<Parameters<typeof trackToDto>[0]>;
    return { tracks: rows.map(trackToDto) };
  });

  app.post<{ Body: FavoriteBody }>(
    '/api/me/favorites',
    { preHandler: [requireAuth, rateLimit({ name: 'favorites', max: 120, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const trackId = typeof request.body?.trackId === 'string' ? request.body.trackId : '';
      if (!trackId || !getTrackRow(trackId)) {
        return reply.code(404).send({ error: { code: 'track_not_found', message: 'Parça bulunamadı.' } });
      }
      getDb()
        .prepare('INSERT OR IGNORE INTO favorites (user_id, track_id, created_at) VALUES (?, ?, ?)')
        .run(request.user!.id, trackId, new Date().toISOString());
      return { ok: true, favorited: true };
    },
  );

  app.delete<{ Params: { trackId: string } }>(
    '/api/me/favorites/:trackId',
    { preHandler: requireAuth },
    async (request) => {
      getDb()
        .prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?')
        .run(request.user!.id, request.params.trackId);
      return { ok: true, favorited: false };
    },
  );

  app.post<{ Body: HistoryBody }>(
    '/api/me/history',
    { preHandler: [requireAuth, rateLimit({ name: 'history', max: 120, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const user = request.user!;
      const trackId = typeof request.body?.trackId === 'string' ? request.body.trackId : '';
      const msPlayed = Number(request.body?.msPlayed);
      const source = typeof request.body?.source === 'string' ? request.body.source : 'player';
      if (!trackId || !getTrackRow(trackId)) {
        return reply.code(404).send({ error: { code: 'track_not_found', message: 'Parça bulunamadı.' } });
      }
      if (!Number.isFinite(msPlayed) || msPlayed < 0 || msPlayed > 24 * 60 * 60 * 1000) {
        return badRequest(reply, 'msPlayed geçersiz.');
      }
      if (!['player', 'stream', 'download'].includes(source)) return badRequest(reply, 'source geçersiz.');
      if (getSetting(user.id, 'historyEnabled') === false) return { ok: true, recorded: false };
      getDb()
        .prepare('INSERT INTO listening_history (user_id, track_id, played_at, ms_played, source) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, trackId, new Date().toISOString(), Math.round(msPlayed), source);
      // New playback changes taste results for this user and everyone compared with them.
      noteTasteChange(user.id);
      return { ok: true, recorded: true };
    },
  );

  app.get('/api/me/history', { preHandler: requireAuth }, async (request) => {
    const limit = Math.min(Math.max(Number(new URL(request.url, 'http://localhost').searchParams.get('limit') ?? '50'), 1), 200);
    const rows = getDb()
      .prepare(
        `SELECT t.*, h.played_at, h.ms_played, h.source
         FROM (SELECT track_id, MAX(played_at) as played_at FROM listening_history WHERE user_id = ? GROUP BY track_id) recent
         JOIN listening_history h ON h.user_id = ? AND h.track_id = recent.track_id AND h.played_at = recent.played_at
         JOIN tracks t ON t.id = h.track_id
         ORDER BY h.played_at DESC
         LIMIT ?`,
      )
      .all(request.user!.id, request.user!.id, limit) as Array<Parameters<typeof trackToDto>[0] & { played_at: string; ms_played: number; source: string }>;
    return {
      items: rows.map((row) => ({ track: trackToDto(row), playedAt: row.played_at, msPlayed: row.ms_played, source: row.source })),
    };
  });

  app.get('/api/me/history/stats', { preHandler: requireAuth }, async (request) => {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS totalPlays,
                COALESCE(SUM(ms_played), 0) AS totalMs,
                MAX(played_at) AS lastPlayedAt
         FROM listening_history WHERE user_id = ?`,
      )
      .get(request.user!.id) as { totalPlays: number; totalMs: number; lastPlayedAt: string | null };
    const topArtists = getDb()
      .prepare(
        `SELECT t.artist, COUNT(*) AS plays
         FROM listening_history h
         JOIN tracks t ON t.id = h.track_id
         WHERE h.user_id = ?
         GROUP BY t.artist
         ORDER BY plays DESC
         LIMIT 5`,
      )
      .all(request.user!.id) as Array<{ artist: string; plays: number }>;
    return {
      totalPlays: row.totalPlays,
      totalMs: row.totalMs,
      lastPlayedAt: row.lastPlayedAt,
      topArtists,
    };
  });

  app.get('/api/me/settings', { preHandler: requireAuth }, async (request) => ({
    settings: readSettings(request.user!.id),
  }));

  app.put<{ Body: SettingsBody }>(
    '/api/me/settings',
    { preHandler: [requireAuth, rateLimit({ name: 'settings', max: 60, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const key = typeof request.body?.key === 'string' ? request.body.key : '';
      const value = request.body?.value;
      if (!SETTINGS_KEYS.has(key)) return badRequest(reply, 'Desteklenmeyen ayar.');
      if (value === undefined || typeof value === 'object') return badRequest(reply, 'Ayar değeri gerekli.');
      getDb()
        .prepare(
          `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
        )
        .run(request.user!.id, key, JSON.stringify(value));
      // Privacy keys take effect immediately, including for open streams.
      if (PRESENCE_SETTING_KEYS.has(key)) {
        try {
          publishPresence(getDb(), presenceStore, request.user!.id);
          publishActivity(getDb(), presenceStore, request.user!.id);
        } catch {
          // a broadcast failure must not fail the setting save
        }
      }
      return { ok: true, settings: readSettings(request.user!.id) };
    },
  );

  app.get('/api/me/artist-follows', { preHandler: requireAuth }, async (request) => {
    const rows = getDb()
      .prepare('SELECT artist_id, artist_name, created_at FROM artist_follows WHERE user_id = ? ORDER BY created_at DESC')
      .all(request.user!.id) as Array<{ artist_id: string; artist_name: string; created_at: string }>;
    return { follows: rows.map((row) => ({ artistId: row.artist_id, artistName: row.artist_name, createdAt: row.created_at })) };
  });

  app.post<{ Body: ArtistFollowBody }>(
    '/api/me/artist-follows',
    { preHandler: [requireAuth, rateLimit({ name: 'artist-follows', max: 60, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const artistId = typeof request.body?.artistId === 'string' ? request.body.artistId : '';
      const artistName = typeof request.body?.artistName === 'string' ? request.body.artistName.trim() : '';
      if (!artistId.startsWith('ar_') || artistName.length < 1 || artistName.length > 120) {
        return badRequest(reply, 'artistId ve artistName gerekli.');
      }
      getDb()
        .prepare('INSERT OR IGNORE INTO artist_follows (user_id, artist_id, artist_name, created_at) VALUES (?, ?, ?, ?)')
        .run(request.user!.id, artistId, artistName, new Date().toISOString());
      return { ok: true, followed: true };
    },
  );

  app.delete<{ Params: { artistId: string } }>(
    '/api/me/artist-follows/:artistId',
    { preHandler: requireAuth },
    async (request) => {
      getDb().prepare('DELETE FROM artist_follows WHERE user_id = ? AND artist_id = ?').run(request.user!.id, request.params.artistId);
      return { ok: true, followed: false };
    },
  );

  app.get('/api/me/search-history', { preHandler: requireAuth }, async (request) => {
    const limit = Math.min(Math.max(Number(new URL(request.url, 'http://localhost').searchParams.get('limit') ?? '50'), 1), 200);
    const rows = getDb()
      .prepare('SELECT id, query, searched_at FROM user_search_history WHERE user_id = ? ORDER BY searched_at DESC, id DESC LIMIT ?')
      .all(request.user!.id, limit) as Array<{ id: number; query: string; searched_at: string }>;
    return { items: rows.map((row) => ({ id: row.id, query: row.query, searchedAt: row.searched_at })) };
  });

  app.post<{ Body: { query?: unknown } }>(
    '/api/me/search-history',
    { preHandler: [requireAuth, rateLimit({ name: 'search-history', max: 60, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const query = typeof request.body?.query === 'string' ? request.body.query.trim().replace(/\s+/g, ' ') : '';
      if (query.length < 2 || query.length > 120) return badRequest(reply, 'Arama sorgusu 2-120 karakter olmalı.');
      if (getSetting(request.user!.id, 'historyEnabled') === false) return { ok: true, recorded: false };
      const now = new Date().toISOString();
      const run = getDb().transaction(() => {
        getDb().prepare('DELETE FROM user_search_history WHERE user_id = ? AND lower(query) = lower(?)').run(request.user!.id, query);
        getDb().prepare('INSERT INTO user_search_history (user_id, query, searched_at) VALUES (?, ?, ?)').run(request.user!.id, query, now);
        const limit = config.searchHistoryLimit;
        getDb().prepare(
          `DELETE FROM user_search_history
           WHERE user_id = ? AND id NOT IN (
             SELECT id FROM user_search_history WHERE user_id = ? ORDER BY searched_at DESC, id DESC LIMIT ?
           )`,
        ).run(request.user!.id, request.user!.id, limit);
      });
      run();
      return { ok: true, recorded: true };
    },
  );

  app.delete('/api/me/search-history', { preHandler: requireAuth }, async (request) => {
    getDb().prepare('DELETE FROM user_search_history WHERE user_id = ?').run(request.user!.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>(
    '/api/profiles/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = findUserById(request.params.id);
      if (!target) return notFound(reply, 'profile_not_found', 'Profil bulunamadı.');
      const isOwner = target.id === request.user!.id;
      const canView = isOwner || target.profile_visibility !== 'private' || request.user!.role === 'admin';
      if (!canView) return notFound(reply, 'profile_not_found', 'Profil bulunamadı.');
      const profile = toPublicProfile(target, isOwner);
      profile.publicPlaylistCount = getPublicPlaylists(target.id).length;
      profile.followedArtistCount = (
        getDb().prepare('SELECT COUNT(*) AS c FROM artist_follows WHERE user_id = ?').get(target.id) as { c: number }
      ).c;
      return {
        profile,
        playlists: getPublicPlaylists(target.id),
        relationship: getRelationship(getDb(), request.user!.id, target.id),
      };
    },
  );

  app.get<{ Params: { username: string } }>(
    '/api/profiles/by-username/:username',
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = findUserByUsername(request.params.username);
      if (!target) return notFound(reply, 'profile_not_found', 'Profil bulunamadı.');
      const isOwner = target.id === request.user!.id;
      const canView = isOwner || target.profile_visibility !== 'private' || request.user!.role === 'admin';
      if (!canView) return notFound(reply, 'profile_not_found', 'Profil bulunamadı.');
      const profile = toPublicProfile(target, isOwner);
      profile.publicPlaylistCount = getPublicPlaylists(target.id).length;
      profile.followedArtistCount = (
        getDb().prepare('SELECT COUNT(*) AS c FROM artist_follows WHERE user_id = ?').get(target.id) as { c: number }
      ).c;
      return {
        profile,
        playlists: getPublicPlaylists(target.id),
        relationship: getRelationship(getDb(), request.user!.id, target.id),
      };
    },
  );

  // People search: only public profiles, only public fields.
  app.get<{ Querystring: { q?: string } }>(
    '/api/users/search',
    {
      preHandler: [
        requireAuth,
        rateLimit({ name: 'user-search', max: 60, windowMs: 60_000, keyBy: 'user' }),
      ],
    },
    async (request) => {
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) return { users: [] };
      const needle = `%${q.toLocaleLowerCase('tr')}%`;
      const prefix = `${q.toLocaleLowerCase('tr')}%`;
      const rows = getDb()
        .prepare(
          `SELECT id, username, display_name, avatar_url, bio
           FROM users
           WHERE COALESCE(profile_visibility, 'public') != 'private'
             AND (lower(COALESCE(username, '')) LIKE ? OR lower(display_name) LIKE ?)
           ORDER BY lower(COALESCE(username, '')) LIKE ? DESC, lower(display_name) LIKE ? DESC
           LIMIT 6`,
        )
        .all(needle, needle, prefix, prefix) as Array<{
        id: string;
        username: string | null;
        display_name: string;
        avatar_url: string | null;
        bio: string | null;
      }>;
      return {
        users: rows.map((row) => ({
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          bio: row.bio,
        })),
      };
    },
  );
}
