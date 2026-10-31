import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(moduleDir, '..');
const projectRoot = resolve(serverRoot, '..');

function envPath(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return resolve(value || fallback);
}

function envFlag(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const configuredToken = process.env.MUSIC_TOKEN?.trim();
const secureCookiesRaw = process.env.SECURE_COOKIES?.trim().toLowerCase();

if (!configuredToken && isProduction) {
  throw new Error(
    'MUSIC_TOKEN is required in production. Copy .env.example to .env and set a strong token.',
  );
}

const musicToken = configuredToken || 'senro-demo';

export const config = {
  isProduction,
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: envInt('PORT', 8787),
  musicDir: envPath('MUSIC_DIR', resolve(serverRoot, 'music')),
  dataDir: envPath('DATA_DIR', resolve(serverRoot, 'data')),
  webDist: envPath('WEB_DIST', resolve(projectRoot, 'apps/web/dist')),
  musicToken,
  demoToken: !configuredToken,
  sessionSecret:
    process.env.MUSIC_SESSION_SECRET?.trim() ||
    createHash('sha256').update(`senro-session:${musicToken}`).digest('hex'),
  sessionDays: envInt('SESSION_DAYS', 30),
  secureCookies:
    secureCookiesRaw === undefined || secureCookiesRaw === ''
      ? null
      : secureCookiesRaw === '1' ||
        secureCookiesRaw === 'true' ||
        secureCookiesRaw === 'yes' ||
        secureCookiesRaw === 'on',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  scanOnStart: envFlag('SCAN_ON_START', true),
  maxScanFiles: envInt('MAX_SCAN_FILES', 50_000),
  serverRoot,
  projectRoot,
} as const;

export const paths = {
  db: resolve(config.dataDir, 'library.db'),
  covers: resolve(config.dataDir, 'covers'),
  webIndex: resolve(config.webDist, 'index.html'),
  webAssets: config.webDist,
} as const;

export function ensureRuntimeDirs(): void {
  for (const dir of [config.dataDir, paths.covers]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.wave',
  '.aiff',
  '.aif',
  '.wma',
  '.alac',
]);

export const COVER_NAMES = [
  'cover.jpg',
  'cover.jpeg',
  'cover.png',
  'cover.webp',
  'cover.svg',
  'folder.jpg',
  'folder.jpeg',
  'folder.png',
  'folder.webp',
  'front.jpg',
  'front.jpeg',
  'front.png',
  'front.webp',
  'albumart.jpg',
  'albumart.jpeg',
  'albumart.png',
  'albumart.webp',
];

// Kept for diagnostics without leaking the token itself.
export const tokenFingerprint = createHash('sha256').update(musicToken).digest('hex').slice(0, 8);
export const instanceId = randomBytes(8).toString('hex');
