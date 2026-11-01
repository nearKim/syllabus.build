import { buildOperationHeaders } from "@syllabus/api-client";
import { clamp } from "./shared.ts";

export type GoalDeadlinePolicy = "fixed_date" | "target_duration" | "no_deadline" | "fixed" | "flexible";
export type CanonicalDeadlinePolicy = "fixed" | "flexible" | "no_deadline";
export type GoalBudgetPolicy = "free_only" | "capped_paid" | "free_or_owned" | "owned_only" | "allow_paid";
export type CanonicalAccessPolicyMode = "free_only" | "free_or_owned" | "owned_only" | "allow_paid";
export type SequencePreference = "theory_first" | "application_first" | "balanced";
export type GoalMathDepth = "formal" | "intuition_first" | "application_focused" | "intuitive" | "applied";
export type CanonicalMathDepth = "formal" | "intuitive" | "applied";

export interface TopicMathDepthOverrideInput {
  readonly topicId?: string; readonly topic_id?: string;
  readonly mathDepth?: GoalMathDepth; readonly math_depth?: GoalMathDepth;
}

export interface NormalizedTopicMathDepthOverride {
  readonly topic_id: string; readonly math_depth: CanonicalMathDepth; readonly uiMathDepth: GoalMathDepth;
}

export interface GoalFeasibilityWarning {
  readonly hasWarning: boolean;
  readonly code: "effort_exceeds_available_capacity";
  readonly requiredMinutes: number; readonly availableMinutes: number; readonly shortfallMinutes: number;
  readonly availableWeeks: number; readonly weeklyHoursCap: number; readonly minimumWeeklyHoursNeeded: number;
  readonly message: string;
  readonly recoveryActions: readonly ["extend_target_date", "increase_weekly_hours", "narrow_goal_scope"];
  readonly silentlyReducesMathDepth: false;
}

export interface GoalIntakeValidationResult {
  readonly valid: boolean; readonly errors: readonly string[]; readonly warnings: readonly string[];
  readonly feasibilityWarning: GoalFeasibilityWarning | null;
}

export interface GoalIntakeFormInput {
  readonly goalTitle?: string; readonly goalSummary?: string; readonly prompt?: string;
  readonly targetOutcomes?: readonly string[]; readonly desired_outcomes?: readonly string[];
  readonly scopeMode?: "focused" | "broad_survey" | "role_preparation" | "certification_preparation";
  readonly deadlinePolicy?: GoalDeadlinePolicy; readonly deadline_policy?: GoalDeadlinePolicy;
  readonly startDate?: string; readonly start_date?: string;
  readonly deadlineDate?: string | null; readonly targetEndDate?: string | null; readonly target_end_date?: string | null;
  readonly targetDurationWeeks?: number | null; readonly availableWeeks?: number | null;
  readonly weeklyHoursCap?: number; readonly weeklyMinutes?: number; readonly weekly_minutes?: number;
  readonly requiredPointEffortMinutes?: number; readonly requiredPointEffortHours?: number;
  readonly budgetPolicy?: GoalBudgetPolicy;
  readonly ownedSubscriptionIds?: readonly string[]; readonly owned_subscription_ids?: readonly string[];
  readonly ownedResourceIds?: readonly string[]; readonly owned_resource_ids?: readonly string[];
  readonly materialsBudgetMinorUnits?: number; readonly computeBudgetMinorUnits?: number; readonly inferenceBudgetMinorUnits?: number;
  readonly currency?: string;
  readonly sequencePreference?: SequencePreference; readonly sequence_preference?: SequencePreference;
  readonly mathDepth?: GoalMathDepth; readonly math_depth?: GoalMathDepth;
  readonly topicMathDepthOverrides?: readonly TopicMathDepthOverrideInput[];
  readonly topic_math_depth_overrides?: readonly TopicMathDepthOverrideInput[];
  readonly knownMaterialReview?: "condensed" | "retain_full" | "skip_if_demonstrated";
  readonly experienceLevel?: "beginner" | "intermediate" | "advanced" | "mixed" | "unknown";
  readonly backgroundSummary?: string; readonly proficiencySnapshotRef?: string | null;
  readonly timezone?: string; readonly region?: string; readonly playbackSpeed?: number; readonly idempotencyKey?: string;
}

const mapCanonicalDeadlinePolicy = (p: GoalDeadlinePolicy): CanonicalDeadlinePolicy =>
  p === "fixed_date" || p === "fixed" ? "fixed" : p === "target_duration" || p === "flexible" ? "flexible" : "no_deadline";

const mapCanonicalMathDepth = (d: GoalMathDepth): CanonicalMathDepth =>
  d === "formal" ? "formal" : d === "intuition_first" || d === "intuitive" ? "intuitive" : "applied";

function mapCanonicalAccessMode(
  budgetPolicy: GoalBudgetPolicy,
  ownedSubs: readonly string[],
  ownedRes: readonly string[],
): CanonicalAccessPolicyMode {
  if (budgetPolicy === "capped_paid" || budgetPolicy === "allow_paid") return "allow_paid";
  if (budgetPolicy === "owned_only") return "owned_only";
  if (budgetPolicy === "free_or_owned" || (budgetPolicy === "free_only" && (ownedSubs.length > 0 || ownedRes.length > 0))) {
    return "free_or_owned";
  }
  return "free_only";
}

function addDaysIsoDate(startDateIso: string, daysToAdd: number): string {
  const parsed = new Date(`${startDateIso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "2026-11-08";
  parsed.setUTCDate(parsed.getUTCDate() + Math.max(1, Math.round(daysToAdd)));
  return parsed.toISOString().slice(0, 10);
}

function diffWeeksBetweenDates(startDateIso: string, endDateIso: string): number {
  const start = new Date(`${startDateIso}T00:00:00Z`);
  const end = new Date(`${endDateIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 2;
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7));
}

function normalizeOverrides(raw: readonly TopicMathDepthOverrideInput[] | undefined): NormalizedTopicMathDepthOverride[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: NormalizedTopicMathDepthOverride[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const topicId = (item.topicId ?? item.topic_id ?? "").trim();
    const uiDepth = item.mathDepth ?? item.math_depth ?? "applied";
    if (topicId && !seen.has(topicId)) {
      seen.add(topicId);
      result.push({ topic_id: topicId, math_depth: mapCanonicalMathDepth(uiDepth), uiMathDepth: uiDepth });
    }
  }
  return result;
}

export function createGoalIntakeController(initialInput: GoalIntakeFormInput = {}) {
  let goalTitle = initialInput.goalTitle ?? initialInput.prompt ?? "Learn LLM attention with mathematical derivations";
  let goalSummary =
    initialInput.goalSummary ?? initialInput.prompt ?? "Focused learning plan with explicit mathematical assumptions and hands-on verification.";
  let targetOutcomes: readonly string[] =
    initialInput.targetOutcomes ?? initialInput.desired_outcomes ?? ["Derive and implement scaled dot-product attention under explicit assumptions."];
  let scopeMode = initialInput.scopeMode ?? "focused";
  let deadlinePolicy: GoalDeadlinePolicy = initialInput.deadlinePolicy ?? initialInput.deadline_policy ?? "target_duration";
  let startDate = initialInput.startDate ?? initialInput.start_date ?? "2026-10-26";
  let targetDurationWeeks: number | null = initialInput.targetDurationWeeks ?? initialInput.availableWeeks ?? 2;
  let deadlineDate: string | null =
    initialInput.deadlineDate !== undefined ? initialInput.deadlineDate
    : initialInput.targetEndDate !== undefined ? initialInput.targetEndDate
    : initialInput.target_end_date !== undefined ? initialInput.target_end_date
    : deadlinePolicy === "no_deadline" ? null : addDaysIsoDate(startDate, (targetDurationWeeks ?? 2) * 7);

  const initialWeeklyMinutes =
    initialInput.weeklyMinutes ?? initialInput.weekly_minutes ??
    (typeof initialInput.weeklyHoursCap === "number" ? Math.round(initialInput.weeklyHoursCap * 60) : 120);
  let weeklyHoursCap =
    typeof initialInput.weeklyHoursCap === "number" ? initialInput.weeklyHoursCap : Number((initialWeeklyMinutes / 60).toFixed(2));
  let requiredPointEffortMinutes =
    typeof initialInput.requiredPointEffortMinutes === "number" ? initialInput.requiredPointEffortMinutes
    : typeof initialInput.requiredPointEffortHours === "number" ? Math.round(initialInput.requiredPointEffortHours * 60) : 48;

  let budgetPolicy: GoalBudgetPolicy = initialInput.budgetPolicy ?? "free_only";
  let ownedSubscriptionIds: readonly string[] = [...(initialInput.ownedSubscriptionIds ?? initialInput.owned_subscription_ids ?? [])];
  let ownedResourceIds: readonly string[] = [...(initialInput.ownedResourceIds ?? initialInput.owned_resource_ids ?? [])];
  let rawMaterialsBudgetMinorUnits = initialInput.materialsBudgetMinorUnits ?? 0;
  let computeBudgetMinorUnits = initialInput.computeBudgetMinorUnits ?? 0;
  let inferenceBudgetMinorUnits = initialInput.inferenceBudgetMinorUnits ?? 100;
  const currency = initialInput.currency ?? "USD";
  let sequencePreference: SequencePreference = initialInput.sequencePreference ?? initialInput.sequence_preference ?? "balanced";
  let mathDepth: GoalMathDepth = initialInput.mathDepth ?? initialInput.math_depth ?? "application_focused";
  let topicMathDepthOverrides = normalizeOverrides(initialInput.topicMathDepthOverrides ?? initialInput.topic_math_depth_overrides);
  let knownMaterialReview = initialInput.knownMaterialReview ?? "condensed";
  let experienceLevel = initialInput.experienceLevel ?? "beginner";
  const backgroundSummary = initialInput.backgroundSummary ?? "Can write basic Python.";
  const proficiencySnapshotRef: string | null = initialInput.proficiencySnapshotRef ?? null;
  const timezone = initialInput.timezone ?? "America/New_York";
  const region = initialInput.region ?? "US";
  const playbackSpeed = initialInput.playbackSpeed ?? 1;
  let defaultIdempotencyKey = initialInput.idempotencyKey;

  const getState = () => ({
    goalTitle, goalSummary, targetOutcomes: [...targetOutcomes] as readonly string[],
    deadlinePolicy, canonicalDeadlinePolicy: mapCanonicalDeadlinePolicy(deadlinePolicy),
    startDate, deadlineDate, targetDurationWeeks, weeklyHoursCap,
    weeklyMinutes: Math.max(30, Math.round(weeklyHoursCap * 60)),
    requiredPointEffortMinutes, budgetPolicy,
    canonicalAccessPolicyMode: mapCanonicalAccessMode(budgetPolicy, ownedSubscriptionIds, ownedResourceIds),
    ownedSubscriptionIds: [...ownedSubscriptionIds] as readonly string[],
    owned_subscription_ids: [...ownedSubscriptionIds] as readonly string[],
    ownedResourceIds: [...ownedResourceIds] as readonly string[],
    materialsBudgetMinorUnits:
      budgetPolicy === "free_only" || budgetPolicy === "free_or_owned" || budgetPolicy === "owned_only"
        ? 0
        : Math.max(0, rawMaterialsBudgetMinorUnits),
    computeBudgetMinorUnits, inferenceBudgetMinorUnits, currency,
    sequencePreference, sequence_preference: sequencePreference,
    mathDepth, math_depth: mathDepth, canonicalMathDepth: mapCanonicalMathDepth(mathDepth),
    topicMathDepthOverrides: [...topicMathDepthOverrides] as readonly NormalizedTopicMathDepthOverride[],
    knownMaterialReview, experienceLevel, backgroundSummary, proficiencySnapshotRef, timezone, region, playbackSpeed,
  });

  function update(patch: GoalIntakeFormInput) {
    if (patch.goalTitle !== undefined) goalTitle = patch.goalTitle;
    if (patch.goalSummary !== undefined) goalSummary = patch.goalSummary;
    if (patch.prompt !== undefined) {
      goalSummary = patch.prompt;
      if (patch.goalTitle === undefined) goalTitle = patch.prompt;
    }
    const nextOutcomes = patch.targetOutcomes ?? patch.desired_outcomes;
    if (nextOutcomes !== undefined) targetOutcomes = [...nextOutcomes];
    if (patch.scopeMode !== undefined) scopeMode = patch.scopeMode;
    startDate = patch.startDate ?? patch.start_date ?? startDate;
    deadlinePolicy = patch.deadlinePolicy ?? patch.deadline_policy ?? deadlinePolicy;
    if (patch.targetDurationWeeks !== undefined || patch.availableWeeks !== undefined) {
      targetDurationWeeks = patch.targetDurationWeeks !== undefined ? patch.targetDurationWeeks : (patch.availableWeeks ?? null);
    }
    if (patch.deadlineDate !== undefined || patch.targetEndDate !== undefined || patch.target_end_date !== undefined) {
      deadlineDate =
        patch.deadlineDate !== undefined ? patch.deadlineDate
        : patch.targetEndDate !== undefined ? patch.targetEndDate : (patch.target_end_date ?? null);
    }
    if (patch.weeklyHoursCap !== undefined) weeklyHoursCap = patch.weeklyHoursCap;
    else if (patch.weeklyMinutes !== undefined || patch.weekly_minutes !== undefined) {
      weeklyHoursCap = Number(((patch.weeklyMinutes ?? patch.weekly_minutes ?? 120) / 60).toFixed(2));
    }
    if (patch.requiredPointEffortMinutes !== undefined) requiredPointEffortMinutes = patch.requiredPointEffortMinutes;
    else if (patch.requiredPointEffortHours !== undefined) requiredPointEffortMinutes = Math.round(patch.requiredPointEffortHours * 60);
    if (patch.budgetPolicy !== undefined) budgetPolicy = patch.budgetPolicy;
    const nextSubs = patch.ownedSubscriptionIds ?? patch.owned_subscription_ids;
    if (nextSubs !== undefined) ownedSubscriptionIds = [...nextSubs];
    const nextRes = patch.ownedResourceIds ?? patch.owned_resource_ids;
    if (nextRes !== undefined) ownedResourceIds = [...nextRes];
    if (patch.materialsBudgetMinorUnits !== undefined) rawMaterialsBudgetMinorUnits = patch.materialsBudgetMinorUnits;
    if (patch.computeBudgetMinorUnits !== undefined) computeBudgetMinorUnits = patch.computeBudgetMinorUnits;
    if (patch.inferenceBudgetMinorUnits !== undefined) inferenceBudgetMinorUnits = patch.inferenceBudgetMinorUnits;
    sequencePreference = patch.sequencePreference ?? patch.sequence_preference ?? sequencePreference;
    mathDepth = patch.mathDepth ?? patch.math_depth ?? mathDepth;
    const nextOverrides = patch.topicMathDepthOverrides ?? patch.topic_math_depth_overrides;
    if (nextOverrides !== undefined) topicMathDepthOverrides = normalizeOverrides(nextOverrides);
    if (patch.knownMaterialReview !== undefined) knownMaterialReview = patch.knownMaterialReview;
    if (patch.experienceLevel !== undefined) experienceLevel = patch.experienceLevel;
    if (patch.idempotencyKey !== undefined) defaultIdempotencyKey = patch.idempotencyKey;
    return getState();
  }

  function validate(): GoalIntakeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!goalTitle?.trim()) errors.push("Goal title or prompt is required.");
    if (!targetOutcomes?.length) errors.push("At least one target outcome is required.");
    if (weeklyHoursCap <= 0) errors.push("Weekly hours cap must be greater than zero.");
    if (deadlinePolicy === "no_deadline" && deadlineDate !== null && deadlineDate !== "") {
      errors.push("Cannot set a deadline date (target_end_date) when deadline_policy is no_deadline.");
    }
    if (deadlinePolicy !== "no_deadline" && !deadlineDate?.trim() && (targetDurationWeeks === null || targetDurationWeeks <= 0)) {
      errors.push("A deadline date or positive target duration in weeks is required when deadline_policy is not no_deadline.");
    }

    let feasibilityWarning: GoalFeasibilityWarning | null = null;
    if (deadlinePolicy !== "no_deadline") {
      const effectiveEndDate = deadlineDate?.trim() ? deadlineDate : addDaysIsoDate(startDate, (targetDurationWeeks ?? 2) * 7);
      const weeks =
        typeof targetDurationWeeks === "number" && targetDurationWeeks > 0
          ? targetDurationWeeks
          : diffWeeksBetweenDates(startDate, effectiveEndDate);
      const availableMinutes = Math.round(weeks * weeklyHoursCap * 60);

      if (requiredPointEffortMinutes > availableMinutes) {
        const shortfallMinutes = requiredPointEffortMinutes - availableMinutes;
        const minimumWeeklyHoursNeeded = weeks > 0 ? Number((requiredPointEffortMinutes / 60 / weeks).toFixed(2)) : weeklyHoursCap;
        const message = `Feasibility warning (@S02): required point-estimate effort (${requiredPointEffortMinutes} min) exceeds available capacity (${availableMinutes} min across ${weeks} weeks at ${weeklyHoursCap}h/week).`;
        warnings.push(message);
        feasibilityWarning = {
          hasWarning: true, code: "effort_exceeds_available_capacity",
          requiredMinutes: requiredPointEffortMinutes, availableMinutes, shortfallMinutes,
          availableWeeks: weeks, weeklyHoursCap, minimumWeeklyHoursNeeded, message,
          recoveryActions: ["extend_target_date", "increase_weekly_hours", "narrow_goal_scope"],
          silentlyReducesMathDepth: false,
        };
      }
    }
    return { valid: errors.length === 0, errors, warnings, feasibilityWarning };
  }

  return {
    getState,
    update,
    setGoal(title: string, summary?: string, outcomes?: readonly string[]) {
      goalTitle = title;
      if (summary !== undefined) goalSummary = summary;
      if (outcomes !== undefined) targetOutcomes = [...outcomes];
      return getState();
    },
    setDeadlinePolicy(
      policy: GoalDeadlinePolicy,
      options?: { readonly deadlineDate?: string | null; readonly targetDurationWeeks?: number | null; readonly startDate?: string },
    ) {
      deadlinePolicy = policy;
      if (options?.startDate !== undefined) startDate = options.startDate;
      if (options?.targetDurationWeeks !== undefined) targetDurationWeeks = options.targetDurationWeeks;
      if (options?.deadlineDate !== undefined) deadlineDate = options.deadlineDate;
      else if (policy === "no_deadline") deadlineDate = null;
      else if (deadlineDate === null) deadlineDate = addDaysIsoDate(startDate, (targetDurationWeeks ?? 2) * 7);
      return getState();
    },
    setWeeklyHoursCap(nextHoursCap: number) {
      weeklyHoursCap = nextHoursCap;
      return getState();
    },
    setBudgetPolicy(
      nextBudgetPolicy: GoalBudgetPolicy,
      options?: {
        readonly ownedSubscriptionIds?: readonly string[]; readonly owned_subscription_ids?: readonly string[];
        readonly ownedResourceIds?: readonly string[]; readonly materialsBudgetMinorUnits?: number;
      },
    ) {
      budgetPolicy = nextBudgetPolicy;
      const nextSubs = options?.ownedSubscriptionIds ?? options?.owned_subscription_ids;
      if (nextSubs !== undefined) ownedSubscriptionIds = [...nextSubs];
      if (options?.ownedResourceIds !== undefined) ownedResourceIds = [...options.ownedResourceIds];
      if (options?.materialsBudgetMinorUnits !== undefined) rawMaterialsBudgetMinorUnits = options.materialsBudgetMinorUnits;
      return getState();
    },
    setSequencePreference(nextPref: SequencePreference) {
      sequencePreference = nextPref;
      return getState();
    },
    setMathDepth(nextDepth: GoalMathDepth, overrides?: readonly TopicMathDepthOverrideInput[]) {
      mathDepth = nextDepth;
      if (overrides !== undefined) topicMathDepthOverrides = normalizeOverrides(overrides);
      return getState();
    },
    validate,
    buildStartGenerationRequest(idempotencyKeyOrOptions?: string | { readonly idempotencyKey?: string }) {
      const validation = validate();
      if (!validation.valid) throw new Error(`Invalid goal intake state: ${validation.errors.join(" ")}`);

      const idempotencyKey =
        typeof idempotencyKeyOrOptions === "string"
          ? idempotencyKeyOrOptions
          : (idempotencyKeyOrOptions?.idempotencyKey ?? defaultIdempotencyKey);
      const headers = buildOperationHeaders("startGeneration", idempotencyKey !== undefined ? { idempotencyKey } : {});
      const state = getState();
      const targetEndDate =
        state.canonicalDeadlinePolicy === "no_deadline"
          ? null
          : (state.deadlineDate ?? addDaysIsoDate(state.startDate, (state.targetDurationWeeks ?? 2) * 7));

      const requestPayload: Record<string, unknown> = {
        schema_version: "0.2.0",
        goal: {
          prompt: state.goalSummary || state.goalTitle,
          desired_outcomes: [...state.targetOutcomes],
          scope_mode: scopeMode,
          target_certification_ids: [],
        },
        learner_profile: {
          experience_level: state.experienceLevel,
          background_summary: state.backgroundSummary,
          self_reported_known_objective_ids: [],
          diagnostic_result_refs: [],
          preferred_language: "en",
          accessibility_needs: ["captions"],
          topic_self_reports: [],
          proficiency_snapshot_ref: state.proficiencySnapshotRef,
        },
        constraints: {
          weekly_minutes: state.weeklyMinutes,
          start_date: state.startDate,
          target_end_date: targetEndDate,
          deadline_policy: state.canonicalDeadlinePolicy,
          timezone: state.timezone,
          available_slots: [],
          max_session_minutes: clamp(Math.round(state.weeklyMinutes / 3), 10, 240),
          sequence_preference: state.sequencePreference,
          guidance_preference: "guided",
          preferred_resource_types: ["article", "repository"],
        },
        access_policy: {
          mode: state.canonicalAccessPolicyMode,
          owned_resource_ids: [...state.ownedResourceIds],
          owned_subscription_ids: [...state.ownedSubscriptionIds],
          unknown_price_policy: "exclude",
          allow_trial_required_resources: false,
          region: state.region,
        },
        budgets: {
          materials: { currency: state.currency, max_minor_units: state.materialsBudgetMinorUnits },
          compute: { currency: state.currency, max_minor_units: state.computeBudgetMinorUnits },
          inference: { currency: state.currency, max_minor_units: state.inferenceBudgetMinorUnits },
        },
        inference: { mode: "hosted", model_policy_id: "synthetic-model-policy" },
        generation_options: {
          include_optional_certification: false,
          playback_speed: state.playbackSpeed,
          planning_horizon_days: Math.max(7, (state.targetDurationWeeks ?? 2) * 7),
          include_hands_on: true,
        },
        instruction_preferences: {
          math_depth: state.canonicalMathDepth,
          topic_math_depth_overrides: state.topicMathDepthOverrides.map((o) => ({ topic_id: o.topic_id, math_depth: o.math_depth })),
          known_material_review: state.knownMaterialReview,
        },
        template_origin: null,
      };

      return {
        operationId: "startGeneration" as const, method: "POST" as const, path: "/generations" as const,
        headers, body: requestPayload, requestPayload, validation,
      };
    },
  };
}
export type GoalIntakeController = ReturnType<typeof createGoalIntakeController>;
export type GoalIntakeState = ReturnType<GoalIntakeController["getState"]>;
export type StartGenerationRequestDescriptor = ReturnType<GoalIntakeController["buildStartGenerationRequest"]>;
