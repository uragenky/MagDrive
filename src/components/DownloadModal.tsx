import React, { useState, useEffect } from 'react';
import { X, Download, FolderOpen, ShieldCheck, FileText } from 'lucide-react';
import { api } from '../services/api';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  packageId: string;
  fileName: string;
  fileSize?: number;
  originalSha256?: string;
  onConfirmDownload: (destinationPath: string) => Promise<void>;
  isDownloading: boolean;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({
  isOpen,
  onClose,
  packageId,
  fileName,
  fileSize,
  originalSha256,
  onConfirmDownload,
  isDownloading,
}) => {
  const [destinationPath, setDestinationPath] = useState('');
  const [promptSaveLocation, setPromptSaveLocation] = useState(true);
  const [downloadDir, setDownloadDir] = useState('');
  const [isLoadingPath, setIsLoadingPath] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadInitialPath();
    }
  }, [isOpen, packageId, fileName]);

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
      // Extract directory from current destinationPath if available
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

  const formatSize = (bytes?: number) => {
    if (!bytes) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Save Downloaded File</h3>
              <p className="text-[11px] text-slate-500">Choose destination directory and confirm download</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isDownloading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors disabled:opacity-50"
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

          {/* Destination Path Input */}
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
                disabled={isDownloading}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 placeholder-slate-600 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleBrowse}
                disabled={isDownloading}
                className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition-all shrink-0 disabled:opacity-50"
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

          {/* Preference Checkbox */}
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2.5 p-4 bg-slate-900/50 border-t border-slate-800">
          <button
            onClick={onClose}
            disabled={isDownloading}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirmDownload(destinationPath.trim())}
            disabled={!destinationPath.trim() || isDownloading}
            className="flex items-center space-x-2 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50"
          >
            <Download className={`w-3.5 h-3.5 ${isDownloading ? 'animate-bounce' : ''}`} />
            <span>{isDownloading ? 'Downloading...' : 'Start Download'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
