//! HTTP API service router (`T00`–`T04` identity, tenant isolation, HTTP concurrency, outbox wiring,
//! reviewed catalog filtering/reviews, goal intake, deterministic generation, and curriculum overview/activation).

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use curriculum_application::build_readiness_report;
use curriculum_jobs::{OutboxJobQueue, OutboxQueueConfig};
use curriculum_persistence::{InMemoryTransactionalStore, PersistenceError};
use curriculum_security::{
    AppEnvironment, AuthVerifier, AuthenticatedPrincipal, DevFixedIdentityAuthVerifier,
    ReleaseFeatureGates,
};
use serde_json::json;
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
    let v1_routes = build_v1_routes();
    Router::new()
        .route(
            "/healthz",
            get(move || async move { Json(build_readiness_report(readiness_gates)) }),
        )
        .merge(v1_routes.clone())
        .nest("/api", v1_routes)
        .with_state(state)
}

pub(crate) fn build_v1_routes() -> Router<ApiAppState> {
    Router::new()
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
        // Credential routes (`T07A`, `T07C`, `@S28`, `@S29`, `@S36`, `@S64`, `@S66`, `@S67`)
        .route("/v1/me/credentials", post(create_credential_handler))
        .route("/v1/me/credentials", get(list_credentials_handler))
        .route("/v1/credentials", post(create_credential_handler))
        .route("/v1/credentials", get(list_credentials_handler))
        .route(
            "/v1/me/credentials/{credential_ref}",
            get(get_credential_metadata_handler),
        )
        .route(
            "/v1/me/credentials/{credential_ref}",
            patch(rotate_credential_handler),
        )
        .route(
            "/v1/me/credentials/{credential_ref}/rotate",
            post(rotate_credential_handler),
        )
        .route(
            "/v1/me/credentials/{credential_ref}",
            delete(revoke_credential_handler),
        )
        .route("/v1/me/usage", get(get_my_usage_handler))
        // T07B & T07D: Hosted wallet, usage quotes, credit reservations, settlements, ledger, checkout & webhooks
        .route("/v1/me/wallet", get(get_hosted_wallet_handler))
        .route("/v1/me/billing/wallet", get(get_hosted_wallet_handler))
        .route("/v1/usage-quotes", post(create_usage_quote_handler))
        .route("/v1/generation-quotes", post(create_usage_quote_handler))
        .route("/v1/reservations", post(create_credit_reservation_handler))
        .route(
            "/v1/usage/reservations",
            post(create_credit_reservation_handler),
        )
        .route(
            "/v1/reservations/{reservation_id}/settle",
            post(settle_credit_reservation_handler),
        )
        .route(
            "/v1/usage/reservations/{reservation_id}/settle",
            post(settle_credit_reservation_handler),
        )
        .route(
            "/v1/reservations/{reservation_id}/release",
            post(release_credit_reservation_handler),
        )
        .route(
            "/v1/usage/reservations/{reservation_id}/release",
            post(release_credit_reservation_handler),
        )
        .route(
            "/v1/reservations/{reservation_id}/reconcile-timeout",
            post(reconcile_ambiguous_timeout_handler),
        )
        .route("/v1/me/ledger", get(get_my_ledger_handler))
        .route(
            "/v1/billing/checkout-sessions",
            post(create_checkout_session_handler),
        )
        .route(
            "/v1/me/billing/checkout-sessions",
            post(create_checkout_session_handler),
        )
        .route(
            "/v1/billing/webhooks",
            post(process_payment_webhook_handler),
        )
        .route(
            "/v1/webhooks/billing",
            post(process_payment_webhook_handler),
        )
        // T05: Reviewed anchor assessments, attempts, assistance events, defect reports & key corrections
        .route(
            "/v1/assessments/{assessment_id}",
            get(get_assessment_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/attempts",
            post(submit_assessment_attempt_handler),
        )
        .route(
            "/v1/assessment-attempts/{attempt_id}",
            get(get_assessment_attempt_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/attempts/{attempt_id}/assistance",
            post(record_attempt_assistance_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/assistance-events",
            post(record_assessment_assistance_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/items/{item_id}/report-defect",
            post(report_defective_item_path_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/reports",
            post(report_defective_item_body_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/key-corrections",
            post(apply_key_correction_handler),
        )
        .route(
            "/v1/admin/assessments/{assessment_id}/key-corrections",
            post(apply_key_correction_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/objectives/{objective_id}/prerequisite-gate",
            post(evaluate_prerequisite_gate_handler),
        )
        // T12: Objective diagnostics, waivers & adaptation proposals
        .route("/v1/diagnostics", post(start_diagnostic_handler))
        .route("/v1/diagnostic-sessions", post(start_diagnostic_handler))
        .route(
            "/v1/diagnostics/{diagnostic_id}",
            get(get_diagnostic_handler),
        )
        .route(
            "/v1/diagnostic-sessions/{diagnostic_id}",
            get(get_diagnostic_handler),
        )
        .route(
            "/v1/diagnostics/{diagnostic_id}/attempts",
            post(submit_diagnostic_attempt_handler),
        )
        .route(
            "/v1/diagnostic-sessions/{diagnostic_id}/attempts",
            post(submit_diagnostic_attempt_handler),
        )
        .route(
            "/v1/diagnostics/{diagnostic_id}/stop",
            post(stop_diagnostic_handler),
        )
        .route(
            "/v1/diagnostic-sessions/{diagnostic_id}/stop",
            post(stop_diagnostic_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/adaptations/preview",
            post(preview_adaptation_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/adaptation-proposals",
            post(preview_adaptation_handler),
        )
        .route(
            "/v1/adaptation-proposals/{proposal_id}",
            get(get_adaptation_proposal_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/adaptation-proposals/{proposal_id}",
            get(get_curriculum_adaptation_proposal_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/adaptations/accept",
            post(accept_adaptation_body_handler),
        )
        .route(
            "/v1/curricula/{curriculum_id}/adaptation-proposals/{proposal_id}/accept",
            post(accept_adaptation_path_handler),
        )
        // T08: Notification preferences, push subscriptions & reminder snooze
        .route(
            "/v1/me/notification-preferences",
            get(get_notification_preferences_handler),
        )
        .route(
            "/v1/me/notification-preferences",
            put(put_notification_preferences_handler),
        )
        .route(
            "/v1/me/push-subscriptions",
            post(post_push_subscription_handler),
        )
        .route(
            "/v1/me/push-subscriptions",
            delete(delete_default_push_subscription_handler),
        )
        .route(
            "/v1/me/push-subscriptions/{subscription_id}",
            delete(delete_push_subscription_handler),
        )
        .route(
            "/v1/me/reminders/{occurrence_id}/snooze",
            post(snooze_reminder_handler),
        )
        // T09 & T11: Account export, deletion requests, and external completion import
        .route("/v1/me/exports", post(create_export_job_handler))
        .route(
            "/v1/me/deletion-requests",
            post(request_account_deletion_handler),
        )
        .route("/v1/me", delete(request_account_deletion_handler))
        .route(
            "/v1/me/integrations/completions",
            post(import_external_completion_handler),
        )
        // T13: Public templates, preview sanitization, discovery, upvotes, moderation & partial adoption
        .route(
            "/v1/curricula/{curriculum_id}/publications/preview",
            post(preview_curriculum_publication_handler),
        )
        .route(
            "/v1/publication-previews",
            post(preview_body_publication_handler),
        )
        .route("/v1/publications", post(publish_curriculum_handler))
        .route("/v1/publications", get(discover_publications_handler))
        .route(
            "/v1/publications/{publication_id}",
            get(get_public_publication_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}",
            get(get_public_publication_revision_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions",
            post(publish_publication_revision_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}/revisions",
            post(publish_publication_revision_handler),
        )
        .route("/v1/me/publications", get(list_owned_publications_handler))
        .route(
            "/v1/me/publications/{publication_id}",
            get(get_owned_publication_management_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}/revisions",
            get(list_owned_publication_revisions_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}/unpublish",
            post(unpublish_publication_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}",
            delete(unpublish_publication_handler),
        )
        .route(
            "/v1/publications/{publication_id}/reports",
            post(report_publication_handler),
        )
        .route(
            "/v1/moderation/reports",
            get(list_moderation_reports_handler),
        )
        .route(
            "/v1/admin/moderation/reports",
            get(list_moderation_reports_handler),
        )
        .route(
            "/v1/moderation/publications/{publication_id}",
            post(moderate_publication_handler),
        )
        .route(
            "/v1/admin/publications/{publication_id}/moderation",
            post(moderate_publication_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
            get(get_my_publication_vote_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
            put(put_my_publication_vote_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
            delete(delete_my_publication_vote_handler),
        )
        .route(
            "/v1/publications/{publication_id}/adopt",
            post(adopt_publication_body_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/adoptions",
            post(adopt_publication_revision_handler),
        )
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
}

pub(crate) fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .and_then(|s| s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")))
        .map(str::trim)
}

pub(crate) fn extract_header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
}

pub(crate) fn authenticate_request(
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

pub(crate) fn error_response(err: PersistenceError) -> Response {
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

pub mod handlers_commerce;
pub mod handlers_core;
pub mod handlers_learning;

pub use handlers_commerce::*;
pub use handlers_core::*;
pub(crate) use handlers_learning::*;

#[cfg(test)]
mod tests;
