//! Background job worker binary (`T00`–`T01` transactional outbox worker loop, lease reaper, and bloat health monitor).

use curriculum_contracts::ContractRegistry;
use curriculum_jobs::{
    evaluate_pg_bloat_health, OutboxJobQueue, OutboxQueueConfig, PgBloatHealthReport,
    PgTableTupleStats, QueueMetricsSnapshot,
};
use curriculum_persistence::{PostgresTransactionalStatements, MIGRATIONS};
use curriculum_providers::{DeterministicFakeProvider, InferenceProvider};

pub fn verify_worker_bootstrap() -> OutboxQueueConfig {
    let _registry = ContractRegistry::load_from_workspace()
        .expect("contract registry must load cleanly on worker bootstrap");
    let fake_provider = DeterministicFakeProvider::default();
    assert_eq!(fake_provider.capabilities().provider_id, "deterministic-fake");
    let migration_bundle = PostgresTransactionalStatements::render_full_migration_bundle();
    assert!(migration_bundle.contains("CREATE TABLE IF NOT EXISTS outbox_jobs"));
    assert!(PostgresTransactionalStatements::claim_next_outbox_job_sql()
        .contains("FOR UPDATE SKIP LOCKED"));
    assert_eq!(MIGRATIONS.len(), 6);
    OutboxQueueConfig::default()
}

/// Runs one maintenance and dispatch tick on an `OutboxJobQueue`:
/// 1. Reaps expired leases (`reap_expired_leases`).
/// 2. Claims and completes available queued jobs for `worker_id`.
/// 3. Prunes retained terminal jobs past retention windows (`prune_retained_jobs`).
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

pub fn check_worker_pg_bloat_health(stats: &[PgTableTupleStats]) -> PgBloatHealthReport {
    evaluate_pg_bloat_health(stats, 0.20)
}

#[tokio::main]
async fn main() {
    let cfg = verify_worker_bootstrap();
    let queue = OutboxJobQueue::new(cfg);
    let snapshot = run_worker_maintenance_tick(&queue, "worker-main", 1_000);
    println!(
        "curriculum-worker bootstrap verified (lease={}s, max_attempts={}, queued={})",
        cfg.lease_duration_seconds, cfg.max_attempts, snapshot.queued_depth
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
                json!({"curriculum_id": "cur-1"}),
                1_000,
            )
            .unwrap();

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
