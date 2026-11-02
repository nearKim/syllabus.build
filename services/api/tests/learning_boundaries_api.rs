use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use syllabus_api::{build_router_with_state, ApiAppState};
use syllabus_security::{AppEnvironment, DevFixedIdentityAuthVerifier, ReleaseFeatureGates};
use tower::ServiceExt;

const USER_A: &str = "Bearer dev-account:00000000-0000-4000-8000-000000000001";
const USER_B: &str = "Bearer dev-account:00000000-0000-4000-8000-000000000002";

fn test_app() -> Router {
    let mut state = ApiAppState::new(ReleaseFeatureGates {
        env: AppEnvironment::Test,
        ..ReleaseFeatureGates::default()
    });
    state.auth_verifier = Arc::new(
        DevFixedIdentityAuthVerifier::new(
            AppEnvironment::Test,
            "00000000-0000-4000-8000-000000000001",
        )
        .unwrap(),
    );
    build_router_with_state(state)
}

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    payload: Value,
) -> (StatusCode, Value) {
    call_with_idempotency(app, method, path, token, payload, None).await
}

async fn call_with_idempotency(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> (StatusCode, Value) {
    let body = if payload.is_null() {
        Body::empty()
    } else {
        Body::from(payload.to_string())
    };
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", token)
        .header("content-type", "application/json");
    if let Some(key) = idempotency_key {
        request = request.header("idempotency-key", key);
    }
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn scoring_and_learning_ids_stay_server_owned() {
    let app = test_app();

    let (status, attempt) = call(
        &app,
        "POST",
        "/v1/assessments/assess-anchor-tokenization/attempts",
        USER_A,
        json!({
            "attempt_id": "att-security-collision",
            "score_bp": 10000,
            "responses": {"item-tok-1": "wrong", "item-tok-2": "wrong"}
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(attempt["score_bp"], 0);
    assert_eq!(attempt["passed"], false);

    let (status, _) = call(
        &app,
        "POST",
        "/v1/assessments/assess-anchor-tokenization/attempts",
        USER_B,
        json!({"attempt_id": "att-security-collision", "responses": {"item-tok-1": "bpe_subword"}}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, diagnostic) = call(
        &app,
        "POST",
        "/v1/diagnostics",
        USER_A,
        json!({"diagnostic_id": "diag-security-collision", "objective_ids": ["objective-tokenization"]}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(diagnostic.get("answer_key").is_none());
    let item_id = diagnostic["items"][0]["item_id"].as_str().unwrap();

    let (status, answered) = call(
        &app,
        "POST",
        "/v1/diagnostics/diag-security-collision/attempts",
        USER_A,
        json!({"item_id": item_id, "answer": "correct-objective-tokenization", "assistance_level": "independent"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(answered.get("answer_key").is_none());
    assert!(answered["granted_waiver_ids"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        answered["objective_states"]["objective-tokenization"],
        "needs_review"
    );

    let (status, fetched) = call(
        &app,
        "GET",
        "/v1/diagnostics/diag-security-collision",
        USER_A,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(fetched.get("answer_key").is_none());

    let (status, _) = call(
        &app,
        "POST",
        "/v1/diagnostics",
        USER_B,
        json!({"diagnostic_id": "diag-security-collision", "objective_ids": ["objective-tokenization"]}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = call(
        &app,
        "POST",
        "/v1/syllabi/cur-learner-a-1/adaptations/preview",
        USER_A,
        json!({"proposal_id": "prop-security-collision"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = call(
        &app,
        "POST",
        "/v1/syllabi/cur-learner-b-1/adaptations/preview",
        USER_B,
        json!({"proposal_id": "prop-security-collision"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn generated_learning_ids_are_distinct_across_accounts() {
    let app = test_app();
    let attempt_payload = json!({
        "responses": {"item-tok-1": "wrong", "item-tok-2": "wrong"}
    });
    let (status_a, attempt_a) = call_with_idempotency(
        &app,
        "POST",
        "/v1/assessments/assess-anchor-tokenization/attempts",
        USER_A,
        attempt_payload.clone(),
        Some("same-idempotency-key"),
    )
    .await;
    let (status_b, attempt_b) = call_with_idempotency(
        &app,
        "POST",
        "/v1/assessments/assess-anchor-tokenization/attempts",
        USER_B,
        attempt_payload,
        Some("same-idempotency-key"),
    )
    .await;
    assert_eq!(status_a, StatusCode::CREATED);
    assert_eq!(status_b, StatusCode::CREATED);
    assert_ne!(attempt_a["attempt_id"], attempt_b["attempt_id"]);

    let (status_a, diagnostic_a) = call(
        &app,
        "POST",
        "/v1/diagnostics",
        USER_A,
        json!({"objective_ids": ["objective-tokenization"]}),
    )
    .await;
    let (status_b, diagnostic_b) = call(
        &app,
        "POST",
        "/v1/diagnostics",
        USER_B,
        json!({"objective_ids": ["objective-tokenization"]}),
    )
    .await;
    assert_eq!(status_a, StatusCode::CREATED);
    assert_eq!(status_b, StatusCode::CREATED);
    assert_ne!(diagnostic_a["diagnostic_id"], diagnostic_b["diagnostic_id"]);

    let (status_a, proposal_a) = call(
        &app,
        "POST",
        "/v1/syllabi/cur-learner-a-1/adaptations/preview",
        USER_A,
        json!({}),
    )
    .await;
    let (status_b, proposal_b) = call(
        &app,
        "POST",
        "/v1/syllabi/cur-learner-b-1/adaptations/preview",
        USER_B,
        json!({}),
    )
    .await;
    assert_eq!(status_a, StatusCode::CREATED);
    assert_eq!(status_b, StatusCode::CREATED);
    assert_ne!(proposal_a["proposal_id"], proposal_b["proposal_id"]);
}

#[tokio::test]
async fn late_assistance_cannot_change_a_finalized_attempt() {
    let app = test_app();
    let (status, attempt) = call(
        &app,
        "POST",
        "/v1/assessments/assess-anchor-tokenization/attempts",
        USER_A,
        json!({
            "attempt_id": "att-finalized-assistance",
            "responses": {
                "item-tok-1": "bpe_subword",
                "item-tok-2": "overlap_window"
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(attempt["derived_proficiency_state"], "demonstrated");
    assert!(attempt["spaced_review_item_id"].is_string());

    let (status, _) = call(
        &app,
        "POST",
        "/v1/assessments/assess-anchor-tokenization/attempts/att-finalized-assistance/assistance",
        USER_A,
        json!({"assistance_level": "solution_studied"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = call(
        &app,
        "POST",
        "/v1/assessments/assess-anchor-vector-retrieval/attempts/att-finalized-assistance/assistance",
        USER_A,
        json!({"assistance_level": "solution_studied"}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, fetched) = call(
        &app,
        "GET",
        "/v1/assessment-attempts/att-finalized-assistance",
        USER_A,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetched, attempt);
}
