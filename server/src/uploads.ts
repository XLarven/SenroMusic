/**
 * Profile image uploads.
 *
 * Only images live here: the downloads route never touches this directory, and
 * audio is never written to it. Files get random names, are served only to
 * authenticated sessions, and are capped at 20 MB.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from './auth.js';
import { paths } from './config.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function sniffMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Writes a validated image and returns its public URL. */
export async function saveProfileImage(bytes: Buffer): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) return null;
  const mime = sniffMime(bytes);
  if (!mime) return null;
  const ext = EXTENSIONS[mime];
  if (!ext) return null;
  const name = `${randomBytes(16).toString('hex')}.${ext}`;
  await mkdir(paths.uploads, { recursive: true });
  await writeFile(`${paths.uploads}/${name}`, bytes, { mode: 0o600 });
  return `/api/uploads/${name}`;
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { file: string } }>(
    '/api/uploads/:file',
    // Profile images are shown inside the app, so a session is required but no
    // extra ownership check: they are not private documents.
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const file = String(request.params.file ?? '');
      if (!FILE_RE.test(file)) return reply.code(404).send({ error: { code: 'not_found', message: 'Görsel yok.' } });
      try {
        const data = await readUpload(file);
        const mime = file.endsWith('.png')
          ? 'image/png'
          : file.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
        return reply
          .header('Content-Type', mime)
          .header('Cache-Control', 'private, max-age=31536000, immutable')
          .header('X-Content-Type-Options', 'nosniff')
          .send(data);
      } catch {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Görsel yok.' } });
      }
    },
  );
}

async function readUpload(file: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(`${paths.uploads}/${file}`);
}

export function isUploadUrl(value: string): boolean {
  return /^\/api\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(value);
}
