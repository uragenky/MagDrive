import React, { useState, useEffect } from 'react';
import {
  X,
  PlusCircle,
  DownloadCloud,
  AlertCircle,
  FolderLock,
  FileText,
  UploadCloud,
} from 'lucide-react';
import { VaultTarget } from '../types';
import { api } from '../services/api';

export type VaultModalMode = 'create' | 'import';

interface VaultModalProps {
  isOpen: boolean;
  initialMode?: VaultModalMode;
  onClose: () => void;
  onCreateVault: (name: string, passphrase: string, targets: VaultTarget[]) => Promise<void>;
  onImportVault: (token: string, passphrase: string) => Promise<void>;
}

export const VaultModal: React.FC<VaultModalProps> = ({
  isOpen,
  initialMode = 'create',
  onClose,
  onCreateVault,
  onImportVault,
}) => {
  const [activeTab, setActiveTab] = useState<VaultModalMode>(initialMode);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [newTargets, setNewTargets] = useState<VaultTarget[]>([
    { label: 'Primary Drive', target_type: 'SharedFolder', target_id: '' },
  ]);

  // Import form state
  const [importSourceType, setImportSourceType] = useState<'token' | 'file'>('file');
  const [importToken, setImportToken] = useState('');
  const [importJsonContent, setImportJsonContent] = useState('');
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [importPassphrase, setImportPassphrase] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialMode);
      setErrorMsg(null);
      setConfirmPassphrase('');
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPassphrase.trim()) {
      setErrorMsg('Vault name and passphrase are required.');
      return;
    }

    if (newPassphrase !== confirmPassphrase) {
      setErrorMsg('Passphrases do not match. Please verify your master passphrase.');
      return;
    }

    const validTargets = newTargets.filter((t) => t.target_id.trim() !== '');
    if (validTargets.length === 0) {
      setErrorMsg('At least one Google Drive Folder ID must be provided.');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMsg(null);
      await onCreateVault(newName.trim(), newPassphrase.trim(), validTargets);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Failed to create vault.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePickJsonFile = async () => {
    try {
      const content = await api.loadVaultJsonFromFile();
      if (content) {
        setImportJsonContent(content);
        try {
          const parsed = JSON.parse(content);
          setLoadedFileName(parsed.vault_name || 'Selected vault.json');
        } catch {
          setLoadedFileName('vault.json');
        }
        setErrorMsg(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Failed to read vault.json file.');
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importPassphrase.trim()) {
      setErrorMsg('Passphrase is required to unlock vault.');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMsg(null);

      if (importSourceType === 'file') {
        if (!importJsonContent.trim()) {
          setErrorMsg('Please select a vault.json file first.');
          setIsLoading(false);
          return;
        }
        await api.importVaultFromJson(importJsonContent.trim(), importPassphrase.trim());
        // Reload vaults list by calling onImportVault fallback or closing
        window.location.reload(); // Quick refresh or state update
      } else {
        if (!importToken.trim()) {
          setErrorMsg('Token string is required.');
          setIsLoading(false);
          return;
        }
        await onImportVault(importToken.trim(), importPassphrase.trim());
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Failed to import vault.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#131417] border border-[#222429] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#222429]">
          <div className="flex items-center space-x-2.5">
            <FolderLock className="w-5 h-5 text-zinc-300" />
            <h3 className="text-sm font-bold text-zinc-100">
              {activeTab === 'create' ? 'Create Vault' : 'Import Existing Vault'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-[#18191d] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex border-b border-[#222429] bg-[#18191d]/60 p-1 text-xs">
          <button
            onClick={() => {
              setActiveTab('create');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 rounded-lg font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              activeTab === 'create'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Create New Vault</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('import');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 rounded-lg font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              activeTab === 'import'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <DownloadCloud className="w-3.5 h-3.5" />
            <span>Import Existing Vault</span>
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

          {activeTab === 'create' && (
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="font-semibold text-zinc-400 block mb-1">Vault Name</label>
                <input
                  type="text"
                  placeholder="e.g. My Secure Drive"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="font-semibold text-zinc-400 block mb-1">
                  Master Passphrase
                </label>
                <input
                  type="password"
                  placeholder="Secret passphrase to lock and encrypt files"
                  value={newPassphrase}
                  onChange={(e) => setNewPassphrase(e.target.value)}
                  className="w-full bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
                />
                <p className="text-[10px] text-zinc-500 mt-1">
                  Zero-Knowledge: Used to encrypt and unlock your files. Keep this safe; it cannot be recovered if forgotten.
                </p>
              </div>

              <div>
                <label className="font-semibold text-zinc-400 block mb-1">
                  Confirm Master Passphrase
                </label>
                <input
                  type="password"
                  placeholder="Re-enter your master passphrase"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  className="w-full bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-zinc-400 block">
                    Google Drive Folder ID:
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setNewTargets([
                        ...newTargets,
                        {
                          label: `Drive ${newTargets.length + 1} (Parity)`,
                          target_type: 'SharedFolder',
                          target_id: '',
                        },
                      ])
                    }
                    className="text-[11px] text-zinc-300 hover:text-white font-semibold"
                  >
                    + Add Backup Drive (Optional)
                  </button>
                </div>
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
                        className="w-1/3 bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-500"
                      />
                      <input
                        type="text"
                        placeholder="Google Drive Folder ID"
                        value={t.target_id}
                        onChange={(e) => {
                          const copy = [...newTargets];
                          copy[idx].target_id = e.target.value;
                          setNewTargets(copy);
                        }}
                        className="flex-1 bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
                      />
                      {newTargets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setNewTargets(newTargets.filter((_, i) => i !== idx))}
                          className="px-2 text-zinc-500 hover:text-rose-400 text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500 mt-1.5">
                  1 drive is sufficient for basic encrypted storage. Adding 2 or more drives enables automatic parity redundancy and hardware failure protection.
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Tip: Open the folder in Google Drive and copy the code after <span className="font-mono text-zinc-400">/folders/</span> in your browser URL bar.
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl font-bold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50 mt-4"
              >
                {isLoading ? 'Creating Vault...' : 'Create Vault'}
              </button>
            </form>
          )}

          {activeTab === 'import' && (
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div className="flex border border-[#26282e] rounded-lg p-1 bg-[#18191d] text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setImportSourceType('file');
                    setErrorMsg(null);
                  }}
                  className={`flex-1 py-1.5 rounded-md font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                    importSourceType === 'file'
                      ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>From vault.json File</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportSourceType('token');
                    setErrorMsg(null);
                  }}
                  className={`flex-1 py-1.5 rounded-md font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                    importSourceType === 'token'
                      ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>From Base64 Token</span>
                </button>
              </div>

              {importSourceType === 'file' ? (
                <div>
                  <label className="font-semibold text-zinc-400 block mb-1">
                    Select Backup File (vault.json):
                  </label>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handlePickJsonFile}
                      className="flex-1 py-2.5 px-3 bg-[#18191d] hover:bg-[#222428] border border-[#26282e] rounded-xl text-zinc-300 text-xs flex items-center justify-center space-x-2 transition-all font-mono"
                    >
                      <FileText className="w-4 h-4 text-zinc-300" />
                      <span>{loadedFileName ? loadedFileName : 'Browse vault.json file...'}</span>
                    </button>
                    {importJsonContent && (
                      <span className="text-[11px] text-emerald-400 font-semibold shrink-0">✓ File loaded</span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    * Choose a backup file previously saved on your hard drive or USB drive.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="font-semibold text-zinc-400 block mb-1">
                    Paste Vault Export Token (.magvault):
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Paste encrypted base64 vault token string here..."
                    value={importToken}
                    onChange={(e) => setImportToken(e.target.value)}
                    className="w-full bg-[#18191d] border border-[#26282e] rounded-lg p-3 text-zinc-200 font-mono text-xs focus:outline-none focus:border-zinc-500"
                  />
                </div>
              )}

              <div>
                <label className="font-semibold text-zinc-400 block mb-1">
                  Vault Passphrase
                </label>
                <input
                  type="password"
                  placeholder="Passphrase used when this vault was created"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  className="w-full bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl font-bold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50 mt-2"
              >
                {isLoading ? 'Unlocking Vault...' : 'Unlock & Import Vault'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
