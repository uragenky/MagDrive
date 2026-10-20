import React from 'react';
import {
  HardDrive,
  UploadCloud,
  ArrowUpDown,
  Activity,
  Settings,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { VaultRecord } from '../types';

export type ActiveTab = 'explorer' | 'upload' | 'transfers' | 'health' | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  vaults: VaultRecord[];
  activeVault: VaultRecord | null;
  onSelectVault: (vaultId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  vaults,
  activeVault,
  onSelectVault,
}) => {
  const navItems = [
    { id: 'explorer', label: 'File Explorer', icon: HardDrive },
    { id: 'upload', label: 'Upload Files', icon: UploadCloud },
    { id: 'transfers', label: 'Transfer Queue', icon: ArrowUpDown },
    { id: 'health', label: 'Vault Health', icon: Activity },
    { id: 'settings', label: 'Settings & GCP', icon: Settings },
  ] as const;

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col justify-between select-none">
      <div>
        {/* Brand */}
        <div className="h-16 border-b border-slate-800 px-6 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-sky-400 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center space-x-1.5">
              <span>MagDrive</span>
            </h1>
            <p className="text-[10px] text-cyan-400/80 font-mono tracking-wider uppercase">
              Zero-Knowledge Vault
            </p>
          </div>
        </div>

        {/* Vault Selector */}
        <div className="p-4 border-b border-slate-800/80">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
            Active Vault
          </label>
          <div className="relative">
            <select
              value={activeVault?.id || ''}
              onChange={(e) => onSelectVault(e.target.value)}
              className="w-full appearance-none bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer pr-8"
            >
              {vaults.length === 0 ? (
                <option value="">(No Vault Selected)</option>
              ) : (
                vaults.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Nav Links */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 text-[11px] text-slate-500 font-mono">
        <div className="flex items-center justify-between">
          <span>Engine: Reed-Solomon</span>
          <span className="text-emerald-400 font-semibold">Active</span>
        </div>
        <div className="text-[10px] text-slate-600 mt-1">AES-256-GCM Zero-Knowledge</div>
      </div>
    </aside>
  );
};
