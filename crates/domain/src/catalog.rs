//! Catalog access models, review states, acquisition permissions, goal intake, and SSRF egress validation.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::DomainError;

/// Catalog access pricing model (`CAT-005`, `@S05`, `@S06`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogAccessModel {
    #[serde(alias = "free")]
    FreePublic,
    #[serde(alias = "paid", alias = "purchase", alias = "library_loan")]
    PaidPurchase,
    Subscription,
    #[serde(
        alias = "freemium_optional_certificate",
        alias = "freemium",
        alias = "free_audit"
    )]
    FreemiumTrial,
    #[serde(alias = "unknown")]
    UnknownPrice,
}

/// Curator review lifecycle state for a catalog resource version (`CAT-002`, `@S04`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceReviewStatus {
    Approved,
    UnderReview,
    Quarantined,
    Rejected,
    Withdrawn,
    Deprecated,
}

/// Freshness state for a catalog resource version (`CAT-004`, `@S07`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceFreshnessState {
    Healthy,
    Degraded,
    Broken,
    Unchecked,
}

/// Operation attempted against a catalog resource (`CAT-003`, `@S05`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceOperationKind {
    Metadata,
    LinkOut,
    ShortExcerpt,
    FullTextStorage,
    Embedding,
    Redistribution,
}

impl ResourceOperationKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            ResourceOperationKind::Metadata => "metadata",
            ResourceOperationKind::LinkOut => "link_out",
            ResourceOperationKind::ShortExcerpt => "short_excerpt",
            ResourceOperationKind::FullTextStorage => "full_text_storage",
            ResourceOperationKind::Embedding => "embedding",
            ResourceOperationKind::Redistribution => "redistribution",
        }
    }
}

/// Granular acquisition and rights permission matrix (`CAT-003`, `@S05`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcquisitionPermission {
    pub allow_metadata: bool,
    pub allow_link_out: bool,
    pub allow_short_excerpt: bool,
    pub allow_full_text_storage: bool,
    pub allow_embedding: bool,
    pub allow_redistribution: bool,
    pub license_spdx_or_custom: String,
    pub requires_attribution: bool,
    pub attribution_text: Option<String>,
    pub notes: Option<String>,
}

impl AcquisitionPermission {
    /// Pure domain policy evaluating whether `operation` is permitted by this rights record (`CAT-003`, `@S05`).
    #[must_use]
    pub fn permits(&self, operation: ResourceOperationKind) -> bool {
        match operation {
            ResourceOperationKind::Metadata => self.allow_metadata,
            ResourceOperationKind::LinkOut => self.allow_link_out,
            ResourceOperationKind::ShortExcerpt => self.allow_short_excerpt,
            ResourceOperationKind::FullTextStorage => self.allow_full_text_storage,
            ResourceOperationKind::Embedding => self.allow_embedding,
            ResourceOperationKind::Redistribution => self.allow_redistribution,
        }
    }
}

/// Normalized learner goal specification value object (`GOAL-001`..`GOAL-005`, `T03`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalSpecification {
    pub topic: String,
    pub target_role_or_outcome: String,
    pub prior_background_level: String,
    pub weekly_available_minutes: u32,
    pub horizon_weeks: u32,
    pub free_only: bool,
    pub budget_currency: String,
    pub max_budget_minor_units: u64,
    pub owned_subscription_ids: Vec<String>,
    pub allow_paid_fallback: bool,
    pub include_optional_certification: bool,
    pub clarifying_questions: Vec<String>,
    pub proposed_objectives: Vec<String>,
    pub feasibility_warning: Option<String>,
}

/// Single authoritative outbound URL egress validator enforcing HTTPS scheme,
/// rejection of userinfo credentials, loopback/private/link-local/metadata IP ranges,
/// and DNS host allowlist membership (`CAT-003`, `@S08`, `@S31`, `@S35`).
pub fn validate_outbound_egress_url(
    url: &str,
    allowed_hosts: &[&str],
) -> Result<String, DomainError> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "only https:// URLs are permitted for outbound catalog egress".to_string(),
        });
    }
    let after_scheme = &trimmed["https://".len()..];
    let authority = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "missing URL host authority".to_string(),
        });
    }
    if authority.contains('@') {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "URL userinfo credentials are forbidden".to_string(),
        });
    }

    let host = if authority.starts_with('[') {
        authority
            .split(']')
            .next()
            .unwrap_or(authority)
            .trim_start_matches('[')
            .to_ascii_lowercase()
    } else {
        authority
            .split(':')
            .next()
            .unwrap_or(authority)
            .to_ascii_lowercase()
    };

    if host.is_empty() {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "empty host in URL".to_string(),
        });
    }

    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host == "::1"
        || host == "0:0:0:0:0:0:0:1"
        || host.starts_with("fc")
        || host.starts_with("fd")
        || host.starts_with("fe80:")
        || host.contains(':')
    {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: format!("loopback, internal, or IPv6 literal host `{host}` is forbidden"),
        });
    }

    let ipv4_parts: Vec<&str> = host.split('.').collect();
    if ipv4_parts
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
    {
        if ipv4_parts.len() == 4 {
            let octets: Result<Vec<u8>, _> = ipv4_parts.iter().map(|p| p.parse::<u8>()).collect();
            if let Ok(o) = octets {
                let (a, b) = (o[0], o[1]);
                let is_private_or_reserved = a == 0
                    || a == 10
                    || a == 127
                    || (a == 169 && b == 254)
                    || (a == 172 && (16..=31).contains(&b))
                    || (a == 192 && b == 168)
                    || (a == 100 && (64..=127).contains(&b))
                    || a >= 224;
                if is_private_or_reserved {
                    return Err(DomainError::UnsafeEgressUrl {
                        url: url.to_string(),
                        reason: format!(
                            "private, loopback, link-local, or metadata IPv4 `{host}` is forbidden"
                        ),
                    });
                }
            }
        }
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: format!("raw IP literal `{host}` is forbidden; use an allowlisted DNS host"),
        });
    }

    if !allowed_hosts.is_empty() {
        let host_allowed = allowed_hosts.iter().any(|allowed| {
            let allowed_lower = allowed.to_ascii_lowercase();
            if let Some(suffix) = allowed_lower.strip_prefix("*.") {
                host == suffix || host.ends_with(&format!(".{suffix}"))
            } else {
                host == allowed_lower
            }
        });
        if !host_allowed {
            return Err(DomainError::UnsafeEgressUrl {
                url: url.to_string(),
                reason: format!("host `{host}` is not in the outbound egress allowlist"),
            });
        }
    }

    Ok(host)
}

/// Chapter or section entry inside a Book's indexed Table of Contents (`Step 4`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookTocChapter {
    pub segment_id: String,
    pub chapter_number: String,
    pub title: String,
    pub subtopics: Vec<String>,
    pub page_range: Option<String>,
}

/// Video item inside a YouTube Playlist's indexed syllabus (`Step 4`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct YoutubeSyllabusItem {
    pub segment_id: String,
    pub video_id: String,
    pub index: u32,
    pub title: String,
    pub duration_minutes: u32,
    pub key_concepts: Vec<String>,
}

/// Unit/week inside an Online Course's indexed syllabus (`Step 4`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CourseSyllabusUnit {
    pub segment_id: String,
    pub week_or_unit: String,
    pub title: String,
    pub lecture_topics: Vec<String>,
    pub problem_sets: Vec<String>,
}

/// Exercise inside a Code Lab / Repository's indexed structure (`Step 4`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryLabExercise {
    pub segment_id: String,
    pub path: String,
    pub title: String,
    pub verification_command: String,
    pub deliverable_summary: String,
}

/// Polymorphic resource index descriptor stored per `resource_version` (`Step 4`).
/// Preserves type-specific structures (Book TOC + blurb, YouTube playlist syllabus + transcript outline,
/// Course syllabus units, and Repository lab exercises) while respecting `AcquisitionPermission`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "index_kind", rename_all = "snake_case")]
pub enum ResourceIndexDescriptor {
    BookIndex {
        authors: Vec<String>,
        publisher: String,
        edition: Option<String>,
        brief_summary: String,
        table_of_contents: Vec<BookTocChapter>,
        content_excerpts: Option<Vec<String>>,
    },
    YoutubePlaylistIndex {
        channel_title: String,
        playlist_id: String,
        total_videos: u32,
        syllabus_items: Vec<YoutubeSyllabusItem>,
        transcript_outline: Option<String>,
    },
    CourseIndex {
        platform: String,
        instructors: Vec<String>,
        syllabus_units: Vec<CourseSyllabusUnit>,
    },
    RepositoryLabIndex {
        repo_full_name: String,
        programming_language: String,
        license_spdx: String,
        lab_exercises: Vec<RepositoryLabExercise>,
    },
}

/// Normalizes a canonical resource URL and optional external identifier (`isbn:...`, `yt:playlist:...`, `gh:...`)
/// for deterministic deduplication across DB retrieval and web search (`Step 1` & `Step 2`).
#[must_use]
pub fn normalize_canonical_resource_identity(
    canonical_url: &str,
    external_id: Option<&str>,
) -> (String, Option<String>) {
    let trimmed = canonical_url.trim();
    let without_fragment = trimmed.split('#').next().unwrap_or(trimmed);
    let normalized_url = without_fragment.trim_end_matches('/').to_ascii_lowercase();
    let normalized_ext = external_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());
    (normalized_url, normalized_ext)
}

/// Evidence-backed topic coverage state for Step 1.5 ("Review existing fit").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TopicCoverageStatus {
    Covered,
    Partial,
    NotVerified,
}

/// Coverage breakdown for a single requested topic tag at the learner's required `math_depth`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopicCoverageItem {
    pub topic_tag: String,
    pub status: TopicCoverageStatus,
    pub supporting_resource_version_ids: Vec<String>,
    pub has_instruction: bool,
    pub has_practice: bool,
    pub gap_note: Option<String>,
}

/// Candidate indexed material evaluated for Step 1.5 ("Review existing fit").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexedMaterialCandidate {
    pub resource_version_id: String,
    pub resource_id: String,
    pub title: String,
    pub resource_type: String,
    pub subject: String,
    pub topic_tags: Vec<String>,
    pub supported_math_depths: Vec<String>,
    pub supported_roles: Vec<String>,
    pub access_model: CatalogAccessModel,
    pub price_minor_units: Option<u64>,
    pub review_status: ResourceReviewStatus,
    pub quarantined: bool,
    pub index_descriptor: Option<ResourceIndexDescriptor>,
}

impl IndexedMaterialCandidate {
    /// Concatenates structured metadata and polymorphic segment titles/summaries into a single
    /// searchable corpus document for sublinear TF-IDF indexing (`Step 1` & `Step 4`).
    #[must_use]
    pub fn searchable_corpus_text(&self) -> String {
        let mut parts = vec![
            self.title.as_str(),
            self.subject.as_str(),
            self.resource_type.as_str(),
        ];
        for tag in &self.topic_tags {
            parts.push(tag.as_str());
        }
        let mut extra = Vec::new();
        if let Some(desc) = &self.index_descriptor {
            match desc {
                ResourceIndexDescriptor::BookIndex {
                    authors,
                    publisher,
                    brief_summary,
                    table_of_contents,
                    ..
                } => {
                    extra.push(publisher.clone());
                    extra.push(brief_summary.clone());
                    extra.extend(authors.iter().cloned());
                    for ch in table_of_contents {
                        extra.push(ch.title.clone());
                        extra.extend(ch.subtopics.iter().cloned());
                    }
                }
                ResourceIndexDescriptor::YoutubePlaylistIndex {
                    channel_title,
                    syllabus_items,
                    transcript_outline,
                    ..
                } => {
                    extra.push(channel_title.clone());
                    if let Some(outline) = transcript_outline {
                        extra.push(outline.clone());
                    }
                    for item in syllabus_items {
                        extra.push(item.title.clone());
                        extra.extend(item.key_concepts.iter().cloned());
                    }
                }
                ResourceIndexDescriptor::CourseIndex {
                    platform,
                    instructors,
                    syllabus_units,
                } => {
                    extra.push(platform.clone());
                    extra.extend(instructors.iter().cloned());
                    for unit in syllabus_units {
                        extra.push(unit.title.clone());
                        extra.extend(unit.lecture_topics.iter().cloned());
                        extra.extend(unit.problem_sets.iter().cloned());
                    }
                }
                ResourceIndexDescriptor::RepositoryLabIndex {
                    repo_full_name,
                    programming_language,
                    lab_exercises,
                    ..
                } => {
                    extra.push(repo_full_name.clone());
                    extra.push(programming_language.clone());
                    for lab in lab_exercises {
                        extra.push(lab.title.clone());
                        extra.push(lab.deliverable_summary.clone());
                    }
                }
            }
        }
        let mut combined = parts.join(" ");
        if !extra.is_empty() {
            combined.push(' ');
            combined.push_str(&extra.join(" "));
        }
        combined
    }
}

/// Tokenizes a document or query string into normalized, stemmed English search terms
/// using [`bm25::DefaultTokenizer`] (`unicode-segmentation` + `deunicode` + `stop-words` + Snowball stemmer).
#[must_use]
pub fn tokenize_search_terms(text: &str) -> Vec<String> {
    use bm25::{DefaultTokenizer, Language, Tokenizer};
    DefaultTokenizer::new(Language::English).tokenize(text)
}

/// Corpus search index backed by the [`bm25`] crate (`SearchEngineBuilder` + English Snowball stemmer).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TfIdfCorpusIndex {
    documents: BTreeMap<String, String>,
}

impl TfIdfCorpusIndex {
    /// Creates an empty [`TfIdfCorpusIndex`].
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Builds a [`TfIdfCorpusIndex`] from an initial slice of [`IndexedMaterialCandidate`]s.
    #[must_use]
    pub fn from_candidates(candidates: &[IndexedMaterialCandidate]) -> Self {
        let mut index = Self::new();
        for candidate in candidates {
            index.upsert_candidate(candidate);
        }
        index
    }

    /// Returns the number of indexed documents in the corpus.
    #[must_use]
    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    /// Inserts or updates a document by `doc_id`.
    pub fn upsert_document(&mut self, doc_id: impl Into<String>, text: &str) {
        self.documents.insert(doc_id.into(), text.to_string());
    }

    /// Removes a document from the corpus index by `doc_id`.
    pub fn remove_document(&mut self, doc_id: &str) -> bool {
        self.documents.remove(doc_id).is_some()
    }

    /// Returns `true` when `doc_id` is currently present in the corpus index.
    #[must_use]
    pub fn contains_document(&self, doc_id: &str) -> bool {
        self.documents.contains_key(doc_id)
    }

    /// Indexes or updates an [`IndexedMaterialCandidate`] in the corpus.
    pub fn upsert_candidate(&mut self, candidate: &IndexedMaterialCandidate) {
        self.upsert_document(
            candidate.resource_version_id.clone(),
            &candidate.searchable_corpus_text(),
        );
    }

    /// Returns the BM25 relevance score between `query` and the indexed document `doc_id`.
    #[must_use]
    pub fn cosine_similarity(&self, query: &str, doc_id: &str) -> f64 {
        self.rank_documents(query)
            .into_iter()
            .find_map(|(id, score)| (id == doc_id).then_some(score))
            .unwrap_or(0.0)
    }

    /// Ranks all indexed documents by descending [`bm25`] relevance score to `query`
    /// with deterministic lexicographical `doc_id` tie-breaking.
    #[must_use]
    pub fn rank_documents(&self, query: &str) -> Vec<(String, f64)> {
        use bm25::{Document, Language, SearchEngineBuilder};

        if self.documents.is_empty() {
            return Vec::new();
        }
        let engine = SearchEngineBuilder::<String>::with_documents(
            Language::English,
            self.documents
                .iter()
                .map(|(id, text)| Document::new(id.clone(), text.clone())),
        )
        .build();
        let hits: BTreeMap<String, f64> = engine
            .search(query, self.documents.len())
            .into_iter()
            .map(|r| {
                let raw = f64::from(r.score).max(0.0);
                let normalized = if raw > 0.0 { raw / (raw + 2.0) } else { 0.0 };
                (r.document.id, normalized)
            })
            .collect();
        let mut ranked: Vec<(String, f64)> = self
            .documents
            .keys()
            .map(|doc_id| (doc_id.clone(), hits.get(doc_id).copied().unwrap_or(0.0)))
            .collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        ranked
    }
}

/// Learner's execution mode choice in Step 1.5 ("Review existing fit").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceFitDecisionMode {
    DirectPlanAdoption,
    UseSelectedOnly,
    FillGaps,
    SearchAllTopics,
}

/// Output of evaluating existing indexed material fit and accepted coverage (`Step 1` & `Step 1.5`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceFitEvaluation {
    pub ranked_materials: Vec<IndexedMaterialCandidate>,
    pub topic_coverage: Vec<TopicCoverageItem>,
    pub covered_topics: Vec<String>,
    pub partial_topics: Vec<String>,
    pub missing_topics_for_search: Vec<String>,
    pub recommended_mode: ResourceFitDecisionMode,
    pub web_search_bypassed: bool,
    pub cost_badge_label: String,
}

/// Structured query parameters for evaluating indexed resource fit and coverage (`Step 1` & `Step 1.5`).
#[derive(Debug, Clone, Copy)]
pub struct ResourceFitQuery<'a> {
    pub requested_subject: &'a str,
    pub requested_topics: &'a [String],
    pub required_math_depth: &'a str,
    pub free_only: bool,
    pub candidates: &'a [IndexedMaterialCandidate],
    pub selected_resource_version_ids: &'a [String],
    pub skipped_resource_version_ids: &'a [String],
    pub requested_mode: Option<ResourceFitDecisionMode>,
}

/// Evaluates eligible indexed materials using [`ResourceFitQuery`].
#[must_use]
pub fn evaluate_resource_fit(query: &ResourceFitQuery<'_>) -> ResourceFitEvaluation {
    evaluate_resource_fit_and_coverage(
        query.requested_subject,
        query.requested_topics,
        query.required_math_depth,
        query.free_only,
        query.candidates,
        query.selected_resource_version_ids,
        query.skipped_resource_version_ids,
        query.requested_mode,
    )
}

/// Evaluates eligible indexed materials, ranks them deterministically, and computes
/// evidence-backed topic coverage over the learner's accepted (`selected_resource_version_ids`)
/// and rejected (`skipped_resource_version_ids`) choices (`Step 1` & `Step 1.5`).
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn evaluate_resource_fit_and_coverage(
    requested_subject: &str,
    requested_topics: &[String],
    required_math_depth: &str,
    free_only: bool,
    candidates: &[IndexedMaterialCandidate],
    selected_resource_version_ids: &[String],
    skipped_resource_version_ids: &[String],
    requested_mode: Option<ResourceFitDecisionMode>,
) -> ResourceFitEvaluation {
    let norm_depth = required_math_depth.trim().to_ascii_lowercase();
    let req_topics_norm: Vec<(String, String)> = requested_topics
        .iter()
        .map(|t| (t.trim().to_string(), t.trim().to_ascii_lowercase()))
        .filter(|(orig, _)| !orig.is_empty())
        .collect();

    // 1. Eligibility precedes ranking: filter out unapproved, quarantined, or budget-ineligible resources
    let mut eligible: Vec<IndexedMaterialCandidate> = candidates
        .iter()
        .filter(|c| {
            if c.review_status != ResourceReviewStatus::Approved || c.quarantined {
                return false;
            }
            if free_only && c.access_model != CatalogAccessModel::FreePublic {
                return false;
            }
            let depth_ok = c.supported_math_depths.is_empty()
                || c.supported_math_depths
                    .iter()
                    .any(|d| d.eq_ignore_ascii_case(&norm_depth));
            let matches_subject = c.subject.eq_ignore_ascii_case(requested_subject.trim());
            let matches_any_topic = req_topics_norm.iter().any(|(_, t_norm)| {
                c.topic_tags
                    .iter()
                    .any(|ct| ct.trim().to_ascii_lowercase() == *t_norm)
            });
            depth_ok && (matches_subject || matches_any_topic)
        })
        .cloned()
        .collect();

    // 2. Deterministic hybrid ranking:
    //    (a) Number of requested topics supported at required depth
    //    (b) Supports both instruction and practice roles
    //    (c) Lower known acquisition cost
    //    (d) Sublinear TF-IDF cosine similarity (in basis points) against query
    //    (e) Stable resource_version_id tie-breaker
    let tfidf_index = TfIdfCorpusIndex::from_candidates(&eligible);
    let mut query_terms = vec![requested_subject.trim().to_string()];
    query_terms.extend(req_topics_norm.iter().map(|(orig, _)| orig.clone()));
    if !norm_depth.is_empty() {
        query_terms.push(norm_depth.clone());
    }
    let composite_query = query_terms.join(" ");

    eligible.sort_by(|a, b| {
        let count_a = req_topics_norm
            .iter()
            .filter(|(_, t_norm)| {
                a.topic_tags
                    .iter()
                    .any(|ct| ct.trim().to_ascii_lowercase() == *t_norm)
            })
            .count();
        let count_b = req_topics_norm
            .iter()
            .filter(|(_, t_norm)| {
                b.topic_tags
                    .iter()
                    .any(|ct| ct.trim().to_ascii_lowercase() == *t_norm)
            })
            .count();
        let sim_a_bp =
            (tfidf_index.cosine_similarity(&composite_query, &a.resource_version_id) * 10_000.0)
                .round() as i64;
        let sim_b_bp =
            (tfidf_index.cosine_similarity(&composite_query, &b.resource_version_id) * 10_000.0)
                .round() as i64;
        count_b
            .cmp(&count_a)
            .then_with(|| b.supported_roles.len().cmp(&a.supported_roles.len()))
            .then_with(|| {
                a.price_minor_units
                    .unwrap_or(0)
                    .cmp(&b.price_minor_units.unwrap_or(0))
            })
            .then_with(|| sim_b_bp.cmp(&sim_a_bp))
            .then_with(|| a.resource_version_id.cmp(&b.resource_version_id))
    });

    // 3. Compute coverage strictly over accepted (selected and not skipped) eligible resources
    let accepted: Vec<&IndexedMaterialCandidate> = eligible
        .iter()
        .filter(|c| {
            selected_resource_version_ids
                .iter()
                .any(|id| id == &c.resource_version_id)
                && !skipped_resource_version_ids
                    .iter()
                    .any(|id| id == &c.resource_version_id)
        })
        .collect();

    let mut topic_coverage = Vec::with_capacity(req_topics_norm.len());
    let mut covered_topics = Vec::new();
    let mut partial_topics = Vec::new();
    let mut missing_topics_for_search = Vec::new();

    for (orig_topic, norm_topic) in &req_topics_norm {
        let mut supporting_ids = Vec::new();
        let mut has_instruction = false;
        let mut has_practice = false;

        for res in &accepted {
            if res
                .topic_tags
                .iter()
                .any(|ct| ct.trim().to_ascii_lowercase() == *norm_topic)
            {
                supporting_ids.push(res.resource_version_id.clone());
                if res.supported_roles.is_empty()
                    || res
                        .supported_roles
                        .iter()
                        .any(|r| r.eq_ignore_ascii_case("instruction"))
                {
                    has_instruction = true;
                }
                if res
                    .supported_roles
                    .iter()
                    .any(|r| r.eq_ignore_ascii_case("practice") || r.eq_ignore_ascii_case("assessment"))
                    || matches!(res.resource_type.as_str(), "repository" | "project")
                {
                    has_practice = true;
                }
            }
        }

        let (status, gap_note) = if supporting_ids.is_empty() {
            missing_topics_for_search.push(orig_topic.clone());
            (
                TopicCoverageStatus::NotVerified,
                Some("No selected indexed resource covers this topic yet.".to_string()),
            )
        } else if has_instruction && has_practice {
            covered_topics.push(orig_topic.clone());
            (TopicCoverageStatus::Covered, None)
        } else if has_instruction {
            // Covered for instruction; if formal depth requires practice, note the practice gap or mark covered if single-source
            covered_topics.push(orig_topic.clone());
            (TopicCoverageStatus::Covered, None)
        } else {
            partial_topics.push(orig_topic.clone());
            missing_topics_for_search.push(orig_topic.clone());
            (
                TopicCoverageStatus::Partial,
                Some("Practice covered, but core instruction segment is missing.".to_string()),
            )
        };

        topic_coverage.push(TopicCoverageItem {
            topic_tag: orig_topic.clone(),
            status,
            supporting_resource_version_ids: supporting_ids,
            has_instruction,
            has_practice,
            gap_note,
        });
    }

    let default_mode = if accepted.is_empty() {
        ResourceFitDecisionMode::SearchAllTopics
    } else if missing_topics_for_search.is_empty() && !req_topics_norm.is_empty() {
        ResourceFitDecisionMode::UseSelectedOnly
    } else {
        ResourceFitDecisionMode::FillGaps
    };
    let effective_mode = requested_mode.unwrap_or(default_mode);

    let (web_search_bypassed, cost_badge_label) = match effective_mode {
        ResourceFitDecisionMode::DirectPlanAdoption => (
            true,
            "No AI generation · No web search".to_string(),
        ),
        ResourceFitDecisionMode::UseSelectedOnly => (
            true,
            "No web search · AI synthesis required".to_string(),
        ),
        ResourceFitDecisionMode::FillGaps => {
            if missing_topics_for_search.is_empty() {
                (true, "No web search · AI synthesis required".to_string())
            } else {
                let n = missing_topics_for_search.len();
                let noun = if n == 1 { "missing topic" } else { "missing topics" };
                (
                    false,
                    format!("Search {n} {noun} · AI synthesis required"),
                )
            }
        }
        ResourceFitDecisionMode::SearchAllTopics => {
            let n = req_topics_norm.len().max(1);
            let noun = if n == 1 { "requested topic" } else { "requested topics" };
            (
                false,
                format!("Search {n} {noun} · AI synthesis required"),
            )
        }
    };

    ResourceFitEvaluation {
        ranked_materials: eligible,
        topic_coverage,
        covered_topics,
        partial_topics,
        missing_topics_for_search,
        recommended_mode: effective_mode,
        web_search_bypassed,
        cost_badge_label,
    }
}
