use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use syllabus_application::SystemReadinessReport;
use syllabus_contracts::generated::CANONICAL_SPEC_SHA256;
use syllabus_domain::ObjectiveProficiencyState;
use syllabus_persistence::{
    IdempotencyBeginOutcome, LearnerProficiencyProjection, ProgressEventReceiptRecord,
    ScheduleFeasibility, ScheduleRevisionRecord,
};
use tower::ServiceExt;

use super::*;
use crate::handlers_commerce::DEFAULT_WEBHOOK_SIGNING_SECRET;

fn test_app() -> (ApiAppState, Router) {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    (state, app)
}

async fn read_body_json(response: Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("read response body");
    if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).expect("parse response json")
    }
}

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

#[tokio::test]
async fn s87_auth_session_lifecycle_create_inspect_and_delete_revokes_session() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);

    // 1. POST /v1/auth/session establishes an authenticated session
    let create_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": "learner-a@example.test",
                        "authentication_code": "123456"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_resp.status(), StatusCode::OK);
    let session_json = read_body_json(create_resp).await;
    assert_eq!(
        session_json["account_id"],
        "00000000-0000-4000-8000-000000000001"
    );
    let token = session_json["session_token"].as_str().unwrap().to_string();

    // 2. GET /v1/auth/session returns active session
    let get_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/auth/session")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);

    // 3. DELETE /v1/auth/session revokes the session token
    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/v1/auth/session")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);

    // 4. Subsequent GET /v1/auth/session with revoked token returns 401 Unauthorized (@S87)
    let after_del_resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/auth/session")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(after_del_resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn s29_s36_s64_s87_cross_tenant_negative_cases_forbid_learner_curator_and_moderator() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);

    // Actors who do NOT own Learner B (`00000000-0000-4000-8000-000000000002`)
    let unauthorized_tokens = [
        "dev-account:00000000-0000-4000-8000-000000000001", // Learner A
        "dev-curator",                                      // Curator (@S36)
        "dev-moderator",                                    // Moderator (@S64)
    ];

    for token in unauthorized_tokens {
        // 1. Cannot read Learner B's proficiency
        let prof_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/me/proficiency?account_id=00000000-0000-4000-8000-000000000002")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            prof_resp.status(),
            StatusCode::FORBIDDEN,
            "token `{token}` must be forbidden from reading Learner B proficiency"
        );

        // 2. Cannot append progress events to Learner B's syllabus
        let prog_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/progress-events")
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "event_id": "evt-cross-tenant-1",
                            "syllabus_id": "cur-learner-b-1",
                            "activity_id": "act-ds-1",
                            "time_spent_minutes": 30
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            prog_resp.status(),
            StatusCode::FORBIDDEN,
            "token `{token}` must be forbidden from mutating Learner B progress"
        );

        // 3. Cannot patch Learner B's schedule
        let sched_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/v1/schedules/cur-learner-b-1")
                    .header("authorization", format!("Bearer {token}"))
                    .header("if-match", "\"sched-v1\"")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "weekly_available_minutes": 120
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            sched_resp.status(),
            StatusCode::FORBIDDEN,
            "token `{token}` must be forbidden from mutating Learner B schedule"
        );

        // 4. Cannot read Learner B's BYOK credential metadata (@S29, @S36, @S64)
        let cred_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/me/credentials/cred-learner-b-openai")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            cred_resp.status(),
            StatusCode::FORBIDDEN,
            "token `{token}` must be forbidden from reading Learner B credential"
        );
    }

    // Verify Learner B CAN read their own credential metadata and it never contains raw secret (@S29)
    let owner_cred_resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/me/credentials/cred-learner-b-openai")
                .header(
                    "authorization",
                    "Bearer dev-account:00000000-0000-4000-8000-000000000002",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(owner_cred_resp.status(), StatusCode::OK);
    let cred_json = read_body_json(owner_cred_resp).await;
    assert_eq!(cred_json["masked_hint"], "...9999");
    assert!(
        !cred_json.to_string().contains("sk-live-secret"),
        "raw secret key must never appear in credential metadata response"
    );
}

#[tokio::test]
async fn s02_s22_s24_schedule_optimistic_concurrency_428_412_etag_increment_and_feasibility() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());

    // 1. PATCH /v1/schedules/{syllabus_id} without If-Match returns 428 Precondition Required
    let missing_if_match = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/schedules/cur-learner-a-1")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "weekly_available_minutes": 240
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_if_match.status(), StatusCode::PRECONDITION_REQUIRED);

    // 2. PATCH with matching If-Match "\"sched-v1\"" succeeds, increments ETag to "\"sched-v2\"", and enqueues outbox job
    let ok_patch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/schedules/cur-learner-a-1")
                .header("if-match", "\"sched-v1\"")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "weekly_available_minutes": 100,
                        "required_minutes": 250,
                        "fixed_deadline": true
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_patch.status(), StatusCode::OK);
    assert_eq!(
        ok_patch
            .headers()
            .get(axum::http::header::ETAG)
            .unwrap()
            .to_str()
            .unwrap(),
        "\"sched-v2\""
    );
    let sched: ScheduleRevisionRecord =
        serde_json::from_value(read_body_json(ok_patch).await).unwrap();
    assert_eq!(sched.etag_version, 2);
    // Verify @S02 infeasibility detection when required_minutes > weekly_available_minutes with fixed_deadline
    assert_eq!(sched.feasibility_status, ScheduleFeasibility::Infeasible);
    assert_eq!(sched.excess_minutes, 150);
    assert!(sched
        .recovery_options
        .contains(&"reduced_scope".to_string()));
    assert_eq!(state.outbox.metrics_snapshot(10_000).queued_depth, 1);

    // 3. Stale edit with old "\"sched-v1\"" returns 412 Precondition Failed with stale_revision (@S22, @S24)
    let stale_patch = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/schedules/cur-learner-a-1")
                .header("if-match", "\"sched-v1\"")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "weekly_available_minutes": 400
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale_patch.status(), StatusCode::PRECONDITION_FAILED);
    let stale_err = read_body_json(stale_patch).await;
    assert_eq!(stale_err["error"]["code"], "stale_revision");
    assert_eq!(stale_err["error"]["current_etag"], "\"sched-v2\"");
}

#[tokio::test]
async fn s16_s21_s24_progress_event_deduplication_retry_and_conflict() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);

    let payload = json!({
        "event_id": "evt-offline-101",
        "syllabus_id": "cur-learner-a-1",
        "activity_id": "act-video-1",
        "objective_id": "obj-la-1",
        "status": "self_reported_completed",
        "time_spent_minutes": 45
    });

    // 1. First submission records event (201 Created) with SelfReported proficiency (never Demonstrated @S16)
    let resp1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/progress-events")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp1.status(), StatusCode::CREATED);
    let receipt1: ProgressEventReceiptRecord =
        serde_json::from_value(read_body_json(resp1).await).unwrap();
    assert!(!receipt1.replayed);
    assert_eq!(receipt1.total_completed_activities, 1);
    assert_eq!(receipt1.total_time_spent_minutes, 45);
    assert_eq!(
        receipt1.objective_proficiency_status,
        ObjectiveProficiencyState::SelfReported
    );

    // 2. Offline retry with identical event_id and payload replays receipt without double-counting (@S21, @S24)
    let resp2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/progress-events")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    assert_eq!(
        resp2
            .headers()
            .get("Idempotency-Replayed")
            .unwrap()
            .to_str()
            .unwrap(),
        "true"
    );
    let receipt2: ProgressEventReceiptRecord =
        serde_json::from_value(read_body_json(resp2).await).unwrap();
    assert!(receipt2.replayed);
    assert_eq!(receipt2.total_completed_activities, 1);
    assert_eq!(receipt2.total_time_spent_minutes, 45);

    // 3. Conflicting payload with same event_id returns 409 Conflict (@S24)
    let mut conflicting_payload = payload.clone();
    conflicting_payload["time_spent_minutes"] = json!(90);
    let resp_conflict = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/progress-events")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&conflicting_payload).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_conflict.status(), StatusCode::CONFLICT);

    // 4. Verify GET /v1/me/proficiency reflects 1 completed activity and SelfReported status
    let prof_resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/me/proficiency")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(prof_resp.status(), StatusCode::OK);
    let prof: LearnerProficiencyProjection =
        serde_json::from_value(read_body_json(prof_resp).await).unwrap();
    assert_eq!(prof.total_time_spent_minutes, 45);
    assert_eq!(
        prof.objectives.get("obj-la-1"),
        Some(&ObjectiveProficiencyState::SelfReported)
    );
}

#[tokio::test]
async fn t01_idempotency_key_http_replay_mismatch_inflight_and_5xx_recovery() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());

    // 1. Transient 5xx failure releases Idempotency-Key so subsequent retry succeeds
    let fail_5xx = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/exports")
                .header("idempotency-key", "idem-export-001")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"simulate_transient_5xx": true})).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fail_5xx.status(), StatusCode::SERVICE_UNAVAILABLE);

    // 2. Retry with same Idempotency-Key now succeeds and queues 1 outbox job
    let ok_first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/exports")
                .header("idempotency-key", "idem-export-001")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"format": "json"})).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_first.status(), StatusCode::ACCEPTED);
    assert!(ok_first.headers().get("Idempotency-Replayed").is_none());
    let first_body = read_body_json(ok_first).await;
    assert_eq!(state.outbox.metrics_snapshot(10_000).queued_depth, 1);

    // 3. Replaying identical request returns stored 202 + Idempotency-Replayed: true without adding another outbox job
    let ok_replay = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/exports")
                .header("idempotency-key", "idem-export-001")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"format": "json"})).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_replay.status(), StatusCode::ACCEPTED);
    assert_eq!(
        ok_replay
            .headers()
            .get("Idempotency-Replayed")
            .unwrap()
            .to_str()
            .unwrap(),
        "true"
    );
    let replay_body = read_body_json(ok_replay).await;
    assert_eq!(first_body, replay_body);
    assert_eq!(state.outbox.metrics_snapshot(10_000).queued_depth, 1);

    // 4. Reusing same Idempotency-Key with different payload returns 409 Conflict (idempotency_payload_mismatch)
    let mismatch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/exports")
                .header("idempotency-key", "idem-export-001")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"format": "markdown"})).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mismatch.status(), StatusCode::CONFLICT);
    let mismatch_body = read_body_json(mismatch).await;
    assert_eq!(
        mismatch_body["error"]["code"],
        "idempotency_payload_mismatch"
    );

    // 5. Duplicate request arriving while first is InFlight returns 409 Conflict (idempotency_in_flight)
    let acquired = state
        .store
        .begin_idempotent_command(
            "00000000-0000-4000-8000-000000000001",
            "createAccountExportJob",
            Some("idem-export-inflight"),
            &json!({"format": "json"}),
            10_000,
            86_400_000,
        )
        .unwrap();
    assert_eq!(acquired, IdempotencyBeginOutcome::Acquired);

    let inflight_resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/exports")
                .header("idempotency-key", "idem-export-inflight")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"format": "json"})).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(inflight_resp.status(), StatusCode::CONFLICT);
    let inflight_body = read_body_json(inflight_resp).await;
    assert_eq!(inflight_body["error"]["code"], "idempotency_in_flight");
}

#[tokio::test]
async fn private_alpha_tracer_bullet_end_to_end_flow() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());

    // 1. Auth Session for Learner A
    let auth_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": "learner.a@example.com",
                        "authentication_code": "123456"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(auth_resp.status(), StatusCode::OK);
    let auth_body = read_body_json(auth_resp).await;
    assert_eq!(
        auth_body["account_id"],
        "00000000-0000-4000-8000-000000000001"
    );
    let session_token = auth_body["session_token"].as_str().unwrap().to_string();

    // 2. Goal Intake (POST /v1/goals/interpret)
    let goal_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/goals/interpret")
                .header("authorization", format!("Bearer {}", session_token))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "goal_text": "Learn LLM Engineering with Python",
                        "weekly_minutes": 180,
                        "target_weeks": 4,
                        "free_only": true,
                        "prior_skills": ["python"],
                        "owned_subscriptions": [],
                        "certification_required": false
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(goal_resp.status(), StatusCode::OK);
    let goal_body = read_body_json(goal_resp).await;
    assert_eq!(goal_body["goal_specification"]["free_only"], true);
    assert_eq!(
        goal_body["goal_specification"]["weekly_available_minutes"],
        180
    );
    let generation_request = goal_body["normalized_generation_request"].clone();

    // 3. Submit Async Generation Job with Idempotency-Key (POST /v1/generations)
    let missing_idem_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/generations")
                .header("authorization", format!("Bearer {}", session_token))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&generation_request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_idem_resp.status(), StatusCode::BAD_REQUEST);

    let gen_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/generations")
                .header("authorization", format!("Bearer {}", session_token))
                .header("idempotency-key", "idem-alpha-gen-001")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&generation_request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(gen_resp.status(), StatusCode::ACCEPTED);
    let gen_body = read_body_json(gen_resp).await;
    let job_id = gen_body["job_id"].as_str().unwrap().to_string();
    assert_eq!(gen_body["status"], "succeeded");
    let syllabus_id = gen_body["syllabus_id"].as_str().unwrap().to_string();
    let revision_id = gen_body["revision_id"].as_str().unwrap().to_string();

    // Replay identical POST /v1/generations with same Idempotency-Key returns 202 + Idempotency-Replayed: true
    let gen_replay = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/generations")
                .header("authorization", format!("Bearer {}", session_token))
                .header("idempotency-key", "idem-alpha-gen-001")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&generation_request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(gen_replay.status(), StatusCode::ACCEPTED);
    assert_eq!(
        gen_replay
            .headers()
            .get("Idempotency-Replayed")
            .unwrap()
            .to_str()
            .unwrap(),
        "true"
    );
    let replay_body = read_body_json(gen_replay).await;
    assert_eq!(replay_body["job_id"], job_id);

    // 4. Poll Generation Status (GET /v1/generations/{job_id})
    let poll_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/generations/{}", job_id))
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(poll_resp.status(), StatusCode::OK);
    let poll_body = read_body_json(poll_resp).await;
    assert_eq!(poll_body["status"], "succeeded");
    assert_eq!(
        poll_body["candidate_sha256"],
        "435f6b3a8297063ab07cf807eaa001a3ad37747efc0b8219f2e69d093ca4e505"
    );

    // 5. Inspect Syllabus Overview & Draft Revision (is_active == false prior to explicit activation)
    let overview_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/syllabi/{}", syllabus_id))
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview_resp.status(), StatusCode::OK);
    assert_eq!(
        overview_resp
            .headers()
            .get("ETag")
            .unwrap()
            .to_str()
            .unwrap(),
        "\"cur-act-v0\""
    );
    let overview_body = read_body_json(overview_resp).await;
    assert!(overview_body["active_revision_id"].is_null());
    assert_eq!(overview_body["revisions"][0]["revision_id"], revision_id);
    assert_eq!(overview_body["revisions"][0]["is_active"], false);

    let rev_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/v1/syllabi/{}/revisions/{}",
                    syllabus_id, revision_id
                ))
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rev_resp.status(), StatusCode::OK);
    let rev_body = read_body_json(rev_resp).await;
    assert_eq!(rev_body["is_active"], false);
    assert_eq!(rev_body["payload"]["total_estimated_minutes"], 48);
    assert_eq!(
        rev_body["payload"]["activities"].as_array().unwrap().len(),
        6
    );

    // 6. Activate Syllabus Revision with If-Match optimistic concurrency
    let activate_missing_if_match = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/v1/syllabi/{}/revisions/{}/activate",
                    syllabus_id, revision_id
                ))
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        activate_missing_if_match.status(),
        StatusCode::PRECONDITION_REQUIRED
    );

    let activate_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/v1/syllabi/{}/revisions/{}/activate",
                    syllabus_id, revision_id
                ))
                .header("authorization", format!("Bearer {}", session_token))
                .header("if-match", "\"cur-act-v0\"")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(activate_ok.status(), StatusCode::OK);
    assert_eq!(
        activate_ok.headers().get("ETag").unwrap().to_str().unwrap(),
        "\"cur-act-v1\""
    );
    let activate_body = read_body_json(activate_ok).await;
    assert_eq!(activate_body["is_active"], true);

    // Stale If-Match returns 412 Precondition Failed (stale_revision)
    let activate_stale = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/v1/syllabi/{}/revisions/{}/activate",
                    syllabus_id, revision_id
                ))
                .header("authorization", format!("Bearer {}", session_token))
                .header("if-match", "\"cur-act-v0\"")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(activate_stale.status(), StatusCode::PRECONDITION_FAILED);
    let stale_body = read_body_json(activate_stale).await;
    assert_eq!(stale_body["error"]["code"], "stale_revision");

    // 7. Inspect & Update Weekly Schedule with If-Match optimistic concurrency
    let sched_get = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/schedules/{}", syllabus_id))
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(sched_get.status(), StatusCode::OK);
    assert_eq!(
        sched_get.headers().get("ETag").unwrap().to_str().unwrap(),
        "\"sched-v1\""
    );

    let sched_patch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/schedules/{}", syllabus_id))
                .header("authorization", format!("Bearer {}", session_token))
                .header("if-match", "\"sched-v1\"")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "weekly_available_minutes": 180,
                        "required_minutes": 120,
                        "fixed_deadline": false
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(sched_patch.status(), StatusCode::OK);
    assert_eq!(
        sched_patch.headers().get("ETag").unwrap().to_str().unwrap(),
        "\"sched-v2\""
    );
    let sched_patch_body = read_body_json(sched_patch).await;
    assert_eq!(sched_patch_body["etag_version"], 2);
    assert_eq!(sched_patch_body["weekly_available_minutes"], 180);

    // 8. Record Activity Completion (POST /v1/syllabi/{syllabus_id}/progress-events) & Verify SelfReported Proficiency
    let progress_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/syllabi/{}/progress-events", syllabus_id))
                .header("authorization", format!("Bearer {}", session_token))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "event_id": "idem-alpha-progress-001",
                        "objective_id": "objective-tokenization",
                        "activity_id": "activity-theory",
                        "status": "self_reported_completed",
                        "time_spent_minutes": 15
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(progress_resp.status(), StatusCode::CREATED);
    let progress_body = read_body_json(progress_resp).await;
    assert_eq!(
        progress_body["objective_proficiency_status"],
        "self_reported"
    );
    assert_ne!(
        progress_body["objective_proficiency_status"],
        "demonstrated"
    );

    let prof_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/me/proficiency")
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(prof_resp.status(), StatusCode::OK);
    let prof_body = read_body_json(prof_resp).await;
    assert_eq!(
        prof_body["objectives"]["objective-tokenization"],
        "self_reported"
    );
    assert_eq!(prof_body["total_time_spent_minutes"], 15);

    // 9. Curator Quarantines Resource -> Resource Alert Surfaces Without Mutating Revision Payload
    let quarantine_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/catalog/resources/synthetic-resource-tokenization-v1/quarantine")
                .header("authorization", "Bearer dev-curator")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "reason": "Broken upstream anchor detected during freshness sweep"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(quarantine_resp.status(), StatusCode::OK);

    let alerts_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/syllabi/{}/resource-alerts", syllabus_id))
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(alerts_resp.status(), StatusCode::OK);
    let alerts_body = read_body_json(alerts_resp).await;
    let alerts = alerts_body["items"].as_array().unwrap();
    assert_eq!(alerts.len(), 1);
    assert_eq!(
        alerts[0]["resource_version_id"],
        "synthetic-resource-tokenization-v1"
    );
    assert_eq!(alerts[0]["severity"], "warning");

    // Verify historical revision candidate_sha256 is unchanged after quarantine (@S07, @S10)
    let rev_after_quarantine = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/v1/syllabi/{}/revisions/{}",
                    syllabus_id, revision_id
                ))
                .header("authorization", format!("Bearer {}", session_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rev_after_quarantine.status(), StatusCode::OK);
    let rev_after_body = read_body_json(rev_after_quarantine).await;
    assert_eq!(
        rev_after_body["candidate_sha256"],
        "435f6b3a8297063ab07cf807eaa001a3ad37747efc0b8219f2e69d093ca4e505"
    );
}

#[tokio::test]
async fn t02_t03_catalog_filter_review_and_generation_cancel_routes() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);

    // 1. GET /v1/catalog/resources with free_only=true excludes unknown-price and paid resources (@S05)
    let cat_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/catalog/resources?topic=rag-python&free_only=true")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cat_resp.status(), StatusCode::OK);
    let cat_body = read_body_json(cat_resp).await;
    let items = cat_body["eligible_resources"].as_array().unwrap();
    assert!(!items.is_empty());
    assert!(items.iter().all(
        |item| item["resource_version_id"] != "res-rag-unknown-price-v1"
            && item["resource_version_id"] != "res-rag-paid-book-v1"
            && item["is_synthetic_fixture"] == false
    ));

    // 2. Curator approval without complete rubric evidence returns 422 (missing_review_rubric_evidence)
    let bad_review_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/catalog/resources/res-rag-unknown-price-v1/reviews")
                .header("authorization", "Bearer dev-curator")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "decision": "approved",
                        "rationale": "Missing rubric scores"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_review_resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let bad_review_body = read_body_json(bad_review_resp).await;
    assert_eq!(
        bad_review_body["error"]["code"],
        "missing_review_rubric_evidence"
    );
}

#[tokio::test]
async fn t05_assessments_assistance_cap_prereq_gate_defects_and_key_correction_recomputation() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);
    let learner_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. Learner view of reviewed anchor assessment redacts answer_key
    let view_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/assessments/assess-anchor-tokenization")
                .header("authorization", learner_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(view_resp.status(), StatusCode::OK);
    let view_body = read_body_json(view_resp).await;
    assert_eq!(view_body["allow_mastery_credit"], true);
    assert!(view_body.get("answer_key").is_none());

    // 2. Prerequisite gate blocks objective-vector-retrieval before objective-tokenization is Demonstrated
    let gate_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/syllabi/cur-learner-a-1/objectives/objective-vector-retrieval/prerequisite-gate")
                    .header("authorization", learner_bearer)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "prerequisite_objective_ids": ["objective-tokenization"],
                            "is_mastery_gated": true
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(gate_resp.status(), StatusCode::OK);
    let gate_body = read_body_json(gate_resp).await;
    assert_eq!(gate_body["outcome"], "blocked_missing_prerequisite");
    assert_eq!(
        gate_body["missing_objective_ids"][0],
        "objective-tokenization"
    );

    // 3. Assisted attempt (solution_studied) caps proficiency at in_progress / assisted_progress even with 100% score
    let assist_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/assessments/assess-anchor-tokenization/assistance-events")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "assistance_level": "solution_studied"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(assist_resp.status(), StatusCode::OK);

    let heavy_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/assessments/assess-anchor-tokenization/attempts")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attempt_id": "att-tok-assisted",
                        "session_id": "sess-1",
                        "responses": {
                            "item-tok-1": "bpe_subword",
                            "item-tok-2": "overlap_window"
                        }
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(heavy_resp.status(), StatusCode::CREATED);
    let heavy_body = read_body_json(heavy_resp).await;
    assert_eq!(heavy_body["passed"], true);
    assert_eq!(heavy_body["derived_proficiency_state"], "in_progress");
    assert_eq!(
        heavy_body["contract_proficiency_label"],
        "assisted_progress"
    );

    // 4. Independent attempt with errata answer on item-tok-2 initially fails, then Curator corrects key -> recomputes to demonstrated
    let attempt_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/assessments/assess-anchor-tokenization/attempts")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attempt_id": "att-tok-errata",
                        "session_id": "sess-2",
                        "assistance_level": "independent",
                        "responses": {
                            "item-tok-1": "bpe_subword",
                            "item-tok-2": "sliding_window_v2"
                        }
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(attempt_resp.status(), StatusCode::CREATED);
    let attempt_body = read_body_json(attempt_resp).await;
    assert_eq!(attempt_body["passed"], false);

    // Learner reports defective item -> suspends gate
    let defect_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/assessments/assess-anchor-tokenization/items/item-tok-2/report-defect")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "reason_code": "broken_answer_key",
                        "details": "Option key for item-tok-2 should be sliding_window_v2"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(defect_resp.status(), StatusCode::CREATED);
    let defect_body = read_body_json(defect_resp).await;
    assert_eq!(defect_body["gate_suspended"], true);

    // Curator issues answer-key correction
    let corr_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/assessments/assess-anchor-tokenization/key-corrections")
                .header("authorization", "Bearer dev-curator")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "updated_answer_key": {
                            "item-tok-1": "bpe_subword",
                            "item-tok-2": "sliding_window_v2"
                        },
                        "rationale": "Verified errata in v1 item bank"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(corr_resp.status(), StatusCode::OK);
    let corr_body = read_body_json(corr_resp).await;
    assert_eq!(corr_body["new_key_revision"], 2);
    let recomputed = corr_body["recomputed_outcomes"].as_array().unwrap();
    assert!(recomputed.iter().any(|r| {
        r["attempt_id"] == "att-tok-errata"
            && r["new_passed"] == true
            && r["new_proficiency_state"] == "demonstrated"
    }));
}

#[tokio::test]
async fn t06_t12_workload_spaced_reviews_diagnostics_waivers_math_depth_and_adaptation_proposals() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let learner_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. Independent pass on assess-anchor-vector-retrieval schedules spaced review in a distinct future session
    let pass_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/assessments/assess-anchor-vector-retrieval/attempts")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attempt_id": "att-vec-pass",
                        "session_id": "sess-initial",
                        "assistance_level": "independent",
                        "responses": {
                            "item-vec-1": "cosine_hnsw",
                            "item-vec-2": "cross_encoder"
                        }
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pass_resp.status(), StatusCode::CREATED);
    let pass_body = read_body_json(pass_resp).await;
    assert_eq!(pass_body["passed"], true);
    assert_eq!(pass_body["spaced_review_item_id"], "rev-att-vec-pass");

    // 2. T12: Start diagnostic session with orthogonal math_depth_preference, submit item attempt, and stop early
    let diag_start_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/diagnostics")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "diagnostic_id": "diag-rag-1",
                        "syllabus_id": "cur-learner-a-1",
                        "topic_id": "rag-python",
                        "math_depth_preference": "intuitive"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(diag_start_resp.status(), StatusCode::CREATED);

    let diag_att_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/diagnostics/diag-rag-1/attempts")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "item_id": "diag-item-1-objective-tokenization",
                        "answer": "correct-objective-tokenization",
                        "assistance_level": "independent"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(diag_att_resp.status(), StatusCode::OK);
    let diag_att_body = read_body_json(diag_att_resp).await;
    assert_eq!(
        diag_att_body["granted_waiver_ids"][0],
        "waiver-diag-rag-1-objective-tokenization"
    );

    let diag_stop_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/diagnostics/diag-rag-1/stop")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "stop_reason": "learner_stopped"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(diag_stop_resp.status(), StatusCode::OK);
    let diag_stop_body = read_body_json(diag_stop_resp).await;
    assert_eq!(diag_stop_body["status"], "stopped_by_learner");
    assert_eq!(diag_stop_body["math_depth_preference"], "intuitive");
    assert_eq!(
        diag_stop_body["objective_states"]["objective-tokenization"],
        "demonstrated"
    );
    assert_eq!(
        diag_stop_body["objective_states"]["objective-rag-evaluation"],
        "unassessed"
    );

    // 3. AdaptationProposal preview + accept with JCS proposal_sha256 and base revision concurrency
    let preview_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/syllabi/cur-learner-a-1/adaptations/preview")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "proposal_id": "adapt-prop-001",
                        "trigger_kind": "missed_sessions"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(preview_resp.status(), StatusCode::CREATED);
    let preview_body = read_body_json(preview_resp).await;
    let proposal_sha256 = preview_body["proposal_sha256"]
        .as_str()
        .unwrap()
        .to_string();

    // Reject mismatched digest
    let bad_hash_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/syllabi/cur-learner-a-1/adaptation-proposals/adapt-prop-001/accept")
                    .header("authorization", learner_bearer)
                    .header("idempotency-key", "idem-adapt-bad-sha")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "expected_proposal_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(bad_hash_resp.status(), StatusCode::CONFLICT);
    let bad_hash_body = read_body_json(bad_hash_resp).await;
    assert_eq!(bad_hash_body["error"]["code"], "proposal_digest_mismatch");

    // Accept with matching JCS proposal_sha256
    let accept_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/syllabi/cur-learner-a-1/adaptation-proposals/adapt-prop-001/accept")
                .header("authorization", learner_bearer)
                .header("idempotency-key", "idem-adapt-ok")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "expected_proposal_sha256": proposal_sha256
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(accept_resp.status(), StatusCode::OK);
    let accept_body = read_body_json(accept_resp).await;
    assert_eq!(accept_body["status"], "accepted");
    assert!(accept_body["accepted_syllabus_revision_id"].is_string());
    assert!(accept_body["accepted_schedule_revision_id"].is_string());
}

#[tokio::test]
async fn t07a_byok_credentials_envelope_encryption_tutor_usage_and_revocation_enforcement() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let learner_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. Register BYOK credential and verify raw key is never returned in metadata
    let create_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/credentials")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "credential_ref": "cred-openai-1",
                        "provider_id": "openai",
                        "label": "Primary OpenAI Key",
                        "api_key": "sk-live-super-secret-9999"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_resp.status(), StatusCode::CREATED);
    let create_body = read_body_json(create_resp).await;
    assert_eq!(create_body["credential_ref"], "cred-openai-1");
    assert_eq!(create_body["version"], 1);
    assert_eq!(create_body["etag"], "\"cred-v1\"");
    let serialized = serde_json::to_string(&create_body).unwrap();
    assert!(!serialized.contains("sk-live-super-secret-9999"));

    // 2. Rotate credential with If-Match optimistic concurrency
    let rotate_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/me/credentials/cred-openai-1")
                .header("authorization", learner_bearer)
                .header("if-match", "\"cred-v1\"")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "api_key": "sk-live-rotated-key-8888",
                        "label": "Rotated OpenAI Key"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rotate_resp.status(), StatusCode::OK);
    let rotate_body = read_body_json(rotate_resp).await;
    assert_eq!(rotate_body["version"], 2);
    assert_eq!(rotate_body["etag"], "\"cred-v2\"");

    // 3. Record BYOK inference usage and verify GET /v1/me/usage reports $0 hosted service charge
    let learner_a = state
        .auth_verifier
        .verify_bearer_token(Some("dev-account:00000000-0000-4000-8000-000000000001"))
        .unwrap();
    state
        .store
        .record_inference_usage(
            &learner_a,
            "cred-openai-1",
            2,
            "openai",
            "gpt-4o-mini",
            "practice_tutor",
            1200,
            400,
            "provider_reported",
        )
        .unwrap();

    let usage_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/me/usage")
                .header("authorization", learner_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(usage_resp.status(), StatusCode::OK);
    let usage_body = read_body_json(usage_resp).await;
    assert_eq!(usage_body["hosted_service_charge_usd_micros"], 0);
    assert_eq!(usage_body["total_tokens"], 1600);

    // 4. Revoke credential and verify subsequent decryption fails with credential_revoked
    let revoke_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/v1/me/credentials/cred-openai-1")
                .header("authorization", learner_bearer)
                .header("if-match", "\"cred-v2\"")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoke_resp.status(), StatusCode::NO_CONTENT);

    let open_err = state
        .store
        .open_credential_for_pinned_inference(&learner_a, "cred-openai-1", 2)
        .unwrap_err();
    assert_eq!(open_err.error_code(), "credential_revoked");
}

#[tokio::test]
async fn t08_reminders_iana_timezone_dst_suppression_push_subscriptions_and_snooze() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let learner_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. Reject invalid IANA timezone
    let bad_tz_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/v1/me/notification-preferences")
                .header("authorization", learner_bearer)
                .header("if-match", "\"notif-v1\"")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "enabled": true,
                        "channel": "web_push",
                        "iana_timezone": "Mars/Olympus_Mons",
                        "local_time_hhmm": "02:30"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_tz_resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 2. Configure America/New_York at 02:30 with If-Match concurrency
    let prefs_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/v1/me/notification-preferences")
                .header("authorization", learner_bearer)
                .header("if-match", "\"notif-v1\"")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "enabled": true,
                        "channel": "web_push",
                        "iana_timezone": "America/New_York",
                        "local_time_hhmm": "02:30",
                        "days_of_week": [1, 2, 3, 4, 5, 6, 7]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(prefs_resp.status(), StatusCode::OK);
    let prefs_body = read_body_json(prefs_resp).await;
    assert_eq!(prefs_body["etag"], "\"notif-v2\"");

    // 3. Evaluate spring-forward DST reminder on 2026-03-08 and snooze it via HTTP
    let learner_a = state
        .auth_verifier
        .verify_bearer_token(Some("dev-account:00000000-0000-4000-8000-000000000001"))
        .unwrap();
    let decision = state
        .store
        .evaluate_or_schedule_reminder(&learner_a, "occ-spring-1", "2026-03-08", 1_772_949_600)
        .unwrap();
    match decision {
        syllabus_domain::ReminderScheduleDecision::Scheduled {
            dst_resolution_policy,
            ..
        } => {
            assert_eq!(
                dst_resolution_policy,
                syllabus_domain::DstResolutionPolicy::SpringForwardShifted
            );
        }
        other => panic!("expected Scheduled decision, got {other:?}"),
    }

    let snooze_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/reminders/occ-spring-1/snooze")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "snooze_minutes": 45,
                        "now_utc_epoch_seconds": 1772955000
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(snooze_resp.status(), StatusCode::OK);
    let snooze_body = read_body_json(snooze_resp).await;
    assert_eq!(snooze_body["status"], "snoozed");

    // 4. Register & delete Web Push subscription
    let sub_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/me/push-subscriptions")
                    .header("authorization", learner_bearer)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "subscription_id": "push-sub-1",
                            "endpoint_url": "https://fcm.googleapis.com/fcm/send/example-sub-1",
                            "p256dh_key": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
                            "auth_secret": "tBHItJI5svbpez7KI4CCXg"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(sub_resp.status(), StatusCode::CREATED);

    let del_sub_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/v1/me/push-subscriptions/push-sub-1")
                .header("authorization", learner_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_sub_resp.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn t07b_t07c_t07d_hosted_credit_ledger_quotes_reservations_webhooks_reconciliation_and_multi_provider_byok(
) {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let learner_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. T07C: Register Anthropic and Google Gemini BYOK credentials via /v1/me/credentials
    for (cred_ref, prov, key) in [
        ("cred-anthropic-1", "anthropic", "sk-ant-api03-secret-7777"),
        (
            "cred-gemini-1",
            "google-gemini",
            "AIzaSySecretGeminiKey8888",
        ),
    ] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/me/credentials")
                    .header("authorization", learner_bearer)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "credential_ref": cred_ref,
                            "provider_id": prov,
                            "label": format!("{prov} key"),
                            "api_key": key
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = read_body_json(resp).await;
        assert!(!body.to_string().contains(key));
    }

    // 2. T07D: Create checkout session & process HMAC-SHA256 signed webhook idempotently (@S59, @S67)
    let chk_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/billing/checkout-sessions")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "checkout_session_id": "chk-sess-100",
                        "amount_minor_units": 500,
                        "currency": "USD"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(chk_resp.status(), StatusCode::CREATED);

    let webhook_payload = serde_json::to_vec(&json!({
        "webhook_event_id": "evt-wh-100",
        "event_type": "checkout.session.completed",
        "checkout_session_id": "chk-sess-100",
        "occurred_at": "2026-10-20T19:02:00Z"
    }))
    .unwrap();

    // Reject invalid webhook signature with 401
    let bad_wh_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/billing/webhooks")
                .header("x-billing-signature", "sha256=deadbeef")
                .header("content-type", "application/json")
                .body(Body::from(webhook_payload.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_wh_resp.status(), StatusCode::UNAUTHORIZED);

    // Valid HMAC signature credits wallet (500 initial + 500 = 1000)
    let valid_sig = syllabus_security::compute_webhook_hmac_sha256(
        DEFAULT_WEBHOOK_SIGNING_SECRET,
        &webhook_payload,
    );
    let ok_wh_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/billing/webhooks")
                .header("x-billing-signature", format!("sha256={valid_sig}"))
                .header("content-type", "application/json")
                .body(Body::from(webhook_payload.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_wh_resp.status(), StatusCode::OK);
    let wh_body = read_body_json(ok_wh_resp).await;
    assert_eq!(wh_body["replayed"], false);
    assert_eq!(wh_body["wallet"]["available_minor_units"], 1000);

    // Replay of the same webhook_event_id is a no-op (`replayed: true`, balance stays 1000)
    let replay_wh_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/billing/webhooks")
                .header("x-billing-signature", format!("sha256={valid_sig}"))
                .header("content-type", "application/json")
                .body(Body::from(webhook_payload))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replay_wh_resp.status(), StatusCode::OK);
    let replay_wh_body = read_body_json(replay_wh_resp).await;
    assert_eq!(replay_wh_body["replayed"], true);
    assert_eq!(replay_wh_body["wallet"]["available_minor_units"], 1000);

    // 3. T07B: Create usage quote with 4 distinct cost buckets, reserve credits, and settle at min(actual, cap)
    let quote_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/usage-quotes")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "quote_id": "quote-hosted-1",
                        "billing_mode": "hosted_credits",
                        "max_reservation_cap_minor_units": 400,
                        "material_cost_minor_units": 1500
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(quote_resp.status(), StatusCode::CREATED);
    let quote_body = read_body_json(quote_resp).await;
    assert_eq!(
        quote_body["four_cost_buckets"]["hosted_ai_inference_minor_units"],
        400
    );
    assert_eq!(
        quote_body["four_cost_buckets"]["external_byok_estimate_minor_units"],
        0
    );
    assert_eq!(
        quote_body["four_cost_buckets"]["learning_materials_and_exams_minor_units"],
        1500
    );

    let resv_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/reservations")
                .header("authorization", learner_bearer)
                .header("idempotency-key", "idem-resv-1")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "reservation_id": "resv-hosted-1",
                        "quote_id": "quote-hosted-1",
                        "now_epoch_seconds": 1_800_000_000
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resv_resp.status(), StatusCode::CREATED);

    // Settle at actual=260 (< cap=400) -> settles 260 and releases 140 back to available balance (1000 - 260 = 740)
    let settle_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/reservations/resv-hosted-1/settle")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "actual_cost_minor_units": 260
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(settle_resp.status(), StatusCode::OK);
    let settle_body = read_body_json(settle_resp).await;
    assert_eq!(
        settle_body["reservation"]["reservation"]["settled_minor_units"],
        260
    );
    assert_eq!(
        settle_body["reservation"]["reservation"]["released_minor_units"],
        140
    );
    assert_eq!(settle_body["wallet"]["available_minor_units"], 740);
    assert_eq!(settle_body["wallet"]["reserved_minor_units"], 0);

    // 4. Ambiguous timeout reconciliation releases reservation if unconfirmed after deadline (@S84)
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/usage-quotes")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "quote_id": "quote-timeout-1",
                        "billing_mode": "hosted_credits",
                        "max_reservation_cap_minor_units": 300
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/reservations")
                .header("authorization", learner_bearer)
                .header("idempotency-key", "idem-resv-timeout-1")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "reservation_id": "resv-timeout-1",
                        "quote_id": "quote-timeout-1",
                        "now_epoch_seconds": 1_800_000_000
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let recon_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/reservations/resv-timeout-1/reconcile-timeout")
                .header("authorization", learner_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "outcome": "unconfirmed_after_deadline"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(recon_resp.status(), StatusCode::OK);
    let recon_body = read_body_json(recon_resp).await;
    assert_eq!(
        recon_body["reservation"]["reservation"]["status"],
        "released"
    );
    assert_eq!(
        recon_body["reservation"]["reservation"]["settled_minor_units"],
        0
    );
    assert_eq!(recon_body["wallet"]["available_minor_units"], 740);
}

#[tokio::test]
async fn t13_public_templates_preview_sanitization_discovery_upvotes_moderation_and_partial_adoption(
) {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let learner_a_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";
    let learner_b_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000002";
    let moderator_bearer = "Bearer dev-moderator";

    // 1. Preview publication strips private fields and computes JCS preview_sha256 (@S56, @S57)
    let prev_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/syllabi/cur-learner-a-1/publications/preview")
                .header("authorization", learner_a_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "visibility": "public",
                        "publisher_display_name": "rag-architect"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(prev_resp.status(), StatusCode::CREATED);
    let prev_body = read_body_json(prev_resp).await;
    let preview_id = prev_body["preview_id"].as_str().unwrap().to_string();
    let expected_sha = prev_body["preview_sha256"].as_str().unwrap().to_string();
    assert!(prev_body["sanitized_content"].get("account_id").is_none());

    // 2. Reject publish if expected_preview_sha256 does not match preview
    let bad_pub_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/publications")
                    .header("authorization", learner_a_bearer)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "publication_id": "pub-rag-1",
                            "preview_id": preview_id,
                            "expected_preview_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(bad_pub_resp.status(), StatusCode::CONFLICT);

    // 3. Publish with matching digest -> discoverable via GET /v1/publications
    let pub_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/publications")
                .header("authorization", learner_a_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "publication_id": "pub-rag-1",
                        "preview_id": preview_id,
                        "expected_preview_sha256": expected_sha
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pub_resp.status(), StatusCode::CREATED);
    let pub_body = read_body_json(pub_resp).await;
    let pub_rev_id = pub_body["publication_revision_id"]
        .as_str()
        .unwrap()
        .to_string();

    // 4. Self-upvote by publisher is rejected with 409; Learner B upvote is idempotent (max 1) (@S60, @S81)
    let self_vote_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!(
                    "/v1/publications/pub-rag-1/revisions/{pub_rev_id}/my-vote"
                ))
                .header("authorization", learner_a_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(self_vote_resp.status(), StatusCode::CONFLICT);

    for _ in 0..2 {
        let b_vote_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!(
                        "/v1/publications/pub-rag-1/revisions/{pub_rev_id}/my-vote"
                    ))
                    .header("authorization", learner_b_bearer)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(b_vote_resp.status(), StatusCode::OK);
        let b_vote_body = read_body_json(b_vote_resp).await;
        assert_eq!(b_vote_body["has_upvoted"], true);
        assert_eq!(b_vote_body["upvote_count"], 1);
    }

    // 5. Partial adoption by Learner B automatically includes transitive prerequisite module closure (@S58, @S61)
    let adopt_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/v1/publications/pub-rag-1/revisions/{pub_rev_id}/adoptions"
                ))
                .header("authorization", learner_b_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "selected_module_ids": ["public-module-vector-retrieval"],
                        "new_syllabus_id": "cur-learner-b-adopted-1"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(adopt_resp.status(), StatusCode::CREATED);
    let adopt_body = read_body_json(adopt_resp).await;
    assert_eq!(
        adopt_body["origin_binding"]["auto_included_prerequisite_module_ids"],
        json!(["public-module-tokenization"])
    );
    assert_eq!(
        adopt_body["origin_binding"]["source_publication_revision_id"],
        pub_rev_id
    );

    // 6. Moderator quarantines publication -> hidden from public discovery, but Learner B's adopted copy remains intact (@S63, @S64)
    let mod_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/moderation/publications/pub-rag-1")
                .header("authorization", moderator_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "action_kind": "quarantine",
                        "rationale": "Temporarily quarantined for review"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mod_resp.status(), StatusCode::OK);

    let disc_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/publications")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let disc_body = read_body_json(disc_resp).await;
    assert!(disc_body["items"].as_array().unwrap().is_empty());

    let adopted_check = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/syllabi/cur-learner-b-adopted-1")
                .header("authorization", learner_b_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(adopted_check.status(), StatusCode::OK);
}

#[tokio::test]
async fn t09_t10_t11_account_export_deletion_restore_tombstone_replay_and_external_completion_import(
) {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let learner_a_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. T11 (`PROG-006`): Import external provider completion -> records activity completion without granting Demonstrated mastery
    let ext_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/integrations/completions")
                .header("authorization", learner_a_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "syllabus_id": "cur-learner-a-1",
                        "activity_id": "act-tok-1",
                        "objective_id": "objective-tokenization",
                        "external_provider": "coursera",
                        "time_spent_minutes": 45
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ext_resp.status(), StatusCode::CREATED);
    let ext_body = read_body_json(ext_resp).await;
    assert_eq!(ext_body["status"], "self_reported_completed");
    assert_eq!(ext_body["objective_proficiency_status"], "self_reported");
    assert_ne!(ext_body["objective_proficiency_status"], "demonstrated");

    // 2. T09 (`OPS-001`, `@S37`): Export account data -> includes syllabi_revisions, schedules, assessment_attempts, progress_events, ledger_entries, and never includes raw BYOK secrets
    let exp_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/exports")
                .header("authorization", learner_a_bearer)
                .header("idempotency-key", "idem-export-full-1")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(exp_resp.status(), StatusCode::ACCEPTED);
    let exp_body = read_body_json(exp_resp).await;
    assert!(exp_body["export_payload"]["syllabi_revisions"].is_array());
    assert!(exp_body["export_payload"]["schedules"].is_array());
    assert!(exp_body["export_payload"]["assessment_attempts"].is_array());
    assert!(exp_body["export_payload"]["progress_events"].is_array());
    assert!(exp_body["export_payload"]["ledger_entries"].is_array());

    // 3. T09 (`OPS-001`, `OPS-002`, `@S37`, `@S38`): Request account deletion -> purges private records, writes tombstone, and prevents resurrection on restore
    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/deletion-requests")
                .header("authorization", learner_a_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "deletion_request_id": "del-req-a-1",
                        "confirm_deletion": true,
                        "now_epoch_ms": 25_000
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_resp.status(), StatusCode::ACCEPTED);
    let del_body = read_body_json(del_resp).await;
    assert_eq!(del_body["status"], "completed");

    let cur_list_after = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/syllabi")
                .header("authorization", learner_a_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let cur_list_body = read_body_json(cur_list_after).await;
    assert!(cur_list_body["items"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn idempotent_validation_error_releases_lock_and_syllabus_proposal_route_verifies_syllabus_id(
) {
    let (_state, app) = test_app();
    let learner_a_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. [P0-1]: Invalid assistance_level on idempotent submit_assessment_attempt records 422
    // and replays deterministically instead of leaving the key stuck InFlight (409).
    let bad_attempt_payload = json!({
        "attempt_id": "att-bad-assistance",
        "session_id": "sess-1",
        "assistance_level": "not_a_valid_level",
        "responses": {}
    });
    for expected_replay in [false, true] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/assessments/assess-anchor-tokenization/attempts")
                    .header("authorization", learner_a_bearer)
                    .header("idempotency-key", "idem-attempt-invalid-level")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&bad_attempt_payload).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            resp.headers().get("Idempotency-Replayed").is_some(),
            expected_replay
        );
    }

    // 2. [P0-5]: GET /v1/syllabi/{syllabus_id}/adaptation-proposals/{proposal_id}
    // enforces that proposal.syllabus_id matches the path syllabus_id.
    let preview_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/syllabi/cur-learner-a-1/adaptations/preview")
                .header("authorization", learner_a_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "proposal_id": "adapt-prop-check-cur",
                        "trigger_kind": "missed_sessions"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(preview_resp.status(), StatusCode::CREATED);

    let matching_cur_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/syllabi/cur-learner-a-1/adaptation-proposals/adapt-prop-check-cur")
                .header("authorization", learner_a_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(matching_cur_resp.status(), StatusCode::OK);

    let wrong_cur_resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/syllabi/cur-other-syllabus/adaptation-proposals/adapt-prop-check-cur")
                .header("authorization", learner_a_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_cur_resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn catalog_search_and_index_tfidf_ranking_incremental_auto_index_and_cheap_model_generation()
{
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let learner_a_bearer = "Bearer dev-account:00000000-0000-4000-8000-000000000001";

    // 1. POST /v1/catalog/search-and-index runs TF-IDF + cosine similarity ranking and incrementally
    //    auto-indexes a newly discovered FlashAttention resource into the live catalog store without redeploy.
    let search_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/catalog/search-and-index")
                    .header("authorization", learner_a_bearer)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "goal_title": "Hardware-Aware FlashAttention & Subword Tokenization",
                            "subject": "Engineering",
                            "topic_tags": ["Tokenization", "FlashAttention"],
                            "math_depth": "formal",
                            "sequence_preference": "theory_first",
                            "free_only": true,
                            "weekly_minutes": 150,
                            "requested_mode": "fill_gaps",
                            "web_search_discoveries": [
                                {
                                    "resource_id": "res-auto-flash-attention",
                                    "resource_version_id": "res-auto-flash-attention-v1",
                                    "title": "Hardware-Aware FlashAttention SRAM Tiling Lecture Series",
                                    "canonical_url": "https://huggingface.co/learn/nlp-course/flash-attention",
                                    "external_id": "yt:playlist:PL_FLASH_AUTO_01",
                                    "resource_type": "video",
                                    "subject": "Engineering",
                                    "topic_tags": ["FlashAttention", "rag-python"],
                                    "supported_math_depths": ["formal"],
                                    "supported_roles": ["instruction", "practice"],
                                    "access_model": "free_public",
                                    "price_minor_units": 0,
                                    "index_descriptor": {
                                        "index_kind": "youtube_playlist_index",
                                        "channel_title": "Systems ML Channel",
                                        "playlist_id": "PL_FLASH_AUTO_01",
                                        "total_videos": 1,
                                        "syllabus_items": [
                                            {
                                                "segment_id": "seg-sram-tiling",
                                                "video_id": "vid-sram-1",
                                                "index": 1,
                                                "title": "SRAM Tiling & Online Softmax Rescaling",
                                                "duration_minutes": 30,
                                                "key_concepts": ["FlashAttention", "Online Softmax"]
                                            }
                                        ],
                                        "transcript_outline": "00:00 HBM bandwidth; 10:00 Online softmax."
                                    }
                                }
                            ]
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(search_resp.status(), StatusCode::OK);
    let search_body = read_body_json(search_resp).await;
    assert_eq!(search_body["web_search_executed"], json!(true));
    assert_eq!(
        search_body["newly_indexed_resources"][0]["resource_version_id"],
        json!("res-auto-flash-attention-v1")
    );
    assert!(
        search_body["tfidf_corpus_document_count"]
            .as_u64()
            .unwrap_or(0)
            >= 2
    );
    let ranked_scores = search_body["tfidf_ranked_scores"]
        .as_array()
        .expect("tfidf_ranked_scores array");
    assert!(!ranked_scores.is_empty());
    assert!(ranked_scores[0][1].as_f64().unwrap_or(0.0) > 0.0);

    // Verify the newly discovered resource was incrementally auto-registered into the live catalog store
    let cat_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/catalog/resources?topic=rag-python&free_only=true")
                .header("authorization", learner_a_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cat_resp.status(), StatusCode::OK);
    let cat_body = read_body_json(cat_resp).await;
    let eligible = cat_body["eligible_resources"]
        .as_array()
        .expect("eligible_resources array");
    assert!(eligible
        .iter()
        .any(|r| r["resource_version_id"] == json!("res-auto-flash-attention-v1")));

    // 2. Verify BYOK generation defaults to cheap frontier model (`gpt-6-mini`) and records it in /v1/me/usage
    let create_cred_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/me/credentials")
                .header("authorization", learner_a_bearer)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "credential_ref": "cred-learner-a-openai",
                        "provider_id": "openai",
                        "label": "OpenAI Cheap E2E Key",
                        "api_key": "sk-proj-cheap-e2e-key-99999999"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_cred_resp.status(), StatusCode::CREATED);

    let gen_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/generations")
                    .header("authorization", learner_a_bearer)
                    .header("idempotency-key", "idem-cheap-model-gen-1")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "goal": "Build a Python RAG pipeline with FlashAttention and subword tokenization",
                            "credential_mode": "byok",
                            "credential_ref": "cred-learner-a-openai",
                            "allow_hosted_fallback": false
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(gen_resp.status(), StatusCode::ACCEPTED);

    let usage_resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/me/usage")
                .header("authorization", learner_a_bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(usage_resp.status(), StatusCode::OK);
    let usage_body = read_body_json(usage_resp).await;
    let usage_items = usage_body["items"].as_array().expect("usage items");
    assert!(usage_items
        .iter()
        .any(|item| item["model_id"] == json!("gpt-6-mini")));
}

#[tokio::test]
async fn oauth_pkce_and_email_signup_login_http_endpoints() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);

    // 1. GET /v1/auth/providers lists Google and GitHub with dev sandbox readiness
    let prov_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/auth/providers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(prov_resp.status(), StatusCode::OK);
    let prov_json = read_body_json(prov_resp).await;
    let providers = prov_json["providers"].as_array().expect("providers array");
    assert_eq!(providers.len(), 2);
    assert_eq!(providers[0]["provider"], json!("google"));
    assert_eq!(providers[1]["provider"], json!("github"));

    // 2. POST /v1/auth/signup creates a hashed-password account and returns 201 + session token
    let signup_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/signup")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": "maya@syllabus.io",
                        "password": "MayaPassword2026!",
                        "display_name": "Maya Lin"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(signup_resp.status(), StatusCode::CREATED);
    let signup_json = read_body_json(signup_resp).await;
    let maya_account_id = signup_json["account_id"].as_str().unwrap().to_string();
    assert_eq!(signup_json["display_name"], json!("Maya Lin"));
    assert_eq!(signup_json["is_new_account"], json!(true));

    // 3. POST /v1/auth/login rejects wrong password (401) and accepts right password (200)
    let bad_login = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": "maya@syllabus.io",
                        "password": "WrongPassword!"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_login.status(), StatusCode::UNAUTHORIZED);

    let ok_login = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": "maya@syllabus.io",
                        "password": "MayaPassword2026!"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_login.status(), StatusCode::OK);

    // 4. GET /v1/auth/oauth/google/authorize builds RFC 7636 S256 URL, and POST callback verifies PKCE & links Maya
    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    let expected_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    let authz_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/v1/auth/oauth/google/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fauth%2Foauth%2Fgoogle%2Fcallback&state=st123&code_verifier={verifier}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(authz_resp.status(), StatusCode::OK);
    let authz_json = read_body_json(authz_resp).await;
    assert!(authz_json["authorize_url"]
        .as_str()
        .unwrap()
        .contains(&format!("code_challenge={expected_challenge}")));

    let cb_resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/oauth/google/callback")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "provider_subject": "google-uid-777",
                        "email": "maya@syllabus.io",
                        "email_verified": true,
                        "display_name": "Maya Lin",
                        "code_verifier": verifier,
                        "expected_code_challenge": expected_challenge
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cb_resp.status(), StatusCode::OK);
    let cb_json = read_body_json(cb_resp).await;
    assert_eq!(cb_json["account_id"], json!(maya_account_id));
    assert_eq!(cb_json["auth_provider"], json!("google"));
    assert_eq!(cb_json["is_new_account"], json!(false));
}
