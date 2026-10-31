import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastState = {
  toasts: ToastItem[];
  push: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, tone = 'success') => {
    const id = nextId;
    nextId += 1;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    window.setTimeout(() => get().dismiss(id), 4_500);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
