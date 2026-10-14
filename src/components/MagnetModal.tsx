import React, { useState } from 'react';
import { X, Link as LinkIcon, Download, AlertCircle, FileText } from 'lucide-react';
import { MagnetInfo } from '../types';
import { api } from '../services/api';

interface MagnetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadFromMagnet: (packageId: string) => void;
}

export const MagnetModal: React.FC<MagnetModalProps> = ({
  isOpen,
  onClose,
  onDownloadFromMagnet,
}) => {
  const [magnetUri, setMagnetUri] = useState('');
  const [parsedInfo, setParsedInfo] = useState<MagnetInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUriChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMagnetUri(val);
    setErrorMsg(null);

    if (val.trim().startsWith('magdrive:?') || val.trim().startsWith('magnet:?')) {
      try {
        const info = await api.parseMagnet(val.trim());
        setParsedInfo(info);
      } catch (err: any) {
        setParsedInfo(null);
        setErrorMsg('Invalid magnet link format.');
      }
    } else {
      setParsedInfo(null);
    }
  };

  const handleStartDownload = () => {
    if (!parsedInfo) return;
    onDownloadFromMagnet(parsedInfo.package_id);
    onClose();
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <LinkIcon className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">Open MagDrive Magnet Link</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          <div>
            <label className="font-semibold text-slate-300 block mb-1.5">
              Paste Magnet URI:
            </label>
            <textarea
              rows={3}
              placeholder="magdrive:?xt=urn:magdrive:pkg_...&sz=...&dn=..."
              value={magnetUri}
              onChange={handleUriChange}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-cyan-500 placeholder-slate-600 resize-none"
            />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {parsedInfo && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-2 text-cyan-400 font-semibold mb-1">
                <FileText className="w-4 h-4" />
                <span>Magnet File Preview:</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500 block text-[10px]">File Name:</span>
                  <span className="font-semibold">{parsedInfo.name || '(Unnamed)'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Original Size:</span>
                  <span className="font-mono">{formatSize(parsedInfo.total_bytes)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block text-[10px]">Package ID:</span>
                  <span className="font-mono text-[10px] text-slate-400">{parsedInfo.package_id}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-800 bg-slate-900/40 flex items-center justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStartDownload}
            disabled={!parsedInfo}
            className="flex items-center space-x-1.5 px-5 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download File</span>
          </button>
        </div>
      </div>
    </div>
  );
};
