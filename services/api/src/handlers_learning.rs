//! Learning & adaptation HTTP handlers: assessments, attempts, assistance events, defect reports,
//! key corrections, prerequisite gates, diagnostics, adaptation proposals, notifications, and reminders.

use crate::*;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use curriculum_domain::{
    AssistanceLevel, DiagnosticStopReason, LearnerGateDecision, MathDepthPreference,
};
use curriculum_persistence::{IdempotencyBeginOutcome, PersistenceError};
use serde_json::{json, Value};
use std::collections::BTreeMap;

// =============================================================================
// T05 Handlers: Assessments, Attempts, Assistance Events, Defect Reports & Key Corrections
// =============================================================================

pub(crate) async fn get_assessment_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(assessment_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.get_assessment_view(&principal, &assessment_id) {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn record_attempt_assistance_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((assessment_id, attempt_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> Response {
    record_assistance_inner(state, headers, assessment_id, Some(attempt_id), payload)
}

pub(crate) async fn record_assessment_assistance_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let attempt_id = payload
        .get("attempt_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    record_assistance_inner(state, headers, assessment_id, attempt_id, payload)
}

pub(crate) fn record_assistance_inner(
    state: ApiAppState,
    headers: HeaderMap,
    assessment_id: String,
    attempt_id: Option<String>,
    payload: Value,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let level_str = payload
        .get("assistance_level")
        .or_else(|| payload.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("hint_used");
    let level = match AssistanceLevel::from_wire(level_str) {
        Ok(l) => l,
        Err(e) => return error_response(PersistenceError::Validation(e.to_string())),
    };
    match state.store.record_assessment_assistance_event(
        &principal,
        &assessment_id,
        attempt_id.as_deref(),
        level,
    ) {
        Ok(res) => (StatusCode::OK, Json(res)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn submit_assessment_attempt_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };

    let idem_key = extract_header_str(&headers, "idempotency-key");
    let operation_id = "submitAssessmentAttempt";
    if idem_key.is_some() {
        match state.store.begin_idempotent_command(
            &principal.account_id,
            operation_id,
            idem_key,
            &payload,
            10_000,
            86_400_000,
        ) {
            Ok(IdempotencyBeginOutcome::Replayed(stored)) => {
                let status =
                    StatusCode::from_u16(stored.status_code).unwrap_or(StatusCode::CREATED);
                let mut resp = (status, Json(stored.body)).into_response();
                resp.headers_mut()
                    .insert("Idempotency-Replayed", HeaderValue::from_static("true"));
                return resp;
            }
            Ok(IdempotencyBeginOutcome::Acquired) => {}
            Err(err) => return error_response(err),
        }
    }

    let attempt_id = payload
        .get("attempt_id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "att-{assessment_id}-{}",
                idem_key.unwrap_or("default")
            )
        });
    let session_id = payload
        .get("session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("sess-initial-1");
    let assistance_str = payload
        .get("assistance_level")
        .and_then(|v| v.as_str())
        .unwrap_or("independent");
    let declared_assistance = match AssistanceLevel::from_wire(assistance_str) {
        Ok(l) => l,
        Err(e) => return error_response(PersistenceError::Validation(e.to_string())),
    };
    let mut responses = BTreeMap::new();
    if let Some(obj) = payload.get("responses").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                responses.insert(k.clone(), s.to_string());
            }
        }
    }
    let explicit_score_bp = payload
        .get("score_bp")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    match state.store.submit_assessment_attempt(
        &principal,
        &assessment_id,
        &attempt_id,
        session_id,
        declared_assistance,
        responses,
        explicit_score_bp,
    ) {
        Ok(record) => {
            let body = serde_json::to_value(&record).unwrap_or(Value::Null);
            if let Some(k) = idem_key {
                state.store.complete_idempotent_command(
                    &principal.account_id,
                    operation_id,
                    k,
                    201,
                    body.clone(),
                );
            }
            (StatusCode::CREATED, Json(body)).into_response()
        }
        Err(err) => {
            if let Some(k) = idem_key {
                state.store.complete_idempotent_command(
                    &principal.account_id,
                    operation_id,
                    k,
                    err.http_status_code(),
                    json!({"error": {"code": err.error_code(), "message": err.to_string()}}),
                );
            }
            error_response(err)
        }
    }
}

pub(crate) async fn get_assessment_attempt_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.get_assessment_attempt(&principal, &attempt_id) {
        Ok(rec) => (StatusCode::OK, Json(rec)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn report_defective_item_path_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((assessment_id, item_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> Response {
    report_defective_item_inner(state, headers, assessment_id, item_id, payload)
}

pub(crate) async fn report_defective_item_body_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let item_id = payload
        .get("item_id")
        .and_then(|v| v.as_str())
        .unwrap_or("item-tok-1")
        .to_string();
    report_defective_item_inner(state, headers, assessment_id, item_id, payload)
}

pub(crate) fn report_defective_item_inner(
    state: ApiAppState,
    headers: HeaderMap,
    assessment_id: String,
    item_id: String,
    payload: Value,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let reason_code = payload
        .get("reason_code")
        .or_else(|| payload.get("reason"))
        .and_then(|v| v.as_str())
        .unwrap_or("broken_answer_key");
    let details = payload
        .get("details")
        .or_else(|| payload.get("description"))
        .and_then(|v| v.as_str())
        .unwrap_or("Reported defective assessment item");
    match state.store.report_defective_assessment_item(
        &principal,
        &assessment_id,
        &item_id,
        reason_code,
        details,
    ) {
        Ok(report) => (StatusCode::CREATED, Json(report)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn apply_key_correction_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let mut updated_key = BTreeMap::new();
    if let Some(obj) = payload
        .get("updated_answer_key")
        .or_else(|| payload.get("answer_key"))
        .and_then(|v| v.as_object())
    {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                updated_key.insert(k.clone(), s.to_string());
            }
        }
    }
    let rationale = payload
        .get("rationale")
        .and_then(|v| v.as_str())
        .unwrap_or("Curator corrected defective answer key");
    match state.store.apply_assessment_key_correction(
        &principal,
        &assessment_id,
        updated_key,
        rationale,
    ) {
        Ok(correction) => (StatusCode::OK, Json(correction)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn evaluate_prerequisite_gate_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((curriculum_id, objective_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let prereq_ids: Vec<String> = payload
        .get("prerequisite_objective_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let is_mastery_gated = payload
        .get("is_mastery_gated")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let decision = match payload.get("learner_decision").and_then(|v| v.as_str()) {
        Some("prerequisite_override_recorded" | "override") => {
            Some(LearnerGateDecision::PrerequisiteOverrideRecorded)
        }
        Some("unverified_prerequisite_acknowledged" | "acknowledge_unverified") => {
            Some(LearnerGateDecision::UnverifiedPrerequisiteAcknowledged)
        }
        _ => None,
    };

    match state.store.evaluate_and_record_prerequisite_gate(
        &principal,
        &curriculum_id,
        &objective_id,
        &prereq_ids,
        is_mastery_gated,
        decision,
    ) {
        Ok(eval) => (StatusCode::OK, Json(eval)).into_response(),
        Err(err) => error_response(err),
    }
}

// =============================================================================
// T12 Handlers: Objective Diagnostics & Adaptation Proposals
// =============================================================================

pub(crate) async fn start_diagnostic_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let diagnostic_id = payload
        .get("diagnostic_id")
        .and_then(|v| v.as_str())
        .unwrap_or("diag-session-1")
        .to_string();
    let curriculum_id = payload
        .get("curriculum_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let topic_id = payload
        .get("topic_id")
        .or_else(|| payload.get("topic"))
        .and_then(|v| v.as_str())
        .unwrap_or("rag-python");
    let candidate_objectives: Vec<String> = payload
        .get("objective_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let math_depth = match payload
        .get("math_depth_preference")
        .or_else(|| payload.get("math_depth"))
        .and_then(|v| v.as_str())
    {
        Some(s) => match MathDepthPreference::from_wire(s) {
            Ok(p) => Some(p),
            Err(e) => return error_response(PersistenceError::Validation(e.to_string())),
        },
        None => None,
    };

    match state.store.start_diagnostic_session(
        &principal,
        &diagnostic_id,
        curriculum_id,
        topic_id,
        candidate_objectives,
        math_depth,
    ) {
        Ok(rec) => (StatusCode::CREATED, Json(rec)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn get_diagnostic_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(diagnostic_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .get_diagnostic_session(&principal, &diagnostic_id)
    {
        Ok(rec) => (StatusCode::OK, Json(rec)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn submit_diagnostic_attempt_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(diagnostic_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let item_id = payload
        .get("item_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let answer = payload
        .get("answer")
        .or_else(|| payload.get("response"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let assistance_str = payload
        .get("assistance_level")
        .and_then(|v| v.as_str())
        .unwrap_or("independent");
    let assistance = match AssistanceLevel::from_wire(assistance_str) {
        Ok(a) => a,
        Err(e) => return error_response(PersistenceError::Validation(e.to_string())),
    };

    match state.store.submit_diagnostic_item_attempt(
        &principal,
        &diagnostic_id,
        item_id,
        answer,
        assistance,
    ) {
        Ok(rec) => (StatusCode::OK, Json(rec)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn stop_diagnostic_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(diagnostic_id): Path<String>,
    payload: Option<Json<Value>>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let reason = payload
        .as_ref()
        .and_then(|Json(v)| v.get("stop_reason").and_then(|r| r.as_str()))
        .map(|s| match s {
            "uncertainty_bound_reached" => DiagnosticStopReason::UncertaintyBoundReached,
            "all_items_answered" => DiagnosticStopReason::AllItemsAnswered,
            _ => DiagnosticStopReason::LearnerStopped,
        });
    match state
        .store
        .stop_diagnostic_session(&principal, &diagnostic_id, reason)
    {
        Ok(rec) => (StatusCode::OK, Json(rec)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn preview_adaptation_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    payload: Option<Json<Value>>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let body = payload.map(|Json(v)| v).unwrap_or_else(|| json!({}));
    let proposal_id = body
        .get("proposal_id")
        .and_then(|v| v.as_str())
        .unwrap_or("adapt-prop-001");
    let trigger_kind = body.get("trigger_kind").and_then(|v| v.as_str());

    match state
        .store
        .create_adaptation_proposal(&principal, &curriculum_id, proposal_id, trigger_kind)
    {
        Ok(rec) => (StatusCode::CREATED, Json(rec.payload)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn get_adaptation_proposal_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(proposal_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .get_adaptation_proposal(&principal, &proposal_id)
    {
        Ok(rec) => (StatusCode::OK, Json(rec.payload)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn get_curriculum_adaptation_proposal_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((_curriculum_id, proposal_id)): Path<(String, String)>,
) -> Response {
    get_adaptation_proposal_handler(State(state), headers, Path(proposal_id)).await
}

pub(crate) async fn accept_adaptation_body_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let proposal_id = payload
        .get("proposal_id")
        .and_then(|v| v.as_str())
        .unwrap_or("adapt-prop-001")
        .to_string();
    accept_adaptation_inner(state, headers, curriculum_id, proposal_id, payload)
}

pub(crate) async fn accept_adaptation_path_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((curriculum_id, proposal_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> Response {
    accept_adaptation_inner(state, headers, curriculum_id, proposal_id, payload)
}

pub(crate) fn accept_adaptation_inner(
    state: ApiAppState,
    headers: HeaderMap,
    curriculum_id: String,
    proposal_id: String,
    payload: Value,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };

    let idem_key = extract_header_str(&headers, "idempotency-key");
    let operation_id = "acceptAdaptation";

    match state.store.begin_idempotent_command(
        &principal.account_id,
        operation_id,
        idem_key,
        &payload,
        10_000,
        86_400_000,
    ) {
        Ok(IdempotencyBeginOutcome::Replayed(stored)) => {
            let status = StatusCode::from_u16(stored.status_code).unwrap_or(StatusCode::OK);
            let mut resp = (status, Json(stored.body)).into_response();
            resp.headers_mut()
                .insert("Idempotency-Replayed", HeaderValue::from_static("true"));
            resp
        }
        Ok(IdempotencyBeginOutcome::Acquired) => {
            let key_str = idem_key.unwrap_or_default();
            let expected_sha = payload
                .get("expected_proposal_sha256")
                .or_else(|| payload.get("proposal_sha256"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let base_cur = payload
                .get("base_curriculum_revision_id")
                .and_then(|v| v.as_str());
            let base_sched = payload
                .get("base_schedule_revision_id")
                .and_then(|v| v.as_str());

            match state.store.accept_adaptation_proposal(
                &principal,
                &curriculum_id,
                &proposal_id,
                expected_sha,
                base_cur,
                base_sched,
            ) {
                Ok(rec) => {
                    state.store.complete_idempotent_command(
                        &principal.account_id,
                        operation_id,
                        key_str,
                        200,
                        rec.payload.clone(),
                    );
                    (StatusCode::OK, Json(rec.payload)).into_response()
                }
                Err(err) => {
                    state.store.complete_idempotent_command(
                        &principal.account_id,
                        operation_id,
                        key_str,
                        err.http_status_code(),
                        json!({"error": {"code": err.error_code(), "message": err.to_string()}}),
                    );
                    error_response(err)
                }
            }
        }
        Err(err) => error_response(err),
    }
}

// =============================================================================
// T08 Handlers: Notification Preferences, Push Subscriptions & Reminder Snooze
// =============================================================================

pub(crate) async fn get_notification_preferences_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let prefs = state.store.get_notification_preferences(&principal);
    let etag = prefs.etag.clone();
    let mut resp = (StatusCode::OK, Json(prefs)).into_response();
    if let Ok(hv) = HeaderValue::from_str(&etag) {
        resp.headers_mut().insert(axum::http::header::ETAG, hv);
    }
    resp
}

pub(crate) async fn put_notification_preferences_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let if_match = extract_header_str(&headers, "if-match");
    let enabled = payload
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let channel = payload
        .get("channel")
        .and_then(|v| v.as_str())
        .unwrap_or("in_app");
    let iana_timezone = payload
        .get("iana_timezone")
        .or_else(|| payload.get("timezone"))
        .and_then(|v| v.as_str())
        .unwrap_or("UTC");
    let local_time_hhmm = payload
        .get("local_time_hhmm")
        .or_else(|| payload.get("reminder_time"))
        .and_then(|v| v.as_str())
        .unwrap_or("19:00");
    let days_of_week: Vec<u8> = payload
        .get("days_of_week")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_u64().map(|n| n as u8))
                .collect()
        })
        .unwrap_or_else(|| vec![1, 2, 3, 4, 5]);
    let quiet_start = payload
        .get("quiet_hours_start_hhmm")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let quiet_end = payload
        .get("quiet_hours_end_hhmm")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    match state.store.update_notification_preferences(
        &principal,
        if_match,
        enabled,
        channel,
        iana_timezone,
        local_time_hhmm,
        days_of_week,
        quiet_start,
        quiet_end,
    ) {
        Ok(updated) => {
            let etag = updated.etag.clone();
            let mut resp = (StatusCode::OK, Json(updated)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

pub(crate) async fn post_push_subscription_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let subscription_id = payload
        .get("subscription_id")
        .and_then(|v| v.as_str())
        .unwrap_or("push-sub-1");
    let endpoint_url = payload
        .get("endpoint_url")
        .or_else(|| payload.get("endpoint"))
        .and_then(|v| v.as_str())
        .unwrap_or("https://fcm.googleapis.com/fcm/send/example-token");
    let p256dh = payload
        .get("p256dh_key")
        .or_else(|| payload.get("p256dh"))
        .and_then(|v| v.as_str())
        .unwrap_or("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM");
    let auth_secret = payload
        .get("auth_secret")
        .or_else(|| payload.get("auth"))
        .and_then(|v| v.as_str())
        .unwrap_or("tBHItJI5svbpez7KI4CCXg");

    match state.store.upsert_push_subscription(
        &principal,
        subscription_id,
        endpoint_url,
        p256dh,
        auth_secret,
    ) {
        Ok(sub) => (StatusCode::CREATED, Json(sub)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn delete_default_push_subscription_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    delete_push_subscription_handler(State(state), headers, Path("default".to_string())).await
}

pub(crate) async fn delete_push_subscription_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(subscription_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .delete_push_subscription(&principal, &subscription_id)
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn snooze_reminder_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(occurrence_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let snooze_minutes = payload
        .get("snooze_minutes")
        .or_else(|| payload.get("duration_minutes"))
        .and_then(|v| v.as_u64())
        .unwrap_or(30) as u32;
    let now_epoch = payload
        .get("now_utc_epoch_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(1_775_156_400);

    match state.store.snooze_reminder_occurrence(
        &principal,
        &occurrence_id,
        snooze_minutes,
        now_epoch,
    ) {
        Ok(rec) => (StatusCode::OK, Json(rec)).into_response(),
        Err(err) => error_response(err),
    }
}
