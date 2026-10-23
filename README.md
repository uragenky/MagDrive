# MagDrive

> Decentralized, Zero-Knowledge Encrypted File Sharing & Data Bank using Google Workspace Shared Drives and Personal Shared Folders, protected by Reed-Solomon Erasure Coding and Magnet Links.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Cryptographic & Redundancy Design](#cryptographic--redundancy-design)
  - [Zero-Knowledge Encryption](#zero-knowledge-encryption)
  - [Adaptive Reed-Solomon Erasure Coding](#adaptive-reed-solomon-erasure-coding)
  - [Multi-Account OAuth Pool & True Quota Isolation](#multi-account-oauth-pool--true-quota-isolation)
  - [Isolated Package Storage & Least-Privilege Sharing](#isolated-package-storage--least-privilege-sharing)
  - [Target Migration & Decommissioning](#target-migration--decommissioning)
  - [Magnet Link Protocol](#magnet-link-protocol)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [1. Development Mode](#1-development-mode)
  - [2. Production Builds](#2-production-builds)
- [Google Workspace & GCP Setup](#google-workspace--gcp-setup)
- [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Documentation & Development Guide](#documentation--development-guide)
- [License](#license)

---

## Overview

**MagDrive** is a desktop application (built with **Tauri v2**, **Rust**, **React 18**, **TypeScript**, and **Tailwind CSS**) designed to turn Google Drive storage (Shared Drives or Personal Shared Folders) into a private, high-performance, resilient data bank.

Files uploaded through MagDrive are:
1. **Never stored in their original format on cloud drives**. They are sliced into equal-sized binary blocks (*stripes and chunks*).
2. **Encrypted locally** on the client side with **AES-256-GCM** before leaving your machine.
3. **Protected with Reed-Solomon Erasure Coding ($2+1$ or $1+1$)**, distributing shards across multiple drives. Even if one of the Shared Drives is permanently deleted, revoked, or corrupted, the client automatically reconstructs the lost data from the remaining parity shards on the fly.
4. **Referenced by Magnet Links (`magdrive://`)**, enabling seamless sharing within the group without relying on a centralized server.

---

## Key Features

- **Zero-Knowledge Privacy**: Only users with the vault passphrase can decrypt manifests and file data. Google Drive only sees random binary blobs without file extensions or MIME signatures.
- **Decentralized Swarm Mirroring**: Converts Google Drive into a BitTorrent-like resilient swarm. Users can replicate shards directly between Google Drives (`files.copy`) server-side within seconds without consuming local internet bandwidth.
- **Serverless Multi-Tracker Coordination**: Lightweight zero-knowledge blind tracker (built for Vercel + Turso libSQL) maps blind HMAC-SHA256 package topics to active mirror drives without ever exposing file names, contents, or decryption keys.
- **Multi-Source Failover & Anti-Quota Exceeded**: Automatically searches across multiple Google Drive mirrors. If a primary target hits Google's HTTP 403 download quota, the client immediately falls back to active mirrors.
- **Auto-Recovery & Self-Healing**: Loss of any storage target triggers real-time Galois Field $GF(2^8)$ reconstruction from surviving data and parity blocks.
- **Dynamic Adaptive Erasure Coding**: Automatically computes the mathematically optimal $(D + P)$ Reed-Solomon scheme based on connected storage targets ($N \le 1 \to 1+0$, $N=2 \to 1+1$, $N=3 \to 2+1$, $N=4 \to 3+1$, $N=5 \to 3+2$, $N=6 \to 4+2$, $N=7 \to 5+2$, $N=8 \to 6+2$, $N \ge 9 \to N-3+3$). Enforces strict non-colocation ($1 \text{ shard per target}$) so total loss of up to $P$ Google accounts produces zero data loss.
- **Multi-Stripe Balanced Target Rotation**: Rotates target placement per stripe `(stripe_index + shard_index) % targets.len()`, evenly balancing storage quota and network transfer volume across all connected Google Drives.
- **Multi-Account OAuth Pool & True Quota Isolation**: Connect multiple Google accounts (`@gmail.com` or Google Workspace). Each target is bound to its owning account (`account_email`); shard uploads are dispatched through that specific account's OAuth session. This bypasses Google's post-2021 shared folder quota penalty by evenly consuming quota across multiple independent 15 GB accounts.
- **Dynamic Per-Vault Root Folders & Collision Resolution**: Automatically provisions named root folders with format `MagDrive - <Vault Name>`. If identical names exist on Drive, an internal `.magdrive/vault_id` identity tag detects conflicts and transparently disambiguates folders (`(2)`, `(3)`).
- **Isolated Per-Package Storage & Least-Privilege Sharing**: Shards and manifests are stored in dedicated per-package subfolders (`.magdrive/packages/<package_id>/`). Only this package subfolder is granted public reader (`anyone with link: reader`) via a single API call; the root vault folder and internal catalog remain **100% PRIVATE**, preventing unauthorized browsing of other vault files.
- **Dual-Manifest Architecture**: Encrypted manifest is uploaded privately to `.magdrive/metadata/` for fast internal vault sync, and duplicated to `.magdrive/packages/<package_id>/meta.enc` for frictionless Magnet Link downloads without Google auth.
- **Exploit-Hardened Queries & Safe IDs**: Sanitized Google Drive API search queries (`escape_drive_query`) and strict regex validation on package identifiers (`validate_package_id`) preventing path traversal and search query injection.
- **Google Workspace Shared Drive Discovery**: Automatically discovers and lists all accessible Shared Drives for any connected account, allowing 1-click addition into the vault.
- **Per-Account Live Storage Quota Monitoring**: Real-time meters for each connected account showing total capacity, used bytes, free space, usage percentages, and breakdowns (Drive files, trash, Gmail/Photos).
- **Per-Target Shard Footprint Tracking**: Live shard count and byte volume displayed directly on each vault target card.
- **Full Target Migration & Evacuation Engine**: 3-layer resilient shard migration (`files.copy` cloud fast-copy $\to$ direct relay download/upload $\to$ Reed-Solomon self-healing reconstruct from surviving shards). Supports replacing decommissioned drives with a new account or evacuating and rebalancing shards across remaining drives with optional old shard cleanup.
- **Multi-Target Storage Abstraction**: Works transparently with Google Workspace Shared Drives (`supportsAllDrives=true`) or regular Shared Folders on `@gmail.com` personal accounts.
- **Integrated Google Permissions RBAC**: Group administrators can invite or revoke member emails from the Shared Drive directly within the app via the Google Drive Permissions API.
- **Local SQLite Cache**: File lists, metadata, and transfer queues are indexed locally for zero-latency searching and offline catalog browsing.
- **Adaptive Streaming Upload & Concurrent Shards**: Files are sliced in memory-safe adaptive blocks (16 MB / 32 MB / 64 MB), guaranteeing constant memory consumption (< 50 MB RAM). Shards within each stripe are uploaded concurrently in parallel (`join_all`) across storage targets.
- **Multi-Stripe Concurrent Pipeline**: Streams up to 2 stripes simultaneously (`buffer_unordered(2)`), keeping up to 6 concurrent upload connections active across 3 Shared Drives for maximum pipe saturation with zero idle gaps between stripes.
- **Parallel Multi-Core Cryptography**: Reed-Solomon erasure encoding, AES-256-GCM encryption, and SHA-256 hashing run concurrently across physical CPU cores using Tokio blocking threadpool workers.
- **In-Memory Folder & Key Caching**: Target directory structures (`.magdrive/chunks` and `metadata`) and Argon2id derived master keys are cached in-memory, eliminating up to 16 redundant HTTP queries per transfer and removing repetitive CPU overhead.
- **Optimized HTTP/2 & TCP Sockets**: Kills TCP packet delays via `tcp_nodelay(true)` and maintains warm connection pools (`pool_max_idle_per_host(32)`) to eliminate repetitive TLS handshakes with Google Drive API servers.
- **Real-Time Per-Shard Transfer Metrics**: Multi-stage progress pipeline (Buffering, Encrypting, Shard Upload, and Finalizing) with live speed (`⚡ MB/s`), dynamic ETA (`⏱ ~seconds`), and instant per-shard counter updates emitted on every shard completion.
- **Transparent OAuth 2.0 Auto-Refresh & 401 Interceptor**: Tokens are tracked by expiry and proactively refreshed before calls; any reactive HTTP 401 response is automatically intercepted to renew credentials on-the-fly without interrupting running operations.
- **Transfer Queue Lifecycle & Auto-Cleanup**: Full state machine with Pause, Resume, Cancel, and Delete. Cancelling a transfer automatically removes any orphaned chunks uploaded to Google Drive.
- **Transfer State Machine**: Resumable chunk transfers equipped with a Leaky Bucket Rate Limiter and Exponential Backoff with Jitter against Google API rate limits (HTTP 429).
- **Optimized Direct-to-Disk Streaming Downloads**: Multi-stripe concurrent pipelining (`buffered(2)`), opportunistic early decoding (stops at 2/3 data shards, saving 33.3% bandwidth and eliminating tail latency), multi-core AES/Reed-Solomon CPU offloading (`spawn_blocking`), and direct-to-disk streaming with constant minimal RAM usage (~64 MB). Features an interactive in-app download popup modal, native OS GTK/Win32 file dialogs, configurable default download directory, collision-safe file naming, and one-click "Show in Folder" file manager reveal.
- **Nordic Minimalist & Tactile Hardware Aesthetic**: Modern, low-fatigue design system crafted with deep obsidian charcoal canvas (`#0c0d0e`), elevated graphite surfaces (`#131417`/`#18191d`), crisp off-white primary actions, subtle 1px structural borders (`#222429`), and an ultra-lightweight GPU-composited procedural fine-grain texture (`.tactile-grain`) that delivers an organic tactile feel without network requests or runtime CPU repainting.
- **Multi-Platform Support**: Cross-compiled binaries for Windows (`.msi` / `.exe`), macOS (`.dmg` / `.app`), and Linux (`.deb` / `.AppImage`).

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│               FRONTEND (React 18 + TypeScript + Tailwind)              │
│  - Vault Selector & RBAC UI        - Virtual Hierarchical Explorer     │
│  - Members & Google Perms Manager  - Transfer Queue (Resumable)        │
│  - Dynamic GCP Credential Config   - Vault Health & Self-Healing       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Tauri v2 IPC (Commands / Events)
┌───────────────────────────────────▼────────────────────────────────────┐
│                             TAURI RUST CORE                            │
│                                                                        │
│  ┌───────────────────────┐ ┌──────────────────────┐ ┌────────────────┐ │
│  │   Crypto & Signatures │ │    Erasure Engine    │ │ Local Storage  │ │
│  │  - AES-256-GCM        │ │  - Reed-Solomon 2+1  │ │ - rusqlite     │ │
│  │  - Argon2id Key Deriv │ │  - Dynamic Fallback  │ │ - Transfer Log │ │
│  │  - Ed25519 Signatures │ │  - Galois Field GF   │ │ - Tombstones   │ │
│  └───────────────────────┘ └──────────────────────┘ └────────────────┘ │
│                                                                        │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │               Google Drive & Network Engine                       │ │
│  │  - OAuth 2.0 PKCE Loopback Server   - Concurrency Worker Pool     │ │
│  │  - Google Permissions API (RBAC)    - Exponential Backoff Retry   │ │
│  │  - Resumable Chunk HTTP/2 Streaming - Storage Target Abstraction  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ TLS 1.3 HTTPS
┌───────────────────────────────────▼────────────────────────────────────┐
│                    DISTRIBUTED STORAGE TARGETS                         │
│  Target 1 (Data Shard 0)   │ Target 2 (Data Shard 1) │ Target 3(Parity)│
│  .magdrive/chunks/ + meta/ │ .magdrive/chunks/+meta/ │ .magdrive/chunks│
└────────────────────────────────────────────────────────────────────────┘
```

---

## Cryptographic & Redundancy Design

### Zero-Knowledge Encryption
- **Key Derivation**: Passphrase + 16-byte random salt $\xrightarrow{\text{Argon2id}}$ 32-byte Master Key ($m=64\text{MB}, t=3, p=1$).
- **Role Subkey Derivation**:
  - `Member Key`: $\text{SHA256}("magdrive-subkey-role:member" \parallel \text{Master Key})$
  - `Viewer Key`: $\text{SHA256}("magdrive-subkey-role:viewer" \parallel \text{Master Key})$
- **Payload Encryption**: Each chunk has an independent 12-byte random cryptographic nonce and is encrypted with `AES-256-GCM`. The resulting binary payload layout is `[12-byte Nonce][Ciphertext + 16-byte Tag]`.
- **Digital Signatures**: Uploader generates an `Ed25519` keypair. File deletion commands require a valid cryptographic signature to prevent unauthorized deletions by other standard members.

### Adaptive Reed-Solomon Erasure Coding
- **Dynamic $(D + P)$ Calculation**:
  - The number of data shards ($D$) and parity shards ($P$) scales dynamically with connected storage targets $N$:
    - $N = 1 \implies 1 + 0$ (single drive, no parity)
    - $N = 2 \implies 1 + 1$ (mirroring, survives 1 dead drive)
    - $N = 3 \implies 2 + 1$ (survives 1 dead drive, +50% overhead)
    - $N = 4 \implies 3 + 1$ (survives 1 dead drive, +33% overhead)
    - $N = 5 \implies 3 + 2$ (survives 2 dead drives, +66% overhead)
    - $N = 6 \implies 4 + 2$ (survives 2 dead drives, +50% overhead)
    - $N = 7 \implies 5 + 2$ (survives 2 dead drives, +40% overhead)
    - $N = 8 \implies 6 + 2$ (survives 2 dead drives, +33% overhead)
    - $N \ge 9 \implies (N - 3) + 3$ (survives 3 dead drives)
- **Strict Non-Colocation Guarantee**: Because $D + P \le N$, no single Google Drive target hosts more than 1 shard per stripe.
- **Balanced Target Rotation**: Shards are placed using `(stripe_index + shard_index) % targets.len()`, distributing storage footprint and API quota consumption equally across all connected targets.
- **Failure Tolerance**: If up to $P$ storage targets are permanently deleted, suspended, or hit quota limits, the client reconstructs missing shards on-the-fly via Galois Field $GF(2^8)$ matrix inversion.

### Multi-Account OAuth Pool & True Quota Isolation
- **Bypassing Google 2021 Shared Folder Quota Policy**:
  - In personal Google Drive (`@gmail.com`), files uploaded to another person's shared folder still consume the *uploader's* storage quota.
  - MagDrive overcomes this by maintaining a multi-account OAuth pool (`google_accounts` SQLite table).
  - Every storage target is bound to its owning Google account (`account_email`).
  - During stripe uploads, Shard 0 is uploaded with Account A's token, Shard 1 with Account B's token, and Shard 2 with Account C's token.
  - This distributes cloud storage footprint across all accounts (e.g. $3 \times 15\text{ GB} = 45\text{ GB}$ pooled capacity).
- **Zero-Configuration Folder Provisioning**:
  - Authenticating a Google account automatically checks for or creates a dedicated root folder named `MagDrive Storage` (`find_or_create_magdrive_folder`).
  - Users can attach the account to any vault with 1 click without manually copying folder IDs.
- **Shared Drive Auto-Discovery**:
  - Scans accessible Google Workspace Shared Drives via `drives.list` and provides a 1-click addition into the vault.

### Isolated Package Storage & Least-Privilege Sharing
- **Per-Vault Root Folders**:
  - Automatically names root target folders as `MagDrive - <Vault Name>`.
  - Disambiguates name collisions on Google Drive using `.magdrive/vault_id` identity markers (`(2)`, `(3)`).
- **Subfolder Isolation**:
  - Shards and manifests are stored under `.magdrive/packages/<package_id>/`.
  - The root vault directory and `.magdrive/metadata/` directory remain **100% PRIVATE**.
  - Only the specific `.magdrive/packages/<package_id>/` folder is marked `anyone with link: reader` (single API call). An external Magnet Link downloader can never navigate upward or browse other files in the vault.
- **Dual Manifest Distribution**:
  - `metadata/meta_<package_id>.enc`: Uploaded to private metadata folder for fast internal vault synchronization.
  - `packages/<package_id>/meta.enc`: Uploaded to the public package folder so recipients of Magnet Links can parse manifests and download shards directly without encountering `HTTP 403 Forbidden`.
- **Security Hardening**:
  - All Google Drive search queries escape quotes and backslashes via `escape_drive_query`.
  - Package identifiers are strictly validated (`^[a-zA-Z0-9_-]{8,64}$`) to eliminate path traversal vulnerabilities.

### Target Migration & Decommissioning
- **3-Layer Resilient Shard Relocation**:
  1. *Server-Side Fast Copy*: Uses Google Drive `files.copy` for instant cloud-to-cloud replication without client bandwidth consumption.
  2. *Direct Download & Upload Relay*: If cross-domain permissions prevent server-side copy, shards are relayed through the local client.
  3. *Reed-Solomon Self-Healing Reconstruct*: If the old drive is completely suspended, banned, or inaccessible, the engine downloads surviving shards from other active targets, decodes the original stripe, re-encodes the missing shard, and uploads it to the replacement target.
- **Replace vs. Evacuate**:
  - *Replace*: Migrates all shards from an old target to a new target account and updates the vault configuration.
  - *Evacuate & Rebalance*: Relocates shards from a retiring drive across the remaining drives in the vault (requires at least 2 targets).
- **Quota Cleanup**: Optionally deletes migrated shards from the old drive to reclaim storage quota.

### Magnet Link Protocol
MagDrive uses self-describing, swarm-aware URIs:
```text
magdrive:?xt=urn:magdrive:<package_id>&vh=<vault_id_hint>&sz=<total_bytes>&dn=<file_name>&k=<aes_key_base64>&src=<origin_folder_id>&tr=<tracker_url>
```
- `xt`: Cryptographic hash identifying the package manifest.
- `vh`: Vault ID hint to verify the user has the matching group profile.
- `sz`: Total size of the reconstructed file in bytes.
- `dn`: URL-encoded display name.
- `k`: Encrypted master key (Base64 URL-safe) enabling recipient direct decryption without pre-shared passwords.
- `src`: Origin Google Drive folder ID for bootstrap peer discovery.
- `tr`: Swarm tracker endpoint URL (can be specified multiple times for multi-tracker redundancy).

---

## Prerequisites

- **Node.js**: `v18.0+` or `v20.0+` / `v22.0+`
- **Rust Toolchain**: `rustc` & `cargo` (`1.80+`)
- **System Libraries**:
  - **Linux (Ubuntu/Debian)**: `build-essential`, `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libdbus-1-dev`, `pkg-config`
  - **Windows**: [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), WebView2 (preinstalled on Windows 10/11)
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)

---

## Quick Start

### 1. Development Mode

Clone the repository and install frontend dependencies:
```bash
git clone git@github.com:uragenky/MagDrive.git
cd MagDrive
npm install
```

Run in development mode (starts Vite frontend + compiles Rust backend):
```bash
# On Linux / WSLg (with isolated namespace & self-healing WebKit helper):
./run-dev.sh

# Or standard Tauri dev command:
npm run tauri dev
```

### 2. Production Builds

#### Linux (.deb / .AppImage / .rpm)
```bash
npm run tauri:build
```
Bundles will be generated under `src-tauri/target/release/bundle/deb/` and `src-tauri/target/release/bundle/appimage/`.

#### Windows (.msi / .exe)
Run on a Windows development machine or CI/CD runner:
```powershell
npm run tauri:build
```
Outputs installer `.msi` and standalone `.exe` under `src-tauri/target/release/bundle/msi/`.

#### macOS (.dmg / .app)
Run on macOS:
```bash
npm run tauri:build
```
Outputs Apple Silicon / Intel `.dmg` and `.app` bundles under `src-tauri/target/release/bundle/dmg/`.

### 3. Automated Multi-Platform Builds (GitHub Actions)

A preconfigured GitHub Actions workflow (`.github/workflows/release.yml`) automatically builds all OS packages concurrently on GitHub-hosted runners (Windows, Linux, macOS).

To trigger a release build:
1. Push a version tag:
   ```bash
   git tag v0.5.1
   git push origin v0.5.1
   ```
2. Or trigger manually via the **GitHub Actions** tab in your repository (`Workflow dispatch`).
3. Completed installers (`.msi`, `.exe`, `.deb`, `.AppImage`, `.dmg`) will automatically be published to the GitHub Releases section of your repository.

> **Note for Windows Users (SmartScreen & "Unknown Publisher"):**  
> Because MagDrive is an open-source community release without a costly commercial code-signing certificate, Windows Defender SmartScreen may display *"Windows protected your PC"*. Simply click **"More info"** and select **"Run anyway"**. All released binaries can be verified using the published SHA-256 checksums or built directly from source.

---

## Google Workspace & GCP Setup

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and enable the **Google Drive API**.
3. Configure the **OAuth Consent Screen**:
   - User Type: *Internal* (for GWS organization) or *External* (with test users added).
   - Scopes: `https://www.googleapis.com/auth/drive`.
4. Create an **OAuth 2.0 Client ID**:
   - Application Type: **Desktop app**.
   - Download the `client_secret.json` or copy the `Client ID` and `Client Secret`.
5. In the MagDrive app:
   - Navigate to **Settings & GCP**.
   - Paste the credentials or import `client_secret.json`.
   - Click **Connect Google Account (OAuth 2.0 PKCE)**. A browser window will open to authorize the account via local loopback.

---

## Role-Based Access Control (RBAC)

| Feature | Admin Role | Member Role | Viewer Role |
| :--- | :---: | :---: | :---: |
| Browse & Search Catalog | Yes | Yes | Yes |
| Download & Reconstruct Files | Yes | Yes | Yes |
| Upload New Files / Folders | Yes | Yes | No |
| Delete Own Uploaded Files | Yes | Yes | No |
| Delete Any Member's Files | Yes (Master Key) | No | No |
| Manage Shared Drive Targets | Yes | No | No |
| Invite / Revoke Drive Members | Yes | No | No |
| Generate Vault Export Tokens | Admin/Member/Viewer | Member Only | No |

---

## Testing & Quality Assurance

MagDrive includes a comprehensive test suite covering cryptographic primitives, Reed-Solomon auto-recovery, database transactions, and complete end-to-end vault lifecycles:

Run all tests:
```bash
cd src-tauri
cargo test -- --nocapture
```

Test coverage includes:
- `crypto::aes::test_aes_encrypt_decrypt`
- `crypto::aes::test_aes_tampered_payload_fails`
- `crypto::argon::test_argon2_derivation`
- `crypto::signature::test_signature_signing_and_verification`
- `erasure::rs::test_reed_solomon_2_plus_1_recovery`
- `erasure::rs::test_insufficient_shards_fails`
- `storage::db::test_database_operations`
- `catalog::manifest::test_manifest_encryption_roundtrip`
- `magnet::parser::test_magnet_link_roundtrip`
- `tests/e2e_vault_test::test_full_e2e_vault_lifecycle_with_auto_recovery`

---

## Documentation & Development Guide

For technical architecture details, IPC command specifications, schema structures, and bug-fixing guides, refer to [DEVELOPMENT.md](./DEVELOPMENT.md).

---

## Legal & Compliance Disclaimer

### Third-Party Terms & Non-Affiliation
- **Not Affiliated with Google LLC**: MagDrive is an independent open-source software project and is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Google LLC, Google Drive™, Google Workspace™, or any of their subsidiaries or affiliates. The official Google website can be found at [https://google.com](https://google.com).
- **Trademark Notice**: Google Drive™, Google Workspace™, and Google™ are registered trademarks of Google LLC. References to these names and trademarks are made strictly for identification and technical interoperability purposes under fair use doctrine.
- **Compliance with Third-Party Terms**: Users are solely responsible for ensuring that their configuration and usage of MagDrive comply with the [Google Terms of Service](https://policies.google.com/terms), [Google Drive Additional Terms](https://www.google.com/drive/terms-of-service/), and Google Cloud Platform policies. MagDrive operates as a client-side encryption and personal data redundancy utility utilizing user-provided API credentials (BYOK model); it does not bypass Google authentication mechanisms or encourage the violation of cloud storage quotas.

### Acceptable Use & Anti-Piracy Policy
MagDrive provides client-side cryptographic primitives (AES-256-GCM, Argon2id, Ed25519, Reed-Solomon Erasure Coding) intended for personal backup, disaster recovery, and sovereign data preservation. MagDrive does not host, index, track, promote, or distribute any user content. Users are strictly prohibited from utilizing MagDrive to transmit, distribute, or store material that infringes on third-party copyrights or intellectual property rights, violates local or international laws, or contains malicious payloads.

### Limitation of Liability
THIS SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS, COPYRIGHT HOLDERS, OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, LOSS OF DATA, SERVICE SUSPENSION, ACCOUNT PENALTY, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## License

This project is licensed under the GNU General Public License v3.0 (GPLv3) - see the [LICENSE](./LICENSE) file for details.
