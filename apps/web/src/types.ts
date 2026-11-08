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
  alreadyRunning?: boolean;
};

export type SpotifyItem = {
  title: string;
  artist: string;
  youtubeQuery: string;
  providerTrackId?: string | null;
  duration?: number | null;
  artworkUrl?: string | null;
  sourceUrl?: string | null;
  album?: string | null;
};

export type SpotifyResolved = {
  type: string;
  title: string;
  description?: string | null;
  artworkUrl?: string | null;
  creator?: string | null;
  totalDuration?: number | null;
  totalTracks?: number;
  items: SpotifyItem[];
};

export type SpotifyCatalogSearch = {
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string | null;
    duration: number | null;
    artworkUrl: string | null;
    sourceUrl: string | null;
    isrc: string | null;
  }>;
  artists: Array<{ id: string; name: string; imageUrl: string | null; sourceUrl: string | null }>;
  albums: Array<{
    id: string;
    name: string;
    artist: string;
    imageUrl: string | null;
    sourceUrl: string | null;
    releaseDate: string | null;
  }>;
  playlists: Array<{
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    sourceUrl: string | null;
    owner: string | null;
    trackCount: number | null;
  }>;
};

export type YouTubeResult = {
  id: string;
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string;
  url: string;
};

export type Health = {
  status: 'ok';
  name: string;
  version: string;
  tracks: number;
  scanning: boolean;
  demoToken?: boolean;
  lastScanAt?: string | null;
  mysqlEnabled?: boolean;
  spotifyConfigured?: boolean;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  username: string | null;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  profileVisibility: 'public' | 'private';
  favoriteGenres: string[];
};

export type PublicProfile = {
  id: string;
  displayName: string;
  username: string | null;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  profileVisibility: 'public' | 'private';
  favoriteGenres: string[];
  role: 'admin' | 'user';
  createdAt: string;
  publicPlaylistCount: number;
  followedArtistCount: number;
  isOwner: boolean;
};

export type HistoryItem = {
  track: Track;
  playedAt: string;
  msPlayed: number;
  source: string;
};

export type SearchHistoryItem = {
  id: number;
  query: string;
  searchedAt: string;
};

export type ArtistFollow = {
  artistId: string;
  artistName: string;
  createdAt: string;
};

export type DownloadState =
  | 'not-downloaded'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'failed'
  | 'unavailable';

export type DownloadRecord = {
  trackId: string;
  state: DownloadState;
  progress: number;
  size: number;
  downloadedAt: string | null;
  error: string | null;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  duration: number;
};

export type AdminStats = {
  totalUsers: number;
  onlineNow: number;
  activeToday: number;
  newLast7d: number;
  users: Array<User & { lastIp: string; userAgent: string; online: boolean }>;
};
