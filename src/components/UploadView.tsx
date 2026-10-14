import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { VaultRecord } from '../types';

interface UploadViewProps {
  activeVault: VaultRecord | null;
  onUpload: (
    fileName: string,
    base64Data: string,
    isFolder: boolean,
    passphrase?: string
  ) => Promise<string>;
  onGoToExplorer: () => void;
}

export const UploadView: React.FC<UploadViewProps> = ({
  activeVault,
  onUpload,
  onGoToExplorer,
}) => {
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    size: number;
    base64: string;
    isFolder: boolean;
  } | null>(null);

  const [passphrase, setPassphrase] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<{
    packageId: string;
    magnetLink: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1] || '';
      setSelectedFile({
        name: file.name,
        size: file.size,
        base64: base64Data,
        isFolder: false,
      });
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const handleStartUpload = async () => {
    if (!selectedFile || !activeVault) return;

    try {
      setIsUploading(true);
      setErrorMsg(null);
      setProgressStatus('Menghitung chunking dan paritas Reed-Solomon...');

      setTimeout(() => {
        setProgressStatus('Mengenkripsi blok biner via AES-256-GCM...');
      }, 500);

      setTimeout(() => {
        setProgressStatus('Mengunggah potongan data terdistribusi ke target Google Drive...');
      }, 1000);

      const pkgId = await onUpload(
        selectedFile.name,
        selectedFile.base64,
        selectedFile.isFolder,
        passphrase || undefined
      );

      const magnet = `magdrive:?xt=urn:magdrive:${pkgId}&vh=${activeVault.id}&sz=${selectedFile.size}&dn=${encodeURIComponent(
        selectedFile.name
      )}`;

      setUploadResult({
        packageId: pkgId,
        magnetLink: magnet,
      });
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Gagal mengunggah berkas.');
    } finally {
      setIsUploading(false);
      setProgressStatus('');
    }
  };

  const handleCopyMagnet = () => {
    if (!uploadResult) return;
    navigator.clipboard.writeText(uploadResult.magnetLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setUploadResult(null);
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!activeVault) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900 p-8 text-center">
        <div className="max-w-md">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-100 mb-1">Vault Belum Dipilih</h3>
          <p className="text-xs text-slate-400 mb-4">
            Pilih atau buat vault grup terlebih dahulu sebelum mengunggah berkas.
          </p>
        </div>
      </div>
    );
  }

  const targetCount = activeVault.targets.length;
  const redundancyScheme =
    targetCount >= 3 ? '2 Data + 1 Paritas (Reed-Solomon RS 2+1)' : targetCount === 2 ? '1 Data + 1 Paritas (RS 1+1 Mirroring)' : '1 Data Tunggal (Tanpa Paritas)';

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Unggah Berkas ke Bank Data</h2>
          <p className="text-xs text-slate-400 mt-1">
            File akan dipecah menjadi potongan biner acak, dihitung paritasnya untuk proteksi
            kehilangan data, dienkripsi di perangkat lokal, dan didistribusikan ke Google Drive
            grup.
          </p>
        </div>

        {uploadResult ? (
          /* Success Card */
          <div className="bg-slate-950 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-6 shadow-xl">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-100">Unggahan Selesai & Terdistribusi!</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Berkas telah berhasil dienkripsi dan disimpan secara redundan di seluruh target
                Shared Drive grup.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-left space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Kode Magnet Berbagi:</span>
                <button
                  onClick={handleCopyMagnet}
                  className="flex items-center space-x-1 text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Tersalin' : 'Salin Magnet'}</span>
                </button>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 break-all select-all">
                {uploadResult.magnetLink}
              </div>
            </div>

            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={onGoToExplorer}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30"
              >
                Lihat di Bank Data
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
              >
                Unggah Berkas Lain
              </button>
            </div>
          </div>
        ) : (
          /* Upload Form */
          <div className="space-y-6">
            {/* Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-cyan-500/60 bg-slate-950/60 hover:bg-slate-950 rounded-2xl p-10 text-center cursor-pointer transition-all group"
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 group-hover:bg-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto mb-4 transition-all">
                <UploadCloud className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-semibold text-slate-200 mb-1">
                Pilih atau Tarik Berkas ke Sini
              </h4>
              <p className="text-xs text-slate-500">Mendukung berkas ukuran apa pun (hingga GB)</p>
            </div>

            {/* Selected File Details */}
            {selectedFile && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-200 text-sm">
                        {selectedFile.name}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {formatSize(selectedFile.size)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedFile(null)}
                    disabled={isUploading}
                    className="text-xs text-slate-500 hover:text-rose-400 transition-colors"
                  >
                    Ganti Berkas
                  </button>
                </div>

                {/* Redundancy Info */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60 text-xs">
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 block mb-1">Target Penyimpanan</span>
                    <span className="font-semibold text-slate-200">
                      {targetCount} Google Shared Drive/Folder
                    </span>
                  </div>
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 block mb-1">Skema Toleransi Kerusakan</span>
                    <span className="font-semibold text-emerald-400">{redundancyScheme}</span>
                  </div>
                </div>

                {/* Passphrase Input */}
                <div className="pt-2">
                  <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                    Passphrase Vault (Opsional, gunakan jika grup memakai kata sandi custom)
                  </label>
                  <input
                    type="password"
                    placeholder="Biarkan kosong untuk menggunakan kunci default vault"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    disabled={isUploading}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                {/* Progress / Status */}
                {isUploading && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-xs text-cyan-400 font-medium">
                      <span>{progressStatus}</span>
                      <span className="animate-pulse font-mono">Memproses...</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 rounded-full animate-indeterminate" />
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Action Button */}
                <button
                  onClick={handleStartUpload}
                  disabled={isUploading}
                  className="w-full flex items-center justify-center space-x-2 py-3 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isUploading ? 'Sedang Mengunggah...' : 'Enkripsi & Unggah Sekarang'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
