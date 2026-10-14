import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  Share2,
  Copy,
  Check,
  AlertCircle,
  Key,
} from 'lucide-react';
import { DrivePermissionItem, VaultRecord, VaultRole } from '../types';
import { api } from '../services/api';

interface MembersViewProps {
  activeVault: VaultRecord | null;
  onExportVault: (vaultId: string, role: string) => Promise<string>;
}

export const MembersView: React.FC<MembersViewProps> = ({ activeVault, onExportVault }) => {
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [members, setMembers] = useState<DrivePermissionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Invite form state
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'fileOrganizer' | 'writer' | 'reader'>('fileOrganizer');
  const [isInviting, setIsInviting] = useState(false);

  // Export Token state
  const [exportRole, setExportRole] = useState<VaultRole>('member');
  const [exportedToken, setExportedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    if (activeVault && activeVault.targets.length > 0) {
      if (!selectedTargetId || !activeVault.targets.some((t) => t.target_id === selectedTargetId)) {
        setSelectedTargetId(activeVault.targets[0].target_id);
      }
    }
  }, [activeVault]);

  useEffect(() => {
    if (selectedTargetId) {
      loadMembers(selectedTargetId);
    }
  }, [selectedTargetId]);

  const loadMembers = async (targetId: string) => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const perms = await api.listDriveMembers(targetId);
      setMembers(perms);
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Gagal memuat daftar izin anggota Google Drive.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !selectedTargetId) return;

    try {
      setIsInviting(true);
      setErrorMsg(null);
      await api.addDriveMember(selectedTargetId, newEmail.trim(), newRole);
      setNewEmail('');
      await loadMembers(selectedTargetId);
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Gagal menambahkan anggota.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveMember = async (permId: string) => {
    if (!confirm('Apakah Anda yakin ingin mencabut izin akses anggota ini dari Google Drive?')) {
      return;
    }

    try {
      setErrorMsg(null);
      await api.removeDriveMember(selectedTargetId, permId);
      await loadMembers(selectedTargetId);
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Gagal menghapus izin anggota.');
    }
  };

  const handleGenerateExport = async () => {
    if (!activeVault) return;
    try {
      const token = await onExportVault(activeVault.id, exportRole);
      setExportedToken(token);
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Gagal membuat token ekspor.');
    }
  };

  const handleCopyToken = () => {
    if (!exportedToken) return;
    navigator.clipboard.writeText(exportedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  if (!activeVault) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900 p-8 text-center">
        <div className="max-w-md">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-100 mb-1">Vault Belum Dipilih</h3>
          <p className="text-xs text-slate-400">Pilih vault untuk mengelola anggota dan perizinan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Akses & Manajemen Anggota</h2>
          <p className="text-xs text-slate-400 mt-1">
            Kelola izin akun Google Workspace pada Shared Drive / Folder dan ekspor token akses
            berjenjang untuk anggota grup.
          </p>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Section 1: Google Drive Live Permissions */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-slate-100">
                Izin Akses Google Drive ({activeVault.name})
              </h3>
            </div>

            {/* Target Selector */}
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400">Pilih Target:</span>
              <select
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
              >
                {activeVault.targets.map((t) => (
                  <option key={t.target_id} value={t.target_id}>
                    {t.label} ({t.target_type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Add Member Form */}
          <form onSubmit={handleAddMember} className="flex items-center gap-3">
            <input
              type="email"
              placeholder="Masukkan email anggota (contoh: user@company.com)..."
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              disabled={isInviting}
              className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as any)}
              disabled={isInviting}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="fileOrganizer">Contributor (Upload & Download)</option>
              <option value="writer">Writer (Upload Chunks)</option>
              <option value="reader">Viewer (Hanya Unduh)</option>
            </select>
            <button
              type="submit"
              disabled={isInviting || !newEmail.trim()}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all disabled:opacity-50"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{isInviting ? 'Menambahkan...' : 'Undang Akun'}</span>
            </button>
          </form>

          {/* Members Table */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Nama / Pengguna</th>
                  <th className="py-2.5 px-4">Email Google</th>
                  <th className="py-2.5 px-4">Peran di Drive</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {isLoading ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      Memuat daftar perizinan Google Drive...
                    </td>
                  </tr>
                ) : members.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      Belum ada anggota yang terdaftar atau perizinan tidak dapat diakses.
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-2.5 px-4 font-medium text-slate-200">
                        {m.display_name || 'Pengguna Google'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 font-mono text-[11px]">
                        {m.email_address || '(Domain / Anyone)'}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-800 text-cyan-400 border border-slate-700">
                          {m.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => handleRemoveMember(m.id)}
                          title="Cabut Izin Akses"
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: Vault Token Export (Role-based Vault Sharing) */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <Share2 className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">Ekspor Token Akses Vault (.magvault)</h3>
          </div>

          <p className="text-xs text-slate-400">
            Hasilkan token terenkripsi untuk dibagikan kepada anggota grup. Anggota cukup mengimpor
            token ini ke aplikasi MagDrive mereka untuk langsung terhubung ke bank data ini.
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
              {(['admin', 'member', 'viewer'] as VaultRole[]).map((role) => (
                <button
                  key={role}
                  onClick={() => {
                    setExportRole(role);
                    setExportedToken(null);
                  }}
                  className={`flex-1 py-1.5 rounded-md font-semibold capitalize transition-all ${
                    exportRole === role
                      ? 'bg-slate-800 text-cyan-400 shadow-sm border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Peran {role}
                </button>
              ))}
            </div>

            <button
              onClick={handleGenerateExport}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/20"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Generate Token</span>
            </button>
          </div>

          {exportedToken && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2 mt-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Token Vault ({exportRole.toUpperCase()}):</span>
                <button
                  onClick={handleCopyToken}
                  className="flex items-center space-x-1 text-cyan-400 hover:text-cyan-300 font-semibold"
                >
                  {copiedToken ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedToken ? 'Tersalin' : 'Salin Token'}</span>
                </button>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-300 break-all select-all max-h-28 overflow-y-auto">
                {exportedToken}
              </div>
              <p className="text-[11px] text-slate-500 italic">
                * Berikan token ini beserta passphrase vault kepada anggota untuk bergabung.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
