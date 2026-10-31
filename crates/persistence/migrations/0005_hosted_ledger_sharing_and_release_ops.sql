-- T07B, T07C, T07D, T13, T09 Migration 0005:
-- Hosted Inference Credit Ledger, Quotes, Reservations & Settlements (T07B),
-- Additional Live Providers Support (T07C),
-- Payment Checkout Sessions, Signed Webhooks & Ambiguous-Timeout Reconciliation (T07D),
-- Public Templates, Discovery, Partial Adoption, Upvotes & Moderation (T13),
-- Account Export/Deletion Lifecycle & Operational Tombstones (T09).
-- Source of Truth: specs/product.md (BILL-001..BILL-008, SHARE-001..SHARE-010, ADAPT-005, CAT-001..CAT-007, OPS-001..OPS-006, NFR-001..NFR-008)

-- =============================================================================
-- T07B: Hosted Credit Wallets, Usage Quotes, Credit Reservations & Ledger Entries
-- =============================================================================

CREATE TABLE IF NOT EXISTS hosted_credit_wallets (
    account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    available_minor_units BIGINT NOT NULL DEFAULT 0,
    reserved_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (reserved_minor_units >= 0),
    lifetime_purchased_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_purchased_minor_units >= 0),
    lifetime_settled_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_settled_minor_units >= 0),
    lifetime_refunded_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_refunded_minor_units >= 0),
    etag TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_quotes (
    quote_id TEXT PRIMARY KEY CHECK (length(quote_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    operation_kind TEXT NOT NULL CHECK (length(operation_kind) BETWEEN 1 AND 64),
    billing_mode TEXT NOT NULL CHECK (billing_mode IN ('hosted_credits', 'byok')),
    provider_id TEXT NOT NULL CHECK (provider_id IN ('openai', 'anthropic', 'google-gemini', 'google')),
    model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 128),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    estimated_minor_units BIGINT NOT NULL CHECK (estimated_minor_units >= 0),
    max_reservable_minor_units BIGINT NOT NULL CHECK (
        max_reservable_minor_units >= 0 AND max_reservable_minor_units >= estimated_minor_units
    ),
    external_byok_estimated_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (external_byok_estimated_minor_units >= 0),
    learning_materials_estimated_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (learning_materials_estimated_minor_units >= 0),
    pricing_snapshot_version TEXT NOT NULL DEFAULT 'pricing-2026-03-v1',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_quotes_account_expires
    ON usage_quotes (account_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS credit_reservations (
    reservation_id TEXT PRIMARY KEY CHECK (length(reservation_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    quote_id TEXT NOT NULL REFERENCES usage_quotes(quote_id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
    operation_kind TEXT NOT NULL CHECK (length(operation_kind) BETWEEN 1 AND 64),
    provider_id TEXT NOT NULL CHECK (provider_id IN ('openai', 'anthropic', 'google-gemini', 'google')),
    model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 128),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    reserved_minor_units BIGINT NOT NULL CHECK (reserved_minor_units >= 0),
    settled_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (
        settled_minor_units >= 0 AND settled_minor_units <= reserved_minor_units
    ),
    released_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (
        released_minor_units >= 0 AND released_minor_units <= reserved_minor_units
    ),
    status TEXT NOT NULL CHECK (
        status IN ('reserved', 'settled', 'released', 'expired')
    ),
    correlation_id TEXT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at TIMESTAMPTZ NULL,
    UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_account_status
    ON credit_reservations (account_id, status, expires_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
    ledger_entry_id TEXT PRIMARY KEY CHECK (length(ledger_entry_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    entry_kind TEXT NOT NULL CHECK (
        entry_kind IN (
            'top_up_credit',
            'reservation_hold',
            'reservation_settlement',
            'reservation_release',
            'refund_debit',
            'chargeback_debit',
            'reconciliation_release'
        )
    ),
    cost_bucket TEXT NOT NULL CHECK (
        cost_bucket IN (
            'service_access',
            'hosted_ai_inference',
            'external_byok_estimate',
            'learning_materials_and_exams'
        )
    ),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    delta_available_minor_units BIGINT NOT NULL,
    delta_reserved_minor_units BIGINT NOT NULL DEFAULT 0,
    balance_after_available_minor_units BIGINT NOT NULL,
    balance_after_reserved_minor_units BIGINT NOT NULL CHECK (balance_after_reserved_minor_units >= 0),
    quote_id TEXT NULL REFERENCES usage_quotes(quote_id) ON DELETE SET NULL,
    reservation_id TEXT NULL REFERENCES credit_reservations(reservation_id) ON DELETE SET NULL,
    checkout_session_id TEXT NULL,
    webhook_event_id TEXT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_created
    ON ledger_entries (account_id, created_at DESC);

-- =============================================================================
-- T07D: Payment Checkout Sessions & Signed Webhook Events
-- =============================================================================

CREATE TABLE IF NOT EXISTS checkout_sessions (
    checkout_session_id TEXT PRIMARY KEY CHECK (length(checkout_session_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    package_id TEXT NOT NULL CHECK (length(package_id) BETWEEN 3 AND 128),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
    credit_minor_units BIGINT NOT NULL CHECK (credit_minor_units > 0),
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'completed', 'expired', 'refunded', 'disputed')
    ),
    checkout_url TEXT NOT NULL CHECK (checkout_url LIKE 'https://%'),
    success_url TEXT NOT NULL CHECK (success_url LIKE 'https://%'),
    cancel_url TEXT NOT NULL CHECK (cancel_url LIKE 'https://%'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_account
    ON checkout_sessions (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    provider_event_id TEXT PRIMARY KEY CHECK (length(provider_event_id) BETWEEN 3 AND 128),
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'checkout.session.completed',
            'charge.refunded',
            'charge.dispute.created'
        )
    ),
    checkout_session_id TEXT NOT NULL REFERENCES checkout_sessions(checkout_session_id) ON DELETE RESTRICT,
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
    signature_sha256 TEXT NOT NULL CHECK (length(signature_sha256) = 64),
    ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(ledger_entry_id) ON DELETE RESTRICT,
    payload_json JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- T13: Public Templates, Previews, Revisions, Upvotes, Reports & Moderation
-- =============================================================================

CREATE TABLE IF NOT EXISTS publication_previews (
    preview_id TEXT PRIMARY KEY CHECK (length(preview_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_id TEXT NOT NULL CHECK (length(syllabus_id) BETWEEN 3 AND 128),
    syllabus_revision_id TEXT NOT NULL CHECK (length(syllabus_revision_id) BETWEEN 3 AND 128),
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted')),
    preview_sha256 TEXT NOT NULL CHECK (length(preview_sha256) = 64),
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    stripped_private_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    withheld_restricted_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    sanitized_payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publication_previews_account_syllabus
    ON publication_previews (account_id, syllabus_id, created_at DESC);

CREATE TABLE IF NOT EXISTS publications (
    publication_id TEXT PRIMARY KEY CHECK (length(publication_id) BETWEEN 3 AND 128),
    owner_account_id TEXT NULL REFERENCES accounts(account_id) ON DELETE SET NULL,
    source_syllabus_id TEXT NOT NULL CHECK (length(source_syllabus_id) BETWEEN 3 AND 128),
    public_author_id TEXT NOT NULL CHECK (length(public_author_id) BETWEEN 3 AND 128),
    publisher_display_name TEXT NOT NULL CHECK (length(publisher_display_name) BETWEEN 1 AND 80),
    visibility TEXT NOT NULL CHECK (
        visibility IN ('private', 'unlisted', 'public', 'withdrawn', 'quarantined', 'removed')
    ),
    current_revision_id TEXT NOT NULL CHECK (length(current_revision_id) BETWEEN 3 AND 128),
    latest_revision_number INTEGER NOT NULL CHECK (latest_revision_number >= 1),
    etag TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    withdrawn_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_publications_visibility_published
    ON publications (visibility, published_at DESC);

CREATE TABLE IF NOT EXISTS publication_revisions (
    publication_revision_id TEXT PRIMARY KEY CHECK (length(publication_revision_id) BETWEEN 3 AND 128),
    publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    supersedes_publication_revision_id TEXT NULL,
    source_syllabus_revision_id TEXT NOT NULL CHECK (length(source_syllabus_revision_id) BETWEEN 3 AND 128),
    preview_sha256 TEXT NOT NULL CHECK (length(preview_sha256) = 64),
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    upvote_count BIGINT NOT NULL DEFAULT 0 CHECK (upvote_count >= 0),
    snapshot_json JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (publication_id, revision_number),
    UNIQUE (content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_publication_revisions_publication
    ON publication_revisions (publication_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS publication_upvotes (
    publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
    publication_revision_id TEXT NOT NULL REFERENCES publication_revisions(publication_revision_id) ON DELETE CASCADE,
    voter_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (publication_revision_id, voter_account_id)
);

CREATE TABLE IF NOT EXISTS publication_reports (
    report_id TEXT PRIMARY KEY CHECK (length(report_id) BETWEEN 3 AND 128),
    publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
    publication_revision_id TEXT NOT NULL REFERENCES publication_revisions(publication_revision_id) ON DELETE CASCADE,
    reporter_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    reason_code TEXT NOT NULL CHECK (
        reason_code IN (
            'copyright_or_license_violation',
            'private_data_exposure',
            'unsafe_or_abusive_content',
            'misleading_pedagogical_claims',
            'spam_or_duplicate'
        )
    ),
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'quarantined', 'removed', 'restored', 'dismissed')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_publication_reports_status
    ON publication_reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_actions (
    action_id TEXT PRIMARY KEY CHECK (length(action_id) BETWEEN 3 AND 128),
    publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
    moderator_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    action_kind TEXT NOT NULL CHECK (
        action_kind IN ('quarantine', 'remove', 'restore', 'dismiss_reports')
    ),
    previous_visibility TEXT NOT NULL,
    new_visibility TEXT NOT NULL,
    rationale TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- T09: Account Export Jobs & Account Deletion Requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS account_export_jobs (
    export_id TEXT PRIMARY KEY CHECK (length(export_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    schema_version TEXT NOT NULL DEFAULT '0.2.0',
    archive_sha256 TEXT NOT NULL CHECK (length(archive_sha256) = 64),
    export_payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
    deletion_request_id TEXT PRIMARY KEY CHECK (length(deletion_request_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL CHECK (length(account_id) BETWEEN 3 AND 128),
    status TEXT NOT NULL CHECK (status IN ('completed', 'tombstoned')),
    tombstoned_entities_count INTEGER NOT NULL CHECK (tombstoned_entities_count >= 1),
    withdrawn_publications_count INTEGER NOT NULL DEFAULT 0 CHECK (withdrawn_publications_count >= 0),
    retained_adopted_syllabi_count INTEGER NOT NULL DEFAULT 0 CHECK (retained_adopted_syllabi_count >= 0),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
