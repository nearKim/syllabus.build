//! HTTP API service router (`T00` baseline scaffold).

use axum::{routing::get, Json, Router};
use curriculum_application::build_readiness_report;
use curriculum_security::ReleaseFeatureGates;

pub fn build_router(gates: ReleaseFeatureGates) -> Router {
    Router::new().route(
        "/healthz",
        get(move || async move { Json(build_readiness_report(gates)) }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use curriculum_application::SystemReadinessReport;
    use curriculum_contracts::generated::CANONICAL_SPEC_SHA256;
    use tower::ServiceExt;

    #[tokio::test]
    async fn healthz_returns_spec_hash_and_visible_release_gates() {
        let app = build_router(ReleaseFeatureGates::default());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024)
            .await
            .unwrap();
        let report: SystemReadinessReport = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(report.status, "ok");
        assert_eq!(report.canonical_spec_sha256, CANONICAL_SPEC_SHA256);
        assert!(!report.release_gates.d11_production_auth_approved);
        assert!(!report.release_gates.d07_live_billing_enabled);
    }
}
