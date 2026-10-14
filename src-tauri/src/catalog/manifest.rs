use serde::{Deserialize, Serialize};
use crate::crypto::aes::{decrypt_chunk, encrypt_chunk, CryptoError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PackageType {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "folder")]
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkRef {
    pub shard_index: usize,
    pub target_id: String,
    pub file_id: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stripe {
    pub stripe_index: usize,
    pub chunks: Vec<ChunkRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErasureSchema {
    pub data_shards: usize,
    pub parity_shards: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageManifest {
    pub version: u32,
    pub package_id: String,
    pub pkg_type: PackageType,
    pub name: String,
    pub total_size: u64,
    pub original_sha256: String,
    pub uploader_pubkey: String,
    pub deleted: bool,
    pub deletion_signature: Option<String>,
    pub chunk_size: usize,
    pub erasure_schema: ErasureSchema,
    pub tree: Vec<FileEntry>,
    pub stripes: Vec<Stripe>,
    pub created_at: i64,
}

impl PackageManifest {
    pub fn encrypt(&self, key: &[u8; 32]) -> Result<Vec<u8>, CryptoError> {
        let json_bytes = serde_json::to_vec(self)
            .map_err(|e| CryptoError::DerivationError(e.to_string()))?;
        encrypt_chunk(&json_bytes, key)
    }

    pub fn decrypt(payload: &[u8], key: &[u8; 32]) -> Result<Self, CryptoError> {
        let decrypted_bytes = decrypt_chunk(payload, key)?;
        serde_json::from_slice(&decrypted_bytes)
            .map_err(|e| CryptoError::DerivationError(format!("Failed to parse manifest JSON: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_encryption_roundtrip() {
        let key = [99u8; 32];
        let manifest = PackageManifest {
            version: 1,
            package_id: "pkg_12345678".to_string(),
            pkg_type: PackageType::File,
            name: "test_asset.zip".to_string(),
            total_size: 1048576,
            original_sha256: "aabbccdd".to_string(),
            uploader_pubkey: "pubkey123".to_string(),
            deleted: false,
            deletion_signature: None,
            chunk_size: 16777216,
            erasure_schema: ErasureSchema {
                data_shards: 2,
                parity_shards: 1,
            },
            tree: vec![FileEntry {
                path: "test_asset.zip".into(),
                size: 1048576,
                sha256: "aabbccdd".into(),
            }],
            stripes: vec![],
            created_at: 1728950400,
        };

        let encrypted = manifest.encrypt(&key).expect("Encryption failed");
        let decrypted = PackageManifest::decrypt(&encrypted, &key).expect("Decryption failed");

        assert_eq!(decrypted.package_id, manifest.package_id);
        assert_eq!(decrypted.name, manifest.name);
        assert_eq!(decrypted.total_size, manifest.total_size);
    }
}
