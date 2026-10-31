import { create } from 'zustand';
import { api } from '../api';

type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

type AuthState = {
  status: AuthStatus;
  demoToken: boolean;
  error: string | null;
  check: () => Promise<void>;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  setAnonymous: () => void;
  clearError: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  demoToken: false,
  error: null,

  check: async () => {
    try {
      const result = await api.me();
      set({ status: 'authenticated', demoToken: result.demoToken, error: null });
    } catch {
      set({ status: 'anonymous' });
    }
  },

  login: async (token) => {
    set({ error: null });
    try {
      const result = await api.login(token);
      set({ status: 'authenticated', demoToken: result.demoToken, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Giriş yapılamadı.';
      set({ error: message });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ status: 'anonymous', error: null });
    }
  },

  setAnonymous: () => set({ status: 'anonymous' }),
  clearError: () => set({ error: null }),
}));
