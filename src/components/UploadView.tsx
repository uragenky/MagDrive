import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { VaultRecord, TransferProgressPayload, AdaptiveErasureInfo } from '../types';
import { api } from '../services/api';

interface UploadViewProps {
  activeVault: VaultRecord | null;
  onUploadFile: (
    file: File,
    passphrase?: string,
    onProgress?: (progress: TransferProgressPayload) => void
  ) => Promise<string>;
  onGoToExplorer: () => void;
}

export const UploadView: React.FC<UploadViewProps> = ({
  activeVault,
  onUploadFile,
  onGoToExplorer,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [progressDetails, setProgressDetails] = useState<TransferProgressPayload | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    packageId: string;
    magnetLink: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [erasureInfo, setErasureInfo] = useState<AdaptiveErasureInfo | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeVault) {
      api
        .getAdaptiveErasureInfo(activeVault.targets.length)
        .then((info) => setErasureInfo(info))
        .catch((err) => console.error(err));
    }
  }, [activeVault]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bps: number) => {
    if (bps <= 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatEta = (secs: number) => {
    if (secs <= 0) return '0s';
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}m ${rem}s`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Zero memory reading overhead: store only File reference
    setSelectedFile(file);
    setErrorMsg(null);
  };

  const handleStartUpload = async () => {
    if (!selectedFile || !activeVault) return;

    try {
      setIsUploading(true);
      setErrorMsg(null);
      setUploadPercent(0);
      setProgressDetails(null);

      const pkgId = await onUploadFile(
        selectedFile,
        passphrase || undefined,
        (p) => {
          setProgressDetails(p);

          let pct = 0;
          if (p.stage === 'slicing') {
            pct = p.total_bytes > 0 ? Math.min(30, Math.round((p.transferred_bytes / p.total_bytes) * 30)) : 10;
          } else if (p.stage === 'encrypting') {
            pct = 35;
          } else if (p.stage === 'uploading_shards') {
            const shardRatio = p.total_shards > 0 ? p.current_shard / p.total_shards : 0;
            pct = 35 + Math.round(shardRatio * 60);
          } else if (p.stage === 'finalizing') {
            pct = 96;
          } else if (p.stage === 'completed') {
            pct = 100;
          }
          setUploadPercent(pct);
        }
      );

      let magnet = '';
      try {
        magnet = await api.generateMagnet(pkgId);
      } catch (e) {
        magnet = `magdrive:?xt=urn:magdrive:${pkgId}&vh=${activeVault.id}&sz=${selectedFile.size}&dn=${encodeURIComponent(
          selectedFile.name
        )}`;
      }

      setUploadResult({
        packageId: pkgId,
        magnetLink: magnet,
      });
    } catch (err: any) {
      setErrorMsg(err?.toString() || 'Failed to upload file.');
    } finally {
      setIsUploading(false);
      setProgressDetails(null);
      setUploadPercent(0);
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
          <h3 className="text-base font-semibold text-slate-100 mb-1">No Vault Selected</h3>
          <p className="text-xs text-slate-400 mb-4">
            Please select or create a group vault before uploading files.
          </p>
        </div>
      </div>
    );
  }

  const targetCount = activeVault.targets.length;

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Upload Files to Vault</h2>
          <p className="text-xs text-slate-400 mt-1">
            Files are sliced via adaptive 32MB/64MB streaming, encrypted locally via AES-256-GCM, and protected by Reed-Solomon error coding across group targets.
          </p>
        </div>

        {uploadResult ? (
          /* Success Card */
          <div className="bg-slate-950 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-6 shadow-xl">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-100">Upload Completed & Distributed!</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                File was encrypted and stored redundantly across all group storage targets.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-left space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Sharing Magnet Code:</span>
                <button
                  onClick={handleCopyMagnet}
                  className="flex items-center space-x-1 text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Magnet'}</span>
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
                View in File Explorer
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
              >
                Upload Another File
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
                Choose or Drag & Drop File Here
              </h4>
              <p className="text-xs text-slate-500">Supports files of any size (hundreds of MB to multi-GB without memory limits)</p>
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
                    Change File
                  </button>
                </div>

                {/* Redundancy Info */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800/60 text-xs">
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 block mb-1">Storage Targets</span>
                    <span className="font-semibold text-slate-200">
                      {targetCount} {targetCount === 1 ? 'Target' : 'Targets'} Connected
                    </span>
                  </div>
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 block mb-1">Adaptive RS Scheme</span>
                    <span className="font-semibold text-cyan-400">
                      {erasureInfo
                        ? `${erasureInfo.data_shards} Data + ${erasureInfo.parity_shards} Parity`
                        : `${targetCount} Targets`}
                    </span>
                  </div>
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60 col-span-2 sm:col-span-1">
                    <span className="text-slate-500 block mb-1">Fault Tolerance</span>
                    <span className="font-semibold text-emerald-400">
                      {erasureInfo && erasureInfo.fault_tolerance > 0
                        ? `Survives ${erasureInfo.fault_tolerance} dead ${erasureInfo.fault_tolerance === 1 ? 'drive' : 'drives'}`
                        : 'No redundancy'}
                    </span>
                  </div>
                </div>

                {/* Passphrase Input */}
                <div className="pt-2">
                  <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                    Vault Passphrase (Optional, for custom password vaults)
                  </label>
                  <input
                    type="password"
                    placeholder="Leave empty to use default vault key"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    disabled={isUploading}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                {/* Progress / Status */}
                {isUploading && (
                  <div className="space-y-3 pt-3 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          {progressDetails?.stage?.replace('_', ' ') || 'Preparing'}
                        </span>
                        <span className="text-slate-300 font-medium text-xs">
                          {progressDetails?.stage === 'slicing'
                            ? `Buffering Part ${progressDetails.current_shard}/${progressDetails.total_shards}`
                            : progressDetails?.stage === 'encrypting'
                            ? `AES-256-GCM Encryption & RS Parity (${progressDetails.total_shards} shards)`
                            : progressDetails?.stage === 'uploading_shards'
                            ? `Uploading Shard ${progressDetails.current_shard}/${progressDetails.total_shards}${progressDetails.target_label ? ` • ${progressDetails.target_label}` : ''}`
                            : progressDetails?.stage === 'finalizing'
                            ? 'Broadcasting Encrypted Manifest to All Targets'
                            : 'Processing upload...'}
                        </span>
                      </div>
                      <span className="font-mono text-cyan-400 font-bold text-xs">{uploadPercent}%</span>
                    </div>

                    <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-300"
                        style={{ width: `${uploadPercent}%` }}
                      />
                    </div>

                    {/* Stats Strip */}
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
                      <span>
                        {formatSize(progressDetails?.transferred_bytes || 0)} / {formatSize(selectedFile.size)}
                      </span>
                      <div className="flex items-center space-x-3">
                        {(progressDetails?.speed_bps ?? 0) > 0 && (
                          <span className="text-cyan-400 font-semibold">
                            ⚡ {formatSpeed(progressDetails?.speed_bps || 0)}
                          </span>
                        )}
                        {(progressDetails?.eta_seconds ?? 0) > 0 && (
                          <span className="text-slate-400">
                            ⏱ ETA: {formatEta(progressDetails?.eta_seconds || 0)}
                          </span>
                        )}
                      </div>
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
                  <span>{isUploading ? 'Uploading...' : 'Encrypt & Upload Now'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
