//! Encrypted BYOK credential vault (Tenant AAD + Authenticated Envelope),
//! webhook signing, and cryptographic primitives.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::principal::SecurityError;

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
        let mut key = [0u8; 32];
        getrandom::fill(&mut key)
            .expect("OS randomness is required for the in-memory credential vault");
        Self::new(key)
    }
}

impl CredentialVault {
    #[must_use]
    pub fn new(master_kek: [u8; 32]) -> Self {
        Self { master_kek }
    }

    /// Loads a persistent 32-byte BYOK key from a 64-character hex or 32-byte base64 value.
    pub fn from_env() -> Result<Self, SecurityError> {
        let raw = std::env::var("BYOK_MASTER_KEY").map_err(|_| {
            SecurityError::InvalidCredentialSecret(
                "BYOK_MASTER_KEY is required for persistent storage".to_string(),
            )
        })?;
        Self::from_encoded(&raw)
    }

    fn from_encoded(raw: &str) -> Result<Self, SecurityError> {
        let trimmed = raw.trim();
        if trimmed.len() == 64 {
            if let Ok(bytes) = hex::decode(trimmed) {
                if let Ok(key) = <[u8; 32]>::try_from(bytes.as_slice()) {
                    return Ok(Self::new(key));
                }
            }
        }
        use base64::Engine as _;
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(trimmed) {
            if let Ok(key) = <[u8; 32]>::try_from(bytes.as_slice()) {
                return Ok(Self::new(key));
            }
        }
        Err(SecurityError::InvalidCredentialSecret(
            "BYOK_MASTER_KEY must be 32 bytes encoded as hex or base64".to_string(),
        ))
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

        let aad = Self::format_aad(
            expected_account_id,
            expected_credential_id,
            expected_version,
        );
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

#[must_use]
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[must_use]
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
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
    fn persistent_vault_requires_a_full_length_key() {
        let key = hex::encode([7u8; 32]);
        assert!(CredentialVault::from_encoded(&key).is_ok());
        assert!(CredentialVault::from_encoded("weak").is_err());
        assert!(CredentialVault::from_encoded("").is_err());
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

        assert_eq!(
            vault
                .open_credential(&sealed, "acct-2", "cred-1", 1)
                .unwrap_err(),
            SecurityError::VaultDecryptionFailed
        );

        assert_eq!(
            vault
                .open_credential(&sealed, "acct-1", "cred-1", 2)
                .unwrap_err(),
            SecurityError::VaultDecryptionFailed
        );

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
