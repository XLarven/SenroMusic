import type {
  Album,
  Artist,
  ArtistFollow,
  Health,
  HistoryItem,
  Library,
  SearchHistoryItem,
  Playlist,
  PlaylistSummary,
  PublicProfile,
  ScanResult,
  Track,
  YouTubeResult,
  User,
  AdminStats,
  SpotifyCatalogSearch,
  SpotifyResolved,
} from './types';
import { getServerUrl } from './lib/serverUrl';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const response = await fetch(`${getServerUrl()}${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let code = 'request_failed';
    let message = `İstek başarısız oldu (${response.status}).`;
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      code = payload.error?.code ?? code;
      message = payload.error?.message ?? message;
    } catch {
      // Keep the generic message when the server did not return JSON.
    }
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('Norie:unauthorized'));
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  health: () => request<Health>('/api/health'),
  authStatus: () => request<{ registrationOpen: boolean; supabaseEnabled: boolean }>('/api/auth/status'),
  me: () => request<{ authenticated: boolean; user?: User }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ ok: boolean; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),
  register: (email: string, password: string, displayName: string, username: string) =>
    request<{ ok: boolean; user: User }>('/api/auth/register', {
      method: 'POST',
      body: { email, password, displayName, username },
    }),
  usernameAvailable: (username: string) =>
    request<{ available: boolean; username: string }>(
      `/api/auth/username-available?username=${encodeURIComponent(username)}`,
    ),
  tokenLogin: (token: string) =>
    request<{ ok: boolean; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { token },
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (input: {
    displayName?: string;
    username?: string | null;
    bio?: string;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    profileVisibility?: 'public' | 'private';
    favoriteGenres?: string[];
  }) =>
    request<{ ok: boolean; user: User }>('/api/auth/me', { method: 'PATCH', body: input }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  deleteAccount: (password: string) =>
    request<{ ok: boolean }>('/api/auth/me', { method: 'DELETE', body: { password } }),
  settings: () => request<{ settings: Record<string, unknown> }>('/api/me/settings'),
  updateSetting: (key: string, value: unknown) =>
    request<{ ok: boolean; settings: Record<string, unknown> }>('/api/me/settings', {
      method: 'PUT',
      body: { key, value },
    }),
  favorites: () => request<{ tracks: Track[] }>('/api/me/favorites'),
  addFavorite: (trackId: string) =>
    request<{ ok: boolean; favorited: boolean }>('/api/me/favorites', {
      method: 'POST',
      body: { trackId },
    }),
  removeFavorite: (trackId: string) =>
    request<{ ok: boolean; favorited: boolean }>(
      `/api/me/favorites/${encodeURIComponent(trackId)}`,
      { method: 'DELETE' },
    ),
  history: (limit = 50) =>
    request<{ items: HistoryItem[] }>(`/api/me/history?limit=${limit}`),
  recordPlay: (trackId: string, msPlayed: number, source = 'player') =>
    request<{ ok: boolean; recorded?: boolean }>('/api/me/history', {
      method: 'POST',
      body: { trackId, msPlayed, source },
    }),
  historyStats: () =>
    request<{
      totalPlays: number;
      totalMs: number;
      lastPlayedAt: string | null;
      topArtists: Array<{ artist: string; plays: number }>;
    }>('/api/me/history/stats'),
  searchHistory: (limit = 50) =>
    request<{ items: SearchHistoryItem[] }>(`/api/me/search-history?limit=${limit}`),
  recordSearch: (query: string) =>
    request<{ ok: boolean; recorded?: boolean }>('/api/me/search-history', {
      method: 'POST',
      body: { query },
    }),
  clearSearchHistory: () =>
    request<{ ok: boolean }>('/api/me/search-history', { method: 'DELETE' }),
  artistFollows: () => request<{ follows: ArtistFollow[] }>('/api/me/artist-follows'),
  followArtist: (artistId: string, artistName: string) =>
    request<{ ok: boolean; followed: boolean }>('/api/me/artist-follows', {
      method: 'POST',
      body: { artistId, artistName },
    }),
  unfollowArtist: (artistId: string) =>
    request<{ ok: boolean; followed: boolean }>(
      `/api/me/artist-follows/${encodeURIComponent(artistId)}`,
      { method: 'DELETE' },
    ),
  publicProfile: (id: string) =>
    request<{ profile: PublicProfile; playlists: PlaylistSummary[] }>(
      `/api/profiles/${encodeURIComponent(id)}`,
    ),
  publicProfileByUsername: (username: string) =>
    request<{ profile: PublicProfile; playlists: PlaylistSummary[] }>(
      `/api/profiles/by-username/${encodeURIComponent(username)}`,
    ),
  adminStats: () => request<AdminStats>('/api/admin/stats'),
  spotifyResolve: (url: string) =>
    request<SpotifyResolved>('/api/spotify/resolve', { method: 'POST', body: { url } }),
  spotifySearch: (q: string, limit = 10) =>
    request<SpotifyCatalogSearch>(
      `/api/spotify/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  spotifyPlaylist: (id: string) =>
    request<SpotifyResolved>(`/api/spotify/playlists/${encodeURIComponent(id)}`),
  library: () => request<Library>('/api/library'),
  search: (q: string, limit = 20) =>
    request<{ tracks: Track[]; albums: Album[]; artists: Artist[] }>(
      `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  youtubeSearch: (q: string, limit?: number) =>
    request<{ results: YouTubeResult[] }>(
      `/api/youtube/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`,
    ),
  searchSuggestions: (q: string) =>
    request<{
      texts: string[];
      songs: Array<{ id: string; title: string; artist: string; thumbnail: string; duration: number | null; url: string }>;
    }>(`/api/search/suggestions?q=${encodeURIComponent(q)}`),
  youtubeSimilar: (input: { title?: string; artist?: string; q?: string; exclude?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (input.q) params.set('q', input.q);
    if (input.title) params.set('title', input.title);
    if (input.artist) params.set('artist', input.artist);
    if (input.exclude) params.set('exclude', input.exclude);
    if (input.limit) params.set('limit', String(input.limit));
    return request<{ results: Array<{ id: string; title: string; artist: string; thumbnail: string; duration: number | null; url: string }> }>(
      `/api/youtube/similar?${params.toString()}`,
    );
  },
  youtubePlaylist: (url: string) =>
    request<{ title: string; items: YouTubeResult[]; total: number }>(
      `/api/youtube/playlist?url=${encodeURIComponent(url)}`,
    ),
  youtubeDownload: (input: { id: string; title?: string; uploader?: string; thumbnail?: string }) =>
    request<{ ok: boolean; path: string }>(
      '/api/youtube/download',
      { method: 'POST', body: input },
    ),
  scan: () => request<ScanResult>('/api/scan', { method: 'POST' }),
  playlists: () => request<{ playlists: PlaylistSummary[] }>('/api/playlists'),
  playlist: (id: string) => request<Playlist>(`/api/playlists/${encodeURIComponent(id)}`),
  createPlaylist: (input: { name: string; description?: string }) =>
    request<Playlist>('/api/playlists', { method: 'POST', body: input }),
  updatePlaylist: (id: string, input: { name?: string; description?: string; visibility?: 'private' | 'public' }) =>
    request<Playlist>(`/api/playlists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),
  deletePlaylist: (id: string) =>
    request<{ ok: boolean }>(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addTrack: (playlistId: string, trackId: string) =>
    request<{ ok: boolean; entryId: number }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/tracks`,
      { method: 'POST', body: { trackId } },
    ),
  removeTrack: (playlistId: string, entryId: number) =>
    request<{ ok: boolean }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${entryId}`,
      { method: 'DELETE' },
    ),
  reorderPlaylist: (playlistId: string, entryIds: number[]) =>
    request<{ ok: boolean }>(`/api/playlists/${encodeURIComponent(playlistId)}/order`, {
      method: 'PUT',
      body: { entryIds },
    }),
  duplicatePlaylist: (playlistId: string) =>
    request<Playlist>(`/api/playlists/${encodeURIComponent(playlistId)}/duplicate`, {
      method: 'POST',
    }),
  pinPlaylist: (playlistId: string) =>
    request<{ ok: boolean; pinned: boolean }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/pin`,
      { method: 'POST' },
    ),
  sharePlaylist: (playlistId: string) =>
    request<{ ok: boolean; shareSlug: string; shareUrl: string }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/share`,
      { method: 'POST' },
    ),
  publicPlaylistBySlug: (slug: string) =>
    request<Playlist>(`/api/public-playlists/${encodeURIComponent(slug)}`),
  importPlaylist: (input: {
    provider: 'spotify' | 'youtube' | 'youtube-music' | 'norie';
    sourceUrl: string;
    sourcePlaylistId?: string | null;
    title?: string;
    description?: string;
    artworkUrl?: string | null;
    existingPlaylistId?: string;
    skipDuplicates?: boolean;
    selectedIndexes?: number[];
    items: Array<{
      providerTrackId?: string | null;
      title: string;
      artist: string;
      album?: string | null;
      duration?: number | null;
      artworkUrl?: string | null;
      sourceUrl?: string | null;
    }>;
  }) =>
    request<{
      playlist: Playlist;
      importedCount: number;
      matchedCount: number;
      unmatchedCount: number;
      skippedCount: number;
      alreadyImported: boolean;
    }>('/api/imports/playlist', { method: 'POST', body: input }),
  uploadPlaylistCover: (playlistId: string, imageDataUrl: string) =>
    request<Playlist>(`/api/playlists/${encodeURIComponent(playlistId)}/cover`, {
      method: 'POST',
      body: { imageDataUrl },
    }),
};
