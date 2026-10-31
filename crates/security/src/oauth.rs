//! Standard OAuth 2.0 Authorization Code + PKCE (`S256`) and password hashing primitives.

use std::str::FromStr;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{constant_time_eq, hmac_sha256, sha256_digest, SecurityError};

const PBKDF2_ITERATIONS: u32 = 10_000;
const MIN_PASSWORD_LEN: usize = 8;

/// Supported first-party OAuth 2.0 / OIDC identity providers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OAuthProvider {
    Google,
    Github,
}

impl OAuthProvider {
    /// Canonical lowercase provider slug used in routes and database records.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Github => "github",
        }
    }

    /// Human-readable provider label for UI display.
    #[must_use]
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Google => "Google",
            Self::Github => "GitHub",
        }
    }

    /// Upstream OAuth 2.0 authorization endpoint URL.
    #[must_use]
    pub const fn authorize_url(self) -> &'static str {
        match self {
            Self::Google => "https://accounts.google.com/o/oauth2/v2/auth",
            Self::Github => "https://github.com/login/oauth/authorize",
        }
    }

    /// Upstream OAuth 2.0 token exchange endpoint URL.
    #[must_use]
    pub const fn token_url(self) -> &'static str {
        match self {
            Self::Google => "https://oauth2.googleapis.com/token",
            Self::Github => "https://github.com/login/oauth/access_token",
        }
    }

    /// Upstream OIDC / OAuth 2.0 user profile endpoint URL.
    #[must_use]
    pub const fn userinfo_url(self) -> &'static str {
        match self {
            Self::Google => "https://openidconnect.googleapis.com/v1/userinfo",
            Self::Github => "https://api.github.com/user",
        }
    }

    /// Space-delimited OAuth 2.0 scopes for email + basic profile sign-in.
    #[must_use]
    pub const fn default_scopes(self) -> &'static str {
        match self {
            Self::Google => "openid email profile",
            Self::Github => "read:user user:email",
        }
    }

    /// Constructs the RFC 6749 + RFC 7636 (`S256`) authorization redirect URL.
    pub fn build_authorization_url(
        self,
        client_id: &str,
        redirect_uri: &str,
        state: &str,
        code_challenge: &str,
        override_authorize_url: Option<&str>,
    ) -> Result<String, SecurityError> {
        if client_id.trim().is_empty() || redirect_uri.trim().is_empty() || state.trim().is_empty()
        {
            return Err(SecurityError::InvalidOAuthGrant(
                "client_id, redirect_uri, and state must be non-empty".to_string(),
            ));
        }
        if code_challenge.trim().is_empty() {
            return Err(SecurityError::InvalidOAuthGrant(
                "PKCE code_challenge must be non-empty".to_string(),
            ));
        }

        let base = override_authorize_url.unwrap_or_else(|| self.authorize_url());
        let mut url = Url::parse(base).map_err(|err| {
            SecurityError::InvalidOAuthGrant(format!("invalid authorize URL `{base}`: {err}"))
        })?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("client_id", client_id.trim());
            pairs.append_pair("redirect_uri", redirect_uri.trim());
            pairs.append_pair("response_type", "code");
            pairs.append_pair("scope", self.default_scopes());
            pairs.append_pair("state", state.trim());
            pairs.append_pair("code_challenge", code_challenge.trim());
            pairs.append_pair("code_challenge_method", "S256");
            if self == Self::Google && override_authorize_url.is_none() {
                pairs.append_pair("prompt", "select_account");
            }
        }
        Ok(url.into())
    }
}

impl FromStr for OAuthProvider {
    type Err = SecurityError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "google" => Ok(Self::Google),
            "github" => Ok(Self::Github),
            other => Err(SecurityError::InvalidOAuthGrant(format!(
                "unsupported OAuth provider `{other}`"
            ))),
        }
    }
}

/// Environment-driven OAuth 2.0 client configuration for Google and GitHub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthProviderStatus {
    pub provider: OAuthProvider,
    pub display_name: String,
    pub configured_live: bool,
    pub dev_sandbox_enabled: bool,
    pub start_path: String,
    pub callback_url: String,
}

/// Resolves configured OAuth 2.0 providers from process environment variables.
#[must_use]
pub fn resolve_oauth_provider_statuses(
    public_web_origin: &str,
    is_local_dev: bool,
) -> Vec<OAuthProviderStatus> {
    let origin = public_web_origin.trim_end_matches('/');
    let google_live = std::env::var("GOOGLE_CLIENT_ID")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .is_some()
        && std::env::var("GOOGLE_CLIENT_SECRET")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .is_some();
    let github_live = std::env::var("GITHUB_CLIENT_ID")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .is_some()
        && std::env::var("GITHUB_CLIENT_SECRET")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .is_some();

    vec![
        OAuthProviderStatus {
            provider: OAuthProvider::Google,
            display_name: OAuthProvider::Google.display_name().to_string(),
            configured_live: google_live,
            dev_sandbox_enabled: !google_live && is_local_dev,
            start_path: "/auth/oauth/google".to_string(),
            callback_url: format!("{origin}/auth/oauth/google/callback"),
        },
        OAuthProviderStatus {
            provider: OAuthProvider::Github,
            display_name: OAuthProvider::Github.display_name().to_string(),
            configured_live: github_live,
            dev_sandbox_enabled: !github_live && is_local_dev,
            start_path: "/auth/oauth/github".to_string(),
            callback_url: format!("{origin}/auth/oauth/github/callback"),
        },
    ]
}

/// Computes an RFC 7636 `S256` PKCE `code_challenge` (`BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`).
pub fn compute_pkce_s256_challenge(code_verifier: &str) -> Result<String, SecurityError> {
    let len = code_verifier.len();
    if !(43..=128).contains(&len) {
        return Err(SecurityError::InvalidOAuthGrant(
            "PKCE code_verifier must be between 43 and 128 ASCII characters".to_string(),
        ));
    }
    let digest = sha256_digest(code_verifier.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(digest))
}

/// Verifies an RFC 7636 `S256` PKCE `code_verifier` against an expected `code_challenge` in constant time.
#[must_use]
pub fn verify_pkce_s256(code_verifier: &str, expected_challenge: &str) -> bool {
    let Ok(actual) = compute_pkce_s256_challenge(code_verifier) else {
        return false;
    };
    constant_time_eq(actual.as_bytes(), expected_challenge.trim().as_bytes())
}

/// Derives a 32-byte RFC 8018 PBKDF2-HMAC-SHA256 key block (`dkLen = 32`).
fn pbkdf2_hmac_sha256_block(password: &[u8], salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut salt_block = Vec::with_capacity(salt.len() + 4);
    salt_block.extend_from_slice(salt);
    salt_block.extend_from_slice(&1u32.to_be_bytes());

    let mut u = hmac_sha256(password, &salt_block);
    let mut out = u;
    for _ in 1..iterations {
        u = hmac_sha256(password, &u);
        for (dst, &src) in out.iter_mut().zip(u.iter()) {
            *dst ^= src;
        }
    }
    out
}

/// Hashes a user password with PBKDF2-HMAC-SHA256 (`pbkdf2-sha256$<iterations>$<salt_hex>$<dk_hex>`).
pub fn hash_password(password: &str, salt: &[u8]) -> Result<String, SecurityError> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(SecurityError::InvalidCredentialSecret(format!(
            "password must be at least {MIN_PASSWORD_LEN} characters"
        )));
    }
    if salt.len() < 8 {
        return Err(SecurityError::InvalidCredentialSecret(
            "password salt must be at least 8 bytes".to_string(),
        ));
    }
    let dk = pbkdf2_hmac_sha256_block(password.as_bytes(), salt, PBKDF2_ITERATIONS);
    Ok(format!(
        "pbkdf2-sha256${PBKDF2_ITERATIONS}${}${}",
        hex::encode(salt),
        hex::encode(dk)
    ))
}

/// Verifies a plaintext password against a `pbkdf2-sha256$<iterations>$<salt_hex>$<dk_hex>` hash in constant time.
#[must_use]
pub fn verify_password(password: &str, encoded_hash: &str) -> bool {
    let mut parts = encoded_hash.split('$');
    let Some("pbkdf2-sha256") = parts.next() else {
        return false;
    };
    let Some(iter_raw) = parts.next() else {
        return false;
    };
    let Ok(iterations) = iter_raw.parse::<u32>() else {
        return false;
    };
    if iterations == 0 || iterations > 500_000 {
        return false;
    }
    let Some(salt_hex) = parts.next() else {
        return false;
    };
    let Some(expected_hex) = parts.next() else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    let (Ok(salt), Ok(expected)) = (hex::decode(salt_hex), hex::decode(expected_hex)) else {
        return false;
    };
    if expected.len() != 32 {
        return false;
    }
    let actual = pbkdf2_hmac_sha256_block(password.as_bytes(), &salt, iterations);
    constant_time_eq(&actual, &expected)
}
