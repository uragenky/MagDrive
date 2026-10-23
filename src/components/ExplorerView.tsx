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
  UploadCloud,
  RefreshCw,
  LayoutGrid,
  List,
  Clock,
} from 'lucide-react';
import { PackageManifest } from '../types';

interface ExplorerViewProps {
  files: PackageManifest[];
  onDownload: (packageId: string) => void;
  onDelete: (packageId: string) => void;
  onCopyMagnet: (packageId: string) => void;
  onGoToUpload: () => void;
  isDownloading: string | null;
  onSync?: () => void;
  isSyncing?: boolean;
  onFileDrop?: (file: File) => void;
}

export const ExplorerView: React.FC<ExplorerViewProps> = ({
  files,
  onDownload,
  onDelete,
  onCopyMagnet,
  onGoToUpload,
  isDownloading,
  onSync,
  isSyncing = false,
  onFileDrop,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'file' | 'folder'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

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
    });
  };

  const handleCopy = (pkgId: string) => {
    onCopyMagnet(pkgId);
    setCopiedId(pkgId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate if leaving target element completely
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      if (onFileDrop) {
        onFileDrop(droppedFiles[0]);
      } else {
        onGoToUpload();
      }
    }
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
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 flex flex-col h-full bg-[#0c0d0e] overflow-hidden relative"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-[#0c0d0e]/90 backdrop-blur-sm border-2 border-dashed border-zinc-500 flex flex-col items-center justify-center p-8 animate-in fade-in duration-150">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800 text-zinc-100 border border-zinc-700 flex items-center justify-center mb-4 shadow-xl animate-bounce">
            <UploadCloud className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-zinc-100">Drop File to Upload</h3>
          <p className="text-xs text-zinc-400 mt-1 max-w-sm text-center">
            Your file will be encrypted on this device and distributed securely across your drives.
          </p>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="p-6 border-b border-[#202226] flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search files by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#141517] border border-[#24262b] rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20 transition-all"
          />
        </div>

        <div className="flex items-center space-x-2.5">
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              title="Sync files with Google Drive"
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#141517] hover:bg-[#1a1c1f] text-zinc-300 border border-[#24262b] hover:border-[#32353c] transition-all shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-zinc-300 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Drive'}</span>
            </button>
          )}

          {/* Filter Pills */}
          <div className="bg-[#141517] p-1 rounded-xl border border-[#24262b] flex text-xs space-x-0.5">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                filterType === 'all'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({files.length})
            </button>
            <button
              onClick={() => setFilterType('file')}
              className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                filterType === 'file'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Files ({files.filter((f) => f.pkg_type === 'file').length})
            </button>
            <button
              onClick={() => setFilterType('folder')}
              className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                filterType === 'folder'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Folders ({files.filter((f) => f.pkg_type === 'folder').length})
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="bg-[#141517] p-1 rounded-xl border border-[#24262b] flex text-xs space-x-0.5">
            <button
              onClick={() => setViewMode('table')}
              title="Table View"
              className={`p-1.5 rounded-lg transition-all ${
                viewMode === 'table'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              title="Grid View"
              className={`p-1.5 rounded-lg transition-all ${
                viewMode === 'grid'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* File Content Area */}
      <div className="flex-1 overflow-auto p-6">
        {filteredFiles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-[#141517] border border-[#24262b] flex items-center justify-center text-zinc-500 mb-4 shadow-inner">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-zinc-200 mb-1">
              {files.length === 0 ? 'Data Vault is Empty' : 'No Matching Files Found'}
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm mb-6 leading-relaxed">
              {files.length === 0
                ? 'Upload or drop a file to store it securely across your drives.'
                : 'Try adjusting your search query or category filter.'}
            </p>
            {files.length === 0 && (
              <button
                onClick={onGoToUpload}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 transition-all shadow-sm border border-white/20"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Upload File</span>
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid Card View */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredFiles.map((item) => {
              const isFile = item.pkg_type === 'file';
              const totalShards =
                item.erasure_schema.data_shards + item.erasure_schema.parity_shards;

              return (
                <div
                  key={item.package_id}
                  className="bg-[#131417] border border-[#222429] hover:border-[#32353c] rounded-2xl p-4 flex flex-col justify-between space-y-3.5 transition-all group shadow-sm hover:shadow-md"
                >
                  <div>
                    <div className="flex items-start justify-between space-x-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-zinc-800/80 text-zinc-300 border border-zinc-700/60">
                        {isFile ? <FileText className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
                      </div>

                      <span className="inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                        <ShieldCheck className="w-3 h-3" />
                        <span>{totalShards} Shards</span>
                      </span>
                    </div>

                    <div className="mt-3">
                      <h4
                        className="font-semibold text-zinc-100 text-xs truncate leading-snug"
                        title={item.name}
                      >
                        {item.name}
                      </h4>
                      <p className="text-[10px] text-zinc-500 font-mono truncate mt-0.5" title={item.package_id}>
                        {item.package_id}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#202226] space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                      <span>{formatSize(item.total_size)}</span>
                      <span className="flex items-center space-x-1 text-[10px] text-zinc-500">
                        <Clock className="w-3 h-3" />
                        <span>{formatDate(item.created_at)}</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-end space-x-1 pt-1">
                      <button
                        onClick={() => handleCopy(item.package_id)}
                        title="Copy Magnet Link"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
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
                        title="Download File"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all disabled:opacity-50"
                      >
                        <Download
                          className={`w-4 h-4 ${
                            isDownloading === item.package_id ? 'animate-bounce text-emerald-400' : ''
                          }`}
                        />
                      </button>
                      <button
                        onClick={() => onDelete(item.package_id)}
                        title="Delete File"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Table View */
          <div className="bg-[#131417] border border-[#222429] rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#18191d] border-b border-[#222429] text-zinc-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">File Name</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Redundancy Health</th>
                  <th className="py-3 px-4">Uploaded At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222429] text-zinc-300">
                {filteredFiles.map((item) => {
                  const isFile = item.pkg_type === 'file';
                  const totalShards =
                    item.erasure_schema.data_shards + item.erasure_schema.parity_shards;

                  return (
                    <tr
                      key={item.package_id}
                      className="hover:bg-[#18191d]/60 transition-colors group"
                    >
                      <td className="py-3 px-4 font-medium text-zinc-100 flex items-center space-x-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-zinc-800/80 text-zinc-300 border border-zinc-700/60">
                          {isFile ? (
                            <FileText className="w-3.5 h-3.5" />
                          ) : (
                            <Folder className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-200 truncate">{item.name}</div>
                          <div className="text-[10px] text-zinc-500 font-mono truncate">
                            {item.package_id}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-zinc-400 font-mono">
                        {formatSize(item.total_size)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          <ShieldCheck className="w-3 h-3" />
                          <span>Healthy ({totalShards}/{totalShards} Shards)</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-400">{formatDate(item.created_at)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => handleCopy(item.package_id)}
                            title="Copy Magnet Link"
                            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
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
                            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
                          >
                            <Download
                              className={`w-4 h-4 ${
                                isDownloading === item.package_id ? 'animate-bounce text-emerald-400' : ''
                              }`}
                            />
                          </button>
                          <button
                            onClick={() => onDelete(item.package_id)}
                            title="Delete File"
                            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-zinc-400 hover:text-rose-400 transition-colors"
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
