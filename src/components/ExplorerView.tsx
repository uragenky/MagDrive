import React, { useState } from 'react';
import {
  Search,
  FileText,
  Folder,
  Download,
  Copy,
  Check,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  UploadCloud,
} from 'lucide-react';
import { PackageManifest } from '../types';

interface ExplorerViewProps {
  files: PackageManifest[];
  onDownload: (packageId: string) => void;
  onDelete: (packageId: string) => void;
  onCopyMagnet: (packageId: string) => void;
  onGoToUpload: () => void;
  isDownloading: string | null;
}

export const ExplorerView: React.FC<ExplorerViewProps> = ({
  files,
  onDownload,
  onDelete,
  onCopyMagnet,
  onGoToUpload,
  isDownloading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'file' | 'folder'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleCopy = (pkgId: string) => {
    onCopyMagnet(pkgId);
    setCopiedId(pkgId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredFiles = files.filter((f) => {
    const matchesSearch =
      f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.package_id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType =
      filterType === 'all' ||
      (filterType === 'file' && f.pkg_type === 'file') ||
      (filterType === 'folder' && f.pkg_type === 'folder');
    return matchesSearch && matchesType;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-hidden">
      {/* Search & Filter Toolbar */}
      <div className="p-6 border-b border-slate-800 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search files by name or package ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
          />
        </div>

        <div className="flex items-center space-x-2">
          <div className="bg-slate-950 p-1 rounded-lg border border-slate-800 flex text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-md transition-all font-medium ${
                filterType === 'all'
                  ? 'bg-slate-800 text-cyan-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({files.length})
            </button>
            <button
              onClick={() => setFilterType('file')}
              className={`px-3 py-1 rounded-md transition-all font-medium ${
                filterType === 'file'
                  ? 'bg-slate-800 text-cyan-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Files ({files.filter((f) => f.pkg_type === 'file').length})
            </button>
            <button
              onClick={() => setFilterType('folder')}
              className={`px-3 py-1 rounded-md transition-all font-medium ${
                filterType === 'folder'
                  ? 'bg-slate-800 text-cyan-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Folders ({files.filter((f) => f.pkg_type === 'folder').length})
            </button>
          </div>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-auto p-6">
        {filteredFiles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center text-slate-500 mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-200 mb-1">
              {files.length === 0 ? 'Data Vault is Empty' : 'No Matching Files Found'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mb-6">
              {files.length === 0
                ? 'Upload your first file to this vault. Files will be encrypted and erasure-coded across cloud targets.'
                : 'Try adjusting your search query or category filter.'}
            </p>
            {files.length === 0 && (
              <button
                onClick={onGoToUpload}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/30"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Upload New File</span>
              </button>
            )}
          </div>
        ) : (
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">File Name</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Redundancy Health</th>
                  <th className="py-3 px-4">Uploaded At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredFiles.map((item) => {
                  const isFile = item.pkg_type === 'file';
                  const totalShards =
                    item.erasure_schema.data_shards + item.erasure_schema.parity_shards;
                  const isDegraded = false; // Evaluated dynamically if some chunk is down

                  return (
                    <tr
                      key={item.package_id}
                      className="hover:bg-slate-900/40 transition-colors group"
                    >
                      <td className="py-3 px-4 font-medium text-slate-100 flex items-center space-x-3">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            isFile
                              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {isFile ? (
                            <FileText className="w-3.5 h-3.5" />
                          ) : (
                            <Folder className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200">{item.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {item.package_id}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-mono">
                        {formatSize(item.total_size)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-1.5">
                          {isDegraded ? (
                            <span className="inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Degraded ({totalShards - 1}/{totalShards})</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <ShieldCheck className="w-3 h-3" />
                              <span>Healthy ({totalShards}/{totalShards} Shards)</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-400">{formatDate(item.created_at)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => handleCopy(item.package_id)}
                            title="Copy Magnet Link"
                            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-colors"
                          >
                            {copiedId === item.package_id ? (
                              <Check className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => onDownload(item.package_id)}
                            disabled={isDownloading === item.package_id}
                            title="Download & Decrypt File"
                            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
                          >
                            <Download
                              className={`w-4 h-4 ${
                                isDownloading === item.package_id ? 'animate-bounce text-emerald-400' : ''
                              }`}
                            />
                          </button>
                          <button
                            onClick={() => onDelete(item.package_id)}
                            title="Delete File (Uploader / Admin Only)"
                            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
