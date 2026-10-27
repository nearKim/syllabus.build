/**
 * Synchronized `Plan` `Outline` + Basic Interactive `Map` Renderer & View-Model
 * (`UI-001`..`UI-005`, `UI-014`, `@S17`, `@S23`, `@S25`, `@S26`, `@S75`, `@S76`).
 */

import {
  ALLOWLISTED_ACTIVITY_TYPES,
  isSafeResourceUrl,
  sanitizeText,
  type AllowlistedActivityType,
} from "./SafeActivityRenderer.ts";

export const ACTIVITY_EXECUTION_STATUSES = [
  "not_started", "in_progress", "self_reported_completed", "completed", "waived",
] as const;

export type ActivityExecutionStatus = (typeof ACTIVITY_EXECUTION_STATUSES)[number];

export const OBJECTIVE_PROFICIENCY_BADGE_STATUSES = [
  "unassessed", "self_reported", "in_progress", "needs_review", "demonstrated",
] as const;

export type ObjectiveProficiencyBadgeStatus = (typeof OBJECTIVE_PROFICIENCY_BADGE_STATUSES)[number];

export const MAP_KEYBOARD_KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Enter"] as const;
export type MapKeyboardKey = (typeof MAP_KEYBOARD_KEYS)[number];

export const SYNCHRONIZED_NODE_ACTIONS = [
  "select_node", "open_details", "inspect_prerequisites", "focus_neighborhood", "study_ahead",
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
  readonly coverageLimitation: { readonly missingRequirement: string; readonly explanation: string } | null;
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
  readonly points: { readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number };
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

export interface CatalogResourceVectorIndexMetadata {
  readonly status?: "indexed" | "pending_reindex" | "quarantined" | string | undefined;
  readonly embedding_model?: string | undefined;
  readonly dimensions?: number | undefined;
  readonly index_type?: string | undefined;
  readonly chunk_count?: number | undefined;
  readonly discovered_by?: "Curator Verified" | "AI Web Search" | "Community Published" | string | undefined;
  readonly discovered_by_handle?: string | undefined;
  readonly last_indexed_at?: string | undefined;
}

export interface CatalogResourceMetadataInput {
  readonly resource_version_id?: string | undefined;
  readonly title?: string | undefined;
  readonly canonical_url?: string | undefined;
  readonly captured_at?: string | undefined;
  readonly category?: "Book" | "Course" | "YouTube" | "Code Lab" | "Problem Set" | string | undefined;
  readonly subject?: string | undefined;
  readonly provider?: { readonly provider_id?: string | undefined; readonly display_name?: string | undefined } | undefined;
  readonly access?: {
    readonly model?: string | undefined;
    readonly tier_label?: string | undefined;
    readonly cost_label?: string | undefined;
    readonly rights_label?: string | undefined;
    readonly certificate_included?: boolean | undefined;
    readonly optional_certificate_price_minor?: number | null | undefined;
    readonly access_verified_at?: string | undefined;
  } | undefined;
  readonly ingestion_permissions?: {
    readonly basis?: string | undefined;
    readonly permissions?: { readonly display_excerpts?: string | undefined } | undefined;
  } | undefined;
  readonly vector_index?: CatalogResourceVectorIndexMetadata | undefined;
  readonly segments?: readonly {
    readonly segment_id?: string | undefined;
    readonly title?: string | undefined;
    readonly verified?: boolean | undefined;
  }[] | undefined;
}

export interface PlanMapAndOutlineBuildOptions {
  readonly curriculum?: Record<string, unknown>;
  readonly proficiency?: Record<string, unknown> | null;
  readonly activityStates?: Readonly<Record<string, ActivityExecutionStatus | string>>;
  readonly catalogResources?: Readonly<Record<string, CatalogResourceMetadataInput>> | readonly CatalogResourceMetadataInput[];
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

const EXECUTION_BADGE_LABELS: Readonly<Record<ActivityExecutionStatus, { readonly label: string; readonly nonColorCue: string }>> = {
  not_started: { label: "Not started", nonColorCue: "[ ] Not started" },
  in_progress: { label: "In progress", nonColorCue: "[~] In progress" },
  self_reported_completed: {
    label: "Self-reported complete (unverified)",
    nonColorCue: "[self] Self-reported complete — assessment required for competence",
  },
  completed: { label: "Completed", nonColorCue: "[✓] Completed" },
  waived: { label: "Waived by reviewed evidence", nonColorCue: "[↦] Waived (not completed)" },
};

const PROFICIENCY_BADGE_LABELS: Readonly<Record<ObjectiveProficiencyBadgeStatus, { readonly label: string; readonly nonColorCue: string }>> = {
  unassessed: { label: "Unassessed", nonColorCue: "○ Unassessed (no reviewed evidence)" },
  self_reported: { label: "Self-reported only", nonColorCue: "◐ Self-reported claim (unverified)" },
  in_progress: { label: "In progress", nonColorCue: "◔ Practice in progress" },
  needs_review: { label: "Needs review", nonColorCue: "◑ Due for spaced review or additional practice" },
  demonstrated: { label: "Demonstrated", nonColorCue: "● Demonstrated via reviewed assessment evidence" },
};

const asObj = (val: unknown): Record<string, unknown> =>
  val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : {};

const asStringArray = (val: unknown): string[] =>
  Array.isArray(val) ? val.map((item) => sanitizeText(item)).filter(Boolean) : [];

function normalizeExecutionStatus(raw: unknown, isWaived = false): ActivityExecutionStatus {
  if (isWaived) return "waived";
  if (typeof raw === "string" && (ACTIVITY_EXECUTION_STATUSES as readonly string[]).includes(raw)) {
    return raw as ActivityExecutionStatus;
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

function makeDurationTriplet(
  min: number,
  point: number,
  max: number,
  mediaMinutesAt1x: number,
  nonMediaMinutesAt1x: number,
  playbackSpeed: number,
): DurationTripletView {
  return {
    min,
    point,
    max,
    minMinutes: min,
    pointMinutes: point,
    maxMinutes: max,
    mediaMinutesAt1x,
    nonMediaMinutesAt1x,
    playbackSpeed,
    rounding: "ceil_per_activity",
    rangeInterpretation: "planning_bounds_not_confidence_interval",
  };
}

function computeComponentDurationSum(bounds: Record<string, unknown>): {
  readonly media: number;
  readonly nonMedia: number;
  readonly totalAt1x: number;
} {
  const num = (k: string) => (typeof bounds[k] === "number" ? Math.max(0, bounds[k] as number) : 0);
  const media = num("media_minutes");
  const nonMedia = num("reading_minutes") + num("practice_minutes") + num("assessment_minutes") + num("review_minutes");
  return { media, nonMedia, totalAt1x: media + nonMedia };
}

export function computeActivityDurationTriplet(
  rawDurationEstimate: unknown,
  playbackSpeed: number,
  curriculumHasMediaMinutes = false,
): DurationTripletView {
  const safeSpeed =
    typeof playbackSpeed === "number" && Number.isFinite(playbackSpeed) && playbackSpeed > 0
      ? Math.min(3, Math.max(0.5, playbackSpeed))
      : 1;
  const est = asObj(rawDurationEstimate);
  const pointParts = computeComponentDurationSum(est);
  const lowerParts = computeComponentDurationSum(est["lower_bounds"] ? asObj(est["lower_bounds"]) : est);
  const upperParts = computeComponentDurationSum(est["upper_bounds"] ? asObj(est["upper_bounds"]) : est);

  const scale = (parts: { media: number; nonMedia: number; totalAt1x: number }) => {
    if (curriculumHasMediaMinutes || pointParts.media > 0) return Math.ceil(parts.media / safeSpeed) + parts.nonMedia;
    return safeSpeed !== 1 ? Math.ceil(parts.totalAt1x / safeSpeed) : parts.totalAt1x;
  };

  return makeDurationTriplet(
    scale(lowerParts),
    scale(pointParts),
    scale(upperParts),
    pointParts.media,
    pointParts.nonMedia,
    safeSpeed,
  );
}

interface DagLayoutPosition {
  readonly id: string;
  readonly layer: number;
  readonly column: number;
  readonly topologicalIndex: number;
}

function computeDeterministicDagLayout(
  nodeIdsInOrder: readonly string[],
  edges: readonly { readonly from: string; readonly to: string }[],
): ReadonlyMap<string, DagLayoutPosition> {
  const knownIds = new Set(nodeIdsInOrder);
  const orderIdx = new Map(nodeIdsInOrder.map((id, idx) => [id, idx]));
  const prereqs = new Map(nodeIdsInOrder.map((id) => [id, new Set<string>()]));
  const deps = new Map(nodeIdsInOrder.map((id) => [id, new Set<string>()]));
  const inDegree = new Map(nodeIdsInOrder.map((id) => [id, 0]));
  const layerByNode = new Map(nodeIdsInOrder.map((id) => [id, 0]));

  for (const { from, to } of edges) {
    if (knownIds.has(from) && knownIds.has(to) && from !== to && !prereqs.get(to)!.has(from)) {
      prereqs.get(to)!.add(from);
      deps.get(from)!.add(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const byOrigOrder = (a: string, b: string) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0);
  const ready = nodeIdsInOrder.filter((id) => (inDegree.get(id) ?? 0) === 0).sort(byOrigOrder);
  const visitedOrder: string[] = [];
  const visitedSet = new Set<string>();

  while (ready.length > 0) {
    const current = ready.shift()!;
    if (visitedSet.has(current)) continue;
    visitedSet.add(current);
    visitedOrder.push(current);
    const currentLayer = layerByNode.get(current) ?? 0;
    for (const dep of Array.from(deps.get(current) ?? []).sort(byOrigOrder)) {
      layerByNode.set(dep, Math.max(layerByNode.get(dep) ?? 0, currentLayer + 1));
      const nextIn = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, nextIn);
      if (nextIn <= 0 && !visitedSet.has(dep)) {
        ready.push(dep);
        ready.sort(byOrigOrder);
      }
    }
  }

  for (const id of nodeIdsInOrder) {
    if (!visitedSet.has(id)) visitedOrder.push(id);
  }

  const nodesByLayer = new Map<number, string[]>();
  for (const id of visitedOrder) {
    const layer = layerByNode.get(id) ?? 0;
    nodesByLayer.set(layer, [...(nodesByLayer.get(layer) ?? []), id]);
  }

  const result = new Map<string, DagLayoutPosition>();
  let topoIdx = 0;
  for (const layer of Array.from(nodesByLayer.keys()).sort((a, b) => a - b)) {
    const group = (nodesByLayer.get(layer) ?? []).sort(byOrigOrder);
    group.forEach((id, column) => result.set(id, { id, layer, column, topologicalIndex: topoIdx++ }));
  }
  return result;
}

function normalizeArgs(
  firstArg: Record<string, unknown> | PlanMapAndOutlineBuildOptions,
  secondArg?: Record<string, unknown> | PlanMapAndOutlineBuildOptions | null,
  thirdArg?: Readonly<Record<string, ActivityExecutionStatus | string>>,
  fourthArg?: Partial<PlanMapAndOutlineBuildOptions>,
): { readonly curriculum: Record<string, unknown>; readonly options: PlanMapAndOutlineBuildOptions } {
  if (
    firstArg && typeof firstArg === "object" && "curriculum" in firstArg &&
    firstArg["curriculum"] && typeof firstArg["curriculum"] === "object" &&
    !("schema_version" in firstArg && "modules" in firstArg)
  ) {
    const opts = firstArg as PlanMapAndOutlineBuildOptions;
    return { curriculum: opts.curriculum ?? {}, options: opts };
  }
  const curriculum = (firstArg as Record<string, unknown>) ?? {};
  const isOptionsObj =
    secondArg && typeof secondArg === "object" &&
    ["activityStates", "playbackSpeed", "viewportWidthPx", "selectedModuleId", "selectedActivityId", "proficiency", "catalogResources", "zoom"]
      .some((k) => k in secondArg);

  if (isOptionsObj) {
    return {
      curriculum,
      options: { ...(secondArg as PlanMapAndOutlineBuildOptions), ...(thirdArg ? { activityStates: thirdArg } : {}), ...(fourthArg ?? {}) },
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
  rawCatalog: Readonly<Record<string, CatalogResourceMetadataInput>> | readonly CatalogResourceMetadataInput[] | undefined,
): ReadonlyMap<string, CatalogResourceMetadataInput> {
  const map = new Map<string, CatalogResourceMetadataInput>();
  if (!rawCatalog) return map;
  if (Array.isArray(rawCatalog)) {
    for (const item of rawCatalog) {
      if (item && typeof item === "object" && typeof item.resource_version_id === "string") {
        map.set(item.resource_version_id, item);
      }
    }
    return map;
  }
  for (const [k, v] of Object.entries(rawCatalog)) {
    if (v && typeof v === "object") map.set(k, v as CatalogResourceMetadataInput);
  }
  return map;
}

export function buildPlanMapAndOutlineModel(
  curriculumOrOptions: Record<string, unknown> | PlanMapAndOutlineBuildOptions,
  proficiencyOrOptions?: Record<string, unknown> | PlanMapAndOutlineBuildOptions | null,
  activityStatesArg?: Readonly<Record<string, ActivityExecutionStatus | string>>,
  extraOptionsArg?: Partial<PlanMapAndOutlineBuildOptions>,
): PlanMapAndOutlineModel {
  const { curriculum, options } = normalizeArgs(curriculumOrOptions, proficiencyOrOptions, activityStatesArg, extraOptionsArg);
  const schemaVersion = sanitizeText(curriculum["schema_version"], "0.2.0");
  const curriculumId = sanitizeText(curriculum["curriculum_id"], "curriculum-default");
  const revisionId = sanitizeText(curriculum["revision_id"], "revision-default");
  const createdAt = sanitizeText(curriculum["created_at"], "2026-10-20T16:00:00Z");

  const rawGoal = asObj(curriculum["goal"]);
  const goal = {
    title: sanitizeText(rawGoal["title"], "Curriculum Plan"),
    summary: sanitizeText(rawGoal["summary"], ""),
    includedTopics: asStringArray(rawGoal["included_topics"]),
    excludedTopics: asStringArray(rawGoal["excluded_topics"]),
    scopeNote: sanitizeText(rawGoal["scope_note"], ""),
  };

  const rawDurationPolicy = asObj(curriculum["duration_policy"]);
  const defaultSpeed = typeof rawDurationPolicy["playback_speed"] === "number" ? rawDurationPolicy["playback_speed"] : 1;
  const playbackSpeed =
    typeof options.playbackSpeed === "number" && options.playbackSpeed > 0
      ? Math.min(3, Math.max(0.5, options.playbackSpeed))
      : defaultSpeed;

  const durationPolicy = {
    playbackSpeed,
    rounding: "ceil_per_activity" as const,
    policyVersion: sanitizeText(rawDurationPolicy["policy_version"], "synthetic-duration-policy"),
  };

  const waiverRefSet = new Set<string>(asStringArray(asObj(curriculum["adaptation_context"])["waiver_refs"]));

  const certificationByResourceVersionId = new Map<string, { readonly rationale: string; readonly mappedObjectiveIds: readonly string[] }>();
  for (const rawCert of Array.isArray(curriculum["certification_options"]) ? curriculum["certification_options"] : []) {
    const cert = asObj(rawCert);
    const rvId = sanitizeText(cert["resource_version_id"]);
    if (rvId) {
      certificationByResourceVersionId.set(rvId, {
        rationale: sanitizeText(cert["rationale"], "Optional certification preparation"),
        mappedObjectiveIds: asStringArray(cert["mapped_objective_ids"]),
      });
    }
  }

  const coverageLimitationByObjectiveId = new Map<string, { readonly missingRequirement: string; readonly explanation: string }>();
  for (const rawLim of Array.isArray(curriculum["coverage_limitations"]) ? curriculum["coverage_limitations"] : []) {
    const lim = asObj(rawLim);
    const objId = sanitizeText(lim["objective_id"]);
    if (objId) {
      coverageLimitationByObjectiveId.set(objId, {
        missingRequirement: sanitizeText(lim["missing_requirement"], "source_coverage"),
        explanation: sanitizeText(lim["explanation"], "Coverage limitation disclosed."),
      });
    }
  }

  const rawObjectiveEvidence = Array.isArray(asObj(options.proficiency)["objective_evidence"])
    ? (asObj(options.proficiency)["objective_evidence"] as unknown[])
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
    const ev = asObj(rawEv);
    const objectiveId = sanitizeText(ev["objective_id"]);
    const objectiveVersionId = sanitizeText(ev["objective_version_id"]);
    const rawSupport = sanitizeText(ev["evidence_support"], "none");
    const parsed: ParsedObjectiveEvidence = {
      objectiveId,
      objectiveVersionId,
      topicId: sanitizeText(ev["topic_id"]),
      rawStatus: sanitizeText(ev["status"], "unknown"),
      evidenceSupport: rawSupport === "corroborated" || rawSupport === "limited" ? rawSupport : "none",
      evidenceRefs: asStringArray(ev["evidence_refs"]),
      refreshRecommended: ev["refresh_recommended"] === true,
    };
    if (objectiveId) evidenceByObjectiveId.set(objectiveId, parsed);
    if (objectiveVersionId) evidenceByObjectiveId.set(objectiveVersionId, parsed);
  }

  const rawActivities = Array.isArray(curriculum["activities"]) ? curriculum["activities"] : [];
  const curriculumHasMediaMinutes = rawActivities.some((rawAct) => {
    const media = asObj(asObj(rawAct)["duration_estimate"])["media_minutes"];
    return typeof media === "number" && media > 0;
  });

  const activityStatesInput = options.activityStates ?? {};
  const studyAheadSet = new Set<string>(options.studyAheadActivityIds ?? []);
  const catalogLookup = buildResourceLookup(options.catalogResources);

  const rawModules = Array.isArray(curriculum["modules"]) ? curriculum["modules"] : [];
  const moduleIdByObjectiveId = new Map<string, string>();
  const moduleIdByActivityId = new Map<string, string>();

  for (const rawMod of rawModules) {
    const m = asObj(rawMod);
    const modId = sanitizeText(m["module_id"] ?? m["id"]);
    for (const oid of asStringArray(m["objective_ids"])) {
      if (!moduleIdByObjectiveId.has(oid)) moduleIdByObjectiveId.set(oid, modId);
    }
    for (const aid of asStringArray(m["activity_ids"])) {
      if (!moduleIdByActivityId.has(aid)) moduleIdByActivityId.set(aid, modId);
    }
  }

  const objectiveEdges: { readonly from: string; readonly to: string }[] = [];
  for (const rawEdge of Array.isArray(curriculum["prerequisite_edges"]) ? curriculum["prerequisite_edges"] : []) {
    const e = asObj(rawEdge);
    const from = sanitizeText(e["from_objective_id"] ?? e["from"]);
    const to = sanitizeText(e["to_objective_id"] ?? e["to"]);
    if (from && to && from !== to) objectiveEdges.push({ from, to });
  }

  const objectiveIdsInOrder: string[] = [];
  const rawObjectiveById = new Map<string, Record<string, unknown>>();
  for (const rawObj of Array.isArray(curriculum["objectives"]) ? curriculum["objectives"] : []) {
    const obj = asObj(rawObj);
    const objId = sanitizeText(obj["objective_id"] ?? obj["id"]);
    if (objId && !rawObjectiveById.has(objId)) {
      objectiveIdsInOrder.push(objId);
      rawObjectiveById.set(objId, obj);
    }
  }

  for (const rawEv of rawObjectiveEvidence) {
    const ev = asObj(rawEv);
    const objId = sanitizeText(ev["objective_id"]);
    if (objId && !rawObjectiveById.has(objId)) {
      objectiveIdsInOrder.push(objId);
      rawObjectiveById.set(objId, {
        objective_id: objId,
        objective_version_id: sanitizeText(ev["objective_version_id"], `${objId}-v1`),
        topic_id: sanitizeText(ev["topic_id"], "topic-general"),
        title: sanitizeText(ev["title"], objId),
        description: sanitizeText(ev["conditions_summary"], "Prior proficiency profile objective."),
        success_criterion: "Demonstrated under reviewed criterion policy.",
        level: "introductory",
        requirement_level: "required",
        assessment_activity_ids: [],
        prior_evidence_refs: Array.isArray(ev["evidence_refs"]) ? ev["evidence_refs"] : [],
      });
    }
  }

  const objectiveLayout = computeDeterministicDagLayout(objectiveIdsInOrder, objectiveEdges);
  const rawActivityById = new Map<string, Record<string, unknown>>();
  const activityIdsByObjectiveId = new Map<string, string[]>();
  const executionStatusByActivityId = new Map<string, ActivityExecutionStatus>();

  for (const rawAct of rawActivities) {
    const act = asObj(rawAct);
    const actId = sanitizeText(act["activity_id"] ?? act["id"]);
    if (!actId) continue;
    rawActivityById.set(actId, act);
    executionStatusByActivityId.set(actId, normalizeExecutionStatus(activityStatesInput[actId], waiverRefSet.has(actId)));
    for (const oid of asStringArray(act["objective_ids"])) {
      activityIdsByObjectiveId.set(oid, [...(activityIdsByObjectiveId.get(oid) ?? []), actId]);
    }
  }

  function resolveObjectiveProficiencyBadge(objectiveId: string): ObjectiveProficiencyBadgeView {
    const rawObj = rawObjectiveById.get(objectiveId);
    const objVersionId = rawObj ? sanitizeText(rawObj["objective_version_id"], objectiveId) : objectiveId;
    const ev = evidenceByObjectiveId.get(objectiveId) ?? evidenceByObjectiveId.get(objVersionId) ?? null;
    const linkedActIds = activityIdsByObjectiveId.get(objectiveId) ?? [];
    const selfReportedActivityCompleted = linkedActIds.some(
      (aid) => executionStatusByActivityId.get(aid) === "self_reported_completed",
    );
    const covLim = coverageLimitationByObjectiveId.get(objectiveId);

    let status: ObjectiveProficiencyBadgeStatus = "unassessed";
    if (ev) {
      if (ev.rawStatus === "demonstrated" && ev.evidenceRefs.length > 0 && ev.evidenceSupport !== "none" && !covLim) {
        status = ev.refreshRecommended ? "needs_review" : "demonstrated";
      } else if (ev.rawStatus === "needs_practice" || ev.rawStatus === "needs_review") {
        status = "needs_review";
      } else if (ev.rawStatus === "self_reported" || ev.rawStatus === "in_progress") {
        status = ev.rawStatus;
      }
    }

    const meta = PROFICIENCY_BADGE_LABELS[status];
    return {
      layer: "objective_proficiency",
      objectiveId,
      status,
      label: meta.label,
      nonColorCue: meta.nonColorCue,
      evidenceSupport: ev?.evidenceSupport ?? "none",
      evidenceRefs: ev?.evidenceRefs ?? [],
      selfReportedActivityCompleted,
      conflatedWithActivityCompletion: false,
    };
  }

  const proficiencyBadgeByObjectiveId = new Map(
    objectiveIdsInOrder.map((objId) => [objId, resolveObjectiveProficiencyBadge(objId)]),
  );

  const prereqObjectivesByObj = new Map(objectiveIdsInOrder.map((id) => [id, [] as string[]]));
  const dependentObjectivesByObj = new Map(objectiveIdsInOrder.map((id) => [id, [] as string[]]));
  for (const edge of objectiveEdges) {
    if (prereqObjectivesByObj.has(edge.to) && prereqObjectivesByObj.has(edge.from)) {
      prereqObjectivesByObj.get(edge.to)!.push(edge.from);
      dependentObjectivesByObj.get(edge.from)!.push(edge.to);
    }
  }

  const moduleIdsInOrder: string[] = [];
  const rawModuleById = new Map<string, Record<string, unknown>>();
  for (const rawMod of rawModules) {
    const m = asObj(rawMod);
    const modId = sanitizeText(m["module_id"] ?? m["id"]);
    if (modId && !rawModuleById.has(modId)) {
      moduleIdsInOrder.push(modId);
      rawModuleById.set(modId, m);
    }
  }

  const moduleEdgeSet = new Set<string>();
  const moduleEdges: { readonly from: string; readonly to: string }[] = [];
  const addModuleEdge = (fromMod: string | undefined, toMod: string | undefined) => {
    if (!fromMod || !toMod || fromMod === toMod || !rawModuleById.has(fromMod) || !rawModuleById.has(toMod)) return;
    const key = `${fromMod}->${toMod}`;
    if (!moduleEdgeSet.has(key)) {
      moduleEdgeSet.add(key);
      moduleEdges.push({ from: fromMod, to: toMod });
    }
  };

  for (const modId of moduleIdsInOrder) {
    for (const p of asStringArray(rawModuleById.get(modId)!["prerequisite_module_ids"])) {
      addModuleEdge(p, modId);
    }
  }
  for (const edge of objectiveEdges) {
    addModuleEdge(moduleIdByObjectiveId.get(edge.from), moduleIdByObjectiveId.get(edge.to));
  }
  for (const [actId, rawAct] of rawActivityById.entries()) {
    const toMod = moduleIdByActivityId.get(actId);
    for (const paid of asStringArray(rawAct["prerequisite_activity_ids"])) {
      addModuleEdge(moduleIdByActivityId.get(paid), toMod);
    }
  }

  const moduleLayout = computeDeterministicDagLayout(moduleIdsInOrder, moduleEdges);
  const sortedModuleIds = [...moduleIdsInOrder].sort(
    (a, b) => (moduleLayout.get(a)?.topologicalIndex ?? 0) - (moduleLayout.get(b)?.topologicalIndex ?? 0),
  );

  const prereqModulesByMod = new Map(moduleIdsInOrder.map((id) => [id, [] as string[]]));
  const dependentModulesByMod = new Map(moduleIdsInOrder.map((id) => [id, [] as string[]]));
  for (const edge of moduleEdges) {
    prereqModulesByMod.get(edge.to)!.push(edge.from);
    dependentModulesByMod.get(edge.from)!.push(edge.to);
  }

  function buildOutlineActivity(actId: string, owningModuleId: string): OutlineActivityView {
    const rawAct = rawActivityById.get(actId) ?? {};
    const rawType = sanitizeText(rawAct["type"] ?? rawAct["activity_type"], "theory");
    const actType: AllowlistedActivityType = (ALLOWLISTED_ACTIVITY_TYPES as readonly string[]).includes(rawType)
      ? (rawType as AllowlistedActivityType)
      : "theory";
    const title = sanitizeText(rawAct["title"], actId);
    const requirementLevel: "required" | "optional" = rawAct["requirement_level"] === "optional" ? "optional" : "required";
    const required = requirementLevel === "required";
    const objectiveIds = asStringArray(rawAct["objective_ids"]);
    const prerequisiteActivityIds = asStringArray(rawAct["prerequisite_activity_ids"]);

    const prerequisiteBadges: PrerequisiteBadgeView[] = prerequisiteActivityIds.map((prereqId) => {
      const prereqStatus = executionStatusByActivityId.get(prereqId) ?? "not_started";
      const satisfied = prereqStatus === "completed" || prereqStatus === "waived";
      const prereqTitle = sanitizeText(rawActivityById.get(prereqId)?.["title"], prereqId);
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

    const durationTriplet = computeActivityDurationTriplet(rawAct["duration_estimate"], playbackSpeed, curriculumHasMediaMinutes);

    const rawAssignments = Array.isArray(rawAct["resource_assignments"]) ? rawAct["resource_assignments"] : [];
    const resourceProvenanceCards: ResourceProvenanceCardView[] = rawAssignments
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
      .map((assignment) => {
        const rvId = sanitizeText(assignment["resource_version_id"], "unknown-resource");
        const role: "primary" | "supplemental" = assignment["role"] === "supplemental" ? "supplemental" : "primary";
        const catalogMeta = catalogLookup.get(rvId);
        const rightsBasis = sanitizeText(catalogMeta?.ingestion_permissions?.basis, "metadata_only");
        const displayExcerptsAllowed = catalogMeta?.ingestion_permissions?.permissions?.display_excerpts === "allowed";
        const rawSegments = asStringArray(assignment["segment_ids"]);
        const verifiedSegmentSet = new Set<string>(
          Array.isArray(catalogMeta?.segments)
            ? catalogMeta.segments.filter((s) => s && s.verified !== false && typeof s.segment_id === "string").map((s) => s.segment_id!)
            : rawSegments,
        );
        const certEntry = certificationByResourceVersionId.get(rvId);
        const canonicalUrl = catalogMeta?.canonical_url && isSafeResourceUrl(catalogMeta.canonical_url) ? catalogMeta.canonical_url : null;

        return {
          resourceVersionId: rvId,
          role,
          title: sanitizeText(catalogMeta?.title, rvId),
          verifiedPublisher: sanitizeText(catalogMeta?.provider?.display_name, "Verified Catalog Publisher"),
          versionTimestamp: sanitizeText(catalogMeta?.captured_at ?? catalogMeta?.access?.access_verified_at, createdAt),
          accessModel: sanitizeText(catalogMeta?.access?.model, "free"),
          rightsBadge: {
            basis: rightsBasis,
            label: displayExcerptsAllowed ? `Rights: ${rightsBasis} (permitted excerpt)` : `Rights: ${rightsBasis} (external link only)`,
            displayExcerptsAllowed,
            externalLinkOnly: !displayExcerptsAllowed,
          },
          optionalCertificationBadge: certEntry
            ? {
                included: Boolean(catalogMeta?.access?.certificate_included),
                relationship: "optional_preparation",
                label: "Optional certification preparation (separate from core completion)",
                rationale: certEntry.rationale,
                verifiedIssuerUrl: canonicalUrl,
                isAccreditedQualificationGuarantee: false,
              }
            : null,
          selectionRationale: sanitizeText(assignment["selection_rationale"], "Selected from approved catalog snapshot."),
          verifiedSegments: rawSegments.filter((segId) => verifiedSegmentSet.has(segId)),
          canonicalUrl,
          omitsUnverifiedPrecision: true,
        };
      });

    const executionStatus = executionStatusByActivityId.get(actId) ?? "not_started";
    const objectiveProficiencyBadges =
      objectiveIds.length > 0
        ? objectiveIds.map((oid) => proficiencyBadgeByObjectiveId.get(oid) ?? resolveObjectiveProficiencyBadge(oid))
        : [resolveObjectiveProficiencyBadge("unmapped-objective")];
    const primaryObjBadge = objectiveProficiencyBadges[0]!;
    const masteryGated = rawAct["mastery_gated"] === true;

    const unmetPrerequisiteActivityIds = prerequisiteActivityIds.filter((pid) => {
      const st = executionStatusByActivityId.get(pid) ?? "not_started";
      return st !== "completed" && st !== "waived";
    });

    const unmetPrerequisiteObjectiveIds: string[] = [];
    for (const oid of objectiveIds) {
      for (const poid of prereqObjectivesByObj.get(oid) ?? []) {
        if (proficiencyBadgeByObjectiveId.get(poid)?.status !== "demonstrated" && !unmetPrerequisiteObjectiveIds.includes(poid)) {
          unmetPrerequisiteObjectiveIds.push(poid);
        }
      }
    }

    const hasUnmetPrereqs = unmetPrerequisiteActivityIds.length > 0 || unmetPrerequisiteObjectiveIds.length > 0;
    const studyAheadAllowed = !masteryGated || !hasUnmetPrereqs;
    const prerequisiteBridgeRecommendation: PrerequisiteBridgeRecommendation | null =
      hasUnmetPrereqs || studyAheadSet.has(actId)
        ? {
            recommended: true,
            blocking: masteryGated && hasUnmetPrereqs,
            masteryGated,
            reason: masteryGated
              ? "Mastery-gated activity: demonstrated prerequisite proficiency is required before advancing."
              : "Non-blocking prerequisite bridge recommendation: you can study ahead, or complete the recommended prerequisite bridge activities first.",
            unmetPrerequisiteActivityIds,
            unmetPrerequisiteObjectiveIds,
            suggestedBridgeActivityIds: unmetPrerequisiteActivityIds.length > 0 ? unmetPrerequisiteActivityIds : prerequisiteActivityIds,
          }
        : null;

    const contentObj = asObj(rawAct["content"]);
    const promptSummary = sanitizeText(
      contentObj["study_prompt"] ?? contentObj["example_prompt"] ?? contentObj["task_prompt"] ??
      contentObj["recall_prompt"] ?? contentObj["reflection_prompt"] ?? contentObj["brief"] ?? title,
      title,
    );

    return {
      activityId: actId,
      moduleId: owningModuleId,
      title,
      type: actType,
      activityType: actType,
      requirementLevel,
      required,
      isOptionalEnrichment: !required,
      objectiveIds,
      prerequisiteActivityIds,
      prerequisiteBadges,
      durationTriplet,
      resourceProvenanceCards,
      executionStatus,
      executionBadge: makeExecutionBadge(executionStatus),
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

  const sortedObjectiveIds = [...objectiveIdsInOrder].sort(
    (a, b) => (objectiveLayout.get(a)?.topologicalIndex ?? 0) - (objectiveLayout.get(b)?.topologicalIndex ?? 0),
  );

  const objectiveTracks: ObjectiveTrackView[] = sortedObjectiveIds.map((objId) => {
    const rawObj = rawObjectiveById.get(objId) ?? {};
    const layoutPos = objectiveLayout.get(objId) ?? { id: objId, layer: 0, column: 0, topologicalIndex: 0 };
    const prereqIds = prereqObjectivesByObj.get(objId) ?? [];
    const depIds = dependentObjectivesByObj.get(objId) ?? [];
    const profBadge = proficiencyBadgeByObjectiveId.get(objId) ?? resolveObjectiveProficiencyBadge(objId);
    const linkedActs = activityIdsByObjectiveId.get(objId) ?? [];

    let rollupExec: ActivityExecutionStatus = "not_started";
    if (waiverRefSet.has(objId)) rollupExec = "waived";
    else if (linkedActs.length > 0 && linkedActs.every((aid) => executionStatusByActivityId.get(aid) === "completed")) rollupExec = "completed";
    else if (linkedActs.some((aid) => executionStatusByActivityId.get(aid) === "self_reported_completed")) rollupExec = "self_reported_completed";
    else if (linkedActs.some((aid) => executionStatusByActivityId.get(aid) === "in_progress")) rollupExec = "in_progress";

    const prereqBadges: PrerequisiteBadgeView[] = prereqIds.map((pId) => {
      const pProf = proficiencyBadgeByObjectiveId.get(pId) ?? resolveObjectiveProficiencyBadge(pId);
      const satisfied = pProf.status === "demonstrated";
      const pTitle = sanitizeText(rawObjectiveById.get(pId)?.["title"], pId);
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

    const rawLevel = sanitizeText(rawObj["level"], "introductory");
    const level: "introductory" | "applied" | "advanced" =
      rawLevel === "applied" || rawLevel === "advanced" ? rawLevel : "introductory";
    const requirementLevel: "required" | "optional" = rawObj["requirement_level"] === "optional" ? "optional" : "required";

    return {
      objectiveId: objId,
      objectiveVersionId: sanitizeText(rawObj["objective_version_id"], `${objId}-v1`),
      topicId: sanitizeText(rawObj["topic_id"], "topic-general"),
      moduleId: moduleIdByObjectiveId.get(objId) ?? null,
      title: sanitizeText(rawObj["title"], objId),
      description: sanitizeText(rawObj["description"], ""),
      successCriterion: sanitizeText(rawObj["success_criterion"], ""),
      level,
      requirementLevel,
      required: requirementLevel === "required",
      topologicalIndex: layoutPos.topologicalIndex,
      layer: layoutPos.layer,
      column: layoutPos.column,
      prerequisiteObjectiveIds: prereqIds,
      dependentObjectiveIds: depIds,
      prerequisiteBadges: prereqBadges,
      assessmentActivityIds: asStringArray(rawObj["assessment_activity_ids"]),
      activityIds: linkedActs,
      proficiencyStatus: profBadge.status,
      proficiencyBadge: profBadge,
      executionStatus: rollupExec,
      executionBadge: makeExecutionBadge(rollupExec),
      coverageLimitation: coverageLimitationByObjectiveId.get(objId) ?? null,
      availableActions: SYNCHRONIZED_NODE_ACTIONS,
    };
  });

  const objectiveTrackById = new Map(objectiveTracks.map((t) => [t.objectiveId, t]));

  const sumTriplets = (items: readonly OutlineActivityView[]) =>
    makeDurationTriplet(
      items.reduce((acc, a) => acc + a.durationTriplet.min, 0),
      items.reduce((acc, a) => acc + a.durationTriplet.point, 0),
      items.reduce((acc, a) => acc + a.durationTriplet.max, 0),
      items.reduce((acc, a) => acc + a.durationTriplet.mediaMinutesAt1x, 0),
      items.reduce((acc, a) => acc + a.durationTriplet.nonMediaMinutesAt1x, 0),
      playbackSpeed,
    );

  const outlineActivities: OutlineActivityView[] = [];
  const outlineModules: OutlineModuleView[] = sortedModuleIds.map((modId) => {
    const rawMod = rawModuleById.get(modId) ?? {};
    const layoutPos = moduleLayout.get(modId) ?? { id: modId, layer: 0, column: 0, topologicalIndex: 0 };
    const objIds = asStringArray(rawMod["objective_ids"]);
    const modObjectives = objIds.map((id) => objectiveTrackById.get(id)).filter((t): t is ObjectiveTrackView => Boolean(t));
    const actIds = asStringArray(rawMod["activity_ids"]);
    const modActivities = actIds.map((aid) => buildOutlineActivity(aid, modId));
    outlineActivities.push(...modActivities);

    const required = modActivities.some((a) => a.required) || modObjectives.some((o) => o.required);
    let modExecStatus: ActivityExecutionStatus = "not_started";
    if (modActivities.length > 0 && modActivities.every((a) => a.executionStatus === "waived")) modExecStatus = "waived";
    else if (modActivities.length > 0 && modActivities.every((a) => a.executionStatus === "completed" || a.executionStatus === "waived")) modExecStatus = "completed";
    else if (modActivities.some((a) => a.executionStatus === "self_reported_completed")) modExecStatus = "self_reported_completed";
    else if (modActivities.some((a) => a.executionStatus === "in_progress" || a.executionStatus === "completed")) modExecStatus = "in_progress";

    const primaryProfBadge = modObjectives[0]?.proficiencyBadge ?? resolveObjectiveProficiencyBadge(modId);
    const prereqModIds = prereqModulesByMod.get(modId) ?? [];
    const depModIds = dependentModulesByMod.get(modId) ?? [];

    const prereqBadges: PrerequisiteBadgeView[] = prereqModIds.map((pModId) => {
      const pTitle = sanitizeText(rawModuleById.get(pModId)?.["title"], pModId);
      const pModObjIds = asStringArray(rawModuleById.get(pModId)?.["objective_ids"]);
      const satisfied = pModObjIds.length > 0 && pModObjIds.every((oid) => proficiencyBadgeByObjectiveId.get(oid)?.status === "demonstrated");
      return {
        edgeId: `${pModId}->${modId}`,
        fromId: pModId,
        toId: modId,
        kind: "module_prerequisite",
        relationshipLabel: `Requires module: ${pTitle}`,
        textMeaning: satisfied
          ? `Prerequisite module "${pTitle}" has demonstrated proficiency.`
          : `Prerequisite module "${pTitle}" is a prerequisite before "${sanitizeText(rawMod["title"], modId)}".`,
        satisfied,
      };
    });

    return {
      moduleId: modId,
      title: sanitizeText(rawMod["title"], modId),
      summary: sanitizeText(rawMod["summary"], ""),
      topologicalIndex: layoutPos.topologicalIndex,
      layer: layoutPos.layer,
      column: layoutPos.column,
      requirementLevel: required ? "required" : "optional",
      required,
      objectiveIds: objIds,
      objectives: modObjectives,
      activityIds: actIds,
      activities: modActivities,
      prerequisiteModuleIds: prereqModIds,
      dependentModuleIds: depModIds,
      prerequisiteBadges: prereqBadges,
      durationTriplet: sumTriplets(modActivities),
      executionStatus: modExecStatus,
      executionBadge: makeExecutionBadge(modExecStatus),
      proficiencyStatus: primaryProfBadge.status,
      proficiencyBadge: primaryProfBadge,
      hasMasteryGatedActivities: modActivities.some((a) => a.masteryGated),
      availableActions: SYNCHRONIZED_NODE_ACTIONS,
    };
  });

  const totalDurationTriplet = sumTriplets(outlineActivities);

  const defaultSelectedModuleId = outlineModules[0]?.moduleId ?? null;
  const selectedModuleId = options.selectedModuleId !== undefined ? options.selectedModuleId : defaultSelectedModuleId;
  const selectedModule = outlineModules.find((m) => m.moduleId === selectedModuleId) ?? outlineModules[0] ?? null;
  const selectedActivityId =
    options.selectedActivityId !== undefined
      ? options.selectedActivityId
      : (selectedModule?.activities[0]?.activityId ?? outlineActivities[0]?.activityId ?? null);
  const focusedNodeId =
    options.focusedNodeId !== undefined
      ? options.focusedNodeId
      : (selectedModule?.moduleId ?? objectiveTracks[0]?.objectiveId ?? null);

  const viewportWidthPx = typeof options.viewportWidthPx === "number" && options.viewportWidthPx > 0 ? options.viewportWidthPx : 1280;
  const immediatePrerequisiteModuleIds = selectedModule ? selectedModule.prerequisiteModuleIds : [];
  const immediateDependentModuleIds = selectedModule ? selectedModule.dependentModuleIds : [];
  const neighborhoodSet = new Set<string>([
    ...immediatePrerequisiteModuleIds,
    ...(selectedModule ? [selectedModule.moduleId] : []),
    ...immediateDependentModuleIds,
  ]);
  const verticalTaskList = selectedModule ? selectedModule.activities : outlineActivities;
  const nextActionActivity =
    verticalTaskList.find((a) => a.executionStatus === "not_started" || a.executionStatus === "in_progress") ??
    verticalTaskList[0] ??
    null;

  const mobileNeighborhood: MobileNeighborhoodView = {
    isCompactMobile: viewportWidthPx < 768,
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

  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 88;
  const LAYER_GAP_X = 280;
  const COLUMN_GAP_Y = 136;
  const ORIGIN_X = 48;
  const ORIGIN_Y = 48;

  const moduleMapNodes: MapNodeView[] = outlineModules.map((mod) => ({
    nodeId: mod.moduleId,
    id: mod.moduleId,
    kind: "module",
    title: mod.title,
    layer: mod.layer,
    column: mod.column,
    x: ORIGIN_X + mod.layer * LAYER_GAP_X,
    y: ORIGIN_Y + mod.column * COLUMN_GAP_Y,
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
    statusBadge: { execution: mod.executionBadge, proficiency: mod.proficiencyBadge },
    durationTriplet: mod.durationTriplet,
    selected: mod.moduleId === (selectedModule?.moduleId ?? null),
    inFocusedNeighborhood: neighborhoodSet.has(mod.moduleId),
    opaqueSurface: true,
    availableActions: mod.availableActions,
  }));

  const maxModuleColumn = moduleMapNodes.reduce((acc, n) => Math.max(acc, n.column), 0);
  const objectiveRowOffsetY = ORIGIN_Y + (maxModuleColumn + 1) * COLUMN_GAP_Y + 40;

  const objectiveMapNodes: MapNodeView[] = objectiveTracks.map((obj) => ({
    nodeId: obj.objectiveId,
    id: obj.objectiveId,
    kind: "objective",
    title: obj.title,
    layer: obj.layer,
    column: obj.column,
    x: ORIGIN_X + obj.layer * LAYER_GAP_X,
    y: objectiveRowOffsetY + obj.column * COLUMN_GAP_Y,
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
    statusBadge: { execution: obj.executionBadge, proficiency: obj.proficiencyBadge },
    durationTriplet: null,
    selected: obj.objectiveId === focusedNodeId,
    inFocusedNeighborhood: obj.moduleId ? neighborhoodSet.has(obj.moduleId) : true,
    opaqueSurface: true,
    availableActions: obj.availableActions,
  }));

  const mapNodes: MapNodeView[] = [...moduleMapNodes, ...objectiveMapNodes];
  const mapNodeById = new Map(mapNodes.map((n) => [n.nodeId, n]));

  const buildEdgesFromBadges = (
    badges: readonly PrerequisiteBadgeView[],
    kind: "module_prerequisite" | "objective_prerequisite",
  ): MapEdgeView[] =>
    badges.flatMap((badge) => {
      const fromNode = mapNodeById.get(badge.fromId);
      const toNode = mapNodeById.get(badge.toId);
      if (!fromNode || !toNode) return [];
      return [{
        edgeId: badge.edgeId,
        from: badge.fromId,
        to: badge.toId,
        fromNodeId: badge.fromId,
        toNodeId: badge.toId,
        kind,
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
      }];
    });

  const mapEdges: MapEdgeView[] = [
    ...outlineModules.flatMap((m) => buildEdgesFromBadges(m.prerequisiteBadges, "module_prerequisite")),
    ...objectiveTracks.flatMap((o) => buildEdgesFromBadges(o.prerequisiteBadges, "objective_prerequisite")),
  ];

  const keyboardOrder: readonly string[] = mapNodes.map((n) => n.nodeId);
  const maxX = mapNodes.reduce((acc, n) => Math.max(acc, n.x + n.width + ORIGIN_X), 640);
  const maxY = mapNodes.reduce((acc, n) => Math.max(acc, n.y + n.height + ORIGIN_Y), 360);
  const zoom =
    typeof options.zoom === "number" && Number.isFinite(options.zoom)
      ? Math.min(2.5, Math.max(0.5, Number(options.zoom.toFixed(2))))
      : 1;
  const panX = typeof options.panX === "number" && Number.isFinite(options.panX) ? options.panX : 0;
  const panY = typeof options.panY === "number" && Number.isFinite(options.panY) ? options.panY : 0;

  const rebuildWith = (nextPatch: Partial<PlanMapAndOutlineBuildOptions>): PlanMapAndOutlineModel =>
    buildPlanMapAndOutlineModel({ ...options, curriculum, ...nextPatch });

  const controls = {
    zoomIn: () => rebuildWith({ zoom: Math.min(2.5, Number((zoom + 0.25).toFixed(2))) }),
    zoomOut: () => rebuildWith({ zoom: Math.max(0.5, Number((zoom - 0.25).toFixed(2))) }),
    resetView: () =>
      rebuildWith({
        zoom: 1,
        panX: 0,
        panY: 0,
        selectedModuleId: defaultSelectedModuleId,
        focusedNodeId: defaultSelectedModuleId,
      }),
    focusNeighborhood: (moduleOrNodeId: string) => {
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

  function navigateKeyboard(key: MapKeyboardKey, fromNodeId?: string): PlanMapAndOutlineModel {
    if (keyboardOrder.length === 0) return rebuildWith({});
    const activeId = fromNodeId ?? focusedNodeId ?? keyboardOrder[0]!;
    if (key === "Enter") return controls.focusNeighborhood(activeId);

    const activeNode = mapNodeById.get(activeId);
    const sameKindNodes = activeNode ? mapNodes.filter((n) => n.kind === activeNode.kind) : mapNodes;
    let nextNode: MapNodeView | undefined;

    if (activeNode && key === "ArrowRight") {
      nextNode =
        sameKindNodes.find((n) => n.layer > activeNode.layer && n.column === activeNode.column) ??
        sameKindNodes.find((n) => n.layer > activeNode.layer);
    } else if (activeNode && key === "ArrowLeft") {
      const prev = sameKindNodes.filter((n) => n.layer < activeNode.layer);
      nextNode = [...prev].reverse().find((n) => n.column === activeNode.column) ?? prev[0];
    } else if (activeNode && key === "ArrowDown") {
      nextNode = sameKindNodes.find((n) => n.layer === activeNode.layer && n.column > activeNode.column);
    } else if (activeNode && key === "ArrowUp") {
      const prev = sameKindNodes.filter((n) => n.layer === activeNode.layer && n.column < activeNode.column);
      nextNode = prev[prev.length - 1];
    }

    if (!nextNode) {
      const idx = Math.max(0, keyboardOrder.indexOf(activeId));
      const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
      nextNode = mapNodeById.get(keyboardOrder[Math.min(keyboardOrder.length - 1, Math.max(0, idx + delta))]!);
    }

    const targetId = nextNode?.nodeId ?? activeId;
    const targetModId =
      nextNode?.kind === "module"
        ? nextNode.nodeId
        : (moduleIdByObjectiveId.get(targetId) ?? selectedModule?.moduleId ?? defaultSelectedModuleId);
    return rebuildWith({ selectedModuleId: targetModId, focusedNodeId: targetId });
  }

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
    const item =
      n.kind === "module"
        ? outlineModules.find((m) => m.moduleId === n.nodeId)
        : objectiveTracks.find((o) => o.objectiveId === n.nodeId);
    return Boolean(item) && item!.executionStatus === n.executionStatus && item!.proficiencyStatus === n.proficiencyStatus;
  });
  const everyActionEquivalent = mapNodes.every((n) => n.availableActions.join(",") === SYNCHRONIZED_NODE_ACTIONS.join(","));

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
    svgViewport: {
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
    },
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
