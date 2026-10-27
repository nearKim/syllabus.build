//! Commerce, sharing, and lifecycle HTTP handlers: hosted credit wallet, quotes, reservations,
//! settlements, ledger, checkout sessions, webhooks, public templates, moderation, adoption, and account lifecycle.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use curriculum_domain::{AmbiguousProviderOutcome, BillingModeKind, ModerationVisibilityState};
use curriculum_persistence::PersistenceError;
use curriculum_security::AuthenticatedPrincipal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    extract_header_str, extract_idempotency_key, extract_if_match, json_bool, json_i64, json_str,
    json_string_vec, json_u64, json_with_etag, ApiAppState, ApiResult, AuthPrincipal,
    DEFAULT_CURRICULUM_ID, DEFAULT_NOW_EPOCH_MS,
};

// =============================================================================
// T07B & T07D Handlers: Hosted Credit Wallet, Quotes, Reservations, Settlements,
// Ledger, Payment Checkout Sessions & Signed Webhooks
// =============================================================================

pub(crate) const DEFAULT_WEBHOOK_SIGNING_SECRET: &[u8] =
    b"whsec_curriculum_io_dev_secret_key_2026";

const DEFAULT_BILLING_MODE: &str = "hosted_credits";
const DEFAULT_OPERATION_KIND: &str = "curriculum_generation";
const DEFAULT_PROVIDER_ID: &str = "openai";
const DEFAULT_MODEL_ID: &str = "gpt-4o-2024-08-06";
const DEFAULT_MAX_RESERVABLE_MINOR_UNITS: i64 = 150;
const DEFAULT_QUOTE_NOW_EPOCH_SECONDS: i64 = 1_800_000_000;
const DEFAULT_QUOTE_TTL_SECONDS: i64 = 900;
const DEFAULT_RESERVATION_IDEMPOTENCY_KEY: &str = "idem-resv-default";
const DEFAULT_QUOTE_ID: &str = "quote-001";
const DEFAULT_SETTLE_NOW_EPOCH_SECONDS: i64 = 1_800_000_300;
const DEFAULT_RELEASE_REASON: &str = "provider_or_validation_failure";
const DEFAULT_RECONCILE_NOW_EPOCH_SECONDS: i64 = 1_800_000_600;
const DEFAULT_CHECKOUT_PACKAGE_ID: &str = "pkg-hosted-starter";
const DEFAULT_CHECKOUT_IDEMPOTENCY_KEY: &str = "idem-checkout-default";
const DEFAULT_CHECKOUT_AMOUNT_MINOR_UNITS: i64 = 1_000;
const DEFAULT_CHECKOUT_SUCCESS_URL: &str = "https://curriculum.example.test/billing/success";
const DEFAULT_CHECKOUT_CANCEL_URL: &str = "https://curriculum.example.test/billing/cancel";
const DEFAULT_PUBLICATION_VISIBILITY: &str = "public";
const DEFAULT_REPORT_REASON_CODE: &str = "policy_violation";
const DEFAULT_REPORT_DETAILS: &str = "Reported publication";
const DEFAULT_MODERATION_RATIONALE: &str = "Moderated public template visibility";
const DEFAULT_IMPORT_ACTIVITY_ID: &str = "act-tok-1";
const DEFAULT_EXTERNAL_PROVIDER: &str = "coursera";
const DEFAULT_IMPORT_MINUTES: u64 = 45;

pub(crate) async fn get_hosted_wallet_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let wallet = state.store.get_hosted_credit_wallet(&principal);
    Ok(json_with_etag(StatusCode::OK, &wallet.etag, &wallet))
}

fn parse_billing_mode(raw: &str) -> Result<BillingModeKind, PersistenceError> {
    match raw {
        "byok" => Ok(BillingModeKind::Byok),
        "hosted" | "hosted_credits" => Ok(BillingModeKind::HostedCredits),
        other => Err(PersistenceError::Validation(format!(
            "invalid billing_mode `{other}`"
        ))),
    }
}

pub(crate) async fn create_usage_quote_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let quote_id = json_str(&payload, &["quote_id"]);
    let mode_str = json_str(&payload, &["billing_mode", "credential_mode"])
        .unwrap_or(DEFAULT_BILLING_MODE);
    let billing_mode = parse_billing_mode(mode_str)?;
    let operation_kind =
        json_str(&payload, &["operation_kind"]).unwrap_or(DEFAULT_OPERATION_KIND);
    let provider_id = json_str(&payload, &["provider_id"]).unwrap_or(DEFAULT_PROVIDER_ID);
    let model_id = json_str(&payload, &["model_id"]).unwrap_or(DEFAULT_MODEL_ID);
    let max_reservable = json_i64(
        &payload,
        &[
            "max_reservable_minor_units",
            "max_reservation_cap_minor_units",
        ],
    )
    .unwrap_or(DEFAULT_MAX_RESERVABLE_MINOR_UNITS);
    let estimated_minor =
        json_i64(&payload, &["estimated_minor_units"]).unwrap_or(max_reservable);
    let byok_estimated = json_i64(
        &payload,
        &[
            "external_byok_estimated_minor_units",
            "byok_telemetry_minor_units",
        ],
    )
    .unwrap_or(0);
    let materials_minor = json_i64(
        &payload,
        &[
            "learning_materials_estimated_minor_units",
            "material_cost_minor_units",
        ],
    )
    .unwrap_or(0);
    let now_epoch =
        json_i64(&payload, &["now_epoch_seconds"]).unwrap_or(DEFAULT_QUOTE_NOW_EPOCH_SECONDS);
    let ttl_seconds = json_i64(&payload, &["ttl_seconds"]).unwrap_or(DEFAULT_QUOTE_TTL_SECONDS);

    let quote = state.store.create_usage_quote(
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
    )?;
    Ok((StatusCode::CREATED, Json(quote)).into_response())
}

pub(crate) async fn create_credit_reservation_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult {
    let idem_key = extract_idempotency_key(&headers)
        .or_else(|| json_str(&payload, &["idempotency_key"]))
        .unwrap_or(DEFAULT_RESERVATION_IDEMPOTENCY_KEY);
    let reservation_id = json_str(&payload, &["reservation_id"]);
    let quote_id = json_str(&payload, &["quote_id"]).unwrap_or(DEFAULT_QUOTE_ID);
    let requested_reserve = json_i64(&payload, &["requested_reserve_minor_units"]);
    let now_epoch =
        json_i64(&payload, &["now_epoch_seconds"]).unwrap_or(DEFAULT_QUOTE_NOW_EPOCH_SECONDS);

    let resv = state.store.create_credit_reservation(
        &principal,
        reservation_id,
        quote_id,
        idem_key,
        requested_reserve,
        now_epoch,
    )?;
    Ok((StatusCode::CREATED, Json(resv)).into_response())
}

#[must_use]
fn reservation_wallet_response<R: Serialize, W: Serialize>(
    reservation: R,
    wallet: W,
) -> Response {
    (
        StatusCode::OK,
        Json(json!({
            "reservation": reservation,
            "wallet": wallet,
        })),
    )
        .into_response()
}

pub(crate) async fn settle_credit_reservation_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(reservation_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let actual_minor = json_i64(
        &payload,
        &[
            "actual_cost_minor_units",
            "actual_usage_minor_units",
            "settled_minor_units",
        ],
    )
    .unwrap_or(0);
    let now_epoch =
        json_i64(&payload, &["now_epoch_seconds"]).unwrap_or(DEFAULT_SETTLE_NOW_EPOCH_SECONDS);

    let (resv, wallet) = state.store.settle_credit_reservation(
        &principal,
        &reservation_id,
        actual_minor,
        now_epoch,
    )?;
    Ok(reservation_wallet_response(resv, wallet))
}

pub(crate) async fn release_credit_reservation_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(reservation_id): Path<String>,
    payload: Option<Json<Value>>,
) -> ApiResult {
    let body = payload.map_or_else(|| json!({}), |Json(v)| v);
    let reason = json_str(&body, &["reason"]).unwrap_or(DEFAULT_RELEASE_REASON);
    let now_epoch =
        json_i64(&body, &["now_epoch_seconds"]).unwrap_or(DEFAULT_SETTLE_NOW_EPOCH_SECONDS);

    let (resv, wallet) =
        state
            .store
            .release_credit_reservation(&principal, &reservation_id, reason, now_epoch)?;
    Ok(reservation_wallet_response(resv, wallet))
}

#[must_use]
fn parse_ambiguous_provider_outcome(payload: &Value) -> AmbiguousProviderOutcome {
    match json_str(payload, &["outcome"]).unwrap_or("provider_confirmed_not_executed") {
        "provider_confirmed_completed" | "confirmed_completed_and_validated" => {
            let minor = json_i64(
                payload,
                &["actual_cost_minor_units", "actual_usage_minor_units"],
            )
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
    }
}

pub(crate) async fn reconcile_ambiguous_timeout_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    Path(reservation_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let committed_artifact_persisted =
        json_bool(&payload, &["committed_artifact_persisted"]).unwrap_or(false);
    let outcome = parse_ambiguous_provider_outcome(&payload);
    let now_epoch = json_i64(&payload, &["now_epoch_seconds"])
        .unwrap_or(DEFAULT_RECONCILE_NOW_EPOCH_SECONDS);

    let (resv, wallet) = state.store.reconcile_ambiguous_provider_timeout(
        &reservation_id,
        committed_artifact_persisted,
        outcome,
        now_epoch,
    )?;
    Ok(reservation_wallet_response(resv, wallet))
}

pub(crate) async fn get_my_ledger_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let wallet = state.store.get_hosted_credit_wallet(&principal);
    let entries = state.store.list_ledger_entries(&principal);
    Ok((
        StatusCode::OK,
        Json(json!({
            "wallet": wallet,
            "items": entries,
        })),
    )
        .into_response())
}

pub(crate) async fn create_checkout_session_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult {
    let session_id = json_str(&payload, &["checkout_session_id", "session_id"]);
    let package_id = json_str(&payload, &["package_id"]).unwrap_or(DEFAULT_CHECKOUT_PACKAGE_ID);
    let idem_key = extract_idempotency_key(&headers)
        .or_else(|| json_str(&payload, &["idempotency_key"]))
        .unwrap_or(DEFAULT_CHECKOUT_IDEMPOTENCY_KEY);
    let amount_minor_units =
        json_i64(&payload, &["amount_minor_units"]).unwrap_or(DEFAULT_CHECKOUT_AMOUNT_MINOR_UNITS);
    let credit_minor_units =
        json_i64(&payload, &["credit_minor_units"]).unwrap_or(amount_minor_units);
    let success_url =
        json_str(&payload, &["success_url"]).unwrap_or(DEFAULT_CHECKOUT_SUCCESS_URL);
    let cancel_url = json_str(&payload, &["cancel_url"]).unwrap_or(DEFAULT_CHECKOUT_CANCEL_URL);

    let sess = state.store.create_checkout_session(
        &principal,
        session_id,
        package_id,
        idem_key,
        amount_minor_units,
        credit_minor_units,
        success_url,
        cancel_url,
    )?;
    Ok((StatusCode::CREATED, Json(sess)).into_response())
}

pub(crate) async fn process_payment_webhook_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    body_bytes: axum::body::Bytes,
) -> ApiResult {
    let signature = extract_header_str(&headers, "x-billing-signature")
        .or_else(|| extract_header_str(&headers, "stripe-signature"))
        .unwrap_or("");

    let outcome = state.store.process_payment_webhook(
        DEFAULT_WEBHOOK_SIGNING_SECRET,
        &body_bytes,
        signature,
    )?;
    Ok((StatusCode::OK, Json(outcome)).into_response())
}

// =============================================================================
// T13 Handlers: Public Templates, Sanitized Previews, Discovery, Upvotes,
// Moderation & Partial Adoption
// =============================================================================

pub(crate) async fn preview_curriculum_publication_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(curriculum_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    preview_publication_inner(&state, &principal, &curriculum_id, &payload)
}

pub(crate) async fn preview_body_publication_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let curriculum_id = json_str(&payload, &["curriculum_id"]).unwrap_or(DEFAULT_CURRICULUM_ID);
    preview_publication_inner(&state, &principal, curriculum_id, &payload)
}

fn preview_publication_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    curriculum_id: &str,
    payload: &Value,
) -> ApiResult {
    let vis_str = json_str(payload, &["visibility"]).unwrap_or(DEFAULT_PUBLICATION_VISIBILITY);
    let visibility = ModerationVisibilityState::from_wire(vis_str)?;
    let publisher_display_name =
        json_str(payload, &["publisher_display_name", "pseudonymous_handle"]);
    let attribution_text = json_str(payload, &["attribution_text"]);

    let preview = state.store.preview_publication(
        principal,
        curriculum_id,
        visibility,
        publisher_display_name,
        attribution_text,
    )?;
    Ok((StatusCode::CREATED, Json(preview)).into_response())
}

#[must_use]
fn extract_expected_preview_sha256(payload: &Value) -> &str {
    json_str(
        payload,
        &[
            "expected_preview_sha256",
            "expected_sanitized_snapshot_sha256",
            "preview_sha256",
        ],
    )
    .unwrap_or("")
}

pub(crate) async fn publish_curriculum_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let preview_id = json_str(&payload, &["preview_id"]);
    let curriculum_id = json_str(&payload, &["curriculum_id"]);
    let publication_id = json_str(&payload, &["publication_id"]);
    let expected_sha256 = extract_expected_preview_sha256(&payload);
    let accept_terms = json_bool(&payload, &["accept_publication_terms"]).unwrap_or(true);
    let visibility_override = json_str(&payload, &["visibility"])
        .map(ModerationVisibilityState::from_wire)
        .transpose()?;

    let view = state.store.publish_curriculum(
        &principal,
        preview_id,
        curriculum_id,
        publication_id,
        expected_sha256,
        accept_terms,
        visibility_override,
    )?;
    Ok((StatusCode::CREATED, Json(view)).into_response())
}

pub(crate) async fn publish_publication_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    let preview_id = json_str(&payload, &["preview_id"]);
    let expected_sha256 = extract_expected_preview_sha256(&payload);
    let accept_terms = json_bool(&payload, &["accept_publication_terms"]).unwrap_or(true);

    let view = state.store.publish_publication_revision(
        &principal,
        &publication_id,
        if_match,
        preview_id,
        expected_sha256,
        accept_terms,
    )?;
    Ok((StatusCode::CREATED, Json(view)).into_response())
}

/// Query parameters for discovering public curriculum templates (`T13`).
#[derive(Debug, Deserialize, Default)]
pub(crate) struct PublicationDiscoveryQueryDto {
    pub(crate) q: Option<String>,
    pub(crate) topic_id: Option<String>,
    pub(crate) sort: Option<String>,
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
) -> ApiResult {
    let view = state
        .store
        .get_public_publication_view(&publication_id, None)?;
    Ok((StatusCode::OK, Json(view)).into_response())
}

pub(crate) async fn get_public_publication_revision_handler(
    State(state): State<ApiAppState>,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> ApiResult {
    let view = state
        .store
        .get_public_publication_view(&publication_id, Some(&publication_revision_id))?;
    Ok((StatusCode::OK, Json(view)).into_response())
}

pub(crate) async fn list_owned_publications_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let items = state.store.list_owned_publications(&principal);
    Ok((StatusCode::OK, Json(json!({ "items": items }))).into_response())
}

pub(crate) async fn get_owned_publication_management_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(publication_id): Path<String>,
) -> ApiResult {
    let mgmt = state
        .store
        .get_owned_publication_management(&principal, &publication_id)?;
    Ok(json_with_etag(StatusCode::OK, &mgmt.etag, &mgmt))
}

pub(crate) async fn list_owned_publication_revisions_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(publication_id): Path<String>,
) -> ApiResult {
    let revisions = state
        .store
        .list_owned_publication_revisions(&principal, &publication_id)?;
    Ok((StatusCode::OK, Json(json!({ "items": revisions }))).into_response())
}

pub(crate) async fn unpublish_publication_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(publication_id): Path<String>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    let mgmt = state
        .store
        .unpublish_publication(&principal, &publication_id, if_match)?;
    Ok(json_with_etag(StatusCode::OK, &mgmt.etag, &mgmt))
}

pub(crate) async fn report_publication_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let pub_rev_id = json_str(&payload, &["publication_revision_id"]);
    let reason_code =
        json_str(&payload, &["reason_code", "reason"]).unwrap_or(DEFAULT_REPORT_REASON_CODE);
    let details =
        json_str(&payload, &["details", "description"]).unwrap_or(DEFAULT_REPORT_DETAILS);

    let rep = state.store.report_publication(
        &principal,
        &publication_id,
        pub_rev_id,
        reason_code,
        details,
    )?;
    Ok((StatusCode::CREATED, Json(rep)).into_response())
}

pub(crate) async fn list_moderation_reports_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let items = state.store.list_moderation_reports(&principal)?;
    Ok((StatusCode::OK, Json(json!({ "items": items }))).into_response())
}

#[must_use]
fn normalize_moderation_action_kind(raw: Option<&str>) -> &str {
    match raw {
        Some("suspended_pending_review" | "suspend") | None => "quarantine",
        Some("removed_by_moderator") => "remove",
        Some("published") => "restore",
        Some(other) => other,
    }
}

pub(crate) async fn moderate_publication_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let action_kind = normalize_moderation_action_kind(json_str(
        &payload,
        &["action_kind", "action", "target_visibility_state"],
    ));
    let rationale = json_str(&payload, &["rationale"]).unwrap_or(DEFAULT_MODERATION_RATIONALE);

    let act_rec =
        state
            .store
            .moderate_publication(&principal, &publication_id, action_kind, rationale)?;
    Ok((StatusCode::OK, Json(act_rec)).into_response())
}

pub(crate) async fn get_my_publication_vote_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> ApiResult {
    let vote_state = state.store.get_my_publication_vote(
        &principal,
        &publication_id,
        &publication_revision_id,
    )?;
    Ok((StatusCode::OK, Json(vote_state)).into_response())
}

pub(crate) async fn put_my_publication_vote_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> ApiResult {
    let vote_state = state.store.set_my_publication_upvote(
        &principal,
        &publication_id,
        &publication_revision_id,
    )?;
    Ok((StatusCode::OK, Json(vote_state)).into_response())
}

pub(crate) async fn delete_my_publication_vote_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
) -> ApiResult {
    let _ = state.store.remove_my_publication_upvote(
        &principal,
        &publication_id,
        &publication_revision_id,
    )?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub(crate) async fn adopt_publication_body_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(publication_id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult {
    let pub_rev_id = json_str(&payload, &["publication_revision_id"]);
    adopt_publication_inner(&state, &principal, &publication_id, pub_rev_id, &payload)
}

pub(crate) async fn adopt_publication_revision_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path((publication_id, publication_revision_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> ApiResult {
    adopt_publication_inner(
        &state,
        &principal,
        &publication_id,
        Some(publication_revision_id.as_str()),
        &payload,
    )
}

fn adopt_publication_inner(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    publication_id: &str,
    publication_revision_id: Option<&str>,
    payload: &Value,
) -> ApiResult {
    let selected_module_ids = json_string_vec(payload, "selected_module_ids");
    let new_curriculum_id = json_str(payload, &["new_curriculum_id", "curriculum_id"]);
    let free_only = json_bool(payload, &["free_only"]).unwrap_or(true);
    let max_budget_minor_units = json_u64(payload, &["max_budget_minor_units"]);

    let adopted = state.store.adopt_publication_revision(
        principal,
        publication_id,
        publication_revision_id,
        new_curriculum_id,
        &selected_module_ids,
        free_only,
        max_budget_minor_units,
    )?;
    Ok((StatusCode::CREATED, Json(adopted)).into_response())
}

// =============================================================================
// T09 & T11 Handlers: Account Deletion Requests & External Completion Import
// =============================================================================

pub(crate) async fn request_account_deletion_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    payload: Option<Json<Value>>,
) -> ApiResult {
    let body = payload.map_or_else(|| json!({}), |Json(v)| v);
    let request_id = json_str(&body, &["deletion_request_id", "request_id"]);
    let confirm_deletion = json_bool(&body, &["confirm_deletion"]).unwrap_or(true);
    let now_epoch_ms = json_u64(&body, &["now_epoch_ms"]).unwrap_or(DEFAULT_NOW_EPOCH_MS);

    let rec = state.store.request_account_deletion(
        &principal,
        request_id,
        confirm_deletion,
        now_epoch_ms,
    )?;
    Ok((StatusCode::ACCEPTED, Json(rec)).into_response())
}

pub(crate) async fn import_external_completion_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let curriculum_id = json_str(&payload, &["curriculum_id"]).unwrap_or(DEFAULT_CURRICULUM_ID);
    let activity_id = json_str(&payload, &["activity_id"]).unwrap_or(DEFAULT_IMPORT_ACTIVITY_ID);
    let objective_id = json_str(&payload, &["objective_id"]);
    let external_provider = json_str(
        &payload,
        &["external_provider", "provider_name", "provider"],
    )
    .unwrap_or(DEFAULT_EXTERNAL_PROVIDER);
    let time_spent_u64 =
        json_u64(&payload, &["time_spent_minutes"]).unwrap_or(DEFAULT_IMPORT_MINUTES);
    let time_spent_minutes = u32::try_from(time_spent_u64).unwrap_or(u32::MAX);

    let res = state.store.import_external_provider_completion(
        &principal,
        curriculum_id,
        activity_id,
        objective_id,
        external_provider,
        time_spent_minutes,
    )?;
    Ok((StatusCode::CREATED, Json(res)).into_response())
}
