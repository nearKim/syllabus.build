//! Syllabus lifecycle, AST operations, schedule, and learner progress HTTP handlers:
//! syllabus overview and listings (`T04`), revision inspection and activation,
//! syllabus resource bindings and alerts, schedule management with optimistic concurrency,
//! and learner progress events.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use syllabus_application::{CatalogResourcePatchInput, SyllabusResourceBindingInput};
use syllabus_domain::ActivityExecutionStatus;
use syllabus_persistence::{ProgressEventInput, SchedulePatchInput};
use syllabus_security::AuthenticatedPrincipal;

use crate::{
    extract_if_match, json_with_etag, ApiAppState, ApiResult, AuthPrincipal, DEFAULT_NOW_EPOCH_MS,
    DEFAULT_SYLLABUS_ID, HEADER_IDEMPOTENCY_REPLAYED,
};

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
    let target_account_id = query.account_id.as_deref().unwrap_or(&principal.account_id);
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
    pub(crate) syllabus_id: Option<String>,
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
    let syllabus_id = req.syllabus_id.take();
    handle_progress_event_inner(
        &state,
        &principal,
        syllabus_id.as_deref().unwrap_or(DEFAULT_SYLLABUS_ID),
        req,
    )
}

pub(crate) async fn post_syllabus_progress_event_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(syllabus_id): Path<String>,
    Json(req): Json<ProgressEventRequestDto>,
) -> ApiResult {
    handle_progress_event_inner(&state, &principal, &syllabus_id, req)
}

fn handle_progress_event_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    syllabus_id: &str,
    req: ProgressEventRequestDto,
) -> ApiResult {
    let input = ProgressEventInput {
        event_id: req.event_id,
        syllabus_id: syllabus_id.to_string(),
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
    Path(syllabus_id): Path<String>,
) -> ApiResult {
    let schedule = state.store.get_schedule(&principal, &syllabus_id)?;
    Ok(json_with_etag(StatusCode::OK, &schedule.etag, &schedule))
}

pub(crate) async fn patch_schedule_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(syllabus_id): Path<String>,
    Json(patch_input): Json<SchedulePatchInput>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    let updated = state
        .store
        .patch_schedule(&principal, &syllabus_id, if_match, patch_input)?;

    let job_id = format!(
        "job-sched-sync-{}-v{}",
        updated.syllabus_id, updated.etag_version
    );
    let _ = state.outbox.enqueue(
        job_id,
        principal.account_id,
        "schedule_reminder_sync",
        json!({
            "syllabus_id": updated.syllabus_id,
            "schedule_revision_id": updated.schedule_revision_id,
            "etag_version": updated.etag_version,
        }),
        DEFAULT_NOW_EPOCH_MS,
    );

    Ok(json_with_etag(StatusCode::OK, &updated.etag, &updated))
}

pub(crate) async fn list_my_syllabi_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let items = state.store.list_my_syllabi(&principal)?;
    Ok((StatusCode::OK, Json(json!({ "items": items }))).into_response())
}

pub(crate) async fn get_syllabus_overview_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(syllabus_id): Path<String>,
) -> ApiResult {
    let overview = state
        .store
        .get_syllabus_overview(&principal, &syllabus_id)?;
    Ok(json_with_etag(StatusCode::OK, &overview.etag, &overview))
}

pub(crate) async fn get_syllabus_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((syllabus_id, revision_id)): Path<(String, String)>,
) -> ApiResult {
    let (rev, etag) = state.store.get_syllabus_revision_by_syllabus_and_id(
        &principal,
        &syllabus_id,
        &revision_id,
    )?;
    let mut body = serde_json::to_value(&rev).unwrap_or(Value::Null);
    body["etag"] = json!(&etag);
    Ok(json_with_etag(StatusCode::OK, &etag, &body))
}

pub(crate) async fn activate_syllabus_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path((syllabus_id, revision_id)): Path<(String, String)>,
) -> ApiResult {
    activate_syllabus_revision_inner(&state, &principal, &headers, &syllabus_id, &revision_id)
}

/// Request payload for activating a syllabus revision via `PUT /v1/syllabi/{id}/active-revision`.
#[derive(Debug, Deserialize)]
pub(crate) struct PutActiveRevisionRequestDto {
    pub(crate) revision_id: String,
}

pub(crate) async fn put_active_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(syllabus_id): Path<String>,
    Json(req): Json<PutActiveRevisionRequestDto>,
) -> ApiResult {
    activate_syllabus_revision_inner(&state, &principal, &headers, &syllabus_id, &req.revision_id)
}

fn activate_syllabus_revision_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    headers: &HeaderMap,
    syllabus_id: &str,
    revision_id: &str,
) -> ApiResult {
    let if_match = extract_if_match(headers);
    let (updated, next_etag) =
        state
            .store
            .activate_syllabus_revision(principal, syllabus_id, revision_id, if_match)?;
    let mut body = serde_json::to_value(&updated).unwrap_or(Value::Null);
    body["active_revision_id"] = json!(updated.revision_id);
    body["etag"] = json!(&next_etag);
    Ok(json_with_etag(StatusCode::OK, &next_etag, &body))
}

pub(crate) async fn get_syllabus_resource_alerts_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(syllabus_id): Path<String>,
) -> ApiResult {
    let alerts = state
        .store
        .list_syllabus_resource_alerts(&principal, &syllabus_id)?;
    Ok((StatusCode::OK, Json(json!({ "items": alerts }))).into_response())
}

pub(crate) async fn add_syllabus_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(syllabus_id): Path<String>,
    Json(input): Json<SyllabusResourceBindingInput>,
) -> ApiResult {
    let (revision, receipt) =
        state
            .store
            .upsert_syllabus_resource_binding(&principal, &syllabus_id, input)?;
    let body = json!({
        "receipt": receipt,
        "revision": revision,
    });
    Ok(json_with_etag(StatusCode::CREATED, &receipt.etag, &body))
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct PatchSyllabusResourceDto {
    #[serde(default)]
    pub(crate) module_id: Option<String>,
    #[serde(default)]
    pub(crate) activity_id: Option<String>,
    #[serde(default)]
    pub(crate) activity_title: Option<String>,
    #[serde(default)]
    pub(crate) role: Option<String>,
    #[serde(default)]
    pub(crate) requirement_level: Option<String>,
    #[serde(default)]
    pub(crate) segment_ids: Vec<String>,
    #[serde(default)]
    pub(crate) selection_rationale: Option<String>,
    #[serde(default)]
    pub(crate) catalog_patch: Option<CatalogResourcePatchInput>,
}

pub(crate) async fn patch_syllabus_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((syllabus_id, resource_version_id)): Path<(String, String)>,
    Json(dto): Json<PatchSyllabusResourceDto>,
) -> ApiResult {
    let updated_resource = if let Some(cat_patch) = dto.catalog_patch {
        state
            .store
            .get_syllabus_overview(&principal, &syllabus_id)?;
        Some(
            state
                .store
                .update_catalog_resource(&principal, &resource_version_id, cat_patch)?,
        )
    } else {
        None
    };

    let (revision, receipt) = state.store.upsert_syllabus_resource_binding(
        &principal,
        &syllabus_id,
        SyllabusResourceBindingInput {
            resource_version_id,
            module_id: dto.module_id,
            activity_id: dto.activity_id,
            activity_title: dto.activity_title,
            role: dto.role,
            requirement_level: dto.requirement_level,
            segment_ids: dto.segment_ids,
            selection_rationale: dto.selection_rationale,
        },
    )?;

    let body = json!({
        "receipt": receipt,
        "revision": revision,
        "resource": updated_resource,
        "tfidf_corpus_document_count": state.store.catalog_tfidf_document_count(),
    });
    Ok(json_with_etag(StatusCode::OK, &receipt.etag, &body))
}

pub(crate) async fn delete_syllabus_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((syllabus_id, resource_version_id)): Path<(String, String)>,
) -> ApiResult {
    let (revision, receipt) = state.store.remove_syllabus_resource_binding(
        &principal,
        &syllabus_id,
        &resource_version_id,
    )?;
    let body = json!({
        "receipt": receipt,
        "revision": revision,
    });
    Ok(json_with_etag(StatusCode::OK, &receipt.etag, &body))
}
