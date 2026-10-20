import React, { useState } from 'react';
import { X, Link as LinkIcon, Download, AlertCircle, FileText, CloudLightning, Globe, CheckCircle2, Loader2 } from 'lucide-react';
import { SwarmResolveResult } from '../types';
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
  const [swarmInfo, setSwarmInfo] = useState<SwarmResolveResult | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [optInSeeding, setOptInSeeding] = useState(true);
  const [copySuccessMsg, setCopySuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUriChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMagnetUri(val);
    setErrorMsg(null);
    setCopySuccessMsg(null);

    if (val.trim().startsWith('magdrive:?') || val.trim().startsWith('magnet:?')) {
      setIsResolving(true);
      try {
        const resolved = await api.resolveMagnetPackage(val.trim());
        setSwarmInfo(resolved);
      } catch (err: any) {
        setSwarmInfo(null);
        setErrorMsg(typeof err === 'string' ? err : 'Failed to resolve magnet link.');
      } finally {
        setIsResolving(false);
      }
    } else {
      setSwarmInfo(null);
    }
  };

  const handleStartDownload = () => {
    if (!swarmInfo) return;
    onDownloadFromMagnet(swarmInfo.package_id);
    onClose();
  };

  const handleCopyToDrive = async () => {
    if (!swarmInfo) return;
    setIsCopying(true);
    setErrorMsg(null);
    setCopySuccessMsg(null);
    try {
      const msg = await api.copyShardsToMyDrive(swarmInfo.package_id, optInSeeding);
      setCopySuccessMsg(msg || 'Successfully copied shards to your Google Drive!');
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : 'Failed to copy shards to Google Drive.');
    } finally {
      setIsCopying(false);
    }
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
              placeholder="magdrive:?xt=urn:magdrive:pkg_...&k=...&sz=...&dn=..."
              value={magnetUri}
              onChange={handleUriChange}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-cyan-500 placeholder-slate-600 resize-none"
            />
          </div>

          {isResolving && (
            <div className="flex items-center space-x-2 text-cyan-400 py-1">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Contacting multi-trackers & discovering mirror swarm...</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {copySuccessMsg && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{copySuccessMsg}</span>
            </div>
          )}

          {swarmInfo && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-cyan-400 font-semibold">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4" />
                  <span>File Preview:</span>
                </div>
                <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] bg-cyan-950 text-cyan-300 border border-cyan-800">
                  <Globe className="w-3 h-3" />
                  <span>{swarmInfo.peer_count} Mirror Swarm</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500 block text-[10px]">File Name:</span>
                  <span className="font-semibold text-slate-200 truncate block">{swarmInfo.name || '(Unnamed)'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Original Size:</span>
                  <span className="font-mono text-slate-200">{formatSize(swarmInfo.total_size)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block text-[10px]">Package ID:</span>
                  <span className="font-mono text-[10px] text-slate-400">{swarmInfo.package_id}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <label className="flex items-center space-x-2 cursor-pointer text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={optInSeeding}
                    onChange={(e) => setOptInSeeding(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                  />
                  <span className="text-[11px]">Help Seeding (Make my folder a public mirror after copying)</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-800 bg-slate-900/40 flex flex-wrap items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            Close
          </button>

          <button
            onClick={handleCopyToDrive}
            disabled={!swarmInfo || isCopying}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50"
            title="Copy shards directly to your Google Drive (Instant, bypasses download quota)"
          >
            {isCopying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CloudLightning className="w-3.5 h-3.5" />
            )}
            <span>Copy to My Drive (Instant)</span>
          </button>

          <button
            onClick={handleStartDownload}
            disabled={!swarmInfo}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download to Computer</span>
          </button>
        </div>
      </div>
    </div>
  );
};
