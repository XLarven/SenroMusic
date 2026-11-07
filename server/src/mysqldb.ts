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
          path VARCHAR(1024) NOT NULL UNIQUE,
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
          INDEX idx_tracks_artist (artist),
          INDEX idx_tracks_album (album_artist, album)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await p.execute(`
        CREATE TABLE IF NOT EXISTS playlists (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(256) NOT NULL,
          description TEXT NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL
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
          INDEX idx_users_last_active (last_active_at),
          INDEX idx_users_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return true;
    } catch (e) {
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
        `INSERT INTO users (id,email,password_hash,display_name,role,created_at,updated_at,last_login_at,last_active_at,last_ip,user_agent)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE email=VALUES(email),password_hash=VALUES(password_hash),display_name=VALUES(display_name),role=VALUES(role),updated_at=VALUES(updated_at),last_login_at=VALUES(last_login_at),last_active_at=VALUES(last_active_at),last_ip=VALUES(last_ip),user_agent=VALUES(user_agent)`,
        [r.id, r.email, r.password_hash, r.display_name, r.role, r.created_at, r.updated_at, r.last_login_at, r.last_active_at, r.last_ip, r.user_agent],
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
        `INSERT INTO playlists (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),updated_at=VALUES(updated_at)`,
        [r.id, r.name, r.description, r.created_at, r.updated_at],
      );
    }
  } catch (e) {
    console.warn('[mysql] mirrorTracksPlaylists failed:', (e as Error).message);
  }
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
