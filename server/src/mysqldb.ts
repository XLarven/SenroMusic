import mysql from 'mysql2/promise';

type MysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  enabled: boolean;
};

export function getMysqlConfig(): MysqlConfig {
  const host = (process.env.MYSQL_HOST || '').trim();
  const port = Number.parseInt(process.env.MYSQL_PORT || '3306', 10);
  const user = (process.env.MYSQL_USER || '').trim();
  const password = process.env.MYSQL_PASSWORD || '';
  const database = (process.env.MYSQL_DATABASE || 'norie_music').trim();
  return { host, port: Number.isFinite(port) ? port : 3306, user, password, database, enabled: Boolean(host && user) };
}

let pool: mysql.Pool | null = null;
let initPromise: Promise<boolean> | null = null;
let lastInitOk = false;
let statusCache: { value: { driver: 'sqlite' | 'mysql'; configured: boolean; connected: boolean; primary: boolean; migrationsApplied: boolean }; at: number } | null = null;

async function ensureColumn(
  p: mysql.Pool,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const [rows] = (await p.execute(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )) as unknown as Array<{ c: number }>;
  const count = Array.isArray(rows) ? (rows[0]?.c ?? 0) : 0;
  if (count === 0) {
    await p.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function ensureIndex(
  p: mysql.Pool,
  table: string,
  indexName: string,
  definition: string,
): Promise<void> {
  const [rows] = (await p.execute(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  )) as unknown as Array<{ c: number }>;
  const count = Array.isArray(rows) ? (rows[0]?.c ?? 0) : 0;
  if (count === 0) {
    await p.execute(`CREATE INDEX ${indexName} ON ${table} (${definition})`);
  }
}

export function getPool(): mysql.Pool | null {
  if (!getMysqlConfig().enabled) return null;
  if (pool) return pool;
  const cfg = getMysqlConfig();
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z',
    connectTimeout: 3000,
    enableKeepAlive: true,
  });
  return pool;
}

export async function initMysqlSchema(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await p.execute(`
        CREATE TABLE IF NOT EXISTS tracks (
          id VARCHAR(64) PRIMARY KEY,
          path VARCHAR(700) NOT NULL UNIQUE,
          rel_path VARCHAR(1024) NOT NULL,
          title VARCHAR(512) NOT NULL,
          artist VARCHAR(512) NOT NULL,
          album VARCHAR(512) NOT NULL,
          album_artist VARCHAR(512) NOT NULL,
          genre VARCHAR(256),
          year INT,
          track_no INT,
          disc_no INT,
          duration DOUBLE NOT NULL DEFAULT 0,
          bitrate INT,
          sample_rate INT,
          channels INT,
          format VARCHAR(32),
          size BIGINT NOT NULL,
          mtime BIGINT NOT NULL,
          cover_id VARCHAR(64),
          added_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          INDEX idx_tracks_artist (artist(150)),
          INDEX idx_tracks_album (album_artist(150), album(150)),
          INDEX idx_tracks_added (added_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS playlists (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(256) NOT NULL,
          description TEXT NOT NULL,
          owner_id VARCHAR(64),
          visibility VARCHAR(16) NOT NULL DEFAULT 'private',
          pinned TINYINT(1) NOT NULL DEFAULT 0,
          share_slug VARCHAR(128) UNIQUE,
          cover_id VARCHAR(64),
          cover_url TEXT,
          source_provider VARCHAR(32),
          source_url VARCHAR(2048),
          source_playlist_id VARCHAR(256),
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          INDEX idx_playlists_owner (owner_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS playlist_tracks (
          entry_id BIGINT AUTO_INCREMENT PRIMARY KEY,
          playlist_id VARCHAR(64) NOT NULL,
          track_id VARCHAR(64) NOT NULL,
          position INT NOT NULL,
          added_at VARCHAR(32) NOT NULL,
          INDEX idx_pt_playlist (playlist_id, position),
          INDEX idx_pt_track (track_id),
          CONSTRAINT fk_pt_playlist FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
          CONSTRAINT fk_pt_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS playlist_external_tracks (
          entry_id BIGINT AUTO_INCREMENT PRIMARY KEY,
          playlist_id VARCHAR(64) NOT NULL,
          provider VARCHAR(32) NOT NULL,
          provider_track_id VARCHAR(256),
          title VARCHAR(512) NOT NULL,
          artist VARCHAR(512) NOT NULL,
          album VARCHAR(512),
          duration DOUBLE,
          artwork_url VARCHAR(2048),
          source_url VARCHAR(2048),
          position INT NOT NULL,
          matched_track_id VARCHAR(64),
          created_at VARCHAR(32) NOT NULL,
          INDEX idx_external_tracks_playlist (playlist_id, position),
          INDEX idx_external_tracks_provider (provider, provider_track_id),
          CONSTRAINT fk_external_playlist FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
          CONSTRAINT fk_external_track FOREIGN KEY (matched_track_id) REFERENCES tracks(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS meta (
          \`key\` VARCHAR(128) PRIMARY KEY,
          value TEXT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(254) NOT NULL UNIQUE,
          password_hash VARCHAR(512) NOT NULL,
          display_name VARCHAR(128) NOT NULL DEFAULT '',
          role VARCHAR(16) NOT NULL DEFAULT 'user',
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          last_login_at VARCHAR(32),
          last_active_at VARCHAR(32),
          last_ip VARCHAR(64) NOT NULL DEFAULT '',
          user_agent VARCHAR(512) NOT NULL DEFAULT '',
          bio TEXT NOT NULL DEFAULT '',
          avatar_url TEXT,
          banner_url TEXT,
          profile_visibility VARCHAR(16) NOT NULL DEFAULT 'public',
          username VARCHAR(32) UNIQUE,
          favorite_genres TEXT,
          INDEX idx_users_last_active (last_active_at),
          INDEX idx_users_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS favorites (
          user_id VARCHAR(64) NOT NULL,
          track_id VARCHAR(64) NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (user_id, track_id),
          INDEX idx_favorites_track (track_id),
          CONSTRAINT fk_fav_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_fav_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS listening_history (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          track_id VARCHAR(64) NOT NULL,
          played_at VARCHAR(32) NOT NULL,
          ms_played BIGINT NOT NULL DEFAULT 0,
          source VARCHAR(32) NOT NULL DEFAULT 'player',
          INDEX idx_history_user_time (user_id, played_at),
          CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_history_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS user_settings (
          user_id VARCHAR(64) NOT NULL,
          \`key\` VARCHAR(128) NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (user_id, \`key\`),
          CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS artist_follows (
          user_id VARCHAR(64) NOT NULL,
          artist_id VARCHAR(128) NOT NULL,
          artist_name VARCHAR(512) NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (user_id, artist_id),
          INDEX idx_artist_follows_name (user_id, artist_name),
          CONSTRAINT fk_artist_follows_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS user_search_history (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          query VARCHAR(512) NOT NULL,
          searched_at VARCHAR(32) NOT NULL,
          INDEX idx_search_history_user_time (user_id, searched_at),
          INDEX idx_search_history_user_query (user_id, query),
          CONSTRAINT fk_search_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INT PRIMARY KEY,
          name VARCHAR(256) NOT NULL,
          applied_at VARCHAR(32) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      for (const column of [
        ['owner_id', 'owner_id VARCHAR(64)'],
        ['visibility', "visibility VARCHAR(16) NOT NULL DEFAULT 'private'"],
        ['pinned', 'pinned TINYINT(1) NOT NULL DEFAULT 0'],
        ['share_slug', 'share_slug VARCHAR(128)'],
        ['cover_id', 'cover_id VARCHAR(64)'],
        ['cover_url', 'cover_url TEXT'],
        ['source_provider', 'source_provider VARCHAR(32)'],
        ['source_url', 'source_url VARCHAR(2048)'],
        ['source_playlist_id', 'source_playlist_id VARCHAR(256)'],
      ] as const) await ensureColumn(p, 'playlists', column[0], column[1]);
      await ensureIndex(p, 'playlists', 'idx_playlists_owner', 'owner_id');
      await ensureIndex(p, 'playlists', 'idx_playlists_share', 'share_slug');

      for (const column of [
        ['bio', "bio TEXT NOT NULL DEFAULT ''"],
        ['avatar_url', 'avatar_url TEXT'],
        ['banner_url', 'banner_url TEXT'],
        ['profile_visibility', "profile_visibility VARCHAR(16) NOT NULL DEFAULT 'public'"],
        ['username', 'username VARCHAR(32)'],
        ['favorite_genres', 'favorite_genres TEXT'],
      ] as const) await ensureColumn(p, 'users', column[0], column[1]);
      await ensureIndex(p, 'users', 'idx_users_username', 'username');
      lastInitOk = true;
      return true;
    } catch (e) {
      lastInitOk = false;
      console.warn('[mysql] init failed:', (e as Error).message);
      return false;
    }
  })();
  return initPromise;
}

// Best-effort mirrors (SQL enjeksiyona kapalı: ? placeholder)
export async function mirrorUsers(): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await initMysqlSchema();
    // SQLite'dan oku (sync getDb dar döngüsü)
    const { getDb } = await import('./db.js');
    const rows = getDb().prepare('SELECT * FROM users').all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return;
    for (const r of rows) {
      await p.query(
        `INSERT INTO users (id,email,password_hash,display_name,role,created_at,updated_at,last_login_at,last_active_at,last_ip,user_agent,bio,avatar_url,banner_url,profile_visibility,username,favorite_genres)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE email=VALUES(email),password_hash=VALUES(password_hash),display_name=VALUES(display_name),role=VALUES(role),updated_at=VALUES(updated_at),last_login_at=VALUES(last_login_at),last_active_at=VALUES(last_active_at),last_ip=VALUES(last_ip),user_agent=VALUES(user_agent),bio=VALUES(bio),avatar_url=VALUES(avatar_url),banner_url=VALUES(banner_url),profile_visibility=VALUES(profile_visibility),username=VALUES(username),favorite_genres=VALUES(favorite_genres)`,
        [r.id, r.email, r.password_hash, r.display_name, r.role, r.created_at, r.updated_at, r.last_login_at, r.last_active_at, r.last_ip, r.user_agent, r.bio ?? '', r.avatar_url ?? null, r.banner_url ?? null, r.profile_visibility ?? 'public', r.username ?? null, r.favorite_genres ?? null],
      );
    }
  } catch (e) {
    console.warn('[mysql] mirrorUsers failed:', (e as Error).message);
  }
}

export async function mirrorTracksPlaylists(): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await initMysqlSchema();
    const { getDb } = await import('./db.js');
    const db = getDb();
    const tracks = db.prepare('SELECT * FROM tracks').all() as Array<Record<string, unknown>>;
    for (const r of tracks.slice(0, 5000)) {
      await p.query(
        `INSERT INTO tracks (id,path,rel_path,title,artist,album,album_artist,genre,year,track_no,disc_no,duration,bitrate,sample_rate,channels,format,size,mtime,cover_id,added_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE title=VALUES(title),artist=VALUES(artist),album=VALUES(album),album_artist=VALUES(album_artist),genre=VALUES(genre),year=VALUES(year),track_no=VALUES(track_no),disc_no=VALUES(disc_no),duration=VALUES(duration),bitrate=VALUES(bitrate),sample_rate=VALUES(sample_rate),channels=VALUES(channels),format=VALUES(format),size=VALUES(size),mtime=VALUES(mtime),cover_id=VALUES(cover_id),updated_at=VALUES(updated_at)`,
        [r.id, r.path, r.rel_path, r.title, r.artist, r.album, r.album_artist, r.genre, r.year, r.track_no, r.disc_no, r.duration, r.bitrate, r.sample_rate, r.channels, r.format, r.size, r.mtime, r.cover_id, r.added_at, r.updated_at],
      );
    }
    const playlists = db.prepare('SELECT * FROM playlists').all() as Array<Record<string, unknown>>;
    for (const r of playlists) {
      await p.query(
        `INSERT INTO playlists (id,name,description,owner_id,visibility,pinned,share_slug,cover_id,cover_url,source_provider,source_url,source_playlist_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),owner_id=VALUES(owner_id),visibility=VALUES(visibility),pinned=VALUES(pinned),share_slug=VALUES(share_slug),cover_id=VALUES(cover_id),cover_url=VALUES(cover_url),source_provider=VALUES(source_provider),source_url=VALUES(source_url),source_playlist_id=VALUES(source_playlist_id),updated_at=VALUES(updated_at)`,
        [r.id, r.name, r.description, r.owner_id ?? null, r.visibility ?? 'private', r.pinned ?? 0, r.share_slug ?? null, r.cover_id ?? null, r.cover_url ?? null, r.source_provider ?? null, r.source_url ?? null, r.source_playlist_id ?? null, r.created_at, r.updated_at],
      );
    }
    const playlistTracks = db.prepare('SELECT * FROM playlist_tracks ORDER BY playlist_id, position').all() as Array<Record<string, unknown>>;
    for (const r of playlistTracks) {
      await p.query(
        `INSERT INTO playlist_tracks (entry_id,playlist_id,track_id,position,added_at) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE playlist_id=VALUES(playlist_id),track_id=VALUES(track_id),position=VALUES(position),added_at=VALUES(added_at)`,
        [r.entry_id, r.playlist_id, r.track_id, r.position, r.added_at],
      );
    }
    const externalTracks = db.prepare('SELECT * FROM playlist_external_tracks ORDER BY playlist_id, position').all() as Array<Record<string, unknown>>;
    for (const r of externalTracks) {
      await p.query(
        `INSERT INTO playlist_external_tracks (entry_id,playlist_id,provider,provider_track_id,title,artist,album,duration,artwork_url,source_url,position,matched_track_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE playlist_id=VALUES(playlist_id),provider=VALUES(provider),provider_track_id=VALUES(provider_track_id),title=VALUES(title),artist=VALUES(artist),album=VALUES(album),duration=VALUES(duration),artwork_url=VALUES(artwork_url),source_url=VALUES(source_url),position=VALUES(position),matched_track_id=VALUES(matched_track_id),created_at=VALUES(created_at)`,
        [r.entry_id, r.playlist_id, r.provider, r.provider_track_id, r.title, r.artist, r.album, r.duration, r.artwork_url, r.source_url, r.position, r.matched_track_id, r.created_at],
      );
    }
    const meta = db.prepare('SELECT * FROM meta').all() as Array<Record<string, unknown>>;
    for (const r of meta) {
      await p.query(
        `INSERT INTO meta (\`key\`,value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE value=VALUES(value)`,
        [r.key, r.value],
      );
    }
  } catch (e) {
    console.warn('[mysql] mirrorTracksPlaylists failed:', (e as Error).message);
  }
}

export async function mirrorPersonalData(): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await initMysqlSchema();
    const { getDb } = await import('./db.js');
    const db = getDb();

    const favorites = db.prepare('SELECT * FROM favorites').all() as Array<Record<string, unknown>>;
    for (const r of favorites) {
      await p.query(
        `INSERT INTO favorites (user_id,track_id,created_at) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE created_at=VALUES(created_at)`,
        [r.user_id, r.track_id, r.created_at],
      );
    }

    const history = db.prepare('SELECT * FROM listening_history').all() as Array<Record<string, unknown>>;
    for (const r of history) {
      await p.query(
        `INSERT INTO listening_history (id,user_id,track_id,played_at,ms_played,source) VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),track_id=VALUES(track_id),played_at=VALUES(played_at),ms_played=VALUES(ms_played),source=VALUES(source)`,
        [r.id, r.user_id, r.track_id, r.played_at, r.ms_played, r.source],
      );
    }

    const settings = db.prepare('SELECT * FROM user_settings').all() as Array<Record<string, unknown>>;
    for (const r of settings) {
      await p.query(
        `INSERT INTO user_settings (user_id,\`key\`,value) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE value=VALUES(value)`,
        [r.user_id, r.key, r.value],
      );
    }

    const follows = db.prepare('SELECT * FROM artist_follows').all() as Array<Record<string, unknown>>;
    for (const r of follows) {
      await p.query(
        `INSERT INTO artist_follows (user_id,artist_id,artist_name,created_at) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE artist_name=VALUES(artist_name),created_at=VALUES(created_at)`,
        [r.user_id, r.artist_id, r.artist_name, r.created_at],
      );
    }

    const searches = db.prepare('SELECT * FROM user_search_history').all() as Array<Record<string, unknown>>;
    for (const r of searches) {
      await p.query(
        `INSERT INTO user_search_history (id,user_id,query,searched_at) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),query=VALUES(query),searched_at=VALUES(searched_at)`,
        [r.id, r.user_id, r.query, r.searched_at],
      );
    }
  } catch (e) {
    console.warn('[mysql] mirrorPersonalData failed:', (e as Error).message);
  }
}

export async function mirrorAll(): Promise<void> {
  if (!getPool()) return;
  await mirrorUsers();
  await mirrorTracksPlaylists();
  await mirrorPersonalData();
}

export async function getDatabaseStatus(): Promise<{
  driver: 'sqlite' | 'mysql';
  configured: boolean;
  connected: boolean;
  primary: boolean;
  migrationsApplied: boolean;
}> {
  const { config } = await import('./config.js');
  const driver = config.dbDriver as 'sqlite' | 'mysql';
  const configured = Boolean(config.mysqlHost && config.mysqlUser);
  const now = Date.now();
  if (statusCache && now - statusCache.at < 30_000) return statusCache.value;
  let connected = false;
  if (configured) {
    try {
      const ok = await initMysqlSchema();
      connected = ok && (await pingMysql());
    } catch {
      connected = false;
    }
  }
  const value = {
    driver,
    configured,
    connected,
    primary: driver === 'mysql' && connected,
    migrationsApplied: lastInitOk,
  };
  statusCache = { value, at: now };
  return value;
}

export async function pingMysql(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  try {
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch {
    return false;
  }
}

export async function closeMysql(): Promise<void> {
  try { await pool?.end(); } catch { /* ignore */ }
  pool = null;
}
