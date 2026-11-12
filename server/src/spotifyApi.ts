import { config } from './config.js';

export type SpotifyItem = {
  title: string;
  artist: string;
  youtubeQuery: string;
  providerTrackId: string | null;
  duration: number | null;
  artworkUrl: string | null;
  sourceUrl: string | null;
  album: string | null;
};

export type SpotifyPlaylist = {
  type: 'playlist';
  title: string;
  description: string | null;
  artworkUrl: string | null;
  creator: string | null;
  totalDuration: number | null;
  totalTracks: number;
  items: SpotifyItem[];
  /** True when the provider returned fewer entries than it reported. */
  truncated?: boolean;
};

export type SpotifySearchResult = {
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

let cachedToken: { value: string; expiresAt: number } | null = null;

export function isSpotifyConfigured(): boolean {
  return Boolean(config.spotifyClientId && config.spotifyClientSecret);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Spotify request failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return response.json();
}

export async function getSpotifyAccessToken(): Promise<string | null> {
  if (!isSpotifyConfigured()) return null;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;
  const basic = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const json = (await fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Spotify did not return an access token.');
  cachedToken = {
    value: json.access_token,
    expiresAt: now + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

async function spotifyGet(path: string): Promise<unknown> {
  const token = await getSpotifyAccessToken();
  if (!token) throw new Error('Spotify credentials are not configured.');
  return fetchJson(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function imageUrl(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0] as { url?: string };
  return typeof first.url === 'string' && first.url ? first.url : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Spotify request failed.';
}

export async function searchSpotify(query: string, limit = config.spotifySearchLimit): Promise<SpotifySearchResult> {
  const token = await getSpotifyAccessToken();
  if (!token) throw new Error('Spotify credentials are not configured.');
  const q = query.trim().slice(0, 120);
  if (!q) throw new Error('Search query is required.');
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const json = (await spotifyGet(
    `/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=${safeLimit}`,
  )) as {
    tracks?: { items?: Array<Record<string, unknown>> };
    artists?: { items?: Array<Record<string, unknown>> };
    albums?: { items?: Array<Record<string, unknown>> };
    playlists?: { items?: Array<Record<string, unknown>> };
  };

  const keep = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  return {
    tracks: (json.tracks?.items ?? []).filter(keep).map((track) => {
      const artists = Array.isArray(track.artists)
        ? track.artists.filter(keep).map((artist) => String(artist.name ?? '')).filter(Boolean)
        : [];
      const album = (typeof track.album === 'object' && track.album !== null ? track.album : undefined) as
        | { name?: string; images?: unknown }
        | undefined;
      const externalIds = (typeof track.external_ids === 'object' && track.external_ids !== null ? track.external_ids : undefined) as
        | { isrc?: string }
        | undefined;
      return {
        id: String(track.id ?? ''),
        title: String(track.name ?? ''),
        artist: artists.join(', '),
        album: typeof album?.name === 'string' ? album.name : null,
        duration: typeof track.duration_ms === 'number' ? track.duration_ms / 1000 : null,
        artworkUrl: imageUrl(album?.images),
        sourceUrl: typeof track.href === 'string' ? track.href : null,
        isrc: typeof externalIds?.isrc === 'string' ? externalIds.isrc : null,
      };
    }),
    artists: (json.artists?.items ?? []).filter(keep).map((artist) => ({
      id: String(artist.id ?? ''),
      name: String(artist.name ?? ''),
      imageUrl: imageUrl(artist.images),
      sourceUrl: typeof artist.href === 'string' ? artist.href : null,
    })),
    albums: (json.albums?.items ?? []).filter(keep).map((album) => {
      const artists = Array.isArray(album.artists)
        ? album.artists.filter(keep).map((artist) => String(artist.name ?? '')).filter(Boolean)
        : [];
      return {
        id: String(album.id ?? ''),
        name: String(album.name ?? ''),
        artist: artists.join(', '),
        imageUrl: imageUrl(album.images),
        sourceUrl: typeof album.href === 'string' ? album.href : null,
        releaseDate: typeof album.release_date === 'string' ? album.release_date : null,
      };
    }),
    playlists: (json.playlists?.items ?? []).filter(keep).map((playlist) => {
      const owner = (typeof playlist.owner === 'object' && playlist.owner !== null ? playlist.owner : undefined) as
        | { display_name?: string; id?: string }
        | undefined;
      const tracks = (typeof playlist.tracks === 'object' && playlist.tracks !== null ? playlist.tracks : undefined) as
        | { total?: number }
        | undefined;
      return {
        id: String(playlist.id ?? ''),
        name: String(playlist.name ?? ''),
        description: typeof playlist.description === 'string' ? playlist.description : null,
        imageUrl: imageUrl(playlist.images),
        sourceUrl: typeof playlist.href === 'string' ? playlist.href : null,
        owner: owner?.display_name ?? owner?.id ?? null,
        trackCount: typeof tracks?.total === 'number' ? tracks.total : null,
      };
    }),
  };
}

export async function getSpotifyPlaylist(id: string): Promise<SpotifyPlaylist> {
  const token = await getSpotifyAccessToken();
  if (!token) throw new Error('Spotify credentials are not configured.');
  if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error('Invalid Spotify playlist ID.');

  const trackFields = 'items(track(id,name,artists(name),album(name,images),duration_ms,external_ids(isrc),href)),total';
  const fields = `name,description,images,owner(display_name,id),tracks.total,tracks(${trackFields})`;
  const json = (await spotifyGet(
    `/playlists/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`,
  )) as {
    name?: string;
    description?: string;
    images?: unknown;
    owner?: { display_name?: string; id?: string };
    tracks?: {
      total?: number;
      items?: Array<{ track?: Record<string, unknown> | null }>;
    };
  };

  const items: SpotifyItem[] = [];
  let totalDuration = 0;

  const append = (entries: Array<{ track?: Record<string, unknown> | null }> | undefined) => {
    for (const entry of entries ?? []) {
      const track = entry.track;
      if (!track) continue;
      const artists = Array.isArray(track.artists)
        ? track.artists.map((artist) => String((artist as { name?: string }).name ?? '')).filter(Boolean)
        : [];
      const artist = artists.join(', ') || 'Unknown';
      const title = String(track.name ?? '').trim();
      if (!title) continue;
      const album = track.album as { name?: string; images?: unknown } | undefined;
      const durationMs = typeof track.duration_ms === 'number' ? track.duration_ms : null;
      if (durationMs !== null) totalDuration += durationMs;
      const externalIds = track.external_ids as { isrc?: string } | undefined;
      const providerTrackId = typeof track.id === 'string' && track.id ? track.id : externalIds?.isrc ?? null;
      items.push({
        title,
        artist,
        youtubeQuery: `${artist} ${title}`.trim(),
        providerTrackId,
        duration: durationMs !== null ? durationMs / 1000 : null,
        artworkUrl: imageUrl(album?.images),
        sourceUrl: typeof track.href === 'string' ? track.href : null,
        album: typeof album?.name === 'string' ? album.name : null,
      });
    }
  };

  append(json.tracks?.items);

  // Spotify returns at most 100 entries per page. A playlist can hold up to
  // 10,000, so page until the provider is exhausted (bounded by our own cap).
  const declaredTotal = typeof json.tracks?.total === 'number' ? json.tracks.total : items.length;
  const hardCap = Math.min(config.maxPlaylistTracks, 10_000);
  let offset = items.length;
  let guard = 0;
  while (offset < declaredTotal && offset < hardCap && guard < 120) {
    guard += 1;
    let page: { items?: Array<{ track?: Record<string, unknown> | null }> };
    try {
      page = (await spotifyGet(
        `/playlists/${encodeURIComponent(id)}/tracks?offset=${offset}&limit=100&fields=${encodeURIComponent(trackFields)}`,
      )) as { items?: Array<{ track?: Record<string, unknown> | null }> };
    } catch {
      break;
    }
    const batch = page.items ?? [];
    if (batch.length === 0) break;
    append(batch);
    offset += batch.length;
  }

  return {
    type: 'playlist',
    title: String(json.name ?? 'Spotify playlist'),
    description: typeof json.description === 'string' ? json.description : null,
    artworkUrl: imageUrl(json.images),
    creator: json.owner?.display_name ?? json.owner?.id ?? null,
    totalDuration: totalDuration > 0 ? totalDuration / 1000 : null,
    totalTracks: typeof json.tracks?.total === 'number' ? json.tracks.total : items.length,
    items: items.slice(0, hardCap),
    truncated: items.length < (json.tracks?.total ?? items.length),
  };
}

export { errorMessage };
