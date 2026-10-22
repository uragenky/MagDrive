use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::drive::oauth::GcpCredentials;
use crate::storage::db::Database;

#[derive(Debug, thiserror::Error)]
pub enum DriveError {
    #[error("API request failed with status {status}: {message}")]
    ApiError { status: u16, message: String },
    #[error("Rate limited (HTTP 429) after multiple retries")]
    RateLimited,
    #[error("File or directory not found: {0}")]
    NotFound(String),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("JSON serialization/deserialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Drive operation error: {0}")]
    General(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetType {
    SharedDrive,
    SharedFolder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageTarget {
    pub target_id: String,
    pub target_type: TargetType,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveFileItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub modified_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveAboutUser {
    pub display_name: String,
    pub email_address: String,
}

#[derive(Debug, Deserialize)]
struct DriveAboutResponse {
    user: DriveAboutUser,
}

#[derive(Debug, Deserialize)]
struct DriveFileListResponse {
    #[serde(default)]
    files: Vec<DriveFileItem>,
}

#[derive(Clone)]
pub struct DriveClient {
    pub client: reqwest::Client,
    pub access_token: Arc<Mutex<String>>,
    pub refresh_token: Option<String>,
    pub credentials: Option<GcpCredentials>,
    pub db: Option<Database>,
}

fn create_optimized_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .tcp_nodelay(true)
        .tcp_keepalive(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(32)
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_default()
}

impl DriveClient {
    pub fn new(access_token: String) -> Self {
        let client = create_optimized_http_client();
        Self {
            client,
            access_token: Arc::new(Mutex::new(access_token)),
            refresh_token: None,
            credentials: None,
            db: None,
        }
    }

    pub fn with_refresh(
        access_token: String,
        refresh_token: Option<String>,
        credentials: Option<GcpCredentials>,
        db: Option<Database>,
    ) -> Self {
        let client = create_optimized_http_client();
        Self {
            client,
            access_token: Arc::new(Mutex::new(access_token)),
            refresh_token,
            credentials,
            db,
        }
    }

    pub fn set_token(&mut self, token: String) {
        let mut lock = self.access_token.lock().unwrap();
        *lock = token;
    }

    pub fn auth_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        let token = self.access_token.lock().unwrap().clone();
        if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", token)) {
            headers.insert(AUTHORIZATION, val);
        }
        headers
    }

    pub async fn try_refresh_token(&self) -> bool {
        if let (Some(ref rt), Some(ref creds)) = (&self.refresh_token, &self.credentials) {
            match crate::drive::oauth::refresh_access_token(creds, rt).await {
                Ok(new_tokens) => {
                    {
                        let mut lock = self.access_token.lock().unwrap();
                        *lock = new_tokens.access_token.clone();
                    }
                    if let Some(ref db) = self.db {
                        let _ = db.set_setting("access_token", &new_tokens.access_token);
                        let new_expires_at = chrono::Utc::now().timestamp() + new_tokens.expires_in as i64;
                        let _ = db.set_setting("token_expires_at", &new_expires_at.to_string());
                        if let Some(ref new_rt) = new_tokens.refresh_token {
                            let _ = db.set_setting("refresh_token", new_rt);
                        }
                    }
                    return true;
                }
                Err(e) => {
                    eprintln!("Auto-refresh failed on 401: {}", e);
                }
            }
        }
        false
    }

    /// Finds a folder with `name` inside `parent_id` without creating it (read-only for peer inspection)
    pub async fn find_subfolder(&self, parent_id: &str, folder_name: &str) -> Result<Option<String>, DriveError> {
        let query = format!("'{}' in parents and name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", parent_id, folder_name);
        let list_url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true",
            url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>()
        );

        let mut res = self
            .client
            .get(&list_url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if res.status().as_u16() == 401 && self.try_refresh_token().await {
            res = self
                .client
                .get(&list_url)
                .headers(self.auth_headers())
                .send()
                .await?;
        }

        if res.status().is_success() {
            let list: DriveFileListResponse = res.json().await?;
            if let Some(first) = list.files.first() {
                return Ok(Some(first.id.clone()));
            }
        }
        Ok(None)
    }

    /// Finds or creates a folder with `name` inside `parent_id`
    pub async fn ensure_folder(&self, parent_id: &str, folder_name: &str) -> Result<String, DriveError> {
        // First check if folder exists
        let query = format!("'{}' in parents and name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", parent_id, folder_name);
        let list_url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true",
            url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>()
        );

        let mut res = self
            .client
            .get(&list_url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if res.status().as_u16() == 401 && self.try_refresh_token().await {
            res = self
                .client
                .get(&list_url)
                .headers(self.auth_headers())
                .send()
                .await?;
        }

        if res.status().is_success() {
            let list: DriveFileListResponse = res.json().await?;
            if let Some(first) = list.files.first() {
                return Ok(first.id.clone());
            }
        }

        // Folder doesn't exist, create it
        let create_url = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true";
        let body = serde_json::json!({
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id]
        });

        let mut create_res = self
            .client
            .post(create_url)
            .headers(self.auth_headers())
            .json(&body)
            .send()
            .await?;

        if create_res.status().as_u16() == 401 && self.try_refresh_token().await {
            create_res = self
                .client
                .post(create_url)
                .headers(self.auth_headers())
                .json(&body)
                .send()
                .await?;
        }

        let status = create_res.status();
        if !status.is_success() {
            let msg = create_res.text().await.unwrap_or_default();
            return Err(DriveError::ApiError {
                status: status.as_u16(),
                message: msg,
            });
        }

        let created_file: DriveFileItem = create_res.json().await?;
        Ok(created_file.id)
    }

    /// Uploads a binary chunk or metadata file using multipart upload
    pub async fn upload_file(
        &self,
        parent_folder_id: &str,
        file_name: &str,
        data: &[u8],
    ) -> Result<String, DriveError> {
        let boundary = format!("BOUNDARY_{}", uuid::Uuid::new_v4().simple());
        let mut body = Vec::new();

        // Part 1: Metadata JSON
        let metadata = serde_json::json!({
            "name": file_name,
            "parents": [parent_folder_id],
            "mimeType": "application/octet-stream"
        });
        let meta_str = serde_json::to_string(&metadata)?;

        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
        body.extend_from_slice(meta_str.as_bytes());
        body.extend_from_slice(b"\r\n");

        // Part 2: Media binary
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(data);
        body.extend_from_slice(b"\r\n");

        // End boundary
        body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

        let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";

        let mut attempts = 0;
        let mut delay_ms = 1000u64;

        loop {
            attempts += 1;
            let mut headers = self.auth_headers();
            headers.insert(
                CONTENT_TYPE,
                HeaderValue::from_str(&format!("multipart/related; boundary={}", boundary)).unwrap(),
            );

            let res = self
                .client
                .post(url)
                .headers(headers)
                .body(body.clone())
                .send()
                .await;

            match res {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        let item: DriveFileItem = response.json().await?;
                        return Ok(item.id);
                    } else if status.as_u16() == 401 && attempts <= 2 {
                        if self.try_refresh_token().await {
                            continue;
                        } else {
                            let msg = response.text().await.unwrap_or_default();
                            return Err(DriveError::ApiError {
                                status: 401,
                                message: msg,
                            });
                        }
                    } else if status.as_u16() == 429 || status.is_server_error() {
                        if attempts >= 5 {
                            return Err(DriveError::RateLimited);
                        }
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        delay_ms *= 2;
                    } else {
                        let msg = response.text().await.unwrap_or_default();
                        return Err(DriveError::ApiError {
                            status: status.as_u16(),
                            message: msg,
                        });
                    }
                }
                Err(e) => {
                    if attempts >= 5 {
                        return Err(DriveError::Network(e));
                    }
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    delay_ms *= 2;
                }
            }
        }
    }

    /// Downloads binary file content (alt=media)
    pub async fn download_file(&self, file_id: &str) -> Result<Vec<u8>, DriveError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?alt=media&supportsAllDrives=true",
            file_id
        );

        let mut attempts = 0;
        let mut delay_ms = 1000u64;

        loop {
            attempts += 1;
            let res = self
                .client
                .get(&url)
                .headers(self.auth_headers())
                .send()
                .await;

            match res {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        let bytes = response.bytes().await?;
                        return Ok(bytes.to_vec());
                    } else if status.as_u16() == 401 && attempts <= 2 {
                        if self.try_refresh_token().await {
                            continue;
                        } else {
                            let msg = response.text().await.unwrap_or_default();
                            return Err(DriveError::ApiError {
                                status: 401,
                                message: msg,
                            });
                        }
                    } else if status.as_u16() == 404 {
                        return Err(DriveError::NotFound(file_id.to_string()));
                    } else if status.as_u16() == 429 || status.is_server_error() {
                        if attempts >= 5 {
                            return Err(DriveError::RateLimited);
                        }
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        delay_ms *= 2;
                    } else {
                        let msg = response.text().await.unwrap_or_default();
                        return Err(DriveError::ApiError {
                            status: status.as_u16(),
                            message: msg,
                        });
                    }
                }
                Err(e) => {
                    if attempts >= 5 {
                        return Err(DriveError::Network(e));
                    }
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    delay_ms *= 2;
                }
            }
        }
    }

    /// Lists files inside a specific directory
    pub async fn list_files_in_folder(&self, folder_id: &str) -> Result<Vec<DriveFileItem>, DriveError> {
        let query = format!("'{}' in parents and trashed = false", folder_id);
        let url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name,size,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true",
            url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>()
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

        let list_res: DriveFileListResponse = res.json().await?;
        Ok(list_res.files)
    }

    /// Deletes a file permanently from Google Drive
    pub async fn delete_file(&self, file_id: &str) -> Result<(), DriveError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?supportsAllDrives=true",
            file_id
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

    /// Server-side copy of a file directly to a destination folder without downloading to client
    pub async fn copy_file(
        &self,
        file_id: &str,
        destination_folder_id: &str,
        new_name: Option<&str>,
    ) -> Result<DriveFileItem, DriveError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/copy?supportsAllDrives=true",
            file_id
        );

        let mut payload = serde_json::json!({
            "parents": [destination_folder_id]
        });

        if let Some(name) = new_name {
            payload["name"] = serde_json::json!(name);
        }

        let mut attempts = 0;
        let mut delay_ms = 1000u64;

        loop {
            attempts += 1;
            let mut headers = self.auth_headers();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

            let res = self
                .client
                .post(&url)
                .headers(headers)
                .json(&payload)
                .send()
                .await;

            match res {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        let item: DriveFileItem = response.json().await?;
                        return Ok(item);
                    } else if status.as_u16() == 401 && attempts <= 2 {
                        if self.try_refresh_token().await {
                            continue;
                        } else {
                            let msg = response.text().await.unwrap_or_default();
                            return Err(DriveError::ApiError {
                                status: 401,
                                message: msg,
                            });
                        }
                    } else if status.as_u16() == 404 {
                        return Err(DriveError::NotFound(file_id.to_string()));
                    } else if status.as_u16() == 429 || status.is_server_error() {
                        if attempts >= 5 {
                            return Err(DriveError::RateLimited);
                        }
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        delay_ms *= 2;
                    } else {
                        let msg = response.text().await.unwrap_or_default();
                        return Err(DriveError::ApiError {
                            status: status.as_u16(),
                            message: msg,
                        });
                    }
                }
                Err(e) => {
                    if attempts >= 5 {
                        return Err(DriveError::Network(e));
                    }
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    delay_ms *= 2;
                }
            }
        }
    }

    /// Sets a folder's permission to Public Viewer (anyone with link can read)
    pub async fn set_folder_public_viewer(&self, folder_id: &str) -> Result<(), DriveError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions?supportsAllDrives=true",
            folder_id
        );

        let payload = serde_json::json!({
            "role": "reader",
            "type": "anyone"
        });

        let mut headers = self.auth_headers();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let mut res = self
            .client
            .post(&url)
            .headers(headers.clone())
            .json(&payload)
            .send()
            .await?;

        if res.status().as_u16() == 401 && self.try_refresh_token().await {
            res = self
                .client
                .post(&url)
                .headers(self.auth_headers())
                .json(&payload)
                .send()
                .await?;
        }

        let status = res.status();
        if status.is_success() {
            Ok(())
        } else {
            let msg = res.text().await.unwrap_or_default();
            Err(DriveError::ApiError {
                status: status.as_u16(),
                message: msg,
            })
        }
    }

    /// Fetches the authenticated user's profile info (display name and email address)
    pub async fn get_user_profile(&self) -> Result<DriveAboutUser, DriveError> {
        let url = "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)";

        let mut res = self
            .client
            .get(url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if res.status().as_u16() == 401 && self.try_refresh_token().await {
            res = self
                .client
                .get(url)
                .headers(self.auth_headers())
                .send()
                .await?;
        }

        let status = res.status();
        if status.is_success() {
            let about: DriveAboutResponse = res.json().await?;
            Ok(about.user)
        } else {
            let msg = res.text().await.unwrap_or_default();
            Err(DriveError::ApiError {
                status: status.as_u16(),
                message: msg,
            })
        }
    }
}
