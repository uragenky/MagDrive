pub mod aes;
pub mod argon;
pub mod signature;

use sha2::{Digest, Sha256};

pub fn compute_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}
