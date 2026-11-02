//! PostgreSQL write-through runtime store backend, row-level workspace/passkey/recovery tables,
//! cross-replica revision synchronization, and transactional outbox SQL dispatcher.
//!
//! Runs a dedicated background OS thread owning a current-thread Tokio runtime and a live
//! `tokio_postgres::Client` connection so synchronous `&self` mutations on
//! [`InMemoryTransactionalStore`] commit durably to PostgreSQL without blocking or panicking
//! inside an outer Axum/Tokio runtime.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use syllabus_domain::{
    validate_outbound_egress_url, AssistanceLevel, LedgerEntry, MathDepthPreference,
    SpacedReviewRecord,
};
use syllabus_security::{CredentialVault, OAuthProvider, SealedCredentialEnvelope};
use tokio_postgres::NoTls;

use crate::store::{credential_map_key, StoreInner};
use crate::{
    AccountDeletionReceiptRecord, AccountExportRecord, AccountRecord, AdaptationProposalRecord,
    AssessmentAttemptRecord, AssessmentIssueReportRecord, AssessmentKeyCorrectionRecord,
    AuthRecoveryTokenRecord, AuthSessionRecord, CandidateArchiveRecord, CatalogAccessModel,
    CatalogResourceVersionRecord, CheckoutSessionRecord, CreditReservationRecord,
    DeletionTombstone, DiagnosticSessionRecord, GenerationJobRecord, HostedCreditWalletRecord,
    IdempotencyRecord, InMemoryTransactionalStore, InferenceUsageRecord,
    LearnerProficiencyProjection, ModerationActionRecord, NotificationPreferencesRecord,
    OAuthIdentityRecord, ObjectiveWaiverRecord, PaymentWebhookReceiptRecord, PersistenceError,
    PostgresTransactionalStatements, PrerequisiteDecisionAuditRecord, PublicTemplateRevisionRecord,
    PublicationPreviewRecord, PublicationRecord, PublicationReportRecord,
    PublicationRevisionRecord, PushSubscriptionRecord, ReminderOccurrenceRecord,
    ResourceQuarantineOverlayRecord, ReviewedAssessmentRecord, ScheduleRevisionRecord,
    StoredCredentialRecord, StoredProgressEvent, SyllabusRevisionRecord, UsageQuoteRecord,
    WebPasskeyRecord, WebWorkspaceRecord, WorkerDispatchReceipt,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PersistedOpenCatalogRow {
    pub resource_version_id: String,
    pub subject: String,
    pub category: String,
    pub title: String,
    pub canonical_url: String,
    pub access_model: String,
    pub is_synthetic_fixture: bool,
    pub metadata_json: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct PersistedStoreSnapshot {
    pub accounts: BTreeMap<String, AccountRecord>,
    #[serde(default)]
    pub account_password_hashes: BTreeMap<String, String>,
    pub oauth_identities: Vec<((OAuthProvider, String), OAuthIdentityRecord)>,
    pub sessions_by_token_sha: BTreeMap<String, AuthSessionRecord>,
    pub private_revisions: BTreeMap<String, SyllabusRevisionRecord>,
    pub syllabus_activation_versions: BTreeMap<String, u64>,
    pub public_revisions: BTreeMap<String, PublicTemplateRevisionRecord>,
    pub schedules: BTreeMap<String, ScheduleRevisionRecord>,
    pub schedule_playback_speeds: BTreeMap<String, f64>,
    pub spaced_reviews: BTreeMap<String, Vec<SpacedReviewRecord>>,
    pub progress_events: Vec<((String, String), StoredProgressEvent)>,
    pub proficiency_by_account: BTreeMap<String, LearnerProficiencyProjection>,
    pub math_depth_by_account: BTreeMap<String, MathDepthPreference>,
    pub credentials: BTreeMap<String, StoredCredentialRecord>,
    pub credential_envelopes: BTreeMap<String, SealedCredentialEnvelope>,
    pub inference_usage_records: Vec<InferenceUsageRecord>,
    pub reviewed_assessments: BTreeMap<String, ReviewedAssessmentRecord>,
    pub assessment_attempts: BTreeMap<String, AssessmentAttemptRecord>,
    pub pending_assistance_by_assessment: Vec<((String, String), AssistanceLevel)>,
    pub assessment_issue_reports: Vec<AssessmentIssueReportRecord>,
    pub assessment_key_corrections: Vec<AssessmentKeyCorrectionRecord>,
    pub prerequisite_audit_events: Vec<PrerequisiteDecisionAuditRecord>,
    pub diagnostic_sessions: BTreeMap<String, DiagnosticSessionRecord>,
    pub objective_waivers: Vec<((String, String), ObjectiveWaiverRecord)>,
    pub adaptation_proposals: BTreeMap<String, AdaptationProposalRecord>,
    pub notification_preferences: BTreeMap<String, NotificationPreferencesRecord>,
    pub push_subscriptions: BTreeMap<String, PushSubscriptionRecord>,
    pub reminder_occurrences: BTreeMap<String, ReminderOccurrenceRecord>,
    pub hosted_credit_wallets: BTreeMap<String, HostedCreditWalletRecord>,
    pub usage_quotes: BTreeMap<String, UsageQuoteRecord>,
    pub credit_reservations: BTreeMap<String, CreditReservationRecord>,
    pub reservations_by_idempotency: Vec<((String, String), String)>,
    pub ledger_entries: Vec<LedgerEntry>,
    pub checkout_sessions: BTreeMap<String, CheckoutSessionRecord>,
    pub checkout_by_idempotency: Vec<((String, String), String)>,
    pub payment_webhook_events: BTreeMap<String, PaymentWebhookReceiptRecord>,
    pub publication_previews: BTreeMap<String, PublicationPreviewRecord>,
    pub publications: BTreeMap<String, PublicationRecord>,
    pub publication_revisions: BTreeMap<String, PublicationRevisionRecord>,
    pub publication_upvotes: Vec<(String, String)>,
    pub publication_reports: Vec<PublicationReportRecord>,
    pub moderation_actions: Vec<ModerationActionRecord>,
    pub adopted_syllabi_by_publication: BTreeMap<String, Vec<String>>,
    pub account_exports: BTreeMap<String, AccountExportRecord>,
    pub account_deletion_requests: BTreeMap<String, AccountDeletionReceiptRecord>,
    pub idempotency_keys: Vec<((String, String, String), IdempotencyRecord)>,
    pub deletion_tombstones: Vec<DeletionTombstone>,
    pub catalog_resources: BTreeMap<String, CatalogResourceVersionRecord>,
    pub quarantine_overlays: BTreeMap<String, ResourceQuarantineOverlayRecord>,
    pub candidate_archives: BTreeMap<String, CandidateArchiveRecord>,
    pub generation_jobs: BTreeMap<String, GenerationJobRecord>,
    #[serde(default)]
    pub web_workspaces: BTreeMap<String, WebWorkspaceRecord>,
    #[serde(default)]
    pub web_passkeys: BTreeMap<String, WebPasskeyRecord>,
    #[serde(default)]
    pub auth_recovery_tokens: BTreeMap<String, AuthRecoveryTokenRecord>,
    pub next_seq: u64,
}

impl PersistedStoreSnapshot {
    pub(crate) fn from_store_inner(inner: &StoreInner) -> Self {
        let mut account_password_hashes = BTreeMap::new();
        for (acct_id, acct) in &inner.accounts {
            if let Some(ref hash) = acct.password_hash {
                account_password_hashes.insert(acct_id.clone(), hash.clone());
            }
        }
        Self {
            accounts: inner.accounts.clone(),
            account_password_hashes,
            oauth_identities: inner
                .oauth_identities
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            sessions_by_token_sha: inner.sessions_by_token_sha.clone(),
            private_revisions: inner.private_revisions.clone(),
            syllabus_activation_versions: inner.syllabus_activation_versions.clone(),
            public_revisions: inner.public_revisions.clone(),
            schedules: inner.schedules.clone(),
            schedule_playback_speeds: inner.schedule_playback_speeds.clone(),
            spaced_reviews: inner.spaced_reviews.clone(),
            progress_events: inner
                .progress_events
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            proficiency_by_account: inner.proficiency_by_account.clone(),
            math_depth_by_account: inner.math_depth_by_account.clone(),
            credentials: inner.credentials.clone(),
            credential_envelopes: inner.credential_envelopes.clone(),
            inference_usage_records: inner.inference_usage_records.clone(),
            reviewed_assessments: inner.reviewed_assessments.clone(),
            assessment_attempts: inner.assessment_attempts.clone(),
            pending_assistance_by_assessment: inner
                .pending_assistance_by_assessment
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect(),
            assessment_issue_reports: inner.assessment_issue_reports.clone(),
            assessment_key_corrections: inner.assessment_key_corrections.clone(),
            prerequisite_audit_events: inner.prerequisite_audit_events.clone(),
            diagnostic_sessions: inner.diagnostic_sessions.clone(),
            objective_waivers: inner
                .objective_waivers
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            adaptation_proposals: inner.adaptation_proposals.clone(),
            notification_preferences: inner.notification_preferences.clone(),
            push_subscriptions: inner.push_subscriptions.clone(),
            reminder_occurrences: inner.reminder_occurrences.clone(),
            hosted_credit_wallets: inner.hosted_credit_wallets.clone(),
            usage_quotes: inner.usage_quotes.clone(),
            credit_reservations: inner.credit_reservations.clone(),
            reservations_by_idempotency: inner
                .reservations_by_idempotency
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            ledger_entries: inner.ledger_entries.clone(),
            checkout_sessions: inner.checkout_sessions.clone(),
            checkout_by_idempotency: inner
                .checkout_by_idempotency
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            payment_webhook_events: inner.payment_webhook_events.clone(),
            publication_previews: inner.publication_previews.clone(),
            publications: inner.publications.clone(),
            publication_revisions: inner.publication_revisions.clone(),
            publication_upvotes: inner.publication_upvotes.iter().cloned().collect(),
            publication_reports: inner.publication_reports.clone(),
            moderation_actions: inner.moderation_actions.clone(),
            adopted_syllabi_by_publication: inner.adopted_syllabi_by_publication.clone(),
            account_exports: inner.account_exports.clone(),
            account_deletion_requests: inner.account_deletion_requests.clone(),
            idempotency_keys: inner
                .idempotency_keys
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            deletion_tombstones: inner.deletion_tombstones.clone(),
            catalog_resources: inner.catalog_resources.clone(),
            quarantine_overlays: inner.quarantine_overlays.clone(),
            candidate_archives: inner.candidate_archives.clone(),
            generation_jobs: inner.generation_jobs.clone(),
            web_workspaces: inner.web_workspaces.clone(),
            web_passkeys: inner.web_passkeys.clone(),
            auth_recovery_tokens: inner.auth_recovery_tokens.clone(),
            next_seq: inner.next_seq,
        }
    }

    pub(crate) fn into_store_inner(mut self) -> Result<StoreInner, PersistenceError> {
        for (acct_id, hash) in self.account_password_hashes {
            if let Some(acct) = self.accounts.get_mut(&acct_id) {
                acct.password_hash = Some(hash);
            }
        }
        let mut inner = StoreInner {
            accounts: self.accounts,
            oauth_identities: self.oauth_identities.into_iter().collect(),
            sessions_by_token_sha: self.sessions_by_token_sha,
            private_revisions: self.private_revisions,
            syllabus_activation_versions: self.syllabus_activation_versions,
            public_revisions: self.public_revisions,
            schedules: self.schedules,
            schedule_playback_speeds: self.schedule_playback_speeds,
            spaced_reviews: self.spaced_reviews,
            progress_events: self.progress_events.into_iter().collect(),
            proficiency_by_account: self.proficiency_by_account,
            math_depth_by_account: self.math_depth_by_account,
            credentials: self
                .credentials
                .into_values()
                .map(|record| {
                    (
                        credential_map_key(&record.owner_account_id, &record.credential_ref),
                        record,
                    )
                })
                .collect(),
            credential_envelopes: self
                .credential_envelopes
                .into_values()
                .map(|envelope| {
                    (
                        credential_map_key(&envelope.account_id, &envelope.credential_id),
                        envelope,
                    )
                })
                .collect(),
            credential_vault: CredentialVault::from_env()?,
            inference_usage_records: self.inference_usage_records,
            reviewed_assessments: self.reviewed_assessments,
            assessment_attempts: self.assessment_attempts,
            pending_assistance_by_assessment: self
                .pending_assistance_by_assessment
                .into_iter()
                .collect(),
            assessment_issue_reports: self.assessment_issue_reports,
            assessment_key_corrections: self.assessment_key_corrections,
            prerequisite_audit_events: self.prerequisite_audit_events,
            diagnostic_sessions: self.diagnostic_sessions,
            objective_waivers: self.objective_waivers.into_iter().collect(),
            adaptation_proposals: self.adaptation_proposals,
            notification_preferences: self.notification_preferences,
            push_subscriptions: self.push_subscriptions,
            reminder_occurrences: self.reminder_occurrences,
            hosted_credit_wallets: self.hosted_credit_wallets,
            usage_quotes: self.usage_quotes,
            credit_reservations: self.credit_reservations,
            reservations_by_idempotency: self.reservations_by_idempotency.into_iter().collect(),
            ledger_entries: self.ledger_entries,
            checkout_sessions: self.checkout_sessions,
            checkout_by_idempotency: self.checkout_by_idempotency.into_iter().collect(),
            payment_webhook_events: self.payment_webhook_events,
            publication_previews: self.publication_previews,
            publications: self.publications,
            publication_revisions: self.publication_revisions,
            publication_upvotes: self
                .publication_upvotes
                .into_iter()
                .collect::<BTreeSet<_>>(),
            publication_reports: self.publication_reports,
            moderation_actions: self.moderation_actions,
            adopted_syllabi_by_publication: self.adopted_syllabi_by_publication,
            account_exports: self.account_exports,
            account_deletion_requests: self.account_deletion_requests,
            idempotency_keys: self.idempotency_keys.into_iter().collect(),
            deletion_tombstones: self.deletion_tombstones,
            catalog_resources: BTreeMap::new(),
            catalog_tfidf_index: syllabus_domain::TfIdfCorpusIndex::default(),
            quarantine_overlays: self.quarantine_overlays,
            candidate_archives: self.candidate_archives,
            generation_jobs: self.generation_jobs,
            web_workspaces: self.web_workspaces,
            web_passkeys: self.web_passkeys,
            auth_recovery_tokens: self.auth_recovery_tokens,
            next_seq: self.next_seq,
        };
        let catalog = self.catalog_resources;
        for rec in catalog.values() {
            InMemoryTransactionalStore::sync_catalog_tfidf_entry_locked(&mut inner, rec);
        }
        inner.catalog_resources = catalog;
        Ok(inner)
    }
}

fn build_open_catalog_rows(inner: &StoreInner) -> Vec<PersistedOpenCatalogRow> {
    inner
        .catalog_resources
        .values()
        .map(|rec| {
            let subject = rec
                .topics
                .first()
                .cloned()
                .unwrap_or_else(|| "general".to_string());
            let access_model = match rec.access_model {
                CatalogAccessModel::FreePublic => "free_public",
                CatalogAccessModel::PaidPurchase => "paid_purchase",
                CatalogAccessModel::Subscription => "subscription",
                CatalogAccessModel::FreemiumTrial => "freemium_trial",
                CatalogAccessModel::UnknownPrice => "unknown_price",
            }
            .to_string();
            let metadata_json = serde_json::to_string(rec).unwrap_or_else(|_| "{}".to_string());
            PersistedOpenCatalogRow {
                resource_version_id: rec.resource_version_id.clone(),
                subject,
                category: rec.resource_type.clone(),
                title: rec.title.clone(),
                canonical_url: rec.canonical_url.clone(),
                access_model,
                is_synthetic_fixture: rec.is_synthetic_fixture,
                metadata_json,
            }
        })
        .collect()
}

fn scope_row_key(ns: &str, key: &str) -> String {
    if ns == "default" {
        key.to_string()
    } else {
        format!("{ns}:{key}")
    }
}

enum PgCommand {
    Load {
        reply: SyncSender<Result<Option<(u64, String)>, String>>,
    },
    LoadIfNewer {
        known_revision: u64,
        reply: SyncSender<Result<Option<(u64, String)>, String>>,
    },
    Save {
        snapshot_json: String,
        accounts: Vec<(String, String, bool)>,
        workspaces: Vec<(String, String, String, i64)>,
        passkeys: Vec<(String, String, String, String)>,
        recovery_tokens: Vec<(String, String, String, String, i64, Option<i64>)>,
        catalog_rows: Vec<PersistedOpenCatalogRow>,
        reply: SyncSender<Result<u64, String>>,
    },
}

/// Thread-safe handle to the background PostgreSQL write-through persistence worker.
pub(crate) struct PgBackendHandle {
    namespace: String,
    last_seen_revision: AtomicU64,
    tx: Mutex<SyncSender<PgCommand>>,
}

impl PgBackendHandle {
    pub(crate) fn connect(database_url: &str, namespace: &str) -> Result<Self, PersistenceError> {
        let db_url = database_url.trim().to_string();
        let ns = if namespace.trim().is_empty() {
            "default".to_string()
        } else {
            namespace.trim().to_string()
        };

        let (cmd_tx, cmd_rx) = mpsc::sync_channel::<PgCommand>(32);
        let (init_tx, init_rx) = mpsc::sync_channel::<Result<(), String>>(1);
        let ns_for_thread = ns.clone();

        thread::Builder::new()
            .name(format!("syllabus-pg-store-{ns}"))
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(e) => {
                        let _ = init_tx.send(Err(format!("tokio runtime init failed: {e}")));
                        return;
                    }
                };

                rt.block_on(async move {
                    let (mut client, connection) = match tokio_postgres::connect(&db_url, NoTls).await {
                        Ok(pair) => pair,
                        Err(e) => {
                            let _ = init_tx.send(Err(format!("postgres connect failed: {e}")));
                            return;
                        }
                    };
                    tokio::spawn(async move {
                        let _ = connection.await;
                    });

                    if let Err(e) = ensure_migrations_applied(&client).await {
                        let _ = init_tx.send(Err(e));
                        return;
                    }

                    let _ = init_tx.send(Ok(()));

                    while let Ok(cmd) = cmd_rx.recv() {
                        match cmd {
                            PgCommand::Load { reply } => {
                                let res = client
                                    .query_opt(
                                        "SELECT revision, snapshot_json::TEXT \
                                         FROM runtime_store_snapshots \
                                         WHERE namespace = $1",
                                        &[&ns_for_thread],
                                    )
                                    .await
                                    .map(|opt| {
                                        opt.map(|row| {
                                            let rev: i64 = row.get(0);
                                            let snap: String = row.get(1);
                                            (rev.max(0) as u64, snap)
                                        })
                                    })
                                    .map_err(|e| format!("postgres load snapshot failed: {e}"));
                                let _ = reply.send(res);
                            }
                            PgCommand::LoadIfNewer {
                                known_revision,
                                reply,
                            } => {
                                let known_i64 = known_revision as i64;
                                let res = client
                                    .query_opt(
                                        "SELECT revision, snapshot_json::TEXT \
                                         FROM runtime_store_snapshots \
                                         WHERE namespace = $1 AND revision > $2",
                                        &[&ns_for_thread, &known_i64],
                                    )
                                    .await
                                    .map(|opt| {
                                        opt.map(|row| {
                                            let rev: i64 = row.get(0);
                                            let snap: String = row.get(1);
                                            (rev.max(0) as u64, snap)
                                        })
                                    })
                                    .map_err(|e| format!("postgres check newer snapshot failed: {e}"));
                                let _ = reply.send(res);
                            }
                            PgCommand::Save {
                                snapshot_json,
                                accounts,
                                workspaces,
                                passkeys,
                                recovery_tokens,
                                catalog_rows,
                                reply,
                            } => {
                                let res: Result<u64, String> = async {
                                    let txn = client
                                        .transaction()
                                        .await
                                        .map_err(|e| format!("begin tx failed: {e}"))?;

                                    let locked_rev_row = txn
                                        .query_opt(
                                            "SELECT revision FROM runtime_store_snapshots \
                                             WHERE namespace = $1 FOR UPDATE",
                                            &[&ns_for_thread],
                                        )
                                        .await
                                        .map_err(|e| format!("lock runtime_store_snapshots failed: {e}"))?;

                                    let next_rev_i64 = locked_rev_row
                                        .map(|r| r.get::<_, i64>(0) + 1)
                                        .unwrap_or(1);

                                    txn.execute(
                                        "INSERT INTO runtime_store_snapshots \
                                         (namespace, schema_version, revision, snapshot_json, updated_at) \
                                         VALUES ($1, 2, $2, $3::TEXT::JSONB, NOW()) \
                                         ON CONFLICT (namespace) DO UPDATE SET \
                                             schema_version = 2, \
                                             revision = EXCLUDED.revision, \
                                             snapshot_json = EXCLUDED.snapshot_json, \
                                             updated_at = NOW()",
                                        &[&ns_for_thread, &next_rev_i64, &snapshot_json],
                                    )
                                    .await
                                    .map_err(|e| format!("upsert runtime_store_snapshots failed: {e}"))?;

                                    for (account_id, email, email_verified) in &accounts {
                                        let scoped_acct = scope_row_key(&ns_for_thread, account_id);
                                        if !(3..=128).contains(&scoped_acct.len()) || email.trim().is_empty() {
                                            continue;
                                        }
                                        let scoped_email = if ns_for_thread == "default" {
                                            email.clone()
                                        } else {
                                            format!("{ns_for_thread}+{email}")
                                        };
                                        txn.execute(
                                            "INSERT INTO accounts (account_id, email, email_verified) \
                                             SELECT $1, $2, $3 \
                                             WHERE NOT EXISTS ( \
                                                 SELECT 1 FROM accounts existing \
                                                 WHERE existing.email = $2 AND existing.account_id <> $1 \
                                             ) \
                                             ON CONFLICT (account_id) DO UPDATE SET \
                                                 email = EXCLUDED.email, \
                                                 email_verified = EXCLUDED.email_verified",
                                            &[&scoped_acct, &scoped_email, email_verified],
                                        )
                                        .await
                                        .map_err(|e| format!("upsert accounts `{scoped_acct}` failed: {e}"))?;
                                    }

                                    // Sync row-level web_account_workspaces for this namespace
                                    if ns_for_thread == "default" {
                                        txn.execute(
                                            "DELETE FROM web_account_workspaces WHERE account_id NOT LIKE '%:%'",
                                            &[],
                                        )
                                        .await
                                        .map_err(|e| format!("prune web_account_workspaces failed: {e}"))?;
                                    } else {
                                        let prefix = format!("{ns_for_thread}:%");
                                        txn.execute(
                                            "DELETE FROM web_account_workspaces WHERE account_id LIKE $1",
                                            &[&prefix],
                                        )
                                        .await
                                        .map_err(|e| format!("prune scoped web_account_workspaces failed: {e}"))?;
                                    }
                                    for (account_id, email, ws_json, rev) in &workspaces {
                                        let scoped_id = scope_row_key(&ns_for_thread, account_id);
                                        txn.execute(
                                            "INSERT INTO web_account_workspaces \
                                             (account_id, email, workspace_json, revision, updated_at) \
                                             VALUES ($1, $2, $3::TEXT::JSONB, $4, NOW()) \
                                             ON CONFLICT (account_id) DO UPDATE SET \
                                                 email = EXCLUDED.email, \
                                                 workspace_json = EXCLUDED.workspace_json, \
                                                 revision = EXCLUDED.revision, \
                                                 updated_at = NOW()",
                                            &[&scoped_id, email, ws_json, rev],
                                        )
                                        .await
                                        .map_err(|e| format!("upsert web_account_workspaces failed: {e}"))?;
                                    }

                                    // Sync row-level web_passkey_credentials for this namespace
                                    if ns_for_thread == "default" {
                                        txn.execute(
                                            "DELETE FROM web_passkey_credentials WHERE credential_id NOT LIKE '%:%'",
                                            &[],
                                        )
                                        .await
                                        .map_err(|e| format!("prune web_passkey_credentials failed: {e}"))?;
                                    } else {
                                        let prefix = format!("{ns_for_thread}:%");
                                        txn.execute(
                                            "DELETE FROM web_passkey_credentials WHERE credential_id LIKE $1",
                                            &[&prefix],
                                        )
                                        .await
                                        .map_err(|e| format!("prune scoped web_passkey_credentials failed: {e}"))?;
                                    }
                                    for (cred_id, account_id, email, cred_json) in &passkeys {
                                        let scoped_cred = scope_row_key(&ns_for_thread, cred_id);
                                        let scoped_acct = scope_row_key(&ns_for_thread, account_id);
                                        txn.execute(
                                            "INSERT INTO web_passkey_credentials \
                                             (credential_id, account_id, email, credential_json, updated_at) \
                                             VALUES ($1, $2, $3, $4::TEXT::JSONB, NOW()) \
                                             ON CONFLICT (credential_id) DO UPDATE SET \
                                                 account_id = EXCLUDED.account_id, \
                                                 email = EXCLUDED.email, \
                                                 credential_json = EXCLUDED.credential_json, \
                                                 updated_at = NOW()",
                                            &[&scoped_cred, &scoped_acct, email, cred_json],
                                        )
                                        .await
                                        .map_err(|e| format!("upsert web_passkey_credentials failed: {e}"))?;
                                    }

                                    // Sync row-level web_auth_recovery_tokens for this namespace
                                    if ns_for_thread == "default" {
                                        txn.execute(
                                            "DELETE FROM web_auth_recovery_tokens WHERE token_sha256 NOT LIKE '%:%'",
                                            &[],
                                        )
                                        .await
                                        .map_err(|e| format!("prune web_auth_recovery_tokens failed: {e}"))?;
                                    } else {
                                        let prefix = format!("{ns_for_thread}:%");
                                        txn.execute(
                                            "DELETE FROM web_auth_recovery_tokens WHERE token_sha256 LIKE $1",
                                            &[&prefix],
                                        )
                                        .await
                                        .map_err(|e| format!("prune scoped web_auth_recovery_tokens failed: {e}"))?;
                                    }
                                    for (token_sha, account_id, email, purpose, exp_ms, consumed_ms) in
                                        &recovery_tokens
                                    {
                                        let scoped_tok = scope_row_key(&ns_for_thread, token_sha);
                                        let scoped_acct = scope_row_key(&ns_for_thread, account_id);
                                        txn.execute(
                                            "INSERT INTO web_auth_recovery_tokens \
                                             (token_sha256, account_id, email, purpose, expires_at_ms, consumed_at_ms) \
                                             VALUES ($1, $2, $3, $4, $5, $6) \
                                             ON CONFLICT (token_sha256) DO UPDATE SET \
                                                 consumed_at_ms = EXCLUDED.consumed_at_ms",
                                            &[
                                                &scoped_tok,
                                                &scoped_acct,
                                                email,
                                                purpose,
                                                exp_ms,
                                                consumed_ms,
                                            ],
                                        )
                                        .await
                                        .map_err(|e| format!("upsert web_auth_recovery_tokens failed: {e}"))?;
                                    }

                                    if ns_for_thread == "default" {
                                        txn.execute("DELETE FROM open_catalog_resources", &[])
                                            .await
                                            .map_err(|e| format!("refresh open_catalog_resources failed: {e}"))?;
                                        for row in &catalog_rows {
                                            txn.execute(
                                                "INSERT INTO open_catalog_resources \
                                                 (resource_version_id, subject, category, title, canonical_url, access_model, is_synthetic_fixture, metadata_json, updated_at) \
                                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::TEXT::JSONB, NOW()) \
                                                 ON CONFLICT (resource_version_id) DO UPDATE SET \
                                                     subject = EXCLUDED.subject, \
                                                     category = EXCLUDED.category, \
                                                     title = EXCLUDED.title, \
                                                     canonical_url = EXCLUDED.canonical_url, \
                                                     access_model = EXCLUDED.access_model, \
                                                     is_synthetic_fixture = EXCLUDED.is_synthetic_fixture, \
                                                     metadata_json = EXCLUDED.metadata_json, \
                                                     updated_at = NOW()",
                                                &[
                                                    &row.resource_version_id,
                                                    &row.subject,
                                                    &row.category,
                                                    &row.title,
                                                    &row.canonical_url,
                                                    &row.access_model,
                                                    &row.is_synthetic_fixture,
                                                    &row.metadata_json,
                                                ],
                                            )
                                            .await
                                            .map_err(|e| format!("upsert open_catalog_resources failed: {e}"))?;
                                        }
                                    }

                                    txn.commit()
                                        .await
                                        .map_err(|e| format!("commit tx failed: {e}"))?;
                                    Ok(next_rev_i64.max(1) as u64)
                                }
                                .await;
                                let _ = reply.send(res);
                            }
                        }
                    }
                });
            })
            .map_err(|e| PersistenceError::Validation(format!("spawn pg worker failed: {e}")))?;

        match init_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                namespace: ns,
                last_seen_revision: AtomicU64::new(0),
                tx: Mutex::new(cmd_tx),
            }),
            Ok(Err(msg)) => Err(PersistenceError::Validation(msg)),
            Err(e) => Err(PersistenceError::Validation(format!(
                "pg worker exited during init: {e}"
            ))),
        }
    }

    #[must_use]
    pub(crate) fn namespace(&self) -> &str {
        &self.namespace
    }

    pub(crate) fn set_last_seen_revision(&self, rev: u64) {
        self.last_seen_revision.store(rev, Ordering::SeqCst);
    }

    pub(crate) fn load_store_inner(&self) -> Result<Option<StoreInner>, PersistenceError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        let sender = self
            .tx
            .lock()
            .map_err(|_| PersistenceError::Validation("pg sender poisoned".to_string()))?;
        sender
            .send(PgCommand::Load { reply: reply_tx })
            .map_err(|e| PersistenceError::Validation(format!("pg load channel closed: {e}")))?;
        drop(sender);

        let raw_opt = reply_rx
            .recv()
            .map_err(|e| PersistenceError::Validation(format!("pg load reply failed: {e}")))?
            .map_err(PersistenceError::Validation)?;
        match raw_opt {
            Some((rev, raw_json)) => {
                let snapshot: PersistedStoreSnapshot =
                    serde_json::from_str(&raw_json).map_err(|e| {
                        PersistenceError::Validation(format!("corrupt pg snapshot: {e}"))
                    })?;
                self.set_last_seen_revision(rev);
                Ok(Some(snapshot.into_store_inner()?))
            }
            None => Ok(None),
        }
    }

    pub(crate) fn load_store_inner_if_newer(
        &self,
    ) -> Result<Option<(u64, StoreInner)>, PersistenceError> {
        let known_revision = self.last_seen_revision.load(Ordering::SeqCst);
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        let sender = self
            .tx
            .lock()
            .map_err(|_| PersistenceError::Validation("pg sender poisoned".to_string()))?;
        sender
            .send(PgCommand::LoadIfNewer {
                known_revision,
                reply: reply_tx,
            })
            .map_err(|e| PersistenceError::Validation(format!("pg load channel closed: {e}")))?;
        drop(sender);

        let raw_opt = reply_rx
            .recv()
            .map_err(|e| PersistenceError::Validation(format!("pg load reply failed: {e}")))?
            .map_err(PersistenceError::Validation)?;
        match raw_opt {
            Some((rev, raw_json)) => {
                let snapshot: PersistedStoreSnapshot =
                    serde_json::from_str(&raw_json).map_err(|e| {
                        PersistenceError::Validation(format!("corrupt pg snapshot: {e}"))
                    })?;
                Ok(Some((rev, snapshot.into_store_inner()?)))
            }
            None => Ok(None),
        }
    }

    pub(crate) fn save_store_inner(&self, inner: &StoreInner) -> Result<(), PersistenceError> {
        let snapshot = PersistedStoreSnapshot::from_store_inner(inner);
        let snapshot_json = serde_json::to_string(&snapshot)
            .map_err(|e| PersistenceError::Validation(format!("serialize snapshot failed: {e}")))?;
        let accounts: Vec<(String, String, bool)> = inner
            .accounts
            .values()
            .filter(|a| a.deleted_at_ms.is_none())
            .map(|a| (a.account_id.clone(), a.email.clone(), a.email_verified))
            .collect();
        let workspaces: Vec<(String, String, String, i64)> = inner
            .web_workspaces
            .values()
            .map(|w| {
                let ws_str =
                    serde_json::to_string(&w.workspace_json).unwrap_or_else(|_| "{}".to_string());
                (
                    w.account_id.clone(),
                    w.email.clone(),
                    ws_str,
                    w.revision as i64,
                )
            })
            .collect();
        let passkeys: Vec<(String, String, String, String)> = inner
            .web_passkeys
            .values()
            .map(|p| {
                let cred_str =
                    serde_json::to_string(&p.credential_json).unwrap_or_else(|_| "{}".to_string());
                (
                    p.credential_id.clone(),
                    p.account_id.clone(),
                    p.email.clone(),
                    cred_str,
                )
            })
            .collect();
        let recovery_tokens: Vec<(String, String, String, String, i64, Option<i64>)> = inner
            .auth_recovery_tokens
            .values()
            .map(|t| {
                (
                    t.token_sha256.clone(),
                    t.account_id.clone(),
                    t.email.clone(),
                    t.purpose.clone(),
                    t.expires_at_ms as i64,
                    t.consumed_at_ms.map(|v| v as i64),
                )
            })
            .collect();
        let catalog_rows = build_open_catalog_rows(inner);

        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        let sender = self
            .tx
            .lock()
            .map_err(|_| PersistenceError::Validation("pg sender poisoned".to_string()))?;
        sender
            .send(PgCommand::Save {
                snapshot_json,
                accounts,
                workspaces,
                passkeys,
                recovery_tokens,
                catalog_rows,
                reply: reply_tx,
            })
            .map_err(|e| PersistenceError::Validation(format!("pg save channel closed: {e}")))?;
        drop(sender);

        let committed_rev = reply_rx
            .recv()
            .map_err(|e| PersistenceError::Validation(format!("pg save reply failed: {e}")))?
            .map_err(PersistenceError::Validation)?;
        self.set_last_seen_revision(committed_rev);
        Ok(())
    }
}

/// Summary of a PostgreSQL transactional outbox worker tick (`SELECT ... FOR UPDATE SKIP LOCKED`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PgOutboxTickReport {
    pub reaped_count: usize,
    pub claimed_and_completed_job_ids: Vec<String>,
    pub remaining_queued_count: i64,
    #[serde(default)]
    pub receipts: Vec<WorkerDispatchReceipt>,
}

async fn schema_already_at_latest(client: &tokio_postgres::Client) -> Result<bool, String> {
    let row = client
        .query_one(
            "SELECT \
                 to_regclass('public.worker_dispatch_receipts') IS NOT NULL \
                 AND to_regclass('public.web_account_workspaces') IS NOT NULL \
                 AND to_regclass('public.web_passkey_credentials') IS NOT NULL \
                 AND to_regclass('public.web_auth_recovery_tokens') IS NOT NULL \
                 AND EXISTS ( \
                     SELECT 1 FROM information_schema.columns \
                     WHERE table_schema = 'public' \
                       AND table_name = 'runtime_store_snapshots' \
                       AND column_name = 'revision' \
                 )",
            &[],
        )
        .await
        .map_err(|e| format!("check schema readiness failed: {e}"))?;
    Ok(row.get::<_, bool>(0))
}

async fn ensure_migrations_applied(client: &tokio_postgres::Client) -> Result<(), String> {
    if schema_already_at_latest(client).await? {
        return Ok(());
    }
    client
        .execute("SELECT pg_advisory_lock(79112203)", &[])
        .await
        .map_err(|e| format!("migration advisory lock failed: {e}"))?;
    let res = async {
        if schema_already_at_latest(client).await? {
            return Ok(());
        }
        let sql = PostgresTransactionalStatements::render_full_migration_bundle();
        client
            .batch_execute(&sql)
            .await
            .map_err(|e| format!("postgres migration bundle failed: {e}"))
    }
    .await;
    let _ = client
        .execute("SELECT pg_advisory_unlock(79112203)", &[])
        .await;
    res
}

/// Applies all embedded migrations (`0000`–`0010`) idempotently to `database_url`.
pub async fn apply_migrations_to_postgres(database_url: &str) -> Result<(), String> {
    let (client, connection) = tokio_postgres::connect(database_url, NoTls)
        .await
        .map_err(|e| format!("postgres connect failed: {e}"))?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    ensure_migrations_applied(&client).await
}

/// Enqueues a durable background job into PostgreSQL's `outbox_jobs` table.
pub async fn enqueue_pg_outbox_job(
    database_url: &str,
    job_id: &str,
    account_id: &str,
    job_type: &str,
    payload: &Value,
) -> Result<(), String> {
    let (client, connection) = tokio_postgres::connect(database_url, NoTls)
        .await
        .map_err(|e| format!("postgres connect failed: {e}"))?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    let fallback_email = format!("{account_id}@outbox.syllabus.local");
    client
        .execute(
            "INSERT INTO accounts (account_id, email, email_verified) \
             VALUES ($1, $2, TRUE) \
             ON CONFLICT (account_id) DO NOTHING",
            &[&account_id, &fallback_email],
        )
        .await
        .map_err(|e| format!("ensure outbox account failed: {e}"))?;

    let payload_str = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    client
        .execute(
            "INSERT INTO outbox_jobs (job_id, account_id, job_type, state, payload_json, available_at) \
             VALUES ($1, $2, $3, 'queued', $4::TEXT::JSONB, NOW()) \
             ON CONFLICT (job_id) DO NOTHING",
            &[&job_id, &account_id, &job_type, &payload_str],
        )
        .await
        .map_err(|e| format!("insert outbox_jobs failed: {e}"))?;
    Ok(())
}

async fn dispatch_claimed_outbox_job(
    http_client: &reqwest::Client,
    job_id: &str,
    account_id: &str,
    job_type: &str,
    payload: &Value,
) -> Result<WorkerDispatchReceipt, String> {
    match job_type {
        "email_notification" | "study_reminder" | "password_reset_email" | "email_verification" => {
            let recipient = payload
                .get("email")
                .or_else(|| payload.get("to"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let subject =
                payload
                    .get("subject")
                    .and_then(Value::as_str)
                    .unwrap_or(match job_type {
                        "study_reminder" => "Syllabus.build Study Session Reminder",
                        "password_reset_email" => "Syllabus.build Password Recovery Code",
                        "email_verification" => "Verify your Syllabus.build email address",
                        _ => "Syllabus.build Notification",
                    });
            let webhook_url = std::env::var("EMAIL_WEBHOOK_URL")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if let Some(url) = webhook_url {
                let resp = http_client
                    .post(&url)
                    .json(&json!({
                        "job_id": job_id,
                        "job_type": job_type,
                        "account_id": account_id,
                        "to": recipient,
                        "subject": subject,
                        "template_data": payload,
                    }))
                    .send()
                    .await
                    .map_err(|e| format!("email webhook transport error: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!(
                        "email webhook returned HTTP {}",
                        resp.status().as_u16()
                    ));
                }
                Ok(WorkerDispatchReceipt {
                    job_id: job_id.to_string(),
                    job_type: job_type.to_string(),
                    channel: "email".to_string(),
                    recipient,
                    status: "sent".to_string(),
                    detail_json: json!({
                        "subject": subject,
                        "delivery_mode": "webhook",
                        "http_status": resp.status().as_u16(),
                    }),
                })
            } else {
                Ok(WorkerDispatchReceipt {
                    job_id: job_id.to_string(),
                    job_type: job_type.to_string(),
                    channel: "email".to_string(),
                    recipient,
                    status: "logged_dry_run".to_string(),
                    detail_json: json!({
                        "subject": subject,
                        "delivery_mode": "dry_run_spool",
                        "account_id": account_id,
                    }),
                })
            }
        }
        "web_push_notification" => {
            let endpoint = payload
                .get("endpoint")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| Some(account_id.to_string()));
            let webhook_url = std::env::var("WEB_PUSH_WEBHOOK_URL")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if let Some(url) = webhook_url {
                let resp = http_client
                    .post(&url)
                    .json(&json!({
                        "job_id": job_id,
                        "account_id": account_id,
                        "endpoint": endpoint,
                        "payload": payload,
                    }))
                    .send()
                    .await
                    .map_err(|e| format!("web push webhook transport error: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!(
                        "web push webhook returned HTTP {}",
                        resp.status().as_u16()
                    ));
                }
                Ok(WorkerDispatchReceipt {
                    job_id: job_id.to_string(),
                    job_type: job_type.to_string(),
                    channel: "web_push".to_string(),
                    recipient: endpoint,
                    status: "sent".to_string(),
                    detail_json: json!({
                        "delivery_mode": "webhook",
                        "http_status": resp.status().as_u16(),
                    }),
                })
            } else {
                Ok(WorkerDispatchReceipt {
                    job_id: job_id.to_string(),
                    job_type: job_type.to_string(),
                    channel: "web_push".to_string(),
                    recipient: endpoint,
                    status: "logged_dry_run".to_string(),
                    detail_json: json!({
                        "delivery_mode": "dry_run_spool",
                        "account_id": account_id,
                    }),
                })
            }
        }
        "catalog_link_check" => {
            let url = payload
                .get("canonical_url")
                .or_else(|| payload.get("url"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let resource_version_id = payload
                .get("resource_version_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown");

            let egress_check = validate_outbound_egress_url(url, &[]);
            if let Err(err) = egress_check {
                return Ok(WorkerDispatchReceipt {
                    job_id: job_id.to_string(),
                    job_type: job_type.to_string(),
                    channel: "catalog_freshness".to_string(),
                    recipient: Some(resource_version_id.to_string()),
                    status: "quarantined".to_string(),
                    detail_json: json!({
                        "resource_version_id": resource_version_id,
                        "canonical_url": url,
                        "reason": err.to_string(),
                    }),
                });
            }

            let live_http = std::env::var("CATALOG_LIVE_HTTP_CHECK")
                .ok()
                .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
            if live_http {
                match http_client.head(url).send().await {
                    Ok(resp) if resp.status().as_u16() == 404 || resp.status().as_u16() == 410 => {
                        return Ok(WorkerDispatchReceipt {
                            job_id: job_id.to_string(),
                            job_type: job_type.to_string(),
                            channel: "catalog_freshness".to_string(),
                            recipient: Some(resource_version_id.to_string()),
                            status: "quarantined".to_string(),
                            detail_json: json!({
                                "resource_version_id": resource_version_id,
                                "canonical_url": url,
                                "http_status": resp.status().as_u16(),
                            }),
                        });
                    }
                    Ok(resp) => {
                        return Ok(WorkerDispatchReceipt {
                            job_id: job_id.to_string(),
                            job_type: job_type.to_string(),
                            channel: "catalog_freshness".to_string(),
                            recipient: Some(resource_version_id.to_string()),
                            status: "verified".to_string(),
                            detail_json: json!({
                                "resource_version_id": resource_version_id,
                                "canonical_url": url,
                                "http_status": resp.status().as_u16(),
                            }),
                        });
                    }
                    Err(err) => {
                        return Err(format!("catalog link live HTTP check failed: {err}"));
                    }
                }
            }

            Ok(WorkerDispatchReceipt {
                job_id: job_id.to_string(),
                job_type: job_type.to_string(),
                channel: "catalog_freshness".to_string(),
                recipient: Some(resource_version_id.to_string()),
                status: "verified".to_string(),
                detail_json: json!({
                    "resource_version_id": resource_version_id,
                    "canonical_url": url,
                    "egress_policy": "https_public_domain_valid",
                }),
            })
        }
        _ => Ok(WorkerDispatchReceipt {
            job_id: job_id.to_string(),
            job_type: job_type.to_string(),
            channel: "internal".to_string(),
            recipient: Some(account_id.to_string()),
            status: "verified".to_string(),
            detail_json: json!({
                "account_id": account_id,
                "handled": true,
            }),
        }),
    }
}

/// Runs one transactional outbox maintenance + dispatch tick directly against PostgreSQL `outbox_jobs`:
/// 1. Reaps expired leases (`in_flight` / `leased` with `locked_until < NOW()`).
/// 2. Claims queued jobs via `FOR UPDATE SKIP LOCKED`, executes typed dispatchers, persists
///    `worker_dispatch_receipts`, and transitions `outbox_jobs` to `'succeeded'` (or requeues/dead-letters on transport error).
pub async fn run_pg_outbox_worker_tick(
    database_url: &str,
    worker_id: &str,
    lease_seconds: i64,
) -> Result<PgOutboxTickReport, String> {
    let (client, connection) = tokio_postgres::connect(database_url, NoTls)
        .await
        .map_err(|e| format!("postgres connect failed: {e}"))?;
    tokio::spawn(async move {
        let _ = connection.await;
    });

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("build reqwest client failed: {e}"))?;

    let reaped_rows = client
        .query(
            "UPDATE outbox_jobs \
             SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END, \
                 locked_by = NULL, \
                 locked_until = NULL, \
                 completed_at = CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE completed_at END, \
                 last_error = CASE WHEN attempt_count >= max_attempts THEN 'lease_expired_max_attempts_exceeded' ELSE 'worker_lease_expired_requeued' END \
             WHERE state IN ('in_flight', 'leased') AND locked_until < NOW() \
             RETURNING job_id",
            &[],
        )
        .await
        .map_err(|e| format!("reap expired leases failed: {e}"))?;

    let mut claimed_and_completed_job_ids = Vec::new();
    let mut receipts = Vec::new();

    loop {
        let claimed = client
            .query_opt(
                "UPDATE outbox_jobs \
                 SET state = 'leased', \
                     locked_by = $1, \
                     locked_until = NOW() + ($2::BIGINT * INTERVAL '1 second'), \
                     attempt_count = attempt_count + 1 \
                 WHERE job_id = ( \
                     SELECT job_id FROM outbox_jobs \
                     WHERE state = 'queued' AND available_at <= NOW() \
                     ORDER BY available_at ASC, job_id ASC \
                     FOR UPDATE SKIP LOCKED \
                     LIMIT 1 \
                 ) \
                 RETURNING job_id, account_id, job_type, payload_json::TEXT, attempt_count, max_attempts",
                &[&worker_id, &lease_seconds],
            )
            .await
            .map_err(|e| format!("claim next outbox job failed: {e}"))?;

        let Some(row) = claimed else {
            break;
        };
        let job_id: String = row.get(0);
        let account_id: String = row.get(1);
        let job_type: String = row.get(2);
        let payload_raw: String = row.get(3);
        let attempt_count: i32 = row.get(4);
        let max_attempts: i32 = row.get(5);
        let payload: Value = serde_json::from_str(&payload_raw)
            .unwrap_or_else(|_| Value::Object(Default::default()));

        match dispatch_claimed_outbox_job(&http_client, &job_id, &account_id, &job_type, &payload)
            .await
        {
            Ok(receipt) => {
                let detail_str = serde_json::to_string(&receipt.detail_json)
                    .unwrap_or_else(|_| "{}".to_string());
                client
                    .execute(
                        "INSERT INTO worker_dispatch_receipts \
                         (job_id, job_type, channel, recipient, status, detail_json, dispatched_at) \
                         VALUES ($1, $2, $3, $4, $5, $6::TEXT::JSONB, NOW()) \
                         ON CONFLICT (job_id) DO UPDATE SET \
                             status = EXCLUDED.status, \
                             detail_json = EXCLUDED.detail_json, \
                             dispatched_at = NOW()",
                        &[
                            &receipt.job_id,
                            &receipt.job_type,
                            &receipt.channel,
                            &receipt.recipient,
                            &receipt.status,
                            &detail_str,
                        ],
                    )
                    .await
                    .map_err(|e| format!("insert worker_dispatch_receipts `{job_id}` failed: {e}"))?;

                client
                    .execute(
                        "UPDATE outbox_jobs \
                         SET state = 'succeeded', \
                             locked_by = NULL, \
                             locked_until = NULL, \
                             completed_at = NOW(), \
                             last_error = NULL \
                         WHERE job_id = $1 AND locked_by = $2",
                        &[&job_id, &worker_id],
                    )
                    .await
                    .map_err(|e| format!("complete outbox job `{job_id}` failed: {e}"))?;

                claimed_and_completed_job_ids.push(job_id);
                receipts.push(receipt);
            }
            Err(dispatch_err) => {
                let terminal = attempt_count >= max_attempts;
                let detail_str = serde_json::to_string(&json!({
                    "error": dispatch_err,
                    "attempt_count": attempt_count,
                    "max_attempts": max_attempts,
                }))
                .unwrap_or_else(|_| "{}".to_string());
                client
                    .execute(
                        "INSERT INTO worker_dispatch_receipts \
                         (job_id, job_type, channel, recipient, status, detail_json, dispatched_at) \
                         VALUES ($1, $2, 'error', $3, 'failed', $4::TEXT::JSONB, NOW()) \
                         ON CONFLICT (job_id) DO UPDATE SET \
                             status = 'failed', \
                             detail_json = EXCLUDED.detail_json, \
                             dispatched_at = NOW()",
                        &[&job_id, &job_type, &Some(account_id), &detail_str],
                    )
                    .await
                    .ok();

                if terminal {
                    client
                        .execute(
                            "UPDATE outbox_jobs \
                             SET state = 'failed', \
                                 locked_by = NULL, \
                                 locked_until = NULL, \
                                 completed_at = NOW(), \
                                 last_error = $3 \
                             WHERE job_id = $1 AND locked_by = $2",
                            &[&job_id, &worker_id, &dispatch_err],
                        )
                        .await
                        .map_err(|e| format!("fail outbox job `{job_id}` failed: {e}"))?;
                } else {
                    client
                        .execute(
                            "UPDATE outbox_jobs \
                             SET state = 'queued', \
                                 locked_by = NULL, \
                                 locked_until = NULL, \
                                 available_at = NOW() + INTERVAL '5 seconds', \
                                 last_error = $3 \
                             WHERE job_id = $1 AND locked_by = $2",
                            &[&job_id, &worker_id, &dispatch_err],
                        )
                        .await
                        .map_err(|e| format!("requeue outbox job `{job_id}` failed: {e}"))?;
                }
            }
        }
    }

    let remaining_row = client
        .query_one(
            "SELECT COUNT(*)::BIGINT FROM outbox_jobs WHERE state = 'queued'",
            &[],
        )
        .await
        .map_err(|e| format!("count queued outbox_jobs failed: {e}"))?;
    let remaining_queued_count: i64 = remaining_row.get(0);

    Ok(PgOutboxTickReport {
        reaped_count: reaped_rows.len(),
        claimed_and_completed_job_ids,
        remaining_queued_count,
        receipts,
    })
}
