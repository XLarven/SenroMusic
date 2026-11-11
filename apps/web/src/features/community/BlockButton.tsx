import { useState } from 'react';
import { Ban, Loader2, ShieldOff } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../lib/i18n';
import { useToastStore } from '../../store/toast';
import type { Relationship } from '../../types';

type BlockButtonProps = {
  userId: string;
  initial?: Relationship | null;
};

/**
 * Block / unblock the profile owner. Blocking also ends any friendship or
 * pending request, and both directions of future contact are refused server-side.
 */
export function BlockButton({ userId, initial }: BlockButtonProps) {
  const pushToast = useToastStore((state) => state.push);
  const [blocked, setBlocked] = useState<boolean | null>(initial?.blockedByMe ?? null);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (blocked) {
        const result = await api.unblockUser(userId);
        setBlocked(false);
        pushToast(t('Engel kaldırıldı.', 'Unblocked.'), 'success');
        void result;
      } else {
        await api.blockUser(userId);
        setBlocked(true);
        pushToast(t('Kullanıcı engellendi.', 'User blocked.'), 'success');
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('İşlem başarısız.', 'Action failed.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="button ghost" onClick={() => void toggle()} disabled={busy}>
      {busy ? <Loader2 size={16} className="spin" /> : blocked ? <ShieldOff size={16} /> : <Ban size={16} />}
      {blocked ? t('Engeli kaldır', 'Unblock') : t('Engelle', 'Block')}
    </button>
  );
}
