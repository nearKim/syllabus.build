-- T01 Migration 0002: HTTP Idempotency Keys, Transactional Outbox Queue, and Post-Restore Deletion Tombstones
-- Source of Truth: specs/product.md (T01, CTRL-002, CTRL-030, NFR-006, @S24, @S43, @S45)

-- Tenant-scoped HTTP Idempotency-Key registry for retriable effect-producing commands
CREATE TABLE IF NOT EXISTS idempotency_keys (
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 2 AND 128),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
    state TEXT NOT NULL CHECK (state IN ('in_flight', 'completed')),
    response_status INTEGER NULL CHECK (response_status IS NULL OR (response_status >= 100 AND response_status < 500)),
    response_body JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (account_id, operation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
    ON idempotency_keys (expires_at)
    WHERE state = 'completed';

-- Transactional Outbox Queue for asynchronous background jobs (SELECT ... FOR UPDATE SKIP LOCKED)
CREATE TABLE IF NOT EXISTS outbox_jobs (
    job_id TEXT PRIMARY KEY CHECK (length(job_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK (length(job_type) BETWEEN 2 AND 128),
    state TEXT NOT NULL CHECK (state IN ('queued', 'in_flight', 'succeeded', 'failed', 'canceled')),
    payload_json JSONB NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    locked_by TEXT NULL,
    locked_until TIMESTAMPTZ NULL,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index optimized for concurrent worker polling via SELECT ... FOR UPDATE SKIP LOCKED
-- and expired lease reaping
CREATE INDEX IF NOT EXISTS idx_outbox_jobs_skip_locked_ready
    ON outbox_jobs (available_at ASC, created_at ASC)
    WHERE state IN ('queued', 'in_flight');

CREATE INDEX IF NOT EXISTS idx_outbox_jobs_retention_prune
    ON outbox_jobs (state, completed_at)
    WHERE state IN ('succeeded', 'failed', 'canceled');

-- Append-only deletion and revocation tombstones for post-backup-restore replay (@S43, @S45, NFR-006)
CREATE TABLE IF NOT EXISTS deletion_tombstones (
    tombstone_id TEXT PRIMARY KEY CHECK (length(tombstone_id) BETWEEN 3 AND 128),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('account_deleted', 'credential_revoked', 'session_revoked', 'resource_withdrawn')),
    account_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_after_restore_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_deletion_tombstones_account_target
    ON deletion_tombstones (entity_type, account_id, target_id);
