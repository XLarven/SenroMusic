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
