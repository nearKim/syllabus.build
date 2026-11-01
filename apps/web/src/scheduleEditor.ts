import { buildOperationHeaders } from "@syllabus/api-client";
import { computeActivityDurationTriplet, resolveSurfaceStyle } from "@syllabus/ui";
import { clamp, sanitizeId } from "./shared.ts";

export interface ScheduleSessionItem {
  readonly session_id: string; readonly start_at: string; readonly duration_minutes: number;
  readonly activity_ids: readonly string[]; readonly reminder_enabled: boolean;
}

export type ReviewScheduleItemStatus = "not_scheduled" | "scheduled" | "due" | "deferred";

export interface ReviewScheduleItemModel {
  readonly review_item_id: string; readonly objective_id: string; readonly activity_id: string;
  readonly status: ReviewScheduleItemStatus; readonly due_at: string | null; readonly interval_policy_version: string;
}

export type ScheduleSessionPatchAction =
  | { readonly session_id: string; readonly action: "move"; readonly requested_start_at: string }
  | { readonly session_id: string; readonly action: "cancel" };

export interface SchedulePatchPayload {
  readonly timezone?: string; readonly weekly_minutes?: number;
  readonly unavailable_dates?: readonly string[]; readonly session_changes?: readonly ScheduleSessionPatchAction[];
}

export interface ScheduleConflictResolutionState {
  readonly hasConflict: boolean; readonly statusCode: 412 | 409 | null;
  readonly errorCode: "precondition_failed" | "conflict" | null; readonly message: string | null;
  readonly staleIfMatchUsed: string | null; readonly latestServerScheduleRevisionId: string;
  readonly latestServerVersion: number; readonly latestServerSessions: readonly ScheduleSessionItem[];
  readonly pendingLocalPatch: SchedulePatchPayload | null; readonly pendingLocalPatchPreserved: boolean;
  readonly silentlyOverwroteServerSchedule: false;
  readonly availableResolutions: readonly ["rebase_on_latest", "discard_local_edits"];
}

export interface ScheduleEditorControllerOptions {
  readonly syllabusId?: string; readonly syllabus_id?: string;
  readonly syllabus?: Record<string, unknown>; readonly schedule?: Record<string, unknown>;
  readonly ifMatch?: string; readonly etag?: string;
  readonly maxSessionMinutes?: number; readonly intervalPolicyVersion?: string;
}

function parseScheduleSessions(rawSessions: unknown, fallback: readonly ScheduleSessionItem[] = []): ScheduleSessionItem[] {
  if (!Array.isArray(rawSessions)) return [...fallback];
  return rawSessions
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
    .map((s, idx) => ({
      session_id: sanitizeId(s["session_id"], `session-${idx + 1}`),
      start_at: sanitizeId(s["start_at"], "2026-10-26T18:00:00-04:00"),
      duration_minutes: typeof s["duration_minutes"] === "number" ? s["duration_minutes"] : 30,
      activity_ids: Array.isArray(s["activity_ids"]) ? s["activity_ids"].map((id) => sanitizeId(id, "")).filter(Boolean) : [],
      reminder_enabled: s["reminder_enabled"] === true,
    }));
}

export function createScheduleEditorController(options: ScheduleEditorControllerOptions = {}) {
  const syllabus = options.syllabus ?? {};
  const schedule = options.schedule ?? {};
  const syllabusId = sanitizeId(options.syllabusId ?? options.syllabus_id ?? syllabus["syllabus_id"], "synthetic-syllabus-1");
  const immutableSyllabusRevisionId = sanitizeId(schedule["syllabus_revision_id"] ?? syllabus["revision_id"], "synthetic-revision-1");
  const scheduleId = sanitizeId(schedule["schedule_id"], "synthetic-schedule-1");
  let scheduleRevisionId = sanitizeId(schedule["schedule_revision_id"], "synthetic-schedule-revision-1");
  let version = typeof schedule["version"] === "number" ? schedule["version"] : 1;
  let currentEtag = options.ifMatch ?? options.etag ?? `"${scheduleRevisionId}-v${version}"`;
  let timezone = sanitizeId(schedule["timezone"], "America/New_York");
  let weeklyMinutes = typeof schedule["weekly_minutes"] === "number" ? schedule["weekly_minutes"] : 120;
  const maxSessionMinutes = options.maxSessionMinutes ?? 40;
  const intervalPolicyVersion = options.intervalPolicyVersion ?? "spaced-interval-policy-v1";
  let playbackSpeed = 1;

  const activityEstimateById = new Map<string, Record<string, unknown>>();
  const activityTypeById = new Map<string, string>();
  const activityObjectiveIdsById = new Map<string, readonly string[]>();

  for (const rawAct of Array.isArray(syllabus["activities"]) ? syllabus["activities"] : []) {
    if (rawAct && typeof rawAct === "object") {
      const act = rawAct as Record<string, unknown>;
      const actId = sanitizeId(act["activity_id"] ?? act["id"], "");
      if (!actId) continue;
      activityEstimateById.set(
        actId,
        act["duration_estimate"] && typeof act["duration_estimate"] === "object"
          ? (act["duration_estimate"] as Record<string, unknown>)
          : { media_minutes: 0, reading_minutes: 10, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0 },
      );
      activityTypeById.set(actId, sanitizeId(act["type"], "theory"));
      activityObjectiveIdsById.set(
        actId,
        Array.isArray(act["objective_ids"]) ? act["objective_ids"].map((o) => sanitizeId(o, "")).filter(Boolean) : ["objective-tokenization"],
      );
    }
  }

  let sessions = parseScheduleSessions(schedule["sessions"]);

  const parseReviewItems = (rawList: unknown): ReviewScheduleItemModel[] => {
    if (Array.isArray(rawList) && rawList.length > 0) {
      return rawList
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r, idx) => {
          const rawStatus = sanitizeId(r["status"], "scheduled");
          const status: ReviewScheduleItemStatus =
            rawStatus === "not_scheduled" || rawStatus === "scheduled" || rawStatus === "due" || rawStatus === "deferred"
              ? rawStatus : "scheduled";
          return {
            review_item_id: sanitizeId(r["review_item_id"], `review-item-${idx + 1}`),
            objective_id: sanitizeId(r["objective_id"], "objective-tokenization"),
            activity_id: sanitizeId(r["activity_id"], "activity-review"),
            status,
            due_at: typeof r["due_at"] === "string" ? r["due_at"] : "2026-10-30T18:00:00-04:00",
            interval_policy_version: sanitizeId(r["interval_policy_version"], intervalPolicyVersion),
          };
        });
    }
    const derived: ReviewScheduleItemModel[] = [];
    for (const s of sessions) {
      for (const actId of s.activity_ids) {
        if (activityTypeById.get(actId) === "review" || actId.includes("review")) {
          const objIds = activityObjectiveIdsById.get(actId) ?? ["objective-tokenization"];
          derived.push({
            review_item_id: `review-item-${actId}`,
            objective_id: objIds[0] ?? "objective-tokenization",
            activity_id: actId, status: "scheduled", due_at: s.start_at, interval_policy_version: intervalPolicyVersion,
          });
        }
      }
    }
    return derived;
  };

  let reviewScheduleItems = parseReviewItems(schedule["review_schedule_items"]);
  let pendingPatch: SchedulePatchPayload = {};
  let missedSessionPreview: ReturnType<typeof previewMissedSessionRedistribution> | null = null;
  let conflictState: ScheduleConflictResolutionState = {
    hasConflict: false, statusCode: null, errorCode: null, message: null, staleIfMatchUsed: null,
    latestServerScheduleRevisionId: scheduleRevisionId, latestServerVersion: version, latestServerSessions: sessions,
    pendingLocalPatch: null, pendingLocalPatchPreserved: false, silentlyOverwroteServerSchedule: false,
    availableResolutions: ["rebase_on_latest", "discard_local_edits"],
  };
  const surfaceStyle = resolveSurfaceStyle("study_card");

  function previewPlaybackSpeed(
    requestedSpeed: number,
    overrideActivityEstimates?: Readonly<Record<string, Record<string, unknown>>>,
  ) {
    const safeSpeed =
      typeof requestedSpeed === "number" && Number.isFinite(requestedSpeed) && requestedSpeed > 0
        ? clamp(requestedSpeed, 0.5, 3) : 1;
    playbackSpeed = safeSpeed;

    const sessionPreviews = sessions.map((session) => {
      let mediaAt1x = 0, mediaAtSpeed = 0, nonMedia = 0, minSum = 0, pointSum = 0, maxSum = 0;
      for (const actId of session.activity_ids) {
        const rawEst = overrideActivityEstimates?.[actId] ?? activityEstimateById.get(actId) ?? {
          media_minutes: 0, reading_minutes: session.duration_minutes, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0,
        };
        const triplet = computeActivityDurationTriplet(rawEst, safeSpeed, true);
        mediaAt1x += triplet.mediaMinutesAt1x;
        mediaAtSpeed += Math.ceil(triplet.mediaMinutesAt1x / safeSpeed);
        nonMedia += triplet.nonMediaMinutesAt1x;
        minSum += triplet.min; pointSum += triplet.point; maxSum += triplet.max;
      }
      const durationAt1xMinutes = session.activity_ids.length > 0 ? mediaAt1x + nonMedia : session.duration_minutes;
      const durationAtSpeedMinutes = session.activity_ids.length > 0 ? pointSum : session.duration_minutes;
      return {
        sessionId: session.session_id, activityIds: session.activity_ids,
        durationAt1xMinutes, durationAtSpeedMinutes,
        mediaMinutesAt1x: mediaAt1x, mediaMinutesAtSpeed: mediaAtSpeed, nonMediaMinutes: nonMedia,
        durationTriplet: {
          min: minSum, point: durationAtSpeedMinutes, max: maxSum,
          minMinutes: minSum, pointMinutes: durationAtSpeedMinutes, maxMinutes: maxSum,
          mediaMinutesAt1x: mediaAt1x, nonMediaMinutesAt1x: nonMedia, playbackSpeed: safeSpeed,
          rounding: "ceil_per_activity" as const,
          rangeInterpretation: "planning_bounds_not_confidence_interval" as const,
        },
      };
    });

    const beforeTotalMinutes = sessionPreviews.reduce((sum, s) => sum + s.durationAt1xMinutes, 0);
    const afterTotalMinutes = sessionPreviews.reduce((sum, s) => sum + s.durationAtSpeedMinutes, 0);

    return {
      playbackSpeed: safeSpeed, rounding: "ceil_per_activity" as const,
      beforeTotalMinutes, afterTotalMinutes, savedMediaMinutes: Math.max(0, beforeTotalMinutes - afterTotalMinutes),
      readingCodingSetupAssessmentReviewUnchanged: true as const,
      reviewHiddenInMediaSpeedAdjustment: false as const,
      mutatesSyllabusRevision: false as const,
      syllabusRevisionId: immutableSyllabusRevisionId,
      sessions: sessionPreviews,
    };
  }

  function previewMissedSessionRedistribution(
    missedSessionIds: readonly string[],
    redistributionOptions?: {
      readonly maxSessionMinutes?: number; readonly availableCapacityMinutes?: number; readonly deadlineFixed?: boolean;
    },
  ) {
    const missedSet = new Set(missedSessionIds);
    const sessionCap = redistributionOptions?.maxSessionMinutes ?? maxSessionMinutes;
    const missedSessions = sessions.filter((s) => missedSet.has(s.session_id));
    const remainingSessions = sessions.filter((s) => !missedSet.has(s.session_id));
    const missedActivities = missedSessions.flatMap((s) => s.activity_ids);
    const requiredMinutesToRedistribute = missedSessions.reduce((sum, s) => sum + s.duration_minutes, 0);
    const workingFutureSessions: ScheduleSessionItem[] = remainingSessions.map((s) => ({ ...s, activity_ids: [...s.activity_ids] }));
    const activityMinutes = (actId: string) => {
      const est = activityEstimateById.get(actId);
      return est ? computeActivityDurationTriplet(est, playbackSpeed, true).point : 10;
    };

    const unplacedActivityIds: string[] = [];
    for (const actId of missedActivities) {
      const actMinutes = activityMinutes(actId);
      const targetIdx = workingFutureSessions.findIndex((s) => s.duration_minutes + actMinutes <= sessionCap);
      if (targetIdx >= 0) {
        const current = workingFutureSessions[targetIdx]!;
        workingFutureSessions[targetIdx] = {
          ...current, duration_minutes: current.duration_minutes + actMinutes, activity_ids: [...current.activity_ids, actId],
        };
      } else {
        unplacedActivityIds.push(actId);
      }
    }

    const totalFutureMinutes = workingFutureSessions.reduce((sum, s) => sum + s.duration_minutes, 0);
    const unplacedMinutes = unplacedActivityIds.reduce((sum, actId) => sum + activityMinutes(actId), 0);
    const declaredBudget = redistributionOptions?.availableCapacityMinutes ?? weeklyMinutes;
    const totalNeededMinutes = totalFutureMinutes + unplacedMinutes;

    if (
      unplacedActivityIds.length > 0 && redistributionOptions?.deadlineFixed !== true &&
      totalNeededMinutes <= declaredBudget && unplacedMinutes <= sessionCap
    ) {
      workingFutureSessions.push({
        session_id: `session-catchup-${missedSessionIds[0] ?? "1"}`, start_at: "2026-11-01T18:00:00-04:00",
        duration_minutes: unplacedMinutes, activity_ids: [...unplacedActivityIds], reminder_enabled: false,
      });
      unplacedActivityIds.length = 0;
    }

    const finalFeasible = unplacedActivityIds.length === 0 && totalNeededMinutes <= declaredBudget;
    const finalExcess = finalFeasible ? 0 : Math.max(unplacedMinutes, totalNeededMinutes - declaredBudget);
    const preview = {
      missedSessionIds: [...missedSessionIds] as readonly string[],
      redistributedActivityIds: missedActivities as readonly string[],
      proposedSessions: workingFutureSessions as readonly ScheduleSessionItem[],
      unplacedActivityIds: unplacedActivityIds as readonly string[],
      requiredMinutesToRedistribute,
      availableRemainingCapacityMinutes: Math.max(0, declaredBudget - remainingSessions.reduce((sum, s) => sum + s.duration_minutes, 0)),
      excessMinutes: finalExcess,
      overbookedSessionMinutes: 0 as const,
      silentlyOverbookedFutureSessions: false as const,
      silentlyRemovedRequiredPractice: false as const,
      feasible: finalFeasible,
      constraintStatus: (finalFeasible ? "feasible" : "infeasible") as "feasible" | "infeasible",
      recoveryOptions: (finalFeasible ? [] : ["reduce_scope", "extend_deadline", "increase_weekly_availability"]) as readonly (
        | "reduce_scope" | "extend_deadline" | "increase_weekly_availability"
      )[],
      mutatesSyllabusRevision: false as const,
      syllabusRevisionId: immutableSyllabusRevisionId,
    };
    missedSessionPreview = preview;
    return preview;
  }

  function previewReviewScheduleSpacing(customReviewItems?: readonly Partial<ReviewScheduleItemModel>[]) {
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

    const allocatedInDistinctSessionsFromInitialQuiz = !sessions.some((s) => {
      const hasQuiz = s.activity_ids.some((id) => activityTypeById.get(id) === "quiz" || id.includes("quiz"));
      const hasReview = s.activity_ids.some((id) => activityTypeById.get(id) === "review" || id.includes("review"));
      return hasQuiz && hasReview;
    });

    const totalScheduledReviewMinutes = reviewScheduleItems.reduce((sum, item) => {
      if (item.status === "not_scheduled" || item.status === "deferred") return sum;
      const est = activityEstimateById.get(item.activity_id);
      return sum + (est ? computeActivityDurationTriplet(est, 1, true).point : 5);
    }, 0);

    return {
      reviewItems: [...reviewScheduleItems] as readonly ReviewScheduleItemModel[],
      intervalPolicyVersion: reviewScheduleItems[0]?.interval_policy_version ?? intervalPolicyVersion,
      isConfigurableHeuristic: true as const,
      allocatedInDistinctSessionsFromInitialQuiz,
      totalScheduledReviewMinutes,
      reviewsConsumeDeclaredStudyCapacity: true as const,
      hiddenInMediaSpeedAdjustment: false as const,
      erasesDatedDemonstrationWhenDue: false as const,
      invalidatesPrerequisiteWaiverWhenDue: false as const,
      mutatesSyllabusRevision: false as const,
      syllabusRevisionId: immutableSyllabusRevisionId,
    };
  }

  function previewSequencePreferenceChange(requestedMode: "theory_first" | "application_first" | "balanced") {
    const orderedActivityIds = sessions.flatMap((s) => s.activity_ids);
    if (requestedMode === "application_first") {
      const rank = (id: string): number => {
        const t = activityTypeById.get(id) ?? "theory";
        return t === "worked_example" || t === "coding" ? 0 : t === "theory" ? 1 : t === "quiz" ? 2 : t === "review" ? 3 : 4;
      };
      orderedActivityIds.sort((a, b) => rank(a) - rank(b));
    }
    return {
      previousSequenceMode: "balanced" as "theory_first" | "application_first" | "balanced",
      requestedSequenceMode: requestedMode,
      orderedActivityIds: orderedActivityIds as readonly string[],
      retainsRequiredObjectives: true as const,
      retainsGenuinePrerequisites: true as const,
      retainsPracticeFeedbackAndReview: true as const,
      diagnosesLearningStyle: false as const,
      mutatesSyllabusRevision: false as const,
    };
  }

  const getState = () => ({
    syllabusId, syllabusRevisionId: immutableSyllabusRevisionId,
    scheduleId, scheduleRevisionId, version, etag: currentEtag,
    timezone, weeklyMinutes, maxSessionMinutes, playbackSpeed,
    sessions: [...sessions] as readonly ScheduleSessionItem[],
    reviewScheduleItems: [...reviewScheduleItems] as readonly ReviewScheduleItemModel[],
    intervalPolicyVersion, pendingPatch: { ...pendingPatch },
    playbackPreview: previewPlaybackSpeed(playbackSpeed),
    missedSessionPreview, reviewSpacingPreview: previewReviewScheduleSpacing(),
    conflictState, mutatesSyllabusRevision: false as const, surfaceStyle,
  });

  return {
    getState,
    getModel: getState,
    previewPlaybackSpeed,
    previewMissedSessionRedistribution,
    previewReviewScheduleSpacing,
    previewSequencePreferenceChange,
    stageSchedulePatch(patch: SchedulePatchPayload) {
      if (patch.timezone !== undefined) timezone = patch.timezone;
      if (patch.weekly_minutes !== undefined) weeklyMinutes = patch.weekly_minutes;
      pendingPatch = {
        ...pendingPatch, ...patch,
        ...(patch.session_changes ? { session_changes: [...(pendingPatch.session_changes ?? []), ...patch.session_changes] } : {}),
      };
      return getState();
    },
    buildPatchScheduleRequest(reqOptions?: { readonly ifMatch?: string; readonly patch?: SchedulePatchPayload }) {
      const ifMatchToUse = reqOptions?.ifMatch !== undefined ? reqOptions.ifMatch : currentEtag;
      return {
        operationId: "patchSchedule" as const, method: "PATCH" as const,
        path: `/syllabi/${syllabusId}/schedule`,
        headers: buildOperationHeaders("patchSchedule", { ifMatch: ifMatchToUse }),
        body: reqOptions?.patch ?? (Object.keys(pendingPatch).length > 0 ? pendingPatch : { timezone, weekly_minutes: weeklyMinutes }),
      };
    },
    handleStaleScheduleConflict(conflictInput: {
      readonly statusCode?: 412 | 409; readonly errorCode?: "precondition_failed" | "conflict";
      readonly staleIfMatch?: string; readonly latestServerSchedule: Record<string, unknown>;
      readonly attemptedPatch?: SchedulePatchPayload;
    }): ScheduleConflictResolutionState {
      const serverSched = conflictInput.latestServerSchedule;
      const latestRevId = sanitizeId(serverSched["schedule_revision_id"], "synthetic-schedule-revision-2");
      const latestVer = typeof serverSched["version"] === "number" ? serverSched["version"] : version + 1;
      const latestSessions = parseScheduleSessions(serverSched["sessions"], sessions);
      const patchToPreserve =
        conflictInput.attemptedPatch ?? (Object.keys(pendingPatch).length > 0 ? pendingPatch : { weekly_minutes: weeklyMinutes });
      pendingPatch = patchToPreserve;

      conflictState = {
        hasConflict: true, statusCode: conflictInput.statusCode ?? 412,
        errorCode: conflictInput.errorCode ?? "precondition_failed",
        message: `Schedule edit conflicted with newer server revision ${latestRevId} (v${latestVer}). Your pending changes are preserved; review the server schedule before rebasing or discarding.`,
        staleIfMatchUsed: conflictInput.staleIfMatch ?? currentEtag,
        latestServerScheduleRevisionId: latestRevId, latestServerVersion: latestVer, latestServerSessions: latestSessions,
        pendingLocalPatch: patchToPreserve, pendingLocalPatchPreserved: true,
        silentlyOverwroteServerSchedule: false,
        availableResolutions: ["rebase_on_latest", "discard_local_edits"],
      };
      return conflictState;
    },
    resolveScheduleConflict(strategy: "rebase_on_latest" | "discard_local_edits") {
      scheduleRevisionId = conflictState.latestServerScheduleRevisionId;
      version = conflictState.latestServerVersion;
      currentEtag = `"${scheduleRevisionId}-v${version}"`;
      sessions = [...conflictState.latestServerSessions];
      if (strategy === "discard_local_edits") pendingPatch = {};
      conflictState = {
        ...conflictState, hasConflict: false, statusCode: null, errorCode: null, message: null,
        pendingLocalPatchPreserved: strategy === "rebase_on_latest",
      };
      return getState();
    },
  };
}
export type ScheduleEditorController = ReturnType<typeof createScheduleEditorController>;
export type PlaybackSpeedPreviewResult = ReturnType<ScheduleEditorController["previewPlaybackSpeed"]>;
export type PlaybackSpeedSessionPreview = PlaybackSpeedPreviewResult["sessions"][number];
export type MissedSessionRedistributionPreview = ReturnType<ScheduleEditorController["previewMissedSessionRedistribution"]>;
export type ReviewScheduleSpacingPreview = ReturnType<ScheduleEditorController["previewReviewScheduleSpacing"]>;
export type SequenceModePreviewResult = ReturnType<ScheduleEditorController["previewSequencePreferenceChange"]>;
export type PatchScheduleRequestDescriptor = ReturnType<ScheduleEditorController["buildPatchScheduleRequest"]>;
export type ScheduleAdaptationPreviewModel = ReturnType<ScheduleEditorController["getState"]>;
