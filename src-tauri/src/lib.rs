pub mod catalog;
pub mod commands;
pub mod crypto;
pub mod drive;
pub mod erasure;
pub mod magnet;
pub mod storage;
pub mod tracker;
pub mod vault;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("magdrive");
    let _ = std::fs::create_dir_all(&data_dir);
    let db_path = data_dir.join("magdrive.db");
    let db = storage::db::Database::new(db_path).expect("Failed to initialize SQLite database");
    let keypair = crypto::signature::Keypair::generate();
    let app_state = commands::AppState {
        db,
        keypair: std::sync::Mutex::new(keypair),
        upload_sessions: std::sync::Mutex::new(std::collections::HashMap::new()),
        folder_cache: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        key_cache: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_gcp_settings,
            commands::save_gcp_settings,
            commands::get_download_settings,
            commands::save_download_settings,
            commands::pick_download_directory,
            commands::pick_save_file_path,
            commands::resolve_download_path,
            commands::start_google_login,
            commands::check_login_status,
            commands::logout_google,
            commands::create_vault,
            commands::list_vaults,
            commands::get_active_vault,
            commands::set_active_vault,
            commands::delete_vault,
            commands::export_vault_config,
            commands::import_vault_config,
            commands::save_vault_json_to_file,
            commands::load_vault_json_from_file,
            commands::import_vault_from_json,
            commands::upload_vault_descriptor_to_drive,
            commands::list_drive_members,
            commands::add_drive_member,
            commands::remove_drive_member,
            commands::sync_catalog,
            commands::list_catalog_files,
            commands::parse_magnet,
            commands::generate_magnet,
            commands::delete_package,
            commands::list_transfers,
            commands::upload_file_package,
            commands::download_package,
            commands::init_upload_session,
            commands::upload_chunk_part,
            commands::finish_upload_session,
            commands::pause_transfer,
            commands::resume_transfer,
            commands::cancel_transfer,
            commands::delete_transfer,
            commands::clear_finished_transfers,
            commands::resolve_magnet_package,
            commands::copy_shards_to_my_drive,
            commands::get_tracker_settings,
            commands::save_tracker_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
