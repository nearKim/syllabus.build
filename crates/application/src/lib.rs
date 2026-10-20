//! Application use-case orchestration layer connecting domain invariants,
//! contract validation, security boundaries, persistence, and inference providers.

use curriculum_contracts::generated::CANONICAL_SPEC_SHA256;
use curriculum_security::ReleaseFeatureGates;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemReadinessReport {
    pub status: String,
    pub release_tier: String,
    pub canonical_spec_sha256: String,
    pub release_gates: ReleaseFeatureGates,
}

pub fn build_readiness_report(gates: ReleaseFeatureGates) -> SystemReadinessReport {
    SystemReadinessReport {
        status: "ok".to_string(),
        release_tier: "private_alpha_t00".to_string(),
        canonical_spec_sha256: CANONICAL_SPEC_SHA256.to_string(),
        release_gates: gates,
    }
}
