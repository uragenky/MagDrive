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
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { VaultRecord, VaultTarget } from '../types';
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
  const [newTargetType, setNewTargetType] = useState<'SharedDrive' | 'SharedFolder'>('SharedDrive');
  const [newTargetLabel, setNewTargetLabel] = useState('');
  const [isSavingTargets, setIsSavingTargets] = useState(false);

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

  const loadSettings = async () => {
    try {
      const gcp = await api.getGcpSettings();
      if (gcp) {
        setClientId(gcp.client_id);
        setClientSecret(gcp.client_secret);
      }
      const logged = await api.checkLoginStatus();
      setIsLoggedIn(logged);

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
                className={`w-3 h-3 rounded-full ${
                  isLoggedIn ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-slate-600'
                }`}
              />
              <span className="text-xs font-medium text-slate-200">
                {isLoggedIn ? 'Google Account Connected' : 'Not Connected'}
              </span>
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
                  Daftar serverless tracker untuk penemuan peer (Google Drive mirror) dan koordinasi swarm.
                </p>
              </div>
            </div>
            {trackerSavedNotice && (
              <div className="flex items-center space-x-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Pengaturan Tracker Tersimpan!</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-300 block">
              Daftar Tracker Aktif:
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
                    title={trackers.length <= 1 ? 'Minimal harus ada 1 tracker' : 'Hapus tracker'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Tambah Tracker Input */}
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="text"
                placeholder="https://tracker-anda.vercel.app/api"
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
                <span>Tambah Tracker</span>
              </button>
            </div>

            {/* Default Opt-in Seeding Toggle */}
            <div className="pt-3 border-t border-slate-800/60 flex items-start justify-between">
              <div className="space-y-0.5">
                <label htmlFor="defaultSeedingCheckbox" className="text-xs font-semibold text-slate-200 cursor-pointer">
                  Otomatis bantu mirror publik saat menyalin (Default Opt-in Seeding)
                </label>
                <p className="text-[11px] text-slate-500">
                  Saat diaktifkan, setiap file yang Anda salin ke Google Drive Anda akan otomatis disetel sebagai Public Viewer dan didaftarkan ke tracker untuk membantu pengguna lain.
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
                {isSavingTracker ? 'Menyimpan...' : 'Simpan Pengaturan Tracker'}
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
                  <button
                    onClick={() => handleRemoveTarget(idx)}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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
      </div>
    </div>
  );
};
