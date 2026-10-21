//! Catalog access models, review states, acquisition permissions, goal intake, and SSRF egress validation.

use crate::*;
use serde::{Deserialize, Serialize};

/// Catalog access pricing model (`CAT-005`, `@S05`, `@S06`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogAccessModel {
    FreePublic,
    PaidPurchase,
    Subscription,
    FreemiumTrial,
    UnknownPrice,
}

/// Curator review lifecycle state for a catalog resource version (`CAT-002`, `@S04`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceReviewStatus {
    Approved,
    UnderReview,
    Quarantined,
    Rejected,
    Withdrawn,
    Deprecated,
}

/// Freshness state for a catalog resource version (`CAT-004`, `@S07`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceFreshnessState {
    Healthy,
    Degraded,
    Broken,
    Unchecked,
}

/// Operation attempted against a catalog resource (`CAT-003`, `@S05`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceOperationKind {
    Metadata,
    LinkOut,
    ShortExcerpt,
    FullTextStorage,
    Embedding,
    Redistribution,
}

impl ResourceOperationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ResourceOperationKind::Metadata => "metadata",
            ResourceOperationKind::LinkOut => "link_out",
            ResourceOperationKind::ShortExcerpt => "short_excerpt",
            ResourceOperationKind::FullTextStorage => "full_text_storage",
            ResourceOperationKind::Embedding => "embedding",
            ResourceOperationKind::Redistribution => "redistribution",
        }
    }
}

/// Granular acquisition and rights permission matrix (`CAT-003`, `@S05`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcquisitionPermission {
    pub allow_metadata: bool,
    pub allow_link_out: bool,
    pub allow_short_excerpt: bool,
    pub allow_full_text_storage: bool,
    pub allow_embedding: bool,
    pub allow_redistribution: bool,
    pub license_spdx_or_custom: String,
    pub requires_attribution: bool,
    pub attribution_text: Option<String>,
    pub notes: Option<String>,
}

impl AcquisitionPermission {
    /// Pure domain policy evaluating whether `operation` is permitted by this rights record (`CAT-003`, `@S05`).
    pub fn permits(&self, operation: ResourceOperationKind) -> bool {
        match operation {
            ResourceOperationKind::Metadata => self.allow_metadata,
            ResourceOperationKind::LinkOut => self.allow_link_out,
            ResourceOperationKind::ShortExcerpt => self.allow_short_excerpt,
            ResourceOperationKind::FullTextStorage => self.allow_full_text_storage,
            ResourceOperationKind::Embedding => self.allow_embedding,
            ResourceOperationKind::Redistribution => self.allow_redistribution,
        }
    }
}

/// Normalized learner goal specification value object (`GOAL-001`..`GOAL-005`, `T03`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalSpecification {
    pub topic: String,
    pub target_role_or_outcome: String,
    pub prior_background_level: String,
    pub weekly_available_minutes: u32,
    pub horizon_weeks: u32,
    pub free_only: bool,
    pub budget_currency: String,
    pub max_budget_minor_units: u64,
    pub owned_subscription_ids: Vec<String>,
    pub allow_paid_fallback: bool,
    pub include_optional_certification: bool,
    pub clarifying_questions: Vec<String>,
    pub proposed_objectives: Vec<String>,
    pub feasibility_warning: Option<String>,
}

/// Single authoritative outbound URL egress validator enforcing HTTPS scheme,
/// rejection of userinfo credentials, loopback/private/link-local/metadata IP ranges,
/// and DNS host allowlist membership (`CAT-003`, `@S08`, `@S31`, `@S35`).
pub fn validate_outbound_egress_url(
    url: &str,
    allowed_hosts: &[&str],
) -> Result<String, DomainError> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "only https:// URLs are permitted for outbound catalog egress".to_string(),
        });
    }
    let after_scheme = &trimmed["https://".len()..];
    let authority = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "missing URL host authority".to_string(),
        });
    }
    if authority.contains('@') {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "URL userinfo credentials are forbidden".to_string(),
        });
    }

    let host = if authority.starts_with('[') {
        authority
            .split(']')
            .next()
            .unwrap_or(authority)
            .trim_start_matches('[')
            .to_ascii_lowercase()
    } else {
        authority
            .split(':')
            .next()
            .unwrap_or(authority)
            .to_ascii_lowercase()
    };

    if host.is_empty() {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "empty host in URL".to_string(),
        });
    }

    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host == "::1"
        || host == "0:0:0:0:0:0:0:1"
        || host.starts_with("fc")
        || host.starts_with("fd")
        || host.starts_with("fe80:")
        || host.contains(':')
    {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: format!("loopback, internal, or IPv6 literal host `{host}` is forbidden"),
        });
    }

    let ipv4_parts: Vec<&str> = host.split('.').collect();
    if ipv4_parts
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
    {
        if ipv4_parts.len() == 4 {
            let octets: Result<Vec<u8>, _> = ipv4_parts.iter().map(|p| p.parse::<u8>()).collect();
            if let Ok(o) = octets {
                let (a, b) = (o[0], o[1]);
                let is_private_or_reserved = a == 0
                    || a == 10
                    || a == 127
                    || (a == 169 && b == 254)
                    || (a == 172 && (16..=31).contains(&b))
                    || (a == 192 && b == 168)
                    || (a == 100 && (64..=127).contains(&b))
                    || a >= 224;
                if is_private_or_reserved {
                    return Err(DomainError::UnsafeEgressUrl {
                        url: url.to_string(),
                        reason: format!(
                            "private, loopback, link-local, or metadata IPv4 `{host}` is forbidden"
                        ),
                    });
                }
            }
        }
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: format!("raw IP literal `{host}` is forbidden; use an allowlisted DNS host"),
        });
    }

    if !allowed_hosts.is_empty() {
        let host_allowed = allowed_hosts.iter().any(|allowed| {
            let allowed_lower = allowed.to_ascii_lowercase();
            if let Some(suffix) = allowed_lower.strip_prefix("*.") {
                host == suffix || host.ends_with(&format!(".{suffix}"))
            } else {
                host == allowed_lower
            }
        });
        if !host_allowed {
            return Err(DomainError::UnsafeEgressUrl {
                url: url.to_string(),
                reason: format!("host `{host}` is not in the outbound egress allowlist"),
            });
        }
    }

    Ok(host)
}
