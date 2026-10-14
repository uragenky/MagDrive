import React, { useState } from 'react';
import {
  X,
  Trash2,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { VaultRecord, VaultTarget } from '../types';

interface VaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  vaults: VaultRecord[];
  activeVault: VaultRecord | null;
  onSelectVault: (vaultId: string) => void;
  onCreateVault: (name: string, passphrase: string, targets: VaultTarget[]) => Promise<void>;
  onImportVault: (token: string, passphrase: string) => Promise<void>;
  onDeleteVault: (vaultId: string) => Promise<void>;
}

export const VaultModal: React.FC<VaultModalProps> = ({
  isOpen,
  onClose,
  vaults,
  activeVault,
  onSelectVault,
  onCreateVault,
  onImportVault,
  onDeleteVault,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'import' | 'list'>('list');

  // Create form state
  const [newName, setNewName] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [newTargets, setNewTargets] = useState<VaultTarget[]>([
    { label: 'Drive Alpha (Data 1)', target_type: 'SharedDrive', target_id: '' },
    { label: 'Drive Beta (Data 2)', target_type: 'SharedDrive', target_id: '' },
    { label: 'Drive Gamma (Parity)', target_type: 'SharedDrive', target_id: '' },
  ]);

  // Import form state
  const [importToken, setImportToken] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPassphrase.trim()) {
      setErrorMsg('Nama vault dan passphrase wajib diisi.');
      return;
    }

    const validTargets = newTargets.filter((t) => t.target_id.trim() !== '');
    if (validTargets.length === 0) {
      setErrorMsg('Minimal satu ID Shared Drive atau Folder harus diisi.');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMsg(null);
      await onCreateVault(newName.trim(), newPassphrase.trim(), validTargets);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Gagal membuat vault.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importToken.trim() || !importPassphrase.trim()) {
      setErrorMsg('Token dan passphrase wajib diisi.');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMsg(null);
      await onImportVault(importToken.trim(), importPassphrase.trim());
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Gagal mengimpor vault.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">Kelola Bank Data & Vault Grup</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-900/60 p-1 text-xs">
          <button
            onClick={() => {
              setActiveTab('list');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
              activeTab === 'list'
                ? 'bg-slate-800 text-cyan-400 shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Daftar Vault ({vaults.length})
          </button>
          <button
            onClick={() => {
              setActiveTab('create');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
              activeTab === 'create'
                ? 'bg-slate-800 text-cyan-400 shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Buat Vault Baru
          </button>
          <button
            onClick={() => {
              setActiveTab('import');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
              activeTab === 'import'
                ? 'bg-slate-800 text-cyan-400 shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Impor Token Vault
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 text-xs space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'list' && (
            <div className="space-y-3">
              {vaults.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  Belum ada vault tersimpan. Buat vault baru atau impor token untuk memulai.
                </div>
              ) : (
                vaults.map((v) => {
                  const isActive = activeVault?.id === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => onSelectVault(v.id)}
                      className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                        isActive
                          ? 'bg-cyan-500/10 border-cyan-500/40 text-slate-100 shadow-sm'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-slate-100">{v.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-800 text-cyan-400 border border-slate-700 uppercase">
                            {v.role}
                          </span>
                          {isActive && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              Aktif
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 font-mono">
                          {v.targets.length} Target Drive/Folder • ID: {v.id}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Hapus vault ${v.name} dari perangkat ini?`)) {
                            onDeleteVault(v.id);
                          }
                        }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                        title="Hapus Vault"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'create' && (
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="font-semibold text-slate-400 block mb-1">Nama Vault / Grup</label>
                <input
                  type="text"
                  placeholder="Contoh: Tim Alpha Project"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-400 block mb-1">
                  Master Passphrase (Kunci Enkripsi Argon2id)
                </label>
                <input
                  type="password"
                  placeholder="Kata sandi rahasia untuk enkripsi grup"
                  value={newPassphrase}
                  onChange={(e) => setNewPassphrase(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-400 block mb-1">
                  Target Google Workspace Shared Drive / Folder ID:
                </label>
                <div className="space-y-2">
                  {newTargets.map((t, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        placeholder={`Label ${idx + 1}`}
                        value={t.label}
                        onChange={(e) => {
                          const copy = [...newTargets];
                          copy[idx].label = e.target.value;
                          setNewTargets(copy);
                        }}
                        className="w-1/3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                      <input
                        type="text"
                        placeholder="Shared Drive / Folder ID (Contoh: 0AJk...)"
                        value={t.target_id}
                        onChange={(e) => {
                          const copy = [...newTargets];
                          copy[idx].target_id = e.target.value;
                          setNewTargets(copy);
                        }}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-lg font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50 mt-4"
              >
                {isLoading ? 'Membuat Vault...' : 'Buat Vault Baru Sekarang'}
              </button>
            </form>
          )}

          {activeTab === 'import' && (
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div>
                <label className="font-semibold text-slate-400 block mb-1">
                  Tempelkan Token Ekspor Vault (.magvault):
                </label>
                <textarea
                  rows={4}
                  placeholder="Tempel string base64 token vault di sini..."
                  value={importToken}
                  onChange={(e) => setImportToken(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-cyan-500 resize-none"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-400 block mb-1">
                  Passphrase Vault:
                </label>
                <input
                  type="password"
                  placeholder="Kata sandi pembuka kunci vault"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50 mt-4"
              >
                {isLoading ? 'Mengimpor...' : 'Impor & Buka Kunci Vault'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
