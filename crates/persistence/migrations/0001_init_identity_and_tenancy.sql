-- T01 Migration 0001: Identity, Tenant Isolation, Immutable Private Revisions,
-- Separate Public Template Projections, Schedule Optimistic Concurrency, and Append-Only Progress Events
-- Source of Truth: specs/product.md (T01, CTRL-002, CTRL-030, CTRL-070, NFR-001, NFR-006, NFR-007)

-- Authoritative tenant accounts table
CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY CHECK (length(account_id) BETWEEN 3 AND 128),
    email TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    roles TEXT[] NOT NULL DEFAULT ARRAY['learner']::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

-- Provider-neutral authenticated sessions (D11)
CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id TEXT PRIMARY KEY CHECK (length(session_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    token_sha256 TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
    roles TEXT[] NOT NULL DEFAULT ARRAY['learner']::TEXT[],
    is_development_only BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_account_id
    ON auth_sessions (account_id);

-- Tenant-scoped learner profile and availability settings
CREATE TABLE IF NOT EXISTS learner_profiles (
    account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    default_playback_speed DOUBLE PRECISION NOT NULL DEFAULT 1.0
        CHECK (default_playback_speed >= 0.5 AND default_playback_speed <= 3.0),
    weekly_available_minutes INTEGER NOT NULL DEFAULT 300
        CHECK (weekly_available_minutes >= 0 AND weekly_available_minutes <= 10080),
    etag_version BIGINT NOT NULL DEFAULT 1 CHECK (etag_version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable private learner syllabus revisions (SHARE-001, SHARE-002, NFR-007)
-- Strictly isolated identifier space: private revision IDs must never use the `pubrev_` prefix.
CREATE TABLE IF NOT EXISTS syllabus_revisions (
    revision_id TEXT PRIMARY KEY
        CHECK (length(revision_id) BETWEEN 3 AND 128 AND revision_id NOT LIKE 'pubrev_%'),
    syllabus_id TEXT NOT NULL
        CHECK (length(syllabus_id) BETWEEN 3 AND 128 AND syllabus_id NOT LIKE 'pub_%'),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    schema_version TEXT NOT NULL DEFAULT '0.3.0',
    candidate_sha256 TEXT NOT NULL CHECK (length(candidate_sha256) = 64),
    payload_json JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (syllabus_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_syllabus_revisions_tenant_syllabus
    ON syllabus_revisions (account_id, syllabus_id, revision_number DESC);

-- Separate storage projection and identifier namespace for immutable public/unlisted template revisions
-- (SHARE-001, SHARE-002, SHARE-007, CTRL-070, @S56, @S57)
CREATE TABLE IF NOT EXISTS public_template_revisions (
    publication_revision_id TEXT PRIMARY KEY
        CHECK (length(publication_revision_id) BETWEEN 7 AND 128 AND publication_revision_id LIKE 'pubrev_%'),
    publication_id TEXT NOT NULL
        CHECK (length(publication_id) BETWEEN 4 AND 128 AND publication_id LIKE 'pub_%'),
    publisher_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    source_private_revision_id TEXT NOT NULL REFERENCES syllabus_revisions(revision_id) ON DELETE RESTRICT,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted')),
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    preview_sha256 TEXT NOT NULL CHECK (length(preview_sha256) = 64),
    public_payload_json JSONB NOT NULL,
    upvote_count BIGINT NOT NULL DEFAULT 0 CHECK (upvote_count >= 0),
    quarantined_at TIMESTAMPTZ NULL,
    quarantine_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (publication_id, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_public_template_revisions_discovery
    ON public_template_revisions (visibility, created_at DESC)
    WHERE visibility = 'public' AND quarantined_at IS NULL;

-- Schedule revisions with optimistic concurrency etag_version (PROG-003, PROG-004, @S22, @S24)
CREATE TABLE IF NOT EXISTS schedule_revisions (
    schedule_revision_id TEXT PRIMARY KEY CHECK (length(schedule_revision_id) BETWEEN 3 AND 128),
    syllabus_id TEXT NOT NULL CHECK (length(syllabus_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_revision_id TEXT NOT NULL REFERENCES syllabus_revisions(revision_id) ON DELETE CASCADE,
    etag_version BIGINT NOT NULL DEFAULT 1 CHECK (etag_version >= 1),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    weekly_available_minutes INTEGER NOT NULL CHECK (weekly_available_minutes >= 0),
    required_minutes INTEGER NOT NULL CHECK (required_minutes >= 0),
    feasibility_status TEXT NOT NULL CHECK (feasibility_status IN ('feasible', 'infeasible')),
    sessions_json JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, syllabus_id, etag_version)
);

CREATE INDEX IF NOT EXISTS idx_schedule_revisions_latest
    ON schedule_revisions (account_id, syllabus_id, etag_version DESC);

-- Append-only learner progress events deduplicated by (account_id, event_id)
-- (PROG-001, PROG-004, PROG-005, @S16, @S21, @S24)
CREATE TABLE IF NOT EXISTS progress_events (
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 3 AND 128),
    syllabus_id TEXT NOT NULL CHECK (length(syllabus_id) BETWEEN 3 AND 128),
    activity_id TEXT NOT NULL CHECK (length(activity_id) BETWEEN 3 AND 128),
    event_type TEXT NOT NULL CHECK (event_type IN ('completed', 'skipped', 'study_time_reported')),
    evidence_origin TEXT NOT NULL DEFAULT 'self_reported_activity_completion'
        CHECK (evidence_origin IN ('self_reported_activity_completion', 'external_provider_import')),
    time_spent_minutes INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_minutes >= 0 AND time_spent_minutes <= 1440),
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
    payload_json JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_events_syllabus
    ON progress_events (account_id, syllabus_id, recorded_at ASC);
