# MagDrive Developer & Technical Architecture Guide

This document provides a comprehensive technical breakdown of MagDrive to assist future developers, bug fixers, and contributors.

---

## 1. Directory Structure

```text
magdrive/
├── src/                               # Frontend (React 18 + TS + Tailwind)
│   ├── assets/                        # Static icons and logos
│   ├── components/                    # UI Component tree
│   │   ├── ui/                        # Reusable modular UI primitives
│   │   │   ├── ConfirmModal.tsx       # Global promise-ready confirmation dialog
│   │   │   └── Toast.tsx              # Stackable toast notification system
│   │   ├── DownloadModal.tsx          # Direct-to-disk streaming download modal
│   │   ├── ExplorerView.tsx           # Data Bank file listing, filtering, search
│   │   ├── HealthView.tsx             # Redundancy monitor & Self-healing rebuild
│   │   ├── MagnetModal.tsx            # Magnet URI input and metadata preview
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
│   ├── App.css                        # Tailwind directives, tactile grain & theme variables
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
│   │   │   ├── client.rs              # Multi-tenant DriveClient pool, isolated package storage, quota API, Shared Drive discovery & auto-folder provisioning
│   │   │   ├── mod.rs
│   │   │   ├── oauth.rs               # Loopback HTTP server & PKCE authorization
│   │   │   └── permissions.rs         # Google Drive Permissions API (RBAC)
│   │   ├── erasure/                   # Redundancy & error recovery
│   │   │   ├── mod.rs
│   │   │   └── rs.rs                  # Adaptive Reed-Solomon encoder, reconstructor & schema calculator
│   │   ├── magnet/                    # Magnet Link protocol
│   │   │   ├── mod.rs
│   │   │   └── parser.rs              # Magnet URI generator & parser
│   │   ├── storage/                   # Local persistence
│   │   │   ├── db.rs                  # SQLite persistence (rusqlite) for vaults, packages, transfers & multi-account pool
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

### 2.6 High-Performance Direct-to-Disk Download Pipeline

- **Multi-Stripe Concurrent Pipelining**:
  - Downloads up to 2 stripes concurrently via `futures::stream::StreamExt::buffered(2)`.
  - While Stripe `N` is writing to disk or finishing parity decoding, Stripe `N+1` is already in-flight over the network, completely eliminating idle network gaps between stripes.
  - Guarantees strict FIFO sequential ordering to disk with bounded memory consumption (~64 MB RAM).
- **Opportunistic Early Decoding**:
  - For RS 2+1 schemas (2 data shards + 1 parity shard), exactly 2 shards are needed to recover 100% of the stripe.
  - As soon as any 2 valid shards finish downloading and decrypting, the 3rd shard is immediately cancelled and dropped.
  - Saves 33.3% of network data transfer and eliminates tail latency from slow or lagging Google Drive connections.
- **Multi-Core Cryptography Offloading**:
  - AES-256-GCM chunk decryption and Reed-Solomon polynomial reconstruction execute on physical CPU core threadpools via `tokio::task::spawn_blocking`, keeping the Tokio async reactor unblocked for maximum HTTP throughput.
- **Incremental SHA-256 Checksum**:
  - The hash digest is fed stripe-by-stripe. If a mismatch is detected at finalization, the partial file is safely purged and marked as corrupted in the transfer log.
- **In-App & Native Save Dialogs**:
  - Integrated `DownloadModal` provides visual confirmation of file name, size, SHA-256, live speed/ETA progress, backgrounding, and destination path.
  - Native file picker uses `rfd` configured with `features = ["tokio", "gtk3", "common-controls-v6"]`, bypassing external DBus desktop portal daemons for 100% reliability on Linux, Windows, and macOS.
  - Automatic collision-safe naming (`resolve_download_path`) appends incremental suffixes (`(1)`, `(2)`) if a file of the same name exists.
- **Post-Download Quick Actions**:
  - Interactive toast and Transfers queue entries provide one-click "Show in Folder" (`revealItemInDir`) and "Open File" (`openPath`) actions.

---

### 2.7 Decentralized Swarm Mirroring & Blind Tracker Engine (`src-tauri/src/tracker/` & `tracker-serverless/`)

- **Server-Side Shard Copy (`files.copy`)**:
  - Replicates all chunk shards and manifests directly between Google Drives server-side in seconds (`client.copy_file`), avoiding local internet download and bypassing Google Drive's public download quota limits.
- **Blind Topic Hashing**:
  - Packages are mapped on trackers via zero-knowledge HMAC-SHA256:
    $$\text{Blind Topic} = \text{HMAC-SHA256}(\text{package\_id}, \text{"magdrive-tracker-v1"})$$
  - The tracker only records the blind topic hash and folder ID, having zero knowledge of file names, contents, or decryption keys.
- **Serverless Tracker (Vercel + Turso)**:
  - Ready-to-deploy template located under `tracker-serverless/` with endpoints:
    - `POST /api/announce`: Registers an active origin or mirror folder ID.
    - `GET /api/peers?topic=<hash>`: Retrieves active swarm peers with 30s Edge caching.
    - `POST /api/report-dead`: Automatically demotes and prunes failing mirrors after 3 consecutive failures.
- **Multi-Source Failover Engine**:
  - If a primary drive hits Google API download limits (HTTP 403 / 404), the client seamlessly shifts shard requests across alternate active mirror folders.

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
| `resolve_magnet_package` | `magnet_uri: String` | `SwarmResolveResult` | Resolves magnet URI, queries multi-trackers, and fetches metadata. |
| `copy_shards_to_my_drive` | `package_id, opt_in_seeding` | `String` | Server-side copies shards to user's Drive and optionally seeds. |
| `get_tracker_settings` | None | `TrackerSettings` | Retrieves active tracker URLs and default opt-in seeding setting. |
| `save_tracker_settings` | `trackers, default_seeding` | `()` | Saves tracker endpoints and seeding preferences to SQLite. |

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

## 5. UI Architecture & Nordic Minimalist Design System

MagDrive utilizes a bespoke **Nordic Minimalist / Tactile Sand** aesthetic designed for focused, low-fatigue engineering workflows:

### 5.1 Color Tokens & Hierarchy
- **Canvas Base**: `#0c0d0e` (Obsidian Charcoal, eliminating blue-tinted AI boilerplate).
- **Surface Elevation**: `#131417` (cards & containers), `#18191d` (nested content & inputs).
- **Borders & Dividers**: `1px solid #222429` (outer bounds) and `#26282e` (inner inputs).
- **Primary Actions**: Crisp Off-White `bg-zinc-100 hover:bg-white text-zinc-950 font-semibold rounded-xl border border-white/20 shadow-sm`.
- **Secondary Actions**: Graphite `bg-[#18191d] hover:bg-[#222428] text-zinc-200 rounded-xl border border-[#26282e]`.
- **Status Accents**: Muted emerald (`emerald-400`/`10% bg`) for healthy/success, muted amber (`amber-400`/`10% bg`) for warning/in-progress, and muted rose (`rose-400`/`10% bg`) for error/danger states.

### 5.2 Procedural Tactile Grain Layer (`.tactile-grain`)
- Implemented as an inline SVG fractal noise tile (~600 B) defined directly in `src/App.css`.
- Layered via `<div className="tactile-grain" aria-hidden="true" />` at `position: fixed; inset: 0; pointer-events: none; z-index: 9999; opacity: 0.038`.
- Rendered on a dedicated GPU compositing layer without invoking CPU paints or webview re-rendering on scroll/resize.
- Works 100% offline without remote asset fetches or image file dependencies.

---

## 6. Adding New Features

1. **Adding a new Tauri Command**:
   - Define the async function in `src-tauri/src/commands.rs` with `#[tauri::command]`.
   - Register it in `src-tauri/src/lib.rs` inside the `tauri::generate_handler![...]` macro invocation.
   - Add the typed caller in `src/services/api.ts`.
2. **Adding an UI Tab**:
   - Add the tab identifier to `ActiveTab` in `src/components/Sidebar.tsx`.
   - Render the view conditionally in `src/App.tsx`.
