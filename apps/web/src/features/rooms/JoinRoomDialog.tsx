import { Loader2 } from 'lucide-react';
import { t } from '../../lib/i18n';

/**
 * Confirmation shown when an account tries to join a second listening room.
 * The backend enforces one active room; this dialog lets the user move safely.
 */
export function JoinRoomDialog({
  roomName,
  busy,
  onCancel,
  onConfirm,
}: {
  roomName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dm-picker" role="dialog" aria-modal="true" aria-label={t('Oda değiştir', 'Switch room')}>
      <div className="dm-picker-card join-room-dialog">
        <header>
          <h4>{t('Zaten bir odadasın', 'You are already in a room')}</h4>
        </header>
        <p className="join-room-copy">
          {t(
            'Şu anda başka bir dinleme odasındasın. Yeni odaya katılmak için mevcut odadan ayrılman gerekiyor. Ayrılıp yeni odaya katılmak istiyor musun?',
            "You're already in another listening room. To join this room, you need to leave your current room. Would you like to leave and join the new room?",
          )}
        </p>
        <p className="join-room-target">
          {t('Şu anki oda:', 'Current room:')} <strong>{roomName}</strong>
        </p>
        <div className="join-room-actions">
          <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>
            {t('Vazgeç', 'Cancel')}
          </button>
          <button type="button" className="button" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {t('Ayrıl ve Katıl', 'Leave and Join')}
          </button>
        </div>
      </div>
    </div>
  );
}
