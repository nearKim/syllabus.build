//! Runnable HTTP API server binary with local development CORS/preflight support and readiness logging.

use axum::{
    extract::Request,
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use curriculum_api::build_router;
use curriculum_persistence::MIGRATIONS;
use curriculum_security::ReleaseFeatureGates;
use std::net::SocketAddr;

const ALLOW_METHODS: &str = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS: &str = "authorization, content-type, accept, origin, idempotency-key, if-match, x-dev-principal-id, x-dev-roles, x-stripe-signature";
const EXPOSE_HEADERS: &str = "etag, content-type, x-idempotent-replay";

fn apply_cors_headers(headers: &mut axum::http::HeaderMap, origin: Option<&HeaderValue>) {
    let allow_origin = origin
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("*"));
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
        HeaderValue::from_static("86400"),
    );
}

async fn local_dev_cors_middleware(req: Request, next: Next) -> Response {
    let origin = req.headers().get(header::ORIGIN).cloned();
    if req.method() == Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_cors_headers(response.headers_mut(), origin.as_ref());
        return response;
    }

    let mut response = next.run(req).await;
    apply_cors_headers(response.headers_mut(), origin.as_ref());
    response
}

pub fn build_server_app(gates: ReleaseFeatureGates) -> Router {
    build_router(gates).layer(middleware::from_fn(local_dev_cors_middleware))
}

#[tokio::main]
async fn main() {
    let addr: SocketAddr = std::env::var("API_BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()
        .expect("valid API_BIND_ADDR");
    let gates = ReleaseFeatureGates::default();
    let app = build_server_app(gates);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");
    let local_addr = listener.local_addr().unwrap_or(addr);
    println!(
        "curriculum-api listening on http://{} (migrations_embedded={}, release_stage=private_alpha)",
        local_addr,
        MIGRATIONS.len()
    );
    axum::serve(listener, app).await.expect("serve api");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    #[tokio::test]
    async fn server_app_handles_cors_options_preflight_and_exposes_etag_headers() {
        let app = build_server_app(ReleaseFeatureGates::default());

        let preflight_req = Request::builder()
            .method(Method::OPTIONS)
            .uri("/v1/curricula")
            .header(header::ORIGIN, "http://localhost:5173")
            .header(
                header::ACCESS_CONTROL_REQUEST_METHOD,
                "POST",
            )
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
    }
}
