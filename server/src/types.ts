export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string | null;
  year: number | null;
  trackNo: number | null;
  discNo: number | null;
  duration: number;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  format: string | null;
  size: number;
  coverUrl: string | null;
  streamUrl: string;
  addedAt: string;
};

export type Album = {
  id: string;
  name: string;
  artist: string;
  year: number | null;
  trackCount: number;
  duration: number;
  coverUrl: string | null;
};

export type Artist = {
  id: string;
  name: string;
  trackCount: number;
  albumCount: number;
  coverUrl: string | null;
};

export type LibraryStats = {
  tracks: number;
  albums: number;
  artists: number;
  totalDuration: number;
  totalSize: number;
  lastScanAt: string | null;
};

export type Library = {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  stats: LibraryStats;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  duration: number;
  coverUrl: string | null;
  visibility: 'private' | 'public';
  pinned: boolean;
  isOwner: boolean;
  sourceProvider: string | null;
  sourceUrl: string | null;
  sourcePlaylistId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExternalPlaylistTrack = {
  entryId: number;
  provider: string;
  providerTrackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  artworkUrl: string | null;
  sourceUrl: string | null;
  position: number;
  matchedTrackId: string | null;
  status: 'playable' | 'unavailable';
  createdAt: string;
};

export type Playlist = PlaylistSummary & {
  tracks: Array<Track & { entryId: number; position: number }>;
  externalTracks: ExternalPlaylistTrack[];
};

export type ScanResult = {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  durationMs: number;
  lastScanAt: string;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};
