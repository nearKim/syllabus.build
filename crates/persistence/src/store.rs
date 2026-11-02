//! Core transactional store, identity/session management, tenancy, catalog, and syllabus revisions.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::{Deref, DerefMut};
use std::sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::{json, Value};
use syllabus_contracts::jcs::jcs_sha256_hex;
use syllabus_domain::{
    AssistanceLevel, LedgerEntry, MathDepthPreference, ModerationVisibilityState,
    SpacedReviewRecord,
};
use syllabus_security::{
    AppEnvironment, AuthenticatedPrincipal, CredentialVault, OAuthProvider, PrincipalRole,
    SealedCredentialEnvelope,
};

use crate::models::{
    AccountDeletionReceiptRecord, AccountExportRecord, AccountRecord, AdaptationProposalRecord,
    AssessmentAttemptRecord, AssessmentIssueReportRecord, AssessmentKeyCorrectionRecord,
    AuthRecoveryTokenRecord, AuthSessionRecord, CandidateArchiveRecord,
    CatalogResourceVersionRecord, CheckoutSessionRecord, CreditReservationRecord,
    DeletionTombstone, DiagnosticSessionRecord, GenerationJobRecord, HostedCreditWalletRecord,
    IdempotencyBeginOutcome, IdempotencyKeyState, IdempotencyRecord, InferenceUsageRecord,
    LearnerProficiencyProjection, ModerationActionRecord, NotificationPreferencesRecord,
    OAuthIdentityRecord, ObjectiveWaiverRecord, PaymentWebhookReceiptRecord, PersistenceError,
    PrerequisiteDecisionAuditRecord, PublicTemplateRevisionRecord, PublicationPreviewRecord,
    PublicationRecord, PublicationReportRecord, PublicationRevisionRecord, PushSubscriptionRecord,
    ReminderOccurrenceRecord, ResourceQuarantineOverlayRecord, ReviewedAssessmentRecord,
    ScheduleRevisionRecord, StoredCredentialRecord, StoredIdempotentResponse, StoredProgressEvent,
    SyllabusRevisionRecord, TombstoneEntityType, TombstoneReplayReport, UsageQuoteRecord,
    WebPasskeyRecord, WebWorkspaceRecord,
};

#[derive(Default)]
pub(crate) struct StoreInner {
    pub(crate) accounts: BTreeMap<String, AccountRecord>,
    pub(crate) oauth_identities: BTreeMap<(OAuthProvider, String), OAuthIdentityRecord>,
    pub(crate) sessions_by_token_sha: BTreeMap<String, AuthSessionRecord>,
    pub(crate) private_revisions: BTreeMap<String, SyllabusRevisionRecord>,
    pub(crate) syllabus_activation_versions: BTreeMap<String, u64>,
    pub(crate) public_revisions: BTreeMap<String, PublicTemplateRevisionRecord>,
    pub(crate) schedules: BTreeMap<String, ScheduleRevisionRecord>,
    pub(crate) schedule_playback_speeds: BTreeMap<String, f64>,
    pub(crate) spaced_reviews: BTreeMap<String, Vec<SpacedReviewRecord>>,
    pub(crate) progress_events: BTreeMap<(String, String), StoredProgressEvent>,
    pub(crate) proficiency_by_account: BTreeMap<String, LearnerProficiencyProjection>,
    pub(crate) math_depth_by_account: BTreeMap<String, MathDepthPreference>,
    pub(crate) credentials: BTreeMap<String, StoredCredentialRecord>,
    pub(crate) credential_envelopes: BTreeMap<String, SealedCredentialEnvelope>,
    pub(crate) credential_vault: CredentialVault,
    pub(crate) inference_usage_records: Vec<InferenceUsageRecord>,
    pub(crate) reviewed_assessments: BTreeMap<String, ReviewedAssessmentRecord>,
    pub(crate) assessment_attempts: BTreeMap<String, AssessmentAttemptRecord>,
    pub(crate) pending_assistance_by_assessment: BTreeMap<(String, String), AssistanceLevel>,
    pub(crate) assessment_issue_reports: Vec<AssessmentIssueReportRecord>,
    pub(crate) assessment_key_corrections: Vec<AssessmentKeyCorrectionRecord>,
    pub(crate) prerequisite_audit_events: Vec<PrerequisiteDecisionAuditRecord>,
    pub(crate) diagnostic_sessions: BTreeMap<String, DiagnosticSessionRecord>,
    pub(crate) objective_waivers: BTreeMap<(String, String), ObjectiveWaiverRecord>,
    pub(crate) adaptation_proposals: BTreeMap<String, AdaptationProposalRecord>,
    pub(crate) notification_preferences: BTreeMap<String, NotificationPreferencesRecord>,
    pub(crate) push_subscriptions: BTreeMap<String, PushSubscriptionRecord>,
    pub(crate) reminder_occurrences: BTreeMap<String, ReminderOccurrenceRecord>,
    pub(crate) hosted_credit_wallets: BTreeMap<String, HostedCreditWalletRecord>,
    pub(crate) usage_quotes: BTreeMap<String, UsageQuoteRecord>,
    pub(crate) credit_reservations: BTreeMap<String, CreditReservationRecord>,
    pub(crate) reservations_by_idempotency: BTreeMap<(String, String), String>,
    pub(crate) ledger_entries: Vec<LedgerEntry>,
    pub(crate) checkout_sessions: BTreeMap<String, CheckoutSessionRecord>,
    pub(crate) checkout_by_idempotency: BTreeMap<(String, String), String>,
    pub(crate) payment_webhook_events: BTreeMap<String, PaymentWebhookReceiptRecord>,
    pub(crate) publication_previews: BTreeMap<String, PublicationPreviewRecord>,
    pub(crate) publications: BTreeMap<String, PublicationRecord>,
    pub(crate) publication_revisions: BTreeMap<String, PublicationRevisionRecord>,
    pub(crate) publication_upvotes: BTreeSet<(String, String)>,
    pub(crate) publication_reports: Vec<PublicationReportRecord>,
    pub(crate) moderation_actions: Vec<ModerationActionRecord>,
    pub(crate) adopted_syllabi_by_publication: BTreeMap<String, Vec<String>>,
    pub(crate) account_exports: BTreeMap<String, AccountExportRecord>,
    pub(crate) account_deletion_requests: BTreeMap<String, AccountDeletionReceiptRecord>,
    pub(crate) idempotency_keys: BTreeMap<(String, String, String), IdempotencyRecord>,
    pub(crate) deletion_tombstones: Vec<DeletionTombstone>,
    pub(crate) catalog_resources: BTreeMap<String, CatalogResourceVersionRecord>,
    pub(crate) catalog_tfidf_index: syllabus_domain::TfIdfCorpusIndex,
    pub(crate) quarantine_overlays: BTreeMap<String, ResourceQuarantineOverlayRecord>,
    pub(crate) candidate_archives: BTreeMap<String, CandidateArchiveRecord>,
    pub(crate) generation_jobs: BTreeMap<String, GenerationJobRecord>,
    pub(crate) web_workspaces: BTreeMap<String, WebWorkspaceRecord>,
    pub(crate) web_passkeys: BTreeMap<String, WebPasskeyRecord>,
    pub(crate) auth_recovery_tokens: BTreeMap<String, AuthRecoveryTokenRecord>,
    pub(crate) next_seq: u64,
}

pub(crate) fn credential_map_key(account_id: &str, credential_ref: &str) -> String {
    format!("{}:{account_id}{credential_ref}", account_id.len())
}

/// Thread-safe transactional store enforcing `T01` identity, tenant isolation,
/// private/public revision separation, HTTP concurrency rules, and post-restore tombstone replay.
/// When opened via [`Self::open_postgres`] or [`Self::open_from_env`] with `DATABASE_URL`, every
/// write guard automatically commits a durable snapshot and catalog mirror to PostgreSQL.
#[derive(Clone, Default)]
pub struct InMemoryTransactionalStore {
    pub(crate) inner: Arc<RwLock<StoreInner>>,
    pub(crate) pg_backend: Option<Arc<crate::pg_backend::PgBackendHandle>>,
}

pub(crate) struct StoreWriteGuard<'a> {
    guard: RwLockWriteGuard<'a, StoreInner>,
    pg_backend: Option<&'a crate::pg_backend::PgBackendHandle>,
}

impl Deref for StoreWriteGuard<'_> {
    type Target = StoreInner;

    fn deref(&self) -> &Self::Target {
        &self.guard
    }
}

impl DerefMut for StoreWriteGuard<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.guard
    }
}

impl Drop for StoreWriteGuard<'_> {
    fn drop(&mut self) {
        if let Some(pg) = self.pg_backend {
            if !std::thread::panicking() {
                let _ = pg.save_store_inner(&self.guard);
            }
        }
    }
}

pub(crate) const PROHIBITED_PRIVATE_FIELDS_IN_PUBLIC: &[&str] = &[
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
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `true` when this store is backed by a live PostgreSQL write-through connection.
    #[must_use]
    pub fn is_postgres_backed(&self) -> bool {
        self.pg_backend.is_some()
    }

    /// Returns the active PostgreSQL persistence namespace if Postgres-backed.
    #[must_use]
    pub fn postgres_namespace(&self) -> Option<&str> {
        self.pg_backend.as_deref().map(|pg| pg.namespace())
    }

    /// Opens a PostgreSQL-backed store for `namespace`, automatically applying embedded migrations,
    /// restoring any existing durable snapshot (or seeding initial fixtures + open Git catalog on
    /// first boot), and writing through on every mutation.
    pub fn open_postgres(database_url: &str, namespace: &str) -> Result<Self, PersistenceError> {
        let vault = CredentialVault::from_env()?;
        let pg = Arc::new(crate::pg_backend::PgBackendHandle::connect(
            database_url,
            namespace,
        )?);
        if let Some(restored_inner) = pg.load_store_inner()? {
            let mut store = Self {
                inner: Arc::new(RwLock::new(restored_inner)),
                pg_backend: None,
            };
            let inserted = store.load_open_catalog_from_workspace();
            store.pg_backend = Some(Arc::clone(&pg));
            if inserted > 0 {
                pg.save_store_inner(&store.read_inner())?;
            }
            Ok(store)
        } else {
            let mut store = Self::new_with_dev_fixtures_with_vault(vault);
            store.load_open_catalog_from_workspace();
            pg.save_store_inner(&store.read_inner())?;
            store.pg_backend = Some(pg);
            Ok(store)
        }
    }

    /// Opens a PostgreSQL-backed store when `DATABASE_URL` is configured (using
    /// `SYLLABUS_STORE_NAMESPACE` or `"default"`). Development and tests may fall back to an
    /// in-memory store seeded with dev fixtures and the workspace `catalog/resources` registry.
    pub fn open_from_env() -> Result<Self, PersistenceError> {
        let database_url = std::env::var("DATABASE_URL").ok();
        Self::open_from_config(database_url.as_deref(), AppEnvironment::from_env())
    }

    fn open_from_config(
        database_url: Option<&str>,
        environment: AppEnvironment,
    ) -> Result<Self, PersistenceError> {
        if let Some(db_url) = database_url {
            let trimmed = db_url.trim();
            if !trimmed.is_empty() {
                let ns = std::env::var("SYLLABUS_STORE_NAMESPACE")
                    .ok()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "default".to_string());
                return Self::open_postgres(trimmed, &ns);
            }
        }
        if !environment.is_local_dev_or_test() {
            return Err(PersistenceError::Validation(
                "DATABASE_URL is required outside development and test".to_string(),
            ));
        }
        let store = Self::new_with_dev_fixtures();
        store.load_open_catalog_from_workspace();
        Ok(store)
    }

    pub(crate) fn read_inner(&self) -> RwLockReadGuard<'_, StoreInner> {
        if let Some(ref pg) = self.pg_backend {
            if let Ok(mut try_w) = self.inner.try_write() {
                if let Ok(Some((rev, refreshed))) = pg.load_store_inner_if_newer() {
                    *try_w = refreshed;
                    pg.set_last_seen_revision(rev);
                }
            }
        }
        self.inner.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn write_inner(&self) -> StoreWriteGuard<'_> {
        let mut guard = self.inner.write().unwrap_or_else(PoisonError::into_inner);
        if let Some(ref pg) = self.pg_backend {
            if let Ok(Some((rev, refreshed))) = pg.load_store_inner_if_newer() {
                *guard = refreshed;
                pg.set_last_seen_revision(rev);
            }
        }
        StoreWriteGuard {
            guard,
            pg_backend: self.pg_backend.as_deref(),
        }
    }

    /// Creates a store pre-seeded with Learner A (`00000000-0000-4000-8000-000000000001`)
    /// and Learner B (`00000000-0000-4000-8000-000000000002`) for development and integration tests.
    #[must_use]
    pub fn new_with_dev_fixtures() -> Self {
        Self::new_with_dev_fixtures_with_vault(CredentialVault::default())
    }

    fn new_with_dev_fixtures_with_vault(vault: CredentialVault) -> Self {
        let store = Self::new();
        store
            .inner
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .credential_vault = vault;
        let learner_a = "00000000-0000-4000-8000-000000000001";
        let learner_b = "00000000-0000-4000-8000-000000000002";

        store.upsert_account(AccountRecord {
            account_id: learner_a.to_string(),
            email: "learner-a@example.test".to_string(),
            email_verified: true,
            roles: vec![PrincipalRole::User],
            display_name: Some("Learner A".to_string()),
            avatar_url: None,
            password_hash: None,
            deleted_at_ms: None,
        });
        store.upsert_account(AccountRecord {
            account_id: learner_b.to_string(),
            email: "learner-b@example.test".to_string(),
            email_verified: true,
            roles: vec![PrincipalRole::User],
            display_name: Some("Learner B".to_string()),
            avatar_url: None,
            password_hash: None,
            deleted_at_ms: None,
        });

        let principal_a = AuthenticatedPrincipal {
            account_id: learner_a.to_string(),
            roles: vec![PrincipalRole::User],
            is_development_only_identity: true,
        };
        let principal_b = AuthenticatedPrincipal {
            account_id: learner_b.to_string(),
            roles: vec![PrincipalRole::User],
            is_development_only_identity: true,
        };

        store
            .commit_private_syllabus_revision(
                &principal_a,
                "cur-learner-a-1",
                "rev-learner-a-1",
                json!({
                    "title": "Learner A Linear Algebra",
                    "objectives": ["obj-la-1", "obj-la-2"]
                }),
            )
            .expect("seed learner A syllabus");

        store
            .commit_private_syllabus_revision(
                &principal_b,
                "cur-learner-b-1",
                "rev-learner-b-1",
                json!({
                    "title": "Learner B Distributed Systems",
                    "objectives": ["obj-ds-1"]
                }),
            )
            .expect("seed learner B syllabus");

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

    /// Simulates a pre-deletion backup snapshot rehydrating an account and credential prior to tombstone replay (`@S43`, `@S45`).
    pub fn simulate_backup_restore_rehydrating_stale_state(
        &self,
        account_id: &str,
        credential_ref: &str,
    ) {
        let mut guard = self.write_inner();
        if let Some(acct) = guard.accounts.get_mut(account_id) {
            acct.deleted_at_ms = None;
        }
        if let Some(cred) = guard
            .credentials
            .get_mut(&credential_map_key(account_id, credential_ref))
        {
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
        let mut guard = self.write_inner();
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
                    if let Some(cred) = guard
                        .credentials
                        .get_mut(&credential_map_key(&account_id, &target_id))
                    {
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

        let mut guard = self.write_inner();
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
                    IdempotencyKeyState::Completed => Ok(IdempotencyBeginOutcome::Replayed(
                        StoredIdempotentResponse {
                            status_code: existing.response_status.unwrap_or(200),
                            body: existing.response_body.clone().unwrap_or(Value::Null),
                            replayed: true,
                        },
                    )),
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
        let mut guard = self.write_inner();
        if status_code >= 500 {
            guard.idempotency_keys.remove(&composite_key);
        } else if let Some(record) = guard.idempotency_keys.get_mut(&composite_key) {
            record.state = IdempotencyKeyState::Completed;
            record.response_status = Some(status_code);
            record.response_body = Some(response_body);
        }
    }

    /// Prunes expired idempotency keys (`T01` retention policy).
    pub fn prune_expired_idempotency_keys(&self, now_ms: u64) -> usize {
        let mut guard = self.write_inner();
        let before = guard.idempotency_keys.len();
        guard
            .idempotency_keys
            .retain(|_, record| record.expires_at_ms > now_ms);
        before - guard.idempotency_keys.len()
    }
}

/// Public interface facade alias matching PROJECT.md interface contract.
pub type TransactionalStore = InMemoryTransactionalStore;

#[cfg(test)]
mod vault_seed_tests {
    use super::*;

    #[test]
    fn production_requires_a_persistent_database() {
        for environment in [AppEnvironment::Staging, AppEnvironment::Production] {
            assert!(matches!(
                InMemoryTransactionalStore::open_from_config(None, environment),
                Err(PersistenceError::Validation(_))
            ));
        }
    }

    #[test]
    fn fixture_credential_uses_the_persistent_vault_key() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures_with_vault(
            CredentialVault::new([7; 32]),
        );
        let owner = AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000002".to_string(),
            roles: vec![PrincipalRole::User],
            is_development_only_identity: true,
        };
        let (credential, _) = store
            .open_credential_for_pinned_inference(&owner, "cred-learner-b-openai", 1)
            .expect("seeded credential must decrypt after boot");
        assert_eq!(credential, "sk-live-secret-learner-b-9999");
    }
}
