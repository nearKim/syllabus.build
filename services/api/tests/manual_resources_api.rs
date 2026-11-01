use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use syllabus_api::{build_router_with_state, ApiAppState};
use syllabus_security::ReleaseFeatureGates;
use serde_json::{json, Value};
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

async fn login_token(app: &axum::Router, email: &str) -> String {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/sessions")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": email,
                        "authentication_code": "123456"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = read_body_json(resp).await;
    body["session_token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn manual_resource_ingestion_auto_indexes_tfidf_and_supports_syllabus_add_edit_delete() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state.clone());
    let token_a = login_token(&app, "learner-a@example.test").await;
    let token_b = login_token(&app, "learner-b@example.test").await;

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
        initial_tfidf_count + 1
    );
    assert!(ingest_json["tfidf_self_match_score"].as_f64().unwrap() > 0.2);

    // Verify TF-IDF corpus search immediately ranks the newly ingested CKAD resource at the top.
    let ranked = state
        .store
        .rank_catalog_tfidf("ckad kubernetes helm deployments");
    assert_eq!(ranked[0].0, rv_id);
    assert!(ranked[0].1 > 0.25);

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

    // 3. EDIT the resource metadata + syllabus rationale simultaneously (`PATCH /v1/syllabi/{id}/resources/{rv_id}`)
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
                        "selection_rationale": "Updated rationale including Cilium service mesh labs.",
                        "catalog_patch": {
                            "title": "CKAD Mastery with Cilium & eBPF",
                            "topics": ["ckad", "kubernetes", "cilium", "ebpf"]
                        }
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
    assert_eq!(
        edit_json["resource"]["title"],
        "CKAD Mastery with Cilium & eBPF"
    );

    // Verify TF-IDF index automatically re-indexed the edited terms ("cilium ebpf")!
    let reindexed_hits = state.store.rank_catalog_tfidf("cilium ebpf");
    assert_eq!(reindexed_hits[0].0, rv_id);
    assert!(reindexed_hits[0].1 > 0.25);

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

    // Resource is still in the library & TF-IDF index after unlinking from one syllabus
    assert!(state.store.get_catalog_resource_version(&rv_id).is_ok());

    // 5. Permanently DELETE the resource from the catalog DB & TF-IDF index (`DELETE /v1/catalog/resources/{rv_id}`)
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
    assert_eq!(del_resp.status(), StatusCode::OK);
    assert!(state.store.get_catalog_resource_version(&rv_id).is_err());
    assert_eq!(
        state.store.catalog_tfidf_document_count(),
        initial_tfidf_count
    );
}

#[tokio::test]
async fn manual_resource_ingestion_rejects_ssrf_and_loopback_urls() {
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);
    let token = login_token(&app, "learner-a@example.test").await;

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
    let state = ApiAppState::new(ReleaseFeatureGates::default());
    let app = build_router_with_state(state);
    let token = login_token(&app, "learner-a@example.test").await;

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
                .header("authorization", format!("Bearer {token}"))
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
