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
} from 'lucide-react';
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

  // Targets state for active vault
  const [targets, setTargets] = useState<VaultTarget[]>([]);
  const [newTargetId, setNewTargetId] = useState('');
  const [newTargetType, setNewTargetType] = useState<'SharedDrive' | 'SharedFolder'>('SharedDrive');
  const [newTargetLabel, setNewTargetLabel] = useState('');
  const [isSavingTargets, setIsSavingTargets] = useState(false);

  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSettings();
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
    } catch (err: any) {
      console.error(err);
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
      setStatusMsg({ type: 'success', text: 'Kredensial GCP berhasil disimpan secara lokal.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Gagal menyimpan kredensial GCP.' });
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
            text: 'Berkas client_secret.json berhasil dibaca otomatis.',
          });
        } else {
          setStatusMsg({
            type: 'error',
            text: 'Format client_secret.json tidak valid (tidak ditemukan client_id).',
          });
        }
      } catch {
        setStatusMsg({ type: 'error', text: 'Gagal mem-parsing berkas JSON.' });
      }
    };
    reader.readAsText(file);
  };

  const handleConnectGoogle = async () => {
    try {
      const authUrl = await api.startGoogleLogin();
      // Open in default browser via window.open
      window.open(authUrl, '_blank');
      setStatusMsg({
        type: 'success',
        text: 'Halaman persetujuan Google telah dibuka di peramban Anda. Selesaikan otorisasi untuk melanjutkan.',
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Gagal memulai autentikasi Google.' });
    }
  };

  const handleLogout = async () => {
    await api.logoutGoogle();
    setIsLoggedIn(false);
    setStatusMsg({ type: 'success', text: 'Berhasil keluar dari akun Google.' });
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
      setStatusMsg({ type: 'success', text: 'Konfigurasi target storage vault berhasil diperbarui.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.toString() || 'Gagal memperbarui target storage.' });
    } finally {
      setIsSavingTargets(false);
    }
  };

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Pengaturan Sistem & Kredensial</h2>
          <p className="text-xs text-slate-400 mt-1">
            Konfigurasi Google Cloud Platform, autentikasi akun Google Workspace, dan target
            penyimpanan Shared Drive.
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
              <h3 className="text-sm font-bold text-slate-100">Kredensial GCP (OAuth 2.0 Client)</h3>
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
                placeholder="Contoh: 123456789-abcdefg.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 block mb-1">
                OAuth Client Secret (Opsional untuk Desktop PKCE)
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
              {isSavingGcp ? 'Menyimpan...' : 'Simpan Kredensial GCP'}
            </button>
          </form>
        </div>

        {/* Section 2: Google Account Auth */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <Globe className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">Status Autentikasi Google Drive</h3>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  isLoggedIn ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-slate-600'
                }`}
              />
              <span className="text-xs font-medium text-slate-200">
                {isLoggedIn ? 'Akun Google Terautentikasi' : 'Belum Terautentikasi'}
              </span>
            </div>

            {isLoggedIn ? (
              <button
                onClick={handleLogout}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-400 border border-slate-700 transition-all"
              >
                Putus Sambungan (Logout)
              </button>
            ) : (
              <button
                onClick={handleConnectGoogle}
                disabled={!clientId.trim()}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
              >
                Hubungkan dengan Google (OAuth 2.0 PKCE)
              </button>
            )}
          </div>
        </div>

        {/* Section 3: Vault Targets */}
        {activeVault && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Target Storage Vault ({activeVault.name})
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {targets.length} Target Terpasang
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
                        {t.target_type} • ID: {t.target_id}
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
                Tambah Target Drive / Folder Baru
              </span>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Label (contoh: Drive Alpha)"
                  value={newTargetLabel}
                  onChange={(e) => setNewTargetLabel(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
                <select
                  value={newTargetType}
                  onChange={(e) => setNewTargetType(e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="SharedDrive">Shared Drive (GWS)</option>
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
                  <span>Tambahkan ke Daftar</span>
                </button>

                <button
                  onClick={handleSaveTargets}
                  disabled={isSavingTargets}
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
                >
                  {isSavingTargets ? 'Menyimpan...' : 'Simpan Perubahan Target'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
