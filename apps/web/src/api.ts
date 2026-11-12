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
  UserSearchResult,
  FriendUser,
  FriendListPage,
  FriendRequestPage,
  FriendCounts,
  FriendNotification,
  Relationship,
  FriendPresence,
  ConversationPage,
  ConversationDetail,
  Message,
  MessageAttachment,
  TasteOverview,
  TasteComparison,
  TasteFriendEntry,
  TasteDiscoveryEntry,
  TasteIdentity,
  RoomDetail,
  RoomState,
  RoomSummary,
  RoomMember,
  RoomChatMessage,
  RoomTrack,
  QuizAttempt,
  QuizCategory,
  QuizGuessResponse,
  QuizHistoryEntry,
  QuizLeaderboardRow,
  QuizPartyState,
  QuizStats,
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
    request<{ profile: PublicProfile; playlists: PlaylistSummary[]; relationship: Relationship }>(
      `/api/profiles/${encodeURIComponent(id)}`,
    ),
  publicProfileByUsername: (username: string) =>
    request<{ profile: PublicProfile; playlists: PlaylistSummary[]; relationship: Relationship }>(
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
  removeExternalTrack: (playlistId: string, entryId: number) =>
    request<{ ok: boolean }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/external/${entryId}`,
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
  trackArtwork: (items: Array<{ key: string; title: string; artist?: string }>) =>
    request<{ artworks: Record<string, string | null> }>('/api/media/artwork', {
      method: 'POST',
      body: { items },
    }),
  searchUsers: (q: string) =>
    request<{ users: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),
  presenceFriends: () =>
    request<{ friends: Array<{ user: FriendUser; presence: FriendPresence }>; at: string }>('/api/presence/friends'),
  presenceUser: (userId: string) =>
    request<{ presence: FriendPresence }>(`/api/presence/user/${encodeURIComponent(userId)}`),
  presenceHeartbeat: (sessionId: string, away: boolean) =>
    request<{ ok: boolean; status: string }>('/api/presence/heartbeat', {
      method: 'POST',
      body: { sessionId, away },
    }),
  presenceActivity: (
    sessionId: string,
    activity: {
      trackId: string | null;
      title: string;
      artist: string;
      album: string | null;
      coverUrl: string | null;
      source: string | null;
      duration: number | null;
      position: number;
      playing: boolean;
    } | null,
  ) =>
    request<{ ok: boolean }>('/api/presence/activity', { method: 'POST', body: { sessionId, activity } }),
  presenceOffline: (sessionId: string) =>
    request<{ ok: boolean }>('/api/presence/offline', { method: 'POST', body: { sessionId } }),
  conversations: (params: { limit?: number; offset?: number; q?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    if (params.q) query.set('q', params.q);
    const suffix = query.toString();
    return request<ConversationPage>(`/api/messages/conversations${suffix ? `?${suffix}` : ''}`);
  },
  openConversation: (userId: string) =>
    request<{ conversationId: string; created: boolean }>('/api/messages/conversations', {
      method: 'POST',
      body: { userId },
    }),
  conversation: (conversationId: string, before?: string | null, limit = 40) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', before);
    return request<ConversationDetail>(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}?${query.toString()}`,
    );
  },
  sendMessage: (
    conversationId: string,
    payload: { body?: string; clientId?: string; attachment?: MessageAttachment | null },
  ) =>
    request<{ message: Message; duplicate: boolean }>(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'POST', body: payload },
    ),
  editMessage: (conversationId: string, messageId: string, body: string) =>
    request<{ message: Message }>(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}`,
      { method: 'PATCH', body: { body } },
    ),
  deleteMessage: (conversationId: string, messageId: string) =>
    request<{ message: Message }>(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    ),
  markConversationRead: (conversationId: string, messageId?: string | null) =>
    request<{ ok: boolean; unreadTotal: number }>(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/read`,
      { method: 'POST', body: messageId ? { messageId } : {} },
    ),
  sendTyping: (conversationId: string, typing: boolean) =>
    request<{ ok: boolean }>(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/typing`,
      { method: 'POST', body: { typing } },
    ),
  messagesUnread: () => request<{ unreadTotal: number }>('/api/messages/unread'),
  tasteMe: () => request<TasteOverview>('/api/taste/me'),
  tasteFriends: (limit = 20, offset = 0) =>
    request<{ items: TasteFriendEntry[]; total: number; limit: number; offset: number }>(
      `/api/taste/friends?limit=${limit}&offset=${offset}`,
    ),
  tasteCompare: (userId: string) =>
    request<{
      viewer: TasteIdentity | null;
      target: TasteIdentity | null;
      relationship: 'self' | 'friend';
      comparison: TasteComparison;
    }>(`/api/taste/compare/${encodeURIComponent(userId)}`),
  tasteDiscover: (limit = 12, offset = 0) =>
    request<{
      optedIn: boolean;
      items: TasteDiscoveryEntry[];
      total: number;
      limit: number;
      offset: number;
    }>(`/api/taste/discover?limit=${limit}&offset=${offset}`),
  tasteLike: (userId: string) =>
    request<{ ok: boolean; mutual: boolean }>(`/api/taste/discover/${encodeURIComponent(userId)}/like`, {
      method: 'POST',
      body: {},
    }),
  tasteLeaveDiscovery: () =>
    request<{ ok: boolean }>('/api/taste/discover', { method: 'DELETE' }),
  rooms: () =>
    request<{ publicRooms: RoomSummary[]; mine: RoomSummary[]; invites: RoomSummary[] }>('/api/rooms'),
  createRoom: (payload: { name: string; visibility: 'public' | 'private'; queueMode: 'owner' | 'collab' }) =>
    request<{ roomId: string; room: RoomSummary | null }>('/api/rooms', { method: 'POST', body: payload }),
  room: (roomId: string) => request<RoomDetail>(`/api/rooms/${encodeURIComponent(roomId)}`),
  updateRoom: (
    roomId: string,
    payload: { name?: string; visibility?: 'public' | 'private'; queueMode?: 'owner' | 'collab' },
  ) =>
    request<{ room: RoomSummary }>(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: 'PATCH',
      body: payload,
    }),
  closeRoom: (roomId: string) =>
    request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' }),
  joinRoom: (roomId: string, code?: string | null) =>
    request<{ ok: boolean; alreadyMember: boolean; state: RoomState | null; serverNow: string }>(
      `/api/rooms/${encodeURIComponent(roomId)}/join`,
      { method: 'POST', body: code ? { code } : {} },
    ),
  leaveRoom: (roomId: string) =>
    request<{ ok: boolean; closed: boolean; newOwnerId: string | null }>(
      `/api/rooms/${encodeURIComponent(roomId)}/leave`,
      { method: 'POST', body: {} },
    ),
  inviteToRoom: (roomId: string, userId: string) =>
    request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}/invite`, {
      method: 'POST',
      body: { userId },
    }),
  roomInvitable: (roomId: string) =>
    request<{ friends: Array<{ id: string; displayName: string; username: string | null; avatarUrl: string | null }> }>(
      `/api/rooms/${encodeURIComponent(roomId)}/invitable`,
    ),
  roomPlayback: (
    roomId: string,
    payload: { action: 'play' | 'pause' | 'seek' | 'next' | 'play-track'; position?: number; track?: RoomTrack },
  ) =>
    request<{ state: RoomState; serverNow: string }>(`/api/rooms/${encodeURIComponent(roomId)}/playback`, {
      method: 'POST',
      body: payload,
    }),
  roomQueueAdd: (roomId: string, track: RoomTrack) =>
    request<{ state: RoomState; atFront: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}/queue`, {
      method: 'POST',
      body: { track },
    }),
  roomQueueRemove: (roomId: string, index: number) =>
    request<{ state: RoomState }>(`/api/rooms/${encodeURIComponent(roomId)}/queue/${index}`, { method: 'DELETE' }),
  roomQueueReorder: (roomId: string, from: number, to: number) =>
    request<{ state: RoomState }>(`/api/rooms/${encodeURIComponent(roomId)}/queue/reorder`, {
      method: 'POST',
      body: { from, to },
    }),
  roomSetRole: (roomId: string, userId: string, role: 'moderator' | 'listener') =>
    request<{ ok: boolean; members: RoomMember[] }>(
      `/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/role`,
      { method: 'POST', body: { role } },
    ),
  roomKick: (roomId: string, userId: string) =>
    request<{ ok: boolean; members: RoomMember[] }>(
      `/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/kick`,
      { method: 'POST', body: {} },
    ),
  roomMessages: (roomId: string, before?: string | null, limit = 40) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', before);
    return request<{ messages: RoomChatMessage[] }>(
      `/api/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`,
    );
  },
  roomSendMessage: (roomId: string, body: string) =>
    request<{ message: RoomChatMessage }>(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: 'POST',
      body: { body },
    }),
  roomDeleteMessage: (roomId: string, messageId: string) =>
    request<{ message: RoomChatMessage }>(
      `/api/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    ),
  quizPool: () =>
    request<{ size: number; turkish: number; international: number; previewStages: number[]; previewAvailable: boolean }>(
      '/api/quiz/pool',
    ),
  quizDaily: (category: QuizCategory) => request<QuizAttempt>(`/api/quiz/daily?category=${category}`),
  quizHistory: () =>
    request<{ items: QuizHistoryEntry[]; stats: QuizStats }>('/api/quiz/daily/history'),
  quizPractice: (category: QuizCategory, fresh = false) =>
    request<QuizAttempt>(`/api/quiz/practice?category=${category}${fresh ? '&fresh=1' : ''}`),
  quizGuess: (attemptId: string, guess: string) =>
    request<QuizGuessResponse>('/api/quiz/guess', { method: 'POST', body: { attemptId, guess } }),
  quizSkip: (attemptId: string) =>
    request<QuizGuessResponse>('/api/quiz/skip', { method: 'POST', body: { attemptId } }),
  quizSuggest: (q: string) =>
    request<{ suggestions: string[] }>(`/api/quiz/suggest?q=${encodeURIComponent(q)}`),
  quizLeaderboard: (range: 'daily' | 'weekly' | 'monthly' | 'all' | 'friends') =>
    request<{ range: string; rows: QuizLeaderboardRow[] }>(`/api/quiz/leaderboard?range=${range}`),
  quizStats: (userId: string) =>
    request<{ userId: string; stats: QuizStats }>(`/api/quiz/stats/${encodeURIComponent(userId)}`),
  quizParties: () =>
    request<{
      invites: Array<{ id: string; hostId: string; category: string; code: string }>;
      current: { id: string; hostId: string; status: string; roundNo: number } | null;
    }>('/api/quiz/parties'),
  quizCreateParty: (category: QuizCategory) =>
    request<{ id: string; code: string }>('/api/quiz/parties', { method: 'POST', body: { category } }),
  quizJoinParty: (partyId: string, code?: string | null) =>
    request<{ ok: boolean }>(`/api/quiz/parties/${encodeURIComponent(partyId)}/join`, {
      method: 'POST',
      body: code ? { code } : {},
    }),
  quizJoinPartyByCode: (code: string) =>
    request<{ id: string }>('/api/quiz/parties/join', { method: 'POST', body: { code } }),
  quizParty: (partyId: string) =>
    request<{ state: QuizPartyState; rounds: number; serverNow: string }>(
      `/api/quiz/parties/${encodeURIComponent(partyId)}`,
    ),
  quizInviteParty: (partyId: string, userId: string) =>
    request<{ ok: boolean }>(`/api/quiz/parties/${encodeURIComponent(partyId)}/invite`, {
      method: 'POST',
      body: { userId },
    }),
  quizStartPartyRound: (partyId: string) =>
    request<{ ok: boolean; roundNo: number }>(`/api/quiz/parties/${encodeURIComponent(partyId)}/start`, {
      method: 'POST',
      body: {},
    }),
  quizNextPartyRound: (partyId: string) =>
    request<{ ok: boolean; roundNo: number }>(`/api/quiz/parties/${encodeURIComponent(partyId)}/next`, {
      method: 'POST',
      body: {},
    }),
  quizPartyPreview: (partyId: string) =>
    request<{ url: string; duration: number }>(`/api/quiz/parties/${encodeURIComponent(partyId)}/preview`),
  quizPartyAnswer: (partyId: string, guess: string) =>
    request<
      | { ok: true; kind: 'correct'; points: number; answered: number }
      | { ok: true; kind: 'wrong' | 'ambiguous' | 'invalid'; message?: string; answered: number }
    >(`/api/quiz/parties/${encodeURIComponent(partyId)}/answer`, { method: 'POST', body: { guess } }),
  friends: (limit = 20, offset = 0) =>
    request<{ friends: FriendListPage; counts: FriendCounts }>(`/api/friends?limit=${limit}&offset=${offset}`),
  friendRequests: (direction: 'in' | 'out', limit = 20, offset = 0) =>
    request<{ direction: 'in' | 'out'; requests: FriendRequestPage; counts: FriendCounts }>(
      `/api/friends/requests?direction=${direction}&limit=${limit}&offset=${offset}`,
    ),
  friendshipStatus: (userId: string) =>
    request<{ relationship: Relationship }>(`/api/friends/status/${encodeURIComponent(userId)}`),
  sendFriendRequest: (userId: string) =>
    request<{ relationship: Relationship; counts: FriendCounts }>('/api/friends/requests', {
      method: 'POST',
      body: { userId },
    }),
  acceptFriendRequest: (requestId: number) =>
    request<{ ok: boolean; counts: FriendCounts }>(`/api/friends/requests/${requestId}/accept`, { method: 'POST' }),
  declineFriendRequest: (requestId: number) =>
    request<{ ok: boolean; counts: FriendCounts }>(`/api/friends/requests/${requestId}/decline`, { method: 'POST' }),
  cancelFriendRequest: (requestId: number) =>
    request<{ ok: boolean; counts: FriendCounts }>(`/api/friends/requests/${requestId}`, { method: 'DELETE' }),
  removeFriend: (userId: string) =>
    request<{ ok: boolean; counts: FriendCounts }>(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  blockUser: (userId: string) =>
    request<{ ok: boolean; relationship: Relationship }>('/api/blocks', { method: 'POST', body: { userId } }),
  unblockUser: (userId: string) =>
    request<{ ok: boolean; relationship: Relationship }>(`/api/blocks/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  blockedUsers: () => request<{ blocked: FriendUser[] }>('/api/blocks'),
  notifications: (limit = 30, offset = 0) =>
    request<{ items: FriendNotification[]; total: number; unread: number }>(
      `/api/notifications?limit=${limit}&offset=${offset}`,
    ),
  markNotificationsRead: (ids?: number[]) =>
    request<{ ok: boolean }>('/api/notifications/read', { method: 'POST', body: { ids } }),
};
