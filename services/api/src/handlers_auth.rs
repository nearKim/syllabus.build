//! Authentication and identity HTTP handlers: sessions, OAuth exchange, passkeys, and email verification.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use syllabus_persistence::{AccountRecord, AuthSessionRecord, PersistenceError};
use syllabus_security::{
    compute_pkce_s256_challenge, resolve_oauth_provider_statuses, OAuthProvider, PrincipalRole,
    SecurityError,
};

use crate::{current_epoch_ms, extract_bearer_token, ApiAppState, ApiResult, AuthPrincipal};

const DEV_SESSION_EXPIRES_AT: &str = "9999-12-31T23:59:59Z";

/// Response payload describing an active authentication session.
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SessionResponseDto {
    pub(crate) account_id: String,
    pub(crate) roles: Vec<PrincipalRole>,
    pub(crate) expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) email_verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) auth_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) is_new_account: Option<bool>,
}

fn build_session_response(
    account: Option<&AccountRecord>,
    session: AuthSessionRecord,
    auth_provider: Option<&str>,
    is_new_account: Option<bool>,
) -> SessionResponseDto {
    SessionResponseDto {
        account_id: session.account_id,
        roles: session.roles,
        expires_at: session.expires_at,
        session_token: Some(session.token),
        email: account.map(|a| a.email.clone()),
        email_verified: account.map(|a| a.email_verified),
        display_name: account.and_then(|a| a.display_name.clone()),
        avatar_url: account.and_then(|a| a.avatar_url.clone()),
        auth_provider: auth_provider.map(str::to_string),
        is_new_account,
    }
}

pub(crate) async fn get_auth_session_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
) -> ApiResult {
    let account = state.store.get_account_by_id(&principal.account_id);
    let expires_at = extract_bearer_token(&headers)
        .and_then(|token| state.store.session_expiry_for_token(token))
        .unwrap_or_else(|| DEV_SESSION_EXPIRES_AT.to_string());
    Ok((
        StatusCode::OK,
        Json(SessionResponseDto {
            account_id: principal.account_id,
            roles: principal.roles,
            expires_at,
            session_token: None,
            email: account.as_ref().map(|a| a.email.clone()),
            email_verified: account.as_ref().map(|a| a.email_verified),
            display_name: account.as_ref().and_then(|a| a.display_name.clone()),
            avatar_url: account.as_ref().and_then(|a| a.avatar_url.clone()),
            auth_provider: None,
            is_new_account: None,
        }),
    )
        .into_response())
}

pub(crate) async fn delete_auth_session_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    headers: HeaderMap,
) -> ApiResult {
    if let Some(token) = extract_bearer_token(&headers) {
        state
            .store
            .revoke_session_token(token, current_epoch_ms())?;
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Query parameters for `GET /v1/auth/oauth/{provider}/authorize`.
#[derive(Debug, Deserialize)]
pub(crate) struct OAuthAuthorizeQueryDto {
    pub(crate) redirect_uri: String,
    pub(crate) state: String,
    #[serde(default)]
    pub(crate) code_challenge: Option<String>,
    #[serde(default)]
    pub(crate) code_verifier: Option<String>,
    #[serde(default)]
    pub(crate) nonce: Option<String>,
}

/// Request payload for `POST /v1/auth/oauth/{provider}/callback`.
#[derive(Debug, Deserialize)]
pub(crate) struct OAuthCallbackExchangeRequestDto {
    pub(crate) provider_subject: String,
    pub(crate) email: String,
    #[serde(default)]
    pub(crate) email_verified: bool,
    #[serde(default)]
    pub(crate) display_name: Option<String>,
    #[serde(default)]
    pub(crate) avatar_url: Option<String>,
}

pub(crate) async fn list_auth_providers_handler(State(state): State<ApiAppState>) -> ApiResult {
    let origin =
        std::env::var("PUBLIC_WEB_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
    let providers =
        resolve_oauth_provider_statuses(&origin, state.gates.env.is_local_dev_or_test());
    Ok((
        StatusCode::OK,
        Json(json!({
            "providers": providers,
            "email_password_enabled": false,
            "passkey_enabled": true,
        })),
    )
        .into_response())
}

pub(crate) async fn oauth_authorize_url_handler(
    State(state): State<ApiAppState>,
    Path(provider_raw): Path<String>,
    Query(query): Query<OAuthAuthorizeQueryDto>,
) -> ApiResult {
    let provider: OAuthProvider = provider_raw.parse().map_err(PersistenceError::Security)?;
    let challenge = match (
        query.code_challenge.as_deref(),
        query.code_verifier.as_deref(),
    ) {
        (Some(ch), _) if !ch.trim().is_empty() => ch.trim().to_string(),
        (_, Some(verifier)) => {
            compute_pkce_s256_challenge(verifier).map_err(PersistenceError::Security)?
        }
        _ => {
            return Err(PersistenceError::Security(SecurityError::InvalidOAuthGrant(
                "code_challenge or code_verifier is required for PKCE S256".to_string(),
            ))
            .into());
        }
    };

    let env_client_id = match provider {
        OAuthProvider::Google => std::env::var("GOOGLE_CLIENT_ID").ok(),
        OAuthProvider::Github => std::env::var("GITHUB_CLIENT_ID").ok(),
        OAuthProvider::Apple => std::env::var("APPLE_CLIENT_ID").ok(),
    }
    .filter(|v| !v.trim().is_empty());

    let origin =
        std::env::var("PUBLIC_WEB_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
    let (client_id, override_url, mode) = match env_client_id {
        Some(live_id) => (live_id, None, "live"),
        None if state.gates.env.is_local_dev_or_test() => (
            format!("dev-{}-client", provider.as_str()),
            Some(format!(
                "{}/auth/dev-idp/{}/authorize",
                origin.trim_end_matches('/'),
                provider.as_str()
            )),
            "dev_sandbox",
        ),
        None => {
            return Err(
                PersistenceError::Security(SecurityError::InvalidOAuthGrant(format!(
                    "OAuth client_id is not configured for `{}`",
                    provider.as_str()
                )))
                .into(),
            );
        }
    };

    let authorize_url = provider
        .build_authorization_url(
            &client_id,
            &query.redirect_uri,
            &query.state,
            &challenge,
            override_url.as_deref(),
            query.nonce.as_deref(),
        )
        .map_err(PersistenceError::Security)?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "provider": provider.as_str(),
            "mode": mode,
            "authorize_url": authorize_url,
            "code_challenge_method": if provider == OAuthProvider::Apple && mode == "live" { None } else { Some("S256") },
        })),
    )
        .into_response())
}

pub(crate) async fn oauth_callback_exchange_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(provider_raw): Path<String>,
    Json(req): Json<OAuthCallbackExchangeRequestDto>,
) -> ApiResult {
    state.require_auth_exchange(&headers)?;
    let provider: OAuthProvider = provider_raw.parse().map_err(PersistenceError::Security)?;

    let outcome = state.store.authenticate_oauth_identity(
        provider,
        &req.provider_subject,
        &req.email,
        req.email_verified,
        req.display_name.as_deref(),
        req.avatar_url.as_deref(),
    )?;
    let status = if outcome.is_new_account {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(build_session_response(
            Some(&outcome.account),
            outcome.session,
            Some(outcome.provider.as_str()),
            Some(outcome.is_new_account),
        )),
    )
        .into_response())
}

pub(crate) async fn get_passkey_for_auth_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Path(credential_id): Path<String>,
) -> ApiResult {
    state.require_auth_exchange(&headers)?;
    let rec = state
        .store
        .get_web_passkey_by_credential_id(&credential_id)
        .ok_or(PersistenceError::NotFound {
            resource_type: "passkey",
            resource_id: credential_id,
        })?;
    Ok((StatusCode::OK, Json(rec)).into_response())
}

#[derive(Debug, Deserialize)]
pub(crate) struct PasskeySessionRequestDto {
    pub(crate) credential_id: String,
    #[serde(default)]
    pub(crate) counter: Option<u64>,
}

pub(crate) async fn create_passkey_session_handler(
    State(state): State<ApiAppState>,
    headers: HeaderMap,
    Json(dto): Json<PasskeySessionRequestDto>,
) -> ApiResult {
    state.require_auth_exchange(&headers)?;
    let (account, session) =
        state
            .store
            .create_passkey_session(&dto.credential_id, dto.counter, current_epoch_ms())?;
    Ok((
        StatusCode::OK,
        Json(build_session_response(
            Some(&account),
            session,
            Some("passkey"),
            Some(false),
        )),
    )
        .into_response())
}

pub(crate) async fn request_email_verification_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
) -> ApiResult {
    let now_ms = current_epoch_ms();
    let issued =
        state
            .store
            .issue_email_verification_token(&principal, now_ms, 24 * 60 * 60 * 1000)?;
    let job_id = format!("emailverify-{}-{now_ms}", issued.account_id);
    enqueue_outbox_durable_and_memory(
        &state,
        &job_id,
        &issued.account_id,
        "email_verification",
        json!({
            "email": issued.email,
            "subject": "Verify your Syllabus.build email address",
            "expires_at_ms": issued.expires_at_ms,
            "verification_code": issued.token,
        }),
        now_ms,
    )
    .await;

    let mut body = json!({
        "status": "sent",
        "email": issued.email,
        "expires_at_ms": issued.expires_at_ms,
    });
    if state.gates.env.is_local_dev_or_test() {
        body["dev_verification_code"] = json!(issued.token);
    }
    Ok((StatusCode::ACCEPTED, Json(body)).into_response())
}

#[derive(Debug, Deserialize)]
pub(crate) struct EmailVerificationConfirmDto {
    #[serde(alias = "token")]
    pub(crate) code: String,
}

pub(crate) async fn confirm_email_verification_handler(
    State(state): State<ApiAppState>,
    Json(dto): Json<EmailVerificationConfirmDto>,
) -> ApiResult {
    let account = state
        .store
        .confirm_email_verification_token(&dto.code, current_epoch_ms())?;
    Ok((
        StatusCode::OK,
        Json(json!({
            "account_id": account.account_id,
            "email": account.email,
            "email_verified": account.email_verified,
        })),
    )
        .into_response())
}

async fn enqueue_outbox_durable_and_memory(
    state: &ApiAppState,
    job_id: &str,
    account_id: &str,
    job_type: &str,
    payload: Value,
    now_ms: u64,
) {
    let _ = state
        .outbox
        .enqueue(job_id, account_id, job_type, payload.clone(), now_ms);
    if let Ok(db_url) = std::env::var("DATABASE_URL") {
        let trimmed = db_url.trim();
        if !trimmed.is_empty() {
            let _ = syllabus_persistence::enqueue_pg_outbox_job(
                trimmed, job_id, account_id, job_type, &payload,
            )
            .await;
        }
    }
}
