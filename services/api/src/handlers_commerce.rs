//! Commerce, sharing, and lifecycle HTTP handlers: hosted credit wallet, quotes, reservations,
//! settlements, ledger, checkout sessions, webhooks, public templates, moderation, adoption, and account lifecycle.

use crate::*;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use curriculum_domain::{AmbiguousProviderOutcome, BillingModeKind, ModerationVisibilityState};
use curriculum_persistence::PersistenceError;
use serde::Deserialize;
use serde_json::{json, Value};

// =============================================================================
// T07B & T07D Handlers: Hosted Credit Wallet, Quotes, Reservations, Settlements,
// Ledger, Payment Checkout Sessions & Signed Webhooks
// =============================================================================

pub const DEFAULT_WEBHOOK_SIGNING_SECRET: &[u8] = b"whsec_curriculum_io_dev_secret_key_2026";

pub(crate) async fn get_hosted_wallet_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let wallet = state.store.get_hosted_credit_wallet(&principal);
    let etag = wallet.etag.clone();
    let mut resp = (StatusCode::OK, Json(wallet)).into_response();
    if let Ok(hv) = HeaderValue::from_str(&etag) {
        resp.headers_mut().insert(axum::http::header::ETAG, hv);
    }
    resp
}

pub(crate) async fn create_usage_quote_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let quote_id = payload.get("quote_id").and_then(|v| v.as_str());
    let mode_str = payload
        .get("billing_mode")
        .or_else(|| payload.get("credential_mode"))
        .and_then(|v| v.as_str())
        .unwrap_or("hosted_credits");
    let billing_mode = match mode_str {
        "byok" => BillingModeKind::Byok,
        "hosted" | "hosted_credits" => BillingModeKind::HostedCredits,
        other => {
            return error_response(PersistenceError::Validation(format!(
                "invalid billing_mode `{other}`"
            )))
        }
    };
    let operation_kind = payload
        .get("operation_kind")
        .and_then(|v| v.as_str())
        .unwrap_or("curriculum_generation");
    let provider_id = payload
        .get("provider_id")
        .and_then(|v| v.as_str())
        .unwrap_or("openai");
    let model_id = payload
        .get("model_id")
        .and_then(|v| v.as_str())
        .unwrap_or("gpt-4o-2024-08-06");
    let max_reservable = payload
        .get("max_reservable_minor_units")
        .or_else(|| payload.get("max_reservation_cap_minor_units"))
        .and_then(|v| v.as_i64())
        .unwrap_or(150);
    let estimated_minor = payload
        .get("estimated_minor_units")
        .and_then(|v| v.as_i64())
        .unwrap_or(max_reservable);
    let byok_estimated = payload
        .get("external_byok_estimated_minor_units")
        .or_else(|| payload.get("byok_telemetry_minor_units"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let materials_minor = payload
        .get("learning_materials_estimated_minor_units")
        .or_else(|| payload.get("material_cost_minor_units"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let now_epoch = payload
        .get("now_epoch_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(1_800_000_000);
    let ttl_seconds = payload
        .get("ttl_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(900);

    match state.store.create_usage_quote(
        &principal,
        quote_id,
        operation_kind,
        billing_mode,
        provider_id,
        model_id,
        estimated_minor,
        max_reservable,
        byok_estimated,
        materials_minor,
        now_epoch,
        ttl_seconds,
    ) {
        Ok(quote) => (StatusCode::CREATED, Json(quote)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn create_credit_reservation_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let idem_key = extract_header_str(&headers, "idempotency-key")
        .or_else(|| payload.get("idempotency_key").and_then(|v| v.as_str()))
        .unwrap_or("idem-resv-default");
    let reservation_id = payload.get("reservation_id").and_then(|v| v.as_str());
    let quote_id = payload
        .get("quote_id")
        .and_then(|v| v.as_str())
        .unwrap_or("quote-001");
    let requested_reserve = payload
        .get("requested_reserve_minor_units")
        .and_then(|v| v.as_i64());
    let now_epoch = payload
        .get("now_epoch_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(1_800_000_000);

    match state.store.create_credit_reservation(
        &principal,
        reservation_id,
        quote_id,
        idem_key,
        requested_reserve,
        now_epoch,
    ) {
        Ok(resv) => (StatusCode::CREATED, Json(resv)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn settle_credit_reservation_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let actual_minor = payload
        .get("actual_cost_minor_units")
        .or_else(|| payload.get("actual_usage_minor_units"))
        .or_else(|| payload.get("settled_minor_units"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let now_epoch = payload
        .get("now_epoch_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(1_800_000_300);

    match state.store.settle_credit_reservation(
        &principal,
        &reservation_id,
        actual_minor,
        now_epoch,
    ) {
        Ok((resv, wallet)) => (
            StatusCode::OK,
            Json(json!({
                "reservation": resv,
                "wallet": wallet,
            })),
        )
            .into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn release_credit_reservation_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    payload: Option<Json<Value>>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let body = payload.map(|Json(v)| v).unwrap_or_else(|| json!({}));
    let reason = body
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("provider_or_validation_failure");
    let now_epoch = body
        .get("now_epoch_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(1_800_000_300);

    match state
        .store
        .release_credit_reservation(&principal, &reservation_id, reason, now_epoch)
    {
        Ok((resv, wallet)) => (
            StatusCode::OK,
            Json(json!({
                "reservation": resv,
                "wallet": wallet,
            })),
        )
            .into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn reconcile_ambiguous_timeout_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let _principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let committed_artifact_persisted = payload
        .get("committed_artifact_persisted")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let outcome_str = payload
        .get("outcome")
        .and_then(|v| v.as_str())
        .unwrap_or("provider_confirmed_not_executed");
    let outcome = match outcome_str {
        "provider_confirmed_completed" | "confirmed_completed_and_validated" => {
            let minor = payload
                .get("actual_cost_minor_units")
                .or_else(|| payload.get("actual_usage_minor_units"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            AmbiguousProviderOutcome::ProviderConfirmedCompleted {
                actual_usage_minor_units: minor,
            }
        }
        "still_ambiguous_after_deadline"
        | "unconfirmed_after_deadline"
        | "unconfirmed_timeout_without_committed_output" => {
            AmbiguousProviderOutcome::UnconfirmedTimeoutWithoutCommittedOutput
        }
        _ => AmbiguousProviderOutcome::ProviderConfirmedNoOutput,
    };
    let now_epoch = payload
        .get("now_epoch_seconds")
        .and_then(|v| v.as_i64())
        .unwrap_or(1_800_000_600);

    match state.store.reconcile_ambiguous_provider_timeout(
        &reservation_id,
        committed_artifact_persisted,
        outcome,
        now_epoch,
    ) {
        Ok((resv, wallet)) => (
            StatusCode::OK,
            Json(json!({
                "reservation": resv,
                "wallet": wallet,
            })),
        )
            .into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn get_my_ledger_handler(State(state): State<ApiAppState>, headers: HeaderMap) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let wallet = state.store.get_hosted_credit_wallet(&principal);
    let entries = state.store.list_ledger_entries(&principal);
    (
        StatusCode::OK,
        Json(json!({
            "wallet": wallet,
            "items": entries,
        })),
    )
        .into_response()
}

pub(crate) async fn create_checkout_session_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let session_id = payload
        .get("checkout_session_id")
        .or_else(|| payload.get("session_id"))
        .and_then(|v| v.as_str());
    let package_id = payload
        .get("package_id")
        .and_then(|v| v.as_str())
        .unwrap_or("pkg-hosted-starter");
    let idem_key = extract_header_str(&headers, "idempotency-key")
        .or_else(|| payload.get("idempotency_key").and_then(|v| v.as_str()))
        .unwrap_or("idem-checkout-default");
    let amount_minor_units = payload
        .get("amount_minor_units")
        .and_then(|v| v.as_i64())
        .unwrap_or(1_000);
    let credit_minor_units = payload
        .get("credit_minor_units")
        .and_then(|v| v.as_i64())
        .unwrap_or(amount_minor_units);
    let success_url = payload
        .get("success_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://curriculum.example.test/billing/success");
    let cancel_url = payload
        .get("cancel_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://curriculum.example.test/billing/cancel");

    match state.store.create_checkout_session(
        &principal,
        session_id,
        package_id,
        idem_key,
        amount_minor_units,
        credit_minor_units,
        success_url,
        cancel_url,
    ) {
        Ok(sess) => (StatusCode::CREATED, Json(sess)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn process_payment_webhook_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    body_bytes: axum::body::Bytes,
) -> Response {
    let signature = extract_header_str(&headers, "x-billing-signature")
        .or_else(|| extract_header_str(&headers, "stripe-signature"))
        .unwrap_or("");

    match state.store.process_payment_webhook(
        DEFAULT_WEBHOOK_SIGNING_SECRET,
        &body_bytes,
        signature,
    ) {
        Ok(outcome) => (StatusCode::OK, Json(outcome)).into_response(),
        Err(err) => error_response(err),
    }
}

// =============================================================================
// T13 Handlers: Public Templates, Sanitized Previews, Discovery, Upvotes,
// Moderation & Partial Adoption
// =============================================================================

pub(crate) async fn preview_curriculum_publication_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(curriculum_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    preview_publication_inner(state, headers, curriculum_id, payload)
}

pub(crate) async fn preview_body_publication_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let curriculum_id = payload
        .get("curriculum_id")
        .and_then(|v| v.as_str())
        .unwrap_or("cur-learner-a-1")
        .to_string();
    preview_publication_inner(state, headers, curriculum_id, payload)
}

pub(crate) fn preview_publication_inner(
    state: ApiAppState,
    headers: HeaderMap,
    curriculum_id: String,
    payload: Value,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let vis_str = payload
        .get("visibility")
        .and_then(|v| v.as_str())
        .unwrap_or("public");
    let visibility = match ModerationVisibilityState::from_wire(vis_str) {
        Ok(v) => v,
        Err(e) => return error_response(PersistenceError::Validation(e.to_string())),
    };
    let publisher_display_name = payload
        .get("publisher_display_name")
        .or_else(|| payload.get("pseudonymous_handle"))
        .and_then(|v| v.as_str());
    let attribution_text = payload.get("attribution_text").and_then(|v| v.as_str());

    match state.store.preview_publication(
        &principal,
        &curriculum_id,
        visibility,
        publisher_display_name,
        attribution_text,
    ) {
        Ok(preview) => (StatusCode::CREATED, Json(preview)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn publish_curriculum_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let preview_id = payload.get("preview_id").and_then(|v| v.as_str());
    let curriculum_id = payload.get("curriculum_id").and_then(|v| v.as_str());
    let publication_id = payload.get("publication_id").and_then(|v| v.as_str());
    let expected_sha256 = payload
        .get("expected_preview_sha256")
        .or_else(|| payload.get("expected_sanitized_snapshot_sha256"))
        .or_else(|| payload.get("preview_sha256"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let accept_terms = payload
        .get("accept_publication_terms")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let visibility_override = match payload.get("visibility").and_then(|v| v.as_str()) {
        Some(s) => match ModerationVisibilityState::from_wire(s) {
            Ok(v) => Some(v),
            Err(e) => return error_response(PersistenceError::Validation(e.to_string())),
        },
        None => None,
    };

    match state.store.publish_curriculum(
        &principal,
        preview_id,
        curriculum_id,
        publication_id,
        expected_sha256,
        accept_terms,
        visibility_override,
    ) {
        Ok(view) => (StatusCode::CREATED, Json(view)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn publish_publication_revision_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let if_match = extract_header_str(&headers, "if-match");
    let preview_id = payload.get("preview_id").and_then(|v| v.as_str());
    let expected_sha256 = payload
        .get("expected_preview_sha256")
        .or_else(|| payload.get("expected_sanitized_snapshot_sha256"))
        .or_else(|| payload.get("preview_sha256"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let accept_terms = payload
        .get("accept_publication_terms")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    match state.store.publish_publication_revision(
        &principal,
        &publication_id,
        if_match,
        preview_id,
        expected_sha256,
        accept_terms,
    ) {
        Ok(view) => (StatusCode::CREATED, Json(view)).into_response(),
        Err(err) => error_response(err),
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct PublicationDiscoveryQueryDto {
    pub q: Option<String>,
    pub topic_id: Option<String>,
    pub sort: Option<String>,
}

pub(crate) async fn discover_publications_handler(
    State(state): State<ApiAppState>,
    Query(query): Query<PublicationDiscoveryQueryDto>,
) -> Response {
    let items = state.store.discover_public_publications(
        query.q.as_deref(),
        query.topic_id.as_deref(),
        query.sort.as_deref(),
    );
    (StatusCode::OK, Json(json!({ "items": items }))).into_response()
}

pub(crate) async fn get_public_publication_handler(
    State(state): State<ApiAppState>,
    Path(publication_id): Path<String>,
) -> Response {
    match state
        .store
        .get_public_publication_view(&publication_id, None)
    {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn get_public_publication_revision_handler(
    State(state): State<ApiAppState>,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> Response {
    match state
        .store
        .get_public_publication_view(&publication_id, Some(&publication_revision_id))
    {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn list_owned_publications_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let items = state.store.list_owned_publications(&principal);
    (StatusCode::OK, Json(json!({ "items": items }))).into_response()
}

pub(crate) async fn get_owned_publication_management_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .get_owned_publication_management(&principal, &publication_id)
    {
        Ok(mgmt) => {
            let etag = mgmt.etag.clone();
            let mut resp = (StatusCode::OK, Json(mgmt)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

pub(crate) async fn list_owned_publication_revisions_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .list_owned_publication_revisions(&principal, &publication_id)
    {
        Ok(revisions) => (StatusCode::OK, Json(json!({ "items": revisions }))).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn unpublish_publication_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let if_match = extract_header_str(&headers, "if-match");

    match state
        .store
        .unpublish_publication(&principal, &publication_id, if_match)
    {
        Ok(mgmt) => {
            let etag = mgmt.etag.clone();
            let mut resp = (StatusCode::OK, Json(mgmt)).into_response();
            if let Ok(hv) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert(axum::http::header::ETAG, hv);
            }
            resp
        }
        Err(err) => error_response(err),
    }
}

pub(crate) async fn report_publication_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let pub_rev_id = payload
        .get("publication_revision_id")
        .and_then(|v| v.as_str());
    let reason_code = payload
        .get("reason_code")
        .or_else(|| payload.get("reason"))
        .and_then(|v| v.as_str())
        .unwrap_or("policy_violation");
    let details = payload
        .get("details")
        .or_else(|| payload.get("description"))
        .and_then(|v| v.as_str())
        .unwrap_or("Reported publication");

    match state.store.report_publication(
        &principal,
        &publication_id,
        pub_rev_id,
        reason_code,
        details,
    ) {
        Ok(rep) => (StatusCode::CREATED, Json(rep)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn list_moderation_reports_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.list_moderation_reports(&principal) {
        Ok(items) => (StatusCode::OK, Json(json!({ "items": items }))).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn moderate_publication_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let action_kind = payload
        .get("action_kind")
        .or_else(|| payload.get("action"))
        .or_else(|| payload.get("target_visibility_state"))
        .and_then(|v| v.as_str())
        .map(|s| match s {
            "suspended_pending_review" | "suspend" => "quarantine",
            "removed_by_moderator" => "remove",
            "published" => "restore",
            other => other,
        })
        .unwrap_or("quarantine");
    let rationale = payload
        .get("rationale")
        .and_then(|v| v.as_str())
        .unwrap_or("Moderated public template visibility");

    match state
        .store
        .moderate_publication(&principal, &publication_id, action_kind, rationale)
    {
        Ok(act_rec) => (StatusCode::OK, Json(act_rec)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn get_my_publication_vote_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state
        .store
        .get_my_publication_vote(&principal, &publication_id, &publication_revision_id)
    {
        Ok(vote_state) => (StatusCode::OK, Json(vote_state)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn put_my_publication_vote_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.set_my_publication_upvote(
        &principal,
        &publication_id,
        &publication_revision_id,
    ) {
        Ok(vote_state) => (StatusCode::OK, Json(vote_state)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn delete_my_publication_vote_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    match state.store.remove_my_publication_upvote(
        &principal,
        &publication_id,
        &publication_revision_id,
    ) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn adopt_publication_body_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let pub_rev_id = payload
        .get("publication_revision_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    adopt_publication_inner(state, headers, publication_id, pub_rev_id, payload)
}

pub(crate) async fn adopt_publication_revision_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> Response {
    adopt_publication_inner(
        state,
        headers,
        publication_id,
        Some(publication_revision_id),
        payload,
    )
}

pub(crate) fn adopt_publication_inner(
    state: ApiAppState,
    headers: HeaderMap,
    publication_id: String,
    publication_revision_id: Option<String>,
    payload: Value,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let selected_module_ids: Vec<String> = payload
        .get("selected_module_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let new_curriculum_id = payload
        .get("new_curriculum_id")
        .or_else(|| payload.get("curriculum_id"))
        .and_then(|v| v.as_str());
    let free_only = payload
        .get("free_only")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let max_budget_minor_units = payload
        .get("max_budget_minor_units")
        .and_then(|v| v.as_u64());

    match state.store.adopt_publication_revision(
        &principal,
        &publication_id,
        publication_revision_id.as_deref(),
        new_curriculum_id,
        &selected_module_ids,
        free_only,
        max_budget_minor_units,
    ) {
        Ok(adopted) => (StatusCode::CREATED, Json(adopted)).into_response(),
        Err(err) => error_response(err),
    }
}

// =============================================================================
// T09 & T11 Handlers: Account Deletion Requests & External Completion Import
// =============================================================================

pub(crate) async fn request_account_deletion_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    payload: Option<Json<Value>>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let body = payload.map(|Json(v)| v).unwrap_or_else(|| json!({}));
    let request_id = body
        .get("deletion_request_id")
        .or_else(|| body.get("request_id"))
        .and_then(|v| v.as_str());
    let confirm_deletion = body
        .get("confirm_deletion")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let now_epoch_ms = body
        .get("now_epoch_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(10_000);

    match state.store.request_account_deletion(
        &principal,
        request_id,
        confirm_deletion,
        now_epoch_ms,
    ) {
        Ok(rec) => (StatusCode::ACCEPTED, Json(rec)).into_response(),
        Err(err) => error_response(err),
    }
}

pub(crate) async fn import_external_completion_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let principal = match authenticate_request(&state, &headers) {
        Ok(p) => p,
        Err(err) => return error_response(err),
    };
    let curriculum_id = payload
        .get("curriculum_id")
        .and_then(|v| v.as_str())
        .unwrap_or("cur-learner-a-1");
    let activity_id = payload
        .get("activity_id")
        .and_then(|v| v.as_str())
        .unwrap_or("act-tok-1");
    let objective_id = payload.get("objective_id").and_then(|v| v.as_str());
    let external_provider = payload
        .get("external_provider")
        .or_else(|| payload.get("provider_name"))
        .or_else(|| payload.get("provider"))
        .and_then(|v| v.as_str())
        .unwrap_or("coursera");
    let time_spent_minutes = payload
        .get("time_spent_minutes")
        .and_then(|v| v.as_u64())
        .unwrap_or(45) as u32;

    match state.store.import_external_provider_completion(
        &principal,
        curriculum_id,
        activity_id,
        objective_id,
        external_provider,
        time_spent_minutes,
    ) {
        Ok(res) => (StatusCode::CREATED, Json(res)).into_response(),
        Err(err) => error_response(err),
    }
}
