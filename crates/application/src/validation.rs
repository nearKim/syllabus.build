//! Authoritative candidate semantic validation and revision promotion collaborators (`T03`, `T04`, `extract-collaborators`).

use std::collections::{BTreeMap, BTreeSet};

use syllabus_contracts::jcs::sha256_bytes_hex;
use syllabus_contracts::ContractRegistry;
use syllabus_domain::{
    validate_dag_acyclic, validate_pedagogical_triad_coverage, ActivityComponentBreakdown,
    EffortTriplet,
};
use syllabus_persistence::{
    serde_json::{self, json, Value},
    CandidateArchiveRecord, CatalogAccessModel, PersistenceError, ResourceFreshnessState,
    ResourceReviewStatus, SyllabusRevisionRecord,
};
use syllabus_security::AuthenticatedPrincipal;

use crate::ports::{CatalogRetrievalPort, SyllabusRevisionPersistencePort};

/// Context parameters governing semantic validation and revision promotion (`T03`, `T04`).
#[derive(Debug, Clone)]
pub struct CandidateValidationContext {
    pub syllabus_id: String,
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
            syllabus_id: "cur-generated-1".to_string(),
            revision_id: "rev-generated-1".to_string(),
            generation_job_id: "gen-job-1".to_string(),
            request_snapshot_id: "req-snap-1".to_string(),
            provider_id: "deterministic-fake".to_string(),
            model_id: "fake-syllabus-v1".to_string(),
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

// -----------------------------------------------------------------------------
// Collaborator 1: CandidateArchiver
// -----------------------------------------------------------------------------

/// Collaborator 1: Manages archival audit records on validation failure or success (`@S28`, `NFR-005`).
pub struct CandidateArchiver<'a, S> {
    store: &'a S,
    ctx: &'a CandidateValidationContext,
    candidate_sha256: String,
    raw_candidate_utf8: &'a str,
    archive_id: String,
}

impl<'a, S: SyllabusRevisionPersistencePort> CandidateArchiver<'a, S> {
    pub fn new(
        store: &'a S,
        ctx: &'a CandidateValidationContext,
        candidate_sha256: &str,
        raw_candidate_utf8: &'a str,
    ) -> Self {
        Self {
            store,
            ctx,
            candidate_sha256: candidate_sha256.to_string(),
            raw_candidate_utf8,
            archive_id: format!("arch-{}-{}", ctx.syllabus_id, ctx.revision_id),
        }
    }

    pub fn fail(&self, code: &str, msg: String) -> PersistenceError {
        self.store.record_candidate_archive(CandidateArchiveRecord {
            archive_id: self.archive_id.clone(),
            syllabus_id: self.ctx.syllabus_id.clone(),
            revision_id: None,
            provider_id: self.ctx.provider_id.clone(),
            raw_utf8_payload: self.raw_candidate_utf8.to_string(),
            candidate_sha256: self.candidate_sha256.clone(),
            validation_succeeded: false,
            validation_errors: vec![format!("{code}: {msg}")],
        });
        PersistenceError::InvalidModelCandidate {
            code: code.to_string(),
            message: msg,
        }
    }

    pub fn record_failure_archive(&self, err: &PersistenceError) {
        let err_str = match err {
            PersistenceError::SyntheticFixtureForbiddenInProduction {
                resource_version_id,
            } => {
                format!("synthetic_fixture_forbidden: {resource_version_id}")
            }
            PersistenceError::IneligibleCatalogResource {
                resource_version_id,
                ..
            } => {
                format!("ineligible_resource: {resource_version_id}")
            }
            _ => format!("{}: {}", err.error_code(), err),
        };
        self.store.record_candidate_archive(CandidateArchiveRecord {
            archive_id: self.archive_id.clone(),
            syllabus_id: self.ctx.syllabus_id.clone(),
            revision_id: None,
            provider_id: self.ctx.provider_id.clone(),
            raw_utf8_payload: self.raw_candidate_utf8.to_string(),
            candidate_sha256: self.candidate_sha256.clone(),
            validation_succeeded: false,
            validation_errors: vec![err_str],
        });
    }

    pub fn record_success(&self) {
        self.store.record_candidate_archive(CandidateArchiveRecord {
            archive_id: self.archive_id.clone(),
            syllabus_id: self.ctx.syllabus_id.clone(),
            revision_id: Some(self.ctx.revision_id.clone()),
            provider_id: self.ctx.provider_id.clone(),
            raw_utf8_payload: self.raw_candidate_utf8.to_string(),
            candidate_sha256: self.candidate_sha256.clone(),
            validation_succeeded: true,
            validation_errors: Vec::new(),
        });
    }
}

// -----------------------------------------------------------------------------
// Collaborator 2: CandidateSecurityValidator
// -----------------------------------------------------------------------------

/// Collaborator 2: Recursively inspects untrusted model candidate JSON for forbidden
/// server-owned keys and executable script/HTML markup (`@S09`, `@S11`, `GEN-004`).
pub struct CandidateSecurityValidator;

impl CandidateSecurityValidator {
    pub fn validate(value: &Value) -> Result<(), (String, String)> {
        Self::detect_forbidden(value, "$")
            .map_err(|reason| ("forbidden_field_or_executable_markup".to_string(), reason))
    }

    fn detect_forbidden(value: &Value, path: &str) -> Result<(), String> {
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
                    Self::detect_forbidden(v, &child_path)?;
                }
            }
            Value::Array(arr) => {
                for (idx, item) in arr.iter().enumerate() {
                    let child_path = format!("{path}[{idx}]");
                    Self::detect_forbidden(item, &child_path)?;
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
}

// -----------------------------------------------------------------------------
// Collaborator 3: CandidateSchemaValidator
// -----------------------------------------------------------------------------

/// Collaborator 3: Validates candidate payload and promoted syllabus against JSON schema definitions (`@S10`).
pub struct CandidateSchemaValidator;

impl CandidateSchemaValidator {
    pub fn validate_candidate_def(candidate: &Value) -> Result<(), (String, String)> {
        let registry = ContractRegistry::global()
            .map_err(|e| ("candidate_schema_violation".to_string(), e.to_string()))?;
        registry
            .validate_def("syllabus.schema.json", "modelCandidate", candidate)
            .map_err(|e| ("candidate_schema_violation".to_string(), e.to_string()))
    }

    pub fn validate_promoted_schema(promoted: &Value) -> Result<(), (String, String)> {
        let registry = ContractRegistry::global().map_err(|e| {
            (
                "promoted_syllabus_schema_violation".to_string(),
                e.to_string(),
            )
        })?;
        registry
            .validate("syllabus.schema.json", promoted)
            .map_err(|e| {
                (
                    "promoted_syllabus_schema_violation".to_string(),
                    e.to_string(),
                )
            })
    }
}

// -----------------------------------------------------------------------------
// Collaborator 4: ObjectiveDagValidator
// -----------------------------------------------------------------------------

/// Collaborator 4: Validates unique objective IDs, builds prerequisite graph, and checks acyclicity (`@S10`, `@S11`).
pub struct ObjectiveDagValidator;

impl ObjectiveDagValidator {
    pub fn validate(candidate: &Value) -> Result<BTreeSet<String>, (String, String)> {
        let objectives = candidate
            .get("objectives")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                (
                    "missing_objectives".to_string(),
                    "objectives array missing".into(),
                )
            })?;

        let mut objective_ids = BTreeSet::new();
        let mut objective_prereqs: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for obj in objectives {
            let oid = obj
                .get("objective_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    (
                        "invalid_objective_id".to_string(),
                        "missing objective_id".into(),
                    )
                })?
                .to_string();
            if !objective_ids.insert(oid.clone()) {
                return Err((
                    "duplicate_objective_id".to_string(),
                    format!("duplicate objective_id `{oid}`"),
                ));
            }
            objective_prereqs.insert(oid, Vec::new());
        }

        if let Some(edges) = candidate
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
                    return Err((
                        "unknown_objective_in_prerequisite_edge".to_string(),
                        format!(
                            "prerequisite edge `{from_id} -> {to_id}` references unknown objective"
                        ),
                    ));
                }
                if let Some(list) = objective_prereqs.get_mut(&to_id) {
                    list.push(from_id);
                }
            }
        }

        let obj_dag_edges: Vec<(String, Vec<String>)> = objective_prereqs.into_iter().collect();
        validate_dag_acyclic(&obj_dag_edges).map_err(|e| {
            (
                "objective_dag_cycle".to_string(),
                format!("objective DAG validation failed: {e}"),
            )
        })?;

        Ok(objective_ids)
    }
}

// -----------------------------------------------------------------------------
// Collaborator 5: CatalogEligibilityValidator
// -----------------------------------------------------------------------------

/// Collaborator 5: Resolves referenced catalog resources, checking review approval,
/// freshness state, synthetic fixture gates, and learner budget/licensing rules (`@S05`..`@S07`, `@S09`, `@S10`).
pub struct CatalogEligibilityValidator;

impl CatalogEligibilityValidator {
    pub fn check_eligibility<S: CatalogRetrievalPort>(
        store: &S,
        rv_id: &str,
        ctx: &CandidateValidationContext,
    ) -> Result<(), PersistenceError> {
        let cat_res = store.get_catalog_resource_version(rv_id).map_err(|_| {
            PersistenceError::InvalidModelCandidate {
                code: "unknown_catalog_resource".to_string(),
                message: format!(
                    "resource references unknown or unreviewed resource_version_id `{rv_id}`"
                ),
            }
        })?;

        if cat_res.is_synthetic_fixture && !ctx.allow_synthetic_fixtures_for_test {
            return Err(PersistenceError::SyntheticFixtureForbiddenInProduction {
                resource_version_id: rv_id.to_string(),
            });
        }

        if cat_res.review_status != ResourceReviewStatus::Approved
            || cat_res.review_evidence.is_none()
            || cat_res.freshness_state == ResourceFreshnessState::Broken
        {
            return Err(PersistenceError::IneligibleCatalogResource {
                resource_version_id: rv_id.to_string(),
                reason: "resource version is unapproved, quarantined, or broken".to_string(),
            });
        }

        match cat_res.access_model {
            CatalogAccessModel::UnknownPrice => Err(PersistenceError::IneligibleCatalogResource {
                resource_version_id: rv_id.to_string(),
                reason: "unknown_price resource cannot be assigned to core syllabus activities"
                    .to_string(),
            }),
            CatalogAccessModel::PaidPurchase | CatalogAccessModel::FreemiumTrial => {
                if ctx.free_only && !ctx.allow_paid_fallback {
                    return Err(PersistenceError::IneligibleCatalogResource {
                        resource_version_id: rv_id.to_string(),
                        reason: "paid resource is not eligible under free_only learner policy"
                            .to_string(),
                    });
                }
                if let Some(max_b) = ctx.max_budget_minor_units {
                    if !ctx.free_only && cat_res.price_minor_units.unwrap_or(u64::MAX) > max_b {
                        return Err(PersistenceError::IneligibleCatalogResource {
                            resource_version_id: rv_id.to_string(),
                            reason: "paid resource price exceeds learner max_budget_minor_units"
                                .to_string(),
                        });
                    }
                }
                Ok(())
            }
            CatalogAccessModel::Subscription => {
                let covered = cat_res
                    .subscription_ids
                    .iter()
                    .any(|sub| ctx.owned_subscription_ids.contains(sub));
                if !covered && ctx.free_only && !ctx.allow_paid_fallback {
                    return Err(PersistenceError::IneligibleCatalogResource {
                        resource_version_id: rv_id.to_string(),
                        reason: "subscription resource is not covered by learner owned_subscription_ids under free_only policy".to_string(),
                    });
                }
                Ok(())
            }
            CatalogAccessModel::FreePublic => Ok(()),
        }
    }
}

// -----------------------------------------------------------------------------
// Collaborator 6: ActivityAndDurationValidator
// -----------------------------------------------------------------------------

/// Output of activity validation containing resolved IDs, lookup map, duration bounds, and resource refs.
pub struct ActivityValidationOutcome<'a> {
    pub activity_ids: BTreeSet<String>,
    pub activity_by_id: BTreeMap<String, &'a Value>,
    pub total_lower_minutes: u32,
    pub total_point_minutes: u32,
    pub total_upper_minutes: u32,
    pub referenced_resource_version_ids: BTreeSet<String>,
}

/// Collaborator 6: Validates unique activity IDs, objective linkage, prerequisite DAG acyclicity,
/// duration component bounds, and adjusted effort ceiling math (`@S10`, `@S12`, `@S20`).
pub struct ActivityAndDurationValidator;

impl ActivityAndDurationValidator {
    pub fn validate<'a, S: CatalogRetrievalPort + SyllabusRevisionPersistencePort>(
        store: &S,
        candidate: &'a Value,
        objective_ids: &BTreeSet<String>,
        ctx: &CandidateValidationContext,
        archiver: &CandidateArchiver<'_, S>,
    ) -> Result<ActivityValidationOutcome<'a>, PersistenceError> {
        let activities = candidate
            .get("activities")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                archiver.fail("missing_activities", "activities array missing".into())
            })?;

        let mut activity_ids = BTreeSet::new();
        let mut activity_by_id = BTreeMap::new();
        let mut activity_dag_input = Vec::new();
        let mut referenced_resource_version_ids = BTreeSet::new();
        let mut total_lower_minutes = 0u32;
        let mut total_point_minutes = 0u32;
        let mut total_upper_minutes = 0u32;

        for act in activities {
            let aid = act
                .get("activity_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| archiver.fail("invalid_activity_id", "missing activity_id".into()))?
                .to_string();

            if !activity_ids.insert(aid.clone()) {
                return Err(archiver.fail(
                    "duplicate_activity_id",
                    format!("duplicate activity_id `{aid}`"),
                ));
            }
            activity_by_id.insert(aid.clone(), act);

            let act_objs = act
                .get("objective_ids")
                .and_then(|v| v.as_array())
                .ok_or_else(|| {
                    archiver.fail(
                        "invalid_activity_objectives",
                        format!("activity `{aid}` missing objective_ids"),
                    )
                })?;
            for o in act_objs {
                let oid = o.as_str().unwrap_or_default();
                if !objective_ids.contains(oid) {
                    return Err(archiver.fail(
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

            // Catalog checks
            if let Some(assignments) = act.get("resource_assignments").and_then(|v| v.as_array()) {
                for assign in assignments {
                    let rv_id = assign
                        .get("resource_version_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if let Err(err) =
                        CatalogEligibilityValidator::check_eligibility(store, &rv_id, ctx)
                    {
                        archiver.record_failure_archive(&err);
                        return Err(err);
                    }
                    referenced_resource_version_ids.insert(rv_id);
                }
            }

            // Duration calculation
            let dur = act.get("duration_estimate").ok_or_else(|| {
                archiver.fail(
                    "missing_duration_estimate",
                    format!("activity `{aid}` missing duration_estimate"),
                )
            })?;
            let lower = dur.get("lower_bounds").ok_or_else(|| {
                archiver.fail(
                    "missing_lower_bounds",
                    format!("activity `{aid}` missing lower_bounds"),
                )
            })?;
            let upper = dur.get("upper_bounds").ok_or_else(|| {
                archiver.fail(
                    "missing_upper_bounds",
                    format!("activity `{aid}` missing upper_bounds"),
                )
            })?;

            let triplet = |comp: &str| -> EffortTriplet {
                let min_m = lower.get(comp).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let pt_m = dur.get(comp).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let max_m = upper.get(comp).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                EffortTriplet {
                    min_minutes: min_m,
                    point_minutes: pt_m,
                    max_minutes: max_m,
                }
            };

            let breakdown = ActivityComponentBreakdown {
                media: triplet("media_minutes"),
                reading: triplet("reading_minutes"),
                practice: triplet("practice_minutes"),
                assessment: triplet("assessment_minutes"),
                review: triplet("review_minutes"),
            };

            let adjusted = breakdown.adjusted_effort(ctx.playback_speed).map_err(|e| {
                archiver.fail(
                    "invalid_duration_bounds",
                    format!("activity `{aid}` failed duration validation: {e}"),
                )
            })?;

            total_lower_minutes += adjusted.min_minutes;
            total_point_minutes += adjusted.point_minutes;
            total_upper_minutes += adjusted.max_minutes;
        }

        validate_dag_acyclic(&activity_dag_input).map_err(|e| {
            archiver.fail(
                "activity_dag_cycle",
                format!("activity prerequisite DAG validation failed: {e}"),
            )
        })?;

        Ok(ActivityValidationOutcome {
            activity_ids,
            activity_by_id,
            total_lower_minutes,
            total_point_minutes,
            total_upper_minutes,
            referenced_resource_version_ids,
        })
    }
}

// -----------------------------------------------------------------------------
// Collaborator 7: ModuleValidator
// -----------------------------------------------------------------------------

/// Collaborator 7: Validates unique module IDs and entity reference integrity (`@S10`).
pub struct ModuleValidator;

impl ModuleValidator {
    pub fn validate(
        candidate: &Value,
        objective_ids: &BTreeSet<String>,
        activity_ids: &BTreeSet<String>,
    ) -> Result<BTreeSet<String>, (String, String)> {
        let modules = candidate
            .get("modules")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                (
                    "missing_modules".to_string(),
                    "modules array missing".into(),
                )
            })?;

        let mut module_ids = BTreeSet::new();
        for m in modules {
            let mid = m
                .get("module_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ("invalid_module_id".to_string(), "missing module_id".into()))?
                .to_string();
            if !module_ids.insert(mid.clone()) {
                return Err((
                    "duplicate_module_id".to_string(),
                    format!("duplicate module_id `{mid}`"),
                ));
            }
            if let Some(m_objs) = m.get("objective_ids").and_then(|v| v.as_array()) {
                for o in m_objs {
                    let oid = o.as_str().unwrap_or_default();
                    if !objective_ids.contains(oid) {
                        return Err((
                            "unknown_module_objective".to_string(),
                            format!("module `{mid}` references unknown objective `{oid}`"),
                        ));
                    }
                }
            }
            if let Some(m_acts) = m.get("activity_ids").and_then(|v| v.as_array()) {
                for a in m_acts {
                    let aid = a.as_str().unwrap_or_default();
                    if !activity_ids.contains(aid) {
                        return Err((
                            "unknown_module_activity".to_string(),
                            format!("module `{mid}` references unknown activity `{aid}`"),
                        ));
                    }
                }
            }
        }
        Ok(module_ids)
    }
}

// -----------------------------------------------------------------------------
// Collaborator 8: PedagogicalTriadValidator
// -----------------------------------------------------------------------------

/// Collaborator 8: Verifies pedagogical triad coverage (`instruction`, `practice`, `assessment` with `assessment_ref`)
/// per objective (`PED-001`, `@S10`, `@S13`).
pub struct PedagogicalTriadValidator;

impl PedagogicalTriadValidator {
    pub fn validate(
        candidate: &Value,
        activity_by_id: &BTreeMap<String, &Value>,
    ) -> Result<(), (String, String)> {
        let objectives = candidate
            .get("objectives")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                (
                    "missing_objectives".to_string(),
                    "objectives array missing".into(),
                )
            })?;
        let activities = candidate
            .get("activities")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                (
                    "missing_activities".to_string(),
                    "activities array missing".into(),
                )
            })?;

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

            if let Some(assess_ids) = obj
                .get("assessment_activity_ids")
                .and_then(|v| v.as_array())
            {
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
                .map_err(|e| ("missing_pedagogical_triad".to_string(), e.to_string()))?;
        }
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Collaborator 9: RevisionPromoter
// -----------------------------------------------------------------------------

/// Collaborator 9: Assembles canonical `syllabus.schema.json` document payload with provenance metadata,
/// validates against canonical schema, and commits via `SyllabusRevisionPersistencePort`.
pub struct RevisionPromoter;

impl RevisionPromoter {
    pub fn promote_and_commit<S: SyllabusRevisionPersistencePort>(
        store: &S,
        principal: &AuthenticatedPrincipal,
        ctx: &CandidateValidationContext,
        candidate: &Value,
        candidate_sha256: &str,
        act_outcome: &ActivityValidationOutcome<'_>,
        archiver: &CandidateArchiver<'_, S>,
    ) -> Result<SyllabusRevisionRecord, PersistenceError> {
        let coverage_limitations = candidate
            .get("coverage_limitations")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let is_partial = coverage_limitations
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false);
        let source_ids: Vec<String> = act_outcome
            .referenced_resource_version_ids
            .iter()
            .cloned()
            .collect();

        let playback_speed_json = if (ctx.playback_speed - ctx.playback_speed.round()).abs() < 1e-9
        {
            json!(ctx.playback_speed as i64)
        } else {
            json!(ctx.playback_speed)
        };

        let promoted = json!({
            "schema_version": "0.2.0",
            "syllabus_id": ctx.syllabus_id,
            "revision_id": ctx.revision_id,
            "revision_number": 1,
            "predecessor_revision_id": null,
            "account_id": principal.account_id,
            "created_at": "2026-10-20T16:00:00Z",
            "revision_reason": "initial_generation",
            "goal": candidate["goal"],
            "language": candidate["language"],
            "sequence_preference_applied": candidate["sequence_preference_applied"],
            "objectives": candidate["objectives"],
            "prerequisite_edges": candidate["prerequisite_edges"],
            "modules": candidate["modules"],
            "activities": candidate["activities"],
            "certification_options": candidate["certification_options"],
            "coverage_limitations": coverage_limitations,
            "duration_policy": {
                "playback_speed": playback_speed_json,
                "rounding": "ceil_per_activity",
                "policy_version": "synthetic-duration-policy"
            },
            "total_estimated_minutes": act_outcome.total_point_minutes.max(1),
            "total_estimate_range_minutes": {
                "lower": act_outcome.total_lower_minutes,
                "upper": act_outcome.total_upper_minutes.max(1)
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
            "instruction_preferences_applied": candidate["instruction_preferences_applied"],
            "adaptation_context": {
                "proficiency_snapshot_ref": null,
                "adaptation_policy_version": "adaptation-policy-001",
                "waiver_refs": [],
                "origin_publication_revision_id": null
            }
        });

        if let Err((code, msg)) = CandidateSchemaValidator::validate_promoted_schema(&promoted) {
            return Err(archiver.fail(&code, msg));
        }

        archiver.record_success();

        store.commit_validated_syllabus_revision(
            principal,
            &ctx.syllabus_id,
            &ctx.revision_id,
            candidate_sha256,
            promoted,
            ctx.initial_is_active,
        )
    }
}

// -----------------------------------------------------------------------------
// Streamlined Coordinator: validate_candidate_and_promote_to_revision
// -----------------------------------------------------------------------------

/// Validates a raw UTF-8 model candidate and promotes it to a canonical syllabus revision (`T03`, `T04`).
pub fn validate_candidate_and_promote_to_revision<S>(
    store: &S,
    principal: &AuthenticatedPrincipal,
    raw_candidate_utf8: &str,
    ctx: &CandidateValidationContext,
) -> Result<SyllabusRevisionRecord, PersistenceError>
where
    S: CatalogRetrievalPort + SyllabusRevisionPersistencePort,
{
    let candidate_sha256 = sha256_bytes_hex(raw_candidate_utf8.as_bytes());
    let archiver = CandidateArchiver::new(store, ctx, &candidate_sha256, raw_candidate_utf8);

    // 1. Parse UTF-8 JSON
    let parsed_candidate: Value = serde_json::from_str(raw_candidate_utf8)
        .map_err(|e| archiver.fail("invalid_json", format!("malformed candidate JSON: {e}")))?;

    // 2. Scan for forbidden fields or executable markup (@S09, @S11)
    CandidateSecurityValidator::validate(&parsed_candidate)
        .map_err(|(code, msg)| archiver.fail(&code, msg))?;

    // 3. Validate against syllabus.schema.json#/$defs/modelCandidate (@S10)
    CandidateSchemaValidator::validate_candidate_def(&parsed_candidate)
        .map_err(|(code, msg)| archiver.fail(&code, msg))?;

    // 4. Validate unique objective IDs and objective prerequisite DAG acyclicity (@S10, @S11)
    let objective_ids = ObjectiveDagValidator::validate(&parsed_candidate)
        .map_err(|(code, msg)| archiver.fail(&code, msg))?;

    // 5. Validate activities, activity DAG, catalog eligibility & duration math (@S05..@S07, @S10, @S12, @S20)
    let act_outcome = ActivityAndDurationValidator::validate(
        store,
        &parsed_candidate,
        &objective_ids,
        ctx,
        &archiver,
    )?;

    // 6. Validate modules (@S10)
    ModuleValidator::validate(&parsed_candidate, &objective_ids, &act_outcome.activity_ids)
        .map_err(|(code, msg)| archiver.fail(&code, msg))?;

    // 7. Validate pedagogical triad coverage (@PED-001, @S10, @S13)
    PedagogicalTriadValidator::validate(&parsed_candidate, &act_outcome.activity_by_id)
        .map_err(|(code, msg)| archiver.fail(&code, msg))?;

    // 8. Promote to canonical syllabus.schema.json revision and commit
    RevisionPromoter::promote_and_commit(
        store,
        principal,
        ctx,
        &parsed_candidate,
        &candidate_sha256,
        &act_outcome,
        &archiver,
    )
}
