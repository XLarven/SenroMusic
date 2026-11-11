/**
 * Presence, listening activity and the real-time stream.
 *
 * Updates come from authenticated REST calls (heartbeat / activity), the stream
 * is Server-Sent Events: no extra dependency, native reconnect, and it passes
 * reverse proxies that WebSockets often need extra configuration for.
 *
 * Every broadcast is per-recipient: only accepted friends, never blocked pairs,
 * and only what the actor's privacy settings allow.
 */
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { listFriends } from '../friends.js';
import {
  canViewPresence,
  presentFor,
  presenceStore,
  publishActivity,
  publishPresence,
  readPresenceSettings,
  recordOffline,
  recordOnline,
  type ActivitySnapshot,
  type PresenceEvent,
  type PresenceStatus,
  type PresenceStore,
  type RealtimeEvent,
} from '../presence.js';

const SESSION_RE = /^[A-Za-z0-9_-]{6,64}$/;
const lastPublished = new Map<string, PresenceStatus>();

function nowIso(): string {
  return new Date().toISOString();
}

function friendsOf(db: Database, userId: string): string[] {
  return listFriends(db, userId, 200, 0).items.map((friend) => friend.id);
}

function sanitizeActivity(raw: unknown): ActivitySnapshot | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object' || raw === undefined) return undefined;
  const value = raw as Record<string, unknown>;
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 200) : '';
  const artist = typeof value.artist === 'string' ? value.artist.trim().slice(0, 200) : '';
  if (!title || !artist) return undefined;
  const trackId = typeof value.trackId === 'string' ? value.trackId.slice(0, 120) : null;
  const album = typeof value.album === 'string' ? value.album.slice(0, 200) : null;
  const coverUrl = typeof value.coverUrl === 'string' && /^https?:\/\//.test(value.coverUrl) ? value.coverUrl.slice(0, 500) : null;
  const source = typeof value.source === 'string' ? value.source.slice(0, 40) : null;
  const duration = Number(value.duration);
  const position = Number(value.position);
  return {
    trackId,
    title,
    artist,
    album,
    coverUrl,
    source,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    position: Number.isFinite(position) && position >= 0 ? Math.round(position) : 0,
    playing: Boolean(value.playing),
    updatedAt: nowIso(),
  };
}

/** Publishes one presence change to the actor's friends, privacy applied. */
export function broadcastPresence(db: Database, store: PresenceStore, userId: string): void {
  publishPresence(db, store, userId);
}

/** Publishes the actor's current activity (or a clear event) to friends. */
export function broadcastActivity(db: Database, store: PresenceStore, userId: string): void {
  publishActivity(db, store, userId);
}

export async function presenceRoutes(app: FastifyInstance): Promise<void> {
  const store = presenceStore;

  app.post<{ Body: { sessionId?: unknown; away?: unknown } }>(
    '/api/presence/heartbeat',
    { preHandler: [requireAuth, rateLimit({ name: 'presence-heartbeat', max: 180, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
      if (!SESSION_RE.test(sessionId)) {
        return reply.code(400).send({ error: { code: 'invalid_session', message: 'Geçersiz oturum.' } });
      }
      const userId = request.user!.id;
      const previous = store.status(userId, Date.now());
      store.heartbeat(userId, sessionId, Boolean(request.body?.away), Date.now());
      const next = store.status(userId, Date.now());
      if (previous !== next) {
        if (next === 'offline') recordOffline(getDb(), userId, nowIso());
        else recordOnline(getDb(), userId, nowIso());
        const last = lastPublished.get(userId);
        const effective = readPresenceSettings(getDb(), userId);
        const published: PresenceStatus = effective.invisible || !effective.presenceVisible ? 'offline' : next;
        if (last !== published) {
          lastPublished.set(userId, published);
          broadcastPresence(getDb(), store, userId);
        }
      }
      return { ok: true, status: next };
    },
  );

  app.post<{ Body: { sessionId?: unknown } }>(
    '/api/presence/offline',
    { preHandler: [requireAuth, rateLimit({ name: 'presence-offline', max: 60, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
      if (!SESSION_RE.test(sessionId)) {
        return reply.code(400).send({ error: { code: 'invalid_session', message: 'Geçersiz oturum.' } });
      }
      const userId = request.user!.id;
      store.dropSession(userId, sessionId);
      if (store.status(userId, Date.now()) === 'offline') {
        recordOffline(getDb(), userId, nowIso());
        lastPublished.set(userId, 'offline');
        broadcastPresence(getDb(), store, userId);
        broadcastActivity(getDb(), store, userId);
      }
      return { ok: true };
    },
  );

  app.post<{ Body: { sessionId?: unknown; activity?: unknown } }>(
    '/api/presence/activity',
    { preHandler: [requireAuth, rateLimit({ name: 'presence-activity', max: 300, windowMs: 60_000, keyBy: 'user' })] },
    async (request, reply) => {
      const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
      if (!SESSION_RE.test(sessionId)) {
        return reply.code(400).send({ error: { code: 'invalid_session', message: 'Geçersiz oturum.' } });
      }
      if (!('activity' in (request.body ?? {}))) {
        return reply.code(400).send({ error: { code: 'invalid_activity', message: 'Aktivite gerekli.' } });
      }
      const activity = sanitizeActivity(request.body?.activity);
      if (activity === undefined) {
        return reply.code(400).send({ error: { code: 'invalid_activity', message: 'Geçersiz aktivite.' } });
      }
      const userId = request.user!.id;
      // A playback event always implies a live session.
      store.heartbeat(userId, sessionId, false, Date.now());
      store.setActivity(userId, sessionId, activity, Date.now());
      broadcastActivity(getDb(), store, userId);
      return { ok: true };
    },
  );

  app.get('/api/presence/friends', { preHandler: [requireAuth] }, async (request) => {
    const db = getDb();
    const userId = request.user!.id;
    const friends = listFriends(db, userId, 100, 0).items;
    const now = Date.now();
    return {
      friends: friends.map((friend) => {
        const presence = presentFor(db, store, userId, friend.id, now);
        return {
          user: friend,
          presence: presence ?? { userId: friend.id, status: 'offline' as const, lastSeenAt: null, activity: null },
        };
      }),
      at: nowIso(),
    };
  });

  app.get<{ Params: { userId: string } }>(
    '/api/presence/user/:userId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const targetId = String(request.params.userId ?? '').trim();
      if (!targetId) return reply.code(400).send({ error: { code: 'invalid_user', message: 'Kullanıcı gerekli.' } });
      const db = getDb();
      const viewerId = request.user!.id;
      if (!canViewPresence(db, viewerId, targetId)) {
        return reply.code(403).send({ error: { code: 'forbidden', message: 'Bu profilin durumu görünmüyor.' } });
      }
      const presence = presentFor(db, store, viewerId, targetId, Date.now());
      return { presence };
    },
  );

  app.get('/api/presence/stream', { preHandler: [requireAuth] }, async (request, reply) => {
    if (store.connectionCount(request.user!.id) >= 6) {
      return reply.code(429).send({ error: { code: 'too_many_streams', message: 'Çok fazla açık bağlantı.' } });
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const userId = request.user!.id;
    const write = (chunk: string) => {
      try {
        reply.raw.write(chunk);
      } catch {
        // the socket is gone; the close handler cleans up
      }
    };
    write(`event: ready\ndata: {"userId":${JSON.stringify(userId)}}\n\n`);

    const unsubscribe = store.subscribe(userId, {
      send: (event: RealtimeEvent) => write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
    });
    const keepAlive = setInterval(() => write(': ping\n\n'), 25_000);
    const close = () => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    request.raw.on('close', close);
    request.raw.on('error', close);
    return reply;
  });

  app.get('/api/presence/settings', { preHandler: [requireAuth] }, async (request) => {
    return { settings: readPresenceSettings(getDb(), request.user!.id) };
  });
}

/** Marks expired users offline and tells their friends. Called on a timer. */
export function sweepPresence(db: Database, store: PresenceStore): void {
  const offline = store.sweep(Date.now());
  for (const userId of offline) {
    recordOffline(db, userId, nowIso());
    lastPublished.set(userId, 'offline');
    broadcastPresence(db, store, userId);
    broadcastActivity(db, store, userId);
  }
}
