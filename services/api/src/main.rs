//! Runnable HTTP API server binary with local development CORS/preflight support and readiness logging.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::{
    extract::Request,
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use syllabus_api::build_router;
use syllabus_persistence::MIGRATIONS;
use syllabus_security::ReleaseFeatureGates;

const DEFAULT_BIND_ADDR: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8080);
const ALLOW_METHODS: &str = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS: &str = "authorization, content-type, accept, origin, idempotency-key, if-match, x-dev-principal-id, x-dev-roles, x-stripe-signature, x-billing-signature, stripe-signature";
const EXPOSE_HEADERS: &str = "etag, content-type, idempotency-replayed, x-idempotent-replay";
const MAX_AGE_SECONDS: &str = "86400";

fn apply_cors_headers(headers: &mut HeaderMap, origin: Option<HeaderValue>) {
    let allow_origin = origin.unwrap_or_else(|| HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, allow_origin);
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(ALLOW_METHODS),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(ALLOW_HEADERS),
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

async fn local_dev_cors_middleware(req: Request, next: Next) -> Response {
    let origin = req.headers().get(header::ORIGIN).cloned();
    if req.method() == Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_cors_headers(response.headers_mut(), origin);
        return response;
    }

    let mut response = next.run(req).await;
    apply_cors_headers(response.headers_mut(), origin);
    response
}

/// Wraps the API router with the local development CORS and `OPTIONS` preflight middleware.
pub fn build_server_app(gates: ReleaseFeatureGates) -> Router {
    build_router(gates).layer(middleware::from_fn(local_dev_cors_middleware))
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
    let gates = ReleaseFeatureGates::default();
    let app = build_server_app(gates);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr().unwrap_or(addr);
    println!(
        "syllabus-api listening on http://{local_addr} (migrations_embedded={}, release_stage=private_alpha)",
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
}
