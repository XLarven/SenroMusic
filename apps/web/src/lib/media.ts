import type { Track } from '../types';
import { getServerUrl } from './serverUrl';

/**
 * Playback source resolution for the browser.
 *
 * Anything that is not a file on this server plays through `/api/media/stream`,
 * which asks the backend's provider chain (YouTube / JioSaavn / Piped) for audio
 * and proxies the bytes. The browser therefore only ever sees one URL shape and
 * never needs a third-party player, an embed frame or a signed provider link.
 */

const YOUTUBE_ID = /^[\w-]{11}$/;

/** `youtube:<id>` stream URLs and `yt_<id>` ids both carry a YouTube id. */
export function youtubeIdOf(track: Track): string | null {
  if (track.streamUrl.startsWith('youtube:')) {
    const id = track.streamUrl.slice('youtube:'.length).trim();
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (track.id.startsWith('yt_')) {
    const id = track.id.slice(3).trim();
    return YOUTUBE_ID.test(id) ? id : null;
  }
  return null;
}

/** True when the audio must be resolved from a provider rather than a file. */
export function isRemoteTrack(track: Track): boolean {
  if (youtubeIdOf(track)) return true;
  return !track.streamUrl.startsWith('/api/');
}

function seconds(value: number | null | undefined): string | null {
  const rounded = Math.round(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? String(rounded) : null;
}

/**
 * URL for `<audio src>`. Local files keep their own endpoint; everything else
 * is handed to the resolver with whatever identity the track has.
 */
export function mediaUrl(track: Track): string {
  // A local file or an internal endpoint is already playable: never send it
  // through the provider resolver, or a library track would be re-matched by
  // title and could come back as the wrong recording (or not at all).
  if (track.streamUrl.startsWith('/api/')) return track.streamUrl;

  const videoId = youtubeIdOf(track);
  const params = new URLSearchParams();

  if (videoId) params.set('videoId', videoId);
  // Metadata always rides along: the resolver needs it to fall back to a
  // second provider when the identified upload refuses to stream.
  if (track.title) params.set('title', track.title);
  if (track.artist) params.set('artist', track.artist);
  const duration = seconds(track.duration);
  if (duration) params.set('duration', duration);

  if (params.size === 0) return track.streamUrl;
  return `/api/media/stream?${params.toString()}`;
}

/**
 * Ordered identity for a track: a known upload first, the song metadata after.
 * The stream URL uses the same values, this is only for diagnostics/UI.
 */
export function trackIdentity(track: Track): { videoId: string | null; title: string; artist: string } {
  return {
    videoId: youtubeIdOf(track),
    title: track.title ?? '',
    artist: track.artist ?? '',
  };
}

/**
 * Asks the server to resolve a remote track without streaming any bytes, so the
 * provider extraction is already paid for when the user presses play. Local
 * files are ignored, and each track is warmed at most once per session.
 */
const warmedTargets = new Set<string>();

export function warmTrack(track: Track | null | undefined): void {
  if (!track) return;
  const target = mediaUrl(track);
  if (!target.startsWith('/api/media/stream')) return;
  if (warmedTargets.has(target)) return;
  warmedTargets.add(target);
  const warmUrl = target.replace('/api/media/stream', '/api/media/warm');
  void fetch(`${getServerUrl()}${warmUrl}`, { credentials: 'include' }).catch(() => undefined);
}