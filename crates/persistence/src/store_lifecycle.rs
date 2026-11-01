//! Private and public syllabus revision lifecycle, candidate archives, AI generation jobs,
//! and revision activation transitions.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use syllabus_contracts::jcs::jcs_sha256_hex;
use syllabus_security::AuthenticatedPrincipal;

use crate::models::{
    evaluate_if_match, CandidateArchiveRecord, GenerationJobRecord, LearnerProficiencyProjection,
    PersistenceError, PublicTemplateRevisionRecord, PublicVisibility, ScheduleFeasibility,
    ScheduleRevisionRecord, ScheduledSessionItem, SyllabusRevisionRecord,
};
use crate::store::{InMemoryTransactionalStore, PROHIBITED_PRIVATE_FIELDS_IN_PUBLIC};

impl InMemoryTransactionalStore {
    /// Commits a private learner syllabus revision (`T01`, `@S09`, `SHARE-001`, `SHARE-002`).
    /// Enforces:
    /// 1. Separate identifier namespace (`revision_id` and `syllabus_id` cannot use `pub_` / `pubrev_` prefixes).
    /// 2. Server-owned `owner_account_id` is derived exclusively from `principal.account_id`;
    ///    if `payload` attempts to set `account_id`, `owner_account_id`, `mastered`, or `demonstrated`, it is rejected.
    pub fn commit_private_syllabus_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        revision_id: &str,
        payload: Value,
    ) -> Result<SyllabusRevisionRecord, PersistenceError> {
        if revision_id.starts_with("pubrev_") || revision_id.starts_with("pubrev-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private syllabus revision `{revision_id}` cannot use public template revision prefix"
            )));
        }
        if syllabus_id.starts_with("pub_") || syllabus_id.starts_with("pub-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private syllabus `{syllabus_id}` cannot use public publication prefix"
            )));
        }

        if let Some(obj) = payload.as_object() {
            for forbidden in [
                "account_id",
                "owner_account_id",
                "mastered",
                "demonstrated_objectives",
                "proficiency_status",
            ] {
                if obj.contains_key(forbidden) {
                    return Err(PersistenceError::ForbiddenClientOrModelAssignedField {
                        field: forbidden.to_string(),
                    });
                }
            }
        }

        let mut guard = self.write_inner();

        // Verify ownership if syllabus_id already exists
        let existing_revs: Vec<&SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .collect();
        if let Some(first) = existing_revs.first() {
            principal.require_learner_ownership(&first.owner_account_id)?;
        }
        let next_rev_num = existing_revs.len() as u32 + 1;
        let candidate_sha256 = jcs_sha256_hex(&payload);

        let record = SyllabusRevisionRecord {
            revision_id: revision_id.to_string(),
            syllabus_id: syllabus_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_num,
            candidate_sha256,
            payload,
            is_active: true,
        };

        guard
            .private_revisions
            .insert(revision_id.to_string(), record.clone());
        guard
            .syllabus_activation_versions
            .entry(syllabus_id.to_string())
            .or_insert(1);

        guard
            .schedules
            .entry(syllabus_id.to_string())
            .or_insert_with(|| ScheduleRevisionRecord {
                schedule_revision_id: format!("sched-{syllabus_id}-v1"),
                syllabus_id: syllabus_id.to_string(),
                owner_account_id: principal.account_id.clone(),
                syllabus_revision_id: revision_id.to_string(),
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
                    session_id: "sess-1".to_string(),
                    activity_id: "act-1".to_string(),
                    duration_minutes: 60,
                    is_review: false,
                }],
            });

        guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        Ok(record)
    }

    pub fn get_private_syllabus_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        revision_id: &str,
    ) -> Result<SyllabusRevisionRecord, PersistenceError> {
        let guard = self.read_inner();
        let record =
            guard
                .private_revisions
                .get(revision_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "syllabus_revision",
                    resource_id: revision_id.to_string(),
                })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        Ok(record.clone())
    }

    /// Publishes an immutable public or unlisted template revision in a separate identifier space
    /// (`pub_`, `pubrev_`) and rejects any prohibited private fields or duplicate content (`SHARE-001`, `SHARE-002`, `SHARE-007`, `@S56`, `@S57`, `@S61`).
    pub fn create_public_template_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        publication_id: &str,
        publication_revision_id: &str,
        source_private_revision_id: &str,
        visibility: PublicVisibility,
        public_payload: Value,
    ) -> Result<PublicTemplateRevisionRecord, PersistenceError> {
        if !publication_id.starts_with("pub_") && !publication_id.starts_with("pub-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "publication_id `{publication_id}` must use `pub_` or `pub-` prefix"
            )));
        }
        if !publication_revision_id.starts_with("pubrev_")
            && !publication_revision_id.starts_with("pubrev-")
        {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "publication_revision_id `{publication_revision_id}` must use `pubrev_` or `pubrev-` prefix"
            )));
        }

        if let Some(obj) = public_payload.as_object() {
            for &prohibited in PROHIBITED_PRIVATE_FIELDS_IN_PUBLIC {
                if obj.contains_key(prohibited) {
                    return Err(PersistenceError::ProhibitedPrivateFieldInPublicProjection {
                        field: prohibited.to_string(),
                    });
                }
            }
        }

        let mut guard = self.write_inner();
        let source_rev = guard
            .private_revisions
            .get(source_private_revision_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "syllabus_revision",
                resource_id: source_private_revision_id.to_string(),
            })?;

        // Owner authorization check (@S56)
        principal.require_learner_ownership(&source_rev.owner_account_id)?;

        let content_sha256 = jcs_sha256_hex(&public_payload);
        // Reject identical duplicate republication under the same publication_id (SHARE-007, @S61)
        let duplicate_exists = guard
            .public_revisions
            .values()
            .any(|r| r.publication_id == publication_id && r.content_sha256 == content_sha256);
        if duplicate_exists {
            return Err(PersistenceError::DuplicatePublicRevisionContent {
                publication_id: publication_id.to_string(),
                content_sha256,
            });
        }

        let preview_sha256 = jcs_sha256_hex(&json!({
            "publication_id": publication_id,
            "visibility": visibility,
            "content_sha256": content_sha256,
        }));

        let record = PublicTemplateRevisionRecord {
            publication_revision_id: publication_revision_id.to_string(),
            publication_id: publication_id.to_string(),
            publisher_account_id: principal.account_id.clone(),
            source_private_revision_id: source_private_revision_id.to_string(),
            visibility,
            content_sha256,
            preview_sha256,
            public_payload,
            upvote_count: 0,
            quarantined: false,
        };

        guard
            .public_revisions
            .insert(publication_revision_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_public_template_revision(
        &self,
        publication_revision_id: &str,
    ) -> Result<PublicTemplateRevisionRecord, PersistenceError> {
        let guard = self.read_inner();
        let record = guard
            .public_revisions
            .get(publication_revision_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "public_template_revision",
                resource_id: publication_revision_id.to_string(),
            })?;
        if record.quarantined {
            return Err(PersistenceError::NotFound {
                resource_type: "public_template_revision",
                resource_id: publication_revision_id.to_string(),
            });
        }
        Ok(record.clone())
    }

    /// Commits a semantically validated syllabus revision (`T03`, `T04`, `@S10`, `@S28`).
    /// Preserves the exact `candidate_sha256` computed over the raw model candidate UTF-8 bytes
    /// and initializes the revision as draft (`initial_is_active = false`) until explicitly activated.
    pub fn commit_validated_syllabus_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        revision_id: &str,
        candidate_sha256: &str,
        payload: Value,
        initial_is_active: bool,
    ) -> Result<SyllabusRevisionRecord, PersistenceError> {
        if revision_id.starts_with("pubrev_") || revision_id.starts_with("pubrev-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private syllabus revision `{revision_id}` cannot use public template revision prefix"
            )));
        }
        if syllabus_id.starts_with("pub_") || syllabus_id.starts_with("pub-") {
            return Err(PersistenceError::IdentifierNamespaceViolation(format!(
                "private syllabus `{syllabus_id}` cannot use public publication prefix"
            )));
        }

        let mut guard = self.write_inner();
        let existing_revs: Vec<&SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .collect();
        if let Some(first) = existing_revs.first() {
            principal.require_learner_ownership(&first.owner_account_id)?;
        }
        let next_rev_num = existing_revs.len() as u32 + 1;

        let record = SyllabusRevisionRecord {
            revision_id: revision_id.to_string(),
            syllabus_id: syllabus_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_num,
            candidate_sha256: candidate_sha256.to_string(),
            payload,
            is_active: initial_is_active,
        };

        guard
            .private_revisions
            .insert(revision_id.to_string(), record.clone());
        guard
            .syllabus_activation_versions
            .entry(syllabus_id.to_string())
            .or_insert(if initial_is_active { 1 } else { 0 });

        guard
            .schedules
            .entry(syllabus_id.to_string())
            .or_insert_with(|| ScheduleRevisionRecord {
                schedule_revision_id: format!("sched-{syllabus_id}-v1"),
                syllabus_id: syllabus_id.to_string(),
                owner_account_id: principal.account_id.clone(),
                syllabus_revision_id: revision_id.to_string(),
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
                    session_id: "sess-1".to_string(),
                    activity_id: "act-1".to_string(),
                    duration_minutes: 60,
                    is_review: false,
                }],
            });

        guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        Ok(record)
    }

    /// Explicitly activates a syllabus revision with `If-Match` optimistic concurrency (`T04`, `@S22`, `@S24`).
    /// - Returns `428 Precondition Required` when `If-Match` is missing.
    /// - Returns `412 Precondition Failed` (`stale_revision`) when `If-Match` does not match the current activation ETag.
    /// - Marks `revision_id` as `is_active = true` (and deactivates older revisions of the same syllabus), increments `activation_version`, and returns the updated revision + new ETag.
    pub fn activate_syllabus_revision(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        revision_id: &str,
        if_match: Option<&str>,
    ) -> Result<(SyllabusRevisionRecord, String), PersistenceError> {
        let mut guard = self.write_inner();
        let owner_account_id = {
            let target = guard
                .private_revisions
                .get(revision_id)
                .filter(|r| r.syllabus_id == syllabus_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "syllabus_revision",
                    resource_id: revision_id.to_string(),
                })?;
            target.owner_account_id.clone()
        };
        principal.require_learner_ownership(&owner_account_id)?;

        let current_ver = guard
            .syllabus_activation_versions
            .get(syllabus_id)
            .copied()
            .unwrap_or(0);
        let current_etag = format!("\"cur-act-v{current_ver}\"");
        evaluate_if_match(if_match, &current_etag)?;

        for rev in guard.private_revisions.values_mut() {
            if rev.syllabus_id == syllabus_id {
                rev.is_active = rev.revision_id == revision_id;
            }
        }
        let next_ver = current_ver + 1;
        guard
            .syllabus_activation_versions
            .insert(syllabus_id.to_string(), next_ver);
        let next_etag = format!("\"cur-act-v{next_ver}\"");

        let updated = guard
            .private_revisions
            .get(revision_id)
            .cloned()
            .expect("revision exists");
        Ok((updated, next_etag))
    }

    pub fn record_candidate_archive(&self, archive: CandidateArchiveRecord) {
        let mut guard = self.write_inner();
        guard
            .candidate_archives
            .insert(archive.archive_id.clone(), archive);
    }

    #[must_use]
    pub fn get_candidate_archive(&self, archive_id: &str) -> Option<CandidateArchiveRecord> {
        let guard = self.read_inner();
        guard.candidate_archives.get(archive_id).cloned()
    }

    pub fn upsert_generation_job(&self, job: GenerationJobRecord) {
        let mut guard = self.write_inner();
        guard.generation_jobs.insert(job.job_id.clone(), job);
    }

    pub fn get_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError> {
        let guard = self.read_inner();
        let job = guard
            .generation_jobs
            .get(job_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "generation_job",
                resource_id: job_id.to_string(),
            })?;
        principal.require_learner_ownership(&job.owner_account_id)?;
        Ok(job.clone())
    }

    pub fn cancel_generation_job(
        &self,
        principal: &AuthenticatedPrincipal,
        job_id: &str,
    ) -> Result<GenerationJobRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let job =
            guard
                .generation_jobs
                .get_mut(job_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "generation_job",
                    resource_id: job_id.to_string(),
                })?;
        principal.require_learner_ownership(&job.owner_account_id)?;
        if job.status != "succeeded" && job.status != "failed" {
            job.status = "cancelled".to_string();
            job.stage_history.push("cancelled".to_string());
        }
        Ok(job.clone())
    }
}
