use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadSessionInfo {
    pub session_id: String,
    pub transfer_id: String,
    pub chunk_size: usize,
    pub total_chunks: usize,
}

#[derive(Debug, Clone)]
pub struct UploadSession {
    pub session_id: String,
    pub transfer_id: String,
    pub file_name: String,
    pub total_bytes: u64,
    pub chunk_size: usize,
    pub is_folder: bool,
    pub passphrase: Option<String>,
    pub temp_file_path: std::path::PathBuf,
    pub uploaded_cloud_file_ids: Vec<String>,
    pub is_cancelled: bool,
    pub is_paused: bool,
}

pub struct AppState {
    pub db: Database,
    pub keypair: Mutex<Keypair>,
    pub upload_sessions: Mutex<HashMap<String, UploadSession>>,
    pub folder_cache: Arc<Mutex<HashMap<String, String>>>,
    pub key_cache: Arc<Mutex<HashMap<String, [u8; 32]>>>,
}

pub async fn ensure_cached_folder(
    client: &DriveClient,
    folder_cache: &Arc<Mutex<HashMap<String, String>>>,
    parent_id: &str,
    folder_name: &str,
) -> Result<String, String> {
    let key = format!("{}:{}", parent_id, folder_name);
    {
        let lock = folder_cache.lock().unwrap();
        if let Some(id) = lock.get(&key) {
            return Ok(id.clone());
        }
    }

    let id = client
        .ensure_folder(parent_id, folder_name)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut lock = folder_cache.lock().unwrap();
        lock.insert(key, id.clone());
    }

    Ok(id)
}

pub fn get_or_derive_master_key(
    key_cache: &Arc<Mutex<HashMap<String, [u8; 32]>>>,
    vault_id: &str,
    passphrase: &str,
    salt: &[u8],
) -> Result<[u8; 32], String> {
    let cache_key = format!("{}:{}", vault_id, compute_sha256(passphrase.as_bytes()));
    {
        let lock = key_cache.lock().unwrap();
        if let Some(k) = lock.get(&cache_key) {
            return Ok(*k);
        }
    }

    let key = derive_master_key(passphrase, salt).map_err(|e| e.to_string())?;
    {
        let mut lock = key_cache.lock().unwrap();
        lock.insert(cache_key, key);
    }

    Ok(key)
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
        .ok_or("GCP credentials not configured. Please enter Client ID first.")?;
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
            let expires_at = chrono::Utc::now().timestamp() + tokens.expires_in as i64;
            let _ = db_clone.set_setting("token_expires_at", &expires_at.to_string());
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
    let access_token = state.db.get_setting("access_token").unwrap_or_default();
    let refresh_token = state.db.get_setting("refresh_token").unwrap_or_default();

    if access_token.is_empty() && refresh_token.is_empty() {
        return Ok(false);
    }

    match get_drive_client(&state.db).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn logout_google(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.db.set_setting("access_token", "");
    let _ = state.db.set_setting("refresh_token", "");
    let _ = state.db.set_setting("token_expires_at", "0");
    Ok(())
}

// Helper to get active DriveClient with proactive auto-refresh and reactive retry
async fn get_drive_client(db: &Database) -> Result<DriveClient, String> {
    let mut access_token = db.get_setting("access_token").unwrap_or_default();
    let refresh_token = db.get_setting("refresh_token").unwrap_or_default();
    let expires_at: i64 = db.get_setting("token_expires_at")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let client_id = db.get_setting("gcp_client_id").unwrap_or_default();
    let client_secret = db.get_setting("gcp_client_secret").unwrap_or_default();
    let creds = if !client_id.is_empty() {
        Some(GcpCredentials { client_id, client_secret })
    } else {
        None
    };

    let now = chrono::Utc::now().timestamp();
    let needs_refresh = !refresh_token.is_empty() && (access_token.is_empty() || expires_at == 0 || now >= expires_at - 60);

    if needs_refresh {
        if let Some(ref c) = creds {
            match crate::drive::oauth::refresh_access_token(c, &refresh_token).await {
                Ok(new_tokens) => {
                    let _ = db.set_setting("access_token", &new_tokens.access_token);
                    let new_expires_at = chrono::Utc::now().timestamp() + new_tokens.expires_in as i64;
                    let _ = db.set_setting("token_expires_at", &new_expires_at.to_string());
                    if let Some(ref rt) = new_tokens.refresh_token {
                        let _ = db.set_setting("refresh_token", rt);
                    }
                    access_token = new_tokens.access_token;
                }
                Err(e) => {
                    eprintln!("Warning: Proactive token refresh failed: {}", e);
                    if access_token.is_empty() {
                        return Err(format!("Google Drive session expired: {}. Please sign in again in Settings.", e));
                    }
                }
            }
        }
    }

    if access_token.is_empty() {
        return Err("Not authenticated to Google Drive. Please sign in with Google in Settings.".into());
    }

    Ok(DriveClient::with_refresh(
        access_token,
        if refresh_token.is_empty() { None } else { Some(refresh_token) },
        creds,
        Some(db.clone()),
    ))
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
        .ok_or("Vault not found.")?;

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
        return Err("Incorrect passphrase. Failed to unlock vault.".into());
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
        .ok_or("No active vault selected.")?;

    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Active vault not found.")?;

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
        .ok_or("No active vault selected.")?;

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
        .ok_or("File not found.")?;

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
        .ok_or("File not found.")?;

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
        return Err("Access denied: You can only delete files uploaded by yourself.".into());
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
        .ok_or("No active vault selected.")?;

    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault not found.")?;

    if vault.targets.is_empty() {
        return Err("Vault has no Google Drive targets configured. Please add targets in the Settings menu.".into());
    }

    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(&file_bytes_base64)
        .map_err(|e| format!("Invalid base64 payload: {}", e))?;

    let total_size = raw_bytes.len() as u64;
    let original_sha256 = compute_sha256(&raw_bytes);
    let package_id = format!("pkg_{}", Uuid::new_v4().simple());

    let pass = passphrase.unwrap_or_else(|| "magdrive".to_string());
    let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
    let key = get_or_derive_master_key(&state.key_cache, &vault.id, &pass, &salt)?;

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

    let num_stripes = (raw_bytes.len() + chunk_size - 1) / chunk_size.max(1);
    let total_shards = num_stripes * (data_shards + parity_shards);

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": transfer_id,
        "stage": "encrypting",
        "current_shard": 0,
        "total_shards": total_shards,
        "transferred": 0,
        "transferred_bytes": 0,
        "total": total_size,
        "total_bytes": total_size,
        "speed_bps": 0,
        "eta_seconds": 0,
        "status": "transferring"
    }));

    // Pre-resolve and cache chunks folders for all targets concurrently
    let mut chunks_dir_futures = Vec::new();
    for target in &vault.targets {
        let client_clone = client.clone();
        let target_id = target.target_id.clone();
        let cache = state.folder_cache.clone();
        chunks_dir_futures.push(async move {
            let magdrive_dir = ensure_cached_folder(&client_clone, &cache, &target_id, ".magdrive").await?;
            let chunks_dir = ensure_cached_folder(&client_clone, &cache, &magdrive_dir, "chunks").await?;
            Ok::<String, String>(chunks_dir)
        });
    }
    let target_chunks_dirs = futures::future::join_all(chunks_dir_futures).await;
    let mut resolved_chunks_dirs = Vec::new();
    for (idx, res) in target_chunks_dirs.into_iter().enumerate() {
        match res {
            Ok(dir) => resolved_chunks_dirs.push(dir),
            Err(e) => return Err(format!("Failed to initialize folder for target {}: {}", vault.targets[idx].label, e)),
        }
    }

    let mut stripes = Vec::new();
    let mut uploaded_shards_count: usize = 0;
    let mut transferred_cloud_bytes: u64 = 0;
    let start_upload_instant = std::time::Instant::now();

    for s_idx in 0..num_stripes {
        let start = s_idx * chunk_size;
        let end = (start + chunk_size).min(raw_bytes.len());
        let stripe_data = &raw_bytes[start..end];

        // Reed-Solomon encoding
        let (shards, _) = encode(stripe_data, data_shards, parity_shards)
            .map_err(|e| e.to_string())?;

        let mut shard_futures = Vec::new();

        for (shard_idx, shard) in shards.iter().enumerate() {
            let encrypted_shard = encrypt_chunk(shard, &key).map_err(|e| e.to_string())?;
            let shard_sha = compute_sha256(&encrypted_shard);
            let chunk_file_name = format!("chunk_{}_{}.bin", package_id, shard_sha);

            let target_idx = shard_idx % vault.targets.len();
            let target = vault.targets[target_idx].clone();
            let chunks_sub = resolved_chunks_dirs[target_idx].clone();
            let client_clone = client.clone();
            let shard_len = encrypted_shard.len() as u64;

            shard_futures.push(async move {
                let fid = client_clone
                    .upload_file(&chunks_sub, &chunk_file_name, &encrypted_shard)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok::<_, String>((shard_idx, target.target_id, fid, shard_sha, shard_len, target.label))
            });
        }

        let results = futures::future::join_all(shard_futures).await;
        let mut chunk_refs = Vec::new();
        let mut last_target_label = String::new();

        for res in results {
            let (shard_idx, target_id, uploaded_file_id, shard_sha, shard_len, target_label) = res?;
            chunk_refs.push(ChunkRef {
                shard_index: shard_idx,
                target_id,
                file_id: uploaded_file_id,
                sha256: shard_sha,
            });
            uploaded_shards_count += 1;
            transferred_cloud_bytes += shard_len;
            last_target_label = target_label;
        }

        stripes.push(Stripe {
            stripe_index: s_idx,
            chunks: chunk_refs,
        });

        // Compute speed & ETA
        let elapsed_secs = start_upload_instant.elapsed().as_secs_f64().max(0.1);
        let speed_bps = (transferred_cloud_bytes as f64 / elapsed_secs) as u64;
        let transferred = ((s_idx + 1) * chunk_size).min(total_size as usize) as u64;
        let remaining_bytes = total_size.saturating_sub(transferred);
        let eta_seconds = if speed_bps > 0 { remaining_bytes / speed_bps.max(1) } else { 0 };

        let _ = app.emit("transfer-progress", serde_json::json!({
            "transfer_id": transfer_id,
            "stage": "uploading_shards",
            "current_shard": uploaded_shards_count,
            "total_shards": total_shards,
            "transferred": transferred,
            "transferred_bytes": transferred,
            "total": total_size,
            "total_bytes": total_size,
            "speed_bps": speed_bps,
            "eta_seconds": eta_seconds,
            "target_label": last_target_label,
            "status": "transferring"
        }));

        if let Ok(Some(mut tx)) = state.db.get_transfer(&transfer_id) {
            tx.transferred_bytes = transferred;
            tx.updated_at = chrono::Utc::now().timestamp();
            let _ = state.db.upsert_transfer(&tx);
        }
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

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": transfer_id,
        "stage": "finalizing",
        "current_shard": total_shards,
        "total_shards": total_shards,
        "transferred": total_size,
        "transferred_bytes": total_size,
        "total": total_size,
        "total_bytes": total_size,
        "speed_bps": 0,
        "eta_seconds": 0,
        "status": "finalizing"
    }));

    // Encrypt and upload metadata manifest to all targets in parallel
    let encrypted_manifest = manifest.encrypt(&key).map_err(|e| e.to_string())?;
    let meta_file_name = format!("meta_{}.enc", package_id);

    let mut manifest_futures = Vec::new();
    for target in &vault.targets {
        let client_clone = client.clone();
        let target_id = target.target_id.clone();
        let m_name = meta_file_name.clone();
        let m_bytes = encrypted_manifest.clone();
        let cache = state.folder_cache.clone();

        manifest_futures.push(async move {
            if let Ok(magdrive_dir) = ensure_cached_folder(&client_clone, &cache, &target_id, ".magdrive").await {
                if let Ok(meta_dir) = ensure_cached_folder(&client_clone, &cache, &magdrive_dir, "metadata").await {
                    let _ = client_clone.upload_file(&meta_dir, &m_name, &m_bytes).await;
                }
            }
        });
    }
    futures::future::join_all(manifest_futures).await;

    // Save to local SQLite
    state.db.upsert_package(&vault_id, &manifest).map_err(|e| e.to_string())?;

    // Mark transfer as completed
    let _ = state.db.upsert_transfer(&TransferRecord {
        id: transfer_id.clone(),
        package_id: package_id.clone(),
        name: file_name,
        transfer_type: "upload".to_string(),
        total_bytes: total_size,
        transferred_bytes: total_size,
        status: "completed".to_string(),
        error_message: None,
        updated_at: chrono::Utc::now().timestamp(),
    });

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": transfer_id,
        "stage": "completed",
        "current_shard": total_shards,
        "total_shards": total_shards,
        "transferred": total_size,
        "transferred_bytes": total_size,
        "total": total_size,
        "total_bytes": total_size,
        "speed_bps": 0,
        "eta_seconds": 0,
        "status": "completed"
    }));

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
        .ok_or("File not found in catalog.")?;

    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("No active vault selected.")?;
    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Active vault not found.")?;

    let pass = passphrase.unwrap_or_else(|| "magdrive".to_string());
    let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
    let key = get_or_derive_master_key(&state.key_cache, &vault.id, &pass, &salt)?;

    let client = get_drive_client(&state.db).await?;

    let mut assembled_bytes = Vec::with_capacity(pkg.total_size as usize);

    for (s_idx, stripe) in pkg.stripes.iter().enumerate() {
        let total_shards = pkg.erasure_schema.data_shards + pkg.erasure_schema.parity_shards;
        let mut available_shards: Vec<Option<Vec<u8>>> = vec![None; total_shards];

        // Download available chunks with auto-recovery concurrently
        let mut chunk_futures = Vec::new();
        for chunk in &stripe.chunks {
            if chunk.shard_index < total_shards {
                let client_clone = client.clone();
                let file_id = chunk.file_id.clone();
                let shard_idx = chunk.shard_index;
                chunk_futures.push(async move {
                    let res = client_clone.download_file(&file_id).await;
                    (shard_idx, res)
                });
            }
        }

        let download_results = futures::future::join_all(chunk_futures).await;
        for (shard_idx, res) in download_results {
            if let Ok(encrypted_bytes) = res {
                if let Ok(decrypted_shard) = decrypt_chunk(&encrypted_bytes, &key) {
                    available_shards[shard_idx] = Some(decrypted_shard);
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
        .map_err(|e| format!("Failed to reconstruct stripe {}: {}", s_idx, e))?;

        assembled_bytes.extend_from_slice(&reconstructed);

        let _ = app.emit("transfer-progress", serde_json::json!({
            "package_id": package_id,
            "transfer_id": package_id,
            "stage": "downloading",
            "transferred": assembled_bytes.len(),
            "transferred_bytes": assembled_bytes.len(),
            "total": pkg.total_size,
            "total_bytes": pkg.total_size,
            "status": "transferring"
        }));
    }

    // Verify final SHA-256 integrity
    let actual_sha = compute_sha256(&assembled_bytes);
    if actual_sha != pkg.original_sha256 {
        return Err("File integrity corrupted: SHA-256 checksum mismatch.".into());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&assembled_bytes);
    Ok(b64)
}

// ----------------------------------------------------
// Streaming Upload & Transfer Queue Control Commands
// ----------------------------------------------------

#[tauri::command]
pub async fn init_upload_session(
    app: AppHandle,
    state: State<'_, AppState>,
    file_name: String,
    total_bytes: u64,
    chunk_size: usize,
    is_folder: bool,
    passphrase: Option<String>,
) -> Result<UploadSessionInfo, String> {
    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("No active vault selected.")?;

    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault not found.")?;

    if vault.targets.is_empty() {
        return Err("Vault has no Google Drive targets configured. Please add targets in the Settings menu.".into());
    }

    let session_id = format!("ses_{}", Uuid::new_v4().simple());
    let transfer_id = format!("tx_{}", Uuid::new_v4().simple());
    let package_id = format!("pkg_{}", Uuid::new_v4().simple());

    // Create temp buffer file on local disk
    let temp_file_path = std::env::temp_dir().join(format!("magdrive_{}.tmp", session_id));
    let _ = std::fs::File::create(&temp_file_path)
        .map_err(|e| format!("Failed to create local temp buffer file: {}", e))?;

    let record = TransferRecord {
        id: transfer_id.clone(),
        package_id,
        name: file_name.clone(),
        transfer_type: "upload".to_string(),
        total_bytes,
        transferred_bytes: 0,
        status: "transferring".to_string(),
        error_message: None,
        updated_at: chrono::Utc::now().timestamp(),
    };
    state.db.upsert_transfer(&record).map_err(|e| e.to_string())?;

    let effective_chunk_size = chunk_size.max(1024 * 1024); // at least 1MB
    let total_chunks = if total_bytes == 0 {
        1
    } else {
        ((total_bytes as usize + effective_chunk_size - 1) / effective_chunk_size).max(1)
    };

    let session = UploadSession {
        session_id: session_id.clone(),
        transfer_id: transfer_id.clone(),
        file_name,
        total_bytes,
        chunk_size: effective_chunk_size,
        is_folder,
        passphrase,
        temp_file_path,
        uploaded_cloud_file_ids: Vec::new(),
        is_cancelled: false,
        is_paused: false,
    };

    state.upload_sessions.lock().unwrap().insert(session_id.clone(), session);

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": transfer_id,
        "transferred": 0,
        "total": total_bytes
    }));

    Ok(UploadSessionInfo {
        session_id,
        transfer_id,
        chunk_size: effective_chunk_size,
        total_chunks,
    })
}

#[tauri::command]
pub async fn upload_chunk_part(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    _chunk_index: usize,
    chunk_bytes_base64: String,
) -> Result<(), String> {
    let (temp_path, transfer_id, is_cancelled, is_paused) = {
        let sessions = state.upload_sessions.lock().unwrap();
        let session = sessions.get(&session_id).ok_or("Upload session not found or expired")?;
        (
            session.temp_file_path.clone(),
            session.transfer_id.clone(),
            session.is_cancelled,
            session.is_paused,
        )
    };

    if is_cancelled {
        return Err("Upload cancelled by user.".into());
    }

    if is_paused {
        return Err("Upload is currently paused.".into());
    }

    let part_bytes = base64::engine::general_purpose::STANDARD
        .decode(&chunk_bytes_base64)
        .map_err(|e| format!("Invalid base64 chunk: {}", e))?;

    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&temp_path)
        .map_err(|e| format!("Failed to append to temp file: {}", e))?;

    file.write_all(&part_bytes).map_err(|e| format!("Failed writing chunk: {}", e))?;
    file.flush().map_err(|e| format!("Failed flushing chunk: {}", e))?;

    let file_len = std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);
    if let Ok(Some(mut tx)) = state.db.get_transfer(&transfer_id) {
        tx.transferred_bytes = file_len;
        tx.updated_at = chrono::Utc::now().timestamp();
        let _ = state.db.upsert_transfer(&tx);

        let _ = app.emit("transfer-progress", serde_json::json!({
            "transfer_id": transfer_id,
            "transferred": file_len,
            "total": tx.total_bytes
        }));
    }

    Ok(())
}

#[tauri::command]
pub async fn finish_upload_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let session = {
        let mut sessions = state.upload_sessions.lock().unwrap();
        sessions.remove(&session_id).ok_or("Upload session not found or already completed")?
    };

    if session.is_cancelled {
        let _ = std::fs::remove_file(&session.temp_file_path);
        return Err("Upload cancelled by user.".into());
    }

    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("No active vault selected.")?;

    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault not found.")?;

    let raw_bytes = match std::fs::read(&session.temp_file_path) {
        Ok(b) => b,
        Err(e) => {
            let _ = std::fs::remove_file(&session.temp_file_path);
            let _ = state.db.update_transfer_status(&session.transfer_id, "failed", Some(&e.to_string()));
            return Err(format!("Failed reading buffered temp file: {}", e));
        }
    };

    // Clean up local temp file now that it's in memory
    let _ = std::fs::remove_file(&session.temp_file_path);

    let total_size = raw_bytes.len() as u64;
    let original_sha256 = compute_sha256(&raw_bytes);
    let package_id = format!("pkg_{}", Uuid::new_v4().simple());

    let pass = session.passphrase.unwrap_or_else(|| "magdrive".to_string());
    let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
    let key = get_or_derive_master_key(&state.key_cache, &vault.id, &pass, &salt)?;

    let uploader_pubkey = state.keypair.lock().unwrap().public_key_hex();

    let (data_shards, parity_shards) = if vault.targets.len() >= 3 {
        (2, 1)
    } else if vault.targets.len() == 2 {
        (1, 1)
    } else {
        (1, 0)
    };

    let client = get_drive_client(&state.db).await?;
    let mut uploaded_cloud_ids: Vec<String> = Vec::new();

    let chunk_size = session.chunk_size;
    let mut stripes = Vec::new();
    let num_stripes = (raw_bytes.len() + chunk_size - 1) / chunk_size.max(1);
    let total_shards = num_stripes * (data_shards + parity_shards);

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": session.transfer_id,
        "stage": "encrypting",
        "current_shard": 0,
        "total_shards": total_shards,
        "transferred": 0,
        "transferred_bytes": 0,
        "total": total_size,
        "total_bytes": total_size,
        "speed_bps": 0,
        "eta_seconds": 0,
        "status": "transferring"
    }));

    // Pre-resolve and cache chunks folders for all targets concurrently
    let mut chunks_dir_futures = Vec::new();
    for target in &vault.targets {
        let client_clone = client.clone();
        let target_id = target.target_id.clone();
        let cache = state.folder_cache.clone();
        chunks_dir_futures.push(async move {
            let magdrive_dir = ensure_cached_folder(&client_clone, &cache, &target_id, ".magdrive").await?;
            let chunks_dir = ensure_cached_folder(&client_clone, &cache, &magdrive_dir, "chunks").await?;
            Ok::<String, String>(chunks_dir)
        });
    }
    let target_chunks_dirs = futures::future::join_all(chunks_dir_futures).await;
    let mut resolved_chunks_dirs = Vec::new();
    for (idx, res) in target_chunks_dirs.into_iter().enumerate() {
        match res {
            Ok(dir) => resolved_chunks_dirs.push(dir),
            Err(e) => return Err(format!("Failed to initialize folder for target {}: {}", vault.targets[idx].label, e)),
        }
    }

    let mut uploaded_shards_count: usize = 0;
    let mut transferred_cloud_bytes: u64 = 0;
    let start_upload_instant = std::time::Instant::now();

    for s_idx in 0..num_stripes {
        // Check pause or cancel
        {
            let sessions = state.upload_sessions.lock().unwrap();
            if let Some(s) = sessions.get(&session_id) {
                if s.is_cancelled {
                    let client_clone = client.clone();
                    let cleanup_ids = uploaded_cloud_ids.clone();
                    tokio::spawn(async move {
                        for fid in cleanup_ids {
                            let _ = client_clone.delete_file(&fid).await;
                        }
                    });
                    let _ = state.db.update_transfer_status(&session.transfer_id, "cancelled", None);
                    return Err("Transfer cancelled by user.".into());
                }
            }
        }

        let start = s_idx * chunk_size;
        let end = (start + chunk_size).min(raw_bytes.len());
        let stripe_data = &raw_bytes[start..end];

        let (shards, _) = encode(stripe_data, data_shards, parity_shards)
            .map_err(|e| e.to_string())?;

        let mut shard_futures = Vec::new();

        for (shard_idx, shard) in shards.iter().enumerate() {
            let encrypted_shard = encrypt_chunk(shard, &key).map_err(|e| e.to_string())?;
            let shard_sha = compute_sha256(&encrypted_shard);
            let chunk_file_name = format!("chunk_{}_{}.bin", package_id, shard_sha);

            let target_idx = shard_idx % vault.targets.len();
            let target = vault.targets[target_idx].clone();
            let chunks_sub = resolved_chunks_dirs[target_idx].clone();
            let client_clone = client.clone();
            let shard_len = encrypted_shard.len() as u64;

            shard_futures.push(async move {
                let fid = client_clone
                    .upload_file(&chunks_sub, &chunk_file_name, &encrypted_shard)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok::<_, String>((shard_idx, target.target_id, fid, shard_sha, shard_len, target.label))
            });
        }

        let results = futures::future::join_all(shard_futures).await;
        let mut chunk_refs = Vec::new();
        let mut last_target_label = String::new();

        for res in results {
            match res {
                Ok((shard_idx, target_id, uploaded_file_id, shard_sha, shard_len, target_label)) => {
                    uploaded_cloud_ids.push(uploaded_file_id.clone());
                    chunk_refs.push(ChunkRef {
                        shard_index: shard_idx,
                        target_id,
                        file_id: uploaded_file_id,
                        sha256: shard_sha,
                    });
                    uploaded_shards_count += 1;
                    transferred_cloud_bytes += shard_len;
                    last_target_label = target_label;
                }
                Err(e) => {
                    let client_clone = client.clone();
                    let cleanup_ids = uploaded_cloud_ids.clone();
                    tokio::spawn(async move {
                        for fid in cleanup_ids {
                            let _ = client_clone.delete_file(&fid).await;
                        }
                    });
                    let _ = state.db.update_transfer_status(&session.transfer_id, "failed", Some(&e));
                    return Err(format!("Cloud chunk upload failed: {}", e));
                }
            }
        }

        stripes.push(Stripe {
            stripe_index: s_idx,
            chunks: chunk_refs,
        });

        // Compute speed & ETA
        let elapsed_secs = start_upload_instant.elapsed().as_secs_f64().max(0.1);
        let speed_bps = (transferred_cloud_bytes as f64 / elapsed_secs) as u64;
        let transferred = ((s_idx + 1) * chunk_size).min(total_size as usize) as u64;
        let remaining_bytes = total_size.saturating_sub(transferred);
        let eta_seconds = if speed_bps > 0 { remaining_bytes / speed_bps.max(1) } else { 0 };

        let _ = app.emit("transfer-progress", serde_json::json!({
            "transfer_id": session.transfer_id,
            "stage": "uploading_shards",
            "current_shard": uploaded_shards_count,
            "total_shards": total_shards,
            "transferred": transferred,
            "transferred_bytes": transferred,
            "total": total_size,
            "total_bytes": total_size,
            "speed_bps": speed_bps,
            "eta_seconds": eta_seconds,
            "target_label": last_target_label,
            "status": "transferring"
        }));

        if let Ok(Some(mut tx)) = state.db.get_transfer(&session.transfer_id) {
            tx.transferred_bytes = transferred;
            tx.updated_at = chrono::Utc::now().timestamp();
            let _ = state.db.upsert_transfer(&tx);
        }
    }

    let manifest = PackageManifest {
        version: 1,
        package_id: package_id.clone(),
        pkg_type: if session.is_folder { PackageType::Folder } else { PackageType::File },
        name: session.file_name.clone(),
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
        tree: vec![],
        stripes,
        created_at: chrono::Utc::now().timestamp(),
    };

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": session.transfer_id,
        "stage": "finalizing",
        "current_shard": total_shards,
        "total_shards": total_shards,
        "transferred": total_size,
        "transferred_bytes": total_size,
        "total": total_size,
        "total_bytes": total_size,
        "speed_bps": 0,
        "eta_seconds": 0,
        "status": "finalizing"
    }));

    // Encrypt and upload metadata manifest to all targets in parallel
    let manifest_bytes = manifest.encrypt(&key).map_err(|e| e.to_string())?;
    let manifest_file_name = format!("meta_{}.enc", package_id);

    let mut manifest_futures = Vec::new();
    for target in &vault.targets {
        let client_clone = client.clone();
        let target_id = target.target_id.clone();
        let m_name = manifest_file_name.clone();
        let m_bytes = manifest_bytes.clone();
        let cache = state.folder_cache.clone();

        manifest_futures.push(async move {
            if let Ok(magdrive_dir) = ensure_cached_folder(&client_clone, &cache, &target_id, ".magdrive").await {
                if let Ok(meta_dir) = ensure_cached_folder(&client_clone, &cache, &magdrive_dir, "metadata").await {
                    let _ = client_clone.upload_file(&meta_dir, &m_name, &m_bytes).await;
                }
            }
        });
    }
    futures::future::join_all(manifest_futures).await;

    state.db.upsert_package(&vault.id, &manifest).map_err(|e| e.to_string())?;

    if let Ok(Some(mut tx)) = state.db.get_transfer(&session.transfer_id) {
        tx.package_id = package_id.clone();
        tx.status = "completed".to_string();
        tx.transferred_bytes = total_size;
        tx.updated_at = chrono::Utc::now().timestamp();
        let _ = state.db.upsert_transfer(&tx);
    }

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": session.transfer_id,
        "stage": "completed",
        "current_shard": total_shards,
        "total_shards": total_shards,
        "transferred": total_size,
        "transferred_bytes": total_size,
        "total": total_size,
        "total_bytes": total_size,
        "speed_bps": 0,
        "eta_seconds": 0,
        "status": "completed"
    }));

    Ok(package_id)
}

#[tauri::command]
pub async fn pause_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.db.update_transfer_status(&transfer_id, "paused", None).map_err(|e| e.to_string())?;
    let mut sessions = state.upload_sessions.lock().unwrap();
    for session in sessions.values_mut() {
        if session.transfer_id == transfer_id {
            session.is_paused = true;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn resume_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.db.update_transfer_status(&transfer_id, "transferring", None).map_err(|e| e.to_string())?;
    let mut sessions = state.upload_sessions.lock().unwrap();
    for session in sessions.values_mut() {
        if session.transfer_id == transfer_id {
            session.is_paused = false;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    state.db.update_transfer_status(&transfer_id, "cancelled", None).map_err(|e| e.to_string())?;

    let mut session_to_cleanup = None;
    {
        let mut sessions = state.upload_sessions.lock().unwrap();
        let mut found_key = None;
        for (key, s) in sessions.iter_mut() {
            if s.transfer_id == transfer_id {
                s.is_cancelled = true;
                found_key = Some(key.clone());
                break;
            }
        }
        if let Some(key) = found_key {
            session_to_cleanup = sessions.remove(&key);
        }
    }

    if let Some(session) = session_to_cleanup {
        let _ = std::fs::remove_file(&session.temp_file_path);

        // Clean up any uploaded cloud files in background
        if !session.uploaded_cloud_file_ids.is_empty() {
            let db_clone = state.db.clone();
            let cloud_ids = session.uploaded_cloud_file_ids;
            tokio::spawn(async move {
                if let Ok(client) = get_drive_client(&db_clone).await {
                    for fid in cloud_ids {
                        let _ = client.delete_file(&fid).await;
                    }
                }
            });
        }
    }

    let _ = app.emit("transfer-progress", serde_json::json!({
        "transfer_id": transfer_id,
        "cancelled": true
    }));

    Ok(())
}

#[tauri::command]
pub async fn delete_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.db.delete_transfer(&transfer_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_finished_transfers(state: State<'_, AppState>) -> Result<(), String> {
    state.db.clear_finished_transfers().map_err(|e| e.to_string())
}
