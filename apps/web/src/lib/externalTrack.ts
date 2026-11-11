import type { ExternalPlaylistTrack, Track } from '../types';

const YOUTUBE_ID = /^[\w-]{11}$/;

/**
 * A playlist entry that only exists as a reference (Spotify import, YouTube
 * playlist import) still has everything the resolver needs: an upload id when
 * the provider gave one, otherwise the title/artist/duration trio.
 */
export function externalToTrack(external: ExternalPlaylistTrack): Track {
  const videoId =
    external.provider !== 'spotify' && external.providerTrackId && YOUTUBE_ID.test(external.providerTrackId)
      ? external.providerTrackId
      : null;
  const provider = external.provider === 'spotify' ? 'spotify' : 'youtube';

  return {
    id: videoId ? `yt_${videoId}` : `ext_${external.entryId}`,
    title: external.title,
    artist: external.artist,
    album: external.album ?? (provider === 'spotify' ? 'Spotify' : 'YouTube'),
    albumArtist: external.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: external.duration ?? 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: provider,
    size: 0,
    coverUrl: external.artworkUrl,
    streamUrl: videoId ? `youtube:${videoId}` : `${provider}:${external.entryId}`,
    addedAt: external.createdAt,
  };
}

export function externalProviderLabel(provider: string): string {
  if (provider === 'spotify') return 'Spotify';
  if (provider === 'youtube-music') return 'YouTube Music';
  if (provider === 'youtube') return 'YouTube';
  return 'Kaynak';
}
