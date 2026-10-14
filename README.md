# MagDrive

> Decentralized, Zero-Knowledge Encrypted File Sharing & Data Bank using Google Workspace Shared Drives and Personal Shared Folders, protected by Reed-Solomon Erasure Coding and Magnet Links.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Cryptographic & Redundancy Design](#cryptographic--redundancy-design)
  - [Zero-Knowledge Encryption](#zero-knowledge-encryption)
  - [Reed-Solomon Erasure Coding (RS 2+1)](#reed-solomon-erasure-coding-rs-21)
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
- **Auto-Recovery & Self-Healing**: Loss of any single storage target (HTTP 404/403) triggers real-time Galois Field $GF(2^8)$ reconstruction from parity blocks.
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

### Reed-Solomon Erasure Coding (RS 2+1)
- For vaults configured with 3 targets:
  - Data is split into $K=2$ equal-sized data shards.
  - $M=1$ parity shard is calculated via Galois Field arithmetic.
  - Shard 0 $\rightarrow$ Target 1 (Drive A).
  - Shard 1 $\rightarrow$ Target 2 (Drive B).
  - Shard 2 (Parity) $\rightarrow$ Target 3 (Drive C).
- **Failure Tolerance**: If Drive A is deleted or inaccessible, the client downloads Shard 1 and Shard 2, mathematically recovering Shard 0 instantly in memory without interrupting playback or file saving.

### Magnet Link Protocol
MagDrive uses self-describing URIs:
```text
magdrive:?xt=urn:magdrive:<package_id>&vh=<vault_id_hint>&sz=<total_bytes>&dn=<file_name>
```
- `xt`: Cryptographic hash identifying the package manifest.
- `vh`: Vault ID hint to verify the user has the matching group profile.
- `sz`: Total size of the reconstructed file in bytes.
- `dn`: URL-encoded display name.

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
   git tag v0.1.0
   git push origin v0.1.0
   ```
2. Or trigger manually via the **GitHub Actions** tab in your repository (`Workflow dispatch`).
3. Completed installers (`.msi`, `.exe`, `.deb`, `.AppImage`, `.dmg`) will automatically be published to the GitHub Releases section of your repository.

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

## License

This project is licensed under the MIT License - see the LICENSE file for details.
