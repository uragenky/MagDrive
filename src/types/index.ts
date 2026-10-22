export type VaultRole = 'admin' | 'member' | 'viewer';

export type TargetType = 'SharedDrive' | 'SharedFolder';

export interface VaultTarget {
  target_id: string;
  target_type: TargetType;
  label: string;
  account_email?: string;
}

export interface VaultRecord {
  id: string;
  name: string;
  role: VaultRole;
  salt_hex: string;
  targets: VaultTarget[];
  verification_tag: string;
  created_at: number;
}

export type PackageType = 'file' | 'folder';

export interface FileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ChunkRef {
  shard_index: number;
  target_id: string;
  file_id: string;
  sha256: string;
}

export interface Stripe {
  stripe_index: number;
  chunks: ChunkRef[];
}

export interface ErasureSchema {
  data_shards: number;
  parity_shards: number;
}

export interface PackageManifest {
  version: number;
  package_id: string;
  pkg_type: PackageType;
  name: string;
  total_size: number;
  original_sha256: string;
  uploader_pubkey: string;
  deleted: boolean;
  deletion_signature?: string;
  chunk_size: number;
  erasure_schema: ErasureSchema;
  tree: FileEntry[];
  stripes: Stripe[];
  created_at: number;
}

export interface DrivePermissionItem {
  id: string;
  type: string;
  role: string;
  email_address?: string;
  display_name?: string;
  photo_link?: string;
}

export type TransferStatus = 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface TransferRecord {
  id: string;
  package_id: string;
  name: string;
  transfer_type: string;
  total_bytes: number;
  transferred_bytes: number;
  status: TransferStatus | string;
  error_message?: string;
  destination_path?: string;
  updated_at: number;
}

export interface UploadSessionInfo {
  session_id: string;
  transfer_id: string;
  chunk_size: number;
  total_chunks: number;
}

export interface GcpCredentials {
  client_id: string;
  client_secret: string;
}

export type TransferStage =
  | 'slicing'
  | 'encrypting'
  | 'uploading_shards'
  | 'finalizing'
  | 'completed'
  | 'downloading'
  | 'reconstructing'
  | 'verifying';

export interface TransferProgressPayload {
  package_id?: string;
  transfer_id: string;
  stage: TransferStage;
  current_shard: number;
  total_shards: number;
  transferred: number;
  transferred_bytes: number;
  total: number;
  total_bytes: number;
  speed_bps: number;
  eta_seconds: number;
  target_label?: string;
  status: string;
  error_message?: string;
  destination_path?: string;
}

export interface MagnetInfo {
  package_id: string;
  vault_hint?: string;
  total_bytes?: number;
  name?: string;
  key?: string;
  sources?: string[];
  trackers?: string[];
}

export interface SwarmResolveResult {
  package_id: string;
  name: string;
  total_size: number;
  peer_count: number;
  sources: string[];
  trackers: string[];
  is_local: boolean;
  key?: string;
}

export interface TrackerSettings {
  trackers: string[];
  default_seeding: boolean;
}

export interface DownloadSettings {
  download_dir: string;
  prompt_save_location: boolean;
}

export interface DownloadResult {
  destination_path: string;
  total_bytes: number;
}

export interface GoogleUserProfile {
  displayName: string;
  emailAddress: string;
}

export interface AdaptiveErasureInfo {
  num_targets: number;
  data_shards: number;
  parity_shards: number;
  total_shards: number;
  fault_tolerance: number;
  overhead_percent: number;
}

export interface TargetMigrationStats {
  target_id: string;
  total_packages: number;
  affected_packages: number;
  chunks_on_target: number;
  total_vault_chunks: number;
}

export interface MigrationProgressPayload {
  stage: string;
  current_chunk: number;
  total_chunks: number;
  copied_chunks: number;
  relayed_chunks: number;
  reconstructed_chunks: number;
  current_package_name: string;
  message: string;
}

export interface TargetMigrationResult {
  success: boolean;
  total_migrated: number;
  copied_count: number;
  relayed_count: number;
  reconstructed_count: number;
  failed_count: number;
  message: string;
}

export interface AccountStorageQuotaInfo {
  displayName: string;
  emailAddress: string;
  limitBytes?: number;
  usageBytes: number;
  usageInDriveBytes: number;
  usageInTrashBytes: number;
  freeBytes?: number;
  usagePercentage?: number;
  isUnlimited: boolean;
}

export interface TargetStorageUsage {
  targetId: string;
  chunkCount: number;
  totalBytes: number;
}

export interface GoogleAccountInfo {
  email: string;
  displayName: string;
  rootFolderId?: string;
  limitBytes?: number;
  usageBytes: number;
  usageInDriveBytes: number;
  usageInTrashBytes: number;
  freeBytes?: number;
  usagePercentage?: number;
  isUnlimited: boolean;
  createdAt: number;
}

export interface SharedDriveItem {
  id: string;
  name: string;
  canAddChildren: boolean;
}




