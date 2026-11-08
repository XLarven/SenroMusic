import { create } from 'zustand';
import { api } from '../api';
import type { User } from '../types';
import { useFavorites } from './favorites';

type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

type AuthState = {
  status: AuthStatus;
  demoToken: boolean;
  user: User | null;
  error: string | null;
  check: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, username: string) => Promise<void>;
  tokenLogin: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  setAnonymous: () => void;
  clearError: () => void;
  updateUser: (user: User) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  demoToken: false,
  user: null,
  error: null,

  check: async () => {
    try {
      const result = await api.me();
      set({ status: 'authenticated', user: result.user ?? null, error: null });
      void useFavorites.getState().load();
    } catch {
      set({ status: 'anonymous', user: null });
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const result = await api.login(email, password);
      set({ status: 'authenticated', user: result.user, error: null });
      void useFavorites.getState().load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Giriş yapılamadı.';
      set({ error: message });
      throw error;
    }
  },

  register: async (email, password, displayName, username) => {
    set({ error: null });
    try {
      const result = await api.register(email, password, displayName, username);
      set({ status: 'authenticated', user: result.user, error: null });
      void useFavorites.getState().load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kayıt oluşturulamadı.';
      set({ error: message });
      throw error;
    }
  },

  tokenLogin: async (token) => {
    set({ error: null });
    try {
      const result = await api.tokenLogin(token);
      set({ status: 'authenticated', user: result.user, error: null });
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
      set({ status: 'anonymous', user: null, error: null });
    }
  },

  setAnonymous: () => set({ status: 'anonymous', user: null }),
  clearError: () => set({ error: null }),
  updateUser: (user) => set({ user }),
}));
