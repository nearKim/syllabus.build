//! Background job worker binary (`T00`–`T01` transactional outbox worker loop, lease reaper, and bloat health monitor).

use syllabus_contracts::ContractRegistry;
use syllabus_jobs::{
    evaluate_pg_bloat_health, OutboxJobQueue, OutboxQueueConfig, PgBloatHealthReport,
    PgTableTupleStats, QueueMetricsSnapshot,
};
use syllabus_persistence::{
    apply_migrations_to_postgres, run_pg_outbox_worker_tick, PostgresTransactionalStatements,
    MIGRATIONS,
};
use syllabus_providers::{DeterministicFakeProvider, InferenceProvider};

const DEFAULT_WORKER_ID: &str = "worker-main";
const INITIAL_TICK_NOW_MS: u64 = 1_000;
const EXPECTED_MIGRATION_COUNT: usize = 12;
const DEFAULT_MAX_DEAD_TUPLE_RATIO: f64 = 0.20;
const DEFAULT_POLL_INTERVAL_MS: u64 = 2_000;

/// Verifies that the workspace contract registry, deterministic provider, and embedded SQL
/// migrations are consistent on worker startup, returning the default `OutboxQueueConfig`.
#[must_use]
pub fn verify_worker_bootstrap() -> OutboxQueueConfig {
    assert!(
        ContractRegistry::load_from_workspace().is_ok(),
        "contract registry must load cleanly on worker bootstrap"
    );
    let fake_provider = DeterministicFakeProvider::default();
    assert_eq!(
        fake_provider.capabilities().provider_id,
        "deterministic-fake"
    );
    let migration_bundle = PostgresTransactionalStatements::render_full_migration_bundle();
    assert!(migration_bundle.contains("CREATE TABLE IF NOT EXISTS outbox_jobs"));
    assert!(PostgresTransactionalStatements::claim_next_outbox_job_sql()
        .contains("FOR UPDATE SKIP LOCKED"));
    assert_eq!(MIGRATIONS.len(), EXPECTED_MIGRATION_COUNT);
    OutboxQueueConfig::default()
}

/// Runs one maintenance and dispatch tick on an `OutboxJobQueue`:
/// 1. Reaps expired leases (`reap_expired_leases`).
/// 2. Claims and completes available queued jobs for `worker_id`.
/// 3. Prunes retained terminal jobs past retention windows (`prune_retained_jobs`).
#[must_use]
pub fn run_worker_maintenance_tick(
    queue: &OutboxJobQueue,
    worker_id: &str,
    now_ms: u64,
) -> QueueMetricsSnapshot {
    let _ = queue.reap_expired_leases(now_ms);
    while let Some(job) = queue.claim_next_job(worker_id, now_ms) {
        let _ = queue.complete_job(&job.job_id, worker_id, now_ms);
    }
    let _ = queue.prune_retained_jobs(now_ms);
    queue.metrics_snapshot(now_ms)
}

/// Evaluates PostgreSQL table tuple bloat health against the worker's dead-tuple ratio threshold.
#[must_use]
pub fn check_worker_pg_bloat_health(stats: &[PgTableTupleStats]) -> PgBloatHealthReport {
    evaluate_pg_bloat_health(stats, DEFAULT_MAX_DEAD_TUPLE_RATIO)
}

#[tokio::main]
async fn main() {
    let cfg = verify_worker_bootstrap();
    let run_once = std::env::args().any(|arg| arg == "--once")
        || std::env::var("WORKER_RUN_ONCE")
            .ok()
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
    let worker_id = std::env::var("WORKER_ID")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_WORKER_ID.to_string());
    let poll_ms = std::env::var("WORKER_POLL_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_POLL_INTERVAL_MS)
        .max(100);

    if let Ok(db_url) = std::env::var("DATABASE_URL") {
        let trimmed_url = db_url.trim();
        if !trimmed_url.is_empty() {
            apply_migrations_to_postgres(trimmed_url)
                .await
                .expect("apply PostgreSQL migrations on worker startup");
            let first_tick = run_pg_outbox_worker_tick(
                trimmed_url,
                &worker_id,
                i64::from(cfg.lease_duration_seconds),
            )
            .await
            .expect("initial PostgreSQL outbox tick");
            println!(
                "syllabus-worker postgres outbox online (worker_id={worker_id}, lease={}s, completed={}, remaining_queued={})",
                cfg.lease_duration_seconds,
                first_tick.claimed_and_completed_job_ids.len(),
                first_tick.remaining_queued_count
            );
            if run_once {
                return;
            }
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(poll_ms));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(err) = run_pg_outbox_worker_tick(
                            trimmed_url,
                            &worker_id,
                            i64::from(cfg.lease_duration_seconds),
                        ).await {
                            eprintln!("syllabus-worker postgres tick error: {err}");
                        }
                    }
                    _ = tokio::signal::ctrl_c() => {
                        println!("syllabus-worker shutting down cleanly");
                        break;
                    }
                }
            }
            return;
        }
    }

    let queue = OutboxJobQueue::new(cfg);
    let snapshot = run_worker_maintenance_tick(&queue, &worker_id, INITIAL_TICK_NOW_MS);
    println!(
        "syllabus-worker bootstrap verified (storage=in_memory, lease={}s, max_attempts={}, queued={})",
        cfg.lease_duration_seconds, cfg.max_attempts, snapshot.queued_depth
    );
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn worker_bootstrap_verifies_contracts_and_provider_capabilities() {
        let cfg = verify_worker_bootstrap();
        assert_eq!(cfg.lease_duration_seconds, 60);
    }

    #[test]
    fn worker_maintenance_tick_reaps_claims_and_completes_outbox_jobs() {
        let cfg = verify_worker_bootstrap();
        let queue = OutboxJobQueue::new(cfg);
        queue
            .enqueue(
                "worker-job-1",
                "00000000-0000-4000-8000-000000000001",
                "schedule_reminder_sync",
                json!({"syllabus_id": "cur-1"}),
                1_000,
            )
            .expect("enqueue test job");

        let metrics = run_worker_maintenance_tick(&queue, "worker-test-1", 2_000);
        assert_eq!(metrics.queued_depth, 0);
        assert_eq!(metrics.succeeded_count, 1);

        let health = check_worker_pg_bloat_health(&[PgTableTupleStats {
            table_name: "outbox_jobs".to_string(),
            n_live_tup: 100,
            n_dead_tup: 5,
            last_autovacuum_age_seconds: Some(30),
        }]);
        assert!(health.is_healthy);
    }
}
