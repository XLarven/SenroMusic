import { create } from 'zustand';

type UiState = {
  createPlaylistOpen: boolean;
  openCreatePlaylist: () => void;
  closeCreatePlaylist: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  createPlaylistOpen: false,
  openCreatePlaylist: () => set({ createPlaylistOpen: true }),
  closeCreatePlaylist: () => set({ createPlaylistOpen: false }),
}));
