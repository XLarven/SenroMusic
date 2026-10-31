import { createContext, useContext } from 'react';
import type { Library, PlaylistSummary } from './types';

export type MusicData = {
  library: Library;
  playlists: PlaylistSummary[];
  refreshLibrary: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
};

export const MusicDataContext = createContext<MusicData | null>(null);

export function useMusicData(): MusicData {
  const value = useContext(MusicDataContext);
  if (!value) throw new Error('MusicDataContext is missing');
  return value;
}
