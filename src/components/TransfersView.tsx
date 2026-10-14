import React from 'react';
import {
  ArrowUpDown,
  UploadCloud,
  Download,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { TransferRecord } from '../types';

interface TransfersViewProps {
  transfers: TransferRecord[];
}

export const TransfersView: React.FC<TransfersViewProps> = ({ transfers }) => {
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
            <span>Selesai</span>
          </span>
        );
      case 'transferring':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            <ArrowUpDown className="w-3 h-3" />
            <span>Transfer Aktif</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3 h-3" />
            <span>Gagal</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <Clock className="w-3 h-3" />
            <span>Menunggu</span>
          </span>
        );
    }
  };

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Daftar Antrean & Riwayat Transfer</h2>
          <p className="text-xs text-slate-400 mt-1">
            Status transfer chunk, enkripsi, dan rekonstruksi paritas berkas.
          </p>
        </div>

        {transfers.length === 0 ? (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mx-auto mb-3">
              <ArrowUpDown className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-slate-300 mb-1">
              Belum Ada Aktivitas Transfer
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Ketika Anda mengunggah atau mengunduh berkas, progres transfer per chunk akan tercatat di
              sini secara otomatis.
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
                          {isUpload ? 'Unggah' : 'Unduh'} • {tx.package_id}
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
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        tx.status === 'completed'
                          ? 'bg-emerald-500'
                          : tx.status === 'failed'
                          ? 'bg-rose-500'
                          : 'bg-cyan-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  {tx.error_message && (
                    <div className="text-[11px] text-rose-400 font-mono bg-rose-500/10 border border-rose-500/20 rounded p-2">
                      Galat: {tx.error_message}
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
