use base64::Engine;
use futures::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::catalog::manifest::{ErasureSchema, FileEntry, PackageManifest, PackageType, Stripe, ChunkRef};
use crate::catalog::sync::sync_vault_catalog;
use crate::crypto::argon::{derive_master_key, generate_salt};
use crate::crypto::signature::Keypair;
use crate::crypto::compute_sha256;
use crate::crypto::aes::{encrypt_chunk, decrypt_chunk};
use crate::drive::client::{DriveClient, DriveAboutUser, SharedDriveItem, TargetType};
use crate::drive::oauth::{start_oauth_flow, GcpCredentials};
use crate::drive::permissions::DrivePermissionItem;
use crate::erasure::rs::{encode, reconstruct, calculate_adaptive_erasure_schema};
use crate::magnet::parser::{generate_swarm_magnet_link, parse_magnet_link, MagnetInfo};
use crate::storage::db::{Database, TransferRecord, GoogleAccountRecord};
use crate::tracker::{announce_to_trackers, calculate_blind_topic, fetch_peers_multi, report_dead_multi};
use crate::vault::model::{VaultExportPayload, VaultRecord, VaultRole, VaultTarget};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerSettings {
    pub trackers: Vec<String>,
    pub default_seeding: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmResolveResult {
    pub package_id: String,
    pub name: String,
    pub total_size: u64,
    pub peer_count: usize,
    pub sources: Vec<String>,
    pub trackers: Vec<String>,
    pub is_local: bool,
    pub key: Option<String>,
}

pub fn get_tracker_urls_from_db(db: &Database) -> Vec<String> {
    if let Some(json_str) = db.get_setting("tracker_urls") {
        if let Ok(urls) = serde_json::from_str::<Vec<String>>(&json_str) {
            if !urls.is_empty() {
                return urls;
            }
        }
    }
    vec!["https://magdrive-tracker.vercel.app/api".to_string()]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadSessionInfo {
    pub session_id: String,
    pub transfer_id: String,
    pub chunk_size: usize,
    pub total_chunks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadSettings {
    pub download_dir: String,
    pub prompt_save_location: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub destination_path: String,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveErasureInfo {
    pub num_targets: usize,
    pub data_shards: usize,
    pub parity_shards: usize,
    pub total_shards: usize,
    pub fault_tolerance: usize,
    pub overhead_percent: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetMigrationStats {
    pub target_id: String,
    pub total_packages: usize,
    pub affected_packages: usize,
    pub chunks_on_target: usize,
    pub total_vault_chunks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationProgressPayload {
    pub stage: String,
    pub current_chunk: usize,
    pub total_chunks: usize,
    pub copied_chunks: usize,
    pub relayed_chunks: usize,
    pub reconstructed_chunks: usize,
    pub current_package_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetMigrationResult {
    pub success: bool,
    pub total_migrated: usize,
    pub copied_count: usize,
    pub relayed_count: usize,
    pub reconstructed_count: usize,
    pub failed_count: usize,
    pub message: String,
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

/// Validates package ID against path traversal and special characters
pub fn validate_package_id(package_id: &str) -> Result<(), String> {
    if package_id.is_empty() || package_id.len() > 64 {
        return Err("Package ID must be between 1 and 64 characters".to_string());
    }
    if !package_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Package ID contains invalid characters".to_string());
    }
    Ok(())
}

/// Ensures `.magdrive/packages/<package_id>` exists under `target_root_id` and has public reader permission
pub async fn ensure_cached_package_folder(
    client: &DriveClient,
    folder_cache: &Arc<Mutex<HashMap<String, String>>>,
    target_root_id: &str,
    package_id: &str,
) -> Result<String, String> {
    validate_package_id(package_id)?;
    let magdrive_dir = ensure_cached_folder(client, folder_cache, target_root_id, ".magdrive").await?;
    let packages_dir = ensure_cached_folder(client, folder_cache, &magdrive_dir, "packages").await?;
    let pkg_folder = ensure_cached_folder(client, folder_cache, &packages_dir, package_id).await?;
    // Set public viewer on this package folder only (gracefully handles domain policy restrictions)
    let _ = client.set_folder_public_viewer(&pkg_folder).await;
    Ok(pkg_folder)
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
// Download Settings & Dialog Commands
// ----------------------------------------------------

fn get_system_default_download_dir() -> std::path::PathBuf {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

#[tauri::command]
pub async fn get_download_settings(state: State<'_, AppState>) -> Result<DownloadSettings, String> {
    let download_dir = state
        .db
        .get_setting("download_dir")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| get_system_default_download_dir().to_string_lossy().to_string());

    let prompt_save_location = state
        .db
        .get_setting("prompt_save_location")
        .map(|s| s != "false")
        .unwrap_or(true);

    Ok(DownloadSettings {
        download_dir,
        prompt_save_location,
    })
}

#[tauri::command]
pub async fn save_download_settings(
    state: State<'_, AppState>,
    download_dir: String,
    prompt_save_location: bool,
) -> Result<(), String> {
    state
        .db
        .set_setting("download_dir", download_dir.trim())
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_setting(
            "prompt_save_location",
            if prompt_save_location { "true" } else { "false" },
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn pick_download_directory(default_dir: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title("Select Download Directory");
    let initial_dir = default_dir
        .filter(|d| !d.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(get_system_default_download_dir);

    if initial_dir.exists() {
        dialog = dialog.set_directory(&initial_dir);
    }

    let folder = dialog.pick_folder().await;
    Ok(folder.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_save_file_path(
    default_name: String,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Save Downloaded File As")
        .set_file_name(&default_name);

    let initial_dir = default_dir
        .filter(|d| !d.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(get_system_default_download_dir);

    if initial_dir.exists() {
        dialog = dialog.set_directory(&initial_dir);
    }

    let file = dialog.save_file().await;
    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub fn resolve_download_path(download_dir: String, file_name: String) -> String {
    let base_dir = std::path::Path::new(&download_dir);
    let original_path = base_dir.join(&file_name);
    if !original_path.exists() {
        return original_path.to_string_lossy().to_string();
    }

    let p = std::path::Path::new(&file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|e| e.to_str());

    for counter in 1..10000 {
        let new_name = match ext {
            Some(extension) => format!("{} ({}).{}", stem, counter, extension),
            None => format!("{} ({})", stem, counter),
        };
        let candidate = base_dir.join(&new_name);
        if !candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    original_path.to_string_lossy().to_string()
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
            let expires_at = chrono::Utc::now().timestamp() + tokens.expires_in as i64;
            let temp_client = DriveClient::new(tokens.access_token.clone());

            if let Ok(profile) = temp_client.get_user_profile().await {
                let root_folder_id = temp_client.find_or_create_magdrive_folder().await.ok();
                let account = GoogleAccountRecord {
                    email: profile.email_address.clone(),
                    display_name: profile.display_name.clone(),
                    access_token: tokens.access_token.clone(),
                    refresh_token: tokens.refresh_token.clone().unwrap_or_default(),
                    expires_at,
                    root_folder_id,
                    created_at: chrono::Utc::now().timestamp(),
                };
                let _ = db_clone.save_google_account(&account);
            }

            let _ = db_clone.set_setting("access_token", &tokens.access_token);
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStorageQuotaInfo {
    pub display_name: String,
    pub email_address: String,
    pub limit_bytes: Option<u64>,
    pub usage_bytes: u64,
    pub usage_in_drive_bytes: u64,
    pub usage_in_trash_bytes: u64,
    pub free_bytes: Option<u64>,
    pub usage_percentage: Option<f64>,
    pub is_unlimited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetStorageUsage {
    pub target_id: String,
    pub chunk_count: usize,
    pub total_bytes: u64,
}

#[tauri::command]
pub async fn get_google_user_profile(state: State<'_, AppState>) -> Result<Option<DriveAboutUser>, String> {
    let client = match get_drive_client(&state.db).await {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    match client.get_user_profile().await {
        Ok(profile) => Ok(Some(profile)),
        Err(e) => {
            eprintln!("Failed to fetch Google user profile: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn get_storage_quota(state: State<'_, AppState>) -> Result<Option<AccountStorageQuotaInfo>, String> {
    let client = match get_drive_client(&state.db).await {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    match client.get_storage_quota().await {
        Ok((user, quota_opt)) => {
            let (limit_bytes, usage_bytes, usage_in_drive_bytes, usage_in_trash_bytes, free_bytes, usage_percentage, is_unlimited) = match quota_opt {
                Some(q) => {
                    let limit = q.limit.as_ref().and_then(|s| s.parse::<u64>().ok());
                    let usage = q.usage.as_ref().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                    let usage_drive = q.usage_in_drive.as_ref().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                    let usage_trash = q.usage_in_drive_trash.as_ref().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);

                    let (free, pct, unlim) = match limit {
                        Some(l) if l > 0 => {
                            let free = l.saturating_sub(usage);
                            let pct = ((usage as f64 / l as f64) * 100.0).min(100.0);
                            (Some(free), Some(pct), false)
                        }
                        _ => (None, None, true),
                    };
                    (limit, usage, usage_drive, usage_trash, free, pct, unlim)
                }
                None => (None, 0, 0, 0, None, None, true),
            };

            Ok(Some(AccountStorageQuotaInfo {
                display_name: user.display_name,
                email_address: user.email_address,
                limit_bytes,
                usage_bytes,
                usage_in_drive_bytes,
                usage_in_trash_bytes,
                free_bytes,
                usage_percentage,
                is_unlimited,
            }))
        }
        Err(e) => {
            eprintln!("Failed to fetch Google storage quota: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn get_vault_targets_usage(
    state: State<'_, AppState>,
    vault_id: String,
) -> Result<Vec<TargetStorageUsage>, String> {
    let packages = state.db.list_packages(&vault_id).map_err(|e| e.to_string())?;
    let mut usage_map: HashMap<String, (usize, u64)> = HashMap::new();

    for pkg in &packages {
        let chunk_bytes = (pkg.chunk_size + 28) as u64;
        for stripe in &pkg.stripes {
            for chunk in &stripe.chunks {
                let entry = usage_map.entry(chunk.target_id.clone()).or_insert((0, 0));
                entry.0 += 1;
                entry.1 += chunk_bytes;
            }
        }
    }

    let results = usage_map
        .into_iter()
        .map(|(target_id, (chunk_count, total_bytes))| TargetStorageUsage {
            target_id,
            chunk_count,
            total_bytes,
        })
        .collect();

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAccountInfo {
    pub email: String,
    pub display_name: String,
    pub root_folder_id: Option<String>,
    pub limit_bytes: Option<u64>,
    pub usage_bytes: u64,
    pub usage_in_drive_bytes: u64,
    pub usage_in_trash_bytes: u64,
    pub free_bytes: Option<u64>,
    pub usage_percentage: Option<f64>,
    pub is_unlimited: bool,
    pub created_at: i64,
}

#[tauri::command]
pub async fn list_google_accounts(state: State<'_, AppState>) -> Result<Vec<GoogleAccountInfo>, String> {
    let accounts = state.db.list_google_accounts().map_err(|e| e.to_string())?;
    let mut infos = Vec::new();

    for acc in accounts {
        let client_res = get_drive_client_for_account(&state.db, &acc.email).await;
        let mut root_folder_id = acc.root_folder_id.clone();

        let (limit_bytes, usage_bytes, usage_in_drive_bytes, usage_in_trash_bytes, free_bytes, usage_percentage, is_unlimited) = match client_res {
            Ok(client) => {
                // Auto ensure root_folder_id if missing
                if root_folder_id.is_none() {
                    if let Ok(fid) = client.find_or_create_magdrive_folder().await {
                        let _ = state.db.update_account_root_folder(&acc.email, &fid);
                        root_folder_id = Some(fid);
                    }
                }

                match client.get_storage_quota().await {
                    Ok((_, quota_opt)) => {
                        match quota_opt {
                            Some(q) => {
                                let limit = q.limit.as_ref().and_then(|s| s.parse::<u64>().ok());
                                let usage = q.usage.as_ref().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                                let usage_drive = q.usage_in_drive.as_ref().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                                let usage_trash = q.usage_in_drive_trash.as_ref().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);

                                let (free, pct, unlim) = match limit {
                                    Some(l) if l > 0 => {
                                        let free = l.saturating_sub(usage);
                                        let pct = ((usage as f64 / l as f64) * 100.0).min(100.0);
                                        (Some(free), Some(pct), false)
                                    }
                                    _ => (None, None, true),
                                };
                                (limit, usage, usage_drive, usage_trash, free, pct, unlim)
                            }
                            None => (None, 0, 0, 0, None, None, true),
                        }
                    }
                    Err(_) => (None, 0, 0, 0, None, None, false),
                }
            }
            Err(_) => (None, 0, 0, 0, None, None, false),
        };

        infos.push(GoogleAccountInfo {
            email: acc.email,
            display_name: acc.display_name,
            root_folder_id,
            limit_bytes,
            usage_bytes,
            usage_in_drive_bytes,
            usage_in_trash_bytes,
            free_bytes,
            usage_percentage,
            is_unlimited,
            created_at: acc.created_at,
        });
    }

    Ok(infos)
}

#[tauri::command]
pub async fn remove_google_account(state: State<'_, AppState>, email: String) -> Result<(), String> {
    state.db.delete_google_account(&email).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_accessible_shared_drives(
    state: State<'_, AppState>,
    email: String,
) -> Result<Vec<SharedDriveItem>, String> {
    let client = get_drive_client_for_account(&state.db, &email).await?;
    client.list_shared_drives().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auto_add_account_target(
    state: State<'_, AppState>,
    vault_id: String,
    email: String,
) -> Result<VaultRecord, String> {
    let mut vault = state.db.get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Active vault not found".to_string())?;

    let client = get_drive_client_for_account(&state.db, &email).await?;
    let folder_id = client.find_or_create_vault_folder(&vault.id, &vault.name).await.map_err(|e| e.to_string())?;
    let _ = state.db.update_account_root_folder(&email, &folder_id);

    let account = state.db.get_google_account(&email)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Account not found".to_string())?;

    // Avoid duplicate target
    if !vault.targets.iter().any(|t| t.target_id == folder_id) {
        vault.targets.push(VaultTarget {
            target_id: folder_id,
            target_type: TargetType::SharedFolder,
            label: format!("{} (Personal)", account.display_name),
            account_email: Some(email),
        });
        state.db.save_vault(&vault).map_err(|e| e.to_string())?;
    }

    Ok(vault)
}

#[tauri::command]
pub async fn add_shared_drive_target(
    state: State<'_, AppState>,
    vault_id: String,
    email: String,
    drive_id: String,
    drive_name: String,
) -> Result<VaultRecord, String> {
    let mut vault = state.db.get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Active vault not found".to_string())?;

    // Avoid duplicate target
    if !vault.targets.iter().any(|t| t.target_id == drive_id) {
        vault.targets.push(VaultTarget {
            target_id: drive_id,
            target_type: TargetType::SharedDrive,
            label: format!("{} (Shared Drive)", drive_name),
            account_email: Some(email),
        });
        state.db.save_vault(&vault).map_err(|e| e.to_string())?;
    }

    Ok(vault)
}

#[tauri::command]
pub async fn logout_google(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.db.set_setting("access_token", "");
    let _ = state.db.set_setting("refresh_token", "");
    let _ = state.db.set_setting("token_expires_at", "0");
    Ok(())
}

pub async fn get_drive_client_for_account(db: &Database, email: &str) -> Result<DriveClient, String> {
    let account = db.get_google_account(email)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Google account {} not found in local vault", email))?;

    let client_id = db.get_setting("gcp_client_id").unwrap_or_default();
    let client_secret = db.get_setting("gcp_client_secret").unwrap_or_default();
    let creds = if !client_id.is_empty() {
        Some(GcpCredentials { client_id, client_secret })
    } else {
        None
    };

    let mut access_token = account.access_token;
    let refresh_token = account.refresh_token;
    let now = chrono::Utc::now().timestamp();

    // If token expired or expires within 60s, refresh proactively
    if (account.expires_at == 0 || account.expires_at - now < 60) && !refresh_token.is_empty() {
        if let Some(ref c) = creds {
            if let Ok(new_tokens) = crate::drive::oauth::refresh_access_token(c, &refresh_token).await {
                access_token = new_tokens.access_token;
                let new_expires_at = now + new_tokens.expires_in as i64;
                let _ = db.update_account_tokens(email, &access_token, new_expires_at);
            }
        }
    }

    Ok(DriveClient::for_account(
        email.to_string(),
        access_token,
        if refresh_token.is_empty() { None } else { Some(refresh_token) },
        creds,
        Some(db.clone()),
    ))
}

pub async fn get_drive_clients_for_targets(
    db: &Database,
    targets: &[VaultTarget],
) -> Result<Vec<DriveClient>, String> {
    let mut clients = Vec::with_capacity(targets.len());
    let default_client = get_drive_client(db).await.ok();

    for t in targets {
        if let Some(ref email) = t.account_email {
            match get_drive_client_for_account(db, email).await {
                Ok(c) => clients.push(c),
                Err(_) => {
                    if let Some(ref def) = default_client {
                        clients.push(def.clone());
                    } else {
                        return Err(format!("No Google account available for target {}", t.label));
                    }
                }
            }
        } else if let Some(ref def) = default_client {
            clients.push(def.clone());
        } else {
            return Err(format!("No Google account available for target {}", t.label));
        }
    }

    Ok(clients)
}

// Helper to get active DriveClient with proactive auto-refresh and reactive retry
async fn get_drive_client(db: &Database) -> Result<DriveClient, String> {
    let mut access_token = db.get_setting("access_token").unwrap_or_default();
    let refresh_token = db.get_setting("refresh_token").unwrap_or_default();
    let expires_at: i64 = db.get_setting("token_expires_at")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    if access_token.is_empty() && refresh_token.is_empty() {
        if let Ok(accounts) = db.list_google_accounts() {
            if let Some(first) = accounts.first() {
                return get_drive_client_for_account(db, &first.email).await;
            }
        }
    }

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

#[tauri::command]
pub async fn save_vault_json_to_file(
    state: State<'_, AppState>,
    vault_id: String,
) -> Result<Option<String>, String> {
    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault not found.")?;

    let payload = VaultExportPayload {
        version: 1,
        vault_id: vault.id,
        vault_name: vault.name.clone(),
        role: vault.role,
        targets: vault.targets,
        salt_hex: vault.salt_hex,
        verification_tag: vault.verification_tag,
    };

    let json_string = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let default_name = format!("{}_vault.json", vault.name.replace(' ', "_"));

    let dialog = rfd::AsyncFileDialog::new()
        .set_title("Save Vault Backup (vault.json)")
        .set_file_name(&default_name)
        .add_filter("JSON Document", &["json"]);

    let file = dialog.save_file().await;
    if let Some(handle) = file {
        let path = handle.path().to_path_buf();
        tokio::fs::write(&path, json_string.as_bytes())
            .await
            .map_err(|e| format!("Failed to write vault.json: {}", e))?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn load_vault_json_from_file() -> Result<Option<String>, String> {
    let dialog = rfd::AsyncFileDialog::new()
        .set_title("Open Vault Backup File (vault.json)")
        .add_filter("JSON Document", &["json"]);

    let file = dialog.pick_file().await;
    if let Some(handle) = file {
        let path = handle.path();
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn import_vault_from_json(
    state: State<'_, AppState>,
    json_content: String,
    passphrase: String,
) -> Result<VaultRecord, String> {
    let payload: VaultExportPayload = serde_json::from_str(&json_content)
        .map_err(|e| format!("Invalid vault.json format: {}", e))?;

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

#[tauri::command]
pub async fn upload_vault_descriptor_to_drive(
    state: State<'_, AppState>,
    vault_id: String,
) -> Result<String, String> {
    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Vault not found.")?;

    if vault.targets.is_empty() {
        return Err("No storage targets configured for this vault.".into());
    }

    let payload = VaultExportPayload {
        version: 1,
        vault_id: vault.id,
        vault_name: vault.name,
        role: vault.role,
        targets: vault.targets.clone(),
        salt_hex: vault.salt_hex,
        verification_tag: vault.verification_tag,
    };

    let json_bytes = serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?;
    let client = get_drive_client(&state.db).await?;

    let mut uploaded_targets = Vec::new();
    for target in &vault.targets {
        let magdrive_dir = ensure_cached_folder(&client, &state.folder_cache, &target.target_id, ".magdrive").await?;
        client
            .upload_file(&magdrive_dir, "vault.json", &json_bytes)
            .await
            .map_err(|e| format!("Failed to upload vault.json to target {}: {}", target.label, e))?;
        uploaded_targets.push(target.label.clone());
    }

    Ok(format!("Uploaded vault.json to {} target(s): {}", uploaded_targets.len(), uploaded_targets.join(", ")))
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
    let vault = state.db.get_vault(&vault_id).map_err(|e| e.to_string())?;

    let key_b64 = if let Ok(Some(enc_hex)) = state.db.get_package_key_enc(&package_id) {
        // Try unwrapping package-specific key using cached master key
        if let Some(ref v) = vault {
            let lock = state.key_cache.lock().unwrap();
            let master_key = lock.get(&v.id).copied().or_else(|| {
                lock.iter()
                    .find(|(k, _)| k.starts_with(&v.id))
                    .map(|(_, val)| *val)
            });
            if let Some(mk) = master_key {
                if let Ok(raw_enc) = base64::engine::general_purpose::STANDARD.decode(&enc_hex) {
                    if let Ok(unwrapped) = decrypt_chunk(&raw_enc, &mk) {
                        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(unwrapped))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else if let Some(ref v) = vault {
        // Fallback for legacy packages encrypted directly with master key
        let lock = state.key_cache.lock().unwrap();
        let found_key = lock.get(&v.id).copied().or_else(|| {
            lock.iter()
                .find(|(k, _)| k.starts_with(&v.id))
                .map(|(_, val)| *val)
        });
        found_key.map(|k| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(k))
    } else {
        None
    };

    let sources: Vec<String> = if let Some(ref v) = vault {
        let mut pkg_sources = Vec::new();
        if let Ok(clients) = get_drive_clients_for_targets(&state.db, &v.targets).await {
            for (idx, target) in v.targets.iter().enumerate() {
                if let Some(client) = clients.get(idx) {
                    if let Ok(pkg_dir) = ensure_cached_package_folder(client, &state.folder_cache, &target.target_id, &pkg.package_id).await {
                        pkg_sources.push(pkg_dir);
                        continue;
                    }
                }
                pkg_sources.push(target.target_id.clone());
            }
        } else {
            pkg_sources = v.targets.iter().map(|t| t.target_id.clone()).collect();
        }
        pkg_sources
    } else {
        Vec::new()
    };

    let trackers = get_tracker_urls_from_db(&state.db);

    let link = generate_swarm_magnet_link(
        &pkg.package_id,
        &vault_id,
        pkg.total_size,
        &pkg.name,
        key_b64.as_deref(),
        &sources,
        &trackers,
    );
    Ok(link)
}

#[tauri::command]
pub async fn resolve_magnet_package(
    state: State<'_, AppState>,
    magnet_uri: String,
) -> Result<SwarmResolveResult, String> {
    let info = parse_magnet_link(&magnet_uri).map_err(|e| e.to_string())?;

    // If package is already in local SQLite DB
    if let Ok(Some(existing_pkg)) = state.db.get_package(&info.package_id) {
        return Ok(SwarmResolveResult {
            package_id: existing_pkg.package_id,
            name: existing_pkg.name,
            total_size: existing_pkg.total_size,
            peer_count: info.sources.len().max(1),
            sources: info.sources,
            trackers: info.trackers,
            is_local: true,
            key: info.key,
        });
    }

    let topic = calculate_blind_topic(&info.package_id);
    let mut tracker_list = info.trackers.clone();
    if tracker_list.is_empty() {
        tracker_list = get_tracker_urls_from_db(&state.db);
    }

    // Fetch peers from all trackers
    let mut peers = fetch_peers_multi(&tracker_list, &topic).await;
    for src in &info.sources {
        if !peers.contains(src) {
            peers.push(src.clone());
        }
    }

    let peer_count = peers.len();

    // If key is provided in magnet or active vault key exists, try to download and decrypt manifest from peers/vaults
    let possible_keys: Vec<[u8; 32]> = {
        let mut keys = Vec::new();
        if let Some(ref key_str) = info.key {
            if let Ok(key_bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(key_str)
                .or_else(|_| base64::engine::general_purpose::STANDARD.decode(key_str))
            {
                if key_bytes.len() == 32 {
                    let mut k = [0u8; 32];
                    k.copy_from_slice(&key_bytes);
                    keys.push(k);
                }
            }
        }
        // Fallback to active vault master key if cached
        let vault_id = state.db.get_setting("active_vault_id").unwrap_or_default();
        if !vault_id.is_empty() {
            let lock = state.key_cache.lock().unwrap();
            for (k, v) in lock.iter() {
                if k.starts_with(&vault_id) && !keys.contains(v) {
                    keys.push(*v);
                }
            }
        }
        keys
    };

    if !possible_keys.is_empty() {
        if let Ok(client) = get_drive_client(&state.db).await {
            let manifest_name = format!("meta_{}.enc", info.package_id);
            let mut search_folders = peers.clone();

            // Also search in current vault targets if available
            let vault_id = state.db.get_setting("active_vault_id").unwrap_or_default();
            if let Ok(Some(vault)) = state.db.get_vault(&vault_id) {
                for t in vault.targets {
                    if !search_folders.contains(&t.target_id) {
                        search_folders.push(t.target_id);
                    }
                }
            }

            for folder_id in &search_folders {
                // Check folder_id itself (could be public package folder), or subfolder paths
                let mut meta_folder_candidates = vec![folder_id.clone()];
                if let Ok(Some(magdrive_dir)) = client.find_subfolder(folder_id, ".magdrive").await {
                    if let Ok(Some(pkgs_dir)) = client.find_subfolder(&magdrive_dir, "packages").await {
                        if let Ok(Some(pkg_dir)) = client.find_subfolder(&pkgs_dir, &info.package_id).await {
                            meta_folder_candidates.push(pkg_dir);
                        }
                    }
                    if let Ok(Some(meta_dir)) = client.find_subfolder(&magdrive_dir, "metadata").await {
                        meta_folder_candidates.push(meta_dir);
                    }
                }

                for meta_dir in meta_folder_candidates {
                    if let Ok(files) = client.list_files_in_folder(&meta_dir).await {
                        for f in files {
                            if f.name == manifest_name || f.name == "meta.enc" {
                                if let Ok(enc_data) = client.download_file(&f.id).await {
                                    for key in &possible_keys {
                                        if let Ok(manifest) = PackageManifest::decrypt(&enc_data, key) {
                                            let v_id = state.db.get_setting("active_vault_id").unwrap_or_else(|| "default_vault".to_string());
                                            let _ = state.db.upsert_package(&v_id, &manifest);
                                            return Ok(SwarmResolveResult {
                                                package_id: manifest.package_id,
                                                name: manifest.name,
                                                total_size: manifest.total_size,
                                                peer_count,
                                                sources: peers,
                                                trackers: tracker_list,
                                                is_local: false,
                                                key: info.key,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(SwarmResolveResult {
        package_id: info.package_id,
        name: info.name.unwrap_or_else(|| "Unknown File".to_string()),
        total_size: info.total_bytes.unwrap_or(0),
        peer_count,
        sources: peers,
        trackers: tracker_list,
        is_local: false,
        key: info.key,
    })
}

#[tauri::command]
pub async fn copy_shards_to_my_drive(
    app: AppHandle,
    state: State<'_, AppState>,
    package_id: String,
    opt_in_seeding: bool,
) -> Result<String, String> {
    let pkg = match state.db.get_package(&package_id).map_err(|e| e.to_string())? {
        Some(p) => p,
        None => {
            // Fallback: Check if we can sync or find the manifest from connected trackers/targets
            let topic = calculate_blind_topic(&package_id);
            let trackers = get_tracker_urls_from_db(&state.db);
            let peers = fetch_peers_multi(&trackers, &topic).await;

            let vault_id = state
                .db
                .get_setting("active_vault_id")
                .unwrap_or_else(|| "default_vault".to_string());

            let mut resolved = None;
            if let Ok(client) = get_drive_client(&state.db).await {
                let manifest_name = format!("meta_{}.enc", package_id);
                let mut search_folders = peers;

                if let Ok(Some(vault)) = state.db.get_vault(&vault_id) {
                    for t in vault.targets {
                        if !search_folders.contains(&t.target_id) {
                            search_folders.push(t.target_id);
                        }
                    }
                }

                // Check active vault keys
                let mut candidate_keys = Vec::new();
                {
                    let lock = state.key_cache.lock().unwrap();
                    for (k, v) in lock.iter() {
                        if k.starts_with(&vault_id) {
                            candidate_keys.push(*v);
                        }
                    }
                }

                'search: for folder_id in search_folders {
                    let mut meta_candidates = vec![folder_id.clone()];
                    if let Ok(Some(magdrive_dir)) = client.find_subfolder(&folder_id, ".magdrive").await {
                        if let Ok(Some(meta_dir)) = client.find_subfolder(&magdrive_dir, "metadata").await {
                            meta_candidates.push(meta_dir);
                        }
                    }

                    for m_dir in meta_candidates {
                        if let Ok(files) = client.list_files_in_folder(&m_dir).await {
                            for f in files {
                                if f.name == manifest_name {
                                    if let Ok(enc_data) = client.download_file(&f.id).await {
                                        for k in &candidate_keys {
                                            if let Ok(manifest) = PackageManifest::decrypt(&enc_data, k) {
                                                let _ = state.db.upsert_package(&vault_id, &manifest);
                                                resolved = Some(manifest);
                                                break 'search;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            resolved.ok_or_else(|| {
                "Package not found in local catalog. Please ensure the magnet link includes the master encryption key (&k=) or sync catalog first.".to_string()
            })?
        }
    };

    let vault_id = state
        .db
        .get_setting("active_vault_id")
        .ok_or("No active vault selected.")?;
    let vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Active vault not found.")?;

    if vault.targets.is_empty() {
        return Err("Active vault has no storage targets configured.".into());
    }

    let client = get_drive_client(&state.db).await?;
    let targets = &vault.targets;
    let num_targets = targets.len();

    // Ensure .magdrive and isolated package folders exist across all configured vault targets
    let mut resolved_chunks_dirs = Vec::new();
    let mut resolved_magdrive_dirs = Vec::new();
    for target in targets {
        let magdrive_dir = ensure_cached_folder(&client, &state.folder_cache, &target.target_id, ".magdrive").await?;
        let pkg_dir = ensure_cached_package_folder(&client, &state.folder_cache, &target.target_id, &package_id).await?;
        resolved_magdrive_dirs.push(magdrive_dir);
        resolved_chunks_dirs.push(pkg_dir);
    }

    let mut chunk_refs = Vec::new();
    for stripe in &pkg.stripes {
        for chunk in &stripe.chunks {
            chunk_refs.push(chunk.clone());
        }
    }

    let total_chunks = chunk_refs.len();
    let transfer_id = format!("cp_{}", Uuid::new_v4().simple());
    let dest_label = if num_targets == 1 {
        format!("Google Drive: {}", targets[0].label)
    } else {
        format!("Google Drive: {} targets (Balanced)", num_targets)
    };
    let record = TransferRecord {
        id: transfer_id.clone(),
        package_id: package_id.clone(),
        name: pkg.name.clone(),
        transfer_type: "copy".to_string(),
        total_bytes: pkg.total_size,
        transferred_bytes: 0,
        status: "transferring".to_string(),
        error_message: None,
        destination_path: Some(dest_label.clone()),
        updated_at: chrono::Utc::now().timestamp(),
    };
    let _ = state.db.upsert_transfer(&record);

    let _ = app.emit(
        "transfer-progress",
        serde_json::json!({
            "package_id": package_id,
            "transfer_id": transfer_id,
            "stage": "copying",
            "current_shard": 0,
            "total_shards": total_chunks,
            "transferred": 0,
            "transferred_bytes": 0,
            "total": pkg.total_size,
            "total_bytes": pkg.total_size,
            "speed_bps": 0,
            "eta_seconds": 0,
            "target_label": format!("Server-side copying to {}", dest_label),
            "status": "transferring"
        }),
    );

    let mut copied_count = 0;
    // Map sha256 -> (new_file_id, chosen_target_id)
    let mut new_file_mapping: HashMap<String, (String, String)> = HashMap::new();

    for (idx, chunk) in chunk_refs.iter().enumerate() {
        let target_idx = chunk.shard_index % num_targets;
        let chosen_target = &targets[target_idx];
        let chunks_dir = &resolved_chunks_dirs[target_idx];

        let chunk_file_name = format!("chunk_{}_{}.bin", package_id, chunk.sha256);
        let copy_res = client
            .copy_file(&chunk.file_id, chunks_dir, Some(&chunk_file_name))
            .await;

        match copy_res {
            Ok(created_item) => {
                copied_count += 1;
                new_file_mapping.insert(chunk.sha256.clone(), (created_item.id, chosen_target.target_id.clone()));
                let transferred = if total_chunks > 0 {
                    (pkg.total_size * copied_count as u64) / total_chunks as u64
                } else {
                    0
                };

                let _ = app.emit(
                    "transfer-progress",
                    serde_json::json!({
                        "package_id": package_id,
                        "transfer_id": transfer_id,
                        "stage": "copying",
                        "current_shard": copied_count,
                        "total_shards": total_chunks,
                        "transferred": transferred,
                        "transferred_bytes": transferred,
                        "total": pkg.total_size,
                        "total_bytes": pkg.total_size,
                        "speed_bps": 0,
                        "eta_seconds": 0,
                        "target_label": format!("Copied shard {}/{} to {}...", copied_count, total_chunks, chosen_target.label),
                        "status": "transferring"
                    }),
                );
            }
            Err(e) => {
                let err_msg = format!("Failed to copy shard {}: {}", idx, e);
                let _ = state.db.update_transfer_status(&transfer_id, "failed", Some(&err_msg));
                return Err(err_msg);
            }
        }
    }

    // Clone and update manifest with newly copied local chunk file IDs and balanced target IDs
    let mut updated_manifest = pkg.clone();
    for stripe in &mut updated_manifest.stripes {
        for chunk in &mut stripe.chunks {
            if let Some((new_id, new_target_id)) = new_file_mapping.get(&chunk.sha256) {
                chunk.file_id = new_id.clone();
                chunk.target_id = new_target_id.clone();
            }
        }
    }

    // Save updated manifest in local database
    let _ = state.db.upsert_package(&vault_id, &updated_manifest);

    // Resolve vault master key to re-encrypt manifest into all targets' .magdrive/metadata/
    let master_key_opt = {
        let lock = state.key_cache.lock().unwrap();
        lock.get(&vault.id).copied().or_else(|| {
            lock.iter()
                .find(|(k, _)| k.starts_with(&vault.id))
                .map(|(_, val)| *val)
        })
    };

    if let Some(mk) = master_key_opt {
        if let Ok(meta_bytes) = updated_manifest.encrypt(&mk) {
            let meta_file_name = format!("meta_{}.enc", package_id);
            for (idx, _target) in targets.iter().enumerate() {
                // 1. Private metadata folder (for internal sync)
                if let Some(magdrive_dir) = resolved_magdrive_dirs.get(idx) {
                    if let Ok(meta_dir) = ensure_cached_folder(&client, &state.folder_cache, magdrive_dir, "metadata").await {
                        let _ = client.upload_file(&meta_dir, &meta_file_name, &meta_bytes).await;
                    }
                }
                // 2. Public package folder (for magnet downloads)
                if let Some(pkg_dir) = resolved_chunks_dirs.get(idx) {
                    let _ = client.upload_file(pkg_dir, "meta.enc", &meta_bytes).await;
                }
            }
        }
    }

    if opt_in_seeding {
        // Collect unique package folder IDs that store shards
        let mut seeded_pkg_folders = HashSet::new();
        for (idx, _) in targets.iter().enumerate() {
            if let Some(pkg_dir) = resolved_chunks_dirs.get(idx) {
                seeded_pkg_folders.insert(pkg_dir.clone());
            }
        }

        let trackers = get_tracker_urls_from_db(&state.db);
        let topic = calculate_blind_topic(&package_id);

        for pkg_folder_id in seeded_pkg_folders {
            let trackers_clone = trackers.clone();
            let topic_clone = topic.clone();
            tokio::spawn(async move {
                announce_to_trackers(&trackers_clone, &topic_clone, &pkg_folder_id, false).await;
            });
        }
    }

    let _ = state.db.update_transfer_status(&transfer_id, "completed", None);
    let _ = app.emit(
        "transfer-progress",
        serde_json::json!({
            "package_id": package_id,
            "transfer_id": transfer_id,
            "stage": "completed",
            "current_shard": total_chunks,
            "total_shards": total_chunks,
            "transferred": pkg.total_size,
            "transferred_bytes": pkg.total_size,
            "total": pkg.total_size,
            "total_bytes": pkg.total_size,
            "speed_bps": 0,
            "eta_seconds": 0,
            "status": "completed"
        }),
    );

    Ok(format!("Successfully copied all {} shards to {}", total_chunks, dest_label))
}

#[tauri::command]
pub async fn get_tracker_settings(
    state: State<'_, AppState>,
) -> Result<TrackerSettings, String> {
    let trackers = get_tracker_urls_from_db(&state.db);
    let default_seeding = state
        .db
        .get_setting("opt_in_seeding_default")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    Ok(TrackerSettings {
        trackers,
        default_seeding,
    })
}

#[tauri::command]
pub async fn save_tracker_settings(
    state: State<'_, AppState>,
    trackers: Vec<String>,
    default_seeding: bool,
) -> Result<(), String> {
    let json_str = serde_json::to_string(&trackers).map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("tracker_urls", &json_str)
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("opt_in_seeding_default", if default_seeding { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    Ok(())
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

    // Attempt to delete chunk files and metadata manifest from cloud targets
    if let Ok(client) = get_drive_client(&state.db).await {
        for stripe in &pkg.stripes {
            for chunk in &stripe.chunks {
                let _ = client.delete_file(&chunk.file_id).await;
            }
        }

        // Clean up meta_<package_id>.enc in .magdrive/metadata/ across all active vault targets
        let vault_id = state.db.get_setting("active_vault_id").unwrap_or_default();
        if let Ok(Some(vault)) = state.db.get_vault(&vault_id) {
            let manifest_name = format!("meta_{}.enc", package_id);
            for target in &vault.targets {
                if let Ok(Some(magdrive_dir)) = client.find_subfolder(&target.target_id, ".magdrive").await {
                    if let Ok(Some(meta_dir)) = client.find_subfolder(&magdrive_dir, "metadata").await {
                        if let Ok(files) = client.list_files_in_folder(&meta_dir).await {
                            for f in files {
                                if f.name == manifest_name {
                                    let _ = client.delete_file(&f.id).await;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Report dead to swarm trackers so node is deregistered
    let trackers = get_tracker_urls_from_db(&state.db);
    let topic = calculate_blind_topic(&package_id);
    let vault_id = state.db.get_setting("active_vault_id").unwrap_or_default();
    if let Ok(Some(vault)) = state.db.get_vault(&vault_id) {
        for target in vault.targets {
            let t_id = target.target_id.clone();
            let tr_clone = trackers.clone();
            let top_clone = topic.clone();
            tokio::spawn(async move {
                report_dead_multi(&tr_clone, &top_clone, &t_id).await;
            });
        }
    }

    Ok(())
}

// ----------------------------------------------------
// Transfer & File Pipeline Commands
// ----------------------------------------------------

struct UploadProgressNotifier {
    app: AppHandle,
    db: Database,
    transfer_id: String,
    total_size: u64,
    total_shards: usize,
    start_instant: std::time::Instant,
    uploaded_shards_count: AtomicUsize,
    transferred_cloud_bytes: AtomicU64,
}

impl UploadProgressNotifier {
    pub fn new(
        app: AppHandle,
        db: Database,
        transfer_id: String,
        total_size: u64,
        total_shards: usize,
    ) -> Self {
        Self {
            app,
            db,
            transfer_id,
            total_size,
            total_shards,
            start_instant: std::time::Instant::now(),
            uploaded_shards_count: AtomicUsize::new(0),
            transferred_cloud_bytes: AtomicU64::new(0),
        }
    }

    pub fn record_shard_uploaded(&self, shard_len: u64, target_label: &str) {
        let shards_done = self.uploaded_shards_count.fetch_add(1, Ordering::SeqCst) + 1;
        let cloud_bytes = self.transferred_cloud_bytes.fetch_add(shard_len, Ordering::SeqCst) + shard_len;

        let elapsed_secs = self.start_instant.elapsed().as_secs_f64().max(0.05);
        let speed_bps = (cloud_bytes as f64 / elapsed_secs) as u64;

        let progress_ratio = (shards_done as f64 / self.total_shards.max(1) as f64).min(1.0);
        let transferred_bytes = (self.total_size as f64 * progress_ratio) as u64;
        let remaining_bytes = self.total_size.saturating_sub(transferred_bytes);
        let eta_seconds = if speed_bps > 0 { remaining_bytes / speed_bps.max(1) } else { 0 };

        let _ = self.app.emit("transfer-progress", serde_json::json!({
            "transfer_id": self.transfer_id,
            "stage": "uploading_shards",
            "current_shard": shards_done,
            "total_shards": self.total_shards,
            "transferred": transferred_bytes,
            "transferred_bytes": transferred_bytes,
            "total": self.total_size,
            "total_bytes": self.total_size,
            "speed_bps": speed_bps,
            "eta_seconds": eta_seconds,
            "target_label": target_label,
            "status": "transferring"
        }));

        if let Ok(Some(mut tx)) = self.db.get_transfer(&self.transfer_id) {
            tx.transferred_bytes = transferred_bytes;
            tx.updated_at = chrono::Utc::now().timestamp();
            let _ = self.db.upsert_transfer(&tx);
        }
    }
}

async fn process_stripe_task(
    s_idx: usize,
    stripe_data: Vec<u8>,
    data_shards: usize,
    parity_shards: usize,
    key: [u8; 32],
    package_id: String,
    targets: Vec<VaultTarget>,
    resolved_chunks_dirs: Vec<String>,
    clients: Vec<DriveClient>,
    progress: Arc<UploadProgressNotifier>,
    uploaded_cloud_ids: Option<Arc<Mutex<Vec<String>>>>,
) -> Result<Stripe, String> {
    // 1. Reed-Solomon encoding in blocking thread
    let shards = tokio::task::spawn_blocking(move || {
        let (encoded_shards, _) = encode(&stripe_data, data_shards, parity_shards)
            .map_err(|e| e.to_string())?;
        Ok::<_, String>(encoded_shards)
    })
    .await
    .map_err(|e| format!("Encode join error: {}", e))??;

    // 2. Parallel AES-256-GCM encryption + SHA256 per shard across CPU cores
    let mut crypto_futures = Vec::new();
    for (shard_idx, shard) in shards.into_iter().enumerate() {
        let key_clone = key;
        let pkg_id_clone = package_id.clone();
        crypto_futures.push(tokio::task::spawn_blocking(move || {
            let encrypted = encrypt_chunk(&shard, &key_clone).map_err(|e| e.to_string())?;
            let sha = compute_sha256(&encrypted);
            let file_name = format!("chunk_{}_{}.bin", pkg_id_clone, sha);
            Ok::<_, String>((shard_idx, encrypted, sha, file_name))
        }));
    }

    let crypto_results_raw = futures::future::join_all(crypto_futures).await;
    let mut crypto_results = Vec::new();
    for res in crypto_results_raw {
        let item = res.map_err(|e| format!("Crypto task join error: {}", e))??;
        crypto_results.push(item);
    }

    // 3. Upload all shards of this stripe concurrently across targets
    let mut shard_futures = Vec::new();
    for (shard_idx, encrypted_shard, shard_sha, chunk_file_name) in crypto_results {
        let target_idx = (s_idx + shard_idx) % targets.len();
        let target = targets[target_idx].clone();
        let chunks_sub = resolved_chunks_dirs[target_idx].clone();
        let client_clone = clients[target_idx].clone();
        let shard_len = encrypted_shard.len() as u64;
        let progress_clone = progress.clone();
        let uploaded_ids_clone = uploaded_cloud_ids.clone();

        shard_futures.push(async move {
            let fid = client_clone
                .upload_file(&chunks_sub, &chunk_file_name, &encrypted_shard)
                .await
                .map_err(|e| e.to_string())?;

            if let Some(ref ids) = uploaded_ids_clone {
                let mut lock = ids.lock().unwrap();
                lock.push(fid.clone());
            }

            progress_clone.record_shard_uploaded(shard_len, &target.label);

            Ok::<_, String>((shard_idx, target.target_id, fid, shard_sha))
        });
    }

    let results = futures::future::join_all(shard_futures).await;
    let mut chunk_refs = Vec::new();

    for res in results {
        let (shard_idx, target_id, uploaded_file_id, shard_sha) = res?;
        chunk_refs.push(ChunkRef {
            shard_index: shard_idx,
            target_id,
            file_id: uploaded_file_id,
            sha256: shard_sha,
        });
    }

    chunk_refs.sort_by_key(|c| c.shard_index);

    Ok(Stripe {
        stripe_index: s_idx,
        chunks: chunk_refs,
    })
}

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
    let master_key = get_or_derive_master_key(&state.key_cache, &vault.id, &pass, &salt)?;

    // Generate isolated random 32-byte key specifically for this package
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);

    // Wrap/encrypt package_key with master_key for local storage
    let wrapped_package_key = encrypt_chunk(&key, &master_key).map_err(|e| e.to_string())?;
    let wrapped_key_b64 = base64::engine::general_purpose::STANDARD.encode(&wrapped_package_key);

    let uploader_pubkey = state.keypair.lock().unwrap().public_key_hex();

    // Determine Reed-Solomon scheme based on target count
    let (data_shards, parity_shards) = calculate_adaptive_erasure_schema(vault.targets.len());

    let clients = get_drive_clients_for_targets(&state.db, &vault.targets).await?;

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
        destination_path: None,
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

    // Pre-resolve and cache isolated package folders for all targets concurrently
    let mut chunks_dir_futures = Vec::new();
    let pkg_id_for_dirs = package_id.clone();
    for (t_idx, target) in vault.targets.iter().enumerate() {
        let client_clone = clients[t_idx].clone();
        let target_id = target.target_id.clone();
        let cache = state.folder_cache.clone();
        let pkg_id_clone = pkg_id_for_dirs.clone();
        chunks_dir_futures.push(async move {
            let pkg_dir = ensure_cached_package_folder(&client_clone, &cache, &target_id, &pkg_id_clone).await?;
            Ok::<String, String>(pkg_dir)
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

    let progress = Arc::new(UploadProgressNotifier::new(
        app.clone(),
        state.db.clone(),
        transfer_id.clone(),
        total_size,
        total_shards,
    ));

    let concurrency = if num_stripes > 1 { 2 } else { 1 };
    let raw_bytes_arc = Arc::new(raw_bytes);
    let pkg_id_for_stream = package_id.clone();
    let mut stripe_stream = futures::stream::iter(0..num_stripes)
        .map(|s_idx| {
            let start = s_idx * chunk_size;
            let end = (start + chunk_size).min(raw_bytes_arc.len());
            let stripe_data = raw_bytes_arc[start..end].to_vec();

            let clients_clone = clients.clone();
            let targets_clone = vault.targets.clone();
            let dirs_clone = resolved_chunks_dirs.clone();
            let progress_clone = progress.clone();
            let pkg_id_clone = pkg_id_for_stream.clone();

            async move {
                process_stripe_task(
                    s_idx,
                    stripe_data,
                    data_shards,
                    parity_shards,
                    key,
                    pkg_id_clone,
                    targets_clone,
                    dirs_clone,
                    clients_clone,
                    progress_clone,
                    None,
                )
                .await
            }
        })
        .buffer_unordered(concurrency);

    let mut stripes = Vec::with_capacity(num_stripes);
    while let Some(res) = stripe_stream.next().await {
        let stripe = res?;
        stripes.push(stripe);
    }

    stripes.sort_by_key(|s| s.stripe_index);

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

    // Encrypt and upload metadata manifest to all targets in parallel:
    // 1) Private .magdrive/metadata/meta_<package_id>.enc for fast internal vault sync
    // 2) Public package folder .magdrive/packages/<package_id>/meta.enc for magnet downloads
    let encrypted_manifest = manifest.encrypt(&key).map_err(|e| e.to_string())?;
    let meta_file_name = format!("meta_{}.enc", package_id);

    let mut manifest_futures = Vec::new();
    for (t_idx, target) in vault.targets.iter().enumerate() {
        let client_clone = clients[t_idx].clone();
        let target_id = target.target_id.clone();
        let m_name = meta_file_name.clone();
        let m_bytes = encrypted_manifest.clone();
        let pkg_id_clone = package_id.clone();
        let cache = state.folder_cache.clone();

        manifest_futures.push(async move {
            // 1. Private metadata directory (for vault owner sync)
            if let Ok(magdrive_dir) = ensure_cached_folder(&client_clone, &cache, &target_id, ".magdrive").await {
                if let Ok(meta_dir) = ensure_cached_folder(&client_clone, &cache, &magdrive_dir, "metadata").await {
                    let _ = client_clone.upload_file(&meta_dir, &m_name, &m_bytes).await;
                }
            }
            // 2. Package directory (for magnet downloads)
            if let Ok(pkg_dir) = ensure_cached_package_folder(&client_clone, &cache, &target_id, &pkg_id_clone).await {
                let _ = client_clone.upload_file(&pkg_dir, "meta.enc", &m_bytes).await;
            }
        });
    }
    futures::future::join_all(manifest_futures).await;

    // Save to local SQLite
    state.db.upsert_package(&vault_id, &manifest).map_err(|e| e.to_string())?;
    let _ = state.db.set_package_key_enc(&package_id, &wrapped_key_b64);

    // Announce package folders to swarm trackers
    let trackers = get_tracker_urls_from_db(&state.db);
    let topic = calculate_blind_topic(&package_id);
    for (t_idx, target) in vault.targets.iter().enumerate() {
        let pkg_folder_id = resolved_chunks_dirs.get(t_idx).cloned().unwrap_or_else(|| target.target_id.clone());
        let tr_clone = trackers.clone();
        let top_clone = topic.clone();
        tokio::spawn(async move {
            announce_to_trackers(&tr_clone, &top_clone, &pkg_folder_id, true).await;
        });
    }

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
        destination_path: None,
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

async fn download_and_reconstruct_stripe(
    s_idx: usize,
    stripe: Stripe,
    total_stripes: usize,
    client: DriveClient,
    key: [u8; 32],
    schema: ErasureSchema,
    total_size: u64,
    chunk_size: usize,
    app: AppHandle,
    package_id: String,
    transfer_id: String,
    db: Database,
    completed_shards: Arc<AtomicUsize>,
    total_required_shards: usize,
    start_time: std::time::Instant,
) -> Result<Vec<u8>, String> {
    // Check if transfer was cancelled
    if let Ok(Some(tx)) = db.get_transfer(&transfer_id) {
        if tx.status == "cancelled" {
            return Err("Download cancelled by user.".into());
        }
    }

    let total_shards = schema.data_shards + schema.parity_shards;
    let needed_shards = schema.data_shards;
    let mut available_shards: Vec<Option<Vec<u8>>> = vec![None; total_shards];

    let mut futures = futures::stream::FuturesUnordered::new();
    for chunk in stripe.chunks {
        if chunk.shard_index < total_shards {
            let client_clone = client.clone();
            let file_id = chunk.file_id;
            let shard_idx = chunk.shard_index;
            let key_clone = key;
            futures.push(async move {
                let res = client_clone.download_file(&file_id).await;
                match res {
                    Ok(encrypted_bytes) => {
                        let dec_res = tokio::task::spawn_blocking(move || {
                            decrypt_chunk(&encrypted_bytes, &key_clone)
                        })
                        .await;

                        match dec_res {
                            Ok(Ok(decrypted)) => Ok((shard_idx, decrypted)),
                            Ok(Err(e)) => Err(format!("Decryption error on shard {}: {}", shard_idx, e)),
                            Err(e) => Err(format!("Task error on shard {}: {}", shard_idx, e)),
                        }
                    }
                    Err(e) => Err(format!("Download error on shard {}: {}", shard_idx, e)),
                }
            });
        }
    }

    let mut valid_count = 0;
    while let Some(res) = futures.next().await {
        // Check cancellation mid-flight
        if let Ok(Some(tx)) = db.get_transfer(&transfer_id) {
            if tx.status == "cancelled" {
                return Err("Download cancelled by user.".into());
            }
        }

        match res {
            Ok((shard_idx, decrypted_shard)) => {
                available_shards[shard_idx] = Some(decrypted_shard);
                valid_count += 1;

                let completed = completed_shards.fetch_add(1, Ordering::Relaxed) + 1;
                let elapsed_secs = start_time.elapsed().as_secs_f64();
                let est_transferred = if total_required_shards > 0 {
                    ((total_size as f64 * (completed as f64 / total_required_shards as f64)) as u64)
                        .min(total_size)
                } else {
                    0
                };
                let speed_bps = if elapsed_secs > 0.05 {
                    (est_transferred as f64 / elapsed_secs) as u64
                } else {
                    0
                };
                let remaining_bytes = total_size.saturating_sub(est_transferred);
                let eta_seconds = if speed_bps > 0 {
                    (remaining_bytes as f64 / speed_bps as f64).ceil() as u64
                } else {
                    0
                };

                let _ = app.emit(
                    "transfer-progress",
                    serde_json::json!({
                        "package_id": package_id,
                        "transfer_id": transfer_id,
                        "stage": "downloading",
                        "current_shard": completed,
                        "total_shards": total_required_shards,
                        "transferred": est_transferred,
                        "transferred_bytes": est_transferred,
                        "total": total_size,
                        "total_bytes": total_size,
                        "speed_bps": speed_bps,
                        "eta_seconds": eta_seconds,
                        "target_label": format!("Downloading shard {}/{} (Stripe {}/{})...", completed, total_required_shards, s_idx + 1, total_stripes),
                        "status": "transferring"
                    }),
                );

                // Early completion: once we have collected needed_shards, stop immediately and drop remaining requests
                if valid_count >= needed_shards {
                    break;
                }
            }
            Err(err_msg) => {
                eprintln!("Shard download warning: {}", err_msg);
            }
        }
    }

    if valid_count < needed_shards {
        let err_msg = format!(
            "Insufficient shards for stripe {}: obtained {}/{} (requires at least {} data shards)",
            s_idx + 1, valid_count, total_shards, needed_shards
        );
        let _ = db.update_transfer_status(&transfer_id, "failed", Some(&err_msg));
        let _ = app.emit(
            "transfer-progress",
            serde_json::json!({
                "package_id": package_id,
                "transfer_id": transfer_id,
                "stage": "downloading",
                "status": "failed",
                "error_message": &err_msg,
                "total": total_size,
            }),
        );
        return Err(err_msg);
    }

    let stripe_len = if s_idx == total_stripes - 1 {
        let rem = (total_size as usize) % chunk_size;
        if rem == 0 {
            chunk_size
        } else {
            rem
        }
    } else {
        chunk_size
    };

    let data_shards = schema.data_shards;
    let parity_shards = schema.parity_shards;
    let reconstructed = tokio::task::spawn_blocking(move || {
        reconstruct(
            &mut available_shards,
            data_shards,
            parity_shards,
            stripe_len,
        )
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
    .map_err(|e| {
        let err_msg = format!("Failed to reconstruct stripe {}: {}", s_idx, e);
        let _ = db.update_transfer_status(&transfer_id, "failed", Some(&err_msg));
        let _ = app.emit(
            "transfer-progress",
            serde_json::json!({
                "package_id": package_id,
                "transfer_id": transfer_id,
                "stage": "downloading",
                "status": "failed",
                "error_message": &err_msg,
                "total": total_size,
            }),
        );
        err_msg
    })?;

    Ok(reconstructed)
}

#[tauri::command]
pub async fn download_package(
    app: AppHandle,
    state: State<'_, AppState>,
    package_id: String,
    destination_path: String,
    passphrase: Option<String>,
) -> Result<DownloadResult, String> {
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

    let key = if let Some(ref p) = passphrase {
        if let Ok(decoded) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p) {
            if decoded.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&decoded);
                k
            } else {
                let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
                get_or_derive_master_key(&state.key_cache, &vault.id, p, &salt)?
            }
        } else if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(p) {
            if decoded.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&decoded);
                k
            } else {
                let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
                get_or_derive_master_key(&state.key_cache, &vault.id, p, &salt)?
            }
        } else {
            let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
            get_or_derive_master_key(&state.key_cache, &vault.id, p, &salt)?
        }
    } else {
        let salt = hex::decode(&vault.salt_hex).map_err(|e| e.to_string())?;
        let master_key = get_or_derive_master_key(&state.key_cache, &vault.id, "magdrive", &salt)?;

        // Try unwrapping package-specific key from db
        if let Ok(Some(enc_hex)) = state.db.get_package_key_enc(&package_id) {
            if let Ok(raw_enc) = base64::engine::general_purpose::STANDARD.decode(&enc_hex) {
                if let Ok(unwrapped) = decrypt_chunk(&raw_enc, &master_key) {
                    if unwrapped.len() == 32 {
                        let mut k = [0u8; 32];
                        k.copy_from_slice(&unwrapped);
                        k
                    } else {
                        master_key
                    }
                } else {
                    master_key
                }
            } else {
                master_key
            }
        } else {
            master_key
        }
    };

    let client = get_drive_client(&state.db).await?;

    let dest_path = std::path::PathBuf::from(&destination_path);
    if let Some(parent) = dest_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    let mut dest_file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&dest_path)
        .await
        .map_err(|e| format!("Failed to open destination file {}: {}", destination_path, e))?;

    let transfer_id = format!("dl_{}", Uuid::new_v4().simple());
    let record = TransferRecord {
        id: transfer_id.clone(),
        package_id: package_id.clone(),
        name: pkg.name.clone(),
        transfer_type: "download".to_string(),
        total_bytes: pkg.total_size,
        transferred_bytes: 0,
        status: "transferring".to_string(),
        error_message: None,
        destination_path: Some(destination_path.clone()),
        updated_at: chrono::Utc::now().timestamp(),
    };
    let _ = state.db.upsert_transfer(&record);

    let total_stripes = pkg.stripes.len();
    let needed_shards_per_stripe = pkg.erasure_schema.data_shards;
    let total_required_shards = total_stripes * needed_shards_per_stripe;
    let total_required_shards = if total_required_shards == 0 { 1 } else { total_required_shards };

    // Emit initial starting event immediately so frontend knows download has begun
    let _ = app.emit(
        "transfer-progress",
        serde_json::json!({
            "package_id": package_id,
            "transfer_id": transfer_id,
            "stage": "downloading",
            "current_shard": 0,
            "total_shards": total_required_shards,
            "transferred": 0,
            "transferred_bytes": 0,
            "total": pkg.total_size,
            "total_bytes": pkg.total_size,
            "speed_bps": 0,
            "eta_seconds": 0,
            "target_label": "Connecting to storage nodes...",
            "status": "transferring"
        }),
    );

    let completed_shards = Arc::new(AtomicUsize::new(0));
    let start_time = std::time::Instant::now();

    let stripe_stream = futures::stream::iter(pkg.stripes.into_iter().enumerate())
        .map(|(s_idx, stripe)| {
            let client = client.clone();
            let key = key;
            let schema = pkg.erasure_schema.clone();
            let total_size = pkg.total_size;
            let chunk_size = pkg.chunk_size;
            let app = app.clone();
            let package_id = package_id.clone();
            let transfer_id = transfer_id.clone();
            let db = state.db.clone();
            let completed_shards = completed_shards.clone();

            async move {
                download_and_reconstruct_stripe(
                    s_idx,
                    stripe,
                    total_stripes,
                    client,
                    key,
                    schema,
                    total_size,
                    chunk_size,
                    app,
                    package_id,
                    transfer_id,
                    db,
                    completed_shards,
                    total_required_shards,
                    start_time,
                )
                .await
            }
        })
        .buffered(2); // Stream 2 stripes concurrently

    tokio::pin!(stripe_stream);

    let mut hasher = sha2::Sha256::new();
    let mut written_bytes: u64 = 0;

    while let Some(stripe_res) = stripe_stream.next().await {
        // Check cancellation
        if let Ok(Some(tx)) = state.db.get_transfer(&transfer_id) {
            if tx.status == "cancelled" {
                let _ = dest_file.flush().await;
                drop(dest_file);
                let _ = tokio::fs::remove_file(&dest_path).await;
                return Err("Download cancelled by user.".into());
            }
        }

        let reconstructed = match stripe_res {
            Ok(data) => data,
            Err(e) => {
                let _ = dest_file.flush().await;
                drop(dest_file);
                let _ = tokio::fs::remove_file(&dest_path).await;
                return Err(e);
            }
        };

        dest_file
            .write_all(&reconstructed)
            .await
            .map_err(|e| {
                let err_msg = format!("Failed to write stripe to destination file: {}", e);
                let _ = state.db.update_transfer_status(&transfer_id, "failed", Some(&err_msg));
                err_msg
            })?;

        hasher.update(&reconstructed);
        written_bytes += reconstructed.len() as u64;

        let _ = state
            .db
            .update_transfer_progress(&transfer_id, written_bytes);
    }

    dest_file
        .flush()
        .await
        .map_err(|e| {
            let err_msg = format!("Failed to flush destination file: {}", e);
            let _ = state.db.update_transfer_status(&transfer_id, "failed", Some(&err_msg));
            err_msg
        })?;
    drop(dest_file);

    let _ = app.emit(
        "transfer-progress",
        serde_json::json!({
            "package_id": package_id,
            "transfer_id": transfer_id,
            "stage": "verifying",
            "current_shard": total_required_shards,
            "total_shards": total_required_shards,
            "transferred": written_bytes,
            "transferred_bytes": written_bytes,
            "total": pkg.total_size,
            "total_bytes": pkg.total_size,
            "speed_bps": 0,
            "eta_seconds": 0,
            "target_label": "Verifying SHA-256 cryptographic integrity...",
            "status": "transferring"
        }),
    );

    // Verify final SHA-256 integrity
    let actual_sha = hex::encode(hasher.finalize());
    if actual_sha != pkg.original_sha256 {
        let _ = tokio::fs::remove_file(&dest_path).await;
        let err_msg = "File integrity corrupted: SHA-256 checksum mismatch.";
        let _ = state.db.update_transfer_status(&transfer_id, "failed", Some(err_msg));
        let _ = app.emit(
            "transfer-progress",
            serde_json::json!({
                "package_id": package_id,
                "transfer_id": transfer_id,
                "stage": "downloading",
                "status": "failed",
                "error_message": err_msg,
                "transferred": written_bytes,
                "total": pkg.total_size,
            }),
        );
        return Err(err_msg.into());
    }

    let _ = state
        .db
        .update_transfer_progress(&transfer_id, pkg.total_size);
    let _ = state
        .db
        .update_transfer_status(&transfer_id, "completed", None);

    let _ = app.emit(
        "transfer-progress",
        serde_json::json!({
            "package_id": package_id,
            "transfer_id": transfer_id,
            "stage": "completed",
            "current_shard": total_required_shards,
            "total_shards": total_required_shards,
            "transferred": pkg.total_size,
            "transferred_bytes": pkg.total_size,
            "total": pkg.total_size,
            "total_bytes": pkg.total_size,
            "speed_bps": 0,
            "eta_seconds": 0,
            "status": "completed",
            "destination_path": destination_path,
        }),
    );

    Ok(DownloadResult {
        destination_path: destination_path.clone(),
        total_bytes: pkg.total_size,
    })
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
        destination_path: None,
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
    let master_key = get_or_derive_master_key(&state.key_cache, &vault.id, &pass, &salt)?;

    // Generate isolated random 32-byte key specifically for this package
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);

    // Wrap/encrypt package_key with master_key for local storage
    let wrapped_package_key = encrypt_chunk(&key, &master_key).map_err(|e| e.to_string())?;
    let wrapped_key_b64 = base64::engine::general_purpose::STANDARD.encode(&wrapped_package_key);

    let uploader_pubkey = state.keypair.lock().unwrap().public_key_hex();

    let (data_shards, parity_shards) = calculate_adaptive_erasure_schema(vault.targets.len());

    let clients = get_drive_clients_for_targets(&state.db, &vault.targets).await?;
    let default_client = get_drive_client(&state.db).await?;
    let chunk_size = session.chunk_size;
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

    // Pre-resolve and cache isolated package folders for all targets concurrently
    let mut chunks_dir_futures = Vec::new();
    let pkg_id_for_dirs = package_id.clone();
    for (t_idx, target) in vault.targets.iter().enumerate() {
        let client_clone = clients[t_idx].clone();
        let target_id = target.target_id.clone();
        let cache = state.folder_cache.clone();
        let pkg_id_clone = pkg_id_for_dirs.clone();
        chunks_dir_futures.push(async move {
            let pkg_dir = ensure_cached_package_folder(&client_clone, &cache, &target_id, &pkg_id_clone).await?;
            Ok::<String, String>(pkg_dir)
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

    let uploaded_cloud_ids = Arc::new(Mutex::new(Vec::new()));
    let progress = Arc::new(UploadProgressNotifier::new(
        app.clone(),
        state.db.clone(),
        session.transfer_id.clone(),
        total_size,
        total_shards,
    ));

    let concurrency = if num_stripes > 1 { 2 } else { 1 };
    let raw_bytes_arc = Arc::new(raw_bytes);
    let pkg_id_for_stream = package_id.clone();
    let db_clone = state.db.clone();
    let transfer_id_clone = session.transfer_id.clone();

    let mut stripe_stream = futures::stream::iter(0..num_stripes)
        .map(|s_idx| {
            let is_cancelled = {
                if let Ok(Some(tx)) = db_clone.get_transfer(&transfer_id_clone) {
                    tx.status == "cancelled"
                } else {
                    false
                }
            };

            let start = s_idx * chunk_size;
            let end = (start + chunk_size).min(raw_bytes_arc.len());
            let stripe_data = raw_bytes_arc[start..end].to_vec();

            let clients_clone = clients.clone();
            let targets_clone = vault.targets.clone();
            let dirs_clone = resolved_chunks_dirs.clone();
            let progress_clone = progress.clone();
            let pkg_id_clone = pkg_id_for_stream.clone();
            let uploaded_ids_clone = uploaded_cloud_ids.clone();

            async move {
                if is_cancelled {
                    return Err("Transfer cancelled by user.".into());
                }
                process_stripe_task(
                    s_idx,
                    stripe_data,
                    data_shards,
                    parity_shards,
                    key,
                    pkg_id_clone,
                    targets_clone,
                    dirs_clone,
                    clients_clone,
                    progress_clone,
                    Some(uploaded_ids_clone),
                )
                .await
            }
        })
        .buffer_unordered(concurrency);

    let mut stripes = Vec::with_capacity(num_stripes);
    while let Some(res) = stripe_stream.next().await {
        match res {
            Ok(stripe) => stripes.push(stripe),
            Err(e) => {
                let client_clone = default_client.clone();
                let cleanup_ids = uploaded_cloud_ids.lock().unwrap().clone();
                tokio::spawn(async move {
                    for fid in cleanup_ids {
                        let _ = client_clone.delete_file(&fid).await;
                    }
                });
                let _ = state.db.update_transfer_status(&session.transfer_id, "failed", Some(&e));
                return Err(e);
            }
        }
    }

    stripes.sort_by_key(|s| s.stripe_index);

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

    // Encrypt and upload metadata manifest to all targets in parallel:
    // 1) Private .magdrive/metadata/meta_<package_id>.enc for fast internal vault sync
    // 2) Public package folder .magdrive/packages/<package_id>/meta.enc for magnet downloads
    let manifest_bytes = manifest.encrypt(&key).map_err(|e| e.to_string())?;
    let manifest_file_name = format!("meta_{}.enc", package_id);

    let mut manifest_futures = Vec::new();
    for (t_idx, target) in vault.targets.iter().enumerate() {
        let client_clone = clients[t_idx].clone();
        let target_id = target.target_id.clone();
        let m_name = manifest_file_name.clone();
        let m_bytes = manifest_bytes.clone();
        let pkg_id_clone = package_id.clone();
        let cache = state.folder_cache.clone();

        manifest_futures.push(async move {
            // 1. Private metadata directory (for vault owner sync)
            if let Ok(magdrive_dir) = ensure_cached_folder(&client_clone, &cache, &target_id, ".magdrive").await {
                if let Ok(meta_dir) = ensure_cached_folder(&client_clone, &cache, &magdrive_dir, "metadata").await {
                    let _ = client_clone.upload_file(&meta_dir, &m_name, &m_bytes).await;
                }
            }
            // 2. Package directory (for magnet downloads)
            if let Ok(pkg_dir) = ensure_cached_package_folder(&client_clone, &cache, &target_id, &pkg_id_clone).await {
                let _ = client_clone.upload_file(&pkg_dir, "meta.enc", &m_bytes).await;
            }
        });
    }
    futures::future::join_all(manifest_futures).await;

    state.db.upsert_package(&vault.id, &manifest).map_err(|e| e.to_string())?;
    let _ = state.db.set_package_key_enc(&package_id, &wrapped_key_b64);

    // Announce package folders to swarm trackers
    let trackers = get_tracker_urls_from_db(&state.db);
    let topic = calculate_blind_topic(&package_id);
    for (t_idx, target) in vault.targets.iter().enumerate() {
        let pkg_folder_id = resolved_chunks_dirs.get(t_idx).cloned().unwrap_or_else(|| target.target_id.clone());
        let tr_clone = trackers.clone();
        let top_clone = topic.clone();
        tokio::spawn(async move {
            announce_to_trackers(&tr_clone, &top_clone, &pkg_folder_id, true).await;
        });
    }

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

#[tauri::command]
pub fn get_adaptive_erasure_info(targets_count: usize) -> AdaptiveErasureInfo {
    let (data_shards, parity_shards) = calculate_adaptive_erasure_schema(targets_count);
    let total_shards = data_shards + parity_shards;
    let fault_tolerance = parity_shards;
    let overhead_percent = if data_shards > 0 {
        (parity_shards * 100) / data_shards
    } else {
        0
    };

    AdaptiveErasureInfo {
        num_targets: targets_count,
        data_shards,
        parity_shards,
        total_shards,
        fault_tolerance,
        overhead_percent,
    }
}

// ----------------------------------------------------
// Target Migration & Evacuation Engine
// ----------------------------------------------------

async fn transfer_or_reconstruct_shard(
    client: &DriveClient,
    chunk: &ChunkRef,
    stripe: &Stripe,
    pkg: &PackageManifest,
    stripe_idx: usize,
    dest_chunks_dir: &str,
    master_key: &[u8; 32],
) -> Result<(String, String), String> {
    let chunk_file_name = format!("chunk_{}_{}.bin", pkg.package_id, chunk.sha256);

    // Attempt 1: Fast Google Drive server-side copy
    if let Ok(copied) = client
        .copy_file(&chunk.file_id, dest_chunks_dir, Some(&chunk_file_name))
        .await
    {
        return Ok((copied.id, "copied".to_string()));
    }

    // Attempt 2: Direct download & upload relay
    if let Ok(downloaded_bytes) = client.download_file(&chunk.file_id).await {
        if let Ok(uploaded_id) = client
            .upload_file(dest_chunks_dir, &chunk_file_name, &downloaded_bytes)
            .await
        {
            return Ok((uploaded_id, "relayed".to_string()));
        }
    }

    // Attempt 3: Reed-Solomon reconstruct & re-encode from surviving shards
    let schema = &pkg.erasure_schema;
    let total_shards = schema.data_shards + schema.parity_shards;
    let mut available_shards: Vec<Option<Vec<u8>>> = vec![None; total_shards];

    let mut dl_futures = futures::stream::FuturesUnordered::new();
    for other_chunk in &stripe.chunks {
        if other_chunk.file_id != chunk.file_id && other_chunk.shard_index < total_shards {
            let client_clone = client.clone();
            let f_id = other_chunk.file_id.clone();
            let s_idx = other_chunk.shard_index;
            let key_clone = *master_key;
            dl_futures.push(async move {
                if let Ok(enc_bytes) = client_clone.download_file(&f_id).await {
                    if let Ok(dec) = decrypt_chunk(&enc_bytes, &key_clone) {
                        return Some((s_idx, dec));
                    }
                }
                None
            });
        }
    }

    while let Some(res) = dl_futures.next().await {
        if let Some((s_idx, dec)) = res {
            available_shards[s_idx] = Some(dec);
        }
    }

    let present_count = available_shards.iter().filter(|s| s.is_some()).count();
    if present_count < schema.data_shards {
        return Err(format!(
            "Cannot reconstruct shard {}: insufficient surviving shards (have {}, need {})",
            chunk.shard_index, present_count, schema.data_shards
        ));
    }

    let total_stripes = pkg.stripes.len();
    let stripe_len = if stripe_idx == total_stripes - 1 {
        let rem = (pkg.total_size as usize) % pkg.chunk_size;
        if rem == 0 {
            pkg.chunk_size
        } else {
            rem
        }
    } else {
        pkg.chunk_size
    };

    let data_shards = schema.data_shards;
    let parity_shards = schema.parity_shards;
    let reconstructed_plain = reconstruct(
        &mut available_shards,
        data_shards,
        parity_shards,
        stripe_len,
    )
    .map_err(|e| format!("Reconstruction error: {}", e))?;

    let (all_encoded_shards, _) = encode(&reconstructed_plain, data_shards, parity_shards)
        .map_err(|e| format!("Re-encoding error: {}", e))?;

    if chunk.shard_index >= all_encoded_shards.len() {
        return Err(format!("Shard index {} out of range", chunk.shard_index));
    }

    let missing_shard_data = &all_encoded_shards[chunk.shard_index];
    let encrypted_shard = encrypt_chunk(missing_shard_data, master_key)
        .map_err(|e| format!("Encryption error: {}", e))?;

    let uploaded_id = client
        .upload_file(dest_chunks_dir, &chunk_file_name, &encrypted_shard)
        .await
        .map_err(|e| format!("Failed to upload reconstructed shard: {}", e))?;

    Ok((uploaded_id, "reconstructed".to_string()))
}

#[tauri::command]
pub async fn get_target_migration_stats(
    state: State<'_, AppState>,
    vault_id: String,
    source_target_id: String,
) -> Result<TargetMigrationStats, String> {
    let packages = state.db.list_packages(&vault_id).map_err(|e| e.to_string())?;
    let mut affected_packages = 0;
    let mut chunks_on_target = 0;
    let mut total_vault_chunks = 0;

    for pkg in &packages {
        let mut pkg_affected = false;
        for stripe in &pkg.stripes {
            for chunk in &stripe.chunks {
                total_vault_chunks += 1;
                if chunk.target_id == source_target_id {
                    chunks_on_target += 1;
                    pkg_affected = true;
                }
            }
        }
        if pkg_affected {
            affected_packages += 1;
        }
    }

    Ok(TargetMigrationStats {
        target_id: source_target_id,
        total_packages: packages.len(),
        affected_packages,
        chunks_on_target,
        total_vault_chunks,
    })
}

#[tauri::command]
pub async fn migrate_target_to_new(
    app: AppHandle,
    state: State<'_, AppState>,
    vault_id: String,
    source_target_id: String,
    new_target: VaultTarget,
    delete_old_shards: bool,
    passphrase: Option<String>,
) -> Result<TargetMigrationResult, String> {
    let mut vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Active vault not found")?;

    let client = get_drive_client(&state.db).await?;

    let new_magdrive = ensure_cached_folder(&client, &state.folder_cache, &new_target.target_id, ".magdrive").await?;
    let new_meta_dir = ensure_cached_folder(&client, &state.folder_cache, &new_magdrive, "metadata").await?;

    let salt = hex::decode(&vault.salt_hex).unwrap_or_default();
    let master_key = get_or_derive_master_key(&state.key_cache, &vault_id, passphrase.as_deref().unwrap_or(""), &salt)?;

    let mut packages = state.db.list_packages(&vault_id).map_err(|e| e.to_string())?;

    // Count total chunks to migrate
    let mut total_chunks_to_migrate = 0;
    for pkg in &packages {
        for stripe in &pkg.stripes {
            for chunk in &stripe.chunks {
                if chunk.target_id == source_target_id {
                    total_chunks_to_migrate += 1;
                }
            }
        }
    }

    let _ = app.emit(
        "migration-progress",
        MigrationProgressPayload {
            stage: "analyzing".into(),
            current_chunk: 0,
            total_chunks: total_chunks_to_migrate,
            copied_chunks: 0,
            relayed_chunks: 0,
            reconstructed_chunks: 0,
            current_package_name: "".into(),
            message: format!("Identified {} chunks to migrate to {}", total_chunks_to_migrate, new_target.label),
        },
    );

    let mut copied_count = 0;
    let mut relayed_count = 0;
    let mut reconstructed_count = 0;
    let mut failed_count = 0;
    let mut current_chunk_idx = 0;

    for pkg in &mut packages {
        let mut pkg_modified = false;

        for s_idx in 0..pkg.stripes.len() {
            let stripe_clone = pkg.stripes[s_idx].clone();
            for c_idx in 0..pkg.stripes[s_idx].chunks.len() {
                if pkg.stripes[s_idx].chunks[c_idx].target_id == source_target_id {
                    current_chunk_idx += 1;
                    let old_file_id = pkg.stripes[s_idx].chunks[c_idx].file_id.clone();

                    let _ = app.emit(
                        "migration-progress",
                        MigrationProgressPayload {
                            stage: "migrating".into(),
                            current_chunk: current_chunk_idx,
                            total_chunks: total_chunks_to_migrate,
                            copied_chunks: copied_count,
                            relayed_chunks: relayed_count,
                            reconstructed_chunks: reconstructed_count,
                            current_package_name: pkg.name.clone(),
                            message: format!("Migrating shard {}/{} ({})", current_chunk_idx, total_chunks_to_migrate, pkg.name),
                        },
                    );

                    let target_pkg_dir = ensure_cached_package_folder(
                        &client,
                        &state.folder_cache,
                        &new_target.target_id,
                        &pkg.package_id,
                    )
                    .await?;

                    match transfer_or_reconstruct_shard(
                        &client,
                        &stripe_clone.chunks[c_idx],
                        &stripe_clone,
                        pkg,
                        s_idx,
                        &target_pkg_dir,
                        &master_key,
                    )
                    .await
                    {
                        Ok((new_file_id, method)) => {
                            if method == "copied" {
                                copied_count += 1;
                            } else if method == "relayed" {
                                relayed_count += 1;
                            } else {
                                reconstructed_count += 1;
                            }

                            pkg.stripes[s_idx].chunks[c_idx].target_id = new_target.target_id.clone();
                            pkg.stripes[s_idx].chunks[c_idx].file_id = new_file_id;
                            pkg_modified = true;

                            if delete_old_shards {
                                let _ = client.delete_file(&old_file_id).await;
                            }
                        }
                        Err(e) => {
                            failed_count += 1;
                            eprintln!("Failed migrating shard {}: {}", old_file_id, e);
                        }
                    }
                }
            }
        }

        if pkg_modified {
            let _ = state.db.update_package_stripes(&pkg.package_id, &pkg.stripes);
            if let Ok(enc_meta) = pkg.encrypt(&master_key) {
                let _ = client
                    .upload_file(&new_meta_dir, &format!("meta_{}.enc", pkg.package_id), &enc_meta)
                    .await;
                if let Ok(target_pkg_dir) = ensure_cached_package_folder(
                    &client,
                    &state.folder_cache,
                    &new_target.target_id,
                    &pkg.package_id,
                ).await {
                    let _ = client.upload_file(&target_pkg_dir, "meta.enc", &enc_meta).await;
                }
            }
        }
    }

    // Replace target in VaultRecord
    let mut updated_targets = Vec::new();
    let mut replaced = false;
    for t in vault.targets {
        if t.target_id == source_target_id {
            updated_targets.push(new_target.clone());
            replaced = true;
        } else {
            updated_targets.push(t);
        }
    }
    if !replaced {
        updated_targets.push(new_target.clone());
    }
    vault.targets = updated_targets;
    state.db.save_vault(&vault).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "migration-progress",
        MigrationProgressPayload {
            stage: "completed".into(),
            current_chunk: current_chunk_idx,
            total_chunks: total_chunks_to_migrate,
            copied_chunks: copied_count,
            relayed_chunks: relayed_count,
            reconstructed_chunks: reconstructed_count,
            current_package_name: "".into(),
            message: format!(
                "Migration finished: {} shards migrated ({} server-side copied, {} relayed, {} reconstructed)",
                current_chunk_idx, copied_count, relayed_count, reconstructed_count
            ),
        },
    );

    Ok(TargetMigrationResult {
        success: failed_count == 0,
        total_migrated: current_chunk_idx,
        copied_count,
        relayed_count,
        reconstructed_count,
        failed_count,
        message: format!(
            "Migration completed: {} migrated ({} copied, {} relayed, {} reconstructed), {} failed",
            current_chunk_idx, copied_count, relayed_count, reconstructed_count, failed_count
        ),
    })
}

#[tauri::command]
pub async fn evacuate_target(
    app: AppHandle,
    state: State<'_, AppState>,
    vault_id: String,
    source_target_id: String,
    delete_old_shards: bool,
    passphrase: Option<String>,
) -> Result<TargetMigrationResult, String> {
    let mut vault = state
        .db
        .get_vault(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or("Active vault not found")?;

    let remaining_targets: Vec<VaultTarget> = vault
        .targets
        .iter()
        .filter(|t| t.target_id != source_target_id)
        .cloned()
        .collect();

    if remaining_targets.is_empty() {
        return Err("Cannot evacuate the last remaining storage target in the vault.".into());
    }

    let client = get_drive_client(&state.db).await?;

    let salt = hex::decode(&vault.salt_hex).unwrap_or_default();
    let master_key = get_or_derive_master_key(&state.key_cache, &vault_id, passphrase.as_deref().unwrap_or(""), &salt)?;

    let mut packages = state.db.list_packages(&vault_id).map_err(|e| e.to_string())?;

    // Pre-resolve metadata destination folders for all remaining targets
    let mut target_meta_dirs = HashMap::new();
    for t in &remaining_targets {
        let mag = ensure_cached_folder(&client, &state.folder_cache, &t.target_id, ".magdrive").await?;
        let m_dir = ensure_cached_folder(&client, &state.folder_cache, &mag, "metadata").await?;
        target_meta_dirs.insert(t.target_id.clone(), m_dir);
    }

    let mut total_chunks_to_evacuate = 0;
    for pkg in &packages {
        for stripe in &pkg.stripes {
            for chunk in &stripe.chunks {
                if chunk.target_id == source_target_id {
                    total_chunks_to_evacuate += 1;
                }
            }
        }
    }

    let _ = app.emit(
        "migration-progress",
        MigrationProgressPayload {
            stage: "analyzing".into(),
            current_chunk: 0,
            total_chunks: total_chunks_to_evacuate,
            copied_chunks: 0,
            relayed_chunks: 0,
            reconstructed_chunks: 0,
            current_package_name: "".into(),
            message: format!("Evacuating {} chunks across {} remaining targets", total_chunks_to_evacuate, remaining_targets.len()),
        },
    );

    let mut copied_count = 0;
    let mut relayed_count = 0;
    let mut reconstructed_count = 0;
    let mut failed_count = 0;
    let mut current_chunk_idx = 0;

    for pkg in &mut packages {
        let mut pkg_modified = false;

        for s_idx in 0..pkg.stripes.len() {
            let stripe_clone = pkg.stripes[s_idx].clone();
            for c_idx in 0..pkg.stripes[s_idx].chunks.len() {
                if pkg.stripes[s_idx].chunks[c_idx].target_id == source_target_id {
                    current_chunk_idx += 1;
                    let old_file_id = pkg.stripes[s_idx].chunks[c_idx].file_id.clone();

                    // Choose destination target among remaining_targets
                    let used_targets: HashSet<&str> = stripe_clone
                        .chunks
                        .iter()
                        .filter(|c| c.target_id != source_target_id)
                        .map(|c| c.target_id.as_str())
                        .collect();

                    let dest_target = remaining_targets
                        .iter()
                        .find(|t| !used_targets.contains(t.target_id.as_str()))
                        .unwrap_or(&remaining_targets[(s_idx + c_idx) % remaining_targets.len()]);

                    let dest_chunks_dir = ensure_cached_package_folder(
                        &client,
                        &state.folder_cache,
                        &dest_target.target_id,
                        &pkg.package_id,
                    )
                    .await?;

                    let _ = app.emit(
                        "migration-progress",
                        MigrationProgressPayload {
                            stage: "migrating".into(),
                            current_chunk: current_chunk_idx,
                            total_chunks: total_chunks_to_evacuate,
                            copied_chunks: copied_count,
                            relayed_chunks: relayed_count,
                            reconstructed_chunks: reconstructed_count,
                            current_package_name: pkg.name.clone(),
                            message: format!("Evacuating shard {}/{} to {}", current_chunk_idx, total_chunks_to_evacuate, dest_target.label),
                        },
                    );

                    match transfer_or_reconstruct_shard(
                        &client,
                        &stripe_clone.chunks[c_idx],
                        &stripe_clone,
                        pkg,
                        s_idx,
                        &dest_chunks_dir,
                        &master_key,
                    )
                    .await
                    {
                        Ok((new_file_id, method)) => {
                            if method == "copied" {
                                copied_count += 1;
                            } else if method == "relayed" {
                                relayed_count += 1;
                            } else {
                                reconstructed_count += 1;
                            }

                            pkg.stripes[s_idx].chunks[c_idx].target_id = dest_target.target_id.clone();
                            pkg.stripes[s_idx].chunks[c_idx].file_id = new_file_id;
                            pkg_modified = true;

                            if delete_old_shards {
                                let _ = client.delete_file(&old_file_id).await;
                            }
                        }
                        Err(e) => {
                            failed_count += 1;
                            eprintln!("Failed evacuating shard {}: {}", old_file_id, e);
                        }
                    }
                }
            }
        }

        if pkg_modified {
            let _ = state.db.update_package_stripes(&pkg.package_id, &pkg.stripes);
            if let Ok(enc_meta) = pkg.encrypt(&master_key) {
                for t in &remaining_targets {
                    if let Some(m_dir) = target_meta_dirs.get(&t.target_id) {
                        let _ = client
                            .upload_file(m_dir, &format!("meta_{}.enc", pkg.package_id), &enc_meta)
                            .await;
                    }
                    if let Ok(pkg_dir) = ensure_cached_package_folder(
                        &client,
                        &state.folder_cache,
                        &t.target_id,
                        &pkg.package_id,
                    ).await {
                        let _ = client.upload_file(&pkg_dir, "meta.enc", &enc_meta).await;
                    }
                }
            }
        }
    }

    // Save updated vault with evacuated target removed
    vault.targets = remaining_targets;
    state.db.save_vault(&vault).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "migration-progress",
        MigrationProgressPayload {
            stage: "completed".into(),
            current_chunk: current_chunk_idx,
            total_chunks: total_chunks_to_evacuate,
            copied_chunks: copied_count,
            relayed_chunks: relayed_count,
            reconstructed_chunks: reconstructed_count,
            current_package_name: "".into(),
            message: format!(
                "Evacuation finished: {} shards safely rebalanced across remaining targets",
                current_chunk_idx
            ),
        },
    );

    Ok(TargetMigrationResult {
        success: failed_count == 0,
        total_migrated: current_chunk_idx,
        copied_count,
        relayed_count,
        reconstructed_count,
        failed_count,
        message: format!(
            "Evacuation completed: {} evacuated ({} copied, {} relayed, {} reconstructed), {} failed",
            current_chunk_idx, copied_count, relayed_count, reconstructed_count, failed_count
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_package_id() {
        assert!(validate_package_id("pkg_12345_abc").is_ok());
        assert!(validate_package_id("file-id-456").is_ok());
        assert!(validate_package_id("").is_err());
        assert!(validate_package_id("../escape").is_err());
        assert!(validate_package_id("id with spaces").is_err());
        assert!(validate_package_id("id/with/slash").is_err());
        assert!(validate_package_id("id'with'quotes").is_err());
    }
}
