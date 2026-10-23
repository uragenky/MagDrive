import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle2, FolderOpen, ExternalLink, X } from 'lucide-react';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import './App.css';

import { Sidebar, ActiveTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { ExplorerView } from './components/ExplorerView';
import { UploadView } from './components/UploadView';
import { TransfersView } from './components/TransfersView';
import { SettingsView } from './components/SettingsView';
import { HealthView } from './components/HealthView';
import { MagnetModal } from './components/MagnetModal';
import { VaultModal, VaultModalMode } from './components/VaultModal';
import { DownloadModal } from './components/DownloadModal';

import { PackageManifest, TransferRecord, VaultRecord, VaultTarget, TransferProgressPayload } from './types';
import { api } from './services/api';
import { ToastContainer, ToastMessage, ToastType } from './components/ui/Toast';
import { ConfirmModal, ConfirmDialogOptions } from './components/ui/ConfirmModal';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('explorer');
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [activeVault, setActiveVault] = useState<VaultRecord | null>(null);
  const [files, setFiles] = useState<PackageManifest[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const [stagedUploadFile, setStagedUploadFile] = useState<File | null>(null);
  const [downloadToast, setDownloadToast] = useState<{
    fileName: string;
    destinationPath: string;
  } | null>(null);

  const addToast = (type: ToastType, message: string, title?: string) => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    setToasts((prev) => [...prev, { id, type, title, message }]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Modals
  const [isMagnetModalOpen, setIsMagnetModalOpen] = useState(false);
  const [vaultModalMode, setVaultModalMode] = useState<VaultModalMode | null>(null);
  const [downloadModalTarget, setDownloadModalTarget] = useState<{
    packageId: string;
    fileName: string;
    fileSize?: number;
    originalSha256?: string;
  } | null>(null);

  useEffect(() => {
    loadInitialData();

    // Listen for OAuth success event
    const unlistenOAuth = listen('oauth-success', () => {
      addToast(
        'success',
        'Google Workspace account authenticated and connected successfully!',
        'Account Connected'
      );
    });

    // Listen for transfer progress updates
    const unlistenProgress = listen('transfer-progress', () => {
      refreshTransfers();
    });

    return () => {
      unlistenOAuth.then((f) => f());
      unlistenProgress.then((f) => f());
    };
  }, []);

  const loadInitialData = async () => {
    try {
      const vList = await api.listVaults();
      setVaults(vList);

      const currentVault = await api.getActiveVault();
      setActiveVault(currentVault);

      if (currentVault) {
        const fileList = await api.listCatalogFiles();
        setFiles(fileList);
      }

      const txList = await api.listTransfers();
      setTransfers(txList);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  };

  const refreshFiles = async () => {
    try {
      const fileList = await api.listCatalogFiles();
      setFiles(fileList);
    } catch (err) {
      console.error('Error refreshing files:', err);
    }
  };

  const refreshTransfers = async () => {
    try {
      const txList = await api.listTransfers();
      setTransfers(txList);
    } catch (err) {
      console.error('Error refreshing transfers:', err);
    }
  };

  const handleSelectVault = async (vaultId: string) => {
    try {
      await api.setActiveVault(vaultId);
      const v = vaults.find((item) => item.id === vaultId) || null;
      setActiveVault(v);
      const fileList = await api.listCatalogFiles();
      setFiles(fileList);

      // Automatically synchronize catalog from remote drive in background if targets exist
      if (v && v.targets && v.targets.length > 0) {
        api.syncCatalog()
          .then(() => refreshFiles())
          .catch((e) => console.warn('Background auto-sync failed:', e));
      }
    } catch (err) {
      console.error('Failed to switch vault:', err);
    }
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      await api.syncCatalog();
      await refreshFiles();
      addToast('success', 'Catalog synchronized successfully with remote storage.', 'Catalog Synced');
    } catch (err: any) {
      addToast('error', 'Failed to sync catalog: ' + (err?.toString() || ''), 'Sync Error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopyMagnet = async (packageId: string) => {
    try {
      const magnetLink = await api.generateMagnet(packageId);
      await navigator.clipboard.writeText(magnetLink);
      addToast('success', 'Magnet Link copied to clipboard.', 'Copied');
    } catch (err) {
      addToast('error', 'Failed to generate magnet: ' + String(err), 'Error');
    }
  };

  const handleDownload = async (packageId: string) => {
    try {
      const pkg = files.find((f) => f.package_id === packageId);
      const fileName = pkg ? pkg.name : `download_${packageId}.bin`;

      // 1. Fetch user's download preferences
      const settings = await api.getDownloadSettings();

      // 2. If prompt_save_location is enabled, open interactive in-app DownloadModal
      if (settings.prompt_save_location) {
        setDownloadModalTarget({
          packageId,
          fileName,
          fileSize: pkg?.total_size,
          originalSha256: pkg?.original_sha256,
        });
        return;
      }

      // 3. Otherwise, automatically download to default download folder
      const destinationPath = await api.resolveDownloadPath(settings.download_dir, fileName);
      try {
        await executeDownload(packageId, destinationPath, fileName);
      } catch (err: any) {
        addToast('error', 'Failed to download file: ' + (err?.toString() || ''), 'Download Error');
      }
    } catch (err: any) {
      addToast('error', 'Failed to prepare download: ' + (err?.toString() || ''), 'Download Error');
    }
  };

  const executeDownload = async (packageId: string, destinationPath: string, displayName?: string) => {
    try {
      setIsDownloading(packageId);
      const result = await api.downloadPackage(packageId, destinationPath);
      await refreshTransfers();

      // Show success toast with quick action to open folder or file
      setDownloadToast({
        fileName: displayName || destinationPath.split(/[/\\]/).pop() || 'file',
        destinationPath: result.destination_path,
      });
      addToast('success', `File downloaded successfully to ${result.destination_path}`, 'Download Complete');
    } catch (err: any) {
      console.error('Download error:', err);
      throw err;
    } finally {
      setIsDownloading(null);
    }
  };

  const handleDelete = (packageId: string) => {
    const pkg = files.find((f) => f.package_id === packageId);
    const fileName = pkg ? pkg.name : packageId;

    setConfirmDialog({
      title: 'Delete Vault File',
      message: `Permanently delete "${fileName}" from this vault and all cloud storage targets? This action cannot be undone.`,
      confirmText: 'Delete File',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deletePackage(packageId);
          await refreshFiles();
          addToast('success', `"${fileName}" deleted successfully.`, 'File Deleted');
        } catch (err: any) {
          addToast('error', 'Failed to delete file: ' + (err?.toString() || ''), 'Error');
        }
      },
    });
  };

  const handleUploadFile = async (
    file: File,
    passphrase?: string,
    onProgress?: (progress: TransferProgressPayload) => void
  ): Promise<string> => {
    const pkgId = await api.uploadFileStream(file, passphrase, onProgress);
    await refreshFiles();
    await refreshTransfers();
    return pkgId;
  };

  const handlePauseTransfer = async (transferId: string) => {
    await api.pauseTransfer(transferId);
    await refreshTransfers();
  };

  const handleResumeTransfer = async (transferId: string) => {
    await api.resumeTransfer(transferId);
    await refreshTransfers();
  };

  const handleCancelTransfer = (transferId: string) => {
    setConfirmDialog({
      title: 'Cancel Transfer',
      message: 'Cancel this transfer? Incomplete chunks will be deleted from Google Drive.',
      confirmText: 'Cancel Transfer',
      variant: 'warning',
      onConfirm: async () => {
        try {
          await api.cancelTransfer(transferId);
          await refreshTransfers();
          addToast('info', 'Transfer cancelled and incomplete chunks removed.', 'Transfer Cancelled');
        } catch (err: any) {
          addToast('error', 'Failed to cancel transfer: ' + (err?.toString() || ''), 'Error');
        }
      },
    });
  };

  const handleDeleteTransfer = async (transferId: string) => {
    await api.deleteTransfer(transferId);
    await refreshTransfers();
  };

  const handleClearFinished = async () => {
    await api.clearFinishedTransfers();
    await refreshTransfers();
    addToast('info', 'Finished transfers cleared from queue.', 'Queue Updated');
  };

  const handleCreateVault = async (
    name: string,
    passphrase: string,
    targets: VaultTarget[],
    autoAccountEmails?: string[]
  ) => {
    const record = await api.createVault(name, passphrase, targets);
    if (autoAccountEmails && autoAccountEmails.length > 0) {
      for (const email of autoAccountEmails) {
        try {
          await api.autoAddAccountTarget(record.id, email);
        } catch (e) {
          console.error(`Failed to auto-add target for ${email}:`, e);
        }
      }
    }
    const vList = await api.listVaults();
    setVaults(vList);
    const updated = vList.find((v) => v.id === record.id) || record;
    setActiveVault(updated);
    await refreshFiles();
    addToast('success', `Vault "${name}" created successfully!`, 'Vault Created');
  };

  const handleImportVault = async (token: string, passphrase: string) => {
    const record = await api.importVaultConfig(token, passphrase);
    const vList = await api.listVaults();
    setVaults(vList);
    setActiveVault(record);
    await refreshFiles();
    addToast('success', `Vault "${record.name}" imported successfully!`, 'Vault Imported');
  };

  const handleDeleteVault = (vaultId: string, vaultName?: string) => {
    const name = vaultName || vaults.find((v) => v.id === vaultId)?.name || 'this vault';

    setConfirmDialog({
      title: 'Remove Vault',
      message: `Remove vault "${name}" from your local application list? Your encrypted chunks stored in Google Drive will remain intact.`,
      confirmText: 'Remove Vault',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteVault(vaultId);
          const vList = await api.listVaults();
          setVaults(vList);
          if (activeVault?.id === vaultId) {
            setActiveVault(vList[0] || null);
          }
          await refreshFiles();
          addToast('info', `Vault "${name}" removed from local list.`, 'Vault Removed');
        } catch (err: any) {
          addToast('error', 'Failed to remove vault: ' + (err?.toString() || ''), 'Error');
        }
      },
    });
  };

  const handleUpdateTargets = async (targets: VaultTarget[]) => {
    if (!activeVault) return;
    const updated = { ...activeVault, targets };
    // Save to local vault record
    await api.createVault(activeVault.name, 'magdrive', targets);
    setActiveVault(updated);
  };

  const handleRebuild = async () => {
    await handleSync();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0c0d0e] font-sans antialiased text-zinc-100 relative">
      <div className="tactile-grain" aria-hidden="true" />
      {/* Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        vaults={vaults}
        activeVault={activeVault}
        onSelectVault={handleSelectVault}
        onOpenCreateVault={() => setVaultModalMode('create')}
        onOpenImportVault={() => setVaultModalMode('import')}
        onDeleteVault={handleDeleteVault}
      />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Navbar
          activeVault={activeVault}
          onOpenMagnetModal={() => setIsMagnetModalOpen(true)}
        />

        <main className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'explorer' && (
            <ExplorerView
              files={files}
              onDownload={handleDownload}
              onDelete={handleDelete}
              onCopyMagnet={handleCopyMagnet}
              onGoToUpload={() => {
                setStagedUploadFile(null);
                setActiveTab('upload');
              }}
              isDownloading={isDownloading}
              onSync={handleSync}
              isSyncing={isSyncing}
              onFileDrop={(file) => {
                setStagedUploadFile(file);
                setActiveTab('upload');
              }}
            />
          )}

          {activeTab === 'upload' && (
            <UploadView
              activeVault={activeVault}
              onUploadFile={handleUploadFile}
              onGoToExplorer={() => {
                setStagedUploadFile(null);
                setActiveTab('explorer');
              }}
              initialFile={stagedUploadFile}
            />
          )}

          {activeTab === 'transfers' && (
            <TransfersView
              transfers={transfers}
              onPause={handlePauseTransfer}
              onResume={handleResumeTransfer}
              onCancel={handleCancelTransfer}
              onDelete={handleDeleteTransfer}
              onClearFinished={handleClearFinished}
            />
          )}

          {activeTab === 'health' && (
            <HealthView activeVault={activeVault} files={files} onRebuild={handleRebuild} />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              activeVault={activeVault}
              onUpdateVaultTargets={handleUpdateTargets}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <MagnetModal
        isOpen={isMagnetModalOpen}
        onClose={() => setIsMagnetModalOpen(false)}
        onDownloadFromMagnet={handleDownload}
      />

      <VaultModal
        isOpen={!!vaultModalMode}
        initialMode={vaultModalMode || 'create'}
        onClose={() => setVaultModalMode(null)}
        onCreateVault={handleCreateVault}
        onImportVault={handleImportVault}
      />

      {downloadModalTarget && (
        <DownloadModal
          isOpen={!!downloadModalTarget}
          onClose={() => setDownloadModalTarget(null)}
          packageId={downloadModalTarget.packageId}
          fileName={downloadModalTarget.fileName}
          fileSize={downloadModalTarget.fileSize}
          originalSha256={downloadModalTarget.originalSha256}
          onConfirmDownload={(destPath) =>
            executeDownload(downloadModalTarget.packageId, destPath, downloadModalTarget.fileName)
          }
          onNavigateToTransfers={() => {
            setDownloadModalTarget(null);
            setActiveTab('transfers');
          }}
          isDownloading={isDownloading === downloadModalTarget.packageId}
        />
      )}

      {/* Download Completion Notification Banner */}
      {downloadToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#151618] border border-[#27292d] rounded-2xl p-4 shadow-2xl flex items-start space-x-3.5 max-w-md backdrop-blur-md">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-zinc-100 flex items-center justify-between">
              <span>Download Complete</span>
              <button
                onClick={() => setDownloadToast(null)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors ml-2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-zinc-300 font-mono truncate mt-0.5" title={downloadToast.fileName}>
              {downloadToast.fileName}
            </p>
            <div className="flex items-center space-x-2 mt-2.5">
              <button
                onClick={async () => {
                  try {
                    await revealItemInDir(downloadToast.destinationPath);
                  } catch (e) {
                    console.error('Failed to reveal file:', e);
                  }
                }}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-all"
              >
                <FolderOpen className="w-3 h-3" />
                <span>Show in Folder</span>
              </button>
              <button
                onClick={async () => {
                  try {
                    await openPath(downloadToast.destinationPath);
                  } catch (e) {
                    console.error('Failed to open file:', e);
                  }
                }}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#222428] hover:bg-[#2b2d32] text-zinc-200 border border-[#2e3035] transition-all"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Open File</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Global Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmDialog}
        options={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />
    </div>
  );
}

export default App;
