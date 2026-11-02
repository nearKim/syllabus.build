//! Embedded SQL migrations and PostgreSQL transactional SQL statement builders.

use std::fmt::Write;

use serde::{Deserialize, Serialize};

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
pub const POLYMORPHIC_RESOURCE_INDICES_AND_TAGS_MIGRATION_SQL: &str =
    include_str!("../migrations/0006_polymorphic_resource_indices_and_tags.sql");
pub const INCREMENTAL_CATALOG_AND_HYBRID_INDEX_MIGRATION_SQL: &str =
    include_str!("../migrations/0007_incremental_catalog_and_hybrid_index.sql");
pub const OAUTH_IDENTITIES_AND_PASSWORD_AUTH_MIGRATION_SQL: &str =
    include_str!("../migrations/0008_oauth_identities_and_password_auth.sql");
pub const RUNTIME_STORE_AND_OPEN_CATALOG_MIGRATION_SQL: &str =
    include_str!("../migrations/0009_runtime_store_and_open_catalog.sql");
pub const WEB_WORKSPACES_AND_WORKER_DISPATCH_MIGRATION_SQL: &str =
    include_str!("../migrations/0010_web_workspaces_and_worker_dispatch.sql");
pub const USER_ADMIN_ROLES_MIGRATION_SQL: &str =
    include_str!("../migrations/0011_user_admin_roles.sql");
pub const APPLE_OAUTH_MIGRATION_SQL: &str = include_str!("../migrations/0012_apple_oauth.sql");

/// Embedded PostgreSQL migration descriptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqlMigration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

/// Ordered registry of embedded PostgreSQL migrations (`T00`–`T14`).
pub const MIGRATIONS: [SqlMigration; 13] = [
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
    SqlMigration {
        version: 6,
        name: "0006_polymorphic_resource_indices_and_tags.sql",
        sql: POLYMORPHIC_RESOURCE_INDICES_AND_TAGS_MIGRATION_SQL,
    },
    SqlMigration {
        version: 7,
        name: "0007_incremental_catalog_and_hybrid_index.sql",
        sql: INCREMENTAL_CATALOG_AND_HYBRID_INDEX_MIGRATION_SQL,
    },
    SqlMigration {
        version: 8,
        name: "0008_oauth_identities_and_password_auth.sql",
        sql: OAUTH_IDENTITIES_AND_PASSWORD_AUTH_MIGRATION_SQL,
    },
    SqlMigration {
        version: 9,
        name: "0009_runtime_store_and_open_catalog.sql",
        sql: RUNTIME_STORE_AND_OPEN_CATALOG_MIGRATION_SQL,
    },
    SqlMigration {
        version: 10,
        name: "0010_web_workspaces_and_worker_dispatch.sql",
        sql: WEB_WORKSPACES_AND_WORKER_DISPATCH_MIGRATION_SQL,
    },
    SqlMigration {
        version: 11,
        name: "0011_user_admin_roles.sql",
        sql: USER_ADMIN_ROLES_MIGRATION_SQL,
    },
    SqlMigration {
        version: 12,
        name: "0012_apple_oauth.sql",
        sql: APPLE_OAUTH_MIGRATION_SQL,
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
            database_url: "postgres://postgres:postgres@localhost:5432/syllabus_dev".to_string(),
            max_connections: 10,
        }
    }
}

/// Parameterized PostgreSQL transactional SQL adapter and migration bundle builder (`T01`, `CTRL-002`, `CTRL-030`, `NFR-006`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PostgresTransactionalStatements;

impl PostgresTransactionalStatements {
    /// Concatenates all embedded `MIGRATIONS` (`0000`–`0005`) in lexical/version order wrapped in a transaction (`BEGIN; ... COMMIT;`).
    #[must_use]
    pub fn render_full_migration_bundle() -> String {
        let mut bundle = String::from("BEGIN;\n\n");
        for migration in &MIGRATIONS {
            let _ = write!(
                bundle,
                "-- === Migration {:04}: {} ===\n{}\n\n",
                migration.version,
                migration.name,
                migration.sql.trim()
            );
        }
        bundle.push_str("COMMIT;\n");
        bundle
    }

    /// Canonical `SELECT ... FOR UPDATE SKIP LOCKED` outbox job claim statement (`T01`, `@S24`).
    #[must_use]
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
    #[must_use]
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
    #[must_use]
    pub fn idempotency_begin_sql() -> &'static str {
        "INSERT INTO idempotency_keys (account_id, operation_id, idempotency_key, request_sha256, state, expires_at) \
         VALUES ($1, $2, $3, $4, 'in_flight', $5) \
         ON CONFLICT (account_id, operation_id, idempotency_key) DO NOTHING \
         RETURNING account_id, operation_id, idempotency_key, request_sha256, state, response_status, response_body;"
    }

    /// Canonical tenant-scoped optimistic concurrency schedule update SQL (`T01`, `@S22`, `@S24`).
    #[must_use]
    pub fn optimistic_schedule_update_sql() -> &'static str {
        "UPDATE schedule_revisions \
         SET etag_version = etag_version + 1, \
             timezone = COALESCE($4, timezone), \
             weekly_available_minutes = COALESCE($5, weekly_available_minutes), \
             required_minutes = COALESCE($6, required_minutes), \
             feasibility_status = $7, \
             sessions_json = COALESCE($8, sessions_json) \
         WHERE account_id = $1 AND syllabus_id = $2 AND etag_version = $3 \
         RETURNING schedule_revision_id, account_id, syllabus_id, syllabus_revision_id, etag_version, feasibility_status;"
    }

    /// Canonical `pg_stat_user_tables` bloat and autovacuum monitoring query (`T01`).
    #[must_use]
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

    /// Parameterized upsert of a single L2-normalized sublinear TF-IDF term weight into `catalog_resource_tfidf_terms` (`T02`, `CTRL-002`).
    #[must_use]
    pub fn upsert_tfidf_term_sql() -> &'static str {
        "INSERT INTO catalog_resource_tfidf_terms (resource_version_id, term, raw_tf, sublinear_tf, normalized_tfidf_weight, updated_at) \
         VALUES ($1, $2, $3, $4, $5, NOW()) \
         ON CONFLICT (resource_version_id, term) DO UPDATE SET \
             raw_tf = EXCLUDED.raw_tf, \
             sublinear_tf = EXCLUDED.sublinear_tf, \
             normalized_tfidf_weight = EXCLUDED.normalized_tfidf_weight, \
             updated_at = NOW();"
    }

    /// Parameterized SQL dot-product cosine similarity query over L2-normalized `catalog_resource_tfidf_terms` (`T02`, `CTRL-002`).
    #[must_use]
    pub fn tfidf_cosine_similarity_ranking_sql() -> &'static str {
        "WITH query_terms AS ( \
             SELECT UNNEST($1::TEXT[]) AS term, UNNEST($2::DOUBLE PRECISION[]) AS query_weight \
         ) \
         SELECT d.resource_version_id, \
                LEAST(1.0, GREATEST(0.0, SUM(q.query_weight * d.normalized_tfidf_weight))) AS cosine_similarity \
         FROM catalog_resource_tfidf_terms d \
         INNER JOIN query_terms q ON q.term = d.term \
         GROUP BY d.resource_version_id \
         HAVING SUM(q.query_weight * d.normalized_tfidf_weight) > 0.0 \
         ORDER BY cosine_similarity DESC, d.resource_version_id ASC;"
    }

    /// Built-in PostgreSQL full-text ranking query using `ts_rank_cd` and `websearch_to_tsquery('english', $1)` (`T02`, `CTRL-002`).
    #[must_use]
    pub fn pg_fts_rank_sql() -> &'static str {
        "SELECT resource_version_id, \
                ts_rank_cd(search_tsv, websearch_to_tsquery('english', $1)) AS rank_score \
         FROM resource_versions \
         WHERE search_tsv @@ websearch_to_tsquery('english', $1) \
         ORDER BY rank_score DESC, resource_version_id ASC;"
    }
}
