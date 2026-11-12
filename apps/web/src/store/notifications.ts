import { create } from 'zustand';
import { api } from '../api';

/**
 * Live unread notification count for the topbar badge.
 *
 * The initial value comes from the notifications endpoint; afterwards the server
 * pushes the authoritative count over the existing SSE stream whenever a
 * notification is written or read, so the badge never drifts.
 */
type NotificationState = {
  unread: number;
  loaded: boolean;
  setUnread: (unread: number) => void;
  refresh: () => Promise<void>;
};

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  loaded: false,
  setUnread: (unread) => set({ unread: Math.max(0, unread), loaded: true }),
  refresh: async () => {
    try {
      const page = await api.notifications(1, 0);
      set({ unread: page.unread, loaded: true });
    } catch {
      // Anonymous or offline: the badge simply stays hidden.
    }
  },
}));
