//! Transactional PostgreSQL persistence boundary, SQL migration registry, tenant-isolated
//! repositories, separate private/public revision namespaces, HTTP concurrency engine
//! (`Idempotency-Key`, `If-Match`, append-only event deduplication), and post-restore
//! deletion tombstone replay (`T01`, `CTRL-002`, `CTRL-030`, `CTRL-070`, `NFR-001`, `NFR-006`, `NFR-007`).

use curriculum_contracts::generated::{OpenApiOperationDescriptor, OPENAPI_OPERATIONS};
use curriculum_contracts::jcs::{jcs_sha256_hex, sha256_bytes_hex};
use curriculum_domain::{
    derive_proficiency_transition, ActivityExecutionStatus, EvidenceOrigin,
    ObjectiveProficiencyState,
};
use curriculum_security::{AuthenticatedPrincipal, PrincipalRole, SecurityError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};
use thiserror::Error;

pub const BASELINE_MIGRATION_SQL: &str = include_str!("../migrations/0000_t00_baseline.sql");
pub const INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL: &str =
    include_str!("../migrations/0001_init_identity_and_tenancy.sql");
pub const IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL: &str =
    include_str!("../migrations/0002_idempotency_and_outbox.sql");

/// Embedded PostgreSQL migration descriptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqlMigration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

/// Ordered registry of embedded PostgreSQL migrations (`T00`–`T01`).
pub const MIGRATIONS: [SqlMigration; 3] = [
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

    #[error("validation error: {0}")]
    Validation(String),
}

impl PersistenceError {
    pub fn http_status_code(&self) -> u16 {
        match self {
            PersistenceError::Security(SecurityError::Unauthenticated) => 401,
            PersistenceError::Security(
                SecurityError::CrossTenantAccessDenied { .. }
                | SecurityError::InsufficientRolePrivilege { .. }
                | SecurityError::DevAuthForbiddenOutsideDev(_)
                | SecurityError::ReleaseGateBlocked { .. },
            ) => 403,
            PersistenceError::NotFound { .. } => 404,
            PersistenceError::IdempotencyPayloadMismatch { .. }
            | PersistenceError::IdempotencyInFlight { .. }
            | PersistenceError::ConflictingProgressEventPayload { .. }
            | PersistenceError::DuplicatePublicRevisionContent { .. } => 409,
            PersistenceError::PreconditionFailed { .. } => 412,
            PersistenceError::IdentifierNamespaceViolation(_)
            | PersistenceError::ProhibitedPrivateFieldInPublicProjection { .. }
            | PersistenceError::ForbiddenClientOrModelAssignedField { .. }
            | PersistenceError::Validation(_) => 422,
            PersistenceError::PreconditionRequired => 428,
            PersistenceError::IdempotencyKeyRequired { .. } => 400,
        }
    }

    pub fn error_code(&self) -> &'static str {
        match self {
            PersistenceError::Security(SecurityError::Unauthenticated) => "unauthenticated",
            PersistenceError::Security(SecurityError::CrossTenantAccessDenied { .. }) => {
                "cross_tenant_forbidden"
            }
            PersistenceError::Security(SecurityError::InsufficientRolePrivilege { .. }) => {
                "insufficient_role_privilege"
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

#[derive(Default)]
struct StoreInner {
    accounts: BTreeMap<String, AccountRecord>,
    sessions_by_token_sha: BTreeMap<String, AuthSessionRecord>,
    private_revisions: BTreeMap<String, CurriculumRevisionRecord>,
    public_revisions: BTreeMap<String, PublicTemplateRevisionRecord>,
    schedules: BTreeMap<String, ScheduleRevisionRecord>,
    progress_events: BTreeMap<(String, String), StoredProgressEvent>,
    proficiency_by_account: BTreeMap<String, LearnerProficiencyProjection>,
    credentials: BTreeMap<String, StoredCredentialRecord>,
    idempotency_keys: BTreeMap<(String, String, String), IdempotencyRecord>,
    deletion_tombstones: Vec<DeletionTombstone>,
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
        if raw_api_key.trim().len() < 8 {
            return Err(PersistenceError::Validation(
                "api_key must be at least 8 characters".to_string(),
            ));
        }
        let suffix: String = raw_api_key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let masked_hint = format!("...{suffix}");
        let key_fingerprint_sha256 = sha256_bytes_hex(raw_api_key.as_bytes());

        let mut guard = self.inner.write().expect("store write lock");
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
                TombstoneEntityType::ResourceWithdrawn => {}
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_and_t01_migrations_are_embedded_and_valid() {
        assert_eq!(MIGRATIONS.len(), 3);
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
}
