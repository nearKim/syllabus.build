//! Transactional PostgreSQL persistence boundary (`CTRL-002`).
//!
//! Full SQL migrations and repository implementations for identity, tenancy,
//! `Idempotency-Key` / `If-Match` preconditions, and transactional outbox queues
//! are implemented in Slice 1 (`T01`).

use serde::{Deserialize, Serialize};

pub const BASELINE_MIGRATION_SQL: &str = include_str!("../migrations/0000_t00_baseline.sql");

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_migration_sql_is_embedded() {
        assert!(BASELINE_MIGRATION_SQL.contains("SELECT 1;"));
    }
}
