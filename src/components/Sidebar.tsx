import React, { useState, useRef, useEffect } from 'react';
import {
  HardDrive,
  UploadCloud,
  ArrowUpDown,
  Activity,
  Settings,
  ChevronDown,
  Layers,
  PlusCircle,
  DownloadCloud,
  Trash2,
  Check,
  Shield,
} from 'lucide-react';
import { VaultRecord } from '../types';

export type ActiveTab = 'explorer' | 'upload' | 'transfers' | 'health' | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  vaults: VaultRecord[];
  activeVault: VaultRecord | null;
  onSelectVault: (vaultId: string) => void;
  onOpenCreateVault: () => void;
  onOpenImportVault: () => void;
  onDeleteVault: (vaultId: string) => Promise<void>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  vaults,
  activeVault,
  onSelectVault,
  onOpenCreateVault,
  onOpenImportVault,
  onDeleteVault,
}) => {
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicked outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setIsSwitcherOpen(false);
      }
    };

    if (isSwitcherOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSwitcherOpen]);

  const navItems = [
    { id: 'explorer', label: 'File Explorer', icon: HardDrive },
    { id: 'upload', label: 'Upload Files', icon: UploadCloud },
    { id: 'transfers', label: 'Transfer Queue', icon: ArrowUpDown },
    { id: 'health', label: 'Vault Health', icon: Activity },
    { id: 'settings', label: 'Settings & GCP', icon: Settings },
  ] as const;

  const handleDelete = async (e: React.MouseEvent, vaultId: string, vaultName: string) => {
    e.stopPropagation();
    if (confirm(`Hapus vault "${vaultName}" dari daftar aplikasi? (Data di Google Drive tidak akan terhapus)`)) {
      await onDeleteVault(vaultId);
    }
  };

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

        {/* Vault Switcher Popover */}
        <div className="p-3 border-b border-slate-800/80 relative" ref={switcherRef}>
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block px-1 mb-1.5">
            Personal Vault
          </label>
          <button
            onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
            className="w-full bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2.5 text-left flex items-center justify-between transition-all group shadow-inner"
          >
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-bold text-slate-200 truncate">
                  {activeVault ? activeVault.name : 'No Vault Selected'}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {activeVault ? `${activeVault.targets.length} target drive(s)` : 'Click to select or create'}
                </div>
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
                isSwitcherOpen ? 'rotate-180 text-cyan-400' : ''
              }`}
            />
          </button>

          {/* Dropdown Menu */}
          {isSwitcherOpen && (
            <div className="absolute top-[82px] left-3 right-3 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col py-1 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800/60">
                Your Vaults ({vaults.length})
              </div>

              <div className="max-h-48 overflow-y-auto py-1">
                {vaults.length === 0 ? (
                  <div className="px-3 py-3 text-center text-xs text-slate-500">
                    No vaults registered yet.
                  </div>
                ) : (
                  vaults.map((v) => {
                    const isCurrent = activeVault?.id === v.id;
                    return (
                      <div
                        key={v.id}
                        onClick={() => {
                          onSelectVault(v.id);
                          setIsSwitcherOpen(false);
                        }}
                        className={`px-3 py-2 flex items-center justify-between text-xs cursor-pointer transition-colors group ${
                          isCurrent
                            ? 'bg-cyan-500/10 text-cyan-400 font-semibold'
                            : 'text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate pr-2">
                          {isCurrent ? (
                            <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          ) : (
                            <div className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="truncate">{v.name}</span>
                        </div>

                        <button
                          title="Hapus vault ini"
                          onClick={(e) => handleDelete(e, v.id, v.name)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Actions Footer */}
              <div className="border-t border-slate-800/80 pt-1 p-1 space-y-0.5 bg-slate-900/40">
                <button
                  onClick={() => {
                    setIsSwitcherOpen(false);
                    onOpenCreateVault();
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Create New Vault</span>
                </button>
                <button
                  onClick={() => {
                    setIsSwitcherOpen(false);
                    onOpenImportVault();
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <DownloadCloud className="w-3.5 h-3.5 text-slate-400" />
                  <span>Import Token (.magvault)</span>
                </button>
              </div>
            </div>
          )}
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
