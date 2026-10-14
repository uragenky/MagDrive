use crate::catalog::manifest::PackageManifest;
use crate::drive::client::DriveClient;
use crate::storage::db::{Database, StorageError};
use crate::vault::model::VaultTarget;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("Drive error during sync: {0}")]
    Drive(#[from] crate::drive::client::DriveError),
    #[error("Database error during sync: {0}")]
    Db(#[from] StorageError),
    #[error("Crypto error during sync: {0}")]
    Crypto(#[from] crate::crypto::aes::CryptoError),
}

pub async fn sync_vault_catalog(
    client: &DriveClient,
    targets: &[VaultTarget],
    vault_id: &str,
    vault_key: &[u8; 32],
    db: &Database,
) -> Result<usize, SyncError> {
    let mut new_packages_count = 0;

    for target in targets {
        // Look up or ensure .magdrive/metadata folder
        let magdrive_dir_id = match client.ensure_folder(&target.target_id, ".magdrive").await {
            Ok(id) => id,
            Err(_) => continue, // If target is inaccessible, continue to next target
        };

        let metadata_dir_id = match client.ensure_folder(&magdrive_dir_id, "metadata").await {
            Ok(id) => id,
            Err(_) => continue,
        };

        let files = match client.list_files_in_folder(&metadata_dir_id).await {
            Ok(f) => f,
            Err(_) => continue,
        };

        for file in files {
            if file.name.starts_with("meta_") && file.name.ends_with(".enc") {
                let package_id = file
                    .name
                    .trim_start_matches("meta_")
                    .trim_end_matches(".enc");

                // If already in db and not modified, skip
                if let Ok(Some(_)) = db.get_package(package_id) {
                    continue;
                }

                // Download and decrypt
                match client.download_file(&file.id).await {
                    Ok(payload) => {
                        if let Ok(manifest) = PackageManifest::decrypt(&payload, vault_key) {
                            if db.upsert_package(vault_id, &manifest).is_ok() {
                                new_packages_count += 1;
                            }
                        }
                    }
                    Err(_) => continue,
                }
            }
        }
    }

    Ok(new_packages_count)
}
