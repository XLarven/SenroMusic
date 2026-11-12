/**
 * Friendship realtime fan-out.
 *
 * Kept in its own module so `friends.ts` never imports `presence.ts` (presence
 * already imports `listFriends`, and a cycle would break the store at boot).
 *
 * Every mutation tells both sides what changed and, where a notification row was
 * written, pushes the fresh unread count. Everything rides the existing per-user
 * SSE stream — no additional connections.
 */
import type { Database } from 'better-sqlite3';
import { presenceStore } from './presence.js';
import { unreadNotificationCount } from './friends.js';

export type FriendshipEvent = 'request' | 'accepted' | 'declined' | 'cancelled' | 'removed' | 'blocked' | 'unblocked';

/** Tells `userId` that their relationship with `peerId` changed. */
export function publishFriendship(userId: string, event: FriendshipEvent, peerId: string): void {
  presenceStore.publish([userId], {
    type: 'friendship',
    event,
    userId,
    peerId,
    at: new Date().toISOString(),
  });
}

/** Pushes the current unread notification count for the badge. */
export function publishNotificationCount(db: Database, userId: string, kind: string | null = null): void {
  presenceStore.publish([userId], {
    type: 'notification',
    unread: unreadNotificationCount(db, userId),
    kind,
    at: new Date().toISOString(),
  });
}
