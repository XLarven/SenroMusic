import type { FastifyInstance } from 'fastify';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie, tokensMatch, verifySession } from '../auth.js';
import { config } from '../config.js';

type LoginBody = { token?: unknown };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const token = typeof request.body?.token === 'string' ? request.body.token.trim() : '';
    if (!token || token.length > 512 || !tokensMatch(token)) {
      return reply.code(401).send({
        error: { code: 'invalid_token', message: 'Sunucu anahtarı hatalı.' },
      });
    }
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
