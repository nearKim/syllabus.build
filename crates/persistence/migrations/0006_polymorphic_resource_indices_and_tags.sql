-- Migration 0006: Polymorphic Resource Indices, Shared Taxonomy Tags, and Segment Coverage Anchors
-- Supports Step 1 (Local Fit Retrieval), Step 1.5 (Review Existing Fit), Step 2 (Delta Web Search Bypass),
-- and Step 4 (Polymorphic Resource Indexing for Books, YouTube Playlists, Courses, and Code Labs).

ALTER TABLE catalog_resources
    ADD COLUMN IF NOT EXISTS canonical_url_hash TEXT NULL CHECK (canonical_url_hash IS NULL OR length(canonical_url_hash) = 64),
    ADD COLUMN IF NOT EXISTS external_id TEXT NULL CHECK (external_id IS NULL OR length(external_id) BETWEEN 3 AND 256);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_resources_canonical_url_hash
    ON catalog_resources (canonical_url_hash)
    WHERE canonical_url_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_resources_external_id
    ON catalog_resources (external_id)
    WHERE external_id IS NOT NULL;

ALTER TABLE resource_versions
    ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'Engineering' CHECK (length(subject) BETWEEN 2 AND 80),
    ADD COLUMN IF NOT EXISTS topic_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS supported_math_depths TEXT[] NOT NULL DEFAULT ARRAY['intuition_first', 'applied', 'formal']::TEXT[],
    ADD COLUMN IF NOT EXISTS supported_roles TEXT[] NOT NULL DEFAULT ARRAY['instruction']::TEXT[],
    ADD COLUMN IF NOT EXISTS index_descriptor JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_resource_versions_subject_review
    ON resource_versions (subject, review_status, access_model);

CREATE INDEX IF NOT EXISTS idx_resource_versions_topic_tags_gin
    ON resource_versions USING GIN (topic_tags);

ALTER TABLE objective_catalog_anchors
    ADD COLUMN IF NOT EXISTS segment_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS supported_depth TEXT NOT NULL DEFAULT 'formal' CHECK (
        supported_depth IN ('intuition_first', 'applied', 'application_focused', 'formal')
    ),
    ADD COLUMN IF NOT EXISTS instructional_role TEXT NOT NULL DEFAULT 'instruction' CHECK (
        instructional_role IN ('instruction', 'practice', 'assessment')
    );
