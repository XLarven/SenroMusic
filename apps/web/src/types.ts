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
  createdAt: string;
  updatedAt: string;
};

export type Playlist = PlaylistSummary & {
  tracks: Array<Track & { entryId: number }>;
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
};

export type SpotifyResolved = {
  type: string;
  title: string;
  items: SpotifyItem[];
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
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
};

export type AdminStats = {
  totalUsers: number;
  onlineNow: number;
  activeToday: number;
  newLast7d: number;
  users: Array<User & { lastIp: string; userAgent: string; online: boolean }>;
};
