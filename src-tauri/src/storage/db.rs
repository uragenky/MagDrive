use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::str::FromStr;

use crate::catalog::manifest::{ErasureSchema, PackageManifest, PackageType};
use crate::vault::model::{VaultRecord, VaultRole, VaultTarget};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Storage error: {0}")]
    General(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub id: String,
    pub package_id: String,
    pub name: String,
    pub transfer_type: String, // "upload", "download"
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub status: String,        // "pending", "transferring", "paused", "completed", "failed"
    pub error_message: Option<String>,
    pub updated_at: i64,
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, StorageError> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        Ok(db)
    }

    pub fn in_memory() -> Result<Self, StorageError> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vaults (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                salt_hex TEXT NOT NULL,
                targets_json TEXT NOT NULL,
                verification_tag TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS packages (
                id TEXT PRIMARY KEY,
                vault_id TEXT NOT NULL,
                name TEXT NOT NULL,
                pkg_type TEXT NOT NULL,
                total_size INTEGER NOT NULL,
                original_sha256 TEXT NOT NULL,
                uploader_pubkey TEXT NOT NULL,
                tree_json TEXT NOT NULL,
                stripes_json TEXT NOT NULL,
                chunk_size INTEGER NOT NULL,
                data_shards INTEGER NOT NULL,
                parity_shards INTEGER NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                deletion_signature TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY,
                package_id TEXT NOT NULL,
                name TEXT NOT NULL,
                transfer_type TEXT NOT NULL,
                total_bytes INTEGER NOT NULL,
                transferred_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                error_message TEXT,
                updated_at INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    // --- Settings ---
    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    // --- Vaults ---
    pub fn save_vault(&self, record: &VaultRecord) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        let targets_json = serde_json::to_string(&record.targets)?;
        conn.execute(
            r#"INSERT INTO vaults (id, name, role, salt_hex, targets_json, verification_tag, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT(id) DO UPDATE SET
               name=?2, role=?3, salt_hex=?4, targets_json=?5, verification_tag=?6"#,
            params![
                record.id,
                record.name,
                record.role.to_string(),
                record.salt_hex,
                targets_json,
                record.verification_tag,
                record.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_vaults(&self) -> Result<Vec<VaultRecord>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, role, salt_hex, targets_json, verification_tag, created_at FROM vaults ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let role_str: String = row.get(2)?;
            let salt_hex: String = row.get(3)?;
            let targets_json: String = row.get(4)?;
            let verification_tag: String = row.get(5)?;
            let created_at: i64 = row.get(6)?;

            let role = VaultRole::from_str(&role_str).unwrap_or(VaultRole::Viewer);
            let targets: Vec<VaultTarget> = serde_json::from_str(&targets_json).unwrap_or_default();

            Ok(VaultRecord {
                id,
                name,
                role,
                salt_hex,
                targets,
                verification_tag,
                created_at,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_vault(&self, id: &str) -> Result<Option<VaultRecord>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, role, salt_hex, targets_json, verification_tag, created_at FROM vaults WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let role_str: String = row.get(2)?;
            let salt_hex: String = row.get(3)?;
            let targets_json: String = row.get(4)?;
            let verification_tag: String = row.get(5)?;
            let created_at: i64 = row.get(6)?;

            let role = VaultRole::from_str(&role_str).unwrap_or(VaultRole::Viewer);
            let targets: Vec<VaultTarget> = serde_json::from_str(&targets_json).unwrap_or_default();

            Ok(VaultRecord {
                id,
                name,
                role,
                salt_hex,
                targets,
                verification_tag,
                created_at,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn delete_vault(&self, id: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM vaults WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM packages WHERE vault_id = ?1", params![id])?;
        Ok(())
    }

    // --- Packages (Catalog Cache) ---
    pub fn upsert_package(&self, vault_id: &str, manifest: &PackageManifest) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        let tree_json = serde_json::to_string(&manifest.tree)?;
        let stripes_json = serde_json::to_string(&manifest.stripes)?;
        let pkg_type = match manifest.pkg_type {
            PackageType::File => "file",
            PackageType::Folder => "folder",
        };

        conn.execute(
            r#"INSERT INTO packages
               (id, vault_id, name, pkg_type, total_size, original_sha256, uploader_pubkey,
                tree_json, stripes_json, chunk_size, data_shards, parity_shards, deleted,
                deletion_signature, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
               ON CONFLICT(id) DO UPDATE SET
               deleted=?13, deletion_signature=?14"#,
            params![
                manifest.package_id,
                vault_id,
                manifest.name,
                pkg_type,
                manifest.total_size as i64,
                manifest.original_sha256,
                manifest.uploader_pubkey,
                tree_json,
                stripes_json,
                manifest.chunk_size as i64,
                manifest.erasure_schema.data_shards as i64,
                manifest.erasure_schema.parity_shards as i64,
                if manifest.deleted { 1 } else { 0 },
                manifest.deletion_signature,
                manifest.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_packages(&self, vault_id: &str) -> Result<Vec<PackageManifest>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, name, pkg_type, total_size, original_sha256, uploader_pubkey,
                      tree_json, stripes_json, chunk_size, data_shards, parity_shards,
                      deleted, deletion_signature, created_at
               FROM packages WHERE vault_id = ?1 AND deleted = 0
               ORDER BY created_at DESC"#,
        )?;

        let rows = stmt.query_map(params![vault_id], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let pkg_type_str: String = row.get(2)?;
            let total_size: i64 = row.get(3)?;
            let original_sha256: String = row.get(4)?;
            let uploader_pubkey: String = row.get(5)?;
            let tree_json: String = row.get(6)?;
            let stripes_json: String = row.get(7)?;
            let chunk_size: i64 = row.get(8)?;
            let data_shards: i64 = row.get(9)?;
            let parity_shards: i64 = row.get(10)?;
            let deleted: i64 = row.get(11)?;
            let deletion_signature: Option<String> = row.get(12)?;
            let created_at: i64 = row.get(13)?;

            let pkg_type = if pkg_type_str == "folder" {
                PackageType::Folder
            } else {
                PackageType::File
            };

            let tree = serde_json::from_str(&tree_json).unwrap_or_default();
            let stripes = serde_json::from_str(&stripes_json).unwrap_or_default();

            Ok(PackageManifest {
                version: 1,
                package_id: id,
                pkg_type,
                name,
                total_size: total_size as u64,
                original_sha256,
                uploader_pubkey,
                deleted: deleted != 0,
                deletion_signature,
                chunk_size: chunk_size as usize,
                erasure_schema: ErasureSchema {
                    data_shards: data_shards as usize,
                    parity_shards: parity_shards as usize,
                },
                tree,
                stripes,
                created_at,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_package(&self, package_id: &str) -> Result<Option<PackageManifest>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, name, pkg_type, total_size, original_sha256, uploader_pubkey,
                      tree_json, stripes_json, chunk_size, data_shards, parity_shards,
                      deleted, deletion_signature, created_at
               FROM packages WHERE id = ?1"#,
        )?;

        let mut rows = stmt.query_map(params![package_id], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let pkg_type_str: String = row.get(2)?;
            let total_size: i64 = row.get(3)?;
            let original_sha256: String = row.get(4)?;
            let uploader_pubkey: String = row.get(5)?;
            let tree_json: String = row.get(6)?;
            let stripes_json: String = row.get(7)?;
            let chunk_size: i64 = row.get(8)?;
            let data_shards: i64 = row.get(9)?;
            let parity_shards: i64 = row.get(10)?;
            let deleted: i64 = row.get(11)?;
            let deletion_signature: Option<String> = row.get(12)?;
            let created_at: i64 = row.get(13)?;

            let pkg_type = if pkg_type_str == "folder" {
                PackageType::Folder
            } else {
                PackageType::File
            };

            let tree = serde_json::from_str(&tree_json).unwrap_or_default();
            let stripes = serde_json::from_str(&stripes_json).unwrap_or_default();

            Ok(PackageManifest {
                version: 1,
                package_id: id,
                pkg_type,
                name,
                total_size: total_size as u64,
                original_sha256,
                uploader_pubkey,
                deleted: deleted != 0,
                deletion_signature,
                chunk_size: chunk_size as usize,
                erasure_schema: ErasureSchema {
                    data_shards: data_shards as usize,
                    parity_shards: parity_shards as usize,
                },
                tree,
                stripes,
                created_at,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn mark_deleted(&self, package_id: &str, signature: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE packages SET deleted = 1, deletion_signature = ?2 WHERE id = ?1",
            params![package_id, signature],
        )?;
        Ok(())
    }

    // --- Transfers ---
    pub fn upsert_transfer(&self, item: &TransferRecord) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO transfers
               (id, package_id, name, transfer_type, total_bytes, transferred_bytes, status, error_message, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
               ON CONFLICT(id) DO UPDATE SET
               transferred_bytes=?6, status=?7, error_message=?8, updated_at=?9"#,
            params![
                item.id,
                item.package_id,
                item.name,
                item.transfer_type,
                item.total_bytes as i64,
                item.transferred_bytes as i64,
                item.status,
                item.error_message,
                item.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn list_transfers(&self) -> Result<Vec<TransferRecord>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, package_id, name, transfer_type, total_bytes, transferred_bytes, status, error_message, updated_at FROM transfers ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let package_id: String = row.get(1)?;
            let name: String = row.get(2)?;
            let transfer_type: String = row.get(3)?;
            let total_bytes: i64 = row.get(4)?;
            let transferred_bytes: i64 = row.get(5)?;
            let status: String = row.get(6)?;
            let error_message: Option<String> = row.get(7)?;
            let updated_at: i64 = row.get(8)?;

            Ok(TransferRecord {
                id,
                package_id,
                name,
                transfer_type,
                total_bytes: total_bytes as u64,
                transferred_bytes: transferred_bytes as u64,
                status,
                error_message,
                updated_at,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_transfer(&self, id: &str) -> Result<Option<TransferRecord>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, package_id, name, transfer_type, total_bytes, transferred_bytes, status, error_message, updated_at FROM transfers WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            let id: String = row.get(0)?;
            let package_id: String = row.get(1)?;
            let name: String = row.get(2)?;
            let transfer_type: String = row.get(3)?;
            let total_bytes: i64 = row.get(4)?;
            let transferred_bytes: i64 = row.get(5)?;
            let status: String = row.get(6)?;
            let error_message: Option<String> = row.get(7)?;
            let updated_at: i64 = row.get(8)?;

            Ok(TransferRecord {
                id,
                package_id,
                name,
                transfer_type,
                total_bytes: total_bytes as u64,
                transferred_bytes: transferred_bytes as u64,
                status,
                error_message,
                updated_at,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn delete_transfer(&self, id: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM transfers WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_finished_transfers(&self) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM transfers WHERE status IN ('completed', 'cancelled', 'failed')",
            [],
        )?;
        Ok(())
    }

    pub fn update_transfer_status(
        &self,
        id: &str,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE transfers SET status = ?2, error_message = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, status, error_message, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_database_operations() {
        let db = Database::in_memory().expect("Failed to create in-memory db");

        // Settings test
        db.set_setting("active_vault", "vlt_100").unwrap();
        assert_eq!(db.get_setting("active_vault").as_deref(), Some("vlt_100"));

        // Vault test
        let vault = VaultRecord {
            id: "vlt_100".to_string(),
            name: "Alpha Group".to_string(),
            role: VaultRole::Admin,
            salt_hex: "01020304".to_string(),
            targets: vec![],
            verification_tag: "tag123".to_string(),
            created_at: 1000,
        };
        db.save_vault(&vault).unwrap();
        let list = db.list_vaults().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Alpha Group");

        // Transfers test
        let tx = TransferRecord {
            id: "tx_1".to_string(),
            package_id: "pkg_1".to_string(),
            name: "test.bin".to_string(),
            transfer_type: "upload".to_string(),
            total_bytes: 1000,
            transferred_bytes: 500,
            status: "transferring".to_string(),
            error_message: None,
            updated_at: 1000,
        };
        db.upsert_transfer(&tx).unwrap();
        let txs = db.list_transfers().unwrap();
        assert_eq!(txs.len(), 1);
        assert_eq!(txs[0].status, "transferring");

        db.update_transfer_status("tx_1", "paused", None).unwrap();
        let updated = db.get_transfer("tx_1").unwrap().unwrap();
        assert_eq!(updated.status, "paused");

        db.update_transfer_status("tx_1", "completed", None).unwrap();
        db.clear_finished_transfers().unwrap();
        let empty = db.list_transfers().unwrap();
        assert_eq!(empty.len(), 0);
    }
}
