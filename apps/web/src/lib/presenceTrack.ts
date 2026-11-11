import type { ListeningActivity, Track } from '../types';

/**
 * Builds a playable track from a friend's shared activity.
 *
 * The stream URL is never shared across users — only the identity is. When the
 * activity carries a known upload id the exact recording is used, otherwise the
 * resolver picks a source from the metadata.
 */
export function activityToTrack(activity: ListeningActivity): Track {
  const id = activity.trackId ?? `presence_${activity.title}-${activity.artist}`.replace(/[^\w-]+/g, '-').slice(0, 60);
  const youtubeId = activity.trackId?.startsWith('yt_') ? activity.trackId.slice(3) : null;
  return {
    id,
    title: activity.title,
    artist: activity.artist,
    album: activity.album ?? '',
    albumArtist: activity.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: activity.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: activity.source ?? 'stream',
    size: 0,
    coverUrl: activity.coverUrl,
    streamUrl: youtubeId && /^[\w-]{11}$/.test(youtubeId) ? `youtube:${youtubeId}` : `spotify:${id}`,
    addedAt: new Date().toISOString(),
  };
}
