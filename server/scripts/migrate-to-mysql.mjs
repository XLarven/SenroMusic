import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const here = new URL('.', import.meta.url).pathname;
const serverRoot = resolve(here, '..');
const dataDir = resolve(process.env.DATA_DIR || resolve(serverRoot, 'data'));
const sqlitePath = resolve(dataDir, 'library.db');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = resolve(dataDir, `library.db.bak-${timestamp}`);

if (!existsSync(sqlitePath)) {
  console.error(`SQLite database not found: ${sqlitePath}`);
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
copyFileSync(sqlitePath, backupPath);
console.log(`Backup created: ${backupPath}`);

const db = new Database(sqlitePath, { readonly: true });
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  charset: 'utf8mb4',
});

async function tableExists(table) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  return rows[0].c > 0;
}

async function copyTable(table, columns, placeholders, values) {
  await connection.query(`DELETE FROM ${table}`);
  if (!placeholders) return;
  const rows = values;
  for (const row of rows) {
    await connection.query(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, row);
  }
}

const tables = [
  'tracks',
  'users',
  'playlists',
  'playlist_tracks',
  'playlist_external_tracks',
  'meta',
  'favorites',
  'listening_history',
  'user_settings',
  'artist_follows',
  'user_search_history',
  'schema_migrations',
];

console.log('Verifying source tables...');
for (const table of tables) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  console.log(`${table}: ${exists ? 'present' : 'missing in SQLite (skipped)'}`);
}

console.log('Initializing MySQL schema and mirroring current SQLite data...');
await connection.end();

const { initMysqlSchema, mirrorAll, closeMysql } = await import('../dist/mysqldb.js');
const ok = await initMysqlSchema();
if (!ok) {
  console.error('MySQL schema initialization failed. Check MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD or firewall access.');
  process.exit(1);
}
await mirrorAll();
console.log('Migration mirror completed. SQLite remains in place until you set DB_DRIVER=mysql after verifying counts in MySQL.');
console.log('Rollback: restore the backup file above over the live SQLite file while the server is stopped.');
console.log('This script does not delete server/data/library.db.');
await closeMysql();
db.close();
