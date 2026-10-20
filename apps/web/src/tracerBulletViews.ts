/**
 * Slice 5 (`T04`) Tracer-Bullet Controllers:
 * 1. `createGoalIntakeController` (`UI-001`, `ADAPT-001`, `ADAPT-007`, `@S02`, `@S47`, `@S69`)
 * 2. `buildRevisionActivationRequest` (`UI-002`, `GEN-008`, `@S03`, `@S24`, `@S53`)
 * 3. `createTodayViewController` (`UI-003`..`UI-006`, `@S17`, `@S19`, `@S23`, `@S24`, `@S26`, `@S27`, `@S84`)
 */

import { buildOperationHeaders } from "../../../packages/api-client/src/index.ts";
import {
  buildPlanMapAndOutlineModel,
  type ActivityExecutionStatus,
  type CatalogResourceMetadataInput,
  type ObjectiveProficiencyBadgeStatus,
  type ResourceProvenanceCardView,
} from "../../../packages/ui/src/index.ts";

export type GoalDeadlinePolicy =
  | "fixed_date"
  | "target_duration"
  | "no_deadline"
  | "fixed"
  | "flexible";

export type CanonicalDeadlinePolicy = "fixed" | "flexible" | "no_deadline";

export type GoalBudgetPolicy =
  | "free_only"
  | "capped_paid"
  | "free_or_owned"
  | "owned_only"
  | "allow_paid";

export type CanonicalAccessPolicyMode =
  | "free_only"
  | "free_or_owned"
  | "owned_only"
  | "allow_paid";

export type SequencePreference = "theory_first" | "application_first" | "balanced";

export type GoalMathDepth =
  | "formal"
  | "intuition_first"
  | "application_focused"
  | "intuitive"
  | "applied";

export type CanonicalMathDepth = "formal" | "intuitive" | "applied";

export interface TopicMathDepthOverrideInput {
  readonly topicId?: string;
  readonly topic_id?: string;
  readonly mathDepth?: GoalMathDepth;
  readonly math_depth?: GoalMathDepth;
}

export interface NormalizedTopicMathDepthOverride {
  readonly topic_id: string;
  readonly math_depth: CanonicalMathDepth;
  readonly uiMathDepth: GoalMathDepth;
}

export interface GoalFeasibilityWarning {
  readonly hasWarning: boolean;
  readonly code: "effort_exceeds_available_capacity";
  readonly requiredMinutes: number;
  readonly availableMinutes: number;
  readonly shortfallMinutes: number;
  readonly availableWeeks: number;
  readonly weeklyHoursCap: number;
  readonly minimumWeeklyHoursNeeded: number;
  readonly message: string;
  readonly recoveryActions: readonly [
    "extend_target_date",
    "increase_weekly_hours",
    "narrow_goal_scope",
  ];
  readonly silentlyReducesMathDepth: false;
}

export interface GoalIntakeValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly feasibilityWarning: GoalFeasibilityWarning | null;
}

export interface GoalIntakeFormInput {
  readonly goalTitle?: string;
  readonly goalSummary?: string;
  readonly prompt?: string;
  readonly targetOutcomes?: readonly string[];
  readonly desired_outcomes?: readonly string[];
  readonly scopeMode?: "focused" | "broad_survey" | "role_preparation" | "certification_preparation";
  readonly deadlinePolicy?: GoalDeadlinePolicy;
  readonly deadline_policy?: GoalDeadlinePolicy;
  readonly startDate?: string;
  readonly start_date?: string;
  readonly deadlineDate?: string | null;
  readonly targetEndDate?: string | null;
  readonly target_end_date?: string | null;
  readonly targetDurationWeeks?: number | null;
  readonly availableWeeks?: number | null;
  readonly weeklyHoursCap?: number;
  readonly weeklyMinutes?: number;
  readonly weekly_minutes?: number;
  readonly requiredPointEffortMinutes?: number;
  readonly requiredPointEffortHours?: number;
  readonly budgetPolicy?: GoalBudgetPolicy;
  readonly ownedSubscriptionIds?: readonly string[];
  readonly owned_subscription_ids?: readonly string[];
  readonly ownedResourceIds?: readonly string[];
  readonly owned_resource_ids?: readonly string[];
  readonly materialsBudgetMinorUnits?: number;
  readonly computeBudgetMinorUnits?: number;
  readonly inferenceBudgetMinorUnits?: number;
  readonly currency?: string;
  readonly sequencePreference?: SequencePreference;
  readonly sequence_preference?: SequencePreference;
  readonly mathDepth?: GoalMathDepth;
  readonly math_depth?: GoalMathDepth;
  readonly topicMathDepthOverrides?: readonly TopicMathDepthOverrideInput[];
  readonly topic_math_depth_overrides?: readonly TopicMathDepthOverrideInput[];
  readonly knownMaterialReview?: "condensed" | "retain_full" | "skip_if_demonstrated";
  readonly experienceLevel?: "beginner" | "intermediate" | "advanced" | "mixed" | "unknown";
  readonly backgroundSummary?: string;
  readonly proficiencySnapshotRef?: string | null;
  readonly timezone?: string;
  readonly region?: string;
  readonly playbackSpeed?: number;
  readonly idempotencyKey?: string;
}

export interface GoalIntakeState {
  readonly goalTitle: string;
  readonly goalSummary: string;
  readonly targetOutcomes: readonly string[];
  readonly deadlinePolicy: GoalDeadlinePolicy;
  readonly canonicalDeadlinePolicy: CanonicalDeadlinePolicy;
  readonly startDate: string;
  readonly deadlineDate: string | null;
  readonly targetDurationWeeks: number | null;
  readonly weeklyHoursCap: number;
  readonly weeklyMinutes: number;
  readonly requiredPointEffortMinutes: number;
  readonly budgetPolicy: GoalBudgetPolicy;
  readonly canonicalAccessPolicyMode: CanonicalAccessPolicyMode;
  readonly ownedSubscriptionIds: readonly string[];
  readonly owned_subscription_ids: readonly string[];
  readonly ownedResourceIds: readonly string[];
  readonly materialsBudgetMinorUnits: number;
  readonly computeBudgetMinorUnits: number;
  readonly inferenceBudgetMinorUnits: number;
  readonly currency: string;
  readonly sequencePreference: SequencePreference;
  readonly sequence_preference: SequencePreference;
  readonly mathDepth: GoalMathDepth;
  readonly math_depth: GoalMathDepth;
  readonly canonicalMathDepth: CanonicalMathDepth;
  readonly topicMathDepthOverrides: readonly NormalizedTopicMathDepthOverride[];
  readonly knownMaterialReview: "condensed" | "retain_full" | "skip_if_demonstrated";
  readonly experienceLevel: "beginner" | "intermediate" | "advanced" | "mixed" | "unknown";
  readonly backgroundSummary: string;
  readonly proficiencySnapshotRef: string | null;
  readonly timezone: string;
  readonly region: string;
  readonly playbackSpeed: number;
}

export interface StartGenerationRequestDescriptor {
  readonly operationId: "startGeneration";
  readonly method: "POST";
  readonly path: "/generations";
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  readonly requestPayload: Record<string, unknown>;
  readonly validation: GoalIntakeValidationResult;
}

export interface GoalIntakeController {
  getState(): GoalIntakeState;
  update(patch: GoalIntakeFormInput): GoalIntakeState;
  setGoal(title: string, summary?: string, targetOutcomes?: readonly string[]): GoalIntakeState;
  setDeadlinePolicy(
    policy: GoalDeadlinePolicy,
    options?: {
      readonly deadlineDate?: string | null;
      readonly targetDurationWeeks?: number | null;
      readonly startDate?: string;
    }
  ): GoalIntakeState;
  setWeeklyHoursCap(weeklyHoursCap: number): GoalIntakeState;
  setBudgetPolicy(
    budgetPolicy: GoalBudgetPolicy,
    options?: {
      readonly ownedSubscriptionIds?: readonly string[];
      readonly owned_subscription_ids?: readonly string[];
      readonly ownedResourceIds?: readonly string[];
      readonly materialsBudgetMinorUnits?: number;
    }
  ): GoalIntakeState;
  setSequencePreference(sequencePreference: SequencePreference): GoalIntakeState;
  setMathDepth(
    mathDepth: GoalMathDepth,
    topicOverrides?: readonly TopicMathDepthOverrideInput[]
  ): GoalIntakeState;
  validate(): GoalIntakeValidationResult;
  buildStartGenerationRequest(
    idempotencyKeyOrOptions?: string | { readonly idempotencyKey?: string }
  ): StartGenerationRequestDescriptor;
}

function mapCanonicalDeadlinePolicy(policy: GoalDeadlinePolicy): CanonicalDeadlinePolicy {
  if (policy === "fixed_date" || policy === "fixed") {
    return "fixed";
  }
  if (policy === "target_duration" || policy === "flexible") {
    return "flexible";
  }
  return "no_deadline";
}

function mapCanonicalMathDepth(depth: GoalMathDepth): CanonicalMathDepth {
  if (depth === "formal") {
    return "formal";
  }
  if (depth === "intuition_first" || depth === "intuitive") {
    return "intuitive";
  }
  return "applied";
}

function mapCanonicalAccessMode(
  budgetPolicy: GoalBudgetPolicy,
  ownedSubscriptionIds: readonly string[],
  ownedResourceIds: readonly string[]
): CanonicalAccessPolicyMode {
  if (budgetPolicy === "capped_paid" || budgetPolicy === "allow_paid") {
    return "allow_paid";
  }
  if (budgetPolicy === "owned_only") {
    return "owned_only";
  }
  if (
    budgetPolicy === "free_or_owned" ||
    (budgetPolicy === "free_only" &&
      (ownedSubscriptionIds.length > 0 || ownedResourceIds.length > 0))
  ) {
    return "free_or_owned";
  }
  return "free_only";
}

function addDaysIsoDate(startDateIso: string, daysToAdd: number): string {
  const parsed = new Date(`${startDateIso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "2026-11-08";
  }
  parsed.setUTCDate(parsed.getUTCDate() + Math.max(1, Math.round(daysToAdd)));
  return parsed.toISOString().slice(0, 10);
}

function diffWeeksBetweenDates(startDateIso: string, endDateIso: string): number {
  const start = new Date(`${startDateIso}T00:00:00Z`);
  const end = new Date(`${endDateIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 2;
  }
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24 * 7));
}

function normalizeOverrides(
  raw: readonly TopicMathDepthOverrideInput[] | undefined
): NormalizedTopicMathDepthOverride[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: NormalizedTopicMathDepthOverride[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const topicId = (item.topicId ?? item.topic_id ?? "").trim();
    const uiDepth = item.mathDepth ?? item.math_depth ?? "applied";
    if (topicId && !seen.has(topicId)) {
      seen.add(topicId);
      result.push({
        topic_id: topicId,
        math_depth: mapCanonicalMathDepth(uiDepth),
        uiMathDepth: uiDepth,
      });
    }
  }
  return result;
}

/**
 * Creates a Goal Intake Form Controller (`UI-001`, `ADAPT-001`, `ADAPT-007`, `@S02`, `@S47`, `@S69`).
 *
 * - Keeps `math_depth` (`formal`, `intuition_first`, `application_focused`),
 *   `sequence_preference` (`theory_first`, `application_first`, `balanced`), and
 *   coarse `experienceLevel` completely independent (`@S47`, `@S69`).
 * - Enforces `free_only` vs `capped_paid` and `owned_subscription_ids` (`budgets.materials.max_minor_units === 0`
 *   whenever `free_only` or `free_or_owned` is selected).
 * - Prohibits setting `no_deadline` simultaneously with a non-null deadline date.
 * - Computes feasibility warnings when required point-estimate effort exceeds
 *   `availableWeeks * weeklyHoursCap` (`@S02`) without silently reducing `math_depth`.
 * - Binds `Idempotency-Key` via `buildOperationHeaders("startGeneration", { idempotencyKey })`.
 */
export function createGoalIntakeController(
  initialInput: GoalIntakeFormInput = {}
): GoalIntakeController {
  let goalTitle =
    initialInput.goalTitle ??
    initialInput.prompt ??
    "Learn LLM attention with mathematical derivations";
  let goalSummary =
    initialInput.goalSummary ??
    initialInput.prompt ??
    "Focused learning plan with explicit mathematical assumptions and hands-on verification.";
  let targetOutcomes: readonly string[] =
    initialInput.targetOutcomes ??
    initialInput.desired_outcomes ?? [
      "Derive and implement scaled dot-product attention under explicit assumptions.",
    ];
  let scopeMode:
    | "focused"
    | "broad_survey"
    | "role_preparation"
    | "certification_preparation" = initialInput.scopeMode ?? "focused";
  let deadlinePolicy: GoalDeadlinePolicy =
    initialInput.deadlinePolicy ?? initialInput.deadline_policy ?? "target_duration";
  let startDate = initialInput.startDate ?? initialInput.start_date ?? "2026-10-26";
  let targetDurationWeeks: number | null =
    initialInput.targetDurationWeeks ?? initialInput.availableWeeks ?? 2;
  let deadlineDate: string | null =
    initialInput.deadlineDate !== undefined
      ? initialInput.deadlineDate
      : initialInput.targetEndDate !== undefined
        ? initialInput.targetEndDate
        : initialInput.target_end_date !== undefined
          ? initialInput.target_end_date
          : deadlinePolicy === "no_deadline"
            ? null
            : addDaysIsoDate(startDate, (targetDurationWeeks ?? 2) * 7);

  const initialWeeklyMinutes =
    initialInput.weeklyMinutes ??
    initialInput.weekly_minutes ??
    (typeof initialInput.weeklyHoursCap === "number"
      ? Math.round(initialInput.weeklyHoursCap * 60)
      : 120);
  let weeklyHoursCap =
    typeof initialInput.weeklyHoursCap === "number"
      ? initialInput.weeklyHoursCap
      : Number((initialWeeklyMinutes / 60).toFixed(2));

  let requiredPointEffortMinutes =
    typeof initialInput.requiredPointEffortMinutes === "number"
      ? initialInput.requiredPointEffortMinutes
      : typeof initialInput.requiredPointEffortHours === "number"
        ? Math.round(initialInput.requiredPointEffortHours * 60)
        : 48;

  let budgetPolicy: GoalBudgetPolicy = initialInput.budgetPolicy ?? "free_only";
  let ownedSubscriptionIds: readonly string[] = [
    ...(initialInput.ownedSubscriptionIds ?? initialInput.owned_subscription_ids ?? []),
  ];
  let ownedResourceIds: readonly string[] = [
    ...(initialInput.ownedResourceIds ?? initialInput.owned_resource_ids ?? []),
  ];
  let rawMaterialsBudgetMinorUnits = initialInput.materialsBudgetMinorUnits ?? 0;
  let computeBudgetMinorUnits = initialInput.computeBudgetMinorUnits ?? 0;
  let inferenceBudgetMinorUnits = initialInput.inferenceBudgetMinorUnits ?? 100;
  let currency = initialInput.currency ?? "USD";

  let sequencePreference: SequencePreference =
    initialInput.sequencePreference ?? initialInput.sequence_preference ?? "balanced";
  let mathDepth: GoalMathDepth =
    initialInput.mathDepth ?? initialInput.math_depth ?? "application_focused";
  let topicMathDepthOverrides: NormalizedTopicMathDepthOverride[] = normalizeOverrides(
    initialInput.topicMathDepthOverrides ?? initialInput.topic_math_depth_overrides
  );
  let knownMaterialReview: "condensed" | "retain_full" | "skip_if_demonstrated" =
    initialInput.knownMaterialReview ?? "condensed";
  let experienceLevel: "beginner" | "intermediate" | "advanced" | "mixed" | "unknown" =
    initialInput.experienceLevel ?? "beginner";
  let backgroundSummary = initialInput.backgroundSummary ?? "Can write basic Python.";
  let proficiencySnapshotRef: string | null = initialInput.proficiencySnapshotRef ?? null;
  let timezone = initialInput.timezone ?? "America/New_York";
  let region = initialInput.region ?? "US";
  let playbackSpeed = initialInput.playbackSpeed ?? 1;
  let defaultIdempotencyKey = initialInput.idempotencyKey;

  function resolveMaterialsCapMinorUnits(): number {
    if (
      budgetPolicy === "free_only" ||
      budgetPolicy === "free_or_owned" ||
      budgetPolicy === "owned_only"
    ) {
      return 0;
    }
    return Math.max(0, rawMaterialsBudgetMinorUnits);
  }

  function getState(): GoalIntakeState {
    const canonicalDeadlinePolicy = mapCanonicalDeadlinePolicy(deadlinePolicy);
    const canonicalMathDepth = mapCanonicalMathDepth(mathDepth);
    const canonicalAccessPolicyMode = mapCanonicalAccessMode(
      budgetPolicy,
      ownedSubscriptionIds,
      ownedResourceIds
    );
    const weeklyMinutes = Math.max(30, Math.round(weeklyHoursCap * 60));

    return {
      goalTitle,
      goalSummary,
      targetOutcomes: [...targetOutcomes],
      deadlinePolicy,
      canonicalDeadlinePolicy,
      startDate,
      deadlineDate,
      targetDurationWeeks,
      weeklyHoursCap,
      weeklyMinutes,
      requiredPointEffortMinutes,
      budgetPolicy,
      canonicalAccessPolicyMode,
      ownedSubscriptionIds: [...ownedSubscriptionIds],
      owned_subscription_ids: [...ownedSubscriptionIds],
      ownedResourceIds: [...ownedResourceIds],
      materialsBudgetMinorUnits: resolveMaterialsCapMinorUnits(),
      computeBudgetMinorUnits,
      inferenceBudgetMinorUnits,
      currency,
      sequencePreference,
      sequence_preference: sequencePreference,
      mathDepth,
      math_depth: mathDepth,
      canonicalMathDepth,
      topicMathDepthOverrides: [...topicMathDepthOverrides],
      knownMaterialReview,
      experienceLevel,
      backgroundSummary,
      proficiencySnapshotRef,
      timezone,
      region,
      playbackSpeed,
    };
  }

  function update(patch: GoalIntakeFormInput): GoalIntakeState {
    if (patch.goalTitle !== undefined) {
      goalTitle = patch.goalTitle;
    }
    if (patch.goalSummary !== undefined) {
      goalSummary = patch.goalSummary;
    }
    if (patch.prompt !== undefined) {
      goalSummary = patch.prompt;
      if (patch.goalTitle === undefined) {
        goalTitle = patch.prompt;
      }
    }
    if (patch.targetOutcomes !== undefined) {
      targetOutcomes = [...patch.targetOutcomes];
    } else if (patch.desired_outcomes !== undefined) {
      targetOutcomes = [...patch.desired_outcomes];
    }
    if (patch.scopeMode !== undefined) {
      scopeMode = patch.scopeMode;
    }
    if (patch.startDate !== undefined || patch.start_date !== undefined) {
      startDate = patch.startDate ?? patch.start_date ?? startDate;
    }
    if (patch.deadlinePolicy !== undefined || patch.deadline_policy !== undefined) {
      deadlinePolicy = patch.deadlinePolicy ?? patch.deadline_policy ?? deadlinePolicy;
    }
    if (patch.targetDurationWeeks !== undefined || patch.availableWeeks !== undefined) {
      targetDurationWeeks =
        patch.targetDurationWeeks !== undefined
          ? patch.targetDurationWeeks
          : (patch.availableWeeks ?? null);
    }
    if (
      patch.deadlineDate !== undefined ||
      patch.targetEndDate !== undefined ||
      patch.target_end_date !== undefined
    ) {
      deadlineDate =
        patch.deadlineDate !== undefined
          ? patch.deadlineDate
          : patch.targetEndDate !== undefined
            ? patch.targetEndDate
            : (patch.target_end_date ?? null);
    }
    if (patch.weeklyHoursCap !== undefined) {
      weeklyHoursCap = patch.weeklyHoursCap;
    } else if (patch.weeklyMinutes !== undefined || patch.weekly_minutes !== undefined) {
      const wm = patch.weeklyMinutes ?? patch.weekly_minutes ?? 120;
      weeklyHoursCap = Number((wm / 60).toFixed(2));
    }
    if (patch.requiredPointEffortMinutes !== undefined) {
      requiredPointEffortMinutes = patch.requiredPointEffortMinutes;
    } else if (patch.requiredPointEffortHours !== undefined) {
      requiredPointEffortMinutes = Math.round(patch.requiredPointEffortHours * 60);
    }
    if (patch.budgetPolicy !== undefined) {
      budgetPolicy = patch.budgetPolicy;
    }
    if (
      patch.ownedSubscriptionIds !== undefined ||
      patch.owned_subscription_ids !== undefined
    ) {
      ownedSubscriptionIds = [
        ...(patch.ownedSubscriptionIds ?? patch.owned_subscription_ids ?? []),
      ];
    }
    if (patch.ownedResourceIds !== undefined || patch.owned_resource_ids !== undefined) {
      ownedResourceIds = [...(patch.ownedResourceIds ?? patch.owned_resource_ids ?? [])];
    }
    if (patch.materialsBudgetMinorUnits !== undefined) {
      rawMaterialsBudgetMinorUnits = patch.materialsBudgetMinorUnits;
    }
    if (patch.computeBudgetMinorUnits !== undefined) {
      computeBudgetMinorUnits = patch.computeBudgetMinorUnits;
    }
    if (patch.inferenceBudgetMinorUnits !== undefined) {
      inferenceBudgetMinorUnits = patch.inferenceBudgetMinorUnits;
    }
    if (patch.sequencePreference !== undefined || patch.sequence_preference !== undefined) {
      // Independent from mathDepth and experienceLevel (@S47, @S69)
      sequencePreference =
        patch.sequencePreference ?? patch.sequence_preference ?? sequencePreference;
    }
    if (patch.mathDepth !== undefined || patch.math_depth !== undefined) {
      // Independent from sequencePreference and experienceLevel (@S47, @S69)
      mathDepth = patch.mathDepth ?? patch.math_depth ?? mathDepth;
    }
    if (
      patch.topicMathDepthOverrides !== undefined ||
      patch.topic_math_depth_overrides !== undefined
    ) {
      topicMathDepthOverrides = normalizeOverrides(
        patch.topicMathDepthOverrides ?? patch.topic_math_depth_overrides
      );
    }
    if (patch.knownMaterialReview !== undefined) {
      knownMaterialReview = patch.knownMaterialReview;
    }
    if (patch.experienceLevel !== undefined) {
      experienceLevel = patch.experienceLevel;
    }
    if (patch.idempotencyKey !== undefined) {
      defaultIdempotencyKey = patch.idempotencyKey;
    }
    return getState();
  }

  function validate(): GoalIntakeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!goalTitle || goalTitle.trim().length === 0) {
      errors.push("Goal title or prompt is required.");
    }
    if (!targetOutcomes || targetOutcomes.length === 0) {
      errors.push("At least one target outcome is required.");
    }
    if (weeklyHoursCap <= 0) {
      errors.push("Weekly hours cap must be greater than zero.");
    }

    // Prohibit setting `no_deadline` simultaneously with a deadline date (`generation-request.schema.json` allOf)
    if (deadlinePolicy === "no_deadline" && deadlineDate !== null && deadlineDate !== "") {
      errors.push(
        "Cannot set a deadline date (target_end_date) when deadline_policy is no_deadline."
      );
    }

    if (
      deadlinePolicy !== "no_deadline" &&
      (!deadlineDate || deadlineDate.trim().length === 0) &&
      (targetDurationWeeks === null || targetDurationWeeks <= 0)
    ) {
      errors.push(
        "A deadline date or positive target duration in weeks is required when deadline_policy is not no_deadline."
      );
    }

    let feasibilityWarning: GoalFeasibilityWarning | null = null;
    if (deadlinePolicy !== "no_deadline") {
      const effectiveEndDate =
        deadlineDate && deadlineDate.trim().length > 0
          ? deadlineDate
          : addDaysIsoDate(startDate, (targetDurationWeeks ?? 2) * 7);
      const weeks =
        typeof targetDurationWeeks === "number" && targetDurationWeeks > 0
          ? targetDurationWeeks
          : diffWeeksBetweenDates(startDate, effectiveEndDate);
      const availableMinutes = Math.round(weeks * weeklyHoursCap * 60);

      if (requiredPointEffortMinutes > availableMinutes) {
        const shortfallMinutes = requiredPointEffortMinutes - availableMinutes;
        const minimumWeeklyHoursNeeded =
          weeks > 0 ? Number((requiredPointEffortMinutes / 60 / weeks).toFixed(2)) : weeklyHoursCap;
        const message = `Feasibility warning (@S02): required point-estimate effort (${requiredPointEffortMinutes} min) exceeds available capacity (${availableMinutes} min across ${weeks} weeks at ${weeklyHoursCap}h/week).`;
        warnings.push(message);
        feasibilityWarning = {
          hasWarning: true,
          code: "effort_exceeds_available_capacity",
          requiredMinutes: requiredPointEffortMinutes,
          availableMinutes,
          shortfallMinutes,
          availableWeeks: weeks,
          weeklyHoursCap,
          minimumWeeklyHoursNeeded,
          message,
          recoveryActions: [
            "extend_target_date",
            "increase_weekly_hours",
            "narrow_goal_scope",
          ],
          silentlyReducesMathDepth: false,
        };
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      feasibilityWarning,
    };
  }

  return {
    getState,
    update,
    setGoal(
      title: string,
      summary?: string,
      outcomes?: readonly string[]
    ): GoalIntakeState {
      goalTitle = title;
      if (summary !== undefined) {
        goalSummary = summary;
      }
      if (outcomes !== undefined) {
        targetOutcomes = [...outcomes];
      }
      return getState();
    },
    setDeadlinePolicy(
      policy: GoalDeadlinePolicy,
      options?: {
        readonly deadlineDate?: string | null;
        readonly targetDurationWeeks?: number | null;
        readonly startDate?: string;
      }
    ): GoalIntakeState {
      deadlinePolicy = policy;
      if (options?.startDate !== undefined) {
        startDate = options.startDate;
      }
      if (options?.targetDurationWeeks !== undefined) {
        targetDurationWeeks = options.targetDurationWeeks;
      }
      if (options?.deadlineDate !== undefined) {
        deadlineDate = options.deadlineDate;
      } else if (policy === "no_deadline") {
        deadlineDate = null;
      } else if (deadlineDate === null) {
        deadlineDate = addDaysIsoDate(startDate, (targetDurationWeeks ?? 2) * 7);
      }
      return getState();
    },
    setWeeklyHoursCap(nextHoursCap: number): GoalIntakeState {
      weeklyHoursCap = nextHoursCap;
      return getState();
    },
    setBudgetPolicy(
      nextBudgetPolicy: GoalBudgetPolicy,
      options?: {
        readonly ownedSubscriptionIds?: readonly string[];
        readonly owned_subscription_ids?: readonly string[];
        readonly ownedResourceIds?: readonly string[];
        readonly materialsBudgetMinorUnits?: number;
      }
    ): GoalIntakeState {
      budgetPolicy = nextBudgetPolicy;
      if (
        options?.ownedSubscriptionIds !== undefined ||
        options?.owned_subscription_ids !== undefined
      ) {
        ownedSubscriptionIds = [
          ...(options.ownedSubscriptionIds ?? options.owned_subscription_ids ?? []),
        ];
      }
      if (options?.ownedResourceIds !== undefined) {
        ownedResourceIds = [...options.ownedResourceIds];
      }
      if (options?.materialsBudgetMinorUnits !== undefined) {
        rawMaterialsBudgetMinorUnits = options.materialsBudgetMinorUnits;
      }
      return getState();
    },
    setSequencePreference(nextPref: SequencePreference): GoalIntakeState {
      sequencePreference = nextPref;
      return getState();
    },
    setMathDepth(
      nextDepth: GoalMathDepth,
      overrides?: readonly TopicMathDepthOverrideInput[]
    ): GoalIntakeState {
      mathDepth = nextDepth;
      if (overrides !== undefined) {
        topicMathDepthOverrides = normalizeOverrides(overrides);
      }
      return getState();
    },
    validate,
    buildStartGenerationRequest(
      idempotencyKeyOrOptions?: string | { readonly idempotencyKey?: string }
    ): StartGenerationRequestDescriptor {
      const validation = validate();
      if (!validation.valid) {
        throw new Error(`Invalid goal intake state: ${validation.errors.join(" ")}`);
      }

      const idempotencyKey =
        typeof idempotencyKeyOrOptions === "string"
          ? idempotencyKeyOrOptions
          : (idempotencyKeyOrOptions?.idempotencyKey ?? defaultIdempotencyKey);

      const headers = buildOperationHeaders(
        "startGeneration",
        idempotencyKey !== undefined ? { idempotencyKey } : {}
      );

      const state = getState();
      const targetEndDate =
        state.canonicalDeadlinePolicy === "no_deadline"
          ? null
          : (state.deadlineDate ??
            addDaysIsoDate(state.startDate, (state.targetDurationWeeks ?? 2) * 7));

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
          max_session_minutes: Math.min(240, Math.max(10, Math.round(state.weeklyMinutes / 3))),
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
          materials: {
            currency: state.currency,
            max_minor_units: state.materialsBudgetMinorUnits,
          },
          compute: {
            currency: state.currency,
            max_minor_units: state.computeBudgetMinorUnits,
          },
          inference: {
            currency: state.currency,
            max_minor_units: state.inferenceBudgetMinorUnits,
          },
        },
        inference: {
          mode: "hosted",
          model_policy_id: "synthetic-model-policy",
        },
        generation_options: {
          include_optional_certification: false,
          playback_speed: state.playbackSpeed,
          planning_horizon_days: Math.max(7, (state.targetDurationWeeks ?? 2) * 7),
          include_hands_on: true,
        },
        instruction_preferences: {
          math_depth: state.canonicalMathDepth,
          topic_math_depth_overrides: state.topicMathDepthOverrides.map((o) => ({
            topic_id: o.topic_id,
            math_depth: o.math_depth,
          })),
          known_material_review: state.knownMaterialReview,
        },
        template_origin: null,
      };

      return {
        operationId: "startGeneration",
        method: "POST",
        path: "/generations",
        headers,
        body: requestPayload,
        requestPayload,
        validation,
      };
    },
  };
}

export interface RevisionActivationOptions {
  readonly curriculumId?: string;
  readonly curriculum_id?: string;
  readonly revisionId?: string;
  readonly revision_id?: string;
  readonly ifMatch?: string;
  readonly etag?: string;
  readonly confirmed?: boolean;
  readonly confirmedByLearner?: boolean;
  readonly learnerConfirmed?: boolean;
  readonly acknowledgeScheduleChanges?: boolean;
  readonly acknowledge_schedule_changes?: boolean;
}

export interface RevisionActivationRequestDescriptor {
  readonly operationId: "activateCurriculumRevision";
  readonly method: "PUT";
  readonly path: string;
  readonly curriculumId: string;
  readonly revisionId: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly revision_id: string;
    readonly acknowledge_schedule_changes: boolean;
  };
  readonly confirmedByLearner: true;
  readonly autoActivated: false;
}

/**
 * Builds the `activateCurriculumRevision` request (`UI-002`, `@S24`, `@S53`):
 * - Requires an explicit learner confirmation action (`confirmedByLearner: true`),
 *   never auto-activating unreviewed revisions.
 * - Requires a non-empty `If-Match` precondition header via
 *   `buildOperationHeaders("activateCurriculumRevision", { ifMatch })`.
 */
export function buildRevisionActivationRequest(
  options: RevisionActivationOptions
): RevisionActivationRequestDescriptor {
  const confirmed =
    options.confirmedByLearner === true ||
    options.confirmed === true ||
    options.learnerConfirmed === true;
  if (!confirmed) {
    throw new Error(
      "Explicit learner confirmation (confirmedByLearner: true) is required before activating a curriculum revision; unreviewed revisions are never auto-activated."
    );
  }

  const curriculumId = (options.curriculumId ?? options.curriculum_id ?? "").trim();
  const revisionId = (options.revisionId ?? options.revision_id ?? "").trim();
  if (!curriculumId || !revisionId) {
    throw new Error("Both curriculumId and revisionId are required to activate a revision.");
  }

  const ifMatch = options.ifMatch ?? options.etag;
  const headers = buildOperationHeaders(
    "activateCurriculumRevision",
    ifMatch !== undefined ? { ifMatch } : {}
  );

  const acknowledgeScheduleChanges =
    options.acknowledgeScheduleChanges ?? options.acknowledge_schedule_changes ?? true;

  return {
    operationId: "activateCurriculumRevision",
    method: "PUT",
    path: `/curricula/${curriculumId}/active-revision`,
    curriculumId,
    revisionId,
    headers,
    body: {
      revision_id: revisionId,
      acknowledge_schedule_changes: Boolean(acknowledgeScheduleChanges),
    },
    confirmedByLearner: true,
    autoActivated: false,
  };
}

export type AsyncSurfaceRecoveryStateKind =
  | "ready"
  | "loading"
  | "generation_failed"
  | "no_eligible_resources"
  | "insufficient_credit"
  | "notification_permission_denied"
  | "offline_with_pending_progress"
  | "stale_source";

export interface AsyncSurfaceRecoveryBanner {
  readonly state: AsyncSurfaceRecoveryStateKind;
  readonly role: "status" | "alert";
  readonly title: string;
  readonly message: string;
  readonly actionableNextStep: string;
  readonly simulatedSuccessRendered: false;
}

export interface TodaySessionActivityItem {
  readonly activityId: string;
  readonly title: string;
  readonly type: string;
  readonly moduleId: string;
  readonly moduleTitle: string;
  readonly objectiveIds: readonly string[];
  readonly requirementLevel: "required" | "optional";
  readonly isOptionalEnrichment: boolean;
  readonly durationMinutes: number;
  readonly durationTriplet: {
    readonly min: number;
    readonly point: number;
    readonly max: number;
  };
  readonly executionStatus: ActivityExecutionStatus;
  readonly objectiveProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly resourceProvenanceLinks: readonly ResourceProvenanceCardView[];
  readonly scheduledReason: string;
}

export interface SessionReviewSeparationReport {
  readonly valid: boolean;
  readonly hasQuiz: boolean;
  readonly hasSpacedReview: boolean;
  readonly coScheduledQuizAndReviewInSameSession: boolean;
  readonly quizActivityIds: readonly string[];
  readonly reviewActivityIds: readonly string[];
  readonly separationSummary: string;
}

export interface TodaySessionCard {
  readonly sessionId: string;
  readonly startAt: string;
  readonly durationMinutes: number;
  readonly reminderEnabled: boolean;
  readonly activityIds: readonly string[];
  readonly activityBreakdown: readonly TodaySessionActivityItem[];
  readonly activities: readonly TodaySessionActivityItem[];
  readonly reviewSeparation: SessionReviewSeparationReport;
  readonly resourceProvenanceLinks: readonly ResourceProvenanceCardView[];
  readonly availableActions: readonly ["start", "snooze", "reschedule", "skip"];
}

export interface ProgressEventInput {
  readonly eventId?: string;
  readonly event_id?: string;
  readonly curriculumRevisionId?: string;
  readonly curriculum_revision_id?: string;
  readonly activityId?: string;
  readonly activity_id?: string;
  readonly type?: "self_reported_completed";
  readonly occurredAt?: string;
  readonly occurred_at?: string;
  readonly clientTimezone?: string;
  readonly client_timezone?: string;
  readonly note?: string | null;
  readonly timeSpentMinutes?: number;
  readonly time_spent_minutes?: number;
}

export interface RecordedProgressEventReceipt {
  readonly eventId: string;
  readonly curriculumRevisionId: string;
  readonly activityId: string;
  readonly type: "self_reported_completed";
  readonly occurredAt: string;
  readonly clientTimezone: string;
  readonly note: string | null;
  readonly timeSpentMinutes: number;
  readonly deduplicated: boolean;
  readonly isDuplicate: boolean;
  readonly activityExecutionStatus: "self_reported_completed";
  readonly objectiveProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly objectiveProficiencyDemonstrated: false;
  readonly totalStudyMinutes: number;
  readonly selfReportedCompletedCount: number;
}

export interface TodayViewState {
  readonly curriculumId: string;
  readonly curriculumRevisionId: string;
  readonly scheduleId: string;
  readonly scheduleRevisionId: string;
  readonly timezone: string;
  readonly weeklyMinutes: number;
  readonly todayCards: readonly TodaySessionCard[];
  readonly sessionCards: readonly TodaySessionCard[];
  readonly nextSession: TodaySessionCard | null;
  readonly activityExecutionStates: Readonly<Record<string, ActivityExecutionStatus>>;
  readonly objectiveProficiencyStates: Readonly<Record<string, ObjectiveProficiencyBadgeStatus>>;
  readonly totalStudyMinutes: number;
  readonly selfReportedCompletedCount: number;
  readonly recordedEventIds: readonly string[];
  readonly recordedEvents: readonly RecordedProgressEventReceipt[];
  readonly reviewSeparationValid: boolean;
  readonly asyncRecoveryBanner: AsyncSurfaceRecoveryBanner;
}

export interface TodayViewControllerOptions {
  readonly curriculum?: Record<string, unknown>;
  readonly schedule?: Record<string, unknown>;
  readonly proficiency?: Record<string, unknown> | null;
  readonly catalogResources?:
    | Readonly<Record<string, CatalogResourceMetadataInput>>
    | readonly CatalogResourceMetadataInput[];
  readonly initialActivityStates?: Readonly<Record<string, ActivityExecutionStatus>>;
}

export interface TodayViewController {
  getState(): TodayViewState;
  recordSelfReportedCompletion(event: ProgressEventInput): RecordedProgressEventReceipt;
  recordProgressEvent(event: ProgressEventInput): RecordedProgressEventReceipt;
  appendProgressEvent(event: ProgressEventInput): RecordedProgressEventReceipt;
  setAsyncRecoveryState(state: AsyncSurfaceRecoveryStateKind): AsyncSurfaceRecoveryBanner;
}

const ASYNC_RECOVERY_MESSAGES: Readonly<
  Record<
    AsyncSurfaceRecoveryStateKind,
    {
      readonly role: "status" | "alert";
      readonly title: string;
      readonly message: string;
      readonly actionableNextStep: string;
    }
  >
> = {
  ready: {
    role: "status",
    title: "Today study queue ready",
    message: "Your scheduled sessions and verified resource links are ready.",
    actionableNextStep: "Select Start on the next feasible session.",
  },
  loading: {
    role: "status",
    title: "Loading study queue",
    message: "Fetching the active curriculum revision and schedule.",
    actionableNextStep: "Wait for synchronization or open the cached Outline.",
  },
  generation_failed: {
    role: "alert",
    title: "Curriculum generation failed",
    message: "The generation job did not produce a valid plan.",
    actionableNextStep: "Retry generation with your saved intake draft or adjust constraints.",
  },
  no_eligible_resources: {
    role: "alert",
    title: "No eligible catalog resources matched",
    message: "Approved catalog coverage was insufficient for the current filter constraints.",
    actionableNextStep: "Broaden resource types or allow owned subscriptions in Goal Intake.",
  },
  insufficient_credit: {
    role: "alert",
    title: "Insufficient hosted AI credit",
    message: "Your hosted wallet balance cannot cover the estimated generation ceiling.",
    actionableNextStep: "Top up hosted credits or configure an approved BYOK connection.",
  },
  notification_permission_denied: {
    role: "status",
    title: "Browser notification permission denied",
    message: "Study reminders cannot be delivered via Web Push while permission is blocked.",
    actionableNextStep: "Use the in-app Today view or enable notification permissions in Settings.",
  },
  offline_with_pending_progress: {
    role: "alert",
    title: "Offline with pending self-reported progress",
    message: "Your progress event is retained locally with its stable event_id.",
    actionableNextStep: "Retry synchronization when reconnected; duplicate retries will not double-count.",
  },
  stale_source: {
    role: "alert",
    title: "Resource link or revision is stale",
    message: "A newer curriculum revision or catalog replacement is available.",
    actionableNextStep: "Refresh the plan or inspect replacement resources.",
  },
};

function normalizeTodayArgs(
  firstArg: Record<string, unknown> | TodayViewControllerOptions,
  secondArg?: Record<string, unknown>,
  thirdArg?: Record<string, unknown> | null,
  fourthArg?:
    | Readonly<Record<string, CatalogResourceMetadataInput>>
    | readonly CatalogResourceMetadataInput[]
): TodayViewControllerOptions {
  if (
    firstArg &&
    typeof firstArg === "object" &&
    "curriculum" in firstArg &&
    "schedule" in firstArg &&
    firstArg["curriculum"] &&
    typeof firstArg["curriculum"] === "object"
  ) {
    return firstArg as TodayViewControllerOptions;
  }
  return {
    curriculum: (firstArg as Record<string, unknown>) ?? {},
    schedule: secondArg ?? {},
    proficiency: thirdArg ?? null,
    ...(fourthArg ? { catalogResources: fourthArg } : {}),
  };
}

/**
 * Creates the `Today` Study Queue & Idempotent Progress Controller
 * (`UI-003`..`UI-006`, `@S17`, `@S19`, `@S23`, `@S24`, `@S26`, `@S27`, `@S84`).
 */
export function createTodayViewController(
  curriculumOrOptions: Record<string, unknown> | TodayViewControllerOptions,
  scheduleArg?: Record<string, unknown>,
  proficiencyArg?: Record<string, unknown> | null,
  catalogResourcesArg?:
    | Readonly<Record<string, CatalogResourceMetadataInput>>
    | readonly CatalogResourceMetadataInput[]
): TodayViewController {
  const opts = normalizeTodayArgs(
    curriculumOrOptions,
    scheduleArg,
    proficiencyArg,
    catalogResourcesArg
  );
  const curriculum = opts.curriculum ?? {};
  const schedule = opts.schedule ?? {};
  const proficiency = opts.proficiency ?? null;

  const activityStates: Record<string, ActivityExecutionStatus> = {
    ...(opts.initialActivityStates ?? {}),
  };
  const recordedEventsById = new Map<string, RecordedProgressEventReceipt>();
  let totalStudyMinutes = 0;
  let selfReportedCompletedCount = 0;
  let asyncRecoveryState: AsyncSurfaceRecoveryStateKind = "ready";

  function buildBanner(state: AsyncSurfaceRecoveryStateKind): AsyncSurfaceRecoveryBanner {
    const meta = ASYNC_RECOVERY_MESSAGES[state];
    return {
      state,
      role: meta.role,
      title: meta.title,
      message: meta.message,
      actionableNextStep: meta.actionableNextStep,
      simulatedSuccessRendered: false,
    };
  }

  function getState(): TodayViewState {
    const planModel = buildPlanMapAndOutlineModel({
      curriculum,
      proficiency,
      activityStates,
      ...(opts.catalogResources ? { catalogResources: opts.catalogResources } : {}),
    });

    const activityById = new Map(planModel.outlineActivities.map((a) => [a.activityId, a]));
    const moduleById = new Map(planModel.outlineModules.map((m) => [m.moduleId, m]));

    const activityExecutionStates: Record<string, ActivityExecutionStatus> = {};
    for (const act of planModel.outlineActivities) {
      activityExecutionStates[act.activityId] = act.executionStatus;
    }

    const objectiveProficiencyStates: Record<string, ObjectiveProficiencyBadgeStatus> = {};
    for (const obj of planModel.objectiveTracks) {
      objectiveProficiencyStates[obj.objectiveId] = obj.proficiencyStatus;
    }

    const rawSessions = Array.isArray(schedule["sessions"]) ? schedule["sessions"] : [];
    const todayCards: TodaySessionCard[] = rawSessions
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
      .map((rawSession) => {
        const sessionId =
          typeof rawSession["session_id"] === "string" ? rawSession["session_id"] : "session";
        const startAt =
          typeof rawSession["start_at"] === "string"
            ? rawSession["start_at"]
            : "2026-10-26T18:00:00-04:00";
        const durationMinutes =
          typeof rawSession["duration_minutes"] === "number"
            ? rawSession["duration_minutes"]
            : 0;
        const reminderEnabled = rawSession["reminder_enabled"] === true;
        const activityIds = Array.isArray(rawSession["activity_ids"])
          ? rawSession["activity_ids"].filter((id): id is string => typeof id === "string")
          : [];

        const quizActivityIds: string[] = [];
        const reviewActivityIds: string[] = [];
        const quizObjectives = new Set<string>();
        const reviewObjectives = new Set<string>();

        const activityBreakdown: TodaySessionActivityItem[] = activityIds.map((actId) => {
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

          const scheduledReason =
            actType === "review"
              ? "Spaced review scheduled in a separate session after initial quiz (@S19)."
              : actType === "quiz"
                ? "Formative check for objective readiness."
                : `Core ${actType} step in ${ownerMod?.title ?? "active module"}.`;

          return {
            activityId: actId,
            title: outlineAct?.title ?? actId,
            type: actType,
            moduleId: outlineAct?.moduleId ?? "module-default",
            moduleTitle: ownerMod?.title ?? "Module",
            objectiveIds: objIds,
            requirementLevel: outlineAct?.requirementLevel ?? "required",
            isOptionalEnrichment: outlineAct?.isOptionalEnrichment ?? false,
            durationMinutes: outlineAct?.durationTriplet.point ?? 0,
            durationTriplet: {
              min: outlineAct?.durationTriplet.min ?? 0,
              point: outlineAct?.durationTriplet.point ?? 0,
              max: outlineAct?.durationTriplet.max ?? 0,
            },
            executionStatus: outlineAct?.executionStatus ?? "not_started",
            objectiveProficiencyStatus: outlineAct?.objectiveProficiencyStatus ?? "unassessed",
            resourceProvenanceLinks: outlineAct?.resourceProvenanceCards ?? [],
            scheduledReason,
          };
        });

        let coScheduledSameObjective = false;
        for (const oid of reviewObjectives) {
          if (quizObjectives.has(oid)) {
            coScheduledSameObjective = true;
          }
        }
        const coScheduledQuizAndReviewInSameSession =
          coScheduledSameObjective ||
          (quizActivityIds.length > 0 && reviewActivityIds.length > 0);

        const reviewSeparation: SessionReviewSeparationReport = {
          valid: !coScheduledQuizAndReviewInSameSession,
          hasQuiz: quizActivityIds.length > 0,
          hasSpacedReview: reviewActivityIds.length > 0,
          coScheduledQuizAndReviewInSameSession,
          quizActivityIds,
          reviewActivityIds,
          separationSummary: !coScheduledQuizAndReviewInSameSession
            ? reviewActivityIds.length > 0
              ? "Spaced review is separated into a later session from initial quiz (@S19)."
              : "No spaced-review collision in this session."
            : "Violation (@S19): spaced review must not share the same session as the initial quiz.",
        };

        const resourceProvenanceLinks = activityBreakdown.flatMap(
          (a) => a.resourceProvenanceLinks
        );

        return {
          sessionId,
          startAt,
          durationMinutes,
          reminderEnabled,
          activityIds,
          activityBreakdown,
          activities: activityBreakdown,
          reviewSeparation,
          resourceProvenanceLinks,
          availableActions: ["start", "snooze", "reschedule", "skip"] as const,
        };
      });

    const nextSession =
      todayCards.find((card) =>
        card.activityBreakdown.some(
          (a) => a.executionStatus === "not_started" || a.executionStatus === "in_progress"
        )
      ) ??
      todayCards[0] ??
      null;

    return {
      curriculumId: planModel.curriculumId,
      curriculumRevisionId: planModel.revisionId,
      scheduleId:
        typeof schedule["schedule_id"] === "string"
          ? schedule["schedule_id"]
          : "synthetic-schedule-1",
      scheduleRevisionId:
        typeof schedule["schedule_revision_id"] === "string"
          ? schedule["schedule_revision_id"]
          : "synthetic-schedule-revision-1",
      timezone:
        typeof schedule["timezone"] === "string" ? schedule["timezone"] : "America/New_York",
      weeklyMinutes:
        typeof schedule["weekly_minutes"] === "number" ? schedule["weekly_minutes"] : 120,
      todayCards,
      sessionCards: todayCards,
      nextSession,
      activityExecutionStates,
      objectiveProficiencyStates,
      totalStudyMinutes,
      selfReportedCompletedCount,
      recordedEventIds: Array.from(recordedEventsById.keys()),
      recordedEvents: Array.from(recordedEventsById.values()),
      reviewSeparationValid: todayCards.every((c) => c.reviewSeparation.valid),
      asyncRecoveryBanner: buildBanner(asyncRecoveryState),
    };
  }

  function recordSelfReportedCompletion(
    event: ProgressEventInput
  ): RecordedProgressEventReceipt {
    const eventId = (event.eventId ?? event.event_id ?? "").trim();
    if (!eventId) {
      throw new Error("A stable non-empty client event_id is required to record progress.");
    }

    // Idempotent deduplication (`@S21`, `@S24`): repeated clicks or retries with the same
    // `event_id` MUST NOT double-count study minutes or completion counts.
    const existing = recordedEventsById.get(eventId);
    if (existing) {
      return {
        ...existing,
        deduplicated: true,
        isDuplicate: true,
        totalStudyMinutes,
        selfReportedCompletedCount,
      };
    }

    const activityId = (event.activityId ?? event.activity_id ?? "").trim();
    if (!activityId) {
      throw new Error("activity_id is required to record progress.");
    }

    const initialPlan = buildPlanMapAndOutlineModel({
      curriculum,
      proficiency,
      activityStates,
    });
    const matchedAct = initialPlan.outlineActivities.find((a) => a.activityId === activityId);
    const defaultMinutes = matchedAct?.durationTriplet.point ?? 10;
    const rawMinutes = event.timeSpentMinutes ?? event.time_spent_minutes ?? defaultMinutes;
    const timeSpentMinutes = Math.max(0, Math.round(rawMinutes));

    const previousExecStatus = activityStates[activityId] ?? "not_started";
    activityStates[activityId] = "self_reported_completed";

    if (
      previousExecStatus !== "self_reported_completed" &&
      previousExecStatus !== "completed"
    ) {
      selfReportedCompletedCount += 1;
    }
    totalStudyMinutes += timeSpentMinutes;

    const updatedPlan = buildPlanMapAndOutlineModel({
      curriculum,
      proficiency,
      activityStates,
    });
    const updatedAct = updatedPlan.outlineActivities.find((a) => a.activityId === activityId);
    const rawProfStatus = updatedAct?.objectiveProficiencyStatus ?? "unassessed";
    // Never conflate `self_reported_completed` activity completion with `demonstrated` proficiency (@S17, @S23)
    const honestProficiencyStatus: ObjectiveProficiencyBadgeStatus =
      rawProfStatus === "demonstrated" ? "unassessed" : rawProfStatus;

    const receipt: RecordedProgressEventReceipt = {
      eventId,
      curriculumRevisionId:
        event.curriculumRevisionId ??
        event.curriculum_revision_id ??
        updatedPlan.revisionId,
      activityId,
      type: "self_reported_completed",
      occurredAt:
        event.occurredAt ?? event.occurred_at ?? "2026-10-26T18:10:00-04:00",
      clientTimezone:
        event.clientTimezone ?? event.client_timezone ?? "America/New_York",
      note: event.note ?? null,
      timeSpentMinutes,
      deduplicated: false,
      isDuplicate: false,
      activityExecutionStatus: "self_reported_completed",
      objectiveProficiencyStatus: honestProficiencyStatus,
      objectiveProficiencyDemonstrated: false,
      totalStudyMinutes,
      selfReportedCompletedCount,
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
