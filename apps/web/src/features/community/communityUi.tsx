import clsx from 'clsx';
import { t } from '../../lib/i18n';

/**
 * Small presentation pieces for the community phases that come next.
 *
 * They are intentionally data-driven and render nothing without real data: the
 * page must never show an invented online dot or a fake friend state.
 */

export type PresenceState = 'online' | 'listening' | 'offline';

export function PresenceDot({ state, label }: { state?: PresenceState | null; label?: string }) {
  if (!state) return null;
  return (
    <span className={clsx('presence-dot', `is-${state}`)} title={label ?? state} aria-label={label ?? state}>
      <span />
      {label ? <small>{label}</small> : null}
    </span>
  );
}

export function FriendBadge({ status }: { status?: 'friends' | 'requested' | 'incoming' | null }) {
  if (!status) return null;
  const text =
    status === 'friends'
      ? t('Arkadaşsınız', 'Friends')
      : status === 'requested'
        ? t('İstek gönderildi', 'Request sent')
        : t('İstek geldi', 'Request received');
  return <span className={clsx('status-pill', 'friend-badge', `is-${status}`)}>{text}</span>;
}
