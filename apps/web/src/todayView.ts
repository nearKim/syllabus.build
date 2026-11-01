import {
  buildPlanMapAndOutlineModel,
  type ActivityExecutionStatus,
  type CatalogResourceMetadataInput,
  type ObjectiveProficiencyBadgeStatus,
} from "@syllabus/ui";
import { requireNonEmpty } from "./shared.ts";

export type AsyncSurfaceRecoveryStateKind =
  | "ready" | "loading" | "generation_failed" | "no_eligible_resources"
  | "insufficient_credit" | "notification_permission_denied" | "offline_with_pending_progress" | "stale_source";

export interface AsyncSurfaceRecoveryBanner {
  readonly state: AsyncSurfaceRecoveryStateKind; readonly role: "status" | "alert";
  readonly title: string; readonly message: string; readonly actionableNextStep: string;
  readonly simulatedSuccessRendered: false;
}

export interface ProgressEventInput {
  readonly eventId?: string; readonly event_id?: string;
  readonly syllabusRevisionId?: string; readonly syllabus_revision_id?: string;
  readonly activityId?: string; readonly activity_id?: string;
  readonly type?: "self_reported_completed";
  readonly occurredAt?: string; readonly occurred_at?: string;
  readonly clientTimezone?: string; readonly client_timezone?: string;
  readonly note?: string | null; readonly timeSpentMinutes?: number; readonly time_spent_minutes?: number;
}

export interface RecordedProgressEventReceipt {
  readonly eventId: string; readonly syllabusRevisionId: string; readonly activityId: string;
  readonly type: "self_reported_completed"; readonly occurredAt: string; readonly clientTimezone: string;
  readonly note: string | null; readonly timeSpentMinutes: number;
  readonly deduplicated: boolean; readonly isDuplicate: boolean;
  readonly activityExecutionStatus: "self_reported_completed";
  readonly objectiveProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly objectiveProficiencyDemonstrated: false;
  readonly totalStudyMinutes: number; readonly selfReportedCompletedCount: number;
}

export interface TodayViewControllerOptions {
  readonly syllabus?: Record<string, unknown>;
  readonly schedule?: Record<string, unknown>;
  readonly proficiency?: Record<string, unknown> | null;
  readonly catalogResources?: Readonly<Record<string, CatalogResourceMetadataInput>> | readonly CatalogResourceMetadataInput[];
  readonly initialActivityStates?: Readonly<Record<string, ActivityExecutionStatus>>;
}

const ASYNC_RECOVERY_MESSAGES: Readonly<
  Record<AsyncSurfaceRecoveryStateKind, readonly [role: "status" | "alert", title: string, message: string, actionableNextStep: string]>
> = {
  ready: ["status", "Today study queue ready", "Your scheduled sessions and verified resource links are ready.", "Select Start on the next feasible session."],
  loading: ["status", "Loading study queue", "Fetching the active syllabus revision and schedule.", "Wait for synchronization or open the cached Outline."],
  generation_failed: ["alert", "Syllabus generation failed", "The generation job did not produce a valid plan.", "Retry generation with your saved intake draft or adjust constraints."],
  no_eligible_resources: ["alert", "No eligible catalog resources matched", "Approved catalog coverage was insufficient for the current filter constraints.", "Broaden resource types or allow owned subscriptions in Goal Intake."],
  insufficient_credit: ["alert", "Insufficient hosted AI credit", "Your hosted wallet balance cannot cover the estimated generation ceiling.", "Top up hosted credits or configure an approved BYOK connection."],
  notification_permission_denied: ["status", "Browser notification permission denied", "Study reminders cannot be delivered via Web Push while permission is blocked.", "Use the in-app Today view or enable notification permissions in Settings."],
  offline_with_pending_progress: ["alert", "Offline with pending self-reported progress", "Your progress event is retained locally with its stable event_id.", "Retry synchronization when reconnected; duplicate retries will not double-count."],
  stale_source: ["alert", "Resource link or revision is stale", "A newer syllabus revision or catalog replacement is available.", "Refresh the plan or inspect replacement resources."],
};

function normalizeTodayArgs(
  firstArg: Record<string, unknown> | TodayViewControllerOptions,
  secondArg?: Record<string, unknown>,
  thirdArg?: Record<string, unknown> | null,
  fourthArg?: Readonly<Record<string, CatalogResourceMetadataInput>> | readonly CatalogResourceMetadataInput[],
): TodayViewControllerOptions {
  if (firstArg && typeof firstArg === "object" && "syllabus" in firstArg && "schedule" in firstArg && firstArg["syllabus"] && typeof firstArg["syllabus"] === "object") {
    return firstArg as TodayViewControllerOptions;
  }
  return {
    syllabus: (firstArg as Record<string, unknown>) ?? {},
    schedule: secondArg ?? {},
    proficiency: thirdArg ?? null,
    ...(fourthArg ? { catalogResources: fourthArg } : {}),
  };
}

export function createTodayViewController(
  syllabusOrOptions: Record<string, unknown> | TodayViewControllerOptions,
  scheduleArg?: Record<string, unknown>,
  proficiencyArg?: Record<string, unknown> | null,
  catalogResourcesArg?: Readonly<Record<string, CatalogResourceMetadataInput>> | readonly CatalogResourceMetadataInput[],
) {
  const opts = normalizeTodayArgs(syllabusOrOptions, scheduleArg, proficiencyArg, catalogResourcesArg);
  const syllabus = opts.syllabus ?? {};
  const schedule = opts.schedule ?? {};
  const proficiency = opts.proficiency ?? null;

  const activityStates: Record<string, ActivityExecutionStatus> = { ...(opts.initialActivityStates ?? {}) };
  const recordedEventsById = new Map<string, RecordedProgressEventReceipt>();
  let totalStudyMinutes = 0;
  let selfReportedCompletedCount = 0;
  let asyncRecoveryState: AsyncSurfaceRecoveryStateKind = "ready";

  const buildBanner = (state: AsyncSurfaceRecoveryStateKind): AsyncSurfaceRecoveryBanner => {
    const [role, title, message, actionableNextStep] = ASYNC_RECOVERY_MESSAGES[state];
    return { state, role, title, message, actionableNextStep, simulatedSuccessRendered: false };
  };

  function getState() {
    const planModel = buildPlanMapAndOutlineModel({
      syllabus, proficiency, activityStates, ...(opts.catalogResources ? { catalogResources: opts.catalogResources } : {}),
    });

    const activityById = new Map(planModel.outlineActivities.map((a) => [a.activityId, a]));
    const moduleById = new Map(planModel.outlineModules.map((m) => [m.moduleId, m]));
    const activityExecutionStates: Record<string, ActivityExecutionStatus> = {};
    for (const act of planModel.outlineActivities) activityExecutionStates[act.activityId] = act.executionStatus;
    const objectiveProficiencyStates: Record<string, ObjectiveProficiencyBadgeStatus> = {};
    for (const obj of planModel.objectiveTracks) objectiveProficiencyStates[obj.objectiveId] = obj.proficiencyStatus;

    const rawSessions = Array.isArray(schedule["sessions"]) ? schedule["sessions"] : [];
    const todayCards = rawSessions
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
      .map((rawSession) => {
        const sessionId = typeof rawSession["session_id"] === "string" ? rawSession["session_id"] : "session";
        const startAt = typeof rawSession["start_at"] === "string" ? rawSession["start_at"] : "2026-10-26T18:00:00-04:00";
        const durationMinutes = typeof rawSession["duration_minutes"] === "number" ? rawSession["duration_minutes"] : 0;
        const reminderEnabled = rawSession["reminder_enabled"] === true;
        const activityIds = Array.isArray(rawSession["activity_ids"])
          ? rawSession["activity_ids"].filter((id): id is string => typeof id === "string")
          : [];

        const quizActivityIds: string[] = [];
        const reviewActivityIds: string[] = [];
        const quizObjectives = new Set<string>();
        const reviewObjectives = new Set<string>();

        const activityBreakdown = activityIds.map((actId) => {
          const outlineAct = activityById.get(actId);
          const ownerMod = outlineAct ? moduleById.get(outlineAct.moduleId) : undefined;
          const actType = outlineAct?.type ?? "theory";
          const objIds = outlineAct?.objectiveIds ?? [];

          if (actType === "quiz") {
            quizActivityIds.push(actId);
            objIds.forEach((oid) => quizObjectives.add(oid));
          } else if (actType === "review") {
            reviewActivityIds.push(actId);
            objIds.forEach((oid) => reviewObjectives.add(oid));
          }

          return {
            activityId: actId,
            title: outlineAct?.title ?? actId,
            type: actType,
            moduleId: outlineAct?.moduleId ?? "module-default",
            moduleTitle: ownerMod?.title ?? "Module",
            objectiveIds: objIds,
            requirementLevel: (outlineAct?.requirementLevel ?? "required") as "required" | "optional",
            isOptionalEnrichment: outlineAct?.isOptionalEnrichment ?? false,
            durationMinutes: outlineAct?.durationTriplet.point ?? 0,
            durationTriplet: {
              min: outlineAct?.durationTriplet.min ?? 0,
              point: outlineAct?.durationTriplet.point ?? 0,
              max: outlineAct?.durationTriplet.max ?? 0,
            },
            executionStatus: (outlineAct?.executionStatus ?? "not_started") as ActivityExecutionStatus,
            objectiveProficiencyStatus: (outlineAct?.objectiveProficiencyStatus ?? "unassessed") as ObjectiveProficiencyBadgeStatus,
            resourceProvenanceLinks: outlineAct?.resourceProvenanceCards ?? [],
            scheduledReason:
              actType === "review"
                ? "Spaced review scheduled in a separate session after initial quiz (@S19)."
                : actType === "quiz"
                  ? "Formative check for objective readiness."
                  : `Core ${actType} step in ${ownerMod?.title ?? "active module"}.`,
          };
        });

        const coScheduledSameObjective = Array.from(reviewObjectives).some((oid) => quizObjectives.has(oid));
        const coScheduledQuizAndReviewInSameSession =
          coScheduledSameObjective || (quizActivityIds.length > 0 && reviewActivityIds.length > 0);

        const reviewSeparation = {
          valid: !coScheduledQuizAndReviewInSameSession,
          hasQuiz: quizActivityIds.length > 0,
          hasSpacedReview: reviewActivityIds.length > 0,
          coScheduledQuizAndReviewInSameSession,
          quizActivityIds: quizActivityIds as readonly string[],
          reviewActivityIds: reviewActivityIds as readonly string[],
          separationSummary: !coScheduledQuizAndReviewInSameSession
            ? reviewActivityIds.length > 0
              ? "Spaced review is separated into a later session from initial quiz (@S19)."
              : "No spaced-review collision in this session."
            : "Violation (@S19): spaced review must not share the same session as the initial quiz.",
        };

        return {
          sessionId, startAt, durationMinutes, reminderEnabled,
          activityIds: activityIds as readonly string[],
          activityBreakdown, activities: activityBreakdown, reviewSeparation,
          resourceProvenanceLinks: activityBreakdown.flatMap((a) => a.resourceProvenanceLinks),
          availableActions: ["start", "snooze", "reschedule", "skip"] as const,
        };
      });

    const nextSession =
      todayCards.find((card) =>
        card.activityBreakdown.some((a) => a.executionStatus === "not_started" || a.executionStatus === "in_progress"),
      ) ?? todayCards[0] ?? null;

    return {
      syllabusId: planModel.syllabusId,
      syllabusRevisionId: planModel.revisionId,
      scheduleId: typeof schedule["schedule_id"] === "string" ? schedule["schedule_id"] : "synthetic-schedule-1",
      scheduleRevisionId:
        typeof schedule["schedule_revision_id"] === "string" ? schedule["schedule_revision_id"] : "synthetic-schedule-revision-1",
      timezone: typeof schedule["timezone"] === "string" ? schedule["timezone"] : "America/New_York",
      weeklyMinutes: typeof schedule["weekly_minutes"] === "number" ? schedule["weekly_minutes"] : 120,
      todayCards, sessionCards: todayCards, nextSession,
      activityExecutionStates: activityExecutionStates as Readonly<Record<string, ActivityExecutionStatus>>,
      objectiveProficiencyStates: objectiveProficiencyStates as Readonly<Record<string, ObjectiveProficiencyBadgeStatus>>,
      totalStudyMinutes, selfReportedCompletedCount,
      recordedEventIds: Array.from(recordedEventsById.keys()) as readonly string[],
      recordedEvents: Array.from(recordedEventsById.values()) as readonly RecordedProgressEventReceipt[],
      reviewSeparationValid: todayCards.every((c) => c.reviewSeparation.valid),
      asyncRecoveryBanner: buildBanner(asyncRecoveryState),
    };
  }

  function recordSelfReportedCompletion(event: ProgressEventInput): RecordedProgressEventReceipt {
    const eventId = requireNonEmpty(
      event.eventId ?? event.event_id,
      "A stable non-empty client event_id is required to record progress.",
    );

    const existing = recordedEventsById.get(eventId);
    if (existing) {
      return { ...existing, deduplicated: true, isDuplicate: true, totalStudyMinutes, selfReportedCompletedCount };
    }

    const activityId = requireNonEmpty(event.activityId ?? event.activity_id, "activity_id is required to record progress.");
    const initialPlan = buildPlanMapAndOutlineModel({ syllabus, proficiency, activityStates });
    const matchedAct = initialPlan.outlineActivities.find((a) => a.activityId === activityId);
    const defaultMinutes = matchedAct?.durationTriplet.point ?? 10;
    const timeSpentMinutes = Math.max(0, Math.round(event.timeSpentMinutes ?? event.time_spent_minutes ?? defaultMinutes));

    const previousExecStatus = activityStates[activityId] ?? "not_started";
    activityStates[activityId] = "self_reported_completed";
    if (previousExecStatus !== "self_reported_completed" && previousExecStatus !== "completed") {
      selfReportedCompletedCount += 1;
    }
    totalStudyMinutes += timeSpentMinutes;

    const updatedPlan = buildPlanMapAndOutlineModel({ syllabus, proficiency, activityStates });
    const updatedAct = updatedPlan.outlineActivities.find((a) => a.activityId === activityId);
    const rawProfStatus = updatedAct?.objectiveProficiencyStatus ?? "unassessed";
    const honestProficiencyStatus: ObjectiveProficiencyBadgeStatus =
      rawProfStatus === "demonstrated" ? "unassessed" : rawProfStatus;

    const receipt: RecordedProgressEventReceipt = {
      eventId,
      syllabusRevisionId: event.syllabusRevisionId ?? event.syllabus_revision_id ?? updatedPlan.revisionId,
      activityId, type: "self_reported_completed",
      occurredAt: event.occurredAt ?? event.occurred_at ?? "2026-10-26T18:10:00-04:00",
      clientTimezone: event.clientTimezone ?? event.client_timezone ?? "America/New_York",
      note: event.note ?? null, timeSpentMinutes, deduplicated: false, isDuplicate: false,
      activityExecutionStatus: "self_reported_completed",
      objectiveProficiencyStatus: honestProficiencyStatus,
      objectiveProficiencyDemonstrated: false,
      totalStudyMinutes, selfReportedCompletedCount,
    };

    recordedEventsById.set(eventId, receipt);
    return receipt;
  }

  return {
    getState,
    recordSelfReportedCompletion,
    recordProgressEvent: recordSelfReportedCompletion,
    appendProgressEvent: recordSelfReportedCompletion,
    setAsyncRecoveryState(state: AsyncSurfaceRecoveryStateKind): AsyncSurfaceRecoveryBanner {
      asyncRecoveryState = state;
      return buildBanner(state);
    },
  };
}
export type TodayViewController = ReturnType<typeof createTodayViewController>;
export type TodayViewState = ReturnType<TodayViewController["getState"]>;
export type TodaySessionCard = TodayViewState["todayCards"][number];
export type TodaySessionActivityItem = TodaySessionCard["activityBreakdown"][number];
export type SessionReviewSeparationReport = TodaySessionCard["reviewSeparation"];
