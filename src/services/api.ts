import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  DrivePermissionItem,
  GcpCredentials,
  MagnetInfo,
  PackageManifest,
  TransferRecord,
  VaultRecord,
  VaultTarget,
  FileEntry,
  UploadSessionInfo,
  TransferProgressPayload,
  DownloadSettings,
  DownloadResult,
  SwarmResolveResult,
  TrackerSettings,
  GoogleUserProfile,
  AdaptiveErasureInfo,
  TargetMigrationStats,
  TargetMigrationResult,
} from '../types';

// Fast native FileReader blob-to-base64 conversion (avoids large JS string allocations)
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

export const api = {
  // GCP & OAuth
  getGcpSettings: () => invoke<GcpCredentials | null>('get_gcp_settings'),
  saveGcpSettings: (credentials: GcpCredentials) =>
    invoke<void>('save_gcp_settings', { credentials }),
  startGoogleLogin: () => invoke<string>('start_google_login'),
  checkLoginStatus: () => invoke<boolean>('check_login_status'),
  getGoogleUserProfile: () => invoke<GoogleUserProfile | null>('get_google_user_profile'),
  logoutGoogle: () => invoke<void>('logout_google'),

  // Vault
  createVault: (name: string, passphrase: string, targets: VaultTarget[]) =>
    invoke<VaultRecord>('create_vault', { name, passphrase, targets }),
  listVaults: () => invoke<VaultRecord[]>('list_vaults'),
  getActiveVault: () => invoke<VaultRecord | null>('get_active_vault'),
  setActiveVault: (vaultId: string) => invoke<void>('set_active_vault', { vaultId }),
  deleteVault: (vaultId: string) => invoke<void>('delete_vault', { vaultId }),
  exportVaultConfig: (vaultId: string, role: string) =>
    invoke<string>('export_vault_config', { vaultId, role }),
  importVaultConfig: (configB64: string, passphrase: string) =>
    invoke<VaultRecord>('import_vault_config', { configB64, passphrase }),
  saveVaultJsonToFile: (vaultId: string) =>
    invoke<string | null>('save_vault_json_to_file', { vaultId }),
  loadVaultJsonFromFile: () =>
    invoke<string | null>('load_vault_json_from_file'),
  importVaultFromJson: (jsonContent: string, passphrase: string) =>
    invoke<VaultRecord>('import_vault_from_json', { jsonContent, passphrase }),
  uploadVaultDescriptorToDrive: (vaultId: string) =>
    invoke<string>('upload_vault_descriptor_to_drive', { vaultId }),

  // Permissions (RBAC)
  listDriveMembers: (targetId: string) =>
    invoke<DrivePermissionItem[]>('list_drive_members', { targetId }),
  addDriveMember: (targetId: string, email: string, role: string) =>
    invoke<DrivePermissionItem>('add_drive_member', { targetId, email, role }),
  removeDriveMember: (targetId: string, permissionId: string) =>
    invoke<void>('remove_drive_member', { targetId, permissionId }),

  // Catalog & Magnet & Swarm
  syncCatalog: (passphrase?: string) => invoke<number>('sync_catalog', { passphrase }),
  listCatalogFiles: () => invoke<PackageManifest[]>('list_catalog_files'),
  parseMagnet: (magnetUri: string) => invoke<MagnetInfo>('parse_magnet', { magnetUri }),
  generateMagnet: (packageId: string) => invoke<string>('generate_magnet', { packageId }),
  resolveMagnetPackage: (magnetUri: string) =>
    invoke<SwarmResolveResult>('resolve_magnet_package', { magnetUri }),
  copyShardsToMyDrive: (packageId: string, optInSeeding: boolean) =>
    invoke<string>('copy_shards_to_my_drive', { packageId, optInSeeding }),
  getTrackerSettings: () => invoke<TrackerSettings>('get_tracker_settings'),
  saveTrackerSettings: (trackers: string[], defaultSeeding: boolean) =>
    invoke<void>('save_tracker_settings', { trackers, defaultSeeding }),
  getAdaptiveErasureInfo: (targetsCount: number) =>
    invoke<AdaptiveErasureInfo>('get_adaptive_erasure_info', { targetsCount }),
  getTargetMigrationStats: (vaultId: string, sourceTargetId: string) =>
    invoke<TargetMigrationStats>('get_target_migration_stats', { vaultId, sourceTargetId }),
  migrateTargetToNew: (
    vaultId: string,
    sourceTargetId: string,
    newTarget: VaultTarget,
    deleteOldShards: boolean,
    passphrase?: string
  ) =>
    invoke<TargetMigrationResult>('migrate_target_to_new', {
      vaultId,
      sourceTargetId,
      newTarget,
      deleteOldShards,
      passphrase,
    }),
  evacuateTarget: (
    vaultId: string,
    sourceTargetId: string,
    deleteOldShards: boolean,
    passphrase?: string
  ) =>
    invoke<TargetMigrationResult>('evacuate_target', {
      vaultId,
      sourceTargetId,
      deleteOldShards,
      passphrase,
    }),
  deletePackage: (packageId: string) => invoke<void>('delete_package', { packageId }),

  // Transfers
  listTransfers: () => invoke<TransferRecord[]>('list_transfers'),
  pauseTransfer: (transferId: string) => invoke<void>('pause_transfer', { transferId }),
  resumeTransfer: (transferId: string) => invoke<void>('resume_transfer', { transferId }),
  cancelTransfer: (transferId: string) => invoke<void>('cancel_transfer', { transferId }),
  deleteTransfer: (transferId: string) => invoke<void>('delete_transfer', { transferId }),
  clearFinishedTransfers: () => invoke<void>('clear_finished_transfers'),

  // Streaming Upload API
  initUploadSession: (
    fileName: string,
    totalBytes: number,
    chunkSize: number,
    isFolder: boolean,
    passphrase?: string
  ) =>
    invoke<UploadSessionInfo>('init_upload_session', {
      fileName,
      totalBytes,
      chunkSize,
      isFolder,
      passphrase,
    }),
  uploadChunkPart: (sessionId: string, chunkIndex: number, chunkBytesBase64: string) =>
    invoke<void>('upload_chunk_part', {
      sessionId,
      chunkIndex,
      chunkBytesBase64,
    }),
  finishUploadSession: (sessionId: string) =>
    invoke<string>('finish_upload_session', { sessionId }),

  // Helper for adaptive chunked upload
  uploadFileStream: async (
    file: File,
    passphrase: string | undefined,
    onProgress?: (progress: TransferProgressPayload) => void
  ): Promise<string> => {
    // Adaptive chunk size:
    // < 100 MB -> 16 MB
    // 100 MB - 1 GB -> 32 MB
    // > 1 GB -> 64 MB
    let chunkSize = 32 * 1024 * 1024;
    if (file.size < 100 * 1024 * 1024) {
      chunkSize = 16 * 1024 * 1024;
    } else if (file.size > 1024 * 1024 * 1024) {
      chunkSize = 64 * 1024 * 1024;
    }

    const session = await api.initUploadSession(
      file.name,
      file.size,
      chunkSize,
      false,
      passphrase
    );

    let unlisten: (() => void) | undefined;
    if (onProgress) {
      unlisten = await listen<TransferProgressPayload>('transfer-progress', (event) => {
        if (event.payload.transfer_id === session.transfer_id) {
          onProgress(event.payload);
        }
      });
    }

    try {
      let offset = 0;
      let chunkIndex = 0;
      const startTime = Date.now();

      while (offset < file.size) {
        const end = Math.min(offset + chunkSize, file.size);
        const slice = file.slice(offset, end);
        const b64Part = await blobToBase64(slice);

        await api.uploadChunkPart(session.session_id, chunkIndex, b64Part);

        offset = end;
        chunkIndex++;

        if (onProgress) {
          const elapsedSecs = Math.max(0.1, (Date.now() - startTime) / 1000);
          const speedBps = Math.round(offset / elapsedSecs);
          const eta = speedBps > 0 ? Math.round((file.size - offset) / speedBps) : 0;
          onProgress({
            transfer_id: session.transfer_id,
            stage: 'slicing',
            current_shard: chunkIndex,
            total_shards: session.total_chunks,
            transferred: offset,
            transferred_bytes: offset,
            total: file.size,
            total_bytes: file.size,
            speed_bps: speedBps,
            eta_seconds: eta,
            status: 'transferring',
          });
        }
      }

      return await api.finishUploadSession(session.session_id);
    } finally {
      if (unlisten) {
        unlisten();
      }
    }
  },

  uploadFilePackage: (
    fileName: string,
    fileBytesBase64: string,
    isFolder: boolean,
    tree: FileEntry[],
    passphrase?: string
  ) =>
    invoke<string>('upload_file_package', {
      fileName,
      fileBytesBase64,
      isFolder,
      tree,
      passphrase,
    }),
  downloadPackage: (packageId: string, destinationPath: string, passphrase?: string) =>
    invoke<DownloadResult>('download_package', { packageId, destinationPath, passphrase }),
  getDownloadSettings: () => invoke<DownloadSettings>('get_download_settings'),
  saveDownloadSettings: (downloadDir: string, promptSaveLocation: boolean) =>
    invoke<void>('save_download_settings', { downloadDir, promptSaveLocation }),
  pickDownloadDirectory: (defaultDir?: string) =>
    invoke<string | null>('pick_download_directory', { defaultDir }),
  pickSaveFilePath: (defaultName: string, defaultDir?: string) =>
    invoke<string | null>('pick_save_file_path', { defaultName, defaultDir }),
  resolveDownloadPath: (downloadDir: string, fileName: string) =>
    invoke<string>('resolve_download_path', { downloadDir, fileName }),
};
