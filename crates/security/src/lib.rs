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
}
