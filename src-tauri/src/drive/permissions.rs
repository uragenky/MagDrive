use serde::{Deserialize, Serialize};
use super::client::{DriveClient, DriveError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrivePermissionItem {
    pub id: String,
    #[serde(rename = "type")]
    pub perm_type: String, // "user", "group", "domain", "anyone"
    pub role: String,      // "organizer", "fileOrganizer", "writer", "commenter", "reader"
    #[serde(default)]
    pub email_address: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub photo_link: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PermissionListResponse {
    #[serde(default)]
    permissions: Vec<DrivePermissionItem>,
}

impl DriveClient {
    /// Lists all permissions on a Shared Drive or Shared Folder
    pub async fn list_permissions(&self, target_id: &str) -> Result<Vec<DrivePermissionItem>, DriveError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions?fields=permissions(id,type,role,emailAddress,displayName,photoLink)&supportsAllDrives=true&pageSize=100",
            target_id
        );

        let mut res = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if res.status().as_u16() == 401 && self.try_refresh_token().await {
            res = self
                .client
                .get(&url)
                .headers(self.auth_headers())
                .send()
                .await?;
        }

        let status = res.status();
        if !status.is_success() {
            let msg = res.text().await.unwrap_or_default();
            return Err(DriveError::ApiError {
                status: status.as_u16(),
                message: msg,
            });
        }

        let list_res: PermissionListResponse = res.json().await?;
        Ok(list_res.permissions)
    }

    /// Adds a member to a Shared Drive or Folder directly
    pub async fn add_permission(
        &self,
        target_id: &str,
        email: &str,
        role: &str, // "fileOrganizer" (Manager/Contributor), "writer", "reader"
    ) -> Result<DrivePermissionItem, DriveError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions?supportsAllDrives=true&sendNotificationEmail=false",
            target_id
        );

        let body = serde_json::json!({
            "role": role,
            "type": "user",
            "emailAddress": email
        });

        let mut res = self
            .client
            .post(&url)
            .headers(self.auth_headers())
            .json(&body)
            .send()
            .await?;

        if res.status().as_u16() == 401 && self.try_refresh_token().await {
            res = self
                .client
                .post(&url)
                .headers(self.auth_headers())
                .json(&body)
                .send()
                .await?;
        }

        let status = res.status();
        if !status.is_success() {
            let msg = res.text().await.unwrap_or_default();
            return Err(DriveError::ApiError {
                status: status.as_u16(),
                message: msg,
            });
        }

        let perm: DrivePermissionItem = res.json().await?;
        Ok(perm)
    }

    /// Revokes a member permission from a Shared Drive or Folder
    pub async fn remove_permission(&self, target_id: &str, permission_id: &str) -> Result<(), DriveError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions/{}?supportsAllDrives=true",
            target_id, permission_id
        );

        let mut res = self
            .client
            .delete(&url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if res.status().as_u16() == 401 && self.try_refresh_token().await {
            res = self
                .client
                .delete(&url)
                .headers(self.auth_headers())
                .send()
                .await?;
        }

        let status = res.status();
        if status.is_success() || status.as_u16() == 404 {
            Ok(())
        } else {
            let msg = res.text().await.unwrap_or_default();
            Err(DriveError::ApiError {
                status: status.as_u16(),
                message: msg,
            })
        }
    }
}
