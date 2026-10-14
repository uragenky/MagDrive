export type VaultRole = 'admin' | 'member' | 'viewer';

export type TargetType = 'SharedDrive' | 'SharedFolder';

export interface VaultTarget {
  target_id: string;
  target_type: TargetType;
  label: string;
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

export interface MagnetInfo {
  package_id: string;
  vault_hint?: string;
  total_bytes?: number;
  name?: string;
}
