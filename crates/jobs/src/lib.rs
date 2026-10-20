//! Background job state machine and transactional outbox configuration (`GEN-001`, `T01`).
//!
//! Full PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` worker loops, lease reaping,
//! retention pruning, crash recovery, autovacuum/bloat monitoring, and multi-worker
//! load tests are implemented in Slice 1 (`T01`).

use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_job_states_classified_correctly() {
        assert!(!GenerationJobState::Queued.is_terminal());
        assert!(!GenerationJobState::Generating.is_terminal());
        assert!(GenerationJobState::Succeeded.is_terminal());
        assert!(GenerationJobState::Failed.is_terminal());
        assert!(GenerationJobState::Canceled.is_terminal());
    }
}
