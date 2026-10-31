import clsx from 'clsx';
import { coverGradient } from '../lib/gradient';
import type { Artist } from '../types';

function initials(name: string): string {
  const parts = name
    .split(/[\s&]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr');
  return `${parts[0][0]}${parts[1][0]}`.toLocaleUpperCase('tr');
}

type ArtistAvatarProps = {
  artist: Artist;
  className?: string;
};

export function ArtistAvatar({ artist, className }: ArtistAvatarProps) {
  return (
    <span
      className={clsx('artist-avatar', className)}
      style={coverGradient(`artist-${artist.name}`)}
      role="img"
      aria-label={artist.name}
    >
      <span className="artist-avatar-ring" aria-hidden="true" />
      <span className="artist-avatar-initials" aria-hidden="true">
        {initials(artist.name)}
      </span>
    </span>
  );
}
