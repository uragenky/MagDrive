import React from 'react';
import { AlertTriangle, Info, Trash2, X } from 'lucide-react';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ConfirmModalProps {
  isOpen: boolean;
  options: ConfirmDialogOptions | null;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ isOpen, options, onClose }) => {
  if (!isOpen || !options) return null;

  const variant = options.variant || 'danger';

  const handleConfirm = () => {
    options.onConfirm();
    onClose();
  };

  const handleCancel = () => {
    if (options.onCancel) {
      options.onCancel();
    }
    onClose();
  };

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return (
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
        );
      case 'warning':
        return (
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-200 shrink-0">
            <Info className="w-5 h-5" />
          </div>
        );
    }
  };

  const getConfirmButtonClass = () => {
    switch (variant) {
      case 'danger':
        return 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-rose-950/40 border-rose-500/30';
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white shadow-amber-950/40 border-amber-500/30';
      case 'info':
      default:
        return 'bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 shadow-sm border border-white/20';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-150">
      <div className="bg-[#131417] border border-[#222429] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start space-x-4">
            {getIcon()}
            <div className="flex-1 min-w-0 pt-0.5">
              <h3 className="text-sm font-bold text-zinc-100 tracking-tight">
                {options.title}
              </h3>
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                {options.message}
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-6 flex items-center justify-end space-x-2.5 pt-4 border-t border-[#222429]">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-[#18191d] hover:bg-[#222428] border border-[#26282e] transition-all"
            >
              {options.cancelText || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border shadow-md transition-all ${getConfirmButtonClass()}`}
            >
              {options.confirmText || 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
