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
  onDeleteVault: (vaultId: string, vaultName?: string) => void | Promise<void>;
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

  const handleDelete = (e: React.MouseEvent, vaultId: string, vaultName: string) => {
    e.stopPropagation();
    onDeleteVault(vaultId, vaultName);
  };

  return (
    <aside className="w-64 border-r border-[#202226] bg-[#0f1012] flex flex-col justify-between select-none z-10">
      <div>
        {/* Brand */}
        <div className="h-16 border-b border-[#202226] px-6 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-b from-zinc-100 to-zinc-300 text-zinc-950 flex items-center justify-center shadow-sm border border-white/20">
            <Layers className="w-5 h-5 text-zinc-900" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-zinc-100 flex items-center space-x-1.5">
              <span>MagDrive</span>
            </h1>
            <p className="text-[10px] text-zinc-400 font-mono tracking-wider uppercase">
              Zero-Knowledge Storage
            </p>
          </div>
        </div>

        {/* Vault Switcher Popover */}
        <div className="p-3 border-b border-[#202226] relative" ref={switcherRef}>
          <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block px-1 mb-1.5">
            Personal Vault
          </label>
          <button
            onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
            className="w-full bg-[#16171a] hover:bg-[#1c1e22] border border-[#26282d] hover:border-[#35383f] rounded-xl px-3 py-2.5 text-left flex items-center justify-between transition-all group"
          >
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center shrink-0">
                <Shield className="w-3.5 h-3.5 text-zinc-300" />
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-bold text-zinc-200 truncate">
                  {activeVault ? activeVault.name : 'No Vault Selected'}
                </div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {activeVault ? `${activeVault.targets.length} target drive(s)` : 'Click to select or create'}
                </div>
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-zinc-400 transition-transform duration-200 shrink-0 ${
                isSwitcherOpen ? 'rotate-180 text-zinc-200' : ''
              }`}
            />
          </button>

          {/* Dropdown Menu */}
          {isSwitcherOpen && (
            <div className="absolute top-[82px] left-3 right-3 bg-[#151619] border border-[#282a30] rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col py-1 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-[#202226]">
                Your Vaults ({vaults.length})
              </div>

              <div className="max-h-48 overflow-y-auto py-1">
                {vaults.length === 0 ? (
                  <div className="px-3 py-3 text-center text-xs text-zinc-500">
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
                            ? 'bg-zinc-800 text-zinc-100 font-semibold'
                            : 'text-zinc-300 hover:bg-[#1a1c20]'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate pr-2">
                          {isCurrent ? (
                            <Check className="w-3.5 h-3.5 text-zinc-100 shrink-0" />
                          ) : (
                            <div className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="truncate">{v.name}</span>
                        </div>

                        <button
                          title="Remove this vault"
                          onClick={(e) => handleDelete(e, v.id, v.name)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-all shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Actions Footer */}
              <div className="border-t border-[#202226] pt-1 p-1 space-y-0.5 bg-[#121316]">
                <button
                  onClick={() => {
                    setIsSwitcherOpen(false);
                    onOpenCreateVault();
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-200 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Create New Vault</span>
                </button>
                <button
                  onClick={() => {
                    setIsSwitcherOpen(false);
                    onOpenImportVault();
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  <span>Import Existing Vault</span>
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
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#16171a]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-[#202226] text-[11px] text-zinc-500 font-mono">
        <div className="flex items-center justify-between">
          <span>Vault Status</span>
          <span className="text-emerald-400 font-medium">Active</span>
        </div>
        <div className="text-[10px] text-zinc-600 mt-1">Zero-Knowledge Encryption</div>
      </div>
    </aside>
  );
};
