import React, { useState, useEffect } from 'react';
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
  FolderOpen,
  Zap,
  Activity,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { TransferRecord, TransferProgressPayload } from '../types';

interface TransfersViewProps {
  transfers: TransferRecord[];
  onPause?: (transferId: string) => Promise<void> | void;
  onResume?: (transferId: string) => Promise<void> | void;
  onCancel?: (transferId: string) => Promise<void> | void;
  onDelete?: (transferId: string) => Promise<void> | void;
  onClearFinished?: () => Promise<void> | void;
}

type FilterStatus = 'all' | 'active' | 'completed' | 'other';

export const TransfersView: React.FC<TransfersViewProps> = ({
  transfers,
  onPause,
  onResume,
  onCancel,
  onDelete,
  onClearFinished,
}) => {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [liveStats, setLiveStats] = useState<
    Record<
      string,
      {
        speed_bps: number;
        eta_seconds: number;
        stage: string;
        current_shard: number;
        total_shards: number;
        transferred_bytes: number;
        target_label?: string;
      }
    >
  >({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<TransferProgressPayload>('transfer-progress', (event) => {
      const p = event.payload;
      if (p.transfer_id) {
        setLiveStats((prev) => ({
          ...prev,
          [p.transfer_id]: {
            speed_bps: p.speed_bps || 0,
            eta_seconds: p.eta_seconds || 0,
            stage: p.stage,
            current_shard: p.current_shard,
            total_shards: p.total_shards,
            transferred_bytes: p.transferred_bytes || p.transferred,
            target_label: p.target_label,
          },
        }));
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bps: number) => {
    if (bps <= 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatEta = (secs: number) => {
    if (secs <= 0) return '0s';
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}m ${rem}s`;
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            <span>Completed</span>
          </span>
        );
      case 'transferring':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            <ArrowUpDown className="w-3 h-3" />
            <span>Transferring</span>
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Pause className="w-3 h-3" />
            <span>Paused</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <XCircle className="w-3 h-3" />
            <span>Cancelled</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <Clock className="w-3 h-3" />
            <span>Pending</span>
          </span>
        );
    }
  };

  // Aggregates
  const activeTransfers = transfers.filter((t) => t.status.toLowerCase() === 'transferring');
  const completedTransfers = transfers.filter((t) => t.status.toLowerCase() === 'completed');
  const otherTransfers = transfers.filter((t) =>
    ['paused', 'failed', 'cancelled', 'pending'].includes(t.status.toLowerCase())
  );

  let totalUploadBps = 0;
  let totalDownloadBps = 0;
  activeTransfers.forEach((tx) => {
    const s = liveStats[tx.id];
    if (s && s.speed_bps > 0) {
      if (tx.transfer_type === 'upload') {
        totalUploadBps += s.speed_bps;
      } else {
        totalDownloadBps += s.speed_bps;
      }
    }
  });

  const filteredTransfers = transfers.filter((t) => {
    const s = t.status.toLowerCase();
    if (filterStatus === 'active') return s === 'transferring';
    if (filterStatus === 'completed') return s === 'completed';
    if (filterStatus === 'other') return ['paused', 'failed', 'cancelled', 'pending'].includes(s);
    return true;
  });

  const hasFinished = transfers.some((t) =>
    ['completed', 'cancelled', 'failed'].includes(t.status.toLowerCase())
  );

  return (
    <div className="flex-1 bg-[#0c0d0e] overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-100 tracking-tight">Transfers</h2>
            <p className="text-xs text-zinc-400 mt-1">
              Monitor active uploads, downloads, and transfer history.
            </p>
          </div>

          {hasFinished && onClearFinished && (
            <button
              onClick={onClearFinished}
              className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#18191d] hover:bg-[#222428] active:bg-[#151618] text-zinc-200 border border-[#26282e] transition-all shadow-sm"
            >
              Clear Finished
            </button>
          )}
        </div>

        {/* Live Bandwidth & Workers Widget */}
        {activeTransfers.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#131417] border border-[#222429] rounded-xl p-3.5 flex items-center space-x-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700/60 flex items-center justify-center shrink-0">
                <UploadCloud className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">
                  Active Upload
                </span>
                <span className="text-sm font-bold text-zinc-100 font-mono">
                  {formatSpeed(totalUploadBps)}
                </span>
              </div>
            </div>

            <div className="bg-[#131417] border border-[#222429] rounded-xl p-3.5 flex items-center space-x-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700/60 flex items-center justify-center shrink-0">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">
                  Active Download
                </span>
                <span className="text-sm font-bold text-zinc-100 font-mono">
                  {formatSpeed(totalDownloadBps)}
                </span>
              </div>
            </div>

            <div className="bg-[#131417] border border-[#222429] rounded-xl p-3.5 flex items-center space-x-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700/60 flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">
                  Active Streams
                </span>
                <span className="text-sm font-bold text-zinc-100 font-mono">
                  {activeTransfers.length} {activeTransfers.length === 1 ? 'Stream' : 'Streams'} Active
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Filter Pills */}
        <div className="flex border-b border-[#222429] bg-[#131417] p-1 rounded-xl text-xs space-x-1 shadow-sm">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              filterStatus === 'all'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All ({transfers.length})
          </button>
          <button
            onClick={() => setFilterStatus('active')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              filterStatus === 'active'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Active ({activeTransfers.length})
          </button>
          <button
            onClick={() => setFilterStatus('completed')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              filterStatus === 'completed'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Completed ({completedTransfers.length})
          </button>
          <button
            onClick={() => setFilterStatus('other')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              filterStatus === 'other'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Paused / Other ({otherTransfers.length})
          </button>
        </div>

        {/* Transfers List */}
        {filteredTransfers.length === 0 ? (
          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-12 text-center shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-[#18191d] border border-[#26282e] flex items-center justify-center text-zinc-500 mx-auto mb-3 shadow-inner">
              <ArrowUpDown className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-1">
              {transfers.length === 0 ? 'No Transfers in Progress' : 'No Transfers Match Filter'}
            </h4>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
              {transfers.length === 0
                ? 'Upload or download a file to monitor real-time transfer progress and speed here.'
                : 'Switch filter tab to see other transfer items.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTransfers.map((tx) => {
              const isUpload = tx.transfer_type === 'upload';
              const stats = liveStats[tx.id];
              const effectiveTransferred =
                stats && (tx.status.toLowerCase() === 'transferring' || tx.status.toLowerCase() === 'paused')
                  ? stats.transferred_bytes
                  : tx.transferred_bytes;

              const percent =
                tx.total_bytes > 0
                  ? Math.min(100, Math.round((effectiveTransferred / tx.total_bytes) * 100))
                  : 0;

              const status = tx.status.toLowerCase();
              const isTransferring = status === 'transferring';
              const isPaused = status === 'paused';
              const isFinished = ['completed', 'failed', 'cancelled'].includes(status);

              return (
                <div
                  key={tx.id}
                  className="bg-[#131417] border border-[#222429] rounded-2xl p-4 flex flex-col space-y-3 hover:border-[#32353c] transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-zinc-800 text-zinc-200 border border-zinc-700/60">
                        {isUpload ? <UploadCloud className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-200 truncate" title={tx.name}>
                          {tx.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">
                          {isUpload ? 'Upload' : 'Download'} • {tx.package_id}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      <div className="text-right font-mono text-xs">
                        <span className="text-zinc-200 font-semibold">
                          {formatSize(effectiveTransferred)}
                        </span>
                        <span className="text-zinc-500"> / {formatSize(tx.total_bytes)}</span>
                      </div>

                      {getStatusBadge(tx.status)}

                      {/* Action Controls */}
                      <div className="flex items-center space-x-1 pl-2 border-l border-[#222429]">
                        {isTransferring && onPause && (
                          <button
                            onClick={() => onPause(tx.id)}
                            title="Pause Transfer"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 transition-colors"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isPaused && onResume && (
                          <button
                            onClick={() => onResume(tx.id)}
                            title="Resume Transfer"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {(isTransferring || isPaused) && onCancel && (
                          <button
                            onClick={() => onCancel(tx.id)}
                            title="Cancel Transfer & Clean Up"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isFinished && !isUpload && status === 'completed' && tx.destination_path && (
                          <button
                            onClick={async () => {
                              try {
                                await revealItemInDir(tx.destination_path!);
                              } catch (e) {
                                console.error('Failed to reveal item in dir:', e);
                              }
                            }}
                            title="Show in Folder"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isFinished && onDelete && (
                          <button
                            onClick={() => onDelete(tx.id)}
                            title="Remove from History"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Real-time stats strip */}
                  {isTransferring && stats && (
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 px-0.5">
                      <div className="flex items-center space-x-2">
                        {stats.stage && (
                          <span className="capitalize text-zinc-200 font-semibold">
                            {stats.stage.replace('_', ' ')}
                          </span>
                        )}
                        {stats.total_shards > 0 && (
                          <span>
                            • Shard {stats.current_shard}/{stats.total_shards}
                          </span>
                        )}
                        {stats.target_label && (
                          <span className="text-zinc-500">
                            ({stats.target_label})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-3">
                        {stats.speed_bps > 0 && (
                          <span className="text-zinc-200 font-semibold flex items-center space-x-1">
                            <Zap className="w-3 h-3 text-zinc-200" />
                            <span>{formatSpeed(stats.speed_bps)}</span>
                          </span>
                        )}
                        {stats.eta_seconds > 0 && (
                          <span className="text-zinc-400">
                            ⏱ ETA: {formatEta(stats.eta_seconds)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="w-full bg-[#18191d] rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        tx.status === 'completed'
                          ? 'bg-emerald-500'
                          : tx.status === 'paused'
                          ? 'bg-amber-500'
                          : tx.status === 'failed' || tx.status === 'cancelled'
                          ? 'bg-rose-500'
                          : 'bg-zinc-100'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  {tx.error_message && (
                    <div className="text-[11px] text-rose-400 font-mono bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
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
