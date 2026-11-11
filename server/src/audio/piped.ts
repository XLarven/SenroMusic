/**
 * Piped audio source.
 *
 * Piped instances proxy the stream themselves, so their URLs survive when a
 * direct YouTube extraction is blocked. Public instances are frequently
 * rate-limited or offline, which is why this provider is opt-in: list the ones
 * you trust in PIPED_INSTANCES (comma separated, e.g. "pipedapi.example.com").
 */
import { BROWSER_UA, mimeFromFormat, type ResolvedStream } from './types.js';

type PipedAudioStream = {
  url?: string;
  bitrate?: number;
  mimeType?: string;
  codec?: string;
};

type PipedStreams = {
  title?: string;
  uploader?: string;
  audioStreams?: PipedAudioStream[];
};

const TIMEOUT_MS = 9_000;

function instances(): string[] {
  const raw = process.env.PIPED_INSTANCES ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .filter((entry) => /^[a-z0-9.-]+(:\d+)?$/i.test(entry));
}

export function pipedAvailable(): boolean {
  return instances().length > 0;
}

export async function resolveVideo(videoId: string): Promise<ResolvedStream | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null;

  for (const host of instances()) {
    try {
      const res = await fetch(`https://${host}/streams/${videoId}`, {
        headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;

      const payload = (await res.json().catch(() => null)) as PipedStreams | null;
      const streams = (payload?.audioStreams ?? []).filter(
        (stream): stream is PipedAudioStream & { url: string } =>
          typeof stream?.url === 'string' && stream.url.length > 0,
      );
      if (streams.length === 0) continue;

      streams.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
      const best = streams[0];

      // Some instances return proxied paths rather than absolute URLs.
      const url = best.url.startsWith('/') ? `https://${host}${best.url}` : best.url;

      return {
        source: 'piped',
        url,
        mimeType: best.mimeType?.startsWith('audio/')
          ? best.mimeType
          : mimeFromFormat(best.mimeType, 'audio/mp4'),
        bitrate: Number.isFinite(best.bitrate) ? Number(best.bitrate) : null,
        contentLength: null,
        expiresAt: Date.now() + 45 * 60_000,
        label: `piped:${videoId} ${payload?.title ?? ''}`.trim(),
      };
    } catch {
      // Try the next instance; one dead host must not fail the request.
    }
  }

  return null;
}
