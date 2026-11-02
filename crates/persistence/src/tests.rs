use super::*;
use serde_json::json;
use syllabus_security::{AuthenticatedPrincipal, PrincipalRole};

#[test]
fn baseline_and_t01_migrations_are_embedded_and_valid() {
    assert_eq!(MIGRATIONS.len(), 11);
    assert!(WEB_WORKSPACES_AND_WORKER_DISPATCH_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS web_account_workspaces"));
    assert!(WEB_WORKSPACES_AND_WORKER_DISPATCH_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS worker_dispatch_receipts"));
    assert!(OAUTH_IDENTITIES_AND_PASSWORD_AUTH_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS oauth_identities"));
    assert!(POLYMORPHIC_RESOURCE_INDICES_AND_TAGS_MIGRATION_SQL
        .contains("ADD COLUMN IF NOT EXISTS index_descriptor JSONB"));
    assert!(INCREMENTAL_CATALOG_AND_HYBRID_INDEX_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS catalog_resource_tfidf_terms"));
    assert!(INCREMENTAL_CATALOG_AND_HYBRID_INDEX_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS catalog_resource_segments"));
    assert!(INCREMENTAL_CATALOG_AND_HYBRID_INDEX_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS catalog_changes"));
    assert!(BASELINE_MIGRATION_SQL.contains("SELECT 1;"));
    assert!(
        !INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL.contains("CREATE EXTENSION IF NOT EXISTS vector")
    );
    assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL.contains("CREATE TABLE IF NOT EXISTS accounts"));
    assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS auth_sessions"));
    assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS learner_profiles"));
    assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS syllabus_revisions"));
    assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS public_template_revisions"));
    assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS schedule_revisions"));
    assert!(INIT_IDENTITY_AND_TENANCY_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS progress_events"));
    assert!(IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS idempotency_keys"));
    assert!(IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL.contains("CREATE TABLE IF NOT EXISTS outbox_jobs"));
    assert!(IDEMPOTENCY_AND_OUTBOX_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS deletion_tombstones"));
    assert!(REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS catalog_resources"));
    assert!(REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL
        .contains("CREATE TABLE IF NOT EXISTS resource_versions"));
    assert!(!REVIEWED_CATALOG_AND_RETRIEVAL_MIGRATION_SQL.contains("vector(1536)"));
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
    assert!(PostgresTransactionalStatements::upsert_tfidf_term_sql()
        .contains("ON CONFLICT (resource_version_id, term) DO UPDATE"));
    assert!(
        PostgresTransactionalStatements::tfidf_cosine_similarity_ranking_sql()
            .contains("SUM(q.query_weight * d.normalized_tfidf_weight)")
    );
}

#[test]
fn s56_s57_separate_private_and_public_revision_identifiers_and_projections() {
    let store = InMemoryTransactionalStore::new_with_dev_fixtures();
    let learner_a = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000001".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };
    let learner_b = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000002".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };

    // Private revision cannot use `pubrev_` prefix
    assert!(matches!(
        store.commit_private_syllabus_revision(
            &learner_a,
            "cur-learner-a-1",
            "pubrev_illegal_private",
            json!({"title": "bad"}),
        ),
        Err(PersistenceError::IdentifierNamespaceViolation(_))
    ));

    // Client or model payload cannot assign account_id or mastered status
    assert!(matches!(
        store.commit_private_syllabus_revision(
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
    store.complete_idempotent_command(acct, op, key, 503, json!({"error": "provider_unavailable"}));

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

    // 7. Abandoned in-flight key is pruned once expires_at_ms <= now_ms
    let in_flight_key = "test-inflight-key";
    store
        .begin_idempotent_command(acct, op, Some(in_flight_key), &payload_1, 1_000, 5_000)
        .unwrap();
    assert_eq!(store.prune_expired_idempotency_keys(4_000), 0);
    assert_eq!(store.prune_expired_idempotency_keys(7_000), 1);
}

#[test]
fn s43_s45_post_restore_tombstone_replay_reapplies_account_and_credential_revocations() {
    let store = InMemoryTransactionalStore::new_with_dev_fixtures();
    let learner_b = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000002".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };

    // Revoke credential and delete account after backup snapshot time
    store
        .revoke_credential(
            &learner_b,
            "cred-learner-b-openai",
            Some("\"cred-v1\""),
            2_000,
        )
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
fn t02_s04_s05_s06_s09_catalog_filtering_budget_subscriptions_unknown_price_and_synthetic_exclusion(
) {
    let store = InMemoryTransactionalStore::new_with_dev_fixtures();
    let registry = syllabus_contracts::ContractRegistry::load_from_workspace()
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
    assert_eq!(
        err_no_fallback.error_code(),
        "insufficient_catalog_coverage"
    );

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
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };
    let curator = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000099".to_string(),
        roles: vec![PrincipalRole::Admin],
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
fn t02_s07_s09_s63_quarantine_overlay_preserves_historical_revision_immutability_and_surfaces_alerts(
) {
    let store = InMemoryTransactionalStore::new_with_dev_fixtures();
    let learner_a = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000001".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };
    let curator = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000099".to_string(),
        roles: vec![PrincipalRole::Admin],
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
        .commit_validated_syllabus_revision(
            &learner_a,
            "cur-rag-1",
            "rev-rag-1",
            "435f6b3a8297063ab07cf807eaa001a3ad37747efc0b8219f2e69d093ca4e505",
            rev_payload.clone(),
            true,
        )
        .expect("commit syllabus revision");

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
        .get_private_syllabus_revision(&learner_a, "rev-rag-1")
        .expect("fetch historical revision");
    assert_eq!(after_quarantine.payload, rev_payload);
    assert_eq!(
        after_quarantine.candidate_sha256,
        committed.candidate_sha256
    );

    // Resource alert is surfaced on the syllabus without mutating the revision
    let alerts = store
        .list_syllabus_resource_alerts(&learner_a, "cur-rag-1")
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
fn postgres_transactional_statements_migration_bundle_and_parameterized_queries_preserve_invariants(
) {
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
        "syllabus_revisions",
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
    assert!(sched_sql.contains("WHERE account_id = $1 AND syllabus_id = $2 AND etag_version = $3"));

    let bloat_sql = PostgresTransactionalStatements::pg_bloat_monitoring_sql();
    assert!(bloat_sql.contains("FROM pg_stat_user_tables"));
    assert!(bloat_sql.contains("outbox_jobs"));
}

#[test]
fn oauth_account_linking_and_session_lifecycle() {
    let store = InMemoryTransactionalStore::new();
    let first = store
        .authenticate_oauth_identity(
            syllabus_security::OAuthProvider::Google,
            "google-sub-999",
            "Jane@Example.com",
            true,
            Some("Jane Doe"),
            None,
        )
        .expect("create OAuth account");
    assert!(first.is_new_account);
    assert_eq!(first.account.email, "jane@example.com");
    assert_eq!(first.account.roles, vec![PrincipalRole::User]);
    assert_eq!(first.account.password_hash, None);
    assert_eq!(first.session.token.len(), 64);
    assert!(store
        .resolve_session_token(&first.session.token)
        .unwrap()
        .is_some());

    let second = store
        .authenticate_oauth_identity(
            syllabus_security::OAuthProvider::Google,
            "google-sub-999",
            "jane@example.com",
            true,
            None,
            None,
        )
        .expect("reuse OAuth account");
    assert!(!second.is_new_account);
    assert_eq!(first.account.account_id, second.account.account_id);
    assert_ne!(first.session.token, second.session.token);

    assert!(store
        .resolve_session_token(&format!("sess-token-1-{}", first.account.account_id))
        .is_err());

    let mut admin = first.account.clone();
    admin.roles = vec![PrincipalRole::Admin];
    store.upsert_account(admin);
    assert_eq!(
        store
            .resolve_session_token(&first.session.token)
            .unwrap()
            .unwrap()
            .roles,
        vec![PrincipalRole::Admin],
    );

    let token_sha = first.session.token_sha256;
    store
        .write_inner()
        .sessions_by_token_sha
        .get_mut(&token_sha)
        .unwrap()
        .expires_at = "2000-01-01T00:00:00Z".to_string();
    assert!(store.resolve_session_token(&first.session.token).is_err());
}

#[test]
fn credential_reference_is_scoped_to_each_account() {
    let store = InMemoryTransactionalStore::new_with_dev_fixtures();
    let owner = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000001".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };
    let other = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000002".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };
    store
        .create_credential(
            &owner,
            "same-ref",
            "openai",
            "Owner",
            "sk-owner-secret-12345",
        )
        .unwrap();
    store
        .create_credential(
            &other,
            "same-ref",
            "openai",
            "Other",
            "sk-other-secret-67890",
        )
        .unwrap();
    assert_eq!(
        store
            .get_credential_metadata(&owner, "same-ref")
            .unwrap()
            .label,
        "Owner"
    );
    assert_eq!(
        store
            .get_credential_metadata(&other, "same-ref")
            .unwrap()
            .label,
        "Other"
    );
    assert_eq!(
        store
            .create_credential(
                &owner,
                "same-ref",
                "openai",
                "Duplicate",
                "sk-another-test-key"
            )
            .unwrap_err()
            .error_code(),
        "credential_ref_exists",
    );
    let (owner_secret, _) = store
        .open_credential_for_pinned_inference(&owner, "same-ref", 1)
        .unwrap();
    let (other_secret, _) = store
        .open_credential_for_pinned_inference(&other, "same-ref", 1)
        .unwrap();
    assert_eq!(owner_secret, "sk-owner-secret-12345");
    assert_eq!(other_secret, "sk-other-secret-67890");
    store
        .rotate_credential(
            &owner,
            "same-ref",
            Some("\"cred-v1\""),
            "sk-owner-rotated-secret",
            None,
        )
        .unwrap();
    let (owner_rotated, _) = store
        .open_credential_for_pinned_inference(&owner, "same-ref", 2)
        .unwrap();
    let (other_unchanged, _) = store
        .open_credential_for_pinned_inference(&other, "same-ref", 1)
        .unwrap();
    assert_eq!(owner_rotated, "sk-owner-rotated-secret");
    assert_eq!(other_unchanged, "sk-other-secret-67890");
}

#[test]
fn billing_ids_cannot_replace_another_accounts_records_or_wallet_hold() {
    let store = InMemoryTransactionalStore::new_with_dev_fixtures();
    let account_a = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000001".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };
    let account_b = AuthenticatedPrincipal {
        account_id: "00000000-0000-4000-8000-000000000002".to_string(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: true,
    };
    let initial_wallet = store.get_hosted_credit_wallet(&account_a);
    assert_eq!(initial_wallet.available_minor_units, 0);
    assert_eq!(initial_wallet.lifetime_purchased_minor_units, 0);

    let create_quote = |principal: &AuthenticatedPrincipal, id: &str| {
        store.create_usage_quote(
            principal,
            Some(id),
            "syllabus_generation",
            BillingModeKind::HostedCredits,
            "openai",
            "test-model",
            100,
            100,
            0,
            0,
            1_800_000_000,
            900,
        )
    };
    create_quote(&account_a, "shared-quote").unwrap();
    assert_eq!(
        create_quote(&account_b, "shared-quote")
            .unwrap_err()
            .error_code(),
        "usage_quote_id_exists"
    );
    assert_eq!(
        store
            .read_inner()
            .usage_quotes
            .get("shared-quote")
            .unwrap()
            .quote
            .account_id,
        account_a.account_id
    );
    create_quote(&account_b, "quote-b").unwrap();

    store.set_wallet_balance_for_test(&account_a.account_id, 200, 0);
    store.set_wallet_balance_for_test(&account_b.account_id, 200, 0);
    store
        .create_credit_reservation(
            &account_a,
            Some("shared-reservation"),
            "shared-quote",
            "idem-a",
            Some(100),
            1_800_000_000,
        )
        .unwrap();
    assert_eq!(
        store
            .create_credit_reservation(
                &account_b,
                Some("shared-reservation"),
                "quote-b",
                "idem-b",
                Some(100),
                1_800_000_000,
            )
            .unwrap_err()
            .error_code(),
        "credit_reservation_id_exists"
    );
    let wallet_b = store.get_hosted_credit_wallet(&account_b);
    assert_eq!(wallet_b.available_minor_units, 200);
    assert_eq!(wallet_b.reserved_minor_units, 0);
    assert!(store.list_ledger_entries(&account_b).is_empty());
    assert_eq!(
        store
            .read_inner()
            .credit_reservations
            .get("shared-reservation")
            .unwrap()
            .reservation
            .account_id,
        account_a.account_id
    );

    let checkout = |principal: &AuthenticatedPrincipal, key: &str| {
        store.create_checkout_session(
            principal,
            Some("shared-checkout"),
            "starter",
            key,
            100,
            100,
            "https://example.edu/success",
            "https://example.edu/cancel",
        )
    };
    checkout(&account_a, "checkout-a").unwrap();
    assert_eq!(
        checkout(&account_b, "checkout-b").unwrap_err().error_code(),
        "checkout_session_id_exists"
    );
}

#[test]
fn open_catalog_workspace_files_load_and_validate_against_contract_schema() {
    let store = InMemoryTransactionalStore::new();
    let inserted = store.load_open_catalog_from_workspace();
    assert!(
            inserted >= 18,
            "expected at least 18 open catalog JSON files loaded from catalog/resources, got {inserted}"
        );
    let registry = syllabus_contracts::ContractRegistry::load_from_workspace()
        .expect("load contract registry");
    for res in store.list_catalog_resources(true) {
        registry
            .validate("resource.schema.json", &res.to_contract_json())
            .unwrap_or_else(|e| {
                panic!(
                    "open catalog resource `{}` failed resource.schema.json: {e}",
                    res.resource_version_id
                )
            });
    }
}

async fn wait_for_pg_outbox_receipt(pg_url: &str, job_id: &str) {
    let (client, connection) = tokio_postgres::connect(pg_url, tokio_postgres::NoTls)
        .await
        .expect("connect to check outbox receipt");
    tokio::spawn(async move {
        let _ = connection.await;
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if client
                .query_opt(
                    "SELECT 1 FROM worker_dispatch_receipts WHERE job_id = $1",
                    &[&job_id],
                )
                .await
                .expect("query outbox receipt")
                .is_some()
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for outbox receipt for {job_id}"));
}

#[tokio::test]
async fn postgres_runtime_store_persists_accounts_syllabi_byok_and_outbox_across_restarts() {
    let Ok(pg_url) = std::env::var("TEST_POSTGRES_URL") else {
        return;
    };
    let pg_url = pg_url.trim().to_string();
    if pg_url.is_empty() {
        return;
    }
    let namespace = format!(
        "test-ns-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(1)
    );

    let acct_id: String;
    {
        let store = InMemoryTransactionalStore::open_postgres(&pg_url, &namespace)
            .expect("open postgres-backed store (boot 1)");
        assert!(store.is_postgres_backed());
        assert_eq!(store.postgres_namespace(), Some(namespace.as_str()));

        let acct = store
            .authenticate_oauth_identity(
                syllabus_security::OAuthProvider::Google,
                "pg-alice-google",
                "pg-alice@example.test",
                true,
                Some("PG Alice"),
                None,
            )
            .expect("register pg-alice")
            .account;
        acct_id = acct.account_id.clone();

        let principal = AuthenticatedPrincipal {
            account_id: acct_id.clone(),
            roles: vec![PrincipalRole::User],
            is_development_only_identity: false,
        };
        store
            .commit_private_syllabus_revision(
                &principal,
                "syllabus-pg-persist-1",
                "rev-pg-persist-1",
                json!({ "title": "Persistent Postgres Syllabus", "modules": [] }),
            )
            .expect("commit syllabus revision");
        store
            .create_credential(
                &principal,
                "cred-pg-alice-openai",
                "openai",
                "Alice BYOK Key",
                "sk-live-alice-pg-secret-8899",
            )
            .expect("create encrypted BYOK credential");
    }

    // Boot 2: fresh store instance against the same PostgreSQL database and namespace
    {
        let restarted = InMemoryTransactionalStore::open_postgres(&pg_url, &namespace)
            .expect("reopen postgres-backed store (boot 2)");
        let logged_in = restarted
            .authenticate_oauth_identity(
                syllabus_security::OAuthProvider::Google,
                "pg-alice-google",
                "pg-alice@example.test",
                true,
                None,
                None,
            )
            .expect("OAuth identity must survive PostgreSQL restart");
        assert_eq!(logged_in.account.account_id, acct_id);
        let principal = AuthenticatedPrincipal {
            account_id: acct_id.clone(),
            roles: vec![PrincipalRole::User],
            is_development_only_identity: false,
        };
        let active = restarted
            .get_private_syllabus_revision(&principal, "rev-pg-persist-1")
            .expect("persisted active syllabus revision");
        assert_eq!(
            active.payload["title"],
            json!("Persistent Postgres Syllabus")
        );
        let (decrypted_secret, _cred_meta) = restarted
            .open_credential_for_pinned_inference(&principal, "cred-pg-alice-openai", 1)
            .expect("decrypt persisted BYOK envelope after restart");
        assert_eq!(decrypted_secret, "sk-live-alice-pg-secret-8899");
    }

    // Also verify PostgreSQL transactional outbox enqueue + claim/complete tick
    let job_id = format!("pg-job-{namespace}");
    crate::enqueue_pg_outbox_job(
        &pg_url,
        &job_id,
        &acct_id,
        "schedule_reminder_sync",
        &json!({ "syllabus_id": "syllabus-pg-persist-1" }),
    )
    .await
    .expect("enqueue pg outbox job");
    crate::run_pg_outbox_worker_tick(&pg_url, "pg-test-worker", 60)
        .await
        .expect("run pg outbox worker tick");
    wait_for_pg_outbox_receipt(&pg_url, &job_id).await;
}

#[tokio::test]
async fn postgres_cross_replica_web_workspaces_passkeys_recovery_and_dispatch_receipts() {
    let pg_url = std::env::var("TEST_POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .unwrap_or_default()
        .trim()
        .to_string();
    if pg_url.is_empty() {
        return;
    }
    let namespace = format!(
        "replica-ns-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(2)
    );

    let replica_a = InMemoryTransactionalStore::open_postgres(&pg_url, &namespace)
        .expect("open replica_a against PostgreSQL");
    let replica_b = InMemoryTransactionalStore::open_postgres(&pg_url, &namespace)
        .expect("open replica_b against PostgreSQL");

    let acct = replica_a
        .authenticate_oauth_identity(
            syllabus_security::OAuthProvider::Google,
            "replica-maya-google",
            "replica-maya@syllabus.build",
            true,
            Some("Maya"),
            None,
        )
        .expect("register account on replica_a")
        .account;
    let principal = AuthenticatedPrincipal {
        account_id: acct.account_id.clone(),
        roles: vec![PrincipalRole::User],
        is_development_only_identity: false,
    };

    // 1. Write web workspace + passkey on replica_a -> immediately visible on live replica_b
    let ws = replica_a
        .put_web_workspace(
            &principal,
            json!({
                "selectedSyllabusId": "syllabus-rag-python-001",
                "sealedByokEnvelopes": {
                    "openai": { "credential_ref": "cred-openai-1", "masked_suffix": "9a4F" }
                }
            }),
            None,
            1_776_000_000_000,
        )
        .expect("put_web_workspace on replica_a");
    assert_eq!(ws.revision, 1);

    replica_a
        .put_web_passkey(
            &principal,
            "pk-cred-replica-1",
            json!({
                "id": "pk-cred-replica-1",
                "passkeyUserId": acct.account_id,
                "counter": 1
            }),
            1_776_000_000_100,
        )
        .expect("put_web_passkey on replica_a");

    let synced_ws = replica_b
        .get_web_workspace(&principal)
        .expect("replica_b must observe replica_a workspace via revision sync");
    assert_eq!(synced_ws.revision, 1);
    assert_eq!(
        synced_ws.workspace_json["selectedSyllabusId"],
        json!("syllabus-rag-python-001")
    );

    let synced_pks = replica_b.list_web_passkeys(&principal);
    assert_eq!(synced_pks.len(), 1);
    assert_eq!(synced_pks[0].credential_id, "pk-cred-replica-1");

    // 2. Issue email verification on replica_a and confirm on replica_b.
    let verify_issued = replica_a
        .issue_email_verification_token(&principal, 1_776_000_000_200, 3_600_000)
        .expect("issue email verification on replica_a");
    let verified_acct = replica_b
        .confirm_email_verification_token(&verify_issued.token, 1_776_000_000_300)
        .expect("confirm email verification on replica_b");
    assert!(verified_acct.email_verified);

    // 3. Verify normalized row-level SQL tables and worker dispatch receipts in PostgreSQL.
    let email_job_id = format!("pg-dispatch-email-{namespace}");
    crate::enqueue_pg_outbox_job(
        &pg_url,
        &email_job_id,
        &acct.account_id,
        "email_verification",
        &json!({ "email": "replica-maya@syllabus.build", "code": "654321" }),
    )
    .await
    .expect("enqueue email_verification job");

    crate::run_pg_outbox_worker_tick(&pg_url, "pg-dispatch-worker", 60)
        .await
        .expect("run outbox worker tick");
    wait_for_pg_outbox_receipt(&pg_url, &email_job_id).await;

    let (pg_client, pg_conn) = tokio_postgres::connect(&pg_url, tokio_postgres::NoTls)
        .await
        .expect("connect direct tokio_postgres client");
    tokio::spawn(async move {
        let _ = pg_conn.await;
    });

    let scoped_acct = format!("{namespace}:{}", acct.account_id);
    let ws_row = pg_client
        .query_opt(
            "SELECT revision FROM web_account_workspaces WHERE account_id = $1",
            &[&scoped_acct],
        )
        .await
        .expect("query web_account_workspaces");
    assert_eq!(ws_row.map(|r| r.get::<_, i64>(0)), Some(1));

    let scoped_pk = format!("{namespace}:pk-cred-replica-1");
    let pk_row = pg_client
        .query_opt(
            "SELECT credential_id FROM web_passkey_credentials WHERE credential_id = $1",
            &[&scoped_pk],
        )
        .await
        .expect("query web_passkey_credentials");
    assert!(pk_row.is_some(), "expected row in web_passkey_credentials");

    let tok_count: i64 = pg_client
            .query_one(
                "SELECT COUNT(*)::BIGINT FROM web_auth_recovery_tokens WHERE account_id = $1 AND consumed_at_ms IS NOT NULL",
                &[&scoped_acct],
            )
            .await
            .expect("query web_auth_recovery_tokens")
            .get(0);
    assert_eq!(
        tok_count, 1,
        "email_verification token must be recorded consumed"
    );

    let receipt_row = pg_client
        .query_opt(
            "SELECT job_type, status FROM worker_dispatch_receipts WHERE job_id = $1",
            &[&email_job_id],
        )
        .await
        .expect("query worker_dispatch_receipts");
    assert!(
        receipt_row.is_some(),
        "expected durable receipt row in worker_dispatch_receipts"
    );
    let receipt = receipt_row.unwrap();
    assert_eq!(receipt.get::<_, String>(0), "email_verification");
}
