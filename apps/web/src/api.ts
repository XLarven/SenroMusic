import type {
  Health,
  Library,
  Playlist,
  PlaylistSummary,
  ScanResult,
} from './types';

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
  const response = await fetch(path, {
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
      window.dispatchEvent(new CustomEvent('senro:unauthorized'));
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  health: () => request<Health>('/api/health'),
  me: () => request<{ authenticated: boolean; demoToken: boolean }>('/api/auth/me'),
  login: (token: string) =>
    request<{ ok: boolean; demoToken: boolean }>('/api/auth/login', {
      method: 'POST',
      body: { token },
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  library: () => request<Library>('/api/library'),
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
