use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tiny_http::{Response, Server};

#[derive(Debug, thiserror::Error)]
pub enum OAuthError {
    #[error("Loopback server failed to bind: {0}")]
    ServerBindError(String),
    #[error("Callback timeout: user did not complete authentication in time")]
    Timeout,
    #[error("Missing code in callback request")]
    MissingCode,
    #[error("OAuth token exchange failed: {0}")]
    ExchangeFailed(String),
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("Invalid credentials")]
    InvalidCredentials,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpCredentials {
    pub client_id: String,
    pub client_secret: String,
}

pub struct PkceSession {
    pub verifier: String,
    pub challenge: String,
}

impl PkceSession {
    pub fn new() -> Self {
        let mut random_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut random_bytes);
        let verifier = URL_SAFE_NO_PAD.encode(random_bytes);

        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

        Self {
            verifier,
            challenge,
        }
    }
}

/// Spawns a loopback server, constructs auth URL, waits for code, and exchanges for tokens.
pub async fn start_oauth_flow(
    credentials: GcpCredentials,
) -> Result<(String, tokio::sync::oneshot::Receiver<Result<OAuthTokens, OAuthError>>), OAuthError> {
    let server = Server::http("127.0.0.1:0")
        .map_err(|e| OAuthError::ServerBindError(e.to_string()))?;
    let port = server.server_addr().to_ip().map(|addr| addr.port()).unwrap_or(8080);
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    let pkce = PkceSession::new();
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
        client_id={}&\
        redirect_uri={}&\
        response_type=code&\
        scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&\
        code_challenge={}&\
        code_challenge_method=S256&\
        access_type=offline&\
        prompt=consent",
        urlencoding::encode(&credentials.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&pkce.challenge)
    );

    let (tx, rx) = tokio::sync::oneshot::channel();

    // Spawn server listener in background thread
    std::thread::spawn(move || {
        let result = (|| -> Result<OAuthTokens, OAuthError> {
            let timeout = Duration::from_secs(180);
            let start = std::time::Instant::now();

            while start.elapsed() < timeout {
                if let Ok(Some(request)) = server.recv_timeout(Duration::from_millis(500)) {
                    let url_str = request.url().to_string();
                    if url_str.starts_with("/callback") {
                        let parsed_url = url::Url::parse(&format!("http://127.0.0.1{}", url_str))
                            .map_err(|_| OAuthError::MissingCode)?;
                        
                        let mut code_opt = None;
                        for (k, v) in parsed_url.query_pairs() {
                            if k == "code" {
                                code_opt = Some(v.to_string());
                                break;
                            }
                        }

                        let html_response = r#"<!DOCTYPE html>
<html>
<head><title>MagDrive - Authentication Successful</title>
<style>
body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; text-align: center; }
.card { padding: 40px; border-radius: 12px; background: #1e293b; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
h1 { color: #38bdf8; margin-bottom: 10px; }
p { color: #94a3b8; }
</style>
</head>
<body>
<div class="card">
  <h1>Authentication Successful</h1>
  <p>You can safely close this browser tab and return to the MagDrive desktop app.</p>
</div>
</body>
</html>"#;
                        let response = Response::from_string(html_response)
                            .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap());
                        let _ = request.respond(response);

                        if let Some(code) = code_opt {
                            // Synchronously exchange code using reqwest blocking or tokio runtime
                            let rt = tokio::runtime::Builder::new_current_thread()
                                .enable_all()
                                .build()
                                .map_err(|e| OAuthError::ExchangeFailed(e.to_string()))?;

                            return rt.block_on(exchange_code_for_tokens(
                                &credentials,
                                &code,
                                &pkce.verifier,
                                &redirect_uri,
                            ));
                        } else {
                            return Err(OAuthError::MissingCode);
                        }
                    }
                }
            }
            Err(OAuthError::Timeout)
        })();

        let _ = tx.send(result);
    });

    Ok((auth_url, rx))
}

pub async fn exchange_code_for_tokens(
    credentials: &GcpCredentials,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<OAuthTokens, OAuthError> {
    let client = reqwest::Client::new();
    let mut params = std::collections::HashMap::new();
    params.insert("client_id", credentials.client_id.as_str());
    if !credentials.client_secret.is_empty() {
        params.insert("client_secret", credentials.client_secret.as_str());
    }
    params.insert("code", code);
    params.insert("code_verifier", verifier);
    params.insert("grant_type", "authorization_code");
    params.insert("redirect_uri", redirect_uri);

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(OAuthError::ExchangeFailed(err_text));
    }

    let tokens: OAuthTokens = res.json().await?;
    Ok(tokens)
}

pub async fn refresh_access_token(
    credentials: &GcpCredentials,
    refresh_token: &str,
) -> Result<OAuthTokens, OAuthError> {
    let client = reqwest::Client::new();
    let mut params = std::collections::HashMap::new();
    params.insert("client_id", credentials.client_id.as_str());
    if !credentials.client_secret.is_empty() {
        params.insert("client_secret", credentials.client_secret.as_str());
    }
    params.insert("refresh_token", refresh_token);
    params.insert("grant_type", "refresh_token");

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(OAuthError::ExchangeFailed(err_text));
    }

    let tokens: OAuthTokens = res.json().await?;
    Ok(tokens)
}

// Simple urlencoding helper
mod urlencoding {
    pub fn encode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }
}
