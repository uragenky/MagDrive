import {
  VaultRecord,
  PackageManifest,
  TransferRecord,
  AccountStorageQuotaInfo,
  GoogleAccountInfo,
  TargetStorageUsage,
  AdaptiveErasureInfo,
  TrackerSettings,
  GcpCredentials,
  GoogleUserProfile,
  SharedDriveItem,
  DownloadSettings,
} from '../types';

export const mockVaults: VaultRecord[] = [
  {
    id: 'vault_personal_cloud',
    name: 'Personal Cloud Vault',
    role: 'admin',
    salt_hex: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    verification_tag: '0123456789abcdef0123456789abcdef',
    created_at: Date.now() - 86400000 * 14,
    targets: [
      {
        target_id: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01',
        target_type: 'SharedFolder',
        label: 'Primary Personal Drive',
        account_email: 'alex.developer@gmail.com',
      },
      {
        target_id: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02',
        target_type: 'SharedFolder',
        label: 'Secondary Backup Drive',
        account_email: 'alex.backup.storage@gmail.com',
      },
      {
        target_id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03',
        target_type: 'SharedDrive',
        label: 'Workspace Shared Drive',
        account_email: 'team.workspace@company.org',
      },
    ],
  },
  {
    id: 'vault_research_archive',
    name: 'Research & Data Archive',
    role: 'admin',
    salt_hex: 'b2c3d4e5f60718293a4b5c6d7e8f90a1',
    verification_tag: 'abcdef0123456789abcdef0123456789',
    created_at: Date.now() - 86400000 * 30,
    targets: [
      {
        target_id: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01',
        target_type: 'SharedFolder',
        label: 'Primary Personal Drive',
        account_email: 'alex.developer@gmail.com',
      },
      {
        target_id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03',
        target_type: 'SharedDrive',
        label: 'Workspace Shared Drive',
        account_email: 'team.workspace@company.org',
      },
    ],
  },
];

export const mockGoogleAccounts: GoogleAccountInfo[] = [
  {
    email: 'alex.developer@gmail.com',
    displayName: 'Alex Developer',
    rootFolderId: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01',
    limitBytes: 16106127360, // 15 GB
    usageBytes: 11811160064, // 11.0 GB
    usageInDriveBytes: 10737418240,
    usageInTrashBytes: 1073741824,
    freeBytes: 4294967296,
    usagePercentage: 73.3,
    isUnlimited: false,
    createdAt: Date.now() - 86400000 * 30,
  },
  {
    email: 'alex.backup.storage@gmail.com',
    displayName: 'Alex Backup',
    rootFolderId: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02',
    limitBytes: 16106127360, // 15 GB
    usageBytes: 3758096384, // 3.5 GB
    usageInDriveBytes: 3758096384,
    usageInTrashBytes: 0,
    freeBytes: 12348030976,
    usagePercentage: 23.3,
    isUnlimited: false,
    createdAt: Date.now() - 86400000 * 20,
  },
  {
    email: 'team.workspace@company.org',
    displayName: 'Company Workspace Team',
    rootFolderId: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03',
    limitBytes: 2199023255552, // 2 TB
    usageBytes: 365072220160, // 340 GB
    usageInDriveBytes: 365072220160,
    usageInTrashBytes: 0,
    freeBytes: 1833951035392,
    usagePercentage: 16.6,
    isUnlimited: false,
    createdAt: Date.now() - 86400000 * 10,
  },
];

export const mockStorageQuota: AccountStorageQuotaInfo = {
  displayName: 'Alex Developer',
  emailAddress: 'alex.developer@gmail.com',
  limitBytes: 16106127360,
  usageBytes: 11811160064,
  usageInDriveBytes: 10737418240,
  usageInTrashBytes: 1073741824,
  freeBytes: 4294967296,
  usagePercentage: 73.3,
  isUnlimited: false,
};

export const mockTargetUsageMap: TargetStorageUsage[] = [
  {
    targetId: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01',
    chunkCount: 24,
    totalBytes: 1073741824,
  },
  {
    targetId: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02',
    chunkCount: 24,
    totalBytes: 1073741824,
  },
  {
    targetId: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03',
    chunkCount: 24,
    totalBytes: 1073741824,
  },
];

export const mockCatalogFiles: PackageManifest[] = [
  {
    version: 1,
    package_id: 'pkg_9f8e7d6c5b4a3120',
    pkg_type: 'file',
    name: 'q4_financial_audit_confidential.pdf',
    total_size: 14889779, // ~14.2 MB
    original_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    uploader_pubkey: 'ed25519_pk_mock_112233445566778899aabbccddeeff00',
    deleted: false,
    chunk_size: 16777216,
    erasure_schema: { data_shards: 2, parity_shards: 1 },
    tree: [
      {
        path: 'q4_financial_audit_confidential.pdf',
        size: 14889779,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    ],
    stripes: [
      {
        stripe_index: 0,
        chunks: [
          { shard_index: 0, target_id: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01', file_id: 'f_01_a', sha256: 'hash_01' },
          { shard_index: 1, target_id: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02', file_id: 'f_01_b', sha256: 'hash_02' },
          { shard_index: 2, target_id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03', file_id: 'f_01_c', sha256: 'hash_03' },
        ],
      },
    ],
    created_at: Date.now() - 86400000 * 1.5,
  },
  {
    version: 1,
    package_id: 'pkg_8a7b6c5d4e3f2119',
    pkg_type: 'file',
    name: 'production_database_backup_20261024.sql.gz',
    total_size: 191365120, // ~182.5 MB
    original_sha256: 'a2b4c6d8e0f123456789abcdef0123456789abcdef0123456789abcdef012345',
    uploader_pubkey: 'ed25519_pk_mock_112233445566778899aabbccddeeff00',
    deleted: false,
    chunk_size: 33554432,
    erasure_schema: { data_shards: 2, parity_shards: 1 },
    tree: [
      {
        path: 'production_database_backup_20261024.sql.gz',
        size: 191365120,
        sha256: 'a2b4c6d8e0f123456789abcdef0123456789abcdef0123456789abcdef012345',
      },
    ],
    stripes: [
      {
        stripe_index: 0,
        chunks: [
          { shard_index: 0, target_id: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01', file_id: 'f_02_a', sha256: 'hash_04' },
          { shard_index: 1, target_id: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02', file_id: 'f_02_b', sha256: 'hash_05' },
          { shard_index: 2, target_id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03', file_id: 'f_02_c', sha256: 'hash_06' },
        ],
      },
    ],
    created_at: Date.now() - 86400000 * 3,
  },
  {
    version: 1,
    package_id: 'pkg_7b6a5d4e3f2c1998',
    pkg_type: 'file',
    name: 'project_source_archive_v0.5.2.tar.zst',
    total_size: 50646016, // ~48.3 MB
    original_sha256: 'c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5',
    uploader_pubkey: 'ed25519_pk_mock_112233445566778899aabbccddeeff00',
    deleted: false,
    chunk_size: 16777216,
    erasure_schema: { data_shards: 2, parity_shards: 1 },
    tree: [
      {
        path: 'project_source_archive_v0.5.2.tar.zst',
        size: 50646016,
        sha256: 'c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5',
      },
    ],
    stripes: [
      {
        stripe_index: 0,
        chunks: [
          { shard_index: 0, target_id: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01', file_id: 'f_03_a', sha256: 'hash_07' },
          { shard_index: 1, target_id: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02', file_id: 'f_03_b', sha256: 'hash_08' },
          { shard_index: 2, target_id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03', file_id: 'f_03_c', sha256: 'hash_09' },
        ],
      },
    ],
    created_at: Date.now() - 86400000 * 5,
  },
  {
    version: 1,
    package_id: 'pkg_6c5d4e3f2a1b9887',
    pkg_type: 'folder',
    name: 'client_contracts_and_nda_bundle',
    total_size: 9017753, // ~8.6 MB
    original_sha256: 'd4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6',
    uploader_pubkey: 'ed25519_pk_mock_112233445566778899aabbccddeeff00',
    deleted: false,
    chunk_size: 16777216,
    erasure_schema: { data_shards: 2, parity_shards: 1 },
    tree: [
      { path: 'client_contracts_and_nda_bundle/master_services_agreement.pdf', size: 3145728, sha256: 'h1' },
      { path: 'client_contracts_and_nda_bundle/non_disclosure_agreement.pdf', size: 1048576, sha256: 'h2' },
      { path: 'client_contracts_and_nda_bundle/security_audit_checklist.xlsx', size: 4823449, sha256: 'h3' },
    ],
    stripes: [
      {
        stripe_index: 0,
        chunks: [
          { shard_index: 0, target_id: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01', file_id: 'f_04_a', sha256: 'hash_10' },
          { shard_index: 1, target_id: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02', file_id: 'f_04_b', sha256: 'hash_11' },
          { shard_index: 2, target_id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03', file_id: 'f_04_c', sha256: 'hash_12' },
        ],
      },
    ],
    created_at: Date.now() - 86400000 * 7,
  },
  {
    version: 1,
    package_id: 'pkg_5d4e3c2b1a9f8776',
    pkg_type: 'file',
    name: 'ai_model_weights_checkpoint_fp16.safetensors',
    total_size: 432013312, // ~412.0 MB
    original_sha256: 'e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7',
    uploader_pubkey: 'ed25519_pk_mock_112233445566778899aabbccddeeff00',
    deleted: false,
    chunk_size: 67108864,
    erasure_schema: { data_shards: 2, parity_shards: 1 },
    tree: [
      {
        path: 'ai_model_weights_checkpoint_fp16.safetensors',
        size: 432013312,
        sha256: 'e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7',
      },
    ],
    stripes: [
      {
        stripe_index: 0,
        chunks: [
          { shard_index: 0, target_id: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_01', file_id: 'f_05_a', sha256: 'hash_13' },
          { shard_index: 1, target_id: '2bCdEfGhIjKlMnOpQrStUvWxYzA_02', file_id: 'f_05_b', sha256: 'hash_14' },
          { shard_index: 2, target_id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03', file_id: 'f_05_c', sha256: 'hash_15' },
        ],
      },
    ],
    created_at: Date.now() - 86400000 * 10,
  },
];

export const mockTransfers: TransferRecord[] = [
  {
    id: 'tr_upload_01',
    package_id: 'pkg_8a7b6c5d4e3f2119',
    name: 'production_database_backup_20261024.sql.gz',
    transfer_type: 'upload',
    total_bytes: 191365120,
    transferred_bytes: 130128281, // ~68%
    status: 'transferring',
    updated_at: Date.now() - 12000,
  },
  {
    id: 'tr_upload_02',
    package_id: 'pkg_9f8e7d6c5b4a3120',
    name: 'q4_financial_audit_confidential.pdf',
    transfer_type: 'upload',
    total_bytes: 14889779,
    transferred_bytes: 14889779,
    status: 'completed',
    updated_at: Date.now() - 3600000,
  },
  {
    id: 'tr_download_01',
    package_id: 'pkg_7b6a5d4e3f2c1998',
    name: 'project_source_archive_v0.5.2.tar.zst',
    transfer_type: 'download',
    total_bytes: 50646016,
    transferred_bytes: 50646016,
    destination_path: 'C:\\Users\\Alex\\Downloads\\project_source_archive_v0.5.2.tar.zst',
    status: 'completed',
    updated_at: Date.now() - 7200000,
  },
];

export const mockErasureInfo: AdaptiveErasureInfo = {
  num_targets: 3,
  data_shards: 2,
  parity_shards: 1,
  total_shards: 3,
  fault_tolerance: 1,
  overhead_percent: 50,
};

export const mockTrackerSettings: TrackerSettings = {
  trackers: [
    'https://magdrive-tracker.vercel.app/api',
    'https://tracker.opencode.dev/api',
  ],
  default_seeding: true,
};

export const mockGcpSettings: GcpCredentials = {
  client_id: '738192039485-abc123def456ghi789jkl012mno345pq.apps.googleusercontent.com',
  client_secret: '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demo',
};

export const mockUserProfile: GoogleUserProfile = {
  displayName: 'Alex Developer',
  emailAddress: 'alex.developer@gmail.com',
};

export const mockSharedDrives: SharedDriveItem[] = [
  {
    id: '0ABcDeFgHiJkLmNoPqRsTuVwXyZ_03',
    name: 'Company Engineering Shared Drive',
    canAddChildren: true,
  },
  {
    id: '0BCdEfGhIjKlMnOpQrStUvWxYz_04',
    name: 'Global Team Media & Assets',
    canAddChildren: true,
  },
];

export const mockDownloadSettings: DownloadSettings = {
  download_dir: 'C:\\Users\\Alex\\Downloads\\MagDrive',
  prompt_save_location: true,
};
