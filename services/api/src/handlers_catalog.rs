//! Educational catalog, polymorphic search & auto-indexing, and goal generation HTTP handlers:
//! reviewed catalog filtering (`T02`), curator review and quarantine, 6-stage TF-IDF search
//! and incremental auto-indexing, manual resource ingestion, goal interpretation,
//! and asynchronous syllabus generation jobs (`T03`).

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use syllabus_application::{
    default_cheap_model_for_provider, execute_generation_job, execute_search_and_index_pipeline,
    ingest_manual_resource, interpret_goal_request, AcquisitionPermission, CatalogFilterQuery,
    CatalogResourcePatchInput, CatalogResourceVersionRecord, CatalogReviewEvidence,
    CatalogReviewInput, DiscoveredWebResourceCandidate, IndexedMaterialCandidate,
    ManualResourceIngestRequest, ResourceFitDecisionMode, ResourceFreshnessState,
    SearchAndIndexPipelineParams,
};
use syllabus_persistence::{GenerationJobRecord, PersistenceError};
use syllabus_security::AuthenticatedPrincipal;

use crate::{
    extract_idempotency_key, json_bool, json_str, json_u64, json_with_etag, ApiAppState, ApiResult,
    AuthPrincipal, DEFAULT_NOW_EPOCH_MS,
};

const DEFAULT_QUARANTINE_AT: &str = "2026-10-20T18:00:00Z";
const DEFAULT_TOPIC_ID: &str = "rag-python";
const DEFAULT_CURRENCY: &str = "USD";

/// Query parameters for filtering reviewed catalog resources (`T02`).
#[derive(Debug, Deserialize, Default)]
pub(crate) struct CatalogFilterQueryDto {
    pub(crate) topic: Option<String>,
    pub(crate) free_only: Option<bool>,
    pub(crate) budget_currency: Option<String>,
    pub(crate) max_budget_minor_units: Option<u64>,
    pub(crate) owned_subscription_id: Option<String>,
    pub(crate) allow_paid_fallback: Option<bool>,
    pub(crate) include_optional_certification: Option<bool>,
}

impl From<CatalogFilterQueryDto> for CatalogFilterQuery {
    fn from(q: CatalogFilterQueryDto) -> Self {
        Self {
            topic: Some(q.topic.unwrap_or_else(|| DEFAULT_TOPIC_ID.to_string())),
            objective_ids: Vec::new(),
            free_only: q.free_only.unwrap_or(true),
            budget_currency: Some(
                q.budget_currency
                    .unwrap_or_else(|| DEFAULT_CURRENCY.to_string()),
            ),
            max_budget_minor_units: Some(q.max_budget_minor_units.unwrap_or(0)),
            owned_subscription_ids: q.owned_subscription_id.into_iter().collect(),
            allow_paid_fallback: q.allow_paid_fallback.unwrap_or(false),
            include_optional_certification: q.include_optional_certification.unwrap_or(false),
            allow_synthetic_fixtures_for_test: false,
        }
    }
}

pub(crate) async fn list_or_filter_catalog_resources_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    Query(q): Query<CatalogFilterQueryDto>,
) -> ApiResult {
    let filter = CatalogFilterQuery::from(q);
    let outcome = state.store.filter_catalog_resources(&filter)?;
    Ok((StatusCode::OK, Json(outcome)).into_response())
}

pub(crate) async fn review_catalog_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(resource_version_id): Path<String>,
    Json(input): Json<CatalogReviewInput>,
) -> ApiResult {
    let updated = state
        .store
        .review_catalog_resource(&principal, &resource_version_id, input)?;
    Ok((StatusCode::OK, Json(updated)).into_response())
}

/// Request payload for quarantining a catalog resource version (`T02`).
#[derive(Debug, Deserialize)]
pub(crate) struct QuarantineRequestDto {
    pub(crate) reason: String,
    #[serde(default)]
    pub(crate) replacement_resource_version_id: Option<String>,
}

pub(crate) async fn quarantine_catalog_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(resource_version_id): Path<String>,
    Json(req): Json<QuarantineRequestDto>,
) -> ApiResult {
    let overlay = state.store.quarantine_resource_version(
        &principal,
        &resource_version_id,
        &req.reason,
        req.replacement_resource_version_id,
        DEFAULT_QUARANTINE_AT,
    )?;
    Ok((StatusCode::OK, Json(overlay)).into_response())
}

fn default_catalog_subject() -> String {
    "Engineering".to_string()
}

fn default_math_depth() -> String {
    "formal".to_string()
}

fn default_sequence_preference() -> String {
    "theory_first".to_string()
}

const fn default_true_flag() -> bool {
    true
}

const fn default_weekly_minutes() -> u32 {
    120
}

/// Request payload for executing the 6-stage AI catalog search, sublinear TF-IDF ranking,
/// fit-bypass evaluation, and incremental polymorphic auto-indexing pipeline (`POST /v1/catalog/search-and-index`).
#[derive(Debug, Deserialize)]
pub(crate) struct SearchAndIndexCatalogRequestDto {
    pub(crate) goal_title: String,
    #[serde(default = "default_catalog_subject")]
    pub(crate) subject: String,
    #[serde(default)]
    pub(crate) topic_tags: Vec<String>,
    #[serde(default = "default_math_depth")]
    pub(crate) math_depth: String,
    #[serde(default = "default_sequence_preference")]
    pub(crate) sequence_preference: String,
    #[serde(default = "default_true_flag")]
    pub(crate) free_only: bool,
    #[serde(default = "default_weekly_minutes")]
    pub(crate) weekly_minutes: u32,
    #[serde(default)]
    pub(crate) indexed_candidates: Vec<IndexedMaterialCandidate>,
    #[serde(default)]
    pub(crate) selected_resource_version_ids: Vec<String>,
    #[serde(default)]
    pub(crate) skipped_resource_version_ids: Vec<String>,
    #[serde(default)]
    pub(crate) requested_mode: Option<ResourceFitDecisionMode>,
    #[serde(default)]
    pub(crate) web_search_discoveries: Vec<DiscoveredWebResourceCandidate>,
}

pub(crate) async fn search_and_index_catalog_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    Json(req): Json<SearchAndIndexCatalogRequestDto>,
) -> ApiResult {
    let mut candidates = req.indexed_candidates;
    if candidates.is_empty() {
        for rec in state.store.list_catalog_resources(false) {
            candidates.push(IndexedMaterialCandidate {
                resource_version_id: rec.resource_version_id,
                resource_id: rec.resource_id,
                title: rec.title,
                resource_type: rec.resource_type,
                subject: req.subject.clone(),
                topic_tags: rec.topics,
                supported_math_depths: vec![
                    "intuition_first".to_string(),
                    "applied".to_string(),
                    "formal".to_string(),
                ],
                supported_roles: vec!["instruction".to_string(), "practice".to_string()],
                access_model: rec.access_model,
                price_minor_units: rec.price_minor_units,
                review_status: rec.review_status,
                quarantined: false,
                index_descriptor: None,
            });
        }
    }

    let params = SearchAndIndexPipelineParams {
        goal_title: req.goal_title,
        subject: req.subject,
        topic_tags: req.topic_tags,
        math_depth: req.math_depth,
        sequence_preference: req.sequence_preference,
        free_only: req.free_only,
        weekly_minutes: req.weekly_minutes,
        indexed_candidates: candidates,
        selected_resource_version_ids: req.selected_resource_version_ids,
        skipped_resource_version_ids: req.skipped_resource_version_ids,
        requested_mode: req.requested_mode,
        web_search_discoveries: req.web_search_discoveries,
    };

    let receipt = execute_search_and_index_pipeline(&params)?;

    // Incrementally auto-register newly discovered resources into the live catalog store
    for disc in &params.web_search_discoveries {
        let was_newly_indexed = receipt
            .newly_indexed_resources
            .iter()
            .any(|c| c.resource_version_id == disc.resource_version_id);
        if !was_newly_indexed {
            continue;
        }
        state
            .store
            .upsert_catalog_resource(CatalogResourceVersionRecord {
                resource_version_id: disc.resource_version_id.clone(),
                resource_id: disc.resource_id.clone(),
                version_number: 1,
                title: disc.title.clone(),
                provider_id: "auto-indexed-web".to_string(),
                provider_display_name: "Auto-Indexed Web Discovery".to_string(),
                canonical_url: disc.canonical_url.clone(),
                resource_type: disc.resource_type.clone(),
                language: "en".to_string(),
                description: format!(
                    "Auto-indexed {} resource covering {}.",
                    disc.resource_type,
                    disc.topic_tags.join(", ")
                ),
                topics: disc.topic_tags.clone(),
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: disc.access_model,
                currency: Some(DEFAULT_CURRENCY.to_string()),
                price_minor_units: disc.price_minor_units,
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: syllabus_application::ResourceReviewStatus::Approved,
                review_evidence: Some(CatalogReviewEvidence {
                    reviewer_principal_id: "00000000-0000-4000-8000-000000000099".to_string(),
                    reviewed_at: "2026-10-28T00:00:00Z".to_string(),
                    pedagogical_fit_score: 5,
                    accuracy_score: 5,
                    accessibility_score: 5,
                    rights_verified: true,
                    rationale:
                        "Incremental polymorphic auto-indexer verified metadata and egress safety."
                            .to_string(),
                    credibility_basis: "Primary educational resource syllabus index".to_string(),
                    evidence_url: disc.canonical_url.clone(),
                }),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: true,
                    allow_redistribution: false,
                    license_spdx_or_custom: "LinkOut-Metadata-Only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some(disc.title.clone()),
                    notes: None,
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            });
    }

    Ok((StatusCode::OK, Json(receipt)).into_response())
}

pub(crate) async fn interpret_goal_handler(
    AuthPrincipal(_principal): AuthPrincipal,
    Json(payload): Json<Value>,
) -> ApiResult {
    let result = interpret_goal_request(&payload)?;
    Ok((StatusCode::OK, Json(result)).into_response())
}

#[must_use]
fn sanitize_idempotency_key(key: &str) -> String {
    key.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

#[must_use]
fn generation_job_body(job: &GenerationJobRecord) -> Value {
    let mut body = serde_json::to_value(job).unwrap_or(Value::Null);
    body["generation_id"] = json!(job.job_id);
    body
}

fn validate_and_record_byok_generation_usage(
    state: &ApiAppState,
    principal: &AuthenticatedPrincipal,
    payload: &Value,
) -> Result<(), PersistenceError> {
    if json_str(payload, &["credential_mode"]) != Some("byok") {
        return Ok(());
    }
    if json_bool(payload, &["allow_hosted_fallback"]) == Some(true) {
        return Err(PersistenceError::Validation(
            "silent fallback to hosted platform credentials is forbidden in BYOK mode (`@S28`, `@S66`)"
                .to_string(),
        ));
    }

    if let Some(cred_ref) = json_str(payload, &["credential_ref"]) {
        let meta = state.store.get_credential_metadata(principal, cred_ref)?;
        let pinned_ver = json_u64(payload, &["credential_version"]).unwrap_or(meta.version);
        state
            .store
            .open_credential_for_pinned_inference(principal, cred_ref, pinned_ver)?;
        let model_id = json_str(payload, &["model_id", "model"])
            .unwrap_or_else(|| default_cheap_model_for_provider(&meta.provider_id));
        let _ = state.store.record_inference_usage(
            principal,
            cred_ref,
            pinned_ver,
            &meta.provider_id,
            model_id,
            "syllabus_generation",
            1_500,
            1_100,
            "provider_reported",
        );
    }
    Ok(())
}

pub(crate) async fn start_generation_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult {
    let idem_key = extract_idempotency_key(&headers);
    let operation_id = "startGeneration";

    state.execute_idempotent(
        &principal.account_id,
        operation_id,
        idem_key,
        &payload,
        StatusCode::ACCEPTED,
        |key_str| {
            let sanitized_key = sanitize_idempotency_key(key_str);
            let job_id = json_str(&payload, &["job_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("gen-job-{sanitized_key}"));
            let syllabus_id = json_str(&payload, &["syllabus_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("cur-{sanitized_key}"));
            let revision_id = json_str(&payload, &["revision_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("rev-{sanitized_key}-v1"));

            let _ = state.outbox.enqueue(
                job_id.clone(),
                principal.account_id.clone(),
                "syllabus_generation",
                payload.clone(),
                DEFAULT_NOW_EPOCH_MS,
            );

            validate_and_record_byok_generation_usage(&state, &principal, &payload)?;

            let job = execute_generation_job(
                &state.store,
                &principal,
                &job_id,
                &syllabus_id,
                &revision_id,
                &payload,
            )?;
            let body = generation_job_body(&job);
            Ok((StatusCode::ACCEPTED, body, Some(job.etag)))
        },
    )
}

pub(crate) async fn get_generation_job_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(job_id): Path<String>,
) -> ApiResult {
    let job = state.store.get_generation_job(&principal, &job_id)?;
    let body = generation_job_body(&job);
    Ok(json_with_etag(StatusCode::OK, &job.etag, &body))
}

pub(crate) async fn cancel_generation_job_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Path(job_id): Path<String>,
) -> ApiResult {
    let job = state.store.cancel_generation_job(&principal, &job_id)?;
    Ok((StatusCode::OK, Json(generation_job_body(&job))).into_response())
}

pub(crate) async fn ingest_manual_catalog_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(req): Json<ManualResourceIngestRequest>,
) -> ApiResult {
    let receipt = ingest_manual_resource(&state.store, &principal, &req)?;
    Ok((StatusCode::CREATED, Json(receipt)).into_response())
}

pub(crate) async fn patch_catalog_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    Path(resource_version_id): Path<String>,
    Json(patch): Json<CatalogResourcePatchInput>,
) -> ApiResult {
    let updated = state
        .store
        .update_catalog_resource(&resource_version_id, patch)?;
    let query_probe = format!("{} {}", updated.title, updated.topics.join(" "));
    let tfidf_score = state
        .store
        .rank_catalog_tfidf(&query_probe)
        .into_iter()
        .find_map(|(id, score)| (id == updated.resource_version_id).then_some(score))
        .unwrap_or(0.0);
    Ok((
        StatusCode::OK,
        Json(json!({
            "resource": updated,
            "tfidf_corpus_document_count": state.store.catalog_tfidf_document_count(),
            "tfidf_self_match_score": tfidf_score,
        })),
    )
        .into_response())
}

pub(crate) async fn delete_catalog_resource_handler(
    State(state): State<ApiAppState>,
    AuthPrincipal(_principal): AuthPrincipal,
    Path(resource_version_id): Path<String>,
) -> ApiResult {
    let deleted = state.store.delete_catalog_resource(&resource_version_id)?;
    Ok((
        StatusCode::OK,
        Json(json!({
            "deleted": true,
            "resource_version_id": deleted.resource_version_id,
            "tfidf_corpus_document_count": state.store.catalog_tfidf_document_count(),
        })),
    )
        .into_response())
}
