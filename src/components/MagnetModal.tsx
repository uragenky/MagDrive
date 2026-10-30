import React, { useState } from 'react';
import { X, Link as LinkIcon, Download, AlertCircle, FileText, CloudLightning, Globe, CheckCircle2, Loader2 } from 'lucide-react';
import { SwarmResolveResult } from '../types';
import { api } from '../services/api';

interface MagnetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadFromMagnet: (packageId: string, directKey?: string) => void;
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
    onDownloadFromMagnet(swarmInfo.package_id, swarmInfo.key);
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#131417] border border-[#222429] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#222429]">
          <div className="flex items-center space-x-2">
            <LinkIcon className="w-5 h-5 text-zinc-300" />
            <h3 className="text-sm font-bold text-zinc-100">Open Magnet Link</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-[#18191d] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          <div>
            <label className="font-semibold text-zinc-300 block mb-1.5">
              Paste Magnet Link:
            </label>
            <textarea
              rows={3}
              placeholder="magdrive:?xt=urn:magdrive:pkg_...&k=...&sz=...&dn=..."
              value={magnetUri}
              onChange={handleUriChange}
              className="w-full bg-[#18191d] border border-[#26282e] rounded-xl p-3 text-zinc-200 font-mono text-[11px] focus:outline-none focus:border-zinc-500 placeholder-zinc-600 resize-none"
            />
          </div>

          {isResolving && (
            <div className="flex items-center space-x-2 text-zinc-300 py-1">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
              <span>Searching swarm for peers...</span>
            </div>
          )}

          {errorMsg && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>

              {swarmInfo && (errorMsg.toLowerCase().includes('shard') || errorMsg.toLowerCase().includes('restricted') || errorMsg.toLowerCase().includes('copy') || errorMsg.toLowerCase().includes('not found')) && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 space-y-3">
                  <div className="flex items-start space-x-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold text-xs text-amber-300">
                        Cloud Server-Side Copy Restricted
                      </div>
                      <p className="text-[11px] text-zinc-300 leading-relaxed">
                        One or more shards are hosted on Google accounts with cross-domain copy restrictions. However, this file is intact and can be directly reconstructed to your local disk using Reed-Solomon recovery.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleStartDownload}
                    className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-semibold rounded-lg text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download to Computer (Auto-Recover)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {copySuccessMsg && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{copySuccessMsg}</span>
            </div>
          )}

          {swarmInfo && (
            <div className="bg-[#18191d] border border-[#26282e] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-zinc-200 font-semibold">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4" />
                  <span>File Preview:</span>
                </div>
                <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-200 border border-zinc-700">
                  <Globe className="w-3 h-3" />
                  <span>{swarmInfo.peer_count} {swarmInfo.peer_count === 1 ? 'Mirror' : 'Mirrors'} Found</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-zinc-300">
                <div>
                  <span className="text-zinc-500 block text-[10px]">File Name:</span>
                  <span className="font-semibold text-zinc-200 truncate block">{swarmInfo.name || '(Unnamed)'}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[10px]">Original Size:</span>
                  <span className="font-mono text-zinc-200">{formatSize(swarmInfo.total_size)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-zinc-500 block text-[10px]">Package ID:</span>
                  <span className="font-mono text-[10px] text-zinc-400">{swarmInfo.package_id}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-[#26282e] flex items-center justify-between">
                <label className="flex items-center space-x-2 cursor-pointer text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={optInSeeding}
                    onChange={(e) => setOptInSeeding(e.target.checked)}
                    className="rounded border-[#26282e] bg-[#131417] text-zinc-200 focus:ring-0"
                  />
                  <span className="text-[11px]">Help Seeding (Make my folder a public mirror after copying)</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[#222429] bg-[#18191d]/40 flex flex-wrap items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-[#18191d] hover:bg-[#222428] border border-[#26282e] transition-all"
          >
            Close
          </button>

          <button
            onClick={handleCopyToDrive}
            disabled={!swarmInfo || isCopying}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white transition-all shadow-sm border border-emerald-500/30 disabled:opacity-50"
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
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download to Computer</span>
          </button>
        </div>
      </div>
    </div>
  );
};
