//! Runnable HTTP API server binary with environment-aware CORS/preflight enforcement,
//! security response headers, and readiness logging.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::{
    extract::Request,
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use syllabus_api::{build_router, build_router_from_env};
use syllabus_persistence::MIGRATIONS;
use syllabus_security::{AppEnvironment, ReleaseFeatureGates};

const DEFAULT_BIND_ADDR: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8080);
const ALLOW_METHODS: &str = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const DEV_ALLOW_HEADERS: &str = "authorization, content-type, accept, origin, idempotency-key, if-match, x-dev-principal-id, x-dev-roles, x-stripe-signature, x-billing-signature, stripe-signature";
const PROD_ALLOW_HEADERS: &str = "authorization, content-type, accept, origin, idempotency-key, if-match, x-stripe-signature, x-billing-signature, stripe-signature";
const EXPOSE_HEADERS: &str = "etag, content-type, idempotency-replayed, x-idempotent-replay";
const MAX_AGE_SECONDS: &str = "86400";

fn resolve_allowed_origins() -> Vec<String> {
    let mut allowed = Vec::new();
    if let Ok(raw) = std::env::var("CORS_ALLOWED_ORIGINS") {
        for item in raw.split(',') {
            let trimmed = item.trim().trim_end_matches('/');
            if !trimmed.is_empty() && !allowed.iter().any(|existing| existing == trimmed) {
                allowed.push(trimmed.to_string());
            }
        }
    }
    if let Ok(web_origin) = std::env::var("PUBLIC_WEB_ORIGIN") {
        let trimmed = web_origin.trim().trim_end_matches('/');
        if !trimmed.is_empty() && !allowed.iter().any(|existing| existing == trimmed) {
            allowed.push(trimmed.to_string());
        }
    }
    allowed
}

fn apply_security_and_cors_headers(
    headers: &mut HeaderMap,
    origin: Option<HeaderValue>,
    env: AppEnvironment,
) {
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    if env.is_local_dev_or_test() {
        let allow_origin = origin.unwrap_or_else(|| HeaderValue::from_static("*"));
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, allow_origin);
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(DEV_ALLOW_HEADERS),
        );
    } else {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        );
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        let allowed = resolve_allowed_origins();
        if let Some(origin_val) = origin {
            if let Ok(origin_str) = origin_val.to_str() {
                let normalized = origin_str.trim().trim_end_matches('/');
                if allowed
                    .iter()
                    .any(|candidate| candidate.eq_ignore_ascii_case(normalized))
                {
                    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin_val);
                }
            }
        }
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(PROD_ALLOW_HEADERS),
        );
    }

    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(ALLOW_METHODS),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static(EXPOSE_HEADERS),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static(MAX_AGE_SECONDS),
    );
}

async fn cors_and_security_middleware(env: AppEnvironment, req: Request, next: Next) -> Response {
    let origin = req.headers().get(header::ORIGIN).cloned();
    if req.method() == Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_security_and_cors_headers(response.headers_mut(), origin, env);
        return response;
    }

    let mut response = next.run(req).await;
    apply_security_and_cors_headers(response.headers_mut(), origin, env);
    response
}

/// Wraps the API router with environment-aware CORS, `OPTIONS` preflight, and security headers.
pub fn build_server_app(gates: ReleaseFeatureGates) -> Router {
    let env = gates.env;
    build_router(gates).layer(middleware::from_fn(move |req, next| {
        cors_and_security_middleware(env, req, next)
    }))
}

/// Wraps an environment-configured API router (PostgreSQL when `DATABASE_URL` is set) with CORS & security headers.
pub fn build_server_app_from_env(gates: ReleaseFeatureGates) -> std::io::Result<(Router, bool)> {
    let env = gates.env;
    let (router, is_pg) = build_router_from_env(gates)
        .map_err(|e| std::io::Error::other(format!("store bootstrap failed: {e}")))?;
    Ok((
        router.layer(middleware::from_fn(move |req, next| {
            cors_and_security_middleware(env, req, next)
        })),
        is_pg,
    ))
}

#[must_use]
fn resolve_bind_addr() -> SocketAddr {
    std::env::var("API_BIND_ADDR")
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(DEFAULT_BIND_ADDR)
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let addr = resolve_bind_addr();
    let gates = ReleaseFeatureGates::from_env();
    let (app, is_pg) = build_server_app_from_env(gates)?;
    let storage_mode = if is_pg { "postgres" } else { "in_memory" };
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr().unwrap_or(addr);
    println!(
        "syllabus-api listening on http://{local_addr} (env={:?}, storage={storage_mode}, migrations_embedded={})",
        gates.env,
        MIGRATIONS.len()
    );
    axum::serve(listener, app).await
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn server_app_handles_cors_options_preflight_and_exposes_etag_headers() {
        let app = build_server_app(ReleaseFeatureGates::default());

        let preflight_req = Request::builder()
            .method(Method::OPTIONS)
            .uri("/v1/syllabi")
            .header(header::ORIGIN, "http://localhost:5173")
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .body(Body::empty())
            .expect("build preflight request");

        let preflight_res = app
            .clone()
            .oneshot(preflight_req)
            .await
            .expect("execute preflight");
        assert_eq!(preflight_res.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            preflight_res
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|v| v.to_str().ok()),
            Some("http://localhost:5173")
        );
        assert_eq!(
            preflight_res
                .headers()
                .get(header::X_CONTENT_TYPE_OPTIONS)
                .and_then(|v| v.to_str().ok()),
            Some("nosniff")
        );
        let allow_headers = preflight_res
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert!(allow_headers.contains("idempotency-key"));
        assert!(allow_headers.contains("if-match"));
        assert!(allow_headers.contains("x-billing-signature"));
        assert!(allow_headers.contains("stripe-signature"));

        let health_req = Request::builder()
            .method(Method::GET)
            .uri("/healthz")
            .header(header::ORIGIN, "http://127.0.0.1:5173")
            .body(Body::empty())
            .expect("build healthz request");
        let health_res = app.oneshot(health_req).await.expect("execute healthz");
        assert_eq!(health_res.status(), StatusCode::OK);
        assert_eq!(
            health_res
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|v| v.to_str().ok()),
            Some("http://127.0.0.1:5173")
        );
        let expose_headers = health_res
            .headers()
            .get(header::ACCESS_CONTROL_EXPOSE_HEADERS)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert!(expose_headers.contains("etag"));
        assert!(expose_headers.contains("idempotency-replayed"));
    }

    #[tokio::test]
    async fn production_server_app_blocks_unlisted_cors_origins_and_disables_dev_auth_fallback() {
        let prod_gates = ReleaseFeatureGates {
            env: AppEnvironment::Production,
            d11_production_auth_approved: true,
            d07_live_billing_enabled: false,
            d16_public_sharing_enabled: false,
            d15_operative_license_approved: true,
        };
        let app = build_server_app(prod_gates);

        // Unlisted cross-origin request must NOT receive Access-Control-Allow-Origin: *
        let preflight_req = Request::builder()
            .method(Method::OPTIONS)
            .uri("/v1/syllabi")
            .header(header::ORIGIN, "https://evil.example.org")
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .body(Body::empty())
            .expect("build prod preflight");
        let preflight_res = app
            .clone()
            .oneshot(preflight_req)
            .await
            .expect("execute prod preflight");
        assert!(preflight_res
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert!(preflight_res
            .headers()
            .get(header::STRICT_TRANSPORT_SECURITY)
            .is_some());
        let prod_allow_headers = preflight_res
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert!(!prod_allow_headers.contains("x-dev-principal-id"));

        // Unauthenticated GET /v1/me/syllabi in Production must return 401 (no DevFixedIdentityAuthVerifier fallback!)
        let unauth_req = Request::builder()
            .method(Method::GET)
            .uri("/v1/me/syllabi")
            .body(Body::empty())
            .expect("build unauth req");
        let unauth_res = app
            .clone()
            .oneshot(unauth_req)
            .await
            .expect("execute unauth");
        assert_eq!(unauth_res.status(), StatusCode::UNAUTHORIZED);

        // Dev bearer token in Production must also return 401
        let dev_tok_req = Request::builder()
            .method(Method::GET)
            .uri("/v1/me/syllabi")
            .header(header::AUTHORIZATION, "Bearer dev-admin")
            .body(Body::empty())
            .expect("build dev token req");
        let dev_tok_res = app.oneshot(dev_tok_req).await.expect("execute dev token");
        assert_eq!(dev_tok_res.status(), StatusCode::UNAUTHORIZED);
    }
}
