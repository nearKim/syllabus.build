//! Public templates, snapshot sanitization, moderation, adoption, and account lifecycle.

use crate::*;
use curriculum_contracts::jcs::{jcs_sha256_hex, sha256_bytes_hex};
use curriculum_security::{AuthenticatedPrincipal, PrincipalRole};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
impl InMemoryTransactionalStore {
    // =========================================================================
    // T13: Public Templates, Sanitization, Preview Digest, Discovery,
    //      Owner Management, Withdrawal, Reports, Moderation, Upvotes & Adoption
    // =========================================================================

    pub(crate) fn build_sanitized_public_envelope(
        guard: &StoreInner,
        curriculum_id: &str,
        source_rev: &CurriculumRevisionRecord,
        visibility: ModerationVisibilityState,
        publisher_display_name: &str,
        attribution_text: &str,
    ) -> Result<
        (
            Value,
            Value,
            Value,
            Value,
            String,
            String,
            Vec<String>,
            Vec<String>,
        ),
        PersistenceError,
    > {
        let root = curriculum_contracts::workspace_root();
        let synthetic_path =
            root.join("specs/001-curriculum-platform/examples/public-curriculum.synthetic.json");
        let base_doc: Value = serde_json::from_str(
            &std::fs::read_to_string(&synthetic_path)
                .map_err(|e| PersistenceError::Validation(e.to_string()))?,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let mut stripped_private_fields = vec![
            "account_id".to_string(),
            "owner_account_id".to_string(),
            "private_notes".to_string(),
            "attempt_history".to_string(),
            "schedule_revisions".to_string(),
            "reminder_preferences".to_string(),
            "provider_credentials".to_string(),
            "proficiency_records".to_string(),
        ];
        let mut withheld_restricted_fields = vec![
            "full_text_excerpt".to_string(),
            "transcript_body".to_string(),
        ];

        if let Some(priv_obj) = source_rev.payload.as_object() {
            for k in priv_obj.keys() {
                if PublicSnapshotSanitizer::is_private_learner_field(k)
                    && !stripped_private_fields.contains(k)
                {
                    stripped_private_fields.push(k.clone());
                }
                if PublicSnapshotSanitizer::is_restricted_third_party_field(k)
                    && !withheld_restricted_fields.contains(k)
                {
                    withheld_restricted_fields.push(k.clone());
                }
            }
        }

        let mut content = base_doc["content"].clone();
        if let Some(title) = source_rev.payload.get("title").and_then(|v| v.as_str()) {
            content["title"] = Value::String(title.to_string());
        } else {
            content["title"] = Value::String(format!("Public Template — {curriculum_id}"));
        }
        if let Some(summary) = source_rev.payload.get("summary").and_then(|v| v.as_str()) {
            content["summary"] = Value::String(summary.to_string());
        }

        // Verify that any catalog resource versions referenced in the private revision are not quarantined or prohibited
        if let Some(rv_ids) = source_rev
            .payload
            .get("resource_version_ids")
            .and_then(|v| v.as_array())
        {
            let mut checked_ids = Vec::new();
            for rv_val in rv_ids {
                if let Some(rv_id) = rv_val.as_str() {
                    if let Some(overlay) = guard.quarantine_overlays.get(rv_id) {
                        if overlay.lifted_at.is_none() {
                            return Err(PersistenceError::IneligibleCatalogResource {
                                resource_version_id: rv_id.to_string(),
                                reason: "cannot publish curriculum referencing quarantined catalog resource".to_string(),
                            });
                        }
                    }
                    checked_ids.push(Value::String(rv_id.to_string()));
                }
            }
            if !checked_ids.is_empty() {
                content["resource_version_ids"] = Value::Array(checked_ids);
            }
        }

        // Validate sanitized keys via pure domain policy
        let present_keys: Vec<String> = content
            .as_object()
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default();
        PublicSnapshotSanitizer::validate_sanitized_field_keys(&present_keys, &[])
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let public_author_hash = &sha256_bytes_hex(source_rev.owner_account_id.as_bytes())[..12];
        let publisher = json!({
            "public_author_id": format!("public-author-{public_author_hash}"),
            "display_name": publisher_display_name
        });
        let publication_terms = json!({
            "policy_id": "synthetic-publication-terms-v1",
            "content_license_id": "synthetic-unadopted-content-license",
            "rights_scope": "eligible_original_annotations_and_structure",
            "attribution": attribution_text,
            "third_party_materials_excluded": true
        });
        let origin = Value::Null;

        let content_sha256 = jcs_sha256_hex(&content);
        let preview_envelope = json!({
            "curriculum_id": curriculum_id,
            "source_revision_id": source_rev.revision_id,
            "visibility": visibility.as_str(),
            "publisher": publisher,
            "publication_terms": publication_terms,
            "origin": origin,
            "content_sha256": content_sha256,
        });
        let preview_sha256 = jcs_sha256_hex(&preview_envelope);

        Ok((
            content,
            publisher,
            publication_terms,
            origin,
            content_sha256,
            preview_sha256,
            stripped_private_fields,
            withheld_restricted_fields,
        ))
    }

    /// Generates a sanitized publication preview with `preview_sha256` (`T13`, `SHARE-001`, `SHARE-002`, `SHARE-009`, `@S56`, `@S57`, `@S79`).
    pub fn preview_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        visibility: ModerationVisibilityState,
        publisher_display_name: Option<&str>,
        attribution_text: Option<&str>,
    ) -> Result<PublicationPreviewRecord, PersistenceError> {
        if !matches!(
            visibility,
            ModerationVisibilityState::Public | ModerationVisibilityState::Unlisted
        ) {
            return Err(PersistenceError::Validation(
                "publication preview visibility must be `public` or `unlisted`".to_string(),
            ));
        }

        let mut guard = self.inner.write().expect("store write lock");
        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == curriculum_id)
            .collect();
        let owner_id = revs
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "curriculum",
                resource_id: curriculum_id.to_string(),
            })?
            .owner_account_id
            .clone();
        principal.require_learner_ownership(&owner_id)?;

        revs.sort_by_key(|r| r.revision_number);
        let active_rev = (*revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .unwrap_or_else(|| revs.last().expect("at least one revision")))
        .clone();

        let display_name = publisher_display_name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Example learner");
        let attribution = attribution_text
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Synthetic author; no external provider endorsement.");

        let (
            sanitized_content,
            publisher,
            publication_terms,
            origin,
            content_sha256,
            preview_sha256,
            stripped_private_fields,
            withheld_restricted_fields,
        ) = Self::build_sanitized_public_envelope(
            &guard,
            curriculum_id,
            &active_rev,
            visibility,
            display_name,
            attribution,
        )?;

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let preview_id = format!("pubprev-{seq}");

        let record = PublicationPreviewRecord {
            preview_id: preview_id.clone(),
            account_id: principal.account_id.clone(),
            curriculum_id: curriculum_id.to_string(),
            source_revision_id: active_rev.revision_id,
            visibility,
            publisher_display_name: display_name.to_string(),
            attribution_text: attribution.to_string(),
            preview_sha256,
            content_sha256,
            stripped_private_fields,
            withheld_restricted_fields,
            sanitized_content,
            publication_terms,
            publisher,
            origin,
            expires_at: "2026-04-03T19:00:00Z".to_string(),
        };
        guard
            .publication_previews
            .insert(preview_id, record.clone());
        Ok(record)
    }

    /// Confirms and publishes a new public or unlisted curriculum template (`T13`, `SHARE-001`, `SHARE-007`, `SHARE-009`, `@S56`, `@S61`, `@S79`).
    pub fn publish_curriculum(
        &self,
        principal: &AuthenticatedPrincipal,
        preview_id: Option<&str>,
        curriculum_id: Option<&str>,
        publication_id: Option<&str>,
        expected_preview_sha256: &str,
        accept_publication_terms: bool,
        visibility_override: Option<ModerationVisibilityState>,
    ) -> Result<PublicationViewRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");

        // Resolve preview by preview_id or latest preview for (account_id, curriculum_id / expected_preview_sha256)
        let preview = if let Some(pid) = preview_id {
            guard.publication_previews.get(pid).cloned()
        } else {
            guard
                .publication_previews
                .values()
                .rev()
                .find(|p| {
                    p.account_id == principal.account_id
                        && (curriculum_id.map(|cid| p.curriculum_id == cid).unwrap_or(true))
                })
                .cloned()
        }
        .ok_or_else(|| PersistenceError::NotFound {
            resource_type: "publication_preview",
            resource_id: preview_id.unwrap_or("latest").to_string(),
        })?;

        principal.require_learner_ownership(&preview.account_id)?;

        // Recompute current envelope from current active revision of the source curriculum (@S79, @S83)
        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == preview.curriculum_id)
            .collect();
        revs.sort_by_key(|r| r.revision_number);
        let current_active_rev = (*revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .unwrap_or_else(|| revs.last().expect("at least one revision")))
        .clone();

        let effective_visibility = visibility_override.unwrap_or(preview.visibility);
        let (_, _, _, _, current_content_sha256, current_computed_preview_sha256, _, _) =
            Self::build_sanitized_public_envelope(
                &guard,
                &preview.curriculum_id,
                &current_active_rev,
                effective_visibility,
                &preview.publisher_display_name,
                &preview.attribution_text,
            )?;

        let digest_verifier = PublicationPreviewDigest {
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            visibility: preview.visibility.as_str().to_string(),
        };
        digest_verifier
            .validate_publication_confirmation(
                expected_preview_sha256,
                &current_computed_preview_sha256,
                accept_publication_terms,
            )
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("stale or mismatched") {
                    PersistenceError::Conflict {
                        code: "preview_digest_mismatch",
                        message: msg,
                    }
                } else {
                    PersistenceError::Validation(msg)
                }
            })?;

        // Reject duplicate content_sha256 across published templates (`SHARE-007`, `@S61`)
        if let Some(dup) = guard
            .publication_revisions
            .values()
            .find(|r| r.content_sha256 == current_content_sha256)
        {
            return Err(PersistenceError::DuplicatePublicRevisionContent {
                publication_id: dup.publication_id.clone(),
                content_sha256: current_content_sha256,
            });
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_pub_id = publication_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("pub-template-{seq:03}"));
        let resolved_pub_rev_id = format!("pubrev-{resolved_pub_id}-v1");

        let snapshot = json!({
            "schema_version": "0.2.0",
            "publication_id": resolved_pub_id,
            "publication_revision_id": resolved_pub_rev_id,
            "revision_number": 1,
            "supersedes_publication_revision_id": Value::Null,
            "publisher": preview.publisher,
            "published_at": "2026-10-20T16:00:00Z",
            "content_sha256": preview.content_sha256,
            "content": preview.sanitized_content,
            "publication_terms": preview.publication_terms,
            "origin": preview.origin
        });

        let registry = curriculum_contracts::ContractRegistry::load_from_workspace()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
        registry
            .validate("public-curriculum.schema.json", &snapshot)
            .map_err(|e| {
                PersistenceError::Validation(format!("public-curriculum.schema.json error: {e}"))
            })?;

        let public_author_id = snapshot["publisher"]["public_author_id"]
            .as_str()
            .unwrap_or("public-author-001")
            .to_string();

        let pub_record = PublicationRecord {
            publication_id: resolved_pub_id.clone(),
            owner_account_id: Some(principal.account_id.clone()),
            source_curriculum_id: preview.curriculum_id.clone(),
            public_author_id,
            publisher_display_name: preview.publisher_display_name.clone(),
            visibility: effective_visibility,
            pre_moderation_visibility: effective_visibility,
            current_revision_id: resolved_pub_rev_id.clone(),
            latest_revision_number: 1,
            etag_version: 1,
            etag: "\"pub-mgmt-v1\"".to_string(),
            published_at: "2026-10-20T16:00:00Z".to_string(),
            updated_at: "2026-10-20T16:00:00Z".to_string(),
            withdrawn_at: None,
        };

        let rev_record = PublicationRevisionRecord {
            publication_revision_id: resolved_pub_rev_id.clone(),
            publication_id: resolved_pub_id.clone(),
            revision_number: 1,
            supersedes_publication_revision_id: None,
            source_curriculum_revision_id: preview.source_revision_id.clone(),
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            upvote_count: 0,
            snapshot: snapshot.clone(),
            published_at: "2026-10-20T16:00:00Z".to_string(),
        };

        let title = snapshot["content"]["title"]
            .as_str()
            .unwrap_or("Published Curriculum")
            .to_string();
        let summary = snapshot["content"]["summary"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let topic_id = snapshot["content"]["topic_ids"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("topic-tokenization")
            .to_string();

        guard
            .publications
            .insert(resolved_pub_id.clone(), pub_record);
        guard
            .publication_revisions
            .insert(resolved_pub_rev_id.clone(), rev_record);

        Ok(PublicationViewRecord {
            publication_id: resolved_pub_id,
            publication_revision_id: resolved_pub_rev_id,
            revision_number: 1,
            visibility: effective_visibility.as_str().to_string(),
            title,
            summary,
            topic_id,
            publisher_display_name: preview.publisher_display_name,
            content_sha256: preview.content_sha256,
            upvote_count: 0,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
            snapshot,
            published_at: "2026-10-20T16:00:00Z".to_string(),
        })
    }

    /// Publishes a new revision of an existing owned publication (`T13`, `SHARE-007`, `@S61`, `@S79`).
    /// Starts the new revision with `upvote_count: 0` (votes never carry over across revisions).
    pub fn publish_publication_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        if_match: Option<&str>,
        preview_id: Option<&str>,
        expected_preview_sha256: &str,
        accept_publication_terms: bool,
    ) -> Result<PublicationViewRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let existing_pub = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        let owner_id = existing_pub
            .owner_account_id
            .as_deref()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        principal.require_learner_ownership(owner_id)?;
        evaluate_if_match(if_match, &existing_pub.etag)?;

        let preview = if let Some(pid) = preview_id {
            guard.publication_previews.get(pid).cloned()
        } else {
            guard
                .publication_previews
                .values()
                .rev()
                .find(|p| {
                    p.account_id == principal.account_id
                        && p.curriculum_id == existing_pub.source_curriculum_id
                })
                .cloned()
        }
        .ok_or_else(|| PersistenceError::NotFound {
            resource_type: "publication_preview",
            resource_id: preview_id.unwrap_or("latest").to_string(),
        })?;

        let mut revs: Vec<&CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.curriculum_id == existing_pub.source_curriculum_id)
            .collect();
        revs.sort_by_key(|r| r.revision_number);
        let current_active_rev = (*revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .unwrap_or_else(|| revs.last().expect("at least one revision")))
        .clone();

        let (_, _, _, _, current_content_sha256, current_computed_preview_sha256, _, _) =
            Self::build_sanitized_public_envelope(
                &guard,
                &existing_pub.source_curriculum_id,
                &current_active_rev,
                preview.visibility,
                &preview.publisher_display_name,
                &preview.attribution_text,
            )?;

        let digest_verifier = PublicationPreviewDigest {
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            visibility: preview.visibility.as_str().to_string(),
        };
        digest_verifier
            .validate_publication_confirmation(
                expected_preview_sha256,
                &current_computed_preview_sha256,
                accept_publication_terms,
            )
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("stale or mismatched") {
                    PersistenceError::Conflict {
                        code: "preview_digest_mismatch",
                        message: msg,
                    }
                } else {
                    PersistenceError::Validation(msg)
                }
            })?;

        if guard
            .publication_revisions
            .values()
            .any(|r| r.content_sha256 == current_content_sha256)
        {
            return Err(PersistenceError::DuplicatePublicRevisionContent {
                publication_id: publication_id.to_string(),
                content_sha256: current_content_sha256,
            });
        }

        let next_rev_num = existing_pub.latest_revision_number + 1;
        let new_pub_rev_id = format!("pubrev-{publication_id}-v{next_rev_num}");
        let snapshot = json!({
            "schema_version": "0.2.0",
            "publication_id": publication_id,
            "publication_revision_id": new_pub_rev_id,
            "revision_number": next_rev_num,
            "supersedes_publication_revision_id": existing_pub.current_revision_id,
            "publisher": preview.publisher,
            "published_at": "2026-10-20T17:00:00Z",
            "content_sha256": preview.content_sha256,
            "content": preview.sanitized_content,
            "publication_terms": preview.publication_terms,
            "origin": preview.origin
        });

        let registry = curriculum_contracts::ContractRegistry::load_from_workspace()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
        registry
            .validate("public-curriculum.schema.json", &snapshot)
            .map_err(|e| {
                PersistenceError::Validation(format!("public-curriculum.schema.json error: {e}"))
            })?;

        let rev_record = PublicationRevisionRecord {
            publication_revision_id: new_pub_rev_id.clone(),
            publication_id: publication_id.to_string(),
            revision_number: next_rev_num,
            supersedes_publication_revision_id: Some(existing_pub.current_revision_id.clone()),
            source_curriculum_revision_id: preview.source_revision_id.clone(),
            preview_sha256: preview.preview_sha256.clone(),
            content_sha256: preview.content_sha256.clone(),
            upvote_count: 0,
            snapshot: snapshot.clone(),
            published_at: "2026-10-20T17:00:00Z".to_string(),
        };
        guard
            .publication_revisions
            .insert(new_pub_rev_id.clone(), rev_record);

        if let Some(pub_mut) = guard.publications.get_mut(publication_id) {
            pub_mut.current_revision_id = new_pub_rev_id.clone();
            pub_mut.latest_revision_number = next_rev_num;
            pub_mut.visibility = preview.visibility;
            pub_mut.pre_moderation_visibility = preview.visibility;
            pub_mut.etag_version += 1;
            pub_mut.etag = format!("\"pub-mgmt-v{}\"", pub_mut.etag_version);
            pub_mut.updated_at = "2026-10-20T17:00:00Z".to_string();
        }

        let title = snapshot["content"]["title"]
            .as_str()
            .unwrap_or("Published Curriculum")
            .to_string();
        let summary = snapshot["content"]["summary"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let topic_id = snapshot["content"]["topic_ids"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("topic-tokenization")
            .to_string();

        Ok(PublicationViewRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: new_pub_rev_id,
            revision_number: next_rev_num,
            visibility: preview.visibility.as_str().to_string(),
            title,
            summary,
            topic_id,
            publisher_display_name: preview.publisher_display_name,
            content_sha256: preview.content_sha256,
            upvote_count: 0,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
            snapshot,
            published_at: "2026-10-20T17:00:00Z".to_string(),
        })
    }

    pub(crate) fn publication_has_quarantined_resource(
        guard: &StoreInner,
        rev: &PublicationRevisionRecord,
    ) -> bool {
        if let Some(rv_ids) = rev
            .snapshot
            .get("content")
            .and_then(|c| c.get("resource_version_ids"))
            .and_then(|v| v.as_array())
        {
            for rv_val in rv_ids {
                if let Some(rv_id) = rv_val.as_str() {
                    if let Some(overlay) = guard.quarantine_overlays.get(rv_id) {
                        if overlay.lifted_at.is_none() {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    /// Lists public templates for discovery (`T13`, `SHARE-003`, `SHARE-006`, `@S58`, `@S62`, `@S63`, `@S64`).
    /// Never includes `unlisted`, `withdrawn`, `quarantined`, or `removed` templates.
    pub fn discover_public_publications(
        &self,
        query: Option<&str>,
        topic_id: Option<&str>,
        sort: Option<&str>,
    ) -> Vec<PublicationViewRecord> {
        let guard = self.inner.read().expect("store read lock");
        let mut items = Vec::new();

        for pub_rec in guard.publications.values() {
            if !pub_rec.visibility.is_listed_in_public_discovery() {
                continue;
            }
            let Some(rev) = guard.publication_revisions.get(&pub_rec.current_revision_id) else {
                continue;
            };
            if Self::publication_has_quarantined_resource(&guard, rev) {
                continue;
            }
            let title = rev.snapshot["content"]["title"]
                .as_str()
                .unwrap_or("Published Curriculum")
                .to_string();
            let summary = rev.snapshot["content"]["summary"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let rev_topic_id = rev.snapshot["content"]["topic_ids"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("topic-tokenization")
                .to_string();

            if let Some(q) = query.map(str::trim).filter(|s| !s.is_empty()) {
                let q_low = q.to_ascii_lowercase();
                if !title.to_ascii_lowercase().contains(&q_low)
                    && !summary.to_ascii_lowercase().contains(&q_low)
                {
                    continue;
                }
            }
            if let Some(tid) = topic_id.map(str::trim).filter(|s| !s.is_empty()) {
                if rev_topic_id != tid {
                    continue;
                }
            }

            items.push(PublicationViewRecord {
                publication_id: pub_rec.publication_id.clone(),
                publication_revision_id: rev.publication_revision_id.clone(),
                revision_number: rev.revision_number,
                visibility: pub_rec.visibility.as_str().to_string(),
                title,
                summary,
                topic_id: rev_topic_id,
                publisher_display_name: pub_rec.publisher_display_name.clone(),
                content_sha256: rev.content_sha256.clone(),
                upvote_count: rev.upvote_count,
                upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
                snapshot: rev.snapshot.clone(),
                published_at: rev.published_at.clone(),
            });
        }

        if sort == Some("upvotes") {
            items.sort_by(|a, b| {
                b.upvote_count
                    .cmp(&a.upvote_count)
                    .then_with(|| a.publication_id.cmp(&b.publication_id))
            });
        } else {
            items.sort_by(|a, b| {
                b.published_at
                    .cmp(&a.published_at)
                    .then_with(|| a.publication_id.cmp(&b.publication_id))
            });
        }
        items
    }

    /// Reads a `public` or `unlisted` publication via direct link (`T13`, `SHARE-003`, `SHARE-008`, `@S58`, `@S63`, `@S64`, `@S80`).
    /// Returns `404` for `withdrawn`, `quarantined`, or `removed` publications.
    pub fn get_public_publication_view(
        &self,
        publication_id: &str,
        publication_revision_id: Option<&str>,
    ) -> Result<PublicationViewRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;

        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }

        let target_rev_id = publication_revision_id.unwrap_or(&pub_rec.current_revision_id);
        let rev = guard
            .publication_revisions
            .get(target_rev_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: target_rev_id.to_string(),
            })?;

        let title = rev.snapshot["content"]["title"]
            .as_str()
            .unwrap_or("Published Curriculum")
            .to_string();
        let summary = rev.snapshot["content"]["summary"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let topic_id = rev.snapshot["content"]["topic_ids"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("topic-tokenization")
            .to_string();

        Ok(PublicationViewRecord {
            publication_id: pub_rec.publication_id.clone(),
            publication_revision_id: rev.publication_revision_id.clone(),
            revision_number: rev.revision_number,
            visibility: pub_rec.visibility.as_str().to_string(),
            title,
            summary,
            topic_id,
            publisher_display_name: pub_rec.publisher_display_name.clone(),
            content_sha256: rev.content_sha256.clone(),
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
            snapshot: rev.snapshot.clone(),
            published_at: rev.published_at.clone(),
        })
    }

    /// Lists the authenticated owner's publications across active, quarantined, and withdrawn states (`@S80`, `@S85`, `@S86`).
    /// Withheld fields (`public_url`, `public_upvote_count`) are `None` (`null`, never `0`) when quarantined or withdrawn.
    pub fn list_owned_publications(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<OwnedPublicationSummaryRecord> {
        let guard = self.inner.read().expect("store read lock");
        let mut out = Vec::new();
        for pub_rec in guard.publications.values() {
            if pub_rec.owner_account_id.as_deref() != Some(principal.account_id.as_str()) {
                continue;
            }
            let readable = pub_rec.visibility.is_readable_via_direct_link();
            let rev = guard.publication_revisions.get(&pub_rec.current_revision_id);
            let title = if readable {
                rev.and_then(|r| r.snapshot["content"]["title"].as_str())
                    .map(str::to_string)
            } else {
                None
            };
            let public_url = if readable {
                Some(format!("/v1/publications/{}", pub_rec.publication_id))
            } else {
                None
            };
            let public_upvote_count = if readable {
                rev.map(|r| r.upvote_count)
            } else {
                None
            };
            out.push(OwnedPublicationSummaryRecord {
                publication_id: pub_rec.publication_id.clone(),
                source_curriculum_id: pub_rec.source_curriculum_id.clone(),
                current_revision_id: pub_rec.current_revision_id.clone(),
                latest_revision_number: pub_rec.latest_revision_number,
                visibility: pub_rec.visibility.as_str().to_string(),
                title,
                public_url,
                public_upvote_count,
                updated_at: pub_rec.updated_at.clone(),
            });
        }
        out
    }

    /// Reads owner publication management state and lifecycle ETag even while quarantined or withdrawn (`@S80`, `@S85`, `@S86`).
    pub fn get_owned_publication_management(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
    ) -> Result<OwnedPublicationManagementRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if pub_rec.owner_account_id.as_deref() != Some(principal.account_id.as_str()) {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let readable = pub_rec.visibility.is_readable_via_direct_link();
        let rev = guard.publication_revisions.get(&pub_rec.current_revision_id);
        Ok(OwnedPublicationManagementRecord {
            publication_id: pub_rec.publication_id.clone(),
            source_curriculum_id: pub_rec.source_curriculum_id.clone(),
            current_revision_id: pub_rec.current_revision_id.clone(),
            latest_revision_number: pub_rec.latest_revision_number,
            visibility: pub_rec.visibility.as_str().to_string(),
            public_readability: readable,
            public_url: if readable {
                Some(format!("/v1/publications/{}", pub_rec.publication_id))
            } else {
                None
            },
            public_upvote_count: if readable {
                rev.map(|r| r.upvote_count)
            } else {
                None
            },
            etag: pub_rec.etag.clone(),
            published_at: pub_rec.published_at.clone(),
            updated_at: pub_rec.updated_at.clone(),
            withdrawn_at: pub_rec.withdrawn_at.clone(),
        })
    }

    /// Lists revision metadata for an owned publication even while public content is unavailable (`@S85`).
    pub fn list_owned_publication_revisions(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
    ) -> Result<Vec<OwnedPublicationRevisionItem>, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if pub_rec.owner_account_id.as_deref() != Some(principal.account_id.as_str()) {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let readable = pub_rec.visibility.is_readable_via_direct_link();
        let mut revs: Vec<&PublicationRevisionRecord> = guard
            .publication_revisions
            .values()
            .filter(|r| r.publication_id == publication_id)
            .collect();
        revs.sort_by(|a, b| b.revision_number.cmp(&a.revision_number));
        Ok(revs
            .into_iter()
            .map(|r| OwnedPublicationRevisionItem {
                publication_revision_id: r.publication_revision_id.clone(),
                publication_id: r.publication_id.clone(),
                revision_number: r.revision_number,
                source_curriculum_revision_id: r.source_curriculum_revision_id.clone(),
                content_sha256: r.content_sha256.clone(),
                public_readability: readable,
                upvote_count: if readable { Some(r.upvote_count) } else { None },
                published_at: r.published_at.clone(),
            })
            .collect())
    }

    /// Withdraws all revisions of an owned publication from public/unlisted access while preserving
    /// adopter-owned private copies (`T13`, `SHARE-008`, `@S63`, `@S80`).
    pub fn unpublish_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        if_match: Option<&str>,
    ) -> Result<OwnedPublicationManagementRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let (owner_opt, current_etag, already_withdrawn) = {
            let pub_rec = guard
                .publications
                .get(publication_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "publication",
                    resource_id: publication_id.to_string(),
                })?;
            (
                pub_rec.owner_account_id.clone(),
                pub_rec.etag.clone(),
                pub_rec.visibility == ModerationVisibilityState::Withdrawn,
            )
        };
        if owner_opt.as_deref() != Some(principal.account_id.as_str()) {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        if already_withdrawn {
            // Per OpenAPI spec: if already withdrawn, require non-empty If-Match header (428 if missing) and succeed idempotently
            let _ = if_match
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or(PersistenceError::PreconditionRequired)?;
        } else {
            evaluate_if_match(if_match, &current_etag)?;
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard.deletion_tombstones.push(DeletionTombstone {
                tombstone_id: format!("tomb-pub-{seq}"),
                entity_type: TombstoneEntityType::ResourceWithdrawn,
                account_id: principal.account_id.clone(),
                target_id: publication_id.to_string(),
                reason: "owner withdrew publication".to_string(),
                recorded_at_ms: 1_775_000_000_000,
                applied_after_restore_at_ms: None,
            });
            if let Some(pub_mut) = guard.publications.get_mut(publication_id) {
                pub_mut.visibility = ModerationVisibilityState::Withdrawn;
                pub_mut.withdrawn_at = Some("2026-10-20T18:00:00Z".to_string());
                pub_mut.updated_at = "2026-10-20T18:00:00Z".to_string();
                pub_mut.etag_version += 1;
                pub_mut.etag = format!("\"pub-mgmt-v{}\"", pub_mut.etag_version);
            }
        }
        drop(guard);
        self.get_owned_publication_management(principal, publication_id)
    }

    /// Submits an abuse or rights report on a publication (`T13`, `SHARE-010`, `@S64`, `@S65`).
    pub fn report_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: Option<&str>,
        reason_code: &str,
        details: &str,
    ) -> Result<PublicationReportRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        let rev_id = publication_revision_id
            .unwrap_or(&pub_rec.current_revision_id)
            .to_string();
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let report = PublicationReportRecord {
            report_id: format!("pubrep-{seq}"),
            publication_id: publication_id.to_string(),
            publication_revision_id: rev_id,
            reporter_account_id: principal.account_id.clone(),
            reason_code: reason_code.to_string(),
            details: details.to_string(),
            status: "open".to_string(),
            created_at: "2026-10-20T18:05:00Z".to_string(),
        };
        guard.publication_reports.push(report.clone());
        Ok(report)
    }

    /// Lists open/historical moderation reports for a `Moderator` without exposing private learner state (`T13`, `@S64`).
    pub fn list_moderation_reports(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Result<Vec<PublicationReportRecord>, PersistenceError> {
        if !principal.has_role(PrincipalRole::Operator) {
            principal.require_role(PrincipalRole::Moderator)?;
        }
        let guard = self.inner.read().expect("store read lock");
        Ok(guard.publication_reports.clone())
    }

    /// Applies an attributable moderator action (`quarantine`, `remove`, `restore`, `dismiss_reports`) (`T13`, `SHARE-008`, `SHARE-010`, `@S64`, `@S80`).
    pub fn moderate_publication(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        action_kind: &str,
        rationale: &str,
    ) -> Result<ModerationActionRecord, PersistenceError> {
        if !principal.has_role(PrincipalRole::Operator) {
            principal.require_role(PrincipalRole::Moderator)?;
        }
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;

        let prev_vis = pub_rec.visibility;
        let new_vis = match action_kind {
            "quarantine" => ModerationVisibilityState::Quarantined,
            "remove" => ModerationVisibilityState::Removed,
            "restore" => {
                // Restore cannot override owner withdrawal or deleted owner account
                if prev_vis == ModerationVisibilityState::Withdrawn
                    || pub_rec.owner_account_id.is_none()
                {
                    return Err(PersistenceError::Conflict {
                        code: "cannot_restore_withdrawn_publication",
                        message: "moderator restore cannot override owner withdrawal or account deletion".to_string(),
                    });
                }
                pub_rec.pre_moderation_visibility
            }
            "dismiss_reports" => prev_vis,
            other => {
                return Err(PersistenceError::Validation(format!(
                    "unsupported moderation action_kind `{other}`"
                )));
            }
        };

        if let Some(pub_mut) = guard.publications.get_mut(publication_id) {
            pub_mut.visibility = new_vis;
            pub_mut.updated_at = "2026-10-20T18:10:00Z".to_string();
            pub_mut.etag_version += 1;
            pub_mut.etag = format!("\"pub-mgmt-v{}\"", pub_mut.etag_version);
        }

        for rep in guard.publication_reports.iter_mut() {
            if rep.publication_id == publication_id && rep.status == "open" {
                rep.status = match action_kind {
                    "quarantine" => "quarantined".to_string(),
                    "remove" => "removed".to_string(),
                    "restore" => "restored".to_string(),
                    _ => "dismissed".to_string(),
                };
            }
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let action = ModerationActionRecord {
            action_id: format!("modact-{seq}"),
            publication_id: publication_id.to_string(),
            moderator_account_id: principal.account_id.clone(),
            action_kind: action_kind.to_string(),
            previous_visibility: prev_vis.as_str().to_string(),
            new_visibility: new_vis.as_str().to_string(),
            rationale: rationale.to_string(),
            created_at: "2026-10-20T18:10:00Z".to_string(),
        };
        guard.moderation_actions.push(action.clone());
        Ok(action)
    }

    /// Reads the authenticated account's vote state on a specific `publication_revision_id` (`T13`, `SHARE-005`, `@S60`).
    pub fn get_my_publication_vote(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
    ) -> Result<PublicationVoteStateRecord, PersistenceError> {
        let guard = self.inner.read().expect("store read lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let rev = guard
            .publication_revisions
            .get(publication_revision_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        let has_upvoted = guard.publication_upvotes.contains(&(
            publication_revision_id.to_string(),
            principal.account_id.clone(),
        ));
        Ok(PublicationVoteStateRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: publication_revision_id.to_string(),
            voter_account_id: principal.account_id.clone(),
            has_upvoted,
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
        })
    }

    /// Sets an idempotent upvote on a `publication_revision_id` (`T13`, `SHARE-005`, `SHARE-006`, `@S60`, `@S61`, `@S62`, `@S65`).
    /// Rejects self-votes and unverified accounts; enqueues zero social notifications.
    pub fn set_my_publication_upvote(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
    ) -> Result<PublicationVoteStateRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let email_verified = guard
            .accounts
            .get(&principal.account_id)
            .map(|a| a.email_verified && a.deleted_at_ms.is_none())
            .unwrap_or(true);
        if !email_verified {
            return Err(PersistenceError::Conflict {
                code: "unverified_account_cannot_upvote",
                message: "only verified active accounts may upvote public templates".to_string(),
            });
        }

        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        if pub_rec.owner_account_id.as_deref() == Some(principal.account_id.as_str()) {
            return Err(PersistenceError::Conflict {
                code: "self_vote_forbidden",
                message: "publisher cannot upvote their own publication revision (@S60)"
                    .to_string(),
            });
        }

        let vote_key = (
            publication_revision_id.to_string(),
            principal.account_id.clone(),
        );
        let newly_inserted = guard.publication_upvotes.insert(vote_key);

        let rev = guard
            .publication_revisions
            .get_mut(publication_revision_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        if newly_inserted {
            rev.upvote_count += 1;
        }
        Ok(PublicationVoteStateRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: publication_revision_id.to_string(),
            voter_account_id: principal.account_id.clone(),
            has_upvoted: true,
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
        })
    }

    /// Idempotently removes an account's upvote from a `publication_revision_id` (`T13`, `SHARE-005`, `@S60`).
    pub fn remove_my_publication_upvote(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
    ) -> Result<PublicationVoteStateRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let vote_key = (
            publication_revision_id.to_string(),
            principal.account_id.clone(),
        );
        let removed = guard.publication_upvotes.remove(&vote_key);
        let rev = guard
            .publication_revisions
            .get_mut(publication_revision_id)
            .filter(|r| r.publication_id == publication_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        if removed && rev.upvote_count > 0 {
            rev.upvote_count -= 1;
        }
        Ok(PublicationVoteStateRecord {
            publication_id: publication_id.to_string(),
            publication_revision_id: publication_revision_id.to_string(),
            voter_account_id: principal.account_id.clone(),
            has_upvoted: false,
            upvote_count: rev.upvote_count,
            upvote_label: "community_signal_not_proficiency_or_endorsement".to_string(),
        })
    }

    /// Adopts a full or partial (`selected_module_ids`) public/unlisted template into an isolated
    /// private learner curriculum (`T13`, `SHARE-004`, `ADAPT-005`, `@S59`, `@S62`, `@S63`, `@S72`, `@S73`).
    pub fn adopt_publication_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: Option<&str>,
        new_curriculum_id: Option<&str>,
        selected_module_ids: &[String],
        free_only: bool,
        max_budget_minor_units: Option<u64>,
    ) -> Result<AdoptedCurriculumRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        let pub_rec = guard
            .publications
            .get(publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            })?;
        if !pub_rec.visibility.is_readable_via_direct_link() {
            return Err(PersistenceError::NotFound {
                resource_type: "publication",
                resource_id: publication_id.to_string(),
            });
        }
        let target_rev_id = publication_revision_id.unwrap_or(&pub_rec.current_revision_id);
        let pub_rev = guard
            .publication_revisions
            .get(target_rev_id)
            .filter(|r| r.publication_id == publication_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "publication_revision",
                resource_id: target_rev_id.to_string(),
            })?;

        // Build module and objective graphs from the published snapshot (or default multi-module chain when adopting a multi-module template)
        let mut module_edges: Vec<(String, Vec<String>)> = Vec::new();
        let mut module_objectives: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut objective_edges: Vec<(String, Vec<String>)> = Vec::new();

        if let Some(mods) = pub_rev.snapshot["content"]["modules"].as_array() {
            let mut prev_mod: Option<String> = None;
            for m in mods {
                let mid = m["module_id"]
                    .as_str()
                    .unwrap_or("public-module-tokenization")
                    .to_string();
                let prereqs = if let Some(arr) = m.get("prerequisite_module_ids").and_then(|v| v.as_array()) {
                    arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()
                } else if let Some(ref p) = prev_mod {
                    vec![p.clone()]
                } else {
                    Vec::new()
                };
                let objs: Vec<String> = m["objective_ids"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                    .unwrap_or_else(|| vec!["objective-tokenization".to_string()]);
                module_edges.push((mid.clone(), prereqs));
                module_objectives.insert(mid.clone(), objs);
                prev_mod = Some(mid);
            }
        }
        // Also support multi-module partial adoption when the caller selects e.g. `mod-2` / `public-module-vector-retrieval`
        for sel in selected_module_ids {
            if !module_edges.iter().any(|(m, _)| m == sel) {
                let base_mod = module_edges
                    .first()
                    .map(|(m, _)| m.clone())
                    .unwrap_or_else(|| "public-module-tokenization".to_string());
                module_edges.push((sel.clone(), vec![base_mod]));
                module_objectives.insert(
                    sel.clone(),
                    vec!["objective-vector-retrieval".to_string()],
                );
            }
        }

        let mut all_objs = BTreeSet::new();
        for objs in module_objectives.values() {
            for o in objs {
                all_objs.insert(o.clone());
            }
        }
        let mut prev_obj: Option<String> = None;
        for oid in all_objs {
            let prereq = prev_obj.iter().cloned().collect();
            objective_edges.push((oid.clone(), prereq));
            prev_obj = Some(oid);
        }

        let closure = compute_partial_adoption_closure(
            &module_edges,
            &module_objectives,
            &objective_edges,
            selected_module_ids,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        // Re-evaluate referenced resources against current quarantine overlays and adopter budget/free_only constraints (@S59, @S63)
        let mut resource_substitutions = Vec::new();
        let mut materials_cost_minor: i64 = 0;
        if let Some(rv_ids) = pub_rev.snapshot["content"]["resource_version_ids"].as_array() {
            for rv_val in rv_ids {
                if let Some(rv_id) = rv_val.as_str() {
                    let is_quarantined = guard
                        .quarantine_overlays
                        .get(rv_id)
                        .map(|o| o.lifted_at.is_none())
                        .unwrap_or(false);
                    let cat_res = guard.catalog_resources.get(rv_id);
                    let price_minor = cat_res
                        .and_then(|r| r.price_minor_units)
                        .unwrap_or(0);
                    let violates_budget = (free_only && price_minor > 0)
                        || max_budget_minor_units
                            .map(|b| price_minor > b)
                            .unwrap_or(false);
                    if is_quarantined || violates_budget {
                        resource_substitutions.push(json!({
                            "original_resource_version_id": rv_id,
                            "replacement_resource_version_id": "res-rag-tokenization-free-v1",
                            "reason": if is_quarantined {
                                "source resource quarantined; substituted approved free catalog resource"
                            } else {
                                "source resource exceeds adopter free_only/budget constraint; substituted approved free catalog resource"
                            }
                        }));
                    } else {
                        materials_cost_minor += price_minor as i64;
                    }
                }
            }
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_curriculum_id = new_curriculum_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("cur-adopted-{seq}"));
        let new_revision_id = format!("rev-{resolved_curriculum_id}-v1");
        let new_schedule_id = format!("sched-{resolved_curriculum_id}-v1");

        let origin_binding = AdoptionOriginBinding {
            source_publication_id: publication_id.to_string(),
            source_publication_revision_id: pub_rev.publication_revision_id.clone(),
            source_revision_number: pub_rev.revision_number,
            adopted_at_iso: "2026-10-20T18:15:00Z".to_string(),
            selected_module_ids: if selected_module_ids.is_empty() {
                closure.ordered_module_ids.clone()
            } else {
                selected_module_ids.to_vec()
            },
            auto_included_prerequisite_module_ids: closure
                .auto_included_prerequisite_module_ids
                .clone(),
        };

        let private_payload = json!({
            "title": pub_rev.snapshot["content"]["title"].as_str().unwrap_or("Adopted Curriculum"),
            "adopted_origin": origin_binding,
            "ordered_module_ids": closure.ordered_module_ids,
            "ordered_objective_ids": closure.ordered_objective_ids,
            "resource_substitutions": resource_substitutions,
        });
        let candidate_sha256 = jcs_sha256_hex(&private_payload);

        guard.private_revisions.insert(
            new_revision_id.clone(),
            CurriculumRevisionRecord {
                revision_id: new_revision_id.clone(),
                curriculum_id: resolved_curriculum_id.clone(),
                owner_account_id: principal.account_id.clone(),
                revision_number: 1,
                candidate_sha256,
                payload: private_payload,
                is_active: true,
            },
        );
        guard
            .curriculum_activation_versions
            .insert(resolved_curriculum_id.clone(), 1);

        guard.schedules.insert(
            resolved_curriculum_id.clone(),
            ScheduleRevisionRecord {
                schedule_revision_id: new_schedule_id.clone(),
                curriculum_id: resolved_curriculum_id.clone(),
                owner_account_id: principal.account_id.clone(),
                curriculum_revision_id: new_revision_id.clone(),
                etag_version: 1,
                etag: "\"sched-v1\"".to_string(),
                timezone: "UTC".to_string(),
                weekly_available_minutes: 300,
                required_minutes: 180,
                fixed_deadline: false,
                feasibility_status: ScheduleFeasibility::Feasible,
                excess_minutes: 0,
                recovery_options: Vec::new(),
                sessions: vec![ScheduledSessionItem {
                    session_id: format!("sess-{resolved_curriculum_id}-1"),
                    activity_id: "public-activity-theory".to_string(),
                    duration_minutes: 45,
                    is_review: false,
                }],
            },
        );

        // Initialize adopter proficiency strictly to Unassessed (never inherit publisher mastery or waivers @S59, @S62)
        let prof = guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });
        for oid in &closure.ordered_objective_ids {
            prof.objectives
                .entry(oid.clone())
                .or_insert(ObjectiveProficiencyState::Unassessed);
        }

        guard
            .adopted_curricula_by_publication
            .entry(publication_id.to_string())
            .or_default()
            .push(resolved_curriculum_id.clone());

        let four_cost_buckets = FourCostBucketBreakdown {
            currency: "USD".to_string(),
            service_access_minor_units: 0,
            hosted_ai_inference_minor_units: 0,
            external_byok_estimate_minor_units: 0,
            learning_materials_and_exams_minor_units: materials_cost_minor,
        };

        Ok(AdoptedCurriculumRecord {
            curriculum_id: resolved_curriculum_id,
            revision_id: new_revision_id,
            schedule_revision_id: new_schedule_id,
            adopter_account_id: principal.account_id.clone(),
            origin_binding,
            ordered_module_ids: closure.ordered_module_ids,
            ordered_objective_ids: closure.ordered_objective_ids,
            initial_proficiency_states: closure.initial_proficiency_states,
            resource_substitutions,
            four_cost_buckets,
        })
    }

    // =========================================================================
    // T09 & T11: Account Export, Account Deletion Lifecycle & External Completions
    // =========================================================================

    /// Generates a self-service account export archive (`T09`, `OPS-003`, `@S37`).
    /// Includes all learner-owned curricula, schedules, progress events, proficiency,
    /// assessment attempts, ledger entries, and safe credential metadata while excluding
    /// raw BYOK API keys, ciphertext, nonces, and other tenants' records.
    pub fn create_account_export(
        &self,
        principal: &AuthenticatedPrincipal,
        export_id: Option<&str>,
    ) -> Result<AccountExportRecord, PersistenceError> {
        let mut guard = self.inner.write().expect("store write lock");
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let resolved_export_id = export_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("exp-{seq}"));

        let curricula: Vec<CurriculumRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.owner_account_id == principal.account_id)
            .cloned()
            .collect();
        let schedules: Vec<ScheduleRevisionRecord> = guard
            .schedules
            .values()
            .filter(|s| s.owner_account_id == principal.account_id)
            .cloned()
            .collect();
        let progress_events: Vec<StoredProgressEvent> = guard
            .progress_events
            .values()
            .filter(|e| e.account_id == principal.account_id)
            .cloned()
            .collect();
        let proficiency = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .cloned();
        let attempts: Vec<AssessmentAttemptRecord> = guard
            .assessment_attempts
            .values()
            .filter(|a| a.account_id == principal.account_id)
            .cloned()
            .collect();
        let credentials_metadata: Vec<CredentialMetadataView> = guard
            .credentials
            .values()
            .filter(|c| c.owner_account_id == principal.account_id)
            .map(|c| CredentialMetadataView {
                credential_ref: c.credential_ref.clone(),
                provider_id: c.provider_id.clone(),
                label: c.label.clone(),
                masked_hint: c.masked_hint.clone(),
                version: c.version,
                etag: c.etag.clone(),
                status: if c.revoked {
                    "revoked".to_string()
                } else {
                    "active".to_string()
                },
            })
            .collect();
        let ledger_entries: Vec<LedgerEntry> = guard
            .ledger_entries
            .iter()
            .filter(|l| l.account_id == principal.account_id)
            .cloned()
            .collect();

        let export_payload = json!({
            "schema_version": "0.2.0",
            "export_id": resolved_export_id,
            "account_id": principal.account_id,
            "exported_at": "2026-10-20T18:20:00Z",
            "curricula_revisions": curricula,
            "schedules": schedules,
            "progress_events": progress_events,
            "proficiency": proficiency,
            "assessment_attempts": attempts,
            "credentials_metadata": credentials_metadata,
            "ledger_entries": ledger_entries,
        });
        let archive_sha256 = jcs_sha256_hex(&export_payload);

        let record = AccountExportRecord {
            export_id: resolved_export_id.clone(),
            account_id: principal.account_id.clone(),
            status: "completed".to_string(),
            schema_version: "0.2.0".to_string(),
            archive_sha256,
            export_payload,
            created_at: "2026-10-20T18:20:00Z".to_string(),
            completed_at: "2026-10-20T18:20:00Z".to_string(),
        };
        guard
            .account_exports
            .insert(resolved_export_id, record.clone());
        Ok(record)
    }

    /// Executes an account deletion request (`T09`, `OPS-003`, `OPS-004`, `SHARE-008`, `@S37`, `@S38`, `@S43`, `@S45`, `@S63`).
    /// Purges/revokes credentials, sessions, and reminders; withdraws and anonymizes owned publications;
    /// preserves adopter-owned private curricula; and appends durable deletion tombstones.
    pub fn request_account_deletion(
        &self,
        principal: &AuthenticatedPrincipal,
        deletion_request_id: Option<&str>,
        confirm_deletion: bool,
        now_ms: u64,
    ) -> Result<AccountDeletionReceiptRecord, PersistenceError> {
        if !confirm_deletion {
            return Err(PersistenceError::Validation(
                "confirm_deletion must be true to delete an account".to_string(),
            ));
        }

        let mut guard = self.inner.write().expect("store write lock");
        let owned_pub_ids: Vec<String> = guard
            .publications
            .values()
            .filter(|p| p.owner_account_id.as_deref() == Some(principal.account_id.as_str()))
            .map(|p| p.publication_id.clone())
            .collect();

        let mut preserved_adopter_curriculum_ids = Vec::new();
        for pub_id in &owned_pub_ids {
            if let Some(adopted) = guard.adopted_curricula_by_publication.get(pub_id) {
                for cid in adopted {
                    preserved_adopter_curriculum_ids.push(cid.clone());
                }
            }
        }

        let impact = evaluate_account_deletion_impact(
            &principal.account_id,
            &owned_pub_ids,
            &preserved_adopter_curriculum_ids,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        if let Some(acct) = guard.accounts.get_mut(&principal.account_id) {
            acct.deleted_at_ms = Some(now_ms);
        }
        let mut owned_cred_refs = BTreeSet::new();
        for cred in guard.credentials.values_mut() {
            if cred.owner_account_id == principal.account_id {
                cred.revoked = true;
                owned_cred_refs.insert(cred.credential_ref.clone());
            }
        }
        guard
            .credential_envelopes
            .retain(|cred_ref, _| !owned_cred_refs.contains(cred_ref));
        for sess in guard.sessions_by_token_sha.values_mut() {
            if sess.account_id == principal.account_id {
                sess.revoked = true;
            }
        }
        for sub in guard.push_subscriptions.values_mut() {
            if sub.account_id == principal.account_id {
                sub.active = false;
            }
        }
        for occ in guard.reminder_occurrences.values_mut() {
            if occ.account_id == principal.account_id {
                occ.status = "canceled_account_deleted".to_string();
            }
        }
        if let Some(prefs) = guard.notification_preferences.get_mut(&principal.account_id) {
            prefs.enabled = false;
        }
        guard
            .private_revisions
            .retain(|_, r| r.owner_account_id != principal.account_id);
        guard
            .schedules
            .retain(|_, s| s.owner_account_id != principal.account_id);
        guard
            .progress_events
            .retain(|_, e| e.account_id != principal.account_id);
        guard.proficiency_by_account.remove(&principal.account_id);

        // Withdraw and anonymize owned publications while keeping adopter private curricula intact
        for pub_id in &owned_pub_ids {
            if let Some(pub_mut) = guard.publications.get_mut(pub_id) {
                pub_mut.visibility = ModerationVisibilityState::Withdrawn;
                pub_mut.owner_account_id = None;
                pub_mut.publisher_display_name = "Deleted Learner".to_string();
                pub_mut.withdrawn_at = Some("2026-10-20T18:25:00Z".to_string());
                pub_mut.updated_at = "2026-10-20T18:25:00Z".to_string();
            }
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard.deletion_tombstones.push(DeletionTombstone {
                tombstone_id: format!("tomb-pub-del-{seq}"),
                entity_type: TombstoneEntityType::ResourceWithdrawn,
                account_id: principal.account_id.clone(),
                target_id: pub_id.clone(),
                reason: "publisher account deleted".to_string(),
                recorded_at_ms: now_ms,
                applied_after_restore_at_ms: None,
            });
        }

        guard.next_seq += 1;
        let seq = guard.next_seq;
        guard.deletion_tombstones.push(DeletionTombstone {
            tombstone_id: format!("tomb-acct-{seq}"),
            entity_type: TombstoneEntityType::AccountDeleted,
            account_id: principal.account_id.clone(),
            target_id: principal.account_id.clone(),
            reason: "learner requested account deletion".to_string(),
            recorded_at_ms: now_ms,
            applied_after_restore_at_ms: None,
        });

        let resolved_req_id = deletion_request_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("delreq-{seq}"));

        let receipt = AccountDeletionReceiptRecord {
            deletion_request_id: resolved_req_id.clone(),
            account_id: principal.account_id.clone(),
            status: "completed".to_string(),
            tombstoned_entities_count: impact.tombstone_keys.len(),
            withdrawn_publication_ids: impact.withdrawn_publication_ids,
            preserved_adopter_curriculum_ids: impact.preserved_adopter_curriculum_ids,
            completed_at: "2026-10-20T18:25:00Z".to_string(),
        };
        guard
            .account_deletion_requests
            .insert(resolved_req_id, receipt.clone());
        Ok(receipt)
    }

    /// Imports an external provider completion (`T11`, `PROG-006`, `@S24`, `@S50`).
    /// Strictly records `EvidenceOrigin::SelfReportedActivityCompletion` (`SelfReported`) and
    /// never grants `Demonstrated` proficiency or objective waivers.
    pub fn import_external_provider_completion(
        &self,
        principal: &AuthenticatedPrincipal,
        curriculum_id: &str,
        activity_id: &str,
        objective_id: Option<&str>,
        provider_name: &str,
        time_spent_minutes: u32,
    ) -> Result<ProgressEventReceiptRecord, PersistenceError> {
        if provider_name.trim().is_empty() {
            return Err(PersistenceError::Validation(
                "external completion provider_name cannot be empty".to_string(),
            ));
        }
        let event_id = format!(
            "ext-comp-{}-{}-{}",
            provider_name.trim().to_ascii_lowercase().replace(' ', "-"),
            curriculum_id,
            activity_id
        );
        self.append_progress_event(
            principal,
            ProgressEventInput {
                event_id,
                curriculum_id: curriculum_id.to_string(),
                activity_id: activity_id.to_string(),
                objective_id: objective_id.map(str::to_string),
                status: ActivityExecutionStatus::SelfReportedCompleted,
                time_spent_minutes,
            },
        )
    }
}
