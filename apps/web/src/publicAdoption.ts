import { buildOperationHeaders } from "@syllabus/api-client";
import type { PublicModuleNode, PublicSyllabusPayload } from "./publicationLifecycle.ts";

export function resolveTransitiveAdoptionScope(
  syllabus: PublicSyllabusPayload,
  selectedModuleIds?: readonly string[],
) {
  const modules = syllabus.content.modules;
  const objectives = syllabus.content.objectives ?? [];
  const edges = syllabus.content.prerequisite_edges ?? [];

  const moduleById = new Map<string, PublicModuleNode>();
  const moduleByObjectiveId = new Map<string, string>();
  const prereqObjectivesByObjectiveId = new Map<string, string[]>();

  for (const obj of objectives) {
    prereqObjectivesByObjectiveId.set(obj.objective_id, [...(obj.prerequisite_objective_ids ?? [])]);
  }
  for (const edge of edges) {
    const existing = prereqObjectivesByObjectiveId.get(edge.to_objective_id) ?? [];
    if (!existing.includes(edge.from_objective_id)) {
      prereqObjectivesByObjectiveId.set(edge.to_objective_id, [...existing, edge.from_objective_id]);
    }
  }
  for (const mod of modules) {
    moduleById.set(mod.module_id, mod);
    for (const objId of mod.objective_ids ?? []) moduleByObjectiveId.set(objId, mod.module_id);
  }

  const initialIds = !selectedModuleIds || selectedModuleIds.length === 0 ? modules.map((m) => m.module_id) : [...selectedModuleIds];
  const requestedSet = new Set(initialIds);
  const resolvedModuleSet = new Set<string>();
  const directObjectiveSet = new Set<string>();
  const resolvedObjectiveSet = new Set<string>();
  const inProgressModules = new Set<string>();
  const inProgressObjectives = new Set<string>();

  function visitObjective(objectiveId: string) {
    if (resolvedObjectiveSet.has(objectiveId)) return;
    if (inProgressObjectives.has(objectiveId)) return;
    inProgressObjectives.add(objectiveId);
    for (const prereqObjId of prereqObjectivesByObjectiveId.get(objectiveId) ?? []) {
      visitObjective(prereqObjId);
      const owningModId = moduleByObjectiveId.get(prereqObjId);
      if (owningModId) visitModule(owningModId);
    }
    inProgressObjectives.delete(objectiveId);
    resolvedObjectiveSet.add(objectiveId);
  }

  function visitModule(moduleId: string) {
    if (resolvedModuleSet.has(moduleId)) return;
    if (inProgressModules.has(moduleId)) return;
    inProgressModules.add(moduleId);
    const mod = moduleById.get(moduleId);
    if (!mod) throw new Error(`Unknown module_id '${moduleId}' in publication.`);
    for (const prereqModId of mod.prerequisite_module_ids ?? []) visitModule(prereqModId);
    resolvedModuleSet.add(moduleId);
    inProgressModules.delete(moduleId);
    for (const objId of mod.objective_ids ?? []) {
      if (requestedSet.has(moduleId)) directObjectiveSet.add(objId);
      visitObjective(objId);
    }
  }

  initialIds.forEach(visitModule);

  const resolvedModuleIds = modules.map((m) => m.module_id).filter((id) => resolvedModuleSet.has(id));
  const resolvedObjectiveIds = Array.from(resolvedObjectiveSet);

  return {
    requestedModuleIds: initialIds as readonly string[],
    resolvedModuleIds: resolvedModuleIds as readonly string[],
    autoIncludedPrerequisiteModuleIds: resolvedModuleIds.filter((id) => !requestedSet.has(id)) as readonly string[],
    resolvedObjectiveIds: resolvedObjectiveIds as readonly string[],
    autoIncludedPrerequisiteObjectiveIds: resolvedObjectiveIds.filter((id) => !directObjectiveSet.has(id)) as readonly string[],
  };
}
export type TransitivePrerequisiteResolution = ReturnType<typeof resolveTransitiveAdoptionScope>;

export function createPublicAdoptionController(syllabus: PublicSyllabusPayload) {
  function buildAdoptionRequest(options: {
    readonly idempotencyKey: string; readonly selectedModuleIds?: readonly string[];
    readonly basePlanningOrRequest: Record<string, unknown>;
    readonly execution:
      | { readonly mode: "deterministic" }
      | {
          readonly mode: "generate_hosted"; readonly model_policy_id: string;
          readonly inferenceBudget: { readonly currency: string; readonly max_minor_units: number };
          readonly quote_id: string; readonly reservation_id: string;
        }
      | {
          readonly mode: "generate_byok"; readonly provider_id: string; readonly credential_ref: string;
          readonly credential_version_ref: string; readonly model_policy_id: string; readonly allow_hosted_fallback: false;
          readonly inferenceBudget: { readonly currency: string; readonly max_minor_units: number };
        };
  }) {
    const scope = resolveTransitiveAdoptionScope(syllabus, options.selectedModuleIds);
    const headers = buildOperationHeaders("adoptSyllabus", { idempotencyKey: options.idempotencyKey });
    const templateOrigin = {
      publication_id: syllabus.publication_id, publication_revision_id: syllabus.publication_revision_id,
      expected_content_sha256: syllabus.content_sha256,
      ...(options.selectedModuleIds && options.selectedModuleIds.length > 0 ? { selected_module_ids: scope.resolvedModuleIds } : {}),
    };
    const path = `/publications/${syllabus.publication_id}/revisions/${syllabus.publication_revision_id}/adoptions`;
    const baseBudgets = (options.basePlanningOrRequest.budgets ?? {}) as Record<string, unknown>;
    const envelope = { operationId: "adoptSyllabus" as const, method: "POST" as const, path, headers, resolvedScope: scope };

    if (options.execution.mode === "deterministic") {
      return {
        ...envelope, requiresAiCredentials: false, requiresCreditReservation: false,
        body: {
          expected_content_sha256: syllabus.content_sha256, execution: "deterministic" as const,
          planning: {
            ...options.basePlanningOrRequest,
            budgets: { materials: baseBudgets.materials, compute: baseBudgets.compute },
            template_origin: templateOrigin,
          },
        },
      };
    }

    if (options.execution.mode === "generate_hosted") {
      if (!options.execution.quote_id.trim() || !options.execution.reservation_id.trim()) {
        throw new Error("Hosted generative adoption requires both quote_id and reservation_id.");
      }
      return {
        ...envelope, requiresAiCredentials: false, requiresCreditReservation: true,
        body: {
          expected_content_sha256: syllabus.content_sha256, execution: "generate" as const,
          request: {
            ...options.basePlanningOrRequest,
            budgets: { materials: baseBudgets.materials, compute: baseBudgets.compute, inference: options.execution.inferenceBudget },
            inference: { mode: "hosted" as const, model_policy_id: options.execution.model_policy_id },
            template_origin: templateOrigin,
          },
          quote_id: options.execution.quote_id, reservation_id: options.execution.reservation_id,
        },
      };
    }

    if (!options.execution.provider_id.trim() || !options.execution.credential_ref.trim() || !options.execution.credential_version_ref.trim()) {
      throw new Error("BYOK generative adoption requires provider_id, credential_ref, and credential_version_ref.");
    }

    return {
      ...envelope, requiresAiCredentials: true, requiresCreditReservation: false,
      body: {
        expected_content_sha256: syllabus.content_sha256, execution: "generate" as const,
        request: {
          ...options.basePlanningOrRequest,
          budgets: { materials: baseBudgets.materials, compute: baseBudgets.compute, inference: options.execution.inferenceBudget },
          inference: {
            mode: "byok" as const, provider_id: options.execution.provider_id, credential_ref: options.execution.credential_ref,
            model_policy_id: options.execution.model_policy_id, credential_version_ref: options.execution.credential_version_ref,
            allow_hosted_fallback: false as const,
          },
          template_origin: templateOrigin,
        },
      },
    };
  }

  return {
    resolveScope: (selectedModuleIds?: readonly string[]) => resolveTransitiveAdoptionScope(syllabus, selectedModuleIds),
    buildAdoptionRequest,
  };
}
