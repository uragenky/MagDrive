use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Cipher error during encryption/decryption")]
    CipherError,
    #[error("Payload too short: expected at least 28 bytes (12 nonce + 16 tag), got {0}")]
    PayloadTooShort(usize),
    #[error("Invalid key length: expected 32 bytes, got {0}")]
    InvalidKeyLength(usize),
    #[error("Key derivation failed: {0}")]
    DerivationError(String),
    #[error("Signature error: {0}")]
    SignatureError(String),
}

pub fn encrypt_chunk(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::CipherError)?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|_| CryptoError::CipherError)?;

    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

pub fn decrypt_chunk(payload: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, CryptoError> {
    if payload.len() < 28 {
        return Err(CryptoError::PayloadTooShort(payload.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::CipherError)?;
    let nonce = Nonce::from_slice(&payload[..12]);
    let ciphertext = &payload[12..];

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::CipherError)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aes_encrypt_decrypt() {
        let key = [42u8; 32];
        let original_data = b"Hello MagDrive Encrypted Payload";

        let encrypted = encrypt_chunk(original_data, &key).expect("Encryption failed");
        assert_ne!(encrypted, original_data);
        assert_eq!(encrypted.len(), 12 + original_data.len() + 16);

        let decrypted = decrypt_chunk(&encrypted, &key).expect("Decryption failed");
        assert_eq!(decrypted, original_data);
    }

    #[test]
    fn test_aes_tampered_payload_fails() {
        let key = [42u8; 32];
        let original_data = b"Secure Data";
        let mut encrypted = encrypt_chunk(original_data, &key).unwrap();

        // Tamper with last byte
        let len = encrypted.len();
        encrypted[len - 1] ^= 0xFF;

        assert!(decrypt_chunk(&encrypted, &key).is_err());
    }
}
