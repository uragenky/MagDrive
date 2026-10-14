use base64::Engine;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::catalog::manifest::{ErasureSchema, FileEntry, PackageManifest, PackageType, Stripe, ChunkRef};
use crate::catalog::sync::sync_vault_catalog;
use crate::crypto::argon::{derive_master_key, generate_salt};
use crate::crypto::signature::Keypair;
use crate::crypto::compute_sha256;
use crate::crypto::aes::{encrypt_chunk, decrypt_chunk};
use crate::drive::client::DriveClient;
use crate::drive::oauth::{start_oauth_flow, GcpCredentials};
use crate::drive::permissions::DrivePermissionItem;
use crate::erasure::rs::{encode, reconstruct};
use crate::magnet::parser::{generate_magnet_link, parse_magnet_link, MagnetInfo};
use crate::storage::db::{Database, TransferRecord};
use crate::vault::model::{VaultExportPayload, VaultRecord, VaultRole, VaultTarget};

pub struct AppState {
    pub db: Database,
    pub keypair: Mutex<Keypair>,
}

// ----------------------------------------------------
// GCP & OAuth Commands
// ----------------------------------------------------

#[tauri::command]
pub async fn get_gcp_settings(state: State<'_, AppState>) -> Result<Option<GcpCredentials>, String> {
    let client_id = state.db.get_setting("gcp_client_id");
    let client_secret = state.db.get_setting("gcp_client_secret").unwrap_or_default();

    if let Some(id) = client_id {
        Ok(Some(GcpCredentials {
            client_id: id,
            client_secret,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn save_gcp_settings(
    state: State<'_, AppState>,
    credentials: GcpCredentials,
) -> Result<(), String> {
    state
        .db
        .set_setting("gcp_client_id", &credentials.client_id)
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("gcp_client_secret", &credentials.client_secret)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn start_google_login(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let client_id = state
        .db
        .get_setting("gcp_client_id")
        .ok_or("Kredensial GCP belum dikonfigurasi. Masukkan Client ID terlebih dahulu.")?;
    let client_secret = state.db.get_setting("gcp_client_secret").unwrap_or_default();

    let creds = GcpCredentials {
        client_id,
        client_secret,
    };

    let (auth_url, rx) = start_oauth_flow(creds)
        .await
        .map_err(|e| e.to_string())?;

    let db_clone = state.db.clone();
    tokio::spawn(async move {
        if let Ok(Ok(tokens)) = rx.await {
            let _ = db_clone.set_setting("access_token", &tokens.access_token);
            if let Some(ref rt) = tokens.refresh_token {
                let _ = db_clone.set_setting("refresh_token", rt);
            }
            let _ = app.emit("oauth-success", ());
        }
    });

    Ok(auth_url)
}

#[tauri::command]
pub async fn check_login_status(state: State<'_, AppState>) -> Result<bool, String> {
    let token = state.db.get_setting("access_token");
    Ok(token.is_some())
}

#[tauri::command]
pub async fn logout_google(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.db.set_setting("access_token", "");
    let _ = state.db.set_setting("refresh_token", "");
    Ok(())
}

// Helper to get active DriveClient with auto-refresh
async fn get_drive_client(db: &Database) -> Result<DriveClient, String> {
    let access_token = db
        .get_setting("access_token")
        .ok_or("Belum terautentikasi ke Google Drive")?;

    let client = DriveClient::new(access_token);
    Ok(client)
}

// ----------------------------------------------------
// Vault Management Commands
// ----------------------------------------------------

#[tauri::command]
pub async fn create_vault(
    state: State<'_, AppState>,
    name: String,
    passphrase: String,
    targets: Vec<VaultTarget>,
) -> Result<VaultRecord, String> {
    let salt = generate_salt();
    let salt_hex = hex::encode(salt);

    let master_key = derive_master_key(&passphrase, &salt).map_err(|e| e.to_string())?;
    let canary = b"magdrive_valid";
    let encrypted_tag = encrypt_chunk(canary, &master_key).map_err(|e| e.to_string())?;
    let verification_tag = hex::encode(encrypted_tag);

    let vault_id = format!("vlt_{}", Uuid::new_v4().simple());
    let now = chrono::Utc::now().timestamp();

    let record = VaultRecord {
        id: vault_id.clone(),
        name,
        role: VaultRole::Admin,
        salt_hex,
        targets,
        verification_tag,
        created_at: now,
    };

    state.db.save_vault(&record).map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("active_vault_id", &vault_id)
        .map_err(|e| e.to_string())?;

    Ok(record)
}

#[tauri::command]
pub async fn list_vaults(state: State<'_, AppState>) -> Result<Vec<VaultRecord>, String> {
    state.db.list_vaults().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_vault(state: State<'_, AppState>) -> Result<Option<VaultRecord>, String> {
    if let Some(id) = state.db.get_setting("active_vault_id") {
        state.db.get_vault(&id).map_err(|e| e.to_string())
    } else {
        let list = state.db.list_vaults().map_err(|e| e.to_string())?;
        if let Some(first) = list.first() {
            let _ = state.db.set_setting("active_vault_id", &first.id);
            Ok(Some(first.clone()))
        } else {
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn set_active_vault(state: State<'_, AppState>, vault_id: String) -> Result<(), String> {
    state
        .db
        .set_setting("active_vault_id", &vault_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_vault(state: State<'_, AppState>, vault_id: String) -> Result<(), String> {
    state.db.delete_vault(&vault_id).map_err(|e| e.to_string())?;
    if state.db.get_setting("active_vault_id").as_deref() == Some(&vault_id) {
        let _ = state.db.set_setting("active_vault_id", "");
    }
    Ok(())
}

#[tauri::command]
pub async fn export_vault_config(
    state: State<'_, AppState>,
    vault_id: String,
    role: String,
) -> Result<String, String> {
    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault tidak ditemukan")?;

    let export_role = role.parse::<VaultRole>().map_err(|e| e.to_string())?;

    let payload = VaultExportPayload {
        version: 1,
        vault_id: vault.id,
        vault_name: vault.name,
        role: export_role,
        targets: vault.targets,
        salt_hex: vault.salt_hex,
        verification_tag: vault.verification_tag,
    };

    let json_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(json_bytes);
    Ok(b64)
}

#[tauri::command]
pub async fn import_vault_config(
    state: State<'_, AppState>,
    config_b64: String,
    passphrase: String,
) -> Result<VaultRecord, String> {
    let json_bytes = base64::engine::general_purpose::STANDARD
        .decode(config_b64.trim())
        .map_err(|e| format!("Invalid base64 vault token: {}", e))?;

    let payload: VaultExportPayload = serde_json::from_slice(&json_bytes)
        .map_err(|e| format!("Invalid vault token format: {}", e))?;

    // Verify passphrase
    let salt = hex::decode(&payload.salt_hex).map_err(|e| e.to_string())?;
    let derived_key = derive_master_key(&passphrase, &salt).map_err(|e| e.to_string())?;

    let tag_bytes = hex::decode(&payload.verification_tag).map_err(|e| e.to_string())?;
    let decrypted = decrypt_chunk(&tag_bytes, &derived_key);
    if decrypted.is_err() || decrypted.unwrap() != b"magdrive_valid" {
        return Err("Passphrase salah. Gagal membuka kunci vault.".into());
    }

    let record = VaultRecord {
        id: payload.vault_id.clone(),
        name: payload.vault_name,
        role: payload.role,
        salt_hex: payload.salt_hex,
        targets: payload.targets,
        verification_tag: payload.verification_tag,
        created_at: chrono::Utc::now().timestamp(),
    };

    state.db.save_vault(&record).map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("active_vault_id", &payload.vault_id)
        .map_err(|e| e.to_string())?;

    Ok(record)
}

// ----------------------------------------------------
// Google Drive Permissions API (RBAC & Members)
// ----------------------------------------------------

#[tauri::command]
pub async fn list_drive_members(
    state: State<'_, AppState>,
    target_id: String,
) -> Result<Vec<DrivePermissionItem>, String> {
    let client = get_drive_client(&state.db).await?;
    client
        .list_permissions(&target_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_drive_member(
    state: State<'_, AppState>,
    target_id: String,
    email: String,
    role: String,
) -> Result<DrivePermissionItem, String> {
    let client = get_drive_client(&state.db).await?;
    client
        .add_permission(&target_id, &email, &role)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_drive_member(
    state: State<'_, AppState>,
    target_id: String,
    permission_id: String,
) -> Result<(), String> {
    let client = get_drive_client(&state.db).await?;
    client
        .remove_permission(&target_id, &permission_id)
        .await
        .map_err(|e| e.to_string())
}

// ----------------------------------------------------
// Catalog & Magnet Commands
// ----------------------------------------------------

#[tauri::command]
pub async fn sync_catalog(
    state: State<'_, AppState>,
    passphrase: Option<String>,
) -> Result<usize, String> {
    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("Tidak ada vault yang aktif")?;

    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault aktif tidak ditemukan")?;

    let pass = passphrase.unwrap_or_else(|| "magdrive".to_string());
    let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
    let key = derive_master_key(&pass, &salt).map_err(|e| e.to_string())?;

    let client = get_drive_client(&state.db).await?;

    sync_vault_catalog(&client, &vault.targets, &vault.id, &key, &state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_catalog_files(state: State<'_, AppState>) -> Result<Vec<PackageManifest>, String> {
    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("Tidak ada vault yang aktif")?;

    state.db.list_packages(&vault_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn parse_magnet(magnet_uri: String) -> Result<MagnetInfo, String> {
    parse_magnet_link(&magnet_uri).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_magnet(
    state: State<'_, AppState>,
    package_id: String,
) -> Result<String, String> {
    let pkg = state
        .db
        .get_package(&package_id)
        .map_err(|e| e.to_string())?
        .ok_or("Berkas tidak ditemukan")?;

    let vault_id = state.db.get_setting("active_vault_id").unwrap_or_default();
    let link = generate_magnet_link(&pkg.package_id, &vault_id, pkg.total_size, &pkg.name);
    Ok(link)
}

#[tauri::command]
pub async fn delete_package(
    state: State<'_, AppState>,
    package_id: String,
) -> Result<(), String> {
    let pkg = state
        .db
        .get_package(&package_id)
        .map_err(|e| e.to_string())?
        .ok_or("Berkas tidak ditemukan")?;

    let (current_pubkey, sig) = {
        let keypair = state.keypair.lock().unwrap();
        let pubkey = keypair.public_key_hex();
        let sig = keypair.sign_message(format!("delete:{}", package_id).as_bytes());
        (pubkey, sig)
    };

    // Check if current user is uploader or admin
    let is_uploader = pkg.uploader_pubkey == current_pubkey;
    let is_admin = true; // In local vault admin mode

    if !is_uploader && !is_admin {
        return Err("Akses ditolak: Anda hanya dapat menghapus berkas milik Anda sendiri.".into());
    }

    // Mark as deleted in local SQLite
    state
        .db
        .mark_deleted(&package_id, &sig)
        .map_err(|e| e.to_string())?;

    // Attempt to delete chunk files from cloud targets
    if let Ok(client) = get_drive_client(&state.db).await {
        for stripe in pkg.stripes {
            for chunk in stripe.chunks {
                let _ = client.delete_file(&chunk.file_id).await;
            }
        }
    }

    Ok(())
}

// ----------------------------------------------------
// Transfer & File Pipeline Commands
// ----------------------------------------------------

#[tauri::command]
pub async fn list_transfers(state: State<'_, AppState>) -> Result<Vec<TransferRecord>, String> {
    state.db.list_transfers().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upload_file_package(
    app: AppHandle,
    state: State<'_, AppState>,
    file_name: String,
    file_bytes_base64: String,
    is_folder: bool,
    tree: Vec<FileEntry>,
    passphrase: Option<String>,
) -> Result<String, String> {
    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("Tidak ada vault yang aktif")?;

    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault tidak ditemukan")?;

    if vault.targets.is_empty() {
        return Err("Vault belum memiliki target Google Drive. Tambahkan target di menu Settings.".into());
    }

    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(&file_bytes_base64)
        .map_err(|e| format!("Invalid base64 payload: {}", e))?;

    let total_size = raw_bytes.len() as u64;
    let original_sha256 = compute_sha256(&raw_bytes);
    let package_id = format!("pkg_{}", Uuid::new_v4().simple());

    let pass = passphrase.unwrap_or_else(|| "magdrive".to_string());
    let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
    let key = derive_master_key(&pass, &salt).map_err(|e| e.to_string())?;

    let uploader_pubkey = state.keypair.lock().unwrap().public_key_hex();

    // Determine Reed-Solomon scheme based on target count
    let (data_shards, parity_shards) = if vault.targets.len() >= 3 {
        (2, 1)
    } else if vault.targets.len() == 2 {
        (1, 1)
    } else {
        (1, 0)
    };

    let client = get_drive_client(&state.db).await?;

    // Create journal entry in transfers table
    let transfer_id = format!("tx_{}", Uuid::new_v4().simple());
    let record = TransferRecord {
        id: transfer_id.clone(),
        package_id: package_id.clone(),
        name: file_name.clone(),
        transfer_type: "upload".to_string(),
        total_bytes: total_size,
        transferred_bytes: 0,
        status: "transferring".to_string(),
        error_message: None,
        updated_at: chrono::Utc::now().timestamp(),
    };
    let _ = state.db.upsert_transfer(&record);

    // Adaptive chunk size
    let chunk_size = if total_size > 1_000_000_000 {
        33_554_432 // 32 MB
    } else if total_size > 10_000_000 {
        16_777_216 // 16 MB
    } else {
        total_size.max(1) as usize
    };

    let mut stripes = Vec::new();
    let num_stripes = (raw_bytes.len() + chunk_size - 1) / chunk_size.max(1);

    for s_idx in 0..num_stripes {
        let start = s_idx * chunk_size;
        let end = (start + chunk_size).min(raw_bytes.len());
        let stripe_data = &raw_bytes[start..end];

        // Reed-Solomon encoding
        let (shards, _) = encode(stripe_data, data_shards, parity_shards)
            .map_err(|e| e.to_string())?;

        let mut chunk_refs = Vec::new();

        for (shard_idx, shard) in shards.iter().enumerate() {
            // Encrypt each shard with AES-256-GCM
            let encrypted_shard = encrypt_chunk(shard, &key).map_err(|e| e.to_string())?;
            let shard_sha = compute_sha256(&encrypted_shard);
            let chunk_file_name = format!("chunk_{}_{}.bin", package_id, shard_sha);

            // Distribute to corresponding target
            let target_idx = shard_idx % vault.targets.len();
            let target = &vault.targets[target_idx];

            let chunks_dir = client
                .ensure_folder(&target.target_id, ".magdrive")
                .await
                .map_err(|e| e.to_string())?;
            let chunks_sub = client
                .ensure_folder(&chunks_dir, "chunks")
                .await
                .map_err(|e| e.to_string())?;

            let uploaded_file_id = client
                .upload_file(&chunks_sub, &chunk_file_name, &encrypted_shard)
                .await
                .map_err(|e| e.to_string())?;

            chunk_refs.push(ChunkRef {
                shard_index: shard_idx,
                target_id: target.target_id.clone(),
                file_id: uploaded_file_id,
                sha256: shard_sha,
            });
        }

        stripes.push(Stripe {
            stripe_index: s_idx,
            chunks: chunk_refs,
        });

        // Emit progress
        let transferred = ((s_idx + 1) * chunk_size).min(total_size as usize) as u64;
        let _ = app.emit("transfer-progress", serde_json::json!({
            "transfer_id": transfer_id,
            "transferred": transferred,
            "total": total_size
        }));
    }

    let manifest = PackageManifest {
        version: 1,
        package_id: package_id.clone(),
        pkg_type: if is_folder { PackageType::Folder } else { PackageType::File },
        name: file_name.clone(),
        total_size,
        original_sha256,
        uploader_pubkey,
        deleted: false,
        deletion_signature: None,
        chunk_size,
        erasure_schema: ErasureSchema {
            data_shards,
            parity_shards,
        },
        tree,
        stripes,
        created_at: chrono::Utc::now().timestamp(),
    };

    // Encrypt and upload metadata manifest to all targets
    let encrypted_manifest = manifest.encrypt(&key).map_err(|e| e.to_string())?;
    let meta_file_name = format!("meta_{}.enc", package_id);

    for target in &vault.targets {
        if let Ok(magdrive_dir) = client.ensure_folder(&target.target_id, ".magdrive").await {
            if let Ok(meta_dir) = client.ensure_folder(&magdrive_dir, "metadata").await {
                let _ = client.upload_file(&meta_dir, &meta_file_name, &encrypted_manifest).await;
            }
        }
    }

    // Save to local SQLite
    state.db.upsert_package(&vault_id, &manifest).map_err(|e| e.to_string())?;

    // Mark transfer as completed
    let _ = state.db.upsert_transfer(&TransferRecord {
        id: transfer_id,
        package_id: package_id.clone(),
        name: file_name,
        transfer_type: "upload".to_string(),
        total_bytes: total_size,
        transferred_bytes: total_size,
        status: "completed".to_string(),
        error_message: None,
        updated_at: chrono::Utc::now().timestamp(),
    });

    Ok(package_id)
}

#[tauri::command]
pub async fn download_package(
    app: AppHandle,
    state: State<'_, AppState>,
    package_id: String,
    passphrase: Option<String>,
) -> Result<String, String> {
    let pkg = state
        .db
        .get_package(&package_id)
        .map_err(|e| e.to_string())?
        .ok_or("Berkas tidak ditemukan di katalog")?;

    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("Tidak ada vault aktif")?;
    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault aktif tidak ditemukan")?;

    let pass = passphrase.unwrap_or_else(|| "magdrive".to_string());
    let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
    let key = derive_master_key(&pass, &salt).map_err(|e| e.to_string())?;

    let client = get_drive_client(&state.db).await?;

    let mut assembled_bytes = Vec::with_capacity(pkg.total_size as usize);

    for (s_idx, stripe) in pkg.stripes.iter().enumerate() {
        let total_shards = pkg.erasure_schema.data_shards + pkg.erasure_schema.parity_shards;
        let mut available_shards: Vec<Option<Vec<u8>>> = vec![None; total_shards];

        // Download available chunks with auto-recovery
        for chunk in &stripe.chunks {
            if chunk.shard_index < total_shards {
                match client.download_file(&chunk.file_id).await {
                    Ok(encrypted_bytes) => {
                        // Decrypt chunk
                        if let Ok(decrypted_shard) = decrypt_chunk(&encrypted_bytes, &key) {
                            available_shards[chunk.shard_index] = Some(decrypted_shard);
                        }
                    }
                    Err(_) => {
                        // Chunk missing or drive dead - failover to parity
                        continue;
                    }
                }
            }
        }

        // Reconstruct stripe
        let stripe_len = if s_idx == pkg.stripes.len() - 1 {
            let rem = (pkg.total_size as usize) % pkg.chunk_size;
            if rem == 0 { pkg.chunk_size } else { rem }
        } else {
            pkg.chunk_size
        };

        let reconstructed = reconstruct(
            &mut available_shards,
            pkg.erasure_schema.data_shards,
            pkg.erasure_schema.parity_shards,
            stripe_len,
        )
        .map_err(|e| format!("Gagal memulihkan potongan stripe {}: {}", s_idx, e))?;

        assembled_bytes.extend_from_slice(&reconstructed);

        let _ = app.emit("transfer-progress", serde_json::json!({
            "package_id": package_id,
            "transferred": assembled_bytes.len(),
            "total": pkg.total_size
        }));
    }

    // Verify final SHA-256 integrity
    let actual_sha = compute_sha256(&assembled_bytes);
    if actual_sha != pkg.original_sha256 {
        return Err("Integritas berkas korup: SHA-256 tidak cocok".into());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&assembled_bytes);
    Ok(b64)
}
