import { useEffect, useState } from 'react';
import { Check, Loader2, UserMinus, UserPlus, X } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../lib/i18n';
import { useToastStore } from '../../store/toast';
import type { Relationship } from '../../types';

type FriendButtonProps = {
  userId: string;
  /** Known state, so the button can paint before a round trip. */
  initial?: Relationship | null;
  onChange?: (relationship: Relationship) => void;
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * One control that always shows the truth of the relationship: add, requested,
 * accept/decline, friends, or blocked. Every action is confirmed by the server
 * and the returned state replaces the local one.
 */
export function FriendButton({ userId, initial, onChange, size = 'md', className }: FriendButtonProps) {
  const pushToast = useToastStore((state) => state.push);
  const [relationship, setRelationship] = useState<Relationship | null>(initial ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial !== undefined) {
      setRelationship(initial);
      return;
    }
    let cancelled = false;
    void api
      .friendshipStatus(userId)
      .then((payload) => {
        if (!cancelled) setRelationship(payload.relationship);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, initial]);

  const apply = (next: Relationship) => {
    setRelationship(next);
    onChange?.(next);
  };

  const run = async (action: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      pushToast(message, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('İşlem başarısız.', 'Action failed.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const compact = size === 'sm';

  if (!relationship) {
    return (
      <button type="button" className={`button secondary ${compact ? 'compact' : ''} ${className ?? ''}`} disabled>
        <Loader2 size={compact ? 14 : 16} className="spin" />
        {t('Yükleniyor…', 'Loading…')}
      </button>
    );
  }

  if (relationship.state === 'self') return null;

  if (relationship.state === 'blocked') {
    return (
      <button
        type="button"
        className={`button ghost ${compact ? 'compact' : ''} ${className ?? ''}`}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await api.unblockUser(userId);
            apply(result.relationship);
          }, t('Engel kaldırıldı.', 'Unblocked.'))
        }
      >
        {busy ? <Loader2 size={compact ? 14 : 16} className="spin" /> : <UserPlus size={compact ? 14 : 16} />}
        {t('Engeli kaldır', 'Unblock')}
      </button>
    );
  }

  if (relationship.state === 'friends') {
    return (
      <button
        type="button"
        className={`button ghost ${compact ? 'compact' : ''} ${className ?? ''}`}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await api.removeFriend(userId);
            apply({ ...relationship, state: 'none', requestId: null });
          }, t('Arkadaşlıktan çıkarıldı.', 'Friend removed.'))
        }
      >
        {busy ? <Loader2 size={compact ? 14 : 16} className="spin" /> : <Check size={compact ? 14 : 16} />}
        {t('Arkadaşsınız', 'Friends')}
        <UserMinus size={compact ? 14 : 16} />
      </button>
    );
  }

  if (relationship.state === 'pending_out' && relationship.requestId) {
    return (
      <button
        type="button"
        className={`button secondary ${compact ? 'compact' : ''} ${className ?? ''}`}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await api.cancelFriendRequest(relationship.requestId as number);
            apply({ ...relationship, state: 'none', requestId: null });
          }, t('İstek geri çekildi.', 'Request cancelled.'))
        }
      >
        {busy ? <Loader2 size={compact ? 14 : 16} className="spin" /> : <X size={compact ? 14 : 16} />}
        {t('İstek gönderildi', 'Request sent')}
      </button>
    );
  }

  if (relationship.state === 'pending_in' && relationship.requestId) {
    return (
      <div className="friend-button-group">
        <button
          type="button"
          className={`button primary ${compact ? 'compact' : ''} ${className ?? ''}`}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.acceptFriendRequest(relationship.requestId as number);
              apply({ ...relationship, state: 'friends' });
            }, t('İstek kabul edildi.', 'Request accepted.'))
          }
        >
          {busy ? <Loader2 size={compact ? 14 : 16} className="spin" /> : <Check size={compact ? 14 : 16} />}
          {t('Kabul et', 'Accept')}
        </button>
        <button
          type="button"
          className={`button ghost ${compact ? 'compact' : ''}`}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.declineFriendRequest(relationship.requestId as number);
              apply({ ...relationship, state: 'none', requestId: null });
            }, t('İstek reddedildi.', 'Request declined.'))
          }
        >
          <X size={compact ? 14 : 16} />
          {t('Reddet', 'Decline')}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`button primary ${compact ? 'compact' : ''} ${className ?? ''}`}
      disabled={busy}
      onClick={() =>
        void run(async () => {
          const result = await api.sendFriendRequest(userId);
          apply(result.relationship);
        }, t('Arkadaşlık isteği gönderildi.', 'Friend request sent.'))
      }
    >
      {busy ? <Loader2 size={compact ? 14 : 16} className="spin" /> : <UserPlus size={compact ? 14 : 16} />}
      {t('Arkadaş ekle', 'Add friend')}
    </button>
  );
}
