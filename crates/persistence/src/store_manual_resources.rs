//! Manual learning resource catalog mutations (edit, delete, atomic TF-IDF re-indexing)
//! and per-syllabus resource binding mutations (`add`, `edit`, `delete`).

use syllabus_contracts::jcs::sha256_bytes_hex;
use syllabus_security::AuthenticatedPrincipal;
use serde_json::{json, Value};

use crate::*;

impl InMemoryTransactionalStore {
    /// Synchronizes a single [`CatalogResourceVersionRecord`] into the live in-memory
    /// [`syllabus_domain::TfIdfCorpusIndex`] inside an active write transaction.
    pub(crate) fn sync_catalog_tfidf_entry_locked(
        guard: &mut StoreInner,
        record: &CatalogResourceVersionRecord,
    ) {
        if record.is_synthetic_fixture
            || record.review_status == ResourceReviewStatus::Quarantined
            || record.review_status == ResourceReviewStatus::Withdrawn
            || record.review_status == ResourceReviewStatus::Rejected
        {
            guard
                .catalog_tfidf_index
                .remove_document(&record.resource_version_id);
            return;
        }
        let corpus_text = format!(
            "{} {} {} {} {}",
            record.title,
            record.provider_display_name,
            record.resource_type,
            record.description,
            record.topics.join(" ")
        );
        guard
            .catalog_tfidf_index
            .upsert_document(record.resource_version_id.clone(), &corpus_text);
    }

    /// Returns the total number of live documents in the catalog TF-IDF search index.
    #[must_use]
    pub fn catalog_tfidf_document_count(&self) -> usize {
        let guard = self.read_inner();
        guard.catalog_tfidf_index.document_count()
    }

    /// Ranks live catalog resources against `query` using the store's synchronized TF-IDF index.
    #[must_use]
    pub fn rank_catalog_tfidf(&self, query: &str) -> Vec<(String, f64)> {
        let guard = self.read_inner();
        guard.catalog_tfidf_index.rank_documents(query)
    }

    /// Updates an existing catalog/library resource version and atomically refreshes its TF-IDF index entry.
    pub fn update_catalog_resource(
        &self,
        resource_version_id: &str,
        patch: CatalogResourcePatchInput,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        if let Some(ref url) = patch.canonical_url {
            validate_manual_resource_egress_url(url)?;
        }
        if let Some(ref title) = patch.title {
            if title.trim().is_empty() {
                return Err(PersistenceError::Validation(
                    "resource title cannot be empty".to_string(),
                ));
            }
        }

        let mut guard = self.write_inner();
        let updated = {
            let record = guard
                .catalog_resources
                .get_mut(resource_version_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "catalog_resource_version",
                    resource_id: resource_version_id.to_string(),
                })?;

            if let Some(title) = patch.title {
                record.title = title.trim().to_string();
            }
            if let Some(canonical_url) = patch.canonical_url {
                record.canonical_url = canonical_url.trim().to_string();
                if let Some(ref mut ev) = record.review_evidence {
                    ev.evidence_url = record.canonical_url.clone();
                }
            }
            if let Some(provider_name) = patch.provider_display_name {
                let trimmed = provider_name.trim();
                if !trimmed.is_empty() {
                    record.provider_display_name = trimmed.to_string();
                }
            }
            if let Some(resource_type) = patch.resource_type {
                let trimmed = resource_type.trim();
                if !trimmed.is_empty() {
                    record.resource_type = normalize_contract_resource_type(trimmed).to_string();
                }
            }
            if let Some(description) = patch.description {
                let mut desc = description.trim().to_string();
                if let Some(ref segs) = patch.segment_titles {
                    let cleaned_segs: Vec<String> = segs
                        .iter()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if !cleaned_segs.is_empty() && !desc.contains("Sections:") {
                        desc = format!("{desc} Sections: {}.", cleaned_segs.join("; "));
                    }
                }
                record.description = desc;
            } else if let Some(segs) = patch.segment_titles {
                let cleaned_segs: Vec<String> = segs
                    .into_iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                if !cleaned_segs.is_empty() {
                    let base = record
                        .description
                        .split(" Sections:")
                        .next()
                        .unwrap_or(&record.description)
                        .trim();
                    record.description = format!("{base} Sections: {}.", cleaned_segs.join("; "));
                }
            }
            if let Some(topics) = patch.topics {
                let mut cleaned: Vec<String> = topics
                    .into_iter()
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .collect();
                if let Some(ref subject) = patch.subject {
                    let subj = subject.trim().to_ascii_lowercase();
                    if !subj.is_empty() && !cleaned.iter().any(|t| t.eq_ignore_ascii_case(&subj)) {
                        cleaned.push(subj);
                    }
                }
                if !cleaned.is_empty() {
                    record.topics = cleaned;
                }
            } else if let Some(subject) = patch.subject {
                let subj = subject.trim().to_ascii_lowercase();
                if !subj.is_empty() && !record.topics.iter().any(|t| t.eq_ignore_ascii_case(&subj))
                {
                    record.topics.push(subj);
                }
            }
            if let Some(level) = patch.level {
                let trimmed = level.trim();
                if !trimmed.is_empty() {
                    record.level = trimmed.to_string();
                }
            }
            if let Some(access_model) = patch.access_model {
                record.access_model = access_model;
            }
            if let Some(price_opt) = patch.price_minor_units {
                record.price_minor_units = price_opt;
            }
            record.clone()
        };

        Self::sync_catalog_tfidf_entry_locked(&mut guard, &updated);
        Ok(updated)
    }

    /// Permanently deletes a catalog/library resource version and purges it from the TF-IDF index.
    pub fn delete_catalog_resource(
        &self,
        resource_version_id: &str,
    ) -> Result<CatalogResourceVersionRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let removed = guard
            .catalog_resources
            .remove(resource_version_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: resource_version_id.to_string(),
            })?;
        guard.quarantine_overlays.remove(resource_version_id);
        guard.catalog_tfidf_index.remove_document(resource_version_id);
        Ok(removed)
    }

    /// Adds or updates a resource binding on a learner's private syllabus (`POST`/`PATCH /v1/syllabi/{id}/resources`).
    /// Commits a new active private revision and increments the syllabus's activation ETag.
    pub fn upsert_syllabus_resource_binding(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        input: SyllabusResourceBindingInput,
    ) -> Result<(SyllabusRevisionRecord, SyllabusResourceMutationReceipt), PersistenceError>
    {
        let rv_id = input.resource_version_id.trim();
        if rv_id.is_empty() {
            return Err(PersistenceError::Validation(
                "resource_version_id is required".to_string(),
            ));
        }

        let mut guard = self.write_inner();
        let resource_record = guard
            .catalog_resources
            .get(rv_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "catalog_resource_version",
                resource_id: rv_id.to_string(),
            })?;

        let mut existing_revs: Vec<SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .cloned()
            .collect();
        let mut payload = if let Some(first) = existing_revs.first() {
            principal.require_learner_ownership(&first.owner_account_id)?;
            existing_revs.sort_by_key(|r| r.revision_number);
            let base_rev = existing_revs
                .iter()
                .rev()
                .find(|r| r.is_active)
                .or_else(|| existing_revs.last())
                .expect("at least one revision");
            let cloned = base_rev.payload.clone();
            if cloned.is_object() {
                cloned
            } else {
                json!({ "syllabus_id": syllabus_id, "title": syllabus_id, "modules": [] })
            }
        } else {
            json!({
                "syllabus_id": syllabus_id,
                "title": syllabus_id,
                "modules": [],
                "activities": []
            })
        };

        let role = match input.role.as_deref().map(str::trim) {
            Some("supplemental" | "optional") => "supplemental",
            _ => "primary",
        };
        let requirement_level = match input.requirement_level.as_deref().map(str::trim) {
            Some("optional") => "optional",
            Some("required") => "required",
            _ if role == "supplemental" => "optional",
            _ => "required",
        };
        let rationale = input
            .selection_rationale
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                if resource_record.description.trim().is_empty() {
                    format!(
                        "Selected {} material from {}.",
                        resource_record.resource_type, resource_record.provider_display_name
                    )
                } else {
                    resource_record.description.clone()
                }
            });

        // Remove any existing binding for `rv_id` first so edits/re-assignments move cleanly without duplicates.
        let existed_before = strip_resource_from_syllabus_payload(&mut payload, rv_id);

        let assignment = json!({
            "resource_version_id": rv_id,
            "role": role,
            "segment_ids": input.segment_ids,
            "selection_rationale": rationale,
        });

        let (resolved_module_id, resolved_activity_id) = attach_resource_to_syllabus_payload(
            &mut payload,
            &resource_record,
            assignment,
            input.module_id.as_deref(),
            input.activity_id.as_deref(),
            input.activity_title.as_deref(),
            requirement_level,
        );

        let next_rev_num = existing_revs
            .last()
            .map(|r| r.revision_number + 1)
            .unwrap_or(1);
        let next_revision_id = format!("rev-{syllabus_id}-v{next_rev_num}");
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("revision_id".to_string(), json!(&next_revision_id));
            obj.insert("revision_number".to_string(), json!(next_rev_num));
        }

        let payload_bytes = serde_json::to_vec(&payload).unwrap_or_default();
        let candidate_sha256 = sha256_bytes_hex(&payload_bytes);

        for rev in guard.private_revisions.values_mut() {
            if rev.syllabus_id == syllabus_id {
                rev.is_active = false;
            }
        }

        let new_record = SyllabusRevisionRecord {
            revision_id: next_revision_id.clone(),
            syllabus_id: syllabus_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_num,
            candidate_sha256,
            payload,
            is_active: true,
        };
        guard
            .private_revisions
            .insert(next_revision_id.clone(), new_record.clone());

        let next_ver = guard
            .syllabus_activation_versions
            .get(syllabus_id)
            .copied()
            .unwrap_or(0)
            + 1;
        guard
            .syllabus_activation_versions
            .insert(syllabus_id.to_string(), next_ver);
        let etag = format!("\"cur-act-v{next_ver}\"");

        let receipt = SyllabusResourceMutationReceipt {
            syllabus_id: syllabus_id.to_string(),
            revision_id: next_revision_id,
            resource_version_id: rv_id.to_string(),
            module_id: resolved_module_id,
            activity_id: resolved_activity_id,
            action: if existed_before {
                "updated".to_string()
            } else {
                "added".to_string()
            },
            etag,
        };
        Ok((new_record, receipt))
    }

    /// Removes a resource binding from a learner's private syllabus (`DELETE /v1/syllabi/{id}/resources/{resource_version_id}`).
    /// Leaves the catalog resource intact in the library & TF-IDF index so it can be re-linked later.
    pub fn remove_syllabus_resource_binding(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        resource_version_id: &str,
    ) -> Result<(SyllabusRevisionRecord, SyllabusResourceMutationReceipt), PersistenceError>
    {
        let rv_id = resource_version_id.trim();
        let mut guard = self.write_inner();

        let mut existing_revs: Vec<SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .cloned()
            .collect();
        let first = existing_revs
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "syllabus",
                resource_id: syllabus_id.to_string(),
            })?;
        principal.require_learner_ownership(&first.owner_account_id)?;

        existing_revs.sort_by_key(|r| r.revision_number);
        let base_rev = existing_revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .or_else(|| existing_revs.last())
            .expect("at least one revision");

        let mut payload = base_rev.payload.clone();
        let removed = strip_resource_from_syllabus_payload(&mut payload, rv_id);
        if !removed {
            return Err(PersistenceError::NotFound {
                resource_type: "syllabus_resource_binding",
                resource_id: rv_id.to_string(),
            });
        }

        let next_rev_num = existing_revs
            .last()
            .map(|r| r.revision_number + 1)
            .unwrap_or(1);
        let next_revision_id = format!("rev-{syllabus_id}-v{next_rev_num}");
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("revision_id".to_string(), json!(&next_revision_id));
            obj.insert("revision_number".to_string(), json!(next_rev_num));
        }

        let payload_bytes = serde_json::to_vec(&payload).unwrap_or_default();
        let candidate_sha256 = sha256_bytes_hex(&payload_bytes);

        for rev in guard.private_revisions.values_mut() {
            if rev.syllabus_id == syllabus_id {
                rev.is_active = false;
            }
        }

        let new_record = SyllabusRevisionRecord {
            revision_id: next_revision_id.clone(),
            syllabus_id: syllabus_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_num,
            candidate_sha256,
            payload,
            is_active: true,
        };
        guard
            .private_revisions
            .insert(next_revision_id.clone(), new_record.clone());

        let next_ver = guard
            .syllabus_activation_versions
            .get(syllabus_id)
            .copied()
            .unwrap_or(0)
            + 1;
        guard
            .syllabus_activation_versions
            .insert(syllabus_id.to_string(), next_ver);
        let etag = format!("\"cur-act-v{next_ver}\"");

        let receipt = SyllabusResourceMutationReceipt {
            syllabus_id: syllabus_id.to_string(),
            revision_id: next_revision_id,
            resource_version_id: rv_id.to_string(),
            module_id: None,
            activity_id: None,
            action: "removed".to_string(),
            etag,
        };
        Ok((new_record, receipt))
    }
}

fn strip_resource_from_syllabus_payload(payload: &mut Value, rv_id: &str) -> bool {
    let mut removed_any = false;
    let mut empty_manual_activity_ids = Vec::new();

    if let Some(activities) = payload.get_mut("activities").and_then(Value::as_array_mut) {
        for act in activities.iter_mut() {
            for key in ["resource_assignments", "resource_refs"] {
                if let Some(arr) = act.get_mut(key).and_then(Value::as_array_mut) {
                    let before = arr.len();
                    arr.retain(|item| {
                        item.get("resource_version_id").and_then(Value::as_str) != Some(rv_id)
                    });
                    if arr.len() != before {
                        removed_any = true;
                    }
                }
            }
            let act_id = act
                .get("activity_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let remaining = act
                .get("resource_assignments")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            if act_id.starts_with("manual-activity-") && remaining == 0 {
                empty_manual_activity_ids.push(act_id);
            }
        }
        if !empty_manual_activity_ids.is_empty() {
            activities.retain(|act| {
                let id = act.get("activity_id").and_then(Value::as_str).unwrap_or("");
                !empty_manual_activity_ids.iter().any(|m| m == id)
            });
        }
    }

    if let Some(modules) = payload.get_mut("modules").and_then(Value::as_array_mut) {
        for module in modules.iter_mut() {
            if !empty_manual_activity_ids.is_empty() {
                if let Some(act_ids) = module
                    .get_mut("activity_ids")
                    .and_then(Value::as_array_mut)
                {
                    act_ids.retain(|v| {
                        let id = v.as_str().unwrap_or("");
                        !empty_manual_activity_ids.iter().any(|m| m == id)
                    });
                }
            }
            if let Some(nested_acts) = module.get_mut("activities").and_then(Value::as_array_mut) {
                for act in nested_acts.iter_mut() {
                    for key in ["resource_assignments", "resource_refs"] {
                        if let Some(arr) = act.get_mut(key).and_then(Value::as_array_mut) {
                            let before = arr.len();
                            arr.retain(|item| {
                                item.get("resource_version_id").and_then(Value::as_str)
                                    != Some(rv_id)
                            });
                            if arr.len() != before {
                                removed_any = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(top_refs) = payload
        .get_mut("resource_refs")
        .and_then(Value::as_array_mut)
    {
        let before = top_refs.len();
        top_refs.retain(|item| {
            item.as_str() != Some(rv_id)
                && item.get("resource_version_id").and_then(Value::as_str) != Some(rv_id)
        });
        if top_refs.len() != before {
            removed_any = true;
        }
    }

    if let Some(src_ids) = payload
        .get_mut("provenance")
        .and_then(|p| p.get_mut("source_resource_version_ids"))
        .and_then(Value::as_array_mut)
    {
        let before = src_ids.len();
        src_ids.retain(|item| item.as_str() != Some(rv_id));
        if src_ids.len() != before {
            removed_any = true;
        }
    }

    removed_any
}

fn attach_resource_to_syllabus_payload(
    payload: &mut Value,
    resource_record: &CatalogResourceVersionRecord,
    assignment: Value,
    requested_module_id: Option<&str>,
    requested_activity_id: Option<&str>,
    requested_activity_title: Option<&str>,
    requirement_level: &str,
) -> (Option<String>, Option<String>) {
    let rv_id = resource_record.resource_version_id.as_str();
    let inferred_act_type = match resource_record.resource_type.as_str() {
        "code_lab" | "repository" => "coding",
        "problem_set" => "worked_example",
        _ => "theory",
    };

    // 1. If a specific activity_id exists in top-level `activities`, attach directly to it.
    if let Some(target_act_id) = requested_activity_id.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(activities) = payload.get_mut("activities").and_then(Value::as_array_mut) {
            if let Some(act) = activities.iter_mut().find(|a| {
                a.get("activity_id").and_then(Value::as_str) == Some(target_act_id)
            }) {
                push_assignment_to_activity(act, assignment);
                if let Some(title) = requested_activity_title.map(str::trim).filter(|s| !s.is_empty()) {
                    act["title"] = json!(title);
                }
                ensure_provenance_source_id(payload, rv_id);
                let mod_id = find_module_for_activity(payload, target_act_id);
                return (mod_id, Some(target_act_id.to_string()));
            }
        }
    }

    // 2. Otherwise resolve target module (or create a default module if minimal fixture payload lacks `modules`).
    let has_modules = payload
        .get("modules")
        .and_then(Value::as_array)
        .map_or(false, |m| !m.is_empty());

    if !has_modules {
        let fallback_act_id = format!("manual-activity-{rv_id}");
        let step_title = requested_activity_title
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Study: {}", resource_record.title));
        if payload.get("activities").and_then(Value::as_array).is_none() {
            payload["activities"] = json!([]);
        }
        if let Some(activities) = payload.get_mut("activities").and_then(Value::as_array_mut) {
            activities.push(json!({
                "activity_id": fallback_act_id,
                "type": inferred_act_type,
                "title": step_title,
                "requirement_level": requirement_level,
                "objective_ids": [],
                "prerequisite_activity_ids": [],
                "resource_assignments": [assignment],
            }));
        }
        ensure_provenance_source_id(payload, rv_id);
        return (None, Some(fallback_act_id));
    }

    let (target_mod_id, target_mod_objectives, existing_mod_act_ids) = {
        let modules = payload["modules"].as_array().expect("checked non-empty");
        let chosen = requested_module_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|req_id| {
                modules
                    .iter()
                    .find(|m| m.get("module_id").and_then(Value::as_str) == Some(req_id))
            })
            .unwrap_or(&modules[0]);
        let mod_id = chosen
            .get("module_id")
            .and_then(Value::as_str)
            .unwrap_or("module-1")
            .to_string();
        let obj_ids = chosen
            .get("objective_ids")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let act_ids: Vec<String> = chosen
            .get("activity_ids")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        (mod_id, obj_ids, act_ids)
    };

    // If top-level `activities` exists and the target module already has a non-quiz/non-review activity
    // (when no custom `activity_title` was requested), or if we create a clean dedicated manual activity:
    if payload.get("activities").and_then(Value::as_array).is_none() {
        payload["activities"] = json!([]);
    }

    let create_new_step = requested_activity_title
        .map(str::trim)
        .map_or(false, |s| !s.is_empty())
        || existing_mod_act_ids.is_empty();

    if !create_new_step {
        if let Some(activities) = payload.get_mut("activities").and_then(Value::as_array_mut) {
            if let Some(existing_act) = activities.iter_mut().find(|a| {
                let id = a.get("activity_id").and_then(Value::as_str).unwrap_or("");
                let kind = a.get("type").and_then(Value::as_str).unwrap_or("theory");
                existing_mod_act_ids.iter().any(|mid| mid == id)
                    && kind != "quiz"
                    && kind != "review"
            }) {
                let act_id = existing_act
                    .get("activity_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                push_assignment_to_activity(existing_act, assignment);
                ensure_provenance_source_id(payload, rv_id);
                return (Some(target_mod_id), Some(act_id));
            }
        }
    }

    let new_act_id = format!("manual-activity-{target_mod_id}-{rv_id}");
    let step_title = requested_activity_title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Study: {}", resource_record.title));

    if let Some(activities) = payload.get_mut("activities").and_then(Value::as_array_mut) {
        activities.push(json!({
            "activity_id": new_act_id,
            "type": inferred_act_type,
            "title": step_title,
            "requirement_level": requirement_level,
            "objective_ids": target_mod_objectives,
            "prerequisite_activity_ids": [],
            "resource_assignments": [assignment],
            "duration_estimate": {
                "OptimisticMinutes": 25,
                "ExpectedMinutes": 40,
                "ConservativeMinutes": 60,
                "media_minutes_at_1x": 20,
                "non_media_minutes": 20,
                "basis": "manual_resource_estimate"
            },
            "content": {
                "activity_type": inferred_act_type,
                "prompt": format!("Study {} and apply the key concepts to this unit.", resource_record.title)
            }
        }));
    }

    if let Some(modules) = payload.get_mut("modules").and_then(Value::as_array_mut) {
        if let Some(target_mod) = modules
            .iter_mut()
            .find(|m| m.get("module_id").and_then(Value::as_str) == Some(target_mod_id.as_str()))
        {
            if target_mod.get("activity_ids").and_then(Value::as_array).is_none() {
                target_mod["activity_ids"] = json!([]);
            }
            if let Some(act_ids) = target_mod
                .get_mut("activity_ids")
                .and_then(Value::as_array_mut)
            {
                if !act_ids.iter().any(|v| v.as_str() == Some(new_act_id.as_str())) {
                    act_ids.push(json!(&new_act_id));
                }
            }
        }
    }

    ensure_provenance_source_id(payload, rv_id);
    (Some(target_mod_id), Some(new_act_id))
}

fn push_assignment_to_activity(activity: &mut Value, assignment: Value) {
    if activity
        .get("resource_assignments")
        .and_then(Value::as_array)
        .is_none()
    {
        activity["resource_assignments"] = json!([]);
    }
    if let Some(arr) = activity
        .get_mut("resource_assignments")
        .and_then(Value::as_array_mut)
    {
        arr.push(assignment);
    }
}

fn find_module_for_activity(payload: &Value, activity_id: &str) -> Option<String> {
    payload
        .get("modules")
        .and_then(Value::as_array)?
        .iter()
        .find(|m| {
            m.get("activity_ids")
                .and_then(Value::as_array)
                .map_or(false, |ids| {
                    ids.iter().any(|id| id.as_str() == Some(activity_id))
                })
        })
        .and_then(|m| m.get("module_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn ensure_provenance_source_id(payload: &mut Value, rv_id: &str) {
    if !payload.get("provenance").map_or(false, Value::is_object) {
        payload["provenance"] = json!({
            "source_resource_version_ids": [rv_id]
        });
        return;
    }
    if payload["provenance"]
        .get("source_resource_version_ids")
        .and_then(Value::as_array)
        .is_none()
    {
        payload["provenance"]["source_resource_version_ids"] = json!([]);
    }
    if let Some(arr) = payload["provenance"]
        .get_mut("source_resource_version_ids")
        .and_then(Value::as_array_mut)
    {
        if !arr.iter().any(|v| v.as_str() == Some(rv_id)) {
            arr.push(json!(rv_id));
        }
    }
}

pub(crate) fn normalize_contract_resource_type(raw: &str) -> &'static str {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.contains("video") || lower.contains("youtube") {
        "video"
    } else if lower.contains("textbook") {
        "textbook"
    } else if lower.contains("book") {
        "book"
    } else if lower.contains("course") {
        "course"
    } else if lower.contains("repo") || lower.contains("github") {
        "repository"
    } else if lower.contains("doc") {
        "documentation"
    } else if lower.contains("cert") {
        "certification"
    } else if lower.contains("project") || lower.contains("problem") || lower.contains("lab") {
        "project"
    } else {
        "article"
    }
}

fn collect_open_catalog_json_files(
    dir: &std::path::Path,
    out: &mut Vec<std::path::PathBuf>,
) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect_open_catalog_json_files(&path, out)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
            out.push(path);
        }
    }
    Ok(())
}

pub(crate) fn parse_open_catalog_json_record(raw_json: &str) -> Option<CatalogResourceVersionRecord> {
    let v: Value = serde_json::from_str(raw_json).ok()?;
    let rv_id = v.get("resource_version_id")?.as_str()?.trim();
    let title = v.get("title")?.as_str()?.trim();
    let canonical_url = v.get("canonical_url")?.as_str()?.trim();
    if rv_id.is_empty() || title.is_empty() || canonical_url.is_empty() {
        return None;
    }

    let resource_id = rv_id.strip_suffix("-v1").unwrap_or(rv_id).to_string();
    let category = v
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or("Article");
    let resource_type = normalize_contract_resource_type(category).to_string();
    let subject = v
        .get("subject")
        .and_then(Value::as_str)
        .unwrap_or("Engineering")
        .trim();

    let provider_obj = v.get("provider");
    let provider_id = provider_obj
        .and_then(|p| p.get("provider_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("community-open-catalog")
        .to_string();
    let provider_display_name = provider_obj
        .and_then(|p| p.get("display_name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Open Community Catalog")
        .to_string();

    let access_obj = v.get("access");
    let access_model = access_obj
        .and_then(|a| a.get("model"))
        .and_then(|m| serde_json::from_value::<CatalogAccessModel>(m.clone()).ok())
        .unwrap_or(CatalogAccessModel::FreePublic);
    let cert_included = access_obj
        .and_then(|a| a.get("certificate_included"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let optional_cert_price = access_obj
        .and_then(|a| a.get("optional_certificate_price_minor"))
        .and_then(Value::as_u64);
    let price_minor_units = match access_model {
        CatalogAccessModel::FreePublic => Some(0),
        _ => optional_cert_price.or(Some(0)),
    };

    let mut topics: Vec<String> = v
        .get("topic_tags")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if !subject.is_empty() && !topics.iter().any(|t| t.eq_ignore_ascii_case(subject)) {
        topics.push(subject.to_ascii_lowercase());
    }
    if topics.is_empty() {
        topics.push("general".to_string());
    }

    let segment_titles: Vec<String> = v
        .get("segments")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|seg| seg.get("title").and_then(Value::as_str))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let summary = v
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let description = match (summary, segment_titles.is_empty()) {
        (Some(s), true) => s.to_string(),
        (Some(s), false) => format!("{s} Sections: {}.", segment_titles.join("; ")),
        (None, false) => format!(
            "{category} in {subject} from {provider_display_name}. Sections: {}.",
            segment_titles.join("; ")
        ),
        (None, true) => format!("{category} in {subject} from {provider_display_name}."),
    };

    let captured_at = v
        .get("captured_at")
        .and_then(Value::as_str)
        .unwrap_or("2026-10-30T00:00:00Z")
        .to_string();
    let allow_excerpts = v
        .get("ingestion_permissions")
        .and_then(|ip| ip.get("permissions"))
        .and_then(|p| p.get("display_excerpts"))
        .and_then(Value::as_str)
        == Some("allowed");

    let is_synthetic_fixture = rv_id.starts_with("synthetic-")
        || canonical_url.contains("example.invalid")
        || v.get("catalog_collection").and_then(Value::as_str) == Some("synthetic_fixture");

    Some(CatalogResourceVersionRecord {
        resource_version_id: rv_id.to_string(),
        resource_id,
        version_number: 1,
        title: title.to_string(),
        provider_id,
        provider_display_name,
        canonical_url: canonical_url.to_string(),
        resource_type,
        language: "en".to_string(),
        description,
        topics,
        level: "intermediate".to_string(),
        objective_ids: Vec::new(),
        access_model,
        currency: Some("USD".to_string()),
        price_minor_units,
        subscription_ids: Vec::new(),
        is_optional_certification: cert_included || optional_cert_price.is_some(),
        review_status: ResourceReviewStatus::Approved,
        review_evidence: Some(CatalogReviewEvidence {
            reviewer_principal_id: "open-catalog-git".to_string(),
            reviewed_at: captured_at,
            pedagogical_fit_score: 5,
            accuracy_score: 5,
            accessibility_score: 5,
            rights_verified: true,
            rationale: "Open Git-tracked community catalog resource.".to_string(),
            credibility_basis: "expert_practitioner".to_string(),
            evidence_url: canonical_url.to_string(),
        }),
        freshness_state: ResourceFreshnessState::Healthy,
        acquisition_permission: AcquisitionPermission {
            allow_metadata: true,
            allow_link_out: true,
            allow_short_excerpt: allow_excerpts,
            allow_full_text_storage: false,
            allow_embedding: true,
            allow_redistribution: false,
            license_spdx_or_custom: "LinkOut-Metadata-Only".to_string(),
            requires_attribution: true,
            attribution_text: Some(title.to_string()),
            notes: Some("Loaded from open Git catalog/resources registry.".to_string()),
        },
        is_synthetic_fixture,
        metadata_embedding: None,
    })
}

impl InMemoryTransactionalStore {
    /// Loads contributor-editable JSON resource files from `<catalog_dir>/resources/**/*.json`
    /// (or `<catalog_dir>/**/*.json` if pointed directly at `catalog/resources`), inserting any
    /// new `resource_version_id` entries into `catalog_resources` and the TF-IDF search index.
    pub fn load_open_catalog_from_dir(
        &self,
        catalog_dir: &std::path::Path,
    ) -> Result<usize, PersistenceError> {
        let resources_root = if catalog_dir.join("resources").is_dir() {
            catalog_dir.join("resources")
        } else {
            catalog_dir.to_path_buf()
        };
        let mut files = Vec::new();
        collect_open_catalog_json_files(&resources_root, &mut files)
            .map_err(|e| PersistenceError::Validation(format!("open catalog read failed: {e}")))?;

        let mut parsed_records = Vec::new();
        for file_path in files {
            if let Ok(raw) = std::fs::read_to_string(&file_path) {
                if let Some(rec) = parse_open_catalog_json_record(&raw) {
                    parsed_records.push(rec);
                }
            }
        }
        if parsed_records.is_empty() {
            return Ok(0);
        }

        let mut guard = self.write_inner();
        let mut inserted = 0usize;
        for rec in parsed_records {
            if !guard.catalog_resources.contains_key(&rec.resource_version_id) {
                Self::sync_catalog_tfidf_entry_locked(&mut guard, &rec);
                guard
                    .catalog_resources
                    .insert(rec.resource_version_id.clone(), rec);
                inserted += 1;
            }
        }
        Ok(inserted)
    }

    /// Resolves the workspace `catalog/resources` directory (via `OPEN_CATALOG_DIR` or
    /// `<repo_root>/catalog/resources`) and loads any new open-catalog JSON entries.
    pub fn load_open_catalog_from_workspace(&self) -> usize {
        if let Ok(custom) = std::env::var("OPEN_CATALOG_DIR") {
            let trimmed = custom.trim();
            if !trimmed.is_empty() {
                return self
                    .load_open_catalog_from_dir(std::path::Path::new(trimmed))
                    .unwrap_or(0);
            }
        }
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        if let Some(repo_root) = manifest_dir.parent().and_then(|p| p.parent()) {
            let default_dir = repo_root.join("catalog").join("resources");
            if default_dir.is_dir() {
                return self.load_open_catalog_from_dir(&default_dir).unwrap_or(0);
            }
        }
        0
    }
}
