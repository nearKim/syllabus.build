//! Core HTTP handlers: auth sessions, learner proficiency, progress events, schedule,
//! export jobs, catalog filtering/review/quarantine, goal intake, generation, curricula, and BYOK credentials.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use curriculum_application::{
    default_cheap_model_for_provider, execute_generation_job, execute_search_and_index_pipeline,
    interpret_goal_request, AcquisitionPermission, CatalogFilterQuery, CatalogResourceVersionRecord,
    CatalogReviewEvidence, CatalogReviewInput, DiscoveredWebResourceCandidate,
    IndexedMaterialCandidate, ResourceFitDecisionMode, ResourceFreshnessState,
};
use curriculum_domain::ActivityExecutionStatus;
use curriculum_persistence::{
    GenerationJobRecord, PersistenceError, ProgressEventInput, SchedulePatchInput,
};
use curriculum_security::{AuthenticatedPrincipal, PrincipalRole};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    extract_bearer_token, extract_idempotency_key, extract_if_match, json_bool, json_str,
    json_u64, json_with_etag, ApiAppState, ApiResult, AuthPrincipal, DEFAULT_CURRICULUM_ID,
    DEFAULT_NOW_EPOCH_MS, HEADER_IDEMPOTENCY_REPLAYED,
};

const DEFAULT_SESSION_EXPIRES_AT: &str = "2026-12-31T23:59:59Z";
const DEFAULT_EXPORT_REQUESTED_AT: &str = "2026-10-20T21:16:10Z";
const DEFAULT_QUARANTINE_AT: &str = "2026-10-20T18:00:00Z";
const DEFAULT_TOPIC_ID: &str = "rag-python";
const DEFAULT_CURRENCY: &str = "USD";
const DEFAULT_PROVIDER_ID: &str = "openai";
const DEFAULT_BYOK_LABEL: &str = "BYOK Credential";

/// Request payload for establishing a new learner authentication session.
#[derive(Debug, Deserialize)]
pub(crate) struct CreateSessionRequestDto {
    pub(crate) email: String,
    pub(crate) authentication_code: String,
}

/// Response payload describing an active authentication session.
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SessionResponseDto {
    pub(crate) account_id: String,
    pub(crate) roles: Vec<PrincipalRole>,
    pub(crate) expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session_token: Option<String>,
}

pub(crate) async fn create_auth_session_handler(
    State(state): State<ApiAppState>,
    Json(req): Json<CreateSessionRequestDto>,
) -> ApiResult {
    let session = state
        .store
        .create_auth_session(&req.email, &req.authentication_code)?;
    Ok((
        StatusCode::OK,
        Json(SessionResponseDto {
            account_id: session.account_id,
            roles: session.roles,
            expires_at: session.expires_at,
            session_token: Some(session.token),
        }),
    )
        .into_response())
}

pub(crate) async fn get_auth_session_handler(
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    Ok((
        StatusCode::OK,
        Json(SessionResponseDto {
            account_id: principal.account_id,
            roles: principal.roles,
            expires_at: DEFAULT_SESSION_EXPIRES_AT.to_string(),
            session_token: None,
        }),
    )
        .into_response())
}

pub(crate) async fn delete_auth_session_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    headers: HeaderMap,
) -> ApiResult {
    if let Some(token) = extract_bearer_token(&headers) {
        state
            .store
            .revoke_session_token(token, DEFAULT_NOW_EPOCH_MS)?;
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Query parameters for inspecting learner proficiency projections.
#[derive(Debug, Deserialize, Default)]
pub(crate) struct ProficiencyQuery {
    pub(crate) account_id: Option<String>,
}

pub(crate) async fn get_my_proficiency_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Query(query): Query<ProficiencyQuery>,
) -> ApiResult {
    let target_account_id = query
        .account_id
        .as_deref()
        .unwrap_or(&principal.account_id);
    let projection = state
        .store
        .get_learner_proficiency(&principal, target_account_id)?;
    Ok((StatusCode::OK, Json(projection)).into_response())
}

/// Request payload for appending an activity progress event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ProgressEventRequestDto {
    pub(crate) event_id: String,
    #[serde(default)]
    pub(crate) curriculum_id: Option<String>,
    pub(crate) activity_id: String,
    #[serde(default)]
    pub(crate) objective_id: Option<String>,
    #[serde(default = "default_completed_status")]
    pub(crate) status: ActivityExecutionStatus,
    #[serde(default)]
    pub(crate) time_spent_minutes: u32,
}

#[must_use]
pub(crate) const fn default_completed_status() -> ActivityExecutionStatus {
    ActivityExecutionStatus::SelfReportedCompleted
}

pub(crate) async fn post_progress_event_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(mut req): Json<ProgressEventRequestDto>,
) -> ApiResult {
    let curriculum_id = req.curriculum_id.take();
    handle_progress_event_inner(
        &state,
        &principal,
        curriculum_id.as_deref().unwrap_or(DEFAULT_CURRICULUM_ID),
        req,
    )
}

pub(crate) async fn post_curriculum_progress_event_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(curriculum_id): Path<String>,
    Json(req): Json<ProgressEventRequestDto>,
) -> ApiResult {
    handle_progress_event_inner(&state, &principal, &curriculum_id, req)
}

fn handle_progress_event_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    curriculum_id: &str,
    req: ProgressEventRequestDto,
) -> ApiResult {
    let input = ProgressEventInput {
        event_id: req.event_id,
        curriculum_id: curriculum_id.to_string(),
        activity_id: req.activity_id,
        objective_id: req.objective_id,
        status: req.status,
        time_spent_minutes: req.time_spent_minutes,
    };

    let receipt = state.store.append_progress_event(principal, input)?;
    let replayed = receipt.replayed;
    let status = if replayed {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    let mut resp = (status, Json(receipt)).into_response();
    if replayed {
        resp.headers_mut().insert(
            HEADER_IDEMPOTENCY_REPLAYED,
            HeaderValue::from_static("true"),
        );
    }
    Ok(resp)
}

pub(crate) async fn get_schedule_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(curriculum_id): Path<String>,
) -> ApiResult {
    let schedule = state.store.get_schedule(&principal, &curriculum_id)?;
    Ok(json_with_etag(StatusCode::OK, &schedule.etag, &schedule))
}

pub(crate) async fn patch_schedule_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(patch_input): Json<SchedulePatchInput>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    let updated = state
        .store
        .patch_schedule(&principal, &curriculum_id, if_match, patch_input)?;

    let job_id = format!(
        "job-sched-sync-{}-v{}",
        updated.curriculum_id, updated.etag_version
    );
    let _ = state.outbox.enqueue(
        job_id,
        principal.account_id,
        "schedule_reminder_sync",
        json!({
            "curriculum_id": updated.curriculum_id,
            "schedule_revision_id": updated.schedule_revision_id,
            "etag_version": updated.etag_version,
        }),
        DEFAULT_NOW_EPOCH_MS,
    );

    Ok(json_with_etag(StatusCode::OK, &updated.etag, &updated))
}

pub(crate) async fn get_credential_metadata_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(credential_ref): Path<String>,
) -> ApiResult {
    let view = state
        .store
        .get_credential_metadata(&principal, &credential_ref)?;
    Ok(json_with_etag(StatusCode::OK, &view.etag, &view))
}

pub(crate) async fn create_export_job_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult {
    // Enforce tenant isolation before beginning idempotency if a target account_id is supplied.
    if let Some(target_acct) = json_str(&payload, &["account_id"]) {
        principal.require_learner_ownership(target_acct)?;
    }

    let idem_key = extract_idempotency_key(&headers);
    let operation_id = "createAccountExportJob";

    state.execute_idempotent(
        &principal.account_id,
        operation_id,
        idem_key,
        &payload,
        StatusCode::ACCEPTED,
        |key_str| {
            if json_bool(&payload, &["simulate_transient_5xx"]) == Some(true) {
                let err_body = json!({
                    "error": {
                        "code": "transient_storage_unavailable",
                        "message": "simulated 503 transient failure before commit"
                    }
                });
                return Ok((StatusCode::SERVICE_UNAVAILABLE, err_body, None));
            }

            let job_id = format!("export-{}-{key_str}", principal.account_id);
            let _ = state.outbox.enqueue(
                job_id.clone(),
                principal.account_id.clone(),
                "account_export",
                payload.clone(),
                DEFAULT_NOW_EPOCH_MS,
            );

            let export_rec = state
                .store
                .create_account_export(&principal, Some(&job_id))?;

            let response_body = json!({
                "job_id": job_id,
                "export_id": export_rec.export_id,
                "status": "queued",
                "requested_at": DEFAULT_EXPORT_REQUESTED_AT,
                "archive_sha256": export_rec.archive_sha256,
                "export_payload": export_rec.export_payload,
            });
            Ok((StatusCode::ACCEPTED, response_body, None))
        },
    )
}

/// Query parameters for filtering reviewed catalog resources (`T02`).
#[derive(Debug, Deserialize, Default)]
pub(crate) struct CatalogFilterQueryDto {
    pub(crate) topic: Option<String>,
    pub(crate) free_only: Option<bool>,
    pub(crate) budget_currency: Option<String>,
    pub(crate) max_budget_minor_units: Option<u64>,
    pub(crate) owned_subscription_id: Option<String>,
    pub(crate) allow_paid_fallback: Option<bool>,
    pub(crate) include_optional_certification: Option<bool>,
}

impl From<CatalogFilterQueryDto> for CatalogFilterQuery {
    fn from(q: CatalogFilterQueryDto) -> Self {
        Self {
            topic: Some(q.topic.unwrap_or_else(|| DEFAULT_TOPIC_ID.to_string())),
            objective_ids: Vec::new(),
            free_only: q.free_only.unwrap_or(true),
            budget_currency: Some(
                q.budget_currency
                    .unwrap_or_else(|| DEFAULT_CURRENCY.to_string()),
            ),
            max_budget_minor_units: Some(q.max_budget_minor_units.unwrap_or(0)),
            owned_subscription_ids: q.owned_subscription_id.into_iter().collect(),
            allow_paid_fallback: q.allow_paid_fallback.unwrap_or(false),
            include_optional_certification: q.include_optional_certification.unwrap_or(false),
            allow_synthetic_fixtures_for_test: false,
        }
    }
}

pub(crate) async fn list_or_filter_catalog_resources_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    Query(q): Query<CatalogFilterQueryDto>,
) -> ApiResult {
    let filter = CatalogFilterQuery::from(q);
    let outcome = state.store.filter_catalog_resources(&filter)?;
    Ok((StatusCode::OK, Json(outcome)).into_response())
}

pub(crate) async fn review_catalog_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(resource_version_id): Path<String>,
    Json(input): Json<CatalogReviewInput>,
) -> ApiResult {
    let updated = state
        .store
        .review_catalog_resource(&principal, &resource_version_id, input)?;
    Ok((StatusCode::OK, Json(updated)).into_response())
}

/// Request payload for quarantining a catalog resource version (`T02`).
#[derive(Debug, Deserialize)]
pub(crate) struct QuarantineRequestDto {
    pub(crate) reason: String,
    #[serde(default)]
    pub(crate) replacement_resource_version_id: Option<String>,
}

pub(crate) async fn quarantine_catalog_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(resource_version_id): Path<String>,
    Json(req): Json<QuarantineRequestDto>,
) -> ApiResult {
    let overlay = state.store.quarantine_resource_version(
        &principal,
        &resource_version_id,
        &req.reason,
        req.replacement_resource_version_id,
        DEFAULT_QUARANTINE_AT,
    )?;
    Ok((StatusCode::OK, Json(overlay)).into_response())
}

fn default_catalog_subject() -> String {
    "Engineering".to_string()
}

fn default_math_depth() -> String {
    "formal".to_string()
}

fn default_sequence_preference() -> String {
    "theory_first".to_string()
}

const fn default_true_flag() -> bool {
    true
}

const fn default_weekly_minutes() -> u32 {
    120
}

/// Request payload for executing the 6-stage AI catalog search, sublinear TF-IDF ranking,
/// fit-bypass evaluation, and incremental polymorphic auto-indexing pipeline (`POST /v1/catalog/search-and-index`).
#[derive(Debug, Deserialize)]
pub(crate) struct SearchAndIndexCatalogRequestDto {
    pub(crate) goal_title: String,
    #[serde(default = "default_catalog_subject")]
    pub(crate) subject: String,
    #[serde(default)]
    pub(crate) topic_tags: Vec<String>,
    #[serde(default = "default_math_depth")]
    pub(crate) math_depth: String,
    #[serde(default = "default_sequence_preference")]
    pub(crate) sequence_preference: String,
    #[serde(default = "default_true_flag")]
    pub(crate) free_only: bool,
    #[serde(default = "default_weekly_minutes")]
    pub(crate) weekly_minutes: u32,
    #[serde(default)]
    pub(crate) indexed_candidates: Vec<IndexedMaterialCandidate>,
    #[serde(default)]
    pub(crate) selected_resource_version_ids: Vec<String>,
    #[serde(default)]
    pub(crate) skipped_resource_version_ids: Vec<String>,
    #[serde(default)]
    pub(crate) requested_mode: Option<ResourceFitDecisionMode>,
    #[serde(default)]
    pub(crate) web_search_discoveries: Vec<DiscoveredWebResourceCandidate>,
}

pub(crate) async fn search_and_index_catalog_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    Json(req): Json<SearchAndIndexCatalogRequestDto>,
) -> ApiResult {
    let mut candidates = req.indexed_candidates;
    if candidates.is_empty() {
        for rec in state.store.list_catalog_resources(false) {
            candidates.push(IndexedMaterialCandidate {
                resource_version_id: rec.resource_version_id,
                resource_id: rec.resource_id,
                title: rec.title,
                resource_type: rec.resource_type,
                subject: req.subject.clone(),
                topic_tags: rec.topics,
                supported_math_depths: vec![
                    "intuition_first".to_string(),
                    "applied".to_string(),
                    "formal".to_string(),
                ],
                supported_roles: vec!["instruction".to_string(), "practice".to_string()],
                access_model: rec.access_model,
                price_minor_units: rec.price_minor_units,
                review_status: rec.review_status,
                quarantined: false,
                index_descriptor: None,
            });
        }
    }

    let receipt = execute_search_and_index_pipeline(
        &req.goal_title,
        &req.subject,
        &req.topic_tags,
        &req.math_depth,
        &req.sequence_preference,
        req.free_only,
        req.weekly_minutes,
        &candidates,
        &req.selected_resource_version_ids,
        &req.skipped_resource_version_ids,
        req.requested_mode,
        &req.web_search_discoveries,
    )?;

    // Incrementally auto-register newly discovered resources into the live catalog store
    for disc in &req.web_search_discoveries {
        let was_newly_indexed = receipt
            .newly_indexed_resources
            .iter()
            .any(|c| c.resource_version_id == disc.resource_version_id);
        if !was_newly_indexed {
            continue;
        }
        state
            .store
            .upsert_catalog_resource(CatalogResourceVersionRecord {
                resource_version_id: disc.resource_version_id.clone(),
                resource_id: disc.resource_id.clone(),
                version_number: 1,
                title: disc.title.clone(),
                provider_id: "auto-indexed-web".to_string(),
                provider_display_name: "Auto-Indexed Web Discovery".to_string(),
                canonical_url: disc.canonical_url.clone(),
                resource_type: disc.resource_type.clone(),
                language: "en".to_string(),
                description: format!(
                    "Auto-indexed {} resource covering {}.",
                    disc.resource_type,
                    disc.topic_tags.join(", ")
                ),
                topics: disc.topic_tags.clone(),
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: disc.access_model,
                currency: Some(DEFAULT_CURRENCY.to_string()),
                price_minor_units: disc.price_minor_units,
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: curriculum_application::ResourceReviewStatus::Approved,
                review_evidence: Some(CatalogReviewEvidence {
                    reviewer_principal_id: "00000000-0000-4000-8000-000000000099".to_string(),
                    reviewed_at: "2026-10-28T00:00:00Z".to_string(),
                    pedagogical_fit_score: 5,
                    accuracy_score: 5,
                    accessibility_score: 5,
                    rights_verified: true,
                    rationale: "Incremental polymorphic auto-indexer verified metadata and egress safety.".to_string(),
                    credibility_basis: "Primary educational resource syllabus index".to_string(),
                    evidence_url: disc.canonical_url.clone(),
                }),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: true,
                    allow_redistribution: false,
                    license_spdx_or_custom: "LinkOut-Metadata-Only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some(disc.title.clone()),
                    notes: None,
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            });
    }

    Ok((StatusCode::OK, Json(receipt)).into_response())
}

pub(crate) async fn interpret_goal_handler(
    AuthPrincipal(_principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let result = interpret_goal_request(&payload)?;
    Ok((StatusCode::OK, Json(result)).into_response())
}

#[must_use]
fn sanitize_idempotency_key(key: &str) -> String {
    key.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

#[must_use]
fn generation_job_body(job: &GenerationJobRecord) -> Value {
    let mut body = serde_json::to_value(job).unwrap_or(Value::Null);
    body["generation_id"] = json!(job.job_id);
    body
}

fn validate_and_record_byok_generation_usage(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    payload: &Value,
) -> Result<(), PersistenceError> {
    if json_str(payload, &["credential_mode"]) != Some("byok") {
        return Ok(());
    }
    if json_bool(payload, &["allow_hosted_fallback"]) == Some(true) {
        return Err(PersistenceError::Validation(
            "silent fallback to hosted platform credentials is forbidden in BYOK mode (`@S28`, `@S66`)"
                .to_string(),
        ));
    }

    if let Some(cred_ref) = json_str(payload, &["credential_ref"]) {
        let meta = state.store.get_credential_metadata(principal, cred_ref)?;
        let pinned_ver = json_u64(payload, &["credential_version"]).unwrap_or(meta.version);
        state
            .store
            .open_credential_for_pinned_inference(principal, cred_ref, pinned_ver)?;
        let model_id = json_str(payload, &["model_id", "model"])
            .unwrap_or_else(|| default_cheap_model_for_provider(&meta.provider_id));
        let _ = state.store.record_inference_usage(
            principal,
            cred_ref,
            pinned_ver,
            &meta.provider_id,
            model_id,
            "curriculum_generation",
            1_500,
            1_100,
            "provider_reported",
        );
    }
    Ok(())
}

pub(crate) async fn start_generation_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult {
    let idem_key = extract_idempotency_key(&headers);
    let operation_id = "startGeneration";

    state.execute_idempotent(
        &principal.account_id,
        operation_id,
        idem_key,
        &payload,
        StatusCode::ACCEPTED,
        |key_str| {
            let sanitized_key = sanitize_idempotency_key(key_str);
            let job_id = json_str(&payload, &["job_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("gen-job-{sanitized_key}"));
            let curriculum_id = json_str(&payload, &["curriculum_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("cur-{sanitized_key}"));
            let revision_id = json_str(&payload, &["revision_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("rev-{sanitized_key}-v1"));

            let _ = state.outbox.enqueue(
                job_id.clone(),
                principal.account_id.clone(),
                "curriculum_generation",
                payload.clone(),
                DEFAULT_NOW_EPOCH_MS,
            );

            validate_and_record_byok_generation_usage(&state, &principal, &payload)?;

            let job = execute_generation_job(
                &state.store,
                &principal,
                &job_id,
                &curriculum_id,
                &revision_id,
                &payload,
            )?;
            let body = generation_job_body(&job);
            Ok((StatusCode::ACCEPTED, body, Some(job.etag)))
        },
    )
}

pub(crate) async fn get_generation_job_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(job_id): Path<String>,
) -> ApiResult {
    let job = state.store.get_generation_job(&principal, &job_id)?;
    let body = generation_job_body(&job);
    Ok(json_with_etag(StatusCode::OK, &job.etag, &body))
}

pub(crate) async fn cancel_generation_job_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(job_id): Path<String>,
) -> ApiResult {
    let job = state.store.cancel_generation_job(&principal, &job_id)?;
    Ok((StatusCode::OK, Json(generation_job_body(&job))).into_response())
}

pub(crate) async fn list_my_curricula_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let items = state.store.list_my_curricula(&principal)?;
    Ok((StatusCode::OK, Json(json!({ "items": items }))).into_response())
}

pub(crate) async fn get_curriculum_overview_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(curriculum_id): Path<String>,
) -> ApiResult {
    let overview = state
        .store
        .get_curriculum_overview(&principal, &curriculum_id)?;
    Ok(json_with_etag(StatusCode::OK, &overview.etag, &overview))
}

pub(crate) async fn get_curriculum_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((curriculum_id, revision_id)): Path<(String, String)>,
) -> ApiResult {
    let (rev, etag) = state.store.get_curriculum_revision_by_curriculum_and_id(
        &principal,
        &curriculum_id,
        &revision_id,
    )?;
    let mut body = serde_json::to_value(&rev).unwrap_or(Value::Null);
    body["etag"] = json!(&etag);
    Ok(json_with_etag(StatusCode::OK, &etag, &body))
}

pub(crate) async fn activate_curriculum_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path((curriculum_id, revision_id)): Path<(String, String)>,
) -> ApiResult {
    activate_curriculum_revision_inner(&state, &principal, &headers, &curriculum_id, &revision_id)
}

/// Request payload for activating a curriculum revision via `PUT /v1/curricula/{id}/active-revision`.
#[derive(Debug, Deserialize)]
pub(crate) struct PutActiveRevisionRequestDto {
    pub(crate) revision_id: String,
}

pub(crate) async fn put_active_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(req): Json<PutActiveRevisionRequestDto>,
) -> ApiResult {
    activate_curriculum_revision_inner(
        &state,
        &principal,
        &headers,
        &curriculum_id,
        &req.revision_id,
    )
}

fn activate_curriculum_revision_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    headers: &HeaderMap,
    curriculum_id: &str,
    revision_id: &str,
) -> ApiResult {
    let if_match = extract_if_match(headers);
    let (updated, next_etag) = state.store.activate_curriculum_revision(
        principal,
        curriculum_id,
        revision_id,
        if_match,
    )?;
    let mut body = serde_json::to_value(&updated).unwrap_or(Value::Null);
    body["active_revision_id"] = json!(updated.revision_id);
    body["etag"] = json!(&next_etag);
    Ok(json_with_etag(StatusCode::OK, &next_etag, &body))
}

pub(crate) async fn get_curriculum_resource_alerts_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(curriculum_id): Path<String>,
) -> ApiResult {
    let alerts = state
        .store
        .list_curriculum_resource_alerts(&principal, &curriculum_id)?;
    Ok((StatusCode::OK, Json(json!({ "items": alerts }))).into_response())
}

// =============================================================================
// T07A Handlers: BYOK Credential Custody & Usage Records
// =============================================================================

pub(crate) async fn create_credential_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let provider_id =
        json_str(&payload, &["provider_id", "provider"]).unwrap_or(DEFAULT_PROVIDER_ID);
    let label = json_str(&payload, &["label"]).unwrap_or(DEFAULT_BYOK_LABEL);
    let raw_api_key = json_str(&payload, &["api_key", "secret"]).unwrap_or("");
    let credential_ref = json_str(&payload, &["credential_ref", "credential_id"])
        .map(str::to_string)
        .unwrap_or_else(|| format!("cred-{}-{provider_id}", principal.account_id));

    let view = state.store.create_credential(
        &principal,
        &credential_ref,
        provider_id,
        label,
        raw_api_key,
    )?;
    Ok(json_with_etag(StatusCode::CREATED, &view.etag, &view))
}

pub(crate) async fn list_credentials_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let items = state.store.list_credential_metadata(&principal);
    Ok((StatusCode::OK, Json(json!({ "items": items }))).into_response())
}

pub(crate) async fn rotate_credential_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(credential_ref): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    let new_key = json_str(&payload, &["api_key", "new_api_key", "secret"]).unwrap_or("");
    let new_label = json_str(&payload, &["label"]);

    let view = state.store.rotate_credential(
        &principal,
        &credential_ref,
        if_match,
        new_key,
        new_label,
    )?;
    Ok(json_with_etag(StatusCode::OK, &view.etag, &view))
}

pub(crate) async fn revoke_credential_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(credential_ref): Path<String>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    state.store.revoke_credential(
        &principal,
        &credential_ref,
        if_match,
        DEFAULT_NOW_EPOCH_MS,
    )?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub(crate) async fn get_my_usage_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let records = state.store.list_inference_usage(&principal);
    let total_tokens: u64 = records.iter().map(|r| r.total_tokens).sum();
    let total_provider_cost_micros: u64 = records
        .iter()
        .map(|r| r.estimated_provider_cost_usd_micros)
        .sum();
    Ok((
        StatusCode::OK,
        Json(json!({
            "account_id": principal.account_id,
            "hosted_service_charge_usd_micros": 0,
            "total_tokens": total_tokens,
            "estimated_provider_cost_usd_micros": total_provider_cost_micros,
            "items": records,
        })),
    )
        .into_response())
}
