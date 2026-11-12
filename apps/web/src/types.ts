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

export type UserSearchResult = {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
};

export type FriendshipState = 'none' | 'self' | 'pending_out' | 'pending_in' | 'friends' | 'blocked';

export type Relationship = {
  state: FriendshipState;
  requestId: number | null;
  blockedByMe: boolean;
  blockedMe: boolean;
};

export type FriendUser = UserSearchResult;

export type FriendRequestEntry = {
  friendshipId: number;
  user: FriendUser;
  createdAt: string;
};

export type FriendListPage = {
  items: FriendUser[];
  total: number;
  limit: number;
  offset: number;
};

export type FriendRequestPage = {
  items: FriendRequestEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type FriendCounts = { friends: number; incoming: number; outgoing: number };

export type FriendNotification = {
  id: number;
  kind: string;
  actorId: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
  actor: FriendUser | null;
};

export type PresenceStatus = 'online' | 'away' | 'offline';

export type ListeningActivity = {
  trackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  source: string | null;
  duration: number | null;
  position: number;
  playing: boolean;
  updatedAt: string;
};

export type FriendPresence = {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
  activity: ListeningActivity | null;
};

export type PresenceEvent =
  | { type: 'presence'; userId: string; status: PresenceStatus; lastSeenAt: string | null; at: string }
  | { type: 'activity'; userId: string; activity: ListeningActivity | null; at: string };

export type MessageAttachment = {
  kind: 'track' | 'playlist' | 'profile';
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  trackId?: string | null;
  playlistId?: string | null;
  userId?: string | null;
  source?: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachment: MessageAttachment | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientId: string | null;
};

export type ConversationPeer = {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type ConversationSummary = {
  id: string;
  peer: ConversationPeer;
  lastMessage: { id: string; body: string; senderId: string; createdAt: string; deleted: boolean } | null;
  lastMessageAt: string;
  unread: number;
};

export type ConversationPage = {
  items: ConversationSummary[];
  total: number;
  limit: number;
  offset: number;
  unreadTotal: number;
};

export type ConversationDetail = {
  conversation: {
    id: string;
    peer: ConversationPeer | null;
    canSend: boolean;
    reason: string | null;
    lastMessageAt: string;
  };
  messages: Message[];
  hasMore: boolean;
  peerReadAt: string | null;
};

export type RealtimeEvent =
  | PresenceEvent
  | { type: 'message'; conversationId: string; message: Message; at: string }
  | { type: 'message_update'; conversationId: string; message: Message; at: string }
  | { type: 'typing'; conversationId: string; userId: string; typing: boolean; at: string }
  | { type: 'read'; conversationId: string; userId: string; messageId: string | null; at: string }
  | { type: 'room_state'; roomId: string; state: RoomState; at: string }
  | { type: 'room_members'; roomId: string; members: RoomMember[]; at: string }
  | { type: 'room_chat'; roomId: string; message: RoomChatMessage; at: string }
  | { type: 'room_invite'; room: RoomSummary; at: string }
  | { type: 'room_closed'; roomId: string; reason: string; at: string }
  | {
      type: 'quiz_party';
      partyId: string;
      event: string;
      at: string;
      roundNo?: number;
      endsAt?: string;
      userId?: string;
      result?: { title: string; artist: string; coverUrl: string | null } | null;
      podium?: unknown;
    }
  | { type: 'community_message'; message: CommunityMessage; at: string }
  | { type: 'community_message_update'; message: CommunityMessage; at: string }
  | { type: 'community_member_update'; userId: string; role: CommunityRole; at: string }
  | { type: 'community_moderation'; action: string; targetUserId: string | null; at: string }
  | {
      type: 'friendship';
      event: 'request' | 'accepted' | 'declined' | 'cancelled' | 'removed' | 'blocked' | 'unblocked';
      userId: string;
      peerId: string;
      at: string;
    }
  | { type: 'notification'; unread: number; kind: string | null; at: string };

export type RoomTrack = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  source: string | null;
  duration: number | null;
};

export type RoomQueueItem = {
  track: RoomTrack;
  addedBy: string | null;
  addedByName: string | null;
};

export type RoomState = {
  current: RoomQueueItem | null;
  queue: RoomQueueItem[];
  position: number;
  playing: boolean;
  revision: number;
  updatedAt: string;
};

export type RoomRole = 'owner' | 'moderator' | 'listener';

export type RoomMember = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  role: RoomRole;
  joinedAt: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  queueMode: 'owner' | 'collab';
  ownerId: string;
  ownerName: string;
  memberCount: number;
  nowPlaying: { title: string; artist: string; coverUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
  invited?: boolean;
};

export type RoomChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
};

export type RoomDetail = {
  room: RoomSummary;
  state: RoomState;
  serverNow: string;
  members: RoomMember[];
  role: RoomRole;
  canControl: boolean;
  canEditQueue: boolean;
  joinCode?: string | null;
};

export type QuizCategory = 'tr' | 'intl' | 'mixed';

export type QuizResult = {
  title: string;
  artist: string;
  coverUrl: string | null;
};

export type QuizAttempt = {
  attemptId: string;
  mode: 'daily' | 'practice';
  category: QuizCategory;
  stage: number;
  stageCount: number;
  guesses: number;
  attemptsLeft: number;
  possiblePoints: number;
  previewDuration: number;
  previewUrl: string | null;
  status: 'active' | 'won' | 'lost';
  score: number;
  startedAt: string;
  result: QuizResult | null;
  day?: string;
  resetsAt?: string;
  timezone?: string;
};

export type QuizGuessResponse =
  | { ok: true; kind: 'correct'; points: number; view: QuizAttempt }
  | { ok: true; kind: 'wrong'; view: QuizAttempt }
  | { ok: true; kind: 'ambiguous' | 'invalid'; message: string; view: QuizAttempt };

export type QuizLeaderboardRow = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  points: number;
  correct: number;
  averagePreviewSeconds: number | null;
  streak: number;
  rank: number;
};

export type QuizStats = {
  totalCorrect: number;
  totalPoints: number;
  averagePreviewSeconds: number | null;
  currentStreak: number;
  bestStreak: number;
  dailyPlayed: number;
  achievements: Array<{ key: string; unlocked: boolean }>;
};

export type QuizHistoryEntry = {
  day: string;
  category: string;
  score: number;
  correct: boolean;
  previewSeconds: number | null;
  title: string;
  artist: string;
};

export type QuizPartyMember = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  score: number;
};

export type QuizPartyState = {
  id: string;
  hostId: string;
  category: QuizCategory;
  status: 'open' | 'playing' | 'finished';
  roundNo: number;
  roundStartedAt: string | null;
  roundEndsAt: string | null;
  members: QuizPartyMember[];
  reveal: (QuizResult & { roundNo: number }) | null;
  yourAnswers: number;
  yourScore: number;
  code: string;
  finished: boolean;
};

export type CommunityRole = 'owner' | 'moderator' | 'member';

export type CommunityAuthor = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  role: CommunityRole;
};

export type CommunityMessage = {
  id: string;
  userId: string;
  body: string;
  attachment: MessageAttachment | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientId: string | null;
  author: CommunityAuthor | null;
};

export type CommunityMember = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  role: CommunityRole;
  joinedAt: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
  activity: ListeningActivity | null;
  mutedUntil: string | null;
  suspendedUntil: string | null;
};

export type CommunityMe = {
  name: string;
  role: CommunityRole;
  canModerate: boolean;
  canManage: boolean;
  restrictions: {
    mutedUntil: string | null;
    suspendedUntil: string | null;
    suspensionReason: string | null;
    canPost: boolean;
    reason: 'muted' | 'suspended' | null;
  };
  settings: { slowModeSeconds: number; maxMessageLength: number };
  memberCount: number;
};

export type CommunityModerationEntry = {
  id: number;
  actorId: string;
  targetUserId: string | null;
  action: string;
  reason: string | null;
  messageId: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type CommunityReport = {
  id: number;
  reporterId: string;
  reporterName: string;
  messageId: string | null;
  targetUserId: string | null;
  targetName: string;
  reason: string;
  status: string;
  createdAt: string;
};

export type DiscoveryItem = {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number | null;
  url: string;
  reason: string;
};

export type DiscoverySectionKey =
  | 'madeForYou'
  | 'becauseYouListened'
  | 'discoverSomethingNew'
  | 'hiddenGems'
  | 'randomDiscovery';

export type DiscoverySection = {
  key: DiscoverySectionKey;
  items: DiscoveryItem[];
  seed?: { title: string; artist: string };
  artists?: string[];
};

export type DiscoveryPayload = {
  generatedAt: string;
  personalized: boolean;
  degraded: boolean;
  sections: DiscoverySection[];
};

export type TasteTag = { name: string; plays: number };

export type TasteTrackSummary = {
  key: string;
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  plays: number;
};

export type TasteSettings = {
  compareFriends: boolean;
  comparePublic: boolean;
  discoverable: boolean;
  anonymous: boolean;
  showShared: boolean;
};

export type TasteOverview = {
  profile: {
    userId: string;
    plays: number;
    totalMs: number;
    lastPlayedAt: string | null;
    eligible: boolean;
    reason: 'insufficient_history' | null;
    artists: TasteTag[];
    tracks: TasteTrackSummary[];
    genres: TasteTag[];
    languages: TasteTag[];
  };
  settings: TasteSettings;
};

export type TasteDimension = {
  key: 'artists' | 'tracks' | 'genres' | 'frequency';
  weight: number;
  score: number;
};

export type TasteIdentity = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  profileVisibility: 'public' | 'private';
};

export type TasteComparison = {
  viewerId: string;
  targetId: string;
  score: number | null;
  eligible: boolean;
  reason: 'insufficient_history' | 'no_dimensions' | null;
  insufficient: { viewer: boolean; target: boolean };
  dimensions: TasteDimension[];
  sharedArtists: Array<TasteTag & { otherPlays: number }>;
  sharedTracks: Array<TasteTrackSummary & { otherPlays: number }>;
  sharedGenres: Array<TasteTag & { otherPlays: number }>;
  sharedLanguages: Array<TasteTag & { otherPlays: number }>;
  onlyViewer: { artists: TasteTag[]; genres: TasteTag[] };
  onlyTarget: { artists: TasteTag[]; genres: TasteTag[] };
  sharedHidden: boolean;
};

export type TasteFriendEntry = {
  user: TasteIdentity | null;
  score: number | null;
  eligible: boolean;
  reason: string | null;
  sharedArtists: number;
  sharedTracks: number;
  sharedGenres: number;
};

export type TasteDiscoveryEntry = {
  matchId: string;
  score: number;
  sharedArtists: number;
  sharedGenres: number;
  anonymous: boolean;
  liked: boolean;
  mutual: boolean;
  user: { id: string; displayName: string; username: string | null; avatarUrl: string | null } | null;
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
  /** Bytes received so far, and the expected total when the server sent one. */
  received?: number;
  total?: number;
};

export type AdminStats = {
  totalUsers: number;
  onlineNow: number;
  activeToday: number;
  newLast7d: number;
  users: Array<User & { lastIp: string; userAgent: string; online: boolean }>;
};
