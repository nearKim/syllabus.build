-- Migration 0007: Incremental Catalog Auto-Indexing, Normalized Segments, and Native Full-Text / TF-IDF Search Index
-- Supports zero-deploy incremental catalog expansion (`catalog_changes`), normalized polymorphic segments
-- (`catalog_resource_segments`), built-in PostgreSQL `tsvector` + GIN (`search_tsv`), and `catalog_resource_tfidf_terms`.

ALTER TABLE resource_versions
    ADD COLUMN IF NOT EXISTS search_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_resource_versions_search_tsv_gin
    ON resource_versions USING GIN (search_tsv);

CREATE TABLE IF NOT EXISTS catalog_resource_tfidf_terms (
    resource_version_id TEXT NOT NULL REFERENCES resource_versions(resource_version_id) ON DELETE CASCADE,
    term TEXT NOT NULL CHECK (length(term) BETWEEN 2 AND 128),
    raw_tf INTEGER NOT NULL CHECK (raw_tf >= 1),
    sublinear_tf DOUBLE PRECISION NOT NULL CHECK (sublinear_tf >= 1.0),
    normalized_tfidf_weight DOUBLE PRECISION NOT NULL CHECK (
        normalized_tfidf_weight >= 0.0 AND normalized_tfidf_weight <= 1.0
    ),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (resource_version_id, term)
);

CREATE INDEX IF NOT EXISTS idx_catalog_resource_tfidf_terms_term
    ON catalog_resource_tfidf_terms (term, normalized_tfidf_weight DESC);

CREATE TABLE IF NOT EXISTS catalog_resource_segments (
    segment_row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_version_id TEXT NOT NULL REFERENCES resource_versions(resource_version_id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL CHECK (length(segment_id) BETWEEN 2 AND 128),
    segment_kind TEXT NOT NULL CHECK (
        segment_kind IN ('book_chapter', 'youtube_video', 'course_unit', 'repository_lab')
    ),
    ordinal_index INTEGER NOT NULL DEFAULT 0 CHECK (ordinal_index >= 0),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    topic_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    duration_minutes INTEGER NULL CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    segment_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (resource_version_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_resource_segments_version_ordinal
    ON catalog_resource_segments (resource_version_id, ordinal_index ASC);

CREATE INDEX IF NOT EXISTS idx_catalog_resource_segments_topic_tags_gin
    ON catalog_resource_segments USING GIN (topic_tags);

CREATE TABLE IF NOT EXISTS catalog_changes (
    seq BIGSERIAL PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES catalog_resources(resource_id) ON DELETE CASCADE,
    resource_version_id TEXT NOT NULL REFERENCES resource_versions(resource_version_id) ON DELETE CASCADE,
    change_kind TEXT NOT NULL CHECK (
        change_kind IN (
            'discovered_web_resource',
            'manual_curator_upsert',
            'segment_reindex',
            'quarantine_state_change'
        )
    ),
    source_query TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_changes_seq_created
    ON catalog_changes (seq ASC, created_at ASC);
