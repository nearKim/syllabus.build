/**
 * Synchronized `Plan` `Outline` + Basic Interactive `Map` Renderer & View-Model Facade
 * (`UI-001`..`UI-005`, `UI-014`, `@S17`, `@S23`, `@S25`, `@S26`, `@S75`, `@S76`).
 */

export * from "./planMapTokens.ts";
export * from "./planOutlineTree.ts";
export * from "./planMapLayout.ts";

import {
  ALLOWLISTED_ACTIVITY_TYPES,
  isSafeResourceUrl,
  sanitizeText,
  type AllowlistedActivityType,
} from "./SafeActivityRenderer.ts";
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  LAYER_GAP_X,
  COLUMN_GAP_Y,
  ORIGIN_X,
  ORIGIN_Y,
  SYNCHRONIZED_NODE_ACTIONS,
  PROFICIENCY_BADGE_LABELS,
  type ActivityExecutionStatus,
  type ObjectiveProficiencyBadgeStatus,
  type MapKeyboardKey,
  type ActivityExecutionBadgeView,
  type ObjectiveProficiencyBadgeView,
  type PrerequisiteBadgeView,
  type ResourceProvenanceCardView,
  normalizeExecutionStatus,
  makeExecutionBadge,
} from "./planMapTokens.ts";
import {
  type DurationTripletView,
  type PrerequisiteBridgeRecommendation,
  type OutlineActivityView,
  type ObjectiveTrackView,
  type OutlineModuleView,
  type CatalogResourceMetadataInput,
  type MobileNeighborhoodView,
  asObj,
  asStringArray,
  makeDurationTriplet,
  computeActivityDurationTriplet,
  sumTriplets,
  buildResourceLookup,
  computeMobileNeighborhood,
} from "./planOutlineTree.ts";
import {
  type MapNodeView,
  type MapEdgeView,
  type SvgViewportModel,
  type MapOutlineEquivalenceSummary,
  computeDeterministicDagLayout,
  buildEdgesFromBadges,
  computeMapOutlineEquivalence,
} from "./planMapLayout.ts";

export interface PlanMapAndOutlineBuildOptions {
  readonly syllabus?: Record<string, unknown>;
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
  readonly syllabusId: string;
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

function normalizeArgs(
  firstArg: Record<string, unknown> | PlanMapAndOutlineBuildOptions,
  secondArg?: Record<string, unknown> | PlanMapAndOutlineBuildOptions | null,
  thirdArg?: Readonly<Record<string, ActivityExecutionStatus | string>>,
  fourthArg?: Partial<PlanMapAndOutlineBuildOptions>,
): { readonly syllabus: Record<string, unknown>; readonly options: PlanMapAndOutlineBuildOptions } {
  if (
    firstArg &&
    typeof firstArg === "object" &&
    "syllabus" in firstArg &&
    firstArg["syllabus"] &&
    typeof firstArg["syllabus"] === "object" &&
    !("schema_version" in firstArg && "modules" in firstArg)
  ) {
    const opts = firstArg as PlanMapAndOutlineBuildOptions;
    return { syllabus: opts.syllabus ?? {}, options: opts };
  }
  const syllabus = (firstArg as Record<string, unknown>) ?? {};
  const isOptionsObj =
    secondArg &&
    typeof secondArg === "object" &&
    ["activityStates", "playbackSpeed", "viewportWidthPx", "selectedModuleId", "selectedActivityId", "proficiency", "catalogResources", "zoom"].some(
      (k) => k in secondArg,
    );

  if (isOptionsObj) {
    return {
      syllabus,
      options: { ...(secondArg as PlanMapAndOutlineBuildOptions), ...(thirdArg ? { activityStates: thirdArg } : {}), ...(fourthArg ?? {}) },
    };
  }
  return {
    syllabus,
    options: {
      proficiency: (secondArg as Record<string, unknown> | null | undefined) ?? null,
      ...(thirdArg ? { activityStates: thirdArg } : {}),
      ...(fourthArg ?? {}),
    },
  };
}

export function buildPlanMapAndOutlineModel(
  syllabusOrOptions: Record<string, unknown> | PlanMapAndOutlineBuildOptions,
  proficiencyOrOptions?: Record<string, unknown> | PlanMapAndOutlineBuildOptions | null,
  activityStatesArg?: Readonly<Record<string, ActivityExecutionStatus | string>>,
  extraOptionsArg?: Partial<PlanMapAndOutlineBuildOptions>,
): PlanMapAndOutlineModel {
  const { syllabus, options } = normalizeArgs(syllabusOrOptions, proficiencyOrOptions, activityStatesArg, extraOptionsArg);
  const schemaVersion = sanitizeText(syllabus["schema_version"], "0.2.0");
  const syllabusId = sanitizeText(syllabus["syllabus_id"], "syllabus-default");
  const revisionId = sanitizeText(syllabus["revision_id"], "revision-default");
  const createdAt = sanitizeText(syllabus["created_at"], "2026-10-20T16:00:00Z");

  const rawGoal = asObj(syllabus["goal"]);
  const goal = {
    title: sanitizeText(rawGoal["title"], "Syllabus Plan"),
    summary: sanitizeText(rawGoal["summary"], ""),
    includedTopics: asStringArray(rawGoal["included_topics"]),
    excludedTopics: asStringArray(rawGoal["excluded_topics"]),
    scopeNote: sanitizeText(rawGoal["scope_note"], ""),
  };

  const rawDurationPolicy = asObj(syllabus["duration_policy"]);
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

  const waiverRefSet = new Set<string>(asStringArray(asObj(syllabus["adaptation_context"])["waiver_refs"]));

  const certificationByResourceVersionId = new Map<string, { readonly rationale: string; readonly mappedObjectiveIds: readonly string[] }>();
  for (const rawCert of Array.isArray(syllabus["certification_options"]) ? syllabus["certification_options"] : []) {
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
  for (const rawLim of Array.isArray(syllabus["coverage_limitations"]) ? syllabus["coverage_limitations"] : []) {
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

  const rawActivities = Array.isArray(syllabus["activities"]) ? syllabus["activities"] : [];
  const syllabusHasMediaMinutes = rawActivities.some((rawAct) => {
    const media = asObj(asObj(rawAct)["duration_estimate"])["media_minutes"];
    return typeof media === "number" && media > 0;
  });

  const activityStatesInput = options.activityStates ?? {};
  const studyAheadSet = new Set<string>(options.studyAheadActivityIds ?? []);
  const catalogLookup = buildResourceLookup(options.catalogResources);

  const rawModules = Array.isArray(syllabus["modules"]) ? syllabus["modules"] : [];
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
  for (const rawEdge of Array.isArray(syllabus["prerequisite_edges"]) ? syllabus["prerequisite_edges"] : []) {
    const e = asObj(rawEdge);
    const from = sanitizeText(e["from_objective_id"] ?? e["from"]);
    const to = sanitizeText(e["to_objective_id"] ?? e["to"]);
    if (from && to && from !== to) objectiveEdges.push({ from, to });
  }

  const objectiveIdsInOrder: string[] = [];
  const rawObjectiveById = new Map<string, Record<string, unknown>>();
  for (const rawObj of Array.isArray(syllabus["objectives"]) ? syllabus["objectives"] : []) {
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

    const durationTriplet = computeActivityDurationTriplet(rawAct["duration_estimate"], playbackSpeed, syllabusHasMediaMinutes);

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
      contentObj["study_prompt"] ??
        contentObj["example_prompt"] ??
        contentObj["task_prompt"] ??
        contentObj["recall_prompt"] ??
        contentObj["reflection_prompt"] ??
        contentObj["brief"] ??
        title,
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
    else if (linkedActs.length > 0 && linkedActs.every((aid) => executionStatusByActivityId.get(aid) === "completed"))
      rollupExec = "completed";
    else if (linkedActs.some((aid) => executionStatusByActivityId.get(aid) === "self_reported_completed"))
      rollupExec = "self_reported_completed";
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
    else if (
      modActivities.length > 0 &&
      modActivities.every((a) => a.executionStatus === "completed" || a.executionStatus === "waived")
    )
      modExecStatus = "completed";
    else if (modActivities.some((a) => a.executionStatus === "self_reported_completed")) modExecStatus = "self_reported_completed";
    else if (modActivities.some((a) => a.executionStatus === "in_progress" || a.executionStatus === "completed"))
      modExecStatus = "in_progress";

    const primaryProfBadge = modObjectives[0]?.proficiencyBadge ?? resolveObjectiveProficiencyBadge(modId);
    const prereqModIds = prereqModulesByMod.get(modId) ?? [];
    const depModIds = dependentModulesByMod.get(modId) ?? [];

    const prereqBadges: PrerequisiteBadgeView[] = prereqModIds.map((pModId) => {
      const pTitle = sanitizeText(rawModuleById.get(pModId)?.["title"], pModId);
      const pModObjIds = asStringArray(rawModuleById.get(pModId)?.["objective_ids"]);
      const satisfied =
        pModObjIds.length > 0 &&
        pModObjIds.every((oid) => proficiencyBadgeByObjectiveId.get(oid)?.status === "demonstrated");
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
      durationTriplet: sumTriplets(modActivities, playbackSpeed),
      executionStatus: modExecStatus,
      executionBadge: makeExecutionBadge(modExecStatus),
      proficiencyStatus: primaryProfBadge.status,
      proficiencyBadge: primaryProfBadge,
      hasMasteryGatedActivities: modActivities.some((a) => a.masteryGated),
      availableActions: SYNCHRONIZED_NODE_ACTIONS,
    };
  });

  const totalDurationTriplet = sumTriplets(outlineActivities, playbackSpeed);

  const defaultSelectedModuleId = outlineModules[0]?.moduleId ?? null;
  const selectedModuleId = options.selectedModuleId !== undefined ? options.selectedModuleId : defaultSelectedModuleId;
  const selectedModule = outlineModules.find((m) => m.moduleId === selectedModuleId) ?? outlineModules[0] ?? null;
  const selectedActivityId =
    options.selectedActivityId !== undefined
      ? options.selectedActivityId
      : (selectedModule?.activities[0]?.activityId ?? outlineActivities[0]?.activityId ?? null);
  const focusedNodeId =
    options.focusedNodeId !== undefined ? options.focusedNodeId : (selectedModule?.moduleId ?? objectiveTracks[0]?.objectiveId ?? null);

  const viewportWidthPx = typeof options.viewportWidthPx === "number" && options.viewportWidthPx > 0 ? options.viewportWidthPx : 1280;

  const immediatePrerequisiteModuleIds = selectedModule ? selectedModule.prerequisiteModuleIds : [];
  const immediateDependentModuleIds = selectedModule ? selectedModule.dependentModuleIds : [];
  const neighborhoodSet = new Set<string>([
    ...immediatePrerequisiteModuleIds,
    ...(selectedModule ? [selectedModule.moduleId] : []),
    ...immediateDependentModuleIds,
  ]);

  const mobileNeighborhood = computeMobileNeighborhood(outlineModules, outlineActivities, selectedModule, viewportWidthPx);

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

  const mapEdges: MapEdgeView[] = [
    ...outlineModules.flatMap((m) => buildEdgesFromBadges(m.prerequisiteBadges, "module_prerequisite", mapNodeById)),
    ...objectiveTracks.flatMap((o) => buildEdgesFromBadges(o.prerequisiteBadges, "objective_prerequisite", mapNodeById)),
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
    buildPlanMapAndOutlineModel({ ...options, syllabus, ...nextPatch });

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

  const equivalence = computeMapOutlineEquivalence(mapNodes, mapEdges, outlineModules, objectiveTracks);

  return {
    syllabusId,
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
    equivalence,
    zoomIn: controls.zoomIn,
    zoomOut: controls.zoomOut,
    resetView: controls.resetView,
    focusNeighborhood: controls.focusNeighborhood,
    navigateKeyboard,
  };
}
