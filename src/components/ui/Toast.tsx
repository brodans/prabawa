import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLES: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200 dark:border-emerald-900/60', iconColor: 'text-emerald-500' },
  error: { icon: AlertCircle, ring: 'border-rose-200 dark:border-rose-900/60', iconColor: 'text-rose-500' },
  info: { icon: Info, ring: 'border-blue-200 dark:border-blue-900/60', iconColor: 'text-blue-500' },
};

let sequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++sequence;
      setToasts(prev => [...prev.slice(-3), { id, kind, message }]);
      setTimeout(() => remove(id), kind === 'error' ? 6000 : 3500);
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: message => show(message, 'success'),
      error: message => show(message, 'error'),
      info: message => show(message, 'info'),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[110] flex flex-col items-end gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => {
            const { icon: Icon, ring, iconColor } = KIND_STYLES[toast.kind];
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={`pointer-events-auto w-full sm:w-auto sm:max-w-sm flex items-start gap-3 rounded-xl border ${ring} bg-white dark:bg-slate-800 px-4 py-3 shadow-xl`}
                role="status"
              >
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
                <p className="flex-1 text-sm text-slate-700 dark:text-slate-200 leading-relaxed break-words">
                  {toast.message}
                </p>
                <button
                  type="button"
                  onClick={() => remove(toast.id)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
                  aria-label="Tutup notifikasi"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
