import React from 'react';
import { Link as LinkIcon, ShieldCheck } from 'lucide-react';
import { VaultRecord } from '../types';

interface NavbarProps {
  activeVault: VaultRecord | null;
  onOpenMagnetModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeVault,
  onOpenMagnetModal,
}) => {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 flex items-center justify-between z-10">
      <div className="flex items-center space-x-3">
        {activeVault ? (
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-slate-100">{activeVault.name}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-wider">
                Personal Vault
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {activeVault.targets.length} Target Drive{activeVault.targets.length > 1 ? 's' : ''} Connected • AES-256 Zero-Knowledge
            </p>
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-slate-400 text-sm">
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            <span>Select or Create a Personal Vault in Sidebar</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenMagnetModal}
          className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/25"
        >
          <LinkIcon className="w-3.5 h-3.5" />
          <span>+ Add Magnet Link</span>
        </button>
      </div>
    </header>
  );
};
