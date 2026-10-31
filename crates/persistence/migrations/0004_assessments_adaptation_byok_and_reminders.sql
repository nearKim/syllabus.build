-- T05, T06, T12, T07A, T08 Migration 0004:
-- Reviewed Assessments & Prerequisite Gates (T05), Schedule Revisions & Spaced Repetition (T06),
-- Objective Diagnostics, Waivers & Adaptation Proposals (T12), Encrypted BYOK Credentials & Usage Records (T07A),
-- and Notification Preferences, Push Subscriptions & Reminder Occurrences (T08).
-- Source of Truth: specs/product.md (PED-002..PED-010, SCH-001..SCH-005, BILL-001..BILL-008, REM-001..REM-005, CTRL-021..CTRL-023, CTRL-050..CTRL-051, NFR-006, NFR-007)

-- =============================================================================
-- T05: Reviewed Anchor Assessments, Attempts, Assistance Events, Defect Reports,
--      Answer-Key Corrections, and Prerequisite Gate Audit Events
-- =============================================================================

CREATE TABLE IF NOT EXISTS reviewed_assessments (
    assessment_id TEXT PRIMARY KEY CHECK (length(assessment_id) BETWEEN 3 AND 128),
    objective_id TEXT NOT NULL CHECK (length(objective_id) BETWEEN 3 AND 128),
    resource_version_id TEXT NOT NULL REFERENCES resource_versions(resource_version_id) ON DELETE RESTRICT,
    assessment_kind TEXT NOT NULL CHECK (assessment_kind IN ('reviewed_anchor', 'ai_practice')),
    review_status TEXT NOT NULL CHECK (
        review_status IN ('approved', 'quarantined', 'suspended', 'retired', 'unreviewed_practice')
    ),
    key_revision INTEGER NOT NULL DEFAULT 1 CHECK (key_revision >= 1),
    mastery_threshold_bp INTEGER NOT NULL DEFAULT 8000 CHECK (mastery_threshold_bp BETWEEN 1 AND 10000),
    allow_mastery_credit BOOLEAN NOT NULL DEFAULT TRUE,
    items_json JSONB NOT NULL DEFAULT '[]'::JSONB,
    answer_key_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    reviewed_by TEXT NULL,
    reviewed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviewed_assessments_objective
    ON reviewed_assessments (objective_id, assessment_kind, review_status);

CREATE TABLE IF NOT EXISTS assessment_attempts (
    attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    assessment_id TEXT NOT NULL REFERENCES reviewed_assessments(assessment_id) ON DELETE RESTRICT,
    objective_id TEXT NOT NULL CHECK (length(objective_id) BETWEEN 3 AND 128),
    session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 3 AND 128),
    assistance_level TEXT NOT NULL CHECK (
        assistance_level IN ('independent', 'hint_used', 'solution_studied')
    ),
    score_bp INTEGER NOT NULL CHECK (score_bp BETWEEN 0 AND 10000),
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    evidence_origin TEXT NOT NULL CHECK (
        evidence_origin IN (
            'independent_reviewed_attempt',
            'assisted_attempt',
            'self_reported',
            'activity_completion',
            'community_upvote',
            'unreviewed_ai_grade'
        )
    ),
    derived_proficiency_state TEXT NOT NULL CHECK (
        derived_proficiency_state IN (
            'unassessed', 'practiced', 'assisted_progress', 'demonstrated', 'mastered', 'needs_review'
        )
    ),
    key_revision INTEGER NOT NULL DEFAULT 1 CHECK (key_revision >= 1),
    recomputed_from_correction_id TEXT NULL,
    responses_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_account_objective
    ON assessment_attempts (account_id, objective_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS assessment_assistance_events (
    event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    assessment_id TEXT NOT NULL REFERENCES reviewed_assessments(assessment_id) ON DELETE RESTRICT,
    attempt_id TEXT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE CASCADE,
    item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
    assistance_level TEXT NOT NULL CHECK (
        assistance_level IN ('independent', 'hint_used', 'solution_studied')
    ),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_issue_reports (
    report_id TEXT PRIMARY KEY CHECK (length(report_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    assessment_id TEXT NOT NULL REFERENCES reviewed_assessments(assessment_id) ON DELETE RESTRICT,
    item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
    reason_code TEXT NOT NULL CHECK (
        reason_code IN ('broken_answer_key', 'ambiguous_prompt', 'out_of_scope', 'rendering_defect')
    ),
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'suspended_gate', 'resolved', 'dismissed')),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_key_corrections (
    correction_id TEXT PRIMARY KEY CHECK (length(correction_id) BETWEEN 3 AND 128),
    assessment_id TEXT NOT NULL REFERENCES reviewed_assessments(assessment_id) ON DELETE RESTRICT,
    curator_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    previous_key_revision INTEGER NOT NULL CHECK (previous_key_revision >= 1),
    new_key_revision INTEGER NOT NULL CHECK (new_key_revision > previous_key_revision),
    rationale TEXT NOT NULL,
    updated_answer_key_json JSONB NOT NULL,
    recomputed_attempt_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prerequisite_decision_audit_events (
    audit_event_id TEXT PRIMARY KEY CHECK (length(audit_event_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_id TEXT NOT NULL CHECK (length(syllabus_id) BETWEEN 3 AND 128),
    target_objective_id TEXT NOT NULL CHECK (length(target_objective_id) BETWEEN 3 AND 128),
    missing_prerequisite_objective_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    decision_kind TEXT NOT NULL CHECK (
        decision_kind IN (
            'blocked_missing_prerequisite',
            'prerequisite_override_recorded',
            'unverified_prerequisite_acknowledged'
        )
    ),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- T06: Schedule Revisions & Spaced Repetition Review Lifecycle
-- =============================================================================

CREATE TABLE IF NOT EXISTS schedule_revisions (
    schedule_revision_id TEXT PRIMARY KEY CHECK (length(schedule_revision_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_id TEXT NOT NULL CHECK (length(syllabus_id) BETWEEN 3 AND 128),
    syllabus_revision_id TEXT NOT NULL CHECK (length(syllabus_revision_id) BETWEEN 3 AND 128),
    revision_number BIGINT NOT NULL CHECK (revision_number >= 1),
    weekly_hours NUMERIC(5,2) NOT NULL CHECK (weekly_hours > 0),
    preferred_playback_speed NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (preferred_playback_speed BETWEEN 0.50 AND 3.00),
    etag TEXT NOT NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, syllabus_id, revision_number)
);

CREATE TABLE IF NOT EXISTS review_schedule_items (
    review_item_id TEXT PRIMARY KEY CHECK (length(review_item_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_id TEXT NOT NULL CHECK (length(syllabus_id) BETWEEN 3 AND 128),
    objective_id TEXT NOT NULL CHECK (length(objective_id) BETWEEN 3 AND 128),
    source_session_id TEXT NOT NULL CHECK (length(source_session_id) BETWEEN 3 AND 128),
    scheduled_session_id TEXT NOT NULL CHECK (
        length(scheduled_session_id) BETWEEN 3 AND 128 AND scheduled_session_id <> source_session_id
    ),
    interval_index INTEGER NOT NULL CHECK (interval_index >= 0),
    interval_days INTEGER NOT NULL CHECK (interval_days >= 1),
    interval_policy_version TEXT NOT NULL DEFAULT 'spaced-v1',
    status TEXT NOT NULL CHECK (
        status IN ('scheduled', 'due', 'completed', 'overdue', 'rescheduled')
    ),
    due_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_schedule_items_account_status
    ON review_schedule_items (account_id, syllabus_id, status, due_at);

-- =============================================================================
-- T12: Objective Diagnostics, Waivers, and Adaptation Proposals
-- =============================================================================

CREATE TABLE IF NOT EXISTS diagnostic_sessions (
    diagnostic_id TEXT PRIMARY KEY CHECK (length(diagnostic_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_id TEXT NULL,
    topic_id TEXT NOT NULL CHECK (length(topic_id) BETWEEN 3 AND 128),
    status TEXT NOT NULL CHECK (
        status IN ('in_progress', 'completed', 'stopped_by_learner', 'uncertainty_bound_reached')
    ),
    stop_reason TEXT NULL CHECK (
        stop_reason IS NULL OR stop_reason IN ('all_items_answered', 'learner_stopped', 'uncertainty_bound_reached')
    ),
    math_depth_preference TEXT NOT NULL DEFAULT 'formal' CHECK (
        math_depth_preference IN ('formal', 'intuitive', 'applied')
    ),
    evaluated_objectives_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    items_json JSONB NOT NULL DEFAULT '[]'::JSONB,
    attempts_json JSONB NOT NULL DEFAULT '[]'::JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS objective_waivers (
    waiver_id TEXT PRIMARY KEY CHECK (length(waiver_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    objective_id TEXT NOT NULL CHECK (length(objective_id) BETWEEN 3 AND 128),
    evidence_kind TEXT NOT NULL CHECK (
        evidence_kind IN ('diagnostic_demonstrated', 'reviewed_anchor_passed', 'equivalent_reviewed_credential')
    ),
    source_evidence_ref TEXT NOT NULL CHECK (length(source_evidence_ref) BETWEEN 3 AND 128),
    equivalence_mapping_id TEXT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, objective_id)
);

CREATE TABLE IF NOT EXISTS adaptation_proposals (
    proposal_id TEXT PRIMARY KEY CHECK (length(proposal_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_id TEXT NOT NULL CHECK (length(syllabus_id) BETWEEN 3 AND 128),
    base_syllabus_revision_id TEXT NOT NULL CHECK (length(base_syllabus_revision_id) BETWEEN 3 AND 128),
    base_schedule_revision_id TEXT NOT NULL CHECK (length(base_schedule_revision_id) BETWEEN 3 AND 128),
    status TEXT NOT NULL CHECK (
        status IN ('pending_confirmation', 'accepted', 'rejected', 'superseded', 'expired')
    ),
    proposal_sha256 TEXT NOT NULL CHECK (length(proposal_sha256) = 64),
    accepted_syllabus_revision_id TEXT NULL,
    accepted_schedule_revision_id TEXT NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_adaptation_proposals_syllabus
    ON adaptation_proposals (account_id, syllabus_id, created_at DESC);

-- =============================================================================
-- T07A: Encrypted BYOK Credential Vault & Inference Usage Records
-- =============================================================================

CREATE TABLE IF NOT EXISTS provider_credentials (
    credential_id TEXT PRIMARY KEY CHECK (length(credential_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL CHECK (provider_id IN ('openai', 'anthropic', 'google')),
    label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
    custody_mode TEXT NOT NULL DEFAULT 'encrypted_account_vault' CHECK (
        custody_mode IN ('encrypted_account_vault')
    ),
    status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'invalid')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    key_Last4_redacted TEXT NOT NULL CHECK (key_Last4_redacted LIKE '...%'),
    key_fingerprint_sha256 TEXT NOT NULL CHECK (length(key_fingerprint_sha256) = 64),
    ciphertext_hex TEXT NOT NULL,
    nonce_hex TEXT NOT NULL CHECK (length(nonce_hex) = 32),
    auth_tag_hex TEXT NOT NULL CHECK (length(auth_tag_hex) = 64),
    allow_hosted_fallback BOOLEAN NOT NULL DEFAULT FALSE CHECK (allow_hosted_fallback = FALSE),
    etag TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    last_verified_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_account
    ON provider_credentials (account_id, provider_id, status);

CREATE TABLE IF NOT EXISTS inference_usage_records (
    usage_record_id TEXT PRIMARY KEY CHECK (length(usage_record_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL REFERENCES provider_credentials(credential_id) ON DELETE RESTRICT,
    credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
    provider_id TEXT NOT NULL CHECK (provider_id IN ('openai', 'anthropic', 'google')),
    model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 128),
    operation_kind TEXT NOT NULL CHECK (length(operation_kind) BETWEEN 1 AND 64),
    prompt_tokens BIGINT NOT NULL CHECK (prompt_tokens >= 0),
    completion_tokens BIGINT NOT NULL CHECK (completion_tokens >= 0),
    total_tokens BIGINT NOT NULL CHECK (total_tokens >= 0),
    usage_source TEXT NOT NULL CHECK (usage_source IN ('provider_reported', 'application_estimated')),
    estimated_provider_cost_usd_micros BIGINT NOT NULL CHECK (estimated_provider_cost_usd_micros >= 0),
    hosted_service_charge_usd_micros BIGINT NOT NULL DEFAULT 0 CHECK (hosted_service_charge_usd_micros = 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inference_usage_records_account
    ON inference_usage_records (account_id, recorded_at DESC);

-- =============================================================================
-- T08: Notification Preferences, Push Subscriptions & Reminder Occurrences
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
    account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    channel TEXT NOT NULL DEFAULT 'in_app' CHECK (
        channel IN ('none', 'in_app', 'web_push', 'email_digest')
    ),
    iana_timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(iana_timezone) BETWEEN 2 AND 64),
    local_time_hhmm TEXT NOT NULL DEFAULT '19:00' CHECK (local_time_hhmm ~ '^[0-2][0-9]:[0-5][0-9]$'),
    days_of_week INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
    quiet_hours_start_hhmm TEXT NULL CHECK (quiet_hours_start_hhmm IS NULL OR quiet_hours_start_hhmm ~ '^[0-2][0-9]:[0-5][0-9]$'),
    quiet_hours_end_hhmm TEXT NULL CHECK (quiet_hours_end_hhmm IS NULL OR quiet_hours_end_hhmm ~ '^[0-2][0-9]:[0-5][0-9]$'),
    etag TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    subscription_id TEXT PRIMARY KEY CHECK (length(subscription_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    endpoint_url TEXT NOT NULL CHECK (endpoint_url LIKE 'https://%'),
    p256dh_key TEXT NOT NULL,
    auth_secret TEXT NOT NULL,
    user_agent TEXT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account
    ON push_subscriptions (account_id, active);

CREATE TABLE IF NOT EXISTS reminder_occurrences (
    occurrence_id TEXT PRIMARY KEY CHECK (length(occurrence_id) BETWEEN 3 AND 128),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    syllabus_id TEXT NULL,
    scheduled_local_date TEXT NOT NULL CHECK (length(scheduled_local_date) = 10),
    scheduled_utc TIMESTAMPTZ NOT NULL,
    expires_utc TIMESTAMPTZ NOT NULL,
    snoozed_until_utc TIMESTAMPTZ NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'scheduled',
            'delivered',
            'snoozed',
            'completed',
            'suppressed_study_completed',
            'suppressed_quiet_hours',
            'suppressed_disabled',
            'expired_suppressed'
        )
    ),
    dst_resolution_policy TEXT NOT NULL DEFAULT 'exact_local_time' CHECK (
        dst_resolution_policy IN ('exact_local_time', 'spring_forward_shifted', 'fall_back_first_occurrence')
    ),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_account_status
    ON reminder_occurrences (account_id, status, scheduled_utc);
