/**
 * Music Quiz endpoints.
 *
 * The client only ever receives: the current stage, a short-lived opaque preview
 * URL, and — once the attempt is finished — the answer. Scores are computed here.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { findUserById } from '../users.js';
import {
  PARTY_ROUNDS,
  STAGE_DURATIONS,
  answerParty,
  closeDueRounds,
  createParty,
  cutPreview,
  dailyHistory,
  ensureChallenge,
  ffmpegAvailable,
  inviteToParty,
  isPartyMember,
  joinParty,
  findPartyByCode,
  leaderboard,
  openDaily,
  openPractice,
  partyForUser,
  partyInvites,
  partyState,
  poolSize,
  previewForParty,
  previewTrackPath,
  quizStats,
  quizStatsVisible,
  skipStage,
  startRound,
  submitGuess,
  suggestions,
  syncQuizPool,
  takePreview,
  type QuizCategory,
} from '../quiz.js';

const guessLimit = rateLimit({ name: 'quiz-guess', max: 90, windowMs: 60_000, keyBy: 'user' });
const readLimit = rateLimit({ name: 'quiz-read', max: 180, windowMs: 60_000, keyBy: 'user' });
const previewLimit = rateLimit({ name: 'quiz-preview', max: 240, windowMs: 60_000, keyBy: 'user' });
const partyLimit = rateLimit({ name: 'quiz-party', max: 120, windowMs: 60_000, keyBy: 'user' });

function fail(reply: FastifyReply, code: string, message: string, status = 400) {
  return reply.code(status).send({ error: { code, message } });
}

function categoryOf(raw: unknown): QuizCategory {
  return raw === 'tr' || raw === 'intl' ? raw : 'mixed';
}

export async function quizRoutes(app: FastifyInstance): Promise<void> {
  /** Keeps the pool in step with the library; cheap when nothing changed. */
  function ensurePool() {
    const db = getDb();
    const size = poolSize(db, 'mixed');
    if (size === 0) syncQuizPool(db);
  }

  app.get('/api/quiz/pool', { preHandler: [requireAuth, readLimit] }, async () => {
    ensurePool();
    const db = getDb();
    return {
      size: poolSize(db, 'mixed'),
      turkish: poolSize(db, 'tr'),
      international: poolSize(db, 'intl'),
      previewStages: STAGE_DURATIONS,
      previewAvailable: ffmpegAvailable(),
    };
  });

  /* ---------- daily ---------- */

  app.get<{ Querystring: { category?: string } }>(
    '/api/quiz/daily',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      ensurePool();
      const category = categoryOf(request.query.category);
      const result = openDaily(getDb(), request.user!.id, category);
      if (!result.ok) return fail(reply, 'no_tracks', 'Bu kategori için uygun şarkı yok.', 409);
      return { ...result.view, day: result.day, resetsAt: result.resetsAt, timezone: 'Europe/Istanbul' };
    },
  );

  app.get('/api/quiz/daily/history', { preHandler: [requireAuth, readLimit] }, async (request) => {
    const db = getDb();
    const userId = request.user!.id;
    return { items: dailyHistory(db, userId), stats: quizStats(db, userId) };
  });

  /* ---------- practice ---------- */

  app.get<{ Querystring: { category?: string; fresh?: string } }>(
    '/api/quiz/practice',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      ensurePool();
      const category = categoryOf(request.query.category);
      const result = openPractice(getDb(), request.user!.id, category, request.query.fresh === '1');
      if (!result.ok) return fail(reply, 'no_tracks', 'Bu kategori için uygun şarkı yok.', 409);
      return result.view;
    },
  );

  /* ---------- guessing ---------- */

  app.post<{ Body: { attemptId?: unknown; guess?: unknown } }>(
    '/api/quiz/guess',
    { preHandler: [requireAuth, guessLimit] },
    async (request, reply) => {
      const attemptId = typeof request.body?.attemptId === 'string' ? request.body.attemptId : '';
      const guess = typeof request.body?.guess === 'string' ? request.body.guess : '';
      if (!attemptId) return fail(reply, 'invalid_attempt', 'Deneme gerekli.');
      const result = submitGuess(getDb(), request.user!.id, attemptId, guess);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'not_owner' ? 403 : 409;
        return fail(reply, result.code, 'Bu tahmin kabul edilmedi.', status);
      }
      return result;
    },
  );

  app.post<{ Body: { attemptId?: unknown } }>(
    '/api/quiz/skip',
    { preHandler: [requireAuth, guessLimit] },
    async (request, reply) => {
      const attemptId = typeof request.body?.attemptId === 'string' ? request.body.attemptId : '';
      if (!attemptId) return fail(reply, 'invalid_attempt', 'Deneme gerekli.');
      const result = skipStage(getDb(), request.user!.id, attemptId);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'not_owner' ? 403 : 409;
        return fail(reply, result.code, 'Atlama kabul edilmedi.', status);
      }
      return result;
    },
  );

  app.get<{ Querystring: { q?: string } }>(
    '/api/quiz/suggest',
    { preHandler: [requireAuth, readLimit] },
    async (request) => ({ suggestions: suggestions(getDb(), String(request.query.q ?? '')) }),
  );

  /* ---------- leaderboard + stats ---------- */

  app.get<{ Querystring: { range?: string } }>(
    '/api/quiz/leaderboard',
    { preHandler: [requireAuth, readLimit] },
    async (request) => {
      const range = ['daily', 'weekly', 'monthly', 'all', 'friends'].includes(String(request.query.range))
        ? (request.query.range as 'daily' | 'weekly' | 'monthly' | 'all' | 'friends')
        : 'weekly';
      const db = getDb();
      return { range, rows: leaderboard(db, request.user!.id, range) };
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/api/quiz/stats/:userId',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      const targetId = request.params.userId;
      if (!findUserById(targetId)) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      if (!quizStatsVisible(db, request.user!.id, targetId)) {
        return fail(reply, 'forbidden', 'Bu istatistikler gizli.', 403);
      }
      return { userId: targetId, stats: quizStats(db, targetId) };
    },
  );

  /* ---------- parties ---------- */

  app.get('/api/quiz/parties', { preHandler: [requireAuth, readLimit] }, async (request) => {
    const db = getDb();
    const current = partyForUser(db, request.user!.id);
    return {
      invites: partyInvites(db, request.user!.id),
      current: current ? { id: current.id, hostId: current.host_id, status: current.status, roundNo: current.round_no } : null,
    };
  });

  app.post<{ Body: { category?: unknown } }>(
    '/api/quiz/parties',
    { preHandler: [requireAuth, partyLimit] },
    async (request, reply) => {
      ensurePool();
      const category = categoryOf(request.body?.category);
      if (poolSize(getDb(), category) === 0) return fail(reply, 'no_tracks', 'Bu kategori için uygun şarkı yok.', 409);
      const party = createParty(getDb(), request.user!.id, category);
      return { id: party.id, code: party.code };
    },
  );

  app.get<{ Params: { partyId: string } }>(
    '/api/quiz/parties/:partyId',
    { preHandler: [requireAuth, readLimit] },
    async (request, reply) => {
      const db = getDb();
      closeDueRounds(db);
      if (!isPartyMember(db, request.params.partyId, request.user!.id)) {
        return fail(reply, 'forbidden', 'Bu partide değilsin.', 403);
      }
      const state = partyState(db, request.params.partyId, request.user!.id);
      if (!state) return fail(reply, 'not_found', 'Parti bulunamadı.', 404);
      return { state, rounds: PARTY_ROUNDS, serverNow: new Date().toISOString() };
    },
  );

  app.post<{ Body: { code?: unknown } }>(
    '/api/quiz/parties/join',
    { preHandler: [requireAuth, partyLimit] },
    async (request, reply) => {
      const code = typeof request.body?.code === 'string' ? request.body.code : '';
      if (!code) return fail(reply, 'invalid_code', 'Parti kodu gerekli.');
      const db = getDb();
      const party = findPartyByCode(db, code);
      if (!party) return fail(reply, 'not_found', 'Bu kodla açık parti yok.', 404);
      const result = joinParty(db, request.user!.id, party.id, code);
      if (!result.ok) return fail(reply, result.code, 'Partiye katılınamadı.', 403);
      return { id: party.id };
    },
  );

  app.post<{ Params: { partyId: string }; Body: { code?: unknown } }>(
    '/api/quiz/parties/:partyId/join',
    { preHandler: [requireAuth, partyLimit] },
    async (request, reply) => {
      const code = typeof request.body?.code === 'string' ? request.body.code : null;
      const result = joinParty(getDb(), request.user!.id, request.params.partyId, code);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'full' ? 409 : 403;
        const message =
          result.code === 'code' ? 'Parti kodu gerekli.' : result.code === 'full' ? 'Parti dolu.' : 'Katılınamadı.';
        return fail(reply, result.code, message, status);
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { partyId: string }; Body: { userId?: unknown } }>(
    '/api/quiz/parties/:partyId/invite',
    { preHandler: [requireAuth, partyLimit] },
    async (request, reply) => {
      const targetId = String(request.body?.userId ?? '').trim();
      if (!targetId || !findUserById(targetId)) return fail(reply, 'not_found', 'Kullanıcı bulunamadı.', 404);
      const result = inviteToParty(getDb(), request.params.partyId, request.user!.id, targetId);
      if (!result.ok) return fail(reply, result.code, 'Davet gönderilemedi.', 403);
      return { ok: true };
    },
  );

  app.post<{ Params: { partyId: string } }>(
    '/api/quiz/parties/:partyId/start',
    { preHandler: [requireAuth, partyLimit] },
    async (request, reply) => {
      const result = startRound(getDb(), request.params.partyId, request.user!.id);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'empty' ? 409 : 403;
        return fail(reply, result.code, 'Tur başlatılamadı.', status);
      }
      return result;
    },
  );

  app.post<{ Params: { partyId: string } }>(
    '/api/quiz/parties/:partyId/next',
    { preHandler: [requireAuth, partyLimit] },
    async (request, reply) => {
      const db = getDb();
      closeDueRounds(db);
      const result = startRound(db, request.params.partyId, request.user!.id);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : result.code === 'busy' ? 409 : 403;
        return fail(reply, result.code, 'Sonraki tur açılamadı.', status);
      }
      return result;
    },
  );

  app.get<{ Params: { partyId: string } }>(
    '/api/quiz/parties/:partyId/preview',
    { preHandler: [requireAuth, previewLimit] },
    async (request, reply) => {
      const db = getDb();
      const result = previewForParty(db, request.params.partyId, request.user!.id);
      if (!result.ok) {
        const status = result.code === 'not_member' ? 403 : result.code === 'late' ? 409 : 404;
        return fail(reply, result.code, 'Önizleme yok.', status);
      }
      return { url: result.url, duration: result.duration };
    },
  );

  app.post<{ Params: { partyId: string }; Body: { guess?: unknown } }>(
    '/api/quiz/parties/:partyId/answer',
    { preHandler: [requireAuth, guessLimit] },
    async (request, reply) => {
      const guess = typeof request.body?.guess === 'string' ? request.body.guess : '';
      const result = answerParty(getDb(), request.params.partyId, request.user!.id, guess);
      if (!result.ok) {
        const status = result.code === 'late' ? 409 : result.code === 'not_found' ? 404 : 403;
        const message =
          result.code === 'late' ? 'Tur kapandı; cevap artık kabul edilmiyor.' : 'Cevap kabul edilmedi.';
        return fail(reply, result.code, message, status);
      }
      return result;
    },
  );

  /* ---------- preview audio ---------- */

  app.get<{ Params: { token: string } }>(
    '/api/quiz/preview/:token',
    { preHandler: [requireAuth, previewLimit] },
    async (request, reply) => {
      const grant = takePreview(request.params.token);
      if (!grant) return fail(reply, 'preview_expired', 'Önizleme bağlantısı geçersiz.', 410);
      if (!(STAGE_DURATIONS as readonly number[]).includes(grant.duration)) {
        return fail(reply, 'preview_invalid', 'Geçersiz önizleme.', 400);
      }
      const path = previewTrackPath(getDb(), grant.trackId);
      if (!path) return fail(reply, 'preview_unavailable', 'Ses dosyası bulunamadı.', 404);

      const ff = cutPreview(path, grant.start, grant.duration);
      reply
        .header('Content-Type', 'audio/mpeg')
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff');
      ff.on('error', () => {
        if (!reply.raw.headersSent) reply.code(502).send({ error: { code: 'preview_failed', message: 'Önizleme üretilemedi.' } });
        else reply.raw.destroy();
      });
      request.raw.on('close', () => ff.kill());
      return reply.send(ff.stdout);
    },
  );

  /* Occasional pool refresh when the quiz page is used. */
  app.get('/api/quiz/ping', { preHandler: [requireAuth, readLimit] }, async () => {
    ensurePool();
    return { ok: true };
  });
}
