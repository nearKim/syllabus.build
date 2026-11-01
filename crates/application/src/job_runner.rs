//! Asynchronous syllabus generation job execution and state machine orchestration (`T03`, `T04`, `@S18`, `@S21`, `@S28`).

use syllabus_persistence::{
    serde_json::Value, CatalogFilterQuery, GenerationJobRecord, PersistenceError,
};
use syllabus_providers::{
    CandidateGenerationRequest, DeterministicFakeProvider, FakeFaultInjection, InferenceAuthMode,
    InferenceProvider, ProviderError,
};
use syllabus_security::AuthenticatedPrincipal;

use crate::goal_interpreter::interpret_goal_request;
use crate::ports::{
    CatalogRetrievalPort, GenerationJobRepositoryPort, SyllabusRevisionPersistencePort,
};
use crate::validation::{validate_candidate_and_promote_to_revision, CandidateValidationContext};

/// Orchestrates an asynchronous generation job through the canonical lifecycle
/// `queued -> retrieving -> generating -> validating -> succeeded` (or `failed`)
/// using `DeterministicFakeProvider` (`T03`, `T04`, `@S18`, `@S21`, `@S28`).
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
            syllabus_id: None,
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

    let candidate_output = match provider.generate_syllabus_candidate(&gen_req) {
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
                syllabus_id: None,
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
        syllabus_id: syllabus_id.to_string(),
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
        // DeterministicFakeProvider emits the canonical `syllabus-candidate.synthetic.json` fixture
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
        syllabus_id: Some(committed.syllabus_id),
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
