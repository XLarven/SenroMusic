import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { subscribePresence } from '../../lib/presence';
import type { FriendPresence, PresenceStatus } from '../../types';

/**
 * Live presence for the current user's friends.
 *
 * The list is loaded once, then kept fresh by the SSE stream: a presence event
 * updates the status, an activity event updates what the friend is playing.
 */
export function useFriendsPresence() {
  const [byUser, setByUser] = useState<Record<string, FriendPresence>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .presenceFriends()
      .then((payload) => {
        if (cancelled) return;
        const next: Record<string, FriendPresence> = {};
        for (const entry of payload.friends) next[entry.user.id] = entry.presence;
        setByUser(next);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    const unsubscribe = subscribePresence((event) => {
      setByUser((previous) => {
        const current = previous[event.userId] ?? {
          userId: event.userId,
          status: 'offline' as PresenceStatus,
          lastSeenAt: null,
          activity: null,
        };
        if (event.type === 'presence') {
          return {
            ...previous,
            [event.userId]: {
              ...current,
              status: event.status,
              lastSeenAt: event.lastSeenAt ?? current.lastSeenAt,
              // Going offline clears the now-playing card.
              activity: event.status === 'offline' ? null : current.activity,
            },
          };
        }
        return {
          ...previous,
          [event.userId]: { ...current, activity: event.activity },
        };
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return useMemo(
    () => ({
      loaded,
      get: (userId: string): FriendPresence | null => byUser[userId] ?? null,
      listeners: Object.values(byUser).filter(
        (entry) => entry.activity && (entry.status === 'online' || entry.status === 'away'),
      ),
      onlineCount: Object.values(byUser).filter((entry) => entry.status === 'online').length,
      entries: byUser,
    }),
    [byUser, loaded],
  );
}
