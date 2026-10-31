import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore } from '../store/toast';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <Icon size={18} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Bildirimi kapat">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
