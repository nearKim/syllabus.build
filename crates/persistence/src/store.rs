//! Core transactional store, identity/session management, tenancy, catalog, and curriculum revisions.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use curriculum_contracts::jcs::{jcs_sha256_hex, sha256_bytes_hex};
use curriculum_security::{
    AuthenticatedPrincipal, CredentialVault, PrincipalRole, SealedCredentialEnvelope, SecurityError,
};
use serde_json::{json, Value};

use crate::*;

#[derive(Default)]
pub(crate) struct StoreInner {
    pub(crate) accounts: BTreeMap<String, AccountRecord>,
    pub(crate) sessions_by_token_sha: BTreeMap<String, AuthSessionRecord>,
    pub(crate) private_revisions: BTreeMap<String, CurriculumRevisionRecord>,
    pub(crate) curriculum_activation_versions: BTreeMap<String, u64>,
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
    pub(crate) adopted_curricula_by_publication: BTreeMap<String, Vec<String>>,
    pub(crate) account_exports: BTreeMap<String, AccountExportRecord>,
    pub(crate) account_deletion_requests: BTreeMap<String, AccountDeletionReceiptRecord>,
    pub(crate) idempotency_keys: BTreeMap<(String, String, String), IdempotencyRecord>,
    pub(crate) deletion_tombstones: Vec<DeletionTombstone>,
    pub(crate) catalog_resources: BTreeMap<String, CatalogResourceVersionRecord>,
    pub(crate) quarantine_overlays: BTreeMap<String, ResourceQuarantineOverlayRecord>,
    pub(crate) candidate_archives: BTreeMap<String, CandidateArchiveRecord>,
    pub(crate) generation_jobs: BTreeMap<String, GenerationJobRecord>,
    pub(crate) next_seq: u64,
}

/// Thread-safe transactional store enforcing `T01` identity, tenant isolation,
/// private/public revision separation, HTTP concurrency rules, and post-restore tombstone replay.
#[derive(Clone, Default)]
pub struct InMemoryTransactionalStore {
    pub(crate) inner: Arc<RwLock<StoreInner>>,
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

    pub(crate) fn read_inner(&self) -> RwLockReadGuard<'_, StoreInner> {
        self.inner.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn write_inner(&self) -> RwLockWriteGuard<'_, StoreInner> {
        self.inner.write().unwrap_or_else(PoisonError::into_inner)
    }

    /// Creates a store pre-seeded with Learner A (`00000000-0000-4000-8000-000000000001`)
    /// and Learner B (`00000000-0000-4000-8000-000000000002`) for development and integration tests.
    #[must_use]
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
        let mut guard = self.write_inner();
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

        let mut guard = self.write_inner();
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
        let guard = self.read_inner();
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
        let mut guard = self.write_inner();
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

        let mut guard = self.write_inner();

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
        let guard = self.read_inner();
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

        let mut guard = self.write_inner();
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
        let guard = self.read_inner();
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
        let guard = self.read_inner();
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
        let mut guard = self.write_inner();

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
        let guard = self.read_inner();
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
        let mut guard = self.write_inner();
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
        let mut guard = self.write_inner();
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
        let view = CredentialMetadataView::from(&record);
        guard
            .credential_envelopes
            .insert(credential_ref.to_string(), sealed);
        guard
            .credentials
            .insert(credential_ref.to_string(), record);
        Ok(view)
    }

    pub fn get_credential_metadata(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
    ) -> Result<CredentialMetadataView, PersistenceError> {
        let guard = self.read_inner();
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
        Ok(CredentialMetadataView::from(record))
    }

    pub fn revoke_credential(
        &self,
        principal: &AuthenticatedPrincipal,
        credential_ref: &str,
        if_match: Option<&str>,
        now_ms: u64,
    ) -> Result<(), PersistenceError> {
        let mut guard = self.write_inner();
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
        let mut guard = self.write_inner();
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
        let mut guard = self.write_inner();
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
        let mut guard = self.write_inner();
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
        let mut guard = self.write_inner();
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

        let mut guard = self.write_inner();
        for item in items {
            guard
                .catalog_resources
                .insert(item.resource_version_id.clone(), item);
        }
    }

    pub fn upsert_catalog_resource(&self, record: CatalogResourceVersionRecord) {
        let mut guard = self.write_inner();
        guard
            .catalog_resources
            .insert(record.resource_version_id.clone(), record);
    }

    pub fn get_catalog_resource_version(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        let guard = self.read_inner();
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
        let guard = self.read_inner();
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
        let guard = self.read_inner();

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
        let guard = self.read_inner();
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

        let mut guard = self.write_inner();
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

        let mut guard = self.write_inner();
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

        let mut guard = self.write_inner();
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
        let guard = self.read_inner();
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

    pub(crate) fn collect_alerts_for_revisions(
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

        let mut guard = self.write_inner();
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
        let guard = self.read_inner();
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
        let guard = self.read_inner();
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
        let alerts = Self::collect_alerts_for_revisions(&guard, curriculum_id, &revs);

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
        let guard = self.read_inner();
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
        let mut guard = self.write_inner();
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
        let mut guard = self.write_inner();
        guard
            .candidate_archives
            .insert(archive.archive_id.clone(), archive);
    }

    #[must_use]
    pub fn get_candidate_archive(&self, archive_id: &str) -> Option<CandidateArchiveRecord> {
        let guard = self.read_inner();
        guard.candidate_archives.get(archive_id).cloned()
    }

    pub fn upsert_generation_job(&self, job: GenerationJobRecord) {
        let mut guard = self.write_inner();
        guard.generation_jobs.insert(job.job_id.clone(), job);
    }

    pub fn get_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError> {
        let guard = self.read_inner();
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
        let mut guard = self.write_inner();
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
}
