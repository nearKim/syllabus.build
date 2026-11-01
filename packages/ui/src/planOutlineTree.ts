/**
 * Hierarchical outline tree representations, duration triplet calculations,
 * and mobile neighborhood projections for Plan Map and Outline.
 */

import {
  ALLOWLISTED_ACTIVITY_TYPES,
  isSafeResourceUrl,
  sanitizeText,
  type AllowlistedActivityType,
} from "./SafeActivityRenderer.ts";
import {
  type ActivityExecutionStatus,
  type ObjectiveProficiencyBadgeStatus,
  type SynchronizedNodeAction,
  SYNCHRONIZED_NODE_ACTIONS,
  type ActivityExecutionBadgeView,
  type ObjectiveProficiencyBadgeView,
  type PrerequisiteBadgeView,
  type RightsBadgeView,
  type OptionalCertificationBadgeView,
  type ResourceProvenanceCardView,
  PROFICIENCY_BADGE_LABELS,
  normalizeExecutionStatus,
  makeExecutionBadge,
} from "./planMapTokens.ts";

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
  readonly description?: string | undefined;
  readonly topics?: readonly string[] | undefined;
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

export const asObj = (val: unknown): Record<string, unknown> =>
  val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : {};

export const asStringArray = (val: unknown): string[] =>
  Array.isArray(val) ? val.map((item) => sanitizeText(item)).filter(Boolean) : [];

export function makeDurationTriplet(
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

export function computeComponentDurationSum(bounds: Record<string, unknown>): {
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
  syllabusHasMediaMinutes = false,
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
    if (syllabusHasMediaMinutes || pointParts.media > 0) return Math.ceil(parts.media / safeSpeed) + parts.nonMedia;
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

export function sumTriplets(items: readonly OutlineActivityView[], playbackSpeed = 1): DurationTripletView {
  return makeDurationTriplet(
    items.reduce((acc, a) => acc + a.durationTriplet.min, 0),
    items.reduce((acc, a) => acc + a.durationTriplet.point, 0),
    items.reduce((acc, a) => acc + a.durationTriplet.max, 0),
    items.reduce((acc, a) => acc + a.durationTriplet.mediaMinutesAt1x, 0),
    items.reduce((acc, a) => acc + a.durationTriplet.nonMediaMinutesAt1x, 0),
    playbackSpeed,
  );
}

export function buildResourceLookup(
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

export function computeMobileNeighborhood(
  outlineModules: readonly OutlineModuleView[],
  outlineActivities: readonly OutlineActivityView[],
  selectedModule: OutlineModuleView | null,
  viewportWidthPx: number,
): MobileNeighborhoodView {
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

  return {
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
}
