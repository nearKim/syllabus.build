//! Account, workspace, profile, credential custody, and export job HTTP handlers:
//! user profile updates, web workspace sync, user passkey management, BYOK credentials (`T07A`),
//! usage tracking, and account data exports (`T09`).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    current_epoch_ms, extract_idempotency_key, extract_if_match, json_bool, json_str,
    json_with_etag, ApiAppState, ApiResult, AuthPrincipal, DEFAULT_NOW_EPOCH_MS,
};

const DEFAULT_EXPORT_REQUESTED_AT: &str = "2026-10-20T21:16:10Z";
const DEFAULT_PROVIDER_ID: &str = "openai";
const DEFAULT_BYOK_LABEL: &str = "BYOK Credential";

pub(crate) async fn get_my_workspace_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    if let Some(record) = state.store.get_web_workspace(&principal) {
        let etag = format!("\"ws-v{}\"", record.revision);
        Ok(json_with_etag(StatusCode::OK, &etag, &record))
    } else {
        let account = state.store.get_account_by_id(&principal.account_id);
        let body = json!({
            "account_id": principal.account_id,
            "email": account.map(|a| a.email),
            "workspace_json": Value::Null,
            "revision": 0,
            "updated_at_ms": 0,
        });
        Ok(json_with_etag(StatusCode::OK, "\"ws-v0\"", &body))
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct PutWorkspaceRequestDto {
    pub(crate) workspace_json: Value,
    #[serde(default)]
    pub(crate) expected_revision: Option<u64>,
}

pub(crate) async fn put_my_workspace_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(dto): Json<PutWorkspaceRequestDto>,
) -> ApiResult {
    let record = state.store.put_web_workspace(
        &principal,
        dto.workspace_json,
        dto.expected_revision,
        current_epoch_ms(),
    )?;
    let etag = format!("\"ws-v{}\"", record.revision);
    Ok(json_with_etag(StatusCode::OK, &etag, &record))
}

pub(crate) async fn delete_my_workspace_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let _ = state.store.delete_web_workspace(&principal);
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Debug, Deserialize)]
pub(crate) struct PatchMyProfileDto {
    #[serde(default)]
    pub(crate) email: Option<String>,
    #[serde(default)]
    pub(crate) display_name: Option<String>,
    #[serde(default)]
    pub(crate) avatar_url: Option<String>,
}

pub(crate) async fn patch_my_profile_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(dto): Json<PatchMyProfileDto>,
) -> ApiResult {
    let account = state.store.update_account_profile(
        &principal,
        dto.email.as_deref(),
        dto.display_name.as_deref(),
        dto.avatar_url.as_deref(),
    )?;
    Ok((
        StatusCode::OK,
        Json(json!({
            "account_id": account.account_id,
            "email": account.email,
            "email_verified": account.email_verified,
            "display_name": account.display_name,
            "avatar_url": account.avatar_url,
            "roles": account.roles,
        })),
    )
        .into_response())
}

pub(crate) async fn list_my_passkeys_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let items = state.store.list_web_passkeys(&principal);
    Ok((StatusCode::OK, Json(json!({ "items": items }))).into_response())
}

#[derive(Debug, Deserialize)]
pub(crate) struct PutPasskeyDto {
    pub(crate) credential_json: Value,
}

pub(crate) async fn put_my_passkey_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(credential_id): Path<String>,
    Json(dto): Json<PutPasskeyDto>,
) -> ApiResult {
    let rec = state.store.put_web_passkey(
        &principal,
        &credential_id,
        dto.credential_json,
        current_epoch_ms(),
    )?;
    Ok((StatusCode::OK, Json(rec)).into_response())
}

pub(crate) async fn delete_my_passkey_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(credential_id): Path<String>,
) -> ApiResult {
    let _ = state.store.delete_web_passkey(&principal, &credential_id)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

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

    let view =
        state
            .store
            .rotate_credential(&principal, &credential_ref, if_match, new_key, new_label)?;
    Ok(json_with_etag(StatusCode::OK, &view.etag, &view))
}

pub(crate) async fn revoke_credential_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Path(credential_ref): Path<String>,
) -> ApiResult {
    let if_match = extract_if_match(&headers);
    state
        .store
        .revoke_credential(&principal, &credential_ref, if_match, DEFAULT_NOW_EPOCH_MS)?;
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
