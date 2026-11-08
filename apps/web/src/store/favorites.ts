import { create } from 'zustand';
import { api } from '../api';

const KEY = 'norie.favorites';

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function persist(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable in private browsing; the server remains authoritative.
  }
}

type State = {
  ids: string[];
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (id: string) => Promise<boolean>;
  isFav: (id: string) => boolean;
  setFromServer: (ids: string[]) => void;
};

export const useFavorites = create<State>((set, get) => ({
  ids: load(),
  loaded: false,
  load: async () => {
    try {
      const data = await api.favorites();
      const ids = data.tracks.map((track) => track.id);
      set({ ids, loaded: true });
      persist(ids);
    } catch {
      set({ loaded: true });
    }
  },
  toggle: async (id) => {
    const previous = get().ids;
    const next = previous.includes(id) ? previous.filter((x) => x !== id) : [...previous, id];
    set({ ids: next });
    persist(next);
    try {
      if (previous.includes(id)) await api.removeFavorite(id);
      else await api.addFavorite(id);
      return next.includes(id);
    } catch {
      set({ ids: previous });
      persist(previous);
      throw new Error('Favori güncellenemedi.');
    }
  },
  isFav: (id) => get().ids.includes(id),
  setFromServer: (ids) => {
    set({ ids });
    persist(ids);
  },
}));
