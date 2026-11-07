import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.js';

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: 'admin' | 'user';
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_active_at: string | null;
  last_ip: string;
  user_agent: string;
};

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split(':');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createUser(email: string, password: string, displayName: string, role: 'admin' | 'user' = 'user'): UserRow {
  const normalized = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const row: UserRow = {
    id: randomBytes(12).toString('hex'),
    email: normalized,
    password_hash: hashPassword(password),
    display_name: displayName.trim().slice(0, 80) || normalized.split('@')[0],
    role,
    created_at: now,
    updated_at: now,
    last_login_at: now,
    last_active_at: now,
    last_ip: '',
    user_agent: '',
  };
  getDb()
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at, last_login_at, last_active_at, last_ip, user_agent)
       VALUES (@id, @email, @password_hash, @display_name, @role, @created_at, @updated_at, @last_login_at, @last_active_at, @last_ip, @user_agent)`,
    )
    .run(row);
  return row;
}

export function findUserByEmail(email: string): UserRow | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return row ?? null;
}

export function findUserById(id: string): UserRow | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ?? null;
}

export function listUsers(limit = 500): UserRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM users ORDER BY last_active_at DESC, created_at DESC LIMIT ?`,
    )
    .all(limit) as UserRow[];
}

// Throttled presence update: at most once per 45s per user in-memory
const lastTouch = new Map<string, number>();
export function touchUserActive(id: string, ip = '', userAgent = ''): void {
  const now = Date.now();
  const prev = lastTouch.get(id) ?? 0;
  if (now - prev < 45_000) return;
  lastTouch.set(id, now);
  const iso = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE users SET last_active_at = @now, updated_at = @now, last_ip = @ip, user_agent = @ua WHERE id = @id`,
    )
    .run({ id, now: iso, ip: ip.slice(0, 64), ua: userAgent.slice(0, 300) });
}

export function touchLogin(id: string, ip = '', userAgent = ''): void {
  const now = Date.now();
  lastTouch.set(id, now);
  const iso = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE users SET last_login_at = @now, last_active_at = @now, updated_at = @now, last_ip = @ip, user_agent = @ua WHERE id = @id`,
    )
    .run({ id, now: iso, ip: ip.slice(0, 64), ua: userAgent.slice(0, 300) });
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastActiveAt: row.last_active_at,
  };
}

export function adminStats(): {
  totalUsers: number;
  onlineNow: number;
  activeToday: number;
  newLast7d: number;
  users: Array<PublicUser & { lastIp: string; userAgent: string; online: boolean }>;
} {
  const now = Date.now();
  const onlineCutoff = new Date(now - 3 * 60_000).toISOString();
  const todayCutoff = new Date(now - 24 * 60 * 60_000).toISOString();
  const weekCutoff = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const totalUsers = (getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  const onlineNow = (
    getDb().prepare('SELECT COUNT(*) AS c FROM users WHERE last_active_at IS NOT NULL AND last_active_at >= ?').get(onlineCutoff) as { c: number }
  ).c;
  const activeToday = (
    getDb().prepare('SELECT COUNT(*) AS c FROM users WHERE last_active_at IS NOT NULL AND last_active_at >= ?').get(todayCutoff) as { c: number }
  ).c;
  const newLast7d = (
    getDb().prepare('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?').get(weekCutoff) as { c: number }
  ).c;
  const users = listUsers().map((row) => ({
    ...toPublicUser(row),
    lastIp: row.last_ip,
    userAgent: row.user_agent,
    online: row.last_active_at !== null && row.last_active_at >= onlineCutoff,
  }));
  return { totalUsers, onlineNow, activeToday, newLast7d, users };
}
