//! 6-stage AI syllabus search, sublinear TF-IDF ranking, fit-bypass evaluation, and polymorphic material indexing (`T02`, `T03`).

use serde::{Deserialize, Serialize};
use syllabus_domain::{
    evaluate_resource_fit_and_coverage, validate_outbound_egress_url, IndexedMaterialCandidate,
    ResourceFitDecisionMode, ResourceFitEvaluation, ResourceIndexDescriptor, TfIdfCorpusIndex,
};
use syllabus_persistence::{CatalogAccessModel, PersistenceError, ResourceReviewStatus};

/// Structured search prompt specification built in Step 0 from the "New Syllabus" modal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusSearchPromptSpec {
    pub goal_title: String,
    pub subject: String,
    pub topic_tags: Vec<String>,
    pub math_depth: String,
    pub sequence_preference: String,
    pub free_only: bool,
    pub weekly_minutes: u32,
    pub synthesized_search_query: String,
    pub latex_equation_instruction: String,
}

/// Step 0: Builds the structured search prompt and LaTeX synthesis instruction from modal inputs.
#[must_use]
pub fn build_syllabus_search_prompt(
    goal_title: &str,
    subject: &str,
    topic_tags: &[String],
    math_depth: &str,
    sequence_preference: &str,
    free_only: bool,
    weekly_minutes: u32,
) -> SyllabusSearchPromptSpec {
    let clean_goal = goal_title.trim();
    let clean_subject = subject.trim();
    let clean_tags: Vec<String> = topic_tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let access_clause = if free_only {
        "free public open-access materials only"
    } else {
        "verified free or paid materials"
    };
    let synthesized_search_query = format!(
        "subject:{clean_subject} goal:\"{clean_goal}\" topics:[{}] depth:{math_depth} order:{sequence_preference} access:({access_clause})",
        clean_tags.join(", ")
    );
    let latex_equation_instruction = "Emit inline ($...$) and block ($$...$$) LaTeX representations for all mathematical equations in Study flow titles, summaries, study prompts, worked examples, and concept checks.".to_string();

    SyllabusSearchPromptSpec {
        goal_title: clean_goal.to_string(),
        subject: clean_subject.to_string(),
        topic_tags: clean_tags,
        math_depth: math_depth.trim().to_string(),
        sequence_preference: sequence_preference.trim().to_string(),
        free_only,
        weekly_minutes,
        synthesized_search_query,
        latex_equation_instruction,
    }
}

/// Newly discovered web resource candidate from Step 2 internet search tool call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredWebResourceCandidate {
    pub resource_id: String,
    pub resource_version_id: String,
    pub title: String,
    pub canonical_url: String,
    pub external_id: Option<String>,
    pub resource_type: String,
    pub subject: String,
    pub topic_tags: Vec<String>,
    pub supported_math_depths: Vec<String>,
    pub supported_roles: Vec<String>,
    pub access_model: CatalogAccessModel,
    pub price_minor_units: Option<u64>,
    pub index_descriptor: ResourceIndexDescriptor,
}

/// Receipt returned by the 6-stage AI syllabus search, fit-bypass, and polymorphic indexing pipeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchAndIndexPipelineReceipt {
    pub search_prompt: SyllabusSearchPromptSpec,
    pub fit_evaluation: ResourceFitEvaluation,
    pub effective_mode: ResourceFitDecisionMode,
    pub web_search_executed: bool,
    pub searched_missing_topics: Vec<String>,
    pub bypassed_existing_resource_version_ids: Vec<String>,
    pub newly_indexed_resources: Vec<IndexedMaterialCandidate>,
    pub pinned_synthesis_resource_version_ids: Vec<String>,
    pub tfidf_corpus_document_count: usize,
    pub tfidf_ranked_scores: Vec<(String, f64)>,
}

/// Strongly-typed parameter object encapsulating all inputs to [`execute_search_and_index_pipeline`].
/// Replaces a 12-argument parameter clump in compliance with Recipe D (`introduce-value-objects`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchAndIndexPipelineParams {
    pub goal_title: String,
    pub subject: String,
    pub topic_tags: Vec<String>,
    pub math_depth: String,
    pub sequence_preference: String,
    pub free_only: bool,
    pub weekly_minutes: u32,
    pub indexed_candidates: Vec<IndexedMaterialCandidate>,
    pub selected_resource_version_ids: Vec<String>,
    pub skipped_resource_version_ids: Vec<String>,
    pub requested_mode: Option<ResourceFitDecisionMode>,
    pub web_search_discoveries: Vec<DiscoveredWebResourceCandidate>,
}

impl Default for SearchAndIndexPipelineParams {
    fn default() -> Self {
        Self {
            goal_title: String::new(),
            subject: "Engineering".to_string(),
            topic_tags: Vec::new(),
            math_depth: "formal".to_string(),
            sequence_preference: "theory_first".to_string(),
            free_only: true,
            weekly_minutes: 120,
            indexed_candidates: Vec::new(),
            selected_resource_version_ids: Vec::new(),
            skipped_resource_version_ids: Vec::new(),
            requested_mode: None,
            web_search_discoveries: Vec::new(),
        }
    }
}

impl SearchAndIndexPipelineParams {
    /// Constructs pipeline parameters with standard defaults for the given goal title.
    #[must_use]
    pub fn new(goal_title: impl Into<String>) -> Self {
        Self {
            goal_title: goal_title.into(),
            ..Default::default()
        }
    }

    /// Validates core pipeline parameter invariants prior to pipeline execution (`Recipe D`).
    pub fn validate(&self) -> Result<(), PersistenceError> {
        if self.goal_title.trim().is_empty() {
            return Err(PersistenceError::Validation(
                "goal_title cannot be empty".to_string(),
            ));
        }
        Ok(())
    }

    /// Builds the structured [`SyllabusSearchPromptSpec`] directly from these parameters (`Recipe D`).
    #[must_use]
    pub fn build_search_prompt(&self) -> SyllabusSearchPromptSpec {
        build_syllabus_search_prompt(
            &self.goal_title,
            &self.subject,
            &self.topic_tags,
            &self.math_depth,
            &self.sequence_preference,
            self.free_only,
            self.weekly_minutes,
        )
    }

    /// Executes the 6-stage search and index pipeline with these parameters (`Recipe D`).
    pub fn execute(&self) -> Result<SearchAndIndexPipelineReceipt, PersistenceError> {
        execute_search_and_index_pipeline(self)
    }

    #[must_use]
    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = subject.into();
        self
    }

    #[must_use]
    pub fn with_topic_tags(mut self, topic_tags: Vec<String>) -> Self {
        self.topic_tags = topic_tags;
        self
    }

    #[must_use]
    pub fn with_math_depth(mut self, math_depth: impl Into<String>) -> Self {
        self.math_depth = math_depth.into();
        self
    }

    #[must_use]
    pub fn with_sequence_preference(mut self, sequence_preference: impl Into<String>) -> Self {
        self.sequence_preference = sequence_preference.into();
        self
    }

    #[must_use]
    pub const fn with_free_only(mut self, free_only: bool) -> Self {
        self.free_only = free_only;
        self
    }

    #[must_use]
    pub const fn with_weekly_minutes(mut self, weekly_minutes: u32) -> Self {
        self.weekly_minutes = weekly_minutes;
        self
    }

    #[must_use]
    pub fn with_indexed_candidates(mut self, candidates: Vec<IndexedMaterialCandidate>) -> Self {
        self.indexed_candidates = candidates;
        self
    }

    #[must_use]
    pub fn with_selected_resource_version_ids(mut self, ids: Vec<String>) -> Self {
        self.selected_resource_version_ids = ids;
        self
    }

    #[must_use]
    pub fn with_skipped_resource_version_ids(mut self, ids: Vec<String>) -> Self {
        self.skipped_resource_version_ids = ids;
        self
    }

    #[must_use]
    pub const fn with_requested_mode(mut self, mode: Option<ResourceFitDecisionMode>) -> Self {
        self.requested_mode = mode;
        self
    }

    #[must_use]
    pub fn with_web_search_discoveries(
        mut self,
        discoveries: Vec<DiscoveredWebResourceCandidate>,
    ) -> Self {
        self.web_search_discoveries = discoveries;
        self
    }
}

/// Executes Steps 0 -> 1 -> 1.5 -> 2 -> 3 -> 4:
/// - Evaluates existing indexed fit (`Step 1` & `Step 1.5`).
/// - Bypasses internet search (`Step 2`) completely for `DirectPlanAdoption` or `UseSelectedOnly`
///   (or when all requested topics are covered by accepted DB resources).
/// - For `FillGaps` (`Path B`) or `SearchAllTopics` (`Path C`), searches only uncovered topics,
///   deduplicating against already-indexed `canonical_url` / `external_id` and learner-`[Skip]`ped IDs.
/// - Indexes newly discovered polymorphic resources (`BookIndex`, `YoutubePlaylistIndex`, `CourseIndex`, `RepositoryLabIndex`) (`Step 4`).
/// - Incrementally updates the sublinear [`TfIdfCorpusIndex`] with newly discovered resources and returns
///   L2-normalized cosine similarity rankings (`Step 4`).
pub fn execute_search_and_index_pipeline(
    params: &SearchAndIndexPipelineParams,
) -> Result<SearchAndIndexPipelineReceipt, PersistenceError> {
    params.validate()?;

    // Step 0: Build structured search prompt via method on value object
    let search_prompt = params.build_search_prompt();

    // Only reviewed candidates can appear in search rankings.
    let mut tfidf_index = TfIdfCorpusIndex::new();
    for candidate in &params.indexed_candidates {
        if candidate.review_status == ResourceReviewStatus::Approved && !candidate.quarantined {
            tfidf_index.upsert_candidate(candidate);
        }
    }

    // Step 1 & Step 1.5: Evaluate existing indexed resource fit & coverage over accepted resources
    let fit_evaluation = evaluate_resource_fit_and_coverage(
        &params.subject,
        &search_prompt.topic_tags,
        &params.math_depth,
        params.free_only,
        &params.indexed_candidates,
        &params.selected_resource_version_ids,
        &params.skipped_resource_version_ids,
        params.requested_mode,
    );
    let effective_mode = fit_evaluation.recommended_mode;

    // Collect already-indexed identities and skipped identities so Step 2 never re-fetches or re-indexes them
    let bypassed_existing_resource_version_ids: Vec<String> = fit_evaluation
        .ranked_materials
        .iter()
        .filter(|c| {
            params
                .selected_resource_version_ids
                .contains(&c.resource_version_id)
                && !params
                    .skipped_resource_version_ids
                    .contains(&c.resource_version_id)
        })
        .map(|c| c.resource_version_id.clone())
        .collect();

    let mut pinned_synthesis_resource_version_ids = bypassed_existing_resource_version_ids.clone();
    let mut newly_indexed_resources = Vec::new();

    let searched_missing_topics = match effective_mode {
        ResourceFitDecisionMode::DirectPlanAdoption | ResourceFitDecisionMode::UseSelectedOnly => {
            Vec::new()
        }
        ResourceFitDecisionMode::FillGaps => fit_evaluation.missing_topics_for_search.clone(),
        ResourceFitDecisionMode::SearchAllTopics => search_prompt.topic_tags.clone(),
    };

    let web_search_executed = !searched_missing_topics.is_empty()
        && !matches!(
            effective_mode,
            ResourceFitDecisionMode::DirectPlanAdoption | ResourceFitDecisionMode::UseSelectedOnly
        );

    if web_search_executed {
        for disc in &params.web_search_discoveries {
            // Validate outbound URL safety before staging
            validate_outbound_egress_url(&disc.canonical_url, &[])
                .map_err(|e| PersistenceError::Validation(e.to_string()))?;

            // Respect learner [Skip] decisions and free-only policy
            if params
                .skipped_resource_version_ids
                .contains(&disc.resource_version_id)
            {
                continue;
            }
            if params.free_only && disc.access_model != CatalogAccessModel::FreePublic {
                continue;
            }

            // Check if this discovery covers at least one of the missing searched topics
            let covers_missing = searched_missing_topics.iter().any(|missing| {
                disc.topic_tags
                    .iter()
                    .any(|t| t.eq_ignore_ascii_case(missing.trim()))
            });
            if !covers_missing {
                continue;
            }

            // Deduplicate against already-indexed resources by resource_version_id or resource_id
            let existing_candidate = params
                .indexed_candidates
                .iter()
                .find(|existing| existing.resource_version_id == disc.resource_version_id)
                .or_else(|| {
                    params.indexed_candidates.iter().find(|existing| {
                        existing.resource_id == disc.resource_id
                            && existing.review_status == ResourceReviewStatus::Approved
                            && !existing.quarantined
                    })
                })
                .or_else(|| {
                    params
                        .indexed_candidates
                        .iter()
                        .find(|existing| existing.resource_id == disc.resource_id)
                });
            if let Some(existing) = existing_candidate {
                if fit_evaluation
                    .ranked_materials
                    .iter()
                    .any(|eligible| eligible.resource_version_id == existing.resource_version_id)
                    && !params
                        .skipped_resource_version_ids
                        .contains(&existing.resource_version_id)
                    && !pinned_synthesis_resource_version_ids
                        .contains(&existing.resource_version_id)
                {
                    pinned_synthesis_resource_version_ids
                        .push(existing.resource_version_id.clone());
                }
                continue;
            }

            if newly_indexed_resources
                .iter()
                .any(|existing: &IndexedMaterialCandidate| {
                    existing.resource_version_id == disc.resource_version_id
                        || existing.resource_id == disc.resource_id
                })
            {
                continue;
            }

            let indexed_candidate = IndexedMaterialCandidate {
                resource_version_id: disc.resource_version_id.clone(),
                resource_id: disc.resource_id.clone(),
                title: disc.title.clone(),
                resource_type: disc.resource_type.clone(),
                subject: disc.subject.clone(),
                topic_tags: disc.topic_tags.clone(),
                supported_math_depths: disc.supported_math_depths.clone(),
                supported_roles: disc.supported_roles.clone(),
                access_model: disc.access_model,
                price_minor_units: disc.price_minor_units,
                review_status: ResourceReviewStatus::UnderReview,
                quarantined: false,
                index_descriptor: Some(disc.index_descriptor.clone()),
            };
            newly_indexed_resources.push(indexed_candidate);
        }
    }

    let tfidf_query = format!(
        "{} {} {}",
        params.goal_title.trim(),
        params.subject.trim(),
        search_prompt.topic_tags.join(" ")
    );
    let tfidf_ranked_scores = tfidf_index.rank_documents(&tfidf_query);
    let tfidf_corpus_document_count = tfidf_index.document_count();

    Ok(SearchAndIndexPipelineReceipt {
        search_prompt,
        fit_evaluation,
        effective_mode,
        web_search_executed,
        searched_missing_topics,
        bypassed_existing_resource_version_ids,
        newly_indexed_resources,
        pinned_synthesis_resource_version_ids,
        tfidf_corpus_document_count,
        tfidf_ranked_scores,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_pipeline_params_validation_and_prompt_building() {
        // Invariant: empty goal title rejected
        let invalid = SearchAndIndexPipelineParams::default();
        assert!(invalid.validate().is_err());

        // Invariant: valid params build search prompt spec
        let params = SearchAndIndexPipelineParams::new("Transformer Architectures")
            .with_subject("Computer Science")
            .with_topic_tags(vec!["Transformers".to_string(), "Attention".to_string()])
            .with_math_depth("applied")
            .with_sequence_preference("theory_first")
            .with_free_only(true)
            .with_weekly_minutes(90);

        assert!(params.validate().is_ok());

        let prompt = params.build_search_prompt();
        assert_eq!(prompt.goal_title, "Transformer Architectures");
        assert_eq!(prompt.subject, "Computer Science");
        assert_eq!(prompt.topic_tags, vec!["Transformers", "Attention"]);
        assert_eq!(prompt.weekly_minutes, 90);
        assert!(prompt
            .synthesized_search_query
            .contains("Transformers, Attention"));
    }

    #[test]
    fn only_approved_existing_versions_rank_and_deduplicated_discoveries_pin_the_existing_id() {
        let approved = IndexedMaterialCandidate {
            resource_version_id: "known-v1".to_string(),
            resource_id: "known".to_string(),
            title: "Reviewed attention resource".to_string(),
            resource_type: "book".to_string(),
            subject: "Engineering".to_string(),
            topic_tags: vec!["Attention".to_string()],
            supported_math_depths: vec!["formal".to_string()],
            supported_roles: vec!["instruction".to_string()],
            access_model: CatalogAccessModel::FreePublic,
            price_minor_units: Some(0),
            review_status: ResourceReviewStatus::Approved,
            quarantined: false,
            index_descriptor: None,
        };
        let pending = IndexedMaterialCandidate {
            resource_version_id: "pending-v1".to_string(),
            resource_id: "pending".to_string(),
            title: "Unreviewed attention resource".to_string(),
            review_status: ResourceReviewStatus::UnderReview,
            ..approved.clone()
        };
        let descriptor = ResourceIndexDescriptor::BookIndex {
            authors: vec![],
            publisher: "Example University".to_string(),
            edition: None,
            brief_summary: "Attention".to_string(),
            table_of_contents: vec![],
            content_excerpts: None,
        };
        let duplicate = DiscoveredWebResourceCandidate {
            resource_id: "known".to_string(),
            resource_version_id: "known-v2".to_string(),
            title: "Discovered newer attention resource".to_string(),
            canonical_url: "https://example.edu/attention-new".to_string(),
            external_id: None,
            resource_type: "book".to_string(),
            subject: "Engineering".to_string(),
            topic_tags: vec!["Attention".to_string()],
            supported_math_depths: vec!["formal".to_string()],
            supported_roles: vec!["instruction".to_string()],
            access_model: CatalogAccessModel::FreePublic,
            price_minor_units: Some(0),
            index_descriptor: descriptor.clone(),
        };
        let new_discovery = DiscoveredWebResourceCandidate {
            resource_id: "new".to_string(),
            resource_version_id: "new-v1".to_string(),
            canonical_url: "https://example.edu/attention-new-resource".to_string(),
            ..duplicate.clone()
        };
        let params = SearchAndIndexPipelineParams {
            goal_title: "Learn attention".to_string(),
            topic_tags: vec!["Attention".to_string()],
            indexed_candidates: vec![approved, pending],
            requested_mode: Some(ResourceFitDecisionMode::SearchAllTopics),
            web_search_discoveries: vec![duplicate, new_discovery],
            ..SearchAndIndexPipelineParams::default()
        };

        let receipt = execute_search_and_index_pipeline(&params).unwrap();
        assert_eq!(
            receipt.pinned_synthesis_resource_version_ids,
            vec!["known-v1"]
        );
        assert_eq!(receipt.newly_indexed_resources.len(), 1);
        assert_eq!(
            receipt.newly_indexed_resources[0].review_status,
            ResourceReviewStatus::UnderReview
        );
        assert_eq!(receipt.tfidf_corpus_document_count, 1);
        assert_eq!(receipt.tfidf_ranked_scores.len(), 1);
        assert_eq!(receipt.tfidf_ranked_scores[0].0, "known-v1");
    }
}
