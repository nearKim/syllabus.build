//! Provider-neutral authentication boundary (`AuthVerifier`), development-only fixed
//! identity adapter (`DevFixedIdentityAuthVerifier`), role isolation, and deferred
//! release-decision feature gates (`D07`, `D11`, `D15`, `D16`, `CTRL-001`).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub mod oauth;

pub use oauth::{
    compute_pkce_s256_challenge, hash_password, resolve_oauth_provider_statuses,
    verify_password, verify_pkce_s256, OAuthProvider, OAuthProviderStatus,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppEnvironment {
    Development,
    Test,
    Staging,
    Production,
}

impl AppEnvironment {
    #[must_use]
    pub fn is_local_dev_or_test(self) -> bool {
        matches!(self, AppEnvironment::Development | AppEnvironment::Test)
    }

    /// Resolves the runtime `AppEnvironment` from `APP_ENV` (falling back to `NODE_ENV` or `Development`).
    #[must_use]
    pub fn from_env() -> Self {
        let raw = std::env::var("APP_ENV")
            .or_else(|_| std::env::var("SYLLABUS_ENV"))
            .unwrap_or_else(|_| "development".to_string());
        Self::parse_str(&raw)
    }

    #[must_use]
    pub fn parse_str(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "production" | "prod" => AppEnvironment::Production,
            "staging" | "stage" => AppEnvironment::Staging,
            "test" | "testing" => AppEnvironment::Test,
            _ => AppEnvironment::Development,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalRole {
    Learner,
    Curator,
    Moderator,
    Operator,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticatedPrincipal {
    pub account_id: String,
    pub roles: Vec<PrincipalRole>,
    pub is_development_only_identity: bool,
}

impl AuthenticatedPrincipal {
    #[must_use]
    pub fn has_role(&self, role: PrincipalRole) -> bool {
        self.roles.contains(&role)
    }

    /// Enforces strict tenant isolation (`NFR-001`, `@S36`, `@S64`):
    /// Curators, moderators, and operators do not gain access to another learner's private state,
    /// assessment evidence, schedules, or BYOK credentials.
    #[must_use]
    pub fn can_access_learner_private_resource(&self, resource_owner_account_id: &str) -> bool {
        self.account_id == resource_owner_account_id
    }

    /// Requires strict account ownership for private learner resources (`@S29`, `@S36`, `@S64`, `@S87`).
    pub fn require_learner_ownership(
        &self,
        resource_owner_account_id: &str,
    ) -> Result<(), SecurityError> {
        if self.can_access_learner_private_resource(resource_owner_account_id) {
            Ok(())
        } else {
            Err(SecurityError::CrossTenantAccessDenied {
                principal_id: self.account_id.clone(),
                owner_id: resource_owner_account_id.to_string(),
            })
        }
    }

    /// Checks role boundary for privileged administrative/curation/moderation operations (`CTRL-022`, `@S36`, `@S64`).
    pub fn require_role(&self, required_role: PrincipalRole) -> Result<(), SecurityError> {
        if self.has_role(required_role) {
            Ok(())
        } else {
            Err(SecurityError::InsufficientRolePrivilege {
                principal_id: self.account_id.clone(),
                required_role,
            })
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SecurityError {
    #[error("development-only fixed identity verifier is forbidden in `{0:?}` environment (`D11` production auth gate required)")]
    DevAuthForbiddenOutsideDev(AppEnvironment),
    #[error("missing or invalid authentication token")]
    Unauthenticated,
    #[error("cross-tenant access denied: principal `{principal_id}` cannot access resource owned by `{owner_id}`")]
    CrossTenantAccessDenied {
        principal_id: String,
        owner_id: String,
    },
    #[error("insufficient role privilege: principal `{principal_id}` lacks required role `{required_role:?}`")]
    InsufficientRolePrivilege {
        principal_id: String,
        required_role: PrincipalRole,
    },
    #[error("release decision gate `{gate_id}` ({description}) is not approved for `{env:?}`")]
    ReleaseGateBlocked {
        gate_id: &'static str,
        description: &'static str,
        env: AppEnvironment,
    },
    #[error("invalid credential secret: {0}")]
    InvalidCredentialSecret(String),
    #[error("credential vault authentication or AAD verification failed")]
    VaultDecryptionFailed,
    #[error("invalid payment webhook HMAC-SHA256 signature: {0}")]
    InvalidWebhookSignature(String),
    #[error("invalid OAuth 2.0 grant or PKCE parameter: {0}")]
    InvalidOAuthGrant(String),
}

/// Provider-neutral HTTP/domain authentication verifier (`D11`).
pub trait AuthVerifier: Send + Sync {
    fn verify_bearer_token(
        &self,
        bearer_token: Option<&str>,
    ) -> Result<AuthenticatedPrincipal, SecurityError>;
}

/// Development-only fixed identity adapter for the Private Alpha tracer bullet (`T00`–`T04`).
///
/// **Security Invariant (`D11`):** Refuses to initialize in `Staging` or `Production`.
/// Any internet-facing beta, BYOK storage (`T07A`), hosted billing (`T07B`/`T07D`), or
/// public publishing (`T13`) is blocked until the `D11` production authentication vendor
/// is approved and configured.
#[derive(Debug, Clone)]
pub struct DevFixedIdentityAuthVerifier {
    default_account_id: String,
}

impl DevFixedIdentityAuthVerifier {
    pub fn new(
        env: AppEnvironment,
        default_account_id: impl Into<String>,
    ) -> Result<Self, SecurityError> {
        if !env.is_local_dev_or_test() {
            return Err(SecurityError::DevAuthForbiddenOutsideDev(env));
        }
        Ok(Self {
            default_account_id: default_account_id.into(),
        })
    }
}

impl AuthVerifier for DevFixedIdentityAuthVerifier {
    fn verify_bearer_token(
        &self,
        bearer_token: Option<&str>,
    ) -> Result<AuthenticatedPrincipal, SecurityError> {
        match bearer_token {
            Some("invalid" | "expired" | "revoked" | "unauthenticated" | "") => {
                Err(SecurityError::Unauthenticated)
            }
            Some(token) if token.starts_with("dev-account:") => {
                let id = token.trim_start_matches("dev-account:").to_string();
                if id.is_empty() {
                    return Err(SecurityError::Unauthenticated);
                }
                Ok(AuthenticatedPrincipal {
                    account_id: id,
                    roles: vec![PrincipalRole::Learner],
                    is_development_only_identity: true,
                })
            }
            Some("dev-curator") => Ok(AuthenticatedPrincipal {
                account_id: "00000000-0000-4000-8000-000000000099".to_string(),
                roles: vec![PrincipalRole::Curator],
                is_development_only_identity: true,
            }),
            Some("dev-moderator") => Ok(AuthenticatedPrincipal {
                account_id: "00000000-0000-4000-8000-000000000098".to_string(),
                roles: vec![PrincipalRole::Moderator],
                is_development_only_identity: true,
            }),
            Some("dev-operator") => Ok(AuthenticatedPrincipal {
                account_id: "00000000-0000-4000-8000-000000000097".to_string(),
                roles: vec![PrincipalRole::Operator],
                is_development_only_identity: true,
            }),
            Some("dev-default") => Ok(AuthenticatedPrincipal {
                account_id: self.default_account_id.clone(),
                roles: vec![PrincipalRole::Learner],
                is_development_only_identity: true,
            }),
            Some(_) => Err(SecurityError::Unauthenticated),
            None => Ok(AuthenticatedPrincipal {
                account_id: self.default_account_id.clone(),
                roles: vec![PrincipalRole::Learner],
                is_development_only_identity: true,
            }),
        }
    }
}

/// Explicit release-decision gates (`CTRL-001`) keeping unresolved owner decisions visible
/// and blocking production activation until approved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseFeatureGates {
    pub env: AppEnvironment,
    /// `D11`: Production cloud, secret-manager, and authentication vendor approved.
    pub d11_production_auth_approved: bool,
    /// `D07`: Commercial pricing, payment/tax vendor, and refund/expiration terms approved.
    pub d07_live_billing_enabled: bool,
    /// `D16`: Final public-syllabus content license text and retention windows approved.
    pub d16_public_sharing_enabled: bool,
    /// `D15`: OSI-approved Apache-2.0 open-source license and contributor terms approved.
    pub d15_operative_license_approved: bool,
}

impl Default for ReleaseFeatureGates {
    fn default() -> Self {
        Self {
            env: AppEnvironment::Development,
            d11_production_auth_approved: false,
            d07_live_billing_enabled: false,
            d16_public_sharing_enabled: false,
            d15_operative_license_approved: false,
        }
    }
}

impl ReleaseFeatureGates {
    #[must_use]
    fn env_flag_enabled(var_name: &str) -> bool {
        std::env::var(var_name).ok().is_some_and(|raw| {
            matches!(
                raw.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "approved" | "enabled"
            )
        })
    }

    /// Loads `ReleaseFeatureGates` from environment variables (`APP_ENV`, `GATE_D11_*`, `GATE_D07_*`, `GATE_D16_*`, `GATE_D15_*`).
    #[must_use]
    pub fn from_env() -> Self {
        Self {
            env: AppEnvironment::from_env(),
            d11_production_auth_approved: Self::env_flag_enabled(
                "GATE_D11_PRODUCTION_AUTH_APPROVED",
            ),
            d07_live_billing_enabled: Self::env_flag_enabled("GATE_D07_LIVE_BILLING_ENABLED"),
            d16_public_sharing_enabled: Self::env_flag_enabled("GATE_D16_PUBLIC_SHARING_ENABLED"),
            d15_operative_license_approved: Self::env_flag_enabled(
                "GATE_D15_OPERATIVE_LICENSE_APPROVED",
            ),
        }
    }

    pub fn require_d11_auth_and_kms(&self) -> Result<(), SecurityError> {
        if self.d11_production_auth_approved {
            Ok(())
        } else {
            Err(SecurityError::ReleaseGateBlocked {
                gate_id: "D11",
                description: "Production authentication vendor and KMS custody required before internet-facing beta, BYOK storage, hosted billing, or public publishing",
                env: self.env,
            })
        }
    }

    pub fn require_d07_live_billing(&self) -> Result<(), SecurityError> {
        self.require_d11_auth_and_kms()?;
        if self.d07_live_billing_enabled {
            Ok(())
        } else {
            Err(SecurityError::ReleaseGateBlocked {
                gate_id: "D07",
                description: "Commercial pricing, payment vendor, and failed-generation refund terms required before live checkout",
                env: self.env,
            })
        }
    }

    pub fn require_d16_public_sharing(&self) -> Result<(), SecurityError> {
        self.require_d11_auth_and_kms()?;
        if self.d16_public_sharing_enabled {
            Ok(())
        } else {
            Err(SecurityError::ReleaseGateBlocked {
                gate_id: "D16",
                description: "Final public-syllabus content license text and retention periods required before production public publishing",
                env: self.env,
            })
        }
    }
}

// =============================================================================
// T07A: Encrypted BYOK Credential Vault (Tenant AAD + Authenticated Envelope)
// =============================================================================

/// Encrypted BYOK credential envelope persisted at rest (`T07A`, `BILL-002`..`BILL-007`, `NFR-006`).
/// Never stores or serializes the raw API key; binds ciphertext to `account_id | credential_id | version`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SealedCredentialEnvelope {
    pub account_id: String,
    pub credential_id: String,
    pub version: u64,
    pub key_last4_redacted: String,
    pub key_fingerprint_sha256: String,
    pub ciphertext_hex: String,
    pub nonce_hex: String,
    pub auth_tag_hex: String,
}

/// Authenticated envelope vault for BYOK provider API keys (`T07A`, `NFR-006`).
#[derive(Clone)]
pub struct CredentialVault {
    master_kek: [u8; 32],
}

impl std::fmt::Debug for CredentialVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialVault")
            .field("master_kek", &"[REDACTED]")
            .finish()
    }
}

impl Default for CredentialVault {
    fn default() -> Self {
        Self::from_env()
    }
}

impl CredentialVault {
    #[must_use]
    pub fn new(master_kek: [u8; 32]) -> Self {
        Self { master_kek }
    }

    /// Resolves a 32-byte BYOK Key-Encryption-Key from `BYOK_MASTER_KEY` (64-char hex,
    /// 32-byte base64, or SHA-256 digest of a passphrase), falling back to the local dev KEK.
    #[must_use]
    pub fn from_env() -> Self {
        if let Ok(raw) = std::env::var("BYOK_MASTER_KEY") {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                if trimmed.len() == 64 {
                    if let Ok(bytes) = hex::decode(trimmed) {
                        if let Ok(arr) = <[u8; 32]>::try_from(bytes.as_slice()) {
                            return Self::new(arr);
                        }
                    }
                }
                use base64::Engine as _;
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(trimmed) {
                    if let Ok(arr) = <[u8; 32]>::try_from(bytes.as_slice()) {
                        return Self::new(arr);
                    }
                }
                return Self::new(sha256_digest(trimmed.as_bytes()));
            }
        }
        Self::new(*b"syllabus-local-vault-kek-32bytes")
    }

    /// Formats a redacted suffix (`...XXXX`) suitable for metadata responses (`BILL-003`, `NFR-006`).
    pub fn redact_secret_suffix(raw_api_key: &str) -> Result<String, SecurityError> {
        let trimmed = raw_api_key.trim();
        if trimmed.len() < 8 {
            return Err(SecurityError::InvalidCredentialSecret(
                "API key must be at least 8 characters long".to_string(),
            ));
        }
        let tail_start = trimmed
            .char_indices()
            .rev()
            .nth(3)
            .map_or(0, |(idx, _)| idx);
        let tail = &trimmed[tail_start..];
        Ok(format!("...{tail}"))
    }

    /// Seals a raw API key into an authenticated `SealedCredentialEnvelope` bound to
    /// `account_id`, `credential_id`, and `version` as Additional Authenticated Data (`AAD`).
    pub fn seal_credential(
        &self,
        account_id: &str,
        credential_id: &str,
        version: u64,
        raw_api_key: &str,
    ) -> Result<SealedCredentialEnvelope, SecurityError> {
        let trimmed = raw_api_key.trim();
        let key_last4_redacted = Self::redact_secret_suffix(trimmed)?;
        let key_fingerprint_sha256 = hex::encode(sha256_digest(trimmed.as_bytes()));

        // Deterministic per-record 16-byte nonce derived from KEK + AAD + key fingerprint so
        // rotating a key or bumping version produces a distinct nonce and ciphertext.
        let aad = Self::format_aad(account_id, credential_id, version);
        let mut nonce_material = Vec::new();
        nonce_material.extend_from_slice(b"nonce-v1|");
        nonce_material.extend_from_slice(&aad);
        nonce_material.extend_from_slice(b"|");
        nonce_material.extend_from_slice(key_fingerprint_sha256.as_bytes());
        let nonce_full = hmac_sha256(&self.master_kek, &nonce_material);
        let nonce = &nonce_full[..16];

        let enc_subkey = hmac_sha256(&self.master_kek, b"enc-subkey-v1");
        let mac_subkey = hmac_sha256(&self.master_kek, b"mac-subkey-v1");

        let ciphertext = xor_keystream(&enc_subkey, nonce, &aad, trimmed.as_bytes());
        let auth_tag = compute_envelope_mac(&mac_subkey, nonce, &aad, &ciphertext);

        Ok(SealedCredentialEnvelope {
            account_id: account_id.to_string(),
            credential_id: credential_id.to_string(),
            version,
            key_last4_redacted,
            key_fingerprint_sha256,
            ciphertext_hex: hex::encode(&ciphertext),
            nonce_hex: hex::encode(nonce),
            auth_tag_hex: hex::encode(auth_tag),
        })
    }

    /// Opens and authenticates a `SealedCredentialEnvelope`, verifying that the caller's
    /// `(expected_account_id, expected_credential_id, expected_version)` match the AAD and MAC tag.
    pub fn open_credential(
        &self,
        envelope: &SealedCredentialEnvelope,
        expected_account_id: &str,
        expected_credential_id: &str,
        expected_version: u64,
    ) -> Result<String, SecurityError> {
        if envelope.account_id != expected_account_id
            || envelope.credential_id != expected_credential_id
            || envelope.version != expected_version
        {
            return Err(SecurityError::VaultDecryptionFailed);
        }

        let nonce =
            hex::decode(&envelope.nonce_hex).map_err(|_| SecurityError::VaultDecryptionFailed)?;
        if nonce.len() != 16 {
            return Err(SecurityError::VaultDecryptionFailed);
        }
        let ciphertext = hex::decode(&envelope.ciphertext_hex)
            .map_err(|_| SecurityError::VaultDecryptionFailed)?;
        let expected_tag = hex::decode(&envelope.auth_tag_hex)
            .map_err(|_| SecurityError::VaultDecryptionFailed)?;
        if expected_tag.len() != 32 {
            return Err(SecurityError::VaultDecryptionFailed);
        }

        let aad = Self::format_aad(expected_account_id, expected_credential_id, expected_version);
        let enc_subkey = hmac_sha256(&self.master_kek, b"enc-subkey-v1");
        let mac_subkey = hmac_sha256(&self.master_kek, b"mac-subkey-v1");

        let actual_tag = compute_envelope_mac(&mac_subkey, &nonce, &aad, &ciphertext);
        if !constant_time_eq(&actual_tag, &expected_tag) {
            return Err(SecurityError::VaultDecryptionFailed);
        }

        let plaintext_bytes = xor_keystream(&enc_subkey, &nonce, &aad, &ciphertext);
        String::from_utf8(plaintext_bytes).map_err(|_| SecurityError::VaultDecryptionFailed)
    }

    fn format_aad(account_id: &str, credential_id: &str, version: u64) -> Vec<u8> {
        format!("aad-v1|acct={account_id}|cred={credential_id}|ver={version}").into_bytes()
    }
}

fn xor_keystream(enc_subkey: &[u8; 32], nonce: &[u8], aad: &[u8], input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    for (block_idx, chunk) in input.chunks(32).enumerate() {
        let mut counter_msg = Vec::with_capacity(nonce.len() + aad.len() + 16);
        counter_msg.extend_from_slice(nonce);
        counter_msg.extend_from_slice(b"|");
        counter_msg.extend_from_slice(aad);
        counter_msg.extend_from_slice(b"|");
        counter_msg.extend_from_slice(&(block_idx as u64).to_be_bytes());
        let stream_block = hmac_sha256(enc_subkey, &counter_msg);
        for (i, &b) in chunk.iter().enumerate() {
            out.push(b ^ stream_block[i]);
        }
    }
    out
}

fn compute_envelope_mac(
    mac_subkey: &[u8; 32],
    nonce: &[u8],
    aad: &[u8],
    ciphertext: &[u8],
) -> [u8; 32] {
    let mut mac_input = Vec::with_capacity(nonce.len() + aad.len() + ciphertext.len() + 24);
    mac_input.extend_from_slice(b"mac-v1|");
    mac_input.extend_from_slice(&(nonce.len() as u64).to_be_bytes());
    mac_input.extend_from_slice(nonce);
    mac_input.extend_from_slice(&(aad.len() as u64).to_be_bytes());
    mac_input.extend_from_slice(aad);
    mac_input.extend_from_slice(&(ciphertext.len() as u64).to_be_bytes());
    mac_input.extend_from_slice(ciphertext);
    hmac_sha256(mac_subkey, &mac_input)
}

pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub(crate) fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut k_block = [0u8; 64];
    if key.len() > 64 {
        let hashed = sha256_digest(key);
        k_block[..32].copy_from_slice(&hashed);
    } else {
        k_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= k_block[i];
        opad[i] ^= k_block[i];
    }
    let mut inner = Vec::with_capacity(64 + message.len());
    inner.extend_from_slice(&ipad);
    inner.extend_from_slice(message);
    let inner_hash = sha256_digest(&inner);

    let mut outer = Vec::with_capacity(64 + 32);
    outer.extend_from_slice(&opad);
    outer.extend_from_slice(&inner_hash);
    sha256_digest(&outer)
}

/// Computes lowercase 64-character hex HMAC-SHA256 signature for payment webhook payloads (`T07D`, `BILL-005`).
#[must_use]
pub fn compute_webhook_hmac_sha256(secret: &[u8], payload: &[u8]) -> String {
    let mac = hmac_sha256(secret, payload);
    hex::encode(mac)
}

/// Verifies a payment webhook HMAC-SHA256 signature header against the raw payload using constant-time comparison (`T07D`, `@S67`, `@S68`).
/// Accepts raw 64-char hex or prefixed formats `sha256=<hex>` / `v1=<hex>`.
pub fn verify_webhook_hmac_sha256(
    secret: &[u8],
    payload: &[u8],
    signature_header: &str,
) -> Result<String, SecurityError> {
    let trimmed = signature_header.trim();
    if trimmed.is_empty() {
        return Err(SecurityError::InvalidWebhookSignature(
            "missing webhook signature header".to_string(),
        ));
    }
    let normalized = trimmed
        .strip_prefix("sha256=")
        .or_else(|| trimmed.strip_prefix("v1="))
        .unwrap_or(trimmed);
    let provided_bytes = hex::decode(normalized).map_err(|_| {
        SecurityError::InvalidWebhookSignature(
            "webhook signature is not valid hex encoding".to_string(),
        )
    })?;
    if provided_bytes.len() != 32 {
        return Err(SecurityError::InvalidWebhookSignature(
            "webhook signature must be 32 bytes (64 hex chars)".to_string(),
        ));
    }
    let expected = hmac_sha256(secret, payload);
    if !constant_time_eq(&provided_bytes, &expected) {
        return Err(SecurityError::InvalidWebhookSignature(
            "HMAC-SHA256 digest mismatch".to_string(),
        ));
    }
    Ok(hex::encode(expected))
}

/// FIPS 180-4 SHA-256 digest used by `CredentialVault`.
#[must_use]
pub fn sha256_digest(input: &[u8]) -> [u8; 32] {
    Sha256::digest(input).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_fixed_identity_verifier_refuses_staging_and_production() {
        assert!(DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Development,
            "00000000-0000-4000-8000-000000000001"
        )
        .is_ok());
        assert_eq!(
            DevFixedIdentityAuthVerifier::new(
                AppEnvironment::Production,
                "00000000-0000-4000-8000-000000000001"
            )
            .unwrap_err(),
            SecurityError::DevAuthForbiddenOutsideDev(AppEnvironment::Production)
        );
    }

    #[test]
    fn s36_curator_cannot_access_learner_private_resource() {
        let verifier = DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Test,
            "00000000-0000-4000-8000-000000000001",
        )
        .unwrap();
        let curator = verifier.verify_bearer_token(Some("dev-curator")).unwrap();
        assert!(curator.has_role(PrincipalRole::Curator));
        assert!(curator.require_role(PrincipalRole::Curator).is_ok());
        assert!(
            !curator.can_access_learner_private_resource("00000000-0000-4000-8000-000000000001")
        );
        assert_eq!(
            curator
                .require_learner_ownership("00000000-0000-4000-8000-000000000001")
                .unwrap_err(),
            SecurityError::CrossTenantAccessDenied {
                principal_id: "00000000-0000-4000-8000-000000000099".to_string(),
                owner_id: "00000000-0000-4000-8000-000000000001".to_string(),
            }
        );
    }

    #[test]
    fn s64_moderator_cannot_access_learner_private_evidence_or_credentials() {
        let verifier = DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Test,
            "00000000-0000-4000-8000-000000000001",
        )
        .unwrap();
        let moderator = verifier.verify_bearer_token(Some("dev-moderator")).unwrap();
        assert!(moderator.has_role(PrincipalRole::Moderator));
        assert!(moderator.require_role(PrincipalRole::Moderator).is_ok());
        assert!(moderator.require_role(PrincipalRole::Curator).is_err());
        assert!(
            !moderator.can_access_learner_private_resource("00000000-0000-4000-8000-000000000001")
        );
    }

    #[test]
    fn deferred_release_gates_fail_closed_until_approved() {
        let gates = ReleaseFeatureGates::default();
        assert!(gates.require_d11_auth_and_kms().is_err());
        assert!(gates.require_d07_live_billing().is_err());
        assert!(gates.require_d16_public_sharing().is_err());
    }

    #[test]
    fn t07a_credential_vault_encrypts_decrypts_and_rejects_cross_tenant_or_version_tampering() {
        let vault = CredentialVault::default();
        let raw_secret = "sk-proj-secret-openai-key-9876";
        let sealed = vault
            .seal_credential("acct-1", "cred-1", 1, raw_secret)
            .expect("seal succeeds");

        assert_eq!(sealed.key_last4_redacted, "...9876");
        assert!(!sealed.ciphertext_hex.contains("secret"));
        let debug_str = format!("{:?}", sealed);
        assert!(!debug_str.contains(raw_secret));

        let opened = vault
            .open_credential(&sealed, "acct-1", "cred-1", 1)
            .expect("valid AAD decrypts");
        assert_eq!(opened, raw_secret);

        // Wrong tenant AAD fails authentication
        assert_eq!(
            vault
                .open_credential(&sealed, "acct-2", "cred-1", 1)
                .unwrap_err(),
            SecurityError::VaultDecryptionFailed
        );

        // Wrong credential version AAD fails authentication
        assert_eq!(
            vault
                .open_credential(&sealed, "acct-1", "cred-1", 2)
                .unwrap_err(),
            SecurityError::VaultDecryptionFailed
        );

        // Tampered ciphertext fails MAC tag verification
        let mut tampered = sealed.clone();
        tampered.ciphertext_hex.replace_range(0..2, "ff");
        if tampered.ciphertext_hex == sealed.ciphertext_hex {
            tampered.ciphertext_hex.replace_range(0..2, "00");
        }
        assert_eq!(
            vault
                .open_credential(&tampered, "acct-1", "cred-1", 1)
                .unwrap_err(),
            SecurityError::VaultDecryptionFailed
        );
    }

    #[test]
    fn rfc7636_pkce_s256_challenge_and_oauth_authorization_url() {
        // RFC 7636 Appendix B official test vector:
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = compute_pkce_s256_challenge(verifier).expect("valid RFC 7636 verifier");
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert!(verify_pkce_s256(verifier, &challenge));
        assert!(!verify_pkce_s256(
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXl",
            &challenge
        ));
        assert!(compute_pkce_s256_challenge("too-short").is_err());

        let url = OAuthProvider::Google
            .build_authorization_url(
                "client-123",
                "http://127.0.0.1:3000/auth/oauth/google/callback",
                "state-xyz",
                &challenge,
                None,
            )
            .expect("build Google authorize URL");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains(&format!("code_challenge={challenge}")));
    }

    #[test]
    fn pbkdf2_password_hash_and_constant_time_verify() {
        let encoded =
            hash_password("CorrectHorseBatteryStaple!", b"syllabus-salt-01").expect("hash");
        assert!(encoded.starts_with("pbkdf2-sha256$10000$"));
        assert!(verify_password("CorrectHorseBatteryStaple!", &encoded));
        assert!(!verify_password("WrongPassword123!", &encoded));
        assert!(hash_password("short", b"syllabus-salt-01").is_err());
    }
}
