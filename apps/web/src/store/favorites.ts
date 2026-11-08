import { create } from 'zustand';

const KEY = 'norie.favorites';

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

type State = {
  ids: string[];
  toggle: (id: string) => void;
  isFav: (id: string) => boolean;
};

export const useFavorites = create<State>((set, get) => ({
  ids: load(),
  toggle: (id) => {
    const next = get().ids.includes(id) ? get().ids.filter((x) => x !== id) : [...get().ids, id];
    set({ ids: next });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  },
  isFav: (id) => get().ids.includes(id),
}));
