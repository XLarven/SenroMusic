import type { FastifyInstance } from 'fastify';
import {
  clearSessionCookie,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  verifySession,
} from '../auth.js';
import { config } from '../config.js';
import { getDatabaseStatus, mirrorUsers } from '../mysqldb.js';
import { getDb } from '../db.js';
import { ensureMembership } from '../community.js';
import { rateLimit } from '../ratelimit.js';
import { isSpotifyConfigured } from '../spotifyApi.js';
import { adminStats, createUser, findUserByEmail, findUserById, findUserByUsername, toPublicUser, touchLogin, verifyPassword } from '../users.js';

type RegisterBody = { email?: unknown; password?: unknown; displayName?: unknown; name?: unknown; username?: unknown };
type LoginBody = { email?: unknown; password?: unknown };

const MAX_ATTEMPTS = 20;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return (first || request.ip || 'unknown').slice(0, 128);
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now && entry.count > MAX_ATTEMPTS) return true;
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
  return false;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validUsername(value: string): boolean {
  return /^[a-z0-9_.]{3,30}$/.test(value);
}

function clientIp(request: { headers: Record<string, string | string[] | undefined>; ip?: string }): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return (first || request.ip || '').slice(0, 64);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/status', async () => ({
    registrationOpen: config.allowRegistration,
    mysqlEnabled: Boolean(config.mysqlHost && config.mysqlUser),
    spotifyEnabled: isSpotifyConfigured(),
    database: await getDatabaseStatus(),
  }));

  app.get<{ Querystring: { username?: string } }>(
    '/api/auth/username-available',
    {
      preHandler: rateLimit({ name: 'username-available', max: 60, windowMs: 60_000 }),
    },
    async (request, reply) => {
      const username = (request.query.username ?? '').trim().toLocaleLowerCase('tr');
      if (!validUsername(username)) {
        return reply.code(400).send({ error: { code: 'invalid_username', message: 'Kullanıcı adı 3-30 karakter olmalı: küçük harfler, rakamlar, alt çizgi veya nokta.' } });
      }
      return { available: !findUserByUsername(username), username };
    },
  );

  app.post<{ Body: RegisterBody }>(
    '/api/auth/register',
    { preHandler: rateLimit({ name: 'register', max: 10, windowMs: 15 * 60_000 }) },
    async (request, reply) => {
      if (!config.allowRegistration) {
      return reply.code(403).send({ error: { code: 'registration_closed', message: 'Yeni kullanıcı kaydı kapalıdır.' } });
    }
    const emailRaw = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const username = typeof request.body?.username === 'string' ? request.body.username.trim().toLocaleLowerCase('tr') : '';
    const displayName =
      (typeof request.body?.displayName === 'string' && request.body.displayName) ||
      (typeof request.body?.name === 'string' && request.body.name) ||
      '';
    if (!validEmail(emailRaw)) {
      return reply.code(400).send({ error: { code: 'invalid_email', message: 'Geçerli bir e-posta girin.' } });
    }
    if (!validUsername(username)) {
      return reply.code(400).send({ error: { code: 'invalid_username', message: 'Kullanıcı adı 3-30 karakter olmalı: küçük harfler, rakamlar, alt çizgi veya nokta.' } });
    }
    if (password.length < 8 || password.length > 200) {
      return reply.code(400).send({ error: { code: 'weak_password', message: 'Parola en az 8 karakter olmalı.' } });
    }
    if (findUserByEmail(emailRaw)) {
      return reply.code(409).send({ error: { code: 'email_taken', message: 'Bu e-posta zaten kayıtlı.' } });
    }
    if (findUserByUsername(username)) {
      return reply.code(409).send({ error: { code: 'username_taken', message: 'Bu kullanıcı adı zaten kullanılıyor.' } });
    }
    let user;
    try {
      const isFirstUser = adminStats().totalUsers === 0;
      user = createUser(emailRaw, password, displayName, isFirstUser ? 'admin' : 'user', username);
    } catch (e) {
      request.log.error({ err: e }, 'register failed');
      return reply.code(500).send({ error: { code: 'register_failed', message: 'Kayıt oluşturulamadı.' } });
    }
    const ip = clientIp(request as never);
    touchLogin(user.id, ip, String(request.headers['user-agent'] || ''));
    // Every account joins the official community immediately.
    try {
      ensureMembership(getDb(), user.id);
    } catch {
      // Membership is also created lazily on first community access.
    }
    void mirrorUsers();
    setSessionCookie(reply, user.id, config.secureCookies ?? request.protocol === 'https');
      return reply.code(201).send({ ok: true, user: toPublicUser(user) });
    },
  );

  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const key = clientKey(request as never);
    const now = Date.now();
    const entry = attempts.get(key);
    if (entry && entry.resetAt > now && entry.count > MAX_ATTEMPTS) {
      reply.header('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return reply.code(429).send({
        error: { code: 'too_many_requests', message: 'Çok fazla başarısız deneme. Lütfen sonra tekrar dene.' },
      });
    }

    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';

    if (!validEmail(email) || !password) {
      checkRateLimit(key);
      return reply.code(400).send({ error: { code: 'invalid_credentials', message: 'E-posta ve parola gerekli.' } });
    }
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      checkRateLimit(key);
      request.log.warn({ key }, 'failed login attempt');
      return reply.code(401).send({ error: { code: 'invalid_credentials', message: 'E-posta veya parola hatalı.' } });
    }
    attempts.delete(key);
    touchLogin(user.id, clientIp(request as never), String(request.headers['user-agent'] || ''));
    void mirrorUsers();
    setSessionCookie(reply, user.id, config.secureCookies ?? request.protocol === 'https');
    return { ok: true, user: toPublicUser(user) };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const userId = verifySession(request.cookies['Norie_session']);
    if (!userId) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Oturum bulunamadı.' } });
    }
    const user = findUserById(userId);
    if (!user) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Kullanıcı bulunamadı.' } });
    }
    return { authenticated: true, user: toPublicUser(user) };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => adminStats());
  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => ({ users: adminStats().users }));
}
