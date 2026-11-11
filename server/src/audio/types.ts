/**
 * Shared shapes for the pluggable audio-source layer.
 *
 * This mirrors how Spotube works: track *metadata* comes from a catalogue
 * (Spotify), while the *audio* is resolved per playback from an independent
 * source. Sources are interchangeable and ordered, so one provider going down
 * never makes a track unplayable while another can still serve it.
 */

export type AudioSource = 'youtube' | 'jiosaavn' | 'piped';

export type ResolvedStream = {
  /** Which provider produced the URL. */
  source: AudioSource;
  /** Direct upstream URL. Never handed to the browser — the proxy streams it. */
  url: string;
  mimeType: string;
  bitrate: number | null;
  contentLength: number | null;
  /** Epoch ms after which the URL is assumed dead and must be re-resolved. */
  expiresAt: number;
  /** Human-readable identity of the chosen recording, for logs and diagnostics. */
  label: string;
};

export type StreamRequest = {
  /** Known YouTube id, when the caller already picked a specific upload. */
  videoId?: string | null;
  title?: string | null;
  artist?: string | null;
  /** Seconds. Used to reject a different recording of the same name. */
  duration?: number | null;
  /** Provider keys that already failed for this song, so retries move on. */
  exclude?: string[];
};

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** `audio/mp4` plays everywhere; webm/opus is Chrome/Firefox only. */
export function mimeFromFormat(
  container: string | null | undefined,
  fallback = 'audio/mpeg',
): string {
  switch (String(container ?? '').toLowerCase()) {
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'audio/mp4';
    case 'webm':
    case 'opus':
      return 'audio/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
    case 'vorbis':
      return 'audio/ogg';
    default:
      return fallback;
  }
}
