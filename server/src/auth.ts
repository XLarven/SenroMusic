import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

export const SESSION_COOKIE = 'senro_session';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function tokensMatch(candidate: string): boolean {
  return timingSafeEqual(digest(candidate), digest(config.musicToken));
}

export function issueSession(now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + config.sessionDays * 86_400;
  const signature = createHmac('sha256', config.sessionSecret).update(String(expiresAt)).digest('hex');
  return `${expiresAt}.${signature}`;
}

export function verifySession(value: string | undefined): boolean {
  if (!value) return false;
  const [expiresRaw, signature] = value.split('.');
  const expiresAt = Number.parseInt(expiresRaw ?? '', 10);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', config.sessionSecret).update(String(expiresAt)).digest('hex');
  const left = Buffer.from(signature, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function setSessionCookie(reply: FastifyReply, secure = config.secureCookies ?? false): void {
  reply.setCookie(SESSION_COOKIE, issueSession(), {
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
  if (verifySession(request.cookies[SESSION_COOKIE])) return;
  reply.code(401).send({
    error: {
      code: 'unauthorized',
      message: 'Oturum bulunamadı veya süresi doldu. Lütfen tekrar giriş yapın.',
    },
  });
}
