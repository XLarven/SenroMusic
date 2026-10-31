import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { COVER_NAMES, paths } from './config.js';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const COVER_ID_RE = /^c_[a-f0-9]{16}\.(jpg|png|webp|gif|svg)$/;

export function findSidecarCover(directory: string): string | null {
  for (const name of COVER_NAMES) {
    const candidate = resolve(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function cacheCoverBuffer(data: Buffer, mime: string): Promise<string | null> {
  const ext = EXTENSIONS[mime.toLowerCase()];
  if (!ext || data.length === 0) return null;
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  const id = `c_${hash}.${ext}`;
  const target = resolve(paths.covers, id);
  if (!existsSync(target)) await writeFile(target, data);
  return id;
}

export async function cacheCoverFile(filePath: string): Promise<string | null> {
  const ext = extname(filePath).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? mimeFromName(filePath);
  if (!mime) return null;
  const data = await readFile(filePath);
  return cacheCoverBuffer(data, mime);
}

function mimeFromName(filePath: string): string | null {
  const name = basename(filePath).toLowerCase();
  if (name.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

export function resolveCoverPath(id: string): string | null {
  if (!COVER_ID_RE.test(id)) return null;
  const target = resolve(paths.covers, id);
  return target.startsWith(paths.covers) && existsSync(target) ? target : null;
}

export function coverMime(id: string): string {
  const ext = id.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
