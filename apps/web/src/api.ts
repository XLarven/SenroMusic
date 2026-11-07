import type {
  Health,
  Library,
  Playlist,
  PlaylistSummary,
  ScanResult,
  YouTubeResult,
  User,
  AdminStats,
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
  register: (email: string, password: string, displayName: string) =>
    request<{ ok: boolean; user: User }>('/api/auth/register', {
      method: 'POST',
      body: { email, password, displayName },
    }),
  tokenLogin: (token: string) =>
    request<{ ok: boolean; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { token },
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  adminStats: () => request<AdminStats>('/api/admin/stats'),
  spotifyResolve: (url: string) =>
    request<SpotifyResolved>('/api/spotify/resolve', { method: 'POST', body: { url } }),
  library: () => request<Library>('/api/library'),
  youtubeSearch: (q: string, limit?: number) =>
    request<{ results: YouTubeResult[] }>(
      `/api/youtube/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`,
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
  updatePlaylist: (id: string, input: { name?: string; description?: string }) =>
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
};
