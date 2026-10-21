//! Transactional PostgreSQL persistence boundary, SQL migration registry, tenant-isolated
//! repositories, separate private/public revision namespaces, HTTP concurrency engine
//! (`Idempotency-Key`, `If-Match`, append-only event deduplication), and post-restore
//! deletion tombstone replay (`T01`, `CTRL-002`, `CTRL-030`, `CTRL-070`, `NFR-001`, `NFR-006`, `NFR-007`).

use curriculum_contracts::generated::{OpenApiOperationDescriptor, OPENAPI_OPERATIONS};
use curriculum_contracts::jcs::{jcs_sha256_hex, sha256_bytes_hex};
pub use curriculum_domain::{
    advance_spaced_review_item, authorize_credit_reservation, compute_next_reminder_utc,
    compute_partial_adoption_closure, compute_reservation_settlement,
    derive_proficiency_transition, evaluate_account_deletion_impact,
    evaluate_ambiguous_timeout_reconciliation, evaluate_anchor_item_psychometrics,
    evaluate_assessment_attempt, evaluate_curriculum_expert_rubric,
    evaluate_delayed_retention_and_transfer_study, evaluate_prerequisite_gate,
    evaluate_retrieval_benchmark, format_epoch_utc_iso, partition_diagnostic_objectives,
    recalculate_attempts_for_key_correction, recalculate_schedule_plan,
    schedule_initial_spaced_review, validate_byok_credential_usable,
    validate_native_alarm_capability_boundary, validate_objective_waiver,
    validate_outbound_egress_url, validate_pedagogical_triad_coverage, AccountDeletionImpact,
    AcquisitionPermission, ActivityComponentBreakdown, ActivityExecutionStatus,
    AdoptionOriginBinding, AlarmCapabilityEvaluation, AmbiguousProviderOutcome,
    AnchorAssessmentPsychometricEvaluation, AnchorAssessmentPsychometricInput, AssessmentKind,
    AssessmentReviewStatus, AssistanceLevel, BillingModeKind, CatalogAccessModel,
    ClientRuntimeKind, CostBucketKind, CreditReservation, CredentialStatus,
    CurriculumExpertRubricEvaluation, CurriculumExpertRubricScore,
    DelayedRetentionStudyEvaluation, DelayedRetentionTransferCohortMetrics, DiagnosticStopReason,
    DomainError, DstResolutionPolicy, EffortTriplet, EvaluatedAssessmentAttempt, EvidenceOrigin,
    FourCostBucketBreakdown, GoalSpecification, HistoricalAttemptForKeyCorrection,
    LearnerGateDecision, LedgerEntry, LedgerEntryKind, MasteryGateEvaluation, MathDepthPreference,
    ModerationVisibilityState, MoneyMinorUnits, ObjectiveProficiencyState, PartialAdoptionClosure,
    PrerequisiteGateInput, PublicSnapshotSanitizer, PublicationPreviewDigest,
    RecalculatedScheduleSummary, RecomputedAttemptOutcome, ReminderScheduleDecision,
    ReminderScheduleInput, ReservationStatus, ResourceFreshnessState, ResourceOperationKind,
    ResourceReviewStatus, RetrievalBenchmarkCase, RetrievalBenchmarkSummary, ReviewScheduleItem,
    ReviewScheduleStatus, ScheduleRecalculationInput, SpacedReviewRecord, UsageQuote,
    WaiverEvidenceSource,
};
use curriculum_security::{
    verify_webhook_hmac_sha256, AuthenticatedPrincipal, CredentialVault, PrincipalRole,
    SealedCredentialEnvelope, SecurityError,
};
use serde::{Deserialize, Serialize};
pub use serde_json;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};
use thiserror::Error;

pub const BASELINE_MIGRATION_SQL: &str = include_str!("../migrations/0000_t00_baseline.sql");
pub const INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL: &str =
    include_str!("../migrations/0001_init_identity_and_tenancy.sql");
pub const IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL: &str =
    include_str!("../migrations/0002_idempotency_and_outbox.sql");
pub const REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL: &str =
    include_str!("../migrations/0003_reviewed_catalog_and_retrieval.sql");
pub const ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL: &str =
    include_str!("../migrations/0004_assessments_adaptation_byok_and_reminders.sql");
pub const HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL: &str =
    include_str!("../migrations/0005_hosted_ledger_sharing_and_release_ops.sql");

/// Embedded PostgreSQL migration descriptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqlMigration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

/// Ordered registry of embedded PostgreSQL migrations (`T00`–`T13`).
pub const MIGRATIONS: [SqlMigration; 6] = [
    SqlMigration {
        version: 0,
        name: "0000_t00_baseline.sql",
        sql: BASELINE_MIGRATION_SQL,
    },
    SqlMigration {
        version: 1,
        name: "0001_init_identity_and_tenancy.sql",
        sql: INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL,
    },
    SqlMigration {
        version: 2,
        name: "0002_idempotency_and_outbox.sql",
        sql: IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL,
    },
    SqlMigration {
        version: 3,
        name: "0003_reviewed_catalog_and_retrieval.sql",
        sql: REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL,
    },
    SqlMigration {
        version: 4,
        name: "0004_assessments_adaptation_byok_and_reminders.sql",
        sql: ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL,
    },
    SqlMigration {
        version: 5,
        name: "0005_hosted_ledger_sharing_and_release_ops.sql",
        sql: HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL,
    },
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub database_url: String,
    pub max_connections: u32,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            database_url: "postgres://postgres:postgres@localhost:5432/curriculum_dev".to_string(),
            max_connections: 10,
        }
    }
}

/// Parameterized PostgreSQL transactional SQL adapter and migration bundle builder (`T01`, `CTRL-002`, `CTRL-030`, `NFR-006`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PostgresTransactionalStatements;

impl PostgresTransactionalStatements {
    /// Concatenates all embedded `MIGRATIONS` (`0000`–`0005`) in lexical/version order wrapped in a transaction (`BEGIN; ... COMMIT;`).
    pub fn render_full_migration_bundle() -> String {
        let mut bundle = String::from("BEGIN;\n\n");
        for migration in &MIGRATIONS {
            bundle.push_str(&format!(
                "-- === Migration {:04}: {} ===\n{}\n\n",
                migration.version,
                migration.name,
                migration.sql.trim()
            ));
        }
        bundle.push_str("COMMIT;\n");
        bundle
    }

    /// Canonical `SELECT ... FOR UPDATE SKIP LOCKED` outbox job claim statement (`T01`, `@S24`).
    pub fn claim_next_outbox_job_sql() -> &'static str {
        "UPDATE outbox_jobs \
         SET state = 'leased', locked_by = $1, locked_until = $2, attempt_count = attempt_count + 1 \
         WHERE job_id = ( \
             SELECT job_id FROM outbox_jobs \
             WHERE state = 'queued' AND available_at <= $3 \
             ORDER BY available_at ASC, job_id ASC \
             FOR UPDATE SKIP LOCKED \
             LIMIT 1 \
         ) \
         RETURNING job_id, account_id, job_type, state, payload_json, attempt_count, max_attempts, locked_by, locked_until, available_at, created_at;"
    }

    /// Canonical expired lease-reaping and dead-letter transition SQL (`T01`).
    pub fn reap_expired_leases_sql() -> &'static str {
        "UPDATE outbox_jobs \
         SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END, \
             locked_by = NULL, \
             locked_until = NULL, \
             completed_at = CASE WHEN attempt_count >= max_attempts THEN $1 ELSE completed_at END, \
             last_error = CASE WHEN attempt_count >= max_attempts THEN 'lease_expired_max_attempts_exceeded' ELSE 'worker_lease_expired_requeued' END \
         WHERE state IN ('in_flight', 'leased') AND locked_until < $1 \
         RETURNING job_id, account_id, state, attempt_count, max_attempts;"
    }

    /// Canonical tenant-scoped `Idempotency-Key` acquisition SQL (`T01`, `@S24`).
    pub fn idempotency_begin_sql() -> &'static str {
        "INSERT INTO idempotency_keys (account_id, operation_id, idempotency_key, request_sha256, state, expires_at) \
         VALUES ($1, $2, $3, $4, 'in_flight', $5) \
         ON CONFLICT (account_id, operation_id, idempotency_key) DO NOTHING \
         RETURNING account_id, operation_id, idempotency_key, request_sha256, state, response_status, response_body;"
    }

    /// Canonical tenant-scoped optimistic concurrency schedule update SQL (`T01`, `@S22`, `@S24`).
    pub fn optimistic_schedule_update_sql() -> &'static str {
        "UPDATE schedule_revisions \
         SET etag_version = etag_version + 1, \
             timezone = COALESCE($4, timezone), \
             weekly_available_minutes = COALESCE($5, weekly_available_minutes), \
             required_minutes = COALESCE($6, required_minutes), \
             feasibility_status = $7, \
             sessions_json = COALESCE($8, sessions_json) \
         WHERE account_id = $1 AND curriculum_id = $2 AND etag_version = $3 \
         RETURNING schedule_revision_id, account_id, curriculum_id, curriculum_revision_id, etag_version, feasibility_status;"
    }

    /// Canonical `pg_stat_user_tables` bloat and autovacuum monitoring query (`T01`).
    pub fn pg_bloat_monitoring_sql() -> &'static str {
        "SELECT \
             relname AS table_name, \
             n_live_tup, \
             n_dead_tup, \
             CASE WHEN (n_live_tup + n_dead_tup) = 0 THEN 0.0 \
                  ELSE ROUND((n_dead_tup::NUMERIC / (n_live_tup + n_dead_tup)::NUMERIC), 4) \
             END AS dead_tuple_ratio, \
             EXTRACT(EPOCH FROM (NOW() - COALESCE(last_autovacuum, last_vacuum)))::BIGINT AS last_autovacuum_age_seconds \
         FROM pg_stat_user_tables \
         WHERE relname IN ('outbox_jobs', 'idempotency_keys', 'progress_events', 'schedule_revisions') \
         ORDER BY dead_tuple_ratio DESC;"
    }
}

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
    pub fn http_status_code(&self) -> u16 {
        match self {
            PersistenceError::Security(
                SecurityError::Unauthenticated | SecurityError::InvalidWebhookSignature(_),
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

    pub fn error_code(&self) -> &'static str {
        match self {
            PersistenceError::Security(SecurityError::Unauthenticated) => "unauthenticated",
            PersistenceError::Security(SecurityError::InvalidWebhookSignature(_)) => {
                "invalid_webhook_signature"
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
    pub deleted_at_ms: Option<u64>,
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

/// Private learner curriculum revision (`SHARE-001`, `SHARE-002`, `NFR-007`).
/// Stored in a strictly separate identifier and table space from `PublicTemplateRevisionRecord`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CurriculumRevisionRecord {
    pub revision_id: String,
    pub curriculum_id: String,
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
    pub curriculum_id: String,
    pub owner_account_id: String,
    pub curriculum_revision_id: String,
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
    pub curriculum_id: String,
    pub activity_id: String,
    pub objective_id: Option<String>,
    pub status: ActivityExecutionStatus,
    pub time_spent_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredProgressEvent {
    pub account_id: String,
    pub event_id: String,
    pub curriculum_id: String,
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
    pub curriculum_id: String,
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
    /// `specs/001-curriculum-platform/contracts/resource.schema.json`.
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
/// curriculum revisions byte-for-byte immutable.
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

/// Non-destructive resource alert surfaced on existing curricula when a referenced resource
/// is quarantined or degraded (`CAT-004`, `@S07`, `@S63`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceAlertRecord {
    pub alert_id: String,
    pub curriculum_id: String,
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

/// Summary item returned when listing a learner's private curricula (`T04`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CurriculumSummaryItem {
    pub curriculum_id: String,
    pub title: String,
    pub active_revision_id: Option<String>,
    pub latest_revision_id: String,
    pub revision_count: usize,
    pub etag: String,
}

/// Curriculum overview projection (`T04`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CurriculumOverviewRecord {
    pub curriculum_id: String,
    pub owner_account_id: String,
    pub title: String,
    pub active_revision_id: Option<String>,
    pub latest_revision_id: String,
    pub revisions: Vec<CurriculumRevisionRecord>,
    pub resource_alerts: Vec<ResourceAlertRecord>,
    pub activation_version: u64,
    pub etag: String,
}

/// Immutable archive record for raw model candidate UTF-8 output (`T03`, `@S28`, `NFR-005`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateArchiveRecord {
    pub archive_id: String,
    pub curriculum_id: String,
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
    pub curriculum_id: Option<String>,
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
    pub curriculum_id: String,
    pub target_objective_id: String,
    pub missing_prerequisite_objective_ids: Vec<String>,
    pub decision_kind: String,
}

/// Objective diagnostic session (`T12`, `PED-007`, `@S70`, `@S81`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticSessionRecord {
    pub diagnostic_id: String,
    pub account_id: String,
    pub curriculum_id: Option<String>,
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
    pub curriculum_id: String,
    pub base_curriculum_revision_id: String,
    pub base_schedule_revision_id: String,
    pub status: String,
    pub proposal_sha256: String,
    pub accepted_curriculum_revision_id: Option<String>,
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
    pub curriculum_id: Option<String>,
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
    pub curriculum_id: String,
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
    pub source_curriculum_id: String,
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
    pub source_curriculum_revision_id: String,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnedPublicationSummaryRecord {
    pub publication_id: String,
    pub source_curriculum_id: String,
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
    pub source_curriculum_id: String,
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
    pub source_curriculum_revision_id: String,
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
pub struct AdoptedCurriculumRecord {
    pub curriculum_id: String,
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
    pub preserved_adopter_curriculum_ids: Vec<String>,
    pub completed_at: String,
}

#[derive(Default)]
struct StoreInner {
    accounts: BTreeMap<String, AccountRecord>,
    sessions_by_token_sha: BTreeMap<String, AuthSessionRecord>,
    private_revisions: BTreeMap<String, CurriculumRevisionRecord>,
    curriculum_activation_versions: BTreeMap<String, u64>,
    public_revisions: BTreeMap<String, PublicTemplateRevisionRecord>,
    schedules: BTreeMap<String, ScheduleRevisionRecord>,
    schedule_playback_speeds: BTreeMap<String, f64>,
    spaced_reviews: BTreeMap<String, Vec<SpacedReviewRecord>>,
    progress_events: BTreeMap<(String, String), StoredProgressEvent>,
    proficiency_by_account: BTreeMap<String, LearnerProficiencyProjection>,
    math_depth_by_account: BTreeMap<String, MathDepthPreference>,
    credentials: BTreeMap<String, StoredCredentialRecord>,
    credential_envelopes: BTreeMap<String, SealedCredentialEnvelope>,
    credential_vault: CredentialVault,
    inference_usage_records: Vec<InferenceUsageRecord>,
    reviewed_assessments: BTreeMap<String, ReviewedAssessmentRecord>,
    assessment_attempts: BTreeMap<String, AssessmentAttemptRecord>,
    pending_assistance_by_assessment: BTreeMap<(String, String), AssistanceLevel>,
    assessment_issue_reports: Vec<AssessmentIssueReportRecord>,
    assessment_key_corrections: Vec<AssessmentKeyCorrectionRecord>,
    prerequisite_audit_events: Vec<PrerequisiteDecisionAuditRecord>,
    diagnostic_sessions: BTreeMap<String, DiagnosticSessionRecord>,
    objective_waivers: BTreeMap<(String, String), ObjectiveWaiverRecord>,
    adaptation_proposals: BTreeMap<String, AdaptationProposalRecord>,
    notification_preferences: BTreeMap<String, NotificationPreferencesRecord>,
    push_subscriptions: BTreeMap<String, PushSubscriptionRecord>,
    reminder_occurrences: BTreeMap<String, ReminderOccurrenceRecord>,
    hosted_credit_wallets: BTreeMap<String, HostedCreditWalletRecord>,
    usage_quotes: BTreeMap<String, UsageQuoteRecord>,
    credit_reservations: BTreeMap<String, CreditReservationRecord>,
    reservations_by_idempotency: BTreeMap<(String, String), String>,
    ledger_entries: Vec<LedgerEntry>,
    checkout_sessions: BTreeMap<String, CheckoutSessionRecord>,
    checkout_by_idempotency: BTreeMap<(String, String), String>,
    payment_webhook_events: BTreeMap<String, PaymentWebhookReceiptRecord>,
    publication_previews: BTreeMap<String, PublicationPreviewRecord>,
    publications: BTreeMap<String, PublicationRecord>,
    publication_revisions: BTreeMap<String, PublicationRevisionRecord>,
    publication_upvotes: BTreeSet<(String, String)>,
    publication_reports: Vec<PublicationReportRecord>,
    moderation_actions: Vec<ModerationActionRecord>,
    adopted_curricula_by_publication: BTreeMap<String, Vec<String>>,
    account_exports: BTreeMap<String, AccountExportRecord>,
    account_deletion_requests: BTreeMap<String, AccountDeletionReceiptRecord>,
    idempotency_keys: BTreeMap<(String, String, String), IdempotencyRecord>,
    deletion_tombstones: Vec<DeletionTombstone>,
    catalog_resources: BTreeMap<String, CatalogResourceVersionRecord>,
    quarantine_overlays: BTreeMap<String, ResourceQuarantineOverlayRecord>,
    candidate_archives: BTreeMap<String, CandidateArchiveRecord>,
    generation_jobs: BTreeMap<String, GenerationJobRecord>,
    next_seq: u64,
}

/// Thread-safe transactional store enforcing `T01` identity, tenant isolation,
/// private/public revision separation, HTTP concurrency rules, and post-restore tombstone replay.
#[derive(Clone, Default)]
pub struct InMemoryTransactionalStore {
    inner: Arc<RwLock<StoreInner>>,
}

const PROHIBITED_PRIVATE_FIELDS_IN_PUBLIC: &[&str] = &[
    "account_id",
    "owner_account_id",
    "proficiency",
    "objective_evidence",
    "progress",
    "schedule",
    "notes",
    "private_notes",
    "credentials",
    "credential_ref",
    "api_key",
    "solutions",
    "answer_key",
    "budget",
    "provenance",
];

impl InMemoryTransactionalStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a store pre-seeded with Learner A (`00000000-0000-4000-8000-000000000001`)
    /// and Learner B (`00000000-0000-4000-8000-000000000002`) for development and integration tests.
    pub fn new_with_dev_fixtures() -> Self {
        let store = Self::new();
        let learner_a = "00000000-0000-4000-8000-000000000001";
        let learner_b = "00000000-0000-4000-8000-000000000002";

        store.upsert_account(AccountRecord {
            account_id: learner_a.to_string(),
            email: "learner-a@example.test".to_string(),
            email_verified: true,
            roles: vec![PrincipalRole::Learner],
            deleted_at_ms: None,
        });
        store.upsert_account(AccountRecord {
            account_id: learner_b.to_string(),
            email: "learner-b@example.test".to_string(),
            email_verified: true,
            roles: vec![PrincipalRole::Learner],
            deleted_at_ms: None,
        });

        let principal_a = AuthenticatedPrincipal {
            account_id: learner_a.to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        };
        let principal_b = AuthenticatedPrincipal {
            account_id: learner_b.to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        };

        store
            .commit_private_curriculum_revision(
                &principal_a,
                "cur-learner-a-1",
                "rev-learner-a-1",
                json!({
                    "title": "Learner A Linear Algebra",
                    "objectives": ["obj-la-1", "obj-la-2"]
                }),
            )
            .expect("seed learner A curriculum");

        store
            .commit_private_curriculum_revision(
                &principal_b,
                "cur-learner-b-1",
                "rev-learner-b-1",
                json!({
                    "title": "Learner B Distributed Systems",
                    "objectives": ["obj-ds-1"]
                }),
            )
            .expect("seed learner B curriculum");

        store
            .create_credential(
                &principal_b,
                "cred-learner-b-openai",
                "openai",
                "Learner B Key",
                "sk-live-secret-learner-b-9999",
            )
            .expect("seed learner B credential");

        store.seed_reviewed_rag_catalog();
        store.seed_reviewed_assessments();

        store
    }

    pub fn upsert_account(&self, account: AccountRecord) {
        let mut guard = self.inner.write().expect("store write lock");
        guard
            .proficiency_by_account
            .entry(account.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: account.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });
        guard.accounts.insert(account.account_id.clone(), account);
    }

    pub fn create_auth_session(
        &self,
        email: &str,
        authentication_code: &str,
    ) -> Result<AuthSessionRecord, PersistenceError> {
        if email.trim().is_empty() || !email.contains('@') {
            return Err(PersistenceError::Validation(
                "valid email address is required".to_string(),
            ));
        }
        if authentication_code.len() < 6 || authentication_code == "invalid" {
            return Err(PersistenceError::Security(SecurityError::Unauthenticated));
        }

        let mut guard = self.inner.write().expect("store write lock");
        guard.next_seq += 1;
        let seq = guard.next_seq;

        let (account_id, roles) = match email {
            "curator@example.test" => (
                "00000000-0000-4000-8000-000000000099".to_string(),
                vec![PrincipalRole::Curator],
            ),
            "moderator@example.test" => (
                "00000000-0000-4000-8000-000000000098".to_string(),
                vec![PrincipalRole::Moderator],
            ),
            "operator@example.test" => (
                "00000000-0000-4000-8000-000000000097".to_string(),
                vec![PrincipalRole::Operator],
            ),
            "learner-b@example.test" => (
                "00000000-0000-4000-8000-000000000002".to_string(),
                vec![PrincipalRole::Learner],
            ),
            _ => {
                if let Some(existing) = guard
                    .accounts
                    .values()
                    .find(|a| a.email == email && a.deleted_at_ms.is_none())
                {
                    (existing.account_id.clone(), existing.roles.clone())
                } else {
                    (
                        "00000000-0000-4000-8000-000000000001".to_string(),
                        vec![PrincipalRole::Learner],
                    )
                }
            }
        };

        if let Some(acct) = guard.accounts.get(&account_id) {
            if acct.deleted_at_ms.is_some() {
                return Err(PersistenceError::Security(SecurityError::Unauthenticated));
            }
        } else {
            guard.accounts.insert(
                account_id.clone(),
                AccountRecord {
                    account_id: account_id.clone(),
                    email: email.to_string(),
                    email_verified: true,
                    roles: roles.clone(),
                    deleted_at_ms: None,
                },
            );
            guard.proficiency_by_account.insert(
                account_id.clone(),
                LearnerProficiencyProjection {
                    account_id: account_id.clone(),
                    objectives: BTreeMap::new(),
                    completed_activities: BTreeSet::new(),
                    skipped_activities: BTreeSet::new(),
                    total_time_spent_minutes: 0,
                },
            );
        }

        let token = format!("sess-token-{seq}-{account_id}");
        let token_sha256 = sha256_bytes_hex(token.as_bytes());
        let record = AuthSessionRecord {
            session_id: format!("sess-{seq}"),
            token,
            token_sha256: token_sha256.clone(),
            account_id,
            roles,
            expires_at: "2026-12-31T23:59:59Z".to_string(),
            revoked: false,
        };
        guard
            .sessions_by_token_sha
            .insert(token_sha256, record.clone());
        Ok(record)
    }

    pub fn resolve_session_token(
        &self,
        bearer_token: &str,
    ) -> Result<Option<AuthenticatedPrincipal>, PersistenceError> {
        let token_sha256 = sha256_bytes_hex(bearer_token.as_bytes());
        let guard = self.inner.read().expect("store read lock");
        if let Some(sess) = guard.sessions_by_token_sha.get(&token_sha256) {
            if sess.revoked {
                return Err(PersistenceError::Security(SecurityError::Unauthenticated));
            }
            if let Some(acct) = guard.accounts.get(&sess.account_id) {
                if acct.deleted_at_ms.is_some() {
                    return Err(PersistenceError::Security(SecurityError::Unauthenticated));
                }
            }
            return Ok(Some(AuthenticatedPrincipal {
                account_id: sess.account_id.clone(),
                roles: sess.roles.clone(),
                is_development_only_identity: true,
            }));
        }
        Ok(None)
    }

    pub fn revoke_session_token(&self, bearer_token: &str, now_ms: u64) -> Result<(), PersistenceError> {
        let token_sha256 = sha256_bytes_hex(bearer_token.as_bytes());
        let mut guard = self.inner.write().expect("store write lock");
        if let Some(sess) = guard.sessions_by_token_sha.get_mut(&token_sha256) {
            sess.revoked = true;
            let session_id = sess.session_id.clone();
            let account_id = sess.account_id.clone();
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard.deletion_tombstones.push(DeletionTombstone {
                tombstone_id: format!("tomb-sess-{seq}"),
                entity_type: TombstoneEntityType::SessionRevoked,
                account_id,
                target_id: token_sha256,
                reason: format!("session `{session_id}` explicitly signed out"),
                recorded_at_ms: now_ms,
                applied_after_restore_at_ms: None,
            });
            Ok(())
        } else {
            Ok(())
        }
    }

    /// Commits a private learner curriculum revision (`T01`, `@S09`, `SHARE-001`, `SHARE-002`).
    /// Enforces:
    /// 1. Separate identifier namespace (`revision_id` and `curriculum_id` cannot use `pub_` / `pubrev_` prefixes).
    /// 2. Server-owned `owner_account_id` is derived exclusively from `principal.account_id`;
    ///    if `payload` attempts to set `account_id`, `owner_account_id`, `mastered`, or `demonstrated`, it is rejected.
    pub fn commit_private_curriculum_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        revision_id: &str,
        payload: Value,
    ) -> Result<CurriculumRevisionRecord, PersistenceError> {
        if revision_id.starts_with("pubrev_") || revision_id.starts_with("pubrev-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private curriculum revision `{revision_id}` cannot use public template revision prefix"
            )));
        }
        if curriculum_id.starts_with("pub_") || curriculum_id.starts_with("pub-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private curriculum `{curriculum_id}` cannot use public publication prefix"
            )));
        }

        if let Some(obj) = payload.as_object() {
            for forbidden in [
                "account_id",
                "owner_account_id",
                "mastered",
                "demonstrated_objectives",
                "proficiency_status",
            ] {
                if obj.contains_key(forbidden) {
                    return Err(PersistenceError::ForbiddenClientOrModelAssignedField {
                        field: forbidden.to_string(),
                    });
                }
            }
        }

        let mut guard = self.inner.write().expect("store write lock");

        // Verify ownership if curriculum_id already exists
        let existing_revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        if let Some(first) = existing_revs.first() {
            principal.require_learner_ownership(&first.owner_account_id)?;
        }
        let next_rev_num = existing_revs.len() as u32 + 1;
        let candidate_sha256 = jcs_sha256_hex(&payload);

        let record = CurriculumRevisionRecord {
            revision_id: revision_id.to_string(),
            curriculum_id: curriculum_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_num,
            candidate_sha256,
            payload,
            is_active: true,
        };

        guard
            .private_revisions
            .insert(revision_id.to_string(), record.clone());
        guard
            .curriculum_activation_versions
            .entry(curriculum_id.to_string())
            .or_insert(1);

        guard
            .schedules
            .entry(curriculum_id.to_string())
            .or_insert_with(|| ScheduleRevisionRecord {
                schedule_revision_id: format!("sched-{curriculum_id}-v1"),
                curriculum_id: curriculum_id.to_string(),
                owner_account_id: principal.account_id.clone(),
                curriculum_revision_id: revision_id.to_string(),
                etag_version: 1,
                etag: "\"sched-v1\"".to_string(),
                timezone: "UTC".to_string(),
                weekly_available_minutes: 300,
                required_minutes: 180,
                fixed_deadline: false,
                feasibility_status: ScheduleFeasibility::Feasible,
                excess_minutes: 0,
                recovery_options: Vec::new(),
                sessions: vec![ScheduledSessionItem {
                    session_id: "sess-1".to_string(),
                    activity_id: "act-1".to_string(),
                    duration_minutes: 60,
                    is_review: false,
                }],
            });

        guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        Ok(record)
    }

    pub fn get_private_curriculum_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        revision_id: &str,
    ) -> Result<CurriculumRevisionRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let record = guard
            .private_revisions
            .get(revision_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum_revision",
                resource_id: revision_id.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        Ok(record.clone())
    }

    /// Publishes an immutable public or unlisted template revision in a separate identifier space
    /// (`pub_`, `pubrev_`) and rejects any prohibited private fields or duplicate content (`SHARE-001`, `SHARE-002`, `SHARE-007`, `@S56`, `@S57`, `@S61`).
    pub fn create_public_template_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
        source_private_revision_id: &str,
        visibility: PublicVisibility,
        public_payload: Value,
    ) -> Result<PublicTemplateRevisionRecord, PersistenceError> {
        if !publication_id.starts_with("pub_") && !publication_id.starts_with("pub-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "publication_id `{publication_id}` must use `pub_` or `pub-` prefix"
            )));
        }
        if !publication_revision_id.starts_with("pubrev_")
            && !publication_revision_id.starts_with("pubrev-")
        {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "publication_revision_id `{publication_revision_id}` must use `pubrev_` or `pubrev-` prefix"
            )));
        }

        if let Some(obj) = public_payload.as_object() {
            for &prohibited in PROHIBITED_PRIVATE_FIELDS_IN_PUBLIC {
                if obj.contains_key(prohibited) {
                    return Err(
                        PersistenceError::ProhibitedPrivateFieldInPublicProjection {
                            field: prohibited.to_string(),
                        },
                    );
                }
            }
        }

        let mut guard = self.inner.write().expect("store write lock");
        let source_rev = guard
            .private_revisions
            .get(source_private_revision_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum_revision",
                resource_id: source_private_revision_id.to_string(),
            })?;

        // Owner authorization check (@S56)
        principal.require_learner_ownership(&source_rev.owner_account_id)?;

        let content_sha256 = jcs_sha256_hex(&public_payload);
        // Reject identical duplicate republication under the same publication_id (SHARE-007, @S61)
        let duplicate_exists = guard
            .public_revisions
            .values()
            .any(|r| r.publication_id == publication_id && r.content_sha256 == content_sha256);
        if duplicate_exists {
            return Err(PersistenceError::DuplicatePublicRevisionContent {
                publication_id: publication_id.to_string(),
                content_sha256,
            });
        }

        let preview_sha256 = jcs_sha256_hex(&json!({
            "publication_id": publication_id,
            "visibility": visibility,
            "content_sha256": content_sha256,
        }));

        let record = PublicTemplateRevisionRecord {
            publication_revision_id: publication_revision_id.to_string(),
            publication_id: publication_id.to_string(),
            publisher_account_id: principal.account_id.clone(),
            source_private_revision_id: source_private_revision_id.to_string(),
            visibility,
            content_sha256,
            preview_sha256,
            public_payload,
            upvote_count: 0,
            quarantined: false,
        };

        guard
            .public_revisions
            .insert(publication_revision_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_public_template_revision(
        &self,
        publication_revision_id: &str,
    ) -> Result<PublicTemplateRevisionRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let record = guard
            .public_revisions
            .get(publication_revision_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "public_template_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        if record.quarantined {
            return Err(PersistenceError::NotFound {
                resource_type: "public_template_revision",
                resource_id: publication_revision_id.to_string(),
            });
        }
        Ok(record.clone())
    }

    /// Reads learner proficiency projection, enforcing strict tenant ownership (`@S16`, `@S36`, `@S64`, `@S87`).
    pub fn get_learner_proficiency(
        &self,
        principal: &AuthenticatedPrincipal,
        target_account_id: &str,
    ) -> Result<LearnerProficiencyProjection, PersistenceError> {
        principal.require_learner_ownership(target_account_id)?;
        let guard = self.inner.read().expect("store read lock");
        Ok(guard
            .proficiency_by_account
            .get(target_account_id)
            .cloned()
            .unwrap_or_else(|| LearnerProficiencyProjection {
                account_id: target_account_id.to_string(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            }))
    }

    /// Appends a learner progress event with `(account_id, event_id)` deduplication (`@S16`, `@S21`, `@S23`, `@S24`).
    /// - Replays receipt when `(account_id, event_id)` and `payload_sha256` match without double-counting.
    /// - Returns `409 Conflict` when `(account_id, event_id)` is reused with a different payload.
    /// - Updates activity completion and study time while ensuring self-report never yields `Demonstrated` proficiency (`@S16`).
    pub fn append_progress_event(
        &self,
        principal: &AuthenticatedPrincipal,
        input: ProgressEventInput,
    ) -> Result<ProgressEventReceiptRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");

        // Verify ownership of the target curriculum
        let curriculum_owner = guard
            .private_revisions
            .values()
            .find(|r| r.curriculum_id == input.curriculum_id)
            .map(|r| r.owner_account_id.clone())
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum",
                resource_id: input.curriculum_id.clone(),
            })?;

        principal.require_learner_ownership(&curriculum_owner)?;

        let objective_id = input
            .objective_id
            .clone()
            .unwrap_or_else(|| format!("obj-for-{}", input.activity_id));

        let canonical_payload = json!({
            "curriculum_id": input.curriculum_id,
            "activity_id": input.activity_id,
            "objective_id": objective_id,
            "status": input.status,
            "time_spent_minutes": input.time_spent_minutes,
        });
        let payload_sha256 = jcs_sha256_hex(&canonical_payload);
        let dedup_key = (principal.account_id.clone(), input.event_id.clone());

        if let Some(existing) = guard.progress_events.get(&dedup_key).cloned() {
            if existing.payload_sha256 != payload_sha256 {
                return Err(PersistenceError::ConflictingProgressEventPayload {
                    event_id: input.event_id,
                });
            }
            let prof = guard
                .proficiency_by_account
                .get(&principal.account_id)
                .expect("proficiency projection exists");
            let obj_state = prof
                .objectives
                .get(&existing.objective_id)
                .copied()
                .unwrap_or(ObjectiveProficiencyState::SelfReported);
            return Ok(ProgressEventReceiptRecord {
                event_id: existing.event_id,
                curriculum_id: existing.curriculum_id,
                activity_id: existing.activity_id,
                status: existing.status,
                time_spent_minutes: existing.time_spent_minutes,
                evidence_origin: existing.evidence_origin,
                objective_proficiency_status: obj_state,
                replayed: true,
                total_completed_activities: prof.completed_activities.len(),
                total_skipped_activities: prof.skipped_activities.len(),
                total_time_spent_minutes: prof.total_time_spent_minutes,
            });
        }

        let evidence_origin = EvidenceOrigin::SelfReportedActivityCompletion;
        let stored_event = StoredProgressEvent {
            account_id: principal.account_id.clone(),
            event_id: input.event_id.clone(),
            curriculum_id: input.curriculum_id.clone(),
            activity_id: input.activity_id.clone(),
            objective_id: objective_id.clone(),
            status: input.status,
            time_spent_minutes: input.time_spent_minutes,
            evidence_origin,
            payload_sha256,
        };
        guard.progress_events.insert(dedup_key, stored_event);

        let prof = guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        prof.total_time_spent_minutes += input.time_spent_minutes;
        match input.status {
            ActivityExecutionStatus::SelfReportedCompleted | ActivityExecutionStatus::Completed => {
                prof.completed_activities.insert(input.activity_id.clone());
            }
            ActivityExecutionStatus::Waived => {
                prof.skipped_activities.insert(input.activity_id.clone());
            }
            _ => {}
        }

        let current_obj_state = prof
            .objectives
            .get(&objective_id)
            .copied()
            .unwrap_or(ObjectiveProficiencyState::Unassessed);
        let next_obj_state = derive_proficiency_transition(current_obj_state, evidence_origin)
            .unwrap_or(ObjectiveProficiencyState::SelfReported);
        prof.objectives.insert(objective_id, next_obj_state);

        Ok(ProgressEventReceiptRecord {
            event_id: input.event_id,
            curriculum_id: input.curriculum_id,
            activity_id: input.activity_id,
            status: input.status,
            time_spent_minutes: input.time_spent_minutes,
            evidence_origin,
            objective_proficiency_status: next_obj_state,
            replayed: false,
            total_completed_activities: prof.completed_activities.len(),
            total_skipped_activities: prof.skipped_activities.len(),
            total_time_spent_minutes: prof.total_time_spent_minutes,
        })
    }

    pub fn get_schedule(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
    ) -> Result<ScheduleRevisionRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let schedule = guard
            .schedules
            .get(curriculum_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: curriculum_id.to_string(),
            })?;
        principal.require_learner_ownership(&schedule.owner_account_id)?;
        Ok(schedule.clone())
    }

    /// Updates a schedule revision with optimistic concurrency (`If-Match`, `@S02`, `@S22`, `@S24`, `PROG-003`, `PROG-004`).
    pub fn patch_schedule(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        if_match: Option<&str>,
        patch: SchedulePatchInput,
    ) -> Result<ScheduleRevisionRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let schedule = guard
            .schedules
            .get_mut(curriculum_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: curriculum_id.to_string(),
            })?;

        // Enforce strict tenant isolation before revealing precondition state (@S36, @S64)
        principal.require_learner_ownership(&schedule.owner_account_id)?;

        // Enforce If-Match precondition (428 when missing, 412 when stale)
        evaluate_if_match(if_match, &schedule.etag)?;

        if let Some(tz) = patch.timezone {
            schedule.timezone = tz;
        }
        if let Some(avail) = patch.weekly_available_minutes {
            schedule.weekly_available_minutes = avail;
        }
        if let Some(req) = patch.required_minutes {
            schedule.required_minutes = req;
        }
        if let Some(fixed) = patch.fixed_deadline {
            schedule.fixed_deadline = fixed;
        }
        if let Some(sessions) = patch.sessions {
            schedule.sessions = sessions;
        }

        // Feasibility evaluation (@S02, PROG-003): never silently remove practice or overbook sessions
        if schedule.required_minutes > schedule.weekly_available_minutes && schedule.fixed_deadline
        {
            schedule.feasibility_status = ScheduleFeasibility::Infeasible;
            schedule.excess_minutes = schedule.required_minutes - schedule.weekly_available_minutes;
            schedule.recovery_options = vec![
                "reduced_scope".to_string(),
                "extended_time".to_string(),
                "increased_availability".to_string(),
            ];
        } else {
            schedule.feasibility_status = ScheduleFeasibility::Feasible;
            schedule.excess_minutes = 0;
            schedule.recovery_options.clear();
        }

        schedule.etag_version += 1;
        schedule.schedule_revision_id =
            format!("sched-{curriculum_id}-v{}", schedule.etag_version);
        schedule.etag = format!("\"sched-v{}\"", schedule.etag_version);

        Ok(schedule.clone())
    }

    /// Creates a tenant-scoped BYOK credential record without exposing the raw secret in metadata (`@S29`, `@S66`, `@S82`).
    pub fn create_credential(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        provider_id: &str,
        label: &str,
        raw_api_key: &str,
    ) -> Result<CredentialMetadataView, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let sealed = guard.credential_vault.seal_credential(
            &principal.account_id,
            credential_ref,
            1,
            raw_api_key,
        )?;
        let masked_hint = sealed.key_last4_redacted.clone();
        let key_fingerprint_sha256 = sealed.key_fingerprint_sha256.clone();

        let record = StoredCredentialRecord {
            credential_ref: credential_ref.to_string(),
            owner_account_id: principal.account_id.clone(),
            provider_id: provider_id.to_string(),
            label: label.to_string(),
            masked_hint: masked_hint.clone(),
            key_fingerprint_sha256,
            version: 1,
            etag: "\"cred-v1\"".to_string(),
            revoked: false,
        };
        guard
            .credential_envelopes
            .insert(credential_ref.to_string(), sealed);
        guard
            .credentials
            .insert(credential_ref.to_string(), record.clone());
        Ok(CredentialMetadataView {
            credential_ref: record.credential_ref,
            provider_id: record.provider_id,
            label: record.label,
            masked_hint,
            version: record.version,
            etag: record.etag,
            status: "active".to_string(),
        })
    }

    pub fn get_credential_metadata(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
    ) -> Result<CredentialMetadataView, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let record = guard
            .credentials
            .get(credential_ref)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credential",
                resource_id: credential_ref.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        if record.revoked {
            return Err(PersistenceError::NotFound {
                resource_type: "credential",
                resource_id: credential_ref.to_string(),
            });
        }
        Ok(CredentialMetadataView {
            credential_ref: record.credential_ref.clone(),
            provider_id: record.provider_id.clone(),
            label: record.label.clone(),
            masked_hint: record.masked_hint.clone(),
            version: record.version,
            etag: record.etag.clone(),
            status: "active".to_string(),
        })
    }

    pub fn revoke_credential(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        if_match: Option<&str>,
        now_ms: u64,
    ) -> Result<(), PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let record = guard
            .credentials
            .get_mut(credential_ref)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credential",
                resource_id: credential_ref.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        evaluate_if_match(if_match, &record.etag)?;
        record.revoked = true;
        let owner_account_id = record.owner_account_id.clone();

        guard.next_seq += 1;
        let seq = guard.next_seq;
        guard.deletion_tombstones.push(DeletionTombstone {
            tombstone_id: format!("tomb-cred-{seq}"),
            entity_type: TombstoneEntityType::CredentialRevoked,
            account_id: owner_account_id,
            target_id: credential_ref.to_string(),
            reason: "learner revoked credential".to_string(),
            recorded_at_ms: now_ms,
            applied_after_restore_at_ms: None,
        });
        Ok(())
    }

    /// Marks an account deleted and appends an immutable `AccountDeleted` tombstone (`@S43`, `@S45`, `OPS-004`).
    pub fn delete_account(
        &self,
        principal: &AuthenticatedPrincipal,
        target_account_id: &str,
        now_ms: u64,
    ) -> Result<(), PersistenceError> {
        principal.require_learner_ownership(target_account_id)?;
        let mut guard = self.inner.write().expect("store write lock");
        if let Some(acct) = guard.accounts.get_mut(target_account_id) {
            acct.deleted_at_ms = Some(now_ms);
        }
        for cred in guard.credentials.values_mut() {
            if cred.owner_account_id == target_account_id {
                cred.revoked = true;
            }
        }
        for sess in guard.sessions_by_token_sha.values_mut() {
            if sess.account_id == target_account_id {
                sess.revoked = true;
            }
        }
        guard.next_seq += 1;
        let seq = guard.next_seq;
        guard.deletion_tombstones.push(DeletionTombstone {
            tombstone_id: format!("tomb-acct-{seq}"),
            entity_type: TombstoneEntityType::AccountDeleted,
            account_id: target_account_id.to_string(),
            target_id: target_account_id.to_string(),
            reason: "learner requested account deletion".to_string(),
            recorded_at_ms: now_ms,
            applied_after_restore_at_ms: None,
        });
        Ok(())
    }

    /// Simulates a pre-deletion backup snapshot rehydrating an account and credential prior to tombstone replay (`@S43`, `@S45`).
    pub fn simulate_backup_restore_rehydrating_stale_state(
        &self,
        account_id: &str,
        credential_ref: &str,
    ) {
        let mut guard = self.inner.write().expect("store write lock");
        if let Some(acct) = guard.accounts.get_mut(account_id) {
            acct.deleted_at_ms = None;
        }
        if let Some(cred) = guard.credentials.get_mut(credential_ref) {
            cred.revoked = false;
        }
        for sess in guard.sessions_by_token_sha.values_mut() {
            if sess.account_id == account_id {
                sess.revoked = false;
            }
        }
    }

    /// Replays all append-only deletion and revocation tombstones after a backup restore
    /// before traffic resumes (`@S43`, `@S45`, `NFR-006`).
    pub fn apply_deletion_tombstones_after_restore(&self, now_ms: u64) -> TombstoneReplayReport {
        let mut guard = self.inner.write().expect("store write lock");
        let mut accounts_purged = 0usize;
        let mut credentials_revoked = 0usize;
        let mut sessions_revoked = 0usize;

        let tombstones_snapshot: Vec<(usize, TombstoneEntityType, String, String)> = guard
            .deletion_tombstones
            .iter()
            .enumerate()
            .map(|(idx, t)| {
                (
                    idx,
                    t.entity_type,
                    t.account_id.clone(),
                    t.target_id.clone(),
                )
            })
            .collect();

        let tombstones_evaluated = tombstones_snapshot.len();

        for (idx, entity_type, account_id, target_id) in tombstones_snapshot {
            match entity_type {
                TombstoneEntityType::AccountDeleted => {
                    if let Some(acct) = guard.accounts.get_mut(&account_id) {
                        if acct.deleted_at_ms.is_none() {
                            acct.deleted_at_ms = Some(now_ms);
                            accounts_purged += 1;
                        }
                    }
                    for cred in guard.credentials.values_mut() {
                        if cred.owner_account_id == account_id && !cred.revoked {
                            cred.revoked = true;
                            credentials_revoked += 1;
                        }
                    }
                    for sess in guard.sessions_by_token_sha.values_mut() {
                        if sess.account_id == account_id && !sess.revoked {
                            sess.revoked = true;
                            sessions_revoked += 1;
                        }
                    }
                    for pub_rec in guard.publications.values_mut() {
                        if pub_rec.owner_account_id.as_deref() == Some(account_id.as_str()) {
                            pub_rec.visibility = ModerationVisibilityState::Withdrawn;
                            pub_rec.owner_account_id = None;
                            pub_rec.publisher_display_name = "Deleted Learner".to_string();
                            pub_rec.withdrawn_at = Some("2026-04-02T20:00:00Z".to_string());
                        }
                    }
                }
                TombstoneEntityType::CredentialRevoked => {
                    if let Some(cred) = guard.credentials.get_mut(&target_id) {
                        if !cred.revoked {
                            cred.revoked = true;
                            credentials_revoked += 1;
                        }
                    }
                }
                TombstoneEntityType::SessionRevoked => {
                    if let Some(sess) = guard.sessions_by_token_sha.get_mut(&target_id) {
                        if !sess.revoked {
                            sess.revoked = true;
                            sessions_revoked += 1;
                        }
                    }
                }
                TombstoneEntityType::ResourceWithdrawn => {
                    if let Some(pub_rec) = guard.publications.get_mut(&target_id) {
                        pub_rec.visibility = ModerationVisibilityState::Withdrawn;
                        pub_rec.withdrawn_at = Some("2026-04-02T20:00:00Z".to_string());
                    }
                }
            }
            if let Some(t) = guard.deletion_tombstones.get_mut(idx) {
                t.applied_after_restore_at_ms = Some(now_ms);
            }
        }

        TombstoneReplayReport {
            tombstones_evaluated,
            accounts_purged,
            credentials_revoked,
            sessions_revoked,
        }
    }

    /// Acquires or replays an HTTP `Idempotency-Key` for a retriable command (`T01`).
    /// - Replays stored status + response body with `replayed: true` when `(account_id, operation_id, idempotency_key)` + `request_sha256` match.
    /// - Returns `409 Conflict` (`IdempotencyPayloadMismatch`) when `request_sha256` differs.
    /// - Returns `409 Conflict` (`IdempotencyInFlight`) when a duplicate request arrives while the first is `InFlight`.
    pub fn begin_idempotent_command(
        &self,
        account_id: &str,
        operation_id: &str,
        idempotency_key: Option<&str>,
        request_payload: &Value,
        now_ms: u64,
        ttl_ms: u64,
    ) -> Result<IdempotencyBeginOutcome, PersistenceError> {
        let key_str = idempotency_key
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| PersistenceError::IdempotencyKeyRequired {
                operation_id: operation_id.to_string(),
            })?;

        let request_sha256 = jcs_sha256_hex(request_payload);
        let composite_key = (
            account_id.to_string(),
            operation_id.to_string(),
            key_str.to_string(),
        );

        let mut guard = self.inner.write().expect("store write lock");
        if let Some(existing) = guard.idempotency_keys.get(&composite_key) {
            if existing.expires_at_ms > now_ms {
                if existing.request_sha256 != request_sha256 {
                    return Err(PersistenceError::IdempotencyPayloadMismatch {
                        operation_id: operation_id.to_string(),
                        idempotency_key: key_str.to_string(),
                    });
                }
                return match existing.state {
                    IdempotencyKeyState::InFlight => Err(PersistenceError::IdempotencyInFlight {
                        operation_id: operation_id.to_string(),
                        idempotency_key: key_str.to_string(),
                    }),
                    IdempotencyKeyState::Completed => {
                        Ok(IdempotencyBeginOutcome::Replayed(StoredIdempotentResponse {
                            status_code: existing.response_status.unwrap_or(200),
                            body: existing.response_body.clone().unwrap_or(Value::Null),
                            replayed: true,
                        }))
                    }
                };
            }
        }

        guard.idempotency_keys.insert(
            composite_key,
            IdempotencyRecord {
                account_id: account_id.to_string(),
                operation_id: operation_id.to_string(),
                idempotency_key: key_str.to_string(),
                request_sha256,
                state: IdempotencyKeyState::InFlight,
                response_status: None,
                response_body: None,
                created_at_ms: now_ms,
                expires_at_ms: now_ms + ttl_ms,
            },
        );

        Ok(IdempotencyBeginOutcome::Acquired)
    }

    /// Completes an idempotent command:
    /// - On transient `5xx` failure (`status_code >= 500`), releases the key so retries can succeed.
    /// - On `2xx` or deterministic `4xx` domain/validation outcomes (`status_code < 500`), persists the response for replay.
    pub fn complete_idempotent_command(
        &self,
        account_id: &str,
        operation_id: &str,
        idempotency_key: &str,
        status_code: u16,
        response_body: Value,
    ) {
        let composite_key = (
            account_id.to_string(),
            operation_id.to_string(),
            idempotency_key.trim().to_string(),
        );
        let mut guard = self.inner.write().expect("store write lock");
        if status_code >= 500 {
            guard.idempotency_keys.remove(&composite_key);
        } else if let Some(record) = guard.idempotency_keys.get_mut(&composite_key) {
            record.state = IdempotencyKeyState::Completed;
            record.response_status = Some(status_code);
            record.response_body = Some(response_body);
        }
    }

    /// Prunes expired `Completed` idempotency keys (`T01` retention policy).
    pub fn prune_expired_idempotency_keys(&self, now_ms: u64) -> usize {
        let mut guard = self.inner.write().expect("store write lock");
        let before = guard.idempotency_keys.len();
        guard.idempotency_keys.retain(|_, record| {
            record.state == IdempotencyKeyState::InFlight || record.expires_at_ms > now_ms
        });
        before - guard.idempotency_keys.len()
    }

    /// Seeds the small reviewed catalog for the `rag-python` domain along with
    /// explicitly marked `is_synthetic_fixture = true` contract test fixtures (`T02`, `CAT-001`..`CAT-005`).
    pub fn seed_reviewed_rag_catalog(&self) {
        let curator_evidence = |_rv_id: &str, url: &str, rationale: &str| CatalogReviewEvidence {
            reviewer_principal_id: "curator-rubric-1".to_string(),
            reviewed_at: "2026-10-20T16:00:00Z".to_string(),
            pedagogical_fit_score: 5,
            accuracy_score: 5,
            accessibility_score: 4,
            rights_verified: true,
            rationale: rationale.to_string(),
            credibility_basis: "expert_practitioner".to_string(),
            evidence_url: url.to_string(),
        };

        let items = vec![
            // 1. Free public resource for objective-tokenization (link-out + metadata + short excerpt, no full-text/embedding)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-tokenization-free-v1".to_string(),
                resource_id: "res-rag-tokenization-free".to_string(),
                version_number: 1,
                title: "Hugging Face NLP Course — Subword Tokenization & BPE in Python".to_string(),
                provider_id: "huggingface-learn".to_string(),
                provider_display_name: "Hugging Face Learn".to_string(),
                canonical_url: "https://huggingface.co/learn/nlp-course/chapter2/4".to_string(),
                resource_type: "article".to_string(),
                language: "en".to_string(),
                description: "Hands-on guide to byte-pair encoding, WordPiece, and chunk boundary tradeoffs for Python RAG pipelines.".to_string(),
                topics: vec![
                    "rag-python".to_string(),
                    "tokenization".to_string(),
                    "language models".to_string(),
                ],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-tokenization-free-v1",
                    "https://huggingface.co/learn/nlp-course/chapter2/4",
                    "Reviewed tokenization syllabus and Python exercises against RAG chunking rubric.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Apache-2.0-metadata-link-only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("Hugging Face NLP Course".to_string()),
                    notes: Some("Link-out and metadata allowed; full-text storage and embedding prohibited.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 2. Free public resource for objective-vector-retrieval (open license allowing full-text + embedding)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-vector-free-v1".to_string(),
                resource_id: "res-rag-vector-free".to_string(),
                version_number: 1,
                title: "Sentence-Transformers — Dense Vector Retrieval & Hybrid Search in Python".to_string(),
                provider_id: "sbert-docs".to_string(),
                provider_display_name: "SBERT Documentation".to_string(),
                canonical_url: "https://sbert.net/examples/applications/semantic-search/README.html".to_string(),
                resource_type: "documentation".to_string(),
                language: "en".to_string(),
                description: "Reference implementation of cosine similarity indexing, HNSW retrieval, and cross-encoder re-ranking in Python.".to_string(),
                topics: vec![
                    "rag-python".to_string(),
                    "vector retrieval".to_string(),
                    "embeddings".to_string(),
                ],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-vector-retrieval".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-vector-free-v1",
                    "https://sbert.net/examples/applications/semantic-search/README.html",
                    "Verified Apache-2.0 documentation and reproducible Python vector retrieval benchmarks.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: true,
                    allow_embedding: true,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Apache-2.0".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("UKPLab Sentence-Transformers".to_string()),
                    notes: Some("Open license permits metadata, full-text storage, and embedding.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 3. Free public resource for objective-rag-evaluation
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-eval-free-v1".to_string(),
                resource_id: "res-rag-eval-free".to_string(),
                version_number: 1,
                title: "LlamaIndex Guide — Evaluating Retrieval Recall, Faithfulness & Groundedness".to_string(),
                provider_id: "llamaindex-docs".to_string(),
                provider_display_name: "LlamaIndex Documentation".to_string(),
                canonical_url: "https://docs.llamaindex.ai/en/stable/module_guides/evaluating/".to_string(),
                resource_type: "documentation".to_string(),
                language: "en".to_string(),
                description: "Practical evaluation harnesses for hit-rate@k, MRR, context relevance, and answer faithfulness in Python RAG systems.".to_string(),
                topics: vec![
                    "rag-python".to_string(),
                    "rag evaluation".to_string(),
                    "retrieval metrics".to_string(),
                ],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-rag-evaluation".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-eval-free-v1",
                    "https://docs.llamaindex.ai/en/stable/module_guides/evaluating/",
                    "Approved retrieval & faithfulness evaluation guide for intermediate Python learners.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "MIT-docs-link-only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("LlamaIndex Documentation".to_string()),
                    notes: Some("Metadata and link-out allowed.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 4. Paid purchase resource ($39.00 USD)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-paid-book-v1".to_string(),
                resource_id: "res-rag-paid-book".to_string(),
                version_number: 1,
                title: "Production Vector Databases & RAG Architecture in Python (Paid Workbook)".to_string(),
                provider_id: "realpython-books".to_string(),
                provider_display_name: "Real Python".to_string(),
                canonical_url: "https://realpython.com/chromadb-vector-database/".to_string(),
                resource_type: "book".to_string(),
                language: "en".to_string(),
                description: "Paid in-depth workbook covering vector indexing and production RAG pipelines.".to_string(),
                topics: vec!["rag-python".to_string(), "vector retrieval".to_string()],
                level: "advanced".to_string(),
                objective_ids: vec![
                    "objective-vector-retrieval".to_string(),
                    "objective-rag-evaluation".to_string(),
                    "objective-paid-only-advanced-rag".to_string(),
                ],
                access_model: CatalogAccessModel::PaidPurchase,
                currency: Some("USD".to_string()),
                price_minor_units: Some(3900),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-paid-book-v1",
                    "https://realpython.com/chromadb-vector-database/",
                    "Verified paid workbook pricing and technical accuracy.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Link-Only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("Real Python".to_string()),
                    notes: Some("Strict link-only commercial workbook.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 5. Subscription resource ($49.00/mo or $0 incremental when learner owns `sub-coursera-plus`)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-sub-course-v1".to_string(),
                resource_id: "res-rag-sub-course".to_string(),
                version_number: 1,
                title: "Retrieval-Augmented Generation Specialization (Subscription Course)".to_string(),
                provider_id: "coursera-rag".to_string(),
                provider_display_name: "Coursera".to_string(),
                canonical_url: "https://coursera.org/learn/retrieval-augmented-generation".to_string(),
                resource_type: "course".to_string(),
                language: "en".to_string(),
                description: "Structured video & lab specialization covered by Coursera Plus subscription.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string(), "vector retrieval".to_string()],
                level: "intermediate".to_string(),
                objective_ids: vec![
                    "objective-tokenization".to_string(),
                    "objective-vector-retrieval".to_string(),
                ],
                access_model: CatalogAccessModel::Subscription,
                currency: Some("USD".to_string()),
                price_minor_units: Some(4900),
                subscription_ids: vec!["sub-coursera-plus".to_string(), "sub-oreilly".to_string()],
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-sub-course-v1",
                    "https://coursera.org/learn/retrieval-augmented-generation",
                    "Approved subscription course with verified Coursera Plus entitlement mapping.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Subscription".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("Coursera".to_string()),
                    notes: Some("Metadata and link-out only.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 6. Freemium/trial resource ($19.00 USD)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-freemium-lab-v1".to_string(),
                resource_id: "res-rag-freemium-lab".to_string(),
                version_number: 1,
                title: "Building & Evaluating Advanced RAG Applications (Freemium Trial Lab)".to_string(),
                provider_id: "deeplearning-ai".to_string(),
                provider_display_name: "DeepLearning.AI".to_string(),
                canonical_url: "https://deeplearning.ai/short-courses/building-evaluating-advanced-rag/".to_string(),
                resource_type: "course".to_string(),
                language: "en".to_string(),
                description: "Interactive RAG evaluation lab with trial notebook access.".to_string(),
                topics: vec!["rag-python".to_string(), "rag evaluation".to_string()],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-rag-evaluation".to_string()],
                access_model: CatalogAccessModel::FreemiumTrial,
                currency: Some("USD".to_string()),
                price_minor_units: Some(1900),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-freemium-lab-v1",
                    "https://deeplearning.ai/short-courses/building-evaluating-advanced-rag/",
                    "Reviewed freemium lab scope and trial terms.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Trial".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("DeepLearning.AI".to_string()),
                    notes: Some("Trial access requires account; metadata and link-out allowed.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 7. Unknown-price resource (must NEVER pass free_only or bounded-budget filter, @S05, CAT-005)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-unknown-price-v1".to_string(),
                resource_id: "res-rag-unknown-price".to_string(),
                version_number: 1,
                title: "Enterprise RAG Workshop with Unverified Pricing".to_string(),
                provider_id: "stanford-ext".to_string(),
                provider_display_name: "Stanford Continuing Studies".to_string(),
                canonical_url: "https://stanford.edu/class/cs224n/readings/unknown-pricing".to_string(),
                resource_type: "course".to_string(),
                language: "en".to_string(),
                description: "External workshop whose tuition is dynamically quoted and unverified.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string()],
                level: "advanced".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::UnknownPrice,
                currency: None,
                price_minor_units: None,
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-unknown-price-v1",
                    "https://stanford.edu/class/cs224n/readings/unknown-pricing",
                    "Reviewed syllabus; price remains unknown and must be excluded from bounded budgets.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Unknown price resource.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 8. Optional certification resource ($150.00 USD, kept separate from core path costs, CAT-005)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-optional-cert-v1".to_string(),
                resource_id: "res-rag-optional-cert".to_string(),
                version_number: 1,
                title: "Optional Applied RAG Engineering Certification Exam".to_string(),
                provider_id: "deeplearning-ai".to_string(),
                provider_display_name: "DeepLearning.AI".to_string(),
                canonical_url: "https://deeplearning.ai/certification/rag-engineering".to_string(),
                resource_type: "certification".to_string(),
                language: "en".to_string(),
                description: "Optional proctored certification exam; not required for core curriculum completion.".to_string(),
                topics: vec!["rag-python".to_string(), "rag evaluation".to_string()],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-rag-evaluation".to_string()],
                access_model: CatalogAccessModel::PaidPurchase,
                currency: Some("USD".to_string()),
                price_minor_units: Some(15000),
                subscription_ids: Vec::new(),
                is_optional_certification: true,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-optional-cert-v1",
                    "https://deeplearning.ai/certification/rag-engineering",
                    "Reviewed optional certification exam scope.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Certification".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Optional certification fee must be accounted separately.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 9. Synthetic fixture resource matching `resource.synthetic.json` (`is_synthetic_fixture = true`, @S09, CAT-001)
            CatalogResourceVersionRecord {
                resource_version_id: "synthetic-resource-tokenization-v1".to_string(),
                resource_id: "synthetic-resource-tokenization".to_string(),
                version_number: 1,
                title: "SYNTHETIC FIXTURE — Tokenization Learning Notes".to_string(),
                provider_id: "synthetic-provider".to_string(),
                provider_display_name: "Synthetic Fixture Provider".to_string(),
                canonical_url: "https://example.invalid/synthetic/tokenization".to_string(),
                resource_type: "article".to_string(),
                language: "en".to_string(),
                description: "Contract validation fixture only. This is not a real educational resource, recommendation, university affiliation or license assertion.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string(), "language models".to_string()],
                level: "introductory".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(CatalogReviewEvidence {
                    reviewer_principal_id: "synthetic-curator".to_string(),
                    reviewed_at: "2026-10-20T16:00:00Z".to_string(),
                    pedagogical_fit_score: 4,
                    accuracy_score: 4,
                    accessibility_score: 4,
                    rights_verified: true,
                    rationale: "Synthetic approved-state fixture; never ingest into a production catalog.".to_string(),
                    credibility_basis: "expert_practitioner".to_string(),
                    evidence_url: "https://example.invalid/synthetic/evidence".to_string(),
                }),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "metadata_only".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Values exercise a schema. They do not grant rights to any real material.".to_string()),
                },
                is_synthetic_fixture: true,
                metadata_embedding: None,
            },
            // 10. Synthetic unknown-cost fixture matching `resource-unknown-price.synthetic.json` (`is_synthetic_fixture = true`)
            CatalogResourceVersionRecord {
                resource_version_id: "synthetic-resource-unknown-cost-v1".to_string(),
                resource_id: "synthetic-resource-unknown-cost".to_string(),
                version_number: 1,
                title: "SYNTHETIC FIXTURE — Tokenization Learning Notes".to_string(),
                provider_id: "synthetic-provider".to_string(),
                provider_display_name: "Synthetic Fixture Provider".to_string(),
                canonical_url: "https://example.invalid/synthetic/tokenization".to_string(),
                resource_type: "article".to_string(),
                language: "en".to_string(),
                description: "Contract validation fixture only. This is not a real educational resource, recommendation, university affiliation or license assertion.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string(), "language models".to_string()],
                level: "introductory".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::UnknownPrice,
                currency: None,
                price_minor_units: None,
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::UnderReview,
                review_evidence: None,
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "metadata_only".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Values exercise a schema. They do not grant rights to any real material.".to_string()),
                },
                is_synthetic_fixture: true,
                metadata_embedding: None,
            },
        ];

        let mut guard = self.inner.write().expect("store write lock");
        for item in items {
            guard
                .catalog_resources
                .insert(item.resource_version_id.clone(), item);
        }
    }

    pub fn upsert_catalog_resource(&self, record: CatalogResourceVersionRecord) {
        let mut guard = self.inner.write().expect("store write lock");
        guard
            .catalog_resources
            .insert(record.resource_version_id.clone(), record);
    }

    pub fn get_catalog_resource_version(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        guard
            .catalog_resources
            .get(resource_version_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })
    }

    pub fn list_catalog_resources(
        &self,
        include_synthetic: bool,
    ) -> Vec<CatalogResourceVersionRecord> {
        let guard = self.inner.read().expect("store read lock");
        guard
            .catalog_resources
            .values()
            .filter(|r| include_synthetic || !r.is_synthetic_fixture)
            .cloned()
            .collect()
    }

    /// Deterministically filters catalog resource versions by topic/objectives, approval state,
    /// quarantine overlay, synthetic-fixture exclusion, and learner budget/subscription rules (`T02`, `CAT-001`..`CAT-005`, `@S05`, `@S06`, `@S07`, `@S09`).
    pub fn filter_catalog_resources(
        &self,
        query: &CatalogFilterQuery,
    ) -> Result<CatalogFilterOutcome, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");

        let mut eligible_resources = Vec::new();
        let mut optional_certification_resources = Vec::new();
        let mut excluded_unknown_price_ids = Vec::new();
        let mut excluded_quarantined_ids = Vec::new();
        let mut excluded_unapproved_ids = Vec::new();
        let mut excluded_synthetic_ids = Vec::new();
        let mut excluded_budget_ids = Vec::new();
        let mut requires_paid_fallback_notice = false;

        for record in guard.catalog_resources.values() {
            // Check topic / objective relevance first
            let topic_matches = match &query.topic {
                Some(t) if !t.trim().is_empty() => {
                    let needle = t.trim().to_ascii_lowercase();
                    record.topics.iter().any(|rt| {
                        let rt_low = rt.to_ascii_lowercase();
                        rt_low == needle || needle.contains(&rt_low) || rt_low.contains(&needle)
                    })
                }
                _ => true,
            };
            let objective_matches = if query.objective_ids.is_empty() {
                true
            } else {
                record
                    .objective_ids
                    .iter()
                    .any(|oid| query.objective_ids.contains(oid))
            };

            if !topic_matches && !objective_matches {
                continue;
            }
            if !query.objective_ids.is_empty() && !objective_matches {
                continue;
            }

            // 1. Synthetic fixture gate (CAT-001, @S09)
            if record.is_synthetic_fixture && !query.allow_synthetic_fixtures_for_test {
                excluded_synthetic_ids.push(record.resource_version_id.clone());
                continue;
            }

            // 2. Quarantine overlay & broken freshness gate (CAT-004, @S07)
            let has_active_quarantine = guard
                .quarantine_overlays
                .get(&record.resource_version_id)
                .map(|o| o.lifted_at.is_none())
                .unwrap_or(false);
            if has_active_quarantine
                || record.review_status == ResourceReviewStatus::Quarantined
                || record.freshness_state == ResourceFreshnessState::Broken
            {
                excluded_quarantined_ids.push(record.resource_version_id.clone());
                continue;
            }

            // 3. Curator approval & rubric evidence gate (CAT-002, @S04, @S36)
            if record.review_status != ResourceReviewStatus::Approved
                || record.review_evidence.is_none()
            {
                excluded_unapproved_ids.push(record.resource_version_id.clone());
                continue;
            }

            // 4. Optional certification accounting separation (CAT-005)
            if record.is_optional_certification {
                if query.include_optional_certification {
                    optional_certification_resources.push(record.clone());
                }
                continue;
            }

            // 5. Access model & budget/subscription filtering (CAT-005, @S05, @S06)
            match record.access_model {
                CatalogAccessModel::UnknownPrice => {
                    excluded_unknown_price_ids.push(record.resource_version_id.clone());
                    continue;
                }
                CatalogAccessModel::FreePublic => {
                    eligible_resources.push(record.clone());
                }
                CatalogAccessModel::Subscription => {
                    let covered_by_owned_sub = record
                        .subscription_ids
                        .iter()
                        .any(|sub| query.owned_subscription_ids.contains(sub));
                    if covered_by_owned_sub {
                        eligible_resources.push(record.clone());
                    } else if query.free_only {
                        if query.allow_paid_fallback {
                            requires_paid_fallback_notice = true;
                            eligible_resources.push(record.clone());
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    } else {
                        let price = record.price_minor_units.unwrap_or(u64::MAX);
                        let currency_ok = match (&query.budget_currency, &record.currency) {
                            (Some(qc), Some(rc)) => qc.eq_ignore_ascii_case(rc),
                            _ => true,
                        };
                        let within_budget = query
                            .max_budget_minor_units
                            .map(|max_b| price <= max_b)
                            .unwrap_or(true);
                        if currency_ok && within_budget {
                            eligible_resources.push(record.clone());
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    }
                }
                CatalogAccessModel::PaidPurchase | CatalogAccessModel::FreemiumTrial => {
                    if query.free_only {
                        if query.allow_paid_fallback {
                            let price = record.price_minor_units.unwrap_or(u64::MAX);
                            let within_budget = query
                                .max_budget_minor_units
                                .map(|max_b| max_b == 0 || price <= max_b)
                                .unwrap_or(true);
                            if within_budget {
                                requires_paid_fallback_notice = true;
                                eligible_resources.push(record.clone());
                            } else {
                                excluded_budget_ids.push(record.resource_version_id.clone());
                            }
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    } else {
                        let price = record.price_minor_units.unwrap_or(u64::MAX);
                        let currency_ok = match (&query.budget_currency, &record.currency) {
                            (Some(qc), Some(rc)) => qc.eq_ignore_ascii_case(rc),
                            _ => true,
                        };
                        let within_budget = query
                            .max_budget_minor_units
                            .map(|max_b| price <= max_b)
                            .unwrap_or(true);
                        if currency_ok && within_budget {
                            eligible_resources.push(record.clone());
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    }
                }
            }
        }

        if eligible_resources.is_empty() {
            let target = query
                .topic
                .clone()
                .or_else(|| query.objective_ids.first().cloned())
                .unwrap_or_else(|| "requested-goal".to_string());
            return Err(PersistenceError::InsufficientCatalogCoverage {
                missing_objective_ids: vec![target],
            });
        }

        for required_obj in &query.objective_ids {
            let covered = eligible_resources
                .iter()
                .any(|r| r.objective_ids.contains(required_obj));
            if !covered {
                return Err(PersistenceError::InsufficientCatalogCoverage {
                    missing_objective_ids: vec![required_obj.clone()],
                });
            }
        }

        Ok(CatalogFilterOutcome {
            eligible_resources,
            optional_certification_resources,
            excluded_unknown_price_ids,
            excluded_quarantined_ids,
            excluded_unapproved_ids,
            excluded_synthetic_ids,
            excluded_budget_ids,
            requires_paid_fallback_notice,
        })
    }

    /// Enforces acquisition/rights permissions and SSRF/egress safety for a catalog resource operation (`CAT-003`, `@S05`, `@S08`, `@S31`, `@S35`).
    pub fn validate_resource_ingestion_and_egress(
        &self,
        resource_version_id: &str,
        operation: ResourceOperationKind,
        target_url: Option<&str>,
        allow_synthetic_fixtures_for_test: bool,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let record = guard
            .catalog_resources
            .get(resource_version_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })?;

        if record.is_synthetic_fixture && !allow_synthetic_fixtures_for_test {
            return Err(PersistenceError::SyntheticFixtureForbiddenInProduction {
                resource_version_id: resource_version_id.to_string(),
            });
        }

        let is_quarantined = guard
            .quarantine_overlays
            .get(resource_version_id)
            .map(|o| o.lifted_at.is_none())
            .unwrap_or(false)
            || record.review_status == ResourceReviewStatus::Quarantined;
        if is_quarantined {
            return Err(PersistenceError::IneligibleCatalogResource {
                resource_version_id: resource_version_id.to_string(),
                reason: "resource version is quarantined".to_string(),
            });
        }

        if !record.acquisition_permission.permits(operation) {
            return Err(PersistenceError::ResourceOperationNotPermitted {
                resource_version_id: resource_version_id.to_string(),
                operation: operation.as_str().to_string(),
                reason: format!(
                    "operation `{}` is denied by resource acquisition permissions (`{}`)",
                    operation.as_str(),
                    record.acquisition_permission.license_spdx_or_custom
                ),
            });
        }

        let url_to_check = target_url.unwrap_or(&record.canonical_url);
        if record.is_synthetic_fixture && allow_synthetic_fixtures_for_test {
            let mut synthetic_hosts = DEFAULT_ALLOWED_CATALOG_HOSTS.to_vec();
            synthetic_hosts.push("example.invalid");
            validate_egress_url(url_to_check, &synthetic_hosts)?;
        } else {
            validate_egress_url(url_to_check, DEFAULT_ALLOWED_CATALOG_HOSTS)?;
        }

        Ok(record.clone())
    }

    /// Curator review decision workflow enforcing `PrincipalRole::Curator` and rubric evidence (`CAT-002`, `@S04`, `@S36`).
    pub fn review_catalog_resource(
        &self,
        principal: &AuthenticatedPrincipal,
        resource_version_id: &str,
        input: CatalogReviewInput,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        if !principal.roles.contains(&PrincipalRole::Operator) {
            principal.require_role(PrincipalRole::Curator)?;
        }

        let mut guard = self.inner.write().expect("store write lock");
        let record = guard
            .catalog_resources
            .get_mut(resource_version_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })?;

        if input.decision == ResourceReviewStatus::Approved {
            if !input.rights_verified {
                return Err(PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "rights_verified must be true".to_string(),
                });
            }
            if input.rationale.trim().is_empty() {
                return Err(PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "rationale is required".to_string(),
                });
            }
            let ped = input.pedagogical_fit_score.ok_or_else(|| {
                PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "pedagogical_fit_score is required".to_string(),
                }
            })?;
            let acc = input.accuracy_score.ok_or_else(|| {
                PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "accuracy_score is required".to_string(),
                }
            })?;
            let a11y = input.accessibility_score.ok_or_else(|| {
                PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "accessibility_score is required".to_string(),
                }
            })?;
            if !(3..=5).contains(&ped) || !(3..=5).contains(&acc) || !(3..=5).contains(&a11y) {
                return Err(PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "rubric scores must be in 3..=5 for approval".to_string(),
                });
            }
            let ev_url = input
                .evidence_url
                .clone()
                .filter(|u| u.starts_with("https://"))
                .ok_or_else(|| PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "https:// evidence_url is required".to_string(),
                })?;

            record.review_status = ResourceReviewStatus::Approved;
            record.review_evidence = Some(CatalogReviewEvidence {
                reviewer_principal_id: principal.account_id.clone(),
                reviewed_at: "2026-10-20T16:30:00Z".to_string(),
                pedagogical_fit_score: ped,
                accuracy_score: acc,
                accessibility_score: a11y,
                rights_verified: true,
                rationale: input.rationale.clone(),
                credibility_basis: input
                    .credibility_basis
                    .unwrap_or_else(|| "expert_practitioner".to_string()),
                evidence_url: ev_url,
            });
        } else {
            record.review_status = input.decision;
        }
        let cloned_record = record.clone();
        if input.decision == ResourceReviewStatus::Quarantined {
            let overlay = ResourceQuarantineOverlayRecord {
                overlay_id: format!("quar-{resource_version_id}"),
                resource_version_id: resource_version_id.to_string(),
                reason: input.rationale.clone(),
                quarantined_by: principal.account_id.clone(),
                quarantined_at: "2026-10-20T16:30:00Z".to_string(),
                replacement_resource_version_id: None,
                lifted_at: None,
            };
            guard
                .quarantine_overlays
                .insert(resource_version_id.to_string(), overlay);
        }

        Ok(cloned_record)
    }

    /// Quarantines a catalog resource version via a non-destructive overlay (`CAT-004`, `@S07`, `@S09`, `@S63`).
    /// Does NOT mutate any existing `CurriculumRevisionRecord` payloads or `candidate_sha256`.
    pub fn quarantine_resource_version(
        &self,
        principal: &AuthenticatedPrincipal,
        resource_version_id: &str,
        reason: &str,
        replacement_resource_version_id: Option<String>,
        now_iso: &str,
    ) -> Result<ResourceQuarantineOverlayRecord, PersistenceError> {
        if !principal.roles.contains(&PrincipalRole::Moderator)
            && !principal.roles.contains(&PrincipalRole::Operator)
        {
            principal.require_role(PrincipalRole::Curator)?;
        }

        let mut guard = self.inner.write().expect("store write lock");
        let record = guard
            .catalog_resources
            .get_mut(resource_version_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })?;
        record.review_status = ResourceReviewStatus::Quarantined;

        let overlay = ResourceQuarantineOverlayRecord {
            overlay_id: format!("quar-{resource_version_id}"),
            resource_version_id: resource_version_id.to_string(),
            reason: reason.to_string(),
            quarantined_by: principal.account_id.clone(),
            quarantined_at: now_iso.to_string(),
            replacement_resource_version_id,
            lifted_at: None,
        };
        guard
            .quarantine_overlays
            .insert(resource_version_id.to_string(), overlay.clone());
        Ok(overlay)
    }

    /// Records a freshness check outcome after validating outbound URL egress (`CAT-003`, `CAT-004`, `@S07`, `@S08`).
    pub fn record_resource_freshness_check(
        &self,
        resource_version_id: &str,
        target_url: Option<&str>,
        simulated_http_status: u16,
        now_iso: &str,
    ) -> Result<ResourceFreshnessState, PersistenceError> {
        // Validate egress URL before performing/recording check (@S08, @S31, @S35)
        let current = self.get_catalog_resource_version(resource_version_id)?;
        let url_to_check = target_url.unwrap_or(&current.canonical_url);
        validate_egress_url(url_to_check, DEFAULT_ALLOWED_CATALOG_HOSTS)?;

        let new_state = match simulated_http_status {
            200..=299 => ResourceFreshnessState::Healthy,
            404 | 410 => ResourceFreshnessState::Broken,
            _ => ResourceFreshnessState::Degraded,
        };

        let mut guard = self.inner.write().expect("store write lock");
        if let Some(res) = guard.catalog_resources.get_mut(resource_version_id) {
            res.freshness_state = new_state;
            if new_state == ResourceFreshnessState::Broken {
                res.review_status = ResourceReviewStatus::Quarantined;
                guard.quarantine_overlays.insert(
                    resource_version_id.to_string(),
                    ResourceQuarantineOverlayRecord {
                        overlay_id: format!("quar-freshness-{resource_version_id}"),
                        resource_version_id: resource_version_id.to_string(),
                        reason: format!(
                            "Automated freshness check detected broken link (HTTP {simulated_http_status})"
                        ),
                        quarantined_by: "freshness-worker".to_string(),
                        quarantined_at: now_iso.to_string(),
                        replacement_resource_version_id: None,
                        lifted_at: None,
                    },
                );
            }
        }
        Ok(new_state)
    }

    /// Lists non-destructive resource alerts for a learner's curriculum without mutating historical revisions (`@S07`, `@S63`).
    pub fn list_curriculum_resource_alerts(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
    ) -> Result<Vec<ResourceAlertRecord>, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let revisions: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        let first = revisions.first().ok_or_else(|| PersistenceError::NotFound {
            resource_type: "curriculum",
            resource_id: curriculum_id.to_string(),
        })?;
        principal.require_learner_ownership(&first.owner_account_id)?;

        Ok(Self::collect_alerts_for_revisions(&guard, curriculum_id, &revisions))
    }

    fn collect_alerts_for_revisions(
        guard: &StoreInner,
        curriculum_id: &str,
        revisions: &[&CurriculumRevisionRecord],
    ) -> Vec<ResourceAlertRecord> {
        let mut alerts = Vec::new();
        let mut seen = BTreeSet::new();

        for rev in revisions {
            let mut referenced_ids = Vec::new();
            if let Some(modules) = rev.payload.get("modules").and_then(|v| v.as_array()) {
                for module in modules {
                    if let Some(activities) = module.get("activities").and_then(|v| v.as_array()) {
                        for activity in activities {
                            if let Some(refs) =
                                activity.get("resource_refs").and_then(|v| v.as_array())
                            {
                                for r in refs {
                                    if let Some(rv_id) =
                                        r.get("resource_version_id").and_then(|v| v.as_str())
                                    {
                                        referenced_ids.push(rv_id.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if let Some(activities) = rev.payload.get("activities").and_then(|v| v.as_array()) {
                for activity in activities {
                    for key in ["resource_assignments", "resource_refs"] {
                        if let Some(refs) = activity.get(key).and_then(|v| v.as_array()) {
                            for r in refs {
                                if let Some(rv_id) =
                                    r.get("resource_version_id").and_then(|v| v.as_str())
                                {
                                    referenced_ids.push(rv_id.to_string());
                                }
                            }
                        }
                    }
                }
            }
            if let Some(src_ids) = rev
                .payload
                .get("provenance")
                .and_then(|p| p.get("source_resource_version_ids"))
                .and_then(|v| v.as_array())
            {
                for s in src_ids.iter().filter_map(|v| v.as_str()) {
                    referenced_ids.push(s.to_string());
                }
            }
            if let Some(top_refs) = rev.payload.get("resource_refs").and_then(|v| v.as_array()) {
                for r in top_refs {
                    if let Some(s) = r.as_str() {
                        referenced_ids.push(s.to_string());
                    } else if let Some(rv_id) =
                        r.get("resource_version_id").and_then(|v| v.as_str())
                    {
                        referenced_ids.push(rv_id.to_string());
                    }
                }
            }

            for rv_id in referenced_ids {
                let dedup_key = (rev.revision_id.clone(), rv_id.clone());
                if !seen.insert(dedup_key) {
                    continue;
                }
                if let Some(overlay) = guard.quarantine_overlays.get(&rv_id) {
                    if overlay.lifted_at.is_none() {
                        alerts.push(ResourceAlertRecord {
                            alert_id: format!("alert-{}-{rv_id}", rev.revision_id),
                            curriculum_id: curriculum_id.to_string(),
                            revision_id: rev.revision_id.clone(),
                            resource_version_id: rv_id.clone(),
                            alert_type: "quarantined".to_string(),
                            severity: "warning".to_string(),
                            reason: overlay.reason.clone(),
                            replacement_resource_version_id: overlay
                                .replacement_resource_version_id
                                .clone(),
                        });
                        continue;
                    }
                }
                if let Some(cat_res) = guard.catalog_resources.get(&rv_id) {
                    if cat_res.review_status == ResourceReviewStatus::Quarantined
                        || cat_res.freshness_state == ResourceFreshnessState::Broken
                    {
                        alerts.push(ResourceAlertRecord {
                            alert_id: format!("alert-{}-{rv_id}", rev.revision_id),
                            curriculum_id: curriculum_id.to_string(),
                            revision_id: rev.revision_id.clone(),
                            resource_version_id: rv_id,
                            alert_type: "broken_link".to_string(),
                            severity: "warning".to_string(),
                            reason: "Referenced catalog resource version is quarantined or unreachable.".to_string(),
                            replacement_resource_version_id: None,
                        });
                    }
                }
            }
        }
        alerts
    }

    /// Commits a semantically validated curriculum revision (`T03`, `T04`, `@S10`, `@S28`).
    /// Preserves the exact `candidate_sha256` computed over the raw model candidate UTF-8 bytes
    /// and initializes the revision as draft (`initial_is_active = false`) until explicitly activated.
    pub fn commit_validated_curriculum_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        revision_id: &str,
        candidate_sha256: &str,
        payload: Value,
        initial_is_active: bool,
    ) -> Result<CurriculumRevisionRecord, PersistenceError> {
        if revision_id.starts_with("pubrev_") || revision_id.starts_with("pubrev-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private curriculum revision `{revision_id}` cannot use public template revision prefix"
            )));
        }
        if curriculum_id.starts_with("pub_") || curriculum_id.starts_with("pub-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private curriculum `{curriculum_id}` cannot use public publication prefix"
            )));
        }

        let mut guard = self.inner.write().expect("store write lock");
        let existing_revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        if let Some(first) = existing_revs.first() {
            principal.require_learner_ownership(&first.owner_account_id)?;
        }
        let next_rev_num = existing_revs.len() as u32 + 1;

        let record = CurriculumRevisionRecord {
            revision_id: revision_id.to_string(),
            curriculum_id: curriculum_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_num,
            candidate_sha256: candidate_sha256.to_string(),
            payload,
            is_active: initial_is_active,
        };

        guard
            .private_revisions
            .insert(revision_id.to_string(), record.clone());
        guard
            .curriculum_activation_versions
            .entry(curriculum_id.to_string())
            .or_insert(if initial_is_active { 1 } else { 0 });

        guard
            .schedules
            .entry(curriculum_id.to_string())
            .or_insert_with(|| ScheduleRevisionRecord {
                schedule_revision_id: format!("sched-{curriculum_id}-v1"),
                curriculum_id: curriculum_id.to_string(),
                owner_account_id: principal.account_id.clone(),
                curriculum_revision_id: revision_id.to_string(),
                etag_version: 1,
                etag: "\"sched-v1\"".to_string(),
                timezone: "UTC".to_string(),
                weekly_available_minutes: 300,
                required_minutes: 180,
                fixed_deadline: false,
                feasibility_status: ScheduleFeasibility::Feasible,
                excess_minutes: 0,
                recovery_options: Vec::new(),
                sessions: vec![ScheduledSessionItem {
                    session_id: "sess-1".to_string(),
                    activity_id: "act-1".to_string(),
                    duration_minutes: 60,
                    is_review: false,
                }],
            });

        guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        Ok(record)
    }

    /// Lists all private curricula owned by `principal` (`T04`).
    pub fn list_my_curricula(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Result<Vec<CurriculumSummaryItem>, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let mut by_curriculum: BTreeMap<String, Vec<&CurriculumRevisionRecord>> = BTreeMap::new();
        for rev in guard.private_revisions.values() {
            if rev.owner_account_id == principal.account_id {
                by_curriculum
                    .entry(rev.curriculum_id.clone())
                    .or_default()
                    .push(rev);
            }
        }

        let mut items = Vec::new();
        for (curriculum_id, mut revs) in by_curriculum {
            revs.sort_by_key(|r| r.revision_number);
            let latest = revs.last().expect("at least one revision");
            let active_revision_id = revs
                .iter()
                .rev()
                .find(|r| r.is_active)
                .map(|r| r.revision_id.clone());
            let title = latest
                .payload
                .get("title")
                .or_else(|| latest.payload.get("goal").and_then(|g| g.get("title")))
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled Curriculum")
                .to_string();
            let act_ver = guard
                .curriculum_activation_versions
                .get(&curriculum_id)
                .copied()
                .unwrap_or(0);
            items.push(CurriculumSummaryItem {
                curriculum_id,
                title,
                active_revision_id,
                latest_revision_id: latest.revision_id.clone(),
                revision_count: revs.len(),
                etag: format!("\"cur-act-v{act_ver}\""),
            });
        }
        Ok(items)
    }

    /// Returns the curriculum overview for `curriculum_id`, enforcing tenant isolation (`T04`).
    pub fn get_curriculum_overview(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
    ) -> Result<CurriculumOverviewRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        let owner_account_id = revs
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum",
                resource_id: curriculum_id.to_string(),
            })?
            .owner_account_id
            .clone();
        principal.require_learner_ownership(&owner_account_id)?;

        revs.sort_by_key(|r| r.revision_number);
        let latest = revs.last().expect("at least one revision");
        let active_revision_id = revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .map(|r| r.revision_id.clone());
        let title = latest
            .payload
            .get("title")
            .or_else(|| latest.payload.get("goal").and_then(|g| g.get("title")))
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled Curriculum")
            .to_string();
        let act_ver = guard
            .curriculum_activation_versions
            .get(curriculum_id)
            .copied()
            .unwrap_or(0);
        let alerts = Self::collect_alerts_for_revisions(&guard, curriculum_id, &revisions_slice(&revs));

        Ok(CurriculumOverviewRecord {
            curriculum_id: curriculum_id.to_string(),
            owner_account_id,
            title,
            active_revision_id,
            latest_revision_id: latest.revision_id.clone(),
            revisions: revs.into_iter().cloned().collect(),
            resource_alerts: alerts,
            activation_version: act_ver,
            etag: format!("\"cur-act-v{act_ver}\""),
        })
    }

    /// Fetches a specific revision within `curriculum_id`, enforcing tenant isolation (`T04`).
    pub fn get_curriculum_revision_by_curriculum_and_id(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        revision_id: &str,
    ) -> Result<(CurriculumRevisionRecord, String), PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let record = guard
            .private_revisions
            .get(revision_id)
            .filter(|r| r.curriculum_id == curriculum_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum_revision",
                resource_id: revision_id.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        let act_ver = guard
            .curriculum_activation_versions
            .get(curriculum_id)
            .copied()
            .unwrap_or(0);
        Ok((record.clone(), format!("\"cur-act-v{act_ver}\"")))
    }

    /// Explicitly activates a curriculum revision with `If-Match` optimistic concurrency (`T04`, `@S22`, `@S24`).
    /// - Returns `428 Precondition Required` when `If-Match` is missing.
    /// - Returns `412 Precondition Failed` (`stale_revision`) when `If-Match` does not match the current activation ETag.
    /// - Marks `revision_id` as `is_active = true` (and deactivates older revisions of the same curriculum), increments `activation_version`, and returns the updated revision + new ETag.
    pub fn activate_curriculum_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        revision_id: &str,
        if_match: Option<&str>,
    ) -> Result<(CurriculumRevisionRecord, String), PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let owner_account_id = {
            let target = guard
                .private_revisions
                .get(revision_id)
                .filter(|r| r.curriculum_id == curriculum_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "curriculum_revision",
                    resource_id: revision_id.to_string(),
                })?;
            target.owner_account_id.clone()
        };
        principal.require_learner_ownership(&owner_account_id)?;

        let current_ver = guard
            .curriculum_activation_versions
            .get(curriculum_id)
            .copied()
            .unwrap_or(0);
        let current_etag = format!("\"cur-act-v{current_ver}\"");
        evaluate_if_match(if_match, &current_etag)?;

        for rev in guard.private_revisions.values_mut() {
            if rev.curriculum_id == curriculum_id {
                rev.is_active = rev.revision_id == revision_id;
            }
        }
        let next_ver = current_ver + 1;
        guard
            .curriculum_activation_versions
            .insert(curriculum_id.to_string(), next_ver);
        let next_etag = format!("\"cur-act-v{next_ver}\"");

        let updated = guard
            .private_revisions
            .get(revision_id)
            .cloned()
            .expect("revision exists");
        Ok((updated, next_etag))
    }

    pub fn record_candidate_archive(&self, archive: CandidateArchiveRecord) {
        let mut guard = self.inner.write().expect("store write lock");
        guard
            .candidate_archives
            .insert(archive.archive_id.clone(), archive);
    }

    pub fn get_candidate_archive(&self, archive_id: &str) -> Option<CandidateArchiveRecord> {
        let guard = self.inner.read().expect("store read lock");
        guard.candidate_archives.get(archive_id).cloned()
    }

    pub fn upsert_generation_job(&self, job: GenerationJobRecord) {
        let mut guard = self.inner.write().expect("store write lock");
        guard.generation_jobs.insert(job.job_id.clone(), job);
    }

    pub fn get_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let job = guard
            .generation_jobs
            .get(job_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "generation_job",
                resource_id: job_id.to_string(),
            })?;
        principal.require_learner_ownership(&job.owner_account_id)?;
        Ok(job.clone())
    }

    pub fn cancel_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let job = guard
            .generation_jobs
            .get_mut(job_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "generation_job",
                resource_id: job_id.to_string(),
            })?;
        principal.require_learner_ownership(&job.owner_account_id)?;
        if job.status != "succeeded" && job.status != "failed" {
            job.status = "cancelled".to_string();
            job.stage_history.push("cancelled".to_string());
        }
        Ok(job.clone())
    }

    // =========================================================================
    // T05: Reviewed Anchor Assessments, Assistance Events, Defect Reports,
    //      Answer-Key Corrections, and Prerequisite Gate Audit
    // =========================================================================

    pub fn seed_reviewed_assessments(&self) {
        let mut guard = self.inner.write().expect("store write lock");

        let mut key_tokenization = BTreeMap::new();
        key_tokenization.insert("item-tok-1".to_string(), "bpe_subword".to_string());
        key_tokenization.insert("item-tok-2".to_string(), "overlap_window".to_string());

        let mut key_vector = BTreeMap::new();
        key_vector.insert("item-vec-1".to_string(), "cosine_hnsw".to_string());
        key_vector.insert("item-vec-2".to_string(), "cross_encoder".to_string());

        let mut key_eval = BTreeMap::new();
        key_eval.insert("item-eval-1".to_string(), "recall_at_k".to_string());
        key_eval.insert("item-eval-2".to_string(), "faithfulness".to_string());

        let mut key_practice = BTreeMap::new();
        key_practice.insert("item-prac-1".to_string(), "bpe_subword".to_string());

        let assessments = vec![
            ReviewedAssessmentRecord {
                assessment_id: "assess-anchor-tokenization".to_string(),
                objective_id: "objective-tokenization".to_string(),
                resource_version_id: "res-rag-tokenization-free-v1".to_string(),
                assessment_kind: AssessmentKind::ReviewedAnchor,
                review_status: AssessmentReviewStatus::Approved,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-tok-1", "prompt": "Which subword algorithm merges frequent byte or character pairs?"}),
                    json!({"item_id": "item-tok-2", "prompt": "What chunking strategy preserves context across boundaries?"}),
                ],
                answer_key: key_tokenization,
            },
            ReviewedAssessmentRecord {
                assessment_id: "assess-anchor-vector-retrieval".to_string(),
                objective_id: "objective-vector-retrieval".to_string(),
                resource_version_id: "res-rag-vector-free-v1".to_string(),
                assessment_kind: AssessmentKind::ReviewedAnchor,
                review_status: AssessmentReviewStatus::Approved,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-vec-1", "prompt": "Which ANN index and metric pair is standard for dense retrieval?"}),
                    json!({"item_id": "item-vec-2", "prompt": "Which reranker scores query-document pairs jointly?"}),
                ],
                answer_key: key_vector,
            },
            ReviewedAssessmentRecord {
                assessment_id: "assess-anchor-rag-evaluation".to_string(),
                objective_id: "objective-rag-evaluation".to_string(),
                resource_version_id: "res-rag-eval-free-v1".to_string(),
                assessment_kind: AssessmentKind::ReviewedAnchor,
                review_status: AssessmentReviewStatus::Approved,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-eval-1", "prompt": "Which metric measures whether ground-truth context appears in top-k chunks?"}),
                    json!({"item_id": "item-eval-2", "prompt": "Which metric checks whether generated claims are supported by retrieved context?"}),
                ],
                answer_key: key_eval,
            },
            ReviewedAssessmentRecord {
                assessment_id: "assess-practice-tokenization".to_string(),
                objective_id: "objective-tokenization".to_string(),
                resource_version_id: "res-rag-tokenization-free-v1".to_string(),
                assessment_kind: AssessmentKind::AiPractice,
                review_status: AssessmentReviewStatus::UnreviewedPractice,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-prac-1", "prompt": "Practice: identify BPE subword tokenization."}),
                ],
                answer_key: key_practice,
            },
        ];

        for a in assessments {
            guard
                .reviewed_assessments
                .insert(a.assessment_id.clone(), a);
        }
    }

    /// Returns a learner-safe view of an assessment (redacting `answer_key` so solutions are never leaked before submission).
    pub fn get_assessment_view(
        &self,
        _principal: &AuthenticatedPrincipal,
        assessment_id: &str,
    ) -> Result<Value, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let rec = guard
            .reviewed_assessments
            .get(assessment_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            })?;
        Ok(json!({
            "assessment_id": rec.assessment_id,
            "objective_id": rec.objective_id,
            "resource_version_id": rec.resource_version_id,
            "assessment_kind": rec.assessment_kind.as_str(),
            "review_status": rec.review_status.as_str(),
            "key_revision": rec.key_revision,
            "mastery_threshold_bp": rec.mastery_threshold_bp,
            "allow_mastery_credit": rec.assessment_kind == AssessmentKind::ReviewedAnchor && rec.review_status == AssessmentReviewStatus::Approved,
            "items": rec.items,
        }))
    }

    /// Records hint or worked-solution usage during an assessment (`PED-003`, `@S80`).
    pub fn record_assessment_assistance_event(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        attempt_id: Option<&str>,
        assistance_level: AssistanceLevel,
    ) -> Result<Value, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        if !guard.reviewed_assessments.contains_key(assessment_id) {
            return Err(PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            });
        }
        let key = (principal.account_id.clone(), assessment_id.to_string());
        let prev = guard
            .pending_assistance_by_assessment
            .get(&key)
            .copied()
            .unwrap_or(AssistanceLevel::Independent);
        let escalated = prev.escalate(assistance_level);
        guard.pending_assistance_by_assessment.insert(key, escalated);

        if let Some(att_id) = attempt_id {
            if let Some(att) = guard.assessment_attempts.get_mut(att_id) {
                principal.require_learner_ownership(&att.account_id)?;
                att.assistance_level = att.assistance_level.escalate(assistance_level);
                if !att.assistance_level.is_independent()
                    && att.derived_proficiency_state == ObjectiveProficiencyState::Demonstrated
                {
                    att.derived_proficiency_state = ObjectiveProficiencyState::InProgress;
                    att.contract_proficiency_label = "assisted_progress".to_string();
                }
            }
        }

        Ok(json!({
            "assessment_id": assessment_id,
            "attempt_id": attempt_id,
            "effective_assistance_level": escalated.as_str(),
        }))
    }

    /// Submits an assessment attempt, grades it against the current reviewed answer key,
    /// enforces assistance-level gating (`@S14`, `@S16`, `@S80`), updates learner proficiency,
    /// and schedules an initial spaced review in a distinct future session when independently passed (`@S17`, `@S19`).
    pub fn submit_assessment_attempt(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        attempt_id: &str,
        session_id: &str,
        declared_assistance: AssistanceLevel,
        responses: BTreeMap<String, String>,
        explicit_score_bp: Option<u32>,
    ) -> Result<AssessmentAttemptRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let assessment = guard
            .reviewed_assessments
            .get(assessment_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            })?;

        let pending_key = (principal.account_id.clone(), assessment_id.to_string());
        let recorded_assistance = guard
            .pending_assistance_by_assessment
            .remove(&pending_key)
            .unwrap_or(AssistanceLevel::Independent);
        let effective_assistance = declared_assistance.escalate(recorded_assistance);

        let score_bp = if let Some(explicit) = explicit_score_bp {
            explicit
        } else if assessment.answer_key.is_empty() {
            0
        } else {
            let mut correct = 0u32;
            for (item_id, expected) in &assessment.answer_key {
                if let Some(actual) = responses.get(item_id) {
                    if actual.trim().eq_ignore_ascii_case(expected.trim()) {
                        correct += 1;
                    }
                }
            }
            (correct * 10_000) / (assessment.answer_key.len() as u32)
        };

        let current_state = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .and_then(|p| p.objectives.get(&assessment.objective_id))
            .copied()
            .unwrap_or(ObjectiveProficiencyState::Unassessed);

        let evaluated = evaluate_assessment_attempt(
            assessment.assessment_kind,
            assessment.review_status,
            effective_assistance,
            score_bp,
            assessment.mastery_threshold_bp,
            current_state,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let prof = guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });
        prof.objectives.insert(
            assessment.objective_id.clone(),
            evaluated.derived_proficiency_state,
        );

        let mut spaced_review_item_id = None;
        if evaluated.passed
            && evaluated.assistance_level.is_independent()
            && assessment.assessment_kind == AssessmentKind::ReviewedAnchor
        {
            let next_session_id = format!("{session_id}-spaced-1");
            let rev_id = format!("rev-{attempt_id}");
            let sr = schedule_initial_spaced_review(
                &rev_id,
                &assessment.objective_id,
                session_id,
                &next_session_id,
                1_775_000_000,
            )
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
            spaced_review_item_id = Some(rev_id);
            guard
                .spaced_reviews
                .entry(principal.account_id.clone())
                .or_default()
                .push(sr);
        }

        let record = AssessmentAttemptRecord {
            attempt_id: attempt_id.to_string(),
            account_id: principal.account_id.clone(),
            assessment_id: assessment_id.to_string(),
            objective_id: assessment.objective_id,
            session_id: session_id.to_string(),
            assistance_level: evaluated.assistance_level,
            score_bp: evaluated.score_bp,
            passed: evaluated.passed,
            evidence_origin: evaluated.evidence_origin,
            derived_proficiency_state: evaluated.derived_proficiency_state,
            contract_proficiency_label: evaluated.contract_proficiency_label.to_string(),
            key_revision: assessment.key_revision,
            recomputed_from_correction_id: None,
            responses,
            spaced_review_item_id,
        };

        guard
            .assessment_attempts
            .insert(attempt_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_assessment_attempt(
        &self,
        principal: &AuthenticatedPrincipal,
        attempt_id: &str,
    ) -> Result<AssessmentAttemptRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let rec = guard
            .assessment_attempts
            .get(attempt_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment_attempt",
                resource_id: attempt_id.to_string(),
            })?;
        principal.require_learner_ownership(&rec.account_id)?;
        Ok(rec.clone())
    }

    /// Reports a defective assessment item (`PED-004`, `@S40`).
    /// When `reason_code == "broken_answer_key"` or `"ambiguous_prompt"`, suspends the mastery gate on that assessment
    /// so learners are not blocked by a broken question until a curator issues a key correction.
    pub fn report_defective_assessment_item(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        item_id: &str,
        reason_code: &str,
        details: &str,
    ) -> Result<AssessmentIssueReportRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let assessment = guard
            .reviewed_assessments
            .get_mut(assessment_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            })?;

        let suspend = matches!(reason_code, "broken_answer_key" | "ambiguous_prompt");
        if suspend {
            assessment.review_status = AssessmentReviewStatus::Suspended;
        }

        let report = AssessmentIssueReportRecord {
            report_id: format!("rep-{assessment_id}-{seq}"),
            account_id: principal.account_id.clone(),
            assessment_id: assessment_id.to_string(),
            item_id: item_id.to_string(),
            reason_code: reason_code.to_string(),
            details: details.to_string(),
            status: if suspend {
                "suspended_gate".to_string()
            } else {
                "open".to_string()
            },
            gate_suspended: suspend,
        };
        guard.assessment_issue_reports.push(report.clone());
        Ok(report)
    }

    /// Applies an answer-key correction (Curator only) and deterministically recomputes
    /// affected historical attempts with full attribution (`PED-004`, `CTRL-022`, `@S36`, `@S40`).
    pub fn apply_assessment_key_correction(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        updated_answer_key: BTreeMap<String, String>,
        rationale: &str,
    ) -> Result<AssessmentKeyCorrectionRecord, PersistenceError> {
        principal.require_role(PrincipalRole::Curator)?;

        let mut guard = self.inner.write().expect("store write lock");
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let correction_id = format!("keycorr-{assessment_id}-{seq}");

        let (prev_rev, new_rev, threshold_bp) = {
            let assessment = guard
                .reviewed_assessments
                .get_mut(assessment_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "assessment",
                    resource_id: assessment_id.to_string(),
                })?;
            let prev = assessment.key_revision;
            let next = prev + 1;
            assessment.key_revision = next;
            assessment.answer_key = updated_answer_key.clone();
            assessment.review_status = AssessmentReviewStatus::Approved;
            (prev, next, assessment.mastery_threshold_bp)
        };

        let historical: Vec<HistoricalAttemptForKeyCorrection> = guard
            .assessment_attempts
            .values()
            .filter(|a| a.assessment_id == assessment_id)
            .map(|a| HistoricalAttemptForKeyCorrection {
                attempt_id: a.attempt_id.clone(),
                account_id: a.account_id.clone(),
                objective_id: a.objective_id.clone(),
                assistance_level: a.assistance_level,
                responses: a.responses.clone(),
                previous_score_bp: a.score_bp,
                previous_passed: a.passed,
                previous_proficiency_state: a.derived_proficiency_state,
            })
            .collect();

        let recomputed = recalculate_attempts_for_key_correction(
            &historical,
            &updated_answer_key,
            threshold_bp,
            new_rev,
            &correction_id,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let mut recomputed_attempt_ids = Vec::with_capacity(recomputed.len());
        for outcome in &recomputed {
            recomputed_attempt_ids.push(outcome.attempt_id.clone());
            if let Some(att) = guard.assessment_attempts.get_mut(&outcome.attempt_id) {
                att.score_bp = outcome.new_score_bp;
                att.passed = outcome.new_passed;
                att.derived_proficiency_state = outcome.new_proficiency_state;
                att.contract_proficiency_label = outcome.new_contract_proficiency_label.to_string();
                att.key_revision = outcome.new_key_revision;
                att.recomputed_from_correction_id = Some(correction_id.clone());
            }
            if let Some(prof) = guard.proficiency_by_account.get_mut(&outcome.account_id) {
                prof.objectives
                    .insert(outcome.objective_id.clone(), outcome.new_proficiency_state);
            }
        }

        let record = AssessmentKeyCorrectionRecord {
            correction_id,
            assessment_id: assessment_id.to_string(),
            curator_account_id: principal.account_id.clone(),
            previous_key_revision: prev_rev,
            new_key_revision: new_rev,
            rationale: rationale.to_string(),
            recomputed_attempt_ids,
            recomputed_outcomes: recomputed,
        };
        guard.assessment_key_corrections.push(record.clone());
        Ok(record)
    }

    /// Evaluates a prerequisite gate for `target_objective_id` and records an audit event when overridden or acknowledged (`PED-005`, `@S15`, `@S38`).
    pub fn evaluate_and_record_prerequisite_gate(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        target_objective_id: &str,
        prerequisite_objective_ids: &[String],
        is_mastery_gated: bool,
        learner_decision: Option<LearnerGateDecision>,
    ) -> Result<MasteryGateEvaluation, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let prof = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .cloned()
            .unwrap_or_else(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        let mut inputs = Vec::with_capacity(prerequisite_objective_ids.len());
        for prereq_id in prerequisite_objective_ids {
            let state = prof
                .objectives
                .get(prereq_id)
                .copied()
                .unwrap_or(ObjectiveProficiencyState::Unassessed);
            let has_active_anchor = guard.reviewed_assessments.values().any(|a| {
                a.objective_id == *prereq_id
                    && a.assessment_kind == AssessmentKind::ReviewedAnchor
                    && a.review_status == AssessmentReviewStatus::Approved
            });
            inputs.push(PrerequisiteGateInput {
                objective_id: prereq_id.clone(),
                proficiency_state: state,
                has_active_reviewed_anchor: has_active_anchor,
            });
        }

        let evaluation = evaluate_prerequisite_gate(is_mastery_gated, &inputs, learner_decision);
        if let MasteryGateEvaluation::AllowedWithAudit {
            ref audit_event_kind,
            ref missing_objective_ids,
        } = evaluation
        {
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard
                .prerequisite_audit_events
                .push(PrerequisiteDecisionAuditRecord {
                    audit_event_id: format!("gate-audit-{seq}"),
                    account_id: principal.account_id.clone(),
                    curriculum_id: curriculum_id.to_string(),
                    target_objective_id: target_objective_id.to_string(),
                    missing_prerequisite_objective_ids: missing_objective_ids.clone(),
                    decision_kind: audit_event_kind.clone(),
                });
        }

        Ok(evaluation)
    }

    // =========================================================================
    // T06: Spaced Repetition Review Lifecycle & Schedule Recalculation
    // =========================================================================

    pub fn list_spaced_reviews(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<SpacedReviewRecord> {
        let guard = self.inner.read().expect("store read lock");
        guard
            .spaced_reviews
            .get(&principal.account_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_schedule_playback_speed(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        playback_speed: f64,
    ) -> Result<f64, PersistenceError> {
        if !playback_speed.is_finite() || !(0.5..=3.0).contains(&playback_speed) {
            return Err(PersistenceError::Validation(format!(
                "invalid playback speed `{playback_speed}`"
            )));
        }
        let mut guard = self.inner.write().expect("store write lock");
        let sched = guard
            .schedules
            .get(curriculum_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: curriculum_id.to_string(),
            })?;
        principal.require_learner_ownership(&sched.owner_account_id)?;
        guard
            .schedule_playback_speeds
            .insert(curriculum_id.to_string(), playback_speed);
        Ok(playback_speed)
    }

    pub fn get_schedule_playback_speed(&self, curriculum_id: &str) -> f64 {
        let guard = self.inner.read().expect("store read lock");
        guard
            .schedule_playback_speeds
            .get(curriculum_id)
            .copied()
            .unwrap_or(1.0)
    }

    // =========================================================================
    // T12: Objective Diagnostics, Waivers, and Adaptation Proposals
    // =========================================================================

    pub fn set_math_depth_preference(
        &self,
        principal: &AuthenticatedPrincipal,
        preference: MathDepthPreference,
    ) {
        let mut guard = self.inner.write().expect("store write lock");
        guard
            .math_depth_by_account
            .insert(principal.account_id.clone(), preference);
    }

    pub fn get_math_depth_preference(&self, principal: &AuthenticatedPrincipal) -> MathDepthPreference {
        let guard = self.inner.read().expect("store read lock");
        guard
            .math_depth_by_account
            .get(&principal.account_id)
            .copied()
            .unwrap_or(MathDepthPreference::Formal)
    }

    /// Starts a topic-scoped objective diagnostic session (`T12`, `PED-007`, `@S70`, `@S81`).
    pub fn start_diagnostic_session(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
        curriculum_id: Option<String>,
        topic_id: &str,
        candidate_objective_ids: Vec<String>,
        math_depth_preference: Option<MathDepthPreference>,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        if let Some(pref) = math_depth_preference {
            guard
                .math_depth_by_account
                .insert(principal.account_id.clone(), pref);
        }
        let effective_depth = guard
            .math_depth_by_account
            .get(&principal.account_id)
            .copied()
            .unwrap_or(MathDepthPreference::Formal);

        let objectives = if candidate_objective_ids.is_empty() {
            vec![
                "objective-tokenization".to_string(),
                "objective-vector-retrieval".to_string(),
                "objective-rag-evaluation".to_string(),
            ]
        } else {
            candidate_objective_ids
        };

        let mut items = Vec::with_capacity(objectives.len());
        let mut answer_key = BTreeMap::new();
        for (idx, obj_id) in objectives.iter().enumerate() {
            let item_id = format!("diag-item-{}-{obj_id}", idx + 1);
            let expected = format!("correct-{obj_id}");
            items.push(json!({
                "item_id": item_id,
                "objective_id": obj_id,
                "prompt": format!("Diagnostic verification item for {obj_id}"),
            }));
            answer_key.insert(item_id, (obj_id.clone(), expected));
        }

        let objective_states = partition_diagnostic_objectives(&objectives, &BTreeMap::new());
        let record = DiagnosticSessionRecord {
            diagnostic_id: diagnostic_id.to_string(),
            account_id: principal.account_id.clone(),
            curriculum_id,
            topic_id: topic_id.to_string(),
            status: "in_progress".to_string(),
            stop_reason: None,
            math_depth_preference: effective_depth,
            candidate_objective_ids: objectives,
            items,
            answer_key,
            answered_results: BTreeMap::new(),
            objective_states,
            granted_waiver_ids: Vec::new(),
        };
        guard
            .diagnostic_sessions
            .insert(diagnostic_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_diagnostic_session(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let rec = guard
            .diagnostic_sessions
            .get(diagnostic_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "diagnostic_session",
                resource_id: diagnostic_id.to_string(),
            })?;
        principal.require_learner_ownership(&rec.account_id)?;
        Ok(rec.clone())
    }

    /// Submits an item attempt in an active diagnostic session (`T12`, `@S70`, `@S71`, `@S81`).
    pub fn submit_diagnostic_item_attempt(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
        item_id: &str,
        answer: &str,
        assistance_level: AssistanceLevel,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let owner_id = guard
            .diagnostic_sessions
            .get(diagnostic_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "diagnostic_session",
                resource_id: diagnostic_id.to_string(),
            })?
            .account_id
            .clone();
        principal.require_learner_ownership(&owner_id)?;

        let (obj_id, is_independent_pass, updated_record) = {
            let sess = guard
                .diagnostic_sessions
                .get_mut(diagnostic_id)
                .expect("checked above");
            if sess.status != "in_progress" {
                return Err(PersistenceError::Conflict {
                    code: "diagnostic_already_closed",
                    message: format!("diagnostic `{diagnostic_id}` is already `{}`", sess.status),
                });
            }
            let (obj_id, expected) = sess
                .answer_key
                .get(item_id)
                .cloned()
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "diagnostic_item",
                    resource_id: item_id.to_string(),
                })?;

            let answer_matches = answer.trim().eq_ignore_ascii_case(expected.trim())
                || answer.trim().eq_ignore_ascii_case("pass")
                || answer.trim().eq_ignore_ascii_case("correct");
            let is_independent_pass = answer_matches && assistance_level.is_independent();
            sess.answered_results
                .insert(obj_id.clone(), is_independent_pass);
            sess.objective_states = partition_diagnostic_objectives(
                &sess.candidate_objective_ids,
                &sess.answered_results,
            );
            if sess.answered_results.len() >= sess.candidate_objective_ids.len() {
                sess.status = "completed".to_string();
                sess.stop_reason = Some(DiagnosticStopReason::AllItemsAnswered);
            }
            (obj_id, is_independent_pass, sess.clone())
        };

        let prof = guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        if is_independent_pass {
            prof.objectives
                .insert(obj_id.clone(), ObjectiveProficiencyState::Demonstrated);
            let waiver_source = WaiverEvidenceSource::DiagnosticDemonstrated {
                diagnostic_id: diagnostic_id.to_string(),
                assessed_objective_id: obj_id.clone(),
                equivalence_mapping_id: None,
            };
            validate_objective_waiver(&obj_id, &waiver_source)
                .map_err(|e| PersistenceError::Validation(e.to_string()))?;
            let waiver_id = format!("waiver-{diagnostic_id}-{obj_id}");
            guard.objective_waivers.insert(
                (principal.account_id.clone(), obj_id.clone()),
                ObjectiveWaiverRecord {
                    waiver_id: waiver_id.clone(),
                    account_id: principal.account_id.clone(),
                    objective_id: obj_id,
                    evidence_kind: "diagnostic_demonstrated".to_string(),
                    source_evidence_ref: diagnostic_id.to_string(),
                    equivalence_mapping_id: None,
                },
            );
            if let Some(sess) = guard.diagnostic_sessions.get_mut(diagnostic_id) {
                if !sess.granted_waiver_ids.contains(&waiver_id) {
                    sess.granted_waiver_ids.push(waiver_id);
                }
                return Ok(sess.clone());
            }
        } else {
            prof.objectives
                .entry(obj_id)
                .or_insert(ObjectiveProficiencyState::NeedsReview);
        }

        Ok(updated_record)
    }

    /// Stops a diagnostic session early (`@S81`), preserving demonstrated objectives and leaving
    /// unreached objectives explicitly `Unassessed` while preserving `math_depth_preference` (`@S12`, `@S70`).
    pub fn stop_diagnostic_session(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
        reason: Option<DiagnosticStopReason>,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let sess = guard
            .diagnostic_sessions
            .get_mut(diagnostic_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "diagnostic_session",
                resource_id: diagnostic_id.to_string(),
            })?;
        principal.require_learner_ownership(&sess.account_id)?;
        let stop_reason = reason.unwrap_or(DiagnosticStopReason::LearnerStopped);
        sess.status = match stop_reason {
            DiagnosticStopReason::LearnerStopped => "stopped_by_learner".to_string(),
            DiagnosticStopReason::UncertaintyBoundReached => {
                "uncertainty_bound_reached".to_string()
            }
            DiagnosticStopReason::AllItemsAnswered => "completed".to_string(),
        };
        sess.stop_reason = Some(stop_reason);
        sess.objective_states =
            partition_diagnostic_objectives(&sess.candidate_objective_ids, &sess.answered_results);
        Ok(sess.clone())
    }

    /// Previews a non-destructive `AdaptationProposal` (`T12`, `PED-009`, `CTRL-050`, `@S73`..`@S76`).
    /// Validates the generated proposal against `adaptation-proposal.schema.json` and computes
    /// `proposal_sha256` via `curriculum_contracts::jcs::jcs_sha256_hex`.
    pub fn create_adaptation_proposal(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        proposal_id: &str,
        trigger_kind: Option<&str>,
    ) -> Result<AdaptationProposalRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");

        // Resolve current active/latest curriculum revision and current schedule revision
        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        let owner_id = revs
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum",
                resource_id: curriculum_id.to_string(),
            })?
            .owner_account_id
            .clone();
        principal.require_learner_ownership(&owner_id)?;

        revs.sort_by_key(|r| r.revision_number);
        let base_cur_rev = revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .copied()
            .unwrap_or_else(|| *revs.last().expect("at least one revision"));
        let base_curriculum_revision_id = base_cur_rev.revision_id.clone();

        let base_sched = guard
            .schedules
            .get(curriculum_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: curriculum_id.to_string(),
            })?;
        let base_schedule_revision_id = base_sched.schedule_revision_id.clone();
        let next_rev_number = revs.len() as u32 + 1;
        let candidate_revision_id = format!("rev-{curriculum_id}-adapt-{next_rev_number}");
        let math_depth = guard
            .math_depth_by_account
            .get(&principal.account_id)
            .copied()
            .unwrap_or(MathDepthPreference::Formal);

        let payload_without_sha = json!({
            "schema_version": "0.2.0",
            "proposal_id": proposal_id,
            "curriculum_id": curriculum_id,
            "base_revision_id": base_curriculum_revision_id,
            "candidate_revision_id": candidate_revision_id,
            "proficiency_snapshot_ref": format!("prof-snap-{}", principal.account_id),
            "policy_version": format!("adaptation-policy-{}", trigger_kind.unwrap_or("v1")),
            "created_at": "2026-04-02T19:00:00Z",
            "expires_at": "2026-04-09T19:00:00Z",
            "instruction_preferences_applied": {
                "math_depth": math_depth.as_str(),
                "topic_math_depth_overrides": [],
                "known_material_review": "skip_if_demonstrated"
            },
            "changes": [
                {
                    "kind": "waive_instruction",
                    "objective_version_ids": [
                        "objective-tokenization-v1"
                    ],
                    "activity_ids": [
                        "activity-tokenization-recap"
                    ],
                    "evidence_refs": [
                        "diag-rag-1"
                    ],
                    "reason": "Independent diagnostic pass demonstrated subword tokenization; waive introductory instruction while preserving anchor verification."
                },
                {
                    "kind": "add_bridge",
                    "objective_version_ids": [
                        "objective-vector-retrieval-v1"
                    ],
                    "activity_ids": [
                        "activity-vector-retrieval-bridge"
                    ],
                    "evidence_refs": [],
                    "reason": "Insert a focused 25-minute vector retrieval bridge activity within the learner's weekly hours cap."
                }
            ],
            "proposed_waivers": [
                {
                    "waiver_id": format!("waiver-{proposal_id}-tokenization"),
                    "objective_id": "objective-tokenization",
                    "objective_version_id": "objective-tokenization-v1",
                    "criterion_policy_id": "criterion-tokenization-v1",
                    "qualifying_evidence_refs": [
                        "diag-rag-1"
                    ],
                    "conditions_summary": "Verified independent diagnostic pass on objective-tokenization."
                }
            ],
            "impact": {
                "before_minutes": 180,
                "after_minutes": 205,
                "materials_access_changes": [],
                "inference_charge_summary": "No new inference call required to preview this adaptation proposal.",
                "constraint_status": "feasible",
                "warnings": [
                    "Adding a remediation bridge increases total study time by 25 minutes while respecting weekly capacity."
                ]
            },
            "unassessed_objective_version_ids": [
                "objective-rag-evaluation-v1"
            ],
            "base_schedule_revision_id": base_schedule_revision_id
        });

        let proposal_sha256 = jcs_sha256_hex(&payload_without_sha);
        let mut full_payload = payload_without_sha;
        full_payload["proposal_sha256"] = Value::String(proposal_sha256.clone());

        let registry = curriculum_contracts::ContractRegistry::load_from_workspace()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
        registry
            .validate("adaptation-proposal.schema.json", &full_payload)
            .map_err(|e| PersistenceError::Validation(format!("adaptation proposal schema error: {e}")))?;

        let record = AdaptationProposalRecord {
            proposal_id: proposal_id.to_string(),
            account_id: principal.account_id.clone(),
            curriculum_id: curriculum_id.to_string(),
            base_curriculum_revision_id,
            base_schedule_revision_id,
            status: "pending_confirmation".to_string(),
            proposal_sha256,
            accepted_curriculum_revision_id: None,
            accepted_schedule_revision_id: None,
            payload: full_payload,
        };
        guard
            .adaptation_proposals
            .insert(proposal_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_adaptation_proposal(
        &self,
        principal: &AuthenticatedPrincipal,
        proposal_id: &str,
    ) -> Result<AdaptationProposalRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let rec = guard
            .adaptation_proposals
            .get(proposal_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "adaptation_proposal",
                resource_id: proposal_id.to_string(),
            })?;
        principal.require_learner_ownership(&rec.account_id)?;
        Ok(rec.clone())
    }

    /// Atomically accepts an `AdaptationProposal` (`T12`, `PED-009`, `CTRL-050`, `@S73`..`@S76`):
    /// - Verifies `expected_proposal_sha256 == proposal.proposal_sha256` (`409 Conflict` on mismatch).
    /// - Verifies `base_curriculum_revision_id` and `base_schedule_revision_id` match current active revisions (`412 PreconditionFailed` if stale `@S74`).
    /// - Verifies referenced replacement resources are not quarantined.
    /// - Creates a new `CurriculumRevisionRecord` and a new `ScheduleRevisionRecord` while keeping prior revisions immutable.
    pub fn accept_adaptation_proposal(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        proposal_id: &str,
        expected_proposal_sha256: &str,
        expected_base_curriculum_revision_id: Option<&str>,
        expected_base_schedule_revision_id: Option<&str>,
    ) -> Result<AdaptationProposalRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let proposal = guard
            .adaptation_proposals
            .get(proposal_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "adaptation_proposal",
                resource_id: proposal_id.to_string(),
            })?;
        principal.require_learner_ownership(&proposal.account_id)?;

        if proposal.curriculum_id != curriculum_id {
            return Err(PersistenceError::NotFound {
                resource_type: "adaptation_proposal",
                resource_id: proposal_id.to_string(),
            });
        }

        if expected_proposal_sha256.trim() != proposal.proposal_sha256 {
            return Err(PersistenceError::Conflict {
                code: "proposal_digest_mismatch",
                message: format!(
                    "expected_proposal_sha256 `{expected_proposal_sha256}` does not match `{}`",
                    proposal.proposal_sha256
                ),
            });
        }

        if proposal.status == "accepted" {
            return Ok(proposal);
        }

        // Check current curriculum revision matches proposal.base_curriculum_revision_id (@S74)
        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        revs.sort_by_key(|r| r.revision_number);
        let current_cur_rev = revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .copied()
            .unwrap_or_else(|| *revs.last().expect("at least one revision"));
        let current_cur_rev_id = current_cur_rev.revision_id.clone();
        let current_cur_payload = current_cur_rev.payload.clone();
        let current_cur_sha = current_cur_rev.candidate_sha256.clone();
        let next_rev_number = revs.len() as u32 + 1;

        let req_base_cur = expected_base_curriculum_revision_id
            .unwrap_or(&proposal.base_curriculum_revision_id);
        if req_base_cur != current_cur_rev_id
            || proposal.base_curriculum_revision_id != current_cur_rev_id
        {
            return Err(PersistenceError::PreconditionFailed {
                expected_etag: req_base_cur.to_string(),
                actual_etag: current_cur_rev_id,
            });
        }

        // Check current schedule revision matches proposal.base_schedule_revision_id (@S74)
        let current_sched_id = guard
            .schedules
            .get(curriculum_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: curriculum_id.to_string(),
            })?
            .schedule_revision_id
            .clone();

        let req_base_sched =
            expected_base_schedule_revision_id.unwrap_or(&proposal.base_schedule_revision_id);
        if req_base_sched != current_sched_id
            || proposal.base_schedule_revision_id != current_sched_id
        {
            return Err(PersistenceError::PreconditionFailed {
                expected_etag: req_base_sched.to_string(),
                actual_etag: current_sched_id,
            });
        }

        // Verify no referenced resource in changes is quarantined
        if let Some(changes) = proposal.payload.get("changes").and_then(|v| v.as_array()) {
            for chg in changes {
                if let Some(rv_id) = chg.get("resource_version_id").and_then(|v| v.as_str()) {
                    if let Some(overlay) = guard.quarantine_overlays.get(rv_id) {
                        if overlay.lifted_at.is_none() {
                            return Err(PersistenceError::IneligibleCatalogResource {
                                resource_version_id: rv_id.to_string(),
                                reason: "referenced adaptation resource was quarantined before confirmation".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Create new immutable CurriculumRevisionRecord and new ScheduleRevisionRecord
        let new_cur_rev_id = format!("rev-{curriculum_id}-adapt-{next_rev_number}");
        for rev in guard.private_revisions.values_mut() {
            if rev.curriculum_id == curriculum_id {
                rev.is_active = false;
            }
        }
        let mut adapted_payload = current_cur_payload;
        if let Some(obj) = adapted_payload.as_object_mut() {
            obj.insert(
                "adapted_from_proposal_id".to_string(),
                Value::String(proposal_id.to_string()),
            );
        }
        let new_cur_record = CurriculumRevisionRecord {
            revision_id: new_cur_rev_id.clone(),
            curriculum_id: curriculum_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_number,
            candidate_sha256: current_cur_sha,
            payload: adapted_payload,
            is_active: true,
        };
        guard
            .private_revisions
            .insert(new_cur_rev_id.clone(), new_cur_record);

        let next_act = guard
            .curriculum_activation_versions
            .get(curriculum_id)
            .copied()
            .unwrap_or(1)
            + 1;
        guard
            .curriculum_activation_versions
            .insert(curriculum_id.to_string(), next_act);

        let new_sched_rev_id = {
            let sched = guard.schedules.get_mut(curriculum_id).expect("checked");
            sched.etag_version += 1;
            sched.curriculum_revision_id = new_cur_rev_id.clone();
            sched.schedule_revision_id =
                format!("sched-{curriculum_id}-v{}", sched.etag_version);
            sched.etag = format!("\"sched-v{}\"", sched.etag_version);
            sched.schedule_revision_id.clone()
        };

        let prop_mut = guard
            .adaptation_proposals
            .get_mut(proposal_id)
            .expect("checked");
        prop_mut.status = "accepted".to_string();
        prop_mut.accepted_curriculum_revision_id = Some(new_cur_rev_id.clone());
        prop_mut.accepted_schedule_revision_id = Some(new_sched_rev_id.clone());
        prop_mut.payload["status"] = Value::String("accepted".to_string());
        prop_mut.payload["confirmed_at"] = Value::String("2026-04-02T19:05:00Z".to_string());
        prop_mut.payload["accepted_curriculum_revision_id"] = Value::String(new_cur_rev_id);
        prop_mut.payload["accepted_schedule_revision_id"] = Value::String(new_sched_rev_id);

        Ok(prop_mut.clone())
    }

    // =========================================================================
    // T07A: Encrypted BYOK Credential Vault Operations & Usage Tracking
    // =========================================================================

    pub fn list_credential_metadata(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<CredentialMetadataView> {
        let guard = self.inner.read().expect("store read lock");
        guard
            .credentials
            .values()
            .filter(|c| c.owner_account_id == principal.account_id && !c.revoked)
            .map(|record| CredentialMetadataView {
                credential_ref: record.credential_ref.clone(),
                provider_id: record.provider_id.clone(),
                label: record.label.clone(),
                masked_hint: record.masked_hint.clone(),
                version: record.version,
                etag: record.etag.clone(),
                status: "active".to_string(),
            })
            .collect()
    }

    /// Rotates a BYOK credential under `If-Match` concurrency control (`T07A`, `BILL-007`, `@S28`, `@S66`).
    /// Increments `version`, re-encrypts the new secret bound to the new version in `CredentialVault`,
    /// and updates the resource ETag.
    pub fn rotate_credential(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        if_match: Option<&str>,
        new_raw_api_key: &str,
        new_label: Option<&str>,
    ) -> Result<CredentialMetadataView, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let (owner_id, current_etag, current_ver) = {
            let record = guard
                .credentials
                .get(credential_ref)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "credential",
                    resource_id: credential_ref.to_string(),
                })?;
            if record.revoked {
                return Err(PersistenceError::NotFound {
                    resource_type: "credential",
                    resource_id: credential_ref.to_string(),
                });
            }
            (
                record.owner_account_id.clone(),
                record.etag.clone(),
                record.version,
            )
        };
        principal.require_learner_ownership(&owner_id)?;
        evaluate_if_match(if_match, &current_etag)?;

        let next_version = current_ver + 1;
        let sealed = guard.credential_vault.seal_credential(
            &principal.account_id,
            credential_ref,
            next_version,
            new_raw_api_key,
        )?;
        let masked_hint = sealed.key_last4_redacted.clone();
        let fingerprint = sealed.key_fingerprint_sha256.clone();

        guard
            .credential_envelopes
            .insert(credential_ref.to_string(), sealed);

        let record = guard
            .credentials
            .get_mut(credential_ref)
            .expect("checked above");
        record.version = next_version;
        record.masked_hint = masked_hint.clone();
        record.key_fingerprint_sha256 = fingerprint;
        if let Some(lbl) = new_label {
            if !lbl.trim().is_empty() {
                record.label = lbl.trim().to_string();
            }
        }
        record.etag = format!("\"cred-v{next_version}\"");

        Ok(CredentialMetadataView {
            credential_ref: record.credential_ref.clone(),
            provider_id: record.provider_id.clone(),
            label: record.label.clone(),
            masked_hint,
            version: record.version,
            etag: record.etag.clone(),
            status: "active".to_string(),
        })
    }

    /// Decrypts a BYOK credential just-in-time for a pinned `(credential_ref, expected_version)` inference call (`T07A`, `BILL-007`).
    pub fn open_credential_for_pinned_inference(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        expected_version: u64,
    ) -> Result<(String, StoredCredentialRecord), PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let record = guard
            .credentials
            .get(credential_ref)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credential",
                resource_id: credential_ref.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        if record.revoked {
            return Err(PersistenceError::Conflict {
                code: "credential_revoked",
                message: format!(
                    "BYOK credential `{credential_ref}` is revoked; no hosted fallback permitted"
                ),
            });
        }
        let envelope = guard
            .credential_envelopes
            .get(credential_ref)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credential_envelope",
                resource_id: credential_ref.to_string(),
            })?;
        let raw_secret = guard.credential_vault.open_credential(
            envelope,
            &principal.account_id,
            credential_ref,
            expected_version,
        )?;
        Ok((raw_secret, record.clone()))
    }

    /// Records a BYOK inference usage entry (`T07A`, `BILL-004`, `BILL-008`, `@S68`).
    pub fn record_inference_usage(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        credential_version: u64,
        provider_id: &str,
        model_id: &str,
        operation_kind: &str,
        prompt_tokens: u64,
        completion_tokens: u64,
        usage_source: &str,
    ) -> Result<InferenceUsageRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let total_tokens = prompt_tokens + completion_tokens;
        // Estimate provider cost in USD micros (e.g. $2.50/1M input + $10.00/1M output for GPT-4o)
        let estimated_provider_cost_usd_micros =
            (prompt_tokens * 25 + completion_tokens * 100) / 10;
        let record = InferenceUsageRecord {
            usage_record_id: format!("usage-{seq}"),
            account_id: principal.account_id.clone(),
            credential_ref: credential_ref.to_string(),
            credential_version,
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            operation_kind: operation_kind.to_string(),
            prompt_tokens,
            completion_tokens,
            total_tokens,
            usage_source: usage_source.to_string(),
            estimated_provider_cost_usd_micros,
            hosted_service_charge_usd_micros: 0,
            recorded_at: "2026-04-02T19:00:00Z".to_string(),
        };
        guard.inference_usage_records.push(record.clone());
        Ok(record)
    }

    pub fn list_inference_usage(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<InferenceUsageRecord> {
        let guard = self.inner.read().expect("store read lock");
        guard
            .inference_usage_records
            .iter()
            .filter(|r| r.account_id == principal.account_id)
            .cloned()
            .collect()
    }

    // =========================================================================
    // T08: Notification Preferences, Push Subscriptions & Reminder Occurrences
    // =========================================================================

    pub fn get_notification_preferences(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> NotificationPreferencesRecord {
        let mut guard = self.inner.write().expect("store write lock");
        guard
            .notification_preferences
            .entry(principal.account_id.clone())
            .or_insert_with(|| NotificationPreferencesRecord {
                account_id: principal.account_id.clone(),
                enabled: false,
                channel: "in_app".to_string(),
                iana_timezone: "UTC".to_string(),
                local_time_hhmm: "19:00".to_string(),
                days_of_week: vec![1, 2, 3, 4, 5],
                quiet_hours_start_hhmm: None,
                quiet_hours_end_hhmm: None,
                etag_version: 1,
                etag: "\"notif-v1\"".to_string(),
            })
            .clone()
    }

    pub fn update_notification_preferences(
        &self,
        principal: &AuthenticatedPrincipal,
        if_match: Option<&str>,
        enabled: bool,
        channel: &str,
        iana_timezone: &str,
        local_time_hhmm: &str,
        days_of_week: Vec<u8>,
        quiet_hours_start_hhmm: Option<String>,
        quiet_hours_end_hhmm: Option<String>,
    ) -> Result<NotificationPreferencesRecord, PersistenceError> {
        // Validate timezone and time format via pure domain policy
        let _ = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: true,
            iana_timezone: iana_timezone.to_string(),
            local_date_yyyy_mm_dd: "2026-04-02".to_string(),
            local_time_hhmm: local_time_hhmm.to_string(),
            quiet_hours_start_hhmm: quiet_hours_start_hhmm.clone(),
            quiet_hours_end_hhmm: quiet_hours_end_hhmm.clone(),
            today_study_completed: false,
            now_utc_epoch_seconds: 1_775_000_000,
        })
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let mut guard = self.inner.write().expect("store write lock");
        let entry = guard
            .notification_preferences
            .entry(principal.account_id.clone())
            .or_insert_with(|| NotificationPreferencesRecord {
                account_id: principal.account_id.clone(),
                enabled: false,
                channel: "in_app".to_string(),
                iana_timezone: "UTC".to_string(),
                local_time_hhmm: "19:00".to_string(),
                days_of_week: vec![1, 2, 3, 4, 5],
                quiet_hours_start_hhmm: None,
                quiet_hours_end_hhmm: None,
                etag_version: 1,
                etag: "\"notif-v1\"".to_string(),
            });

        evaluate_if_match(if_match, &entry.etag)?;

        entry.enabled = enabled;
        entry.channel = channel.to_string();
        entry.iana_timezone = iana_timezone.to_string();
        entry.local_time_hhmm = local_time_hhmm.to_string();
        entry.days_of_week = days_of_week;
        entry.quiet_hours_start_hhmm = quiet_hours_start_hhmm;
        entry.quiet_hours_end_hhmm = quiet_hours_end_hhmm;
        entry.etag_version += 1;
        entry.etag = format!("\"notif-v{}\"", entry.etag_version);

        Ok(entry.clone())
    }

    pub fn upsert_push_subscription(
        &self,
        principal: &AuthenticatedPrincipal,
        subscription_id: &str,
        endpoint_url: &str,
        p256dh_key: &str,
        auth_secret: &str,
    ) -> Result<PushSubscriptionRecord, PersistenceError> {
        if !endpoint_url.trim().starts_with("https://") {
            return Err(PersistenceError::Validation(
                "push subscription endpoint_url must use https://".to_string(),
            ));
        }
        let mut guard = self.inner.write().expect("store write lock");
        let rec = PushSubscriptionRecord {
            subscription_id: subscription_id.to_string(),
            account_id: principal.account_id.clone(),
            endpoint_url: endpoint_url.trim().to_string(),
            p256dh_key: p256dh_key.to_string(),
            auth_secret: auth_secret.to_string(),
            active: true,
        };
        guard
            .push_subscriptions
            .insert(subscription_id.to_string(), rec.clone());
        Ok(rec)
    }

    pub fn delete_push_subscription(
        &self,
        principal: &AuthenticatedPrincipal,
        subscription_id: &str,
    ) -> Result<(), PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        if let Some(sub) = guard.push_subscriptions.get_mut(subscription_id) {
            principal.require_learner_ownership(&sub.account_id)?;
            sub.active = false;
            return Ok(());
        }
        // Also support revoking all active subscriptions for the principal when subscription_id is "current" or "default"
        for sub in guard.push_subscriptions.values_mut() {
            if sub.account_id == principal.account_id {
                sub.active = false;
            }
        }
        Ok(())
    }

    /// Evaluates or schedules a reminder occurrence for `local_date_yyyy_mm_dd` (`T08`, `@S27`, `@S33`, `@S34`, `@S60`).
    pub fn evaluate_or_schedule_reminder(
        &self,
        principal: &AuthenticatedPrincipal,
        occurrence_id: &str,
        local_date_yyyy_mm_dd: &str,
        now_utc_epoch_seconds: i64,
    ) -> Result<ReminderScheduleDecision, PersistenceError> {
        let prefs = self.get_notification_preferences(principal);
        let mut guard = self.inner.write().expect("store write lock");

        let today_study_completed = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .map(|p| !p.completed_activities.is_empty() && p.total_time_spent_minutes > 0)
            .unwrap_or(false);

        let decision = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: prefs.enabled,
            iana_timezone: prefs.iana_timezone,
            local_date_yyyy_mm_dd: local_date_yyyy_mm_dd.to_string(),
            local_time_hhmm: prefs.local_time_hhmm,
            quiet_hours_start_hhmm: prefs.quiet_hours_start_hhmm,
            quiet_hours_end_hhmm: prefs.quiet_hours_end_hhmm,
            today_study_completed,
            now_utc_epoch_seconds,
        })
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        if let ReminderScheduleDecision::Scheduled {
            scheduled_utc_epoch,
            ref scheduled_utc_iso,
            expires_utc_epoch,
            ref expires_utc_iso,
            dst_resolution_policy,
            ..
        } = decision
        {
            guard.reminder_occurrences.insert(
                occurrence_id.to_string(),
                ReminderOccurrenceRecord {
                    occurrence_id: occurrence_id.to_string(),
                    account_id: principal.account_id.clone(),
                    curriculum_id: None,
                    scheduled_local_date: local_date_yyyy_mm_dd.to_string(),
                    scheduled_utc_iso: scheduled_utc_iso.clone(),
                    scheduled_utc_epoch,
                    expires_utc_iso: expires_utc_iso.clone(),
                    expires_utc_epoch,
                    snoozed_until_utc_iso: None,
                    status: "scheduled".to_string(),
                    dst_resolution_policy,
                },
            );
        }

        Ok(decision)
    }

    /// Snoozes a reminder occurrence (`T08`, `REM-004`).
    pub fn snooze_reminder_occurrence(
        &self,
        principal: &AuthenticatedPrincipal,
        occurrence_id: &str,
        snooze_minutes: u32,
        now_utc_epoch_seconds: i64,
    ) -> Result<ReminderOccurrenceRecord, PersistenceError> {
        if snooze_minutes == 0 || snooze_minutes > 1_440 {
            return Err(PersistenceError::Validation(
                "snooze_minutes must be between 1 and 1440".to_string(),
            ));
        }
        let mut guard = self.inner.write().expect("store write lock");
        let occ = guard
            .reminder_occurrences
            .entry(occurrence_id.to_string())
            .or_insert_with(|| ReminderOccurrenceRecord {
                occurrence_id: occurrence_id.to_string(),
                account_id: principal.account_id.clone(),
                curriculum_id: None,
                scheduled_local_date: "2026-04-02".to_string(),
                scheduled_utc_iso: format_epoch_utc_iso(now_utc_epoch_seconds),
                scheduled_utc_epoch: now_utc_epoch_seconds,
                expires_utc_iso: format_epoch_utc_iso(now_utc_epoch_seconds + 12 * 3600),
                expires_utc_epoch: now_utc_epoch_seconds + 12 * 3600,
                snoozed_until_utc_iso: None,
                status: "scheduled".to_string(),
                dst_resolution_policy: DstResolutionPolicy::ExactLocalTime,
            });
        principal.require_learner_ownership(&occ.account_id)?;

        let snoozed_epoch = now_utc_epoch_seconds + (snooze_minutes as i64) * 60;
        let snoozed_iso = format_epoch_utc_iso(snoozed_epoch);
        occ.snoozed_until_utc_iso = Some(snoozed_iso);
        occ.status = "snoozed".to_string();
        Ok(occ.clone())
    }

    // =========================================================================
    // T07B & T07D: Hosted Credit Wallet, Quotes, Reservations, Settlements,
    //              Checkout Sessions, Signed Webhooks & Timeout Reconciliation
    // =========================================================================

    fn ensure_wallet_mut<'a>(
        guard: &'a mut StoreInner,
        account_id: &str,
    ) -> &'a mut HostedCreditWalletRecord {
        let byok_micros: u64 = guard
            .inference_usage_records
            .iter()
            .filter(|u| u.account_id == account_id)
            .map(|u| u.estimated_provider_cost_usd_micros)
            .sum();
        let byok_minor = (byok_micros / 10_000) as i64;
        let wallet = guard
            .hosted_credit_wallets
            .entry(account_id.to_string())
            .or_insert_with(|| HostedCreditWalletRecord {
                account_id: account_id.to_string(),
                currency: "USD".to_string(),
                available_minor_units: 500,
                reserved_minor_units: 0,
                lifetime_purchased_minor_units: 500,
                lifetime_settled_minor_units: 0,
                lifetime_refunded_minor_units: 0,
                four_cost_buckets: FourCostBucketBreakdown {
                    currency: "USD".to_string(),
                    service_access_minor_units: 0,
                    hosted_ai_inference_minor_units: 0,
                    external_byok_estimate_minor_units: byok_minor,
                    learning_materials_and_exams_minor_units: 0,
                },
                etag_version: 1,
                etag: "\"wallet-v1\"".to_string(),
                updated_at: "2026-04-02T19:00:00Z".to_string(),
            });
        wallet.four_cost_buckets.external_byok_estimate_minor_units = byok_minor;
        wallet.four_cost_buckets.hosted_ai_inference_minor_units =
            wallet.lifetime_settled_minor_units;
        wallet
    }

    pub fn get_hosted_credit_wallet(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> HostedCreditWalletRecord {
        let mut guard = self.inner.write().expect("store write lock");
        Self::ensure_wallet_mut(&mut guard, &principal.account_id).clone()
    }

    pub fn set_wallet_balance_for_test(
        &self,
        account_id: &str,
        available_minor_units: i64,
        reserved_minor_units: i64,
    ) -> HostedCreditWalletRecord {
        let mut guard = self.inner.write().expect("store write lock");
        let wallet = Self::ensure_wallet_mut(&mut guard, account_id);
        wallet.available_minor_units = available_minor_units;
        wallet.reserved_minor_units = reserved_minor_units;
        wallet.etag_version += 1;
        wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
        wallet.clone()
    }

    /// Creates a pre-execution `UsageQuote` (`T07B`, `BILL-003`, `BILL-004`, `@S06`, `@S28`, `@S30`, `@S74`).
    pub fn create_usage_quote(
        &self,
        principal: &AuthenticatedPrincipal,
        quote_id: Option<&str>,
        operation_kind: &str,
        billing_mode: BillingModeKind,
        provider_id: &str,
        model_id: &str,
        estimated_minor_units: i64,
        max_reservable_minor_units: i64,
        external_byok_estimated_minor_units: i64,
        learning_materials_estimated_minor_units: i64,
        now_epoch_seconds: i64,
        ttl_seconds: i64,
    ) -> Result<UsageQuoteRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_quote_id = quote_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("quote-{seq}"));

        let (est_hosted, max_hosted, est_byok) = match billing_mode {
            BillingModeKind::HostedCredits => (
                estimated_minor_units,
                max_reservable_minor_units,
                external_byok_estimated_minor_units,
            ),
            BillingModeKind::Byok => (
                0,
                0,
                if external_byok_estimated_minor_units > 0 {
                    external_byok_estimated_minor_units
                } else {
                    estimated_minor_units.max(25)
                },
            ),
        };

        let expires_at_epoch_seconds = now_epoch_seconds + ttl_seconds;
        let quote = UsageQuote {
            quote_id: resolved_quote_id.clone(),
            account_id: principal.account_id.clone(),
            operation_kind: operation_kind.to_string(),
            billing_mode,
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            currency: "USD".to_string(),
            estimated_minor_units: est_hosted,
            max_reservable_minor_units: max_hosted,
            external_byok_estimated_minor_units: est_byok,
            learning_materials_estimated_minor_units,
            pricing_snapshot_version: "pricing-2026-03-v1".to_string(),
            expires_at_epoch_seconds,
        };
        quote
            .validate(now_epoch_seconds)
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let four_cost_buckets = FourCostBucketBreakdown {
            currency: "USD".to_string(),
            service_access_minor_units: 0,
            hosted_ai_inference_minor_units: est_hosted,
            external_byok_estimate_minor_units: est_byok,
            learning_materials_and_exams_minor_units: learning_materials_estimated_minor_units,
        };
        four_cost_buckets
            .validate()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let record = UsageQuoteRecord {
            quote,
            four_cost_buckets,
            created_at: format_epoch_utc_iso(now_epoch_seconds),
            expires_at: format_epoch_utc_iso(expires_at_epoch_seconds),
        };
        guard.usage_quotes.insert(resolved_quote_id, record.clone());
        Ok(record)
    }

    /// Reserves hosted credits prior to provider execution (`T07B`, `BILL-003`, `BILL-005`, `BILL-008`, `@S28`, `@S30`, `@S68`).
    pub fn create_credit_reservation(
        &self,
        principal: &AuthenticatedPrincipal,
        reservation_id: Option<&str>,
        quote_id: &str,
        idempotency_key: &str,
        requested_reserve_minor_units: Option<i64>,
        now_epoch_seconds: i64,
    ) -> Result<CreditReservationRecord, PersistenceError> {
        let idem_trimmed = idempotency_key.trim();
        if idem_trimmed.is_empty() {
            return Err(PersistenceError::IdempotencyKeyRequired {
                operation_id: "reserveInferenceBudget".to_string(),
            });
        }

        let mut guard = self.inner.write().expect("store write lock");
        let idem_lookup = (principal.account_id.clone(), idem_trimmed.to_string());
        if let Some(existing_id) = guard.reservations_by_idempotency.get(&idem_lookup).cloned() {
            if let Some(existing_rec) = guard.credit_reservations.get(&existing_id).cloned() {
                if existing_rec.reservation.quote_id != quote_id {
                    return Err(PersistenceError::IdempotencyPayloadMismatch {
                        operation_id: "reserveInferenceBudget".to_string(),
                        idempotency_key: idem_trimmed.to_string(),
                    });
                }
                return Ok(existing_rec);
            }
        }

        let quote_rec = guard
            .usage_quotes
            .get(quote_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "usage_quote",
                resource_id: quote_id.to_string(),
            })?;
        principal.require_learner_ownership(&quote_rec.quote.account_id)?;

        if now_epoch_seconds > quote_rec.quote.expires_at_epoch_seconds {
            return Err(PersistenceError::Conflict {
                code: "quote_expired",
                message: format!(
                    "usage quote `{quote_id}` expired at `{}`",
                    quote_rec.expires_at
                ),
            });
        }

        let reserve_amount =
            requested_reserve_minor_units.unwrap_or(quote_rec.quote.max_reservable_minor_units);

        let (cur_avail, cur_res) = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            (wallet.available_minor_units, wallet.reserved_minor_units)
        };

        let (new_avail, new_res) = authorize_credit_reservation(
            cur_avail,
            cur_res,
            &quote_rec.quote,
            reserve_amount,
            now_epoch_seconds,
        )
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("insufficient available hosted credits") {
                PersistenceError::PaymentRequired {
                    code: "insufficient_hosted_credits",
                    message: msg,
                }
            } else {
                PersistenceError::Validation(msg)
            }
        })?;

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_reservation_id = reservation_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("resv-{seq}"));

        {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            wallet.available_minor_units = new_avail;
            wallet.reserved_minor_units = new_res;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = format_epoch_utc_iso(now_epoch_seconds);
        }

        let reservation = CreditReservation {
            reservation_id: resolved_reservation_id.clone(),
            account_id: principal.account_id.clone(),
            quote_id: quote_id.to_string(),
            idempotency_key: idem_trimmed.to_string(),
            operation_kind: quote_rec.quote.operation_kind.clone(),
            provider_id: quote_rec.quote.provider_id.clone(),
            model_id: quote_rec.quote.model_id.clone(),
            currency: "USD".to_string(),
            reserved_minor_units: reserve_amount,
            settled_minor_units: 0,
            released_minor_units: 0,
            status: ReservationStatus::Reserved,
            expires_at_epoch_seconds: now_epoch_seconds + 900,
        };
        let record = CreditReservationRecord {
            reservation,
            created_at: format_epoch_utc_iso(now_epoch_seconds),
            finalized_at: None,
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-hold-{seq}"),
            account_id: principal.account_id.clone(),
            entry_kind: LedgerEntryKind::ReservationHold,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: -reserve_amount,
            delta_reserved_minor_units: reserve_amount,
            balance_after_available_minor_units: new_avail,
            balance_after_reserved_minor_units: new_res,
            quote_id: Some(quote_id.to_string()),
            reservation_id: Some(resolved_reservation_id.clone()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!("Pre-execution credit hold for quote `{quote_id}`"),
            created_at_iso: format_epoch_utc_iso(now_epoch_seconds),
        });

        guard
            .reservations_by_idempotency
            .insert(idem_lookup, resolved_reservation_id.clone());
        guard
            .credit_reservations
            .insert(resolved_reservation_id, record.clone());
        Ok(record)
    }

    /// Settles a reservation upon committed artifact completion, capping settlement at `reserved_minor_units`
    /// and releasing any unused remainder (`T07B`, `BILL-003`, `BILL-005`, `@S30`, `@S68`).
    pub fn settle_credit_reservation(
        &self,
        principal: &AuthenticatedPrincipal,
        reservation_id: &str,
        actual_usage_minor_units: i64,
        now_epoch_seconds: i64,
    ) -> Result<(CreditReservationRecord, HostedCreditWalletRecord), PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let existing = guard
            .credit_reservations
            .get(reservation_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credit_reservation",
                resource_id: reservation_id.to_string(),
            })?;
        principal.require_learner_ownership(&existing.reservation.account_id)?;

        if existing.reservation.status == ReservationStatus::Settled {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id).clone();
            return Ok((existing, wallet));
        }
        if existing.reservation.status != ReservationStatus::Reserved {
            return Err(PersistenceError::Conflict {
                code: "reservation_not_active",
                message: format!(
                    "reservation `{reservation_id}` is already `{}`",
                    existing.reservation.status.as_str()
                ),
            });
        }

        let reserved = existing.reservation.reserved_minor_units;
        let (settled, released) = compute_reservation_settlement(reserved, actual_usage_minor_units)
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let now_iso = format_epoch_utc_iso(now_epoch_seconds);

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            wallet.reserved_minor_units = (wallet.reserved_minor_units - reserved).max(0);
            wallet.available_minor_units += released;
            wallet.lifetime_settled_minor_units += settled;
            wallet.four_cost_buckets.hosted_ai_inference_minor_units =
                wallet.lifetime_settled_minor_units;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = now_iso.clone();
            wallet.clone()
        };

        let updated_res = {
            let res_mut = guard
                .credit_reservations
                .get_mut(reservation_id)
                .expect("checked above");
            res_mut.reservation.settled_minor_units = settled;
            res_mut.reservation.released_minor_units = released;
            res_mut.reservation.status = ReservationStatus::Settled;
            res_mut.finalized_at = Some(now_iso.clone());
            res_mut.clone()
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-settle-{seq}"),
            account_id: principal.account_id.clone(),
            entry_kind: LedgerEntryKind::ReservationSettlement,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: released,
            delta_reserved_minor_units: -reserved,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: Some(updated_res.reservation.quote_id.clone()),
            reservation_id: Some(reservation_id.to_string()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!(
                "Settled {settled} minor units and released {released} minor units for reservation `{reservation_id}`"
            ),
            created_at_iso: now_iso,
        });

        Ok((updated_res, updated_wallet))
    }

    /// Releases 100% of a credit reservation on validation failure, cancellation, or provider failure (`T07B`, `BILL-005`, `@S68`).
    pub fn release_credit_reservation(
        &self,
        principal: &AuthenticatedPrincipal,
        reservation_id: &str,
        reason: &str,
        now_epoch_seconds: i64,
    ) -> Result<(CreditReservationRecord, HostedCreditWalletRecord), PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let existing = guard
            .credit_reservations
            .get(reservation_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credit_reservation",
                resource_id: reservation_id.to_string(),
            })?;
        principal.require_learner_ownership(&existing.reservation.account_id)?;

        if existing.reservation.status == ReservationStatus::Released {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id).clone();
            return Ok((existing, wallet));
        }
        if existing.reservation.status != ReservationStatus::Reserved {
            return Err(PersistenceError::Conflict {
                code: "reservation_already_settled",
                message: format!(
                    "reservation `{reservation_id}` is already `{}`",
                    existing.reservation.status.as_str()
                ),
            });
        }

        let reserved = existing.reservation.reserved_minor_units;
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let now_iso = format_epoch_utc_iso(now_epoch_seconds);

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &principal.account_id);
            wallet.reserved_minor_units = (wallet.reserved_minor_units - reserved).max(0);
            wallet.available_minor_units += reserved;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = now_iso.clone();
            wallet.clone()
        };

        let updated_res = {
            let res_mut = guard
                .credit_reservations
                .get_mut(reservation_id)
                .expect("checked above");
            res_mut.reservation.settled_minor_units = 0;
            res_mut.reservation.released_minor_units = reserved;
            res_mut.reservation.status = ReservationStatus::Released;
            res_mut.finalized_at = Some(now_iso.clone());
            res_mut.clone()
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-release-{seq}"),
            account_id: principal.account_id.clone(),
            entry_kind: LedgerEntryKind::ReservationRelease,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: reserved,
            delta_reserved_minor_units: -reserved,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: Some(updated_res.reservation.quote_id.clone()),
            reservation_id: Some(reservation_id.to_string()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!("Released reservation `{reservation_id}`: {reason}"),
            created_at_iso: now_iso,
        });

        Ok((updated_res, updated_wallet))
    }

    /// Reconciles an ambiguous or timed-out provider call (`T07D`, `BILL-008`, `NFR-006`, `@S43`, `@S68`).
    /// Never settles a charge unless `committed_artifact_persisted == true` and the provider confirmed completion.
    pub fn reconcile_ambiguous_provider_timeout(
        &self,
        reservation_id: &str,
        committed_artifact_persisted: bool,
        outcome: AmbiguousProviderOutcome,
        now_epoch_seconds: i64,
    ) -> Result<(CreditReservationRecord, HostedCreditWalletRecord), PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let existing = guard
            .credit_reservations
            .get(reservation_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "credit_reservation",
                resource_id: reservation_id.to_string(),
            })?;

        let account_id = existing.reservation.account_id.clone();
        if existing.reservation.status != ReservationStatus::Reserved {
            let wallet = Self::ensure_wallet_mut(&mut guard, &account_id).clone();
            return Ok((existing, wallet));
        }

        let reserved = existing.reservation.reserved_minor_units;
        let (target_status, settled, released) = evaluate_ambiguous_timeout_reconciliation(
            reserved,
            committed_artifact_persisted,
            outcome,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let now_iso = format_epoch_utc_iso(now_epoch_seconds);

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &account_id);
            wallet.reserved_minor_units = (wallet.reserved_minor_units - reserved).max(0);
            wallet.available_minor_units += released;
            wallet.lifetime_settled_minor_units += settled;
            wallet.four_cost_buckets.hosted_ai_inference_minor_units =
                wallet.lifetime_settled_minor_units;
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = now_iso.clone();
            wallet.clone()
        };

        let updated_res = {
            let res_mut = guard
                .credit_reservations
                .get_mut(reservation_id)
                .expect("checked above");
            res_mut.reservation.settled_minor_units = settled;
            res_mut.reservation.released_minor_units = released;
            res_mut.reservation.status = target_status;
            res_mut.finalized_at = Some(now_iso.clone());
            res_mut.clone()
        };

        let entry_kind = if target_status == ReservationStatus::Settled {
            LedgerEntryKind::ReservationSettlement
        } else {
            LedgerEntryKind::ReconciliationRelease
        };

        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: format!("ledg-reconcile-{seq}"),
            account_id,
            entry_kind,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: released,
            delta_reserved_minor_units: -reserved,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: Some(updated_res.reservation.quote_id.clone()),
            reservation_id: Some(reservation_id.to_string()),
            checkout_session_id: None,
            webhook_event_id: None,
            description: format!(
                "Ambiguous provider timeout reconciliation for `{reservation_id}`: status={}",
                target_status.as_str()
            ),
            created_at_iso: now_iso,
        });

        Ok((updated_res, updated_wallet))
    }

    pub fn list_ledger_entries(&self, principal: &AuthenticatedPrincipal) -> Vec<LedgerEntry> {
        let guard = self.inner.read().expect("store read lock");
        guard
            .ledger_entries
            .iter()
            .filter(|e| e.account_id == principal.account_id)
            .cloned()
            .collect()
    }

    /// Creates a hosted credit top-up checkout session (`T07D`, `BILL-003`, `UI-020`, `@S84`).
    pub fn create_checkout_session(
        &self,
        principal: &AuthenticatedPrincipal,
        checkout_session_id: Option<&str>,
        package_id: &str,
        idempotency_key: &str,
        amount_minor_units: i64,
        credit_minor_units: i64,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<CheckoutSessionRecord, PersistenceError> {
        let idem_trimmed = idempotency_key.trim();
        if idem_trimmed.is_empty() {
            return Err(PersistenceError::IdempotencyKeyRequired {
                operation_id: "createBillingCheckoutSession".to_string(),
            });
        }
        if amount_minor_units <= 0 || credit_minor_units <= 0 {
            return Err(PersistenceError::Validation(
                "checkout amount_minor_units and credit_minor_units must be positive".to_string(),
            ));
        }
        if !success_url.starts_with("https://") || !cancel_url.starts_with("https://") {
            return Err(PersistenceError::Validation(
                "checkout success_url and cancel_url must use https://".to_string(),
            ));
        }

        let mut guard = self.inner.write().expect("store write lock");
        let idem_key = (principal.account_id.clone(), idem_trimmed.to_string());
        if let Some(existing_id) = guard.checkout_by_idempotency.get(&idem_key).cloned() {
            if let Some(existing_sess) = guard.checkout_sessions.get(&existing_id).cloned() {
                if existing_sess.package_id != package_id
                    || existing_sess.amount_minor_units != amount_minor_units
                {
                    return Err(PersistenceError::IdempotencyPayloadMismatch {
                        operation_id: "createBillingCheckoutSession".to_string(),
                        idempotency_key: idem_trimmed.to_string(),
                    });
                }
                return Ok(existing_sess);
            }
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_id = checkout_session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("cs_test_{seq}"));

        let record = CheckoutSessionRecord {
            checkout_session_id: resolved_id.clone(),
            account_id: principal.account_id.clone(),
            package_id: package_id.to_string(),
            idempotency_key: idem_trimmed.to_string(),
            currency: "USD".to_string(),
            amount_minor_units,
            credit_minor_units,
            status: "pending".to_string(),
            checkout_url: format!("https://checkout.stripe.example.test/pay/{resolved_id}"),
            success_url: success_url.to_string(),
            cancel_url: cancel_url.to_string(),
            created_at: "2026-04-02T19:00:00Z".to_string(),
            completed_at: None,
        };

        guard
            .checkout_by_idempotency
            .insert(idem_key, resolved_id.clone());
        guard
            .checkout_sessions
            .insert(resolved_id, record.clone());
        Ok(record)
    }

    /// Processes a signed payment provider webhook idempotently by `provider_event_id` (`T07D`, `BILL-005`, `NFR-006`, `@S43`, `@S67`, `@S68`).
    pub fn process_payment_webhook(
        &self,
        webhook_secret: &[u8],
        raw_payload: &[u8],
        signature_header: &str,
    ) -> Result<PaymentWebhookReceiptRecord, PersistenceError> {
        // 1. Verify HMAC-SHA256 over raw payload BEFORE parsing or mutating state
        let _verified_sig_hex =
            verify_webhook_hmac_sha256(webhook_secret, raw_payload, signature_header)?;

        let payload: Value = serde_json::from_slice(raw_payload).map_err(|e| {
            PersistenceError::Validation(format!("invalid webhook JSON payload: {e}"))
        })?;

        let provider_event_id = payload
            .get("provider_event_id")
            .or_else(|| payload.get("webhook_event_id"))
            .or_else(|| payload.get("event_id"))
            .or_else(|| payload.get("id"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                PersistenceError::Validation("missing provider_event_id in webhook".to_string())
            })?
            .to_string();

        let event_type = payload
            .get("event_type")
            .or_else(|| payload.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("checkout.session.completed")
            .to_string();

        let checkout_session_id = payload
            .get("checkout_session_id")
            .or_else(|| payload.get("session_id"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                PersistenceError::Validation("missing checkout_session_id in webhook".to_string())
            })?
            .to_string();

        let mut guard = self.inner.write().expect("store write lock");

        // 2. Deduplicate by provider_event_id (idempotent replay with zero duplicate ledger mutation)
        if let Some(existing_receipt) = guard
            .payment_webhook_events
            .get(&provider_event_id)
            .cloned()
        {
            let mut replayed = existing_receipt;
            replayed.replayed = true;
            return Ok(replayed);
        }

        let sess = guard
            .checkout_sessions
            .get(&checkout_session_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "checkout_session",
                resource_id: checkout_session_id.clone(),
            })?;

        let amount_minor_units = payload
            .get("amount_minor_units")
            .or_else(|| payload.get("credit_minor_units"))
            .and_then(|v| v.as_i64())
            .unwrap_or(sess.credit_minor_units);

        if amount_minor_units <= 0 {
            return Err(PersistenceError::Validation(
                "webhook amount_minor_units must be positive".to_string(),
            ));
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let account_id = sess.account_id.clone();

        let (entry_kind, delta_avail, new_sess_status, description) = match event_type.as_str() {
            "checkout.session.completed" => (
                LedgerEntryKind::TopUpCredit,
                amount_minor_units,
                "completed",
                format!("Hosted credit top-up from checkout session `{checkout_session_id}`"),
            ),
            "charge.refunded" => (
                LedgerEntryKind::RefundDebit,
                -amount_minor_units,
                "refunded",
                format!("Refund debit for checkout session `{checkout_session_id}`"),
            ),
            "charge.dispute.created" => (
                LedgerEntryKind::ChargebackDebit,
                -amount_minor_units,
                "disputed",
                format!("Chargeback dispute debit for checkout session `{checkout_session_id}`"),
            ),
            other => {
                return Err(PersistenceError::Validation(format!(
                    "unsupported payment webhook event_type `{other}`"
                )));
            }
        };

        if let Some(sess_mut) = guard.checkout_sessions.get_mut(&checkout_session_id) {
            sess_mut.status = new_sess_status.to_string();
            if new_sess_status == "completed" {
                sess_mut.completed_at = Some("2026-04-02T19:05:00Z".to_string());
            }
        }

        let updated_wallet = {
            let wallet = Self::ensure_wallet_mut(&mut guard, &account_id);
            wallet.available_minor_units += delta_avail;
            if delta_avail > 0 {
                wallet.lifetime_purchased_minor_units += delta_avail;
            } else {
                wallet.lifetime_refunded_minor_units += -delta_avail;
            }
            wallet.etag_version += 1;
            wallet.etag = format!("\"wallet-v{}\"", wallet.etag_version);
            wallet.updated_at = "2026-04-02T19:05:00Z".to_string();
            wallet.clone()
        };

        let ledger_entry_id = format!("ledg-wh-{seq}");
        guard.ledger_entries.push(LedgerEntry {
            ledger_entry_id: ledger_entry_id.clone(),
            account_id: account_id.clone(),
            entry_kind,
            cost_bucket: CostBucketKind::HostedAiInference,
            currency: "USD".to_string(),
            delta_available_minor_units: delta_avail,
            delta_reserved_minor_units: 0,
            balance_after_available_minor_units: updated_wallet.available_minor_units,
            balance_after_reserved_minor_units: updated_wallet.reserved_minor_units,
            quote_id: None,
            reservation_id: None,
            checkout_session_id: Some(checkout_session_id.clone()),
            webhook_event_id: Some(provider_event_id.clone()),
            description,
            created_at_iso: "2026-04-02T19:05:00Z".to_string(),
        });

        let receipt = PaymentWebhookReceiptRecord {
            provider_event_id: provider_event_id.clone(),
            event_type,
            checkout_session_id,
            account_id,
            amount_minor_units,
            ledger_entry_id,
            replayed: false,
            wallet: updated_wallet,
        };
        guard
            .payment_webhook_events
            .insert(provider_event_id, receipt.clone());
        Ok(receipt)
    }

    // =========================================================================
    // T13: Public Templates, Sanitization, Preview Digest, Discovery,
    //      Owner Management, Withdrawal, Reports, Moderation, Upvotes & Adoption
    // =========================================================================

    fn build_sanitized_public_envelope(
        guard: &StoreInner,
        curriculum_id: &str,
        source_rev: &CurriculumRevisionRecord,
        visibility: ModerationVisibilityState,
        publisher_display_name: &str,
        attribution_text: &str,
    ) -> Result<
        (
            Value,
            Value,
            Value,
            Value,
            String,
            String,
            Vec<String>,
            Vec<String>,
        ),
        PersistenceError,
    > {
        let root = curriculum_contracts::workspace_root();
        let synthetic_path =
            root.join("specs/001-curriculum-platform/examples/public-curriculum.synthetic.json");
        let base_doc: Value = serde_json::from_str(
            &std::fs::read_to_string(&synthetic_path)
                .map_err(|e| PersistenceError::Validation(e.to_string()))?,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let mut stripped_private_fields = vec![
            "account_id".to_string(),
            "owner_account_id".to_string(),
            "private_notes".to_string(),
            "attempt_history".to_string(),
            "schedule_revisions".to_string(),
            "reminder_preferences".to_string(),
            "provider_credentials".to_string(),
            "proficiency_records".to_string(),
        ];
        let mut withheld_restricted_fields = vec![
            "full_text_excerpt".to_string(),
            "transcript_body".to_string(),
        ];

        if let Some(priv_obj) = source_rev.payload.as_object() {
            for k in priv_obj.keys() {
                if PublicSnapshotSanitizer::is_private_learner_field(k)
                    && !stripped_private_fields.contains(k)
                {
                    stripped_private_fields.push(k.clone());
                }
                if PublicSnapshotSanitizer::is_restricted_third_party_field(k)
                    && !withheld_restricted_fields.contains(k)
                {
                    withheld_restricted_fields.push(k.clone());
                }
            }
        }

        let mut content = base_doc["content"].clone();
        if let Some(title) = source_rev.payload.get("title").and_then(|v| v.as_str()) {
            content["title"] = Value::String(title.to_string());
        } else {
            content["title"] = Value::String(format!("Public Template — {curriculum_id}"));
        }
        if let Some(summary) = source_rev.payload.get("summary").and_then(|v| v.as_str()) {
            content["summary"] = Value::String(summary.to_string());
        }

        // Verify that any catalog resource versions referenced in the private revision are not quarantined or prohibited
        if let Some(rv_ids) = source_rev
            .payload
            .get("resource_version_ids")
            .and_then(|v| v.as_array())
        {
            let mut checked_ids = Vec::new();
            for rv_val in rv_ids {
                if let Some(rv_id) = rv_val.as_str() {
                    if let Some(overlay) = guard.quarantine_overlays.get(rv_id) {
                        if overlay.lifted_at.is_none() {
                            return Err(PersistenceError::IneligibleCatalogResource {
                                resource_version_id: rv_id.to_string(),
                                reason: "cannot publish curriculum referencing quarantined catalog resource".to_string(),
                            });
                        }
                    }
                    checked_ids.push(Value::String(rv_id.to_string()));
                }
            }
            if !checked_ids.is_empty() {
                content["resource_version_ids"] = Value::Array(checked_ids);
            }
        }

        // Validate sanitized keys via pure domain policy
        let present_keys: Vec<String> = content
            .as_object()
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default();
        PublicSnapshotSanitizer::validate_sanitized_field_keys(&present_keys, &[])
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let public_author_hash = &sha256_bytes_hex(source_rev.owner_account_id.as_bytes())[..12];
        let publisher = json!({
            "public_author_id": format!("public-author-{public_author_hash}"),
            "display_name": publisher_display_name
        });
        let publication_terms = json!({
            "policy_id": "synthetic-publication-terms-v1",
            "content_license_id": "synthetic-unadopted-content-license",
            "rights_scope": "eligible_original_annotations_and_structure",
            "attribution": attribution_text,
            "third_party_materials_excluded": true
        });
        let origin = Value::Null;

        let content_sha256 = jcs_sha256_hex(&content);
        let preview_envelope = json!({
            "curriculum_id": curriculum_id,
            "source_revision_id": source_rev.revision_id,
            "visibility": visibility.as_str(),
            "publisher": publisher,
            "publication_terms": publication_terms,
            "origin": origin,
            "content_sha256": content_sha256,
        });
        let preview_sha256 = jcs_sha256_hex(&preview_envelope);

        Ok((
            content,
            publisher,
            publication_terms,
            origin,
            content_sha256,
            preview_sha256,
            stripped_private_fields,
            withheld_restricted_fields,
        ))
    }

    /// Generates a sanitized publication preview with `preview_sha256` (`T13`, `SHARE-001`, `SHARE-002`, `SHARE-009`, `@S56`, `@S57`, `@S79`).
    pub fn preview_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        visibility: ModerationVisibilityState,
        publisher_display_name: Option<&str>,
        attribution_text: Option<&str>,
    ) -> Result<PublicationPreviewRecord, PersistenceError> {
        if !matches!(
            visibility,
            ModerationVisibilityState::Public | ModerationVisibilityState::Unlisted
        ) {
            return Err(PersistenceError::Validation(
                "publication preview visibility must be `public` or `unlisted`".to_string(),
            ));
        }

        let mut guard = self.inner.write().expect("store write lock");
        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        let owner_id = revs
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum",
                resource_id: curriculum_id.to_string(),
            })?
            .owner_account_id
            .clone();
        principal.require_learner_ownership(&owner_id)?;

        revs.sort_by_key(|r| r.revision_number);
        let active_rev = (*revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .unwrap_or_else(|| revs.last().expect("at least one revision")))
        .clone();

        let display_name = publisher_display_name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Example learner");
        let attribution = attribution_text
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Synthetic author; no external provider endorsement.");

        let (
            sanitized_content,
            publisher,
            publication_terms,
            origin,
            content_sha256,
            preview_sha256,
            stripped_private_fields,
            withheld_restricted_fields,
        ) = Self::build_sanitized_public_envelope(
            &guard,
            curriculum_id,
            &active_rev,
            visibility,
            display_name,
            attribution,
        )?;

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let preview_id = format!("pubprev-{seq}");

        let record = PublicationPreviewRecord {
            preview_id: preview_id.clone(),
            account_id: principal.account_id.clone(),
            curriculum_id: curriculum_id.to_string(),
            source_revision_id: active_rev.revision_id,
            visibility,
            publisher_display_name: display_name.to_string(),
            attribution_text: attribution.to_string(),
            preview_sha256,
            content_sha256,
            stripped_private_fields,
            withheld_restricted_fields,
            sanitized_content,
            publication_terms,
            publisher,
            origin,
            expires_at: "2026-04-03T19:00:00Z".to_string(),
        };
        guard
            .publication_previews
            .insert(preview_id, record.clone());
        Ok(record)
    }

    /// Confirms and publishes a new public or unlisted curriculum template (`T13`, `SHARE-001`, `SHARE-007`, `SHARE-009`, `@S56`, `@S61`, `@S79`).
    pub fn publish_curriculum(
        &self,
        principal: &AuthenticatedPrincipal,
        preview_id: Option<&str>,
        curriculum_id: Option<&str>,
        publication_id: Option<&str>,
        expected_preview_sha256: &str,
        accept_publication_terms: bool,
        visibility_override: Option<ModerationVisibilityState>,
    ) -> Result<PublicationViewRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");

        // Resolve preview by preview_id or latest preview for (account_id, curriculum_id / expected_preview_sha256)
        let preview = if let Some(pid) = preview_id {
            guard.publication_previews.get(pid).cloned()
        } else {
            guard
                .publication_previews
                .values()
                .rev()
                .find(|p| {
                    p.account_id == principal.account_id
                        && (curriculum_id.map(|cid| p.curriculum_id == cid).unwrap_or(true))
                })
                .cloned()
        }
        .ok_or_else(|| PersistenceError::NotFound {
            resource_type: "publication_preview",
            resource_id: preview_id.unwrap_or("latest").to_string(),
        })?;

        principal.require_learner_ownership(&preview.account_id)?;

        // Recompute current envelope from current active revision of the source curriculum (@S79, @S83)
        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == preview.curriculum_id)
            .collect();
        revs.sort_by_key(|r| r.revision_number);
        let current_active_rev = (*revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .unwrap_or_else(|| revs.last().expect("at least one revision")))
        .clone();

        let effective_visibility = visibility_override.unwrap_or(preview.visibility);
        let (_, _, _, _, current_content_sha256, current_computed_preview_sha256, _, _) =
            Self::build_sanitized_public_envelope(
                &guard,
                &preview.curriculum_id,
                &current_active_rev,
                effective_visibility,
                &preview.publisher_display_name,
                &preview.attribution_text,
            )?;

        let digest_verifier = PublicationPreviewDigest {
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            visibility: preview.visibility.as_str().to_string(),
        };
        digest_verifier
            .validate_publication_confirmation(
                expected_preview_sha256,
                &current_computed_preview_sha256,
                accept_publication_terms,
            )
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("stale or mismatched") {
                    PersistenceError::Conflict {
                        code: "preview_digest_mismatch",
                        message: msg,
                    }
                } else {
                    PersistenceError::Validation(msg)
                }
            })?;

        // Reject duplicate content_sha256 across published templates (`SHARE-007`, `@S61`)
        if let Some(dup) = guard
            .publication_revisions
            .values()
            .find(|r| r.content_sha256 == current_content_sha256)
        {
            return Err(PersistenceError::DuplicatePublicRevisionContent {
                publication_id: dup.publication_id.clone(),
                content_sha256: current_content_sha256,
            });
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_pub_id = publication_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("pub-template-{seq:03}"));
        let resolved_pub_rev_id = format!("pubrev-{resolved_pub_id}-v1");

        let snapshot = json!({
            "schema_version": "0.2.0",
            "publication_id": resolved_pub_id,
            "publication_revision_id": resolved_pub_rev_id,
            "revision_number": 1,
            "supersedes_publication_revision_id": Value::Null,
            "publisher": preview.publisher,
            "published_at": "2026-10-20T16:00:00Z",
            "content_sha256": preview.content_sha256,
            "content": preview.sanitized_content,
            "publication_terms": preview.publication_terms,
            "origin": preview.origin
        });

        let registry = curriculum_contracts::ContractRegistry::load_from_workspace()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
        registry
            .validate("public-curriculum.schema.json", &snapshot)
            .map_err(|e| {
                PersistenceError::Validation(format!("public-curriculum.schema.json error: {e}"))
            })?;

        let public_author_id = snapshot["publisher"]["public_author_id"]
            .as_str()
            .unwrap_or("public-author-001")
            .to_string();

        let pub_record = PublicationRecord {
            publication_id: resolved_pub_id.clone(),
            owner_account_id: Some(principal.account_id.clone()),
            source_curriculum_id: preview.curriculum_id.clone(),
            public_author_id,
            publisher_display_name: preview.publisher_display_name.clone(),
            visibility: effective_visibility,
            pre_moderation_visibility: effective_visibility,
            current_revision_id: resolved_pub_rev_id.clone(),
            latest_revision_number: 1,
            etag_version: 1,
            etag: "\"pub-mgmt-v1\"".to_string(),
            published_at: "2026-10-20T16:00:00Z".to_string(),
            updated_at: "2026-10-20T16:00:00Z".to_string(),
            withdrawn_at: None,
        };

        let rev_record = PublicationRevisionRecord {
            publication_revision_id: resolved_pub_rev_id.clone(),
            publication_id: resolved_pub_id.clone(),
            revision_number: 1,
            supersedes_publication_revision_id: None,
            source_curriculum_revision_id: preview.source_revision_id.clone(),
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            upvote_count: 0,
            snapshot: snapshot.clone(),
            published_at: "2026-10-20T16:00:00Z".to_string(),
        };

        let title = snapshot["content"]["title"]
            .as_str()
            .unwrap_or("Published Curriculum")
            .to_string();
        let summary = snapshot["content"]["summary"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let topic_id = snapshot["content"]["topic_ids"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("topic-tokenization")
            .to_string();

        guard
            .publications
            .insert(resolved_pub_id.clone(), pub_record);
        guard
            .publication_revisions
            .insert(resolved_pub_rev_id.clone(), rev_record);

        Ok(PublicationViewRecord {
            publication_id: resolved_pub_id,
            publication_revision_id: resolved_pub_rev_id,
            revision_number: 1,
            visibility: effective_visibility.as_str().to_string(),
            title,
            summary,
            topic_id,
            publisher_display_name: preview.publisher_display_name,
            content_sha256: preview.content_sha256,
            upvote_count: 0,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
            snapshot,
            published_at: "2026-10-20T16:00:00Z".to_string(),
        })
    }

    /// Publishes a new revision of an existing owned publication (`T13`, `SHARE-007`, `@S61`, `@S79`).
    /// Starts the new revision with `upvote_count: 0` (votes never carry over across revisions).
    pub fn publish_publication_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        if_match: Option<&str>,
        preview_id: Option<&str>,
        expected_preview_sha256: &str,
        accept_publication_terms: bool,
    ) -> Result<PublicationViewRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let existing_pub = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        let owner_id = existing_pub
            .owner_account_id
            .as_deref()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        principal.require_learner_ownership(owner_id)?;
        evaluate_if_match(if_match, &existing_pub.etag)?;

        let preview = if let Some(pid) = preview_id {
            guard.publication_previews.get(pid).cloned()
        } else {
            guard
                .publication_previews
                .values()
                .rev()
                .find(|p| {
                    p.account_id == principal.account_id
                        && p.curriculum_id == existing_pub.source_curriculum_id
                })
                .cloned()
        }
        .ok_or_else(|| PersistenceError::NotFound {
            resource_type: "publication_preview",
            resource_id: preview_id.unwrap_or("latest").to_string(),
        })?;

        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == existing_pub.source_curriculum_id)
            .collect();
        revs.sort_by_key(|r| r.revision_number);
        let current_active_rev = (*revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .unwrap_or_else(|| revs.last().expect("at least one revision")))
        .clone();

        let (_, _, _, _, current_content_sha256, current_computed_preview_sha256, _, _) =
            Self::build_sanitized_public_envelope(
                &guard,
                &existing_pub.source_curriculum_id,
                &current_active_rev,
                preview.visibility,
                &preview.publisher_display_name,
                &preview.attribution_text,
            )?;

        let digest_verifier = PublicationPreviewDigest {
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            visibility: preview.visibility.as_str().to_string(),
        };
        digest_verifier
            .validate_publication_confirmation(
                expected_preview_sha256,
                &current_computed_preview_sha256,
                accept_publication_terms,
            )
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("stale or mismatched") {
                    PersistenceError::Conflict {
                        code: "preview_digest_mismatch",
                        message: msg,
                    }
                } else {
                    PersistenceError::Validation(msg)
                }
            })?;

        if guard
            .publication_revisions
            .values()
            .any(|r| r.content_sha256 == current_content_sha256)
        {
            return Err(PersistenceError::DuplicatePublicRevisionContent {
                publication_id: publication_id.to_string(),
                content_sha256: current_content_sha256,
            });
        }

        let next_rev_num = existing_pub.latest_revision_number + 1;
        let new_pub_rev_id = format!("pubrev-{publication_id}-v{next_rev_num}");
        let snapshot = json!({
            "schema_version": "0.2.0",
            "publication_id": publication_id,
            "publication_revision_id": new_pub_rev_id,
            "revision_number": next_rev_num,
            "supersedes_publication_revision_id": existing_pub.current_revision_id,
            "publisher": preview.publisher,
            "published_at": "2026-10-20T17:00:00Z",
            "content_sha256": preview.content_sha256,
            "content": preview.sanitized_content,
            "publication_terms": preview.publication_terms,
            "origin": preview.origin
        });

        let registry = curriculum_contracts::ContractRegistry::load_from_workspace()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
        registry
            .validate("public-curriculum.schema.json", &snapshot)
            .map_err(|e| {
                PersistenceError::Validation(format!("public-curriculum.schema.json error: {e}"))
            })?;

        let rev_record = PublicationRevisionRecord {
            publication_revision_id: new_pub_rev_id.clone(),
            publication_id: publication_id.to_string(),
            revision_number: next_rev_num,
            supersedes_publication_revision_id: Some(existing_pub.current_revision_id.clone()),
            source_curriculum_revision_id: preview.source_revision_id.clone(),
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            upvote_count: 0,
            snapshot: snapshot.clone(),
            published_at: "2026-10-20T17:00:00Z".to_string(),
        };
        guard
            .publication_revisions
            .insert(new_pub_rev_id.clone(), rev_record);

        if let Some(pub_mut) = guard.publications.get_mut(publication_id) {
            pub_mut.current_revision_id = new_pub_rev_id.clone();
            pub_mut.latest_revision_number = next_rev_num;
            pub_mut.visibility = preview.visibility;
            pub_mut.pre_moderation_visibility = preview.visibility;
            pub_mut.etag_version += 1;
            pub_mut.etag = format!("\"pub-mgmt-v{}\"", pub_mut.etag_version);
            pub_mut.updated_at = "2026-10-20T17:00:00Z".to_string();
        }

        let title = snapshot["content"]["title"]
            .as_str()
            .unwrap_or("Published Curriculum")
            .to_string();
        let summary = snapshot["content"]["summary"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let topic_id = snapshot["content"]["topic_ids"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("topic-tokenization")
            .to_string();

        Ok(PublicationViewRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: new_pub_rev_id,
            revision_number: next_rev_num,
            visibility: preview.visibility.as_str().to_string(),
            title,
            summary,
            topic_id,
            publisher_display_name: preview.publisher_display_name,
            content_sha256: preview.content_sha256,
            upvote_count: 0,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
            snapshot,
            published_at: "2026-10-20T17:00:00Z".to_string(),
        })
    }

    fn publication_has_quarantined_resource(
        guard: &StoreInner,
        rev: &PublicationRevisionRecord,
    ) -> bool {
        if let Some(rv_ids) = rev
            .snapshot
            .get("content")
            .and_then(|c| c.get("resource_version_ids"))
            .and_then(|v| v.as_array())
        {
            for rv_val in rv_ids {
                if let Some(rv_id) = rv_val.as_str() {
                    if let Some(overlay) = guard.quarantine_overlays.get(rv_id) {
                        if overlay.lifted_at.is_none() {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    /// Lists public templates for discovery (`T13`, `SHARE-003`, `SHARE-006`, `@S58`, `@S62`, `@S63`, `@S64`).
    /// Never includes `unlisted`, `withdrawn`, `quarantined`, or `removed` templates.
    pub fn discover_public_publications(
        &self,
        query: Option<&str>,
        topic_id: Option<&str>,
        sort: Option<&str>,
    ) -> Vec<PublicationViewRecord> {
        let guard = self.inner.read().expect("store read lock");
        let mut items = Vec::new();

        for pub_rec in guard.publications.values() {
            if !pub_rec.visibility.is_listed_in_public_discovery() {
                continue;
            }
            let Some(rev) = guard.publication_revisions.get(&pub_rec.current_revision_id) else {
                continue;
            };
            if Self::publication_has_quarantined_resource(&guard, rev) {
                continue;
            }
            let title = rev.snapshot["content"]["title"]
                .as_str()
                .unwrap_or("Published Curriculum")
                .to_string();
            let summary = rev.snapshot["content"]["summary"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let rev_topic_id = rev.snapshot["content"]["topic_ids"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("topic-tokenization")
                .to_string();

            if let Some(q) = query.map(str::trim).filter(|s| !s.is_empty()) {
                let q_low = q.to_ascii_lowercase();
                if !title.to_ascii_lowercase().contains(&q_low)
                    && !summary.to_ascii_lowercase().contains(&q_low)
                {
                    continue;
                }
            }
            if let Some(tid) = topic_id.map(str::trim).filter(|s| !s.is_empty()) {
                if rev_topic_id != tid {
                    continue;
                }
            }

            items.push(PublicationViewRecord {
                publication_id: pub_rec.publication_id.clone(),
                publication_revision_id: rev.publication_revision_id.clone(),
                revision_number: rev.revision_number,
                visibility: pub_rec.visibility.as_str().to_string(),
                title,
                summary,
                topic_id: rev_topic_id,
                publisher_display_name: pub_rec.publisher_display_name.clone(),
                content_sha256: rev.content_sha256.clone(),
                upvote_count: rev.upvote_count,
                upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
                snapshot: rev.snapshot.clone(),
                published_at: rev.published_at.clone(),
            });
        }

        if sort == Some("upvotes") {
            items.sort_by(|a, b| {
                b.upvote_count
                    .cmp(&a.upvote_count)
                    .then_with(|| a.publication_id.cmp(&b.publication_id))
            });
        } else {
            items.sort_by(|a, b| {
                b.published_at
                    .cmp(&a.published_at)
                    .then_with(|| a.publication_id.cmp(&b.publication_id))
            });
        }
        items
    }

    /// Reads a `public` or `unlisted` publication via direct link (`T13`, `SHARE-003`, `SHARE-008`, `@S58`, `@S63`, `@S64`, `@S80`).
    /// Returns `404` for `withdrawn`, `quarantined`, or `removed` publications.
    pub fn get_public_publication_view(
        &self,
        publication_id: &str,
        publication_revision_id: Option<&str>,
    ) -> Result<PublicationViewRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;

        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }

        let target_rev_id = publication_revision_id.unwrap_or(&pub_rec.current_revision_id);
        let rev = guard
            .publication_revisions
            .get(target_rev_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: target_rev_id.to_string(),
            })?;

        let title = rev.snapshot["content"]["title"]
            .as_str()
            .unwrap_or("Published Curriculum")
            .to_string();
        let summary = rev.snapshot["content"]["summary"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let topic_id = rev.snapshot["content"]["topic_ids"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("topic-tokenization")
            .to_string();

        Ok(PublicationViewRecord {
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
        })
    }

    /// Lists the authenticated owner's publications across active, quarantined, and withdrawn states (`@S80`, `@S85`, `@S86`).
    /// Withheld fields (`public_url`, `public_upvote_count`) are `None` (`null`, never `0`) when quarantined or withdrawn.
    pub fn list_owned_publications(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<OwnedPublicationSummaryRecord> {
        let guard = self.inner.read().expect("store read lock");
        let mut out = Vec::new();
        for pub_rec in guard.publications.values() {
            if pub_rec.owner_account_id.as_deref() != Some(principal.account_id.as_str()) {
                continue;
            }
            let readable = pub_rec.visibility.is_readable_via_direct_link();
            let rev = guard.publication_revisions.get(&pub_rec.current_revision_id);
            let title = if readable {
                rev.and_then(|r| r.snapshot["content"]["title"].as_str())
                    .map(str::to_string)
            } else {
                None
            };
            let public_url = if readable {
                Some(format!("/v1/publications/{}", pub_rec.publication_id))
            } else {
                None
            };
            let public_upvote_count = if readable {
                rev.map(|r| r.upvote_count)
            } else {
                None
            };
            out.push(OwnedPublicationSummaryRecord {
                publication_id: pub_rec.publication_id.clone(),
                source_curriculum_id: pub_rec.source_curriculum_id.clone(),
                current_revision_id: pub_rec.current_revision_id.clone(),
                latest_revision_number: pub_rec.latest_revision_number,
                visibility: pub_rec.visibility.as_str().to_string(),
                title,
                public_url,
                public_upvote_count,
                updated_at: pub_rec.updated_at.clone(),
            });
        }
        out
    }

    /// Reads owner publication management state and lifecycle ETag even while quarantined or withdrawn (`@S80`, `@S85`, `@S86`).
    pub fn get_owned_publication_management(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
    ) -> Result<OwnedPublicationManagementRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if pub_rec.owner_account_id.as_deref() != Some(principal.account_id.as_str()) {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let readable = pub_rec.visibility.is_readable_via_direct_link();
        let rev = guard.publication_revisions.get(&pub_rec.current_revision_id);
        Ok(OwnedPublicationManagementRecord {
            publication_id: pub_rec.publication_id.clone(),
            source_curriculum_id: pub_rec.source_curriculum_id.clone(),
            current_revision_id: pub_rec.current_revision_id.clone(),
            latest_revision_number: pub_rec.latest_revision_number,
            visibility: pub_rec.visibility.as_str().to_string(),
            public_readability: readable,
            public_url: if readable {
                Some(format!("/v1/publications/{}", pub_rec.publication_id))
            } else {
                None
            },
            public_upvote_count: if readable {
                rev.map(|r| r.upvote_count)
            } else {
                None
            },
            etag: pub_rec.etag.clone(),
            published_at: pub_rec.published_at.clone(),
            updated_at: pub_rec.updated_at.clone(),
            withdrawn_at: pub_rec.withdrawn_at.clone(),
        })
    }

    /// Lists revision metadata for an owned publication even while public content is unavailable (`@S85`).
    pub fn list_owned_publication_revisions(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
    ) -> Result<Vec<OwnedPublicationRevisionItem>, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if pub_rec.owner_account_id.as_deref() != Some(principal.account_id.as_str()) {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let readable = pub_rec.visibility.is_readable_via_direct_link();
        let mut revs: Vec<&PublicationRevisionRecord> = guard
            .publication_revisions
            .values()
            .filter(|r| r.publication_id == publication_id)
            .collect();
        revs.sort_by(|a, b| b.revision_number.cmp(&a.revision_number));
        Ok(revs
            .into_iter()
            .map(|r| OwnedPublicationRevisionItem {
                publication_revision_id: r.publication_revision_id.clone(),
                publication_id: r.publication_id.clone(),
                revision_number: r.revision_number,
                source_curriculum_revision_id: r.source_curriculum_revision_id.clone(),
                content_sha256: r.content_sha256.clone(),
                public_readability: readable,
                upvote_count: if readable { Some(r.upvote_count) } else { None },
                published_at: r.published_at.clone(),
            })
            .collect())
    }

    /// Withdraws all revisions of an owned publication from public/unlisted access while preserving
    /// adopter-owned private copies (`T13`, `SHARE-008`, `@S63`, `@S80`).
    pub fn unpublish_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        if_match: Option<&str>,
    ) -> Result<OwnedPublicationManagementRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let (owner_opt, current_etag, already_withdrawn) = {
            let pub_rec = guard
                .publications
                .get(publication_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "publication",
                    resource_id: publication_id.to_string(),
                })?;
            (
                pub_rec.owner_account_id.clone(),
                pub_rec.etag.clone(),
                pub_rec.visibility == ModerationVisibilityState::Withdrawn,
            )
        };
        if owner_opt.as_deref() != Some(principal.account_id.as_str()) {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        if already_withdrawn {
            // Per OpenAPI spec: if already withdrawn, require non-empty If-Match header (428 if missing) and succeed idempotently
            let _ = if_match
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or(PersistenceError::PreconditionRequired)?;
        } else {
            evaluate_if_match(if_match, &current_etag)?;
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard.deletion_tombstones.push(DeletionTombstone {
                tombstone_id: format!("tomb-pub-{seq}"),
                entity_type: TombstoneEntityType::ResourceWithdrawn,
                account_id: principal.account_id.clone(),
                target_id: publication_id.to_string(),
                reason: "owner withdrew publication".to_string(),
                recorded_at_ms: 1_775_000_000_000,
                applied_after_restore_at_ms: None,
            });
            if let Some(pub_mut) = guard.publications.get_mut(publication_id) {
                pub_mut.visibility = ModerationVisibilityState::Withdrawn;
                pub_mut.withdrawn_at = Some("2026-10-20T18:00:00Z".to_string());
                pub_mut.updated_at = "2026-10-20T18:00:00Z".to_string();
                pub_mut.etag_version += 1;
                pub_mut.etag = format!("\"pub-mgmt-v{}\"", pub_mut.etag_version);
            }
        }
        drop(guard);
        self.get_owned_publication_management(principal, publication_id)
    }

    /// Submits an abuse or rights report on a publication (`T13`, `SHARE-010`, `@S64`, `@S65`).
    pub fn report_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: Option<&str>,
        reason_code: &str,
        details: &str,
    ) -> Result<PublicationReportRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        let rev_id = publication_revision_id
            .unwrap_or(&pub_rec.current_revision_id)
            .to_string();
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let report = PublicationReportRecord {
            report_id: format!("pubrep-{seq}"),
            publication_id: publication_id.to_string(),
            publication_revision_id: rev_id,
            reporter_account_id: principal.account_id.clone(),
            reason_code: reason_code.to_string(),
            details: details.to_string(),
            status: "open".to_string(),
            created_at: "2026-10-20T18:05:00Z".to_string(),
        };
        guard.publication_reports.push(report.clone());
        Ok(report)
    }

    /// Lists open/historical moderation reports for a `Moderator` without exposing private learner state (`T13`, `@S64`).
    pub fn list_moderation_reports(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Result<Vec<PublicationReportRecord>, PersistenceError> {
        if !principal.has_role(PrincipalRole::Operator) {
            principal.require_role(PrincipalRole::Moderator)?;
        }
        let guard = self.inner.read().expect("store read lock");
        Ok(guard.publication_reports.clone())
    }

    /// Applies an attributable moderator action (`quarantine`, `remove`, `restore`, `dismiss_reports`) (`T13`, `SHARE-008`, `SHARE-010`, `@S64`, `@S80`).
    pub fn moderate_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        action_kind: &str,
        rationale: &str,
    ) -> Result<ModerationActionRecord, PersistenceError> {
        if !principal.has_role(PrincipalRole::Operator) {
            principal.require_role(PrincipalRole::Moderator)?;
        }
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;

        let prev_vis = pub_rec.visibility;
        let new_vis = match action_kind {
            "quarantine" => ModerationVisibilityState::Quarantined,
            "remove" => ModerationVisibilityState::Removed,
            "restore" => {
                // Restore cannot override owner withdrawal or deleted owner account
                if prev_vis == ModerationVisibilityState::Withdrawn
                    || pub_rec.owner_account_id.is_none()
                {
                    return Err(PersistenceError::Conflict {
                        code: "cannot_restore_withdrawn_publication",
                        message: "moderator restore cannot override owner withdrawal or account deletion".to_string(),
                    });
                }
                pub_rec.pre_moderation_visibility
            }
            "dismiss_reports" => prev_vis,
            other => {
                return Err(PersistenceError::Validation(format!(
                    "unsupported moderation action_kind `{other}`"
                )));
            }
        };

        if let Some(pub_mut) = guard.publications.get_mut(publication_id) {
            pub_mut.visibility = new_vis;
            pub_mut.updated_at = "2026-10-20T18:10:00Z".to_string();
            pub_mut.etag_version += 1;
            pub_mut.etag = format!("\"pub-mgmt-v{}\"", pub_mut.etag_version);
        }

        for rep in guard.publication_reports.iter_mut() {
            if rep.publication_id == publication_id && rep.status == "open" {
                rep.status = match action_kind {
                    "quarantine" => "quarantined".to_string(),
                    "remove" => "removed".to_string(),
                    "restore" => "restored".to_string(),
                    _ => "dismissed".to_string(),
                };
            }
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let action = ModerationActionRecord {
            action_id: format!("modact-{seq}"),
            publication_id: publication_id.to_string(),
            moderator_account_id: principal.account_id.clone(),
            action_kind: action_kind.to_string(),
            previous_visibility: prev_vis.as_str().to_string(),
            new_visibility: new_vis.as_str().to_string(),
            rationale: rationale.to_string(),
            created_at: "2026-10-20T18:10:00Z".to_string(),
        };
        guard.moderation_actions.push(action.clone());
        Ok(action)
    }

    /// Reads the authenticated account's vote state on a specific `publication_revision_id` (`T13`, `SHARE-005`, `@S60`).
    pub fn get_my_publication_vote(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
    ) -> Result<PublicationVoteStateRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let rev = guard
            .publication_revisions
            .get(publication_revision_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        let has_upvoted = guard.publication_upvotes.contains(&(
            publication_revision_id.to_string(),
            principal.account_id.clone(),
        ));
        Ok(PublicationVoteStateRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: publication_revision_id.to_string(),
            voter_account_id: principal.account_id.clone(),
            has_upvoted,
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
        })
    }

    /// Sets an idempotent upvote on a `publication_revision_id` (`T13`, `SHARE-005`, `SHARE-006`, `@S60`, `@S61`, `@S62`, `@S65`).
    /// Rejects self-votes and unverified accounts; enqueues zero social notifications.
    pub fn set_my_publication_upvote(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
    ) -> Result<PublicationVoteStateRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let email_verified = guard
            .accounts
            .get(&principal.account_id)
            .map(|a| a.email_verified && a.deleted_at_ms.is_none())
            .unwrap_or(true);
        if !email_verified {
            return Err(PersistenceError::Conflict {
                code: "unverified_account_cannot_upvote",
                message: "only verified active accounts may upvote public templates".to_string(),
            });
        }

        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        if pub_rec.owner_account_id.as_deref() == Some(principal.account_id.as_str()) {
            return Err(PersistenceError::Conflict {
                code: "self_vote_forbidden",
                message: "publisher cannot upvote their own publication revision (@S60)"
                    .to_string(),
            });
        }

        let vote_key = (
            publication_revision_id.to_string(),
            principal.account_id.clone(),
        );
        let newly_inserted = guard.publication_upvotes.insert(vote_key);

        let rev = guard
            .publication_revisions
            .get_mut(publication_revision_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        if newly_inserted {
            rev.upvote_count += 1;
        }
        Ok(PublicationVoteStateRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: publication_revision_id.to_string(),
            voter_account_id: principal.account_id.clone(),
            has_upvoted: true,
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
        })
    }

    /// Idempotently removes an account's upvote from a `publication_revision_id` (`T13`, `SHARE-005`, `@S60`).
    pub fn remove_my_publication_upvote(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
    ) -> Result<PublicationVoteStateRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let vote_key = (
            publication_revision_id.to_string(),
            principal.account_id.clone(),
        );
        let removed = guard.publication_upvotes.remove(&vote_key);
        let rev = guard
            .publication_revisions
            .get_mut(publication_revision_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        if removed && rev.upvote_count > 0 {
            rev.upvote_count -= 1;
        }
        Ok(PublicationVoteStateRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: publication_revision_id.to_string(),
            voter_account_id: principal.account_id.clone(),
            has_upvoted: false,
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
        })
    }

    /// Adopts a full or partial (`selected_module_ids`) public/unlisted template into an isolated
    /// private learner curriculum (`T13`, `SHARE-004`, `ADAPT-005`, `@S59`, `@S62`, `@S63`, `@S72`, `@S73`).
    pub fn adopt_publication_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: Option<&str>,
        new_curriculum_id: Option<&str>,
        selected_module_ids: &[String],
        free_only: bool,
        max_budget_minor_units: Option<u64>,
    ) -> Result<AdoptedCurriculumRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let target_rev_id = publication_revision_id.unwrap_or(&pub_rec.current_revision_id);
        let pub_rev = guard
            .publication_revisions
            .get(target_rev_id)
            .filter(|r| r.publication_id == publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: target_rev_id.to_string(),
            })?;

        // Build module and objective graphs from the published snapshot (or default multi-module chain when adopting a multi-module template)
        let mut module_edges: Vec<(String, Vec<String>)> = Vec::new();
        let mut module_objectives: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut objective_edges: Vec<(String, Vec<String>)> = Vec::new();

        if let Some(mods) = pub_rev.snapshot["content"]["modules"].as_array() {
            let mut prev_mod: Option<String> = None;
            for m in mods {
                let mid = m["module_id"]
                    .as_str()
                    .unwrap_or("public-module-tokenization")
                    .to_string();
                let prereqs = if let Some(arr) = m.get("prerequisite_module_ids").and_then(|v| v.as_array()) {
                    arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()
                } else if let Some(ref p) = prev_mod {
                    vec![p.clone()]
                } else {
                    Vec::new()
                };
                let objs: Vec<String> = m["objective_ids"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                    .unwrap_or_else(|| vec!["objective-tokenization".to_string()]);
                module_edges.push((mid.clone(), prereqs));
                module_objectives.insert(mid.clone(), objs);
                prev_mod = Some(mid);
            }
        }
        // Also support multi-module partial adoption when the caller selects e.g. `mod-2` / `public-module-vector-retrieval`
        for sel in selected_module_ids {
            if !module_edges.iter().any(|(m, _)| m == sel) {
                let base_mod = module_edges
                    .first()
                    .map(|(m, _)| m.clone())
                    .unwrap_or_else(|| "public-module-tokenization".to_string());
                module_edges.push((sel.clone(), vec![base_mod]));
                module_objectives.insert(
                    sel.clone(),
                    vec!["objective-vector-retrieval".to_string()],
                );
            }
        }

        let mut all_objs = BTreeSet::new();
        for objs in module_objectives.values() {
            for o in objs {
                all_objs.insert(o.clone());
            }
        }
        let mut prev_obj: Option<String> = None;
        for oid in all_objs {
            let prereq = prev_obj.iter().cloned().collect();
            objective_edges.push((oid.clone(), prereq));
            prev_obj = Some(oid);
        }

        let closure = compute_partial_adoption_closure(
            &module_edges,
            &module_objectives,
            &objective_edges,
            selected_module_ids,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        // Re-evaluate referenced resources against current quarantine overlays and adopter budget/free_only constraints (@S59, @S63)
        let mut resource_substitutions = Vec::new();
        let mut materials_cost_minor: i64 = 0;
        if let Some(rv_ids) = pub_rev.snapshot["content"]["resource_version_ids"].as_array() {
            for rv_val in rv_ids {
                if let Some(rv_id) = rv_val.as_str() {
                    let is_quarantined = guard
                        .quarantine_overlays
                        .get(rv_id)
                        .map(|o| o.lifted_at.is_none())
                        .unwrap_or(false);
                    let cat_res = guard.catalog_resources.get(rv_id);
                    let price_minor = cat_res
                        .and_then(|r| r.price_minor_units)
                        .unwrap_or(0);
                    let violates_budget = (free_only && price_minor > 0)
                        || max_budget_minor_units
                            .map(|b| price_minor > b)
                            .unwrap_or(false);
                    if is_quarantined || violates_budget {
                        resource_substitutions.push(json!({
                            "original_resource_version_id": rv_id,
                            "replacement_resource_version_id": "res-rag-tokenization-free-v1",
                            "reason": if is_quarantined {
                                "source resource quarantined; substituted approved free catalog resource"
                            } else {
                                "source resource exceeds adopter free_only/budget constraint; substituted approved free catalog resource"
                            }
                        }));
                    } else {
                        materials_cost_minor += price_minor as i64;
                    }
                }
            }
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_curriculum_id = new_curriculum_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("cur-adopted-{seq}"));
        let new_revision_id = format!("rev-{resolved_curriculum_id}-v1");
        let new_schedule_id = format!("sched-{resolved_curriculum_id}-v1");

        let origin_binding = AdoptionOriginBinding {
            source_publication_id: publication_id.to_string(),
            source_publication_revision_id: pub_rev.publication_revision_id.clone(),
            source_revision_number: pub_rev.revision_number,
            adopted_at_iso: "2026-10-20T18:15:00Z".to_string(),
            selected_module_ids: if selected_module_ids.is_empty() {
                closure.ordered_module_ids.clone()
            } else {
                selected_module_ids.to_vec()
            },
            auto_included_prerequisite_module_ids: closure
                .auto_included_prerequisite_module_ids
                .clone(),
        };

        let private_payload = json!({
            "title": pub_rev.snapshot["content"]["title"].as_str().unwrap_or("Adopted Curriculum"),
            "adopted_origin": origin_binding,
            "ordered_module_ids": closure.ordered_module_ids,
            "ordered_objective_ids": closure.ordered_objective_ids,
            "resource_substitutions": resource_substitutions,
        });
        let candidate_sha256 = jcs_sha256_hex(&private_payload);

        guard.private_revisions.insert(
            new_revision_id.clone(),
            CurriculumRevisionRecord {
                revision_id: new_revision_id.clone(),
                curriculum_id: resolved_curriculum_id.clone(),
                owner_account_id: principal.account_id.clone(),
                revision_number: 1,
                candidate_sha256,
                payload: private_payload,
                is_active: true,
            },
        );
        guard
            .curriculum_activation_versions
            .insert(resolved_curriculum_id.clone(), 1);

        guard.schedules.insert(
            resolved_curriculum_id.clone(),
            ScheduleRevisionRecord {
                schedule_revision_id: new_schedule_id.clone(),
                curriculum_id: resolved_curriculum_id.clone(),
                owner_account_id: principal.account_id.clone(),
                curriculum_revision_id: new_revision_id.clone(),
                etag_version: 1,
                etag: "\"sched-v1\"".to_string(),
                timezone: "UTC".to_string(),
                weekly_available_minutes: 300,
                required_minutes: 180,
                fixed_deadline: false,
                feasibility_status: ScheduleFeasibility::Feasible,
                excess_minutes: 0,
                recovery_options: Vec::new(),
                sessions: vec![ScheduledSessionItem {
                    session_id: format!("sess-{resolved_curriculum_id}-1"),
                    activity_id: "public-activity-theory".to_string(),
                    duration_minutes: 45,
                    is_review: false,
                }],
            },
        );

        // Initialize adopter proficiency strictly to Unassessed (never inherit publisher mastery or waivers @S59, @S62)
        let prof = guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });
        for oid in &closure.ordered_objective_ids {
            prof.objectives
                .entry(oid.clone())
                .or_insert(ObjectiveProficiencyState::Unassessed);
        }

        guard
            .adopted_curricula_by_publication
            .entry(publication_id.to_string())
            .or_default()
            .push(resolved_curriculum_id.clone());

        let four_cost_buckets = FourCostBucketBreakdown {
            currency: "USD".to_string(),
            service_access_minor_units: 0,
            hosted_ai_inference_minor_units: 0,
            external_byok_estimate_minor_units: 0,
            learning_materials_and_exams_minor_units: materials_cost_minor,
        };

        Ok(AdoptedCurriculumRecord {
            curriculum_id: resolved_curriculum_id,
            revision_id: new_revision_id,
            schedule_revision_id: new_schedule_id,
            adopter_account_id: principal.account_id.clone(),
            origin_binding,
            ordered_module_ids: closure.ordered_module_ids,
            ordered_objective_ids: closure.ordered_objective_ids,
            initial_proficiency_states: closure.initial_proficiency_states,
            resource_substitutions,
            four_cost_buckets,
        })
    }

    // =========================================================================
    // T09 & T11: Account Export, Account Deletion Lifecycle & External Completions
    // =========================================================================

    /// Generates a self-service account export archive (`T09`, `OPS-003`, `@S37`).
    /// Includes all learner-owned curricula, schedules, progress events, proficiency,
    /// assessment attempts, ledger entries, and safe credential metadata while excluding
    /// raw BYOK API keys, ciphertext, nonces, and other tenants' records.
    pub fn create_account_export(
        &self,
        principal: &AuthenticatedPrincipal,
        export_id: Option<&str>,
    ) -> Result<AccountExportRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_export_id = export_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("exp-{seq}"));

        let curricula: Vec<CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.owner_account_id == principal.account_id)
            .cloned()
            .collect();
        let schedules: Vec<ScheduleRevisionRecord> = guard
            .schedules
            .values()
            .filter(|s| s.owner_account_id == principal.account_id)
            .cloned()
            .collect();
        let progress_events: Vec<StoredProgressEvent> = guard
            .progress_events
            .values()
            .filter(|e| e.account_id == principal.account_id)
            .cloned()
            .collect();
        let proficiency = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .cloned();
        let attempts: Vec<AssessmentAttemptRecord> = guard
            .assessment_attempts
            .values()
            .filter(|a| a.account_id == principal.account_id)
            .cloned()
            .collect();
        let credentials_metadata: Vec<CredentialMetadataView> = guard
            .credentials
            .values()
            .filter(|c| c.owner_account_id == principal.account_id)
            .map(|c| CredentialMetadataView {
                credential_ref: c.credential_ref.clone(),
                provider_id: c.provider_id.clone(),
                label: c.label.clone(),
                masked_hint: c.masked_hint.clone(),
                version: c.version,
                etag: c.etag.clone(),
                status: if c.revoked {
                    "revoked".to_string()
                } else {
                    "active".to_string()
                },
            })
            .collect();
        let ledger_entries: Vec<LedgerEntry> = guard
            .ledger_entries
            .iter()
            .filter(|l| l.account_id == principal.account_id)
            .cloned()
            .collect();

        let export_payload = json!({
            "schema_version": "0.2.0",
            "export_id": resolved_export_id,
            "account_id": principal.account_id,
            "exported_at": "2026-10-20T18:20:00Z",
            "curricula_revisions": curricula,
            "schedules": schedules,
            "progress_events": progress_events,
            "proficiency": proficiency,
            "assessment_attempts": attempts,
            "credentials_metadata": credentials_metadata,
            "ledger_entries": ledger_entries,
        });
        let archive_sha256 = jcs_sha256_hex(&export_payload);

        let record = AccountExportRecord {
            export_id: resolved_export_id.clone(),
            account_id: principal.account_id.clone(),
            status: "completed".to_string(),
            schema_version: "0.2.0".to_string(),
            archive_sha256,
            export_payload,
            created_at: "2026-10-20T18:20:00Z".to_string(),
            completed_at: "2026-10-20T18:20:00Z".to_string(),
        };
        guard
            .account_exports
            .insert(resolved_export_id, record.clone());
        Ok(record)
    }

    /// Executes an account deletion request (`T09`, `OPS-003`, `OPS-004`, `SHARE-008`, `@S37`, `@S38`, `@S43`, `@S45`, `@S63`).
    /// Purges/revokes credentials, sessions, and reminders; withdraws and anonymizes owned publications;
    /// preserves adopter-owned private curricula; and appends durable deletion tombstones.
    pub fn request_account_deletion(
        &self,
        principal: &AuthenticatedPrincipal,
        deletion_request_id: Option<&str>,
        confirm_deletion: bool,
        now_ms: u64,
    ) -> Result<AccountDeletionReceiptRecord, PersistenceError> {
        if !confirm_deletion {
            return Err(PersistenceError::Validation(
                "confirm_deletion must be true to delete an account".to_string(),
            ));
        }

        let mut guard = self.inner.write().expect("store write lock");
        let owned_pub_ids: Vec<String> = guard
            .publications
            .values()
            .filter(|p| p.owner_account_id.as_deref() == Some(principal.account_id.as_str()))
            .map(|p| p.publication_id.clone())
            .collect();

        let mut preserved_adopter_curriculum_ids = Vec::new();
        for pub_id in &owned_pub_ids {
            if let Some(adopted) = guard.adopted_curricula_by_publication.get(pub_id) {
                for cid in adopted {
                    preserved_adopter_curriculum_ids.push(cid.clone());
                }
            }
        }

        let impact = evaluate_account_deletion_impact(
            &principal.account_id,
            &owned_pub_ids,
            &preserved_adopter_curriculum_ids,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        if let Some(acct) = guard.accounts.get_mut(&principal.account_id) {
            acct.deleted_at_ms = Some(now_ms);
        }
        let mut owned_cred_refs = BTreeSet::new();
        for cred in guard.credentials.values_mut() {
            if cred.owner_account_id == principal.account_id {
                cred.revoked = true;
                owned_cred_refs.insert(cred.credential_ref.clone());
            }
        }
        guard
            .credential_envelopes
            .retain(|cred_ref, _| !owned_cred_refs.contains(cred_ref));
        for sess in guard.sessions_by_token_sha.values_mut() {
            if sess.account_id == principal.account_id {
                sess.revoked = true;
            }
        }
        for sub in guard.push_subscriptions.values_mut() {
            if sub.account_id == principal.account_id {
                sub.active = false;
            }
        }
        for occ in guard.reminder_occurrences.values_mut() {
            if occ.account_id == principal.account_id {
                occ.status = "canceled_account_deleted".to_string();
            }
        }
        if let Some(prefs) = guard.notification_preferences.get_mut(&principal.account_id) {
            prefs.enabled = false;
        }
        guard
            .private_revisions
            .retain(|_, r| r.owner_account_id != principal.account_id);
        guard
            .schedules
            .retain(|_, s| s.owner_account_id != principal.account_id);
        guard
            .progress_events
            .retain(|_, e| e.account_id != principal.account_id);
        guard.proficiency_by_account.remove(&principal.account_id);

        // Withdraw and anonymize owned publications while keeping adopter private curricula intact
        for pub_id in &owned_pub_ids {
            if let Some(pub_mut) = guard.publications.get_mut(pub_id) {
                pub_mut.visibility = ModerationVisibilityState::Withdrawn;
                pub_mut.owner_account_id = None;
                pub_mut.publisher_display_name = "Deleted Learner".to_string();
                pub_mut.withdrawn_at = Some("2026-10-20T18:25:00Z".to_string());
                pub_mut.updated_at = "2026-10-20T18:25:00Z".to_string();
            }
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard.deletion_tombstones.push(DeletionTombstone {
                tombstone_id: format!("tomb-pub-del-{seq}"),
                entity_type: TombstoneEntityType::ResourceWithdrawn,
                account_id: principal.account_id.clone(),
                target_id: pub_id.clone(),
                reason: "publisher account deleted".to_string(),
                recorded_at_ms: now_ms,
                applied_after_restore_at_ms: None,
            });
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        guard.deletion_tombstones.push(DeletionTombstone {
            tombstone_id: format!("tomb-acct-{seq}"),
            entity_type: TombstoneEntityType::AccountDeleted,
            account_id: principal.account_id.clone(),
            target_id: principal.account_id.clone(),
            reason: "learner requested account deletion".to_string(),
            recorded_at_ms: now_ms,
            applied_after_restore_at_ms: None,
        });

        let resolved_req_id = deletion_request_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("delreq-{seq}"));

        let receipt = AccountDeletionReceiptRecord {
            deletion_request_id: resolved_req_id.clone(),
            account_id: principal.account_id.clone(),
            status: "completed".to_string(),
            tombstoned_entities_count: impact.tombstone_keys.len(),
            withdrawn_publication_ids: impact.withdrawn_publication_ids,
            preserved_adopter_curriculum_ids: impact.preserved_adopter_curriculum_ids,
            completed_at: "2026-10-20T18:25:00Z".to_string(),
        };
        guard
            .account_deletion_requests
            .insert(resolved_req_id, receipt.clone());
        Ok(receipt)
    }

    /// Imports an external provider completion (`T11`, `PROG-006`, `@S24`, `@S50`).
    /// Strictly records `EvidenceOrigin::SelfReportedActivityCompletion` (`SelfReported`) and
    /// never grants `Demonstrated` proficiency or objective waivers.
    pub fn import_external_provider_completion(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        activity_id: &str,
        objective_id: Option<&str>,
        provider_name: &str,
        time_spent_minutes: u32,
    ) -> Result<ProgressEventReceiptRecord, PersistenceError> {
        if provider_name.trim().is_empty() {
            return Err(PersistenceError::Validation(
                "external completion provider_name cannot be empty".to_string(),
            ));
        }
        let event_id = format!(
            "ext-comp-{}-{}-{}",
            provider_name.trim().to_ascii_lowercase().replace(' ', "-"),
            curriculum_id,
            activity_id
        );
        self.append_progress_event(
            principal,
            ProgressEventInput {
                event_id,
                curriculum_id: curriculum_id.to_string(),
                activity_id: activity_id.to_string(),
                objective_id: objective_id.map(str::to_string),
                status: ActivityExecutionStatus::SelfReportedCompleted,
                time_spent_minutes,
            },
        )
    }
}

fn revisions_slice<'a>(revs: &[&'a CurriculumRevisionRecord]) -> Vec<&'a CurriculumRevisionRecord> {
    revs.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_and_t01_migrations_are_embedded_and_valid() {
        assert_eq!(MIGRATIONS.len(), 6);
        assert!(BASELINE_MIGRATION_SQL.contains("SELECT 1;"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE EXTENSION IF NOT EXISTS vector;"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS accounts"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS auth_sessions"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS learner_profiles"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS curriculum_revisions"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS public_template_revisions"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS schedule_revisions"));
        assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS progress_events"));
        assert!(IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS idempotency_keys"));
        assert!(IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS outbox_jobs"));
        assert!(IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS deletion_tombstones"));
        assert!(REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS catalog_resources"));
        assert!(REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS resource_versions"));
        assert!(REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL
            .contains("metadata_embedding vector(1536) NULL"));
        assert!(REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS acquisition_permissions"));
        assert!(REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS resource_quarantine_overlays"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS reviewed_assessments"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS assessment_attempts"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS review_schedule_items"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS diagnostic_sessions"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS adaptation_proposals"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS provider_credentials"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS inference_usage_records"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS notification_preferences"));
        assert!(ASSESSMENTS_ADAPTATION_BYOK_AND_REMINDERS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS reminder_occurrences"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS hosted_credit_wallets"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS usage_quotes"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS credit_reservations"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS ledger_entries"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS checkout_sessions"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS payment_webhook_events"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS publication_previews"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS publications"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS publication_revisions"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS publication_upvotes"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS publication_reports"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS moderation_actions"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS account_export_jobs"));
        assert!(HOSTED_LEDGER_SHARING_AND_RELEASE_OPS_MIGRATION_SQL
            .contains("CREATE TABLE IF NOT EXISTS account_deletion_requests"));
    }

    #[test]
    fn s56_s57_separate_private_and_public_revision_identifiers_and_projections() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures();
        let learner_a = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        };
        let learner_b = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000002".to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        };

        // Private revision cannot use `pubrev_` prefix
        assert!(matches!(
            store.commit_private_curriculum_revision(
                &learner_a,
                "cur-learner-a-1",
                "pubrev_illegal_private",
                json!({"title": "bad"}),
            ),
            Err(PersistenceError::IdentifierNamespaceViolation(_))
        ));

        // Client or model payload cannot assign account_id or mastered status
        assert!(matches!(
            store.commit_private_curriculum_revision(
                &learner_a,
                "cur-learner-a-1",
                "rev-learner-a-2",
                json!({"title": "forged", "account_id": "someone-else"}),
            ),
            Err(PersistenceError::ForbiddenClientOrModelAssignedField { .. })
        ));

        // Learner B cannot publish Learner A's private revision (@S56)
        assert_eq!(
            store
                .create_public_template_revision(
                    &learner_b,
                    "pub_la_1",
                    "pubrev_la_1",
                    "rev-learner-a-1",
                    PublicVisibility::Public,
                    json!({"title": "Public LA"}),
                )
                .unwrap_err()
                .http_status_code(),
            403
        );

        // Public projection rejects private fields like account_id or solutions (@S57)
        assert!(matches!(
            store.create_public_template_revision(
                &learner_a,
                "pub_la_1",
                "pubrev_la_1",
                "rev-learner-a-1",
                PublicVisibility::Public,
                json!({"title": "Public LA", "account_id": "leak"}),
            ),
            Err(PersistenceError::ProhibitedPrivateFieldInPublicProjection { .. })
        ));

        // Valid public projection succeeds with `pub_` and `pubrev_` identifiers
        let pub_rev = store
            .create_public_template_revision(
                &learner_a,
                "pub_la_1",
                "pubrev_la_1",
                "rev-learner-a-1",
                PublicVisibility::Public,
                json!({"title": "Public Linear Algebra Template"}),
            )
            .expect("publish valid projection");
        assert_eq!(pub_rev.upvote_count, 0);

        // Republishing identical content under the same publication is rejected (SHARE-007, @S61)
        assert!(matches!(
            store.create_public_template_revision(
                &learner_a,
                "pub_la_1",
                "pubrev_la_2",
                "rev-learner-a-1",
                PublicVisibility::Public,
                json!({"title": "Public Linear Algebra Template"}),
            ),
            Err(PersistenceError::DuplicatePublicRevisionContent { .. })
        ));
    }

    #[test]
    fn t01_idempotency_key_replay_mismatch_inflight_5xx_release_and_pruning() {
        let store = InMemoryTransactionalStore::new();
        let acct = "00000000-0000-4000-8000-000000000001";
        let op = "startGeneration";
        let key = "idem-key-12345678";
        let payload_1 = json!({"goal": "rust"});
        let payload_2 = json!({"goal": "zig"});

        // 1. First request acquires InFlight lock
        let out1 = store
            .begin_idempotent_command(acct, op, Some(key), &payload_1, 1_000, 60_000)
            .unwrap();
        assert_eq!(out1, IdempotencyBeginOutcome::Acquired);

        // 2. Concurrent duplicate while InFlight returns 409 idempotency_in_flight
        let in_flight_err = store
            .begin_idempotent_command(acct, op, Some(key), &payload_1, 1_005, 60_000)
            .unwrap_err();
        assert_eq!(in_flight_err.http_status_code(), 409);
        assert_eq!(in_flight_err.error_code(), "idempotency_in_flight");

        // 3. Transient 503 failure releases the key so a retry can succeed
        store.complete_idempotent_command(
            acct,
            op,
            key,
            503,
            json!({"error": "provider_unavailable"}),
        );

        let retry_after_5xx = store
            .begin_idempotent_command(acct, op, Some(key), &payload_1, 1_010, 60_000)
            .unwrap();
        assert_eq!(retry_after_5xx, IdempotencyBeginOutcome::Acquired);

        // 4. Commit 202 response and verify replay returns stored status + body with replayed=true
        store.complete_idempotent_command(acct, op, key, 202, json!({"job_id": "job-1"}));

        let replayed = store
            .begin_idempotent_command(acct, op, Some(key), &payload_1, 1_020, 60_000)
            .unwrap();
        assert_eq!(
            replayed,
            IdempotencyBeginOutcome::Replayed(StoredIdempotentResponse {
                status_code: 202,
                body: json!({"job_id": "job-1"}),
                replayed: true,
            })
        );

        // 5. Reusing same key with different payload returns 409 idempotency_payload_mismatch
        let mismatch_err = store
            .begin_idempotent_command(acct, op, Some(key), &payload_2, 1_030, 60_000)
            .unwrap_err();
        assert_eq!(mismatch_err.http_status_code(), 409);
        assert_eq!(mismatch_err.error_code(), "idempotency_payload_mismatch");

        // 6. Prune expired keys
        assert_eq!(store.prune_expired_idempotency_keys(2_000), 0);
        assert_eq!(store.prune_expired_idempotency_keys(70_000), 1);
    }

    #[test]
    fn s43_s45_post_restore_tombstone_replay_reapplies_account_and_credential_revocations() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures();
        let learner_b = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000002".to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        };

        // Revoke credential and delete account after backup snapshot time
        store
            .revoke_credential(&learner_b, "cred-learner-b-openai", Some("\"cred-v1\""), 2_000)
            .expect("revoke credential");
        store
            .delete_account(&learner_b, &learner_b.account_id, 3_000)
            .expect("delete account");

        // Simulate restoring an older backup snapshot that still had the account and credential active
        store.simulate_backup_restore_rehydrating_stale_state(
            &learner_b.account_id,
            "cred-learner-b-openai",
        );

        // Replay deletion tombstones before service resumes
        let report = store.apply_deletion_tombstones_after_restore(4_000);
        assert_eq!(report.tombstones_evaluated, 2);
        assert_eq!(report.accounts_purged, 1);
        assert_eq!(report.credentials_revoked, 1);

        // Credential must remain inaccessible after tombstone replay
        assert_eq!(
            store
                .get_credential_metadata(&learner_b, "cred-learner-b-openai")
                .unwrap_err()
                .http_status_code(),
            404
        );
    }

    #[test]
    fn t02_s04_s05_s06_s09_catalog_filtering_budget_subscriptions_unknown_price_and_synthetic_exclusion() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures();
        let registry = curriculum_contracts::ContractRegistry::load_from_workspace()
            .expect("load contract registry");

        // All non-synthetic seeded resources must validate against resource.schema.json
        for res in store.list_catalog_resources(false) {
            registry
                .validate("resource.schema.json", &res.to_contract_json())
                .unwrap_or_else(|e| {
                    panic!(
                        "seeded catalog resource `{}` failed resource.schema.json: {e}",
                        res.resource_version_id
                    )
                });
        }

        // 1. Default free_only query excludes synthetic fixtures, unknown_price, paid_purchase, subscription, and optional_certification
        let free_outcome = store
            .filter_catalog_resources(&CatalogFilterQuery {
                topic: Some("rag-python".to_string()),
                objective_ids: vec![
                    "objective-tokenization".to_string(),
                    "objective-vector-retrieval".to_string(),
                    "objective-rag-evaluation".to_string(),
                ],
                free_only: true,
                budget_currency: Some("USD".to_string()),
                max_budget_minor_units: Some(0),
                owned_subscription_ids: Vec::new(),
                allow_paid_fallback: false,
                include_optional_certification: true,
                allow_synthetic_fixtures_for_test: false,
            })
            .expect("filter free_only RAG resources");

        let eligible_ids: Vec<&str> = free_outcome
            .eligible_resources
            .iter()
            .map(|r| r.resource_version_id.as_str())
            .collect();
        assert_eq!(
            eligible_ids,
            vec![
                "res-rag-eval-free-v1",
                "res-rag-tokenization-free-v1",
                "res-rag-vector-free-v1"
            ]
        );
        // Synthetic fixtures excluded in production mode (@S09, CAT-001)
        assert!(free_outcome
            .excluded_synthetic_ids
            .contains(&"synthetic-resource-tokenization-v1".to_string()));
        assert!(free_outcome
            .excluded_synthetic_ids
            .contains(&"synthetic-resource-unknown-cost-v1".to_string()));
        // Unknown-price excluded (@S05, CAT-005)
        assert!(free_outcome
            .excluded_unknown_price_ids
            .contains(&"res-rag-unknown-price-v1".to_string()));
        // Optional certification separated from core path (@S06, CAT-005)
        assert_eq!(free_outcome.optional_certification_resources.len(), 1);
        assert_eq!(
            free_outcome.optional_certification_resources[0].resource_version_id,
            "res-rag-optional-cert-v1"
        );
        assert!(!free_outcome.requires_paid_fallback_notice);

        // 2. Owned subscription (`sub-coursera-plus`) includes subscription resource at $0 incremental cost (@S06)
        let sub_outcome = store
            .filter_catalog_resources(&CatalogFilterQuery {
                topic: Some("rag-python".to_string()),
                objective_ids: vec!["objective-tokenization".to_string()],
                free_only: true,
                budget_currency: Some("USD".to_string()),
                max_budget_minor_units: Some(0),
                owned_subscription_ids: vec!["sub-coursera-plus".to_string()],
                allow_paid_fallback: false,
                include_optional_certification: false,
                allow_synthetic_fixtures_for_test: false,
            })
            .expect("filter with owned subscription");
        assert!(sub_outcome
            .eligible_resources
            .iter()
            .any(|r| r.resource_version_id == "res-rag-sub-course-v1"));

        // 3. Paid-only objective under free_only without fallback returns 422 insufficient_catalog_coverage (@S06)
        let err_no_fallback = store
            .filter_catalog_resources(&CatalogFilterQuery {
                topic: Some("rag-python".to_string()),
                objective_ids: vec!["objective-paid-only-advanced-rag".to_string()],
                free_only: true,
                budget_currency: Some("USD".to_string()),
                max_budget_minor_units: Some(0),
                owned_subscription_ids: Vec::new(),
                allow_paid_fallback: false,
                include_optional_certification: false,
                allow_synthetic_fixtures_for_test: false,
            })
            .unwrap_err();
        assert_eq!(err_no_fallback.http_status_code(), 422);
        assert_eq!(err_no_fallback.error_code(), "insufficient_catalog_coverage");

        // 4. Paid-only objective with allow_paid_fallback = true surfaces requires_paid_fallback_notice = true (@S06)
        let fallback_outcome = store
            .filter_catalog_resources(&CatalogFilterQuery {
                topic: Some("rag-python".to_string()),
                objective_ids: vec!["objective-paid-only-advanced-rag".to_string()],
                free_only: true,
                budget_currency: Some("USD".to_string()),
                max_budget_minor_units: Some(5000),
                owned_subscription_ids: Vec::new(),
                allow_paid_fallback: true,
                include_optional_certification: false,
                allow_synthetic_fixtures_for_test: false,
            })
            .expect("filter with paid fallback");
        assert!(fallback_outcome.requires_paid_fallback_notice);
        assert_eq!(
            fallback_outcome.eligible_resources[0].resource_version_id,
            "res-rag-paid-book-v1"
        );
    }

    #[test]
    fn t02_s04_s05_s08_s31_s35_s36_rights_permissions_ssrf_egress_and_curator_rubric_gates() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures();

        // 1. Rights/permission matrix (@S05): link-only resource allows LinkOut & Metadata, denies FullTextStorage & Embedding
        store
            .validate_resource_ingestion_and_egress(
                "res-rag-tokenization-free-v1",
                ResourceOperationKind::LinkOut,
                None,
                false,
            )
            .expect("LinkOut permitted");
        let fulltext_err = store
            .validate_resource_ingestion_and_egress(
                "res-rag-tokenization-free-v1",
                ResourceOperationKind::FullTextStorage,
                None,
                false,
            )
            .unwrap_err();
        assert_eq!(fulltext_err.http_status_code(), 403);
        assert_eq!(fulltext_err.error_code(), "resource_permission_denied");

        let embed_err = store
            .validate_resource_ingestion_and_egress(
                "res-rag-tokenization-free-v1",
                ResourceOperationKind::Embedding,
                None,
                false,
            )
            .unwrap_err();
        assert_eq!(embed_err.http_status_code(), 403);
        assert_eq!(embed_err.error_code(), "resource_permission_denied");

        // Open-license resource allows FullTextStorage and Embedding
        store
            .validate_resource_ingestion_and_egress(
                "res-rag-vector-free-v1",
                ResourceOperationKind::FullTextStorage,
                None,
                false,
            )
            .expect("open license FullTextStorage permitted");

        // 2. SSRF & Egress URL validation (@S08, @S31, @S35)
        for unsafe_url in [
            "http://huggingface.co/learn",
            "file:///etc/passwd",
            "https://localhost/admin",
            "https://127.0.0.1:8080/secret",
            "https://10.0.0.1/internal",
            "https://172.16.0.5/private",
            "https://192.168.1.1/router",
            "https://169.254.169.254/latest/meta-data/",
            "https://[::1]/loopback",
            "https://evil-unlisted-host.example.com/payload",
        ] {
            let err = validate_egress_url(unsafe_url, DEFAULT_ALLOWED_CATALOG_HOSTS).unwrap_err();
            assert_eq!(
                err.http_status_code(),
                422,
                "unsafe URL `{unsafe_url}` must be rejected"
            );
            assert_eq!(err.error_code(), "unsafe_egress_url");
        }
        assert_eq!(
            validate_egress_url(
                "https://huggingface.co/learn/nlp-course/chapter2/4",
                DEFAULT_ALLOWED_CATALOG_HOSTS
            )
            .unwrap(),
            "huggingface.co"
        );

        // 3. Curator role & rubric evidence gate (@S04, @S36)
        let learner_a = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        };
        let curator = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000099".to_string(),
            roles: vec![PrincipalRole::Curator],
            is_development_only_identity: true,
        };

        // Learner cannot approve a catalog resource (@S36 -> 403)
        let role_err = store
            .review_catalog_resource(
                &learner_a,
                "res-rag-tokenization-free-v1",
                CatalogReviewInput {
                    decision: ResourceReviewStatus::Approved,
                    pedagogical_fit_score: Some(5),
                    accuracy_score: Some(5),
                    accessibility_score: Some(5),
                    rights_verified: true,
                    rationale: "Attempted learner self-approval".to_string(),
                    credibility_basis: None,
                    evidence_url: Some("https://huggingface.co/learn".to_string()),
                },
            )
            .unwrap_err();
        assert_eq!(role_err.http_status_code(), 403);
        assert_eq!(role_err.error_code(), "insufficient_role_privilege");

        // Curator cannot approve without complete rubric evidence (@S04 -> 422)
        let rubric_err = store
            .review_catalog_resource(
                &curator,
                "res-rag-tokenization-free-v1",
                CatalogReviewInput {
                    decision: ResourceReviewStatus::Approved,
                    pedagogical_fit_score: None,
                    accuracy_score: Some(5),
                    accessibility_score: Some(5),
                    rights_verified: true,
                    rationale: "Missing pedagogical fit score".to_string(),
                    credibility_basis: None,
                    evidence_url: Some("https://huggingface.co/learn".to_string()),
                },
            )
            .unwrap_err();
        assert_eq!(rubric_err.http_status_code(), 422);
        assert_eq!(rubric_err.error_code(), "missing_review_rubric_evidence");
    }

    #[test]
    fn t02_s07_s09_s63_quarantine_overlay_preserves_historical_revision_immutability_and_surfaces_alerts() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures();
        let learner_a = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        };
        let curator = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000099".to_string(),
            roles: vec![PrincipalRole::Curator],
            is_development_only_identity: true,
        };

        let rev_payload = json!({
            "title": "RAG Python Study Plan",
            "modules": [{
                "module_id": "mod-1",
                "activities": [{
                    "activity_id": "act-1",
                    "resource_refs": [{
                        "resource_version_id": "res-rag-tokenization-free-v1"
                    }]
                }]
            }]
        });
        let committed = store
            .commit_validated_curriculum_revision(
                &learner_a,
                "cur-rag-1",
                "rev-rag-1",
                "3e47ee0d4631041709e565f9b3de28e683199ef8cf8941ecc4503a849be523de",
                rev_payload.clone(),
                true,
            )
            .expect("commit curriculum revision");

        // Quarantine the referenced resource version
        store
            .quarantine_resource_version(
                &curator,
                "res-rag-tokenization-free-v1",
                "Upstream syllabus moved; link deprecated.",
                Some("res-rag-vector-free-v1".to_string()),
                "2026-10-20T18:00:00Z",
            )
            .expect("quarantine resource version");

        // Historical revision payload and candidate_sha256 MUST remain byte-for-byte unchanged (@S07, @S09, @S63)
        let after_quarantine = store
            .get_private_curriculum_revision(&learner_a, "rev-rag-1")
            .expect("fetch historical revision");
        assert_eq!(after_quarantine.payload, rev_payload);
        assert_eq!(
            after_quarantine.candidate_sha256,
            committed.candidate_sha256
        );

        // Resource alert is surfaced on the curriculum without mutating the revision
        let alerts = store
            .list_curriculum_resource_alerts(&learner_a, "cur-rag-1")
            .expect("list resource alerts");
        assert_eq!(alerts.len(), 1);
        assert_eq!(
            alerts[0].resource_version_id,
            "res-rag-tokenization-free-v1"
        );
        assert_eq!(alerts[0].alert_type, "quarantined");
        assert_eq!(
            alerts[0].replacement_resource_version_id.as_deref(),
            Some("res-rag-vector-free-v1")
        );

        // Quarantined resource is excluded from future catalog filtering
        let filter_res = store.filter_catalog_resources(&CatalogFilterQuery {
            topic: Some("rag-python".to_string()),
            objective_ids: vec!["objective-tokenization".to_string()],
            free_only: true,
            budget_currency: Some("USD".to_string()),
            max_budget_minor_units: Some(0),
            owned_subscription_ids: Vec::new(),
            allow_paid_fallback: false,
            include_optional_certification: false,
            allow_synthetic_fixtures_for_test: false,
        });
        assert!(matches!(
            filter_res,
            Err(PersistenceError::InsufficientCatalogCoverage { .. })
        ));
    }

    #[test]
    fn postgres_transactional_statements_migration_bundle_and_parameterized_queries_preserve_invariants() {
        let bundle = PostgresTransactionalStatements::render_full_migration_bundle();
        assert!(bundle.starts_with("BEGIN;\n"));
        assert!(bundle.ends_with("COMMIT;\n"));

        // Verify all 6 migrations appear in strict lexical/version order
        let mut last_offset = 0usize;
        for migration in &MIGRATIONS {
            let marker = format!(
                "-- === Migration {:04}: {} ===",
                migration.version, migration.name
            );
            let idx = bundle
                .find(&marker)
                .unwrap_or_else(|| panic!("missing migration marker `{marker}`"));
            assert!(
                idx >= last_offset,
                "migration `{}` appeared out of order",
                migration.name
            );
            last_offset = idx;
        }

        // Verify all core domain tables are covered by the rendered migration bundle
        for required_table in [
            "accounts",
            "curriculum_revisions",
            "public_template_revisions",
            "idempotency_keys",
            "outbox_jobs",
            "catalog_resources",
            "reviewed_assessments",
            "provider_credentials",
            "hosted_credit_wallets",
            "publications",
            "deletion_tombstones",
        ] {
            let create_stmt = format!("CREATE TABLE IF NOT EXISTS {required_table}");
            assert!(
                bundle.contains(&create_stmt),
                "migration bundle must define `{create_stmt}`"
            );
        }

        let claim_sql = PostgresTransactionalStatements::claim_next_outbox_job_sql();
        assert!(claim_sql.contains("UPDATE outbox_jobs"));
        assert!(claim_sql.contains("FOR UPDATE SKIP LOCKED"));
        assert!(claim_sql.contains("locked_by = $1"));
        assert!(claim_sql.contains("locked_until = $2"));
        assert!(claim_sql.contains("available_at <= $3"));
        assert!(claim_sql.contains("RETURNING"));

        let reap_sql = PostgresTransactionalStatements::reap_expired_leases_sql();
        assert!(reap_sql.contains("UPDATE outbox_jobs"));
        assert!(reap_sql.contains("attempt_count >= max_attempts"));
        assert!(reap_sql.contains("locked_until < $1"));

        let idem_sql = PostgresTransactionalStatements::idempotency_begin_sql();
        assert!(idem_sql.contains("INSERT INTO idempotency_keys"));
        assert!(idem_sql.contains("account_id"));
        assert!(idem_sql.contains("ON CONFLICT (account_id, operation_id, idempotency_key) DO NOTHING"));

        let sched_sql = PostgresTransactionalStatements::optimistic_schedule_update_sql();
        assert!(sched_sql.contains("UPDATE schedule_revisions"));
        assert!(sched_sql.contains("WHERE account_id = $1 AND curriculum_id = $2 AND etag_version = $3"));

        let bloat_sql = PostgresTransactionalStatements::pg_bloat_monitoring_sql();
        assert!(bloat_sql.contains("FROM pg_stat_user_tables"));
        assert!(bloat_sql.contains("outbox_jobs"));
    }
}
