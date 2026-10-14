use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::aes::CryptoError;

pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// Derives a 32-byte master key using Argon2id
pub fn derive_master_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], CryptoError> {
    if salt.len() < 8 {
        return Err(CryptoError::DerivationError("Salt too short".into()));
    }

    // Recommended parameters: 64MB memory (65536 KB), 3 iterations, 1 lane
    let params = Params::new(65536, 3, 1, Some(32))
        .map_err(|e| CryptoError::DerivationError(e.to_string()))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| CryptoError::DerivationError(e.to_string()))?;

    Ok(key)
}

/// Derive subkey for a specific role (e.g. "member", "viewer")
pub fn derive_role_key(master_key: &[u8; 32], role: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"magdrive-subkey-role:");
    hasher.update(role.as_bytes());
    hasher.update(master_key);
    let result = hasher.finalize();
    let mut role_key = [0u8; 32];
    role_key.copy_from_slice(&result);
    role_key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_argon2_derivation() {
        let salt = generate_salt();
        let pass = "SuperSecretGroupPassword123!";
        let key1 = derive_master_key(pass, &salt).expect("Key 1 failed");
        let key2 = derive_master_key(pass, &salt).expect("Key 2 failed");
        assert_eq!(key1, key2);

        let key3 = derive_master_key("DifferentPassword", &salt).expect("Key 3 failed");
        assert_ne!(key1, key3);

        let member_key = derive_role_key(&key1, "member");
        let viewer_key = derive_role_key(&key1, "viewer");
        assert_ne!(member_key, viewer_key);
        assert_ne!(member_key, key1);
    }
}
