import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  FolderOpen,
  ShieldCheck,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Minimize2,
  ArrowRight,
  RefreshCw,
  Ban,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { api } from '../services/api';
import { TransferProgressPayload } from '../types';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  packageId: string;
  fileName: string;
  fileSize?: number;
  originalSha256?: string;
  onConfirmDownload: (destinationPath: string) => Promise<void>;
  onNavigateToTransfers?: () => void;
  isDownloading: boolean;
}

interface LiveProgress {
  currentShard: number;
  totalShards: number;
  transferredBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
  stage: string;
  targetLabel?: string;
  percent: number;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({
  isOpen,
  onClose,
  packageId,
  fileName,
  fileSize,
  originalSha256,
  onConfirmDownload,
  onNavigateToTransfers,
  isDownloading,
}) => {
  const [destinationPath, setDestinationPath] = useState('');
  const [promptSaveLocation, setPromptSaveLocation] = useState(true);
  const [downloadDir, setDownloadDir] = useState('');
  const [isLoadingPath, setIsLoadingPath] = useState(false);

  // Download lifecycle states: 'idle' | 'downloading' | 'completed' | 'failed'
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedPath, setCompletedPath] = useState<string>('');
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);

  const [progress, setProgress] = useState<LiveProgress>({
    currentShard: 0,
    totalShards: 1,
    transferredBytes: 0,
    totalBytes: fileSize || 0,
    speedBps: 0,
    etaSeconds: 0,
    stage: 'downloading',
    percent: 0,
  });

  useEffect(() => {
    if (isOpen) {
      loadInitialPath();
      if (isDownloading) {
        setDownloadStatus('downloading');
      } else if (downloadStatus !== 'completed') {
        setDownloadStatus('idle');
        setErrorMessage(null);
      }
    }
  }, [isOpen, packageId, fileName, isDownloading]);

  // Listen to granular real-time progress events for this package
  useEffect(() => {
    if (!isOpen) return;

    let unlisten: (() => void) | undefined;
    listen<TransferProgressPayload>('transfer-progress', (event) => {
      const p = event.payload;
      if (p.package_id === packageId) {
        if (p.transfer_id) {
          setActiveTransferId(p.transfer_id);
        }

        if (p.status === 'failed') {
          setDownloadStatus('failed');
          setErrorMessage(p.error_message || 'Download encountered an unexpected error.');
        } else if (p.status === 'completed' || p.stage === 'completed') {
          setDownloadStatus('completed');
          if (p.destination_path) {
            setCompletedPath(p.destination_path);
          }
          setProgress((prev) => ({
            ...prev,
            percent: 100,
            transferredBytes: prev.totalBytes,
            speedBps: 0,
            etaSeconds: 0,
          }));
        } else {
          setDownloadStatus('downloading');
          const total = p.total_bytes || p.total || fileSize || 1;
          const transferred = p.transferred_bytes || p.transferred || 0;
          const pct = Math.min(100, Math.max(0, Math.round((transferred / total) * 100)));

          setProgress({
            currentShard: p.current_shard,
            totalShards: p.total_shards,
            transferredBytes: transferred,
            totalBytes: total,
            speedBps: p.speed_bps || 0,
            etaSeconds: p.eta_seconds || 0,
            stage: p.stage || 'downloading',
            targetLabel: p.target_label,
            percent: pct,
          });
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen, packageId, fileSize]);

  const loadInitialPath = async () => {
    try {
      setIsLoadingPath(true);
      const settings = await api.getDownloadSettings();
      setDownloadDir(settings.download_dir);
      setPromptSaveLocation(settings.prompt_save_location);

      const resolved = await api.resolveDownloadPath(settings.download_dir, fileName);
      setDestinationPath(resolved);
    } catch (err) {
      console.error('Failed to resolve initial download path:', err);
      setDestinationPath(fileName);
    } finally {
      setIsLoadingPath(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const dirHint = destinationPath
        ? destinationPath.substring(0, Math.max(destinationPath.lastIndexOf('/'), destinationPath.lastIndexOf('\\')))
        : downloadDir;

      const chosen = await api.pickSaveFilePath(fileName, dirHint || undefined);
      if (chosen) {
        setDestinationPath(chosen);
      }
    } catch (err) {
      console.error('Failed to browse destination:', err);
    }
  };

  const handleTogglePromptSave = async (checked: boolean) => {
    setPromptSaveLocation(checked);
    try {
      await api.saveDownloadSettings(downloadDir, checked);
    } catch (err) {
      console.error('Failed to save prompt setting:', err);
    }
  };

  const handleStartDownload = async () => {
    const targetPath = destinationPath.trim();
    if (!targetPath) return;

    try {
      setDownloadStatus('downloading');
      setErrorMessage(null);
      setCompletedPath(targetPath);
      await onConfirmDownload(targetPath);
      setDownloadStatus('completed');
    } catch (err: any) {
      setDownloadStatus('failed');
      setErrorMessage(err?.toString() || 'Failed to download file.');
    }
  };

  const handleCancelDownload = async () => {
    if (activeTransferId) {
      try {
        await api.cancelTransfer(activeTransferId);
      } catch (err) {
        console.error('Failed to cancel transfer:', err);
      }
    }
    setDownloadStatus('idle');
    onClose();
  };

  const handleRevealItem = async () => {
    const target = completedPath || destinationPath;
    try {
      await revealItemInDir(target);
    } catch (err) {
      console.error('Failed to reveal file:', err);
    }
  };

  const handleOpenFile = async () => {
    const target = completedPath || destinationPath;
    try {
      await openPath(target);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                downloadStatus === 'completed'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : downloadStatus === 'failed'
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  : downloadStatus === 'downloading'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {downloadStatus === 'completed' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : downloadStatus === 'failed' ? (
                <AlertTriangle className="w-4 h-4" />
              ) : downloadStatus === 'downloading' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                {downloadStatus === 'completed'
                  ? 'Download Complete'
                  : downloadStatus === 'failed'
                  ? 'Download Failed'
                  : downloadStatus === 'downloading'
                  ? 'Downloading File'
                  : 'Save Downloaded File'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {downloadStatus === 'completed'
                  ? 'File reconstructed & verified successfully'
                  : downloadStatus === 'failed'
                  ? 'An error occurred during transfer or reconstruction'
                  : downloadStatus === 'downloading'
                  ? 'Streaming direct-to-disk with Reed-Solomon parity'
                  : 'Choose destination directory and confirm download'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
            title={downloadStatus === 'downloading' ? 'Close to background (download continues)' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          {/* File Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2.5">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2.5 min-w-0">
                <FileText className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-slate-100 text-xs block truncate" title={fileName}>
                    {fileName}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {formatSize(fileSize)}
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono shrink-0">
                <ShieldCheck className="w-3 h-3" />
                <span>AES-256 + RS 2+1</span>
              </div>
            </div>

            {originalSha256 && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>Checksum:</span>
                <span className="truncate max-w-[280px]" title={originalSha256}>
                  {originalSha256.substring(0, 16)}...{originalSha256.substring(originalSha256.length - 8)}
                </span>
              </div>
            )}
          </div>

          {/* ACTIVE DOWNLOADING PROGRESS VIEW */}
          {downloadStatus === 'downloading' && (
            <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-4 space-y-3.5 shadow-lg shadow-cyan-950/20 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                  <span className="font-semibold text-slate-200">
                    {progress.targetLabel ||
                      (progress.stage === 'verifying'
                        ? 'Verifying cryptographic integrity...'
                        : progress.stage === 'reconstructing'
                        ? 'Reconstructing parity shards...'
                        : 'Downloading from storage nodes...')}
                  </span>
                </div>
                <span className="text-cyan-400 font-mono font-bold text-sm">
                  {progress.percent}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden p-0.5 border border-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300 shadow-sm shadow-cyan-500/50"
                  style={{ width: `${Math.max(5, progress.percent)}%` }}
                />
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                <div className="bg-slate-950/80 rounded-lg p-2 border border-slate-800/80">
                  <div className="text-[10px] text-slate-500">Transferred</div>
                  <div className="text-slate-200 font-semibold truncate">
                    {formatSize(progress.transferredBytes)}
                  </div>
                </div>
                <div className="bg-slate-950/80 rounded-lg p-2 border border-slate-800/80">
                  <div className="text-[10px] text-slate-500">Speed</div>
                  <div className="text-cyan-400 font-semibold truncate">
                    ⚡ {formatSpeed(progress.speedBps)}
                  </div>
                </div>
                <div className="bg-slate-950/80 rounded-lg p-2 border border-slate-800/80">
                  <div className="text-[10px] text-slate-500">ETA</div>
                  <div className="text-slate-200 font-semibold truncate">
                    ⏱ {formatEta(progress.etaSeconds)}
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 flex items-center justify-between">
                <span>
                  Shard: {progress.currentShard} / {progress.totalShards}
                </span>
                <span className="truncate max-w-[240px]" title={destinationPath}>
                  Saving to: {destinationPath.split(/[/\\]/).pop()}
                </span>
              </div>
            </div>
          )}

          {/* COMPLETED SUCCESS VIEW */}
          {downloadStatus === 'completed' && (
            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4 space-y-3 animate-fade-in">
              <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>File successfully downloaded and integrity verified!</span>
              </div>
              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] text-slate-300 break-all select-all">
                {completedPath || destinationPath}
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={handleRevealItem}
                  className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition-all shadow-sm"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Show in Folder</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenFile}
                  className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-sm shadow-emerald-600/30"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open File</span>
                </button>
              </div>
            </div>
          )}

          {/* FAILED ERROR VIEW */}
          {downloadStatus === 'failed' && (
            <div className="bg-rose-950/20 border border-rose-500/30 rounded-xl p-4 space-y-2.5 text-rose-300 animate-fade-in">
              <div className="flex items-center space-x-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>Download Failed</span>
              </div>
              <p className="text-[11px] text-rose-200 font-mono bg-slate-950/80 border border-rose-500/20 rounded-lg p-2.5 break-all">
                {errorMessage || 'Unknown error occurred while downloading file.'}
              </p>
            </div>
          )}

          {/* Destination Path Input (Visible in idle or failed state) */}
          {(downloadStatus === 'idle' || downloadStatus === 'failed') && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-300 block">
                  Save Destination Path:
                </label>
                {isLoadingPath && (
                  <span className="text-[10px] text-cyan-400 animate-pulse font-mono">Resolving path...</span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={destinationPath}
                  onChange={(e) => setDestinationPath(e.target.value)}
                  placeholder="Full file destination path (e.g. /home/user/Downloads/file.pdf)"
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 placeholder-slate-600"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition-all shrink-0"
                  title="Browse folder via system dialog"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Browse...</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                The file will be reconstructed directly on disk at this exact location.
              </p>
            </div>
          )}

          {/* Preference Checkbox (Visible in idle state) */}
          {downloadStatus === 'idle' && (
            <div className="pt-2 flex items-center justify-between border-t border-slate-800/60">
              <label htmlFor="modalPromptCheckbox" className="text-[11px] text-slate-400 cursor-pointer flex items-center space-x-2">
                <input
                  id="modalPromptCheckbox"
                  type="checkbox"
                  checked={promptSaveLocation}
                  onChange={(e) => handleTogglePromptSave(e.target.checked)}
                  className="rounded border-slate-800 text-emerald-500 focus:ring-emerald-500/20 bg-slate-900 w-3.5 h-3.5 cursor-pointer"
                />
                <span>Always ask where to save each file</span>
              </label>
              <span className="text-[10px] text-slate-600">Can be changed in Settings</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 bg-slate-900/50 border-t border-slate-800">
          {downloadStatus === 'downloading' ? (
            <>
              <button
                type="button"
                onClick={handleCancelDownload}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all"
                title="Cancel download and remove partial file"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>

              <div className="flex items-center space-x-2">
                {onNavigateToTransfers && (
                  <button
                    type="button"
                    onClick={onNavigateToTransfers}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
                    title="Switch to Transfers tab"
                  >
                    <span>View in Queue</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30"
                  title="Close modal and continue downloading in the background"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Run in Background</span>
                </button>
              </div>
            </>
          ) : downloadStatus === 'completed' ? (
            <div className="flex items-center justify-end w-full space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all"
              >
                Done
              </button>
            </div>
          ) : downloadStatus === 'failed' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleStartDownload}
                className="flex items-center space-x-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/30"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Download</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartDownload}
                disabled={!destinationPath.trim()}
                className="flex items-center space-x-2 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Start Download</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
