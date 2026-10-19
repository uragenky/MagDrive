use futures::future::join_all;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashSet;
use std::time::Duration;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmPeer {
    pub folder_id: String,
    #[serde(default)]
    pub is_origin: bool,
    #[serde(default)]
    pub last_seen: i64,
}

#[derive(Debug, Deserialize)]
struct PeersResponse {
    #[serde(default)]
    peers: Vec<SwarmPeer>,
}

pub fn calculate_blind_topic(package_id: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(b"magdrive-tracker-v1")
        .expect("HMAC can take key of any size");
    mac.update(package_id.as_bytes());
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

fn create_tracker_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap_or_default()
}

pub async fn announce_to_tracker(
    tracker_url: &str,
    topic: &str,
    folder_id: &str,
    is_origin: bool,
) -> Result<(), String> {
    let client = create_tracker_client();
    let base = tracker_url.trim_end_matches('/');
    let url = if base.ends_with("/api") {
        format!("{}/announce", base)
    } else {
        format!("{}/api/announce", base)
    };

    let body = serde_json::json!({
        "topic": topic,
        "folder_id": folder_id,
        "is_origin": is_origin
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Announce failed to {}: {}", url, e))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Announce to {} returned status {}",
            url,
            resp.status()
        ))
    }
}

pub async fn announce_to_trackers(
    tracker_urls: &[String],
    topic: &str,
    folder_id: &str,
    is_origin: bool,
) -> Vec<Result<(), String>> {
    let futures = tracker_urls
        .iter()
        .map(|tr| announce_to_tracker(tr, topic, folder_id, is_origin));
    join_all(futures).await
}

pub async fn fetch_peers_from_tracker(
    tracker_url: &str,
    topic: &str,
) -> Result<Vec<SwarmPeer>, String> {
    let client = create_tracker_client();
    let base = tracker_url.trim_end_matches('/');
    let url = if base.ends_with("/api") {
        format!("{}/peers?topic={}", base, topic)
    } else {
        format!("{}/api/peers?topic={}", base, topic)
    };

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Fetch peers failed from {}: {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Fetch peers from {} returned status {}",
            url,
            resp.status()
        ));
    }

    let data: PeersResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse peers json from {}: {}", url, e))?;

    Ok(data.peers)
}

pub async fn fetch_peers_multi(tracker_urls: &[String], topic: &str) -> Vec<String> {
    let futures = tracker_urls
        .iter()
        .map(|tr| fetch_peers_from_tracker(tr, topic));
    let results = join_all(futures).await;

    let mut origins = Vec::new();
    let mut mirrors = Vec::new();
    let mut seen = HashSet::new();

    for res in results {
        if let Ok(peers) = res {
            for peer in peers {
                if seen.insert(peer.folder_id.clone()) {
                    if peer.is_origin {
                        origins.push(peer.folder_id);
                    } else {
                        mirrors.push(peer.folder_id);
                    }
                }
            }
        }
    }

    // Return origins first, then mirrors
    origins.extend(mirrors);
    origins
}

pub async fn report_dead_to_tracker(
    tracker_url: &str,
    topic: &str,
    folder_id: &str,
) -> Result<(), String> {
    let client = create_tracker_client();
    let base = tracker_url.trim_end_matches('/');
    let url = if base.ends_with("/api") {
        format!("{}/report-dead", base)
    } else {
        format!("{}/api/report-dead", base)
    };

    let body = serde_json::json!({
        "topic": topic,
        "folder_id": folder_id
    });

    let _ = client.post(&url).json(&body).send().await;
    Ok(())
}

pub async fn report_dead_multi(tracker_urls: &[String], topic: &str, folder_id: &str) {
    let futures = tracker_urls
        .iter()
        .map(|tr| report_dead_to_tracker(tr, topic, folder_id));
    let _ = join_all(futures).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blind_topic_calculation() {
        let pkg_id_1 = "package_123456";
        let pkg_id_2 = "package_654321";

        let topic_1 = calculate_blind_topic(pkg_id_1);
        let topic_2 = calculate_blind_topic(pkg_id_2);

        assert_ne!(topic_1, topic_2);
        assert_eq!(topic_1.len(), 64); // SHA256 hex length
        assert_eq!(topic_1, calculate_blind_topic(pkg_id_1));
    }
}
