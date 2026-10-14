import React from 'react';
import { RefreshCw, Link as LinkIcon, PlusCircle, ShieldCheck } from 'lucide-react';
import { VaultRecord } from '../types';

interface NavbarProps {
  activeVault: VaultRecord | null;
  onOpenMagnetModal: () => void;
  onOpenVaultModal: () => void;
  onSync: () => void;
  isSyncing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeVault,
  onOpenMagnetModal,
  onOpenVaultModal,
  onSync,
  isSyncing,
}) => {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 flex items-center justify-between z-10">
      <div className="flex items-center space-x-3">
        {activeVault ? (
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-slate-100">{activeVault.name}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase">
                {activeVault.role}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {activeVault.targets.length} Target Drive Terhubung • Enkripsi AES-256 Aktif
            </p>
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-slate-400 text-sm">
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            <span>Pilih atau Buat Vault Grup untuk Memulai</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenMagnetModal}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 hover:border-cyan-500/50 transition-all shadow-sm"
        >
          <LinkIcon className="w-3.5 h-3.5" />
          <span>Buka Magnet</span>
        </button>

        {activeVault && (
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Menyinkronkan...' : 'Sinkronisasi'}</span>
          </button>
        )}

        <button
          onClick={onOpenVaultModal}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-sm shadow-cyan-600/30"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Kelola Vault</span>
        </button>
      </div>
    </header>
  );
};
