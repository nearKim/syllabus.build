//! Provider-neutral authentication boundary (`AuthVerifier`), development-only fixed
//! identity adapter (`DevFixedIdentityAuthVerifier`), role isolation, and deferred
//! release-decision feature gates (`D07`, `D11`, `D15`, `D16`, `CTRL-001`).

pub mod oauth;
pub mod principal;
pub mod vault;

pub use oauth::{
    compute_pkce_s256_challenge, hash_password, resolve_oauth_provider_statuses, verify_password,
    verify_pkce_s256, OAuthProvider, OAuthProviderStatus,
};
pub use principal::{
    AppEnvironment, AuthVerifier, AuthenticatedPrincipal, DevFixedIdentityAuthVerifier,
    PrincipalRole, ReleaseFeatureGates, SecurityError,
};
pub use vault::{
    compute_webhook_hmac_sha256, constant_time_eq, hmac_sha256, sha256_digest,
    verify_webhook_hmac_sha256, CredentialVault, SealedCredentialEnvelope,
};
