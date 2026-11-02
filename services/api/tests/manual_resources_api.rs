use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use serde_json::{json, Value};
use std::sync::Arc;
use syllabus_api::{build_router_with_state, ApiAppState};
use syllabus_security::{AppEnvironment, DevFixedIdentityAuthVerifier, ReleaseFeatureGates};
use tower::ServiceExt;

async fn read_body_json(response: Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), 128 * 1024)
        .await
        .expect("read response body");
    if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).expect("parse response json")
    }
}

const USER_A_TOKEN: &str = "dev-account:00000000-0000-4000-8000-000000000001";
const USER_B_TOKEN: &str = "dev-account:00000000-0000-4000-8000-000000000002";

fn test_state() -> ApiAppState {
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
    state
}

#[tokio::test]
async fn manual_resource_ingestion_stays_unreviewed_and_supports_private_syllabus_edits() {
    let state = test_state();
    let app = build_router_with_state(state.clone());
    let token_a = USER_A_TOKEN;
    let token_b = USER_B_TOKEN;

    let initial_tfidf_count = state.store.catalog_tfidf_document_count();

    // 1. Ingest a manual resource with bare domain + free-form notes ("udemy.com/blahblah this is the ckad course...")
    let ingest_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/catalog/resources/manual")
                .header("authorization", format!("Bearer {token_a}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "raw_text": "udemy.com/course/ckad-kubernetes-admin this is the ckad course covering pods, deployments, helm, network policies"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ingest_resp.status(), StatusCode::CREATED);
    let ingest_json = read_body_json(ingest_resp).await;

    let rv_id = ingest_json["resource"]["resource_version_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(rv_id.starts_with("manual-"));
    assert_eq!(
        ingest_json["resource"]["canonical_url"],
        "https://udemy.com/course/ckad-kubernetes-admin"
    );
    assert_eq!(ingest_json["resource"]["provider_display_name"], "Udemy");
    assert_eq!(ingest_json["category"], "Course");
    assert_eq!(ingest_json["subject"], "Systems");
    assert_eq!(
        ingest_json["tfidf_corpus_document_count"].as_u64().unwrap() as usize,
        initial_tfidf_count
    );
    assert_eq!(ingest_json["resource"]["review_status"], "under_review");
    assert_eq!(ingest_json["tfidf_self_match_score"], 0.0);

    // Unreviewed submissions do not enter the approved catalog index.
    let ranked = state
        .store
        .rank_catalog_tfidf("ckad kubernetes helm deployments");
    assert!(!ranked.iter().any(|(id, _)| id == &rv_id));

    // 2. Link (ADD) the library resource to Learner A's syllabus (`cur-learner-a-1`)
    let link_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/syllabi/cur-learner-a-1/resources")
                .header("authorization", format!("Bearer {token_a}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "resource_version_id": rv_id,
                        "role": "primary",
                        "segment_ids": ["seg-1", "seg-2"],
                        "selection_rationale": "Hands-on CKAD exam preparation covering pods and Helm."
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(link_resp.status(), StatusCode::CREATED);
    let link_json = read_body_json(link_resp).await;
    assert_eq!(link_json["receipt"]["action"], "added");
    assert_eq!(
        link_json["revision"]["payload"]["activities"][0]["resource_assignments"][0]
            ["resource_version_id"],
        rv_id
    );

    // Cross-tenant isolation check: Learner B cannot mutate Learner A's syllabus resources
    let cross_tenant_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/v1/syllabi/cur-learner-a-1/resources/{rv_id}"))
                .header("authorization", format!("Bearer {token_b}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cross_tenant_resp.status(), StatusCode::FORBIDDEN);

    // 3. Edit only the private syllabus binding.
    let edit_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/syllabi/cur-learner-a-1/resources/{rv_id}"))
                .header("authorization", format!("Bearer {token_a}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "role": "supplemental",
                        "selection_rationale": "Updated rationale including Cilium service mesh labs."
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(edit_resp.status(), StatusCode::OK);
    let edit_json = read_body_json(edit_resp).await;
    assert_eq!(edit_json["receipt"]["action"], "updated");
    assert!(edit_json["resource"].is_null());

    let forbidden_patch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/syllabi/cur-learner-a-1/resources/{rv_id}"))
                .header("authorization", format!("Bearer {token_b}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"catalog_patch": {"title": "Forged title"}}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_patch.status(), StatusCode::FORBIDDEN);
    assert_ne!(
        state
            .store
            .get_catalog_resource_version(&rv_id)
            .unwrap()
            .title,
        "Forged title"
    );

    // 4. REMOVE (unlink) the resource from the syllabus (`DELETE /v1/syllabi/{id}/resources/{rv_id}`)
    let unlink_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/v1/syllabi/cur-learner-a-1/resources/{rv_id}"))
                .header("authorization", format!("Bearer {token_a}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unlink_resp.status(), StatusCode::OK);
    let unlink_json = read_body_json(unlink_resp).await;
    assert_eq!(unlink_json["receipt"]["action"], "removed");
    assert!(unlink_json["revision"]["payload"]["activities"]
        .as_array()
        .unwrap()
        .is_empty());

    // Resource remains in the library after unlinking from one syllabus.
    assert!(state.store.get_catalog_resource_version(&rv_id).is_ok());

    // 5. Only Admin can permanently delete a global catalog resource.
    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/v1/catalog/resources/{rv_id}"))
                .header("authorization", format!("Bearer {token_a}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_resp.status(), StatusCode::FORBIDDEN);
    let admin_del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/v1/catalog/resources/{rv_id}"))
                .header("authorization", "Bearer dev-admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(admin_del_resp.status(), StatusCode::OK);
    assert!(state.store.get_catalog_resource_version(&rv_id).is_err());
    assert_eq!(
        state.store.catalog_tfidf_document_count(),
        initial_tfidf_count
    );
}

#[tokio::test]
async fn manual_resource_ingestion_rejects_ssrf_and_loopback_urls() {
    let state = test_state();
    let app = build_router_with_state(state);
    let token = USER_A_TOKEN;

    for unsafe_input in [
        "http://127.0.0.1:8080/admin secret internal page",
        "https://169.254.169.254/latest/meta-data cloud metadata",
        "localhost/internal-course local notes",
    ] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/catalog/resources/manual")
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({ "raw_text": unsafe_input })).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}

#[tokio::test]
async fn web_dto_parity_explicit_id_category_access_aliases_and_auto_syllabus_binding() {
    let state = test_state();
    let app = build_router_with_state(state);
    let token = USER_A_TOKEN;

    // 1. Ingest with explicit web `resource_version_id`
    let explicit_id = "manual-web-parity-triton-v1";
    let ingest_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/catalog/resources/manual")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "resource_version_id": explicit_id,
                        "raw_text": "https://github.com/triton-lang/triton GPU kernel tutorials",
                        "title": "Triton GPU Kernel Tutorials",
                        "category": "Repository",
                        "subject": "Systems",
                        "access_model": "free"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ingest_resp.status(), StatusCode::CREATED);

    // 2. PATCH using @syllabus/web payload shape (`category`, `summary`, `access_model: "free"`, `subject`, `segment_titles`)
    let patch_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/catalog/resources/{explicit_id}"))
                .header("authorization", "Bearer dev-admin")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "title": "Triton GPU Kernel Tutorials (Updated)",
                        "category": "Video",
                        "summary": "Deep-dive into block-level GPU programming.",
                        "subject": "Systems",
                        "access_model": "freemium_optional_certificate",
                        "segment_titles": ["1. Vector Add", "2. Fused Softmax"]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch_resp.status(), StatusCode::OK);

    // 3. Bind to a frontend-generated syllabus ID that didn't pre-exist in Rust
    let bind_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/syllabi/syllabus-gen-web-001/resources")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "resource_version_id": explicit_id,
                        "role": "primary",
                        "selection_rationale": "Core GPU kernel hands-on material."
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bind_resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn user_cannot_replace_or_edit_a_reviewed_catalog_resource() {
    let state = test_state();
    let app = build_router_with_state(state.clone());
    let id = "res-rag-vector-free-v1";
    let original = state.store.get_catalog_resource_version(id).unwrap();

    let replace = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/catalog/resources/manual")
                .header("authorization", format!("Bearer {USER_A_TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "resource_version_id": id,
                        "raw_text": "https://github.com/example/unique-learning-resource"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replace.status(), StatusCode::CONFLICT);

    let edit = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/catalog/resources/{id}"))
                .header("authorization", format!("Bearer {USER_A_TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({"title": "Forged title"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(edit.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        state.store.get_catalog_resource_version(id).unwrap(),
        original
    );

    let admin_edit = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/catalog/resources/{id}"))
                .header("authorization", "Bearer dev-admin")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"title": "Revised vector resource"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(admin_edit.status(), StatusCode::OK);
    let revised = state.store.get_catalog_resource_version(id).unwrap();
    assert_eq!(
        revised.review_status,
        syllabus_domain::ResourceReviewStatus::UnderReview
    );
    assert!(revised.review_evidence.is_none());
    assert!(!state
        .store
        .rank_catalog_tfidf("vector resource")
        .iter()
        .any(|(found, _)| found == id));
}

#[tokio::test]
async fn duplicate_url_reuses_global_record_for_another_private_syllabus() {
    let state = test_state();
    let app = build_router_with_state(state.clone());
    let original_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/catalog/resources/manual")
                .header("authorization", format!("Bearer {USER_A_TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "raw_text": "https://example.edu/shared-learning-resource",
                        "title": "Original learning resource",
                        "description": "Original catalog description"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(original_response.status(), StatusCode::CREATED);
    let original_body = read_body_json(original_response).await;
    let id = original_body["resource"]["resource_version_id"]
        .as_str()
        .unwrap();
    let original = state.store.get_catalog_resource_version(id).unwrap();
    let corpus_count = state.store.catalog_tfidf_document_count();

    let reused_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/catalog/resources/manual")
                .header("authorization", format!("Bearer {USER_B_TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "raw_text": "https://example.edu/shared-learning-resource",
                        "resource_version_id": "res-rag-vector-free-v1",
                        "title": "Forged replacement title",
                        "description": "Forged replacement description",
                        "syllabus_id": "cur-learner-b-1",
                        "selection_rationale": "My private reason for using this resource"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reused_response.status(), StatusCode::CREATED);
    let reused = read_body_json(reused_response).await;
    assert_eq!(reused["resource"]["resource_version_id"], id);
    assert_eq!(reused["resource"]["title"], original.title);
    assert_eq!(reused["syllabus_binding"]["syllabus_id"], "cur-learner-b-1");
    assert_eq!(
        state.store.get_catalog_resource_version(id).unwrap(),
        original
    );
    assert_eq!(state.store.catalog_tfidf_document_count(), corpus_count);
}
