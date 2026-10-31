//! Persistence domain records, error types, and HTTP concurrency precondition helpers.

use std::collections::{BTreeMap, BTreeSet};

use syllabus_contracts::generated::{OpenApiOperationDescriptor, OPENAPI_OPERATIONS};
use syllabus_security::{PrincipalRole, SecurityError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::*;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PersistenceError {
    #[error("security error: {0}")]
    Security(#[from] SecurityError),

    #[error("resource `{resource_type}` with id `{resource_id}` was not found")]
    NotFound {
        resource_type: &'static str,
        resource_id: String,
    },

    #[error("missing required If-Match precondition header (`428 Precondition Required`)")]
    PreconditionRequired,

    #[error("stale revision precondition failed (`412 Precondition Failed`): expected `{expected_etag}`, actual `{actual_etag}`")]
    PreconditionFailed {
        expected_etag: String,
        actual_etag: String,
    },

    #[error("missing required Idempotency-Key header for retriable command `{operation_id}`")]
    IdempotencyKeyRequired { operation_id: String },

    #[error("idempotency key `{idempotency_key}` for operation `{operation_id}` was reused with a different request payload (`409 Conflict`)")]
    IdempotencyPayloadMismatch {
        operation_id: String,
        idempotency_key: String,
    },

    #[error("idempotency key `{idempotency_key}` for operation `{operation_id}` already has an in-flight request (`409 Conflict`)")]
    IdempotencyInFlight {
        operation_id: String,
        idempotency_key: String,
    },

    #[error("progress event `{event_id}` was already recorded with a conflicting payload (`409 Conflict`)")]
    ConflictingProgressEventPayload { event_id: String },

    #[error("identifier namespace violation: {0}")]
    IdentifierNamespaceViolation(String),

    #[error("public projection contains prohibited private field `{field}` (`SHARE-002`, `@S57`)")]
    ProhibitedPrivateFieldInPublicProjection { field: String },

    #[error("duplicate public template revision content `{content_sha256}` for publication `{publication_id}` (`SHARE-007`, `@S61`)")]
    DuplicatePublicRevisionContent {
        publication_id: String,
        content_sha256: String,
    },

    #[error("model or client payload cannot assign server-owned field `{field}` (`T01`, `@S09`)")]
    ForbiddenClientOrModelAssignedField { field: String },

    #[error("synthetic fixture `{resource_version_id}` is forbidden in production catalog retrieval (`CAT-001`, `@S09`)")]
    SyntheticFixtureForbiddenInProduction { resource_version_id: String },

    #[error("resource `{resource_version_id}` operation `{operation}` is not permitted: {reason} (`CAT-003`, `@S05`)")]
    ResourceOperationNotPermitted {
        resource_version_id: String,
        operation: String,
        reason: String,
    },

    #[error("unsafe or restricted egress URL `{url}` rejected: {reason} (`CTRL-032`, `@S08`, `@S31`, `@S35`)")]
    UnsafeEgressUrlRejected { url: String, reason: String },

    #[error("catalog approval rubric evidence missing for `{resource_id}`: {reason} (`CAT-002`, `@S04`)")]
    MissingReviewRubricEvidence { resource_id: String, reason: String },

    #[error("ineligible catalog resource `{resource_version_id}`: {reason} (`CAT-004`, `@S06`, `@S10`)")]
    IneligibleCatalogResource {
        resource_version_id: String,
        reason: String,
    },

    #[error("insufficient catalog coverage for required objectives: {missing_objective_ids:?} (`GEN-006`, `@S13`)")]
    InsufficientCatalogCoverage { missing_objective_ids: Vec<String> },

    #[error("invalid model candidate output (`{code}`): {message} (`GEN-004`, `@S11`, `@S12`)")]
    InvalidModelCandidate { code: String, message: String },

    #[error("conflict (`{code}`): {message}")]
    Conflict { code: &'static str, message: String },

    #[error("payment or hosted credit required (`{code}`): {message}")]
    PaymentRequired { code: &'static str, message: String },

    #[error("validation error: {0}")]
    Validation(String),
}

impl PersistenceError {
    #[must_use]
    pub fn http_status_code(&self) -> u16 {
        match self {
            PersistenceError::Security(
                SecurityError::Unauthenticated
                | SecurityError::InvalidWebhookSignature(_)
                | SecurityError::InvalidOAuthGrant(_),
            ) => 401,
            PersistenceError::PaymentRequired { .. } => 402,
            PersistenceError::Security(
                SecurityError::CrossTenantAccessDenied { .. }
                | SecurityError::InsufficientRolePrivilege { .. }
                | SecurityError::DevAuthForbiddenOutsideDev(_)
                | SecurityError::ReleaseGateBlocked { .. }
                | SecurityError::VaultDecryptionFailed,
            )
            | PersistenceError::ResourceOperationNotPermitted { .. } => 403,
            PersistenceError::NotFound { .. } => 404,
            PersistenceError::IdempotencyPayloadMismatch { .. }
            | PersistenceError::IdempotencyInFlight { .. }
            | PersistenceError::ConflictingProgressEventPayload { .. }
            | PersistenceError::DuplicatePublicRevisionContent { .. }
            | PersistenceError::Conflict { .. } => 409,
            PersistenceError::PreconditionFailed { .. } => 412,
            PersistenceError::Security(SecurityError::InvalidCredentialSecret(_))
            | PersistenceError::IdentifierNamespaceViolation(_)
            | PersistenceError::ProhibitedPrivateFieldInPublicProjection { .. }
            | PersistenceError::ForbiddenClientOrModelAssignedField { .. }
            | PersistenceError::SyntheticFixtureForbiddenInProduction { .. }
            | PersistenceError::UnsafeEgressUrlRejected { .. }
            | PersistenceError::MissingReviewRubricEvidence { .. }
            | PersistenceError::IneligibleCatalogResource { .. }
            | PersistenceError::InsufficientCatalogCoverage { .. }
            | PersistenceError::InvalidModelCandidate { .. }
            | PersistenceError::Validation(_) => 422,
            PersistenceError::PreconditionRequired => 428,
            PersistenceError::IdempotencyKeyRequired { .. } => 400,
        }
    }

    #[must_use]
    pub fn error_code(&self) -> &'static str {
        match self {
            PersistenceError::Security(SecurityError::Unauthenticated) => "unauthenticated",
            PersistenceError::Security(SecurityError::InvalidWebhookSignature(_)) => {
                "invalid_webhook_signature"
            }
            PersistenceError::Security(SecurityError::InvalidOAuthGrant(_)) => {
                "invalid_oauth_grant"
            }
            PersistenceError::PaymentRequired { code, .. } => code,
            PersistenceError::Security(SecurityError::CrossTenantAccessDenied { .. }) => {
                "cross_tenant_forbidden"
            }
            PersistenceError::Security(SecurityError::InsufficientRolePrivilege { .. }) => {
                "insufficient_role_privilege"
            }
            PersistenceError::Security(SecurityError::InvalidCredentialSecret(_)) => {
                "invalid_credential_secret"
            }
            PersistenceError::Security(SecurityError::VaultDecryptionFailed) => {
                "vault_decryption_failed"
            }
            PersistenceError::Security(_) => "security_gate_blocked",
            PersistenceError::NotFound { .. } => "not_found",
            PersistenceError::PreconditionRequired => "precondition_required",
            PersistenceError::PreconditionFailed { .. } => "stale_revision",
            PersistenceError::IdempotencyKeyRequired { .. } => "idempotency_key_required",
            PersistenceError::IdempotencyPayloadMismatch { .. } => "idempotency_payload_mismatch",
            PersistenceError::IdempotencyInFlight { .. } => "idempotency_in_flight",
            PersistenceError::ConflictingProgressEventPayload { .. } => {
                "progress_event_payload_mismatch"
            }
            PersistenceError::Conflict { code, .. } => code,
            PersistenceError::IdentifierNamespaceViolation(_) => "identifier_namespace_violation",
            PersistenceError::ProhibitedPrivateFieldInPublicProjection { .. } => {
                "prohibited_private_field_in_public_projection"
            }
            PersistenceError::DuplicatePublicRevisionContent { .. } => {
                "duplicate_public_revision_content"
            }
            PersistenceError::ForbiddenClientOrModelAssignedField { .. } => {
                "forbidden_client_or_model_field"
            }
            PersistenceError::SyntheticFixtureForbiddenInProduction { .. } => {
                "synthetic_fixture_forbidden"
            }
            PersistenceError::ResourceOperationNotPermitted { .. } => "resource_permission_denied",
            PersistenceError::UnsafeEgressUrlRejected { .. } => "unsafe_egress_url",
            PersistenceError::MissingReviewRubricEvidence { .. } => "missing_review_rubric_evidence",
            PersistenceError::IneligibleCatalogResource { .. } => "ineligible_resources",
            PersistenceError::InsufficientCatalogCoverage { .. } => "insufficient_catalog_coverage",
            PersistenceError::InvalidModelCandidate { .. } => "invalid_model_output",
            PersistenceError::Validation(_) => "validation_error",
        }
    }
}

/// Evaluates an HTTP `If-Match` precondition header against the current resource ETag (`T01`, `@S22`, `@S24`).
pub fn evaluate_if_match(
    provided_if_match: Option<&str>,
    current_etag: &str,
) -> Result<(), PersistenceError> {
    let raw = provided_if_match
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(PersistenceError::PreconditionRequired)?;

    if raw.trim().trim_matches('"') == current_etag.trim().trim_matches('"') {
        Ok(())
    } else {
        Err(PersistenceError::PreconditionFailed {
            expected_etag: raw.to_string(),
            actual_etag: current_etag.to_string(),
        })
    }
}

/// Looks up the canonical OpenAPI concurrency descriptor for `operation_id`.
#[must_use]
pub fn lookup_operation_concurrency_policy(
    operation_id: &str,
) -> Option<&'static OpenApiOperationDescriptor> {
    OPENAPI_OPERATIONS
        .iter()
        .find(|op| op.operation_id == operation_id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdempotencyKeyState {
    InFlight,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredIdempotentResponse {
    pub status_code: u16,
    pub body: Value,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdempotencyRecord {
    pub account_id: String,
    pub operation_id: String,
    pub idempotency_key: String,
    pub request_sha256: String,
    pub state: IdempotencyKeyState,
    pub response_status: Option<u16>,
    pub response_body: Option<Value>,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdempotencyBeginOutcome {
    Acquired,
    Replayed(StoredIdempotentResponse),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountRecord {
    pub account_id: String,
    pub email: String,
    pub email_verified: bool,
    pub roles: Vec<PrincipalRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing)]
    pub password_hash: Option<String>,
    pub deleted_at_ms: Option<u64>,
}

/// Federated OAuth 2.0 / OIDC identity linked to a local `AccountRecord`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthIdentityRecord {
    pub provider: syllabus_security::OAuthProvider,
    pub provider_subject: String,
    pub account_id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

/// Outcome of an OAuth 2.0 callback exchange (`login` or automatic `signup` + account linking).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthLoginOutcome {
    pub account: AccountRecord,
    pub session: AuthSessionRecord,
    pub is_new_account: bool,
    pub provider: syllabus_security::OAuthProvider,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthSessionRecord {
    pub session_id: String,
    pub token: String,
    pub token_sha256: String,
    pub account_id: String,
    pub roles: Vec<PrincipalRole>,
    pub expires_at: String,
    pub revoked: bool,
}

/// Private learner syllabus revision (`SHARE-001`, `SHARE-002`, `NFR-007`).
/// Stored in a strictly separate identifier and table space from `PublicTemplateRevisionRecord`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusRevisionRecord {
    pub revision_id: String,
    pub syllabus_id: String,
    pub owner_account_id: String,
    pub revision_number: u32,
    pub candidate_sha256: String,
    pub payload: Value,
    pub is_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicVisibility {
    Public,
    Unlisted,
}

/// Public or unlisted template revision stored in a separate identifier space (`pub_`, `pubrev_`)
/// and separate projection table (`SHARE-001`, `SHARE-002`, `SHARE-007`, `CTRL-070`, `@S56`, `@S57`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicTemplateRevisionRecord {
    pub publication_revision_id: String,
    pub publication_id: String,
    pub publisher_account_id: String,
    pub source_private_revision_id: String,
    pub visibility: PublicVisibility,
    pub content_sha256: String,
    pub preview_sha256: String,
    pub public_payload: Value,
    pub upvote_count: u64,
    pub quarantined: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleFeasibility {
    Feasible,
    Infeasible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScheduledSessionItem {
    pub session_id: String,
    pub activity_id: String,
    pub duration_minutes: u32,
    pub is_review: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScheduleRevisionRecord {
    pub schedule_revision_id: String,
    pub syllabus_id: String,
    pub owner_account_id: String,
    pub syllabus_revision_id: String,
    pub etag_version: u64,
    pub etag: String,
    pub timezone: String,
    pub weekly_available_minutes: u32,
    pub required_minutes: u32,
    pub fixed_deadline: bool,
    pub feasibility_status: ScheduleFeasibility,
    pub excess_minutes: u32,
    pub recovery_options: Vec<String>,
    pub sessions: Vec<ScheduledSessionItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchedulePatchInput {
    pub timezone: Option<String>,
    pub weekly_available_minutes: Option<u32>,
    pub required_minutes: Option<u32>,
    pub fixed_deadline: Option<bool>,
    pub sessions: Option<Vec<ScheduledSessionItem>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressEventInput {
    pub event_id: String,
    pub syllabus_id: String,
    pub activity_id: String,
    pub objective_id: Option<String>,
    pub status: ActivityExecutionStatus,
    pub time_spent_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredProgressEvent {
    pub account_id: String,
    pub event_id: String,
    pub syllabus_id: String,
    pub activity_id: String,
    pub objective_id: String,
    pub status: ActivityExecutionStatus,
    pub time_spent_minutes: u32,
    pub evidence_origin: EvidenceOrigin,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressEventReceiptRecord {
    pub event_id: String,
    pub syllabus_id: String,
    pub activity_id: String,
    pub status: ActivityExecutionStatus,
    pub time_spent_minutes: u32,
    pub evidence_origin: EvidenceOrigin,
    pub objective_proficiency_status: ObjectiveProficiencyState,
    pub replayed: bool,
    pub total_completed_activities: usize,
    pub total_skipped_activities: usize,
    pub total_time_spent_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LearnerProficiencyProjection {
    pub account_id: String,
    pub objectives: BTreeMap<String, ObjectiveProficiencyState>,
    pub completed_activities: BTreeSet<String>,
    pub skipped_activities: BTreeSet<String>,
    pub total_time_spent_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredCredentialRecord {
    pub credential_ref: String,
    pub owner_account_id: String,
    pub provider_id: String,
    pub label: String,
    pub masked_hint: String,
    pub key_fingerprint_sha256: String,
    pub version: u64,
    pub etag: String,
    pub revoked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialMetadataView {
    pub credential_ref: String,
    pub provider_id: String,
    pub label: String,
    pub masked_hint: String,
    pub version: u64,
    pub etag: String,
    pub status: String,
}

impl From<&StoredCredentialRecord> for CredentialMetadataView {
    fn from(record: &StoredCredentialRecord) -> Self {
        Self {
            credential_ref: record.credential_ref.clone(),
            provider_id: record.provider_id.clone(),
            label: record.label.clone(),
            masked_hint: record.masked_hint.clone(),
            version: record.version,
            etag: record.etag.clone(),
            status: if record.revoked {
                "revoked".to_string()
            } else {
                "active".to_string()
            },
        }
    }
}

impl From<StoredCredentialRecord> for CredentialMetadataView {
    fn from(record: StoredCredentialRecord) -> Self {
        Self::from(&record)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TombstoneEntityType {
    AccountDeleted,
    CredentialRevoked,
    SessionRevoked,
    ResourceWithdrawn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeletionTombstone {
    pub tombstone_id: String,
    pub entity_type: TombstoneEntityType,
    pub account_id: String,
    pub target_id: String,
    pub reason: String,
    pub recorded_at_ms: u64,
    pub applied_after_restore_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TombstoneReplayReport {
    pub tombstones_evaluated: usize,
    pub accounts_purged: usize,
    pub credentials_revoked: usize,
    pub sessions_revoked: usize,
}

/// Curator review rubric evidence recorded when approving a resource (`CAT-002`, `@S04`, `@S36`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogReviewEvidence {
    pub reviewer_principal_id: String,
    pub reviewed_at: String,
    pub pedagogical_fit_score: u8,
    pub accuracy_score: u8,
    pub accessibility_score: u8,
    pub rights_verified: bool,
    pub rationale: String,
    pub credibility_basis: String,
    pub evidence_url: String,
}

/// Input submitted by a Curator to review a catalog resource version (`CAT-002`, `@S04`, `@S36`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogReviewInput {
    pub decision: ResourceReviewStatus,
    #[serde(default)]
    pub pedagogical_fit_score: Option<u8>,
    #[serde(default)]
    pub accuracy_score: Option<u8>,
    #[serde(default)]
    pub accessibility_score: Option<u8>,
    #[serde(default)]
    pub rights_verified: bool,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub credibility_basis: Option<String>,
    #[serde(default)]
    pub evidence_url: Option<String>,
}

/// Immutable catalog resource version snapshot (`CAT-001`..`CAT-005`).
/// `metadata_embedding` is optional/nullable (`ADR-002`, `NFR-008`, `T02`) so deterministic
/// metadata filtering works with zero vector-embedding dependencies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogResourceVersionRecord {
    pub resource_version_id: String,
    pub resource_id: String,
    pub version_number: u32,
    pub title: String,
    pub provider_id: String,
    pub provider_display_name: String,
    pub canonical_url: String,
    pub resource_type: String,
    pub language: String,
    pub description: String,
    pub topics: Vec<String>,
    pub level: String,
    pub objective_ids: Vec<String>,
    pub access_model: CatalogAccessModel,
    pub currency: Option<String>,
    pub price_minor_units: Option<u64>,
    pub subscription_ids: Vec<String>,
    pub is_optional_certification: bool,
    pub review_status: ResourceReviewStatus,
    pub review_evidence: Option<CatalogReviewEvidence>,
    pub freshness_state: ResourceFreshnessState,
    pub acquisition_permission: AcquisitionPermission,
    pub is_synthetic_fixture: bool,
    pub metadata_embedding: Option<Vec<f32>>,
}

impl CatalogResourceVersionRecord {
    /// Projects this catalog resource version into a JSON object conforming to
    /// `specs/001-syllabus-platform/contracts/resource.schema.json`.
    #[must_use]
    pub fn to_contract_json(&self) -> Value {
        let access_model_str = match self.access_model {
            CatalogAccessModel::FreePublic => "free",
            CatalogAccessModel::PaidPurchase => "purchase",
            CatalogAccessModel::Subscription => "subscription",
            CatalogAccessModel::FreemiumTrial => "free_audit",
            CatalogAccessModel::UnknownPrice => "purchase",
        };
        let price_obj = match self.access_model {
            CatalogAccessModel::UnknownPrice => json!({
                "status": "unknown",
                "reason": "Price is unverified or dynamically quoted by external provider.",
                "observed_at": null
            }),
            _ => json!({
                "status": "known",
                "amount": {
                    "currency": self.currency.clone().unwrap_or_else(|| "USD".to_string()),
                    "amount_minor_units": self.price_minor_units.unwrap_or(0)
                },
                "billing_period": if self.access_model == CatalogAccessModel::Subscription {
                    "monthly"
                } else if self.is_optional_certification {
                    "per_exam"
                } else {
                    "one_time"
                },
                "observed_at": "2026-10-20T16:00:00Z",
                "pricing_url": self.canonical_url
            }),
        };

        let perm_flag = |allowed: bool| if allowed { "allowed" } else { "denied" };
        let review_status_str = match self.review_status {
            ResourceReviewStatus::Approved => "approved",
            ResourceReviewStatus::UnderReview => "proposed",
            ResourceReviewStatus::Quarantined => "quarantined",
            ResourceReviewStatus::Rejected => "rejected",
            ResourceReviewStatus::Withdrawn | ResourceReviewStatus::Deprecated => "retired",
        };
        let (curator_id, reviewed_at, credibility_basis, rationale, evidence_arr) =
            if let Some(ev) = &self.review_evidence {
                (
                    json!(ev.reviewer_principal_id),
                    json!(ev.reviewed_at),
                    ev.credibility_basis.clone(),
                    ev.rationale.clone(),
                    json!([
                        {
                            "evidence_id": format!("ev-{}", self.resource_version_id),
                            "claim": ev.rationale,
                            "kind": "syllabus_review",
                            "source_url": ev.evidence_url,
                            "accessed_at": ev.reviewed_at,
                            "notes": format!(
                                "Rubric scores: pedagogical_fit={}, accuracy={}, accessibility={}",
                                ev.pedagogical_fit_score, ev.accuracy_score, ev.accessibility_score
                            )
                        }
                    ]),
                )
            } else {
                (
                    Value::Null,
                    Value::Null,
                    "expert_practitioner".to_string(),
                    "Pending curator rubric review.".to_string(),
                    json!([]),
                )
            };

        let link_status = match self.freshness_state {
            ResourceFreshnessState::Healthy | ResourceFreshnessState::Degraded => "reachable",
            ResourceFreshnessState::Broken => "broken",
            ResourceFreshnessState::Unchecked => "unknown",
        };

        json!({
            "schema_version": "0.2.0",
            "resource_id": self.resource_id,
            "resource_version_id": self.resource_version_id,
            "version_number": self.version_number,
            "captured_at": "2026-10-20T16:00:00Z",
            "title": self.title,
            "provider": {
                "provider_id": self.provider_id,
                "display_name": self.provider_display_name
            },
            "authors": [
                {
                    "name": self.provider_display_name,
                    "affiliation": null,
                    "verified_profile_url": null
                }
            ],
            "canonical_url": self.canonical_url,
            "resource_type": self.resource_type,
            "language": self.language,
            "description": self.description,
            "topics": self.topics,
            "level": self.level,
            "learning_outcomes": [
                format!("Apply {} concepts covered in {}.", self.topics.first().cloned().unwrap_or_else(|| "core".to_string()), self.title)
            ],
            "prerequisites": [
                "Intermediate Python 3 programming familiarity."
            ],
            "prerequisite_review_status": "verified",
            "segments": [],
            "access": {
                "model": access_model_str,
                "requires_account": self.access_model == CatalogAccessModel::Subscription || self.access_model == CatalogAccessModel::FreemiumTrial,
                "requires_trial": self.access_model == CatalogAccessModel::FreemiumTrial,
                "price": price_obj,
                "free_scope_description": if self.access_model == CatalogAccessModel::FreePublic {
                    json!("Full public instructional material available at no cost.")
                } else {
                    Value::Null
                },
                "assessments_included": true,
                "certificate_included": self.is_optional_certification,
                "subscription_ids": self.subscription_ids,
                "region_restrictions": [],
                "access_evidence_url": self.canonical_url,
                "access_verified_at": "2026-10-20T16:00:00Z"
            },
            "ingestion_permissions": {
                "basis": if self.acquisition_permission.allow_full_text_storage {
                    "open_license"
                } else {
                    "metadata_only"
                },
                "license_identifier": self.acquisition_permission.license_spdx_or_custom,
                "rights_evidence_urls": [self.canonical_url],
                "reviewed_at": "2026-10-20T16:00:00Z",
                "reviewed_by": "curator-rubric-1",
                "permissions": {
                    "store_metadata": perm_flag(self.acquisition_permission.allow_metadata),
                    "embed_metadata": perm_flag(self.acquisition_permission.allow_metadata),
                    "send_metadata_to_model_provider": perm_flag(self.acquisition_permission.allow_metadata),
                    "fetch_fulltext": perm_flag(self.acquisition_permission.allow_full_text_storage),
                    "store_fulltext": perm_flag(self.acquisition_permission.allow_full_text_storage),
                    "embed_fulltext": perm_flag(self.acquisition_permission.allow_embedding),
                    "send_fulltext_to_model_provider": perm_flag(self.acquisition_permission.allow_full_text_storage),
                    "derive_assessments": "allowed",
                    "display_excerpts": perm_flag(self.acquisition_permission.allow_short_excerpt),
                    "redistribute_fulltext": perm_flag(self.acquisition_permission.allow_redistribution)
                },
                "notes": self.acquisition_permission.notes.clone().unwrap_or_default()
            },
            "review": {
                "status": review_status_str,
                "credibility_basis": credibility_basis,
                "curator_id": curator_id,
                "reviewed_at": reviewed_at,
                "rationale": rationale,
                "evidence": evidence_arr
            },
            "freshness": {
                "link_checked_at": "2026-10-20T16:00:00Z",
                "link_status": link_status,
                "content_checked_at": "2026-10-20T16:00:00Z",
                "content_last_updated_at": "2026-10-01T00:00:00Z",
                "technology_versions": ["python-3.12"],
                "refresh_due_at": "2026-11-20T16:00:00Z"
            },
            "provenance": {
                "origin": "manual_curator",
                "source_url": self.canonical_url,
                "import_batch_id": null,
                "is_synthetic_fixture": self.is_synthetic_fixture
            }
        })
    }
}

/// Non-destructive quarantine overlay (`CAT-004`, `@S07`, `@S09`, `@S63`).
/// Blocks a resource version from future generation/retrieval while keeping historical
/// syllabus revisions byte-for-byte immutable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceQuarantineOverlayRecord {
    pub overlay_id: String,
    pub resource_version_id: String,
    pub reason: String,
    pub quarantined_by: String,
    pub quarantined_at: String,
    pub replacement_resource_version_id: Option<String>,
    pub lifted_at: Option<String>,
}

/// Non-destructive resource alert surfaced on existing syllabi when a referenced resource
/// is quarantined or degraded (`CAT-004`, `@S07`, `@S63`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceAlertRecord {
    pub alert_id: String,
    pub syllabus_id: String,
    pub revision_id: String,
    pub resource_version_id: String,
    pub alert_type: String,
    pub severity: String,
    pub reason: String,
    pub replacement_resource_version_id: Option<String>,
}

/// Deterministic catalog metadata filter query (`T02`, `CAT-001`, `CAT-005`, `@S05`, `@S06`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogFilterQuery {
    pub topic: Option<String>,
    pub objective_ids: Vec<String>,
    pub free_only: bool,
    pub budget_currency: Option<String>,
    pub max_budget_minor_units: Option<u64>,
    pub owned_subscription_ids: Vec<String>,
    pub allow_paid_fallback: bool,
    pub include_optional_certification: bool,
    pub allow_synthetic_fixtures_for_test: bool,
}

impl Default for CatalogFilterQuery {
    fn default() -> Self {
        Self {
            topic: Some("rag-python".to_string()),
            objective_ids: Vec::new(),
            free_only: true,
            budget_currency: Some("USD".to_string()),
            max_budget_minor_units: Some(0),
            owned_subscription_ids: Vec::new(),
            allow_paid_fallback: false,
            include_optional_certification: false,
            allow_synthetic_fixtures_for_test: false,
        }
    }
}

/// Result of deterministic catalog metadata filtering (`T02`, `CAT-001`, `CAT-005`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogFilterOutcome {
    pub eligible_resources: Vec<CatalogResourceVersionRecord>,
    pub optional_certification_resources: Vec<CatalogResourceVersionRecord>,
    pub excluded_unknown_price_ids: Vec<String>,
    pub excluded_quarantined_ids: Vec<String>,
    pub excluded_unapproved_ids: Vec<String>,
    pub excluded_synthetic_ids: Vec<String>,
    pub excluded_budget_ids: Vec<String>,
    pub requires_paid_fallback_notice: bool,
}

/// Summary item returned when listing a learner's private syllabi (`T04`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusSummaryItem {
    pub syllabus_id: String,
    pub title: String,
    pub active_revision_id: Option<String>,
    pub latest_revision_id: String,
    pub revision_count: usize,
    pub etag: String,
}

/// Syllabus overview projection (`T04`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusOverviewRecord {
    pub syllabus_id: String,
    pub owner_account_id: String,
    pub title: String,
    pub active_revision_id: Option<String>,
    pub latest_revision_id: String,
    pub revisions: Vec<SyllabusRevisionRecord>,
    pub resource_alerts: Vec<ResourceAlertRecord>,
    pub activation_version: u64,
    pub etag: String,
}

/// Immutable archive record for raw model candidate UTF-8 output (`T03`, `@S28`, `NFR-005`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateArchiveRecord {
    pub archive_id: String,
    pub syllabus_id: String,
    pub revision_id: Option<String>,
    pub provider_id: String,
    pub raw_utf8_payload: String,
    pub candidate_sha256: String,
    pub validation_succeeded: bool,
    pub validation_errors: Vec<String>,
}

/// Async generation job status record (`T03`, `T04`, `@S18`, `@S21`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerationJobRecord {
    pub job_id: String,
    pub owner_account_id: String,
    pub status: String,
    pub stage_history: Vec<String>,
    pub syllabus_id: Option<String>,
    pub revision_id: Option<String>,
    pub candidate_sha256: Option<String>,
    pub provider_id: String,
    pub credential_mode: String,
    pub request_payload: Value,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub etag: String,
}

/// Default allowlisted HTTPS hosts for catalog ingestion and freshness checks (`CAT-003`, `@S08`, `@S31`, `@S35`).
pub const DEFAULT_ALLOWED_CATALOG_HOSTS: &[&str] = &[
    "docs.python.org",
    "huggingface.co",
    "pytorch.org",
    "arxiv.org",
    "sbert.net",
    "qdrant.tech",
    "openai.com",
    "platform.openai.com",
    "anthropic.com",
    "docs.anthropic.com",
    "scikit-learn.org",
    "numpy.org",
    "scipy.org",
    "ocw.mit.edu",
    "stanford.edu",
    "github.com",
    "raw.githubusercontent.com",
    "coursera.org",
    "edx.org",
    "deeplearning.ai",
    "fast.ai",
    "realpython.com",
    "llamaindex.ai",
    "docs.llamaindex.ai",
    "python.langchain.com",
];

/// Validates a target URL against SSRF, loopback, private-network, link-local,
/// metadata IP, non-HTTPS scheme, and host-allowlist rules by delegating to the pure
/// domain policy `validate_outbound_egress_url` (`@S08`, `@S31`, `@S35`, `CAT-003`).
pub fn validate_egress_url(url: &str, allowed_hosts: &[&str]) -> Result<String, PersistenceError> {
    validate_outbound_egress_url(url, allowed_hosts).map_err(|err| match err {
        DomainError::UnsafeEgressUrl { url, reason } => {
            PersistenceError::UnsafeEgressUrlRejected { url, reason }
        }
        other => PersistenceError::Validation(other.to_string()),
    })
}

// =============================================================================
// Tier 2 Records (`T05`, `T06`, `T12`, `T07A`, `T08`)
// =============================================================================

/// Reviewed anchor or AI formative practice assessment record (`T05`, `PED-002`, `PED-004`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewedAssessmentRecord {
    pub assessment_id: String,
    pub objective_id: String,
    pub resource_version_id: String,
    pub assessment_kind: AssessmentKind,
    pub review_status: AssessmentReviewStatus,
    pub key_revision: u32,
    pub mastery_threshold_bp: u32,
    pub items: Vec<Value>,
    pub answer_key: BTreeMap<String, String>,
}

/// Recorded assessment attempt (`T05`, `PED-003`, `PED-004`, `@S14`, `@S16`, `@S80`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssessmentAttemptRecord {
    pub attempt_id: String,
    pub account_id: String,
    pub assessment_id: String,
    pub objective_id: String,
    pub session_id: String,
    pub assistance_level: AssistanceLevel,
    pub score_bp: u32,
    pub passed: bool,
    pub evidence_origin: EvidenceOrigin,
    pub derived_proficiency_state: ObjectiveProficiencyState,
    pub contract_proficiency_label: String,
    pub key_revision: u32,
    pub recomputed_from_correction_id: Option<String>,
    pub responses: BTreeMap<String, String>,
    pub spaced_review_item_id: Option<String>,
}

/// Defective assessment item report (`T05`, `PED-004`, `@S40`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssessmentIssueReportRecord {
    pub report_id: String,
    pub account_id: String,
    pub assessment_id: String,
    pub item_id: String,
    pub reason_code: String,
    pub details: String,
    pub status: String,
    pub gate_suspended: bool,
}

/// Curator answer-key correction record (`T05`, `PED-004`, `@S40`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssessmentKeyCorrectionRecord {
    pub correction_id: String,
    pub assessment_id: String,
    pub curator_account_id: String,
    pub previous_key_revision: u32,
    pub new_key_revision: u32,
    pub rationale: String,
    pub recomputed_attempt_ids: Vec<String>,
    pub recomputed_outcomes: Vec<RecomputedAttemptOutcome>,
}

/// Prerequisite gate decision audit event (`T05`, `PED-005`, `@S15`, `@S38`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrerequisiteDecisionAuditRecord {
    pub audit_event_id: String,
    pub account_id: String,
    pub syllabus_id: String,
    pub target_objective_id: String,
    pub missing_prerequisite_objective_ids: Vec<String>,
    pub decision_kind: String,
}

/// Objective diagnostic session (`T12`, `PED-007`, `@S70`, `@S81`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticSessionRecord {
    pub diagnostic_id: String,
    pub account_id: String,
    pub syllabus_id: Option<String>,
    pub topic_id: String,
    pub status: String,
    pub stop_reason: Option<DiagnosticStopReason>,
    pub math_depth_preference: MathDepthPreference,
    pub candidate_objective_ids: Vec<String>,
    pub items: Vec<Value>,
    pub answer_key: BTreeMap<String, (String, String)>, // item_id -> (objective_id, expected_answer)
    pub answered_results: BTreeMap<String, bool>,
    pub objective_states: BTreeMap<String, ObjectiveProficiencyState>,
    pub granted_waiver_ids: Vec<String>,
}

/// Objective waiver record (`T12`, `PED-008`, `CTRL-023`, `@S71`, `@S72`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectiveWaiverRecord {
    pub waiver_id: String,
    pub account_id: String,
    pub objective_id: String,
    pub evidence_kind: String,
    pub source_evidence_ref: String,
    pub equivalence_mapping_id: Option<String>,
}

/// Adaptation proposal record (`T12`, `PED-009`, `CTRL-050`, `CTRL-051`, `@S73`..`@S76`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdaptationProposalRecord {
    pub proposal_id: String,
    pub account_id: String,
    pub syllabus_id: String,
    pub base_syllabus_revision_id: String,
    pub base_schedule_revision_id: String,
    pub status: String,
    pub proposal_sha256: String,
    pub accepted_syllabus_revision_id: Option<String>,
    pub accepted_schedule_revision_id: Option<String>,
    pub payload: Value,
}

/// Inference usage record (`T07A`, `BILL-004`, `BILL-008`, `@S68`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceUsageRecord {
    pub usage_record_id: String,
    pub account_id: String,
    pub credential_ref: String,
    pub credential_version: u64,
    pub provider_id: String,
    pub model_id: String,
    pub operation_kind: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub usage_source: String,
    pub estimated_provider_cost_usd_micros: u64,
    pub hosted_service_charge_usd_micros: u64,
    pub recorded_at: String,
}

/// Learner notification preferences (`T08`, `REM-001`, `REM-004`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationPreferencesRecord {
    pub account_id: String,
    pub enabled: bool,
    pub channel: String,
    pub iana_timezone: String,
    pub local_time_hhmm: String,
    pub days_of_week: Vec<u8>,
    pub quiet_hours_start_hhmm: Option<String>,
    pub quiet_hours_end_hhmm: Option<String>,
    pub etag_version: u64,
    pub etag: String,
}

/// Web push subscription record (`T08`, `REM-003`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushSubscriptionRecord {
    pub subscription_id: String,
    pub account_id: String,
    pub endpoint_url: String,
    pub p256dh_key: String,
    pub auth_secret: String,
    pub active: bool,
}

/// Scheduled reminder occurrence record (`T08`, `REM-002`..`REM-005`, `@S27`, `@S33`, `@S34`, `@S60`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReminderOccurrenceRecord {
    pub occurrence_id: String,
    pub account_id: String,
    pub syllabus_id: Option<String>,
    pub scheduled_local_date: String,
    pub scheduled_utc_iso: String,
    pub scheduled_utc_epoch: i64,
    pub expires_utc_iso: String,
    pub expires_utc_epoch: i64,
    pub snoozed_until_utc_iso: Option<String>,
    pub status: String,
    pub dst_resolution_policy: DstResolutionPolicy,
}

// =============================================================================
// Tier 3 Records (`T07B`, `T07D`, `T13`, `T09`)
// =============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostedCreditWalletRecord {
    pub account_id: String,
    pub currency: String,
    pub available_minor_units: i64,
    pub reserved_minor_units: i64,
    pub lifetime_purchased_minor_units: i64,
    pub lifetime_settled_minor_units: i64,
    pub lifetime_refunded_minor_units: i64,
    pub four_cost_buckets: FourCostBucketBreakdown,
    pub etag_version: u64,
    pub etag: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageQuoteRecord {
    pub quote: UsageQuote,
    pub four_cost_buckets: FourCostBucketBreakdown,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreditReservationRecord {
    pub reservation: CreditReservation,
    pub created_at: String,
    pub finalized_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckoutSessionRecord {
    pub checkout_session_id: String,
    pub account_id: String,
    pub package_id: String,
    pub idempotency_key: String,
    pub currency: String,
    pub amount_minor_units: i64,
    pub credit_minor_units: i64,
    pub status: String,
    pub checkout_url: String,
    pub success_url: String,
    pub cancel_url: String,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentWebhookReceiptRecord {
    pub provider_event_id: String,
    pub event_type: String,
    pub checkout_session_id: String,
    pub account_id: String,
    pub amount_minor_units: i64,
    pub ledger_entry_id: String,
    pub replayed: bool,
    pub wallet: HostedCreditWalletRecord,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationPreviewRecord {
    pub preview_id: String,
    pub account_id: String,
    pub syllabus_id: String,
    pub source_revision_id: String,
    pub visibility: ModerationVisibilityState,
    pub publisher_display_name: String,
    pub attribution_text: String,
    pub preview_sha256: String,
    pub content_sha256: String,
    pub stripped_private_fields: Vec<String>,
    pub withheld_restricted_fields: Vec<String>,
    pub sanitized_content: Value,
    pub publication_terms: Value,
    pub publisher: Value,
    pub origin: Value,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationRecord {
    pub publication_id: String,
    pub owner_account_id: Option<String>,
    pub source_syllabus_id: String,
    pub public_author_id: String,
    pub publisher_display_name: String,
    pub visibility: ModerationVisibilityState,
    pub pre_moderation_visibility: ModerationVisibilityState,
    pub current_revision_id: String,
    pub latest_revision_number: u32,
    pub etag_version: u64,
    pub etag: String,
    pub published_at: String,
    pub updated_at: String,
    pub withdrawn_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationRevisionRecord {
    pub publication_revision_id: String,
    pub publication_id: String,
    pub revision_number: u32,
    pub supersedes_publication_revision_id: Option<String>,
    pub source_syllabus_revision_id: String,
    pub preview_sha256: String,
    pub content_sha256: String,
    pub upvote_count: u64,
    pub snapshot: Value,
    pub published_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationViewRecord {
    pub publication_id: String,
    pub publication_revision_id: String,
    pub revision_number: u32,
    pub visibility: String,
    pub title: String,
    pub summary: String,
    pub topic_id: String,
    pub publisher_display_name: String,
    pub content_sha256: String,
    pub upvote_count: u64,
    pub upvote_label: String,
    pub snapshot: Value,
    pub published_at: String,
}

impl PublicationViewRecord {
    /// Projects a `PublicationRecord` and `PublicationRevisionRecord` into a `PublicationViewRecord`.
    #[must_use]
    pub fn from_records(pub_rec: &PublicationRecord, rev: &PublicationRevisionRecord) -> Self {
        let content = &rev.snapshot["content"];
        let title = content["title"]
            .as_str()
            .unwrap_or("Published Syllabus")
            .to_string();
        let summary = content["summary"].as_str().unwrap_or("").to_string();
        let topic_id = content["topic_ids"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("topic-tokenization")
            .to_string();
        Self {
            publication_id: pub_rec.publication_id.clone(),
            publication_revision_id: rev.publication_revision_id.clone(),
            revision_number: rev.revision_number,
            visibility: pub_rec.visibility.as_str().to_string(),
            title,
            summary,
            topic_id,
            publisher_display_name: pub_rec.publisher_display_name.clone(),
            content_sha256: rev.content_sha256.clone(),
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
            snapshot: rev.snapshot.clone(),
            published_at: rev.published_at.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnedPublicationSummaryRecord {
    pub publication_id: String,
    pub source_syllabus_id: String,
    pub current_revision_id: String,
    pub latest_revision_number: u32,
    pub visibility: String,
    pub title: Option<String>,
    pub public_url: Option<String>,
    pub public_upvote_count: Option<u64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnedPublicationManagementRecord {
    pub publication_id: String,
    pub source_syllabus_id: String,
    pub current_revision_id: String,
    pub latest_revision_number: u32,
    pub visibility: String,
    pub public_readability: bool,
    pub public_url: Option<String>,
    pub public_upvote_count: Option<u64>,
    pub etag: String,
    pub published_at: String,
    pub updated_at: String,
    pub withdrawn_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnedPublicationRevisionItem {
    pub publication_revision_id: String,
    pub publication_id: String,
    pub revision_number: u32,
    pub source_syllabus_revision_id: String,
    pub content_sha256: String,
    pub public_readability: bool,
    pub upvote_count: Option<u64>,
    pub published_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationVoteStateRecord {
    pub publication_id: String,
    pub publication_revision_id: String,
    pub voter_account_id: String,
    pub has_upvoted: bool,
    pub upvote_count: u64,
    pub upvote_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationReportRecord {
    pub report_id: String,
    pub publication_id: String,
    pub publication_revision_id: String,
    pub reporter_account_id: String,
    pub reason_code: String,
    pub details: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModerationActionRecord {
    pub action_id: String,
    pub publication_id: String,
    pub moderator_account_id: String,
    pub action_kind: String,
    pub previous_visibility: String,
    pub new_visibility: String,
    pub rationale: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdoptedSyllabusRecord {
    pub syllabus_id: String,
    pub revision_id: String,
    pub schedule_revision_id: String,
    pub adopter_account_id: String,
    pub origin_binding: AdoptionOriginBinding,
    pub ordered_module_ids: Vec<String>,
    pub ordered_objective_ids: Vec<String>,
    pub initial_proficiency_states: BTreeMap<String, ObjectiveProficiencyState>,
    pub resource_substitutions: Vec<Value>,
    pub four_cost_buckets: FourCostBucketBreakdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountExportRecord {
    pub export_id: String,
    pub account_id: String,
    pub status: String,
    pub schema_version: String,
    pub archive_sha256: String,
    pub export_payload: Value,
    pub created_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountDeletionReceiptRecord {
    pub deletion_request_id: String,
    pub account_id: String,
    pub status: String,
    pub tombstoned_entities_count: usize,
    pub withdrawn_publication_ids: Vec<String>,
    pub preserved_adopter_syllabus_ids: Vec<String>,
    pub completed_at: String,
}

/// Partial update payload for editing an existing catalog/library resource version
/// and automatically re-indexing it in the TF-IDF corpus.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogResourcePatchInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub canonical_url: Option<String>,
    #[serde(default)]
    pub provider_display_name: Option<String>,
    #[serde(default)]
    pub resource_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub topics: Option<Vec<String>>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub access_model: Option<CatalogAccessModel>,
    #[serde(default)]
    pub price_minor_units: Option<Option<u64>>,
}

/// Request payload for adding or editing a resource binding within a learner's syllabus.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusResourceBindingInput {
    pub resource_version_id: String,
    #[serde(default)]
    pub module_id: Option<String>,
    #[serde(default)]
    pub activity_id: Option<String>,
    #[serde(default)]
    pub activity_title: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub requirement_level: Option<String>,
    #[serde(default)]
    pub segment_ids: Vec<String>,
    #[serde(default)]
    pub selection_rationale: Option<String>,
}

/// Receipt returned when adding, updating, or removing a resource binding on a syllabus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusResourceMutationReceipt {
    pub syllabus_id: String,
    pub revision_id: String,
    pub resource_version_id: String,
    pub module_id: Option<String>,
    pub activity_id: Option<String>,
    pub action: String,
    pub etag: String,
}

/// Validates a learner-provided manual resource URL against SSRF, loopback, private-IP,
/// link-local, metadata-IP, and userinfo rules while permitting public HTTPS domains.
pub fn validate_manual_resource_egress_url(url: &str) -> Result<String, PersistenceError> {
    let host = validate_outbound_egress_url(url, &[]).map_err(|err| match err {
        DomainError::UnsafeEgressUrl { url, reason } => {
            PersistenceError::UnsafeEgressUrlRejected { url, reason }
        }
        other => PersistenceError::Validation(other.to_string()),
    })?;
    if !host.contains('.') || host.ends_with(".invalid") {
        return Err(PersistenceError::UnsafeEgressUrlRejected {
            url: url.to_string(),
            reason: format!("host `{host}` must be a routable public domain"),
        });
    }
    Ok(host)
}
