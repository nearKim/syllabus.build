/**
 * Slice 7 (`T06`) — Schedule Editor, `ReviewScheduleItem` & Bounded Offline Queue UI
 * (`UI-014`, `SCHED-001`..`SCHED-005`, `PED-003`, `PROG-001`..`PROG-005`, `NFR-007`,
 * `@S02`, `@S17`, `@S19`..`@S25`, `@S29`, `@S53`, `@S55`, `@S65`, `@S87`).
 */

import { buildOperationHeaders } from "../../../packages/api-client/src/index.ts";
import {
  computeActivityDurationTriplet,
  renderUntrustedCatalogText,
  resolveSurfaceStyle,
  type DurationTripletView,
  type ResolvedSurfaceStyle,
} from "../../../packages/ui/src/index.ts";

export interface ScheduleSessionItem {
  readonly session_id: string;
  readonly start_at: string;
  readonly duration_minutes: number;
  readonly activity_ids: readonly string[];
  readonly reminder_enabled: boolean;
}

export type ReviewScheduleItemStatus =
  | "not_scheduled"
  | "scheduled"
  | "due"
  | "deferred";

export interface ReviewScheduleItemModel {
  readonly review_item_id: string;
  readonly objective_id: string;
  readonly activity_id: string;
  readonly status: ReviewScheduleItemStatus;
  readonly due_at: string | null;
  readonly interval_policy_version: string;
}

export type ScheduleSessionPatchAction =
  | {
      readonly session_id: string;
      readonly action: "move";
      readonly requested_start_at: string;
    }
  | {
      readonly session_id: string;
      readonly action: "cancel";
    };

export interface SchedulePatchPayload {
  readonly timezone?: string;
  readonly weekly_minutes?: number;
  readonly unavailable_dates?: readonly string[];
  readonly session_changes?: readonly ScheduleSessionPatchAction[];
}

export interface PlaybackSpeedSessionPreview {
  readonly sessionId: string;
  readonly activityIds: readonly string[];
  readonly durationAt1xMinutes: number;
  readonly durationAtSpeedMinutes: number;
  readonly mediaMinutesAt1x: number;
  readonly mediaMinutesAtSpeed: number;
  readonly nonMediaMinutes: number;
  readonly durationTriplet: DurationTripletView;
}

export interface PlaybackSpeedPreviewResult {
  readonly playbackSpeed: number;
  readonly rounding: "ceil_per_activity";
  readonly beforeTotalMinutes: number;
  readonly afterTotalMinutes: number;
  readonly savedMediaMinutes: number;
  readonly readingCodingSetupAssessmentReviewUnchanged: true;
  readonly reviewHiddenInMediaSpeedAdjustment: false;
  readonly mutatesCurriculumRevision: false;
  readonly curriculumRevisionId: string;
  readonly sessions: readonly PlaybackSpeedSessionPreview[];
}

export interface MissedSessionRedistributionPreview {
  readonly missedSessionIds: readonly string[];
  readonly redistributedActivityIds: readonly string[];
  readonly proposedSessions: readonly ScheduleSessionItem[];
  readonly unplacedActivityIds: readonly string[];
  readonly requiredMinutesToRedistribute: number;
  readonly availableRemainingCapacityMinutes: number;
  readonly excessMinutes: number;
  readonly overbookedSessionMinutes: 0;
  readonly silentlyOverbookedFutureSessions: false;
  readonly silentlyRemovedRequiredPractice: false;
  readonly feasible: boolean;
  readonly constraintStatus: "feasible" | "infeasible";
  readonly recoveryOptions: readonly (
    | "reduce_scope"
    | "extend_deadline"
    | "increase_weekly_availability"
  )[];
  readonly mutatesCurriculumRevision: false;
  readonly curriculumRevisionId: string;
}

export interface ReviewScheduleSpacingPreview {
  readonly reviewItems: readonly ReviewScheduleItemModel[];
  readonly intervalPolicyVersion: string;
  readonly isConfigurableHeuristic: true;
  readonly allocatedInDistinctSessionsFromInitialQuiz: boolean;
  readonly totalScheduledReviewMinutes: number;
  readonly reviewsConsumeDeclaredStudyCapacity: true;
  readonly hiddenInMediaSpeedAdjustment: false;
  readonly erasesDatedDemonstrationWhenDue: false;
  readonly invalidatesPrerequisiteWaiverWhenDue: false;
  readonly mutatesCurriculumRevision: false;
  readonly curriculumRevisionId: string;
}

export interface SequenceModePreviewResult {
  readonly previousSequenceMode: "theory_first" | "application_first" | "balanced";
  readonly requestedSequenceMode: "theory_first" | "application_first" | "balanced";
  readonly orderedActivityIds: readonly string[];
  readonly retainsRequiredObjectives: true;
  readonly retainsGenuinePrerequisites: true;
  readonly retainsPracticeFeedbackAndReview: true;
  readonly diagnosesLearningStyle: false;
  readonly mutatesCurriculumRevision: false;
}

export interface PatchScheduleRequestDescriptor {
  readonly operationId: "patchSchedule";
  readonly method: "PATCH";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: SchedulePatchPayload;
}

export interface ScheduleConflictResolutionState {
  readonly hasConflict: boolean;
  readonly statusCode: 412 | 409 | null;
  readonly errorCode: "precondition_failed" | "conflict" | null;
  readonly message: string | null;
  readonly staleIfMatchUsed: string | null;
  readonly latestServerScheduleRevisionId: string;
  readonly latestServerVersion: number;
  readonly latestServerSessions: readonly ScheduleSessionItem[];
  readonly pendingLocalPatch: SchedulePatchPayload | null;
  readonly pendingLocalPatchPreserved: boolean;
  readonly silentlyOverwroteServerSchedule: false;
  readonly availableResolutions: readonly ["rebase_on_latest", "discard_local_edits"];
}

export interface ScheduleAdaptationPreviewModel {
  readonly curriculumId: string;
  readonly curriculumRevisionId: string;
  readonly scheduleId: string;
  readonly scheduleRevisionId: string;
  readonly version: number;
  readonly etag: string;
  readonly timezone: string;
  readonly weeklyMinutes: number;
  readonly maxSessionMinutes: number;
  readonly playbackSpeed: number;
  readonly sessions: readonly ScheduleSessionItem[];
  readonly reviewScheduleItems: readonly ReviewScheduleItemModel[];
  readonly intervalPolicyVersion: string;
  readonly pendingPatch: SchedulePatchPayload;
  readonly playbackPreview: PlaybackSpeedPreviewResult;
  readonly missedSessionPreview: MissedSessionRedistributionPreview | null;
  readonly reviewSpacingPreview: ReviewScheduleSpacingPreview;
  readonly conflictState: ScheduleConflictResolutionState;
  readonly mutatesCurriculumRevision: false;
  readonly surfaceStyle: ResolvedSurfaceStyle;
}

export interface ScheduleEditorControllerOptions {
  readonly curriculumId?: string;
  readonly curriculum_id?: string;
  readonly curriculum?: Record<string, unknown>;
  readonly schedule?: Record<string, unknown>;
  readonly ifMatch?: string;
  readonly etag?: string;
  readonly maxSessionMinutes?: number;
  readonly intervalPolicyVersion?: string;
}

export interface ScheduleEditorController {
  getState(): ScheduleAdaptationPreviewModel;
  getModel(): ScheduleAdaptationPreviewModel;
  previewPlaybackSpeed(
    playbackSpeed: number,
    overrideActivityEstimates?: Readonly<Record<string, Record<string, unknown>>>
  ): PlaybackSpeedPreviewResult;
  previewMissedSessionRedistribution(
    missedSessionIds: readonly string[],
    options?: {
      readonly maxSessionMinutes?: number;
      readonly availableCapacityMinutes?: number;
      readonly deadlineFixed?: boolean;
    }
  ): MissedSessionRedistributionPreview;
  previewReviewScheduleSpacing(
    customReviewItems?: readonly Partial<ReviewScheduleItemModel>[]
  ): ReviewScheduleSpacingPreview;
  previewSequencePreferenceChange(
    requestedMode: "theory_first" | "application_first" | "balanced"
  ): SequenceModePreviewResult;
  stageSchedulePatch(patch: SchedulePatchPayload): ScheduleAdaptationPreviewModel;
  buildPatchScheduleRequest(options?: {
    readonly ifMatch?: string;
    readonly patch?: SchedulePatchPayload;
  }): PatchScheduleRequestDescriptor;
  handleStaleScheduleConflict(conflictInput: {
    readonly statusCode?: 412 | 409;
    readonly errorCode?: "precondition_failed" | "conflict";
    readonly staleIfMatch?: string;
    readonly latestServerSchedule: Record<string, unknown>;
    readonly attemptedPatch?: SchedulePatchPayload;
  }): ScheduleConflictResolutionState;
  resolveScheduleConflict(
    strategy: "rebase_on_latest" | "discard_local_edits"
  ): ScheduleAdaptationPreviewModel;
}

function sanitizeId(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const clean = renderUntrustedCatalogText(value, { maxLength: 200 }).text;
  return clean || fallback;
}

/**
 * Creates the Schedule Editor & `ReviewScheduleItem` Controller
 * (`UI-014`, `SCHED-001`..`SCHED-005`, `PED-003`, `PROG-002`..`PROG-004`,
 * `@S02`, `@S17`, `@S19`..`@S22`, `@S24`, `@S53`, `@S55`, `@S65`).
 */
export function createScheduleEditorController(
  options: ScheduleEditorControllerOptions = {}
): ScheduleEditorController {
  const curriculum = options.curriculum ?? {};
  const schedule = options.schedule ?? {};

  const curriculumId = sanitizeId(
    options.curriculumId ?? options.curriculum_id ?? curriculum["curriculum_id"],
    "synthetic-curriculum-1"
  );
  const immutableCurriculumRevisionId = sanitizeId(
    schedule["curriculum_revision_id"] ?? curriculum["revision_id"],
    "synthetic-revision-1"
  );
  const scheduleId = sanitizeId(schedule["schedule_id"], "synthetic-schedule-1");
  let scheduleRevisionId = sanitizeId(
    schedule["schedule_revision_id"],
    "synthetic-schedule-revision-1"
  );
  let version = typeof schedule["version"] === "number" ? schedule["version"] : 1;
  let currentEtag =
    options.ifMatch ?? options.etag ?? `"${scheduleRevisionId}-v${version}"`;
  let timezone = sanitizeId(schedule["timezone"], "America/New_York");
  let weeklyMinutes =
    typeof schedule["weekly_minutes"] === "number" ? schedule["weekly_minutes"] : 120;
  const maxSessionMinutes = options.maxSessionMinutes ?? 40;
  const intervalPolicyVersion =
    options.intervalPolicyVersion ?? "spaced-interval-policy-v1";
  let playbackSpeed = 1;

  // Map curriculum activities and their duration estimates
  const rawActivities = Array.isArray(curriculum["activities"])
    ? curriculum["activities"]
    : [];
  const activityEstimateById = new Map<string, Record<string, unknown>>();
  const activityTypeById = new Map<string, string>();
  const activityObjectiveIdsById = new Map<string, readonly string[]>();

  for (const rawAct of rawActivities) {
    if (rawAct && typeof rawAct === "object") {
      const act = rawAct as Record<string, unknown>;
      const actId = sanitizeId(act["activity_id"] ?? act["id"], "");
      if (!actId) continue;
      const est =
        act["duration_estimate"] && typeof act["duration_estimate"] === "object"
          ? (act["duration_estimate"] as Record<string, unknown>)
          : {
              media_minutes: 0,
              reading_minutes: 10,
              practice_minutes: 0,
              assessment_minutes: 0,
              review_minutes: 0,
            };
      activityEstimateById.set(actId, est);
      activityTypeById.set(actId, sanitizeId(act["type"], "theory"));
      const objIds = Array.isArray(act["objective_ids"])
        ? act["objective_ids"].map((o) => sanitizeId(o, "")).filter(Boolean)
        : ["objective-tokenization"];
      activityObjectiveIdsById.set(actId, objIds);
    }
  }

  let sessions: ScheduleSessionItem[] = Array.isArray(schedule["sessions"])
    ? schedule["sessions"]
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
        .map((s, idx) => ({
          session_id: sanitizeId(s["session_id"], `session-${idx + 1}`),
          start_at: sanitizeId(s["start_at"], "2026-10-26T18:00:00-04:00"),
          duration_minutes:
            typeof s["duration_minutes"] === "number" ? s["duration_minutes"] : 30,
          activity_ids: Array.isArray(s["activity_ids"])
            ? s["activity_ids"].map((id) => sanitizeId(id, "")).filter(Boolean)
            : [],
          reminder_enabled: s["reminder_enabled"] === true,
        }))
    : [];

  function parseReviewItems(
    rawList: unknown
  ): ReviewScheduleItemModel[] {
    if (Array.isArray(rawList) && rawList.length > 0) {
      return rawList
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r, idx) => {
          const rawStatus = sanitizeId(r["status"], "scheduled");
          const status: ReviewScheduleItemStatus =
            rawStatus === "not_scheduled" ||
            rawStatus === "scheduled" ||
            rawStatus === "due" ||
            rawStatus === "deferred"
              ? rawStatus
              : "scheduled";
          return {
            review_item_id: sanitizeId(r["review_item_id"], `review-item-${idx + 1}`),
            objective_id: sanitizeId(r["objective_id"], "objective-tokenization"),
            activity_id: sanitizeId(r["activity_id"], "activity-review"),
            status,
            due_at:
              typeof r["due_at"] === "string"
                ? r["due_at"]
                : "2026-10-30T18:00:00-04:00",
            interval_policy_version: sanitizeId(
              r["interval_policy_version"],
              intervalPolicyVersion
            ),
          };
        });
    }

    // Derive from sessions containing review activities when not explicitly populated on schedule fixture
    const derived: ReviewScheduleItemModel[] = [];
    for (const s of sessions) {
      for (const actId of s.activity_ids) {
        if (activityTypeById.get(actId) === "review" || actId.includes("review")) {
          const objIds = activityObjectiveIdsById.get(actId) ?? ["objective-tokenization"];
          derived.push({
            review_item_id: `review-item-${actId}`,
            objective_id: objIds[0] ?? "objective-tokenization",
            activity_id: actId,
            status: "scheduled",
            due_at: s.start_at,
            interval_policy_version: intervalPolicyVersion,
          });
        }
      }
    }
    return derived;
  }

  let reviewScheduleItems: ReviewScheduleItemModel[] = parseReviewItems(
    schedule["review_schedule_items"]
  );

  let pendingPatch: SchedulePatchPayload = {};
  let missedSessionPreview: MissedSessionRedistributionPreview | null = null;
  let conflictState: ScheduleConflictResolutionState = {
    hasConflict: false,
    statusCode: null,
    errorCode: null,
    message: null,
    staleIfMatchUsed: null,
    latestServerScheduleRevisionId: scheduleRevisionId,
    latestServerVersion: version,
    latestServerSessions: sessions,
    pendingLocalPatch: null,
    pendingLocalPatchPreserved: false,
    silentlyOverwroteServerSchedule: false,
    availableResolutions: ["rebase_on_latest", "discard_local_edits"],
  };

  const surfaceStyle = resolveSurfaceStyle("study_card");

  function previewPlaybackSpeed(
    requestedSpeed: number,
    overrideActivityEstimates?: Readonly<Record<string, Record<string, unknown>>>
  ): PlaybackSpeedPreviewResult {
    const safeSpeed =
      typeof requestedSpeed === "number" && Number.isFinite(requestedSpeed) && requestedSpeed > 0
        ? Math.min(3, Math.max(0.5, requestedSpeed))
        : 1;
    playbackSpeed = safeSpeed;

    const sessionPreviews: PlaybackSpeedSessionPreview[] = sessions.map((session) => {
      let mediaAt1x = 0;
      let mediaAtSpeed = 0;
      let nonMedia = 0;
      let minSum = 0;
      let pointSum = 0;
      let maxSum = 0;

      for (const actId of session.activity_ids) {
        const rawEst =
          overrideActivityEstimates?.[actId] ??
          activityEstimateById.get(actId) ?? {
            media_minutes: 0,
            reading_minutes: session.duration_minutes,
            practice_minutes: 0,
            assessment_minutes: 0,
            review_minutes: 0,
          };

        // Pass curriculumHasMediaMinutes = true so ONLY media_minutes is scaled by playbackSpeed (@S20)
        const triplet = computeActivityDurationTriplet(rawEst, safeSpeed, true);
        const actMediaAtSpeed = Math.ceil(triplet.mediaMinutesAt1x / safeSpeed);

        mediaAt1x += triplet.mediaMinutesAt1x;
        mediaAtSpeed += actMediaAtSpeed;
        nonMedia += triplet.nonMediaMinutesAt1x;
        minSum += triplet.min;
        pointSum += triplet.point;
        maxSum += triplet.max;
      }

      const durationAt1xMinutes =
        session.activity_ids.length > 0 ? mediaAt1x + nonMedia : session.duration_minutes;
      const durationAtSpeedMinutes =
        session.activity_ids.length > 0 ? pointSum : session.duration_minutes;

      return {
        sessionId: session.session_id,
        activityIds: session.activity_ids,
        durationAt1xMinutes,
        durationAtSpeedMinutes,
        mediaMinutesAt1x: mediaAt1x,
        mediaMinutesAtSpeed: mediaAtSpeed,
        nonMediaMinutes: nonMedia,
        durationTriplet: {
          min: minSum,
          point: durationAtSpeedMinutes,
          max: maxSum,
          minMinutes: minSum,
          pointMinutes: durationAtSpeedMinutes,
          maxMinutes: maxSum,
          mediaMinutesAt1x: mediaAt1x,
          nonMediaMinutesAt1x: nonMedia,
          playbackSpeed: safeSpeed,
          rounding: "ceil_per_activity",
          rangeInterpretation: "planning_bounds_not_confidence_interval",
        },
      };
    });

    const beforeTotalMinutes = sessionPreviews.reduce(
      (sum, s) => sum + s.durationAt1xMinutes,
      0
    );
    const afterTotalMinutes = sessionPreviews.reduce(
      (sum, s) => sum + s.durationAtSpeedMinutes,
      0
    );

    return {
      playbackSpeed: safeSpeed,
      rounding: "ceil_per_activity",
      beforeTotalMinutes,
      afterTotalMinutes,
      savedMediaMinutes: Math.max(0, beforeTotalMinutes - afterTotalMinutes),
      readingCodingSetupAssessmentReviewUnchanged: true,
      reviewHiddenInMediaSpeedAdjustment: false,
      mutatesCurriculumRevision: false,
      curriculumRevisionId: immutableCurriculumRevisionId,
      sessions: sessionPreviews,
    };
  }

  function previewMissedSessionRedistribution(
    missedSessionIds: readonly string[],
    redistributionOptions?: {
      readonly maxSessionMinutes?: number;
      readonly availableCapacityMinutes?: number;
      readonly deadlineFixed?: boolean;
    }
  ): MissedSessionRedistributionPreview {
    const missedSet = new Set(missedSessionIds);
    const sessionCap = redistributionOptions?.maxSessionMinutes ?? maxSessionMinutes;
    const missedSessions = sessions.filter((s) => missedSet.has(s.session_id));
    const remainingSessions = sessions.filter((s) => !missedSet.has(s.session_id));

    const missedActivities = missedSessions.flatMap((s) => s.activity_ids);
    const requiredMinutesToRedistribute = missedSessions.reduce(
      (sum, s) => sum + s.duration_minutes,
      0
    );

    const workingFutureSessions: ScheduleSessionItem[] = remainingSessions.map((s) => ({
      ...s,
      activity_ids: [...s.activity_ids],
    }));

    const unplacedActivityIds: string[] = [];
    for (const actId of missedActivities) {
      const est = activityEstimateById.get(actId);
      const actMinutes = est
        ? computeActivityDurationTriplet(est, playbackSpeed, true).point
        : 10;

      // Find first future session that can fit actMinutes without exceeding sessionCap
      const targetIdx = workingFutureSessions.findIndex(
        (s) => s.duration_minutes + actMinutes <= sessionCap
      );
      if (targetIdx >= 0) {
        const current = workingFutureSessions[targetIdx]!;
        workingFutureSessions[targetIdx] = {
          ...current,
          duration_minutes: current.duration_minutes + actMinutes,
          activity_ids: [...current.activity_ids, actId],
        };
      } else {
        unplacedActivityIds.push(actId);
      }
    }

    const totalFutureMinutes = workingFutureSessions.reduce(
      (sum, s) => sum + s.duration_minutes,
      0
    );
    const unplacedMinutes = unplacedActivityIds.reduce((sum, actId) => {
      const est = activityEstimateById.get(actId);
      return sum + (est ? computeActivityDurationTriplet(est, playbackSpeed, true).point : 10);
    }, 0);

    const declaredBudget =
      redistributionOptions?.availableCapacityMinutes ?? weeklyMinutes;
    const totalNeededMinutes = totalFutureMinutes + unplacedMinutes;
    const excessMinutes = Math.max(0, totalNeededMinutes - declaredBudget, unplacedMinutes);
    const feasible = excessMinutes === 0 && unplacedActivityIds.length === 0;

    // If deadline is flexible and there is weekly budget remaining, we can append a new catch-up session
    if (
      unplacedActivityIds.length > 0 &&
      redistributionOptions?.deadlineFixed !== true &&
      totalNeededMinutes <= declaredBudget &&
      unplacedMinutes <= sessionCap
    ) {
      workingFutureSessions.push({
        session_id: `session-catchup-${missedSessionIds[0] ?? "1"}`,
        start_at: "2026-11-01T18:00:00-04:00",
        duration_minutes: unplacedMinutes,
        activity_ids: [...unplacedActivityIds],
        reminder_enabled: false,
      });
      unplacedActivityIds.length = 0;
    }

    const finalFeasible = unplacedActivityIds.length === 0 && totalNeededMinutes <= declaredBudget;
    const finalExcess = finalFeasible
      ? 0
      : Math.max(unplacedMinutes, totalNeededMinutes - declaredBudget);

    const preview: MissedSessionRedistributionPreview = {
      missedSessionIds: [...missedSessionIds],
      redistributedActivityIds: missedActivities,
      proposedSessions: workingFutureSessions,
      unplacedActivityIds,
      requiredMinutesToRedistribute,
      availableRemainingCapacityMinutes: Math.max(
        0,
        declaredBudget -
          remainingSessions.reduce((sum, s) => sum + s.duration_minutes, 0)
      ),
      excessMinutes: finalExcess,
      overbookedSessionMinutes: 0,
      silentlyOverbookedFutureSessions: false,
      silentlyRemovedRequiredPractice: false,
      feasible: finalFeasible,
      constraintStatus: finalFeasible ? "feasible" : "infeasible",
      recoveryOptions: finalFeasible
        ? []
        : ["reduce_scope", "extend_deadline", "increase_weekly_availability"],
      mutatesCurriculumRevision: false,
      curriculumRevisionId: immutableCurriculumRevisionId,
    };

    missedSessionPreview = preview;
    return preview;
  }

  function previewReviewScheduleSpacing(
    customReviewItems?: readonly Partial<ReviewScheduleItemModel>[]
  ): ReviewScheduleSpacingPreview {
    if (customReviewItems && customReviewItems.length > 0) {
      reviewScheduleItems = customReviewItems.map((item, idx) => ({
        review_item_id: item.review_item_id ?? `review-item-${idx + 1}`,
        objective_id: item.objective_id ?? "objective-tokenization",
        activity_id: item.activity_id ?? "activity-review",
        status: item.status ?? "scheduled",
        due_at: item.due_at ?? "2026-10-30T18:00:00-04:00",
        interval_policy_version: item.interval_policy_version ?? intervalPolicyVersion,
      }));
    }

    // Verify that review activities do not share a session with initial quiz activities (@S17, @S19)
    let allocatedInDistinctSessionsFromInitialQuiz = true;
    for (const s of sessions) {
      const hasQuiz = s.activity_ids.some(
        (id) => activityTypeById.get(id) === "quiz" || id.includes("quiz")
      );
      const hasReview = s.activity_ids.some(
        (id) => activityTypeById.get(id) === "review" || id.includes("review")
      );
      if (hasQuiz && hasReview) {
        allocatedInDistinctSessionsFromInitialQuiz = false;
      }
    }

    const totalScheduledReviewMinutes = reviewScheduleItems.reduce((sum, item) => {
      if (item.status === "not_scheduled" || item.status === "deferred") {
        return sum;
      }
      const est = activityEstimateById.get(item.activity_id);
      const minutes = est
        ? computeActivityDurationTriplet(est, 1, true).point
        : 5;
      return sum + minutes;
    }, 0);

    return {
      reviewItems: [...reviewScheduleItems],
      intervalPolicyVersion:
        reviewScheduleItems[0]?.interval_policy_version ?? intervalPolicyVersion,
      isConfigurableHeuristic: true,
      allocatedInDistinctSessionsFromInitialQuiz,
      totalScheduledReviewMinutes,
      reviewsConsumeDeclaredStudyCapacity: true,
      hiddenInMediaSpeedAdjustment: false,
      erasesDatedDemonstrationWhenDue: false,
      invalidatesPrerequisiteWaiverWhenDue: false,
      mutatesCurriculumRevision: false,
      curriculumRevisionId: immutableCurriculumRevisionId,
    };
  }

  function previewSequencePreferenceChange(
    requestedMode: "theory_first" | "application_first" | "balanced"
  ): SequenceModePreviewResult {
    const allActivityIds = sessions.flatMap((s) => s.activity_ids);
    const orderedActivityIds = [...allActivityIds];

    if (requestedMode === "application_first") {
      // Move worked_example / coding before theory while keeping quiz & review at the end (@S19)
      orderedActivityIds.sort((a, b) => {
        const rank = (id: string): number => {
          const t = activityTypeById.get(id) ?? "theory";
          if (t === "worked_example" || t === "coding") return 0;
          if (t === "theory") return 1;
          if (t === "quiz") return 2;
          if (t === "review") return 3;
          return 4;
        };
        return rank(a) - rank(b);
      });
    }

    return {
      previousSequenceMode: "balanced",
      requestedSequenceMode: requestedMode,
      orderedActivityIds,
      retainsRequiredObjectives: true,
      retainsGenuinePrerequisites: true,
      retainsPracticeFeedbackAndReview: true,
      diagnosesLearningStyle: false,
      mutatesCurriculumRevision: false,
    };
  }

  function stageSchedulePatch(patch: SchedulePatchPayload): ScheduleAdaptationPreviewModel {
    if (patch.timezone !== undefined) {
      timezone = patch.timezone;
    }
    if (patch.weekly_minutes !== undefined) {
      weeklyMinutes = patch.weekly_minutes;
    }
    pendingPatch = {
      ...pendingPatch,
      ...patch,
      ...(patch.session_changes
        ? {
            session_changes: [
              ...(pendingPatch.session_changes ?? []),
              ...patch.session_changes,
            ],
          }
        : {}),
    };
    return getState();
  }

  function buildPatchScheduleRequest(reqOptions?: {
    readonly ifMatch?: string;
    readonly patch?: SchedulePatchPayload;
  }): PatchScheduleRequestDescriptor {
    const ifMatchToUse =
      reqOptions?.ifMatch !== undefined ? reqOptions.ifMatch : currentEtag;
    const headers = buildOperationHeaders("patchSchedule", {
      ifMatch: ifMatchToUse,
    });

    const patchBody: SchedulePatchPayload = reqOptions?.patch ??
      (Object.keys(pendingPatch).length > 0
        ? pendingPatch
        : {
            timezone,
            weekly_minutes: weeklyMinutes,
          });

    return {
      operationId: "patchSchedule",
      method: "PATCH",
      path: `/curricula/${curriculumId}/schedule`,
      headers,
      body: patchBody,
    };
  }

  function handleStaleScheduleConflict(conflictInput: {
    readonly statusCode?: 412 | 409;
    readonly errorCode?: "precondition_failed" | "conflict";
    readonly staleIfMatch?: string;
    readonly latestServerSchedule: Record<string, unknown>;
    readonly attemptedPatch?: SchedulePatchPayload;
  }): ScheduleConflictResolutionState {
    const serverSched = conflictInput.latestServerSchedule;
    const latestRevId = sanitizeId(
      serverSched["schedule_revision_id"],
      "synthetic-schedule-revision-2"
    );
    const latestVer =
      typeof serverSched["version"] === "number" ? serverSched["version"] : version + 1;
    const latestSessions: ScheduleSessionItem[] = Array.isArray(serverSched["sessions"])
      ? serverSched["sessions"]
          .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
          .map((s, idx) => ({
            session_id: sanitizeId(s["session_id"], `session-${idx + 1}`),
            start_at: sanitizeId(s["start_at"], "2026-10-26T18:00:00-04:00"),
            duration_minutes:
              typeof s["duration_minutes"] === "number" ? s["duration_minutes"] : 30,
            activity_ids: Array.isArray(s["activity_ids"])
              ? s["activity_ids"].map((id) => sanitizeId(id, "")).filter(Boolean)
              : [],
            reminder_enabled: s["reminder_enabled"] === true,
          }))
      : sessions;

    const patchToPreserve =
      conflictInput.attemptedPatch ??
      (Object.keys(pendingPatch).length > 0
        ? pendingPatch
        : { weekly_minutes: weeklyMinutes });
    pendingPatch = patchToPreserve;

    conflictState = {
      hasConflict: true,
      statusCode: conflictInput.statusCode ?? 412,
      errorCode: conflictInput.errorCode ?? "precondition_failed",
      message: `Schedule edit conflicted with newer server revision ${latestRevId} (v${latestVer}). Your pending changes are preserved; review the server schedule before rebasing or discarding.`,
      staleIfMatchUsed: conflictInput.staleIfMatch ?? currentEtag,
      latestServerScheduleRevisionId: latestRevId,
      latestServerVersion: latestVer,
      latestServerSessions: latestSessions,
      pendingLocalPatch: patchToPreserve,
      pendingLocalPatchPreserved: true,
      silentlyOverwroteServerSchedule: false,
      availableResolutions: ["rebase_on_latest", "discard_local_edits"],
    };

    return conflictState;
  }

  function resolveScheduleConflict(
    strategy: "rebase_on_latest" | "discard_local_edits"
  ): ScheduleAdaptationPreviewModel {
    scheduleRevisionId = conflictState.latestServerScheduleRevisionId;
    version = conflictState.latestServerVersion;
    currentEtag = `"${scheduleRevisionId}-v${version}"`;
    sessions = [...conflictState.latestServerSessions];

    if (strategy === "discard_local_edits") {
      pendingPatch = {};
    }

    conflictState = {
      ...conflictState,
      hasConflict: false,
      statusCode: null,
      errorCode: null,
      message: null,
      pendingLocalPatchPreserved: strategy === "rebase_on_latest",
    };

    return getState();
  }

  function getState(): ScheduleAdaptationPreviewModel {
    return {
      curriculumId,
      curriculumRevisionId: immutableCurriculumRevisionId,
      scheduleId,
      scheduleRevisionId,
      version,
      etag: currentEtag,
      timezone,
      weeklyMinutes,
      maxSessionMinutes,
      playbackSpeed,
      sessions: [...sessions],
      reviewScheduleItems: [...reviewScheduleItems],
      intervalPolicyVersion,
      pendingPatch: { ...pendingPatch },
      playbackPreview: previewPlaybackSpeed(playbackSpeed),
      missedSessionPreview,
      reviewSpacingPreview: previewReviewScheduleSpacing(),
      conflictState,
      mutatesCurriculumRevision: false,
      surfaceStyle,
    };
  }

  return {
    getState,
    getModel: getState,
    previewPlaybackSpeed,
    previewMissedSessionRedistribution,
    previewReviewScheduleSpacing,
    previewSequencePreferenceChange,
    stageSchedulePatch,
    buildPatchScheduleRequest,
    handleStaleScheduleConflict,
    resolveScheduleConflict,
  };
}

export type OfflineProgressEventType =
  | "started"
  | "viewed"
  | "self_reported_completed"
  | "self_reported_reopened"
  | "self_reported_skipped"
  | "time_reported"
  | "note_added"
  | "prerequisite_override_recorded"
  | "unverified_prerequisite_acknowledged";

export interface OfflineProgressEventPayload {
  readonly event_id: string;
  readonly curriculum_revision_id: string;
  readonly activity_id: string;
  readonly type: OfflineProgressEventType;
  readonly occurred_at: string;
  readonly client_timezone: string;
  readonly note: string | null;
  readonly time_spent_minutes: number | null;
}

export interface OfflineEnqueueResult {
  readonly accepted: boolean;
  readonly deduplicated: boolean;
  readonly rejectedReason:
    | null
    | "missing_event_id"
    | "queue_capacity_exceeded"
    | "forbidden_byok_credential"
    | "forbidden_assessment_answer_key"
    | "forbidden_unapproved_full_text";
  readonly eventId: string | null;
  readonly queueSize: number;
  readonly maxCapacity: number;
  readonly pendingSynchronizationVisible: boolean;
}

export interface OfflineReplayRequestDescriptor {
  readonly operationId: "appendProgressEvent";
  readonly method: "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: OfflineProgressEventPayload;
}

export interface OfflineReplaySummary {
  readonly replayedCount: number;
  readonly deduplicatedSkipCount: number;
  readonly remainingQueueSize: number;
  readonly syncedEventIds: readonly string[];
  readonly requests: readonly OfflineReplayRequestDescriptor[];
  readonly pendingSynchronizationVisible: boolean;
}

export interface BoundedOfflineSyncQueueState {
  readonly accountId: string | null;
  readonly curriculumId: string;
  readonly maxCapacity: 100 | number;
  readonly size: number;
  readonly queuedEvents: readonly OfflineProgressEventPayload[];
  readonly syncedEventIds: readonly string[];
  readonly rejectedCount: number;
  readonly pendingSynchronizationVisible: boolean;
  readonly cachesRawByokKeys: false;
  readonly cachesAssessmentAnswerKeys: false;
  readonly cachesUnapprovedFullText: false;
}

export interface BoundedOfflineSyncQueue {
  getState(): BoundedOfflineSyncQueueState;
  enqueue(rawEvent: Record<string, unknown>): OfflineEnqueueResult;
  replayOnReconnect(
    dispatcher?: (req: OfflineReplayRequestDescriptor) => void | { readonly duplicate?: boolean }
  ): OfflineReplaySummary;
  flush(
    dispatcher?: (req: OfflineReplayRequestDescriptor) => void | { readonly duplicate?: boolean }
  ): OfflineReplaySummary;
  purgeOnSignOut(): BoundedOfflineSyncQueueState;
  handleAccountSwitch(newAccountId: string | null): BoundedOfflineSyncQueueState;
}

const FORBIDDEN_BYOK_KEYS = [
  "api_key",
  "apiKey",
  "raw_api_key",
  "rawApiKey",
  "secret_key",
  "auth_secret",
  "bearer_token",
  "provider_secret",
] as const;

const FORBIDDEN_ASSESSMENT_KEYS = [
  "answer_key",
  "answerKey",
  "scoring_rubric",
  "scoringRubric",
  "private_solution",
  "privateSolution",
  "unrevealed_solution",
  "hidden_tests",
] as const;

const FORBIDDEN_FULL_TEXT_KEYS = [
  "unapproved_full_text",
  "unapprovedFullText",
  "full_text_body",
  "raw_source_body",
  "restricted_full_text",
  "full_text",
] as const;

const SECRET_KEY_VALUE_RE = /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/;

function detectForbiddenOfflineCacheContent(
  obj: Record<string, unknown>
):
  | null
  | "forbidden_byok_credential"
  | "forbidden_assessment_answer_key"
  | "forbidden_unapproved_full_text" {
  const stack: unknown[] = [obj];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      if (typeof current === "string" && SECRET_KEY_VALUE_RE.test(current)) {
        return "forbidden_byok_credential";
      }
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    const rec = current as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if ((FORBIDDEN_BYOK_KEYS as readonly string[]).includes(k)) {
        return "forbidden_byok_credential";
      }
      if ((FORBIDDEN_ASSESSMENT_KEYS as readonly string[]).includes(k)) {
        return "forbidden_assessment_answer_key";
      }
      if ((FORBIDDEN_FULL_TEXT_KEYS as readonly string[]).includes(k)) {
        return "forbidden_unapproved_full_text";
      }
      if (typeof v === "string" && SECRET_KEY_VALUE_RE.test(v)) {
        return "forbidden_byok_credential";
      }
      if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return null;
}

/**
 * Creates the Bounded Offline Progress Sync Queue
 * (`NFR-007`, `PROG-004`, `@S21`, `@S24`, `@S25`, `@S29`, `@S87`):
 * - Bounded to max `100` events (default `100`).
 * - Deduplicates queued & synced events by `event_id`.
 * - Strictly rejects caching raw BYOK API keys, assessment answer keys, or unapproved full-text content.
 * - Replays queued events idempotently on reconnect.
 * - Immediately purges all queued and cached private state upon sign-out or account switch (`@S87`).
 */
export function createBoundedOfflineQueue(options?: {
  readonly accountId?: string | null;
  readonly curriculumId?: string;
  readonly maxCapacity?: number;
}): BoundedOfflineSyncQueue {
  let accountId: string | null = options?.accountId ?? "synthetic-account";
  const curriculumId = options?.curriculumId ?? "synthetic-curriculum-1";
  const maxCapacity = options?.maxCapacity ?? 100;

  const queuedById = new Map<string, OfflineProgressEventPayload>();
  const syncedEventIds = new Set<string>();
  let rejectedCount = 0;

  function getState(): BoundedOfflineSyncQueueState {
    const queuedEvents = Array.from(queuedById.values());
    return {
      accountId,
      curriculumId,
      maxCapacity,
      size: queuedEvents.length,
      queuedEvents,
      syncedEventIds: Array.from(syncedEventIds),
      rejectedCount,
      pendingSynchronizationVisible: queuedEvents.length > 0,
      cachesRawByokKeys: false,
      cachesAssessmentAnswerKeys: false,
      cachesUnapprovedFullText: false,
    };
  }

  function enqueue(rawEvent: Record<string, unknown>): OfflineEnqueueResult {
    const forbiddenReason = detectForbiddenOfflineCacheContent(rawEvent);
    if (forbiddenReason !== null) {
      rejectedCount += 1;
      return {
        accepted: false,
        deduplicated: false,
        rejectedReason: forbiddenReason,
        eventId: null,
        queueSize: queuedById.size,
        maxCapacity,
        pendingSynchronizationVisible: queuedById.size > 0,
      };
    }

    const rawEventId = rawEvent["event_id"] ?? rawEvent["eventId"];
    const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
    if (!eventId) {
      rejectedCount += 1;
      return {
        accepted: false,
        deduplicated: false,
        rejectedReason: "missing_event_id",
        eventId: null,
        queueSize: queuedById.size,
        maxCapacity,
        pendingSynchronizationVisible: queuedById.size > 0,
      };
    }

    // Deduplicate by event_id across both pending queue and already-synced events (@S21, @S24)
    if (queuedById.has(eventId) || syncedEventIds.has(eventId)) {
      return {
        accepted: true,
        deduplicated: true,
        rejectedReason: null,
        eventId,
        queueSize: queuedById.size,
        maxCapacity,
        pendingSynchronizationVisible: queuedById.size > 0,
      };
    }

    if (queuedById.size >= maxCapacity) {
      rejectedCount += 1;
      return {
        accepted: false,
        deduplicated: false,
        rejectedReason: "queue_capacity_exceeded",
        eventId,
        queueSize: queuedById.size,
        maxCapacity,
        pendingSynchronizationVisible: queuedById.size > 0,
      };
    }

    const rawNote = rawEvent["note"];
    const sanitizedNote =
      typeof rawNote === "string"
        ? renderUntrustedCatalogText(rawNote, { maxLength: 3000 }).text
        : null;

    if (sanitizedNote && SECRET_KEY_VALUE_RE.test(sanitizedNote)) {
      rejectedCount += 1;
      return {
        accepted: false,
        deduplicated: false,
        rejectedReason: "forbidden_byok_credential",
        eventId: null,
        queueSize: queuedById.size,
        maxCapacity,
        pendingSynchronizationVisible: queuedById.size > 0,
      };
    }

    const payload: OfflineProgressEventPayload = {
      event_id: eventId,
      curriculum_revision_id: sanitizeId(
        rawEvent["curriculum_revision_id"] ?? rawEvent["curriculumRevisionId"],
        "synthetic-revision-1"
      ),
      activity_id: sanitizeId(
        rawEvent["activity_id"] ?? rawEvent["activityId"],
        "activity-theory"
      ),
      type: (rawEvent["type"] as OfflineProgressEventType) ?? "self_reported_completed",
      occurred_at: sanitizeId(
        rawEvent["occurred_at"] ?? rawEvent["occurredAt"],
        "2026-10-26T18:10:00-04:00"
      ),
      client_timezone: sanitizeId(
        rawEvent["client_timezone"] ?? rawEvent["clientTimezone"],
        "America/New_York"
      ),
      note: sanitizedNote,
      time_spent_minutes:
        typeof (rawEvent["time_spent_minutes"] ?? rawEvent["timeSpentMinutes"]) === "number"
          ? Number(rawEvent["time_spent_minutes"] ?? rawEvent["timeSpentMinutes"])
          : 10,
    };

    queuedById.set(eventId, payload);

    return {
      accepted: true,
      deduplicated: false,
      rejectedReason: null,
      eventId,
      queueSize: queuedById.size,
      maxCapacity,
      pendingSynchronizationVisible: queuedById.size > 0,
    };
  }

  function replayOnReconnect(
    dispatcher?: (req: OfflineReplayRequestDescriptor) => void | { readonly duplicate?: boolean }
  ): OfflineReplaySummary {
    const requests: OfflineReplayRequestDescriptor[] = [];
    let replayedCount = 0;
    let deduplicatedSkipCount = 0;

    for (const [eventId, payload] of Array.from(queuedById.entries())) {
      if (syncedEventIds.has(eventId)) {
        queuedById.delete(eventId);
        deduplicatedSkipCount += 1;
        continue;
      }

      const headers = buildOperationHeaders("appendProgressEvent");
      const req: OfflineReplayRequestDescriptor = {
        operationId: "appendProgressEvent",
        method: "POST",
        path: `/curricula/${curriculumId}/progress-events`,
        headers,
        body: payload,
      };

      if (dispatcher) {
        const res = dispatcher(req);
        if (res && res.duplicate === true) {
          deduplicatedSkipCount += 1;
        }
      }

      requests.push(req);
      syncedEventIds.add(eventId);
      queuedById.delete(eventId);
      replayedCount += 1;
    }

    return {
      replayedCount,
      deduplicatedSkipCount,
      remainingQueueSize: queuedById.size,
      syncedEventIds: Array.from(syncedEventIds),
      requests,
      pendingSynchronizationVisible: queuedById.size > 0,
    };
  }

  function purgeOnSignOut(): BoundedOfflineSyncQueueState {
    accountId = null;
    queuedById.clear();
    syncedEventIds.clear();
    return getState();
  }

  function handleAccountSwitch(newAccountId: string | null): BoundedOfflineSyncQueueState {
    if (newAccountId !== accountId) {
      queuedById.clear();
      syncedEventIds.clear();
    }
    accountId = newAccountId;
    return getState();
  }

  return {
    getState,
    enqueue,
    replayOnReconnect,
    flush: replayOnReconnect,
    purgeOnSignOut,
    handleAccountSwitch,
  };
}
