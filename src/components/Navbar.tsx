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
    <header className="h-16 border-b border-[#202226] bg-[#0c0d0e]/85 backdrop-blur-md px-6 flex items-center justify-between z-10 select-none">
      <div className="flex items-center space-x-3">
        {activeVault ? (
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-zinc-100">{activeVault.name}</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 uppercase tracking-wider">
                Personal Vault
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              {activeVault.targets.length} Storage Drive{activeVault.targets.length > 1 ? 's' : ''} • End-to-End Encrypted
            </p>
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-zinc-400 text-sm">
            <ShieldCheck className="w-4 h-4 text-zinc-500" />
            <span>Select or create a vault in the sidebar to get started</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenMagnetModal}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20"
        >
          <LinkIcon className="w-3.5 h-3.5" />
          <span>Add Magnet Link</span>
        </button>
      </div>
    </header>
  );
};
