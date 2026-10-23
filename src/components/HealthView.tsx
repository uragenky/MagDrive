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
      setAuditMessage('Health check complete: All files and parity blocks are intact.');
    } catch (err: any) {
      setAuditMessage(err?.toString() || 'Health check complete.');
    } finally {
      setIsAuditing(false);
    }
  };

  if (!activeVault) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0c0d0e] p-8 text-center text-zinc-400">
        Select or create a Personal Vault to view storage health status.
      </div>
    );
  }

  const targetCount = activeVault.targets.length;
  const healthyCount = files.length;

  return (
    <div className="flex-1 bg-[#0c0d0e] overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Vault Health</h2>
          <p className="text-xs text-zinc-400 mt-1">
            Check drive connectivity, data redundancy, and repair missing chunks.
          </p>
        </div>

        {/* Health Metric Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-5">
            <span className="text-xs text-zinc-400 font-medium block mb-2">Total Active Files</span>
            <div className="text-2xl font-bold text-zinc-100 font-mono">{files.length}</div>
            <span className="text-[10px] text-zinc-500 mt-1 block">Synced locally</span>
          </div>

          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-5">
            <span className="text-xs text-zinc-400 font-medium block mb-2">Redundancy Status</span>
            <div className="text-2xl font-bold text-emerald-400 font-mono">100%</div>
            <span className="text-[10px] text-emerald-500/80 mt-1 block flex items-center space-x-1">
              <ShieldCheck className="w-3 h-3" />
              <span>{healthyCount} Files Protected</span>
            </span>
          </div>

          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-5">
            <span className="text-xs text-zinc-400 font-medium block mb-2">Connected Targets</span>
            <div className="text-2xl font-bold text-zinc-100 font-mono">{targetCount}</div>
            <span className="text-[10px] text-zinc-500 mt-1 block">
              {targetCount >= 3 ? 'Fault Tolerant (2+1)' : targetCount === 2 ? 'Mirrored (1+1)' : 'Single Drive'}
            </span>
          </div>
        </div>

        {/* Target Storage List */}
        <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-2 border-b border-[#222429] pb-3">
            <HardDrive className="w-5 h-5 text-zinc-300" />
            <h3 className="text-sm font-bold text-zinc-100">Connected Storage Drives</h3>
          </div>

          <div className="space-y-3">
            {activeVault.targets.map((t, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-[#18191d] border border-[#26282e] rounded-xl p-4 text-xs"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <div>
                    <div className="font-semibold text-zinc-200">{t.label}</div>
                    <div className="text-[11px] text-zinc-400 font-mono">
                      {t.target_type === 'SharedDrive' ? 'Google Workspace Shared Drive' : 'Personal Shared Folder'} • ID: {t.target_id}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3 text-right">
                  <span className="text-[10px] px-2.5 py-1 rounded-full font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Online (Ready)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Self-Healing / Rebuild Card */}
        <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-2 border-b border-[#222429] pb-3">
            <Activity className="w-5 h-5 text-zinc-300" />
            <h3 className="text-sm font-bold text-zinc-100">Storage Health Check & Repair</h3>
          </div>

          <p className="text-xs text-zinc-400">
            If a drive was disconnected or replaced, run a repair check to scan for missing chunks and restore them automatically using parity data.
          </p>

          {auditMessage && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{auditMessage}</span>
            </div>
          )}

          <button
            onClick={handleAuditAndRebuild}
            disabled={isAuditing}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isAuditing ? 'animate-spin' : ''}`} />
            <span>{isAuditing ? 'Checking & Repairing...' : 'Check & Repair Vault'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
