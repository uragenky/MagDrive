import React from 'react';
import {
  ArrowUpDown,
  UploadCloud,
  Download,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Pause,
  Play,
  XCircle,
  Trash2,
} from 'lucide-react';
import { TransferRecord } from '../types';

interface TransfersViewProps {
  transfers: TransferRecord[];
  onPause?: (transferId: string) => Promise<void>;
  onResume?: (transferId: string) => Promise<void>;
  onCancel?: (transferId: string) => Promise<void>;
  onDelete?: (transferId: string) => Promise<void>;
  onClearFinished?: () => Promise<void>;
}

export const TransfersView: React.FC<TransfersViewProps> = ({
  transfers,
  onPause,
  onResume,
  onCancel,
  onDelete,
  onClearFinished,
}) => {
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            <span>Completed</span>
          </span>
        );
      case 'transferring':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            <ArrowUpDown className="w-3 h-3" />
            <span>Transferring</span>
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Pause className="w-3 h-3" />
            <span>Paused</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <XCircle className="w-3 h-3" />
            <span>Cancelled</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <Clock className="w-3 h-3" />
            <span>Pending</span>
          </span>
        );
    }
  };

  const hasFinished = transfers.some((t) =>
    ['completed', 'cancelled', 'failed'].includes(t.status.toLowerCase())
  );

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-100">Transfer Queue & History</h2>
            <p className="text-xs text-slate-400 mt-1">
              Real-time chunk transfers, pause/resume state machine, and parity reconstruction.
            </p>
          </div>

          {hasFinished && onClearFinished && (
            <button
              onClick={onClearFinished}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all shadow-sm"
            >
              Clear Finished
            </button>
          )}
        </div>

        {transfers.length === 0 ? (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mx-auto mb-3">
              <ArrowUpDown className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-slate-300 mb-1">
              No Transfer Activity
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              When you upload or download files, per-chunk transfer progress and verification will be journaled here automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {transfers.map((tx) => {
              const isUpload = tx.transfer_type === 'upload';
              const percent =
                tx.total_bytes > 0
                  ? Math.min(100, Math.round((tx.transferred_bytes / tx.total_bytes) * 100))
                  : 0;

              const status = tx.status.toLowerCase();
              const isTransferring = status === 'transferring';
              const isPaused = status === 'paused';
              const isFinished = ['completed', 'failed', 'cancelled'].includes(status);

              return (
                <div
                  key={tx.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col space-y-3 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isUpload
                            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {isUpload ? (
                          <UploadCloud className="w-4 h-4" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-200">{tx.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {isUpload ? 'Upload' : 'Download'} • {tx.package_id}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div className="text-right font-mono text-xs">
                        <span className="text-slate-300 font-semibold">
                          {formatSize(tx.transferred_bytes)}
                        </span>
                        <span className="text-slate-500"> / {formatSize(tx.total_bytes)}</span>
                      </div>
                      {getStatusBadge(tx.status)}

                      {/* Action Controls */}
                      <div className="flex items-center space-x-1 pl-2 border-l border-slate-800">
                        {isTransferring && onPause && (
                          <button
                            onClick={() => onPause(tx.id)}
                            title="Pause Transfer"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isPaused && onResume && (
                          <button
                            onClick={() => onResume(tx.id)}
                            title="Resume Transfer"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {(isTransferring || isPaused) && onCancel && (
                          <button
                            onClick={() => onCancel(tx.id)}
                            title="Cancel Transfer & Clean Up"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isFinished && onDelete && (
                          <button
                            onClick={() => onDelete(tx.id)}
                            title="Remove from History"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        tx.status === 'completed'
                          ? 'bg-emerald-500'
                          : tx.status === 'paused'
                          ? 'bg-amber-500'
                          : tx.status === 'failed' || tx.status === 'cancelled'
                          ? 'bg-rose-500'
                          : 'bg-cyan-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  {tx.error_message && (
                    <div className="text-[11px] text-rose-400 font-mono bg-rose-500/10 border border-rose-500/20 rounded p-2">
                      Error: {tx.error_message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
