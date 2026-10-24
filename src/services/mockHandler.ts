import { mockIPC } from '@tauri-apps/api/mocks';
import {
  mockVaults,
  mockGoogleAccounts,
  mockStorageQuota,
  mockTargetUsageMap,
  mockCatalogFiles,
  mockTransfers,
  mockErasureInfo,
  mockTrackerSettings,
  mockGcpSettings,
  mockUserProfile,
  mockSharedDrives,
  mockDownloadSettings,
} from './mockData';
import { VaultRecord, PackageManifest, TransferRecord } from '../types';

let currentVaults: VaultRecord[] = [...mockVaults];
let currentActiveVault: VaultRecord | null = currentVaults[0] || null;
let currentFiles: PackageManifest[] = [...mockCatalogFiles];
let currentTransfers: TransferRecord[] = [...mockTransfers];

export function setupMockEnvironment() {
  const isTauriRuntime =
    typeof window !== 'undefined' &&
    Boolean((window as any).__TAURI_INTERNALS__?.invoke);

  const forceDemo =
    typeof window !== 'undefined' &&
    (window.location.search.includes('demo=1') ||
      window.location.search.includes('demo=true'));

  // If we are in real Tauri desktop app and not forcing demo, do not mock!
  if (isTauriRuntime && !forceDemo) {
    return;
  }

  console.info('[MagDrive] Running in Demo / Mock mode for screenshot & browser preview.');

  mockIPC(
    (cmd: string, args: any) => {
      switch (cmd) {
        // Vaults
        case 'list_vaults':
          return currentVaults;

        case 'get_active_vault':
          return currentActiveVault;

        case 'set_active_vault': {
          const found = currentVaults.find((v) => v.id === args?.vaultId);
          if (found) currentActiveVault = found;
          return null;
        }

        case 'create_vault': {
          const newVault: VaultRecord = {
            id: 'vault_' + Date.now(),
            name: args.name || 'New Vault',
            role: 'admin',
            salt_hex: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
            verification_tag: '0123456789abcdef0123456789abcdef',
            created_at: Date.now(),
            targets: args.targets || [],
          };
          currentVaults.push(newVault);
          currentActiveVault = newVault;
          return newVault;
        }

        case 'delete_vault': {
          currentVaults = currentVaults.filter((v) => v.id !== args?.vaultId);
          if (currentActiveVault?.id === args?.vaultId) {
            currentActiveVault = currentVaults[0] || null;
          }
          return null;
        }

        case 'export_vault_config':
          return 'bW9jay1tYWdkcml2ZS12YXVsdC1jb25maWctZXhwb3J0';

        case 'import_vault_config':
        case 'import_vault_from_json':
          return currentVaults[0];

        case 'save_vault_json_to_file':
          return 'Personal_Cloud_Vault.json';

        case 'load_vault_json_from_file':
          return null;

        case 'upload_vault_descriptor_to_drive':
          return 'mock_descriptor_file_id';

        // Catalog & Files
        case 'sync_catalog':
          return currentFiles.length;

        case 'list_catalog_files':
          return currentFiles;

        case 'delete_package':
          currentFiles = currentFiles.filter((f) => f.package_id !== args?.packageId);
          return null;

        // Magnet & Swarm
        case 'parse_magnet':
          return {
            package_id: 'pkg_9f8e7d6c5b4a3120',
            name: 'q4_financial_audit_confidential.pdf',
            total_bytes: 14889779,
            vault_hint: 'Personal Cloud Vault',
            sources: ['1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01', '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03'],
            trackers: ['https://magdrive-tracker.vercel.app/api'],
          };

        case 'generate_magnet':
          return `magdrive://${args?.packageId || 'pkg_9f8e7d6c5b4a3120'}?k=a1b2c3d4e5f6&name=q4_financial_audit_confidential.pdf`;

        case 'resolve_magnet_package':
          return {
            package_id: 'pkg_9f8e7d6c5b4a3120',
            name: 'q4_financial_audit_confidential.pdf',
            total_size: 14889779,
            peer_count: 3,
            sources: ['Primary Personal Drive', 'Workspace Shared Drive'],
            trackers: ['https://magdrive-tracker.vercel.app/api'],
            is_local: true,
          };

        case 'copy_shards_to_my_drive':
          return 'folder_copy_success_id';

        case 'get_tracker_settings':
          return mockTrackerSettings;

        case 'save_tracker_settings':
          return null;

        // Erasure & Migration
        case 'get_adaptive_erasure_info':
          return mockErasureInfo;

        case 'get_target_migration_stats':
          return {
            target_id: args?.sourceTargetId || '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01',
            total_packages: 5,
            affected_packages: 5,
            chunks_on_target: 24,
            total_vault_chunks: 72,
          };

        case 'migrate_target_to_new':
          return {
            success: true,
            total_migrated: 24,
            copied_count: 24,
            relayed_count: 0,
            reconstructed_count: 0,
            failed_count: 0,
            message: 'All 24 shards migrated successfully to destination drive.',
          };

        case 'evacuate_target':
          return {
            success: true,
            total_migrated: 24,
            copied_count: 0,
            relayed_count: 0,
            reconstructed_count: 24,
            failed_count: 0,
            message: 'Evacuation complete: 24 shards reconstructed via Reed-Solomon parity.',
          };

        // Transfers
        case 'list_transfers':
          return currentTransfers;

        case 'pause_transfer':
          currentTransfers = currentTransfers.map((t) =>
            t.id === args?.transferId ? { ...t, status: 'paused' } : t
          );
          return null;

        case 'resume_transfer':
          currentTransfers = currentTransfers.map((t) =>
            t.id === args?.transferId ? { ...t, status: 'transferring' } : t
          );
          return null;

        case 'cancel_transfer':
          currentTransfers = currentTransfers.map((t) =>
            t.id === args?.transferId ? { ...t, status: 'cancelled' } : t
          );
          return null;

        case 'delete_transfer':
          currentTransfers = currentTransfers.filter((t) => t.id !== args?.transferId);
          return null;

        case 'clear_finished_transfers':
          currentTransfers = currentTransfers.filter(
            (t) => t.status !== 'completed' && t.status !== 'cancelled'
          );
          return null;

        // Upload session
        case 'init_upload_session':
          return {
            session_id: 'sess_mock_' + Date.now(),
            transfer_id: 'tr_upload_new',
            chunk_size: 16777216,
            total_chunks: 3,
          };

        case 'upload_chunk_part':
          return null;

        case 'finish_upload_session':
          return 'pkg_uploaded_mock_id';

        case 'upload_file_package':
          return 'pkg_uploaded_mock_id';

        // Downloads
        case 'download_package':
          return {
            destination_path: 'C:\\Users\\Alex\\Downloads\\q4_financial_audit_confidential.pdf',
            total_bytes: 14889779,
          };

        case 'get_download_settings':
          return mockDownloadSettings;

        case 'save_download_settings':
          return null;

        case 'pick_download_directory':
          return 'C:\\Users\\Alex\\Downloads\\MagDrive';

        case 'pick_save_file_path':
          return 'C:\\Users\\Alex\\Downloads\\' + (args?.defaultName || 'file.dat');

        case 'resolve_download_path':
          return `${args?.downloadDir || 'C:\\Users\\Alex\\Downloads'}\\${args?.fileName || 'file.dat'}`;

        // Accounts & GCP
        case 'get_gcp_settings':
          return mockGcpSettings;

        case 'save_gcp_settings':
          return null;

        case 'start_google_login':
          return 'https://accounts.google.com/o/oauth2/v2/auth?mock=demo_mode';

        case 'check_login_status':
          return true;

        case 'get_google_user_profile':
          return mockUserProfile;

        case 'logout_google':
          return null;

        case 'get_storage_quota':
          return mockStorageQuota;

        case 'get_vault_targets_usage':
          return mockTargetUsageMap;

        case 'list_google_accounts':
          return mockGoogleAccounts;

        case 'remove_google_account':
          return null;

        case 'list_accessible_shared_drives':
          return mockSharedDrives;

        case 'auto_add_account_target':
        case 'add_shared_drive_target':
          return currentActiveVault;

        // Permissions
        case 'list_drive_members':
          return [];

        case 'add_drive_member':
          return {
            id: 'perm_mock_1',
            type: 'user',
            role: 'writer',
            email_address: args?.email || 'collaborator@example.com',
            display_name: 'Collaborator',
          };

        case 'remove_drive_member':
          return null;

        default:
          if (cmd.startsWith('plugin:')) {
            return null;
          }
          console.warn('[Demo Mode] Unhandled mock command:', cmd, args);
          return null;
      }
    },
    { shouldMockEvents: true }
  );
}
