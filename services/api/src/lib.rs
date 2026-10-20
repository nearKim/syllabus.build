//! HTTP API service router (`T00`–`T04` identity, tenant isolation, HTTP concurrency, outbox wiring,
//! reviewed catalog filtering/reviews, goal intake, deterministic generation, and curriculum overview/activation).

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use curriculum_application::{
    build_readiness_report, execute_generation_job, interpret_goal_request, CatalogFilterQuery,
    CatalogReviewInput,
};
use curriculum_domain::ActivityExecutionStatus;
use curriculum_jobs::{OutboxJobQueue, OutboxQueueConfig};
use curriculum_persistence::{
    IdempotencyBeginOutcome, InMemoryTransactionalStore, PersistenceError, ProgressEventInput,
    SchedulePatchInput,
};
use curriculum_security::{
    AppEnvironment, AuthVerifier, AuthenticatedPrincipal, DevFixedIdentityAuthVerifier,
    PrincipalRole, ReleaseFeatureGates,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone)]
pub struct ApiAppState {
    pub gates: ReleaseFeatureGates,
    pub store: InMemoryTransactionalStore,
    pub outbox: OutboxJobQueue,
    pub auth_verifier: Arc<dyn AuthVerifier>,
}

impl ApiAppState {
    pub fn new(gates: ReleaseFeatureGates) -> Self {
        let verifier = DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Development,
            "00000000-0000-4000-8000-000000000001",
        )
        .expect("dev auth verifier");
        Self {
            gates,
            store: InMemoryTransactionalStore::new_with_dev_fixtures(),
            outbox: OutboxJobQueue::new(OutboxQueueConfig::default()),
            auth_verifier: Arc::new(verifier),
        }
    }
}

pub fn build_router(gates: ReleaseFeatureGates) -> Router {
    build_router_with_state(ApiAppState::new(gates))
}

pub fn build_router_with_state(state: ApiAppState) -> Router {
    let readiness_gates = state.gates;
    Router::new()
        .route(
            "/healthz",
            get(move || async move { Json(build_readiness_report(readiness_gates)) }),
        )
        // Companion auth session routes (supporting both /v1/auth/session and /v1/auth/sessions*)
        .route("/v1/auth/session", post(create_auth_session_handler))
        .route("/v1/auth/session", get(get_auth_session_handler))
        .route("/v1/auth/session", delete(delete_auth_session_handler))
        .route("/v1/auth/sessions", post(create_auth_session_handler))
        .route("/v1/auth/sessions/current", get(get_auth_session_handler))
        .route(
            "/v1/auth/sessions/current",
            delete(delete_auth_session_handler),
        )
        // Protected learner proficiency & progress event routes
        .route("/v1/me/proficiency", get(get_my_proficiency_handler))
        .route("/v1/progress-events", post(post_progress_event_handler))
        .route(
            "/v1/curricula/{curriculum_id}/progress-events",
            post(post_curriculum_progress_event_handler),
        )
        // Schedule routes with If-Match optimistic concurrency
        .route("/v1/schedules/{curriculum_id}", get(get_schedule_handler))
        .route(
            "/v1/schedules/{curriculum_id}",
            patch(patch_schedule_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/schedule",
            get(get_schedule_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/schedule",
            patch(patch_schedule_handler),
        )
        // Credential metadata route for cross-tenant negative verification (@S29, @S36, @S64)
        .route(
            "/v1/me/credentials/{credential_ref}",
            get(get_credential_metadata_handler),
        )
        // Retriable command endpoint with Idempotency-Key + transactional outbox enqueue
        .route("/v1/me/exports", post(create_export_job_handler))
        // T02: Reviewed catalog filtering, curator review & quarantine routes
        .route(
            "/v1/resources/versions",
            get(list_or_filter_catalog_resources_handler),
        )
        .route(
            "/v1/catalog/resources",
            get(list_or_filter_catalog_resources_handler),
        )
        .route(
            "/v1/catalog/resources/{resource_version_id}/reviews",
            post(review_catalog_resource_handler),
        )
        .route(
            "/v1/admin/resources/{resource_version_id}/reviews",
            post(review_catalog_resource_handler),
        )
        .route(
            "/v1/catalog/resources/{resource_version_id}/quarantine",
            post(quarantine_catalog_resource_handler),
        )
        // T03: Goal intake & async curriculum generation routes
        .route("/v1/goals/interpret", post(interpret_goal_handler))
        .route(
            "/v1/curricula/goal-interpretations",
            post(interpret_goal_handler),
        )
        .route("/v1/generations", post(start_generation_handler))
        .route(
            "/v1/curricula/generation-jobs",
            post(start_generation_handler),
        )
        .route(
            "/v1/generations/{job_id}",
            get(get_generation_job_handler),
        )
        .route(
            "/v1/generation-jobs/{job_id}",
            get(get_generation_job_handler),
        )
        .route(
            "/v1/curricula/generation-jobs/{job_id}",
            get(get_generation_job_handler),
        )
        .route(
            "/v1/generations/{job_id}/cancel",
            post(cancel_generation_job_handler),
        )
        .route(
            "/v1/generation-jobs/{job_id}/cancel",
            post(cancel_generation_job_handler),
        )
        // T04: Curricula list, overview, revision inspection, activation & resource alerts
        .route("/v1/curricula", get(list_my_curricula_handler))
        .route("/v1/me/curricula", get(list_my_curricula_handler))
        .route(
            "/v1/curricula/{curriculum_id}",
            get(get_curriculum_overview_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/revisions/{revision_id}",
            get(get_curriculum_revision_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/revisions/{revision_id}/activate",
            post(activate_curriculum_revision_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/active-revision",
            put(put_active_revision_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/resource-alerts",
            get(get_curriculum_resource_alerts_handler),
        )
        .with_state(state)
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .and_then(|s| s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")))
        .map(str::trim)
}

fn extract_header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
}

fn authenticate_request(
    state: &ApiAppState,
    headers: &HeaderMap,
) -> Result<AuthenticatedPrincipal, PersistenceError> {
    let bearer = extract_bearer_token(headers);
    if let Some(token) = bearer {
        if let Some(session_principal) = state.store.resolve_session_token(token)? {
            return Ok(session_principal);
        }
    }
    state
        .auth_verifier
        .verify_bearer_token(bearer)
        .map_err(PersistenceError::Security)
}

fn error_response(err: PersistenceError) -> Response {
    let status =
        StatusCode::from_u16(err.http_status_code()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut body = json!({
        "error": {
            "code": err.error_code(),
            "message": err.to_string(),
        }
    });
    if let PersistenceError::PreconditionFailed {
        expected_etag,
        actual_etag,
    } = &err
    {
        body["error"]["expected_etag"] = json!(expected_etag);
        body["error"]["current_etag"] = json!(actual_etag);
    }
    (status, Json(body)).into_response()
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionRequestDto {
    pub email: String,
    pub authentication_code: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionResponseDto {
    pub account_id: String,
    pub roles: Vec<PrincipalRole>,
    pub expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
}

async fn create_auth_session_handler(
    State(state): State<ApiAppState>,
    Json(req): Json<CreateSessionRequestDto>,
) -> Response {
    match state
        .store
        .create_auth_session(&req.email, &req.authentication_code)
    {
        Ok(session) => (
            StatusCode::OK,
            Json(SessionResponseDto {
                account_id: session.account_id,
                roles: session.roles,
                expires_at: session.expires_at,
                session_token: Some(session.token),
            }),
        )
            .into_response(),
        Err(err) => error_response(err),
    }
}

async fn get_auth_session_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    match authenticate_request(&state, &headers) {
        Ok(principal) => (
            StatusCode::OK,
            Json(SessionResponseDto {
                account_id: principal.account_id,
                roles: principal.roles,
                expires_at: "2026-12-31T23:59:59Z".to_string(),
                session_token: None,
            }),
        )
            .into_response(),
        Err(err) => error_response(err),
    }
}

async fn delete_auth_session_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let _ = principal;
    if let Some(token) = extract_bearer_token(&headers) {
        if let Err(err) = state.store.revoke_session_token(token, 10_000) {
            return error_response(err);
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Debug, Deserialize, Default)]
pub struct ProficiencyQuery {
    pub account_id: Option<String>,
}

async fn get_my_proficiency_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Query(query): Query<ProficiencyQuery>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let target_account_id = query
        .account_id
        .as_deref()
        .unwrap_or(&principal.account_id);
    match state
        .store
        .get_learner_proficiency(&principal, target_account_id)
    {
        Ok(projection) => (StatusCode::OK, Json(projection)).into_response(),
        Err(err) => error_response(err),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressEventRequestDto {
    pub event_id: String,
    #[serde(default)]
    pub curriculum_id: Option<String>,
    pub activity_id: String,
    #[serde(default)]
    pub objective_id: Option<String>,
    #[serde(default = "default_completed_status")]
    pub status: ActivityExecutionStatus,
    #[serde(default)]
    pub time_spent_minutes: u32,
}

fn default_completed_status() -> ActivityExecutionStatus {
    ActivityExecutionStatus::SelfReportedCompleted
}

async fn post_progress_event_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(req): Json<ProgressEventRequestDto>,
) -> Response {
    let curriculum_id = req
        .curriculum_id
        .clone()
        .unwrap_or_else(|| "cur-learner-a-1".to_string());
    handle_progress_event_inner(state, headers, curriculum_id, req)
}

async fn post_curriculum_progress_event_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(req): Json<ProgressEventRequestDto>,
) -> Response {
    handle_progress_event_inner(state, headers, curriculum_id, req)
}

fn handle_progress_event_inner(
    state: ApiAppState,
    headers: HeaderMap,
    curriculum_id: String,
    req: ProgressEventRequestDto,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };

    let input = ProgressEventInput {
        event_id: req.event_id,
        curriculum_id,
        activity_id: req.activity_id,
        objective_id: req.objective_id,
        status: req.status,
        time_spent_minutes: req.time_spent_minutes,
    };

    match state.store.append_progress_event(&principal, input) {
        Ok(receipt) => {
            let status = if receipt.replayed {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            };
            let mut resp = (status, Json(receipt.clone())).into_response();
            if receipt.replayed {
                resp.headers_mut().insert(
                    "Idempotency-Replayed",
                    HeaderValue::from_static("true"),
                );
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn get_schedule_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };

    match state.store.get_schedule(&principal, &curriculum_id) {
        Ok(schedule) => {
            let etag = schedule.etag.clone();
            let mut resp = (StatusCode::OK, Json(schedule)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn patch_schedule_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(patch_input): Json<SchedulePatchInput>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };

    let if_match = extract_header_str(&headers, "if-match");
    match state
        .store
        .patch_schedule(&principal, &curriculum_id, if_match, patch_input)
    {
        Ok(updated) => {
            let etag = updated.etag.clone();
            let job_id = format!(
                "job-sched-sync-{}-v{}",
                updated.curriculum_id, updated.etag_version
            );
            let _ = state.outbox.enqueue(
                job_id,
                principal.account_id.clone(),
                "schedule_reminder_sync",
                json!({
                    "curriculum_id": updated.curriculum_id,
                    "schedule_revision_id": updated.schedule_revision_id,
                    "etag_version": updated.etag_version,
                }),
                10_000,
            );

            let mut resp = (StatusCode::OK, Json(updated)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn get_credential_metadata_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(credential_ref): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .get_credential_metadata(&principal, &credential_ref)
    {
        Ok(view) => {
            let etag = view.etag.clone();
            let mut resp = (StatusCode::OK, Json(view)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn create_export_job_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };

    // If caller asks to target another account_id in payload, enforce tenant isolation first
    if let Some(target_acct) = payload.get("account_id").and_then(|v| v.as_str()) {
        if let Err(sec_err) = principal.require_learner_ownership(target_acct) {
            return error_response(PersistenceError::Security(sec_err));
        }
    }

    let idem_key = extract_header_str(&headers, "idempotency-key");
    let operation_id = "createAccountExportJob";

    match state.store.begin_idempotent_command(
        &principal.account_id,
        operation_id,
        idem_key,
        &payload,
        10_000,
        86_400_000,
    ) {
        Ok(IdempotencyBeginOutcome::Replayed(stored)) => {
            let status = StatusCode::from_u16(stored.status_code).unwrap_or(StatusCode::ACCEPTED);
            let mut resp = (status, Json(stored.body)).into_response();
            resp.headers_mut()
                .insert("Idempotency-Replayed", HeaderValue::from_static("true"));
            resp
        }
        Ok(IdempotencyBeginOutcome::Acquired) => {
            let key_str = idem_key.unwrap_or_default();
            if payload
                .get("simulate_transient_5xx")
                .and_then(|v| v.as_bool())
                == Some(true)
            {
                let err_body = json!({
                    "error": {
                        "code": "transient_storage_unavailable",
                        "message": "simulated 503 transient failure before commit"
                    }
                });
                state.store.complete_idempotent_command(
                    &principal.account_id,
                    operation_id,
                    key_str,
                    503,
                    err_body.clone(),
                );
                return (StatusCode::SERVICE_UNAVAILABLE, Json(err_body)).into_response();
            }

            let job_id = format!("export-{}-{}", principal.account_id, key_str);
            let _ = state.outbox.enqueue(
                job_id.clone(),
                principal.account_id.clone(),
                "account_export",
                payload.clone(),
                10_000,
            );

            let response_body = json!({
                "job_id": job_id,
                "status": "queued",
                "requested_at": "2026-10-20T21:16:10Z"
            });
            state.store.complete_idempotent_command(
                &principal.account_id,
                operation_id,
                key_str,
                202,
                response_body.clone(),
            );
            (StatusCode::ACCEPTED, Json(response_body)).into_response()
        }
        Err(err) => error_response(err),
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct CatalogFilterQueryDto {
    pub topic: Option<String>,
    pub free_only: Option<bool>,
    pub budget_currency: Option<String>,
    pub max_budget_minor_units: Option<u64>,
    pub owned_subscription_id: Option<String>,
    pub allow_paid_fallback: Option<bool>,
    pub include_optional_certification: Option<bool>,
}

async fn list_or_filter_catalog_resources_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Query(q): Query<CatalogFilterQueryDto>,
) -> Response {
    if let Err(err) = authenticate_request(&state, &headers) {
        return error_response(err);
    }

    let filter = CatalogFilterQuery {
        topic: Some(q.topic.unwrap_or_else(|| "rag-python".to_string())),
        objective_ids: Vec::new(),
        free_only: q.free_only.unwrap_or(true),
        budget_currency: Some(q.budget_currency.unwrap_or_else(|| "USD".to_string())),
        max_budget_minor_units: Some(q.max_budget_minor_units.unwrap_or(0)),
        owned_subscription_ids: q.owned_subscription_id.into_iter().collect(),
        allow_paid_fallback: q.allow_paid_fallback.unwrap_or(false),
        include_optional_certification: q.include_optional_certification.unwrap_or(false),
        allow_synthetic_fixtures_for_test: false,
    };

    match state.store.filter_catalog_resources(&filter) {
        Ok(outcome) => (StatusCode::OK, Json(outcome)).into_response(),
        Err(err) => error_response(err),
    }
}

async fn review_catalog_resource_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(resource_version_id): Path<String>,
    Json(input): Json<CatalogReviewInput>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .review_catalog_resource(&principal, &resource_version_id, input)
    {
        Ok(updated) => (StatusCode::OK, Json(updated)).into_response(),
        Err(err) => error_response(err),
    }
}

#[derive(Debug, Deserialize)]
pub struct QuarantineRequestDto {
    pub reason: String,
    #[serde(default)]
    pub replacement_resource_version_id: Option<String>,
}

async fn quarantine_catalog_resource_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(resource_version_id): Path<String>,
    Json(req): Json<QuarantineRequestDto>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.quarantine_resource_version(
        &principal,
        &resource_version_id,
        &req.reason,
        req.replacement_resource_version_id,
        "2026-10-20T18:00:00Z",
    ) {
        Ok(overlay) => (StatusCode::OK, Json(overlay)).into_response(),
        Err(err) => error_response(err),
    }
}

async fn interpret_goal_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    if let Err(err) = authenticate_request(&state, &headers) {
        return error_response(err);
    }
    match interpret_goal_request(&payload) {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(err) => error_response(err),
    }
}

async fn start_generation_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };

    let idem_key = extract_header_str(&headers, "idempotency-key");
    let operation_id = "startGeneration";

    match state.store.begin_idempotent_command(
        &principal.account_id,
        operation_id,
        idem_key,
        &payload,
        10_000,
        86_400_000,
    ) {
        Ok(IdempotencyBeginOutcome::Replayed(stored)) => {
            let status = StatusCode::from_u16(stored.status_code).unwrap_or(StatusCode::ACCEPTED);
            let mut resp = (status, Json(stored.body)).into_response();
            resp.headers_mut()
                .insert("Idempotency-Replayed", HeaderValue::from_static("true"));
            resp
        }
        Ok(IdempotencyBeginOutcome::Acquired) => {
            let key_str = idem_key.unwrap_or_default();
            let sanitized_key: String = key_str
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect();
            let job_id = payload
                .get("job_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("gen-job-{sanitized_key}"));
            let curriculum_id = payload
                .get("curriculum_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("cur-{sanitized_key}"));
            let revision_id = payload
                .get("revision_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("rev-{sanitized_key}-v1"));

            let _ = state.outbox.enqueue(
                job_id.clone(),
                principal.account_id.clone(),
                "curriculum_generation",
                payload.clone(),
                10_000,
            );

            match execute_generation_job(
                &state.store,
                &principal,
                &job_id,
                &curriculum_id,
                &revision_id,
                &payload,
            ) {
                Ok(job) => {
                    let mut body = serde_json::to_value(&job).unwrap_or(Value::Null);
                    body["generation_id"] = json!(job.job_id);
                    state.store.complete_idempotent_command(
                        &principal.account_id,
                        operation_id,
                        key_str,
                        202,
                        body.clone(),
                    );
                    let mut resp = (StatusCode::ACCEPTED, Json(body)).into_response();
                    if let Ok(hv) = HeaderValue::from_str(&job.etag) {
                        resp.headers_mut().insert(axum::http::header::ETAG, hv);
                    }
                    resp
                }
                Err(err) => {
                    let status_u16 = err.http_status_code();
                    let err_body = json!({
                        "error": {
                            "code": err.error_code(),
                            "message": err.to_string(),
                        }
                    });
                    state.store.complete_idempotent_command(
                        &principal.account_id,
                        operation_id,
                        key_str,
                        status_u16,
                        err_body,
                    );
                    error_response(err)
                }
            }
        }
        Err(err) => error_response(err),
    }
}

async fn get_generation_job_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.get_generation_job(&principal, &job_id) {
        Ok(job) => {
            let etag = job.etag.clone();
            let mut body = serde_json::to_value(&job).unwrap_or(Value::Null);
            body["generation_id"] = json!(job.job_id);
            let mut resp = (StatusCode::OK, Json(body)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn cancel_generation_job_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.cancel_generation_job(&principal, &job_id) {
        Ok(job) => {
            let mut body = serde_json::to_value(&job).unwrap_or(Value::Null);
            body["generation_id"] = json!(job.job_id);
            (StatusCode::OK, Json(body)).into_response()
        }
        Err(err) => error_response(err),
    }
}

async fn list_my_curricula_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.list_my_curricula(&principal) {
        Ok(items) => (StatusCode::OK, Json(json!({ "items": items }))).into_response(),
        Err(err) => error_response(err),
    }
}

async fn get_curriculum_overview_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.get_curriculum_overview(&principal, &curriculum_id) {
        Ok(overview) => {
            let etag = overview.etag.clone();
            let mut resp = (StatusCode::OK, Json(overview)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn get_curriculum_revision_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((curriculum_id, revision_id)): Path<(String, String)>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.get_curriculum_revision_by_curriculum_and_id(
        &principal,
        &curriculum_id,
        &revision_id,
    ) {
        Ok((rev, etag)) => {
            let mut body = serde_json::to_value(&rev).unwrap_or(Value::Null);
            body["etag"] = json!(etag);
            let mut resp = (StatusCode::OK, Json(body)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn activate_curriculum_revision_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((curriculum_id, revision_id)): Path<(String, String)>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let if_match = extract_header_str(&headers, "if-match");
    match state
        .store
        .activate_curriculum_revision(&principal, &curriculum_id, &revision_id, if_match)
    {
        Ok((updated, next_etag)) => {
            let mut body = serde_json::to_value(&updated).unwrap_or(Value::Null);
            body["active_revision_id"] = json!(updated.revision_id);
            body["etag"] = json!(next_etag);
            let mut resp = (StatusCode::OK, Json(body)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&next_etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

#[derive(Debug, Deserialize)]
pub struct PutActiveRevisionRequestDto {
    pub revision_id: String,
}

async fn put_active_revision_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(req): Json<PutActiveRevisionRequestDto>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let if_match = extract_header_str(&headers, "if-match");
    match state.store.activate_curriculum_revision(
        &principal,
        &curriculum_id,
        &req.revision_id,
        if_match,
    ) {
        Ok((updated, next_etag)) => {
            let mut body = serde_json::to_value(&updated).unwrap_or(Value::Null);
            body["active_revision_id"] = json!(updated.revision_id);
            body["etag"] = json!(next_etag);
            let mut resp = (StatusCode::OK, Json(body)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&next_etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

async fn get_curriculum_resource_alerts_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .list_curriculum_resource_alerts(&principal, &curriculum_id)
    {
        Ok(alerts) => (StatusCode::OK, Json(json!({ "items": alerts }))).into_response(),
        Err(err) => error_response(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use curriculum_application::SystemReadinessReport;
    use curriculum_contracts::generated::CANONICAL_SPEC_SHA256;
    use curriculum_domain::ObjectiveProficiencyState;
    use curriculum_persistence::{
        IdempotencyBeginOutcome, LearnerProficiencyProjection, ProgressEventReceiptRecord,
        ScheduleFeasibility, ScheduleRevisionRecord,
    };
    use tower::ServiceExt;

    async fn read_body_json(response: Response) -> Value {
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("read response body");
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).expect("parse response json")
        }
    }

    #[tokio::test]
    async fn healthz_returns_spec_hash_and_visible_release_gates() {
        let app = build_router(ReleaseFeatureGates::default());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024)
            .await
            .unwrap();
        let report: SystemReadinessReport = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(report.status, "ok");
        assert_eq!(report.canonical_spec_sha256, CANONICAL_SPEC_SHA256);
        assert!(!report.release_gates.d11_production_auth_approved);
        assert!(!report.release_gates.d07_live_billing_enabled);
    }

    #[tokio::test]
    async fn s87_auth_session_lifecycle_create_inspect_and_delete_revokes_session() {
        let state = ApiAppState::new(ReleaseFeatureGates::default());
        let app = build_router_with_state(state);

        // 1. POST /v1/auth/session establishes an authenticated session
        let create_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/auth/session")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "email": "learner-a@example.test",
                            "authentication_code": "123456"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_resp.status(), StatusCode::OK);
        let session_json = read_body_json(create_resp).await;
        assert_eq!(
            session_json["account_id"],
            "00000000-0000-4000-8000-000000000001"
        );
        let token = session_json["session_token"].as_str().unwrap().to_string();

        // 2. GET /v1/auth/session returns active session
        let get_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/auth/session")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(get_resp.status(), StatusCode::OK);

        // 3. DELETE /v1/auth/session revokes the session token
        let del_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/v1/auth/session")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);

        // 4. Subsequent GET /v1/auth/session with revoked token returns 401 Unauthorized (@S87)
        let after_del_resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/auth/session")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(after_del_resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn s29_s36_s64_s87_cross_tenant_negative_cases_forbid_learner_curator_and_moderator() {
        let state = ApiAppState::new(ReleaseFeatureGates::default());
        let app = build_router_with_state(state);

        // Actors who do NOT own Learner B (`00000000-0000-4000-8000-000000000002`)
        let unauthorized_tokens = [
            "dev-account:00000000-0000-4000-8000-000000000001", // Learner A
            "dev-curator",                                      // Curator (@S36)
            "dev-moderator",                                    // Moderator (@S64)
        ];

        for token in unauthorized_tokens {
            // 1. Cannot read Learner B's proficiency
            let prof_resp = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("GET")
                        .uri("/v1/me/proficiency?account_id=00000000-0000-4000-8000-000000000002")
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                prof_resp.status(),
                StatusCode::FORBIDDEN,
                "token `{token}` must be forbidden from reading Learner B proficiency"
            );

            // 2. Cannot append progress events to Learner B's curriculum
            let prog_resp = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/v1/progress-events")
                        .header("authorization", format!("Bearer {token}"))
                        .header("content-type", "application/json")
                        .body(Body::from(
                            serde_json::to_vec(&json!({
                                "event_id": "evt-cross-tenant-1",
                                "curriculum_id": "cur-learner-b-1",
                                "activity_id": "act-ds-1",
                                "time_spent_minutes": 30
                            }))
                            .unwrap(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                prog_resp.status(),
                StatusCode::FORBIDDEN,
                "token `{token}` must be forbidden from mutating Learner B progress"
            );

            // 3. Cannot patch Learner B's schedule
            let sched_resp = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("PATCH")
                        .uri("/v1/schedules/cur-learner-b-1")
                        .header("authorization", format!("Bearer {token}"))
                        .header("if-match", "\"sched-v1\"")
                        .header("content-type", "application/json")
                        .body(Body::from(
                            serde_json::to_vec(&json!({
                                "weekly_available_minutes": 120
                            }))
                            .unwrap(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                sched_resp.status(),
                StatusCode::FORBIDDEN,
                "token `{token}` must be forbidden from mutating Learner B schedule"
            );

            // 4. Cannot read Learner B's BYOK credential metadata (@S29, @S36, @S64)
            let cred_resp = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("GET")
                        .uri("/v1/me/credentials/cred-learner-b-openai")
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                cred_resp.status(),
                StatusCode::FORBIDDEN,
                "token `{token}` must be forbidden from reading Learner B credential"
            );
        }

        // Verify Learner B CAN read their own credential metadata and it never contains raw secret (@S29)
        let owner_cred_resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/me/credentials/cred-learner-b-openai")
                    .header(
                        "authorization",
                        "Bearer dev-account:00000000-0000-4000-8000-000000000002",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(owner_cred_resp.status(), StatusCode::OK);
        let cred_json = read_body_json(owner_cred_resp).await;
        assert_eq!(cred_json["masked_hint"], "...9999");
        assert!(
            !cred_json.to_string().contains("sk-live-secret"),
            "raw secret key must never appear in credential metadata response"
        );
    }

    #[tokio::test]
    async fn s02_s22_s24_schedule_optimistic_concurrency_428_412_etag_increment_and_feasibility() {
        let state = ApiAppState::new(ReleaseFeatureGates::default());
        let app = build_router_with_state(state.clone());

        // 1. PATCH /v1/schedules/{curriculum_id} without If-Match returns 428 Precondition Required
        let missing_if_match = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/v1/schedules/cur-learner-a-1")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "weekly_available_minutes": 240
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_if_match.status(), StatusCode::PRECONDITION_REQUIRED);

        // 2. PATCH with matching If-Match "\"sched-v1\"" succeeds, increments ETag to "\"sched-v2\"", and enqueues outbox job
        let ok_patch = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/v1/schedules/cur-learner-a-1")
                    .header("if-match", "\"sched-v1\"")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "weekly_available_minutes": 100,
                            "required_minutes": 250,
                            "fixed_deadline": true
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok_patch.status(), StatusCode::OK);
        assert_eq!(
            ok_patch
                .headers()
                .get(axum::http::header::ETAG)
                .unwrap()
                .to_str()
                .unwrap(),
            "\"sched-v2\""
        );
        let sched: ScheduleRevisionRecord =
            serde_json::from_value(read_body_json(ok_patch).await).unwrap();
        assert_eq!(sched.etag_version, 2);
        // Verify @S02 infeasibility detection when required_minutes > weekly_available_minutes with fixed_deadline
        assert_eq!(sched.feasibility_status, ScheduleFeasibility::Infeasible);
        assert_eq!(sched.excess_minutes, 150);
        assert!(sched
            .recovery_options
            .contains(&"reduced_scope".to_string()));
        assert_eq!(state.outbox.metrics_snapshot(10_000).queued_depth, 1);

        // 3. Stale edit with old "\"sched-v1\"" returns 412 Precondition Failed with stale_revision (@S22, @S24)
        let stale_patch = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/v1/schedules/cur-learner-a-1")
                    .header("if-match", "\"sched-v1\"")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "weekly_available_minutes": 400
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stale_patch.status(), StatusCode::PRECONDITION_FAILED);
        let stale_err = read_body_json(stale_patch).await;
        assert_eq!(stale_err["error"]["code"], "stale_revision");
        assert_eq!(stale_err["error"]["current_etag"], "\"sched-v2\"");
    }

    #[tokio::test]
    async fn s16_s21_s24_progress_event_deduplication_retry_and_conflict() {
        let state = ApiAppState::new(ReleaseFeatureGates::default());
        let app = build_router_with_state(state);

        let payload = json!({
            "event_id": "evt-offline-101",
            "curriculum_id": "cur-learner-a-1",
            "activity_id": "act-video-1",
            "objective_id": "obj-la-1",
            "status": "self_reported_completed",
            "time_spent_minutes": 45
        });

        // 1. First submission records event (201 Created) with SelfReported proficiency (never Demonstrated @S16)
        let resp1 = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/progress-events")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp1.status(), StatusCode::CREATED);
        let receipt1: ProgressEventReceiptRecord =
            serde_json::from_value(read_body_json(resp1).await).unwrap();
        assert!(!receipt1.replayed);
        assert_eq!(receipt1.total_completed_activities, 1);
        assert_eq!(receipt1.total_time_spent_minutes, 45);
        assert_eq!(
            receipt1.objective_proficiency_status,
            ObjectiveProficiencyState::SelfReported
        );

        // 2. Offline retry with identical event_id and payload replays receipt without double-counting (@S21, @S24)
        let resp2 = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/progress-events")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp2.status(), StatusCode::OK);
        assert_eq!(
            resp2
                .headers()
                .get("Idempotency-Replayed")
                .unwrap()
                .to_str()
                .unwrap(),
            "true"
        );
        let receipt2: ProgressEventReceiptRecord =
            serde_json::from_value(read_body_json(resp2).await).unwrap();
        assert!(receipt2.replayed);
        assert_eq!(receipt2.total_completed_activities, 1);
        assert_eq!(receipt2.total_time_spent_minutes, 45);

        // 3. Conflicting payload with same event_id returns 409 Conflict (@S24)
        let mut conflicting_payload = payload.clone();
        conflicting_payload["time_spent_minutes"] = json!(90);
        let resp_conflict = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/progress-events")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&conflicting_payload).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp_conflict.status(), StatusCode::CONFLICT);

        // 4. Verify GET /v1/me/proficiency reflects 1 completed activity and SelfReported status
        let prof_resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/me/proficiency")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(prof_resp.status(), StatusCode::OK);
        let prof: LearnerProficiencyProjection =
            serde_json::from_value(read_body_json(prof_resp).await).unwrap();
        assert_eq!(prof.total_time_spent_minutes, 45);
        assert_eq!(
            prof.objectives.get("obj-la-1"),
            Some(&ObjectiveProficiencyState::SelfReported)
        );
    }

    #[tokio::test]
    async fn t01_idempotency_key_http_replay_mismatch_inflight_and_5xx_recovery() {
        let state = ApiAppState::new(ReleaseFeatureGates::default());
        let app = build_router_with_state(state.clone());

        // 1. Transient 5xx failure releases Idempotency-Key so subsequent retry succeeds
        let fail_5xx = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/me/exports")
                    .header("idempotency-key", "idem-export-001")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({"simulate_transient_5xx": true})).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(fail_5xx.status(), StatusCode::SERVICE_UNAVAILABLE);

        // 2. Retry with same Idempotency-Key now succeeds and queues 1 outbox job
        let ok_first = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/me/exports")
                    .header("idempotency-key", "idem-export-001")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({"format": "json"})).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok_first.status(), StatusCode::ACCEPTED);
        assert!(ok_first.headers().get("Idempotency-Replayed").is_none());
        let first_body = read_body_json(ok_first).await;
        assert_eq!(state.outbox.metrics_snapshot(10_000).queued_depth, 1);

        // 3. Replaying identical request returns stored 202 + Idempotency-Replayed: true without adding another outbox job
        let ok_replay = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/me/exports")
                    .header("idempotency-key", "idem-export-001")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({"format": "json"})).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok_replay.status(), StatusCode::ACCEPTED);
        assert_eq!(
            ok_replay
                .headers()
                .get("Idempotency-Replayed")
                .unwrap()
                .to_str()
                .unwrap(),
            "true"
        );
        let replay_body = read_body_json(ok_replay).await;
        assert_eq!(first_body, replay_body);
        assert_eq!(state.outbox.metrics_snapshot(10_000).queued_depth, 1);

        // 4. Reusing same Idempotency-Key with different payload returns 409 Conflict (idempotency_payload_mismatch)
        let mismatch = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/me/exports")
                    .header("idempotency-key", "idem-export-001")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({"format": "markdown"})).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mismatch.status(), StatusCode::CONFLICT);
        let mismatch_body = read_body_json(mismatch).await;
        assert_eq!(
            mismatch_body["error"]["code"],
            "idempotency_payload_mismatch"
        );

        // 5. Duplicate request arriving while first is InFlight returns 409 Conflict (idempotency_in_flight)
        let acquired = state
            .store
            .begin_idempotent_command(
                "00000000-0000-4000-8000-000000000001",
                "createAccountExportJob",
                Some("idem-export-inflight"),
                &json!({"format": "json"}),
                10_000,
                86_400_000,
            )
            .unwrap();
        assert_eq!(acquired, IdempotencyBeginOutcome::Acquired);

        let inflight_resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/me/exports")
                    .header("idempotency-key", "idem-export-inflight")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({"format": "json"})).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(inflight_resp.status(), StatusCode::CONFLICT);
        let inflight_body = read_body_json(inflight_resp).await;
        assert_eq!(inflight_body["error"]["code"], "idempotency_in_flight");
    }

    #[tokio::test]
    async fn private_alpha_tracer_bullet_end_to_end_flow() {
        let state = ApiAppState::new(ReleaseFeatureGates::default());
        let app = build_router_with_state(state.clone());

        // 1. Auth Session for Learner A
        let auth_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/auth/session")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "email": "learner.a@example.com",
                            "authentication_code": "123456"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(auth_resp.status(), StatusCode::OK);
        let auth_body = read_body_json(auth_resp).await;
        assert_eq!(
            auth_body["account_id"],
            "00000000-0000-4000-8000-000000000001"
        );
        let session_token = auth_body["session_token"].as_str().unwrap().to_string();

        // 2. Goal Intake (POST /v1/goals/interpret)
        let goal_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/goals/interpret")
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "goal_text": "Learn LLM Engineering with Python",
                            "weekly_minutes": 180,
                            "target_weeks": 4,
                            "free_only": true,
                            "prior_skills": ["python"],
                            "owned_subscriptions": [],
                            "certification_required": false
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(goal_resp.status(), StatusCode::OK);
        let goal_body = read_body_json(goal_resp).await;
        assert_eq!(goal_body["goal_specification"]["free_only"], true);
        assert_eq!(
            goal_body["goal_specification"]["weekly_available_minutes"],
            180
        );
        let generation_request = goal_body["normalized_generation_request"].clone();

        // 3. Submit Async Generation Job with Idempotency-Key (POST /v1/generations)
        let missing_idem_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/generations")
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&generation_request).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_idem_resp.status(), StatusCode::BAD_REQUEST);

        let gen_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/generations")
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("idempotency-key", "idem-alpha-gen-001")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&generation_request).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(gen_resp.status(), StatusCode::ACCEPTED);
        let gen_body = read_body_json(gen_resp).await;
        let job_id = gen_body["job_id"].as_str().unwrap().to_string();
        assert_eq!(gen_body["status"], "succeeded");
        let curriculum_id = gen_body["curriculum_id"].as_str().unwrap().to_string();
        let revision_id = gen_body["revision_id"].as_str().unwrap().to_string();

        // Replay identical POST /v1/generations with same Idempotency-Key returns 202 + Idempotency-Replayed: true
        let gen_replay = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/generations")
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("idempotency-key", "idem-alpha-gen-001")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&generation_request).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(gen_replay.status(), StatusCode::ACCEPTED);
        assert_eq!(
            gen_replay
                .headers()
                .get("Idempotency-Replayed")
                .unwrap()
                .to_str()
                .unwrap(),
            "true"
        );
        let replay_body = read_body_json(gen_replay).await;
        assert_eq!(replay_body["job_id"], job_id);

        // 4. Poll Generation Status (GET /v1/generations/{job_id})
        let poll_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/v1/generations/{}", job_id))
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(poll_resp.status(), StatusCode::OK);
        let poll_body = read_body_json(poll_resp).await;
        assert_eq!(poll_body["status"], "succeeded");
        assert_eq!(
            poll_body["candidate_sha256"],
            "3e47ee0d4631041709e565f9b3de28e683199ef8cf8941ecc4503a849be523de"
        );

        // 5. Inspect Curriculum Overview & Draft Revision (is_active == false prior to explicit activation)
        let overview_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/v1/curricula/{}", curriculum_id))
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(overview_resp.status(), StatusCode::OK);
        assert_eq!(
            overview_resp.headers().get("ETag").unwrap().to_str().unwrap(),
            "\"cur-act-v0\""
        );
        let overview_body = read_body_json(overview_resp).await;
        assert!(overview_body["active_revision_id"].is_null());
        assert_eq!(overview_body["revisions"][0]["revision_id"], revision_id);
        assert_eq!(overview_body["revisions"][0]["is_active"], false);

        let rev_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/v1/curricula/{}/revisions/{}",
                        curriculum_id, revision_id
                    ))
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rev_resp.status(), StatusCode::OK);
        let rev_body = read_body_json(rev_resp).await;
        assert_eq!(rev_body["is_active"], false);
        assert_eq!(rev_body["payload"]["total_estimated_minutes"], 48);
        assert_eq!(
            rev_body["payload"]["activities"].as_array().unwrap().len(),
            6
        );

        // 6. Activate Curriculum Revision with If-Match optimistic concurrency
        let activate_missing_if_match = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/v1/curricula/{}/revisions/{}/activate",
                        curriculum_id, revision_id
                    ))
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            activate_missing_if_match.status(),
            StatusCode::PRECONDITION_REQUIRED
        );

        let activate_ok = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/v1/curricula/{}/revisions/{}/activate",
                        curriculum_id, revision_id
                    ))
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("if-match", "\"cur-act-v0\"")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(activate_ok.status(), StatusCode::OK);
        assert_eq!(
            activate_ok.headers().get("ETag").unwrap().to_str().unwrap(),
            "\"cur-act-v1\""
        );
        let activate_body = read_body_json(activate_ok).await;
        assert_eq!(activate_body["is_active"], true);

        // Stale If-Match returns 412 Precondition Failed (stale_revision)
        let activate_stale = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/v1/curricula/{}/revisions/{}/activate",
                        curriculum_id, revision_id
                    ))
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("if-match", "\"cur-act-v0\"")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(activate_stale.status(), StatusCode::PRECONDITION_FAILED);
        let stale_body = read_body_json(activate_stale).await;
        assert_eq!(stale_body["error"]["code"], "stale_revision");

        // 7. Inspect & Update Weekly Schedule with If-Match optimistic concurrency
        let sched_get = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/v1/schedules/{}", curriculum_id))
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(sched_get.status(), StatusCode::OK);
        assert_eq!(
            sched_get.headers().get("ETag").unwrap().to_str().unwrap(),
            "\"sched-v1\""
        );

        let sched_patch = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/v1/schedules/{}", curriculum_id))
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("if-match", "\"sched-v1\"")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "weekly_available_minutes": 180,
                            "required_minutes": 120,
                            "fixed_deadline": false
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(sched_patch.status(), StatusCode::OK);
        assert_eq!(
            sched_patch.headers().get("ETag").unwrap().to_str().unwrap(),
            "\"sched-v2\""
        );
        let sched_patch_body = read_body_json(sched_patch).await;
        assert_eq!(sched_patch_body["etag_version"], 2);
        assert_eq!(sched_patch_body["weekly_available_minutes"], 180);

        // 8. Record Activity Completion (POST /v1/curricula/{curriculum_id}/progress-events) & Verify SelfReported Proficiency
        let progress_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/curricula/{}/progress-events", curriculum_id))
                    .header("authorization", format!("Bearer {}", session_token))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "event_id": "idem-alpha-progress-001",
                            "objective_id": "objective-tokenization",
                            "activity_id": "activity-theory",
                            "status": "self_reported_completed",
                            "time_spent_minutes": 15
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(progress_resp.status(), StatusCode::CREATED);
        let progress_body = read_body_json(progress_resp).await;
        assert_eq!(
            progress_body["objective_proficiency_status"],
            "self_reported"
        );
        assert_ne!(
            progress_body["objective_proficiency_status"],
            "demonstrated"
        );

        let prof_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/me/proficiency")
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(prof_resp.status(), StatusCode::OK);
        let prof_body = read_body_json(prof_resp).await;
        assert_eq!(
            prof_body["objectives"]["objective-tokenization"],
            "self_reported"
        );
        assert_eq!(prof_body["total_time_spent_minutes"], 15);

        // 9. Curator Quarantines Resource -> Resource Alert Surfaces Without Mutating Revision Payload
        let quarantine_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/catalog/resources/synthetic-resource-tokenization-v1/quarantine")
                    .header("authorization", "Bearer dev-curator")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "reason": "Broken upstream anchor detected during freshness sweep"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(quarantine_resp.status(), StatusCode::OK);

        let alerts_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/v1/curricula/{}/resource-alerts", curriculum_id))
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(alerts_resp.status(), StatusCode::OK);
        let alerts_body = read_body_json(alerts_resp).await;
        let alerts = alerts_body["items"].as_array().unwrap();
        assert_eq!(alerts.len(), 1);
        assert_eq!(
            alerts[0]["resource_version_id"],
            "synthetic-resource-tokenization-v1"
        );
        assert_eq!(alerts[0]["severity"], "warning");

        // Verify historical revision candidate_sha256 is unchanged after quarantine (@S07, @S10)
        let rev_after_quarantine = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/v1/curricula/{}/revisions/{}",
                        curriculum_id, revision_id
                    ))
                    .header("authorization", format!("Bearer {}", session_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rev_after_quarantine.status(), StatusCode::OK);
        let rev_after_body = read_body_json(rev_after_quarantine).await;
        assert_eq!(
            rev_after_body["candidate_sha256"],
            "3e47ee0d4631041709e565f9b3de28e683199ef8cf8941ecc4503a849be523de"
        );
    }

    #[tokio::test]
    async fn t02_t03_catalog_filter_review_and_generation_cancel_routes() {
        let state = ApiAppState::new(ReleaseFeatureGates::default());
        let app = build_router_with_state(state);

        // 1. GET /v1/catalog/resources with free_only=true excludes unknown-price and paid resources (@S05)
        let cat_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/catalog/resources?topic=rag-python&free_only=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cat_resp.status(), StatusCode::OK);
        let cat_body = read_body_json(cat_resp).await;
        let items = cat_body["eligible_resources"].as_array().unwrap();
        assert!(!items.is_empty());
        assert!(items
            .iter()
            .all(|item| item["resource_version_id"] != "res-rag-unknown-price-v1"
                && item["resource_version_id"] != "res-rag-paid-book-v1"
                && item["is_synthetic_fixture"] == false));

        // 2. Curator approval without complete rubric evidence returns 422 (missing_review_rubric_evidence)
        let bad_review_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/catalog/resources/res-rag-unknown-price-v1/reviews")
                    .header("authorization", "Bearer dev-curator")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "decision": "approved",
                            "rationale": "Missing rubric scores"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad_review_resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let bad_review_body = read_body_json(bad_review_resp).await;
        assert_eq!(
            bad_review_body["error"]["code"],
            "missing_review_rubric_evidence"
        );
    }
}
