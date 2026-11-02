use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use syllabus_api::build_router;
use syllabus_security::{AppEnvironment, ReleaseFeatureGates};
use tower::ServiceExt;

#[tokio::test]
async fn runtime_test_mode_does_not_enable_fixture_authentication() {
    let gates = ReleaseFeatureGates {
        env: AppEnvironment::Test,
        ..ReleaseFeatureGates::default()
    };
    let app = build_router(gates);
    for token in [None, Some("Bearer dev-admin")] {
        let mut request = Request::builder().uri("/v1/me/syllabi");
        if let Some(token) = token {
            request = request.header("authorization", token);
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
