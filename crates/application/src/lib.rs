//! Application use-case orchestration layer connecting domain invariants,
//! contract validation, security boundaries, persistence, and inference providers (`T02`, `T03`, `T04`).
//!
//! Architectural alignment:
//! - **DDD & SOLID**: Defines narrow, segregated ports (`CatalogRetrievalPort`,
//!   `CurriculumRevisionPersistencePort`, `GenerationJobRepositoryPort`) and pure application
//!   use-case services (`interpret_goal_request`, `validate_candidate_and_promote_to_revision`,
//!   `execute_generation_job`).
//! - **DRY**: Delegates DAG cycle detection (`validate_dag_acyclic`), pedagogical triad coverage
//!   (`validate_pedagogical_triad_coverage`), playback-speed ceiling math
//!   (`ActivityComponentBreakdown::adjusted_effort`), and URL egress safety
//!   (`validate_outbound_egress_url`) to `curriculum-domain`.

use curriculum_contracts::generated::CANONICAL_SPEC_SHA256;
use curriculum_contracts::jcs::sha256_bytes_hex;
use curriculum_contracts::ContractRegistry;
use curriculum_domain::{
    validate_dag_acyclic, validate_pedagogical_triad_coverage, ActivityComponentBreakdown,
    EffortTriplet, GoalSpecification,
};
pub use curriculum_persistence::{
    serde_json::{self, json, Value},
    validate_egress_url, AcquisitionPermission, CandidateArchiveRecord, CatalogAccessModel,
    CatalogFilterOutcome, CatalogFilterQuery, CatalogResourceVersionRecord, CatalogReviewEvidence,
    CatalogReviewInput, CurriculumOverviewRecord, CurriculumRevisionRecord, CurriculumSummaryItem,
    GenerationJobRecord, InMemoryTransactionalStore, PersistenceError, ResourceAlertRecord,
    ResourceFreshnessState, ResourceOperationKind, ResourceQuarantineOverlayRecord,
    ResourceReviewStatus, DEFAULT_ALLOWED_CATALOG_HOSTS,
};
use curriculum_providers::{
    CandidateGenerationRequest, DeterministicFakeProvider, FakeFaultInjection, InferenceAuthMode,
    InferenceProvider, ProviderError,
};
use curriculum_security::{AuthenticatedPrincipal, ReleaseFeatureGates};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Segregated port for deterministic catalog metadata filtering and lookup (`T02`, ISP/DIP).
pub trait CatalogRetrievalPort {
    fn filter_catalog_resources(
        &self,
        query: &CatalogFilterQuery,
    ) -> Result<CatalogFilterOutcome, PersistenceError>;

    fn get_catalog_resource_version(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError>;
}

/// Segregated port for archiving raw model candidates and committing validated revisions (`T03`, ISP/DIP).
pub trait CurriculumRevisionPersistencePort {
    fn record_candidate_archive(&self, archive: CandidateArchiveRecord);

    fn commit_validated_curriculum_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        revision_id: &str,
        candidate_sha256: &str,
        payload: Value,
        initial_is_active: bool,
    ) -> Result<CurriculumRevisionRecord, PersistenceError>;
}

/// Segregated port for asynchronous generation job state transitions (`T03`, `T04`, ISP/DIP).
pub trait GenerationJobRepositoryPort {
    fn upsert_generation_job(&self, job: GenerationJobRecord);

    fn get_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError>;
}

impl CatalogRetrievalPort for InMemoryTransactionalStore {
    fn filter_catalog_resources(
        &self,
        query: &CatalogFilterQuery,
    ) -> Result<CatalogFilterOutcome, PersistenceError> {
        InMemoryTransactionalStore::filter_catalog_resources(self, query)
    }

    fn get_catalog_resource_version(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        InMemoryTransactionalStore::get_catalog_resource_version(self, resource_version_id)
    }
}

impl CurriculumRevisionPersistencePort for InMemoryTransactionalStore {
    fn record_candidate_archive(&self, archive: CandidateArchiveRecord) {
        InMemoryTransactionalStore::record_candidate_archive(self, archive);
    }

    fn commit_validated_curriculum_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        revision_id: &str,
        candidate_sha256: &str,
        payload: Value,
        initial_is_active: bool,
    ) -> Result<CurriculumRevisionRecord, PersistenceError> {
        InMemoryTransactionalStore::commit_validated_curriculum_revision(
            self,
            principal,
            curriculum_id,
            revision_id,
            candidate_sha256,
            payload,
            initial_is_active,
        )
    }
}

impl GenerationJobRepositoryPort for InMemoryTransactionalStore {
    fn upsert_generation_job(&self, job: GenerationJobRecord) {
        InMemoryTransactionalStore::upsert_generation_job(self, job);
    }

    fn get_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError> {
        InMemoryTransactionalStore::get_generation_job(self, principal, job_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemReadinessReport {
    pub status: String,
    pub release_tier: String,
    pub canonical_spec_sha256: String,
    pub release_gates: ReleaseFeatureGates,
}

pub fn build_readiness_report(gates: ReleaseFeatureGates) -> SystemReadinessReport {
    SystemReadinessReport {
        status: "ok".to_string(),
        release_tier: "private_alpha_t00".to_string(),
        canonical_spec_sha256: CANONICAL_SPEC_SHA256.to_string(),
        release_gates: gates,
    }
}

/// Output of goal interpretation and clarification (`T03`, `GOAL-001`..`GOAL-005`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoalInterpretationResult {
    pub goal_specification: GoalSpecification,
    pub feasibility_status: String,
    pub recovery_options: Vec<String>,
    pub normalized_generation_request: Value,
}

/// Interprets a learner's free-text or structured goal intake request into a normalized
/// `GoalSpecification` and a contract-validated `generation-request.schema.json` document
/// (`T03`, `GOAL-001`..`GOAL-005`, `@S01`..`@S04`, `@S18`, `@S19`, `@S47`, `@S61`, `@S72`).
pub fn interpret_goal_request(
    raw_request: &Value,
) -> Result<GoalInterpretationResult, PersistenceError> {
    let prompt = raw_request
        .get("goal")
        .and_then(|g| {
            if let Some(s) = g.as_str() {
                Some(s)
            } else {
                g.get("prompt").and_then(|p| p.as_str())
            }
        })
        .or_else(|| raw_request.get("topic").and_then(|v| v.as_str()))
        .or_else(|| raw_request.get("prompt").and_then(|v| v.as_str()))
        .or_else(|| raw_request.get("goal_text").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            PersistenceError::Validation(
                "goal prompt or topic is required and cannot be empty".to_string(),
            )
        })?;

    let target_role_or_outcome = raw_request
        .get("target_role_or_outcome")
        .and_then(|v| v.as_str())
        .or_else(|| {
            raw_request
                .get("goal")
                .and_then(|g| g.get("desired_outcomes"))
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.as_str())
        })
        .unwrap_or("Build and evaluate a retrieval-augmented generation (RAG) pipeline in Python")
        .to_string();

    let prior_background_level = raw_request
        .get("prior_background_level")
        .and_then(|v| v.as_str())
        .or_else(|| {
            raw_request
                .get("learner_profile")
                .and_then(|lp| lp.get("experience_level"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("intermediate")
        .to_string();

    let weekly_available_minutes = raw_request
        .get("weekly_available_minutes")
        .and_then(|v| v.as_u64())
        .or_else(|| raw_request.get("weekly_minutes").and_then(|v| v.as_u64()))
        .or_else(|| {
            raw_request
                .get("constraints")
                .and_then(|c| c.get("weekly_minutes"))
                .and_then(|v| v.as_u64())
        })
        .unwrap_or(180) as u32;

    if weekly_available_minutes == 0 {
        return Err(PersistenceError::Validation(
            "weekly_available_minutes must be at least 1".to_string(),
        ));
    }

    let horizon_weeks = raw_request
        .get("horizon_weeks")
        .and_then(|v| v.as_u64())
        .or_else(|| raw_request.get("target_weeks").and_then(|v| v.as_u64()))
        .or_else(|| {
            raw_request
                .get("generation_options")
                .and_then(|o| o.get("planning_horizon_days"))
                .and_then(|v| v.as_u64())
                .map(|days| (days.max(7) / 7) as u64)
        })
        .unwrap_or(4)
        .max(1) as u32;

    let free_only = raw_request
        .get("free_only")
        .and_then(|v| v.as_bool())
        .or_else(|| {
            raw_request
                .get("access_policy")
                .and_then(|ap| ap.get("mode"))
                .and_then(|v| v.as_str())
                .map(|m| m == "free_only")
        })
        .unwrap_or(true);

    let budget_currency = raw_request
        .get("budget_currency")
        .and_then(|v| v.as_str())
        .or_else(|| {
            raw_request
                .get("budgets")
                .and_then(|b| b.get("materials"))
                .and_then(|m| m.get("currency"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("USD")
        .to_string();

    let max_budget_minor_units = raw_request
        .get("max_budget_minor_units")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            raw_request
                .get("budgets")
                .and_then(|b| b.get("materials"))
                .and_then(|m| m.get("max_minor_units"))
                .and_then(|v| v.as_u64())
        })
        .unwrap_or(if free_only { 0 } else { 10_000 });

    let owned_subscription_ids: Vec<String> = raw_request
        .get("owned_subscription_ids")
        .or_else(|| {
            raw_request
                .get("access_policy")
                .and_then(|ap| ap.get("owned_subscription_ids"))
        })
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let allow_paid_fallback = raw_request
        .get("allow_paid_fallback")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let include_optional_certification = raw_request
        .get("include_optional_certification")
        .or_else(|| {
            raw_request
                .get("generation_options")
                .and_then(|go| go.get("include_optional_certification"))
        })
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Clarifying questions for broad or underspecified goals (@S01)
    let mut clarifying_questions = Vec::new();
    let prompt_lower = prompt.to_ascii_lowercase();
    if prompt.split_whitespace().count() <= 3
        || prompt_lower == "learn ai"
        || prompt_lower == "machine learning"
        || prompt_lower == "python"
    {
        clarifying_questions.push(
            "Which concrete application focus do you want first (e.g., RAG document retrieval in Python vs. model fine-tuning)?"
                .to_string(),
        );
        clarifying_questions.push(
            "What is your current Python and linear algebra comfort level (beginner, intermediate, or advanced)?"
                .to_string(),
        );
    }
    if raw_request.get("weekly_available_minutes").is_none()
        && raw_request.get("constraints").is_none()
    {
        clarifying_questions.push(
            "How many minutes per week can you realistically dedicate to reading, coding practice, and assessments?"
                .to_string(),
        );
    }

    let topic = if prompt_lower.contains("rag")
        || prompt_lower.contains("token")
        || prompt_lower.contains("retrieval")
        || prompt_lower.contains("python")
    {
        "rag-python".to_string()
    } else {
        prompt.to_string()
    };

    let proposed_objectives = if topic == "rag-python" {
        vec![
            "objective-tokenization".to_string(),
            "objective-vector-retrieval".to_string(),
            "objective-rag-evaluation".to_string(),
        ]
    } else {
        vec![format!(
            "objective-{}",
            topic
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                })
                .collect::<String>()
                .trim_matches('-')
        )]
    };

    let total_available_minutes = weekly_available_minutes.saturating_mul(horizon_weeks);
    let minimum_required_minutes = 48u32;
    let (feasibility_status, feasibility_warning, recovery_options) =
        if total_available_minutes < minimum_required_minutes {
            (
                "infeasible".to_string(),
                Some(format!(
                    "Available study budget ({total_available_minutes} minutes across {horizon_weeks} weeks) is below minimum required triad effort ({minimum_required_minutes} minutes)."
                )),
                vec![
                    "reduced_scope".to_string(),
                    "extended_time".to_string(),
                    "increased_availability".to_string(),
                ],
            )
        } else {
            ("feasible".to_string(), None, Vec::new())
        };

    let exp_level = match prior_background_level.as_str() {
        "beginner" | "intermediate" | "advanced" => prior_background_level.as_str(),
        _ => "intermediate",
    };

    let normalized_generation_request = json!({
        "schema_version": "0.2.0",
        "goal": {
            "prompt": prompt,
            "desired_outcomes": [target_role_or_outcome],
            "scope_mode": "focused",
            "target_certification_ids": []
        },
        "learner_profile": {
            "experience_level": exp_level,
            "background_summary": format!("Learner background: {prior_background_level}"),
            "self_reported_known_objective_ids": [],
            "diagnostic_result_refs": [],
            "preferred_language": "en",
            "accessibility_needs": ["captions"],
            "topic_self_reports": [],
            "proficiency_snapshot_ref": null
        },
        "constraints": {
            "weekly_minutes": weekly_available_minutes.max(30),
            "start_date": "2026-10-26",
            "target_end_date": "2026-11-23",
            "deadline_policy": "flexible",
            "timezone": "UTC",
            "available_slots": [],
            "max_session_minutes": weekly_available_minutes.clamp(30, 60),
            "sequence_preference": "balanced",
            "guidance_preference": "guided",
            "preferred_resource_types": ["article", "documentation", "repository"]
        },
        "access_policy": {
            "mode": if free_only { "free_only" } else { "bounded_budget" },
            "owned_resource_ids": [],
            "owned_subscription_ids": owned_subscription_ids,
            "unknown_price_policy": "exclude",
            "allow_trial_required_resources": !free_only,
            "region": "US"
        },
        "budgets": {
            "materials": {
                "currency": budget_currency,
                "max_minor_units": max_budget_minor_units
            },
            "compute": {
                "currency": budget_currency,
                "max_minor_units": 0
            },
            "inference": {
                "currency": budget_currency,
                "max_minor_units": 100
            }
        },
        "inference": {
            "mode": "hosted",
            "model_policy_id": "synthetic-model-policy"
        },
        "generation_options": {
            "include_optional_certification": include_optional_certification,
            "playback_speed": 1,
            "planning_horizon_days": horizon_weeks * 7,
            "include_hands_on": true
        },
        "instruction_preferences": {
            "math_depth": "applied",
            "topic_math_depth_overrides": [],
            "known_material_review": "condensed"
        },
        "template_origin": null
    });

    // Validate the normalized request against generation-request.schema.json
    let registry = ContractRegistry::load_from_workspace()
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;
    registry
        .validate(
            "generation-request.schema.json",
            &normalized_generation_request,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

    let goal_specification = GoalSpecification {
        topic,
        target_role_or_outcome,
        prior_background_level,
        weekly_available_minutes,
        horizon_weeks,
        free_only,
        budget_currency,
        max_budget_minor_units,
        owned_subscription_ids,
        allow_paid_fallback,
        include_optional_certification,
        clarifying_questions,
        proposed_objectives,
        feasibility_warning,
    };

    Ok(GoalInterpretationResult {
        goal_specification,
        feasibility_status,
        recovery_options,
        normalized_generation_request,
    })
}

/// Context parameters governing semantic validation and revision promotion (`T03`, `T04`).
#[derive(Debug, Clone)]
pub struct CandidateValidationContext {
    pub curriculum_id: String,
    pub revision_id: String,
    pub generation_job_id: String,
    pub request_snapshot_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub playback_speed: f64,
    pub free_only: bool,
    pub max_budget_minor_units: Option<u64>,
    pub owned_subscription_ids: Vec<String>,
    pub allow_paid_fallback: bool,
    pub allow_synthetic_fixtures_for_test: bool,
    pub initial_is_active: bool,
}

impl Default for CandidateValidationContext {
    fn default() -> Self {
        Self {
            curriculum_id: "cur-generated-1".to_string(),
            revision_id: "rev-generated-1".to_string(),
            generation_job_id: "gen-job-1".to_string(),
            request_snapshot_id: "req-snap-1".to_string(),
            provider_id: "deterministic-fake".to_string(),
            model_id: "fake-curriculum-v1".to_string(),
            playback_speed: 1.0,
            free_only: true,
            max_budget_minor_units: Some(0),
            owned_subscription_ids: Vec::new(),
            allow_paid_fallback: false,
            allow_synthetic_fixtures_for_test: false,
            initial_is_active: false,
        }
    }
}

/// Recursively inspects untrusted model candidate JSON for forbidden server-owned keys
/// and executable HTML/script payloads (`@S09`, `@S11`, `GEN-004`).
fn detect_forbidden_fields_or_script(value: &Value, path: &str) -> Result<(), String> {
    const FORBIDDEN_KEYS: &[&str] = &[
        "account_id",
        "owner_account_id",
        "mastered",
        "demonstrated",
        "demonstrated_objectives",
        "proficiency_status",
        "html",
        "raw_html",
        "script",
        "executable_js",
    ];

    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if FORBIDDEN_KEYS.contains(&k.as_str()) {
                    return Err(format!(
                        "forbidden server-owned or executable field `{k}` at `{path}`"
                    ));
                }
                let child_path = format!("{path}.{k}");
                detect_forbidden_fields_or_script(v, &child_path)?;
            }
        }
        Value::Array(arr) => {
            for (idx, item) in arr.iter().enumerate() {
                let child_path = format!("{path}[{idx}]");
                detect_forbidden_fields_or_script(item, &child_path)?;
            }
        }
        Value::String(s) => {
            let lower = s.to_ascii_lowercase();
            for pattern in [
                "<script",
                "</script",
                "javascript:",
                "onerror=",
                "onload=",
                "<iframe",
            ] {
                if lower.contains(pattern) {
                    return Err(format!(
                        "unsafe executable markup `{pattern}` detected in string at `{path}`"
                    ));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Validates a raw UTF-8 model candidate against:
/// 1. Raw UTF-8 SHA-256 archival (`@S28`, `NFR-005`)
/// 2. Forbidden fields & executable script/HTML rejection (`@S09`, `@S11`, `GEN-004`)
/// 3. JSON Schema Draft 2020-12 (`curriculum.schema.json#/$defs/modelCandidate`)
/// 4. Unique IDs (`objective_id`, `module_id`, `activity_id`) & DAG acyclicity (`@S10`, `@S11`, `GEN-003`)
/// 5. Catalog resource resolution, synthetic fixture gate, quarantine/approval gate & budget/rights rules (`@S05`, `@S06`, `@S07`, `@S09`, `@S10`)
/// 6. Pedagogical triad coverage (`instruction`, `practice`, `assessment` with `assessment_ref`) (`PED-001`, `@S10`, `@S13`)
/// 7. Duration component bounds & playback-speed ceiling math (`SCHED-001`, `@S12`, `@S20`)
/// 8. Promotion to a canonical `curriculum.schema.json` revision and validation against `curriculum.schema.json`.
pub fn validate_candidate_and_promote_to_revision<S>(
    store: &S,
    principal: &AuthenticatedPrincipal,
    raw_candidate_utf8: &str,
    ctx: &CandidateValidationContext,
) -> Result<CurriculumRevisionRecord, PersistenceError>
where
    S: CatalogRetrievalPort + CurriculumRevisionPersistencePort,
{
    let candidate_sha256 = sha256_bytes_hex(raw_candidate_utf8.as_bytes());
    let archive_id = format!("arch-{}-{}", ctx.curriculum_id, ctx.revision_id);

    let fail_and_archive = |code: &str, msg: String| -> PersistenceError {
        store.record_candidate_archive(CandidateArchiveRecord {
            archive_id: archive_id.clone(),
            curriculum_id: ctx.curriculum_id.clone(),
            revision_id: None,
            provider_id: ctx.provider_id.clone(),
            raw_utf8_payload: raw_candidate_utf8.to_string(),
            candidate_sha256: candidate_sha256.clone(),
            validation_succeeded: false,
            validation_errors: vec![format!("{code}: {msg}")],
        });
        PersistenceError::InvalidModelCandidate {
            code: code.to_string(),
            message: msg,
        }
    };

    // 1. Parse UTF-8 JSON
    let parsed_candidate: Value = serde_json::from_str(raw_candidate_utf8)
        .map_err(|e| fail_and_archive("invalid_json", format!("malformed candidate JSON: {e}")))?;

    // 2. Scan for forbidden server-owned fields or executable script/HTML markup (@S09, @S11)
    if let Err(reason) = detect_forbidden_fields_or_script(&parsed_candidate, "$") {
        return Err(fail_and_archive(
            "forbidden_field_or_executable_markup",
            reason,
        ));
    }

    // 3. Validate against curriculum.schema.json#/$defs/modelCandidate
    let registry = ContractRegistry::load_from_workspace()
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;
    if let Err(schema_err) = registry.validate_def(
        "curriculum.schema.json",
        "modelCandidate",
        &parsed_candidate,
    ) {
        return Err(fail_and_archive(
            "candidate_schema_violation",
            schema_err.to_string(),
        ));
    }

    // 4. Validate unique objective IDs and objective prerequisite DAG acyclicity (@S10, @S11)
    let objectives = parsed_candidate
        .get("objectives")
        .and_then(|v| v.as_array())
        .ok_or_else(|| fail_and_archive("missing_objectives", "objectives array missing".into()))?;

    let mut objective_ids = BTreeSet::new();
    let mut objective_prereqs: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for obj in objectives {
        let oid = obj
            .get("objective_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| fail_and_archive("invalid_objective_id", "missing objective_id".into()))?
            .to_string();
        if !objective_ids.insert(oid.clone()) {
            return Err(fail_and_archive(
                "duplicate_objective_id",
                format!("duplicate objective_id `{oid}`"),
            ));
        }
        objective_prereqs.insert(oid, Vec::new());
    }

    if let Some(edges) = parsed_candidate
        .get("prerequisite_edges")
        .and_then(|v| v.as_array())
    {
        for edge in edges {
            let from_id = edge
                .get("from_objective_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let to_id = edge
                .get("to_objective_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if !objective_ids.contains(&from_id) || !objective_ids.contains(&to_id) {
                return Err(fail_and_archive(
                    "unknown_objective_in_prerequisite_edge",
                    format!("prerequisite edge `{from_id} -> {to_id}` references unknown objective"),
                ));
            }
            if let Some(list) = objective_prereqs.get_mut(&to_id) {
                list.push(from_id);
            }
        }
    }

    let obj_dag_edges: Vec<(String, Vec<String>)> = objective_prereqs.into_iter().collect();
    validate_dag_acyclic(&obj_dag_edges).map_err(|e| {
        fail_and_archive(
            "objective_dag_cycle",
            format!("objective DAG validation failed: {e}"),
        )
    })?;

    // 5. Validate activities, unique activity_ids, activity DAG acyclicity, catalog resource references, and duration bounds
    let activities = parsed_candidate
        .get("activities")
        .and_then(|v| v.as_array())
        .ok_or_else(|| fail_and_archive("missing_activities", "activities array missing".into()))?;

    let mut activity_ids = BTreeSet::new();
    let mut activity_by_id: BTreeMap<String, &Value> = BTreeMap::new();
    let mut activity_dag_input: Vec<(String, Vec<String>)> = Vec::new();
    let mut referenced_resource_version_ids = BTreeSet::new();

    let mut total_lower_minutes = 0u32;
    let mut total_point_minutes = 0u32;
    let mut total_upper_minutes = 0u32;

    for act in activities {
        let aid = act
            .get("activity_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| fail_and_archive("invalid_activity_id", "missing activity_id".into()))?
            .to_string();
        if !activity_ids.insert(aid.clone()) {
            return Err(fail_and_archive(
                "duplicate_activity_id",
                format!("duplicate activity_id `{aid}`"),
            ));
        }
        activity_by_id.insert(aid.clone(), act);

        // Verify activity objective_ids resolve
        let act_objs = act
            .get("objective_ids")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                fail_and_archive(
                    "invalid_activity_objectives",
                    format!("activity `{aid}` missing objective_ids"),
                )
            })?;
        for o in act_objs {
            let oid = o.as_str().unwrap_or_default();
            if !objective_ids.contains(oid) {
                return Err(fail_and_archive(
                    "unknown_activity_objective",
                    format!("activity `{aid}` references unknown objective `{oid}`"),
                ));
            }
        }

        let prereq_aids: Vec<String> = act
            .get("prerequisite_activity_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        activity_dag_input.push((aid.clone(), prereq_aids));

        // Verify resource_assignments resolve to approved, non-quarantined, budget-eligible catalog resources (@S05, @S06, @S07, @S09, @S10)
        if let Some(assignments) = act.get("resource_assignments").and_then(|v| v.as_array()) {
            for assign in assignments {
                let rv_id = assign
                    .get("resource_version_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let cat_res = store.get_catalog_resource_version(&rv_id).map_err(|_| {
                    fail_and_archive(
                        "unknown_catalog_resource",
                        format!("activity `{aid}` references unknown or unreviewed resource_version_id `{rv_id}`"),
                    )
                })?;

                if cat_res.is_synthetic_fixture && !ctx.allow_synthetic_fixtures_for_test {
                    store.record_candidate_archive(CandidateArchiveRecord {
                        archive_id: archive_id.clone(),
                        curriculum_id: ctx.curriculum_id.clone(),
                        revision_id: None,
                        provider_id: ctx.provider_id.clone(),
                        raw_utf8_payload: raw_candidate_utf8.to_string(),
                        candidate_sha256: candidate_sha256.clone(),
                        validation_succeeded: false,
                        validation_errors: vec![format!("synthetic_fixture_forbidden: {rv_id}")],
                    });
                    return Err(PersistenceError::SyntheticFixtureForbiddenInProduction {
                        resource_version_id: rv_id,
                    });
                }

                if cat_res.review_status != ResourceReviewStatus::Approved
                    || cat_res.review_evidence.is_none()
                    || cat_res.freshness_state == ResourceFreshnessState::Broken
                {
                    store.record_candidate_archive(CandidateArchiveRecord {
                        archive_id: archive_id.clone(),
                        curriculum_id: ctx.curriculum_id.clone(),
                        revision_id: None,
                        provider_id: ctx.provider_id.clone(),
                        raw_utf8_payload: raw_candidate_utf8.to_string(),
                        candidate_sha256: candidate_sha256.clone(),
                        validation_succeeded: false,
                        validation_errors: vec![format!("ineligible_resource: {rv_id}")],
                    });
                    return Err(PersistenceError::IneligibleCatalogResource {
                        resource_version_id: rv_id,
                        reason: "resource version is unapproved, quarantined, or broken"
                            .to_string(),
                    });
                }

                // Budget / access model check (@S05, @S06)
                match cat_res.access_model {
                    CatalogAccessModel::UnknownPrice => {
                        return Err(PersistenceError::IneligibleCatalogResource {
                            resource_version_id: rv_id,
                            reason: "unknown_price resource cannot be assigned to core curriculum activities".to_string(),
                        });
                    }
                    CatalogAccessModel::PaidPurchase | CatalogAccessModel::FreemiumTrial => {
                        if ctx.free_only && !ctx.allow_paid_fallback {
                            return Err(PersistenceError::IneligibleCatalogResource {
                                resource_version_id: rv_id,
                                reason: "paid resource is not eligible under free_only learner policy".to_string(),
                            });
                        }
                        if let Some(max_b) = ctx.max_budget_minor_units {
                            if !ctx.free_only && cat_res.price_minor_units.unwrap_or(u64::MAX) > max_b {
                                return Err(PersistenceError::IneligibleCatalogResource {
                                    resource_version_id: rv_id,
                                    reason: "paid resource price exceeds learner max_budget_minor_units".to_string(),
                                });
                            }
                        }
                    }
                    CatalogAccessModel::Subscription => {
                        let covered = cat_res
                            .subscription_ids
                            .iter()
                            .any(|sub| ctx.owned_subscription_ids.contains(sub));
                        if !covered && ctx.free_only && !ctx.allow_paid_fallback {
                            return Err(PersistenceError::IneligibleCatalogResource {
                                resource_version_id: rv_id,
                                reason: "subscription resource is not covered by learner owned_subscription_ids under free_only policy".to_string(),
                            });
                        }
                    }
                    CatalogAccessModel::FreePublic => {}
                }

                referenced_resource_version_ids.insert(rv_id);
            }
        }

        // Validate duration bounds & compute adjusted effort via domain service (@S12, @S20)
        let dur = act.get("duration_estimate").ok_or_else(|| {
            fail_and_archive(
                "missing_duration_estimate",
                format!("activity `{aid}` missing duration_estimate"),
            )
        })?;
        let lower = dur.get("lower_bounds").ok_or_else(|| {
            fail_and_archive(
                "missing_lower_bounds",
                format!("activity `{aid}` missing lower_bounds"),
            )
        })?;
        let upper = dur.get("upper_bounds").ok_or_else(|| {
            fail_and_archive(
                "missing_upper_bounds",
                format!("activity `{aid}` missing upper_bounds"),
            )
        })?;

        let triplet = |comp: &str| -> Result<EffortTriplet, PersistenceError> {
            let min_m = lower.get(comp).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let pt_m = dur.get(comp).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let max_m = upper.get(comp).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            Ok(EffortTriplet {
                min_minutes: min_m,
                point_minutes: pt_m,
                max_minutes: max_m,
            })
        };

        let breakdown = ActivityComponentBreakdown {
            media: triplet("media_minutes")?,
            reading: triplet("reading_minutes")?,
            practice: triplet("practice_minutes")?,
            assessment: triplet("assessment_minutes")?,
            review: triplet("review_minutes")?,
        };

        let adjusted = breakdown.adjusted_effort(ctx.playback_speed).map_err(|e| {
            fail_and_archive(
                "invalid_duration_bounds",
                format!("activity `{aid}` failed duration validation: {e}"),
            )
        })?;

        total_lower_minutes += adjusted.min_minutes;
        total_point_minutes += adjusted.point_minutes;
        total_upper_minutes += adjusted.max_minutes;
    }

    // Validate activity prerequisite DAG acyclicity
    validate_dag_acyclic(&activity_dag_input).map_err(|e| {
        fail_and_archive(
            "activity_dag_cycle",
            format!("activity prerequisite DAG validation failed: {e}"),
        )
    })?;

    // Validate modules
    let modules = parsed_candidate
        .get("modules")
        .and_then(|v| v.as_array())
        .ok_or_else(|| fail_and_archive("missing_modules", "modules array missing".into()))?;
    let mut module_ids = BTreeSet::new();
    for m in modules {
        let mid = m
            .get("module_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| fail_and_archive("invalid_module_id", "missing module_id".into()))?
            .to_string();
        if !module_ids.insert(mid.clone()) {
            return Err(fail_and_archive(
                "duplicate_module_id",
                format!("duplicate module_id `{mid}`"),
            ));
        }
        if let Some(m_objs) = m.get("objective_ids").and_then(|v| v.as_array()) {
            for o in m_objs {
                let oid = o.as_str().unwrap_or_default();
                if !objective_ids.contains(oid) {
                    return Err(fail_and_archive(
                        "unknown_module_objective",
                        format!("module `{mid}` references unknown objective `{oid}`"),
                    ));
                }
            }
        }
        if let Some(m_acts) = m.get("activity_ids").and_then(|v| v.as_array()) {
            for a in m_acts {
                let aid = a.as_str().unwrap_or_default();
                if !activity_ids.contains(aid) {
                    return Err(fail_and_archive(
                        "unknown_module_activity",
                        format!("module `{mid}` references unknown activity `{aid}`"),
                    ));
                }
            }
        }
    }

    // 6. Validate Pedagogical Triad Coverage (`instruction`, `practice`, `assessment` with `assessment_ref`) (`PED-001`, `@S10`, `@S13`)
    for obj in objectives {
        let oid = obj
            .get("objective_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        let mut has_instruction = false;
        let mut has_practice = false;
        let mut has_assessment = false;

        for act in activities {
            let maps_to_obj = act
                .get("objective_ids")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().any(|x| x.as_str() == Some(oid)))
                .unwrap_or(false);
            if !maps_to_obj {
                continue;
            }
            let act_type = act.get("type").and_then(|v| v.as_str()).unwrap_or_default();
            let dur = act.get("duration_estimate");
            let media_m = dur
                .and_then(|d| d.get("media_minutes"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let reading_m = dur
                .and_then(|d| d.get("reading_minutes"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let practice_m = dur
                .and_then(|d| d.get("practice_minutes"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            if matches!(act_type, "theory" | "worked_example") || (media_m + reading_m > 0) {
                has_instruction = true;
            }
            if matches!(
                act_type,
                "worked_example" | "coding" | "exercise" | "project" | "reflection"
            ) || practice_m > 0
            {
                has_practice = true;
            }
        }

        if let Some(assess_ids) = obj.get("assessment_activity_ids").and_then(|v| v.as_array()) {
            for aid_val in assess_ids {
                if let Some(aid) = aid_val.as_str() {
                    if let Some(act) = activity_by_id.get(aid) {
                        let maps_to_obj = act
                            .get("objective_ids")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.iter().any(|x| x.as_str() == Some(oid)))
                            .unwrap_or(false);
                        let has_ref = act
                            .get("content")
                            .and_then(|c| c.get("assessment_ref"))
                            .and_then(|v| v.as_str())
                            .map(|s| !s.trim().is_empty())
                            .unwrap_or(false);
                        if maps_to_obj && has_ref {
                            has_assessment = true;
                        }
                    }
                }
            }
        }

        validate_pedagogical_triad_coverage(oid, has_instruction, has_practice, has_assessment)
            .map_err(|e| fail_and_archive("missing_pedagogical_triad", e.to_string()))?;
    }

    // 7. Promote validated modelCandidate to canonical curriculum.schema.json revision
    let coverage_limitations = parsed_candidate
        .get("coverage_limitations")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let is_partial = coverage_limitations
        .as_array()
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    let source_ids: Vec<String> = referenced_resource_version_ids.into_iter().collect();

    let playback_speed_json = if (ctx.playback_speed - ctx.playback_speed.round()).abs() < 1e-9 {
        json!(ctx.playback_speed as i64)
    } else {
        json!(ctx.playback_speed)
    };

    let promoted = json!({
        "schema_version": "0.2.0",
        "curriculum_id": ctx.curriculum_id,
        "revision_id": ctx.revision_id,
        "revision_number": 1,
        "predecessor_revision_id": null,
        "account_id": principal.account_id,
        "created_at": "2026-10-20T16:00:00Z",
        "revision_reason": "initial_generation",
        "goal": parsed_candidate["goal"],
        "language": parsed_candidate["language"],
        "sequence_preference_applied": parsed_candidate["sequence_preference_applied"],
        "objectives": parsed_candidate["objectives"],
        "prerequisite_edges": parsed_candidate["prerequisite_edges"],
        "modules": parsed_candidate["modules"],
        "activities": parsed_candidate["activities"],
        "certification_options": parsed_candidate["certification_options"],
        "coverage_limitations": coverage_limitations,
        "duration_policy": {
            "playback_speed": playback_speed_json,
            "rounding": "ceil_per_activity",
            "policy_version": "synthetic-duration-policy"
        },
        "total_estimated_minutes": total_point_minutes.max(1),
        "total_estimate_range_minutes": {
            "lower": total_lower_minutes,
            "upper": total_upper_minutes.max(1)
        },
        "coverage_status": if is_partial { "partial" } else { "complete" },
        "provenance": {
            "generation_job_id": ctx.generation_job_id,
            "catalog_snapshot_id": "synthetic-catalog-1",
            "request_snapshot_id": ctx.request_snapshot_id,
            "retrieval_policy_version": "synthetic-retrieval-policy",
            "source_resource_version_ids": source_ids,
            "pedagogy_policy_version": "synthetic-pedagogy-policy",
            "generator_policy_version": "synthetic-generator-policy",
            "prompt_template_version": "synthetic-prompt-template",
            "provider_id": ctx.provider_id,
            "model_id": ctx.model_id,
            "candidate_sha256": candidate_sha256,
            "validation_policy_version": "synthetic-validation-policy"
        },
        "instruction_preferences_applied": parsed_candidate["instruction_preferences_applied"],
        "adaptation_context": {
            "proficiency_snapshot_ref": null,
            "adaptation_policy_version": "adaptation-policy-001",
            "waiver_refs": [],
            "origin_publication_revision_id": null
        }
    });

    // 8. Authoritative JSON Schema validation on promoted curriculum.schema.json document
    if let Err(e) = registry.validate("curriculum.schema.json", &promoted) {
        return Err(fail_and_archive(
            "promoted_curriculum_schema_violation",
            e.to_string(),
        ));
    }

    store.record_candidate_archive(CandidateArchiveRecord {
        archive_id,
        curriculum_id: ctx.curriculum_id.clone(),
        revision_id: Some(ctx.revision_id.clone()),
        provider_id: ctx.provider_id.clone(),
        raw_utf8_payload: raw_candidate_utf8.to_string(),
        candidate_sha256: candidate_sha256.clone(),
        validation_succeeded: true,
        validation_errors: Vec::new(),
    });

    store.commit_validated_curriculum_revision(
        principal,
        &ctx.curriculum_id,
        &ctx.revision_id,
        &candidate_sha256,
        promoted,
        ctx.initial_is_active,
    )
}

/// Orchestrates an asynchronous generation job through the canonical lifecycle
/// `queued -> retrieving -> generating -> validating -> succeeded` (or `failed`)
/// using `DeterministicFakeProvider` (`T03`, `T04`, `@S18`, `@S21`, `@S28`).
pub fn execute_generation_job<S>(
    store: &S,
    principal: &AuthenticatedPrincipal,
    job_id: &str,
    curriculum_id: &str,
    revision_id: &str,
    raw_request: &Value,
) -> Result<GenerationJobRecord, PersistenceError>
where
    S: CatalogRetrievalPort + CurriculumRevisionPersistencePort + GenerationJobRepositoryPort,
{
    let interpreted = interpret_goal_request(raw_request)?;
    let spec = &interpreted.goal_specification;

    let credential_mode = raw_request
        .get("credential_mode")
        .and_then(|v| v.as_str())
        .or_else(|| {
            raw_request
                .get("inference")
                .and_then(|i| i.get("mode"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("deterministic_fake")
        .to_string();

    let mut stage_history = vec!["queued".to_string(), "retrieving".to_string()];

    // Step 1: Deterministic catalog metadata retrieval (`T02`)
    let filter_query = CatalogFilterQuery {
        topic: Some(spec.topic.clone()),
        objective_ids: if spec.topic == "rag-python" {
            vec!["objective-tokenization".to_string()]
        } else {
            spec.proposed_objectives.clone()
        },
        free_only: spec.free_only,
        budget_currency: Some(spec.budget_currency.clone()),
        max_budget_minor_units: Some(spec.max_budget_minor_units),
        owned_subscription_ids: spec.owned_subscription_ids.clone(),
        allow_paid_fallback: spec.allow_paid_fallback,
        include_optional_certification: spec.include_optional_certification,
        allow_synthetic_fixtures_for_test: false,
    };

    if let Err(err) = store.filter_catalog_resources(&filter_query) {
        let failed_job = GenerationJobRecord {
            job_id: job_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            status: "failed".to_string(),
            stage_history,
            curriculum_id: None,
            revision_id: None,
            candidate_sha256: None,
            provider_id: "deterministic-fake".to_string(),
            credential_mode,
            request_payload: raw_request.clone(),
            error_code: Some(err.error_code().to_string()),
            error_message: Some(err.to_string()),
            etag: format!("\"gen-{job_id}-failed\""),
        };
        store.upsert_generation_job(failed_job);
        return Err(err);
    }

    // Step 2: Generate untrusted candidate via DeterministicFakeProvider (`T03`)
    stage_history.push("generating".to_string());
    let fault_mode = match raw_request
        .get("simulate_provider_fault")
        .and_then(|v| v.as_str())
    {
        Some("byok_auth_rejected") => FakeFaultInjection::ByokAuthRejected,
        Some("quota_exceeded") => FakeFaultInjection::QuotaExceeded,
        Some("invalid_executable_candidate") => FakeFaultInjection::InvalidExecutableCandidate,
        Some("ambiguous_timeout") => FakeFaultInjection::AmbiguousTimeout,
        _ => FakeFaultInjection::None,
    };
    let provider = DeterministicFakeProvider::new(fault_mode);
    let auth_mode = if credential_mode == "byok" {
        InferenceAuthMode::Byok {
            credential_id: raw_request
                .get("credential_ref")
                .and_then(|v| v.as_str())
                .unwrap_or("cred-default")
                .to_string(),
            credential_version: 1,
        }
    } else {
        InferenceAuthMode::DeterministicFake
    };

    let gen_req = CandidateGenerationRequest {
        request_id: job_id.to_string(),
        account_id: principal.account_id.clone(),
        goal_id: format!("goal-{job_id}"),
        auth_mode,
        allow_hosted_fallback: false,
        max_output_tokens: 4_096,
    };

    let candidate_output = match provider.generate_curriculum_candidate(&gen_req) {
        Ok(out) => out,
        Err(prov_err) => {
            let (code, msg) = match &prov_err {
                ProviderError::InvalidCandidateOutput { message } => {
                    ("invalid_model_output", message.clone())
                }
                other => ("provider_generation_failed", other.to_string()),
            };
            let failed_job = GenerationJobRecord {
                job_id: job_id.to_string(),
                owner_account_id: principal.account_id.clone(),
                status: "failed".to_string(),
                stage_history,
                curriculum_id: None,
                revision_id: None,
                candidate_sha256: None,
                provider_id: provider.capabilities().provider_id.clone(),
                credential_mode,
                request_payload: raw_request.clone(),
                error_code: Some(code.to_string()),
                error_message: Some(msg.clone()),
                etag: format!("\"gen-{job_id}-failed\""),
            };
            store.upsert_generation_job(failed_job);
            return Err(PersistenceError::InvalidModelCandidate {
                code: code.to_string(),
                message: msg,
            });
        }
    };

    // Step 3: Authoritative Semantic Validation & Draft Revision Promotion (`T03`, `T04`)
    stage_history.push("validating".to_string());
    let playback_speed = raw_request
        .get("playback_speed")
        .or_else(|| {
            raw_request
                .get("generation_options")
                .and_then(|o| o.get("playback_speed"))
        })
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);

    let val_ctx = CandidateValidationContext {
        curriculum_id: curriculum_id.to_string(),
        revision_id: revision_id.to_string(),
        generation_job_id: job_id.to_string(),
        request_snapshot_id: format!("req-snap-{job_id}"),
        provider_id: provider.capabilities().provider_id.clone(),
        model_id: provider.capabilities().model_id.clone(),
        playback_speed,
        free_only: spec.free_only,
        max_budget_minor_units: Some(spec.max_budget_minor_units),
        owned_subscription_ids: spec.owned_subscription_ids.clone(),
        allow_paid_fallback: spec.allow_paid_fallback,
        // DeterministicFakeProvider emits the canonical `curriculum-candidate.synthetic.json` fixture
        allow_synthetic_fixtures_for_test: provider.capabilities().provider_id
            == "deterministic-fake",
        // New generated revisions start as draft (`is_active: false`) until explicitly activated via If-Match (`T04`)
        initial_is_active: false,
    };

    let committed = validate_candidate_and_promote_to_revision(
        store,
        principal,
        &candidate_output.raw_candidate_json,
        &val_ctx,
    )?;

    stage_history.push("succeeded".to_string());
    let succeeded_job = GenerationJobRecord {
        job_id: job_id.to_string(),
        owner_account_id: principal.account_id.clone(),
        status: "succeeded".to_string(),
        stage_history,
        curriculum_id: Some(committed.curriculum_id),
        revision_id: Some(committed.revision_id),
        candidate_sha256: Some(committed.candidate_sha256),
        provider_id: provider.capabilities().provider_id.clone(),
        credential_mode,
        request_payload: raw_request.clone(),
        error_code: None,
        error_message: None,
        etag: format!("\"gen-{job_id}-succeeded\""),
    };
    store.upsert_generation_job(succeeded_job.clone());
    Ok(succeeded_job)
}

#[cfg(test)]
mod tests {
    use super::*;
    use curriculum_security::PrincipalRole;

    fn learner_a() -> AuthenticatedPrincipal {
        AuthenticatedPrincipal {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            roles: vec![PrincipalRole::Learner],
            is_development_only_identity: true,
        }
    }

    fn read_canonical_candidate() -> String {
        let root = curriculum_contracts::workspace_root();
        std::fs::read_to_string(
            root.join("specs/001-curriculum-platform/examples/curriculum-candidate.synthetic.json"),
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
        .expect("valid real catalog candidate promotes to curriculum revision");
        assert_eq!(promoted_real.payload["total_estimated_minutes"], json!(48));
        assert_eq!(
            promoted_real.payload["total_estimate_range_minutes"],
            json!({"lower": 38, "upper": 76})
        );
        assert!(!promoted_real.is_active);

        // 3. Canonical synthetic candidate with `allow_synthetic_fixtures_for_test: true` preserves exact SHA-256
        let test_ctx = CandidateValidationContext {
            curriculum_id: "cur-synth-1".to_string(),
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
            "3e47ee0d4631041709e565f9b3de28e683199ef8cf8941ecc4503a849be523de"
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
            Some("3e47ee0d4631041709e565f9b3de28e683199ef8cf8941ecc4503a849be523de")
        );

        let archive = store
            .get_candidate_archive("arch-cur-rag-alpha-1-rev-rag-alpha-1")
            .expect("candidate archive recorded");
        assert!(archive.validation_succeeded);
        assert_eq!(
            archive.candidate_sha256,
            "3e47ee0d4631041709e565f9b3de28e683199ef8cf8941ecc4503a849be523de"
        );
    }
}
