use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum MagnetError {
    #[error("Invalid magnet link prefix, expected 'magdrive:?' or 'magnet:?'")]
    InvalidPrefix,
    #[error("Missing exact topic parameter 'xt' in magnet URI")]
    MissingXt,
    #[error("Invalid exact topic format: expected 'urn:magdrive:<id>'")]
    InvalidXtFormat,
    #[error("Failed to parse magnet URL: {0}")]
    UrlParseError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagnetInfo {
    pub package_id: String,
    pub vault_hint: Option<String>,
    pub total_bytes: Option<u64>,
    pub name: Option<String>,
    pub key: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub trackers: Vec<String>,
}

pub fn generate_magnet_link(
    package_id: &str,
    vault_hint: &str,
    total_bytes: u64,
    display_name: &str,
) -> String {
    generate_swarm_magnet_link(package_id, vault_hint, total_bytes, display_name, None, &[], &[])
}

pub fn generate_swarm_magnet_link(
    package_id: &str,
    vault_hint: &str,
    total_bytes: u64,
    display_name: &str,
    key: Option<&str>,
    sources: &[String],
    trackers: &[String],
) -> String {
    let mut link = format!(
        "magdrive:?xt=urn:magdrive:{}&vh={}&sz={}&dn={}",
        url::form_urlencoded::byte_serialize(package_id.as_bytes()).collect::<String>(),
        url::form_urlencoded::byte_serialize(vault_hint.as_bytes()).collect::<String>(),
        total_bytes,
        url::form_urlencoded::byte_serialize(display_name.as_bytes()).collect::<String>()
    );

    if let Some(k) = key {
        link.push_str("&k=");
        link.push_str(&url::form_urlencoded::byte_serialize(k.as_bytes()).collect::<String>());
    }

    for src in sources {
        link.push_str("&src=");
        link.push_str(&url::form_urlencoded::byte_serialize(src.as_bytes()).collect::<String>());
    }

    for tr in trackers {
        link.push_str("&tr=");
        link.push_str(&url::form_urlencoded::byte_serialize(tr.as_bytes()).collect::<String>());
    }

    link
}

pub fn parse_magnet_link(uri: &str) -> Result<MagnetInfo, MagnetError> {
    let query_str = if let Some(stripped) = uri.strip_prefix("magdrive:?") {
        stripped
    } else if let Some(stripped) = uri.strip_prefix("magnet:?") {
        stripped
    } else {
        return Err(MagnetError::InvalidPrefix);
    };

    let mut package_id = None;
    let mut vault_hint = None;
    let mut total_bytes = None;
    let mut name = None;
    let mut key = None;
    let mut sources = Vec::new();
    let mut trackers = Vec::new();

    for (k, v) in url::form_urlencoded::parse(query_str.as_bytes()) {
        match k.as_ref() {
            "xt" => {
                if let Some(id) = v.strip_prefix("urn:magdrive:") {
                    package_id = Some(id.to_string());
                } else {
                    return Err(MagnetError::InvalidXtFormat);
                }
            }
            "vh" => vault_hint = Some(v.to_string()),
            "sz" => total_bytes = v.parse::<u64>().ok(),
            "dn" => name = Some(v.to_string()),
            "k" => key = Some(v.to_string()),
            "src" => sources.push(v.to_string()),
            "tr" => trackers.push(v.to_string()),
            _ => {}
        }
    }

    let package_id = package_id.ok_or(MagnetError::MissingXt)?;

    Ok(MagnetInfo {
        package_id,
        vault_hint,
        total_bytes,
        name,
        key,
        sources,
        trackers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_magnet_link_roundtrip() {
        let pkg_id = "9f8a3c4d5e";
        let vh = "vlt_123456";
        let sz = 104857600;
        let name = "Video Tutorial 2026.mp4";

        let link = generate_magnet_link(pkg_id, vh, sz, name);
        assert!(link.starts_with("magdrive:?xt=urn:magdrive:9f8a3c4d5e"));

        let parsed = parse_magnet_link(&link).expect("Parse failed");
        assert_eq!(parsed.package_id, pkg_id);
        assert_eq!(parsed.vault_hint.as_deref(), Some(vh));
        assert_eq!(parsed.total_bytes, Some(sz));
        assert_eq!(parsed.name.as_deref(), Some(name));
        assert_eq!(parsed.key, None);
        assert!(parsed.sources.is_empty());
        assert!(parsed.trackers.is_empty());
    }

    #[test]
    fn test_swarm_magnet_link_roundtrip() {
        let pkg_id = "abc123pkg";
        let vh = "vault_public";
        let sz = 2048000;
        let name = "Archive.zip";
        let key = "base64secretkey==";
        let sources = vec!["drive_folder_1".to_string(), "drive_folder_2".to_string()];
        let trackers = vec![
            "https://tracker1.vercel.app/api".to_string(),
            "https://tracker2.fly.dev/api".to_string(),
        ];

        let link = generate_swarm_magnet_link(
            pkg_id,
            vh,
            sz,
            name,
            Some(key),
            &sources,
            &trackers,
        );

        let parsed = parse_magnet_link(&link).expect("Swarm magnet parse failed");
        assert_eq!(parsed.package_id, pkg_id);
        assert_eq!(parsed.key.as_deref(), Some(key));
        assert_eq!(parsed.sources, sources);
        assert_eq!(parsed.trackers, trackers);
    }
}
