-- Norie Music — MySQL şeması (SQLite'in aynadaki karşılığı)
-- phpMyAdmin / mysql CLI / HeidiSQL ile çalıştırın

CREATE DATABASE IF NOT EXISTS norie_music
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE norie_music;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlists (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta (
  `key` VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
