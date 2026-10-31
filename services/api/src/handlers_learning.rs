//! Learning & adaptation HTTP handlers: assessments, attempts, assistance events, defect reports,
//! key corrections, prerequisite gates, diagnostics, adaptation proposals, notifications, and reminders.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use syllabus_domain::{
    AssistanceLevel, DiagnosticStopReason, LearnerGateDecision, MathDepthPreference,
};
use syllabus_persistence::PersistenceError;
use syllabus_security::AuthenticatedPrincipal;
use serde_json::{json, Value};

use crate::{
    extract_idempotency_key, extract_if_match, json_bool, json_i64, json_str, json_string_map,
    json_string_vec, json_u64, json_with_etag, ApiAppState, ApiResult, AuthPrincipal,
};

const DEFAULT_ASSISTANCE_EVENT_LEVEL: &str = "hint_used";
const DEFAULT_DECLARED_ASSISTANCE_LEVEL: &str = "independent";
const DEFAULT_SESSION_ID: &str = "sess-initial-1";
const DEFAULT_DEFECTIVE_ITEM_ID: &str = "item-tok-1";
const DEFAULT_DEFECT_REASON_CODE: &str = "broken_answer_key";
const DEFAULT_DEFECT_DETAILS: &str = "Reported defective assessment item";
const DEFAULT_KEY_CORRECTION_RATIONALE: &str = "Curator corrected defective answer key";
const DEFAULT_DIAGNOSTIC_ID: &str = "diag-session-1";
const DEFAULT_TOPIC_ID: &str = "rag-python";
const DEFAULT_ADAPTATION_PROPOSAL_ID: &str = "adapt-prop-001";
const DEFAULT_NOTIFICATION_CHANNEL: &str = "in_app";
const DEFAULT_TIMEZONE: &str = "UTC";
const DEFAULT_REMINDER_TIME_HHMM: &str = "19:00";
const DEFAULT_PUSH_SUBSCRIPTION_ID: &str = "push-sub-1";
const DEFAULT_PUSH_ENDPOINT_URL: &str = "https://fcm.googleapis.com/fcm/send/example-token";
const DEFAULT_PUSH_P256DH: &str =
    "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const DEFAULT_PUSH_AUTH_SECRET: &str = "tBHItJI5svbpez7KI4CCXg";
const DEFAULT_SNOOZE_MINUTES: u64 = 30;
const DEFAULT_SNOOZE_NOW_EPOCH_SECONDS: i64 = 1_775_156_400;

// =============================================================================
// T05 Handlers: Assessments, Attempts, Assistance Events, Defect Reports & Key Corrections
// =============================================================================

pub(crate) async fn get_assessment_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(assessment_id): Path<String>,
) -> ApiResult {
    let view = state.store.get_assessment_view(&principal, &assessment_id)?;
    Ok((StatusCode::OK, Json(view)).into_response())
}

pub(crate) async fn record_attempt_assistance_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((assessment_id, attempt_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> ApiResult {
    record_assistance_inner(
        &state,
        &principal,
        &assessment_id,
        Some(attempt_id.as_str()),
        &payload,
    )
}

pub(crate) async fn record_assessment_assistance_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let attempt_id = json_str(&payload, &["attempt_id"]);
    record_assistance_inner(&state, &principal, &assessment_id, attempt_id, &payload)
}

fn record_assistance_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    assessment_id: &str,
    attempt_id: Option<&str>,
    payload: &Value,
) -> ApiResult {
    let level_str =
        json_str(payload, &["assistance_level", "kind"]).unwrap_or(DEFAULT_ASSISTANCE_EVENT_LEVEL);
    let level = AssistanceLevel::from_wire(level_str)?;
    let res = state.store.record_assessment_assistance_event(
        principal,
        assessment_id,
        attempt_id,
        level,
    )?;
    Ok((StatusCode::OK, Json(res)).into_response())
}

pub(crate) async fn submit_assessment_attempt_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let idem_key = extract_idempotency_key(&headers);
    let operation_id = "submitAssessmentAttempt";

    state.execute_optional_idempotent(
        &principal.account_id,
        operation_id,
        idem_key,
        &payload,
        StatusCode::CREATED,
        |key_str| {
            let attempt_id = json_str(&payload, &["attempt_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("att-{assessment_id}-{key_str}"));
            let session_id = json_str(&payload, &["session_id"]).unwrap_or(DEFAULT_SESSION_ID);
            let assistance_str = json_str(&payload, &["assistance_level"])
                .unwrap_or(DEFAULT_DECLARED_ASSISTANCE_LEVEL);
            let declared_assistance = AssistanceLevel::from_wire(assistance_str)
                .map_err(|err| PersistenceError::Validation(err.to_string()))?;
            let responses = json_string_map(&payload, &["responses"]);
            let explicit_score_bp = json_u64(&payload, &["score_bp"])
                .map(|n| u32::try_from(n).unwrap_or(u32::MAX));

            let record = state.store.submit_assessment_attempt(
                &principal,
                &assessment_id,
                &attempt_id,
                session_id,
                declared_assistance,
                responses,
                explicit_score_bp,
            )?;
            let body = serde_json::to_value(&record).unwrap_or(Value::Null);
            Ok((StatusCode::CREATED, body, None))
        },
    )
}

pub(crate) async fn get_assessment_attempt_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(attempt_id): Path<String>,
) -> ApiResult {
    let rec = state.store.get_assessment_attempt(&principal, &attempt_id)?;
    Ok((StatusCode::OK, Json(rec)).into_response())
}

pub(crate) async fn report_defective_item_path_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((assessment_id, item_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> ApiResult {
    report_defective_item_inner(&state, &principal, &assessment_id, &item_id, &payload)
}

pub(crate) async fn report_defective_item_body_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let item_id = json_str(&payload, &["item_id"]).unwrap_or(DEFAULT_DEFECTIVE_ITEM_ID);
    report_defective_item_inner(&state, &principal, &assessment_id, item_id, &payload)
}

fn report_defective_item_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    assessment_id: &str,
    item_id: &str,
    payload: &Value,
) -> ApiResult {
    let reason_code =
        json_str(payload, &["reason_code", "reason"]).unwrap_or(DEFAULT_DEFECT_REASON_CODE);
    let details =
        json_str(payload, &["details", "description"]).unwrap_or(DEFAULT_DEFECT_DETAILS);
    let report = state.store.report_defective_assessment_item(
        principal,
        assessment_id,
        item_id,
        reason_code,
        details,
    )?;
    Ok((StatusCode::CREATED, Json(report)).into_response())
}

pub(crate) async fn apply_key_correction_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(assessment_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let updated_key = json_string_map(&payload, &["updated_answer_key", "answer_key"]);
    let rationale =
        json_str(&payload, &["rationale"]).unwrap_or(DEFAULT_KEY_CORRECTION_RATIONALE);
    let correction = state.store.apply_assessment_key_correction(
        &principal,
        &assessment_id,
        updated_key,
        rationale,
    )?;
    Ok((StatusCode::OK, Json(correction)).into_response())
}

#[must_use]
fn parse_learner_gate_decision(raw: Option<&str>) -> Option<LearnerGateDecision> {
    match raw {
        Some("prerequisite_override_recorded" | "override") => {
            Some(LearnerGateDecision::PrerequisiteOverrideRecorded)
        }
        Some("unverified_prerequisite_acknowledged" | "acknowledge_unverified") => {
            Some(LearnerGateDecision::UnverifiedPrerequisiteAcknowledged)
        }
        _ => None,
    }
}

pub(crate) async fn evaluate_prerequisite_gate_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((syllabus_id, objective_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let prereq_ids = json_string_vec(&payload, "prerequisite_objective_ids");
    let is_mastery_gated = json_bool(&payload, &["is_mastery_gated"]).unwrap_or(true);
    let decision = parse_learner_gate_decision(json_str(&payload, &["learner_decision"]));

    let eval = state.store.evaluate_and_record_prerequisite_gate(
        &principal,
        &syllabus_id,
        &objective_id,
        &prereq_ids,
        is_mastery_gated,
        decision,
    )?;
    Ok((StatusCode::OK, Json(eval)).into_response())
}

// =============================================================================
// T12 Handlers: Objective Diagnostics & Adaptation Proposals
// =============================================================================

pub(crate) async fn start_diagnostic_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let diagnostic_id = json_str(&payload, &["diagnostic_id"]).unwrap_or(DEFAULT_DIAGNOSTIC_ID);
    let syllabus_id = json_str(&payload, &["syllabus_id"]).map(str::to_string);
    let topic_id = json_str(&payload, &["topic_id", "topic"]).unwrap_or(DEFAULT_TOPIC_ID);
    let candidate_objectives = json_string_vec(&payload, "objective_ids");
    let math_depth = json_str(&payload, &["math_depth_preference", "math_depth"])
        .map(MathDepthPreference::from_wire)
        .transpose()?;

    let rec = state.store.start_diagnostic_session(
        &principal,
        diagnostic_id,
        syllabus_id,
        topic_id,
        candidate_objectives,
        math_depth,
    )?;
    Ok((StatusCode::CREATED, Json(rec)).into_response())
}

pub(crate) async fn get_diagnostic_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(diagnostic_id): Path<String>,
) -> ApiResult {
    let rec = state
        .store
        .get_diagnostic_session(&principal, &diagnostic_id)?;
    Ok((StatusCode::OK, Json(rec)).into_response())
}

pub(crate) async fn submit_diagnostic_attempt_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(diagnostic_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let item_id = json_str(&payload, &["item_id"]).unwrap_or("");
    let answer = json_str(&payload, &["answer", "response"]).unwrap_or("");
    let assistance_str =
        json_str(&payload, &["assistance_level"]).unwrap_or(DEFAULT_DECLARED_ASSISTANCE_LEVEL);
    let assistance = AssistanceLevel::from_wire(assistance_str)?;

    let rec = state.store.submit_diagnostic_item_attempt(
        &principal,
        &diagnostic_id,
        item_id,
        answer,
        assistance,
    )?;
    Ok((StatusCode::OK, Json(rec)).into_response())
}

#[must_use]
fn parse_diagnostic_stop_reason(raw: &str) -> DiagnosticStopReason {
    match raw {
        "uncertainty_bound_reached" => DiagnosticStopReason::UncertaintyBoundReached,
        "all_items_answered" => DiagnosticStopReason::AllItemsAnswered,
        _ => DiagnosticStopReason::LearnerStopped,
    }
}

pub(crate) async fn stop_diagnostic_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(diagnostic_id): Path<String>,
    payload: Option<Json<Value>>,
) -> ApiResult {
    let reason = payload
        .as_ref()
        .and_then(|Json(v)| json_str(v, &["stop_reason"]))
        .map(parse_diagnostic_stop_reason);
    let rec = state
        .store
        .stop_diagnostic_session(&principal, &diagnostic_id, reason)?;
    Ok((StatusCode::OK, Json(rec)).into_response())
}

pub(crate) async fn preview_adaptation_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(syllabus_id): Path<String>,
    payload: Option<Json<Value>>,
) -> ApiResult {
    let body = payload.map_or_else(|| json!({}), |Json(v)| v);
    let proposal_id = json_str(&body, &["proposal_id"]).unwrap_or(DEFAULT_ADAPTATION_PROPOSAL_ID);
    let trigger_kind = json_str(&body, &["trigger_kind"]);

    let rec = state.store.create_adaptation_proposal(
        &principal,
        &syllabus_id,
        proposal_id,
        trigger_kind,
    )?;
    Ok((StatusCode::CREATED, Json(rec.payload)).into_response())
}

pub(crate) async fn get_adaptation_proposal_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(proposal_id): Path<String>,
) -> ApiResult {
    let rec = state
        .store
        .get_adaptation_proposal(&principal, &proposal_id)?;
    Ok((StatusCode::OK, Json(rec.payload)).into_response())
}

pub(crate) async fn get_syllabus_adaptation_proposal_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((syllabus_id, proposal_id)): Path<(String, String)>,
) -> ApiResult {
    let rec = state
        .store
        .get_adaptation_proposal(&principal, &proposal_id)?;
    if rec.syllabus_id != syllabus_id {
        return Err(PersistenceError::NotFound {
            resource_type: "adaptation_proposal",
            resource_id: proposal_id,
        }
        .into());
    }
    Ok((StatusCode::OK, Json(rec.payload)).into_response())
}

pub(crate) async fn accept_adaptation_body_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(syllabus_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let proposal_id =
        json_str(&payload, &["proposal_id"]).unwrap_or(DEFAULT_ADAPTATION_PROPOSAL_ID);
    accept_adaptation_inner(
        &state,
        &principal,
        &headers,
        &syllabus_id,
        proposal_id,
        &payload,
    )
}

pub(crate) async fn accept_adaptation_path_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path((syllabus_id, proposal_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> ApiResult {
    accept_adaptation_inner(
        &state,
        &principal,
        &headers,
        &syllabus_id,
        &proposal_id,
        &payload,
    )
}

fn accept_adaptation_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    headers: &HeaderMap,
    syllabus_id: &str,
    proposal_id: &str,
    payload: &Value,
) -> ApiResult {
    let idem_key = extract_idempotency_key(headers);
    let operation_id = "acceptAdaptation";

    state.execute_idempotent(
        &principal.account_id,
        operation_id,
        idem_key,
        payload,
        StatusCode::OK,
        |_key_str| {
            let expected_sha =
                json_str(payload, &["expected_proposal_sha256", "proposal_sha256"]).unwrap_or("");
            let base_cur = json_str(payload, &["base_syllabus_revision_id"]);
            let base_sched = json_str(payload, &["base_schedule_revision_id"]);

            let rec = state.store.accept_adaptation_proposal(
                principal,
                syllabus_id,
                proposal_id,
                expected_sha,
                base_cur,
                base_sched,
            )?;
            Ok((StatusCode::OK, rec.payload, None))
        },
    )
}

// =============================================================================
// T08 Handlers: Notification Preferences, Push Subscriptions & Reminder Snooze
// =============================================================================

pub(crate) async fn get_notification_preferences_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let prefs = state.store.get_notification_preferences(&principal);
    Ok(json_with_etag(StatusCode::OK, &prefs.etag, &prefs))
}

pub(crate) async fn put_notification_preferences_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    let enabled = json_bool(&payload, &["enabled"]).unwrap_or(false);
    let channel = json_str(&payload, &["channel"]).unwrap_or(DEFAULT_NOTIFICATION_CHANNEL);
    let iana_timezone =
        json_str(&payload, &["iana_timezone", "timezone"]).unwrap_or(DEFAULT_TIMEZONE);
    let local_time_hhmm = json_str(&payload, &["local_time_hhmm", "reminder_time"])
        .unwrap_or(DEFAULT_REMINDER_TIME_HHMM);
    let days_of_week: Vec<u8> = payload
        .get("days_of_week")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_u64().and_then(|n| u8::try_from(n).ok()))
                .collect()
        })
        .unwrap_or_else(|| vec![1, 2, 3, 4, 5]);
    let quiet_start = json_str(&payload, &["quiet_hours_start_hhmm"]).map(str::to_string);
    let quiet_end = json_str(&payload, &["quiet_hours_end_hhmm"]).map(str::to_string);

    let updated = state.store.update_notification_preferences(
        &principal,
        if_match,
        enabled,
        channel,
        iana_timezone,
        local_time_hhmm,
        days_of_week,
        quiet_start,
        quiet_end,
    )?;
    Ok(json_with_etag(StatusCode::OK, &updated.etag, &updated))
}

pub(crate) async fn post_push_subscription_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let subscription_id =
        json_str(&payload, &["subscription_id"]).unwrap_or(DEFAULT_PUSH_SUBSCRIPTION_ID);
    let endpoint_url =
        json_str(&payload, &["endpoint_url", "endpoint"]).unwrap_or(DEFAULT_PUSH_ENDPOINT_URL);
    let p256dh = json_str(&payload, &["p256dh_key", "p256dh"]).unwrap_or(DEFAULT_PUSH_P256DH);
    let auth_secret =
        json_str(&payload, &["auth_secret", "auth"]).unwrap_or(DEFAULT_PUSH_AUTH_SECRET);

    let sub = state.store.upsert_push_subscription(
        &principal,
        subscription_id,
        endpoint_url,
        p256dh,
        auth_secret,
    )?;
    Ok((StatusCode::CREATED, Json(sub)).into_response())
}

pub(crate) async fn delete_default_push_subscription_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    state
        .store
        .delete_push_subscription(&principal, "default")?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub(crate) async fn delete_push_subscription_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(subscription_id): Path<String>,
) -> ApiResult {
    state
        .store
        .delete_push_subscription(&principal, &subscription_id)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub(crate) async fn snooze_reminder_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(occurrence_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let snooze_minutes_u64 =
        json_u64(&payload, &["snooze_minutes", "duration_minutes"]).unwrap_or(DEFAULT_SNOOZE_MINUTES);
    let snooze_minutes = u32::try_from(snooze_minutes_u64).unwrap_or(u32::MAX);
    let now_epoch = json_i64(&payload, &["now_utc_epoch_seconds"])
        .unwrap_or(DEFAULT_SNOOZE_NOW_EPOCH_SECONDS);

    let rec = state.store.snooze_reminder_occurrence(
        &principal,
        &occurrence_id,
        snooze_minutes,
        now_epoch,
    )?;
    Ok((StatusCode::OK, Json(rec)).into_response())
}
