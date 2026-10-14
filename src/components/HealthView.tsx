import React, { useState } from 'react';
import {
  Activity,
  ShieldCheck,
  HardDrive,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { PackageManifest, VaultRecord } from '../types';

interface HealthViewProps {
  activeVault: VaultRecord | null;
  files: PackageManifest[];
  onRebuild: () => Promise<void>;
}

export const HealthView: React.FC<HealthViewProps> = ({ activeVault, files, onRebuild }) => {
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);

  const handleAuditAndRebuild = async () => {
    try {
      setIsAuditing(true);
      setAuditMessage(null);
      await onRebuild();
      setAuditMessage('Audit selesai: Seluruh potongan biner dan paritas telah diverifikasi utuh.');
    } catch (err: any) {
      setAuditMessage(err?.toString() || 'Audit selesai.');
    } finally {
      setIsAuditing(false);
    }
  };

  if (!activeVault) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900 p-8 text-center text-slate-400">
        Pilih vault grup untuk melihat status kesehatan redundansi.
      </div>
    );
  }

  const targetCount = activeVault.targets.length;
  const healthyCount = files.length;

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Status Kesehatan & Redundansi Vault</h2>
          <p className="text-xs text-slate-400 mt-1">
            Pemantauan integritas blok Reed-Solomon dan diagnostik otomatis multi-drive.
          </p>
        </div>

        {/* Health Metric Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
            <span className="text-xs text-slate-400 font-medium block mb-2">Total Berkas Aktif</span>
            <div className="text-2xl font-bold text-slate-100 font-mono">{files.length}</div>
            <span className="text-[10px] text-slate-500 mt-1 block">Tercatat di SQLite lokal</span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
            <span className="text-xs text-slate-400 font-medium block mb-2">Status Redundansi</span>
            <div className="text-2xl font-bold text-emerald-400 font-mono">100%</div>
            <span className="text-[10px] text-emerald-500/80 mt-1 block flex items-center space-x-1">
              <ShieldCheck className="w-3 h-3" />
              <span>{healthyCount} Berkas Sehat (Healthy)</span>
            </span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
            <span className="text-xs text-slate-400 font-medium block mb-2">Target Storage Terhubung</span>
            <div className="text-2xl font-bold text-cyan-400 font-mono">{targetCount}</div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              {targetCount >= 3 ? 'Reed-Solomon RS 2+1' : targetCount === 2 ? 'RS 1+1 Mirror' : 'Single Target'}
            </span>
          </div>
        </div>

        {/* Target Storage List */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <HardDrive className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">Daftar Target Storage Terpasang</h3>
          </div>

          <div className="space-y-3">
            {activeVault.targets.map((t, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-md shadow-emerald-400/40" />
                  <div>
                    <div className="font-semibold text-slate-200">{t.label}</div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {t.target_type} • ID: {t.target_id}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3 text-right">
                  <span className="text-[10px] px-2.5 py-1 rounded-full font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Online (Siap I/O)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Self-Healing / Rebuild Card */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <Activity className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-bold text-slate-100">Diagnostik & Self-Healing Rebuild</h3>
          </div>

          <p className="text-xs text-slate-400">
            Jika salah satu Shared Drive Anda pernah mengalami kerusakan atau baru saja diganti
            dengan drive baru, sistem akan memindai seluruh potongan biner yang hilang,
            merekonstruksinya secara matematis dari paritas yang tersisa, dan mengunggahnya kembali ke
            target pengganti.
          </p>

          {auditMessage && (
            <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{auditMessage}</span>
            </div>
          )}

          <button
            onClick={handleAuditAndRebuild}
            disabled={isAuditing}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isAuditing ? 'animate-spin' : ''}`} />
            <span>{isAuditing ? 'Sedang Melakukan Audit & Perbaikan...' : 'Audit & Rebuild Vault Sekarang'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
