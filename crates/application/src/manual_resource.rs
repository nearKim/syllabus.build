//! Manual learning resource ingestion (`URL + free-form notes` -> structured resource + TF-IDF indexing + optional syllabus link).

use serde::{Deserialize, Serialize};
use syllabus_contracts::jcs::sha256_bytes_hex;
use syllabus_domain::{
    normalize_canonical_resource_identity, tokenize_search_terms, BookTocChapter,
    CourseSyllabusUnit, IndexedMaterialCandidate, RepositoryLabExercise, ResourceIndexDescriptor,
    YoutubeSyllabusItem,
};
use syllabus_persistence::{
    validate_manual_resource_egress_url, AcquisitionPermission, CatalogAccessModel,
    CatalogResourceVersionRecord, InMemoryTransactionalStore, PersistenceError,
    ResourceFreshnessState, ResourceReviewStatus, SyllabusResourceBindingInput,
    SyllabusResourceMutationReceipt,
};
use syllabus_security::AuthenticatedPrincipal;

/// Input payload for `POST /v1/catalog/resources/manual`.
/// Supports single-box free-form input (`raw_text`, e.g. `"udemy.com/course/ckad this is the ckad course..."`)
/// as well as optional AI-analyzed metadata fields supplied by the caller or web analyzer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManualResourceIngestRequest {
    #[serde(default)]
    pub raw_text: String,
    #[serde(default)]
    pub resource_version_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub canonical_url: Option<String>,
    #[serde(default)]
    pub provider_display_name: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub resource_type: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub topic_tags: Vec<String>,
    #[serde(default)]
    pub segments: Vec<String>,
    #[serde(default)]
    pub access_model: Option<CatalogAccessModel>,
    #[serde(default)]
    pub price_minor_units: Option<u64>,
    #[serde(default)]
    pub syllabus_id: Option<String>,
    #[serde(default)]
    pub module_id: Option<String>,
    #[serde(default)]
    pub activity_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub selection_rationale: Option<String>,
}

/// Receipt returned by manual resource ingestion after updating the catalog DB and TF-IDF search index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManualResourceIngestReceipt {
    pub resource: CatalogResourceVersionRecord,
    pub indexed_candidate: IndexedMaterialCandidate,
    pub extracted_notes: String,
    pub category: String,
    pub subject: String,
    pub segments: Vec<String>,
    pub tfidf_corpus_document_count: usize,
    pub tfidf_self_match_score: f64,
    pub syllabus_binding: Option<SyllabusResourceMutationReceipt>,
}

/// Splits a free-form string like `"udemy.com/blahblah this is the ckad course blah blah"`
/// into `(normalized_https_url, remaining_user_notes)`.
pub fn extract_url_and_notes_from_freeform(
    raw_text: &str,
    explicit_url: Option<&str>,
) -> Result<(String, String), PersistenceError> {
    if let Some(url) = explicit_url.map(str::trim).filter(|s| !s.is_empty()) {
        let normalized = normalize_to_https_url(url)?;
        return Ok((normalized, raw_text.trim().to_string()));
    }

    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return Err(PersistenceError::Validation(
            "provide a resource URL (with optional notes)".to_string(),
        ));
    }

    let mut detected_token: Option<&str> = None;
    for token in trimmed.split_whitespace() {
        let stripped = token.trim_matches(|c: char| {
            matches!(
                c,
                '(' | ')' | '[' | ']' | '<' | '>' | '"' | '\'' | ',' | ';'
            )
        });
        let cleaned = stripped.trim_end_matches(['.', ':', '!', '?']);
        if looks_like_url_token(cleaned) {
            detected_token = Some(token);
            break;
        }
    }

    let raw_token = detected_token.ok_or_else(|| {
        PersistenceError::Validation(
            "could not detect a URL or domain in the input (for example `udemy.com/course/...`)"
                .to_string(),
        )
    })?;

    let cleaned_url_token = raw_token
        .trim_matches(|c: char| {
            matches!(
                c,
                '(' | ')' | '[' | ']' | '<' | '>' | '"' | '\'' | ',' | ';'
            )
        })
        .trim_end_matches(['.', ':', '!', '?']);

    let normalized_url = normalize_to_https_url(cleaned_url_token)?;

    let notes = trimmed
        .replacen(raw_token, " ", 1)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    Ok((normalized_url, notes))
}

fn looks_like_url_token(token: &str) -> bool {
    if token.starts_with("https://") || token.starts_with("http://") {
        return true;
    }
    if token.contains('@') || token.starts_with('/') || token.starts_with('.') {
        return false;
    }
    let host_part = token.split(['/', '?', '#']).next().unwrap_or("");
    let labels: Vec<&str> = host_part.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    let tld = labels.last().copied().unwrap_or("");
    let valid_labels = labels
        .iter()
        .all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    valid_labels && tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic())
}

fn normalize_to_https_url(raw_url: &str) -> Result<String, PersistenceError> {
    let trimmed = raw_url.trim();
    let https_url = if trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        format!("https://{trimmed}")
    };
    validate_manual_resource_egress_url(&https_url)?;
    Ok(https_url)
}

struct DomainProfile {
    provider_id: String,
    provider_display_name: String,
    category: &'static str,
    resource_type: &'static str,
    access_model: CatalogAccessModel,
    default_price_minor: Option<u64>,
}

fn infer_domain_profile(host: &str, path: &str, notes_lower: &str) -> DomainProfile {
    let base_host = host.strip_prefix("www.").unwrap_or(host);
    let mentions_free = notes_lower.contains("free") || notes_lower.contains("open access");
    let mentions_paid = notes_lower.contains("paid") || notes_lower.contains("udemy");

    let (provider_id, provider_name, mut category, mut resource_type, mut access, mut price) =
        if base_host.ends_with("udemy.com") {
            (
                "udemy",
                "Udemy",
                "Course",
                "course",
                CatalogAccessModel::PaidPurchase,
                Some(1999_u64),
            )
        } else if base_host.ends_with("coursera.org") {
            (
                "coursera",
                "Coursera",
                "Course",
                "course",
                CatalogAccessModel::FreemiumTrial,
                Some(4900),
            )
        } else if base_host.ends_with("edx.org") {
            (
                "edx",
                "edX",
                "Course",
                "course",
                CatalogAccessModel::FreemiumTrial,
                Some(4900),
            )
        } else if base_host.ends_with("youtube.com") || base_host == "youtu.be" {
            (
                "youtube",
                "YouTube",
                "YouTube",
                "video",
                CatalogAccessModel::FreePublic,
                Some(0),
            )
        } else if base_host.ends_with("github.com") || base_host.ends_with("gitlab.com") {
            (
                "github",
                "GitHub",
                "Code Lab",
                "code_lab",
                CatalogAccessModel::FreePublic,
                Some(0),
            )
        } else if base_host.ends_with("arxiv.org") {
            (
                "arxiv",
                "arXiv",
                "Book",
                "book",
                CatalogAccessModel::FreePublic,
                Some(0),
            )
        } else if base_host.ends_with("oreilly.com") {
            (
                "oreilly",
                "O'Reilly",
                "Book",
                "book",
                CatalogAccessModel::Subscription,
                Some(4900),
            )
        } else if base_host.ends_with("ocw.mit.edu") {
            (
                "mit-ocw",
                "MIT OpenCourseWare",
                "Course",
                "course",
                CatalogAccessModel::FreePublic,
                Some(0),
            )
        } else if base_host.ends_with("deeplearning.ai") {
            (
                "deeplearning-ai",
                "DeepLearning.AI",
                "Course",
                "course",
                CatalogAccessModel::FreemiumTrial,
                Some(0),
            )
        } else if base_host.ends_with("leetcode.com")
            || base_host.ends_with("exercism.org")
            || base_host.ends_with("kaggle.com")
        {
            (
                "practice-platform",
                "Practice Platform",
                "Problem Set",
                "problem_set",
                CatalogAccessModel::FreePublic,
                Some(0),
            )
        } else {
            let root = base_host.split('.').next().unwrap_or("web");
            let display = title_case_word(root);
            return DomainProfile {
                provider_id: format!("manual-{root}"),
                provider_display_name: display,
                category: if path.contains("/course") || notes_lower.contains("course") {
                    "Course"
                } else if notes_lower.contains("video") || notes_lower.contains("lecture") {
                    "YouTube"
                } else if notes_lower.contains("lab") || notes_lower.contains("repo") {
                    "Code Lab"
                } else if notes_lower.contains("problem") || notes_lower.contains("exercise") {
                    "Problem Set"
                } else {
                    "Book"
                },
                resource_type: if path.contains("/course") || notes_lower.contains("course") {
                    "course"
                } else if notes_lower.contains("lab") || notes_lower.contains("repo") {
                    "code_lab"
                } else {
                    "book"
                },
                access_model: if mentions_paid && !mentions_free {
                    CatalogAccessModel::PaidPurchase
                } else {
                    CatalogAccessModel::FreePublic
                },
                default_price_minor: if mentions_paid && !mentions_free {
                    Some(1999)
                } else {
                    Some(0)
                },
            };
        };

    if notes_lower.contains("problem set") || notes_lower.contains("exercises") {
        category = "Problem Set";
        resource_type = "problem_set";
    } else if notes_lower.contains("code lab") {
        category = "Code Lab";
        resource_type = "code_lab";
    }
    if mentions_free {
        access = CatalogAccessModel::FreePublic;
        price = Some(0);
    }

    DomainProfile {
        provider_id: provider_id.to_string(),
        provider_display_name: provider_name.to_string(),
        category,
        resource_type,
        access_model: access,
        default_price_minor: price,
    }
}

fn title_case_word(word: &str) -> String {
    let upper_acronyms = [
        "ckad", "cka", "cks", "k8s", "aws", "gcp", "rag", "llm", "llms", "svd", "pca", "sql",
        "api", "rest", "grpc", "gpu", "cuda", "nlp", "ml", "ai", "rust", "go",
    ];
    let lower = word.to_ascii_lowercase();
    if lower == "rust" || lower == "go" {
        let mut chars = lower.chars();
        return match chars.next() {
            Some(c) => format!("{}{}", c.to_ascii_uppercase(), chars.as_str()),
            None => String::new(),
        };
    }
    if upper_acronyms.contains(&lower.as_str()) {
        return lower.to_ascii_uppercase();
    }
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

fn synthesize_title(canonical_url: &str, notes: &str, category: &str, provider: &str) -> String {
    let after_scheme = canonical_url
        .strip_prefix("https://")
        .unwrap_or(canonical_url);
    let path = after_scheme
        .find('/')
        .map(|idx| &after_scheme[idx + 1..])
        .unwrap_or("");
    let raw_slug = path
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .split('/')
        .rev()
        .find(|seg| {
            !seg.is_empty()
                && !matches!(
                    *seg,
                    "course" | "courses" | "learn" | "watch" | "playlist" | "index.html"
                )
        })
        .unwrap_or("");

    let generic_slugs = ["blah", "blahblah", "test", "example", "item", "view", "id"];
    let slug_words: Vec<String> = raw_slug
        .split(['-', '_', '+'])
        .filter(|w| !w.is_empty() && !w.chars().all(|c| c.is_ascii_digit()))
        .filter(|w| !generic_slugs.contains(&w.to_ascii_lowercase().as_str()))
        .map(title_case_word)
        .collect();

    if slug_words.len() >= 2 {
        return slug_words.join(" ");
    }

    // Fall back to meaningful terms from learner notes (e.g. "this is the ckad course...")
    let filler = [
        "this", "is", "the", "a", "an", "for", "with", "and", "about", "blah", "blahblah", "my",
        "here", "link", "url", "good", "great", "nice", "covering", "covers",
    ];
    let note_words: Vec<String> = notes
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|w| w.len() >= 2)
        .filter(|w| !filler.contains(&w.to_ascii_lowercase().as_str()))
        .take(6)
        .map(title_case_word)
        .collect();

    if !note_words.is_empty() {
        return note_words.join(" ");
    }
    if !slug_words.is_empty() {
        return format!("{} {}", slug_words.join(" "), category);
    }
    format!("{provider} {category}")
}

fn infer_subject(haystack_lower: &str) -> String {
    if [
        "rust",
        "async",
        "concurrency",
        "kernel",
        "linux",
        "kubernetes",
        "ckad",
        "cka",
        "docker",
        "container",
        "helm",
        "distributed",
        "epoll",
        "waker",
    ]
    .iter()
    .any(|kw| haystack_lower.contains(kw))
    {
        "Systems".to_string()
    } else if [
        "linear algebra",
        "eigen",
        "svd",
        "matrix",
        "calculus",
        "theorem",
        "proof",
        "spectral",
    ]
    .iter()
    .any(|kw| haystack_lower.contains(kw))
    {
        "Mathematics".to_string()
    } else if [
        "thermodynamics",
        "physics",
        "quantum",
        "ensemble",
        "ising",
        "boltzmann",
    ]
    .iter()
    .any(|kw| haystack_lower.contains(kw))
    {
        "Physics".to_string()
    } else if ["tolstoy", "literature", "novel", "realism", "narrative"]
        .iter()
        .any(|kw| haystack_lower.contains(kw))
    {
        "Literature".to_string()
    } else {
        "Engineering".to_string()
    }
}

fn extract_topics_and_segments(
    title: &str,
    notes: &str,
    explicit_topics: &[String],
    explicit_segments: &[String],
) -> (Vec<String>, Vec<String>) {
    let mut topics: Vec<String> = explicit_topics
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    let combined = format!("{title} {notes}");
    let combined_lower = combined.to_ascii_lowercase();
    if combined_lower.contains("ckad")
        && !topics.iter().any(|t| t.eq_ignore_ascii_case("kubernetes"))
    {
        topics.push("CKAD".to_string());
        topics.push("Kubernetes".to_string());
    }

    if topics.len() < 4 {
        let stop_noise = [
            "blah", "blahblah", "http", "https", "course", "book", "video",
        ];
        for term in tokenize_search_terms(&combined) {
            if term.len() >= 3
                && !stop_noise.contains(&term.as_str())
                && !topics
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(&term))
            {
                topics.push(term);
                if topics.len() >= 8 {
                    break;
                }
            }
        }
    }
    if topics.is_empty() {
        topics.push("general".to_string());
    }

    let mut segments: Vec<String> = explicit_segments
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if segments.is_empty() {
        // Check if notes mention comma-separated topics after "covering" / "topics:" / "includes"
        let lower_notes = notes.to_ascii_lowercase();
        for marker in ["covering ", "covers ", "topics: ", "includes "] {
            if let Some(idx) = lower_notes.find(marker) {
                let tail = &notes[idx + marker.len()..];
                for part in tail.split([',', ';']) {
                    let cleaned = part
                        .trim()
                        .trim_start_matches("and ")
                        .trim_end_matches('.')
                        .trim();
                    if cleaned.len() >= 3 && !cleaned.to_ascii_lowercase().contains("blah") {
                        segments.push(title_case_phrase(cleaned));
                    }
                }
                break;
            }
        }
    }
    if segments.is_empty() {
        segments.push(format!("{title} — Core Overview"));
        if topics.len() >= 2 {
            segments.push(format!(
                "Applied {} & {}",
                title_case_word(&topics[0]),
                title_case_word(&topics[1])
            ));
        }
    }

    (topics, segments)
}

fn title_case_phrase(phrase: &str) -> String {
    phrase
        .split_whitespace()
        .map(title_case_word)
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_index_descriptor(
    category: &str,
    provider_name: &str,
    summary: &str,
    segments: &[String],
    topics: &[String],
) -> ResourceIndexDescriptor {
    match category {
        "YouTube" => ResourceIndexDescriptor::YoutubePlaylistIndex {
            channel_title: provider_name.to_string(),
            playlist_id: "manual-video".to_string(),
            total_videos: segments.len().max(1) as u32,
            syllabus_items: segments
                .iter()
                .enumerate()
                .map(|(idx, seg)| YoutubeSyllabusItem {
                    segment_id: format!("seg-{}", idx + 1),
                    video_id: format!("vid-{}", idx + 1),
                    index: (idx + 1) as u32,
                    title: seg.clone(),
                    duration_minutes: 25,
                    key_concepts: topics.iter().take(4).cloned().collect(),
                })
                .collect(),
            transcript_outline: Some(summary.to_string()),
        },
        "Course" => ResourceIndexDescriptor::CourseIndex {
            platform: provider_name.to_string(),
            instructors: vec![provider_name.to_string()],
            syllabus_units: segments
                .iter()
                .enumerate()
                .map(|(idx, seg)| CourseSyllabusUnit {
                    segment_id: format!("seg-{}", idx + 1),
                    week_or_unit: format!("Unit {}", idx + 1),
                    title: seg.clone(),
                    lecture_topics: topics.iter().take(4).cloned().collect(),
                    problem_sets: Vec::new(),
                })
                .collect(),
        },
        "Code Lab" => ResourceIndexDescriptor::RepositoryLabIndex {
            repo_full_name: provider_name.to_string(),
            programming_language: "Multi-language".to_string(),
            license_spdx: "LinkOut-Metadata-Only".to_string(),
            lab_exercises: segments
                .iter()
                .enumerate()
                .map(|(idx, seg)| RepositoryLabExercise {
                    segment_id: format!("seg-{}", idx + 1),
                    path: format!("labs/unit-{}", idx + 1),
                    title: seg.clone(),
                    verification_command: "make verify".to_string(),
                    deliverable_summary: summary.to_string(),
                })
                .collect(),
        },
        _ => ResourceIndexDescriptor::BookIndex {
            authors: vec![provider_name.to_string()],
            publisher: provider_name.to_string(),
            edition: None,
            brief_summary: summary.to_string(),
            table_of_contents: segments
                .iter()
                .enumerate()
                .map(|(idx, seg)| BookTocChapter {
                    segment_id: format!("seg-{}", idx + 1),
                    chapter_number: format!("Ch. {}", idx + 1),
                    title: seg.clone(),
                    subtopics: topics.iter().take(4).cloned().collect(),
                    page_range: None,
                })
                .collect(),
            content_excerpts: None,
        },
    }
}

/// Parses, analyzes, validates, persists, and TF-IDF-indexes a manually submitted learning resource,
/// and optionally links it directly into a target learner syllabus.
pub fn ingest_manual_resource(
    store: &InMemoryTransactionalStore,
    principal: &AuthenticatedPrincipal,
    req: &ManualResourceIngestRequest,
) -> Result<ManualResourceIngestReceipt, PersistenceError> {
    let (canonical_url, extracted_notes) =
        extract_url_and_notes_from_freeform(&req.raw_text, req.canonical_url.as_deref())?;
    let host = validate_manual_resource_egress_url(&canonical_url)?;
    let (normalized_url_identity, _) = normalize_canonical_resource_identity(&canonical_url, None);

    let notes_lower = extracted_notes.to_ascii_lowercase();
    let profile = infer_domain_profile(&host, &canonical_url, &notes_lower);

    let category = req
        .category
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(profile.category)
        .to_string();
    let resource_type = req
        .resource_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(profile.resource_type)
        .to_string();
    let provider_display_name = req
        .provider_display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or(profile.provider_display_name);

    let title = req
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            synthesize_title(
                &canonical_url,
                &extracted_notes,
                &category,
                &provider_display_name,
            )
        });

    let haystack_lower = format!(
        "{} {} {} {}",
        title.to_ascii_lowercase(),
        notes_lower,
        canonical_url.to_ascii_lowercase(),
        req.topic_tags.join(" ").to_ascii_lowercase()
    );
    let subject = req
        .subject
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| infer_subject(&haystack_lower));

    let (topic_tags, segments) =
        extract_topics_and_segments(&title, &extracted_notes, &req.topic_tags, &req.segments);

    let description = req
        .description
        .as_deref()
        .or(req.selection_rationale.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            if !extracted_notes.is_empty() {
                extracted_notes.clone()
            } else {
                format!(
                    "{category} from {provider_display_name} covering {}.",
                    topic_tags.join(", ")
                )
            }
        });

    let access_model = req.access_model.unwrap_or(profile.access_model);
    let price_minor_units = req.price_minor_units.or(profile.default_price_minor);

    // Reuse an existing global record without accepting replacement metadata from this request.
    let existing_match = store.list_catalog_resources(false).into_iter().find(|rec| {
        let (rec_norm, _) = normalize_canonical_resource_identity(&rec.canonical_url, None);
        rec_norm == normalized_url_identity
    });
    let is_new_resource = existing_match.is_none();

    let resource_version_id = existing_match
        .as_ref()
        .map(|existing| existing.resource_version_id.clone())
        .or_else(|| {
            req.resource_version_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            let url_hash = &sha256_bytes_hex(normalized_url_identity.as_bytes())[..10];
            let slug: String = title
                .to_ascii_lowercase()
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect::<String>()
                .split('-')
                .filter(|s| !s.is_empty())
                .take(4)
                .collect::<Vec<_>>()
                .join("-");
            let clean_slug = if slug.is_empty() { "resource" } else { &slug };
            format!("manual-{clean_slug}-{url_hash}-v1")
        });
    let resource_id = existing_match
        .as_ref()
        .map(|existing| existing.resource_id.clone())
        .unwrap_or_else(|| {
            resource_version_id
                .strip_suffix("-v1")
                .unwrap_or(&resource_version_id)
                .to_string()
        });

    let enriched_description = if segments.is_empty() {
        description.clone()
    } else {
        format!("{description} Sections: {}.", segments.join("; "))
    };

    let record = existing_match.unwrap_or_else(|| CatalogResourceVersionRecord {
        resource_version_id: resource_version_id.clone(),
        resource_id: resource_id.clone(),
        version_number: 1,
        title: title.clone(),
        provider_id: profile.provider_id,
        provider_display_name: provider_display_name.clone(),
        canonical_url: canonical_url.clone(),
        resource_type: resource_type.clone(),
        language: "en".to_string(),
        description: enriched_description,
        topics: topic_tags.clone(),
        level: "intermediate".to_string(),
        objective_ids: Vec::new(),
        access_model,
        currency: Some("USD".to_string()),
        price_minor_units,
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
            allow_embedding: true,
            allow_redistribution: false,
            license_spdx_or_custom: "LinkOut-Metadata-Only".to_string(),
            requires_attribution: true,
            attribution_text: Some(title.clone()),
            notes: Some("Manual learner library ingestion (link and metadata only).".to_string()),
        },
        is_synthetic_fixture: false,
        metadata_embedding: None,
    });

    if is_new_resource {
        store.insert_catalog_resource(record.clone())?;
    }

    let index_descriptor = build_index_descriptor(
        &category,
        &record.provider_display_name,
        &record.description,
        &segments,
        &record.topics,
    );
    let indexed_candidate = IndexedMaterialCandidate {
        resource_version_id: resource_version_id.clone(),
        resource_id: record.resource_id.clone(),
        title: record.title.clone(),
        resource_type: record.resource_type.clone(),
        subject: subject.clone(),
        topic_tags: record.topics.clone(),
        supported_math_depths: vec![
            "intuition_first".to_string(),
            "applied".to_string(),
            "formal".to_string(),
        ],
        supported_roles: vec!["instruction".to_string(), "practice".to_string()],
        access_model: record.access_model,
        price_minor_units: record.price_minor_units,
        review_status: record.review_status,
        quarantined: false,
        index_descriptor: Some(index_descriptor),
    };

    let query_probe = format!("{} {}", record.title, record.topics.join(" "));
    let tfidf_corpus_document_count = store.catalog_tfidf_document_count();
    let tfidf_self_match_score = store
        .rank_catalog_tfidf(&query_probe)
        .into_iter()
        .find_map(|(id, score)| (id == resource_version_id).then_some(score))
        .unwrap_or(0.0);

    let syllabus_binding = if let Some(cur_id) = req
        .syllabus_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let segment_ids: Vec<String> = (0..segments.len())
            .map(|idx| format!("seg-{}", idx + 1))
            .collect();
        let (_, binding_receipt) = store.upsert_syllabus_resource_binding(
            principal,
            cur_id,
            SyllabusResourceBindingInput {
                resource_version_id,
                module_id: req.module_id.clone(),
                activity_id: req.activity_id.clone(),
                activity_title: None,
                role: req.role.clone(),
                requirement_level: None,
                segment_ids,
                selection_rationale: Some(
                    req.selection_rationale
                        .clone()
                        .unwrap_or_else(|| description.clone()),
                ),
            },
        )?;
        Some(binding_receipt)
    } else {
        None
    };

    Ok(ManualResourceIngestReceipt {
        resource: record,
        indexed_candidate,
        extracted_notes,
        category,
        subject,
        segments,
        tfidf_corpus_document_count,
        tfidf_self_match_score,
        syllabus_binding,
    })
}
