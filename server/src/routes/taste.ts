/**
 * Taste Match endpoints.
 *
 * The score is computed from real playback rows; the route layer only composes
 * identities and enforces who may see what. Every visibility decision is made
 * here, on the server, from the target's own settings.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { listFriends } from '../friends.js';
import { findUserById, toPublicUser } from '../users.js';
import {
  buildTasteProfile,
  compareTaste,
  discoveryCandidates,
  leaveDiscovery,
  likedBefore,
  readTasteSettings,
  recordInterest,
  revealedWith,
  tasteAccess,
} from '../taste.js';

const readLimit = rateLimit({ name: 'taste-read', max: 90, windowMs: 60_000, keyBy: 'user' });
const compareLimit = rateLimit({ name: 'taste-compare', max: 60, windowMs: 60_000, keyBy: 'user' });
const discoverLimit = rateLimit({ name: 'taste-discover', max: 40, windowMs: 60_000, keyBy: 'user' });
const likeLimit = rateLimit({ name: 'taste-like', max: 40, windowMs: 60_000, keyBy: 'user' });

function fail(reply: FastifyReply, code: string, message: string, status = 400) {
  return reply.code(status).send({ error: { code, message } });
}

function page(query: { limit?: string; offset?: string }): { limit: number; offset: number } {
  const limit = Number.parseInt(String(query.limit ?? ''), 10);
  const offset = Number.parseInt(String(query.offset ?? ''), 10);
  return {
    limit: Math.min(Math.max(Number.isFinite(limit) ? limit : 20, 1), 50),
    offset: Math.max(Number.isFinite(offset) ? offset : 0, 0),
  };
}

function identity(row: ReturnType<typeof findUserById>) {
  if (!row) return null;
  const user = toPublicUser(row);
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    avatarUrl: user.avatarUrl,
    profileVisibility: user.profileVisibility,
  };
}

export async function tasteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/taste/me', { preHandler: [requireAuth, readLimit] }, async (request) => {
    const db = getDb();
    const userId = request.user!.id;
    const profile = buildTasteProfile(db, userId);
    return {
      profile: {
        userId: profile.userId,
        plays: profile.plays,
        totalMs: profile.totalMs,
        lastPlayedAt: profile.lastPlayedAt,
        eligible: profile.eligible,
        reason: profile.reason,
        artists: profile.artists.slice(0, 8),
        tracks: profile.tracks.slice(0, 8),
        genres: profile.genres,
        languages: profile.languages,
      },
      settings: readTasteSettings(db, userId),
    };
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/taste/friends',
    { preHandler: [requireAuth, readLimit] },
    async (request) => {
      const db = getDb();
      const viewerId = request.user!.id;
      const { limit, offset } = page(request.query);
      const viewerSettings = readTasteSettings(db, viewerId);
      const friends = listFriends(db, viewerId, 100, 0).items;
      const items = friends
        .map((friend) => {
          const row = findUserById(friend.id);
          if (!row) return null;
          const settings = readTasteSettings(db, friend.id);
          const access = tasteAccess(db, viewerId, friend.id, { profileVisibility: toPublicUser(row).profileVisibility }, settings);
          if (access !== 'ok' && access !== 'self') return null;
          const comparison = compareTaste(db, viewerId, friend.id, {
            showShared: viewerSettings.showShared && settings.showShared,
          });
          return {
            user: identity(row),
            score: comparison.score,
            eligible: comparison.eligible,
            reason: comparison.reason,
            sharedArtists: comparison.sharedArtists.length,
            sharedTracks: comparison.sharedTracks.length,
            sharedGenres: comparison.sharedGenres.length,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      return {
        items: items.slice(offset, offset + limit),
        total: items.length,
        limit,
        offset,
      };
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/api/taste/compare/:userId',
    { preHandler: [requireAuth, compareLimit] },
    async (request, reply) => {
      const db = getDb();
      const viewerId = request.user!.id;
      const targetId = String(request.params.userId ?? '').trim();
      if (!targetId) return fail(reply, 'invalid_user', 'Kullanıcı gerekli.');
      const targetRow = findUserById(targetId);
      if (!targetRow) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const targetUser = toPublicUser(targetRow);
      const targetSettings = readTasteSettings(db, targetId);
      const viewerSettings = readTasteSettings(db, viewerId);
      const access = tasteAccess(
        db,
        viewerId,
        targetId,
        { profileVisibility: targetUser.profileVisibility },
        targetSettings,
      );
      if (access === 'blocked') return fail(reply, 'blocked', 'Bu kullanıcıyla karşılaştırma yapılamaz.', 403);
      if (access === 'private') return fail(reply, 'not_allowed', 'Bu kullanıcı zevk karşılaştırmasını paylaşmıyor.', 403);

      const comparison = compareTaste(db, viewerId, targetId, {
        showShared: viewerSettings.showShared && targetSettings.showShared,
      });
      const viewerRow = findUserById(viewerId);
      return {
        viewer: identity(viewerRow),
        target: identity(targetRow),
        relationship: access === 'self' ? 'self' : 'friend',
        comparison,
      };
    },
  );

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/taste/discover',
    { preHandler: [requireAuth, discoverLimit] },
    async (request) => {
      const db = getDb();
      const viewerId = request.user!.id;
      const { limit, offset } = page(request.query);
      const viewerSettings = readTasteSettings(db, viewerId);
      if (!viewerSettings.discoverable) {
        return { optedIn: false, items: [], total: 0, limit, offset };
      }
      const candidates = discoveryCandidates(db, viewerId);
      const slice = candidates.slice(offset, offset + limit);
      return {
        optedIn: true,
        total: candidates.length,
        limit,
        offset,
        items: slice.map((candidate) => {
          const settings = readTasteSettings(db, candidate.userId);
          const mutual = revealedWith(db, viewerId, candidate.userId);
          const anonymous = settings.anonymous && !mutual;
          return {
            matchId: candidate.userId,
            score: candidate.score,
            sharedArtists: candidate.sharedArtists,
            sharedGenres: candidate.sharedGenres,
            anonymous,
            liked: likedBefore(db, viewerId, candidate.userId),
            mutual,
            user: anonymous
              ? null
              : {
                  id: candidate.row.id,
                  displayName: candidate.row.display_name,
                  username: candidate.row.username,
                  avatarUrl: candidate.row.avatar_url,
                },
          };
        }),
      };
    },
  );

  app.post<{ Params: { userId: string } }>(
    '/api/taste/discover/:userId/like',
    { preHandler: [requireAuth, likeLimit] },
    async (request, reply) => {
      const db = getDb();
      const viewerId = request.user!.id;
      const targetId = String(request.params.userId ?? '').trim();
      if (!targetId || targetId === viewerId) return fail(reply, 'invalid_user', 'Geçersiz kullanıcı.');
      if (!readTasteSettings(db, viewerId).discoverable) {
        return fail(reply, 'not_opted_in', 'Keşfe katılmadan beğeni gönderemezsin.', 403);
      }
      const targetRow = findUserById(targetId);
      if (!targetRow) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      if (!readTasteSettings(db, targetId).discoverable) {
        return fail(reply, 'not_discoverable', 'Bu kullanıcı keşifte değil.', 404);
      }
      const result = recordInterest(db, viewerId, targetId);
      return { ok: true, mutual: result.mutual };
    },
  );

  app.delete('/api/taste/discover', { preHandler: [requireAuth, likeLimit] }, async (request) => {
    leaveDiscovery(getDb(), request.user!.id);
    return { ok: true, settings: readTasteSettings(getDb(), request.user!.id) };
  });
}
