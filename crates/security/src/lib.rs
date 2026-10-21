//! Provider-neutral authentication boundary (`AuthVerifier`), development-only fixed
//! identity adapter (`DevFixedIdentityAuthVerifier`), role isolation, and deferred
//! release-decision feature gates (`D07`, `D11`, `D15`, `D16`, `CTRL-001`).

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppEnvironment {
    Development,
    Test,
    Staging,
    Production,
}

impl AppEnvironment {
    pub fn is_local_dev_or_test(self) -> bool {
        matches!(self, AppEnvironment::Development | AppEnvironment::Test)
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
    pub fn has_role(&self, role: PrincipalRole) -> bool {
        self.roles.contains(&role)
    }

    /// Enforces strict tenant isolation (`NFR-001`, `@S36`, `@S64`):
    /// Curators, moderators, and operators do not gain access to another learner's private state,
    /// assessment evidence, schedules, or BYOK credentials.
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
    /// `D16`: Final public-curriculum content license text and retention windows approved.
    pub d16_public_sharing_enabled: bool,
    /// `D15`: Final operative custom personal-use license and contributor agreement approved.
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
                description: "Final public-curriculum content license text and retention periods required before production public publishing",
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
        Self::new(*b"curriculum-dev-vault-kek-32bytes")
    }
}

impl CredentialVault {
    pub fn new(master_kek: [u8; 32]) -> Self {
        Self { master_kek }
    }

    /// Formats a redacted suffix (`...XXXX`) suitable for metadata responses (`BILL-003`, `NFR-006`).
    pub fn redact_secret_suffix(raw_api_key: &str) -> Result<String, SecurityError> {
        let trimmed = raw_api_key.trim();
        if trimmed.len() < 8 {
            return Err(SecurityError::InvalidCredentialSecret(
                "API key must be at least 8 characters long".to_string(),
            ));
        }
        let tail: String = trimmed
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
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
        let key_last4_redacted = Self::redact_secret_secret_inner(trimmed)?;
        let key_fingerprint_sha256 = hex_encode(&sha256_digest(trimmed.as_bytes()));

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
            ciphertext_hex: hex_encode(&ciphertext),
            nonce_hex: hex_encode(nonce),
            auth_tag_hex: hex_encode(&auth_tag),
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

        let nonce = hex_decode(&envelope.nonce_hex).ok_or(SecurityError::VaultDecryptionFailed)?;
        if nonce.len() != 16 {
            return Err(SecurityError::VaultDecryptionFailed);
        }
        let ciphertext =
            hex_decode(&envelope.ciphertext_hex).ok_or(SecurityError::VaultDecryptionFailed)?;
        let expected_tag =
            hex_decode(&envelope.auth_tag_hex).ok_or(SecurityError::VaultDecryptionFailed)?;
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

    fn redact_secret_secret_inner(trimmed: &str) -> Result<String, SecurityError> {
        Self::redact_secret_suffix(trimmed)
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

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(&mut s, "{b:02x}");
    }
    s
}

fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(hex.len() / 2);
    for idx in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[idx..idx + 2], 16).ok()?;
        out.push(byte);
    }
    Some(out)
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
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
pub fn compute_webhook_hmac_sha256(secret: &[u8], payload: &[u8]) -> String {
    let mac = hmac_sha256(secret, payload);
    hex_encode(&mac)
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
    let provided_bytes = hex_decode(normalized).ok_or_else(|| {
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
    Ok(hex_encode(&expected))
}

/// FIPS 180-4 SHA-256 digest used by `CredentialVault`.
pub fn sha256_digest(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (input.len() as u64) * 8;
    let mut padded = input.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..(i + 1) * 4].copy_from_slice(&word.to_be_bytes());
    }
    out
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
}
