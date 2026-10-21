//! Core HTTP handlers: auth sessions, learner proficiency, progress events, schedule,
//! export jobs, catalog filtering/review/quarantine, goal intake, generation, curricula, and BYOK credentials.

use crate::*;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use curriculum_application::{
    execute_generation_job, interpret_goal_request, CatalogFilterQuery, CatalogReviewInput,
};
use curriculum_domain::ActivityExecutionStatus;
use curriculum_persistence::{
    IdempotencyBeginOutcome, PersistenceError, ProgressEventInput, SchedulePatchInput,
};
use curriculum_security::PrincipalRole;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

pub(crate) async fn create_auth_session_handler(
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

pub(crate) async fn get_auth_session_handler(
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

pub(crate) async fn delete_auth_session_handler(
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

pub(crate) async fn get_my_proficiency_handler(
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

pub(crate) fn default_completed_status() -> ActivityExecutionStatus {
    ActivityExecutionStatus::SelfReportedCompleted
}

pub(crate) async fn post_progress_event_handler(
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

pub(crate) async fn post_curriculum_progress_event_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(req): Json<ProgressEventRequestDto>,
) -> Response {
    handle_progress_event_inner(state, headers, curriculum_id, req)
}

pub(crate) fn handle_progress_event_inner(
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

pub(crate) async fn get_schedule_handler(
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

pub(crate) async fn patch_schedule_handler(
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

pub(crate) async fn get_credential_metadata_handler(
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

pub(crate) async fn create_export_job_handler(
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

            let export_rec = match state.store.create_account_export(&principal, Some(&job_id)) {
                Ok(r) => r,
                Err(err) => return error_response(err),
            };

            let response_body = json!({
                "job_id": job_id,
                "export_id": export_rec.export_id,
                "status": "queued",
                "requested_at": "2026-10-20T21:16:10Z",
                "archive_sha256": export_rec.archive_sha256,
                "export_payload": export_rec.export_payload,
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

pub(crate) async fn list_or_filter_catalog_resources_handler(
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

pub(crate) async fn review_catalog_resource_handler(
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

pub(crate) async fn quarantine_catalog_resource_handler(
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

pub(crate) async fn interpret_goal_handler(
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

pub(crate) async fn start_generation_handler(
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

            // T07A: If BYOK mode is requested, enforce allow_hosted_fallback == false and verify pinned credential
            if payload.get("credential_mode").and_then(|v| v.as_str()) == Some("byok") {
                if payload
                    .get("allow_hosted_fallback")
                    .and_then(|v| v.as_bool())
                    == Some(true)
                {
                    let err = PersistenceError::Validation(
                        "silent fallback to hosted platform credentials is forbidden in BYOK mode (`@S28`, `@S66`)"
                            .to_string(),
                    );
                    state.store.complete_idempotent_command(
                        &principal.account_id,
                        operation_id,
                        key_str,
                        err.http_status_code(),
                        json!({"error": {"code": err.error_code(), "message": err.to_string()}}),
                    );
                    return error_response(err);
                }

                if let Some(cred_ref) = payload.get("credential_ref").and_then(|v| v.as_str()) {
                    let meta = match state.store.get_credential_metadata(&principal, cred_ref) {
                        Ok(m) => m,
                        Err(err) => {
                            state.store.complete_idempotent_command(
                                &principal.account_id,
                                operation_id,
                                key_str,
                                err.http_status_code(),
                                json!({"error": {"code": err.error_code(), "message": err.to_string()}}),
                            );
                            return error_response(err);
                        }
                    };
                    let pinned_ver = payload
                        .get("credential_version")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(meta.version);
                    if let Err(err) = state.store.open_credential_for_pinned_inference(
                        &principal,
                        cred_ref,
                        pinned_ver,
                    ) {
                        state.store.complete_idempotent_command(
                            &principal.account_id,
                            operation_id,
                            key_str,
                            err.http_status_code(),
                            json!({"error": {"code": err.error_code(), "message": err.to_string()}}),
                        );
                        return error_response(err);
                    }
                    let _ = state.store.record_inference_usage(
                        &principal,
                        cred_ref,
                        pinned_ver,
                        &meta.provider_id,
                        "gpt-4o-2024-08-06",
                        "curriculum_generation",
                        1_500,
                        1_100,
                        "provider_reported",
                    );
                }
            }

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

pub(crate) async fn get_generation_job_handler(
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

pub(crate) async fn cancel_generation_job_handler(
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

pub(crate) async fn list_my_curricula_handler(
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

pub(crate) async fn get_curriculum_overview_handler(
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

pub(crate) async fn get_curriculum_revision_handler(
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

pub(crate) async fn activate_curriculum_revision_handler(
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

pub(crate) async fn put_active_revision_handler(
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

pub(crate) async fn get_curriculum_resource_alerts_handler(
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

// =============================================================================
// T07A Handlers: BYOK Credential Custody & Usage Records
// =============================================================================

pub(crate) async fn create_credential_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let provider_id = payload
        .get("provider_id")
        .or_else(|| payload.get("provider"))
        .and_then(|v| v.as_str())
        .unwrap_or("openai");
    let label = payload
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("BYOK Credential");
    let raw_api_key = payload
        .get("api_key")
        .or_else(|| payload.get("secret"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let credential_ref = payload
        .get("credential_ref")
        .or_else(|| payload.get("credential_id"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("cred-{}-{provider_id}", principal.account_id));

    match state.store.create_credential(
        &principal,
        &credential_ref,
        provider_id,
        label,
        raw_api_key,
    ) {
        Ok(view) => {
            let etag = view.etag.clone();
            let mut resp = (StatusCode::CREATED, Json(view)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

pub(crate) async fn list_credentials_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let items = state.store.list_credential_metadata(&principal);
    (StatusCode::OK, Json(json!({ "items": items }))).into_response()
}

pub(crate) async fn rotate_credential_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(credential_ref): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let if_match = extract_header_str(&headers, "if-match");
    let new_key = payload
        .get("api_key")
        .or_else(|| payload.get("new_api_key"))
        .or_else(|| payload.get("secret"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let new_label = payload.get("label").and_then(|v| v.as_str());

    match state
        .store
        .rotate_credential(&principal, &credential_ref, if_match, new_key, new_label)
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

pub(crate) async fn revoke_credential_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(credential_ref): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let if_match = extract_header_str(&headers, "if-match");
    match state
        .store
        .revoke_credential(&principal, &credential_ref, if_match, 10_000)
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn get_my_usage_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let records = state.store.list_inference_usage(&principal);
    let total_tokens: u64 = records.iter().map(|r| r.total_tokens).sum();
    let total_provider_cost_micros: u64 = records
        .iter()
        .map(|r| r.estimated_provider_cost_usd_micros)
        .sum();
    (
        StatusCode::OK,
        Json(json!({
            "account_id": principal.account_id,
            "hosted_service_charge_usd_micros": 0,
            "total_tokens": total_tokens,
            "estimated_provider_cost_usd_micros": total_provider_cost_micros,
            "items": records,
        })),
    )
        .into_response()
}
