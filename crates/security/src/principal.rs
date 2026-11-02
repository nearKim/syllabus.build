//! Principal roles, tenant identity boundaries, authentication verifier adapters,
//! and release-decision feature gates.

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
    #[must_use]
    pub fn is_local_dev_or_test(self) -> bool {
        matches!(self, AppEnvironment::Development | AppEnvironment::Test)
    }

    /// Resolves the runtime `AppEnvironment` from `APP_ENV` or `SYLLABUS_ENV`.
    /// An absent or unknown value uses Production so optional development paths stay disabled.
    #[must_use]
    pub fn from_env() -> Self {
        let raw = std::env::var("APP_ENV")
            .or_else(|_| std::env::var("SYLLABUS_ENV"))
            .unwrap_or_else(|_| "production".to_string());
        Self::parse_str(&raw)
    }

    #[must_use]
    pub fn parse_str(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "development" | "dev" => AppEnvironment::Development,
            "production" | "prod" => AppEnvironment::Production,
            "staging" | "stage" => AppEnvironment::Staging,
            "test" | "testing" => AppEnvironment::Test,
            _ => AppEnvironment::Production,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalRole {
    #[serde(
        alias = "learner",
        alias = "curator",
        alias = "moderator",
        alias = "operator"
    )]
    User,
    Admin,
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
    /// Admins do not gain access to another user's private state,
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
    #[error("fixed identity verifier is allowed only in Test, not `{0:?}`")]
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

/// Test-only fixed identity adapter for the Private Alpha tracer bullet (`T00`–`T04`).
///
/// **Security Invariant (`D11`):** Refuses to initialize outside `Test`.
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
        if env != AppEnvironment::Test {
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
                    roles: vec![PrincipalRole::User],
                    is_development_only_identity: true,
                })
            }
            Some("dev-admin") => Ok(AuthenticatedPrincipal {
                account_id: "00000000-0000-4000-8000-000000000099".to_string(),
                roles: vec![PrincipalRole::Admin],
                is_development_only_identity: true,
            }),
            Some("dev-default") => Ok(AuthenticatedPrincipal {
                account_id: self.default_account_id.clone(),
                roles: vec![PrincipalRole::User],
                is_development_only_identity: true,
            }),
            Some(_) => Err(SecurityError::Unauthenticated),
            None => Ok(AuthenticatedPrincipal {
                account_id: self.default_account_id.clone(),
                roles: vec![PrincipalRole::User],
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_environment_disables_development_paths() {
        assert_eq!(
            AppEnvironment::parse_str("development"),
            AppEnvironment::Development
        );
        assert_eq!(AppEnvironment::parse_str(""), AppEnvironment::Production);
        assert_eq!(
            AppEnvironment::parse_str("prodution"),
            AppEnvironment::Production
        );
    }

    #[test]
    fn fixed_identity_verifier_is_test_only() {
        assert!(DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Test,
            "00000000-0000-4000-8000-000000000001"
        )
        .is_ok());
        assert_eq!(
            DevFixedIdentityAuthVerifier::new(
                AppEnvironment::Development,
                "00000000-0000-4000-8000-000000000001"
            )
            .unwrap_err(),
            SecurityError::DevAuthForbiddenOutsideDev(AppEnvironment::Development)
        );
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
    fn admin_cannot_access_user_private_resource() {
        let verifier = DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Test,
            "00000000-0000-4000-8000-000000000001",
        )
        .unwrap();
        let admin = verifier.verify_bearer_token(Some("dev-admin")).unwrap();
        assert!(admin.has_role(PrincipalRole::Admin));
        assert!(admin.require_role(PrincipalRole::Admin).is_ok());
        assert!(!admin.can_access_learner_private_resource("00000000-0000-4000-8000-000000000001"));
        assert_eq!(
            admin
                .require_learner_ownership("00000000-0000-4000-8000-000000000001")
                .unwrap_err(),
            SecurityError::CrossTenantAccessDenied {
                principal_id: "00000000-0000-4000-8000-000000000099".to_string(),
                owner_id: "00000000-0000-4000-8000-000000000001".to_string(),
            }
        );
    }

    #[test]
    fn legacy_role_strings_downgrade_to_user() {
        let verifier = DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Test,
            "00000000-0000-4000-8000-000000000001",
        )
        .unwrap();
        assert!(verifier.verify_bearer_token(Some("dev-moderator")).is_err());
        for legacy in ["learner", "curator", "moderator", "operator"] {
            let role: PrincipalRole = serde_json::from_str(&format!("\"{legacy}\"")).unwrap();
            assert_eq!(role, PrincipalRole::User);
        }
    }

    #[test]
    fn deferred_release_gates_fail_closed_until_approved() {
        let gates = ReleaseFeatureGates::default();
        assert!(gates.require_d11_auth_and_kms().is_err());
        assert!(gates.require_d07_live_billing().is_err());
        assert!(gates.require_d16_public_sharing().is_err());
    }
}
