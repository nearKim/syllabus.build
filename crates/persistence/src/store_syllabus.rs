//! Syllabus contents, progress tracking, objective mastery transitions, schedule revisions,
//! and syllabus overviews.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::json;
use syllabus_contracts::jcs::jcs_sha256_hex;
use syllabus_domain::{
    derive_proficiency_transition, ActivityExecutionStatus, EvidenceOrigin,
    ObjectiveProficiencyState,
};
use syllabus_security::AuthenticatedPrincipal;

use crate::models::{
    evaluate_if_match, LearnerProficiencyProjection, PersistenceError, ProgressEventInput,
    ProgressEventReceiptRecord, ScheduleFeasibility, SchedulePatchInput, ScheduleRevisionRecord,
    StoredProgressEvent, SyllabusOverviewRecord, SyllabusRevisionRecord, SyllabusSummaryItem,
};
use crate::store::InMemoryTransactionalStore;

impl InMemoryTransactionalStore {
    /// Reads learner proficiency projection, enforcing strict tenant ownership (`@S16`, `@S36`, `@S64`, `@S87`).
    pub fn get_learner_proficiency(
        &self,
        principal: &AuthenticatedPrincipal,
        target_account_id: &str,
    ) -> Result<LearnerProficiencyProjection, PersistenceError> {
        principal.require_learner_ownership(target_account_id)?;
        let guard = self.read_inner();
        Ok(guard
            .proficiency_by_account
            .get(target_account_id)
            .cloned()
            .unwrap_or_else(|| LearnerProficiencyProjection {
                account_id: target_account_id.to_string(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            }))
    }

    /// Appends a learner progress event with `(account_id, event_id)` deduplication (`@S16`, `@S21`, `@S23`, `@S24`).
    /// - Replays receipt when `(account_id, event_id)` and `payload_sha256` match without double-counting.
    /// - Returns `409 Conflict` when `(account_id, event_id)` is reused with a different payload.
    /// - Updates activity completion and study time while ensuring self-report never yields `Demonstrated` proficiency (`@S16`).
    pub fn append_progress_event(
        &self,
        principal: &AuthenticatedPrincipal,
        input: ProgressEventInput,
    ) -> Result<ProgressEventReceiptRecord, PersistenceError> {
        let mut guard = self.write_inner();

        // Verify ownership of the target syllabus
        let syllabus_owner = guard
            .private_revisions
            .values()
            .find(|r| r.syllabus_id == input.syllabus_id)
            .map(|r| r.owner_account_id.clone())
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "syllabus",
                resource_id: input.syllabus_id.clone(),
            })?;

        principal.require_learner_ownership(&syllabus_owner)?;

        let objective_id = input
            .objective_id
            .clone()
            .unwrap_or_else(|| format!("obj-for-{}", input.activity_id));

        let canonical_payload = json!({
            "syllabus_id": input.syllabus_id,
            "activity_id": input.activity_id,
            "objective_id": objective_id,
            "status": input.status,
            "time_spent_minutes": input.time_spent_minutes,
        });
        let payload_sha256 = jcs_sha256_hex(&canonical_payload);
        let dedup_key = (principal.account_id.clone(), input.event_id.clone());

        if let Some(existing) = guard.progress_events.get(&dedup_key).cloned() {
            if existing.payload_sha256 != payload_sha256 {
                return Err(PersistenceError::ConflictingProgressEventPayload {
                    event_id: input.event_id,
                });
            }
            let prof = guard
                .proficiency_by_account
                .get(&principal.account_id)
                .expect("proficiency projection exists");
            let obj_state = prof
                .objectives
                .get(&existing.objective_id)
                .copied()
                .unwrap_or(ObjectiveProficiencyState::SelfReported);
            return Ok(ProgressEventReceiptRecord {
                event_id: existing.event_id,
                syllabus_id: existing.syllabus_id,
                activity_id: existing.activity_id,
                status: existing.status,
                time_spent_minutes: existing.time_spent_minutes,
                evidence_origin: existing.evidence_origin,
                objective_proficiency_status: obj_state,
                replayed: true,
                total_completed_activities: prof.completed_activities.len(),
                total_skipped_activities: prof.skipped_activities.len(),
                total_time_spent_minutes: prof.total_time_spent_minutes,
            });
        }

        let evidence_origin = EvidenceOrigin::SelfReportedActivityCompletion;
        let stored_event = StoredProgressEvent {
            account_id: principal.account_id.clone(),
            event_id: input.event_id.clone(),
            syllabus_id: input.syllabus_id.clone(),
            activity_id: input.activity_id.clone(),
            objective_id: objective_id.clone(),
            status: input.status,
            time_spent_minutes: input.time_spent_minutes,
            evidence_origin,
            payload_sha256,
        };
        guard.progress_events.insert(dedup_key, stored_event);

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

        prof.total_time_spent_minutes += input.time_spent_minutes;
        match input.status {
            ActivityExecutionStatus::SelfReportedCompleted | ActivityExecutionStatus::Completed => {
                prof.completed_activities.insert(input.activity_id.clone());
            }
            ActivityExecutionStatus::Waived => {
                prof.skipped_activities.insert(input.activity_id.clone());
            }
            _ => {}
        }

        let current_obj_state = prof
            .objectives
            .get(&objective_id)
            .copied()
            .unwrap_or(ObjectiveProficiencyState::Unassessed);
        let next_obj_state = derive_proficiency_transition(current_obj_state, evidence_origin)
            .unwrap_or(ObjectiveProficiencyState::SelfReported);
        prof.objectives.insert(objective_id, next_obj_state);

        Ok(ProgressEventReceiptRecord {
            event_id: input.event_id,
            syllabus_id: input.syllabus_id,
            activity_id: input.activity_id,
            status: input.status,
            time_spent_minutes: input.time_spent_minutes,
            evidence_origin,
            objective_proficiency_status: next_obj_state,
            replayed: false,
            total_completed_activities: prof.completed_activities.len(),
            total_skipped_activities: prof.skipped_activities.len(),
            total_time_spent_minutes: prof.total_time_spent_minutes,
        })
    }

    pub fn get_schedule(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
    ) -> Result<ScheduleRevisionRecord, PersistenceError> {
        let guard = self.read_inner();
        let schedule =
            guard
                .schedules
                .get(syllabus_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "schedule",
                    resource_id: syllabus_id.to_string(),
                })?;
        principal.require_learner_ownership(&schedule.owner_account_id)?;
        Ok(schedule.clone())
    }

    /// Updates a schedule revision with optimistic concurrency (`If-Match`, `@S02`, `@S22`, `@S24`, `PROG-003`, `PROG-004`).
    pub fn patch_schedule(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        if_match: Option<&str>,
        patch: SchedulePatchInput,
    ) -> Result<ScheduleRevisionRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let schedule =
            guard
                .schedules
                .get_mut(syllabus_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "schedule",
                    resource_id: syllabus_id.to_string(),
                })?;

        // Enforce strict tenant isolation before revealing precondition state (@S36, @S64)
        principal.require_learner_ownership(&schedule.owner_account_id)?;

        // Enforce If-Match precondition (428 when missing, 412 when stale)
        evaluate_if_match(if_match, &schedule.etag)?;

        if let Some(tz) = patch.timezone {
            schedule.timezone = tz;
        }
        if let Some(avail) = patch.weekly_available_minutes {
            schedule.weekly_available_minutes = avail;
        }
        if let Some(req) = patch.required_minutes {
            schedule.required_minutes = req;
        }
        if let Some(fixed) = patch.fixed_deadline {
            schedule.fixed_deadline = fixed;
        }
        if let Some(sessions) = patch.sessions {
            schedule.sessions = sessions;
        }

        // Feasibility evaluation (@S02, PROG-003): never silently remove practice or overbook sessions
        if schedule.required_minutes > schedule.weekly_available_minutes && schedule.fixed_deadline
        {
            schedule.feasibility_status = ScheduleFeasibility::Infeasible;
            schedule.excess_minutes = schedule.required_minutes - schedule.weekly_available_minutes;
            schedule.recovery_options = vec![
                "reduced_scope".to_string(),
                "extended_time".to_string(),
                "increased_availability".to_string(),
            ];
        } else {
            schedule.feasibility_status = ScheduleFeasibility::Feasible;
            schedule.excess_minutes = 0;
            schedule.recovery_options.clear();
        }

        schedule.etag_version += 1;
        schedule.schedule_revision_id = format!("sched-{syllabus_id}-v{}", schedule.etag_version);
        schedule.etag = format!("\"sched-v{}\"", schedule.etag_version);

        Ok(schedule.clone())
    }

    /// Lists all private syllabi owned by `principal` (`T04`).
    pub fn list_my_syllabi(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Result<Vec<SyllabusSummaryItem>, PersistenceError> {
        let guard = self.read_inner();
        let mut by_syllabus: BTreeMap<String, Vec<&SyllabusRevisionRecord>> = BTreeMap::new();
        for rev in guard.private_revisions.values() {
            if rev.owner_account_id == principal.account_id {
                by_syllabus
                    .entry(rev.syllabus_id.clone())
                    .or_default()
                    .push(rev);
            }
        }

        let mut items = Vec::new();
        for (syllabus_id, mut revs) in by_syllabus {
            revs.sort_by_key(|r| r.revision_number);
            let latest = revs.last().expect("at least one revision");
            let active_revision_id = revs
                .iter()
                .rev()
                .find(|r| r.is_active)
                .map(|r| r.revision_id.clone());
            let title = latest
                .payload
                .get("title")
                .or_else(|| latest.payload.get("goal").and_then(|g| g.get("title")))
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled Syllabus")
                .to_string();
            let act_ver = guard
                .syllabus_activation_versions
                .get(&syllabus_id)
                .copied()
                .unwrap_or(0);
            items.push(SyllabusSummaryItem {
                syllabus_id,
                title,
                active_revision_id,
                latest_revision_id: latest.revision_id.clone(),
                revision_count: revs.len(),
                etag: format!("\"cur-act-v{act_ver}\""),
            });
        }
        Ok(items)
    }

    /// Returns the syllabus overview for `syllabus_id`, enforcing tenant isolation (`T04`).
    pub fn get_syllabus_overview(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
    ) -> Result<SyllabusOverviewRecord, PersistenceError> {
        let guard = self.read_inner();
        let mut revs: Vec<&SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .collect();
        let owner_account_id = revs
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "syllabus",
                resource_id: syllabus_id.to_string(),
            })?
            .owner_account_id
            .clone();
        principal.require_learner_ownership(&owner_account_id)?;

        revs.sort_by_key(|r| r.revision_number);
        let latest = revs.last().expect("at least one revision");
        let active_revision_id = revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .map(|r| r.revision_id.clone());
        let title = latest
            .payload
            .get("title")
            .or_else(|| latest.payload.get("goal").and_then(|g| g.get("title")))
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled Syllabus")
            .to_string();
        let act_ver = guard
            .syllabus_activation_versions
            .get(syllabus_id)
            .copied()
            .unwrap_or(0);
        let alerts = Self::collect_alerts_for_revisions(&guard, syllabus_id, &revs);

        Ok(SyllabusOverviewRecord {
            syllabus_id: syllabus_id.to_string(),
            owner_account_id,
            title,
            active_revision_id,
            latest_revision_id: latest.revision_id.clone(),
            revisions: revs.into_iter().cloned().collect(),
            resource_alerts: alerts,
            activation_version: act_ver,
            etag: format!("\"cur-act-v{act_ver}\""),
        })
    }

    /// Fetches a specific revision within `syllabus_id`, enforcing tenant isolation (`T04`).
    pub fn get_syllabus_revision_by_syllabus_and_id(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        revision_id: &str,
    ) -> Result<(SyllabusRevisionRecord, String), PersistenceError> {
        let guard = self.read_inner();
        let record = guard
            .private_revisions
            .get(revision_id)
            .filter(|r| r.syllabus_id == syllabus_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "syllabus_revision",
                resource_id: revision_id.to_string(),
            })?;
        principal.require_learner_ownership(&record.owner_account_id)?;
        let act_ver = guard
            .syllabus_activation_versions
            .get(syllabus_id)
            .copied()
            .unwrap_or(0);
        Ok((record.clone(), format!("\"cur-act-v{act_ver}\"")))
    }
}
