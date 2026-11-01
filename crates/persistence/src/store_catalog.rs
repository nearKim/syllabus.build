//! Reviewed learning resource catalog, semantic/TF-IDF filtering, SSRF egress validation,
//! curator rubric reviews, quarantine overlays, and resource freshness alerts.

use std::collections::BTreeSet;

use syllabus_domain::{
    AcquisitionPermission, CatalogAccessModel, ResourceFreshnessState, ResourceOperationKind,
    ResourceReviewStatus,
};
use syllabus_security::{AuthenticatedPrincipal, PrincipalRole};

use crate::models::{
    validate_egress_url, CatalogFilterOutcome, CatalogFilterQuery, CatalogResourceVersionRecord,
    CatalogReviewEvidence, CatalogReviewInput, PersistenceError, ResourceAlertRecord,
    ResourceQuarantineOverlayRecord, SyllabusRevisionRecord, DEFAULT_ALLOWED_CATALOG_HOSTS,
};
use crate::store::{InMemoryTransactionalStore, StoreInner};

impl InMemoryTransactionalStore {
    /// Seeds the small reviewed catalog for the `rag-python` domain along with
    /// explicitly marked `is_synthetic_fixture = true` contract test fixtures (`T02`, `CAT-001`..`CAT-005`).
    pub fn seed_reviewed_rag_catalog(&self) {
        let curator_evidence = |_rv_id: &str, url: &str, rationale: &str| CatalogReviewEvidence {
            reviewer_principal_id: "curator-rubric-1".to_string(),
            reviewed_at: "2026-10-20T16:00:00Z".to_string(),
            pedagogical_fit_score: 5,
            accuracy_score: 5,
            accessibility_score: 4,
            rights_verified: true,
            rationale: rationale.to_string(),
            credibility_basis: "expert_practitioner".to_string(),
            evidence_url: url.to_string(),
        };

        let items = vec![
            // 1. Free public resource for objective-tokenization (link-out + metadata + short excerpt, no full-text/embedding)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-tokenization-free-v1".to_string(),
                resource_id: "res-rag-tokenization-free".to_string(),
                version_number: 1,
                title: "Hugging Face NLP Course — Subword Tokenization & BPE in Python".to_string(),
                provider_id: "huggingface-learn".to_string(),
                provider_display_name: "Hugging Face Learn".to_string(),
                canonical_url: "https://huggingface.co/learn/nlp-course/chapter2/4".to_string(),
                resource_type: "article".to_string(),
                language: "en".to_string(),
                description: "Hands-on guide to byte-pair encoding, WordPiece, and chunk boundary tradeoffs for Python RAG pipelines.".to_string(),
                topics: vec![
                    "rag-python".to_string(),
                    "tokenization".to_string(),
                    "language models".to_string(),
                ],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-tokenization-free-v1",
                    "https://huggingface.co/learn/nlp-course/chapter2/4",
                    "Reviewed tokenization syllabus and Python exercises against RAG chunking rubric.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Apache-2.0-metadata-link-only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("Hugging Face NLP Course".to_string()),
                    notes: Some("Link-out and metadata allowed; full-text storage and embedding prohibited.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 2. Free public resource for objective-vector-retrieval (open license allowing full-text + embedding)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-vector-free-v1".to_string(),
                resource_id: "res-rag-vector-free".to_string(),
                version_number: 1,
                title: "Sentence-Transformers — Dense Vector Retrieval & Hybrid Search in Python".to_string(),
                provider_id: "sbert-docs".to_string(),
                provider_display_name: "SBERT Documentation".to_string(),
                canonical_url: "https://sbert.net/examples/applications/semantic-search/README.html".to_string(),
                resource_type: "documentation".to_string(),
                language: "en".to_string(),
                description: "Reference implementation of cosine similarity indexing, HNSW retrieval, and cross-encoder re-ranking in Python.".to_string(),
                topics: vec![
                    "rag-python".to_string(),
                    "vector retrieval".to_string(),
                    "embeddings".to_string(),
                ],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-vector-retrieval".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-vector-free-v1",
                    "https://sbert.net/examples/applications/semantic-search/README.html",
                    "Verified Apache-2.0 documentation and reproducible Python vector retrieval benchmarks.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: true,
                    allow_embedding: true,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Apache-2.0".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("UKPLab Sentence-Transformers".to_string()),
                    notes: Some("Open license permits metadata, full-text storage, and embedding.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 3. Free public resource for objective-rag-evaluation
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-eval-free-v1".to_string(),
                resource_id: "res-rag-eval-free".to_string(),
                version_number: 1,
                title: "LlamaIndex Guide — Evaluating Retrieval Recall, Faithfulness & Groundedness".to_string(),
                provider_id: "llamaindex-docs".to_string(),
                provider_display_name: "LlamaIndex Documentation".to_string(),
                canonical_url: "https://docs.llamaindex.ai/en/stable/module_guides/evaluating/".to_string(),
                resource_type: "documentation".to_string(),
                language: "en".to_string(),
                description: "Practical evaluation harnesses for hit-rate@k, MRR, context relevance, and answer faithfulness in Python RAG systems.".to_string(),
                topics: vec![
                    "rag-python".to_string(),
                    "rag evaluation".to_string(),
                    "retrieval metrics".to_string(),
                ],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-rag-evaluation".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-eval-free-v1",
                    "https://docs.llamaindex.ai/en/stable/module_guides/evaluating/",
                    "Approved retrieval & faithfulness evaluation guide for intermediate Python learners.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "MIT-docs-link-only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("LlamaIndex Documentation".to_string()),
                    notes: Some("Metadata and link-out allowed.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 4. Paid purchase resource ($39.00 USD)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-paid-book-v1".to_string(),
                resource_id: "res-rag-paid-book".to_string(),
                version_number: 1,
                title: "Production Vector Databases & RAG Architecture in Python (Paid Workbook)".to_string(),
                provider_id: "realpython-books".to_string(),
                provider_display_name: "Real Python".to_string(),
                canonical_url: "https://realpython.com/chromadb-vector-database/".to_string(),
                resource_type: "book".to_string(),
                language: "en".to_string(),
                description: "Paid in-depth workbook covering vector indexing and production RAG pipelines.".to_string(),
                topics: vec!["rag-python".to_string(), "vector retrieval".to_string()],
                level: "advanced".to_string(),
                objective_ids: vec![
                    "objective-vector-retrieval".to_string(),
                    "objective-rag-evaluation".to_string(),
                    "objective-paid-only-advanced-rag".to_string(),
                ],
                access_model: CatalogAccessModel::PaidPurchase,
                currency: Some("USD".to_string()),
                price_minor_units: Some(3900),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-paid-book-v1",
                    "https://realpython.com/chromadb-vector-database/",
                    "Verified paid workbook pricing and technical accuracy.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Link-Only".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("Real Python".to_string()),
                    notes: Some("Strict link-only commercial workbook.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 5. Subscription resource ($49.00/mo or $0 incremental when learner owns `sub-coursera-plus`)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-sub-course-v1".to_string(),
                resource_id: "res-rag-sub-course".to_string(),
                version_number: 1,
                title: "Retrieval-Augmented Generation Specialization (Subscription Course)".to_string(),
                provider_id: "coursera-rag".to_string(),
                provider_display_name: "Coursera".to_string(),
                canonical_url: "https://coursera.org/learn/retrieval-augmented-generation".to_string(),
                resource_type: "course".to_string(),
                language: "en".to_string(),
                description: "Structured video & lab specialization covered by Coursera Plus subscription.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string(), "vector retrieval".to_string()],
                level: "intermediate".to_string(),
                objective_ids: vec![
                    "objective-tokenization".to_string(),
                    "objective-vector-retrieval".to_string(),
                ],
                access_model: CatalogAccessModel::Subscription,
                currency: Some("USD".to_string()),
                price_minor_units: Some(4900),
                subscription_ids: vec!["sub-coursera-plus".to_string(), "sub-oreilly".to_string()],
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-sub-course-v1",
                    "https://coursera.org/learn/retrieval-augmented-generation",
                    "Approved subscription course with verified Coursera Plus entitlement mapping.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Subscription".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("Coursera".to_string()),
                    notes: Some("Metadata and link-out only.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 6. Freemium/trial resource ($19.00 USD)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-freemium-lab-v1".to_string(),
                resource_id: "res-rag-freemium-lab".to_string(),
                version_number: 1,
                title: "Building & Evaluating Advanced RAG Applications (Freemium Trial Lab)".to_string(),
                provider_id: "deeplearning-ai".to_string(),
                provider_display_name: "DeepLearning.AI".to_string(),
                canonical_url: "https://deeplearning.ai/short-courses/building-evaluating-advanced-rag/".to_string(),
                resource_type: "course".to_string(),
                language: "en".to_string(),
                description: "Interactive RAG evaluation lab with trial notebook access.".to_string(),
                topics: vec!["rag-python".to_string(), "rag evaluation".to_string()],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-rag-evaluation".to_string()],
                access_model: CatalogAccessModel::FreemiumTrial,
                currency: Some("USD".to_string()),
                price_minor_units: Some(1900),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-freemium-lab-v1",
                    "https://deeplearning.ai/short-courses/building-evaluating-advanced-rag/",
                    "Reviewed freemium lab scope and trial terms.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: true,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Trial".to_string(),
                    requires_attribution: true,
                    attribution_text: Some("DeepLearning.AI".to_string()),
                    notes: Some("Trial access requires account; metadata and link-out allowed.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 7. Unknown-price resource (must NEVER pass free_only or bounded-budget filter, @S05, CAT-005)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-unknown-price-v1".to_string(),
                resource_id: "res-rag-unknown-price".to_string(),
                version_number: 1,
                title: "Enterprise RAG Workshop with Unverified Pricing".to_string(),
                provider_id: "stanford-ext".to_string(),
                provider_display_name: "Stanford Continuing Studies".to_string(),
                canonical_url: "https://stanford.edu/class/cs224n/readings/unknown-pricing".to_string(),
                resource_type: "course".to_string(),
                language: "en".to_string(),
                description: "External workshop whose tuition is dynamically quoted and unverified.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string()],
                level: "advanced".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::UnknownPrice,
                currency: None,
                price_minor_units: None,
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-unknown-price-v1",
                    "https://stanford.edu/class/cs224n/readings/unknown-pricing",
                    "Reviewed syllabus; price remains unknown and must be excluded from bounded budgets.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Unknown price resource.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 8. Optional certification resource ($150.00 USD, kept separate from core path costs, CAT-005)
            CatalogResourceVersionRecord {
                resource_version_id: "res-rag-optional-cert-v1".to_string(),
                resource_id: "res-rag-optional-cert".to_string(),
                version_number: 1,
                title: "Optional Applied RAG Engineering Certification Exam".to_string(),
                provider_id: "deeplearning-ai".to_string(),
                provider_display_name: "DeepLearning.AI".to_string(),
                canonical_url: "https://deeplearning.ai/certification/rag-engineering".to_string(),
                resource_type: "certification".to_string(),
                language: "en".to_string(),
                description: "Optional proctored certification exam; not required for core syllabus completion.".to_string(),
                topics: vec!["rag-python".to_string(), "rag evaluation".to_string()],
                level: "intermediate".to_string(),
                objective_ids: vec!["objective-rag-evaluation".to_string()],
                access_model: CatalogAccessModel::PaidPurchase,
                currency: Some("USD".to_string()),
                price_minor_units: Some(15000),
                subscription_ids: Vec::new(),
                is_optional_certification: true,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(curator_evidence(
                    "res-rag-optional-cert-v1",
                    "https://deeplearning.ai/certification/rag-engineering",
                    "Reviewed optional certification exam scope.",
                )),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "Proprietary-Certification".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Optional certification fee must be accounted separately.".to_string()),
                },
                is_synthetic_fixture: false,
                metadata_embedding: None,
            },
            // 9. Synthetic fixture resource matching `resource.synthetic.json` (`is_synthetic_fixture = true`, @S09, CAT-001)
            CatalogResourceVersionRecord {
                resource_version_id: "synthetic-resource-tokenization-v1".to_string(),
                resource_id: "synthetic-resource-tokenization".to_string(),
                version_number: 1,
                title: "SYNTHETIC FIXTURE — Tokenization Learning Notes".to_string(),
                provider_id: "synthetic-provider".to_string(),
                provider_display_name: "Synthetic Fixture Provider".to_string(),
                canonical_url: "https://example.invalid/synthetic/tokenization".to_string(),
                resource_type: "article".to_string(),
                language: "en".to_string(),
                description: "Contract validation fixture only. This is not a real educational resource, recommendation, university affiliation or license assertion.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string(), "language models".to_string()],
                level: "introductory".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::FreePublic,
                currency: Some("USD".to_string()),
                price_minor_units: Some(0),
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::Approved,
                review_evidence: Some(CatalogReviewEvidence {
                    reviewer_principal_id: "synthetic-curator".to_string(),
                    reviewed_at: "2026-10-20T16:00:00Z".to_string(),
                    pedagogical_fit_score: 4,
                    accuracy_score: 4,
                    accessibility_score: 4,
                    rights_verified: true,
                    rationale: "Synthetic approved-state fixture; never ingest into a production catalog.".to_string(),
                    credibility_basis: "expert_practitioner".to_string(),
                    evidence_url: "https://example.invalid/synthetic/evidence".to_string(),
                }),
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "metadata_only".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Values exercise a schema. They do not grant rights to any real material.".to_string()),
                },
                is_synthetic_fixture: true,
                metadata_embedding: None,
            },
            // 10. Synthetic unknown-cost fixture matching `resource-unknown-price.synthetic.json` (`is_synthetic_fixture = true`)
            CatalogResourceVersionRecord {
                resource_version_id: "synthetic-resource-unknown-cost-v1".to_string(),
                resource_id: "synthetic-resource-unknown-cost".to_string(),
                version_number: 1,
                title: "SYNTHETIC FIXTURE — Tokenization Learning Notes".to_string(),
                provider_id: "synthetic-provider".to_string(),
                provider_display_name: "Synthetic Fixture Provider".to_string(),
                canonical_url: "https://example.invalid/synthetic/tokenization".to_string(),
                resource_type: "article".to_string(),
                language: "en".to_string(),
                description: "Contract validation fixture only. This is not a real educational resource, recommendation, university affiliation or license assertion.".to_string(),
                topics: vec!["rag-python".to_string(), "tokenization".to_string(), "language models".to_string()],
                level: "introductory".to_string(),
                objective_ids: vec!["objective-tokenization".to_string()],
                access_model: CatalogAccessModel::UnknownPrice,
                currency: None,
                price_minor_units: None,
                subscription_ids: Vec::new(),
                is_optional_certification: false,
                review_status: ResourceReviewStatus::UnderReview,
                review_evidence: None,
                freshness_state: ResourceFreshnessState::Healthy,
                acquisition_permission: AcquisitionPermission {
                    allow_metadata: true,
                    allow_link_out: true,
                    allow_short_excerpt: false,
                    allow_full_text_storage: false,
                    allow_embedding: false,
                    allow_redistribution: false,
                    license_spdx_or_custom: "metadata_only".to_string(),
                    requires_attribution: false,
                    attribution_text: None,
                    notes: Some("Values exercise a schema. They do not grant rights to any real material.".to_string()),
                },
                is_synthetic_fixture: true,
                metadata_embedding: None,
            },
        ];

        let mut guard = self.write_inner();
        for item in items {
            Self::sync_catalog_tfidf_entry_locked(&mut guard, &item);
            guard
                .catalog_resources
                .insert(item.resource_version_id.clone(), item);
        }
    }

    pub fn upsert_catalog_resource(&self, record: CatalogResourceVersionRecord) {
        let mut guard = self.write_inner();
        Self::sync_catalog_tfidf_entry_locked(&mut guard, &record);
        guard
            .catalog_resources
            .insert(record.resource_version_id.clone(), record);
    }

    pub fn get_catalog_resource_version(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        let guard = self.read_inner();
        guard
            .catalog_resources
            .get(resource_version_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })
    }

    pub fn list_catalog_resources(
        &self,
        include_synthetic: bool,
    ) -> Vec<CatalogResourceVersionRecord> {
        let guard = self.read_inner();
        guard
            .catalog_resources
            .values()
            .filter(|r| include_synthetic || !r.is_synthetic_fixture)
            .cloned()
            .collect()
    }

    /// Deterministically filters catalog resource versions by topic/objectives, approval state,
    /// quarantine overlay, synthetic-fixture exclusion, and learner budget/subscription rules (`T02`, `CAT-001`..`CAT-005`, `@S05`, `@S06`, `@S07`, `@S09`).
    pub fn filter_catalog_resources(
        &self,
        query: &CatalogFilterQuery,
    ) -> Result<CatalogFilterOutcome, PersistenceError> {
        let guard = self.read_inner();

        let mut eligible_resources = Vec::new();
        let mut optional_certification_resources = Vec::new();
        let mut excluded_unknown_price_ids = Vec::new();
        let mut excluded_quarantined_ids = Vec::new();
        let mut excluded_unapproved_ids = Vec::new();
        let mut excluded_synthetic_ids = Vec::new();
        let mut excluded_budget_ids = Vec::new();
        let mut requires_paid_fallback_notice = false;

        for record in guard.catalog_resources.values() {
            // Check topic / objective relevance first
            let topic_matches = match &query.topic {
                Some(t) if !t.trim().is_empty() => {
                    let needle = t.trim().to_ascii_lowercase();
                    record.topics.iter().any(|rt| {
                        let rt_low = rt.to_ascii_lowercase();
                        rt_low == needle || needle.contains(&rt_low) || rt_low.contains(&needle)
                    })
                }
                _ => true,
            };
            let objective_matches = if query.objective_ids.is_empty() {
                true
            } else {
                record
                    .objective_ids
                    .iter()
                    .any(|oid| query.objective_ids.contains(oid))
            };

            if !topic_matches && !objective_matches {
                continue;
            }
            if !query.objective_ids.is_empty() && !objective_matches {
                continue;
            }

            // 1. Synthetic fixture gate (CAT-001, @S09)
            if record.is_synthetic_fixture && !query.allow_synthetic_fixtures_for_test {
                excluded_synthetic_ids.push(record.resource_version_id.clone());
                continue;
            }

            // 2. Quarantine overlay & broken freshness gate (CAT-004, @S07)
            let has_active_quarantine = guard
                .quarantine_overlays
                .get(&record.resource_version_id)
                .map(|o| o.lifted_at.is_none())
                .unwrap_or(false);
            if has_active_quarantine
                || record.review_status == ResourceReviewStatus::Quarantined
                || record.freshness_state == ResourceFreshnessState::Broken
            {
                excluded_quarantined_ids.push(record.resource_version_id.clone());
                continue;
            }

            // 3. Curator approval & rubric evidence gate (CAT-002, @S04, @S36)
            if record.review_status != ResourceReviewStatus::Approved
                || record.review_evidence.is_none()
            {
                excluded_unapproved_ids.push(record.resource_version_id.clone());
                continue;
            }

            // 4. Optional certification accounting separation (CAT-005)
            if record.is_optional_certification {
                if query.include_optional_certification {
                    optional_certification_resources.push(record.clone());
                }
                continue;
            }

            // 5. Access model & budget/subscription filtering (CAT-005, @S05, @S06)
            match record.access_model {
                CatalogAccessModel::UnknownPrice => {
                    excluded_unknown_price_ids.push(record.resource_version_id.clone());
                    continue;
                }
                CatalogAccessModel::FreePublic => {
                    eligible_resources.push(record.clone());
                }
                CatalogAccessModel::Subscription => {
                    let covered_by_owned_sub = record
                        .subscription_ids
                        .iter()
                        .any(|sub| query.owned_subscription_ids.contains(sub));
                    if covered_by_owned_sub {
                        eligible_resources.push(record.clone());
                    } else if query.free_only {
                        if query.allow_paid_fallback {
                            requires_paid_fallback_notice = true;
                            eligible_resources.push(record.clone());
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    } else {
                        let price = record.price_minor_units.unwrap_or(u64::MAX);
                        let currency_ok = match (&query.budget_currency, &record.currency) {
                            (Some(qc), Some(rc)) => qc.eq_ignore_ascii_case(rc),
                            _ => true,
                        };
                        let within_budget = query
                            .max_budget_minor_units
                            .map(|max_b| price <= max_b)
                            .unwrap_or(true);
                        if currency_ok && within_budget {
                            eligible_resources.push(record.clone());
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    }
                }
                CatalogAccessModel::PaidPurchase | CatalogAccessModel::FreemiumTrial => {
                    if query.free_only {
                        if query.allow_paid_fallback {
                            let price = record.price_minor_units.unwrap_or(u64::MAX);
                            let within_budget = query
                                .max_budget_minor_units
                                .map(|max_b| max_b == 0 || price <= max_b)
                                .unwrap_or(true);
                            if within_budget {
                                requires_paid_fallback_notice = true;
                                eligible_resources.push(record.clone());
                            } else {
                                excluded_budget_ids.push(record.resource_version_id.clone());
                            }
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    } else {
                        let price = record.price_minor_units.unwrap_or(u64::MAX);
                        let currency_ok = match (&query.budget_currency, &record.currency) {
                            (Some(qc), Some(rc)) => qc.eq_ignore_ascii_case(rc),
                            _ => true,
                        };
                        let within_budget = query
                            .max_budget_minor_units
                            .map(|max_b| price <= max_b)
                            .unwrap_or(true);
                        if currency_ok && within_budget {
                            eligible_resources.push(record.clone());
                        } else {
                            excluded_budget_ids.push(record.resource_version_id.clone());
                        }
                    }
                }
            }
        }

        if eligible_resources.is_empty() {
            let target = query
                .topic
                .clone()
                .or_else(|| query.objective_ids.first().cloned())
                .unwrap_or_else(|| "requested-goal".to_string());
            return Err(PersistenceError::InsufficientCatalogCoverage {
                missing_objective_ids: vec![target],
            });
        }

        for required_obj in &query.objective_ids {
            let covered = eligible_resources
                .iter()
                .any(|r| r.objective_ids.contains(required_obj));
            if !covered {
                return Err(PersistenceError::InsufficientCatalogCoverage {
                    missing_objective_ids: vec![required_obj.clone()],
                });
            }
        }

        Ok(CatalogFilterOutcome {
            eligible_resources,
            optional_certification_resources,
            excluded_unknown_price_ids,
            excluded_quarantined_ids,
            excluded_unapproved_ids,
            excluded_synthetic_ids,
            excluded_budget_ids,
            requires_paid_fallback_notice,
        })
    }

    /// Enforces acquisition/rights permissions and SSRF/egress safety for a catalog resource operation (`CAT-003`, `@S05`, `@S08`, `@S31`, `@S35`).
    pub fn validate_resource_ingestion_and_egress(
        &self,
        resource_version_id: &str,
        operation: ResourceOperationKind,
        target_url: Option<&str>,
        allow_synthetic_fixtures_for_test: bool,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        let guard = self.read_inner();
        let record = guard
            .catalog_resources
            .get(resource_version_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })?;

        if record.is_synthetic_fixture && !allow_synthetic_fixtures_for_test {
            return Err(PersistenceError::SyntheticFixtureForbiddenInProduction {
                resource_version_id: resource_version_id.to_string(),
            });
        }

        let is_quarantined = guard
            .quarantine_overlays
            .get(resource_version_id)
            .map(|o| o.lifted_at.is_none())
            .unwrap_or(false)
            || record.review_status == ResourceReviewStatus::Quarantined;
        if is_quarantined {
            return Err(PersistenceError::IneligibleCatalogResource {
                resource_version_id: resource_version_id.to_string(),
                reason: "resource version is quarantined".to_string(),
            });
        }

        if !record.acquisition_permission.permits(operation) {
            return Err(PersistenceError::ResourceOperationNotPermitted {
                resource_version_id: resource_version_id.to_string(),
                operation: operation.as_str().to_string(),
                reason: format!(
                    "operation `{}` is denied by resource acquisition permissions (`{}`)",
                    operation.as_str(),
                    record.acquisition_permission.license_spdx_or_custom
                ),
            });
        }

        let url_to_check = target_url.unwrap_or(&record.canonical_url);
        if record.is_synthetic_fixture && allow_synthetic_fixtures_for_test {
            let mut synthetic_hosts = DEFAULT_ALLOWED_CATALOG_HOSTS.to_vec();
            synthetic_hosts.push("example.invalid");
            validate_egress_url(url_to_check, &synthetic_hosts)?;
        } else {
            validate_egress_url(url_to_check, DEFAULT_ALLOWED_CATALOG_HOSTS)?;
        }

        Ok(record.clone())
    }

    /// Curator review decision workflow enforcing `PrincipalRole::Curator` and rubric evidence (`CAT-002`, `@S04`, `@S36`).
    pub fn review_catalog_resource(
        &self,
        principal: &AuthenticatedPrincipal,
        resource_version_id: &str,
        input: CatalogReviewInput,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        if !principal.roles.contains(&PrincipalRole::Operator) {
            principal.require_role(PrincipalRole::Curator)?;
        }

        let mut guard = self.write_inner();
        let record = guard
            .catalog_resources
            .get_mut(resource_version_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })?;

        if input.decision == ResourceReviewStatus::Approved {
            if !input.rights_verified {
                return Err(PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "rights_verified must be true".to_string(),
                });
            }
            if input.rationale.trim().is_empty() {
                return Err(PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "rationale is required".to_string(),
                });
            }
            let ped = input.pedagogical_fit_score.ok_or_else(|| {
                PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "pedagogical_fit_score is required".to_string(),
                }
            })?;
            let acc = input.accuracy_score.ok_or_else(|| {
                PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "accuracy_score is required".to_string(),
                }
            })?;
            let a11y = input.accessibility_score.ok_or_else(|| {
                PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "accessibility_score is required".to_string(),
                }
            })?;
            if !(3..=5).contains(&ped) || !(3..=5).contains(&acc) || !(3..=5).contains(&a11y) {
                return Err(PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "rubric scores must be in 3..=5 for approval".to_string(),
                });
            }
            let ev_url = input
                .evidence_url
                .clone()
                .filter(|u| u.starts_with("https://"))
                .ok_or_else(|| PersistenceError::MissingReviewRubricEvidence {
                    resource_id: resource_version_id.to_string(),
                    reason: "https:// evidence_url is required".to_string(),
                })?;

            record.review_status = ResourceReviewStatus::Approved;
            record.review_evidence = Some(CatalogReviewEvidence {
                reviewer_principal_id: principal.account_id.clone(),
                reviewed_at: "2026-10-20T16:30:00Z".to_string(),
                pedagogical_fit_score: ped,
                accuracy_score: acc,
                accessibility_score: a11y,
                rights_verified: true,
                rationale: input.rationale.clone(),
                credibility_basis: input
                    .credibility_basis
                    .unwrap_or_else(|| "expert_practitioner".to_string()),
                evidence_url: ev_url,
            });
        } else {
            record.review_status = input.decision;
        }
        let cloned_record = record.clone();
        if input.decision == ResourceReviewStatus::Quarantined {
            let overlay = ResourceQuarantineOverlayRecord {
                overlay_id: format!("quar-{resource_version_id}"),
                resource_version_id: resource_version_id.to_string(),
                reason: input.rationale.clone(),
                quarantined_by: principal.account_id.clone(),
                quarantined_at: "2026-10-20T16:30:00Z".to_string(),
                replacement_resource_version_id: None,
                lifted_at: None,
            };
            guard
                .quarantine_overlays
                .insert(resource_version_id.to_string(), overlay);
        }

        Ok(cloned_record)
    }

    /// Quarantines a catalog resource version via a non-destructive overlay (`CAT-004`, `@S07`, `@S09`, `@S63`).
    /// Does NOT mutate any existing `SyllabusRevisionRecord` payloads or `candidate_sha256`.
    pub fn quarantine_resource_version(
        &self,
        principal: &AuthenticatedPrincipal,
        resource_version_id: &str,
        reason: &str,
        replacement_resource_version_id: Option<String>,
        now_iso: &str,
    ) -> Result<ResourceQuarantineOverlayRecord, PersistenceError> {
        if !principal.roles.contains(&PrincipalRole::Moderator)
            && !principal.roles.contains(&PrincipalRole::Operator)
        {
            principal.require_role(PrincipalRole::Curator)?;
        }

        let mut guard = self.write_inner();
        let record = guard
            .catalog_resources
            .get_mut(resource_version_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })?;
        record.review_status = ResourceReviewStatus::Quarantined;

        let overlay = ResourceQuarantineOverlayRecord {
            overlay_id: format!("quar-{resource_version_id}"),
            resource_version_id: resource_version_id.to_string(),
            reason: reason.to_string(),
            quarantined_by: principal.account_id.clone(),
            quarantined_at: now_iso.to_string(),
            replacement_resource_version_id,
            lifted_at: None,
        };
        guard
            .quarantine_overlays
            .insert(resource_version_id.to_string(), overlay.clone());
        Ok(overlay)
    }

    /// Records a freshness check outcome after validating outbound URL egress (`CAT-003`, `CAT-004`, `@S07`, `@S08`).
    pub fn record_resource_freshness_check(
        &self,
        resource_version_id: &str,
        target_url: Option<&str>,
        simulated_http_status: u16,
        now_iso: &str,
    ) -> Result<ResourceFreshnessState, PersistenceError> {
        // Validate egress URL before performing/recording check (@S08, @S31, @S35)
        let current = self.get_catalog_resource_version(resource_version_id)?;
        let url_to_check = target_url.unwrap_or(&current.canonical_url);
        validate_egress_url(url_to_check, DEFAULT_ALLOWED_CATALOG_HOSTS)?;

        let new_state = match simulated_http_status {
            200..=299 => ResourceFreshnessState::Healthy,
            404 | 410 => ResourceFreshnessState::Broken,
            _ => ResourceFreshnessState::Degraded,
        };

        let mut guard = self.write_inner();
        if let Some(res) = guard.catalog_resources.get_mut(resource_version_id) {
            res.freshness_state = new_state;
            if new_state == ResourceFreshnessState::Broken {
                res.review_status = ResourceReviewStatus::Quarantined;
                guard.quarantine_overlays.insert(
                    resource_version_id.to_string(),
                    ResourceQuarantineOverlayRecord {
                        overlay_id: format!("quar-freshness-{resource_version_id}"),
                        resource_version_id: resource_version_id.to_string(),
                        reason: format!(
                            "Automated freshness check detected broken link (HTTP {simulated_http_status})"
                        ),
                        quarantined_by: "freshness-worker".to_string(),
                        quarantined_at: now_iso.to_string(),
                        replacement_resource_version_id: None,
                        lifted_at: None,
                    },
                );
            }
        }
        Ok(new_state)
    }

    /// Lists non-destructive resource alerts for a learner's syllabus without mutating historical revisions (`@S07`, `@S63`).
    pub fn list_syllabus_resource_alerts(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
    ) -> Result<Vec<ResourceAlertRecord>, PersistenceError> {
        let guard = self.read_inner();
        let revisions: Vec<&SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .collect();
        let first = revisions
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "syllabus",
                resource_id: syllabus_id.to_string(),
            })?;
        principal.require_learner_ownership(&first.owner_account_id)?;

        Ok(Self::collect_alerts_for_revisions(
            &guard,
            syllabus_id,
            &revisions,
        ))
    }

    pub(crate) fn collect_alerts_for_revisions(
        guard: &StoreInner,
        syllabus_id: &str,
        revisions: &[&SyllabusRevisionRecord],
    ) -> Vec<ResourceAlertRecord> {
        let mut alerts = Vec::new();
        let mut seen = BTreeSet::new();

        for rev in revisions {
            let mut referenced_ids = Vec::new();
            if let Some(modules) = rev.payload.get("modules").and_then(|v| v.as_array()) {
                for module in modules {
                    if let Some(activities) = module.get("activities").and_then(|v| v.as_array()) {
                        for activity in activities {
                            if let Some(refs) =
                                activity.get("resource_refs").and_then(|v| v.as_array())
                            {
                                for r in refs {
                                    if let Some(rv_id) =
                                        r.get("resource_version_id").and_then(|v| v.as_str())
                                    {
                                        referenced_ids.push(rv_id.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if let Some(activities) = rev.payload.get("activities").and_then(|v| v.as_array()) {
                for activity in activities {
                    for key in ["resource_assignments", "resource_refs"] {
                        if let Some(refs) = activity.get(key).and_then(|v| v.as_array()) {
                            for r in refs {
                                if let Some(rv_id) =
                                    r.get("resource_version_id").and_then(|v| v.as_str())
                                {
                                    referenced_ids.push(rv_id.to_string());
                                }
                            }
                        }
                    }
                }
            }
            if let Some(src_ids) = rev
                .payload
                .get("provenance")
                .and_then(|p| p.get("source_resource_version_ids"))
                .and_then(|v| v.as_array())
            {
                for s in src_ids.iter().filter_map(|v| v.as_str()) {
                    referenced_ids.push(s.to_string());
                }
            }
            if let Some(top_refs) = rev.payload.get("resource_refs").and_then(|v| v.as_array()) {
                for r in top_refs {
                    if let Some(s) = r.as_str() {
                        referenced_ids.push(s.to_string());
                    } else if let Some(rv_id) =
                        r.get("resource_version_id").and_then(|v| v.as_str())
                    {
                        referenced_ids.push(rv_id.to_string());
                    }
                }
            }

            for rv_id in referenced_ids {
                let dedup_key = (rev.revision_id.clone(), rv_id.clone());
                if !seen.insert(dedup_key) {
                    continue;
                }
                if let Some(overlay) = guard.quarantine_overlays.get(&rv_id) {
                    if overlay.lifted_at.is_none() {
                        alerts.push(ResourceAlertRecord {
                            alert_id: format!("alert-{}-{rv_id}", rev.revision_id),
                            syllabus_id: syllabus_id.to_string(),
                            revision_id: rev.revision_id.clone(),
                            resource_version_id: rv_id.clone(),
                            alert_type: "quarantined".to_string(),
                            severity: "warning".to_string(),
                            reason: overlay.reason.clone(),
                            replacement_resource_version_id: overlay
                                .replacement_resource_version_id
                                .clone(),
                        });
                        continue;
                    }
                }
                if let Some(cat_res) = guard.catalog_resources.get(&rv_id) {
                    if cat_res.review_status == ResourceReviewStatus::Quarantined
                        || cat_res.freshness_state == ResourceFreshnessState::Broken
                    {
                        alerts.push(ResourceAlertRecord {
                            alert_id: format!("alert-{}-{rv_id}", rev.revision_id),
                            syllabus_id: syllabus_id.to_string(),
                            revision_id: rev.revision_id.clone(),
                            resource_version_id: rv_id,
                            alert_type: "broken_link".to_string(),
                            severity: "warning".to_string(),
                            reason:
                                "Referenced catalog resource version is quarantined or unreachable."
                                    .to_string(),
                            replacement_resource_version_id: None,
                        });
                    }
                }
            }
        }
        alerts
    }
}
