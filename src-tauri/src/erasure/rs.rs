use reed_solomon_erasure::galois_8::ReedSolomon;

#[derive(Debug, thiserror::Error)]
pub enum ErasureError {
    #[error("Reed-Solomon initialization error: {0}")]
    InitError(String),
    #[error("Reed-Solomon encoding error: {0}")]
    EncodingError(String),
    #[error("Reed-Solomon reconstruction failed: {0}")]
    ReconstructionError(String),
    #[error("Too many missing shards: got {present} present, but need at least {needed}")]
    InsufficientShards { present: usize, needed: usize },
    #[error("Shard size mismatch or invalid shard count")]
    InvalidShardData,
}

/// Encodes raw buffer into (data_shards + parity_shards) equal-sized blocks.
/// Returns: (shards, shard_size)
pub fn encode(
    data: &[u8],
    data_shards: usize,
    parity_shards: usize,
) -> Result<(Vec<Vec<u8>>, usize), ErasureError> {
    if data_shards == 0 {
        return Err(ErasureError::InitError("Data shards must be > 0".into()));
    }

    if parity_shards == 0 {
        // Fallback for single drive (no parity needed)
        return Ok((vec![data.to_vec()], data.len()));
    }

    let rs = ReedSolomon::new(data_shards, parity_shards)
        .map_err(|e| ErasureError::InitError(format!("{:?}", e)))?;

    // Determine equal shard size
    let shard_size = if data.is_empty() {
        1
    } else {
        (data.len() + data_shards - 1) / data_shards
    };

    let mut shards: Vec<Vec<u8>> = Vec::with_capacity(data_shards + parity_shards);

    for i in 0..data_shards {
        let mut shard = vec![0u8; shard_size];
        let start = i * shard_size;
        if start < data.len() {
            let end = (start + shard_size).min(data.len());
            shard[..(end - start)].copy_from_slice(&data[start..end]);
        }
        shards.push(shard);
    }

    for _ in 0..parity_shards {
        shards.push(vec![0u8; shard_size]);
    }

    rs.encode(&mut shards)
        .map_err(|e| ErasureError::EncodingError(format!("{:?}", e)))?;

    Ok((shards, shard_size))
}

/// Reconstructs original data from available shards.
/// `shards` is a slice of length (data_shards + parity_shards), with None for missing shards.
pub fn reconstruct(
    shards: &mut [Option<Vec<u8>>],
    data_shards: usize,
    parity_shards: usize,
    original_size: usize,
) -> Result<Vec<u8>, ErasureError> {
    if parity_shards == 0 {
        if let Some(Some(ref data)) = shards.get(0) {
            let len = original_size.min(data.len());
            return Ok(data[..len].to_vec());
        } else {
            return Err(ErasureError::InsufficientShards {
                present: 0,
                needed: 1,
            });
        }
    }

    let present_count = shards.iter().filter(|s| s.is_some()).count();
    if present_count < data_shards {
        return Err(ErasureError::InsufficientShards {
            present: present_count,
            needed: data_shards,
        });
    }

    let rs = ReedSolomon::new(data_shards, parity_shards)
        .map_err(|e| ErasureError::InitError(format!("{:?}", e)))?;

    rs.reconstruct(shards)
        .map_err(|e| ErasureError::ReconstructionError(format!("{:?}", e)))?;

    let mut reconstructed = Vec::with_capacity(original_size);
    for shard in shards.iter().take(data_shards) {
        if let Some(ref data) = shard {
            reconstructed.extend_from_slice(data);
        } else {
            return Err(ErasureError::ReconstructionError(
                "Data shard still missing after reconstruction".into(),
            ));
        }
    }

    reconstructed.truncate(original_size);
    Ok(reconstructed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reed_solomon_2_plus_1_recovery() {
        let original_data = b"This is confidential information distributed across three cloud drives!";
        let data_shards = 2;
        let parity_shards = 1;

        let (encoded_shards, shard_size) =
            encode(original_data, data_shards, parity_shards).expect("Encoding failed");
        assert_eq!(encoded_shards.len(), 3);
        assert_eq!(encoded_shards[0].len(), shard_size);

        // Scenario 1: Drive 1 (Shard 0) is lost / deleted!
        let mut missing_shard_0 = vec![
            None, // Shard 0 lost
            Some(encoded_shards[1].clone()),
            Some(encoded_shards[2].clone()), // Parity
        ];

        let recovered_data_0 = reconstruct(
            &mut missing_shard_0,
            data_shards,
            parity_shards,
            original_data.len(),
        )
        .expect("Recovery from missing shard 0 failed");

        assert_eq!(recovered_data_0, original_data);

        // Scenario 2: Drive 2 (Shard 1) is lost!
        let mut missing_shard_1 = vec![
            Some(encoded_shards[0].clone()),
            None, // Shard 1 lost
            Some(encoded_shards[2].clone()),
        ];

        let recovered_data_1 = reconstruct(
            &mut missing_shard_1,
            data_shards,
            parity_shards,
            original_data.len(),
        )
        .expect("Recovery from missing shard 1 failed");

        assert_eq!(recovered_data_1, original_data);

        // Scenario 3: Parity drive (Shard 2) is lost!
        let mut missing_shard_2 = vec![
            Some(encoded_shards[0].clone()),
            Some(encoded_shards[1].clone()),
            None, // Parity lost
        ];

        let recovered_data_2 = reconstruct(
            &mut missing_shard_2,
            data_shards,
            parity_shards,
            original_data.len(),
        )
        .expect("Recovery from missing parity failed");

        assert_eq!(recovered_data_2, original_data);
    }

    #[test]
    fn test_insufficient_shards_fails() {
        let original_data = b"Some data";
        let (encoded_shards, _) = encode(original_data, 2, 1).unwrap();

        // 2 shards lost (only 1 remaining, but 2 needed)
        let mut missing_2_shards = vec![
            Some(encoded_shards[0].clone()),
            None,
            None,
        ];

        let res = reconstruct(&mut missing_2_shards, 2, 1, original_data.len());
        assert!(res.is_err());
    }
}
