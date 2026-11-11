import type { ListeningActivity, Track } from '../types';

/**
 * Builds a playable track from shared metadata (a friend's activity or a shared
 * card in a message).
 *
 * The stream URL is never shared across users — only the identity is. When the
 * payload carries a known upload id the exact recording is used, otherwise the
 * resolver picks a source from the metadata.
 */
export function shareToTrack(input: {
  trackId?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  source?: string | null;
  duration?: number | null;
}): Track {
  const id =
    input.trackId ?? `presence_${input.title}-${input.artist}`.replace(/[^\w-]+/g, '-').slice(0, 60);
  const youtubeId = id.startsWith('yt_') ? id.slice(3) : null;
  return {
    id,
    title: input.title,
    artist: input.artist,
    album: input.album ?? '',
    albumArtist: input.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: input.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: input.source ?? 'stream',
    size: 0,
    coverUrl: input.coverUrl ?? null,
    streamUrl: youtubeId && /^[\w-]{11}$/.test(youtubeId) ? `youtube:${youtubeId}` : `spotify:${id}`,
    addedAt: new Date().toISOString(),
  };
}

export function activityToTrack(activity: ListeningActivity): Track {
  return shareToTrack({
    trackId: activity.trackId,
    title: activity.title,
    artist: activity.artist,
    album: activity.album,
    coverUrl: activity.coverUrl,
    source: activity.source,
    duration: activity.duration,
  });
}
