import { invoke } from '@tauri-apps/api/core';
import {
  DrivePermissionItem,
  GcpCredentials,
  MagnetInfo,
  PackageManifest,
  TransferRecord,
  VaultRecord,
  VaultTarget,
  FileEntry,
} from '../types';

export const api = {
  // GCP & OAuth
  getGcpSettings: () => invoke<GcpCredentials | null>('get_gcp_settings'),
  saveGcpSettings: (credentials: GcpCredentials) =>
    invoke<void>('save_gcp_settings', { credentials }),
  startGoogleLogin: () => invoke<string>('start_google_login'),
  checkLoginStatus: () => invoke<boolean>('check_login_status'),
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

  // Permissions (RBAC)
  listDriveMembers: (targetId: string) =>
    invoke<DrivePermissionItem[]>('list_drive_members', { targetId }),
  addDriveMember: (targetId: string, email: string, role: string) =>
    invoke<DrivePermissionItem>('add_drive_member', { targetId, email, role }),
  removeDriveMember: (targetId: string, permissionId: string) =>
    invoke<void>('remove_drive_member', { targetId, permissionId }),

  // Catalog & Magnet
  syncCatalog: (passphrase?: string) => invoke<number>('sync_catalog', { passphrase }),
  listCatalogFiles: () => invoke<PackageManifest[]>('list_catalog_files'),
  parseMagnet: (magnetUri: string) => invoke<MagnetInfo>('parse_magnet', { magnetUri }),
  generateMagnet: (packageId: string) => invoke<string>('generate_magnet', { packageId }),
  deletePackage: (packageId: string) => invoke<void>('delete_package', { packageId }),

  // Transfers
  listTransfers: () => invoke<TransferRecord[]>('list_transfers'),
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
  downloadPackage: (packageId: string, passphrase?: string) =>
    invoke<string>('download_package', { packageId, passphrase }),
};
