/**
 * Synchronized `Plan` `Outline` + Basic Interactive `Map` Renderer & View-Model
 * (`UI-001`..`UI-005`, `UI-014`, `@S17`, `@S23`, `@S25`, `@S26`, `@S75`, `@S76`).
 *
 * Guarantees:
 * 1. Topological ordering of modules, objectives, and activities with deterministic
 *    DAG layout coordinates (`layer`, `column`, `x`, `y`).
 * 2. Honest two-layer status badges:
 *    - Activity execution badge: `not_started` | `in_progress` | `self_reported_completed` | `completed` | `waived`
 *    - Objective proficiency badge: `unassessed` | `self_reported` | `in_progress` | `needs_review` | `demonstrated`
 *    Never conflates `self_reported_completed` activity execution with `demonstrated`
 *    objective proficiency (`@S17`, `@S23`).
 * 3. Duration triplets (`min` / `point` / `max` minutes) adjusted by playback speed via
 *    ceiling math (`ceil_per_activity`).
 * 4. Resource provenance cards with verified publisher, version timestamp, access model,
 *    rights badge, and separate optional certification badge (`UI-004`, `UI-005`, `@S39`).
 * 5. Explicit `mastery_gated` flags and non-blocking prerequisite bridge recommendations
 *    when studying ahead on non-gated activities (`@S75`).
 * 6. 100% `Map` <-> `Outline` equivalence (`@S75`) with keyboard navigation
 *    (`ArrowRight`, `ArrowLeft`, `ArrowDown`, `ArrowUp`, `Enter`) and non-dragging
 *    viewport controls (`zoomIn`, `zoomOut`, `resetView`, `focusNeighborhood`).
 * 7. Compact mobile neighborhood mode (`< 768px`) showing the selected module's
 *    immediate prerequisite and dependent neighborhood plus a vertical task list
 *    (`UI-002`, `UI-003`, `@S75`, `@S76`).
 */

import {
  ALLOWLISTED_ACTIVITY_TYPES,
  isSafeResourceUrl,
  renderUntrustedCatalogText,
  type AllowlistedActivityType,
} from "./SafeActivityRenderer.ts";

export const ACTIVITY_EXECUTION_STATUSES = [
  "not_started",
  "in_progress",
  "self_reported_completed",
  "completed",
  "waived",
] as const;

export type ActivityExecutionStatus = (typeof ACTIVITY_EXECUTION_STATUSES)[number];

export const OBJECTIVE_PROFICIENCY_BADGE_STATUSES = [
  "unassessed",
  "self_reported",
  "in_progress",
  "needs_review",
  "demonstrated",
] as const;

export type ObjectiveProficiencyBadgeStatus =
  (typeof OBJECTIVE_PROFICIENCY_BADGE_STATUSES)[number];

export const MAP_KEYBOARD_KEYS = [
  "ArrowRight",
  "ArrowLeft",
  "ArrowDown",
  "ArrowUp",
  "Enter",
] as const;

export type MapKeyboardKey = (typeof MAP_KEYBOARD_KEYS)[number];

export const SYNCHRONIZED_NODE_ACTIONS = [
  "select_node",
  "open_details",
  "inspect_prerequisites",
  "focus_neighborhood",
  "study_ahead",
] as const;

export type SynchronizedNodeAction = (typeof SYNCHRONIZED_NODE_ACTIONS)[number];

export interface DurationTripletView {
  readonly min: number;
  readonly point: number;
  readonly max: number;
  readonly minMinutes: number;
  readonly pointMinutes: number;
  readonly maxMinutes: number;
  readonly mediaMinutesAt1x: number;
  readonly nonMediaMinutesAt1x: number;
  readonly playbackSpeed: number;
  readonly rounding: "ceil_per_activity";
  readonly rangeInterpretation: "planning_bounds_not_confidence_interval";
}

export interface ActivityExecutionBadgeView {
  readonly layer: "activity_execution";
  readonly status: ActivityExecutionStatus;
  readonly label: string;
  readonly nonColorCue: string;
  readonly countsAsDemonstratedProficiency: false;
}

export interface ObjectiveProficiencyBadgeView {
  readonly layer: "objective_proficiency";
  readonly objectiveId: string;
  readonly status: ObjectiveProficiencyBadgeStatus;
  readonly label: string;
  readonly nonColorCue: string;
  readonly evidenceSupport: "none" | "limited" | "corroborated";
  readonly evidenceRefs: readonly string[];
  readonly selfReportedActivityCompleted: boolean;
  readonly conflatedWithActivityCompletion: false;
}

export interface PrerequisiteBadgeView {
  readonly edgeId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly kind: "module_prerequisite" | "objective_prerequisite" | "activity_prerequisite";
  readonly relationshipLabel: string;
  readonly textMeaning: string;
  readonly satisfied: boolean;
}

export interface RightsBadgeView {
  readonly basis: string;
  readonly label: string;
  readonly displayExcerptsAllowed: boolean;
  readonly externalLinkOnly: boolean;
}

export interface OptionalCertificationBadgeView {
  readonly included: boolean;
  readonly relationship: "optional_preparation" | "none";
  readonly label: string;
  readonly rationale: string | null;
  readonly verifiedIssuerUrl: string | null;
  readonly isAccreditedQualificationGuarantee: false;
}

export interface ResourceProvenanceCardView {
  readonly resourceVersionId: string;
  readonly role: "primary" | "supplemental";
  readonly title: string;
  readonly verifiedPublisher: string;
  readonly versionTimestamp: string;
  readonly accessModel: string;
  readonly rightsBadge: RightsBadgeView;
  readonly optionalCertificationBadge: OptionalCertificationBadgeView | null;
  readonly selectionRationale: string;
  readonly verifiedSegments: readonly string[];
  readonly canonicalUrl: string | null;
  readonly omitsUnverifiedPrecision: true;
}

export interface PrerequisiteBridgeRecommendation {
  readonly recommended: boolean;
  readonly blocking: boolean;
  readonly masteryGated: boolean;
  readonly reason: string;
  readonly unmetPrerequisiteActivityIds: readonly string[];
  readonly unmetPrerequisiteObjectiveIds: readonly string[];
  readonly suggestedBridgeActivityIds: readonly string[];
}

export interface OutlineActivityView {
  readonly activityId: string;
  readonly moduleId: string;
  readonly title: string;
  readonly type: AllowlistedActivityType;
  readonly activityType: AllowlistedActivityType;
  readonly requirementLevel: "required" | "optional";
  readonly required: boolean;
  readonly isOptionalEnrichment: boolean;
  readonly objectiveIds: readonly string[];
  readonly prerequisiteActivityIds: readonly string[];
  readonly prerequisiteBadges: readonly PrerequisiteBadgeView[];
  readonly durationTriplet: DurationTripletView;
  readonly resourceProvenanceCards: readonly ResourceProvenanceCardView[];
  readonly executionStatus: ActivityExecutionStatus;
  readonly executionBadge: ActivityExecutionBadgeView;
  readonly objectiveProficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly objectiveProficiencyBadge: ObjectiveProficiencyBadgeView;
  readonly objectiveProficiencyBadges: readonly ObjectiveProficiencyBadgeView[];
  readonly masteryGated: boolean;
  readonly unmetPrerequisiteActivityIds: readonly string[];
  readonly unmetPrerequisiteObjectiveIds: readonly string[];
  readonly studyAheadAllowed: boolean;
  readonly prerequisiteBridgeRecommendation: PrerequisiteBridgeRecommendation | null;
  readonly promptSummary: string;
  readonly availableActions: readonly SynchronizedNodeAction[];
}

export interface ObjectiveTrackView {
  readonly objectiveId: string;
  readonly objectiveVersionId: string;
  readonly topicId: string;
  readonly moduleId: string | null;
  readonly title: string;
  readonly description: string;
  readonly successCriterion: string;
  readonly level: "introductory" | "applied" | "advanced";
  readonly requirementLevel: "required" | "optional";
  readonly required: boolean;
  readonly topologicalIndex: number;
  readonly layer: number;
  readonly column: number;
  readonly prerequisiteObjectiveIds: readonly string[];
  readonly dependentObjectiveIds: readonly string[];
  readonly prerequisiteBadges: readonly PrerequisiteBadgeView[];
  readonly assessmentActivityIds: readonly string[];
  readonly activityIds: readonly string[];
  readonly proficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly proficiencyBadge: ObjectiveProficiencyBadgeView;
  readonly executionStatus: ActivityExecutionStatus;
  readonly executionBadge: ActivityExecutionBadgeView;
  readonly coverageLimitation: {
    readonly missingRequirement: string;
    readonly explanation: string;
  } | null;
  readonly availableActions: readonly SynchronizedNodeAction[];
}

export interface OutlineModuleView {
  readonly moduleId: string;
  readonly title: string;
  readonly summary: string;
  readonly topologicalIndex: number;
  readonly layer: number;
  readonly column: number;
  readonly requirementLevel: "required" | "optional";
  readonly required: boolean;
  readonly objectiveIds: readonly string[];
  readonly objectives: readonly ObjectiveTrackView[];
  readonly activityIds: readonly string[];
  readonly activities: readonly OutlineActivityView[];
  readonly prerequisiteModuleIds: readonly string[];
  readonly dependentModuleIds: readonly string[];
  readonly prerequisiteBadges: readonly PrerequisiteBadgeView[];
  readonly durationTriplet: DurationTripletView;
  readonly executionStatus: ActivityExecutionStatus;
  readonly executionBadge: ActivityExecutionBadgeView;
  readonly proficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly proficiencyBadge: ObjectiveProficiencyBadgeView;
  readonly hasMasteryGatedActivities: boolean;
  readonly availableActions: readonly SynchronizedNodeAction[];
}

export interface MapNodeView {
  readonly nodeId: string;
  readonly id: string;
  readonly kind: "module" | "objective";
  readonly title: string;
  readonly layer: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly required: boolean;
  readonly requirementLevel: "required" | "optional";
  readonly prerequisiteIds: readonly string[];
  readonly dependentIds: readonly string[];
  readonly prerequisiteBadges: readonly PrerequisiteBadgeView[];
  readonly executionStatus: ActivityExecutionStatus;
  readonly executionBadge: ActivityExecutionBadgeView;
  readonly proficiencyStatus: ObjectiveProficiencyBadgeStatus;
  readonly proficiencyBadge: ObjectiveProficiencyBadgeView;
  readonly statusBadge: {
    readonly execution: ActivityExecutionBadgeView;
    readonly proficiency: ObjectiveProficiencyBadgeView;
  };
  readonly durationTriplet: DurationTripletView | null;
  readonly selected: boolean;
  readonly inFocusedNeighborhood: boolean;
  readonly opaqueSurface: true;
  readonly availableActions: readonly SynchronizedNodeAction[];
}

export interface MapEdgeView {
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: "module_prerequisite" | "objective_prerequisite";
  readonly relationshipLabel: string;
  readonly arrowMeaning: "prerequisite_dependency";
  readonly textMeaning: string;
  readonly satisfied: boolean;
  readonly points: {
    readonly fromX: number;
    readonly fromY: number;
    readonly toX: number;
    readonly toY: number;
  };
}

export interface SvgViewportModel {
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly focusedModuleId: string | null;
  readonly focusedNodeId: string | null;
  readonly opaqueSurface: true;
  readonly requiresPointerDragging: false;
  readonly controls: {
    zoomIn(): PlanMapAndOutlineModel;
    zoomOut(): PlanMapAndOutlineModel;
    resetView(): PlanMapAndOutlineModel;
    focusNeighborhood(moduleOrNodeId: string): PlanMapAndOutlineModel;
  };
}

export interface MobileNeighborhoodView {
  readonly isCompactMobile: boolean;
  readonly viewportWidthPx: number;
  readonly selectedModuleId: string | null;
  readonly selectedModule: OutlineModuleView | null;
  readonly immediatePrerequisiteModuleIds: readonly string[];
  readonly immediateDependentModuleIds: readonly string[];
  readonly neighborhoodModuleIds: readonly string[];
  readonly verticalTaskList: readonly OutlineActivityView[];
  readonly nextActionActivityId: string | null;
  readonly shrinksDesktopGraph: false;
}

export interface MapOutlineEquivalenceSummary {
  readonly isEquivalent: true;
  readonly everyMapNodeInOutline: boolean;
  readonly everyPrerequisiteEdgeInOutline: boolean;
  readonly everyStatusBadgeEquivalent: boolean;
  readonly everyActionEquivalent: boolean;
  readonly requiresPointerDragging: false;
}

export interface CatalogResourceMetadataInput {
  readonly resource_version_id?: string;
  readonly title?: string;
  readonly canonical_url?: string;
  readonly captured_at?: string;
  readonly provider?: {
    readonly provider_id?: string;
    readonly display_name?: string;
  };
  readonly access?: {
    readonly model?: string;
    readonly certificate_included?: boolean;
    readonly access_verified_at?: string;
  };
  readonly ingestion_permissions?: {
    readonly basis?: string;
    readonly permissions?: {
      readonly display_excerpts?: string;
    };
  };
  readonly segments?: readonly {
    readonly segment_id?: string;
    readonly title?: string;
    readonly verified?: boolean;
  }[];
}

export interface PlanMapAndOutlineBuildOptions {
  readonly curriculum?: Record<string, unknown>;
  readonly proficiency?: Record<string, unknown> | null;
  readonly activityStates?: Readonly<Record<string, ActivityExecutionStatus | string>>;
  readonly catalogResources?: Readonly<
    Record<string, CatalogResourceMetadataInput>
  > | readonly CatalogResourceMetadataInput[];
  readonly playbackSpeed?: number;
  readonly viewportWidthPx?: number;
  readonly selectedModuleId?: string | null;
  readonly selectedActivityId?: string | null;
  readonly focusedNodeId?: string | null;
  readonly zoom?: number;
  readonly panX?: number;
  readonly panY?: number;
  readonly studyAheadActivityIds?: readonly string[];
}

export interface PlanMapAndOutlineModel {
  readonly curriculumId: string;
  readonly revisionId: string;
  readonly schemaVersion: string;
  readonly goal: {
    readonly title: string;
    readonly summary: string;
    readonly includedTopics: readonly string[];
    readonly excludedTopics: readonly string[];
    readonly scopeNote: string;
  };
  readonly durationPolicy: {
    readonly playbackSpeed: number;
    readonly rounding: "ceil_per_activity";
    readonly policyVersion: string;
  };
  readonly totalDurationTriplet: DurationTripletView;
  readonly outlineModules: readonly OutlineModuleView[];
  readonly outlineActivities: readonly OutlineActivityView[];
  readonly objectiveTracks: readonly ObjectiveTrackView[];
  readonly mapNodes: readonly MapNodeView[];
  readonly moduleMapNodes: readonly MapNodeView[];
  readonly objectiveMapNodes: readonly MapNodeView[];
  readonly mapEdges: readonly MapEdgeView[];
  readonly svgViewport: SvgViewportModel;
  readonly keyboardOrder: readonly string[];
  readonly selectedModuleId: string | null;
  readonly selectedActivityId: string | null;
  readonly focusedNodeId: string | null;
  readonly mobileNeighborhood: MobileNeighborhoodView;
  readonly equivalence: MapOutlineEquivalenceSummary;
  zoomIn(): PlanMapAndOutlineModel;
  zoomOut(): PlanMapAndOutlineModel;
  resetView(): PlanMapAndOutlineModel;
  focusNeighborhood(moduleOrNodeId: string): PlanMapAndOutlineModel;
  navigateKeyboard(key: MapKeyboardKey, fromNodeId?: string): PlanMapAndOutlineModel;
}

const EXECUTION_BADGE_LABELS: Readonly<
  Record<ActivityExecutionStatus, { readonly label: string; readonly nonColorCue: string }>
> = {
  not_started: {
    label: "Not started",
    nonColorCue: "[ ] Not started",
  },
  in_progress: {
    label: "In progress",
    nonColorCue: "[~] In progress",
  },
  self_reported_completed: {
    label: "Self-reported complete (unverified)",
    nonColorCue: "[self] Self-reported complete — assessment required for competence",
  },
  completed: {
    label: "Completed",
    nonColorCue: "[✓] Completed",
  },
  waived: {
    label: "Waived by reviewed evidence",
    nonColorCue: "[↦] Waived (not completed)",
  },
};

const PROFICIENCY_BADGE_LABELS: Readonly<
  Record<ObjectiveProficiencyBadgeStatus, { readonly label: string; readonly nonColorCue: string }>
> = {
  unassessed: {
    label: "Unassessed",
    nonColorCue: "○ Unassessed (no reviewed evidence)",
  },
  self_reported: {
    label: "Self-reported only",
    nonColorCue: "◐ Self-reported claim (unverified)",
  },
  in_progress: {
    label: "In progress",
    nonColorCue: "◔ Practice in progress",
  },
  needs_review: {
    label: "Needs review",
    nonColorCue: "◑ Due for spaced review or additional practice",
  },
  demonstrated: {
    label: "Demonstrated",
    nonColorCue: "● Demonstrated via reviewed assessment evidence",
  },
};

function sanitizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const clean = renderUntrustedCatalogText(value, { maxLength: 1600 }).text;
  return clean || fallback;
}

function normalizeExecutionStatus(raw: unknown, isWaived = false): ActivityExecutionStatus {
  if (isWaived) {
    return "waived";
  }
  if (typeof raw === "string") {
    if ((ACTIVITY_EXECUTION_STATUSES as readonly string[]).includes(raw)) {
      return raw as ActivityExecutionStatus;
    }
    if (raw === "self_reported_skipped") {
      return "not_started";
    }
  }
  return "not_started";
}

function makeExecutionBadge(status: ActivityExecutionStatus): ActivityExecutionBadgeView {
  const meta = EXECUTION_BADGE_LABELS[status];
  return {
    layer: "activity_execution",
    status,
    label: meta.label,
    nonColorCue: meta.nonColorCue,
    countsAsDemonstratedProficiency: false,
  };
}

function computeComponentDurationSum(bounds: Record<string, unknown>): {
  readonly media: number;
  readonly nonMedia: number;
  readonly totalAt1x: number;
} {
  const media = typeof bounds["media_minutes"] === "number" ? Math.max(0, bounds["media_minutes"]) : 0;
  const reading =
    typeof bounds["reading_minutes"] === "number" ? Math.max(0, bounds["reading_minutes"]) : 0;
  const practice =
    typeof bounds["practice_minutes"] === "number" ? Math.max(0, bounds["practice_minutes"]) : 0;
  const assessment =
    typeof bounds["assessment_minutes"] === "number" ? Math.max(0, bounds["assessment_minutes"]) : 0;
  const review =
    typeof bounds["review_minutes"] === "number" ? Math.max(0, bounds["review_minutes"]) : 0;
  const nonMedia = reading + practice + assessment + review;
  return {
    media,
    nonMedia,
    totalAt1x: media + nonMedia,
  };
}

/**
 * Computes an activity's duration triplet (`min` / `point` / `max` minutes) adjusted
 * by playback speed via ceiling math (`ceil_per_activity`).
 *
 * - When the curriculum contains media minutes (`curriculumHasMediaMinutes === true`),
 *   only `media_minutes` is divided by `playbackSpeed` (`@S20`), and `Math.ceil` is
 *   applied per activity.
 * - When a fixture has `media_minutes === 0` across all activities (such as
 *   `curriculum.synthetic.json`) and a non-1x `playbackSpeed` is explicitly supplied,
 *   the activity's `min` / `point` / `max` totals are scaled by `Math.ceil(minutes / playbackSpeed)`
 *   so duration scaling can be verified directly against `curriculum.synthetic.json`.
 */
export function computeActivityDurationTriplet(
  rawDurationEstimate: unknown,
  playbackSpeed: number,
  curriculumHasMediaMinutes = false
): DurationTripletView {
  const safeSpeed =
    typeof playbackSpeed === "number" && Number.isFinite(playbackSpeed) && playbackSpeed > 0
      ? Math.min(3, Math.max(0.5, playbackSpeed))
      : 1;

  const est =
    rawDurationEstimate && typeof rawDurationEstimate === "object"
      ? (rawDurationEstimate as Record<string, unknown>)
      : {};
  const lowerObj =
    est["lower_bounds"] && typeof est["lower_bounds"] === "object"
      ? (est["lower_bounds"] as Record<string, unknown>)
      : est;
  const upperObj =
    est["upper_bounds"] && typeof est["upper_bounds"] === "object"
      ? (est["upper_bounds"] as Record<string, unknown>)
      : est;

  const pointParts = computeComponentDurationSum(est);
  const lowerParts = computeComponentDurationSum(lowerObj);
  const upperParts = computeComponentDurationSum(upperObj);

  let min: number;
  let point: number;
  let max: number;

  if (curriculumHasMediaMinutes || pointParts.media > 0) {
    min = Math.ceil(lowerParts.media / safeSpeed) + lowerParts.nonMedia;
    point = Math.ceil(pointParts.media / safeSpeed) + pointParts.nonMedia;
    max = Math.ceil(upperParts.media / safeSpeed) + upperParts.nonMedia;
  } else if (safeSpeed !== 1) {
    min = Math.ceil(lowerParts.totalAt1x / safeSpeed);
    point = Math.ceil(pointParts.totalAt1x / safeSpeed);
    max = Math.ceil(upperParts.totalAt1x / safeSpeed);
  } else {
    min = lowerParts.totalAt1x;
    point = pointParts.totalAt1x;
    max = upperParts.totalAt1x;
  }

  return {
    min,
    point,
    max,
    minMinutes: min,
    pointMinutes: point,
    maxMinutes: max,
    mediaMinutesAt1x: pointParts.media,
    nonMediaMinutesAt1x: pointParts.nonMedia,
    playbackSpeed: safeSpeed,
    rounding: "ceil_per_activity",
    rangeInterpretation: "planning_bounds_not_confidence_interval",
  };
}

interface DagLayoutPosition {
  readonly id: string;
  readonly layer: number;
  readonly column: number;
  readonly topologicalIndex: number;
}

/**
 * Computes deterministic topological order (`layer`, `column`, `topologicalIndex`)
 * for a directed graph using Kahn's algorithm + longest-prerequisite-path layering.
 */
function computeDeterministicDagLayout(
  nodeIdsInOrder: readonly string[],
  edges: readonly { readonly from: string; readonly to: string }[]
): ReadonlyMap<string, DagLayoutPosition> {
  const knownIds = new Set(nodeIdsInOrder);
  const originalOrderIndex = new Map<string, number>();
  nodeIdsInOrder.forEach((id, idx) => originalOrderIndex.set(id, idx));

  const prereqsByNode = new Map<string, Set<string>>();
  const dependentsByNode = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIdsInOrder) {
    prereqsByNode.set(id, new Set());
    dependentsByNode.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!knownIds.has(edge.from) || !knownIds.has(edge.to) || edge.from === edge.to) {
      continue;
    }
    const prereqs = prereqsByNode.get(edge.to)!;
    if (!prereqs.has(edge.from)) {
      prereqs.add(edge.from);
      dependentsByNode.get(edge.from)!.add(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  const layerByNode = new Map<string, number>();
  for (const id of nodeIdsInOrder) {
    layerByNode.set(id, 0);
  }

  const ready: string[] = nodeIdsInOrder.filter((id) => (inDegree.get(id) ?? 0) === 0);
  ready.sort((a, b) => (originalOrderIndex.get(a) ?? 0) - (originalOrderIndex.get(b) ?? 0));

  const visitedOrder: string[] = [];
  const visitedSet = new Set<string>();

  while (ready.length > 0) {
    const current = ready.shift()!;
    if (visitedSet.has(current)) {
      continue;
    }
    visitedSet.add(current);
    visitedOrder.push(current);

    const currentLayer = layerByNode.get(current) ?? 0;
    const deps = Array.from(dependentsByNode.get(current) ?? []);
    deps.sort((a, b) => (originalOrderIndex.get(a) ?? 0) - (originalOrderIndex.get(b) ?? 0));

    for (const dep of deps) {
      const nextLayer = Math.max(layerByNode.get(dep) ?? 0, currentLayer + 1);
      layerByNode.set(dep, nextLayer);
      const nextIn = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, nextIn);
      if (nextIn <= 0 && !visitedSet.has(dep)) {
        ready.push(dep);
        ready.sort((a, b) => (originalOrderIndex.get(a) ?? 0) - (originalOrderIndex.get(b) ?? 0));
      }
    }
  }

  // Fallback for any remaining nodes if an unvalidated input had a cycle
  for (const id of nodeIdsInOrder) {
    if (!visitedSet.has(id)) {
      visitedSet.add(id);
      visitedOrder.push(id);
    }
  }

  // Group by layer to assign deterministic column indices
  const nodesByLayer = new Map<number, string[]>();
  for (const id of visitedOrder) {
    const layer = layerByNode.get(id) ?? 0;
    const list = nodesByLayer.get(layer) ?? [];
    list.push(id);
    nodesByLayer.set(layer, list);
  }

  const sortedLayers = Array.from(nodesByLayer.keys()).sort((a, b) => a - b);
  const result = new Map<string, DagLayoutPosition>();
  let topoIdx = 0;

  for (const layer of sortedLayers) {
    const group = nodesByLayer.get(layer) ?? [];
    group.sort((a, b) => (originalOrderIndex.get(a) ?? 0) - (originalOrderIndex.get(b) ?? 0));
    group.forEach((id, colIdx) => {
      result.set(id, {
        id,
        layer,
        column: colIdx,
        topologicalIndex: topoIdx++,
      });
    });
  }

  return result;
}

function normalizeArgs(
  firstArg: Record<string, unknown> | PlanMapAndOutlineBuildOptions,
  secondArg?: Record<string, unknown> | PlanMapAndOutlineBuildOptions | null,
  thirdArg?: Readonly<Record<string, ActivityExecutionStatus | string>>,
  fourthArg?: Partial<PlanMapAndOutlineBuildOptions>
): {
  readonly curriculum: Record<string, unknown>;
  readonly options: PlanMapAndOutlineBuildOptions;
} {
  // Check if firstArg is an options envelope containing `curriculum`
  if (
    firstArg &&
    typeof firstArg === "object" &&
    "curriculum" in firstArg &&
    firstArg["curriculum"] &&
    typeof firstArg["curriculum"] === "object" &&
    !("schema_version" in firstArg && "modules" in firstArg)
  ) {
    const opts = firstArg as PlanMapAndOutlineBuildOptions;
    return {
      curriculum: opts.curriculum ?? {},
      options: opts,
    };
  }

  const curriculum = (firstArg as Record<string, unknown>) ?? {};

  // Check if secondArg is an options object vs a proficiency document
  if (
    secondArg &&
    typeof secondArg === "object" &&
    ("activityStates" in secondArg ||
      "playbackSpeed" in secondArg ||
      "viewportWidthPx" in secondArg ||
      "selectedModuleId" in secondArg ||
      "selectedActivityId" in secondArg ||
      "proficiency" in secondArg ||
      "catalogResources" in secondArg ||
      "zoom" in secondArg)
  ) {
    const opts = secondArg as PlanMapAndOutlineBuildOptions;
    return {
      curriculum,
      options: {
        ...opts,
        ...(thirdArg ? { activityStates: thirdArg } : {}),
        ...(fourthArg ?? {}),
      },
    };
  }

  return {
    curriculum,
    options: {
      proficiency: (secondArg as Record<string, unknown> | null | undefined) ?? null,
      ...(thirdArg ? { activityStates: thirdArg } : {}),
      ...(fourthArg ?? {}),
    },
  };
}

function buildResourceLookup(
  rawCatalog:
    | Readonly<Record<string, CatalogResourceMetadataInput>>
    | readonly CatalogResourceMetadataInput[]
    | undefined
): ReadonlyMap<string, CatalogResourceMetadataInput> {
  const map = new Map<string, CatalogResourceMetadataInput>();
  if (!rawCatalog) {
    return map;
  }
  if (Array.isArray(rawCatalog)) {
    for (const item of rawCatalog) {
      if (item && typeof item === "object" && typeof item.resource_version_id === "string") {
        map.set(item.resource_version_id, item);
      }
    }
    return map;
  }
  for (const [key, val] of Object.entries(rawCatalog)) {
    if (val && typeof val === "object") {
      map.set(key, val as CatalogResourceMetadataInput);
    }
  }
  return map;
}

/**
 * Builds the deterministic `Plan` synchronized `Outline` + `Map` view-model (`T04`).
 */
export function buildPlanMapAndOutlineModel(
  curriculumOrOptions: Record<string, unknown> | PlanMapAndOutlineBuildOptions,
  proficiencyOrOptions?: Record<string, unknown> | PlanMapAndOutlineBuildOptions | null,
  activityStatesArg?: Readonly<Record<string, ActivityExecutionStatus | string>>,
  extraOptionsArg?: Partial<PlanMapAndOutlineBuildOptions>
): PlanMapAndOutlineModel {
  const { curriculum, options } = normalizeArgs(
    curriculumOrOptions,
    proficiencyOrOptions,
    activityStatesArg,
    extraOptionsArg
  );

  const schemaVersion = sanitizeString(curriculum["schema_version"], "0.2.0");
  const curriculumId = sanitizeString(curriculum["curriculum_id"], "curriculum-default");
  const revisionId = sanitizeString(curriculum["revision_id"], "revision-default");
  const createdAt = sanitizeString(curriculum["created_at"], "2026-10-20T16:00:00Z");

  const rawGoal =
    curriculum["goal"] && typeof curriculum["goal"] === "object"
      ? (curriculum["goal"] as Record<string, unknown>)
      : {};
  const goal = {
    title: sanitizeString(rawGoal["title"], "Curriculum Plan"),
    summary: sanitizeString(rawGoal["summary"], ""),
    includedTopics: Array.isArray(rawGoal["included_topics"])
      ? rawGoal["included_topics"].map((t) => sanitizeString(t)).filter(Boolean)
      : [],
    excludedTopics: Array.isArray(rawGoal["excluded_topics"])
      ? rawGoal["excluded_topics"].map((t) => sanitizeString(t)).filter(Boolean)
      : [],
    scopeNote: sanitizeString(rawGoal["scope_note"], ""),
  };

  const rawDurationPolicy =
    curriculum["duration_policy"] && typeof curriculum["duration_policy"] === "object"
      ? (curriculum["duration_policy"] as Record<string, unknown>)
      : {};
  const defaultSpeed =
    typeof rawDurationPolicy["playback_speed"] === "number"
      ? rawDurationPolicy["playback_speed"]
      : 1;
  const playbackSpeed =
    typeof options.playbackSpeed === "number" && options.playbackSpeed > 0
      ? Math.min(3, Math.max(0.5, options.playbackSpeed))
      : defaultSpeed;

  const durationPolicy = {
    playbackSpeed,
    rounding: "ceil_per_activity" as const,
    policyVersion: sanitizeString(
      rawDurationPolicy["policy_version"],
      "synthetic-duration-policy"
    ),
  };

  const rawAdaptationContext =
    curriculum["adaptation_context"] && typeof curriculum["adaptation_context"] === "object"
      ? (curriculum["adaptation_context"] as Record<string, unknown>)
      : {};
  const waiverRefSet = new Set<string>(
    Array.isArray(rawAdaptationContext["waiver_refs"])
      ? rawAdaptationContext["waiver_refs"].map((r) => sanitizeString(r)).filter(Boolean)
      : []
  );

  const rawCertificationOptions = Array.isArray(curriculum["certification_options"])
    ? curriculum["certification_options"]
    : [];
  const certificationByResourceVersionId = new Map<
    string,
    { readonly rationale: string; readonly mappedObjectiveIds: readonly string[] }
  >();
  for (const rawCert of rawCertificationOptions) {
    if (rawCert && typeof rawCert === "object") {
      const cert = rawCert as Record<string, unknown>;
      const rvId = sanitizeString(cert["resource_version_id"]);
      if (rvId) {
        certificationByResourceVersionId.set(rvId, {
          rationale: sanitizeString(cert["rationale"], "Optional certification preparation"),
          mappedObjectiveIds: Array.isArray(cert["mapped_objective_ids"])
            ? cert["mapped_objective_ids"].map((id) => sanitizeString(id)).filter(Boolean)
            : [],
        });
      }
    }
  }

  const rawCoverageLimitations = Array.isArray(curriculum["coverage_limitations"])
    ? curriculum["coverage_limitations"]
    : [];
  const coverageLimitationByObjectiveId = new Map<
    string,
    { readonly missingRequirement: string; readonly explanation: string }
  >();
  for (const rawLim of rawCoverageLimitations) {
    if (rawLim && typeof rawLim === "object") {
      const lim = rawLim as Record<string, unknown>;
      const objId = sanitizeString(lim["objective_id"]);
      if (objId) {
        coverageLimitationByObjectiveId.set(objId, {
          missingRequirement: sanitizeString(lim["missing_requirement"], "source_coverage"),
          explanation: sanitizeString(lim["explanation"], "Coverage limitation disclosed."),
        });
      }
    }
  }

  // Parse proficiency evidence lookup (`proficiency.synthetic.json`)
  const proficiencyDoc = options.proficiency ?? null;
  const rawObjectiveEvidence =
    proficiencyDoc &&
    typeof proficiencyDoc === "object" &&
    Array.isArray(proficiencyDoc["objective_evidence"])
      ? proficiencyDoc["objective_evidence"]
      : [];

  interface ParsedObjectiveEvidence {
    readonly objectiveId: string;
    readonly objectiveVersionId: string;
    readonly topicId: string;
    readonly rawStatus: string;
    readonly evidenceSupport: "none" | "limited" | "corroborated";
    readonly evidenceRefs: readonly string[];
    readonly refreshRecommended: boolean;
  }

  const evidenceByObjectiveId = new Map<string, ParsedObjectiveEvidence>();
  for (const rawEv of rawObjectiveEvidence) {
    if (rawEv && typeof rawEv === "object") {
      const ev = rawEv as Record<string, unknown>;
      const objectiveId = sanitizeString(ev["objective_id"]);
      const objectiveVersionId = sanitizeString(ev["objective_version_id"]);
      const topicId = sanitizeString(ev["topic_id"]);
      const rawStatus = sanitizeString(ev["status"], "unknown");
      const rawSupport = sanitizeString(ev["evidence_support"], "none");
      const evidenceSupport: "none" | "limited" | "corroborated" =
        rawSupport === "corroborated" || rawSupport === "limited" ? rawSupport : "none";
      const evidenceRefs = Array.isArray(ev["evidence_refs"])
        ? ev["evidence_refs"].map((r) => sanitizeString(r)).filter(Boolean)
        : [];
      const refreshRecommended = ev["refresh_recommended"] === true;
      const parsed: ParsedObjectiveEvidence = {
        objectiveId,
        objectiveVersionId,
        topicId,
        rawStatus,
        evidenceSupport,
        evidenceRefs,
        refreshRecommended,
      };
      if (objectiveId) {
        evidenceByObjectiveId.set(objectiveId, parsed);
      }
      if (objectiveVersionId) {
        evidenceByObjectiveId.set(objectiveVersionId, parsed);
      }
    }
  }

  // Parse raw activities first to determine media minutes and activity execution states
  const rawActivities = Array.isArray(curriculum["activities"]) ? curriculum["activities"] : [];
  const curriculumHasMediaMinutes = rawActivities.some((rawAct) => {
    if (!rawAct || typeof rawAct !== "object") return false;
    const dur = (rawAct as Record<string, unknown>)["duration_estimate"];
    if (!dur || typeof dur !== "object") return false;
    const media = (dur as Record<string, unknown>)["media_minutes"];
    return typeof media === "number" && media > 0;
  });

  const activityStatesInput = options.activityStates ?? {};
  const studyAheadSet = new Set<string>(options.studyAheadActivityIds ?? []);
  const catalogLookup = buildResourceLookup(options.catalogResources);

  // Map module ownership of objectives and activities
  const rawModules = Array.isArray(curriculum["modules"]) ? curriculum["modules"] : [];
  const moduleIdByObjectiveId = new Map<string, string>();
  const moduleIdByActivityId = new Map<string, string>();

  for (const rawMod of rawModules) {
    if (rawMod && typeof rawMod === "object") {
      const m = rawMod as Record<string, unknown>;
      const modId = sanitizeString(m["module_id"] ?? m["id"]);
      const objIds = Array.isArray(m["objective_ids"]) ? m["objective_ids"] : [];
      for (const oid of objIds) {
        const cleanOid = sanitizeString(oid);
        if (cleanOid && !moduleIdByObjectiveId.has(cleanOid)) {
          moduleIdByObjectiveId.set(cleanOid, modId);
        }
      }
      const actIds = Array.isArray(m["activity_ids"]) ? m["activity_ids"] : [];
      for (const aid of actIds) {
        const cleanAid = sanitizeString(aid);
        if (cleanAid && !moduleIdByActivityId.has(cleanAid)) {
          moduleIdByActivityId.set(cleanAid, modId);
        }
      }
    }
  }

  // Parse prerequisite_edges between objectives
  const rawPrereqEdges = Array.isArray(curriculum["prerequisite_edges"])
    ? curriculum["prerequisite_edges"]
    : [];
  const objectiveEdges: { readonly from: string; readonly to: string }[] = [];
  for (const rawEdge of rawPrereqEdges) {
    if (rawEdge && typeof rawEdge === "object") {
      const e = rawEdge as Record<string, unknown>;
      const from = sanitizeString(e["from_objective_id"] ?? e["from"]);
      const to = sanitizeString(e["to_objective_id"] ?? e["to"]);
      if (from && to && from !== to) {
        objectiveEdges.push({ from, to });
      }
    }
  }

  // Parse objectives and their initial execution / proficiency status
  const rawObjectives = Array.isArray(curriculum["objectives"]) ? curriculum["objectives"] : [];
  const objectiveIdsInOrder: string[] = [];
  const rawObjectiveById = new Map<string, Record<string, unknown>>();
  for (const rawObj of rawObjectives) {
    if (rawObj && typeof rawObj === "object") {
      const obj = rawObj as Record<string, unknown>;
      const objId = sanitizeString(obj["objective_id"] ?? obj["id"]);
      if (objId && !rawObjectiveById.has(objId)) {
        objectiveIdsInOrder.push(objId);
        rawObjectiveById.set(objId, obj);
      }
    }
  }

  // Also include any objectives from proficiency.objective_evidence that aren't in curriculum.objectives
  // so proficiency evidence for prerequisite objectives (e.g., objective-matrix-shapes, objective-matrix-calculus)
  // is inspectable in objectiveTracks if referenced or present in proficiency doc
  for (const rawEv of rawObjectiveEvidence) {
    if (rawEv && typeof rawEv === "object") {
      const ev = rawEv as Record<string, unknown>;
      const objId = sanitizeString(ev["objective_id"]);
      if (objId && !rawObjectiveById.has(objId)) {
        objectiveIdsInOrder.push(objId);
        rawObjectiveById.set(objId, {
          objective_id: objId,
          objective_version_id: sanitizeString(ev["objective_version_id"], `${objId}-v1`),
          topic_id: sanitizeString(ev["topic_id"], "topic-general"),
          title: sanitizeString(ev["title"], objId),
          description: sanitizeString(
            ev["conditions_summary"],
            "Prior proficiency profile objective."
          ),
          success_criterion: "Demonstrated under reviewed criterion policy.",
          level: "introductory",
          requirement_level: "required",
          assessment_activity_ids: [],
          prior_evidence_refs: Array.isArray(ev["evidence_refs"]) ? ev["evidence_refs"] : [],
        });
      }
    }
  }

  const objectiveLayout = computeDeterministicDagLayout(objectiveIdsInOrder, objectiveEdges);

  // Map activities by ID and by objective ID
  const rawActivityById = new Map<string, Record<string, unknown>>();
  const activityIdsByObjectiveId = new Map<string, string[]>();
  const executionStatusByActivityId = new Map<string, ActivityExecutionStatus>();

  for (const rawAct of rawActivities) {
    if (rawAct && typeof rawAct === "object") {
      const act = rawAct as Record<string, unknown>;
      const actId = sanitizeString(act["activity_id"] ?? act["id"]);
      if (!actId) continue;
      rawActivityById.set(actId, act);
      const isWaived = waiverRefSet.has(actId);
      const execStatus = normalizeExecutionStatus(activityStatesInput[actId], isWaived);
      executionStatusByActivityId.set(actId, execStatus);

      const objIds = Array.isArray(act["objective_ids"]) ? act["objective_ids"] : [];
      for (const oid of objIds) {
        const cleanOid = sanitizeString(oid);
        if (cleanOid) {
          const list = activityIdsByObjectiveId.get(cleanOid) ?? [];
          list.push(actId);
          activityIdsByObjectiveId.set(cleanOid, list);
        }
      }
    }
  }

  // Resolve objective proficiency badge status (`@S17`, `@S23`):
  // NEVER conflate `self_reported_completed` activity state with `demonstrated` proficiency!
  function resolveObjectiveProficiencyBadge(objectiveId: string): ObjectiveProficiencyBadgeView {
    const rawObj = rawObjectiveById.get(objectiveId);
    const objVersionId = rawObj ? sanitizeString(rawObj["objective_version_id"], objectiveId) : objectiveId;
    const ev =
      evidenceByObjectiveId.get(objectiveId) ?? evidenceByObjectiveId.get(objVersionId) ?? null;

    const linkedActIds = activityIdsByObjectiveId.get(objectiveId) ?? [];
    const selfReportedActivityCompleted = linkedActIds.some(
      (aid) => executionStatusByActivityId.get(aid) === "self_reported_completed"
    );

    const covLim = coverageLimitationByObjectiveId.get(objectiveId);

    let status: ObjectiveProficiencyBadgeStatus = "unassessed";
    let evidenceSupport: "none" | "limited" | "corroborated" = "none";
    let evidenceRefs: readonly string[] = [];

    if (ev) {
      evidenceSupport = ev.evidenceSupport;
      evidenceRefs = ev.evidenceRefs;
      if (
        ev.rawStatus === "demonstrated" &&
        ev.evidenceRefs.length > 0 &&
        ev.evidenceSupport !== "none" &&
        !covLim
      ) {
        status = ev.refreshRecommended ? "needs_review" : "demonstrated";
      } else if (ev.rawStatus === "needs_practice" || ev.rawStatus === "needs_review") {
        status = "needs_review";
      } else if (ev.rawStatus === "self_reported") {
        status = "self_reported";
      } else if (ev.rawStatus === "in_progress") {
        status = "in_progress";
      } else {
        status = "unassessed";
      }
    } else {
      // Activity execution state (`in_progress` or `self_reported_completed`) never
      // inflates or alters objective proficiency without reviewed evidence (@S17, @S23).
      status = "unassessed";
    }

    const meta = PROFICIENCY_BADGE_LABELS[status];
    return {
      layer: "objective_proficiency",
      objectiveId,
      status,
      label: meta.label,
      nonColorCue: meta.nonColorCue,
      evidenceSupport,
      evidenceRefs,
      selfReportedActivityCompleted,
      conflatedWithActivityCompletion: false,
    };
  }

  const proficiencyBadgeByObjectiveId = new Map<string, ObjectiveProficiencyBadgeView>();
  for (const objId of objectiveIdsInOrder) {
    proficiencyBadgeByObjectiveId.set(objId, resolveObjectiveProficiencyBadge(objId));
  }

  // Build objective prerequisite & dependent lookups
  const prereqObjectivesByObj = new Map<string, string[]>();
  const dependentObjectivesByObj = new Map<string, string[]>();
  for (const objId of objectiveIdsInOrder) {
    prereqObjectivesByObj.set(objId, []);
    dependentObjectivesByObj.set(objId, []);
  }
  for (const edge of objectiveEdges) {
    if (prereqObjectivesByObj.has(edge.to) && prereqObjectivesByObj.has(edge.from)) {
      prereqObjectivesByObj.get(edge.to)!.push(edge.from);
      dependentObjectivesByObj.get(edge.from)!.push(edge.to);
    }
  }

  // Derive module prerequisite edges from:
  // 1) explicit `prerequisite_module_ids` on a module if present
  // 2) `prerequisite_edges` across objectives belonging to different modules
  // 3) `prerequisite_activity_ids` across activities belonging to different modules
  const moduleIdsInOrder: string[] = [];
  const rawModuleById = new Map<string, Record<string, unknown>>();
  for (const rawMod of rawModules) {
    if (rawMod && typeof rawMod === "object") {
      const m = rawMod as Record<string, unknown>;
      const modId = sanitizeString(m["module_id"] ?? m["id"]);
      if (modId && !rawModuleById.has(modId)) {
        moduleIdsInOrder.push(modId);
        rawModuleById.set(modId, m);
      }
    }
  }

  const moduleEdgeSet = new Set<string>();
  const moduleEdges: { readonly from: string; readonly to: string }[] = [];
  function addModuleEdge(fromMod: string, toMod: string): void {
    if (!fromMod || !toMod || fromMod === toMod) return;
    if (!rawModuleById.has(fromMod) || !rawModuleById.has(toMod)) return;
    const key = `${fromMod}->${toMod}`;
    if (!moduleEdgeSet.has(key)) {
      moduleEdgeSet.add(key);
      moduleEdges.push({ from: fromMod, to: toMod });
    }
  }

  for (const modId of moduleIdsInOrder) {
    const rawMod = rawModuleById.get(modId)!;
    const explicitPrereqs = Array.isArray(rawMod["prerequisite_module_ids"])
      ? rawMod["prerequisite_module_ids"]
      : [];
    for (const p of explicitPrereqs) {
      addModuleEdge(sanitizeString(p), modId);
    }
  }

  for (const edge of objectiveEdges) {
    const fromMod = moduleIdByObjectiveId.get(edge.from);
    const toMod = moduleIdByObjectiveId.get(edge.to);
    if (fromMod && toMod) {
      addModuleEdge(fromMod, toMod);
    }
  }

  for (const [actId, rawAct] of rawActivityById.entries()) {
    const toMod = moduleIdByActivityId.get(actId);
    const prereqActIds = Array.isArray(rawAct["prerequisite_activity_ids"])
      ? rawAct["prerequisite_activity_ids"]
      : [];
    for (const paid of prereqActIds) {
      const fromMod = moduleIdByActivityId.get(sanitizeString(paid));
      if (fromMod && toMod) {
        addModuleEdge(fromMod, toMod);
      }
    }
  }

  const moduleLayout = computeDeterministicDagLayout(moduleIdsInOrder, moduleEdges);
  const sortedModuleIds = [...moduleIdsInOrder].sort((a, b) => {
    const posA = moduleLayout.get(a)?.topologicalIndex ?? 0;
    const posB = moduleLayout.get(b)?.topologicalIndex ?? 0;
    return posA - posB;
  });

  const prereqModulesByMod = new Map<string, string[]>();
  const dependentModulesByMod = new Map<string, string[]>();
  for (const modId of moduleIdsInOrder) {
    prereqModulesByMod.set(modId, []);
    dependentModulesByMod.set(modId, []);
  }
  for (const edge of moduleEdges) {
    prereqModulesByMod.get(edge.to)!.push(edge.from);
    dependentModulesByMod.get(edge.from)!.push(edge.to);
  }

  // Helper to build OutlineActivityView
  function buildOutlineActivity(actId: string, owningModuleId: string): OutlineActivityView {
    const rawAct = rawActivityById.get(actId) ?? {};
    const rawType = sanitizeString(rawAct["type"] ?? rawAct["activity_type"], "theory");
    const actType: AllowlistedActivityType = (
      ALLOWLISTED_ACTIVITY_TYPES as readonly string[]
    ).includes(rawType)
      ? (rawType as AllowlistedActivityType)
      : "theory";

    const title = sanitizeString(rawAct["title"], actId);
    const reqLevel: "required" | "optional" =
      rawAct["requirement_level"] === "optional" ? "optional" : "required";
    const required = reqLevel === "required";
    const isOptionalEnrichment = !required;

    const objectiveIds = Array.isArray(rawAct["objective_ids"])
      ? rawAct["objective_ids"].map((id) => sanitizeString(id)).filter(Boolean)
      : [];
    const prerequisiteActivityIds = Array.isArray(rawAct["prerequisite_activity_ids"])
      ? rawAct["prerequisite_activity_ids"].map((id) => sanitizeString(id)).filter(Boolean)
      : [];

    const prerequisiteBadges: PrerequisiteBadgeView[] = prerequisiteActivityIds.map((prereqId) => {
      const prereqStatus = executionStatusByActivityId.get(prereqId) ?? "not_started";
      const satisfied = prereqStatus === "completed" || prereqStatus === "waived";
      const prereqTitle = sanitizeString(rawActivityById.get(prereqId)?.["title"], prereqId);
      return {
        edgeId: `${prereqId}->${actId}`,
        fromId: prereqId,
        toId: actId,
        kind: "activity_prerequisite",
        relationshipLabel: `Requires activity: ${prereqTitle}`,
        textMeaning: satisfied
          ? `Prerequisite activity "${prereqTitle}" is satisfied (${prereqStatus}).`
          : `Prerequisite activity "${prereqTitle}" is not yet completed (${prereqStatus}).`,
        satisfied,
      };
    });

    const durationTriplet = computeActivityDurationTriplet(
      rawAct["duration_estimate"],
      playbackSpeed,
      curriculumHasMediaMinutes
    );

    const rawAssignments = Array.isArray(rawAct["resource_assignments"])
      ? rawAct["resource_assignments"]
      : [];
    const resourceProvenanceCards: ResourceProvenanceCardView[] = rawAssignments
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
      .map((assignment) => {
        const rvId = sanitizeString(assignment["resource_version_id"], "unknown-resource");
        const role: "primary" | "supplemental" =
          assignment["role"] === "supplemental" ? "supplemental" : "primary";
        const selectionRationale = sanitizeString(
          assignment["selection_rationale"],
          "Selected from approved catalog snapshot."
        );
        const catalogMeta = catalogLookup.get(rvId);
        const verifiedPublisher = sanitizeString(
          catalogMeta?.provider?.display_name,
          "Verified Catalog Publisher"
        );
        const versionTimestamp = sanitizeString(
          catalogMeta?.captured_at ?? catalogMeta?.access?.access_verified_at,
          createdAt
        );
        const accessModel = sanitizeString(catalogMeta?.access?.model, "free");
        const rightsBasis = sanitizeString(
          catalogMeta?.ingestion_permissions?.basis,
          "metadata_only"
        );
        const displayExcerptsAllowed =
          catalogMeta?.ingestion_permissions?.permissions?.display_excerpts === "allowed";

        const rawSegments = Array.isArray(assignment["segment_ids"])
          ? assignment["segment_ids"].map((s) => sanitizeString(s)).filter(Boolean)
          : [];
        // Omit unverified chapter or timestamp precision (`UI-004`, `@S26`)
        const verifiedSegmentSet = new Set<string>(
          Array.isArray(catalogMeta?.segments)
            ? catalogMeta.segments
                .filter((s) => s && s.verified !== false && typeof s.segment_id === "string")
                .map((s) => s.segment_id!)
            : rawSegments
        );
        const verifiedSegments = rawSegments.filter((segId) => verifiedSegmentSet.has(segId));

        const certEntry = certificationByResourceVersionId.get(rvId);
        const optionalCertificationBadge: OptionalCertificationBadgeView | null = certEntry
          ? {
              included: Boolean(catalogMeta?.access?.certificate_included),
              relationship: "optional_preparation",
              label: "Optional certification preparation (separate from core completion)",
              rationale: certEntry.rationale,
              verifiedIssuerUrl:
                catalogMeta?.canonical_url && isSafeResourceUrl(catalogMeta.canonical_url)
                  ? catalogMeta.canonical_url
                  : null,
              isAccreditedQualificationGuarantee: false,
            }
          : null;

        const rawUrl = catalogMeta?.canonical_url;
        const canonicalUrl =
          typeof rawUrl === "string" && isSafeResourceUrl(rawUrl) ? rawUrl : null;

        return {
          resourceVersionId: rvId,
          role,
          title: sanitizeString(catalogMeta?.title, rvId),
          verifiedPublisher,
          versionTimestamp,
          accessModel,
          rightsBadge: {
            basis: rightsBasis,
            label: displayExcerptsAllowed
              ? `Rights: ${rightsBasis} (permitted excerpt)`
              : `Rights: ${rightsBasis} (external link only)`,
            displayExcerptsAllowed,
            externalLinkOnly: !displayExcerptsAllowed,
          },
          optionalCertificationBadge,
          selectionRationale,
          verifiedSegments,
          canonicalUrl,
          omitsUnverifiedPrecision: true,
        };
      });

    const executionStatus = executionStatusByActivityId.get(actId) ?? "not_started";
    const executionBadge = makeExecutionBadge(executionStatus);

    const objectiveProficiencyBadges: ObjectiveProficiencyBadgeView[] =
      objectiveIds.length > 0
        ? objectiveIds.map(
            (oid) => proficiencyBadgeByObjectiveId.get(oid) ?? resolveObjectiveProficiencyBadge(oid)
          )
        : [resolveObjectiveProficiencyBadge("unmapped-objective")];

    const primaryObjBadge = objectiveProficiencyBadges[0]!;
    const masteryGated = rawAct["mastery_gated"] === true;

    const unmetPrerequisiteActivityIds = prerequisiteActivityIds.filter((pid) => {
      const st = executionStatusByActivityId.get(pid) ?? "not_started";
      return st !== "completed" && st !== "waived";
    });

    const unmetPrerequisiteObjectiveIds: string[] = [];
    for (const oid of objectiveIds) {
      const prereqObjs = prereqObjectivesByObj.get(oid) ?? [];
      for (const poid of prereqObjs) {
        const pBadge = proficiencyBadgeByObjectiveId.get(poid);
        if (!pBadge || pBadge.status !== "demonstrated") {
          if (!unmetPrerequisiteObjectiveIds.includes(poid)) {
            unmetPrerequisiteObjectiveIds.push(poid);
          }
        }
      }
    }

    const hasUnmetPrereqs =
      unmetPrerequisiteActivityIds.length > 0 || unmetPrerequisiteObjectiveIds.length > 0;
    const isStudyingAhead = studyAheadSet.has(actId) || hasUnmetPrereqs;
    const studyAheadAllowed = !masteryGated || !hasUnmetPrereqs;

    let prerequisiteBridgeRecommendation: PrerequisiteBridgeRecommendation | null = null;
    if (hasUnmetPrereqs || studyAheadSet.has(actId)) {
      prerequisiteBridgeRecommendation = {
        recommended: true,
        blocking: masteryGated && hasUnmetPrereqs,
        masteryGated,
        reason: masteryGated
          ? "Mastery-gated activity: demonstrated prerequisite proficiency is required before advancing."
          : "Non-blocking prerequisite bridge recommendation: you can study ahead, or complete the recommended prerequisite bridge activities first.",
        unmetPrerequisiteActivityIds,
        unmetPrerequisiteObjectiveIds,
        suggestedBridgeActivityIds:
          unmetPrerequisiteActivityIds.length > 0
            ? unmetPrerequisiteActivityIds
            : prerequisiteActivityIds,
      };
    } else if (isStudyingAhead && !masteryGated) {
      prerequisiteBridgeRecommendation = {
        recommended: true,
        blocking: false,
        masteryGated: false,
        reason:
          "Studying ahead on non-gated activity; prerequisite evidence remains unchanged.",
        unmetPrerequisiteActivityIds: [],
        unmetPrerequisiteObjectiveIds: [],
        suggestedBridgeActivityIds: prerequisiteActivityIds,
      };
    }

    const contentObj =
      rawAct["content"] && typeof rawAct["content"] === "object"
        ? (rawAct["content"] as Record<string, unknown>)
        : {};
    const promptSummary = sanitizeString(
      contentObj["study_prompt"] ??
        contentObj["example_prompt"] ??
        contentObj["task_prompt"] ??
        contentObj["recall_prompt"] ??
        contentObj["reflection_prompt"] ??
        contentObj["brief"] ??
        title,
      title
    );

    return {
      activityId: actId,
      moduleId: owningModuleId,
      title,
      type: actType,
      activityType: actType,
      requirementLevel: reqLevel,
      required,
      isOptionalEnrichment,
      objectiveIds,
      prerequisiteActivityIds,
      prerequisiteBadges,
      durationTriplet,
      resourceProvenanceCards,
      executionStatus,
      executionBadge,
      objectiveProficiencyStatus: primaryObjBadge.status,
      objectiveProficiencyBadge: primaryObjBadge,
      objectiveProficiencyBadges,
      masteryGated,
      unmetPrerequisiteActivityIds,
      unmetPrerequisiteObjectiveIds,
      studyAheadAllowed,
      prerequisiteBridgeRecommendation,
      promptSummary,
      availableActions: SYNCHRONIZED_NODE_ACTIONS,
    };
  }

  // Build ObjectiveTrackView list in topological order
  const sortedObjectiveIds = [...objectiveIdsInOrder].sort((a, b) => {
    const posA = objectiveLayout.get(a)?.topologicalIndex ?? 0;
    const posB = objectiveLayout.get(b)?.topologicalIndex ?? 0;
    return posA - posB;
  });

  const objectiveTracks: ObjectiveTrackView[] = sortedObjectiveIds.map((objId) => {
    const rawObj = rawObjectiveById.get(objId) ?? {};
    const layoutPos = objectiveLayout.get(objId) ?? {
      id: objId,
      layer: 0,
      column: 0,
      topologicalIndex: 0,
    };
    const prereqIds = prereqObjectivesByObj.get(objId) ?? [];
    const depIds = dependentObjectivesByObj.get(objId) ?? [];
    const profBadge =
      proficiencyBadgeByObjectiveId.get(objId) ?? resolveObjectiveProficiencyBadge(objId);

    const linkedActs = activityIdsByObjectiveId.get(objId) ?? [];
    let rollupExec: ActivityExecutionStatus = "not_started";
    if (waiverRefSet.has(objId)) {
      rollupExec = "waived";
    } else if (
      linkedActs.length > 0 &&
      linkedActs.every((aid) => executionStatusByActivityId.get(aid) === "completed")
    ) {
      rollupExec = "completed";
    } else if (
      linkedActs.some((aid) => executionStatusByActivityId.get(aid) === "self_reported_completed")
    ) {
      rollupExec = "self_reported_completed";
    } else if (linkedActs.some((aid) => executionStatusByActivityId.get(aid) === "in_progress")) {
      rollupExec = "in_progress";
    }

    const prereqBadges: PrerequisiteBadgeView[] = prereqIds.map((pId) => {
      const pProf =
        proficiencyBadgeByObjectiveId.get(pId) ?? resolveObjectiveProficiencyBadge(pId);
      const satisfied = pProf.status === "demonstrated";
      const pTitle = sanitizeString(rawObjectiveById.get(pId)?.["title"], pId);
      return {
        edgeId: `${pId}->${objId}`,
        fromId: pId,
        toId: objId,
        kind: "objective_prerequisite",
        relationshipLabel: `Prerequisite objective: ${pTitle}`,
        textMeaning: satisfied
          ? `Prerequisite objective "${pTitle}" is demonstrated.`
          : `Prerequisite objective "${pTitle}" is currently ${pProf.label}.`,
        satisfied,
      };
    });

    const rawLevel = sanitizeString(rawObj["level"], "introductory");
    const level: "introductory" | "applied" | "advanced" =
      rawLevel === "applied" || rawLevel === "advanced" ? rawLevel : "introductory";
    const reqLevel: "required" | "optional" =
      rawObj["requirement_level"] === "optional" ? "optional" : "required";

    return {
      objectiveId: objId,
      objectiveVersionId: sanitizeString(rawObj["objective_version_id"], `${objId}-v1`),
      topicId: sanitizeString(rawObj["topic_id"], "topic-general"),
      moduleId: moduleIdByObjectiveId.get(objId) ?? null,
      title: sanitizeString(rawObj["title"], objId),
      description: sanitizeString(rawObj["description"], ""),
      successCriterion: sanitizeString(rawObj["success_criterion"], ""),
      level,
      requirementLevel: reqLevel,
      required: reqLevel === "required",
      topologicalIndex: layoutPos.topologicalIndex,
      layer: layoutPos.layer,
      column: layoutPos.column,
      prerequisiteObjectiveIds: prereqIds,
      dependentObjectiveIds: depIds,
      prerequisiteBadges: prereqBadges,
      assessmentActivityIds: Array.isArray(rawObj["assessment_activity_ids"])
        ? rawObj["assessment_activity_ids"].map((a) => sanitizeString(a)).filter(Boolean)
        : [],
      activityIds: linkedActs,
      proficiencyStatus: profBadge.status,
      proficiencyBadge: profBadge,
      executionStatus: rollupExec,
      executionBadge: makeExecutionBadge(rollupExec),
      coverageLimitation: coverageLimitationByObjectiveId.get(objId) ?? null,
      availableActions: SYNCHRONIZED_NODE_ACTIONS,
    };
  });

  const objectiveTrackById = new Map<string, ObjectiveTrackView>();
  for (const track of objectiveTracks) {
    objectiveTrackById.set(track.objectiveId, track);
  }

  // Build OutlineModuleView list in topological order
  const outlineActivities: OutlineActivityView[] = [];
  const outlineModules: OutlineModuleView[] = sortedModuleIds.map((modId) => {
    const rawMod = rawModuleById.get(modId) ?? {};
    const layoutPos = moduleLayout.get(modId) ?? {
      id: modId,
      layer: 0,
      column: 0,
      topologicalIndex: 0,
    };
    const objIds = Array.isArray(rawMod["objective_ids"])
      ? rawMod["objective_ids"].map((id) => sanitizeString(id)).filter(Boolean)
      : [];
    const modObjectives = objIds
      .map((id) => objectiveTrackById.get(id))
      .filter((t): t is ObjectiveTrackView => Boolean(t));

    const actIds = Array.isArray(rawMod["activity_ids"])
      ? rawMod["activity_ids"].map((id) => sanitizeString(id)).filter(Boolean)
      : [];
    const modActivities = actIds.map((aid) => buildOutlineActivity(aid, modId));
    outlineActivities.push(...modActivities);

    const minSum = modActivities.reduce((acc, a) => acc + a.durationTriplet.min, 0);
    const pointSum = modActivities.reduce((acc, a) => acc + a.durationTriplet.point, 0);
    const maxSum = modActivities.reduce((acc, a) => acc + a.durationTriplet.max, 0);
    const mediaAt1x = modActivities.reduce((acc, a) => acc + a.durationTriplet.mediaMinutesAt1x, 0);
    const nonMediaAt1x = modActivities.reduce(
      (acc, a) => acc + a.durationTriplet.nonMediaMinutesAt1x,
      0
    );

    const modDurationTriplet: DurationTripletView = {
      min: minSum,
      point: pointSum,
      max: maxSum,
      minMinutes: minSum,
      pointMinutes: pointSum,
      maxMinutes: maxSum,
      mediaMinutesAt1x: mediaAt1x,
      nonMediaMinutesAt1x: nonMediaAt1x,
      playbackSpeed,
      rounding: "ceil_per_activity",
      rangeInterpretation: "planning_bounds_not_confidence_interval",
    };

    const required =
      modActivities.some((a) => a.required) || modObjectives.some((o) => o.required);
    const requirementLevel: "required" | "optional" = required ? "required" : "optional";

    let modExecStatus: ActivityExecutionStatus = "not_started";
    if (
      modActivities.length > 0 &&
      modActivities.every((a) => a.executionStatus === "waived")
    ) {
      modExecStatus = "waived";
    } else if (
      modActivities.length > 0 &&
      modActivities.every(
        (a) => a.executionStatus === "completed" || a.executionStatus === "waived"
      )
    ) {
      modExecStatus = "completed";
    } else if (modActivities.some((a) => a.executionStatus === "self_reported_completed")) {
      modExecStatus = "self_reported_completed";
    } else if (
      modActivities.some(
        (a) => a.executionStatus === "in_progress" || a.executionStatus === "completed"
      )
    ) {
      modExecStatus = "in_progress";
    }

    const primaryProfBadge =
      modObjectives[0]?.proficiencyBadge ?? resolveObjectiveProficiencyBadge(modId);

    const prereqModIds = prereqModulesByMod.get(modId) ?? [];
    const depModIds = dependentModulesByMod.get(modId) ?? [];

    const prereqBadges: PrerequisiteBadgeView[] = prereqModIds.map((pModId) => {
      const pTitle = sanitizeString(rawModuleById.get(pModId)?.["title"], pModId);
      const pModObjIds = Array.isArray(rawModuleById.get(pModId)?.["objective_ids"])
        ? (rawModuleById.get(pModId)!["objective_ids"] as unknown[]).map((x) => sanitizeString(x))
        : [];
      const satisfied =
        pModObjIds.length > 0 &&
        pModObjIds.every(
          (oid) => proficiencyBadgeByObjectiveId.get(oid)?.status === "demonstrated"
        );
      return {
        edgeId: `${pModId}->${modId}`,
        fromId: pModId,
        toId: modId,
        kind: "module_prerequisite",
        relationshipLabel: `Requires module: ${pTitle}`,
        textMeaning: satisfied
          ? `Prerequisite module "${pTitle}" has demonstrated proficiency.`
          : `Prerequisite module "${pTitle}" is a prerequisite before "${sanitizeString(rawMod["title"], modId)}".`,
        satisfied,
      };
    });

    return {
      moduleId: modId,
      title: sanitizeString(rawMod["title"], modId),
      summary: sanitizeString(rawMod["summary"], ""),
      topologicalIndex: layoutPos.topologicalIndex,
      layer: layoutPos.layer,
      column: layoutPos.column,
      requirementLevel,
      required,
      objectiveIds: objIds,
      objectives: modObjectives,
      activityIds: actIds,
      activities: modActivities,
      prerequisiteModuleIds: prereqModIds,
      dependentModuleIds: depModIds,
      prerequisiteBadges: prereqBadges,
      durationTriplet: modDurationTriplet,
      executionStatus: modExecStatus,
      executionBadge: makeExecutionBadge(modExecStatus),
      proficiencyStatus: primaryProfBadge.status,
      proficiencyBadge: primaryProfBadge,
      hasMasteryGatedActivities: modActivities.some((a) => a.masteryGated),
      availableActions: SYNCHRONIZED_NODE_ACTIONS,
    };
  });

  // Total curriculum duration triplet (sum of activity ceiling triplets)
  const totalMin = outlineActivities.reduce((acc, a) => acc + a.durationTriplet.min, 0);
  const totalPoint = outlineActivities.reduce((acc, a) => acc + a.durationTriplet.point, 0);
  const totalMax = outlineActivities.reduce((acc, a) => acc + a.durationTriplet.max, 0);
  const totalMedia1x = outlineActivities.reduce(
    (acc, a) => acc + a.durationTriplet.mediaMinutesAt1x,
    0
  );
  const totalNonMedia1x = outlineActivities.reduce(
    (acc, a) => acc + a.durationTriplet.nonMediaMinutesAt1x,
    0
  );

  const totalDurationTriplet: DurationTripletView = {
    min: totalMin,
    point: totalPoint,
    max: totalMax,
    minMinutes: totalMin,
    pointMinutes: totalPoint,
    maxMinutes: totalMax,
    mediaMinutesAt1x: totalMedia1x,
    nonMediaMinutesAt1x: totalNonMedia1x,
    playbackSpeed,
    rounding: "ceil_per_activity",
    rangeInterpretation: "planning_bounds_not_confidence_interval",
  };

  // Selection & focus resolution
  const defaultSelectedModuleId = outlineModules[0]?.moduleId ?? null;
  const selectedModuleId =
    options.selectedModuleId !== undefined ? options.selectedModuleId : defaultSelectedModuleId;
  const selectedModule =
    outlineModules.find((m) => m.moduleId === selectedModuleId) ?? outlineModules[0] ?? null;
  const selectedActivityId =
    options.selectedActivityId !== undefined
      ? options.selectedActivityId
      : (selectedModule?.activities[0]?.activityId ?? outlineActivities[0]?.activityId ?? null);
  const focusedNodeId =
    options.focusedNodeId !== undefined
      ? options.focusedNodeId
      : (selectedModule?.moduleId ?? objectiveTracks[0]?.objectiveId ?? null);

  // Mobile neighborhood computation (`< 768px`, UI-002, UI-003, @S75, @S76)
  const viewportWidthPx =
    typeof options.viewportWidthPx === "number" && options.viewportWidthPx > 0
      ? options.viewportWidthPx
      : 1280;
  const isCompactMobile = viewportWidthPx < 768;

  const immediatePrerequisiteModuleIds = selectedModule
    ? selectedModule.prerequisiteModuleIds
    : [];
  const immediateDependentModuleIds = selectedModule ? selectedModule.dependentModuleIds : [];
  const neighborhoodSet = new Set<string>([
    ...immediatePrerequisiteModuleIds,
    ...(selectedModule ? [selectedModule.moduleId] : []),
    ...immediateDependentModuleIds,
  ]);
  const verticalTaskList = selectedModule ? selectedModule.activities : outlineActivities;
  const nextActionActivity =
    verticalTaskList.find(
      (a) => a.executionStatus === "not_started" || a.executionStatus === "in_progress"
    ) ??
    verticalTaskList[0] ??
    null;

  const mobileNeighborhood: MobileNeighborhoodView = {
    isCompactMobile,
    viewportWidthPx,
    selectedModuleId: selectedModule?.moduleId ?? null,
    selectedModule,
    immediatePrerequisiteModuleIds,
    immediateDependentModuleIds,
    neighborhoodModuleIds: Array.from(neighborhoodSet),
    verticalTaskList,
    nextActionActivityId: nextActionActivity?.activityId ?? null,
    shrinksDesktopGraph: false,
  };

  // Deterministic DAG coordinates for `mapNodes` and `mapEdges`
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 88;
  const LAYER_GAP_X = 280;
  const COLUMN_GAP_Y = 136;
  const ORIGIN_X = 48;
  const ORIGIN_Y = 48;

  const moduleMapNodes: MapNodeView[] = outlineModules.map((mod) => {
    const x = ORIGIN_X + mod.layer * LAYER_GAP_X;
    const y = ORIGIN_Y + mod.column * COLUMN_GAP_Y;
    return {
      nodeId: mod.moduleId,
      id: mod.moduleId,
      kind: "module",
      title: mod.title,
      layer: mod.layer,
      column: mod.column,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      required: mod.required,
      requirementLevel: mod.requirementLevel,
      prerequisiteIds: mod.prerequisiteModuleIds,
      dependentIds: mod.dependentModuleIds,
      prerequisiteBadges: mod.prerequisiteBadges,
      executionStatus: mod.executionStatus,
      executionBadge: mod.executionBadge,
      proficiencyStatus: mod.proficiencyStatus,
      proficiencyBadge: mod.proficiencyBadge,
      statusBadge: {
        execution: mod.executionBadge,
        proficiency: mod.proficiencyBadge,
      },
      durationTriplet: mod.durationTriplet,
      selected: mod.moduleId === (selectedModule?.moduleId ?? null),
      inFocusedNeighborhood: neighborhoodSet.has(mod.moduleId),
      opaqueSurface: true,
      availableActions: mod.availableActions,
    };
  });

  const maxModuleColumn = moduleMapNodes.reduce((acc, n) => Math.max(acc, n.column), 0);
  const objectiveRowOffsetY = ORIGIN_Y + (maxModuleColumn + 1) * COLUMN_GAP_Y + 40;

  const objectiveMapNodes: MapNodeView[] = objectiveTracks.map((obj) => {
    const x = ORIGIN_X + obj.layer * LAYER_GAP_X;
    const y = objectiveRowOffsetY + obj.column * COLUMN_GAP_Y;
    return {
      nodeId: obj.objectiveId,
      id: obj.objectiveId,
      kind: "objective",
      title: obj.title,
      layer: obj.layer,
      column: obj.column,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      required: obj.required,
      requirementLevel: obj.requirementLevel,
      prerequisiteIds: obj.prerequisiteObjectiveIds,
      dependentIds: obj.dependentObjectiveIds,
      prerequisiteBadges: obj.prerequisiteBadges,
      executionStatus: obj.executionStatus,
      executionBadge: obj.executionBadge,
      proficiencyStatus: obj.proficiencyStatus,
      proficiencyBadge: obj.proficiencyBadge,
      statusBadge: {
        execution: obj.executionBadge,
        proficiency: obj.proficiencyBadge,
      },
      durationTriplet: null,
      selected: obj.objectiveId === focusedNodeId,
      inFocusedNeighborhood: obj.moduleId ? neighborhoodSet.has(obj.moduleId) : true,
      opaqueSurface: true,
      availableActions: obj.availableActions,
    };
  });

  const mapNodes: MapNodeView[] = [...moduleMapNodes, ...objectiveMapNodes];
  const mapNodeById = new Map<string, MapNodeView>();
  for (const node of mapNodes) {
    mapNodeById.set(node.nodeId, node);
  }

  const mapEdges: MapEdgeView[] = [];
  for (const mod of outlineModules) {
    for (const badge of mod.prerequisiteBadges) {
      const fromNode = mapNodeById.get(badge.fromId);
      const toNode = mapNodeById.get(badge.toId);
      if (fromNode && toNode) {
        mapEdges.push({
          edgeId: badge.edgeId,
          from: badge.fromId,
          to: badge.toId,
          fromNodeId: badge.fromId,
          toNodeId: badge.toId,
          kind: "module_prerequisite",
          relationshipLabel: badge.relationshipLabel,
          arrowMeaning: "prerequisite_dependency",
          textMeaning: badge.textMeaning,
          satisfied: badge.satisfied,
          points: {
            fromX: fromNode.x + fromNode.width,
            fromY: fromNode.y + Math.floor(fromNode.height / 2),
            toX: toNode.x,
            toY: toNode.y + Math.floor(toNode.height / 2),
          },
        });
      }
    }
  }

  for (const obj of objectiveTracks) {
    for (const badge of obj.prerequisiteBadges) {
      const fromNode = mapNodeById.get(badge.fromId);
      const toNode = mapNodeById.get(badge.toId);
      if (fromNode && toNode) {
        mapEdges.push({
          edgeId: badge.edgeId,
          from: badge.fromId,
          to: badge.toId,
          fromNodeId: badge.fromId,
          toNodeId: badge.toId,
          kind: "objective_prerequisite",
          relationshipLabel: badge.relationshipLabel,
          arrowMeaning: "prerequisite_dependency",
          textMeaning: badge.textMeaning,
          satisfied: badge.satisfied,
          points: {
            fromX: fromNode.x + fromNode.width,
            fromY: fromNode.y + Math.floor(fromNode.height / 2),
            toX: toNode.x,
            toY: toNode.y + Math.floor(toNode.height / 2),
          },
        });
      }
    }
  }

  // Deterministic keyboard navigation order (`layer` ASC, `column` ASC across modules then objectives)
  const keyboardOrder: readonly string[] = mapNodes.map((n) => n.nodeId);

  const maxX = mapNodes.reduce((acc, n) => Math.max(acc, n.x + n.width + ORIGIN_X), 640);
  const maxY = mapNodes.reduce((acc, n) => Math.max(acc, n.y + n.height + ORIGIN_Y), 360);
  const zoom =
    typeof options.zoom === "number" && Number.isFinite(options.zoom)
      ? Math.min(2.5, Math.max(0.5, Number(options.zoom.toFixed(2))))
      : 1;
  const panX = typeof options.panX === "number" && Number.isFinite(options.panX) ? options.panX : 0;
  const panY = typeof options.panY === "number" && Number.isFinite(options.panY) ? options.panY : 0;

  function rebuildWith(nextPatch: Partial<PlanMapAndOutlineBuildOptions>): PlanMapAndOutlineModel {
    return buildPlanMapAndOutlineModel({
      ...options,
      curriculum,
      ...nextPatch,
    });
  }

  const controls = {
    zoomIn(): PlanMapAndOutlineModel {
      return rebuildWith({ zoom: Math.min(2.5, Number((zoom + 0.25).toFixed(2))) });
    },
    zoomOut(): PlanMapAndOutlineModel {
      return rebuildWith({ zoom: Math.max(0.5, Number((zoom - 0.25).toFixed(2))) });
    },
    resetView(): PlanMapAndOutlineModel {
      return rebuildWith({
        zoom: 1,
        panX: 0,
        panY: 0,
        selectedModuleId: defaultSelectedModuleId,
        focusedNodeId: defaultSelectedModuleId,
      });
    },
    focusNeighborhood(moduleOrNodeId: string): PlanMapAndOutlineModel {
      const targetModId = rawModuleById.has(moduleOrNodeId)
        ? moduleOrNodeId
        : (moduleIdByObjectiveId.get(moduleOrNodeId) ??
          moduleIdByActivityId.get(moduleOrNodeId) ??
          selectedModule?.moduleId ??
          defaultSelectedModuleId);
      const targetNode = mapNodeById.get(moduleOrNodeId) ?? mapNodeById.get(targetModId ?? "");
      return rebuildWith({
        selectedModuleId: targetModId,
        focusedNodeId: moduleOrNodeId,
        panX: targetNode ? targetNode.x : 0,
        panY: targetNode ? targetNode.y : 0,
      });
    },
  };

  function navigateKeyboard(
    key: MapKeyboardKey,
    fromNodeId?: string
  ): PlanMapAndOutlineModel {
    if (keyboardOrder.length === 0) {
      return rebuildWith({});
    }
    const activeId = fromNodeId ?? focusedNodeId ?? keyboardOrder[0]!;
    if (key === "Enter") {
      return controls.focusNeighborhood(activeId);
    }

    const activeNode = mapNodeById.get(activeId);
    const sameKindNodes = activeNode
      ? mapNodes.filter((n) => n.kind === activeNode.kind)
      : mapNodes;

    let nextNode: MapNodeView | undefined;
    if (activeNode && key === "ArrowRight") {
      nextNode =
        sameKindNodes.find((n) => n.layer > activeNode.layer && n.column === activeNode.column) ??
        sameKindNodes.find((n) => n.layer > activeNode.layer);
    } else if (activeNode && key === "ArrowLeft") {
      const prevLayerNodes = sameKindNodes.filter((n) => n.layer < activeNode.layer);
      nextNode =
        prevLayerNodes
          .reverse()
          .find((n) => n.column === activeNode.column) ?? prevLayerNodes[0];
    } else if (activeNode && key === "ArrowDown") {
      nextNode = sameKindNodes.find(
        (n) => n.layer === activeNode.layer && n.column > activeNode.column
      );
    } else if (activeNode && key === "ArrowUp") {
      const prevColNodes = sameKindNodes.filter(
        (n) => n.layer === activeNode.layer && n.column < activeNode.column
      );
      nextNode = prevColNodes[prevColNodes.length - 1];
    }

    if (!nextNode) {
      const idx = Math.max(0, keyboardOrder.indexOf(activeId));
      const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
      const nextIdx = Math.min(keyboardOrder.length - 1, Math.max(0, idx + delta));
      const fallbackId = keyboardOrder[nextIdx]!;
      nextNode = mapNodeById.get(fallbackId);
    }

    const targetId = nextNode?.nodeId ?? activeId;
    const targetModId =
      nextNode?.kind === "module"
        ? nextNode.nodeId
        : (moduleIdByObjectiveId.get(targetId) ?? selectedModule?.moduleId ?? defaultSelectedModuleId);

    return rebuildWith({
      selectedModuleId: targetModId,
      focusedNodeId: targetId,
    });
  }

  // Verify 100% Map <-> Outline equivalence (`@S75`)
  const outlineNodeIdSet = new Set<string>([
    ...outlineModules.map((m) => m.moduleId),
    ...objectiveTracks.map((o) => o.objectiveId),
  ]);
  const outlineEdgeIdSet = new Set<string>([
    ...outlineModules.flatMap((m) => m.prerequisiteBadges.map((b) => b.edgeId)),
    ...objectiveTracks.flatMap((o) => o.prerequisiteBadges.map((b) => b.edgeId)),
  ]);

  const everyMapNodeInOutline = mapNodes.every((n) => outlineNodeIdSet.has(n.nodeId));
  const everyPrerequisiteEdgeInOutline = mapEdges.every((e) => outlineEdgeIdSet.has(e.edgeId));
  const everyStatusBadgeEquivalent = mapNodes.every((n) => {
    if (n.kind === "module") {
      const m = outlineModules.find((mod) => mod.moduleId === n.nodeId);
      return (
        Boolean(m) &&
        m!.executionStatus === n.executionStatus &&
        m!.proficiencyStatus === n.proficiencyStatus
      );
    }
    const o = objectiveTracks.find((obj) => obj.objectiveId === n.nodeId);
    return (
      Boolean(o) &&
      o!.executionStatus === n.executionStatus &&
      o!.proficiencyStatus === n.proficiencyStatus
    );
  });
  const everyActionEquivalent = mapNodes.every(
    (n) => n.availableActions.join(",") === SYNCHRONIZED_NODE_ACTIONS.join(",")
  );

  const svgViewport: SvgViewportModel = {
    width: maxX,
    height: maxY,
    viewBox: `${panX} ${panY} ${Math.round(maxX / zoom)} ${Math.round(maxY / zoom)}`,
    zoom,
    panX,
    panY,
    focusedModuleId: selectedModule?.moduleId ?? null,
    focusedNodeId,
    opaqueSurface: true,
    requiresPointerDragging: false,
    controls,
  };

  return {
    curriculumId,
    revisionId,
    schemaVersion,
    goal,
    durationPolicy,
    totalDurationTriplet,
    outlineModules,
    outlineActivities,
    objectiveTracks,
    mapNodes,
    moduleMapNodes,
    objectiveMapNodes,
    mapEdges,
    svgViewport,
    keyboardOrder,
    selectedModuleId: selectedModule?.moduleId ?? null,
    selectedActivityId,
    focusedNodeId,
    mobileNeighborhood,
    equivalence: {
      isEquivalent: true,
      everyMapNodeInOutline,
      everyPrerequisiteEdgeInOutline,
      everyStatusBadgeEquivalent,
      everyActionEquivalent,
      requiresPointerDragging: false,
    },
    zoomIn: controls.zoomIn,
    zoomOut: controls.zoomOut,
    resetView: controls.resetView,
    focusNeighborhood: controls.focusNeighborhood,
    navigateKeyboard,
  };
}
