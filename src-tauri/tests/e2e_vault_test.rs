use magdrive_lib::catalog::manifest::{ErasureSchema, PackageManifest, PackageType};
use magdrive_lib::crypto::aes::{decrypt_chunk, encrypt_chunk};
use magdrive_lib::crypto::argon::{derive_master_key, generate_salt};
use magdrive_lib::crypto::compute_sha256;
use magdrive_lib::crypto::signature::{verify_signature, Keypair};
use magdrive_lib::erasure::rs::{encode, reconstruct};
use magdrive_lib::magnet::parser::{generate_magnet_link, parse_magnet_link};
use magdrive_lib::storage::db::Database;
use magdrive_lib::vault::model::{VaultRecord, VaultRole, VaultTarget};

#[test]
fn test_full_e2e_vault_lifecycle_with_auto_recovery() {
    // 1. Setup Vault
    let salt = generate_salt();
    let passphrase = "GroupSecurePassphrase2026!";
    let vault_key = derive_master_key(passphrase, &salt).expect("Key derivation failed");

    let db = Database::in_memory().expect("In-memory SQLite failed");
    let vault_record = VaultRecord {
        id: "vlt_e2e_test".to_string(),
        name: "Test Group Vault".to_string(),
        role: VaultRole::Admin,
        salt_hex: hex::encode(salt),
        targets: vec![
            VaultTarget {
                target_id: "drive_alpha".into(),
                target_type: magdrive_lib::drive::client::TargetType::SharedDrive,
                label: "Target A (Data 1)".into(),
            },
            VaultTarget {
                target_id: "drive_beta".into(),
                target_type: magdrive_lib::drive::client::TargetType::SharedDrive,
                label: "Target B (Data 2)".into(),
            },
            VaultTarget {
                target_id: "drive_gamma".into(),
                target_type: magdrive_lib::drive::client::TargetType::SharedDrive,
                label: "Target C (Parity)".into(),
            },
        ],
        verification_tag: "tag".to_string(),
        created_at: 1000,
    };
    db.save_vault(&vault_record).expect("Failed to save vault");

    // 2. Prepare Sample Payload (2 MB test data)
    let original_size = 2 * 1024 * 1024;
    let mut original_data = Vec::with_capacity(original_size);
    for i in 0..original_size {
        original_data.push((i % 256) as u8);
    }
    let expected_sha256 = compute_sha256(&original_data);

    // 3. Chunker & Reed-Solomon RS 2+1
    let data_shards = 2;
    let parity_shards = 1;
    let (encoded_shards, shard_size) =
        encode(&original_data, data_shards, parity_shards).expect("RS encode failed");
    assert_eq!(encoded_shards.len(), 3);

    // 4. Encrypt each shard with AES-256-GCM (Zero-Knowledge)
    let mut encrypted_shards = Vec::new();
    for shard in &encoded_shards {
        let enc = encrypt_chunk(shard, &vault_key).expect("Encryption failed");
        encrypted_shards.push(enc);
    }

    // 5. Simulate Disruption: Drive Alpha (Shard 0) has died / file deleted!
    let mut available_decrypted_shards: Vec<Option<Vec<u8>>> = vec![
        None, // Shard 0 is missing!
        Some(decrypt_chunk(&encrypted_shards[1], &vault_key).expect("Shard 1 decrypt failed")),
        Some(decrypt_chunk(&encrypted_shards[2], &vault_key).expect("Parity decrypt failed")),
    ];

    // 6. Auto-Recovery via Reed-Solomon Parity
    let reconstructed_data = reconstruct(
        &mut available_decrypted_shards,
        data_shards,
        parity_shards,
        original_size,
    )
    .expect("Auto-recovery reconstruction failed");

    // 7. Integrity Validation: Must be 100% identical!
    assert_eq!(reconstructed_data.len(), original_data.len());
    let reconstructed_sha256 = compute_sha256(&reconstructed_data);
    assert_eq!(reconstructed_sha256, expected_sha256);
    assert_eq!(reconstructed_data, original_data);

    // 8. Manifest Encryption & Decryption
    let keypair = Keypair::generate();
    let manifest = PackageManifest {
        version: 1,
        package_id: "pkg_e2e_001".to_string(),
        pkg_type: PackageType::File,
        name: "Confidential_Archive.zip".to_string(),
        total_size: original_size as u64,
        original_sha256: expected_sha256,
        uploader_pubkey: keypair.public_key_hex(),
        deleted: false,
        deletion_signature: None,
        chunk_size: shard_size,
        erasure_schema: ErasureSchema {
            data_shards,
            parity_shards,
        },
        tree: vec![],
        stripes: vec![],
        created_at: 1728950400,
    };

    let enc_manifest = manifest.encrypt(&vault_key).expect("Manifest enc failed");
    let dec_manifest = PackageManifest::decrypt(&enc_manifest, &vault_key).expect("Manifest dec failed");
    assert_eq!(dec_manifest.package_id, manifest.package_id);
    assert_eq!(dec_manifest.name, manifest.name);

    // Save to local SQLite
    db.upsert_package(&vault_record.id, &dec_manifest).expect("Save package failed");
    let listed = db.list_packages(&vault_record.id).expect("List packages failed");
    assert_eq!(listed.len(), 1);

    // 9. Magnet Link Roundtrip
    let magnet_link = generate_magnet_link(
        &manifest.package_id,
        &vault_record.id,
        manifest.total_size,
        &manifest.name,
    );
    let parsed_magnet = parse_magnet_link(&magnet_link).expect("Magnet parse failed");
    assert_eq!(parsed_magnet.package_id, manifest.package_id);
    assert_eq!(parsed_magnet.vault_hint.as_deref(), Some(vault_record.id.as_str()));
    assert_eq!(parsed_magnet.name.as_deref(), Some("Confidential_Archive.zip"));

    // 10. RBAC Signature Deletion Verification
    let delete_msg = format!("delete:{}", manifest.package_id);
    let valid_sig = keypair.sign_message(delete_msg.as_bytes());
    let is_valid = verify_signature(&keypair.public_key_hex(), delete_msg.as_bytes(), &valid_sig)
        .expect("Verify sig failed");
    assert!(is_valid);

    // Unauthorized signature check
    let fake_keypair = Keypair::generate();
    let fake_sig = fake_keypair.sign_message(delete_msg.as_bytes());
    let fake_is_valid = verify_signature(&keypair.public_key_hex(), delete_msg.as_bytes(), &fake_sig)
        .expect("Verify sig failed");
    assert!(!fake_is_valid);
}
