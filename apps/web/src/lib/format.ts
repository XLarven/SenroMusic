import type { Album, Artist, Library, Track } from '../types';
import { getAppLanguage, localeForLanguage } from './i18n';

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatLongDuration(seconds: number): string {
  const language = getAppLanguage();
  if (!Number.isFinite(seconds) || seconds <= 0) return language === 'en' ? '0 min' : '0 dk';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return language === 'en' ? `${hours} hr ${minutes} min` : `${hours} sa ${minutes} dk`;
  return language === 'en' ? `${totalMinutes} min` : `${totalMinutes} dk`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(iso: string | null): string {
  const language = getAppLanguage();
  if (!iso) return language === 'en' ? 'Not scanned yet' : 'Henüz taranmadı';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return language === 'en' ? 'Unknown' : 'Bilinmiyor';
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (getAppLanguage() === 'en') {
    if (hour < 6) return 'Good night';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }
  if (hour < 6) return 'İyi geceler';
  if (hour < 12) return 'Günaydın';
  if (hour < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(localeForLanguage(getAppLanguage())).format(value);
}

export function tracksForAlbum(library: Library, album: Album): Track[] {
  return library.tracks
    .filter((track) => track.albumArtist === album.artist && track.album === album.name)
    .sort(
      (a, b) =>
        (a.discNo ?? 0) - (b.discNo ?? 0) ||
        (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
        a.title.localeCompare(b.title, 'tr'),
    );
}

export function tracksForArtist(library: Library, artist: Artist): Track[] {
  return library.tracks
    .filter((track) => track.artist === artist.name)
    .sort(
      (a, b) =>
        a.album.localeCompare(b.album, 'tr') ||
        (a.discNo ?? 0) - (b.discNo ?? 0) ||
        (a.trackNo ?? 0) - (b.trackNo ?? 0),
    );
}

export function albumsForArtist(library: Library, artist: Artist): Album[] {
  const keys = new Set(
    library.tracks
      .filter((track) => track.artist === artist.name)
      .map((track) => `${track.albumArtist}\u0000${track.album}`),
  );
  return library.albums.filter((album) => keys.has(`${album.artist}\u0000${album.name}`));
}

export function albumById(library: Library, id: string): Album | null {
  return library.albums.find((album) => album.id === id) ?? null;
}

export function artistById(library: Library, id: string): Artist | null {
  return library.artists.find((artist) => artist.id === id) ?? null;
}

export function artistIdByName(library: Library, name: string): string | null {
  return library.artists.find((artist) => artist.name === name)?.id ?? null;
}

export function recentAlbums(library: Library, limit = 8): Album[] {
  const seen = new Set<string>();
  const albums: Album[] = [];
  const sortedTracks = [...library.tracks].sort(
    (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
  );
  for (const track of sortedTracks) {
    const key = `${track.albumArtist}\u0000${track.album}`;
    if (seen.has(key)) continue;
    const album = library.albums.find(
      (entry) => entry.artist === track.albumArtist && entry.name === track.album,
    );
    if (!album) continue;
    seen.add(key);
    albums.push(album);
    if (albums.length >= limit) break;
  }
  return albums;
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
