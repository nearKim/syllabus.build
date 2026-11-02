//! HTTP API service router (`T00`–`T04` identity, tenant isolation, HTTP concurrency, outbox wiring,
//! reviewed catalog filtering/reviews, goal intake, deterministic generation, and syllabus overview/activation).

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{json, Value};
use syllabus_application::build_readiness_report;
use syllabus_domain::DomainError;
use syllabus_jobs::{OutboxJobQueue, OutboxQueueConfig};
use syllabus_persistence::{
    IdempotencyBeginOutcome, InMemoryTransactionalStore, PersistenceError, StoredIdempotentResponse,
};
use syllabus_security::{
    constant_time_eq, AuthVerifier, AuthenticatedPrincipal, ReleaseFeatureGates, SecurityError,
};
#[cfg(test)]
use syllabus_security::{AppEnvironment, DevFixedIdentityAuthVerifier};

pub(crate) mod handlers_account;
pub(crate) mod handlers_auth;
pub(crate) mod handlers_catalog;
pub(crate) mod handlers_commerce;
pub(crate) mod handlers_learning;
pub(crate) mod handlers_syllabus;

#[cfg(test)]
pub(crate) const DEFAULT_DEV_ACCOUNT_ID: &str = "00000000-0000-4000-8000-000000000001";
pub(crate) const DEFAULT_SYLLABUS_ID: &str = "cur-learner-a-1";
pub(crate) const HEADER_IDEMPOTENCY_KEY: &str = "idempotency-key";
pub(crate) const HEADER_IDEMPOTENCY_REPLAYED: &str = "Idempotency-Replayed";
pub(crate) const DEFAULT_NOW_EPOCH_MS: u64 = 10_000;
pub(crate) const DEFAULT_IDEMPOTENCY_TTL_MS: u64 = 86_400_000;

pub(crate) fn current_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(DEFAULT_NOW_EPOCH_MS)
}

struct FailClosedAuthVerifier;

fn valid_32_byte_hex_secret(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl AuthVerifier for FailClosedAuthVerifier {
    fn verify_bearer_token(
        &self,
        _bearer_token: Option<&str>,
    ) -> Result<AuthenticatedPrincipal, SecurityError> {
        Err(SecurityError::Unauthenticated)
    }
}

/// Shared application state injected into Axum route handlers.
#[derive(Clone)]
pub struct ApiAppState {
    pub gates: ReleaseFeatureGates,
    pub store: InMemoryTransactionalStore,
    pub outbox: OutboxJobQueue,
    pub auth_verifier: Arc<dyn AuthVerifier>,
    pub(crate) auth_exchange_secret: Option<String>,
}

impl ApiAppState {
    /// Creates a new `ApiAppState` seeded with development fixtures and outbox configuration.
    #[must_use]
    pub fn new(gates: ReleaseFeatureGates) -> Self {
        Self::with_store(gates, InMemoryTransactionalStore::new_with_dev_fixtures())
    }

    /// Creates a new `ApiAppState` bound to the provided transactional store.
    #[must_use]
    pub fn with_store(gates: ReleaseFeatureGates, store: InMemoryTransactionalStore) -> Self {
        #[cfg(test)]
        let auth_verifier: Arc<dyn AuthVerifier> = if gates.env.is_local_dev_or_test() {
            Arc::new(
                DevFixedIdentityAuthVerifier::new(AppEnvironment::Test, DEFAULT_DEV_ACCOUNT_ID)
                    .expect("test identity verifier initializes in Test"),
            )
        } else {
            Arc::new(FailClosedAuthVerifier)
        };
        #[cfg(not(test))]
        let auth_verifier: Arc<dyn AuthVerifier> = Arc::new(FailClosedAuthVerifier);
        Self {
            gates,
            store,
            outbox: OutboxJobQueue::new(OutboxQueueConfig::default()),
            auth_verifier,
            auth_exchange_secret: std::env::var("AUTH_EXCHANGE_SECRET")
                .ok()
                .filter(|value| valid_32_byte_hex_secret(value)),
        }
    }

    /// Creates an `ApiAppState` backed by PostgreSQL when `DATABASE_URL` is configured.
    /// Development and test may use an in-memory store when it is absent.
    pub fn new_from_env(gates: ReleaseFeatureGates) -> Result<Self, PersistenceError> {
        if !std::env::var("AUTH_EXCHANGE_SECRET")
            .ok()
            .as_deref()
            .is_some_and(valid_32_byte_hex_secret)
        {
            return Err(PersistenceError::Validation(
                "AUTH_EXCHANGE_SECRET must be 32 random bytes encoded as 64 hex characters"
                    .to_string(),
            ));
        }
        if !std::env::var("BILLING_WEBHOOK_SECRET")
            .ok()
            .as_deref()
            .is_some_and(valid_32_byte_hex_secret)
        {
            return Err(PersistenceError::Validation(
                "BILLING_WEBHOOK_SECRET must be 32 random bytes encoded as 64 hex characters"
                    .to_string(),
            ));
        }
        let store = InMemoryTransactionalStore::open_from_env()?;
        Ok(Self::with_store(gates, store))
    }

    /// Authenticates an incoming HTTP request using session token resolution or the configured `AuthVerifier`.
    pub(crate) fn authenticate(
        &self,
        headers: &HeaderMap,
    ) -> Result<AuthenticatedPrincipal, PersistenceError> {
        authenticate_request(self, headers)
    }

    pub(crate) fn require_auth_exchange(
        &self,
        headers: &HeaderMap,
    ) -> Result<(), PersistenceError> {
        let valid = self.auth_exchange_secret.as_deref().is_some_and(|secret| {
            headers
                .get("x-auth-exchange-secret")
                .is_some_and(|provided| constant_time_eq(provided.as_bytes(), secret.as_bytes()))
        });
        if valid {
            Ok(())
        } else {
            Err(PersistenceError::Security(SecurityError::Unauthenticated))
        }
    }

    /// Executes a mandatory idempotent HTTP command, ensuring that any `Acquired` lock is
    /// deterministically completed on both success and early validation/store errors (`[P0-1]`).
    pub(crate) fn execute_idempotent<F>(
        &self,
        account_id: &str,
        operation_id: &str,
        idempotency_key: Option<&str>,
        payload: &Value,
        default_replay_status: StatusCode,
        f: F,
    ) -> ApiResult
    where
        F: FnOnce(&str) -> Result<(StatusCode, Value, Option<String>), PersistenceError>,
    {
        match self.store.begin_idempotent_command(
            account_id,
            operation_id,
            idempotency_key,
            payload,
            DEFAULT_NOW_EPOCH_MS,
            DEFAULT_IDEMPOTENCY_TTL_MS,
        )? {
            IdempotencyBeginOutcome::Replayed(stored) => {
                Ok(idempotent_replay_response(stored, default_replay_status))
            }
            IdempotencyBeginOutcome::Acquired => {
                let key_str = idempotency_key.unwrap_or_default();
                match f(key_str) {
                    Ok((status, body, etag)) => Ok(self.complete_idempotent_json(
                        account_id,
                        operation_id,
                        key_str,
                        status,
                        body,
                        etag.as_deref(),
                    )),
                    Err(err) => {
                        Ok(self.complete_idempotent_error(account_id, operation_id, key_str, err))
                    }
                }
            }
        }
    }

    /// Executes an optionally-idempotent HTTP command (`Idempotency-Key` enforced only when header is present),
    /// ensuring an acquired lock is never leaked on validation or persistence failure (`[P0-1]`).
    pub(crate) fn execute_optional_idempotent<F>(
        &self,
        account_id: &str,
        operation_id: &str,
        idempotency_key: Option<&str>,
        payload: &Value,
        default_replay_status: StatusCode,
        f: F,
    ) -> ApiResult
    where
        F: FnOnce(&str) -> Result<(StatusCode, Value, Option<String>), PersistenceError>,
    {
        if idempotency_key.is_some() {
            return self.execute_idempotent(
                account_id,
                operation_id,
                idempotency_key,
                payload,
                default_replay_status,
                f,
            );
        }
        let (status, body, etag) = f("default")?;
        if let Some(tag) = etag {
            Ok(json_with_etag(status, &tag, &body))
        } else {
            Ok((status, Json(body)).into_response())
        }
    }

    /// Records a successful idempotent HTTP response and builds the outgoing Axum `Response`.
    #[must_use]
    pub(crate) fn complete_idempotent_json(
        &self,
        account_id: &str,
        operation_id: &str,
        idempotency_key: &str,
        status: StatusCode,
        body: Value,
        etag: Option<&str>,
    ) -> Response {
        self.store.complete_idempotent_command(
            account_id,
            operation_id,
            idempotency_key,
            status.as_u16(),
            body.clone(),
        );
        let mut resp = (status, Json(body)).into_response();
        if let Some(hv) = etag.and_then(|tag| HeaderValue::from_str(tag).ok()) {
            resp.headers_mut().insert(header::ETAG, hv);
        }
        resp
    }

    /// Records a failed idempotent HTTP response and builds the outgoing error `Response`.
    #[must_use]
    pub(crate) fn complete_idempotent_error(
        &self,
        account_id: &str,
        operation_id: &str,
        idempotency_key: &str,
        err: PersistenceError,
    ) -> Response {
        self.store.complete_idempotent_command(
            account_id,
            operation_id,
            idempotency_key,
            err.http_status_code(),
            error_body(&err),
        );
        error_response(err)
    }
}

/// Unified HTTP API error wrapper converting persistence, security, and domain errors into HTTP responses.
#[derive(Debug)]
pub(crate) struct ApiError(pub(crate) PersistenceError);

pub(crate) type ApiResult = Result<Response, ApiError>;

impl From<PersistenceError> for ApiError {
    fn from(err: PersistenceError) -> Self {
        Self(err)
    }
}

impl From<SecurityError> for ApiError {
    fn from(err: SecurityError) -> Self {
        Self(PersistenceError::Security(err))
    }
}

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        Self(PersistenceError::Validation(err.to_string()))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        error_response(self.0)
    }
}

/// Axum request-parts extractor that authenticates the caller into an `AuthenticatedPrincipal`.
#[derive(Debug, Clone)]
pub(crate) struct AuthPrincipal(pub(crate) AuthenticatedPrincipal);

impl FromRequestParts<ApiAppState> for AuthPrincipal {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &ApiAppState,
    ) -> Result<Self, Self::Rejection> {
        let principal = state.authenticate(&parts.headers)?;
        Ok(Self(principal))
    }
}

/// Builds the HTTP API router with a freshly initialized `ApiAppState`.
pub fn build_router(gates: ReleaseFeatureGates) -> Router {
    build_router_with_state(ApiAppState::new(gates))
}

/// Builds the HTTP API router using `ApiAppState::new_from_env` (connecting to PostgreSQL when
/// `DATABASE_URL` is set and loading `catalog/resources/**/*.json`).
pub fn build_router_from_env(
    gates: ReleaseFeatureGates,
) -> Result<(Router, bool), PersistenceError> {
    let state = ApiAppState::new_from_env(gates)?;
    let is_pg = state.store.is_postgres_backed();
    Ok((build_router_with_state(state), is_pg))
}

/// Builds the HTTP API router bound to the provided `ApiAppState`.
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
        .merge(auth_and_core_routes())
        .merge(credential_and_commerce_routes())
        .merge(assessment_and_adaptation_routes())
        .merge(notification_and_lifecycle_routes())
        .merge(publication_and_moderation_routes())
        .merge(catalog_generation_and_syllabus_routes())
}

fn auth_and_core_routes() -> Router<ApiAppState> {
    Router::new()
        // OAuth 2.0 and authenticated session routes
        .route(
            "/v1/auth/providers",
            get(handlers_auth::list_auth_providers_handler),
        )
        .route(
            "/v1/auth/oauth/{provider}/authorize",
            get(handlers_auth::oauth_authorize_url_handler),
        )
        .route(
            "/v1/auth/oauth/{provider}/callback",
            post(handlers_auth::oauth_callback_exchange_handler),
        )
        .route(
            "/v1/auth/session",
            get(handlers_auth::get_auth_session_handler)
                .delete(handlers_auth::delete_auth_session_handler),
        )
        .route(
            "/v1/auth/sessions/current",
            get(handlers_auth::get_auth_session_handler),
        )
        .route(
            "/v1/auth/sessions/current",
            delete(handlers_auth::delete_auth_session_handler),
        )
        // Email verification, WebAuthn passkeys, and durable web workspace routes
        .route(
            "/v1/auth/email-verification/request",
            post(handlers_auth::request_email_verification_handler),
        )
        .route(
            "/v1/auth/email-verification/confirm",
            post(handlers_auth::confirm_email_verification_handler),
        )
        .route(
            "/v1/auth/passkeys/session",
            post(handlers_auth::create_passkey_session_handler),
        )
        .route(
            "/v1/auth/passkeys/{credential_id}",
            get(handlers_auth::get_passkey_for_auth_handler),
        )
        .route(
            "/v1/me/workspace",
            get(handlers_account::get_my_workspace_handler)
                .put(handlers_account::put_my_workspace_handler)
                .delete(handlers_account::delete_my_workspace_handler),
        )
        .route(
            "/v1/me/profile",
            patch(handlers_account::patch_my_profile_handler),
        )
        .route(
            "/v1/me/passkeys",
            get(handlers_account::list_my_passkeys_handler),
        )
        .route(
            "/v1/me/passkeys/{credential_id}",
            put(handlers_account::put_my_passkey_handler)
                .delete(handlers_account::delete_my_passkey_handler),
        )
        // Protected learner proficiency & progress event routes
        .route(
            "/v1/me/proficiency",
            get(handlers_syllabus::get_my_proficiency_handler),
        )
        .route(
            "/v1/progress-events",
            post(handlers_syllabus::post_progress_event_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/progress-events",
            post(handlers_syllabus::post_syllabus_progress_event_handler),
        )
        // Schedule routes with If-Match optimistic concurrency
        .route(
            "/v1/schedules/{syllabus_id}",
            get(handlers_syllabus::get_schedule_handler),
        )
        .route(
            "/v1/schedules/{syllabus_id}",
            patch(handlers_syllabus::patch_schedule_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/schedule",
            get(handlers_syllabus::get_schedule_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/schedule",
            patch(handlers_syllabus::patch_schedule_handler),
        )
}

fn credential_and_commerce_routes() -> Router<ApiAppState> {
    Router::new()
        // Credential routes (`T07A`, `T07C`, `@S28`, `@S29`, `@S36`, `@S64`, `@S66`, `@S67`)
        .route(
            "/v1/me/credentials",
            post(handlers_account::create_credential_handler),
        )
        .route(
            "/v1/me/credentials",
            get(handlers_account::list_credentials_handler),
        )
        .route(
            "/v1/credentials",
            post(handlers_account::create_credential_handler),
        )
        .route(
            "/v1/credentials",
            get(handlers_account::list_credentials_handler),
        )
        .route(
            "/v1/me/credentials/{credential_ref}",
            get(handlers_account::get_credential_metadata_handler),
        )
        .route(
            "/v1/me/credentials/{credential_ref}",
            patch(handlers_account::rotate_credential_handler),
        )
        .route(
            "/v1/me/credentials/{credential_ref}/rotate",
            post(handlers_account::rotate_credential_handler),
        )
        .route(
            "/v1/me/credentials/{credential_ref}",
            delete(handlers_account::revoke_credential_handler),
        )
        .route("/v1/me/usage", get(handlers_account::get_my_usage_handler))
        // T07B & T07D: Hosted wallet, usage quotes, credit reservations, settlements, ledger, checkout & webhooks
        .route(
            "/v1/me/wallet",
            get(handlers_commerce::get_hosted_wallet_handler),
        )
        .route(
            "/v1/me/billing/wallet",
            get(handlers_commerce::get_hosted_wallet_handler),
        )
        .route(
            "/v1/usage-quotes",
            post(handlers_commerce::create_usage_quote_handler),
        )
        .route(
            "/v1/generation-quotes",
            post(handlers_commerce::create_usage_quote_handler),
        )
        .route(
            "/v1/reservations",
            post(handlers_commerce::create_credit_reservation_handler),
        )
        .route(
            "/v1/usage/reservations",
            post(handlers_commerce::create_credit_reservation_handler),
        )
        .route(
            "/v1/reservations/{reservation_id}/settle",
            post(handlers_commerce::settle_credit_reservation_handler),
        )
        .route(
            "/v1/usage/reservations/{reservation_id}/settle",
            post(handlers_commerce::settle_credit_reservation_handler),
        )
        .route(
            "/v1/reservations/{reservation_id}/release",
            post(handlers_commerce::release_credit_reservation_handler),
        )
        .route(
            "/v1/usage/reservations/{reservation_id}/release",
            post(handlers_commerce::release_credit_reservation_handler),
        )
        .route(
            "/v1/reservations/{reservation_id}/reconcile-timeout",
            post(handlers_commerce::reconcile_ambiguous_timeout_handler),
        )
        .route(
            "/v1/me/ledger",
            get(handlers_commerce::get_my_ledger_handler),
        )
        .route(
            "/v1/billing/checkout-sessions",
            post(handlers_commerce::create_checkout_session_handler),
        )
        .route(
            "/v1/me/billing/checkout-sessions",
            post(handlers_commerce::create_checkout_session_handler),
        )
        .route(
            "/v1/billing/webhooks",
            post(handlers_commerce::process_payment_webhook_handler),
        )
        .route(
            "/v1/webhooks/billing",
            post(handlers_commerce::process_payment_webhook_handler),
        )
}

fn assessment_and_adaptation_routes() -> Router<ApiAppState> {
    Router::new()
        // T05: Reviewed anchor assessments, attempts, assistance events, defect reports & key corrections
        .route(
            "/v1/assessments/{assessment_id}",
            get(handlers_learning::get_assessment_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/attempts",
            post(handlers_learning::submit_assessment_attempt_handler),
        )
        .route(
            "/v1/assessment-attempts/{attempt_id}",
            get(handlers_learning::get_assessment_attempt_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/attempts/{attempt_id}/assistance",
            post(handlers_learning::record_attempt_assistance_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/assistance-events",
            post(handlers_learning::record_assessment_assistance_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/items/{item_id}/report-defect",
            post(handlers_learning::report_defective_item_path_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/reports",
            post(handlers_learning::report_defective_item_body_handler),
        )
        .route(
            "/v1/assessments/{assessment_id}/key-corrections",
            post(handlers_learning::apply_key_correction_handler),
        )
        .route(
            "/v1/admin/assessments/{assessment_id}/key-corrections",
            post(handlers_learning::apply_key_correction_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/objectives/{objective_id}/prerequisite-gate",
            post(handlers_learning::evaluate_prerequisite_gate_handler),
        )
        // T12: Objective diagnostics, waivers & adaptation proposals
        .route(
            "/v1/diagnostics",
            post(handlers_learning::start_diagnostic_handler),
        )
        .route(
            "/v1/diagnostic-sessions",
            post(handlers_learning::start_diagnostic_handler),
        )
        .route(
            "/v1/diagnostics/{diagnostic_id}",
            get(handlers_learning::get_diagnostic_handler),
        )
        .route(
            "/v1/diagnostic-sessions/{diagnostic_id}",
            get(handlers_learning::get_diagnostic_handler),
        )
        .route(
            "/v1/diagnostics/{diagnostic_id}/attempts",
            post(handlers_learning::submit_diagnostic_attempt_handler),
        )
        .route(
            "/v1/diagnostic-sessions/{diagnostic_id}/attempts",
            post(handlers_learning::submit_diagnostic_attempt_handler),
        )
        .route(
            "/v1/diagnostics/{diagnostic_id}/stop",
            post(handlers_learning::stop_diagnostic_handler),
        )
        .route(
            "/v1/diagnostic-sessions/{diagnostic_id}/stop",
            post(handlers_learning::stop_diagnostic_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/adaptations/preview",
            post(handlers_learning::preview_adaptation_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/adaptation-proposals",
            post(handlers_learning::preview_adaptation_handler),
        )
        .route(
            "/v1/adaptation-proposals/{proposal_id}",
            get(handlers_learning::get_adaptation_proposal_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/adaptation-proposals/{proposal_id}",
            get(handlers_learning::get_syllabus_adaptation_proposal_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/adaptations/accept",
            post(handlers_learning::accept_adaptation_body_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/adaptation-proposals/{proposal_id}/accept",
            post(handlers_learning::accept_adaptation_path_handler),
        )
}

fn notification_and_lifecycle_routes() -> Router<ApiAppState> {
    Router::new()
        // T08: Notification preferences, push subscriptions & reminder snooze
        .route(
            "/v1/me/notification-preferences",
            get(handlers_learning::get_notification_preferences_handler),
        )
        .route(
            "/v1/me/notification-preferences",
            put(handlers_learning::put_notification_preferences_handler),
        )
        .route(
            "/v1/me/push-subscriptions",
            post(handlers_learning::post_push_subscription_handler),
        )
        .route(
            "/v1/me/push-subscriptions",
            delete(handlers_learning::delete_default_push_subscription_handler),
        )
        .route(
            "/v1/me/push-subscriptions/{subscription_id}",
            delete(handlers_learning::delete_push_subscription_handler),
        )
        .route(
            "/v1/me/reminders/{occurrence_id}/snooze",
            post(handlers_learning::snooze_reminder_handler),
        )
        // T09 & T11: Account export, deletion requests, and external completion import
        .route(
            "/v1/me/exports",
            post(handlers_account::create_export_job_handler),
        )
        .route(
            "/v1/me/deletion-requests",
            post(handlers_commerce::request_account_deletion_handler),
        )
        .route(
            "/v1/me",
            delete(handlers_commerce::request_account_deletion_handler),
        )
        .route(
            "/v1/me/integrations/completions",
            post(handlers_commerce::import_external_completion_handler),
        )
}

fn publication_and_moderation_routes() -> Router<ApiAppState> {
    Router::new()
        // T13: Public templates, preview sanitization, discovery, upvotes, moderation & partial adoption
        .route(
            "/v1/syllabi/{syllabus_id}/publications/preview",
            post(handlers_commerce::preview_syllabus_publication_handler),
        )
        .route(
            "/v1/publication-previews",
            post(handlers_commerce::preview_body_publication_handler),
        )
        .route(
            "/v1/publications",
            post(handlers_commerce::publish_syllabus_handler),
        )
        .route(
            "/v1/publications",
            get(handlers_commerce::discover_publications_handler),
        )
        .route(
            "/v1/publications/{publication_id}",
            get(handlers_commerce::get_public_publication_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}",
            get(handlers_commerce::get_public_publication_revision_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions",
            post(handlers_commerce::publish_publication_revision_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}/revisions",
            post(handlers_commerce::publish_publication_revision_handler),
        )
        .route(
            "/v1/me/publications",
            get(handlers_commerce::list_owned_publications_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}",
            get(handlers_commerce::get_owned_publication_management_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}/revisions",
            get(handlers_commerce::list_owned_publication_revisions_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}/unpublish",
            post(handlers_commerce::unpublish_publication_handler),
        )
        .route(
            "/v1/me/publications/{publication_id}",
            delete(handlers_commerce::unpublish_publication_handler),
        )
        .route(
            "/v1/publications/{publication_id}/reports",
            post(handlers_commerce::report_publication_handler),
        )
        .route(
            "/v1/moderation/reports",
            get(handlers_commerce::list_moderation_reports_handler),
        )
        .route(
            "/v1/admin/moderation/reports",
            get(handlers_commerce::list_moderation_reports_handler),
        )
        .route(
            "/v1/moderation/publications/{publication_id}",
            post(handlers_commerce::moderate_publication_handler),
        )
        .route(
            "/v1/admin/publications/{publication_id}/moderation",
            post(handlers_commerce::moderate_publication_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
            get(handlers_commerce::get_my_publication_vote_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
            put(handlers_commerce::put_my_publication_vote_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
            delete(handlers_commerce::delete_my_publication_vote_handler),
        )
        .route(
            "/v1/publications/{publication_id}/adopt",
            post(handlers_commerce::adopt_publication_body_handler),
        )
        .route(
            "/v1/publications/{publication_id}/revisions/{publication_revision_id}/adoptions",
            post(handlers_commerce::adopt_publication_revision_handler),
        )
}

fn catalog_generation_and_syllabus_routes() -> Router<ApiAppState> {
    Router::new()
        // T02: Reviewed catalog filtering, curator review & quarantine routes
        .route(
            "/v1/resources/versions",
            get(handlers_catalog::list_or_filter_catalog_resources_handler),
        )
        .route(
            "/v1/catalog/resources",
            get(handlers_catalog::list_or_filter_catalog_resources_handler),
        )
        .route(
            "/v1/catalog/resources/manual",
            post(handlers_catalog::ingest_manual_catalog_resource_handler),
        )
        .route(
            "/v1/catalog/resources/{resource_version_id}",
            patch(handlers_catalog::patch_catalog_resource_handler)
                .delete(handlers_catalog::delete_catalog_resource_handler),
        )
        .route(
            "/v1/catalog/resources/{resource_version_id}/reviews",
            post(handlers_catalog::review_catalog_resource_handler),
        )
        .route(
            "/v1/admin/resources/{resource_version_id}/reviews",
            post(handlers_catalog::review_catalog_resource_handler),
        )
        .route(
            "/v1/catalog/resources/{resource_version_id}/quarantine",
            post(handlers_catalog::quarantine_catalog_resource_handler),
        )
        .route(
            "/v1/catalog/search-and-index",
            post(handlers_catalog::search_and_index_catalog_handler),
        )
        .route(
            "/v1/catalog/index",
            post(handlers_catalog::search_and_index_catalog_handler),
        )
        // T03: Goal intake & async syllabus generation routes
        .route(
            "/v1/goals/interpret",
            post(handlers_catalog::interpret_goal_handler),
        )
        .route(
            "/v1/syllabi/goal-interpretations",
            post(handlers_catalog::interpret_goal_handler),
        )
        .route(
            "/v1/generations",
            post(handlers_catalog::start_generation_handler),
        )
        .route(
            "/v1/syllabi/generation-jobs",
            post(handlers_catalog::start_generation_handler),
        )
        .route(
            "/v1/generations/{job_id}",
            get(handlers_catalog::get_generation_job_handler),
        )
        .route(
            "/v1/generation-jobs/{job_id}",
            get(handlers_catalog::get_generation_job_handler),
        )
        .route(
            "/v1/syllabi/generation-jobs/{job_id}",
            get(handlers_catalog::get_generation_job_handler),
        )
        .route(
            "/v1/generations/{job_id}/cancel",
            post(handlers_catalog::cancel_generation_job_handler),
        )
        .route(
            "/v1/generation-jobs/{job_id}/cancel",
            post(handlers_catalog::cancel_generation_job_handler),
        )
        // T04: Syllabi list, overview, revision inspection, activation & resource alerts
        .route(
            "/v1/syllabi",
            get(handlers_syllabus::list_my_syllabi_handler),
        )
        .route(
            "/v1/me/syllabi",
            get(handlers_syllabus::list_my_syllabi_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}",
            get(handlers_syllabus::get_syllabus_overview_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/revisions/{revision_id}",
            get(handlers_syllabus::get_syllabus_revision_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/revisions/{revision_id}/activate",
            post(handlers_syllabus::activate_syllabus_revision_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/active-revision",
            put(handlers_syllabus::put_active_revision_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/resource-alerts",
            get(handlers_syllabus::get_syllabus_resource_alerts_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/resources",
            post(handlers_syllabus::add_syllabus_resource_handler),
        )
        .route(
            "/v1/syllabi/{syllabus_id}/resources/{resource_version_id}",
            patch(handlers_syllabus::patch_syllabus_resource_handler)
                .delete(handlers_syllabus::delete_syllabus_resource_handler),
        )
}

/// Extracts a trimmed Bearer token from the `Authorization` header.
#[must_use]
pub(crate) fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .and_then(|s| {
            s.strip_prefix("Bearer ")
                .or_else(|| s.strip_prefix("bearer "))
        })
        .map(str::trim)
}

/// Extracts a trimmed UTF-8 header value by name.
#[must_use]
pub(crate) fn extract_header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
}

/// Extracts the `If-Match` precondition header from `headers`.
#[must_use]
pub(crate) fn extract_if_match(headers: &HeaderMap) -> Option<&str> {
    extract_header_str(headers, header::IF_MATCH.as_str())
}

/// Extracts the `Idempotency-Key` header from `headers`.
#[must_use]
pub(crate) fn extract_idempotency_key(headers: &HeaderMap) -> Option<&str> {
    extract_header_str(headers, HEADER_IDEMPOTENCY_KEY)
}

/// Resolves an authenticated principal from a bearer session token or the configured `AuthVerifier`.
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

/// Constructs the canonical JSON error body for a `PersistenceError`.
#[must_use]
pub(crate) fn error_body(err: &PersistenceError) -> Value {
    let mut body = json!({
        "error": {
            "code": err.error_code(),
            "message": err.to_string(),
        }
    });
    if let PersistenceError::PreconditionFailed {
        expected_etag,
        actual_etag,
    } = err
    {
        body["error"]["expected_etag"] = json!(expected_etag);
        body["error"]["current_etag"] = json!(actual_etag);
    }
    body
}

/// Converts a `PersistenceError` into an HTTP `Response` with the matching status code and JSON body.
#[must_use]
pub(crate) fn error_response(err: PersistenceError) -> Response {
    let status =
        StatusCode::from_u16(err.http_status_code()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (status, Json(error_body(&err))).into_response()
}

/// Builds a JSON response with an attached `ETag` header without cloning the ETag string.
#[must_use]
pub(crate) fn json_with_etag<T: Serialize>(
    status: StatusCode,
    etag: &str,
    payload: &T,
) -> Response {
    let mut resp = (status, Json(payload)).into_response();
    if let Ok(hv) = HeaderValue::from_str(etag) {
        resp.headers_mut().insert(header::ETAG, hv);
    }
    resp
}

/// Builds a replayed idempotent response with the `Idempotency-Replayed: true` header.
#[must_use]
pub(crate) fn idempotent_replay_response(
    stored: StoredIdempotentResponse,
    fallback_status: StatusCode,
) -> Response {
    let status = StatusCode::from_u16(stored.status_code).unwrap_or(fallback_status);
    let mut resp = (status, Json(stored.body)).into_response();
    resp.headers_mut().insert(
        HEADER_IDEMPOTENCY_REPLAYED,
        HeaderValue::from_static("true"),
    );
    resp
}

/// Extracts the first matching string field from `payload`.
#[must_use]
pub(crate) fn json_str<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_str))
}

/// Extracts the first matching boolean field from `payload`.
#[must_use]
pub(crate) fn json_bool(payload: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_bool))
}

/// Extracts the first matching signed 64-bit integer field from `payload`.
#[must_use]
pub(crate) fn json_i64(payload: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_i64))
}

/// Extracts the first matching unsigned 64-bit integer field from `payload`.
#[must_use]
pub(crate) fn json_u64(payload: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_u64))
}

/// Extracts an array of owned strings from `payload[key]`.
#[must_use]
pub(crate) fn json_string_vec(payload: &Value, key: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Extracts a string-valued `BTreeMap<String, String>` from the first matching object key in `payload`.
#[must_use]
pub(crate) fn json_string_map(payload: &Value, keys: &[&str]) -> BTreeMap<String, String> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_object))
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
        .collect()
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod auth_secret_tests {
    use super::valid_32_byte_hex_secret;

    #[test]
    fn exchange_secret_requires_a_full_hex_key() {
        assert!(!valid_32_byte_hex_secret("short"));
        assert!(!valid_32_byte_hex_secret(&"g".repeat(64)));
        assert!(valid_32_byte_hex_secret(&"a1".repeat(32)));
    }
}
