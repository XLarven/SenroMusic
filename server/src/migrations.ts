import type { Database } from 'better-sqlite3';

type Migration = {
  id: number;
  name: string;
  up: (db: Database) => void;
};

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function addColumn(db: Database, table: string, definition: string): void {
  const column = definition.split(/\s+/)[0] ?? '';
  if (!column || hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

const migrations: Migration[] = [
  {
    id: 1,
    name: 'user-owned playlists, favorites, history, settings, profile fields',
    up(db) {
      // Playlists become per-user. Legacy rows keep owner_id NULL: visible to every
      // authenticated user (pre-isolation behavior preserved), mutable by admins only.
      addColumn(db, 'playlists', 'owner_id TEXT REFERENCES users(id)');
      addColumn(db, 'playlists', "visibility TEXT NOT NULL DEFAULT 'private'");
      addColumn(db, 'playlists', 'pinned INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'playlists', 'share_slug TEXT');
      addColumn(db, 'playlists', 'cover_id TEXT');
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_share
         ON playlists(share_slug) WHERE share_slug IS NOT NULL`,
      );
      db.exec(`CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists(owner_id)`);

      // Profile fields.
      addColumn(db, 'users', "bio TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'users', 'avatar_url TEXT');
      addColumn(db, 'users', 'banner_url TEXT');
      addColumn(db, 'users', "profile_visibility TEXT NOT NULL DEFAULT 'public'");
      addColumn(db, 'users', 'username TEXT');
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
         ON users(username) WHERE username IS NOT NULL`,
      );

      db.exec(`
        CREATE TABLE IF NOT EXISTS favorites (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, track_id)
        );
        CREATE INDEX IF NOT EXISTS idx_favorites_track ON favorites(track_id);

        CREATE TABLE IF NOT EXISTS listening_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
          played_at TEXT NOT NULL,
          ms_played INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'player'
        );
        CREATE INDEX IF NOT EXISTS idx_history_user_time
          ON listening_history(user_id, played_at DESC);

        CREATE TABLE IF NOT EXISTS user_settings (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (user_id, key)
        );
      `);

      // Preserve legacy shared playlists: hand them to the earliest account so no
      // row is lost. Only runs when ownerless rows exist (pre-isolation data).
      db.exec(`
        UPDATE playlists
        SET owner_id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
        WHERE owner_id IS NULL
          AND EXISTS (SELECT 1 FROM users)
      `);
    },
  },
  {
    id: 2,
    name: 'playlist cover URL, favorite genres, artist follows',
    up(db) {
      addColumn(db, 'playlists', 'cover_url TEXT');
      addColumn(db, 'users', 'favorite_genres TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS artist_follows (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          artist_id TEXT NOT NULL,
          artist_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, artist_id)
        );
        CREATE INDEX IF NOT EXISTS idx_artist_follows_name
          ON artist_follows(user_id, artist_name);
      `);
    },
  },
  {
    id: 3,
    name: 'preserve imported external playlist tracks and source metadata',
    up(db) {
      addColumn(db, 'playlists', 'source_provider TEXT');
      addColumn(db, 'playlists', 'source_url TEXT');
      addColumn(db, 'playlists', 'source_playlist_id TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS playlist_external_tracks (
          entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
          playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          provider_track_id TEXT,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT,
          duration REAL,
          artwork_url TEXT,
          source_url TEXT,
          position INTEGER NOT NULL,
          matched_track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_external_tracks_playlist
          ON playlist_external_tracks(playlist_id, position);
        CREATE INDEX IF NOT EXISTS idx_external_tracks_provider
          ON playlist_external_tracks(provider, provider_track_id);
      `);
    },
  },
  {
    id: 4,
    name: 'account synchronized search history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_search_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          query TEXT NOT NULL,
          searched_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_search_history_user_time
          ON user_search_history(user_id, searched_at DESC);
        CREATE INDEX IF NOT EXISTS idx_search_history_user_query
          ON user_search_history(user_id, query);
      `);
    },
  },
  {
    id: 5,
    name: 'friend requests, friendships, blocks and notifications',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS friendships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pair_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (requester_id <> addressee_id),
          CHECK (status IN ('pending', 'accepted')),
          UNIQUE (pair_key)
        );
        CREATE INDEX IF NOT EXISTS idx_friendships_requester
          ON friendships(requester_id, status);
        CREATE INDEX IF NOT EXISTS idx_friendships_addressee
          ON friendships(addressee_id, status);

        CREATE TABLE IF NOT EXISTS user_blocks (
          blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (blocker_id, blocked_id),
          CHECK (blocker_id <> blocked_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
          ON user_blocks(blocked_id);

        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          entity_id TEXT,
          dedupe_key TEXT,
          read_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user_time
          ON notifications(user_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
          ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
      `);
    },
  },
  {
    id: 6,
    name: 'presence and listening activity',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_presence (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'offline',
          last_seen_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_activity (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          track_id TEXT,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT,
          cover_url TEXT,
          source TEXT,
          duration REAL,
          position REAL NOT NULL DEFAULT 0,
          playing INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_user_activity_updated
          ON user_activity(updated_at DESC);
      `);
    },
  },
  {
    id: 7,
    name: 'direct messages',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pair_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_message_at TEXT NOT NULL,
          CHECK (user_a <> user_b)
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_a
          ON conversations(user_a, last_message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_conversations_b
          ON conversations(user_b, last_message_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          client_id TEXT,
          attachment_json TEXT,
          created_at TEXT NOT NULL,
          edited_at TEXT,
          deleted_at TEXT,
          UNIQUE (conversation_id, client_id)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation
          ON messages(conversation_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS conversation_reads (
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          last_read_message_id TEXT,
          last_read_at TEXT NOT NULL,
          PRIMARY KEY (conversation_id, user_id)
        );
      `);
    },
  },
  {
    id: 8,
    name: 'taste matching',
    up(db) {
      // Only filled when a scanner finds a reliable tag; absent means "unknown",
      // never "mismatch".
      addColumn(db, 'tracks', 'language TEXT');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_history_user_track
          ON listening_history(user_id, track_id);

        CREATE TABLE IF NOT EXISTS taste_interests (
          viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          revealed_at TEXT,
          PRIMARY KEY (viewer_id, target_id)
        );
      `);
    },
  },
  {
    id: 9,
    name: 'listening rooms',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS listening_rooms (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          visibility TEXT NOT NULL DEFAULT 'public',
          join_code TEXT,
          queue_mode TEXT NOT NULL DEFAULT 'owner',
          state_json TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          owner_seen_at TEXT NOT NULL,
          closed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rooms_public
          ON listening_rooms(visibility, closed_at, updated_at DESC);

        CREATE TABLE IF NOT EXISTS room_members (
          room_id TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'listener',
          joined_at TEXT NOT NULL,
          PRIMARY KEY (room_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

        CREATE TABLE IF NOT EXISTS room_invites (
          room_id TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          invited_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (room_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS room_messages (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          deleted_at TEXT,
          deleted_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_room_messages_room
          ON room_messages(room_id, created_at DESC);
      `);
    },
  },
  {
    id: 10,
    name: 'music quiz',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quiz_tracks (
          track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'intl',
          duration REAL NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          synced_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_quiz_tracks_lang ON quiz_tracks(language, active);

        CREATE TABLE IF NOT EXISTS quiz_challenges (
          id TEXT PRIMARY KEY,
          day TEXT NOT NULL,
          category TEXT NOT NULL,
          track_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (day, category)
        );

        CREATE TABLE IF NOT EXISTS quiz_attempts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          mode TEXT NOT NULL,
          category TEXT NOT NULL,
          challenge_id TEXT,
          party_id TEXT,
          track_id TEXT NOT NULL,
          preview_start REAL NOT NULL,
          stage INTEGER NOT NULL DEFAULT 0,
          guesses INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          score INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          UNIQUE (user_id, challenge_id)
        );
        CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS quiz_guesses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
          stage INTEGER NOT NULL,
          guess TEXT NOT NULL,
          normalized TEXT NOT NULL,
          correct INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quiz_daily_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          day TEXT NOT NULL,
          category TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          attempt_id TEXT NOT NULL UNIQUE REFERENCES quiz_attempts(id) ON DELETE CASCADE,
          score INTEGER NOT NULL DEFAULT 0,
          correct INTEGER NOT NULL DEFAULT 0,
          preview_seconds REAL,
          created_at TEXT NOT NULL,
          UNIQUE (user_id, day, category)
        );
        CREATE INDEX IF NOT EXISTS idx_quiz_results_day ON quiz_daily_results(day, score DESC);

        CREATE TABLE IF NOT EXISTS quiz_streaks (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          current INTEGER NOT NULL DEFAULT 0,
          best INTEGER NOT NULL DEFAULT 0,
          last_day TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quiz_parties (
          id TEXT PRIMARY KEY,
          host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          round_no INTEGER NOT NULL DEFAULT 0,
          round_started_at TEXT,
          round_ends_at TEXT,
          code TEXT NOT NULL,
          created_at TEXT NOT NULL,
          closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS quiz_party_members (
          party_id TEXT NOT NULL REFERENCES quiz_parties(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          score INTEGER NOT NULL DEFAULT 0,
          joined_at TEXT NOT NULL,
          PRIMARY KEY (party_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS quiz_party_rounds (
          party_id TEXT NOT NULL REFERENCES quiz_parties(id) ON DELETE CASCADE,
          round_no INTEGER NOT NULL,
          track_id TEXT NOT NULL,
          preview_start REAL NOT NULL,
          started_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          revealed_at TEXT,
          PRIMARY KEY (party_id, round_no)
        );

        CREATE TABLE IF NOT EXISTS quiz_party_answers (
          party_id TEXT NOT NULL,
          round_no INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          guess_no INTEGER NOT NULL,
          value TEXT NOT NULL,
          correct INTEGER NOT NULL DEFAULT 0,
          points INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY (party_id, round_no, user_id, guess_no)
        );

        CREATE TABLE IF NOT EXISTS quiz_party_invites (
          party_id TEXT NOT NULL REFERENCES quiz_parties(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          invited_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (party_id, user_id)
        );
      `);
    },
  },
  {
    id: 11,
    name: 'official community server',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS community_members (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'member',
          joined_at TEXT NOT NULL,
          muted_until TEXT,
          suspended_until TEXT,
          suspension_reason TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_community_members_role ON community_members(role);

        CREATE TABLE IF NOT EXISTS community_messages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          client_id TEXT,
          attachment_json TEXT,
          created_at TEXT NOT NULL,
          edited_at TEXT,
          deleted_at TEXT,
          deleted_by TEXT,
          UNIQUE (user_id, client_id)
        );
        CREATE INDEX IF NOT EXISTS idx_community_messages_time
          ON community_messages(created_at DESC);

        CREATE TABLE IF NOT EXISTS community_moderation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id TEXT NOT NULL,
          target_user_id TEXT,
          action TEXT NOT NULL,
          reason TEXT,
          message_id TEXT,
          created_at TEXT NOT NULL,
          expires_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_community_moderation_time
          ON community_moderation(created_at DESC);

        CREATE TABLE IF NOT EXISTS community_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reporter_id TEXT NOT NULL,
          message_id TEXT,
          target_user_id TEXT,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_community_reports_status
          ON community_reports(status, created_at DESC);

        CREATE TABLE IF NOT EXISTS community_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      // Every existing account joins the official community; the configured
      // administrator owns it. The first registered user is never assumed.
      const at = new Date().toISOString();
      db.prepare(
        `INSERT INTO community_members (user_id, role, joined_at, updated_at)
         SELECT id, 'member', ?, ? FROM users
         WHERE id NOT IN (SELECT user_id FROM community_members)`,
      ).run(at, at);
      db.prepare(
        `UPDATE community_members SET role = 'owner', updated_at = ?
         WHERE user_id IN (SELECT id FROM users WHERE role = 'admin')
           AND user_id NOT IN (SELECT user_id FROM community_members WHERE role = 'owner')`,
      ).run(at);
      db.prepare(
        `INSERT INTO community_settings (key, value, updated_at) VALUES ('slowModeSeconds', '0', ?)
         ON CONFLICT (key) DO NOTHING`,
      ).run(at);
      db.prepare(
        `INSERT INTO community_settings (key, value, updated_at) VALUES ('maxMessageLength', '2000', ?)
         ON CONFLICT (key) DO NOTHING`,
      ).run(at);
    },
  },
  {
    id: 12,
    name: 'discovery feedback',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS discovery_feedback (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, kind, value)
        );
        CREATE INDEX IF NOT EXISTS idx_discovery_feedback_user
          ON discovery_feedback(user_id, kind);
      `);
    },
  },
  {
    id: 13,
    name: 'quiz language source',
    up(db) {
      addColumn(db, 'quiz_tracks', "language_source TEXT NOT NULL DEFAULT 'unknown'");
    },
  },
  {
    id: 14,
    name: 'stream resolution map',
    up(db) {
      // Metadata-only songs (Spotify rows) are matched to a YouTube upload once;
      // remembering the id keeps the same recording across restarts and skips the
      // provider search on the next play.
      db.exec(`
        CREATE TABLE IF NOT EXISTS stream_resolutions (
          key TEXT PRIMARY KEY,
          video_id TEXT NOT NULL,
          label TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
];

export function applyMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>).map(
      (row) => row.id,
    ),
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.id, migration.name, new Date().toISOString());
    });
    run();
  }
}
