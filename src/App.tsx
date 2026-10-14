import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import './App.css';

import { Sidebar, ActiveTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { ExplorerView } from './components/ExplorerView';
import { UploadView } from './components/UploadView';
import { TransfersView } from './components/TransfersView';
import { MembersView } from './components/MembersView';
import { SettingsView } from './components/SettingsView';
import { HealthView } from './components/HealthView';
import { MagnetModal } from './components/MagnetModal';
import { VaultModal } from './components/VaultModal';

import { PackageManifest, TransferRecord, VaultRecord, VaultTarget } from './types';
import { api } from './services/api';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('explorer');
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [activeVault, setActiveVault] = useState<VaultRecord | null>(null);
  const [files, setFiles] = useState<PackageManifest[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  // Modals
  const [isMagnetModalOpen, setIsMagnetModalOpen] = useState(false);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);

  useEffect(() => {
    loadInitialData();

    // Listen for OAuth success event
    const unlistenOAuth = listen('oauth-success', () => {
      alert('Google Workspace account authenticated and connected successfully!');
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
    } catch (err) {
      console.error('Failed to switch vault:', err);
    }
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      await api.syncCatalog();
      await refreshFiles();
    } catch (err: any) {
      alert('Failed to sync catalog: ' + (err?.toString() || ''));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopyMagnet = async (packageId: string) => {
    try {
      const magnetLink = await api.generateMagnet(packageId);
      await navigator.clipboard.writeText(magnetLink);
    } catch (err) {
      console.error('Failed to generate magnet:', err);
    }
  };

  const handleDownload = async (packageId: string) => {
    try {
      setIsDownloading(packageId);
      const pkg = files.find((f) => f.package_id === packageId);
      const fileName = pkg ? pkg.name : `download_${packageId}.bin`;

      const b64 = await api.downloadPackage(packageId);

      // Trigger browser/desktop file save
      const byteCharacters = atob(b64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await refreshTransfers();
    } catch (err: any) {
      alert('Failed to download file: ' + (err?.toString() || ''));
    } finally {
      setIsDownloading(null);
    }
  };

  const handleDelete = async (packageId: string) => {
    if (!confirm('Are you sure you want to delete this file from the vault and all cloud storage targets?')) {
      return;
    }
    try {
      await api.deletePackage(packageId);
      await refreshFiles();
    } catch (err: any) {
      alert('Failed to delete file: ' + (err?.toString() || ''));
    }
  };

  const handleUploadFile = async (
    file: File,
    passphrase?: string,
    onProgress?: (percent: number, currentChunk: number, totalChunks: number) => void
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

  const handleCancelTransfer = async (transferId: string) => {
    if (confirm('Cancel this transfer? Incomplete chunks will be deleted from Google Drive.')) {
      await api.cancelTransfer(transferId);
      await refreshTransfers();
    }
  };

  const handleDeleteTransfer = async (transferId: string) => {
    await api.deleteTransfer(transferId);
    await refreshTransfers();
  };

  const handleClearFinished = async () => {
    await api.clearFinishedTransfers();
    await refreshTransfers();
  };

  const handleCreateVault = async (name: string, passphrase: string, targets: VaultTarget[]) => {
    const record = await api.createVault(name, passphrase, targets);
    const vList = await api.listVaults();
    setVaults(vList);
    setActiveVault(record);
    await refreshFiles();
  };

  const handleImportVault = async (token: string, passphrase: string) => {
    const record = await api.importVaultConfig(token, passphrase);
    const vList = await api.listVaults();
    setVaults(vList);
    setActiveVault(record);
    await refreshFiles();
  };

  const handleDeleteVault = async (vaultId: string) => {
    await api.deleteVault(vaultId);
    const vList = await api.listVaults();
    setVaults(vList);
    if (activeVault?.id === vaultId) {
      setActiveVault(vList[0] || null);
    }
    await refreshFiles();
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
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans antialiased text-slate-100">
      {/* Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        vaults={vaults}
        activeVault={activeVault}
        onSelectVault={handleSelectVault}
      />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Navbar
          activeVault={activeVault}
          onOpenMagnetModal={() => setIsMagnetModalOpen(true)}
          onOpenVaultModal={() => setIsVaultModalOpen(true)}
          onSync={handleSync}
          isSyncing={isSyncing}
        />

        <main className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'explorer' && (
            <ExplorerView
              files={files}
              onDownload={handleDownload}
              onDelete={handleDelete}
              onCopyMagnet={handleCopyMagnet}
              onGoToUpload={() => setActiveTab('upload')}
              isDownloading={isDownloading}
            />
          )}

          {activeTab === 'upload' && (
            <UploadView
              activeVault={activeVault}
              onUploadFile={handleUploadFile}
              onGoToExplorer={() => setActiveTab('explorer')}
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

          {activeTab === 'members' && (
            <MembersView
              activeVault={activeVault}
              onExportVault={(id, role) => api.exportVaultConfig(id, role)}
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
        isOpen={isVaultModalOpen}
        onClose={() => setIsVaultModalOpen(false)}
        vaults={vaults}
        activeVault={activeVault}
        onSelectVault={handleSelectVault}
        onCreateVault={handleCreateVault}
        onImportVault={handleImportVault}
        onDeleteVault={handleDeleteVault}
      />
    </div>
  );
}

export default App;
