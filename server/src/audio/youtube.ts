/**
 * YouTube audio source.
 *
 * YouTube's anonymous InnerTube endpoints now answer the player request with a
 * bot check, so extraction goes through yt-dlp, which carries the client
 * configuration that still works. One process per resolve (~3 s) and the result
 * is cached by the resolver, so playback start pays that cost once per track.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BROWSER_UA, mimeFromFormat, type ResolvedStream } from './types.js';

const execFileAsync = promisify(execFile);
const PYTHON = process.env.PYTHON_PATH || 'python';

/** Prefer m4a: it is the only container that plays in every target browser. */
const FORMAT = 'bestaudio[ext=m4a]/bestaudio/best';

const EXTRACT_TIMEOUT_MS = 35_000;

type YtDlpResult = { stdout: string; stderr: string };

async function runYtDlp(args: string[], timeoutMs: number): Promise<YtDlpResult | null> {
  try {
    return await execFileAsync(PYTHON, ['-m', 'yt_dlp', ...args], {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    if (stderr) {
      const tail = stderr.trim().split(/\r?\n/).slice(-1)[0] ?? '';
      console.warn('[audio/youtube] yt-dlp failed:', tail.slice(0, 200));
    }
    return null;
  }
}

function firstUrl(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const value = line.trim();
    if (value.startsWith('https://')) return value;
  }
  return null;
}

/** googlevideo URLs carry the real container in the `mime` query parameter. */
function mimeOf(url: string, ext: string | null): string {
  try {
    const mime = new URL(url).searchParams.get('mime');
    if (mime && mime.startsWith('audio/')) return mime;
  } catch {
    // fall through to the container hint
  }
  return mimeFromFormat(ext, 'audio/mp4');
}

/** googlevideo links are signed with an expiry; trust it when present. */
function expiryOf(url: string): number {
  try {
    const expire = Number(new URL(url).searchParams.get('expire'));
    if (Number.isFinite(expire) && expire > 0) return expire * 1000;
  } catch {
    // ignore
  }
  return Date.now() + 45 * 60_000;
}

/** Direct audio URL for a known video, or null when the video cannot be served. */
export async function extractAudio(videoId: string): Promise<ResolvedStream | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null;

  const result = await runYtDlp(
    [
      '-g',
      '--no-warnings',
      '--no-playlist',
      '--no-progress',
      '--socket-timeout',
      '12',
      '--extractor-retries',
      '1',
      '-f',
      FORMAT,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    EXTRACT_TIMEOUT_MS,
  );

  const url = result ? firstUrl(result.stdout) : null;
  if (!url) return null;

  let ext: string | null = null;
  try {
    ext = new URL(url).searchParams.get('ext');
  } catch {
    // ignore
  }

  return {
    source: 'youtube',
    url,
    mimeType: mimeOf(url, ext),
    bitrate: null,
    contentLength: null,
    expiresAt: expiryOf(url),
    label: `youtube:${videoId}`,
  };
}

/**
 * First YouTube Music result for a free-text song query. Used only when the
 * caller has no video id yet (a Spotify track that was never matched).
 */
export async function searchVideoId(query: string): Promise<string | null> {
  const trimmed = query.trim().slice(0, 160);
  if (!trimmed) return null;

  const result = await runYtDlp(
    [
      '--flat-playlist',
      '--no-warnings',
      '--no-progress',
      '--socket-timeout',
      '12',
      '--print',
      '%(id)s',
      '-I',
      '1:1',
      `ytsearch1:${trimmed}`,
    ],
    25_000,
  );

  const id = result?.stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
  return /^[\w-]{11}$/.test(id) ? id : null;
}

/** HEAD probe used when a cached URL has to be validated before serving. */
export async function probeAudio(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': BROWSER_UA, range: 'bytes=0-1' },
      signal: AbortSignal.timeout(8_000),
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}
