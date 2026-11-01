-- Migration 0010: Row-level normalized web workspaces, passkey credentials,
-- auth recovery/verification tokens, revisioned runtime snapshots, and worker dispatch receipts.

ALTER TABLE runtime_store_snapshots
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS web_account_workspaces (
    account_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    workspace_json JSONB NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_account_workspaces_email
    ON web_account_workspaces (LOWER(email));

CREATE TABLE IF NOT EXISTS web_passkey_credentials (
    credential_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    email TEXT NOT NULL,
    credential_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_passkey_credentials_account
    ON web_passkey_credentials (account_id);

CREATE TABLE IF NOT EXISTS web_auth_recovery_tokens (
    token_sha256 TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
    expires_at_ms BIGINT NOT NULL,
    consumed_at_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_auth_recovery_tokens_account_purpose
    ON web_auth_recovery_tokens (account_id, purpose);

CREATE TABLE IF NOT EXISTS worker_dispatch_receipts (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT,
    status TEXT NOT NULL CHECK (status IN ('sent', 'logged_dry_run', 'verified', 'quarantined', 'failed')),
    detail_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_dispatch_receipts_job_type
    ON worker_dispatch_receipts (job_type, dispatched_at DESC);
