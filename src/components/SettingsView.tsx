import React, { useState, useEffect, useRef } from 'react';
import {
  Key,
  Globe,
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
  X,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import {
  VaultRecord,
  VaultTarget,
  GoogleUserProfile,
  AdaptiveErasureInfo,
  TargetMigrationStats,
  MigrationProgressPayload,
  TargetMigrationResult,
} from '../types';
import { api } from '../services/api';

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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
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

  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSettings();

    // Listen for OAuth success event to update login status reactively
    let unlisten: (() => void) | undefined;
    listen('oauth-success', () => {
      setIsLoggedIn(true);
      setAuthUrlManual(null);
      setStatusMsg({
        type: 'success',
        text: 'Google account authenticated and connected successfully!',
      });
      setIsLoadingProfile(true);
      api
        .getGoogleUserProfile()
        .then((profile) => setUserProfile(profile))
        .catch((e) => console.error(e))
        .finally(() => setIsLoadingProfile(false));
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
      const logged = await api.checkLoginStatus();
      setIsLoggedIn(logged);
      if (logged) {
        setIsLoadingProfile(true);
        api
          .getGoogleUserProfile()
          .then((profile) => setUserProfile(profile))
          .catch((e) => console.error(e))
          .finally(() => setIsLoadingProfile(false));
      } else {
        setUserProfile(null);
      }

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

  const handleUploadVaultToDrive = async () => {
    if (!activeVault) return;
    const confirmUpload = window.confirm(
      'The vault.json file will be uploaded to .magdrive/ in your Google Drive. Anyone with access to your shared Drive folder can view the vault name and target layout (passphrase and files remain securely encrypted). Continue?'
    );
    if (!confirmUpload) return;

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
    setIsLoggedIn(false);
    setUserProfile(null);
    setAuthUrlManual(null);
    setStatusMsg({ type: 'success', text: 'Successfully disconnected from Google account.' });
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
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-bold text-slate-100">System Settings & Credentials</h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure Google Cloud Platform credentials, authenticate your Google account, and manage
            distributed storage targets.
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

        {/* Section 1: GCP Credentials */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <Key className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-slate-100">GCP Credentials (OAuth 2.0 Client)</h3>
            </div>
            <button
              onClick={() => jsonFileInputRef.current?.click()}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-700 transition-all"
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
              <label className="text-xs font-semibold text-slate-400 block mb-1">
                OAuth Client ID
              </label>
              <input
                type="text"
                placeholder="e.g., 123456789-abcdefg.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 block mb-1">
                OAuth Client Secret (Optional for Desktop PKCE)
              </label>
              <input
                type="password"
                placeholder="GOCSPX-..."
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isSavingGcp || !clientId.trim()}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all disabled:opacity-50"
            >
              {isSavingGcp ? 'Saving...' : 'Save GCP Credentials'}
            </button>
          </form>
        </div>

        {/* Section 2: Google Account Auth */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <Globe className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">Google Drive Authentication Status</h3>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div
                className={`w-3 h-3 rounded-full shrink-0 ${
                  isLoggedIn ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-slate-600'
                }`}
              />
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate-200">
                  {isLoggedIn ? 'Google Account Connected' : 'Not Connected'}
                </span>
                {isLoggedIn && userProfile && (
                  <div className="flex items-center space-x-2 mt-0.5">
                    <span className="text-xs font-semibold text-white">
                      {userProfile.displayName}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      ({userProfile.emailAddress})
                    </span>
                  </div>
                )}
                {isLoggedIn && !userProfile && isLoadingProfile && (
                  <span className="text-[11px] text-slate-500 mt-0.5">Loading account info...</span>
                )}
              </div>
            </div>

            {isLoggedIn ? (
              <button
                onClick={handleLogout}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-400 border border-slate-700 transition-all"
              >
                Disconnect (Logout)
              </button>
            ) : (
              <button
                onClick={handleConnectGoogle}
                disabled={!clientId.trim()}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
              >
                Connect with Google (OAuth 2.0 PKCE)
              </button>
            )}
          </div>

          {/* Manual Link Fallback */}
          {authUrlManual && !isLoggedIn && (
            <div className="mt-4 p-4 rounded-xl bg-slate-900 border border-cyan-500/30 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-bold text-cyan-300">Browser Did Not Open Automatically?</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Click the button below to launch the authorization window, or copy the link directly into your browser.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => openUrl(authUrlManual)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 border border-cyan-500/40 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Browser</span>
                  </button>
                  <button
                    onClick={handleCopyAuthUrl}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
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
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] text-slate-400 font-mono select-all focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Section 2: Download Preferences */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <FolderDown className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-sm font-bold text-slate-100">Download Preferences</h3>
                <p className="text-[11px] text-slate-500">Configure default save location and download prompt behaviors.</p>
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
              <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                Default Download Directory
              </label>
              <div className="flex items-center space-x-2">
                <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono truncate select-all">
                  {downloadDir || 'Detecting default system download folder...'}
                </div>
                <button
                  type="button"
                  onClick={handleBrowseDownloadDir}
                  className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition-all shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Change...</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetDownloadDir}
                  title="Reset to system default Downloads folder"
                  className="p-2.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-all shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Standard folder where decrypted files will be assembled and stored.
              </p>
            </div>

            {/* Prompt Save Location Toggle */}
            <div className="pt-3 border-t border-slate-800/60 flex items-start justify-between">
              <div className="space-y-0.5">
                <label htmlFor="promptSaveCheckbox" className="text-xs font-semibold text-slate-200 cursor-pointer">
                  Always ask where to save each file
                </label>
                <p className="text-[11px] text-slate-500">
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
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Section 3: Multi-Tracker & Swarm Mirroring */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <Server className="w-5 h-5 text-indigo-400" />
              <div>
                <h3 className="text-sm font-bold text-slate-100">Multi-Tracker & Swarm Mirroring</h3>
                <p className="text-[11px] text-slate-500">
                  Serverless tracker list for peer discovery (Google Drive mirrors) and swarm coordination.
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
            <label className="text-xs font-semibold text-slate-300 block">
              Active Trackers:
            </label>
            <div className="space-y-2">
              {trackers.map((tr, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs"
                >
                  <span className="font-mono text-slate-300 truncate max-w-[85%]">{tr}</span>
                  <button
                    onClick={() => handleRemoveTracker(idx)}
                    disabled={trackers.length <= 1}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-30"
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
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <button
                onClick={handleAddTracker}
                disabled={!newTrackerUrl.trim()}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 transition-all disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Tracker</span>
              </button>
            </div>

            {/* Default Opt-in Seeding Toggle */}
            <div className="pt-3 border-t border-slate-800/60 flex items-start justify-between">
              <div className="space-y-0.5">
                <label htmlFor="defaultSeedingCheckbox" className="text-xs font-semibold text-slate-200 cursor-pointer">
                  Automatically enable public mirror when copying (Default Opt-in Seeding)
                </label>
                <p className="text-[11px] text-slate-500">
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
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveTrackers}
                disabled={isSavingTracker}
                className="px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-600/30 disabled:opacity-50"
              >
                {isSavingTracker ? 'Saving...' : 'Save Tracker Settings'}
              </button>
            </div>
          </div>
        </div>

        {/* Section 4: Vault Targets */}
        {activeVault && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Vault Storage Targets ({activeVault.name})
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {targets.length} Targets Configured
              </span>
            </div>

            {/* Adaptive Erasure Scheme Info Banner */}
            {erasureInfo && (
              <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold text-slate-100">
                      Adaptive Erasure Coding Scheme
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800">
                    Auto-Configured
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Active Formula</span>
                    <span className="text-sm font-bold text-cyan-400">
                      {erasureInfo.data_shards} + {erasureInfo.parity_shards}
                    </span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      ({erasureInfo.data_shards} Data, {erasureInfo.parity_shards} Parity)
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Fault Tolerance</span>
                    <span className="text-sm font-bold text-emerald-400">
                      {erasureInfo.fault_tolerance} {erasureInfo.fault_tolerance === 1 ? 'Target' : 'Targets'}
                    </span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      {erasureInfo.fault_tolerance > 0 ? 'Survives total loss' : 'No redundancy'}
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Distribution</span>
                    <span className="text-sm font-bold text-amber-400">
                      1 Shard / Target
                    </span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      Strict non-colocation
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Storage Overhead</span>
                    <span className="text-sm font-bold text-purple-400">
                      +{erasureInfo.overhead_percent}%
                    </span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      Cloud quota usage
                    </span>
                  </div>
                </div>

                <div className="flex items-start space-x-2 text-[11px] text-slate-400 bg-slate-950/50 rounded-lg p-2 border border-slate-800/50">
                  <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span>
                    {erasureInfo.fault_tolerance > 0 ? (
                      <>
                        Each file stripe is partitioned across all connected storage targets. If up to{' '}
                        <strong className="text-slate-200">{erasureInfo.fault_tolerance} Google account(s)</strong> are suspended or deleted, MagDrive will still reconstruct all files with zero data loss.
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
                  className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs"
                >
                  <div className="flex items-center space-x-3">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-[10px]">
                      {idx + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-200">{t.label}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {t.target_type === 'SharedDrive' ? 'Google Workspace Shared Drive' : 'Personal Shared Folder'} • ID: {t.target_id}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleOpenMigration(t)}
                      title="Migrate or Evacuate Shards"
                      className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-400 transition-colors text-[11px] font-medium"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Migrate</span>
                    </button>
                    <button
                      onClick={() => handleRemoveTarget(idx)}
                      title="Remove Target"
                      className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Target Input */}
            <div className="pt-2 border-t border-slate-800/60 space-y-3">
              <span className="text-xs font-semibold text-slate-400 block">
                Add New Storage Target (Drive or Folder)
              </span>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Label (e.g., Primary Drive)"
                  value={newTargetLabel}
                  onChange={(e) => setNewTargetLabel(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
                <select
                  value={newTargetType}
                  onChange={(e) => setNewTargetType(e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="SharedDrive">Shared Drive (Google Workspace)</option>
                  <option value="SharedFolder">Shared Folder (Personal Gmail)</option>
                </select>
                <input
                  type="text"
                  placeholder="Drive / Folder ID"
                  value={newTargetId}
                  onChange={(e) => setNewTargetId(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handleAddTarget}
                  disabled={!newTargetId.trim() || !newTargetLabel.trim()}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 transition-all disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Target</span>
                </button>

                <button
                  onClick={handleSaveTargets}
                  disabled={isSavingTargets}
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
                >
                  {isSavingTargets ? 'Saving...' : 'Save Target Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Section 5: Vault Backup & Migration */}
        {activeVault && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <Share2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Vault Backup & Device Migration (.magvault)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Back up encrypted configuration tokens or files to migrate or restore your vault on another machine.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <p className="text-xs text-slate-400 max-w-lg">
                Back up your vault configuration. You can save an offline <code className="text-emerald-400">vault.json</code> descriptor to your computer, copy the base64 token, or optionally upload it to Google Drive.
              </p>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={handleSaveJsonBackup}
                  disabled={isSavingJsonFile}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all border border-slate-700 hover:border-slate-600 disabled:opacity-50"
                  title="Save vault.json file to local storage or USB drive"
                >
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{isSavingJsonFile ? 'Saving...' : 'Save vault.json'}</span>
                </button>
                <button
                  onClick={handleExportVaultBackup}
                  disabled={isExportingToken}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>{isExportingToken ? 'Generating...' : 'Export Token'}</span>
                </button>
                <button
                  onClick={handleUploadVaultToDrive}
                  disabled={isUploadingToCloud}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-cyan-700/60 hover:bg-cyan-600/60 text-cyan-200 transition-all border border-cyan-500/30 disabled:opacity-50"
                  title="Upload vault.json descriptor to .magdrive/ on Google Drive (Optional)"
                >
                  <CloudUpload className="w-3.5 h-3.5 text-cyan-300" />
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
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2 mt-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">Encrypted Backup Token:</span>
                  <button
                    onClick={handleCopyBackupToken}
                    className="flex items-center space-x-1 text-cyan-400 hover:text-cyan-300 font-semibold"
                  >
                    {tokenCopied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{tokenCopied ? 'Copied!' : 'Copy Token'}</span>
                  </button>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-300 break-all select-all max-h-28 overflow-y-auto">
                  {exportedToken}
                </div>
                <p className="text-[11px] text-slate-500 italic">
                  * To restore on another computer, open Vault Menu &gt; Import Vault tab, then provide this token along with your vault passphrase.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Target Migration & Evacuation Modal */}
      {migrationTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-cyan-950/60 border border-cyan-800/50 rounded-lg text-cyan-400">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Target Migration &amp; Decommissioning
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {migrationTarget.label} • {migrationTarget.target_id}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseMigration}
                disabled={isMigrating}
                className="text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Diagnostic Stats */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Target Storage Footprint
              </span>
              {isLoadingStats ? (
                <div className="flex items-center space-x-2 text-xs text-slate-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Scanning vault packages and shard allocations...</span>
                </div>
              ) : migrationStats ? (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-500 block">Shards on Target</span>
                    <span className="text-sm font-bold text-cyan-400 font-mono">
                      {migrationStats.chunks_on_target}
                    </span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-500 block">Affected Packages</span>
                    <span className="text-sm font-bold text-slate-200 font-mono">
                      {migrationStats.affected_packages}
                    </span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-500 block">Total Vault Shards</span>
                    <span className="text-sm font-bold text-slate-400 font-mono">
                      {migrationStats.total_vault_chunks}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500">No shard metadata found for this target.</div>
              )}
            </div>

            {/* Mode Selector Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMigrationMode('replace')}
                disabled={isMigrating}
                className={`py-2 px-3 rounded-lg transition-colors flex items-center justify-center space-x-2 ${
                  migrationMode === 'replace'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                    : 'text-slate-400 hover:text-slate-200'
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
                    ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                    : 'text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-400'
                }`}
              >
                <span>Evacuate &amp; Rebalance</span>
              </button>
            </div>

            {/* Mode 1: Replace with New Target */}
            {migrationMode === 'replace' && (
              <div className="space-y-3 bg-slate-900/50 p-4 rounded-xl border border-slate-800/60 text-xs">
                <span className="text-xs font-bold text-slate-200 block">
                  New Replacement Target Credentials
                </span>
                <p className="text-[11px] text-slate-400">
                  Shards on the old target will be migrated via Google fast-copy (or reconstructed via Reed-Solomon if the old account is lost). Once finished, the new target seamlessly replaces the old one.
                </p>

                <div className="space-y-2 pt-1">
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium block mb-1">
                      New Target Label
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. My Backup Drive 2"
                      value={migrationNewName}
                      onChange={(e) => setMigrationNewName(e.target.value)}
                      disabled={isMigrating}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-400 font-medium block mb-1">
                        Target Type
                      </label>
                      <select
                        value={migrationNewType}
                        onChange={(e) => setMigrationNewType(e.target.value as any)}
                        disabled={isMigrating}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                      >
                        <option value="SharedFolder">Personal Shared Folder</option>
                        <option value="SharedDrive">Google Workspace Shared Drive</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-400 font-medium block mb-1">
                        Drive / Folder ID
                      </label>
                      <input
                        type="text"
                        placeholder="Google Folder or Drive ID"
                        value={migrationNewId}
                        onChange={(e) => setMigrationNewId(e.target.value)}
                        disabled={isMigrating}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Mode 2: Evacuate & Rebalance */}
            {migrationMode === 'evacuate' && (
              <div className="space-y-2 bg-amber-950/20 border border-amber-800/40 p-4 rounded-xl text-xs text-slate-300">
                <span className="text-xs font-bold text-amber-300 block">
                  Evacuate Without Replacement
                </span>
                <p className="text-[11px] text-slate-400">
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
            <div className="space-y-3 pt-1 border-t border-slate-800/60 text-xs">
              <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={migrationDeleteOld}
                  onChange={(e) => setMigrationDeleteOld(e.target.checked)}
                  disabled={isMigrating}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span className="text-[11px]">
                  Delete old shards from decommissioned drive after transfer (reclaim Google Drive quota)
                </span>
              </label>

              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">
                  Vault Passphrase (Optional, required only for custom passphrase vaults)
                </label>
                <input
                  type="password"
                  placeholder="Leave blank if using default vault key"
                  value={migrationPassphrase}
                  onChange={(e) => setMigrationPassphrase(e.target.value)}
                  disabled={isMigrating}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* Progress Display */}
            {isMigrating && migrationProgress && (
              <div className="bg-slate-900/90 border border-cyan-800/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    <span className="font-semibold text-slate-200">
                      {migrationProgress.message}
                    </span>
                  </div>
                  <span className="font-mono text-cyan-400 font-bold">
                    {migrationProgress.total_chunks > 0
                      ? Math.round(
                          (migrationProgress.current_chunk / migrationProgress.total_chunks) * 100
                        )
                      : 0}
                    %
                  </span>
                </div>

                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-emerald-500 h-full transition-all duration-300"
                    style={{
                      width: `${
                        migrationProgress.total_chunks > 0
                          ? (migrationProgress.current_chunk / migrationProgress.total_chunks) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>

                <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono">
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                    Copied: {migrationProgress.copied_chunks}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                    Relayed: {migrationProgress.relayed_chunks}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
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
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={handleCloseMigration}
                disabled={isMigrating}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-50"
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
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center space-x-2 ${
                  migrationMode === 'replace'
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:bg-cyan-950 disabled:text-cyan-800'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:bg-amber-950 disabled:text-amber-800'
                }`}
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
    </div>
  );
};
