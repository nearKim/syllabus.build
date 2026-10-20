//! Background job state machine and transactional outbox queue operations (`GEN-001`, `T01`).
//!
//! Implements PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` claim semantics, expired lease
//! reaping, retention pruning, worker-crash recovery with idempotent effect ledger,
//! `pg_stat_user_tables` autovacuum/bloat monitoring, and multi-worker concurrent load verification.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use thiserror::Error;

/// Canonical generation job lifecycle states (`Section 14.6`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerationJobState {
    Queued,
    Retrieving,
    Generating,
    Validating,
    Succeeded,
    Failed,
    CancelRequested,
    Canceled,
}

impl GenerationJobState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            GenerationJobState::Succeeded
                | GenerationJobState::Failed
                | GenerationJobState::Canceled
        )
    }
}

/// Operational parameters for the PostgreSQL transactional outbox queue (`T01`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutboxQueueConfig {
    pub lease_duration_seconds: u32,
    pub max_attempts: u32,
    pub completed_retention_days: u32,
    pub dead_letter_retention_days: u32,
}

impl Default for OutboxQueueConfig {
    fn default() -> Self {
        Self {
            lease_duration_seconds: 60,
            max_attempts: 5,
            completed_retention_days: 7,
            dead_letter_retention_days: 30,
        }
    }
}

/// Outbox queue row state corresponding to `outbox_jobs.state` in `0002_idempotency_and_outbox.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutboxJobState {
    Queued,
    InFlight,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutboxJobRecord {
    pub job_id: String,
    pub account_id: String,
    pub job_type: String,
    pub state: OutboxJobState,
    pub payload_json: Value,
    pub attempt_count: u32,
    pub max_attempts: u32,
    pub locked_by: Option<String>,
    pub locked_until_ms: Option<u64>,
    pub available_at_ms: u64,
    pub completed_at_ms: Option<u64>,
    pub created_at_ms: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueMetricsSnapshot {
    pub queued_depth: usize,
    pub in_flight_leased: usize,
    pub succeeded_count: usize,
    pub dead_letter_count: usize,
    pub reaped_leases_count: u64,
    pub max_queue_age_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReapLeasesReport {
    pub reaped_to_queued: usize,
    pub transitioned_to_dead_letter: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PruneJobsReport {
    pub pruned_succeeded: usize,
    pub pruned_dead_letter: usize,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OutboxQueueError {
    #[error("job `{0}` not found")]
    JobNotFound(String),
    #[error("job `{job_id}` is not currently leased by worker `{worker_id}`")]
    LeaseOwnershipMismatch { job_id: String, worker_id: String },
    #[error("duplicate job_id `{0}`")]
    DuplicateJobId(String),
}

/// Canonical SQL query used by `SELECT ... FOR UPDATE SKIP LOCKED` workers (`0002_idempotency_and_outbox.sql`).
pub const OUTBOX_CLAIM_SKIP_LOCKED_SQL: &str = r#"
WITH next_job AS (
    SELECT job_id
    FROM outbox_jobs
    WHERE state = 'queued'
      AND available_at <= $1
    ORDER BY available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE outbox_jobs j
SET state = 'in_flight',
    attempt_count = j.attempt_count + 1,
    locked_by = $2,
    locked_until = $1 + ($3 || ' seconds')::INTERVAL
FROM next_job
WHERE j.job_id = next_job.job_id
RETURNING j.*;
"#;

/// Canonical SQL query over `pg_stat_user_tables` for autovacuum & dead-tuple bloat monitoring (`T01`).
pub fn pg_bloat_monitoring_sql() -> &'static str {
    r#"
SELECT
    relname AS table_name,
    n_live_tup,
    n_dead_tup,
    CASE
        WHEN (n_live_tup + n_dead_tup) = 0 THEN 0.0
        ELSE ROUND((n_dead_tup::NUMERIC / (n_live_tup + n_dead_tup)::NUMERIC), 4)
    END AS dead_tuple_ratio,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(last_autovacuum, last_vacuum)))::BIGINT AS last_autovacuum_age_seconds
FROM pg_stat_user_tables
WHERE relname IN ('outbox_jobs', 'idempotency_keys', 'progress_events', 'schedule_revisions')
ORDER BY dead_tuple_ratio DESC;
"#
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PgTableTupleStats {
    pub table_name: String,
    pub n_live_tup: u64,
    pub n_dead_tup: u64,
    pub last_autovacuum_age_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PgTableBloatAlert {
    pub table_name: String,
    pub n_live_tup: u64,
    pub n_dead_tup: u64,
    pub dead_tuple_ratio: f64,
    pub recommended_action: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PgBloatHealthReport {
    pub inspected_tables: usize,
    pub dead_tuple_ratio_threshold: f64,
    pub alerted_tables: Vec<PgTableBloatAlert>,
    pub is_healthy: bool,
    pub diagnostic_sql: String,
}

/// Evaluates `pg_stat_user_tables` dead-tuple ratios against `dead_tuple_ratio_threshold` (`T01`).
pub fn evaluate_pg_bloat_health(
    stats: &[PgTableTupleStats],
    dead_tuple_ratio_threshold: f64,
) -> PgBloatHealthReport {
    let mut alerted_tables = Vec::new();
    for s in stats {
        let total = s.n_live_tup + s.n_dead_tup;
        let ratio = if total == 0 {
            0.0
        } else {
            (s.n_dead_tup as f64) / (total as f64)
        };
        if ratio > dead_tuple_ratio_threshold {
            alerted_tables.push(PgTableBloatAlert {
                table_name: s.table_name.clone(),
                n_live_tup: s.n_live_tup,
                n_dead_tup: s.n_dead_tup,
                dead_tuple_ratio: ratio,
                recommended_action: format!(
                    "VACUUM (ANALYZE) {}; tune autovacuum_vacuum_scale_factor for high-churn outbox/idempotency table",
                    s.table_name
                ),
            });
        }
    }

    PgBloatHealthReport {
        inspected_tables: stats.len(),
        dead_tuple_ratio_threshold,
        is_healthy: alerted_tables.is_empty(),
        alerted_tables,
        diagnostic_sql: pg_bloat_monitoring_sql().trim().to_string(),
    }
}

struct QueueInner {
    config: OutboxQueueConfig,
    jobs: BTreeMap<String, OutboxJobRecord>,
    insertion_order: Vec<String>,
    reaped_leases_count: u64,
    /// Idempotent committed effect ledger per `job_id` ensuring worker-crash recovery
    /// never duplicates committed side effects.
    committed_effects: BTreeSet<String>,
}

/// Thread-safe transactional outbox queue implementing `SELECT ... FOR UPDATE SKIP LOCKED`
/// worker claiming, lease reaping, retention pruning, metrics, and crash recovery (`T01`).
#[derive(Clone)]
pub struct OutboxJobQueue {
    inner: Arc<Mutex<QueueInner>>,
}

impl OutboxJobQueue {
    pub fn new(config: OutboxQueueConfig) -> Self {
        Self {
            inner: Arc::new(Mutex::new(QueueInner {
                config,
                jobs: BTreeMap::new(),
                insertion_order: Vec::new(),
                reaped_leases_count: 0,
                committed_effects: BTreeSet::new(),
            })),
        }
    }

    pub fn config(&self) -> OutboxQueueConfig {
        self.inner.lock().expect("queue lock").config
    }

    /// Enqueues a job transactionally into the outbox.
    pub fn enqueue(
        &self,
        job_id: impl Into<String>,
        account_id: impl Into<String>,
        job_type: impl Into<String>,
        payload_json: Value,
        now_ms: u64,
    ) -> Result<OutboxJobRecord, OutboxQueueError> {
        let job_id = job_id.into();
        let mut guard = self.inner.lock().expect("queue lock");
        if guard.jobs.contains_key(&job_id) {
            return Err(OutboxQueueError::DuplicateJobId(job_id));
        }
        let max_attempts = guard.config.max_attempts;
        let record = OutboxJobRecord {
            job_id: job_id.clone(),
            account_id: account_id.into(),
            job_type: job_type.into(),
            state: OutboxJobState::Queued,
            payload_json,
            attempt_count: 0,
            max_attempts,
            locked_by: None,
            locked_until_ms: None,
            available_at_ms: now_ms,
            completed_at_ms: None,
            created_at_ms: now_ms,
            last_error: None,
        };
        guard.insertion_order.push(job_id.clone());
        guard.jobs.insert(job_id, record.clone());
        Ok(record)
    }

    /// Atomically claims the next available `Queued` job using `SELECT ... FOR UPDATE SKIP LOCKED` semantics.
    /// If the next queued job's `attempt_count >= max_attempts`, transitions it to dead-letter (`Failed`)
    /// and continues scanning.
    pub fn claim_next_job(&self, worker_id: &str, now_ms: u64) -> Option<OutboxJobRecord> {
        let mut guard = self.inner.lock().expect("queue lock");
        let lease_ms = (guard.config.lease_duration_seconds as u64) * 1_000;
        let order = guard.insertion_order.clone();

        for job_id in order {
            if let Some(job) = guard.jobs.get_mut(&job_id) {
                if job.state == OutboxJobState::Queued && job.available_at_ms <= now_ms {
                    if job.attempt_count >= job.max_attempts {
                        job.state = OutboxJobState::Failed;
                        job.completed_at_ms = Some(now_ms);
                        job.last_error = Some("max_attempts_exceeded".to_string());
                        continue;
                    }
                    job.state = OutboxJobState::InFlight;
                    job.attempt_count += 1;
                    job.locked_by = Some(worker_id.to_string());
                    job.locked_until_ms = Some(now_ms + lease_ms);
                    return Some(job.clone());
                }
            }
        }
        None
    }

    /// Completes an `InFlight` job owned by `worker_id` and records its committed side effect idempotently.
    /// Returns `true` if the side effect was newly committed, or `false` if it had already been committed.
    pub fn complete_job(
        &self,
        job_id: &str,
        worker_id: &str,
        now_ms: u64,
    ) -> Result<bool, OutboxQueueError> {
        let mut guard = self.inner.lock().expect("queue lock");
        let job = guard
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| OutboxQueueError::JobNotFound(job_id.to_string()))?;

        if job.state != OutboxJobState::InFlight || job.locked_by.as_deref() != Some(worker_id) {
            return Err(OutboxQueueError::LeaseOwnershipMismatch {
                job_id: job_id.to_string(),
                worker_id: worker_id.to_string(),
            });
        }

        job.state = OutboxJobState::Succeeded;
        job.locked_by = None;
        job.locked_until_ms = None;
        job.completed_at_ms = Some(now_ms);

        let newly_committed = guard.committed_effects.insert(job_id.to_string());
        Ok(newly_committed)
    }

    /// Operation 3: Expired Lease Reaping (`reap_expired_leases(now_ms)`).
    /// Recovers `InFlight` jobs where `locked_until_ms < now_ms`, or transitions them to
    /// dead-letter (`Failed`) when `attempt_count >= max_attempts`.
    pub fn reap_expired_leases(&self, now_ms: u64) -> ReapLeasesReport {
        let mut guard = self.inner.lock().expect("queue lock");
        let mut reaped_to_queued = 0usize;
        let mut transitioned_to_dead_letter = 0usize;

        let job_ids: Vec<String> = guard.jobs.keys().cloned().collect();
        for job_id in job_ids {
            if let Some(job) = guard.jobs.get_mut(&job_id) {
                if job.state == OutboxJobState::InFlight {
                    if let Some(locked_until) = job.locked_until_ms {
                        if locked_until < now_ms {
                            job.locked_by = None;
                            job.locked_until_ms = None;
                            if job.attempt_count >= job.max_attempts {
                                job.state = OutboxJobState::Failed;
                                job.completed_at_ms = Some(now_ms);
                                job.last_error =
                                    Some("lease_expired_max_attempts_exceeded".to_string());
                                transitioned_to_dead_letter += 1;
                            } else {
                                job.state = OutboxJobState::Queued;
                                job.last_error =
                                    Some("worker_lease_expired_requeued".to_string());
                                reaped_to_queued += 1;
                            }
                        }
                    }
                }
            }
        }

        guard.reaped_leases_count += (reaped_to_queued + transitioned_to_dead_letter) as u64;
        ReapLeasesReport {
            reaped_to_queued,
            transitioned_to_dead_letter,
        }
    }

    /// Operation 1: Retention & Pruning (`prune_retained_jobs(now_ms)`).
    /// Removes completed jobs older than `completed_retention_days` and dead-letter jobs
    /// older than `dead_letter_retention_days`.
    pub fn prune_retained_jobs(&self, now_ms: u64) -> PruneJobsReport {
        let mut guard = self.inner.lock().expect("queue lock");
        let completed_cutoff_ms =
            (guard.config.completed_retention_days as u64) * 24 * 60 * 60 * 1_000;
        let dead_letter_cutoff_ms =
            (guard.config.dead_letter_retention_days as u64) * 24 * 60 * 60 * 1_000;

        let mut pruned_succeeded = 0usize;
        let mut pruned_dead_letter = 0usize;

        guard.jobs.retain(|_, job| match job.state {
            OutboxJobState::Succeeded => {
                let completed_at = job.completed_at_ms.unwrap_or(job.created_at_ms);
                if now_ms.saturating_sub(completed_at) >= completed_cutoff_ms {
                    pruned_succeeded += 1;
                    false
                } else {
                    true
                }
            }
            OutboxJobState::Failed | OutboxJobState::Canceled => {
                let completed_at = job.completed_at_ms.unwrap_or(job.created_at_ms);
                if now_ms.saturating_sub(completed_at) >= dead_letter_cutoff_ms {
                    pruned_dead_letter += 1;
                    false
                } else {
                    true
                }
            }
            OutboxJobState::Queued | OutboxJobState::InFlight => true,
        });

        let remaining_keys: BTreeSet<String> = guard.jobs.keys().cloned().collect();
        guard
            .insertion_order
            .retain(|id| remaining_keys.contains(id));

        PruneJobsReport {
            pruned_succeeded,
            pruned_dead_letter,
        }
    }

    /// Operation 2: Queue Metrics (`metrics_snapshot(now_ms)`).
    pub fn metrics_snapshot(&self, now_ms: u64) -> QueueMetricsSnapshot {
        let guard = self.inner.lock().expect("queue lock");
        let mut queued_depth = 0usize;
        let mut in_flight_leased = 0usize;
        let mut succeeded_count = 0usize;
        let mut dead_letter_count = 0usize;
        let mut max_queue_age_ms = 0u64;

        for job in guard.jobs.values() {
            match job.state {
                OutboxJobState::Queued => {
                    queued_depth += 1;
                    let age = now_ms.saturating_sub(job.created_at_ms);
                    if age > max_queue_age_ms {
                        max_queue_age_ms = age;
                    }
                }
                OutboxJobState::InFlight => {
                    in_flight_leased += 1;
                }
                OutboxJobState::Succeeded => {
                    succeeded_count += 1;
                }
                OutboxJobState::Failed | OutboxJobState::Canceled => {
                    dead_letter_count += 1;
                }
            }
        }

        QueueMetricsSnapshot {
            queued_depth,
            in_flight_leased,
            succeeded_count,
            dead_letter_count,
            reaped_leases_count: guard.reaped_leases_count,
            max_queue_age_ms,
        }
    }

    pub fn get_job(&self, job_id: &str) -> Option<OutboxJobRecord> {
        self.inner
            .lock()
            .expect("queue lock")
            .jobs
            .get(job_id)
            .cloned()
    }

    pub fn committed_effect_count(&self) -> usize {
        self.inner
            .lock()
            .expect("queue lock")
            .committed_effects
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeSet;

    #[test]
    fn terminal_job_states_classified_correctly() {
        assert!(!GenerationJobState::Queued.is_terminal());
        assert!(!GenerationJobState::Generating.is_terminal());
        assert!(GenerationJobState::Succeeded.is_terminal());
        assert!(GenerationJobState::Failed.is_terminal());
        assert!(GenerationJobState::Canceled.is_terminal());
    }

    #[test]
    fn t01_queue_metrics_lease_reaping_dead_letter_and_retention_pruning() {
        let cfg = OutboxQueueConfig {
            lease_duration_seconds: 60,
            max_attempts: 2,
            completed_retention_days: 7,
            dead_letter_retention_days: 30,
        };
        let queue = OutboxJobQueue::new(cfg);

        // Enqueue 2 jobs at t = 1_000ms
        queue
            .enqueue(
                "job-1",
                "00000000-0000-4000-8000-000000000001",
                "curriculum_generation",
                json!({"goal": "algebra"}),
                1_000,
            )
            .unwrap();
        queue
            .enqueue(
                "job-2",
                "00000000-0000-4000-8000-000000000001",
                "curriculum_generation",
                json!({"goal": "calculus"}),
                2_000,
            )
            .unwrap();

        let m0 = queue.metrics_snapshot(5_000);
        assert_eq!(m0.queued_depth, 2);
        assert_eq!(m0.max_queue_age_ms, 4_000);

        // Worker-1 claims job-1 and completes it at t = 10_000ms
        let claimed1 = queue.claim_next_job("worker-1", 5_000).unwrap();
        assert_eq!(claimed1.job_id, "job-1");
        assert!(queue.complete_job("job-1", "worker-1", 10_000).unwrap());

        // Worker-1 claims job-2 (attempt 1 of 2) at t = 10_000ms (lease until 70_000ms) and stalls
        let claimed2 = queue.claim_next_job("worker-1", 10_000).unwrap();
        assert_eq!(claimed2.job_id, "job-2");
        assert_eq!(claimed2.attempt_count, 1);

        // Reap at t = 75_000ms -> job-2 returns to Queued
        let reap1 = queue.reap_expired_leases(75_000);
        assert_eq!(reap1.reaped_to_queued, 1);
        assert_eq!(reap1.transitioned_to_dead_letter, 0);

        // Worker-2 claims job-2 (attempt 2 of 2) at t = 80_000ms (lease until 140_000ms) and stalls again
        let claimed2_retry = queue.claim_next_job("worker-2", 80_000).unwrap();
        assert_eq!(claimed2_retry.job_id, "job-2");
        assert_eq!(claimed2_retry.attempt_count, 2);

        // Reap at t = 150_000ms -> job-2 exceeds max_attempts (2) and transitions to dead-letter (`Failed`)
        let reap2 = queue.reap_expired_leases(150_000);
        assert_eq!(reap2.reaped_to_queued, 0);
        assert_eq!(reap2.transitioned_to_dead_letter, 1);

        let m1 = queue.metrics_snapshot(150_000);
        assert_eq!(m1.queued_depth, 0);
        assert_eq!(m1.in_flight_leased, 0);
        assert_eq!(m1.succeeded_count, 1);
        assert_eq!(m1.dead_letter_count, 1);
        assert_eq!(m1.reaped_leases_count, 2);

        // Prune after 8 days (completed_retention_days = 7, dead_letter_retention_days = 30)
        let eight_days_ms = 8 * 24 * 60 * 60 * 1_000;
        let prune1 = queue.prune_retained_jobs(150_000 + eight_days_ms);
        assert_eq!(prune1.pruned_succeeded, 1);
        assert_eq!(prune1.pruned_dead_letter, 0);

        // Prune after 31 days -> dead-letter job is also pruned
        let thirty_one_days_ms = 31 * 24 * 60 * 60 * 1_000;
        let prune2 = queue.prune_retained_jobs(150_000 + thirty_one_days_ms);
        assert_eq!(prune2.pruned_succeeded, 0);
        assert_eq!(prune2.pruned_dead_letter, 1);
    }

    #[test]
    fn t01_worker_crash_recovery_reaps_lease_and_prevents_stale_worker_commit() {
        let queue = OutboxJobQueue::new(OutboxQueueConfig::default());
        queue
            .enqueue(
                "job-crash-1",
                "00000000-0000-4000-8000-000000000001",
                "schedule_reminder_sync",
                json!({"curriculum_id": "cur-1"}),
                1_000,
            )
            .unwrap();

        // Worker A claims job-crash-1 at t = 1_000ms (lease expires at 61_000ms) and crashes mid-lease
        let lease_a = queue.claim_next_job("worker-a", 1_000).unwrap();
        assert_eq!(lease_a.job_id, "job-crash-1");
        assert_eq!(lease_a.attempt_count, 1);

        // Lease expires at t = 62_000ms and is reaped
        let reap = queue.reap_expired_leases(62_000);
        assert_eq!(reap.reaped_to_queued, 1);

        // Worker B claims the recovered job and completes it cleanly
        let lease_b = queue.claim_next_job("worker-b", 63_000).unwrap();
        assert_eq!(lease_b.job_id, "job-crash-1");
        assert_eq!(lease_b.attempt_count, 2);

        // If zombie Worker A wakes up and tries to complete with its stale lease, it is rejected
        assert_eq!(
            queue
                .complete_job("job-crash-1", "worker-a", 64_000)
                .unwrap_err(),
            OutboxQueueError::LeaseOwnershipMismatch {
                job_id: "job-crash-1".to_string(),
                worker_id: "worker-a".to_string(),
            }
        );

        // Worker B commits the job; effect is recorded exactly once
        assert!(queue.complete_job("job-crash-1", "worker-b", 65_000).unwrap());
        assert_eq!(queue.committed_effect_count(), 1);
    }

    #[test]
    fn t01_pg_autovacuum_and_bloat_monitoring_flags_high_dead_tuple_tables() {
        let sql = pg_bloat_monitoring_sql();
        assert!(sql.contains("pg_stat_user_tables"));
        assert!(sql.contains("n_dead_tup"));
        assert!(sql.contains("n_live_tup"));
        assert!(sql.contains("outbox_jobs"));

        let stats = vec![
            PgTableTupleStats {
                table_name: "outbox_jobs".to_string(),
                n_live_tup: 400,
                n_dead_tup: 600, // 60% dead tuples > 20% threshold
                last_autovacuum_age_seconds: Some(3600),
            },
            PgTableTupleStats {
                table_name: "idempotency_keys".to_string(),
                n_live_tup: 950,
                n_dead_tup: 50, // 5% dead tuples <= 20% threshold
                last_autovacuum_age_seconds: Some(120),
            },
        ];

        let report = evaluate_pg_bloat_health(&stats, 0.20);
        assert_eq!(report.inspected_tables, 2);
        assert!(!report.is_healthy);
        assert_eq!(report.alerted_tables.len(), 1);
        assert_eq!(report.alerted_tables[0].table_name, "outbox_jobs");
        assert!((report.alerted_tables[0].dead_tuple_ratio - 0.60).abs() < 1e-6);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn t01_multi_worker_concurrent_load_test_4_workers_200_jobs_zero_duplicates() {
        let queue = OutboxJobQueue::new(OutboxQueueConfig::default());
        for i in 0..200 {
            queue
                .enqueue(
                    format!("job-{i:03}"),
                    "00000000-0000-4000-8000-000000000001",
                    "concurrent_load_test",
                    json!({"index": i}),
                    1_000,
                )
                .unwrap();
        }

        let mut handles = Vec::new();
        for w in 0..4 {
            let q = queue.clone();
            let worker_id = format!("worker-{w}");
            handles.push(tokio::spawn(async move {
                let mut processed = Vec::new();
                while let Some(job) = q.claim_next_job(&worker_id, 2_000) {
                    tokio::task::yield_now().await;
                    let newly_committed = q
                        .complete_job(&job.job_id, &worker_id, 3_000)
                        .expect("complete leased job");
                    assert!(newly_committed, "job {} committed more than once", job.job_id);
                    processed.push(job.job_id);
                }
                processed
            }));
        }

        let mut all_processed = Vec::new();
        for handle in handles {
            let worker_jobs = handle.await.expect("worker task panicked");
            all_processed.extend(worker_jobs);
        }

        assert_eq!(
            all_processed.len(),
            200,
            "all 200 jobs must be processed with 0 dropped and 0 duplicates"
        );
        let unique: BTreeSet<String> = all_processed.into_iter().collect();
        assert_eq!(unique.len(), 200, "every job must be processed exactly once");

        let metrics = queue.metrics_snapshot(4_000);
        assert_eq!(metrics.queued_depth, 0);
        assert_eq!(metrics.in_flight_leased, 0);
        assert_eq!(metrics.succeeded_count, 200);
        assert_eq!(metrics.dead_letter_count, 0);
        assert_eq!(queue.committed_effect_count(), 200);
    }
}
