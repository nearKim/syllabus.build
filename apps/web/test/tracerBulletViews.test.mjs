import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRevisionActivationRequest,
  createGoalIntakeController,
  createTodayViewController,
} from "../src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");

const canonicalSyllabus = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/syllabus.synthetic.json"),
    "utf-8"
  )
);

const canonicalProficiency = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/proficiency.synthetic.json"),
    "utf-8"
  )
);

const canonicalSchedule = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/schedule.synthetic.json"),
    "utf-8"
  )
);

const canonicalProgressEvent = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/progress-event.synthetic.json"),
    "utf-8"
  )
);

const canonicalResource = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-syllabus-platform/examples/resource.synthetic.json"),
    "utf-8"
  )
);

test("createGoalIntakeController preserves independent math_depth + sequence_preference, enforces free_only vs owned subscriptions, validates feasibility warnings, and binds Idempotency-Key (@S02, @S08, @S47, @S69)", () => {
  const intake = createGoalIntakeController({
    goalTitle: "Master LLM Attention & Serving",
    goalSummary: "Derive scaled dot-product attention and build an inference server.",
    targetOutcomes: ["Derive attention gradients", "Benchmark KV-cache serving"],
    deadlinePolicy: "fixed_date",
    startDate: "2026-10-26",
    deadlineDate: "2026-11-09",
    targetDurationWeeks: 2,
    weeklyHoursCap: 2,
    requiredPointEffortMinutes: 360, // 6 hours needed vs 4 hours available (2 weeks * 2h/wk)
    budgetPolicy: "free_only",
    ownedSubscriptionIds: ["sub-acm-dl"],
    sequencePreference: "application_first",
    mathDepth: "formal",
    topicMathDepthOverrides: [{ topicId: "topic-serving", mathDepth: "intuition_first" }],
    experienceLevel: "beginner",
  });

  const state1 = intake.getState();
  assert.equal(state1.mathDepth, "formal");
  assert.equal(state1.canonicalMathDepth, "formal");
  assert.equal(state1.sequencePreference, "application_first");
  assert.equal(state1.experienceLevel, "beginner");
  assert.equal(state1.materialsBudgetMinorUnits, 0);
  assert.equal(state1.canonicalAccessPolicyMode, "free_or_owned");
  assert.deepEqual(state1.owned_subscription_ids, ["sub-acm-dl"]);

  // Changing sequence_preference never mutates math_depth or experienceLevel (@S47, @S69)
  intake.setSequencePreference("theory_first");
  assert.equal(intake.getState().sequencePreference, "theory_first");
  assert.equal(intake.getState().mathDepth, "formal");
  assert.equal(intake.getState().experienceLevel, "beginner");

  // Changing math_depth never mutates sequence_preference
  intake.setMathDepth("intuition_first");
  assert.equal(intake.getState().mathDepth, "intuition_first");
  assert.equal(intake.getState().canonicalMathDepth, "intuitive");
  assert.equal(intake.getState().sequencePreference, "theory_first");

  // Restore formal math_depth with application_first ordering
  intake.setMathDepth("formal", [{ topicId: "topic-serving", mathDepth: "intuition_first" }]);
  intake.setSequencePreference("application_first");

  // Feasibility warning when required point effort (360m) > available capacity (240m) (@S02)
  const validation = intake.validate();
  assert.equal(validation.valid, true);
  assert.ok(validation.feasibilityWarning);
  assert.equal(validation.feasibilityWarning.hasWarning, true);
  assert.equal(validation.feasibilityWarning.requiredMinutes, 360);
  assert.equal(validation.feasibilityWarning.availableMinutes, 240);
  assert.equal(validation.feasibilityWarning.shortfallMinutes, 120);
  assert.equal(validation.feasibilityWarning.silentlyReducesMathDepth, false);

  // Prohibits `no_deadline` simultaneously with a deadline date
  intake.update({
    deadlinePolicy: "no_deadline",
    deadlineDate: "2026-12-01",
  });
  const invalidNoDeadline = intake.validate();
  assert.equal(invalidNoDeadline.valid, false);
  assert.ok(invalidNoDeadline.errors.some((e) => e.includes("no_deadline")));
  assert.throws(() => intake.buildStartGenerationRequest("idem-gen-001"), /no_deadline/);

  // Fix deadline policy via setDeadlinePolicy("no_deadline") which clears deadlineDate to null
  intake.setDeadlinePolicy("no_deadline");
  assert.equal(intake.getState().deadlineDate, null);
  assert.equal(intake.validate().valid, true);

  // Missing Idempotency-Key throws via buildOperationHeaders("startGeneration", ...)
  assert.throws(() => intake.buildStartGenerationRequest(""), /Idempotency-Key/);

  const req = intake.buildStartGenerationRequest("idem-gen-001");
  assert.equal(req.operationId, "startGeneration");
  assert.equal(req.method, "POST");
  assert.equal(req.path, "/generations");
  assert.equal(req.headers["Idempotency-Key"], "idem-gen-001");
  assert.equal(req.body.constraints.deadline_policy, "no_deadline");
  assert.equal(req.body.constraints.target_end_date, null);
  assert.equal(req.body.constraints.sequence_preference, "application_first");
  assert.equal(req.body.instruction_preferences.math_depth, "formal");
  assert.deepEqual(req.body.instruction_preferences.topic_math_depth_overrides, [
    { topic_id: "topic-serving", math_depth: "intuitive" },
  ]);
  assert.equal(req.body.budgets.materials.max_minor_units, 0);
  assert.deepEqual(req.body.access_policy.owned_subscription_ids, ["sub-acm-dl"]);

  // Switching to capped_paid enables materials cap
  intake.setBudgetPolicy("capped_paid", { materialsBudgetMinorUnits: 4500 });
  const paidReq = intake.buildStartGenerationRequest({ idempotencyKey: "idem-gen-002" });
  assert.equal(paidReq.body.access_policy.mode, "allow_paid");
  assert.equal(paidReq.body.budgets.materials.max_minor_units, 4500);
});

test("buildRevisionActivationRequest requires explicit learner confirmation and If-Match precondition header (UI-002, @S24, @S53)", () => {
  // Rejects unconfirmed revision activation (never auto-activates unreviewed revisions)
  assert.throws(
    () =>
      buildRevisionActivationRequest({
        syllabusId: "synthetic-syllabus-1",
        revisionId: "synthetic-revision-2",
        ifMatch: '"rev-etag-1"',
        confirmedByLearner: false,
      }),
    /Explicit learner confirmation/
  );

  // Rejects missing If-Match header via buildOperationHeaders("activateSyllabusRevision", ...)
  assert.throws(
    () =>
      buildRevisionActivationRequest({
        syllabusId: "synthetic-syllabus-1",
        revisionId: "synthetic-revision-2",
        confirmedByLearner: true,
      }),
    /If-Match/
  );

  const actReq = buildRevisionActivationRequest({
    syllabusId: "synthetic-syllabus-1",
    revisionId: "synthetic-revision-2",
    ifMatch: '"rev-etag-1"',
    confirmedByLearner: true,
    acknowledgeScheduleChanges: true,
  });

  assert.equal(actReq.operationId, "activateSyllabusRevision");
  assert.equal(actReq.method, "PUT");
  assert.equal(actReq.path, "/syllabi/synthetic-syllabus-1/active-revision");
  assert.equal(actReq.headers["If-Match"], '"rev-etag-1"');
  assert.equal(actReq.body.revision_id, "synthetic-revision-2");
  assert.equal(actReq.confirmedByLearner, true);
  assert.equal(actReq.autoActivated, false);
});

test("createTodayViewController projects schedule.synthetic.json + syllabus.synthetic.json, enforces review separation (@S19), and deduplicates self_reported_completed events without inflating proficiency (@S17, @S23, @S24)", () => {
  const today = createTodayViewController({
    syllabus: canonicalSyllabus,
    schedule: canonicalSchedule,
    proficiency: canonicalProficiency,
    catalogResources: [canonicalResource],
  });

  const initial = today.getState();
  assert.equal(initial.syllabusId, "synthetic-syllabus-1");
  assert.equal(initial.scheduleId, "synthetic-schedule-1");
  assert.equal(initial.todayCards.length, 3);
  assert.equal(initial.reviewSeparationValid, true);

  // Session 1 has 35m duration and 3 activities (theory, example, coding) with provenance links
  const session1 = initial.todayCards[0];
  assert.equal(session1.sessionId, "synthetic-session-1");
  assert.equal(session1.durationMinutes, 35);
  assert.equal(session1.activityBreakdown.length, 3);
  assert.ok(session1.resourceProvenanceLinks.length > 0);
  assert.equal(
    session1.resourceProvenanceLinks[0].verifiedPublisher,
    "Synthetic Fixture Provider"
  );

  // Session 2 has initial quiz; Session 3 (2 days later) has spaced review (@S19)
  const session2 = initial.todayCards[1];
  const session3 = initial.todayCards[2];
  assert.equal(session2.reviewSeparation.hasQuiz, true);
  assert.equal(session2.reviewSeparation.hasSpacedReview, false);
  assert.equal(session2.reviewSeparation.valid, true);
  assert.equal(session3.reviewSeparation.hasQuiz, false);
  assert.equal(session3.reviewSeparation.hasSpacedReview, true);
  assert.equal(session3.reviewSeparation.valid, true);

  // Record self_reported_completed from progress-event.synthetic.json
  const receipt1 = today.recordSelfReportedCompletion(canonicalProgressEvent);
  assert.equal(receipt1.eventId, "synthetic-event-1");
  assert.equal(receipt1.activityId, "activity-theory");
  assert.equal(receipt1.deduplicated, false);
  assert.equal(receipt1.activityExecutionStatus, "self_reported_completed");
  assert.equal(receipt1.objectiveProficiencyStatus, "unassessed");
  assert.equal(receipt1.objectiveProficiencyDemonstrated, false);
  assert.equal(receipt1.totalStudyMinutes, 10);
  assert.equal(receipt1.selfReportedCompletedCount, 1);

  // Repeated click / network retry with the SAME event_id is deduplicated (@S24)
  const receiptDuplicate1 = today.recordSelfReportedCompletion(canonicalProgressEvent);
  const receiptDuplicate2 = today.recordSelfReportedCompletion({
    eventId: "synthetic-event-1",
    activityId: "activity-theory",
    timeSpentMinutes: 10,
  });

  assert.equal(receiptDuplicate1.deduplicated, true);
  assert.equal(receiptDuplicate2.deduplicated, true);
  assert.equal(receiptDuplicate2.totalStudyMinutes, 10);
  assert.equal(receiptDuplicate2.selfReportedCompletedCount, 1);

  const afterState = today.getState();
  assert.equal(afterState.totalStudyMinutes, 10);
  assert.equal(afterState.selfReportedCompletedCount, 1);
  assert.equal(afterState.recordedEventIds.length, 1);
  assert.equal(afterState.activityExecutionStates["activity-theory"], "self_reported_completed");
  assert.equal(afterState.objectiveProficiencyStates["objective-tokenization"], "unassessed");

  // Async/unavailable recovery banners (@S27, @S84) never simulate success
  const offlineBanner = today.setAsyncRecoveryState("offline_with_pending_progress");
  assert.equal(offlineBanner.role, "alert");
  assert.equal(offlineBanner.simulatedSuccessRendered, false);
  assert.ok(offlineBanner.actionableNextStep.includes("Retry"));
});
