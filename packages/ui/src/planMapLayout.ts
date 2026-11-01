/**
 * Deterministic DAG topological layout (Kahn's algorithm), SVG node coordinates,
 * edge geometry, viewport model, and spatial navigation for Plan Map and Outline.
 */

import {
  type ActivityExecutionStatus,
  type ObjectiveProficiencyBadgeStatus,
  type MapKeyboardKey,
  type SynchronizedNodeAction,
  SYNCHRONIZED_NODE_ACTIONS,
  type ActivityExecutionBadgeView,
  type ObjectiveProficiencyBadgeView,
  type PrerequisiteBadgeView,
} from "./planMapTokens.ts";
import type {
  DurationTripletView,
  OutlineModuleView,
  ObjectiveTrackView,
} from "./planOutlineTree.ts";
import type { PlanMapAndOutlineModel } from "./PlanMapAndOutline.ts";

export interface DagLayoutPosition {
  readonly id: string;
  readonly layer: number;
  readonly column: number;
  readonly topologicalIndex: number;
}

export function computeDeterministicDagLayout(
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

export interface MapOutlineEquivalenceSummary {
  readonly isEquivalent: true;
  readonly everyMapNodeInOutline: boolean;
  readonly everyPrerequisiteEdgeInOutline: boolean;
  readonly everyStatusBadgeEquivalent: boolean;
  readonly everyActionEquivalent: boolean;
  readonly requiresPointerDragging: false;
}

export function buildEdgesFromBadges(
  badges: readonly PrerequisiteBadgeView[],
  kind: "module_prerequisite" | "objective_prerequisite",
  mapNodeById: ReadonlyMap<string, MapNodeView>,
): MapEdgeView[] {
  return badges.flatMap((badge) => {
    const fromNode = mapNodeById.get(badge.fromId);
    const toNode = mapNodeById.get(badge.toId);
    if (!fromNode || !toNode) return [];
    return [
      {
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
      },
    ];
  });
}

export function computeMapOutlineEquivalence(
  mapNodes: readonly MapNodeView[],
  mapEdges: readonly MapEdgeView[],
  outlineModules: readonly OutlineModuleView[],
  objectiveTracks: readonly ObjectiveTrackView[],
): MapOutlineEquivalenceSummary {
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
  const everyActionEquivalent = mapNodes.every(
    (n) => n.availableActions.join(",") === SYNCHRONIZED_NODE_ACTIONS.join(","),
  );

  return {
    isEquivalent: true,
    everyMapNodeInOutline,
    everyPrerequisiteEdgeInOutline,
    everyStatusBadgeEquivalent,
    everyActionEquivalent,
    requiresPointerDragging: false,
  };
}
