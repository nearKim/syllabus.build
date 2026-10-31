import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAdaptationDiffController,
  createBoundedOfflineQueue,
  createByokCustodyController,
  createDiagnosticFlowController,
  createReminderPreferenceController,
  createScheduleEditorController,
  evaluatePwaCacheEligibility,
} from "../src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.resolve(
  __dirname,
  "../../../specs/001-syllabus-platform/examples"
);

function loadSyntheticExample(filename) {
  return JSON.parse(
    fs.readFileSync(path.join(EXAMPLES_DIR, filename), "utf8")
  );
}

test("T06 (@S20, @S02, @S53, @S22, @S24): ScheduleEditorController scales only media_minutes at 1.5x, redistributes missed sessions without overbooking, and enforces If-Match", () => {
  const scheduleFixture = loadSyntheticExample("schedule.synthetic.json");
  const syllabusFixture = loadSyntheticExample("syllabus.synthetic.json");

  const controller = createScheduleEditorController({
    syllabusId: syllabusFixture.syllabus_id,
    syllabus: syllabusFixture,
    schedule: scheduleFixture,
    ifMatch: '"schedule-etag-v1"',
    maxSessionMinutes: 40,
  });

  // 1. Playback speed 1.5x scales only media_minutes via ceiling math (@S20) and never mutates SyllabusRevision
  const playbackPreview = controller.previewPlaybackSpeed(1.5, {
    "activity-theory": {
      media_minutes: 30,
      reading_minutes: 10,
      practice_minutes: 15,
      assessment_minutes: 0,
      review_minutes: 0,
    },
  });
  const sessionWithMedia = playbackPreview.sessions.find((s) =>
    s.activityIds.includes("activity-theory")
  );
  assert.ok(sessionWithMedia);
  assert.equal(sessionWithMedia.mediaMinutesAt1x, 30);
  assert.equal(sessionWithMedia.mediaMinutesAtSpeed, 20);
  assert.equal(sessionWithMedia.nonMediaMinutes, 50);
  assert.equal(sessionWithMedia.durationAt1xMinutes, 80);
  assert.equal(sessionWithMedia.durationAtSpeedMinutes, 70);
  assert.equal(
    playbackPreview.readingCodingSetupAssessmentReviewUnchanged,
    true
  );
  assert.equal(playbackPreview.mutatesSyllabusRevision, false);
  assert.equal(
    playbackPreview.syllabusRevisionId,
    scheduleFixture.syllabus_revision_id
  );

  // 2. Missed-session redistribution never overbooks remaining sessions (@S02, @S53)
  const missedPreview = controller.previewMissedSessionRedistribution(
    ["synthetic-session-1"],
    {
      maxSessionMinutes: 40,
      deadlineFixed: false,
    }
  );
  assert.equal(missedPreview.silentlyOverbookedFutureSessions, false);
  assert.equal(missedPreview.overbookedSessionMinutes, 0);
  assert.equal(missedPreview.mutatesSyllabusRevision, false);
  for (const session of missedPreview.proposedSessions) {
    assert.ok(session.duration_minutes <= 40);
  }

  // 3. ReviewScheduleItem spacing preview
  const reviewPreview = controller.previewReviewScheduleSpacing([
    {
      review_item_id: "review-tok-1",
      objective_id: "objective-tokenization",
      activity_id: "activity-review",
      status: "due",
      due_at: "2026-10-28T18:00:00-04:00",
    },
  ]);
  assert.equal(reviewPreview.reviewItems.length, 1);
  assert.equal(reviewPreview.reviewItems[0].status, "due");
  assert.equal(reviewPreview.reviewsConsumeDeclaredStudyCapacity, true);
  assert.equal(reviewPreview.erasesDatedDemonstrationWhenDue, false);

  // 4. PATCH /syllabi/{id}/schedule requires If-Match header
  const patchReq = controller.buildPatchScheduleRequest({
    patch: { weekly_minutes: 150 },
  });
  assert.equal(patchReq.operationId, "patchSchedule");
  assert.equal(patchReq.headers["If-Match"], '"schedule-etag-v1"');

  // 5. 412 Precondition Failed conflict resolution
  const conflict = controller.handleStaleScheduleConflict({
    statusCode: 412,
    staleIfMatch: '"schedule-etag-v1"',
    latestServerSchedule: {
      ...scheduleFixture,
      schedule_revision_id: "synthetic-schedule-revision-2",
      version: 2,
      weekly_minutes: 135,
    },
  });
  assert.equal(conflict.hasConflict, true);
  assert.equal(conflict.statusCode, 412);
  assert.equal(conflict.silentlyOverwroteServerSchedule, false);

  const resolved = controller.resolveScheduleConflict("rebase_on_latest");
  assert.equal(resolved.conflictState.hasConflict, false);
  assert.equal(resolved.scheduleRevisionId, "synthetic-schedule-revision-2");
});

test("T06 (@S21, @S24, @S25, @S29, @S87): BoundedOfflineQueue enforces 100-item bound, deduplicates by event_id, rejects secrets/answer keys/full text, and purges on sign-out", () => {
  const queue = createBoundedOfflineQueue({
    accountId: "learner-1",
    syllabusId: "curr-1",
    maxCapacity: 100,
  });

  // Reject BYOK API keys, assessment answer keys, and unapproved full text
  const rejectByok = queue.enqueue({
    event_id: "evt-secret-1",
    api_key: "sk-live-secret-1234567890abcdef",
  });
  assert.equal(rejectByok.accepted, false);
  assert.equal(rejectByok.rejectedReason, "forbidden_byok_credential");

  const rejectAnswerKey = queue.enqueue({
    event_id: "evt-key-1",
    answer_key: { q1: "opt-a" },
  });
  assert.equal(rejectAnswerKey.accepted, false);
  assert.equal(rejectAnswerKey.rejectedReason, "forbidden_assessment_answer_key");

  const rejectFullText = queue.enqueue({
    event_id: "evt-fulltext-1",
    unapproved_full_text: "Copyrighted textbook chapter full text...",
  });
  assert.equal(rejectFullText.accepted, false);
  assert.equal(rejectFullText.rejectedReason, "forbidden_unapproved_full_text");

  // Enqueue 100 valid events and verify deduplication + 101st rejection
  for (let i = 1; i <= 100; i++) {
    const res = queue.enqueue({
      event_id: `evt-valid-${i}`,
      activity_id: "activity-theory",
      type: "self_reported_completed",
      time_spent_minutes: 10,
    });
    assert.equal(res.accepted, true);
    assert.equal(res.deduplicated, false);
  }

  const duplicateRes = queue.enqueue({
    event_id: "evt-valid-1",
    activity_id: "activity-theory",
  });
  assert.equal(duplicateRes.accepted, true);
  assert.equal(duplicateRes.deduplicated, true);
  assert.equal(duplicateRes.queueSize, 100);

  const overflowRes = queue.enqueue({
    event_id: "evt-valid-101",
    activity_id: "activity-theory",
  });
  assert.equal(overflowRes.accepted, false);
  assert.equal(overflowRes.rejectedReason, "queue_capacity_exceeded");

  // Replay on reconnect
  const replay = queue.replayOnReconnect();
  assert.equal(replay.replayedCount, 100);
  assert.equal(replay.remainingQueueSize, 0);

  // Re-enqueuing an already-synced event_id is deduplicated
  const postSyncDup = queue.enqueue({
    event_id: "evt-valid-1",
    activity_id: "activity-theory",
  });
  assert.equal(postSyncDup.deduplicated, true);
  assert.equal(postSyncDup.queueSize, 0);

  // Purge on sign-out (@S87)
  queue.enqueue({
    event_id: "evt-after-sync-200",
    activity_id: "activity-example",
  });
  const purged = queue.purgeOnSignOut();
  assert.equal(purged.accountId, null);
  assert.equal(purged.size, 0);
  assert.equal(purged.syncedEventIds.length, 0);
});

test("T12 (@S18, @S19, @S51, @S59, @S64, @S70): DiagnosticSessionController and AdaptationDiffController enforce objective partitioning, waiver evidence refs, and concurrency guards", () => {
  const diagnosticFixture = loadSyntheticExample(
    "diagnostic-session.synthetic.json"
  );
  const proficiencyFixture = loadSyntheticExample("proficiency.synthetic.json");
  const proposalFixture = loadSyntheticExample(
    "adaptation-proposal.synthetic.json"
  );

  // 1. Diagnostic flow controller preserves demonstrated vs unassessed objectives (@S70)
  const activeDiag = createDiagnosticFlowController(
    {
      ...diagnosticFixture,
      state: "active",
      stop_reason: null,
      assessed_objective_version_ids: [],
      unassessed_objective_version_ids: [
        "objective-matrix-shapes-v1",
        "objective-matrix-calculus-v1",
      ],
    },
    proficiencyFixture
  );

  const attemptReq = activeDiag.submitDiagnosticAttempt({
    item_id: "diag-item-shapes-1",
    objective_version_id: "objective-matrix-shapes-v1",
    objective_id: "objective-matrix-shapes",
    topic_id: "topic-linear-algebra",
    attempt_id: "anchor-attempt-001",
    selected_choice_id: "choice-correct",
    demonstrated: true,
  });
  assert.equal(
    attemptReq.path,
    `/v1/diagnostics/${diagnosticFixture.diagnostic_session_id}/attempts`
  );

  const stopReq = activeDiag.stopEarly("learner_stopped");
  assert.equal(
    stopReq.path,
    `/v1/diagnostics/${diagnosticFixture.diagnostic_session_id}/stop`
  );
  assert.equal(stopReq.body.stop_reason, "learner_stopped");

  const diagState = activeDiag.getState();
  assert.equal(diagState.state, "stopped");
  assert.deepEqual(diagState.assessed_objective_version_ids, [
    "objective-matrix-shapes-v1",
  ]);
  assert.deepEqual(diagState.unassessed_objective_version_ids, [
    "objective-matrix-calculus-v1",
  ]);

  const calculusEvidence = diagState.objective_evidence.find(
    (e) => e.objective_version_id === "objective-matrix-calculus-v1"
  );
  assert.equal(calculusEvidence?.state, "unknown");

  const linearAlgebraCoverage = diagState.topic_coverage.find(
    (t) => t.topic_id === "topic-linear-algebra"
  );
  const matrixCalculusCoverage = diagState.topic_coverage.find(
    (t) => t.topic_id === "topic-matrix-calculus"
  );
  assert.equal(linearAlgebraCoverage?.coverage_state, "partial");
  assert.equal(matrixCalculusCoverage?.coverage_state, "unassessed");

  // 2. AdaptationDiffController categorizes changes, validates waiver evidence refs, and enforces Idempotency-Key + SHA256 + base revisions
  const diffController = createAdaptationDiffController(proposalFixture);
  const diffModel = diffController.getDiffModel();

  assert.equal(diffModel.proposal_id, "adaptation-synthetic-001");
  assert.equal(diffModel.preserved_math_depth, "formal");
  assert.equal(diffModel.buckets.waived.length, 1);
  assert.equal(diffModel.buckets.added.length, 1);
  assert.equal(diffModel.allWaiversHaveEvidence, true);
  assert.deepEqual(diffModel.waivers[0].qualifying_evidence_refs, [
    "anchor-attempt-001",
  ]);
  assert.deepEqual(diffModel.unassessed_objective_version_ids, [
    "objective-matrix-calculus-v1",
  ]);
  assert.equal(diffModel.impact.delta_minutes, 60);

  const acceptReq = diffController.buildAcceptAdaptationRequest({
    idempotencyKey: "idem-accept-adaptation-001",
  });
  assert.equal(
    acceptReq.headers["Idempotency-Key"],
    "idem-accept-adaptation-001"
  );
  assert.equal(
    acceptReq.body.expected_proposal_sha256,
    proposalFixture.proposal_sha256
  );
  assert.equal(
    acceptReq.body.base_syllabus_revision_id,
    "formal-plan-before"
  );
  assert.equal(
    acceptReq.body.base_schedule_revision_id,
    "formal-schedule-before"
  );

  // Stale base revision or mismatched sha256 is rejected before dispatch (@S59)
  assert.throws(() => {
    diffController.buildAcceptAdaptationRequest({
      idempotencyKey: "idem-stale-002",
      baseSyllabusRevisionId: "outdated-plan-revision",
    });
  }, /Stale syllabus base revision/);
});

test("T07A (@S28, @S29, @S38, @S68, @S80): ByokCustodyController wipes transient secret buffer, displays only masked metadata, enforces If-Match, and disables silent fallback", () => {
  const byokRequestFixture = loadSyntheticExample(
    "generation-request.byok.synthetic.json"
  );

  const byok = createByokCustodyController({
    initialMode: "byok",
    modelPolicyId: byokRequestFixture.inference.model_policy_id,
  });

  // Verify explicit server-custody and external-billing disclosures
  const initialState = byok.getState();
  assert.match(initialState.serverCustodyDisclosure, /Server custody disclosure/);
  assert.match(
    initialState.externalBillingDisclosure,
    /External billing disclosure/
  );
  assert.equal(initialState.allowHostedFallback, false);

  // Enter transient key -> never exposed in state -> wiped immediately upon createCredential
  const rawSecret = "sk-proj-super-secret-key-9876";
  const stateWithBuffer = byok.setTransientApiKey(rawSecret);
  assert.equal(stateWithBuffer.hasTransientKeyInBuffer, true);
  assert.equal(JSON.stringify(stateWithBuffer).includes(rawSecret), false);

  const createReq = byok.buildCreateCredentialRequest({
    provider_id: byokRequestFixture.inference.provider_id,
    label: "Primary OpenAI Key",
  });
  assert.equal(createReq.path, "/v1/me/credentials");
  assert.equal(createReq.body?.api_key, rawSecret);

  const stateAfterCreate = byok.getState();
  assert.equal(stateAfterCreate.hasTransientKeyInBuffer, false);
  assert.equal(stateAfterCreate.transientKeyLength, 0);
  assert.equal(stateAfterCreate.credentials.length, 1);
  assert.equal(stateAfterCreate.credentials[0].masked_suffix, "9876");
  assert.equal(stateAfterCreate.credentials[0].masked_hint, "••••9876");
  assert.equal(JSON.stringify(stateAfterCreate).includes(rawSecret), false);

  // Generation inference config matches generation-request.byok.synthetic.json invariants
  const inferenceConfig = byok.buildGenerationInferenceConfig();
  assert.equal(inferenceConfig.mode, "byok");
  assert.equal(inferenceConfig.allow_hosted_fallback, false);
  assert.equal(
    inferenceConfig.provider_id,
    byokRequestFixture.inference.provider_id
  );

  // Provider failure never silently falls back to hosted mode (@S28)
  const failedState = byok.handleByokProviderFailure({
    errorCode: "invalid_api_key",
    message: "Provider rejected key with 401 Unauthorized.",
  });
  assert.equal(failedState.mode, "byok");
  assert.equal(failedState.providerFailureBanner?.autoFallbackTriggered, false);

  // Rotate and revoke enforce If-Match
  const credRef = stateAfterCreate.credentials[0].credential_ref;
  byok.setTransientApiKey("sk-proj-rotated-secret-key-4321");
  const rotateReq = byok.buildRotateCredentialRequest({
    credential_ref: credRef,
    ifMatch: '"cred-v1"',
  });
  assert.equal(rotateReq.headers["If-Match"], '"cred-v1"');
  assert.equal(byok.getState().hasTransientKeyInBuffer, false);
  assert.equal(byok.getState().credentials[0].masked_suffix, "4321");

  const revokeReq = byok.buildRevokeCredentialRequest({
    credential_ref: credRef,
    ifMatch: '"cred-v2"',
    reason: "Key decommissioned",
  });
  assert.equal(revokeReq.headers["If-Match"], '"cred-v2"');
  assert.equal(byok.getState().credentials[0].status, "revoked");
  assert.throws(() => {
    byok.buildGenerationInferenceConfig();
  }, /BYOK mode requires an active credential/);
});

test("T08 (@S23, @S84, @S87): ReminderPreferenceController enforces If-Match and quiet hours, and evaluatePwaCacheEligibility rejects /me/*, /auth/*, secrets, and withdrawn publications", () => {
  const reminderController = createReminderPreferenceController(
    {
      enabled: true,
      channels: ["email", "web_push"],
      timezone: "America/New_York",
      quiet_hours: {
        start_local_time: "22:00",
        end_local_time: "07:00",
      },
      lead_time_minutes: 15,
      version: 1,
      etag: '"prefs-v1"',
    },
    [
      {
        occurrence_id: "rem-occ-1",
        session_id: "synthetic-session-1",
        scheduled_for: "2026-10-26T22:00:00Z",
        status: "scheduled",
      },
    ]
  );

  assert.match(
    reminderController.getState().bestEffortDeliveryDisclosure,
    /Best-effort delivery disclosure/
  );

  const updateReq = reminderController.buildUpdatePreferencesRequest(
    {
      lead_time_minutes: 30,
      quiet_hours: { start_local_time: "21:30", end_local_time: "07:30" },
    },
    { ifMatch: '"prefs-v1"' }
  );
  assert.equal(updateReq.method, "PUT");
  assert.equal(updateReq.path, "/v1/me/notification-preferences");
  assert.equal(updateReq.headers["If-Match"], '"prefs-v1"');

  const snoozeReq = reminderController.buildSnoozeReminderRequest({
    occurrence_id: "rem-occ-1",
    snooze_minutes: 30,
  });
  assert.equal(snoozeReq.method, "POST");
  assert.equal(snoozeReq.path, "/v1/me/reminders/rem-occ-1/snooze");
  assert.equal(
    reminderController.getState().occurrences[0].status,
    "snoozed"
  );

  // PWA Service Worker cache eligibility policy (@S84, @S87)
  const staticAsset = evaluatePwaCacheEligibility({
    path: "/assets/app-shell.js",
    method: "GET",
  });
  assert.equal(staticAsset.allowCache, true);
  assert.equal(staticAsset.cacheBucket, "static-shell-v1");

  const meRoute = evaluatePwaCacheEligibility({
    path: "/v1/me/credentials",
    method: "GET",
  });
  assert.equal(meRoute.allowCache, false);
  assert.equal(meRoute.reason, "authenticated_identity_or_credential_route");

  const authRoute = evaluatePwaCacheEligibility({
    path: "/v1/auth/session",
    method: "GET",
  });
  assert.equal(authRoute.allowCache, false);

  const withdrawnPublication = evaluatePwaCacheEligibility({
    path: "/v1/catalog/syllabi/withdrawn-1",
    method: "GET",
    publicationStatus: "withdrawn",
  });
  assert.equal(withdrawnPublication.allowCache, false);
  assert.equal(withdrawnPublication.reason, "publication_withdrawn");
});
