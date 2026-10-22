use serde::{Deserialize, Serialize};
use crate::drive::client::TargetType;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VaultRole {
    #[serde(rename = "admin")]
    Admin,
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "viewer")]
    Viewer,
}

impl std::fmt::Display for VaultRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VaultRole::Admin => write!(f, "admin"),
            VaultRole::Member => write!(f, "member"),
            VaultRole::Viewer => write!(f, "viewer"),
        }
    }
}

impl std::str::FromStr for VaultRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "admin" => Ok(VaultRole::Admin),
            "member" => Ok(VaultRole::Member),
            "viewer" => Ok(VaultRole::Viewer),
            _ => Err(format!("Unknown role: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTarget {
    pub target_id: String,
    pub target_type: TargetType,
    pub label: String,
    #[serde(default)]
    pub account_email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultRecord {
    pub id: String,
    pub name: String,
    pub role: VaultRole,
    pub salt_hex: String,
    pub targets: Vec<VaultTarget>,
    pub verification_tag: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultExportPayload {
    pub version: u32,
    pub vault_id: String,
    pub vault_name: String,
    pub role: VaultRole,
    pub targets: Vec<VaultTarget>,
    pub salt_hex: String,
    pub verification_tag: String,
}
