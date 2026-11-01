-- T14 Migration 0009: Durable Runtime Store Snapshots, Open Community Catalog Mirror, and Outbox Lease State Compatibility
-- Source of Truth: specs/product.md (T01, T02, T07A, CTRL-002, CTRL-030, NFR-006)

-- Durable write-through transactional runtime snapshot table for full StoreInner state persistence across restarts
CREATE TABLE IF NOT EXISTS runtime_store_snapshots (
    namespace TEXT PRIMARY KEY CHECK (length(namespace) BETWEEN 1 AND 128),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
    snapshot_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queryable mirror of open Git-tracked & manually ingested community catalog resources
CREATE TABLE IF NOT EXISTS open_catalog_resources (
    resource_version_id TEXT PRIMARY KEY CHECK (length(resource_version_id) BETWEEN 3 AND 160),
    subject TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    access_model TEXT NOT NULL,
    is_synthetic_fixture BOOLEAN NOT NULL DEFAULT FALSE,
    metadata_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_catalog_resources_subject_category
    ON open_catalog_resources (subject, category);

-- Ensure outbox_jobs accepts both 'in_flight' and 'leased' active worker claim states idempotently
ALTER TABLE outbox_jobs DROP CONSTRAINT IF EXISTS outbox_jobs_state_check;
ALTER TABLE outbox_jobs ADD CONSTRAINT outbox_jobs_state_check
    CHECK (state IN ('queued', 'in_flight', 'leased', 'succeeded', 'failed', 'canceled'));
