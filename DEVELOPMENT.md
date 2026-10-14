# MagDrive Developer & Technical Architecture Guide

This document provides a comprehensive technical breakdown of MagDrive to assist future developers, bug fixers, and contributors.

---

## 1. Directory Structure

```text
magdrive/
├── src/                               # Frontend (React 18 + TS + Tailwind)
│   ├── assets/                        # Static icons and logos
│   ├── components/                    # UI Component tree
│   │   ├── ExplorerView.tsx           # Bank Data file listing, filtering, search
│   │   ├── HealthView.tsx             # Redundancy monitor & Self-healing rebuild
│   │   ├── MagnetModal.tsx            # Magnet URI input and metadata preview
│   │   ├── MembersView.tsx            # Google Permissions management & Token export
│   │   ├── Navbar.tsx                 # Top bar with active vault indicator & sync
│   │   ├── SettingsView.tsx           # GCP credentials & Drive target config
│   │   ├── Sidebar.tsx                # App navigation & vault switcher
│   │   ├── TransfersView.tsx          # Transfer queue and progress bars
│   │   ├── UploadView.tsx             # File/folder uploader & Reed-Solomon config
│   │   └── VaultModal.tsx             # Vault creation and import modal
│   ├── services/
│   │   └── api.ts                     # Typed Tauri IPC bridge
│   ├── types/
│   │   └── index.ts                   # TypeScript interfaces matching Rust models
│   ├── App.css                        # Tailwind directives and styling
│   ├── App.tsx                        # Main application container & state root
│   └── main.tsx                       # React DOM entrypoint
├── src-tauri/                         # Backend (Rust Tauri Core)
│   ├── src/
│   │   ├── catalog/                   # Metadata manifests and remote sync
│   │   │   ├── manifest.rs            # PackageManifest structure & encryption
│   │   │   ├── mod.rs
│   │   │   └── sync.rs                # Multi-target metadata sync engine
│   │   ├── crypto/                    # Cryptographic primitives
│   │   │   ├── aes.rs                 # AES-256-GCM encryption/decryption
│   │   │   ├── argon.rs               # Argon2id password key derivation
│   │   │   ├── mod.rs
│   │   │   └── signature.rs           # Ed25519 digital signatures
│   │   ├── drive/                     # Google Drive REST API & OAuth
│   │   │   ├── client.rs              # DriveClient, multipart upload, downloads
│   │   │   ├── mod.rs
│   │   │   ├── oauth.rs               # Loopback HTTP server & PKCE authorization
│   │   │   └── permissions.rs         # Google Drive Permissions API (RBAC)
│   │   ├── erasure/                   # Redundancy & error recovery
│   │   │   ├── mod.rs
│   │   │   └── rs.rs                  # Reed-Solomon RS 2+1 encoder & reconstructor
│   │   ├── magnet/                    # Magnet Link protocol
│   │   │   ├── mod.rs
│   │   │   └── parser.rs              # Magnet URI generator & parser
│   │   ├── storage/                   # Local persistence
│   │   │   ├── db.rs                  # SQLite database wrapper (rusqlite)
│   │   │   └── mod.rs
│   │   ├── vault/                     # Group vault configuration & export
│   │   │   ├── model.rs               # VaultRecord & VaultExportPayload
│   │   │   └── mod.rs
│   │   ├── commands.rs                # Tauri IPC handlers (`#[tauri::command]`)
│   │   ├── lib.rs                     # Library initialization & state setup
│   │   └── main.rs                    # Executable entrypoint
│   ├── tests/                         # Integration test suite
│   │   └── e2e_vault_test.rs          # End-to-end encryption & recovery test
│   ├── Cargo.toml                     # Rust dependencies and compiler flags
│   └── tauri.conf.json                # Tauri v2 bundle and window configuration
├── package.json                       # Frontend dependencies & scripts
├── tailwind.config.js                 # Tailwind CSS configuration
├── tsconfig.json                      # TypeScript configuration
└── README.md                          # Project overview and user guide
```

---

## 2. Core Modules Breakdown

### 2.1 Cryptographic Engine (`src-tauri/src/crypto/`)

#### AES-256-GCM (`aes.rs`)
- **Key Size**: 32 bytes (256-bit).
- **Nonce Size**: 12 bytes generated via `rand::thread_rng().fill_bytes()`.
- **Payload Layout**:
  ```text
  [ 0..12 bytes ] : Random Nonce
  [ 12..end-16  ] : Encrypted Ciphertext
  [ end-16..end ] : 16-byte Poly1305 Authentication Tag
  ```
- **Function**: `encrypt_chunk(&data, &key)` and `decrypt_chunk(&payload, &key)`.

#### Argon2id (`argon.rs`)
- **Parameters**: Memory: 65,536 KB (64 MB), Iterations: 3, Parallelism: 1.
- **Function**: `derive_master_key(passphrase, salt)` converts user passphrases into a cryptographically strong 32-byte master key.
- **Role Keys**: `derive_role_key(master_key, "member")` derives sub-keys for scoped access.

#### Digital Signatures (`signature.rs`)
- **Algorithm**: `Ed25519` (via `ed25519-dalek`).
- **Function**: Protects against unauthorized file deletions. When a file is uploaded, the author's public key is recorded in the manifest. Deletion requires a message signed by the matching private key or the vault administrator's master key.

---

### 2.2 Erasure Coding Engine (`src-tauri/src/erasure/rs.rs`)

- **Algorithm**: Reed-Solomon Erasure Coding over Galois Field $GF(2^8)$.
- **Default Schemes**:
  - **$\ge 3$ Targets**: $K=2$ Data Shards, $M=1$ Parity Shard (RS 2+1).
  - **2 Targets**: $K=1$ Data Shard, $M=1$ Parity Shard (Mirroring / RS 1+1).
  - **1 Target**: $K=1$ Data Shard, $M=0$ Parity Shard (Single target).
- **Reconstruction**:
  `reconstruct(&mut shards, data_shards, parity_shards, original_size)`:
  Pass `None` for any missing shard index. If at least $K$ shards out of $K+M$ are present (`Some(Vec<u8>)`), the lost shards are reconstructed accurately.

---

### 2.3 Distributed Metadata & Catalog (`src-tauri/src/catalog/`)

- **Manifest**: `PackageManifest` records file hierarchy, total size, original SHA-256, chunk shard references, and deletion signatures.
- **Encryption**: The entire manifest is serialized to JSON and encrypted via AES-256-GCM.
- **Replication**: Stored at `.magdrive/metadata/meta_<package_id>.enc` on **all** connected storage targets.
- **Catalog Synchronization**: `sync_vault_catalog()` scans target directories, identifies un-indexed or modified metadata files, decrypts them locally, and inserts them into the local SQLite database.

---

### 2.4 Google Drive Client & OAuth PKCE (`src-tauri/src/drive/`)

- **OAuth 2.0 PKCE**:
  - `start_oauth_flow()` spawns a temporary HTTP server on `127.0.0.1:0`.
  - Directs user to Google OAuth consent screen with `scope=https://www.googleapis.com/auth/drive`.
  - Captures authorization code via `/callback` and exchanges it for an access token, refresh token, and expiration timestamp.
- **Proactive & Reactive Token Auto-Refresh**:
  - `get_drive_client(db)` proactively checks `token_expires_at`. If the token is older than 59 minutes or expired, it automatically exchanges the `refresh_token` for a new `access_token` and updates SQLite.
  - `DriveClient` includes an internal reactive 401 interceptor: if any API request encounters an unexpected HTTP 401, it calls `try_refresh_token()`, updates credentials, and automatically replays the failed request on-the-fly.
- **High-Performance Upload Pipeline & Concurrency**:
  - **Multi-Stripe Concurrent Pipeline**: Streams up to 2 stripes simultaneously via `buffer_unordered(2)`. For 3 Shared Drives, up to 6 concurrent chunk uploads stream simultaneously (2 connections per Shared Drive), maintaining full network saturation without idle gaps between stripes.
  - **Multi-Core Parallel Cryptography**: Reed-Solomon erasure encoding, AES-256-GCM encryption, and SHA-256 calculation execute in parallel across CPU cores using `tokio::task::spawn_blocking` threadpools.
  - **HTTP/2 Socket & Connection Pool Tuning**: Client uses `tcp_nodelay(true)` to eliminate Nagle packet delays, keep-alives, and `pool_max_idle_per_host(32)` to reuse existing TLS connections.
  - **In-Memory Folder & Key Caching**: Target directory structures (`.magdrive/chunks` and `metadata`) and Argon2id derived master keys are cached in-memory, eliminating up to 16 redundant HTTP queries per transfer and removing repetitive CPU overhead.
  - **Native Blob-to-Base64 Slicing**: Uses browser WebKit native C++ `FileReader.readAsDataURL` to eliminate large JavaScript string allocations and main-thread CPU freezes.
  - **Per-Shard Real-Time Progress**: `UploadProgressNotifier` emits granular progress events upon each individual shard completion, updating speed (`⚡ MB/s`), dynamic ETA (`⏱ ~seconds`), and shard counters in real time.
  - **Parallel Manifest Distribution**: Metadata manifests are distributed to all storage targets in parallel via `futures::future::join_all`.
- **Rate-Limiting Protection**:
  - Automatically handles HTTP `429 Too Many Requests` and HTTP `5xx` server errors with an exponential backoff loop with randomized jitter (1s, 2s, 4s, 8s).
- **Google Permissions API**:
  - `list_permissions(target_id)`: Fetches member list.
  - `add_permission(target_id, email, role)`: Directly invites member email.
  - `remove_permission(target_id, permission_id)`: Revokes member access.

---

### 2.5 Local Storage & Transfer Queue (`src-tauri/src/storage/db.rs`)

- **SQLite Database**: Located at `%APPDATA%/magdrive/magdrive.db` (Windows) or `~/.local/share/magdrive/magdrive.db` (Linux).
- **Tables**:
  - `settings`: Key-value storage for active vault ID, GCP credentials, OAuth tokens, and download preferences (`download_dir`, `prompt_save_location`).
  - `vaults`: Configuration of registered vaults, target IDs, salt, and verification tags.
  - `packages`: Cached metadata of uploaded files and packages.
  - `transfers`: Journal of active and historical upload/download operations with transfer progress and `destination_path`.

---

### 2.6 Direct-to-Disk Streaming Download & Save Management

- **Direct-to-Disk Streaming**:
  - Unlike browser-based Base64 downloads that load gigabytes into memory, MagDrive reconstructs each stripe via Reed-Solomon and writes it directly to disk via `tokio::fs::File`.
  - Maintains flat ~32 MB memory consumption throughout the entire download session.
  - Real-time progress events emit current shard, total shards, bytes transferred, speed (`⚡ MB/s`), and ETA (`⏱ ~seconds`).
- **Incremental SHA-256 Checksum**:
  - The hash digest is fed stripe-by-stripe. If a mismatch is detected at finalization, the partial file is safely purged and marked as corrupted in the transfer log.
- **In-App & Native Save Dialogs**:
  - Integrated `DownloadModal` provides visual confirmation of file name, size, SHA-256, and destination path.
  - Native file picker uses `rfd` configured with `features = ["tokio", "gtk3", "common-controls-v6"]`, bypassing external DBus desktop portal daemons for 100% reliability on Linux, Windows, and macOS.
  - Automatic collision-safe naming (`resolve_download_path`) appends incremental suffixes (`(1)`, `(2)`) if a file of the same name exists.
- **Post-Download Quick Actions**:
  - Interactive toast and Transfers queue entries provide one-click "Show in Folder" (`revealItemInDir`) and "Open File" (`openPath`) actions.

---

## 3. Tauri IPC Command Reference

| Command Name | Arguments | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `get_gcp_settings` | None | `Option<GcpCredentials>` | Retrieves stored GCP Client ID and Secret. |
| `save_gcp_settings` | `credentials: GcpCredentials` | `()` | Saves GCP Client ID and Secret. |
| `start_google_login` | None | `String` (URL) | Starts loopback listener and returns auth URL. |
| `check_login_status` | None | `bool` | Checks if a valid access token exists. |
| `logout_google` | None | `()` | Clears saved OAuth tokens. |
| `create_vault` | `name, passphrase, targets` | `VaultRecord` | Initializes a new group vault. |
| `list_vaults` | None | `Vec<VaultRecord>` | Lists all locally saved vaults. |
| `get_active_vault` | None | `Option<VaultRecord>` | Gets the currently selected vault. |
| `set_active_vault` | `vault_id: String` | `()` | Switches active group vault. |
| `delete_vault` | `vault_id: String` | `()` | Removes vault configuration locally. |
| `export_vault_config` | `vault_id, role` | `String` (Base64) | Generates an encrypted `.magvault` token. |
| `import_vault_config` | `config_b64, passphrase` | `VaultRecord` | Imports and decrypts a `.magvault` token. |
| `list_drive_members` | `target_id: String` | `Vec<DrivePermissionItem>` | Fetches member permissions from Google Drive. |
| `add_drive_member` | `target_id, email, role` | `DrivePermissionItem` | Shares drive target with an email. |
| `remove_drive_member`| `target_id, permission_id`| `()` | Revokes access for a member from Google Drive. |
| `sync_catalog` | `passphrase: Option<String>` | `usize` | Syncs remote metadata manifests with SQLite. |
| `list_catalog_files` | None | `Vec<PackageManifest>` | Fetches cached file list for the active vault. |
| `parse_magnet` | `magnet_uri: String` | `MagnetInfo` | Parses `magdrive://` URI. |
| `generate_magnet` | `package_id: String` | `String` | Generates a magnet URI for a package. |
| `delete_package` | `package_id: String` | `()` | Signs and executes deletion from cloud targets. |
| `list_transfers` | None | `Vec<TransferRecord>` | Returns active and historical transfer queue. |
| `init_upload_session` | `fileName, totalBytes, chunkSize, isFolder, passphrase` | `UploadSessionInfo` | Initializes chunked streaming session & local buffer. |
| `upload_chunk_part` | `sessionId, chunkIndex, chunkBytesBase64` | `()` | Appends sliced chunk (16/32/64 MB) to local buffer. |
| `finish_upload_session` | `sessionId` | `String` (pkg_id) | Encrypts, encodes RS parity, uploads to Drive, creates manifest. |
| `pause_transfer` | `transferId: String` | `()` | Pauses active upload session. |
| `resume_transfer` | `transferId: String` | `()` | Resumes paused upload session. |
| `cancel_transfer` | `transferId: String` | `()` | Cancels transfer, deletes local buffer & cleans up uploaded cloud chunks. |
| `delete_transfer` | `transferId: String` | `()` | Removes transfer record from local SQLite history. |
| `clear_finished_transfers` | None | `()` | Clears all completed, failed, and cancelled transfers. |
| `upload_file_package`| `fileName, bytesB64, isFolder, tree, passphrase` | `String` (pkg_id) | Direct monolithic upload (for small files/tests). |
| `download_package` | `package_id, destination_path, passphrase` | `DownloadResult` | Downloads shards, auto-reconstructs, streams directly to disk. |
| `get_download_settings` | None | `DownloadSettings` | Retrieves default download folder and prompt preference. |
| `save_download_settings` | `download_dir, prompt_save_location` | `()` | Saves download location & prompt behavior to SQLite. |
| `pick_download_directory`| `default_dir: Option<String>` | `Option<String>` | Native directory selection dialog. |
| `pick_save_file_path` | `default_name: String, default_dir: Option<String>` | `Option<String>` | Native "Save As" file popup dialog with suggested name. |
| `resolve_download_path` | `download_dir: String, file_name: String` | `String` | Generates collision-safe path for automatic downloads. |

---

## 4. Troubleshooting & Debugging Guide

### 4.1 "Rate limited (HTTP 429)" during heavy transfers
- **Cause**: Google Drive API has user-based queries-per-minute limits.
- **Fix**: The `DriveClient` incorporates exponential backoff. If you encounter rate limits on large folders, ensure chunk size is at least 16 MB (`16_777_216` bytes) to minimize the number of API calls.

### 4.2 "Incorrect passphrase. Failed to unlock vault" on import
- **Cause**: The passphrase provided does not match the Argon2id verification tag stored in the `.magvault` token.
- **Fix**: Verify with the vault administrator that the passphrase entered is exact (case-sensitive).

### 4.3 Missing dependencies when building on Linux
- **Cause**: System webkit2gtk or GTK3 libraries not found by `pkg-config`.
- **Fix**:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libdbus-1-dev pkg-config
  ```

### 4.4 Shared Drive vs Personal Shared Folder 404 Errors
- When using a **Shared Drive**: Query parameter `supportsAllDrives=true` is required for all requests (this is enabled by default in `DriveClient`).
- When using a **Personal Shared Folder**: The authenticated user must have **Editor** permissions on the folder. Ensure the target folder is shared with the user's email address.

### 4.5 Large File Uploads & Memory Footprint
- MagDrive uses **Adaptive Streaming Slicing** (`file.slice` in 16MB, 32MB, or 64MB blocks).
- Browser heap consumption stays below 50 MB regardless of file size (supports multi-GB files without `RangeError: out of memory`).

### 4.6 Linux / WSLg Desktop Development
- Use `./run-dev.sh` to run the development server with user/mount namespace isolation (`unshare`) and self-healing WebKit process resolution.

---

## 5. Adding New Features

1. **Adding a new Tauri Command**:
   - Define the async function in `src-tauri/src/commands.rs` with `#[tauri::command]`.
   - Register it in `src-tauri/src/lib.rs` inside the `tauri::generate_handler![...]` macro invocation.
   - Add the typed caller in `src/services/api.ts`.
2. **Adding an UI Tab**:
   - Add the tab identifier to `ActiveTab` in `src/components/Sidebar.tsx`.
   - Render the view conditionally in `src/App.tsx`.
