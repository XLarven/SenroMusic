import type { FastifyInstance } from 'fastify';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie, tokensMatch, verifySession } from '../auth.js';
import { config } from '../config.js';

type LoginBody = { token?: unknown };

// In-memory brute-force protection for login
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return (first || request.ip || 'unknown').slice(0, 128);
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) return true;
  return false;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
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

    const token = typeof request.body?.token === 'string' ? request.body.token.trim() : '';
    if (!token || token.length > 512 || !tokensMatch(token)) {
      isRateLimited(key);
      request.log.warn({ key }, 'failed login attempt');
      return reply.code(401).send({
        error: { code: 'invalid_token', message: 'Sunucu anahtarı hatalı.' },
      });
    }
    attempts.delete(key);
    setSessionCookie(reply, config.secureCookies ?? request.protocol === 'https');
    return { ok: true, demoToken: config.demoToken };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!verifySession(request.cookies[SESSION_COOKIE])) {
      return reply.code(401).send({
        error: { code: 'unauthorized', message: 'Oturum bulunamadı.' },
      });
    }
    return { authenticated: true, demoToken: config.demoToken };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });
}
