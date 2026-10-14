use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;

use super::aes::CryptoError;

pub struct Keypair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

impl Keypair {
    pub fn generate() -> Self {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
        }
    }

    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(bytes);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
        }
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.verifying_key.as_bytes())
    }

    pub fn private_key_hex(&self) -> String {
        hex::encode(self.signing_key.to_bytes())
    }

    pub fn sign_message(&self, message: &[u8]) -> String {
        let signature: Signature = self.signing_key.sign(message);
        hex::encode(signature.to_bytes())
    }
}

pub fn verify_signature(
    public_key_hex: &str,
    message: &[u8],
    signature_hex: &str,
) -> Result<bool, CryptoError> {
    let pub_bytes = hex::decode(public_key_hex)
        .map_err(|e| CryptoError::SignatureError(format!("Invalid public key hex: {}", e)))?;
    if pub_bytes.len() != 32 {
        return Err(CryptoError::SignatureError("Public key must be 32 bytes".into()));
    }
    let mut pub_arr = [0u8; 32];
    pub_arr.copy_from_slice(&pub_bytes);
    let verifying_key = VerifyingKey::from_bytes(&pub_arr)
        .map_err(|e| CryptoError::SignatureError(format!("Invalid verifying key: {}", e)))?;

    let sig_bytes = hex::decode(signature_hex)
        .map_err(|e| CryptoError::SignatureError(format!("Invalid signature hex: {}", e)))?;
    if sig_bytes.len() != 64 {
        return Err(CryptoError::SignatureError("Signature must be 64 bytes".into()));
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_arr);

    Ok(verifying_key.verify(message, &signature).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_signing_and_verification() {
        let keypair = Keypair::generate();
        let pub_hex = keypair.public_key_hex();
        let msg = b"delete package 9f8a3c4d5e";

        let sig = keypair.sign_message(msg);
        let valid = verify_signature(&pub_hex, msg, &sig).expect("Verification failed");
        assert!(valid);

        let invalid = verify_signature(&pub_hex, b"tampered message", &sig).unwrap();
        assert!(!invalid);
    }
}
