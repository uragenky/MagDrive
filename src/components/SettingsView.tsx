import React, { useState, useEffect, useRef } from 'react';
import {
  Key,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Plus,
  Trash2,
  FileCode,
  ExternalLink,
  Copy,
  Check,
  FolderDown,
  FolderOpen,
  RotateCcw,
  Server,
  Share2,
  FileText,
  CloudUpload,
  ShieldCheck,
  Info,
  ArrowLeftRight,
  Loader2,
  RefreshCw,
  Users,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronUp,
  X,
  Unlink,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import {
  VaultRecord,
  VaultTarget,
  AdaptiveErasureInfo,
  TargetMigrationStats,
  MigrationProgressPayload,
  TargetMigrationResult,
  TargetStorageUsage,
  GoogleAccountInfo,
  SharedDriveItem,
} from '../types';
import { api } from '../services/api';
import { ConfirmModal, ConfirmDialogOptions } from './ui/ConfirmModal';

type SettingsTab = 'storage' | 'transfers' | 'backup' | 'advanced';

interface SettingsViewProps {
  activeVault: VaultRecord | null;
  onUpdateVaultTargets: (targets: VaultTarget[]) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeVault,
  onUpdateVaultTargets,
}) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [targetUsageMap, setTargetUsageMap] = useState<Record<string, TargetStorageUsage>>({});
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccountInfo[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [sharedDrivesMap, setSharedDrivesMap] = useState<Record<string, SharedDriveItem[]>>({});
  const [loadingDrivesEmail, setLoadingDrivesEmail] = useState<string | null>(null);
  const [openSharedDrivesEmail, setOpenSharedDrivesEmail] = useState<string | null>(null);
  const [selectedSharedDrive, setSelectedSharedDrive] = useState<Record<string, string>>({});
  const [showManualAddTarget, setShowManualAddTarget] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [isSavingGcp, setIsSavingGcp] = useState(false);
  const [authUrlManual, setAuthUrlManual] = useState<string | null>(null);
  const [copiedAuthUrl, setCopiedAuthUrl] = useState(false);

  // Download preferences state
  const [downloadDir, setDownloadDir] = useState('');
  const [promptSaveLocation, setPromptSaveLocation] = useState(true);
  const [downloadSettingsSaved, setDownloadSettingsSaved] = useState(false);

  // Multi-Tracker and Swarm state
  const [trackers, setTrackers] = useState<string[]>(['https://magdrive-tracker.vercel.app/api']);
  const [newTrackerUrl, setNewTrackerUrl] = useState('');
  const [defaultSeeding, setDefaultSeeding] = useState(false);
  const [isSavingTracker, setIsSavingTracker] = useState(false);
  const [trackerSavedNotice, setTrackerSavedNotice] = useState(false);

  // Targets state for active vault
  const [targets, setTargets] = useState<VaultTarget[]>([]);
  const [newTargetId, setNewTargetId] = useState('');
  const [newTargetLabel, setNewTargetLabel] = useState('');
  const [newTargetType, setNewTargetType] = useState<'SharedDrive' | 'SharedFolder'>('SharedFolder');
  const [isSavingTargets, setIsSavingTargets] = useState(false);
  const [erasureInfo, setErasureInfo] = useState<AdaptiveErasureInfo | null>(null);

  // Target Migration & Evacuation State
  const [migrationTarget, setMigrationTarget] = useState<VaultTarget | null>(null);
  const [migrationMode, setMigrationMode] = useState<'replace' | 'evacuate'>('replace');
  const [migrationStats, setMigrationStats] = useState<TargetMigrationStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [migrationNewName, setMigrationNewName] = useState('');
  const [migrationNewType, setMigrationNewType] = useState<'SharedDrive' | 'SharedFolder'>('SharedFolder');
  const [migrationNewId, setMigrationNewId] = useState('');
  const [migrationDeleteOld, setMigrationDeleteOld] = useState(true);
  const [migrationPassphrase, setMigrationPassphrase] = useState('');
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgressPayload | null>(null);
  const [migrationResult, setMigrationResult] = useState<TargetMigrationResult | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  // Vault Backup Token Export state
  const [exportedToken, setExportedToken] = useState<string | null>(null);
  const [isExportingToken, setIsExportingToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);
  const [isSavingJsonFile, setIsSavingJsonFile] = useState(false);
  const [isUploadingToCloud, setIsUploadingToCloud] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('storage');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);

  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number, decimals = 2): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const fetchTargetUsage = async () => {
    if (!activeVault) return;
    try {
      const usages = await api.getVaultTargetsUsage(activeVault.id);
      const map: Record<string, TargetStorageUsage> = {};
      for (const u of usages) {
        map[u.targetId] = u;
      }
      setTargetUsageMap(map);
    } catch (err) {
      console.error('Failed to fetch target storage usage:', err);
    }
  };

  const fetchGoogleAccounts = async () => {
    setIsLoadingAccounts(true);
    try {
      const accs = await api.listGoogleAccounts();
      setGoogleAccounts(accs);
    } catch (err) {
      console.error('Failed to list Google accounts:', err);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const handleRemoveAccount = async (email: string) => {
    try {
      await api.removeGoogleAccount(email);
      await fetchGoogleAccounts();
      setStatusMsg({ type: 'success', text: `Account ${email} disconnected from pool.` });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Failed to remove account' });
    }
  };

  const handleToggleSharedDrives = async (email: string) => {
    if (openSharedDrivesEmail === email) {
      setOpenSharedDrivesEmail(null);
      return;
    }
    setOpenSharedDrivesEmail(email);

    if (!sharedDrivesMap[email]) {
      setLoadingDrivesEmail(email);
      try {
        const drives = await api.listAccessibleSharedDrives(email);
        setSharedDrivesMap((prev) => ({ ...prev, [email]: drives }));
        if (drives.length > 0 && !selectedSharedDrive[email]) {
          setSelectedSharedDrive((prev) => ({ ...prev, [email]: drives[0].id }));
        }
      } catch (err: any) {
        console.error('Failed to list shared drives:', err);
      } finally {
        setLoadingDrivesEmail(null);
      }
    }
  };

  const handleAutoAddAccountTarget = async (email: string) => {
    if (!activeVault) return;
    try {
      const updated = await api.autoAddAccountTarget(activeVault.id, email);
      setTargets(updated.targets);
      await onUpdateVaultTargets(updated.targets);
      fetchTargetUsage();
      setStatusMsg({ type: 'success', text: `Target folder for ${email} added to vault!` });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Failed to add target' });
    }
  };

  const handleAddSharedDriveTarget = async (email: string) => {
    if (!activeVault) return;
    const driveId = selectedSharedDrive[email];
    if (!driveId) return;
    const driveItem = sharedDrivesMap[email]?.find((d) => d.id === driveId);
    const driveName = driveItem ? driveItem.name : 'Shared Drive';

    try {
      const updated = await api.addSharedDriveTarget(activeVault.id, email, driveId, driveName);
      setTargets(updated.targets);
      await onUpdateVaultTargets(updated.targets);
      fetchTargetUsage();
      setStatusMsg({ type: 'success', text: `Shared Drive "${driveName}" added to vault!` });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Failed to add Shared Drive' });
    }
  };

  useEffect(() => {
    loadSettings();

    // Listen for OAuth success event to update login status reactively
    let unlisten: (() => void) | undefined;
    listen('oauth-success', () => {
      setAuthUrlManual(null);
      setStatusMsg({
        type: 'success',
        text: 'Google account authenticated and added to pool successfully!',
      });
      fetchGoogleAccounts();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (activeVault) {
      setTargets(activeVault.targets);
      fetchTargetUsage();
    }
  }, [activeVault]);

  useEffect(() => {
    api
      .getAdaptiveErasureInfo(targets.length)
      .then((info) => setErasureInfo(info))
      .catch((err) => console.error(err));
  }, [targets.length]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<MigrationProgressPayload>('migration-progress', (event) => {
      setMigrationProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const loadSettings = async () => {
    try {
      const gcp = await api.getGcpSettings();
      if (gcp) {
        setClientId(gcp.client_id);
        setClientSecret(gcp.client_secret);
      }
      await fetchGoogleAccounts();

      const dlSettings = await api.getDownloadSettings();
      if (dlSettings) {
        setDownloadDir(dlSettings.download_dir);
        setPromptSaveLocation(dlSettings.prompt_save_location);
      }

      const trkSettings = await api.getTrackerSettings();
      if (trkSettings) {
        if (trkSettings.trackers && trkSettings.trackers.length > 0) {
          setTrackers(trkSettings.trackers);
        }
        setDefaultSeeding(trkSettings.default_seeding);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const triggerDownloadSavedNotice = () => {
    setDownloadSettingsSaved(true);
    setTimeout(() => setDownloadSettingsSaved(false), 2500);
  };

  const handleBrowseDownloadDir = async () => {
    try {
      const selected = await api.pickDownloadDirectory(downloadDir);
      if (selected) {
        setDownloadDir(selected);
        await api.saveDownloadSettings(selected, promptSaveLocation);
        triggerDownloadSavedNotice();
      }
    } catch (err) {
      console.error('Failed to pick download directory:', err);
    }
  };

  const handleTogglePromptSave = async (enabled: boolean) => {
    setPromptSaveLocation(enabled);
    try {
      await api.saveDownloadSettings(downloadDir, enabled);
      triggerDownloadSavedNotice();
    } catch (err) {
      console.error('Failed to save prompt settings:', err);
    }
  };

  const handleResetDownloadDir = async () => {
    try {
      await api.saveDownloadSettings('', promptSaveLocation);
      const res = await api.getDownloadSettings();
      setDownloadDir(res.download_dir);
      triggerDownloadSavedNotice();
    } catch (err) {
      console.error('Failed to reset download directory:', err);
    }
  };

  const handleAddTracker = () => {
    const trimmed = newTrackerUrl.trim();
    if (!trimmed) return;
    if (!trackers.includes(trimmed)) {
      setTrackers([...trackers, trimmed]);
    }
    setNewTrackerUrl('');
  };

  const handleRemoveTracker = (index: number) => {
    setTrackers(trackers.filter((_, i) => i !== index));
  };

  const handleSaveTrackers = async () => {
    setIsSavingTracker(true);
    try {
      await api.saveTrackerSettings(trackers, defaultSeeding);
      setTrackerSavedNotice(true);
      setTimeout(() => setTrackerSavedNotice(false), 2500);
    } catch (err) {
      console.error('Failed to save tracker settings:', err);
    } finally {
      setIsSavingTracker(false);
    }
  };

  const handleExportVaultBackup = async () => {
    if (!activeVault) return;
    setIsExportingToken(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const token = await api.exportVaultConfig(activeVault.id, 'admin');
      setExportedToken(token);
    } catch (err: any) {
      setBackupError(typeof err === 'string' ? err : 'Failed to export vault backup token.');
    } finally {
      setIsExportingToken(false);
    }
  };

  const handleSaveJsonBackup = async () => {
    if (!activeVault) return;
    setIsSavingJsonFile(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const savedPath = await api.saveVaultJsonToFile(activeVault.id);
      if (savedPath) {
        setBackupSuccess(`Backup file successfully saved to: ${savedPath}`);
      }
    } catch (err: any) {
      setBackupError(typeof err === 'string' ? err : 'Failed to save backup JSON file.');
    } finally {
      setIsSavingJsonFile(false);
    }
  };

  const handleUploadVaultToDrive = () => {
    if (!activeVault) return;

    setConfirmDialog({
      title: 'Upload Cloud Descriptor',
      message:
        'The vault.json file will be uploaded to .magdrive/ in your Google Drive. Anyone with access to your shared Drive folder can view the vault name and target layout (passphrase and files remain securely encrypted). Continue?',
      confirmText: 'Upload Descriptor',
      variant: 'warning',
      onConfirm: async () => {
        setIsUploadingToCloud(true);
        setBackupError(null);
        setBackupSuccess(null);
        try {
          const msg = await api.uploadVaultDescriptorToDrive(activeVault.id);
          setBackupSuccess(msg);
        } catch (err: any) {
          setBackupError(typeof err === 'string' ? err : 'Failed to upload vault.json to Google Drive.');
        } finally {
          setIsUploadingToCloud(false);
        }
      },
    });
  };

  const handleCopyBackupToken = () => {
    if (!exportedToken) return;
    navigator.clipboard.writeText(exportedToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const handleSaveGcp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingGcp(true);
      await api.saveGcpSettings({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      });
      setStatusMsg({ type: 'success', text: 'GCP credentials saved locally.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Failed to save GCP credentials.' });
    } finally {
      setIsSavingGcp(false);
    }
  };

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const installed = json.installed || json.web;
        if (installed && installed.client_id) {
          setClientId(installed.client_id);
          setClientSecret(installed.client_secret || '');
          setStatusMsg({
            type: 'success',
            text: 'Loaded client_secret.json successfully.',
          });
        } else {
          setStatusMsg({
            type: 'error',
            text: 'Invalid client_secret.json format (client_id not found).',
          });
        }
      } catch {
        setStatusMsg({ type: 'error', text: 'Failed to parse JSON file.' });
      }
    };
    reader.readAsText(file);
  };

  const handleConnectGoogle = async () => {
    try {
      const authUrl = await api.startGoogleLogin();
      setAuthUrlManual(authUrl);

      // Launch default system browser via official Tauri opener plugin
      try {
        await openUrl(authUrl);
      } catch (openErr) {
        console.warn('openUrl failed, falling back to window.open:', openErr);
        window.open(authUrl, '_blank');
      }

      setStatusMsg({
        type: 'success',
        text: 'Google authorization opened in your browser. Complete authentication to finish.',
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Failed to start Google authentication.' });
    }
  };

  const handleCopyAuthUrl = () => {
    if (!authUrlManual) return;
    navigator.clipboard.writeText(authUrlManual);
    setCopiedAuthUrl(true);
    setTimeout(() => setCopiedAuthUrl(false), 2500);
  };

  const handleLogout = async () => {
    await api.logoutGoogle();
    setTargetUsageMap({});
    setAuthUrlManual(null);
    await fetchGoogleAccounts();
    setStatusMsg({ type: 'success', text: 'All active sessions disconnected.' });
  };

  const handleAddTarget = () => {
    if (!newTargetId.trim() || !newTargetLabel.trim()) return;

    const updated = [
      ...targets,
      {
        target_id: newTargetId.trim(),
        target_type: newTargetType,
        label: newTargetLabel.trim(),
      },
    ];
    setTargets(updated);
    setNewTargetId('');
    setNewTargetLabel('');
  };

  const handleRemoveTarget = (index: number) => {
    setTargets(targets.filter((_, i) => i !== index));
  };

  const handleSaveTargets = async () => {
    try {
      setIsSavingTargets(true);
      await onUpdateVaultTargets(targets);
      fetchTargetUsage();
      setStatusMsg({ type: 'success', text: 'Vault storage targets updated successfully.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Failed to update storage targets.' });
    } finally {
      setIsSavingTargets(false);
    }
  };

  const handleOpenMigration = async (target: VaultTarget) => {
    setMigrationTarget(target);
    setMigrationMode('replace');
    setMigrationNewName('');
    setMigrationNewId('');
    setMigrationPassphrase('');
    setMigrationProgress(null);
    setMigrationResult(null);
    setMigrationError(null);
    setIsLoadingStats(true);

    if (activeVault) {
      try {
        const stats = await api.getTargetMigrationStats(activeVault.id, target.target_id);
        setMigrationStats(stats);
      } catch (err: any) {
        console.error('Failed to get migration stats:', err);
      } finally {
        setIsLoadingStats(false);
      }
    }
  };

  const handleExecuteMigration = async () => {
    if (!activeVault || !migrationTarget) return;

    try {
      setIsMigrating(true);
      setMigrationError(null);
      setMigrationResult(null);

      let result: TargetMigrationResult;
      if (migrationMode === 'replace') {
        if (!migrationNewId.trim()) {
          setMigrationError('Please provide the new Google Drive Folder or Drive ID.');
          setIsMigrating(false);
          return;
        }

        const newTarget: VaultTarget = {
          target_id: migrationNewId.trim(),
          target_type: migrationNewType,
          label: migrationNewName.trim() || 'New Storage Target',
        };

        result = await api.migrateTargetToNew(
          activeVault.id,
          migrationTarget.target_id,
          newTarget,
          migrationDeleteOld,
          migrationPassphrase || undefined
        );
      } else {
        result = await api.evacuateTarget(
          activeVault.id,
          migrationTarget.target_id,
          migrationDeleteOld,
          migrationPassphrase || undefined
        );
      }

      setMigrationResult(result);
      if (result.success) {
        // Refresh vault
        const vaults = await api.listVaults();
        const updated = vaults.find((v) => v.id === activeVault.id);
        if (updated) {
          setTargets(updated.targets);
          await onUpdateVaultTargets(updated.targets);
          fetchTargetUsage();
        }
      }
    } catch (err: any) {
      setMigrationError(err?.toString() || 'Migration execution failed.');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleCloseMigration = () => {
    if (isMigrating) return;
    setMigrationTarget(null);
    setMigrationProgress(null);
    setMigrationResult(null);
    setMigrationError(null);
  };

  return (
    <div className="flex-1 bg-[#0c0d0e] overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Settings</h2>
          <p className="text-xs text-zinc-400 mt-1">
            Manage connected accounts, storage drives, downloads, and backups.
          </p>
        </div>

        {statusMsg && (
          <div
            className={`p-4 rounded-xl text-xs flex items-center space-x-2 border ${
              statusMsg.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Sub-Tab Navigation Bar */}
        <div className="flex border-b border-[#222429] bg-[#131417] p-1 rounded-xl text-xs space-x-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveSettingsTab('storage')}
            className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg font-semibold transition-all ${
              activeSettingsTab === 'storage'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18191d]'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Accounts & Storage</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSettingsTab('transfers')}
            className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg font-semibold transition-all ${
              activeSettingsTab === 'transfers'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18191d]'
            }`}
          >
            <FolderDown className="w-4 h-4" />
            <span>Transfers & Download</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSettingsTab('backup')}
            className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg font-semibold transition-all ${
              activeSettingsTab === 'backup'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18191d]'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Vault Backup & Recovery</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSettingsTab('advanced')}
            className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg font-semibold transition-all ${
              activeSettingsTab === 'advanced'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18191d]'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>API & Network</span>
          </button>
        </div>

        {/* Tab 4: API & Swarm Network (Part 1: GCP Credentials) */}
        {activeSettingsTab === 'advanced' && (
        <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#222429] pb-3">
            <div className="flex items-center space-x-2">
              <Key className="w-5 h-5 text-zinc-300" />
              <h3 className="text-sm font-bold text-zinc-100">GCP Credentials (OAuth 2.0 Client)</h3>
            </div>
            <button
              onClick={() => jsonFileInputRef.current?.click()}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#18191d] hover:bg-[#222428] text-zinc-200 border border-[#26282e] transition-all"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Import client_secret.json</span>
            </button>
            <input
              ref={jsonFileInputRef}
              type="file"
              accept=".json"
              onChange={handleJsonUpload}
              className="hidden"
            />
          </div>

          <form onSubmit={handleSaveGcp} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1">
                OAuth Client ID
              </label>
              <input
                type="text"
                placeholder="e.g., 123456789-abcdefg.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1">
                OAuth Client Secret (Optional for Desktop PKCE)
              </label>
              <input
                type="password"
                placeholder="GOCSPX-..."
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isSavingGcp || !clientId.trim()}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50"
            >
              {isSavingGcp ? 'Saving...' : 'Save GCP Credentials'}
            </button>
          </form>
        </div>
        )}

        {/* Tab 1: Accounts & Storage (Part 1: Google Accounts Pool) */}
        {activeSettingsTab === 'storage' && (
          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#222429] pb-3">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-sm font-bold text-zinc-100">Connected Google Accounts</h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Connect one or more Google accounts. Quotas are pooled together automatically for multi-drive redundancy.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={fetchGoogleAccounts}
                disabled={isLoadingAccounts}
                title="Refresh accounts & storage quotas"
                className="h-9 px-3.5 inline-flex items-center justify-center space-x-1.5 rounded-xl text-xs font-semibold bg-[#18191d] hover:bg-[#222428] text-zinc-300 hover:text-zinc-100 border border-[#26282e] transition-all disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAccounts ? 'animate-spin text-zinc-300' : ''}`} />
                <span>{isLoadingAccounts ? 'Refreshing...' : 'Refresh'}</span>
              </button>
              {googleAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Disconnect all accounts"
                  className="h-9 px-3.5 inline-flex items-center justify-center space-x-1.5 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all shrink-0"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Disconnect All</span>
                </button>
              )}
              <button
                onClick={handleConnectGoogle}
                disabled={!clientId.trim()}
                className="h-9 px-3.5 inline-flex items-center justify-center space-x-1.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect Google Account</span>
              </button>
            </div>
          </div>

          {/* Manual Link Fallback */}
          {authUrlManual && (
            <div className="p-4 rounded-xl bg-[#18191d] border border-[#26282e] space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-bold text-zinc-200">Browser Did Not Open Automatically?</h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Click the button below to launch the authorization window, or copy the link directly into your browser.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => openUrl(authUrlManual)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Browser</span>
                  </button>
                  <button
                    onClick={handleCopyAuthUrl}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#222428] hover:bg-[#2b2d32] text-zinc-200 border border-[#2e3035] transition-all"
                  >
                    {copiedAuthUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedAuthUrl ? 'Copied!' : 'Copy URL'}</span>
                  </button>
                </div>
              </div>
              <input
                type="text"
                readOnly
                value={authUrlManual}
                className="w-full bg-[#0c0d0e] border border-[#26282e] rounded-lg px-3 py-1.5 text-[11px] text-zinc-400 font-mono select-all focus:outline-none"
              />
            </div>
          )}

          {/* Connected Accounts List */}
          {googleAccounts.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-[#26282e] rounded-xl space-y-3">
              <div className="w-12 h-12 rounded-full bg-[#18191d] flex items-center justify-center mx-auto text-zinc-500">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-300">No Google Accounts Connected Yet</p>
                <p className="text-[11px] text-zinc-500 max-w-sm mx-auto mt-0.5">
                  Authenticate your first Google account using OAuth 2.0 PKCE. MagDrive securely pools your storage drives with zero-knowledge encryption.
                </p>
              </div>
              <button
                onClick={handleConnectGoogle}
                disabled={!clientId.trim()}
                className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect Account with Google</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {googleAccounts.map((acc) => {
                const isTargetAdded = activeVault?.targets.some(
                  (t) => t.account_email === acc.email || (acc.rootFolderId && t.target_id === acc.rootFolderId)
                );
                const drives = sharedDrivesMap[acc.email] || [];
                const isDrivesOpen = openSharedDrivesEmail === acc.email;
                const isLoadingDrives = loadingDrivesEmail === acc.email;

                return (
                  <div
                    key={acc.email}
                    className="bg-[#18191d] border border-[#26282e] rounded-xl p-4 space-y-3 hover:border-[#353840] transition-all"
                  >
                    {/* Account Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-100 border border-zinc-700/60 flex items-center justify-center font-bold text-sm">
                          {acc.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-zinc-100">{acc.displayName}</span>
                            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/80 border border-emerald-800/60 px-1.5 py-0.2 rounded">
                              Connected
                            </span>
                          </div>
                          <span className="text-[11px] text-zinc-400 font-mono block">
                            {acc.email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => handleRemoveAccount(acc.email)}
                          title="Disconnect account"
                          className="px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:bg-rose-950/30 border border-[#26282e] hover:border-rose-900/50 rounded-lg transition-colors"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>

                    {/* Storage Quota Progress */}
                    <div className="bg-[#131417] border border-[#222429] rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        {acc.isUnlimited ? (
                          <>
                            <span className="text-zinc-400">Storage Capacity:</span>
                            <span className="font-semibold text-emerald-400">
                              Unlimited Workspace Pooled ({formatBytes(acc.usageBytes)} used)
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-zinc-300 font-medium">
                              {formatBytes(acc.usageBytes)} of {formatBytes(acc.limitBytes || 0)} used
                              {acc.usagePercentage !== undefined && (
                                <span className="text-zinc-400 ml-1 font-mono">
                                  ({acc.usagePercentage.toFixed(1)}%)
                                </span>
                              )}
                            </span>
                            <span className="font-semibold text-emerald-400">
                              {formatBytes(acc.freeBytes || 0)} remaining
                            </span>
                          </>
                        )}
                      </div>

                      {!acc.isUnlimited && (
                        <div className="w-full bg-[#18191d] rounded-full h-2 overflow-hidden border border-[#222429] flex">
                          <div
                            className={`h-full transition-all duration-500 rounded-full ${
                              (acc.usagePercentage || 0) > 90
                                ? 'bg-rose-500'
                                : (acc.usagePercentage || 0) > 75
                                ? 'bg-amber-400'
                                : 'bg-zinc-100'
                            }`}
                            style={{ width: `${Math.min(acc.usagePercentage || 0, 100)}%` }}
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2 pt-1 text-[10px]">
                        <div className="bg-[#18191d] rounded p-1 text-center border border-[#222429]">
                          <span className="text-zinc-500 block">Drive Files</span>
                          <span className="text-zinc-300 font-mono">{formatBytes(acc.usageInDriveBytes)}</span>
                        </div>
                        <div className="bg-[#18191d] rounded p-1 text-center border border-[#222429]">
                          <span className="text-zinc-500 block">Drive Trash</span>
                          <span className="text-zinc-300 font-mono">{formatBytes(acc.usageInTrashBytes)}</span>
                        </div>
                        <div className="bg-[#18191d] rounded p-1 text-center border border-[#222429]">
                          <span className="text-zinc-500 block">Mail/Photos</span>
                          <span className="text-zinc-300 font-mono">
                            {formatBytes(Math.max(0, acc.usageBytes - acc.usageInDriveBytes))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Auto Folder & 1-Click Vault Actions */}
                    <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-[#222429]">
                      <div className="flex items-center space-x-1.5 text-[11px] text-zinc-400">
                        <Folder className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                        <span>
                          {isTargetAdded ? (
                            <>
                              Vault Folder: <strong className="text-zinc-200">MagDrive - {activeVault?.name}</strong>
                              {acc.rootFolderId && (
                                <span className="text-[10px] font-mono text-zinc-500 ml-1">
                                  ({acc.rootFolderId})
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-zinc-500">Not attached to active vault</span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* Auto Personal Target Button */}
                        <button
                          onClick={() => handleAutoAddAccountTarget(acc.email)}
                          disabled={!activeVault || isTargetAdded}
                          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            isTargetAdded
                              ? 'bg-zinc-800 text-emerald-400 border border-emerald-900/40 cursor-default'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                          }`}
                        >
                          {isTargetAdded ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Added to Vault</span>
                            </>
                          ) : (
                            <>
                              <FolderPlus className="w-3.5 h-3.5" />
                              <span>+ Add to Vault (Auto Folder)</span>
                            </>
                          )}
                        </button>

                        {/* Toggle Shared Drives */}
                        <button
                          onClick={() => handleToggleSharedDrives(acc.email)}
                          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#18191d] hover:bg-[#222428] text-zinc-300 border border-[#26282e] transition-all"
                        >
                          <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Shared Drives</span>
                          {isDrivesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Shared Drives Drawer */}
                    {isDrivesOpen && (
                      <div className="mt-2 p-3 rounded-lg bg-[#18191d] border border-[#26282e] space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-zinc-300">
                            Accessible Google Workspace Shared Drives
                          </span>
                          {isLoadingDrives && (
                            <span className="text-[10px] text-zinc-500 flex items-center space-x-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Scanning drives...</span>
                            </span>
                          )}
                        </div>

                        {drives.length === 0 && !isLoadingDrives ? (
                          <p className="text-[11px] text-zinc-500 py-1">
                            No Google Workspace Shared Drives found for this account.
                          </p>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <select
                              value={selectedSharedDrive[acc.email] || (drives[0]?.id || '')}
                              onChange={(e) =>
                                setSelectedSharedDrive((prev) => ({
                                  ...prev,
                                  [acc.email]: e.target.value,
                                }))
                              }
                              className="flex-1 bg-[#131417] border border-[#222429] rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
                            >
                              {drives.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name} {d.canAddChildren ? '(Writable)' : '(Read Only)'}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleAddSharedDriveTarget(acc.email)}
                              disabled={!activeVault || drives.length === 0}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 shadow-sm border border-white/20 transition-all disabled:opacity-50"
                            >
                              Add Drive to Vault
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Tab 2: Transfers & Download Preferences */}
        {activeSettingsTab === 'transfers' && (
        <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#222429] pb-3">
            <div className="flex items-center space-x-2">
              <FolderDown className="w-5 h-5 text-zinc-300" />
              <div>
                <h3 className="text-sm font-bold text-zinc-100">Download Preferences</h3>
                <p className="text-[11px] text-zinc-400">Configure default save location and download prompt behaviors.</p>
              </div>
            </div>
            {downloadSettingsSaved && (
              <span className="flex items-center space-x-1 text-xs text-emerald-400 font-medium">
                <Check className="w-3.5 h-3.5" />
                <span>Saved</span>
              </span>
            )}
          </div>

          <div className="space-y-4">
            {/* Default Download Directory */}
            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1.5">
                Default Download Directory
              </label>
              <div className="flex items-center space-x-2">
                <div className="flex-1 bg-[#18191d] border border-[#26282e] rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 font-mono truncate select-all">
                  {downloadDir || 'Detecting default system download folder...'}
                </div>
                <button
                  type="button"
                  onClick={handleBrowseDownloadDir}
                  className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[#18191d] hover:bg-[#222428] text-zinc-200 border border-[#26282e] transition-all shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Change...</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetDownloadDir}
                  title="Reset to system default Downloads folder"
                  className="p-2.5 rounded-xl text-xs font-semibold bg-[#18191d] hover:bg-[#222428] text-zinc-400 hover:text-zinc-200 border border-[#26282e] transition-all shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">
                Standard folder where decrypted files will be assembled and stored.
              </p>
            </div>

            {/* Prompt Save Location Toggle */}
            <div className="pt-3 border-t border-[#222429] flex items-start justify-between">
              <div className="space-y-0.5">
                <label htmlFor="promptSaveCheckbox" className="text-xs font-semibold text-zinc-200 cursor-pointer">
                  Always ask where to save each file
                </label>
                <p className="text-[11px] text-zinc-500">
                  When enabled, a native "Save As" file dialog appears every time you download a file, letting you choose its destination folder and name.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4 mt-0.5">
                <input
                  id="promptSaveCheckbox"
                  type="checkbox"
                  checked={promptSaveLocation}
                  onChange={(e) => handleTogglePromptSave(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#26282e] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-zinc-100"></div>
              </label>
            </div>
          </div>
        </div>
        )}

        {/* Tab 4: API & Swarm Network (Part 2: Multi-Tracker) */}
        {activeSettingsTab === 'advanced' && (
        <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#222429] pb-3">
            <div className="flex items-center space-x-2">
              <Server className="w-5 h-5 text-zinc-300" />
              <div>
                <h3 className="text-sm font-bold text-zinc-100">P2P Swarm & Trackers</h3>
                <p className="text-[11px] text-zinc-400">
                  List of trackers for peer discovery and mirror swarm coordination.
                </p>
              </div>
            </div>
            {trackerSavedNotice && (
              <div className="flex items-center space-x-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Tracker Settings Saved!</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-xs font-semibold text-zinc-300 block">
              Active Trackers:
            </label>
            <div className="space-y-2">
              {trackers.map((tr, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-[#18191d] border border-[#26282e] rounded-xl p-2.5 text-xs"
                >
                  <span className="font-mono text-zinc-300 truncate max-w-[85%]">{tr}</span>
                  <button
                    onClick={() => handleRemoveTracker(idx)}
                    disabled={trackers.length <= 1}
                    className="p-1 rounded text-zinc-500 hover:text-rose-400 transition-colors disabled:opacity-30"
                    title={trackers.length <= 1 ? 'At least 1 tracker is required' : 'Remove tracker'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Tracker Input */}
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="text"
                placeholder="https://your-tracker.vercel.app/api"
                value={newTrackerUrl}
                onChange={(e) => setNewTrackerUrl(e.target.value)}
                className="flex-1 bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono"
              />
              <button
                onClick={handleAddTracker}
                disabled={!newTrackerUrl.trim()}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#18191d] hover:bg-[#222428] text-zinc-200 border border-[#26282e] transition-all disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Tracker</span>
              </button>
            </div>

            {/* Default Opt-in Seeding Toggle */}
            <div className="pt-3 border-t border-[#222429] flex items-start justify-between">
              <div className="space-y-0.5">
                <label htmlFor="defaultSeedingCheckbox" className="text-xs font-semibold text-zinc-200 cursor-pointer">
                  Automatically enable public mirror when copying (Default Opt-in Seeding)
                </label>
                <p className="text-[11px] text-zinc-500">
                  When enabled, copied files to your Google Drive will automatically be set to Public Viewer and announced to trackers to help other users.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4 mt-0.5">
                <input
                  id="defaultSeedingCheckbox"
                  type="checkbox"
                  checked={defaultSeeding}
                  onChange={(e) => setDefaultSeeding(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#26282e] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-zinc-100"></div>
              </label>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveTrackers}
                disabled={isSavingTracker}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50"
              >
                {isSavingTracker ? 'Saving...' : 'Save Tracker Settings'}
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Tab 1: Accounts & Storage (Part 2: Active Vault Targets) */}
        {activeSettingsTab === 'storage' && activeVault && (
          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-[#222429] pb-3">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-5 h-5 text-zinc-300" />
                <h3 className="text-sm font-bold text-zinc-100">
                  Storage Targets ({activeVault.name})
                </h3>
              </div>
              <span className="text-xs text-zinc-400 font-mono">
                {targets.length} Targets Configured
              </span>
            </div>

            {/* Adaptive Erasure Scheme Info Banner */}
            {erasureInfo && (
              <div className="bg-[#18191d] border border-[#26282e] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-zinc-300" />
                    <span className="text-xs font-bold text-zinc-100">
                      Drive Redundancy & Protection
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700">
                    Auto-Configured
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-[#131417] border border-[#222429] rounded-lg p-2.5">
                    <span className="text-[10px] text-zinc-400 block uppercase tracking-wider font-semibold">Formula</span>
                    <span className="text-sm font-bold text-zinc-100">
                      {erasureInfo.data_shards} + {erasureInfo.parity_shards}
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">
                      ({erasureInfo.data_shards} Data, {erasureInfo.parity_shards} Parity)
                    </span>
                  </div>

                  <div className="bg-[#131417] border border-[#222429] rounded-lg p-2.5">
                    <span className="text-[10px] text-zinc-400 block uppercase tracking-wider font-semibold">Fault Tolerance</span>
                    <span className="text-sm font-bold text-emerald-400">
                      {erasureInfo.fault_tolerance > 0 ? `Tolerates ${erasureInfo.fault_tolerance} drive failure${erasureInfo.fault_tolerance > 1 ? 's' : ''}` : 'No redundancy'}
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">
                      {erasureInfo.fault_tolerance > 0 ? 'Survives drive loss' : 'Single drive only'}
                    </span>
                  </div>

                  <div className="bg-[#131417] border border-[#222429] rounded-lg p-2.5">
                    <span className="text-[10px] text-zinc-400 block uppercase tracking-wider font-semibold">Distribution</span>
                    <span className="text-sm font-bold text-zinc-100">
                      1 Shard / Target
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">
                      Strict non-colocation
                    </span>
                  </div>

                  <div className="bg-[#131417] border border-[#222429] rounded-lg p-2.5">
                    <span className="text-[10px] text-zinc-400 block uppercase tracking-wider font-semibold">Storage Overhead</span>
                    <span className="text-sm font-bold text-zinc-300">
                      +{erasureInfo.overhead_percent}%
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">
                      Cloud quota usage
                    </span>
                  </div>
                </div>

                <div className="flex items-start space-x-2 text-[11px] text-zinc-400 bg-[#131417] rounded-lg p-2 border border-[#222429]">
                  <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                  <span>
                    {erasureInfo.fault_tolerance > 0 ? (
                      <>
                        Each file stripe is partitioned across all connected storage targets. If up to{' '}
                        <strong className="text-zinc-200">{erasureInfo.fault_tolerance} Google account(s)</strong> are suspended or deleted, MagDrive will still reconstruct all files with zero data loss.
                      </>
                    ) : (
                      <>
                        With only 1 target connected, data is stored without redundancy. Connect 2 or more targets to enable Reed-Solomon parity and fault tolerance.
                      </>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Existing Targets */}
            <div className="space-y-2">
              {targets.map((t, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-[#18191d] border border-[#26282e] rounded-lg p-3 text-xs"
                >
                  <div className="flex items-center space-x-3">
                    <span className="w-5 h-5 rounded-full bg-[#131417] text-zinc-400 flex items-center justify-center font-bold text-[10px] border border-[#222429]">
                      {idx + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-zinc-200 flex items-center space-x-2">
                        <span>{t.label}</span>
                        {t.account_email && (
                          <span className="text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-1.5 py-0.2 rounded">
                            Owner: {t.account_email}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono flex items-center space-x-1.5 flex-wrap mt-0.5">
                        <span>{t.target_type === 'SharedDrive' ? 'Google Workspace Shared Drive' : 'Personal Shared Folder'} • ID: {t.target_id}</span>
                        {targetUsageMap[t.target_id] && (
                          <span className="text-zinc-300 font-medium bg-[#131417] px-1.5 py-0.5 rounded border border-[#222429]">
                            {targetUsageMap[t.target_id].chunkCount} shards ({formatBytes(targetUsageMap[t.target_id].totalBytes)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleOpenMigration(t)}
                      title="Migrate or Evacuate Shards"
                      className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#222428] hover:bg-[#2b2d32] text-zinc-300 hover:text-white transition-colors text-[11px] font-medium border border-[#2e3035]"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5 text-zinc-300" />
                      <span>Migrate</span>
                    </button>
                    <button
                      onClick={() => handleRemoveTarget(idx)}
                      title="Remove Target"
                      className="p-1 rounded text-zinc-500 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Target Input (Collapsible for manual entry) */}
            <div className="pt-2 border-t border-[#222429] space-y-3">
              <button
                type="button"
                onClick={() => setShowManualAddTarget(!showManualAddTarget)}
                className="flex items-center space-x-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <span>Manual Entry: Add Storage Drive by ID</span>
                {showManualAddTarget ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showManualAddTarget && (
                <div className="bg-[#18191d] border border-[#26282e] rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Label (e.g., Primary Drive)"
                      value={newTargetLabel}
                      onChange={(e) => setNewTargetLabel(e.target.value)}
                      className="bg-[#131417] border border-[#222429] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                    />
                    <select
                      value={newTargetType}
                      onChange={(e) => setNewTargetType(e.target.value as any)}
                      className="bg-[#131417] border border-[#222429] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
                    >
                      <option value="SharedDrive">Shared Drive (Google Workspace)</option>
                      <option value="SharedFolder">Shared Folder (Personal Gmail)</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Drive / Folder ID"
                      value={newTargetId}
                      onChange={(e) => setNewTargetId(e.target.value)}
                      className="bg-[#131417] border border-[#222429] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono"
                    />
                  </div>

                  <p className="text-[11px] text-zinc-500">
                    Tip: Open the destination folder in Google Drive. Copy the ID string from your browser address bar after <span className="font-mono text-zinc-400">/folders/</span>
                  </p>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={handleAddTarget}
                      disabled={!newTargetId.trim() || !newTargetLabel.trim()}
                      className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#222428] hover:bg-[#2b2d32] text-zinc-200 border border-[#2e3035] transition-all disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Target to List</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handleSaveTargets}
                  disabled={isSavingTargets}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50"
                >
                  {isSavingTargets ? 'Saving...' : 'Save Target Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Vault Backup & Recovery */}
        {activeSettingsTab === 'backup' && activeVault && (
          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#222429] pb-3">
              <div className="flex items-center space-x-2">
                <Share2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">
                    Vault Backup & Recovery
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    Export encrypted backup tokens or configuration files to restore your vault on other devices.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <p className="text-xs text-zinc-400 max-w-lg">
                Back up your vault configuration. You can save an offline <code className="text-emerald-400">vault.json</code> descriptor to your computer, copy the base64 token, or optionally upload it to Google Drive.
              </p>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={handleSaveJsonBackup}
                  disabled={isSavingJsonFile}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#18191d] hover:bg-[#222428] text-zinc-200 transition-all border border-[#26282e] disabled:opacity-50"
                  title="Save vault.json file to local storage or USB drive"
                >
                  <FileText className="w-3.5 h-3.5 text-zinc-300" />
                  <span>{isSavingJsonFile ? 'Saving...' : 'Save vault.json'}</span>
                </button>
                <button
                  onClick={handleExportVaultBackup}
                  disabled={isExportingToken}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>{isExportingToken ? 'Generating...' : 'Export Token'}</span>
                </button>
                <button
                  onClick={handleUploadVaultToDrive}
                  disabled={isUploadingToCloud}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#222428] hover:bg-[#2b2d32] text-zinc-200 transition-all border border-[#2e3035] disabled:opacity-50"
                  title="Upload vault.json descriptor to .magdrive/ on Google Drive (Optional)"
                >
                  <CloudUpload className="w-3.5 h-3.5 text-zinc-300" />
                  <span>{isUploadingToCloud ? 'Uploading...' : 'Sync to Drive'}</span>
                </button>
              </div>
            </div>

            {backupSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{backupSuccess}</span>
              </div>
            )}

            {backupError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{backupError}</span>
              </div>
            )}

            {exportedToken && (
              <div className="bg-[#18191d] border border-[#26282e] rounded-xl p-4 space-y-2 mt-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="font-semibold text-zinc-200">Encrypted Backup Token:</span>
                  <button
                    onClick={handleCopyBackupToken}
                    className="flex items-center space-x-1 text-zinc-200 hover:text-white font-semibold"
                  >
                    {tokenCopied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{tokenCopied ? 'Copied!' : 'Copy Token'}</span>
                  </button>
                </div>
                <div className="bg-[#0c0d0e] p-3 rounded-lg border border-[#26282e] font-mono text-[10px] text-zinc-300 break-all select-all max-h-28 overflow-y-auto">
                  {exportedToken}
                </div>
                <p className="text-[11px] text-zinc-500 italic">
                  * To restore on another computer, open Vault Menu &gt; Import Vault tab, then provide this token along with your vault passphrase.
                </p>
              </div>
            )}
          </div>
        )}
        {activeSettingsTab === 'backup' && !activeVault && (
          <div className="bg-[#131417] border border-[#222429] rounded-2xl p-8 text-center text-zinc-400 text-xs">
            <ShieldCheck className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p className="font-semibold text-zinc-300">No Active Vault Selected</p>
            <p className="text-zinc-500 mt-1">
              Please select or create a Personal Vault in the sidebar to export backup tokens or descriptors.
            </p>
          </div>
        )}
      </div>

      {/* Target Migration & Evacuation Modal */}
      {migrationTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#131417] border border-[#222429] rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#222429] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-zinc-800 border border-zinc-700/80 rounded-lg text-zinc-200">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">
                    Drive Migration &amp; Replacement
                  </h3>
                  <p className="text-[11px] text-zinc-400 font-mono">
                    {migrationTarget.label} • {migrationTarget.target_id}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseMigration}
                disabled={isMigrating}
                className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Diagnostic Stats */}
            <div className="bg-[#18191d] border border-[#26282e] rounded-xl p-3.5 space-y-2">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">
                Target Storage Footprint
              </span>
              {isLoadingStats ? (
                <div className="flex items-center space-x-2 text-xs text-zinc-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                  <span>Scanning vault packages and shard allocations...</span>
                </div>
              ) : migrationStats ? (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-[#131417] p-2.5 rounded-lg border border-[#222429]">
                    <span className="text-[10px] text-zinc-500 block">Shards on Target</span>
                    <span className="text-sm font-bold text-zinc-100 font-mono">
                      {migrationStats.chunks_on_target}
                    </span>
                  </div>
                  <div className="bg-[#131417] p-2.5 rounded-lg border border-[#222429]">
                    <span className="text-[10px] text-zinc-500 block">Affected Packages</span>
                    <span className="text-sm font-bold text-zinc-200 font-mono">
                      {migrationStats.affected_packages}
                    </span>
                  </div>
                  <div className="bg-[#131417] p-2.5 rounded-lg border border-[#222429]">
                    <span className="text-[10px] text-zinc-500 block">Total Vault Shards</span>
                    <span className="text-sm font-bold text-zinc-400 font-mono">
                      {migrationStats.total_vault_chunks}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500">No shard metadata found for this target.</div>
              )}
            </div>

            {/* Mode Selector Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#18191d] border border-[#26282e] rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMigrationMode('replace')}
                disabled={isMigrating}
                className={`py-2 px-3 rounded-lg transition-colors flex items-center justify-center space-x-2 ${
                  migrationMode === 'replace'
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>Replace with New Target</span>
              </button>
              <button
                type="button"
                onClick={() => setMigrationMode('evacuate')}
                disabled={isMigrating || targets.length < 2}
                className={`py-2 px-3 rounded-lg transition-colors flex items-center justify-center space-x-2 ${
                  migrationMode === 'evacuate'
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:hover:text-zinc-400'
                }`}
              >
                <span>Evacuate &amp; Rebalance</span>
              </button>
            </div>

            {/* Mode 1: Replace with New Target */}
            {migrationMode === 'replace' && (
              <div className="space-y-3 bg-[#18191d] p-4 rounded-xl border border-[#26282e] text-xs">
                <span className="text-xs font-bold text-zinc-200 block">
                  New Replacement Target Credentials
                </span>
                <p className="text-[11px] text-zinc-400">
                  Shards on the old target will be migrated via Google fast-copy (or reconstructed via Reed-Solomon if the old account is lost). Once finished, the new target seamlessly replaces the old one.
                </p>

                <div className="space-y-2 pt-1">
                  <div>
                    <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                      New Target Label
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. My Backup Drive 2"
                      value={migrationNewName}
                      onChange={(e) => setMigrationNewName(e.target.value)}
                      disabled={isMigrating}
                      className="w-full bg-[#131417] border border-[#222429] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                        Target Type
                      </label>
                      <select
                        value={migrationNewType}
                        onChange={(e) => setMigrationNewType(e.target.value as any)}
                        disabled={isMigrating}
                        className="w-full bg-[#131417] border border-[#222429] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
                      >
                        <option value="SharedFolder">Personal Shared Folder</option>
                        <option value="SharedDrive">Google Workspace Shared Drive</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                        Drive / Folder ID
                      </label>
                      <input
                        type="text"
                        placeholder="Google Folder or Drive ID"
                        value={migrationNewId}
                        onChange={(e) => setMigrationNewId(e.target.value)}
                        disabled={isMigrating}
                        className="w-full bg-[#131417] border border-[#222429] rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Mode 2: Evacuate & Rebalance */}
            {migrationMode === 'evacuate' && (
              <div className="space-y-2 bg-[#18191d] border border-amber-800/40 p-4 rounded-xl text-xs text-zinc-300">
                <span className="text-xs font-bold text-amber-300 block">
                  Evacuate Without Replacement
                </span>
                <p className="text-[11px] text-zinc-400">
                  All {migrationStats?.chunks_on_target ?? 0} shard(s) hosted on this target will be relocated and rebalanced across the remaining {targets.length - 1} connected target(s). Once complete, this target is safely removed from the vault.
                </p>
                {targets.length < 2 && (
                  <p className="text-[11px] text-rose-400 font-semibold">
                    At least 2 targets are required in the vault to perform an evacuation.
                  </p>
                )}
              </div>
            )}

            {/* Common Options */}
            <div className="space-y-3 pt-1 border-t border-[#222429] text-xs">
              <label className="flex items-center space-x-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={migrationDeleteOld}
                  onChange={(e) => setMigrationDeleteOld(e.target.checked)}
                  disabled={isMigrating}
                  className="rounded bg-[#18191d] border-[#26282e] text-zinc-200 focus:ring-0"
                />
                <span className="text-[11px]">
                  Delete old shards from decommissioned drive after transfer (reclaim Google Drive quota)
                </span>
              </label>

              <div>
                <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                  Vault Passphrase (Optional, required only for custom passphrase vaults)
                </label>
                <input
                  type="password"
                  placeholder="Leave blank if using default vault key"
                  value={migrationPassphrase}
                  onChange={(e) => setMigrationPassphrase(e.target.value)}
                  disabled={isMigrating}
                  className="w-full bg-[#18191d] border border-[#26282e] rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            {/* Progress Display */}
            {isMigrating && migrationProgress && (
              <div className="bg-[#18191d] border border-[#26282e] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                    <span className="font-semibold text-zinc-200">
                      {migrationProgress.message}
                    </span>
                  </div>
                  <span className="font-mono text-zinc-100 font-bold">
                    {migrationProgress.total_chunks > 0
                      ? Math.round(
                          (migrationProgress.current_chunk / migrationProgress.total_chunks) * 100
                        )
                      : 0}
                    %
                  </span>
                </div>

                <div className="w-full bg-[#131417] h-2 rounded-full overflow-hidden border border-[#222429]">
                  <div
                    className="bg-zinc-100 h-full transition-all duration-300"
                    style={{
                      width: `${
                        migrationProgress.total_chunks > 0
                          ? (migrationProgress.current_chunk / migrationProgress.total_chunks) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>

                <div className="flex items-center space-x-2 text-[10px] text-zinc-400 font-mono">
                  <span className="px-2 py-0.5 rounded bg-[#131417] border border-[#222429]">
                    Copied: {migrationProgress.copied_chunks}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#131417] border border-[#222429]">
                    Relayed: {migrationProgress.relayed_chunks}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#131417] border border-[#222429]">
                    Reconstructed: {migrationProgress.reconstructed_chunks}
                  </span>
                </div>
              </div>
            )}

            {/* Result / Error Banner */}
            {migrationResult && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center space-x-2 border ${
                  migrationResult.success
                    ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                    : 'bg-amber-950/40 border-amber-800/50 text-amber-300'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{migrationResult.message}</span>
              </div>
            )}

            {migrationError && (
              <div className="p-3 rounded-xl text-xs flex items-center space-x-2 bg-rose-950/40 border border-rose-800/50 text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{migrationError}</span>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#222429]">
              <button
                type="button"
                onClick={handleCloseMigration}
                disabled={isMigrating}
                className="px-4 py-2 rounded-xl bg-[#18191d] hover:bg-[#222428] text-zinc-300 text-xs font-semibold transition-all border border-[#26282e] disabled:opacity-50"
              >
                {migrationResult ? 'Close' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleExecuteMigration}
                disabled={
                  isMigrating ||
                  (migrationMode === 'replace' && !migrationNewId.trim()) ||
                  (migrationMode === 'evacuate' && targets.length < 2)
                }
                className="px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 border border-white/20 shadow-sm disabled:opacity-50"
              >
                {isMigrating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing Migration...</span>
                  </>
                ) : (
                  <span>
                    {migrationMode === 'replace' ? 'Start Replacement' : 'Start Evacuation'}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cloud Descriptor Confirmation Dialog */}
      <ConfirmModal
        isOpen={!!confirmDialog}
        options={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />
    </div>
  );
};
