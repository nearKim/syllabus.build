//! Application use-case orchestration layer connecting domain invariants,
//! contract validation, security boundaries, persistence, and inference providers (`T02`, `T03`, `T04`).
//!
//! Architectural alignment:
//! - **DDD & SOLID**: Defines narrow, segregated ports ([`ports::CatalogRetrievalPort`],
//!   [`ports::SyllabusRevisionPersistencePort`], [`ports::GenerationJobRepositoryPort`]) and pure application
//!   use-case services ([`goal_interpreter::interpret_goal_request`],
//!   [`validation::validate_candidate_and_promote_to_revision`], [`job_runner::execute_generation_job`]).
//! - **DRY**: Delegates DAG cycle detection (`validate_dag_acyclic`), pedagogical triad coverage
//!   (`validate_pedagogical_triad_coverage`), playback-speed ceiling math
//!   (`ActivityComponentBreakdown::adjusted_effort`), and URL egress safety
//!   (`validate_outbound_egress_url`) to `syllabus-domain`.

pub mod goal_interpreter;
pub mod job_runner;
pub mod manual_resource;
pub mod ports;
pub mod readiness;
pub mod search_pipeline;
pub mod validation;

pub use goal_interpreter::*;
pub use job_runner::*;
pub use manual_resource::*;
pub use ports::*;
pub use readiness::*;
pub use search_pipeline::*;
pub use validation::*;

pub use syllabus_domain::{
    evaluate_resource_fit_and_coverage, normalize_canonical_resource_identity,
    tokenize_search_terms, validate_dag_acyclic, validate_pedagogical_triad_coverage,
    ActivityComponentBreakdown, BookTocChapter, CourseSyllabusUnit, EffortTriplet,
    GoalSpecification, IndexedMaterialCandidate, RepositoryLabExercise, ResourceFitDecisionMode,
    ResourceFitEvaluation, ResourceIndexDescriptor, TfIdfCorpusIndex, TopicCoverageItem,
    TopicCoverageStatus, YoutubeSyllabusItem,
};
pub use syllabus_persistence::{
    serde_json::{self, json, Value},
    validate_egress_url, validate_manual_resource_egress_url, AcquisitionPermission,
    CandidateArchiveRecord, CatalogAccessModel, CatalogFilterOutcome, CatalogFilterQuery,
    CatalogResourcePatchInput, CatalogResourceVersionRecord, CatalogReviewEvidence,
    CatalogReviewInput, GenerationJobRecord, InMemoryTransactionalStore, PersistenceError,
    ResourceAlertRecord, ResourceFreshnessState, ResourceOperationKind,
    ResourceQuarantineOverlayRecord, ResourceReviewStatus, SyllabusOverviewRecord,
    SyllabusResourceBindingInput, SyllabusResourceMutationReceipt, SyllabusRevisionRecord,
    SyllabusSummaryItem, DEFAULT_ALLOWED_CATALOG_HOSTS,
};
pub use syllabus_providers::{
    default_cheap_model_for_provider, DEFAULT_CHEAP_ANTHROPIC_MODEL, DEFAULT_CHEAP_GEMINI_MODEL,
    DEFAULT_CHEAP_OPENAI_MODEL,
};
use syllabus_security::{AuthenticatedPrincipal, ReleaseFeatureGates};

/// Public facade coordinating core application use cases across decomposed domain submodules.
/// Preserves exact public method signatures and return types.
#[derive(Debug, Clone, Default)]
pub struct ApplicationService;

impl ApplicationService {
    /// Builds the system operational readiness report.
    #[must_use]
    pub fn build_readiness_report(gates: ReleaseFeatureGates) -> SystemReadinessReport {
        readiness::build_readiness_report(gates)
    }

    /// Evaluates dynamic release readiness against requirements from traceability matrix.
    #[must_use]
    pub fn evaluate_dynamic_release_readiness(
        rows: &[TraceabilityRequirementRow],
        input: &DynamicReleaseGateInput,
    ) -> DynamicReleaseReadinessEvaluation {
        readiness::evaluate_dynamic_release_readiness(rows, input)
    }

    /// Interprets a goal request from a typed `GoalIntakeInput` value object.
    pub fn interpret_goal(
        input: &GoalIntakeInput,
    ) -> Result<GoalInterpretationResult, PersistenceError> {
        goal_interpreter::interpret_goal_intake(input)
    }

    /// Interprets a goal request from an untyped JSON payload (backward compatibility).
    pub fn interpret_goal_request(
        raw_request: &Value,
    ) -> Result<GoalInterpretationResult, PersistenceError> {
        goal_interpreter::interpret_goal_request(raw_request)
    }

    /// Validates a raw candidate payload and promotes it to a canonical revision.
    pub fn validate_candidate_and_promote_to_revision<S>(
        store: &S,
        principal: &AuthenticatedPrincipal,
        raw_candidate_utf8: &str,
        ctx: &CandidateValidationContext,
    ) -> Result<SyllabusRevisionRecord, PersistenceError>
    where
        S: CatalogRetrievalPort + SyllabusRevisionPersistencePort,
    {
        validation::validate_candidate_and_promote_to_revision(
            store,
            principal,
            raw_candidate_utf8,
            ctx,
        )
    }

    /// Dispatches and executes an asynchronous syllabus generation job.
    pub fn execute_generation_job<S>(
        store: &S,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
        syllabus_id: &str,
        revision_id: &str,
        raw_request: &Value,
    ) -> Result<GenerationJobRecord, PersistenceError>
    where
        S: CatalogRetrievalPort + SyllabusRevisionPersistencePort + GenerationJobRepositoryPort,
    {
        job_runner::execute_generation_job(
            store,
            principal,
            job_id,
            syllabus_id,
            revision_id,
            raw_request,
        )
    }

    /// Builds a structured syllabus search prompt from modal parameters.
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
        search_pipeline::build_syllabus_search_prompt(
            goal_title,
            subject,
            topic_tags,
            math_depth,
            sequence_preference,
            free_only,
            weekly_minutes,
        )
    }

    /// Executes the multi-stage catalog search, fit bypass, and indexing pipeline.
    pub fn execute_search_and_index_pipeline(
        params: &SearchAndIndexPipelineParams,
    ) -> Result<SearchAndIndexPipelineReceipt, PersistenceError> {
        search_pipeline::execute_search_and_index_pipeline(params)
    }

    /// Ingests a manual learning resource into the transactional catalog.
    pub fn ingest_manual_resource(
        store: &InMemoryTransactionalStore,
        principal: &AuthenticatedPrincipal,
        req: &ManualResourceIngestRequest,
    ) -> Result<ManualResourceIngestReceipt, PersistenceError> {
        manual_resource::ingest_manual_resource(store, principal, req)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use syllabus_security::PrincipalRole;

    fn learner_a() -> AuthenticatedPrincipal {
        AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            roles: vec![PrincipalRole::User],
            is_development_only_identity: true,
        }
    }

    fn read_canonical_candidate() -> String {
        let root = syllabus_contracts::workspace_root();
        std::fs::read_to_string(
            root.join("specs/001-syllabus-platform/examples/syllabus-candidate.synthetic.json"),
        )
        .expect("read canonical candidate fixture")
    }

    #[test]
    fn t03_s01_s02_s03_goal_intake_clarifying_questions_feasibility_and_schema_validation() {
        // Broad goal triggers clarifying questions (@S01)
        let broad = interpret_goal_request(&json!({
            "goal": "learn AI"
        }))
        .expect("interpret broad goal");
        assert!(!broad.goal_specification.clarifying_questions.is_empty());
        assert_eq!(broad.feasibility_status, "feasible");

        // Infeasible timeline surfaces explicit feasibility_warning and recovery_options (@S02)
        let tight = interpret_goal_request(&json!({
            "goal": "Build a Python RAG pipeline with tokenization and vector search",
            "weekly_available_minutes": 15,
            "horizon_weeks": 2,
            "free_only": true
        }))
        .expect("interpret tight timeline goal");
        assert_eq!(tight.feasibility_status, "infeasible");
        assert!(tight.goal_specification.feasibility_warning.is_some());
        assert_eq!(
            tight.recovery_options,
            vec!["reduced_scope", "extended_time", "increased_availability"]
        );
    }

    #[test]
    fn t03_s09_s10_s11_s12_s13_s20_s28_semantic_validator_positive_and_negative_invariants() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures();
        let principal = learner_a();
        let raw_candidate = read_canonical_candidate();

        // 1. In production mode (`allow_synthetic_fixtures_for_test: false`), synthetic resource is rejected (@S09, CAT-001)
        let prod_ctx = CandidateValidationContext {
            allow_synthetic_fixtures_for_test: false,
            ..CandidateValidationContext::default()
        };
        let synth_err = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &raw_candidate,
            &prod_ctx,
        )
        .unwrap_err();
        assert_eq!(synth_err.http_status_code(), 422);
        assert_eq!(synth_err.error_code(), "synthetic_fixture_forbidden");

        // 2. Replace synthetic resource with approved real catalog resource `res-rag-tokenization-free-v1` -> passes in production mode!
        let real_candidate = raw_candidate.replace(
            "synthetic-resource-tokenization-v1",
            "res-rag-tokenization-free-v1",
        );
        let promoted_real = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &real_candidate,
            &prod_ctx,
        )
        .expect("valid real catalog candidate promotes to syllabus revision");
        assert_eq!(promoted_real.payload["total_estimated_minutes"], json!(48));
        assert_eq!(
            promoted_real.payload["total_estimate_range_minutes"],
            json!({"lower": 38, "upper": 76})
        );
        assert!(!promoted_real.is_active);

        // 3. Canonical synthetic candidate with `allow_synthetic_fixtures_for_test: true` preserves exact SHA-256
        let test_ctx = CandidateValidationContext {
            syllabus_id: "cur-synth-1".to_string(),
            revision_id: "rev-synth-1".to_string(),
            allow_synthetic_fixtures_for_test: true,
            ..CandidateValidationContext::default()
        };
        let promoted_synth = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &raw_candidate,
            &test_ctx,
        )
        .expect("canonical synthetic candidate promotes");
        assert_eq!(
            promoted_synth.candidate_sha256,
            "435f6b3a8297063ab07cf807eaa001a3ad37747efc0b8219f2e69d093ca4e505"
        );

        // 4. Negative: executable <script> markup or forbidden field is rejected (@S11)
        let mut script_candidate: Value = serde_json::from_str(&real_candidate).unwrap();
        script_candidate["goal"]["summary"] = json!("Bad <script>alert(1)</script> injection");
        let err_script = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &serde_json::to_string(&script_candidate).unwrap(),
            &prod_ctx,
        )
        .unwrap_err();
        assert_eq!(err_script.error_code(), "invalid_model_output");

        // 5. Negative: cyclic prerequisite_edges rejected (@S10, @S11)
        let mut cyclic_candidate: Value = serde_json::from_str(&real_candidate).unwrap();
        cyclic_candidate["prerequisite_edges"] = json!([
            {
                "from_objective_id": "objective-tokenization",
                "to_objective_id": "objective-tokenization"
            }
        ]);
        let err_cycle = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &serde_json::to_string(&cyclic_candidate).unwrap(),
            &prod_ctx,
        )
        .unwrap_err();
        assert_eq!(err_cycle.error_code(), "invalid_model_output");

        // 6. Negative: invented/unknown resource_version_id rejected (@S10)
        let invented_res = real_candidate.replace(
            "res-rag-tokenization-free-v1",
            "invented-unreviewed-resource-v99",
        );
        let err_invented = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &invented_res,
            &prod_ctx,
        )
        .unwrap_err();
        assert_eq!(err_invented.error_code(), "invalid_model_output");

        // 7. Negative: missing pedagogical triad (remove assessment_activity_ids) rejected (@S10, @S13, PED-001)
        let mut no_assess_candidate: Value = serde_json::from_str(&real_candidate).unwrap();
        no_assess_candidate["objectives"][0]["assessment_activity_ids"] = json!([]);
        let err_triad = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &serde_json::to_string(&no_assess_candidate).unwrap(),
            &prod_ctx,
        )
        .unwrap_err();
        assert_eq!(err_triad.error_code(), "invalid_model_output");

        // 8. Negative: unordered duration bounds (lower > point) rejected (@S12)
        let mut bad_bounds: Value = serde_json::from_str(&real_candidate).unwrap();
        bad_bounds["activities"][0]["duration_estimate"]["lower_bounds"]["reading_minutes"] =
            json!(25);
        let err_bounds = validate_candidate_and_promote_to_revision(
            &store,
            &principal,
            &serde_json::to_string(&bad_bounds).unwrap(),
            &prod_ctx,
        )
        .unwrap_err();
        assert_eq!(err_bounds.error_code(), "invalid_model_output");
    }

    #[test]
    fn t03_s18_s28_execute_generation_job_succeeds_and_archives_canonical_candidate() {
        let store = InMemoryTransactionalStore::new_with_dev_fixtures();
        let principal = learner_a();

        let job = execute_generation_job(
            &store,
            &principal,
            "job-rag-alpha-1",
            "cur-rag-alpha-1",
            "rev-rag-alpha-1",
            &json!({
                "goal": "Build a Python RAG pipeline with tokenization and vector search",
                "weekly_available_minutes": 180,
                "free_only": true
            }),
        )
        .expect("generation job succeeds");

        assert_eq!(job.status, "succeeded");
        assert_eq!(
            job.stage_history,
            vec![
                "queued",
                "retrieving",
                "generating",
                "validating",
                "succeeded"
            ]
        );
        assert_eq!(
            job.candidate_sha256.as_deref(),
            Some("435f6b3a8297063ab07cf807eaa001a3ad37747efc0b8219f2e69d093ca4e505")
        );

        let archive = store
            .get_candidate_archive("arch-cur-rag-alpha-1-rev-rag-alpha-1")
            .expect("candidate archive recorded");
        assert!(archive.validation_succeeded);
        assert_eq!(
            archive.candidate_sha256,
            "435f6b3a8297063ab07cf807eaa001a3ad37747efc0b8219f2e69d093ca4e505"
        );
    }

    #[test]
    fn t09_s40_to_s45_dynamic_release_readiness_gate_parses_traceability_csv_without_hardcoded_counts(
    ) {
        let rows =
            load_traceability_rows_from_workspace().expect("load traceability.csv at runtime");
        assert!(!rows.is_empty());

        let all_p0_ids: BTreeSet<String> = rows
            .iter()
            .filter(|r| r.priority == "P0")
            .map(|r| r.requirement_id.clone())
            .collect();
        let all_p1_ids: BTreeSet<String> = rows
            .iter()
            .filter(|r| r.priority == "P1")
            .map(|r| r.requirement_id.clone())
            .collect();
        assert!(all_p1_ids.contains("PROG-006"));
        assert!(all_p1_ids.contains("NOT-005"));

        // 1. All P0 requirements verified + all operational gates green -> release_ready = true
        let ready_input = DynamicReleaseGateInput {
            verified_requirement_ids: all_p0_ids.clone(),
            synthetic_fixtures_blocked_in_production: true,
            open_critical_defects: 0,
            manual_accessibility_audit_passed: true,
            pedagogical_evaluation_passed: true,
            security_and_privacy_controls_verified: true,
            backup_restore_and_tombstone_replay_verified: true,
        };
        let eval_ok = evaluate_dynamic_release_readiness(&rows, &ready_input);
        assert!(eval_ok.release_ready);
        assert_eq!(
            eval_ok.p0_requirements_verified,
            eval_ok.p0_requirements_discovered
        );
        assert!(eval_ok.missing_p0_requirement_ids.is_empty());
        assert!(eval_ok.blocking_reasons.is_empty());

        // 2. Omitting any P0 requirement (e.g. OPS-006) blocks release readiness (@S45)
        let mut missing_one = all_p0_ids.clone();
        missing_one.remove("OPS-006");
        let eval_missing = evaluate_dynamic_release_readiness(
            &rows,
            &DynamicReleaseGateInput {
                verified_requirement_ids: missing_one,
                ..ready_input.clone()
            },
        );
        assert!(!eval_missing.release_ready);
        assert_eq!(eval_missing.missing_p0_requirement_ids, vec!["OPS-006"]);

        // 3. Synthetic fixtures not blocked or open critical defect blocks release (@S40, @S41)
        let eval_defects = evaluate_dynamic_release_readiness(
            &rows,
            &DynamicReleaseGateInput {
                synthetic_fixtures_blocked_in_production: false,
                open_critical_defects: 1,
                ..ready_input
            },
        );
        assert!(!eval_defects.release_ready);
        assert_eq!(eval_defects.blocking_reasons.len(), 2);
    }

    #[test]
    fn step_0_to_4_search_fit_bypass_and_polymorphic_indexing_pipeline() {
        let indexed = vec![IndexedMaterialCandidate {
            resource_version_id: "synthetic-resource-tokenization-v1".to_string(),
            resource_id: "res-tokenization".to_string(),
            title: "Reviewed Open Monograph: Subword Tokenization & Sequence Packing".to_string(),
            resource_type: "book".to_string(),
            subject: "Engineering".to_string(),
            topic_tags: vec!["Tokenization".to_string(), "Attention".to_string()],
            supported_math_depths: vec!["formal".to_string()],
            supported_roles: vec!["instruction".to_string()],
            access_model: CatalogAccessModel::FreePublic,
            price_minor_units: Some(0),
            review_status: ResourceReviewStatus::Approved,
            quarantined: false,
            index_descriptor: None,
        }];

        let discoveries = vec![DiscoveredWebResourceCandidate {
            resource_id: "res-flash-attention-yt".to_string(),
            resource_version_id: "synthetic-resource-flash-attention-yt-v1".to_string(),
            title: "YouTube Playlist: Hardware-Aware FlashAttention & IO-Complexity".to_string(),
            canonical_url: "https://example.edu/playlists/flash-attention".to_string(),
            external_id: Some("yt:playlist:PL_FLASH_01".to_string()),
            resource_type: "video".to_string(),
            subject: "Engineering".to_string(),
            topic_tags: vec!["FlashAttention".to_string()],
            supported_math_depths: vec!["formal".to_string()],
            supported_roles: vec!["instruction".to_string()],
            access_model: CatalogAccessModel::FreePublic,
            price_minor_units: Some(0),
            index_descriptor: ResourceIndexDescriptor::YoutubePlaylistIndex {
                channel_title: "Systems ML Lectures".to_string(),
                playlist_id: "PL_FLASH_01".to_string(),
                total_videos: 3,
                syllabus_items: vec![YoutubeSyllabusItem {
                    segment_id: "seg-flash-tiling".to_string(),
                    video_id: "yt_flash_1".to_string(),
                    index: 1,
                    title: "Lecture 1: SRAM Tiling & Online Softmax Rescaling".to_string(),
                    duration_minutes: 28,
                    key_concepts: vec!["FlashAttention".to_string(), "Online Softmax".to_string()],
                }],
                transcript_outline: Some(
                    "00:00 HBM vs SRAM bandwidth; 12:15 Online softmax rescaling.".to_string(),
                ),
            },
        }];

        let topics = vec![
            "Tokenization".to_string(),
            "Attention".to_string(),
            "FlashAttention".to_string(),
        ];

        // Path B (FillGaps): Tokenization & Attention are covered by the accepted DB book;
        // web search executes ONLY for the missing topic ("FlashAttention") and indexes the YouTube playlist
        let params_path_b = SearchAndIndexPipelineParams {
            goal_title: "Understand Transformer Internals & FlashAttention".to_string(),
            subject: "Engineering".to_string(),
            topic_tags: topics.clone(),
            math_depth: "formal".to_string(),
            sequence_preference: "theory_first".to_string(),
            free_only: true,
            weekly_minutes: 120,
            indexed_candidates: indexed.clone(),
            selected_resource_version_ids: vec!["synthetic-resource-tokenization-v1".to_string()],
            skipped_resource_version_ids: Vec::new(),
            requested_mode: Some(ResourceFitDecisionMode::FillGaps),
            web_search_discoveries: discoveries.clone(),
        };
        let receipt_path_b =
            execute_search_and_index_pipeline(&params_path_b).expect("Path B succeeds");

        assert!(receipt_path_b.web_search_executed);
        assert_eq!(
            receipt_path_b.searched_missing_topics,
            vec!["FlashAttention".to_string()]
        );
        assert_eq!(
            receipt_path_b.bypassed_existing_resource_version_ids,
            vec!["synthetic-resource-tokenization-v1".to_string()]
        );
        assert_eq!(receipt_path_b.newly_indexed_resources.len(), 1);
        assert_eq!(
            receipt_path_b.newly_indexed_resources[0].resource_version_id,
            "synthetic-resource-flash-attention-yt-v1"
        );
        assert_eq!(receipt_path_b.tfidf_corpus_document_count, 1);
        assert_eq!(receipt_path_b.tfidf_ranked_scores.len(), 1);
        assert!(receipt_path_b.tfidf_ranked_scores[0].1 > 0.0);
        assert!(receipt_path_b
            .search_prompt
            .latex_equation_instruction
            .contains("LaTeX"));

        // Path A (UseSelectedOnly): Web search is strictly bypassed even when FlashAttention is uncovered
        let params_path_a = SearchAndIndexPipelineParams {
            requested_mode: Some(ResourceFitDecisionMode::UseSelectedOnly),
            ..params_path_b
        };
        let receipt_path_a =
            execute_search_and_index_pipeline(&params_path_a).expect("Path A succeeds");

        assert!(!receipt_path_a.web_search_executed);
        assert!(receipt_path_a.searched_missing_topics.is_empty());
        assert!(receipt_path_a.newly_indexed_resources.is_empty());
        assert_eq!(
            receipt_path_a.pinned_synthesis_resource_version_ids,
            vec!["synthetic-resource-tokenization-v1".to_string()]
        );
    }

    #[test]
    fn goal_intake_value_object_and_application_service_facade() {
        // Value object invariant: empty prompt rejected
        let err_empty = GoalIntakeInput::from_value(&json!({ "goal": "   " })).unwrap_err();
        assert_eq!(err_empty.error_code(), "validation_error");

        // Value object invariant: 0 weekly minutes rejected
        let err_zero = GoalIntakeInput::from_value(&json!({
            "goal": "Learn Rust",
            "weekly_available_minutes": 0
        }))
        .unwrap_err();
        assert_eq!(err_zero.error_code(), "validation_error");

        // Value object correctly parses and normalizes aliases
        let input = GoalIntakeInput::from_value(&json!({
            "topic": "Rust Systems Programming",
            "target_weeks": 6,
            "constraints": {
                "weekly_minutes": 240
            },
            "access_policy": {
                "mode": "free_only"
            }
        }))
        .expect("valid GoalIntakeInput");
        assert_eq!(input.prompt, "Rust Systems Programming");
        assert_eq!(input.horizon_weeks, 6);
        assert_eq!(input.weekly_available_minutes, 240);
        assert!(input.free_only);

        // ApplicationService facade methods
        let interpreted = ApplicationService::interpret_goal(&input).expect("interpret via facade");
        assert_eq!(interpreted.feasibility_status, "feasible");

        let report = ApplicationService::build_readiness_report(ReleaseFeatureGates::default());
        assert_eq!(report.status, "ok");
    }
}
