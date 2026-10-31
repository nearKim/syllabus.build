-- T02 Migration 0003: Small Reviewed Catalog, Rights/Egress Guards, Quarantine Overlays,
-- and Deterministic Metadata + TF-IDF Cosine Retrieval
-- Source of Truth: specs/product.md (T02, CAT-001..CAT-008, OPS-001..OPS-005, CTRL-002, CTRL-010..CTRL-014, CTRL-020..CTRL-024)

-- Canonical catalog resource identity
CREATE TABLE IF NOT EXISTS catalog_resources (
    resource_id TEXT PRIMARY KEY CHECK (length(resource_id) BETWEEN 3 AND 128),
    provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 3 AND 128),
    provider_display_name TEXT NOT NULL CHECK (length(provider_display_name) BETWEEN 1 AND 200),
    canonical_url TEXT NOT NULL CHECK (canonical_url LIKE 'https://%'),
    resource_type TEXT NOT NULL CHECK (
        resource_type IN (
            'course', 'video', 'book', 'textbook', 'repository',
            'project', 'documentation', 'article', 'certification'
        )
    ),
    is_optional_certification BOOLEAN NOT NULL DEFAULT FALSE,
    official_issuer_url TEXT NULL CHECK (official_issuer_url IS NULL OR official_issuer_url LIKE 'https://%'),
    credential_distinction TEXT NULL CHECK (
        credential_distinction IS NULL OR credential_distinction IN (
            'assessed_credential', 'course_completion_certificate'
        )
    ),
    is_synthetic_fixture BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Versioned catalog resource snapshots; retrieval uses deterministic metadata filtering
-- and L2-normalized sublinear TF-IDF cosine similarity (`catalog_resource_tfidf_terms`).
CREATE TABLE IF NOT EXISTS resource_versions (
    resource_version_id TEXT PRIMARY KEY CHECK (length(resource_version_id) BETWEEN 3 AND 128),
    resource_id TEXT NOT NULL REFERENCES catalog_resources(resource_id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL CHECK (version_number >= 1),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    canonical_url TEXT NOT NULL CHECK (canonical_url LIKE 'https://%'),
    language TEXT NOT NULL CHECK (length(language) BETWEEN 2 AND 35),
    access_model TEXT NOT NULL CHECK (
        access_model IN (
            'free_public', 'paid_purchase', 'subscription', 'freemium_trial', 'unknown_price'
        )
    ),
    price_currency TEXT NULL CHECK (price_currency IS NULL OR length(price_currency) = 3),
    price_minor_units BIGINT NULL CHECK (price_minor_units IS NULL OR price_minor_units >= 0),
    requires_trial BOOLEAN NOT NULL DEFAULT FALSE,
    trial_covers_full_material BOOLEAN NOT NULL DEFAULT TRUE,
    subscription_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    review_status TEXT NOT NULL CHECK (
        review_status IN (
            'proposed', 'approved', 'rejected', 'quarantined', 'withdrawn', 'expired', 'retired'
        )
    ),
    is_synthetic_fixture BOOLEAN NOT NULL DEFAULT FALSE,
    etag_version BIGINT NOT NULL DEFAULT 1 CHECK (etag_version >= 1),
    payload_json JSONB NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (resource_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_resource_versions_deterministic_filter
    ON resource_versions (review_status, language, access_model, is_synthetic_fixture);

-- Operation-specific reuse and ingestion permissions (CAT-003, CTRL-010, CTRL-011, @S05)
CREATE TABLE IF NOT EXISTS acquisition_permissions (
    resource_version_id TEXT PRIMARY KEY REFERENCES resource_versions(resource_version_id) ON DELETE CASCADE,
    basis TEXT NOT NULL CHECK (
        basis IN (
            'open_license', 'provider_agreement', 'explicit_permission',
            'metadata_only', 'no_permission', 'unknown'
        )
    ),
    link_and_metadata_only BOOLEAN NOT NULL DEFAULT TRUE,
    store_metadata_allowed BOOLEAN NOT NULL DEFAULT TRUE,
    embed_metadata_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    model_metadata_submission_allowed BOOLEAN NOT NULL DEFAULT TRUE,
    full_text_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    embedding_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    model_submission_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    assessment_derivation_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    excerpt_display_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    redistribution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    rights_evidence_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    reviewed_by TEXT NULL,
    reviewed_at TIMESTAMPTZ NULL
);

-- Curator credibility and accuracy review records (CAT-002, CAT-008, CTRL-020, CTRL-021, @S04, @S36)
CREATE TABLE IF NOT EXISTS resource_review_records (
    review_id TEXT PRIMARY KEY CHECK (length(review_id) BETWEEN 3 AND 128),
    resource_id TEXT NOT NULL REFERENCES catalog_resources(resource_id) ON DELETE RESTRICT,
    resource_version_id TEXT NOT NULL REFERENCES resource_versions(resource_version_id) ON DELETE RESTRICT,
    curator_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'quarantine', 'retire')),
    credibility_basis TEXT NOT NULL CHECK (
        credibility_basis IN ('institutional', 'expert_practitioner', 'community_vetted', 'unclassified')
    ),
    verified_author_identity BOOLEAN NOT NULL DEFAULT FALSE,
    sampled_technical_accuracy_verified BOOLEAN NOT NULL DEFAULT FALSE,
    rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 3000),
    evidence_json JSONB NOT NULL DEFAULT '[]'::JSONB,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_review_records_version
    ON resource_review_records (resource_version_id, reviewed_at DESC);

-- Permission-aware freshness checks; failed refreshes never fabricate fresh verification (OPS-002, @S07)
CREATE TABLE IF NOT EXISTS resource_freshness_checks (
    check_id TEXT PRIMARY KEY CHECK (length(check_id) BETWEEN 3 AND 128),
    resource_version_id TEXT NOT NULL REFERENCES resource_versions(resource_version_id) ON DELETE CASCADE,
    link_status TEXT NOT NULL CHECK (link_status IN ('reachable', 'broken', 'unknown')),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_reachable_at TIMESTAMPTZ NULL,
    failure_reason TEXT NULL
);

-- Deterministic objective-to-resource mapping anchors (CAT-001, CAT-004, T02)
CREATE TABLE IF NOT EXISTS objective_catalog_anchors (
    objective_id TEXT NOT NULL CHECK (length(objective_id) BETWEEN 3 AND 128),
    resource_version_id TEXT NOT NULL REFERENCES resource_versions(resource_version_id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL CHECK (length(topic_id) BETWEEN 3 AND 128),
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (objective_id, resource_version_id)
);

CREATE INDEX IF NOT EXISTS idx_objective_catalog_anchors_objective
    ON objective_catalog_anchors (objective_id, is_primary);

-- Active quarantine and rights-revocation overlays that override stale search indexes or snapshots
-- without mutating historical SyllabusRevision records (CAT-006, CAT-007, CTRL-014, CTRL-024, @S07, @S09, @S63)
CREATE TABLE IF NOT EXISTS resource_quarantine_overlays (
    overlay_id TEXT PRIMARY KEY CHECK (length(overlay_id) BETWEEN 3 AND 128),
    resource_version_id TEXT NOT NULL UNIQUE REFERENCES resource_versions(resource_version_id) ON DELETE RESTRICT,
    actor_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    reason_code TEXT NOT NULL CHECK (reason_code IN ('quarantined', 'rights_revoked', 'unavailable', 'stale')),
    rationale TEXT NOT NULL,
    replacement_resource_version_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    active BOOLEAN NOT NULL DEFAULT TRUE,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
