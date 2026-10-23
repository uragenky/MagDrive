import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col space-y-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  useEffect(() => {
    const duration = toast.duration ?? 4500;
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'info':
      default:
        return <Info className="w-4 h-4 text-zinc-200 shrink-0" />;
    }
  };

  const getBorderColor = () => {
    switch (toast.type) {
      case 'success':
        return 'border-emerald-500/30 bg-[#151619]/95 shadow-xl';
      case 'error':
        return 'border-rose-500/30 bg-[#151619]/95 shadow-xl';
      case 'warning':
        return 'border-amber-500/30 bg-[#151619]/95 shadow-xl';
      case 'info':
      default:
        return 'border-[#2c2e35] bg-[#151619]/95 shadow-xl';
    }
  };

  return (
    <div
      className={`pointer-events-auto border rounded-xl p-3.5 shadow-2xl backdrop-blur-md flex items-start space-x-3 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200 ${getBorderColor()}`}
    >
      <div className="mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <div className="text-xs font-bold text-zinc-100 tracking-tight leading-snug">
            {toast.title}
          </div>
        )}
        <div className="text-[11px] text-zinc-300 leading-relaxed break-words mt-0.5">
          {toast.message}
        </div>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
