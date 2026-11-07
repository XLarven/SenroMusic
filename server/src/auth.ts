import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { findUserById, touchUserActive, type UserRow } from './users.js';

export const SESSION_COOKIE = 'senro_session';

// Extend Fastify request with user
declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow | null;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function tokensMatch(candidate: string): boolean {
  return timingSafeEqual(digest(candidate), digest(config.musicToken));
}

// Session format: userId.expiresAt.signature
export function issueSession(userId: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + config.sessionDays * 86_400;
  const signature = createHmac('sha256', config.sessionSecret).update(`${userId}.${expiresAt}`).digest('hex');
  return `${userId}.${expiresAt}.${signature}`;
}

export function verifySession(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresRaw, signature] = parts;
  const expiresAt = Number.parseInt(expiresRaw ?? '', 10);
  if (!userId || !Number.isFinite(expiresAt) || !signature) return null;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const expected = createHmac('sha256', config.sessionSecret).update(`${userId}.${expiresAt}`).digest('hex');
  const left = Buffer.from(signature, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  // Legacy token-only sessions (pre-v0.4, no user row, timeframe signature) are invalid — user must re-login with email.
  if (userId === 'token') return null;
  return userId;
}

export function setSessionCookie(reply: FastifyReply, userId: string, secure = config.secureCookies ?? false): void {
  reply.setCookie(SESSION_COOKIE, issueSession(userId), {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    secure,
    maxAge: config.sessionDays * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = verifySession(request.cookies[SESSION_COOKIE]);
  if (!userId) {
    reply.code(401).send({
      error: {
        code: 'unauthorized',
        message: 'Oturum bulunamadı veya süresi doldu. Lütfen tekrar giriş yapın.',
      },
    });
    return;
  }
  const user = findUserById(userId);
  if (!user) {
    reply.code(401).send({
      error: {
        code: 'unauthorized',
        message: 'Kullanıcı bulunamadı. Lütfen tekrar giriş yapın.',
      },
    });
    return;
  }
  request.user = user;
  const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || '';
  touchUserActive(user.id, ip, String(request.headers['user-agent'] || ''));
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.statusCode === 401) return;
  if (!request.user || request.user.role !== 'admin') {
    reply.code(403).send({
      error: { code: 'forbidden', message: 'Bu sayfa yalnızca yöneticilere açıktır.' },
    });
  }
}
