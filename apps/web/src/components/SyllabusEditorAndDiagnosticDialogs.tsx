import type { VNode } from "preact";
import { renderAccessibleMathFormula } from "../../../../packages/ui/src/index.ts";
import type {
  AdaptationProposalFixture,
  DiagnosticSessionFixture,
  ProficiencyProfileFixture,
} from "../diagnosticsAndAdaptation.ts";
import type { DiagnosticQuestion } from "../liveTutor.ts";
import { normalizeStringList } from "../shared.ts";
import { asRecord, goalTitleOf, rawListOf } from "./ExploreMarketplace.tsx";
import { SfIcon } from "./Icons.tsx";
import { MathText } from "./MathText.tsx";
import { displayUnitTitle, humanize } from "./StudyFlowBoard.tsx";

export const SYLLABUS_EDIT_MODES = [
  "syllabus",
  "add-module",
  "edit-module",
  "add-activity",
  "edit-activity",
] as const;
export type SyllabusEditMode = (typeof SYLLABUS_EDIT_MODES)[number];

export const EDITABLE_ACTIVITY_TYPES = [
  "theory",
  "worked_example",
  "coding",
  "quiz",
  "review",
  "reflection",
] as const;
export type EditableActivityType = (typeof EDITABLE_ACTIVITY_TYPES)[number];

const ACTIVITY_TYPE_LABELS: Readonly<Record<EditableActivityType, string>> = {
  theory: "Reading & Theory",
  worked_example: "Worked Example",
  coding: "Code Lab / Deliverable",
  quiz: "Checkpoint Quiz / Gate",
  review: "Spaced Review",
  reflection: "Synthesis Reflection",
};

export interface ProficiencyOverrideEntry {
  readonly status: "demonstrated" | "in_progress" | "unverified";
  readonly evidenceRef: string;
}

function bumpSyllabusRevision(
  syllabus: Record<string, unknown>,
  reason: string,
): Pick<Record<string, unknown>, "revision_id" | "revision_number" | "predecessor_revision_id" | "revision_reason"> {
  const prevNum = typeof syllabus["revision_number"] === "number" ? syllabus["revision_number"] : 1;
  const nextNum = prevNum + 1;
  const prevRev = typeof syllabus["revision_id"] === "string" ? syllabus["revision_id"] : `revision-v${prevNum}`;
  const baseSlug = prevRev.replace(/-v\d+.*$/, "");
  return {
    revision_id: `${baseSlug}-v${nextNum}`,
    revision_number: nextNum,
    predecessor_revision_id: prevRev,
    revision_reason: reason,
  };
}

function buildDurationEstimateForType(activityType: EditableActivityType, minutes: number) {
  const clamped = Math.max(5, Math.min(240, Math.round(minutes) || 20));
  const lo = Math.max(4, Math.round(clamped * 0.75));
  const hi = Math.round(clamped * 1.35);
  const slot = (m: number) => ({
    media_minutes: 0,
    reading_minutes: activityType === "theory" ? m : 0,
    practice_minutes: activityType === "worked_example" || activityType === "coding" ? m : 0,
    assessment_minutes: activityType === "quiz" ? m : 0,
    review_minutes: activityType === "review" || activityType === "reflection" ? m : 0,
  });
  return {
    ...slot(clamped),
    lower_bounds: slot(lo),
    upper_bounds: slot(hi),
    range_interpretation: "planning_bounds_not_confidence_interval",
  };
}

export function activityMinutesOfRaw(rawAct: Readonly<Record<string, unknown>>): number {
  const dur = asRecord(rawAct["duration_estimate"]);
  const sum =
    (Number(dur["media_minutes"]) || 0) +
    (Number(dur["reading_minutes"]) || 0) +
    (Number(dur["practice_minutes"]) || 0) +
    (Number(dur["assessment_minutes"]) || 0) +
    (Number(dur["review_minutes"]) || 0);
  return sum > 0 ? sum : 20;
}

export function activityPromptOfRaw(rawAct: Readonly<Record<string, unknown>>): string {
  const content = asRecord(rawAct["content"]);
  for (const key of ["study_prompt", "example_prompt", "task_prompt", "recall_prompt", "reflection_prompt"]) {
    if (typeof content[key] === "string" && content[key].trim()) {
      return content[key].trim();
    }
  }
  return "";
}

function buildContentForActivityType(
  activityType: EditableActivityType,
  prompt: string,
  prevContent: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const clean = prompt.trim();
  if (activityType === "theory") {
    return { ...prevContent, study_prompt: clean || "Annotate the primary claims and assumptions in this section." };
  }
  if (activityType === "worked_example") {
    return {
      ...prevContent,
      example_prompt: clean || "Work through the derivation step by step before checking the solution.",
      guidance_level: prevContent["guidance_level"] ?? "full",
    };
  }
  if (activityType === "coding") {
    return {
      ...prevContent,
      task_prompt: clean || "Implement and verify the deliverable against your test cases.",
      deliverable_description:
        typeof prevContent["deliverable_description"] === "string" && prevContent["deliverable_description"]
          ? prevContent["deliverable_description"]
          : clean || "Working implementation with passing verification checks.",
      execution_mode: prevContent["execution_mode"] ?? "external",
    };
  }
  if (activityType === "quiz") {
    return {
      ...prevContent,
      study_prompt: clean || "Complete the unit checkpoint without external hints.",
    };
  }
  if (activityType === "review") {
    return {
      ...prevContent,
      recall_prompt: clean || "Reconstruct the core argument and invariants from memory.",
    };
  }
  return {
    ...prevContent,
    reflection_prompt: clean || "Summarize what clicked and which edge cases still need practice.",
  };
}

export function mutateSyllabusMeta(
  syllabus: Record<string, unknown>,
  input: { readonly title: string; readonly summary: string },
): { readonly syllabus: Record<string, unknown> } | { readonly error: string } {
  const title = input.title.trim();
  if (!title) return { error: "Enter a syllabus title." };
  const prevGoal = asRecord(syllabus["goal"]);
  const summary = input.summary.trim() || (typeof prevGoal["summary"] === "string" ? prevGoal["summary"] : title);
  return {
    syllabus: {
      ...syllabus,
      ...bumpSyllabusRevision(syllabus, "manual_structure_edit"),
      goal: {
        ...prevGoal,
        title,
        summary,
      },
    },
  };
}

export function upsertSyllabusModule(
  syllabus: Record<string, unknown>,
  input: {
    readonly moduleId?: string | null | undefined;
    readonly title: string;
    readonly summary?: string | undefined;
    readonly requirementLevel?: string | undefined;
  },
): { readonly syllabus: Record<string, unknown>; readonly moduleId: string } | { readonly error: string } {
  const cleanTitle = input.title.trim();
  if (!cleanTitle) return { error: "Enter a unit title." };
  const reqLevel = input.requirementLevel === "optional" ? "optional" : "required";
  const modules = rawListOf(syllabus, "modules");
  const objectives = rawListOf(syllabus, "objectives");
  const activities = rawListOf(syllabus, "activities");

  if (input.moduleId && modules.some((m) => m["module_id"] === input.moduleId)) {
    const targetId = input.moduleId;
    const nextModules = modules.map((mod) =>
      mod["module_id"] === targetId
        ? {
            ...mod,
            title: cleanTitle,
            summary: input.summary?.trim() || (typeof mod["summary"] === "string" ? mod["summary"] : cleanTitle),
            requirement_level: reqLevel,
          }
        : mod,
    );
    return {
      moduleId: targetId,
      syllabus: {
        ...syllabus,
        ...bumpSyllabusRevision(syllabus, "manual_module_edit"),
        modules: nextModules,
      },
    };
  }

  const slug = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "unit";
  const suffix = modules.length + 1;
  const newModuleId = `module-custom-${slug}-${suffix}`;
  const newObjectiveId = `objective-custom-${slug}-${suffix}`;
  const newActivityId = `activity-custom-${slug}-${suffix}-intro`;
  const lastModuleId = typeof modules[modules.length - 1]?.["module_id"] === "string"
    ? (modules[modules.length - 1]!["module_id"] as string)
    : null;

  const newObjective = {
    objective_id: newObjectiveId,
    objective_version_id: `${newObjectiveId}-v1`,
    topic_id: `topic-${slug}`,
    title: cleanTitle.replace(/^Module\s+\d+:\s*/i, ""),
    description: input.summary?.trim() || `Build and verify mastery of ${cleanTitle}.`,
    success_criterion: `Demonstrate ${cleanTitle.replace(/^Module\s+\d+:\s*/i, "")} on an unseen problem without hints.`,
    level: "applied",
    requirement_level: reqLevel,
    assessment_activity_ids: [],
    prior_evidence_refs: [],
  };

  const newStarterActivity = {
    activity_id: newActivityId,
    type: "theory",
    title: `Core Notes: ${cleanTitle.replace(/^Module\s+\d+:\s*/i, "")}`,
    requirement_level: reqLevel,
    objective_ids: [newObjectiveId],
    prerequisite_activity_ids: [],
    resource_assignments: [],
    duration_estimate: buildDurationEstimateForType("theory", 20),
    content: buildContentForActivityType("theory", input.summary?.trim() ?? ""),
  };

  const newModule = {
    module_id: newModuleId,
    title: /^Module\s+\d+:/i.test(cleanTitle) ? cleanTitle : `Module ${suffix}: ${cleanTitle}`,
    summary: input.summary?.trim() || `Core concepts and verification steps for ${cleanTitle}.`,
    requirement_level: reqLevel,
    prerequisite_module_ids: lastModuleId ? [lastModuleId] : [],
    objective_ids: [newObjectiveId],
    activity_ids: [newActivityId],
  };

  return {
    moduleId: newModuleId,
    syllabus: {
      ...syllabus,
      ...bumpSyllabusRevision(syllabus, "manual_module_added"),
      objectives: [...objectives, newObjective],
      modules: [...modules, newModule],
      activities: [...activities, newStarterActivity],
    },
  };
}

export function moveSyllabusModule(
  syllabus: Record<string, unknown>,
  moduleId: string,
  direction: "up" | "down",
): Record<string, unknown> {
  const modules = [...rawListOf(syllabus, "modules")];
  const idx = modules.findIndex((m) => m["module_id"] === moduleId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= modules.length) return syllabus;
  const temp = modules[idx]!;
  modules[idx] = modules[swapIdx]!;
  modules[swapIdx] = temp;
  return {
    ...syllabus,
    ...bumpSyllabusRevision(syllabus, "manual_module_reorder"),
    modules,
  };
}

export function removeSyllabusModule(
  syllabus: Record<string, unknown>,
  moduleId: string,
): { readonly syllabus: Record<string, unknown> } | { readonly error: string } {
  const modules = rawListOf(syllabus, "modules");
  if (modules.length <= 1) {
    return { error: "A syllabus must keep at least one unit." };
  }
  const target = modules.find((m) => m["module_id"] === moduleId);
  if (!target) return { error: "Unit not found." };
  const removedActIds = new Set(normalizeStringList(target["activity_ids"]));
  const remainingModules = modules
    .filter((m) => m["module_id"] !== moduleId)
    .map((m) => ({
      ...m,
      prerequisite_module_ids: normalizeStringList(m["prerequisite_module_ids"]).filter((pid) => pid !== moduleId),
    }));
  const remainingActivities = rawListOf(syllabus, "activities")
    .filter((a) => !removedActIds.has(String(a["activity_id"] ?? "")))
    .map((a) => ({
      ...a,
      prerequisite_activity_ids: normalizeStringList(a["prerequisite_activity_ids"]).filter((pid) => !removedActIds.has(pid)),
    }));
  return {
    syllabus: {
      ...syllabus,
      ...bumpSyllabusRevision(syllabus, "manual_module_removed"),
      modules: remainingModules,
      activities: remainingActivities,
    },
  };
}

export function upsertSyllabusActivity(
  syllabus: Record<string, unknown>,
  input: {
    readonly activityId?: string | null | undefined;
    readonly moduleId: string;
    readonly title: string;
    readonly activityType?: string | undefined;
    readonly durationMinutes?: number | string | undefined;
    readonly requirementLevel?: string | undefined;
    readonly prompt?: string | undefined;
  },
): { readonly syllabus: Record<string, unknown>; readonly activityId: string; readonly moduleId: string } | { readonly error: string } {
  const cleanTitle = input.title.trim();
  if (!cleanTitle) return { error: "Enter a step title." };
  const modules = rawListOf(syllabus, "modules");
  const targetMod = modules.find((m) => m["module_id"] === input.moduleId) ?? modules[0];
  if (!targetMod || typeof targetMod["module_id"] !== "string") {
    return { error: "Choose a valid unit for this step." };
  }
  const resolvedModId = targetMod["module_id"];
  const actType: EditableActivityType = (EDITABLE_ACTIVITY_TYPES as readonly string[]).includes(input.activityType ?? "")
    ? (input.activityType as EditableActivityType)
    : "theory";
  const mins = typeof input.durationMinutes === "number"
    ? input.durationMinutes
    : Number.parseInt(String(input.durationMinutes ?? "20"), 10) || 20;
  const reqLevel = input.requirementLevel === "optional" ? "optional" : "required";
  const activities = rawListOf(syllabus, "activities");
  const modObjectiveIds = normalizeStringList(targetMod["objective_ids"]);

  if (input.activityId && activities.some((a) => a["activity_id"] === input.activityId)) {
    const actId = input.activityId;
    const nextActivities = activities.map((act) => {
      if (act["activity_id"] !== actId) return act;
      const prevContent = asRecord(act["content"]);
      return {
        ...act,
        type: actType,
        title: cleanTitle,
        requirement_level: reqLevel,
        mastery_gated: actType === "quiz" ? true : Boolean(act["mastery_gated"]),
        objective_ids: normalizeStringList(act["objective_ids"]).length > 0
          ? normalizeStringList(act["objective_ids"])
          : modObjectiveIds,
        duration_estimate: buildDurationEstimateForType(actType, mins),
        content: buildContentForActivityType(actType, input.prompt ?? "", prevContent),
      };
    });
    const nextModules = modules.map((mod) => {
      const ids = normalizeStringList(mod["activity_ids"]).filter((id) => id !== actId);
      return mod["module_id"] === resolvedModId
        ? { ...mod, activity_ids: normalizeStringList(mod["activity_ids"]).includes(actId) ? normalizeStringList(mod["activity_ids"]) : [...ids, actId] }
        : { ...mod, activity_ids: ids };
    });
    return {
      activityId: actId,
      moduleId: resolvedModId,
      syllabus: {
        ...syllabus,
        ...bumpSyllabusRevision(syllabus, "manual_activity_edit"),
        modules: nextModules,
        activities: nextActivities,
      },
    };
  }

  const slug = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "step";
  const newActId = `activity-custom-${slug}-${activities.length + 1}`;
  const existingModActIds = normalizeStringList(targetMod["activity_ids"]);
  const lastActId = existingModActIds[existingModActIds.length - 1];

  const newAct = {
    activity_id: newActId,
    type: actType,
    title: cleanTitle,
    requirement_level: reqLevel,
    ...(actType === "quiz" ? { mastery_gated: true } : {}),
    objective_ids: modObjectiveIds,
    prerequisite_activity_ids: lastActId ? [lastActId] : [],
    resource_assignments: [],
    duration_estimate: buildDurationEstimateForType(actType, mins),
    content: buildContentForActivityType(actType, input.prompt ?? ""),
  };

  const nextModules = modules.map((mod) =>
    mod["module_id"] === resolvedModId
      ? { ...mod, activity_ids: [...existingModActIds, newActId] }
      : mod,
  );

  return {
    activityId: newActId,
    moduleId: resolvedModId,
    syllabus: {
      ...syllabus,
      ...bumpSyllabusRevision(syllabus, "manual_activity_added"),
      modules: nextModules,
      activities: [...activities, newAct],
    },
  };
}

export function moveSyllabusActivity(
  syllabus: Record<string, unknown>,
  moduleId: string,
  activityId: string,
  direction: "up" | "down",
): Record<string, unknown> {
  const modules = rawListOf(syllabus, "modules").map((mod) => {
    if (mod["module_id"] !== moduleId) return mod;
    const ids = [...normalizeStringList(mod["activity_ids"])];
    const idx = ids.indexOf(activityId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ids.length) return mod;
    const tmp = ids[idx]!;
    ids[idx] = ids[swapIdx]!;
    ids[swapIdx] = tmp;
    return { ...mod, activity_ids: ids };
  });
  return {
    ...syllabus,
    ...bumpSyllabusRevision(syllabus, "manual_activity_reorder"),
    modules,
  };
}

export function removeSyllabusActivity(
  syllabus: Record<string, unknown>,
  activityId: string,
): { readonly syllabus: Record<string, unknown> } | { readonly error: string } {
  const activities = rawListOf(syllabus, "activities");
  if (activities.length <= 1) {
    return { error: "A syllabus must keep at least one study step." };
  }
  const holder = rawListOf(syllabus, "modules").find((m) =>
    normalizeStringList(m["activity_ids"]).includes(activityId),
  );
  if (holder && normalizeStringList(holder["activity_ids"]).length <= 1) {
    return { error: "Each unit must keep at least one study step. Add another step or delete the unit instead." };
  }
  const nextModules = rawListOf(syllabus, "modules").map((m) => ({
    ...m,
    activity_ids: normalizeStringList(m["activity_ids"]).filter((id) => id !== activityId),
  }));
  const nextActivities = activities
    .filter((a) => a["activity_id"] !== activityId)
    .map((a) => ({
      ...a,
      prerequisite_activity_ids: normalizeStringList(a["prerequisite_activity_ids"]).filter((id) => id !== activityId),
    }));
  return {
    syllabus: {
      ...syllabus,
      ...bumpSyllabusRevision(syllabus, "manual_activity_removed"),
      modules: nextModules,
      activities: nextActivities,
    },
  };
}

export function buildEffectiveProficiency(
  base: ProficiencyProfileFixture,
  syllabus: Record<string, unknown>,
  overrides: Readonly<Record<string, ProficiencyOverrideEntry>> = {},
): ProficiencyProfileFixture {
  if (Object.keys(overrides).length === 0) return base;
  const rawObjectives = rawListOf(syllabus, "objectives");
  const existingByObjId = new Map(base.objective_evidence.map((e) => [e.objective_id, e]));
  const nextEvidence = [...base.objective_evidence];

  for (const [objId, ov] of Object.entries(overrides)) {
    const rawObj = rawObjectives.find((o) => o["objective_id"] === objId);
    const verId = typeof rawObj?.["objective_version_id"] === "string"
      ? rawObj["objective_version_id"]
      : existingByObjId.get(objId)?.objective_version_id ?? `${objId}-v1`;
    const topicId = typeof rawObj?.["topic_id"] === "string"
      ? rawObj["topic_id"]
      : existingByObjId.get(objId)?.topic_id ?? "topic-general";
    const entry = {
      objective_id: objId,
      objective_version_id: verId,
      topic_id: topicId,
      state: ov.status,
      status: ov.status,
      evidence_support: ov.status === "demonstrated" ? ("corroborated" as const) : ("self_reported_only" as const),
      qualifying_attempt_ids: ov.status === "demonstrated" ? [ov.evidenceRef] : [],
      evidence_refs: [ov.evidenceRef],
      UnverifiedReason: null,
    };
    const idx = nextEvidence.findIndex((e) => e.objective_id === objId);
    if (idx >= 0) nextEvidence[idx] = entry;
    else nextEvidence.push(entry);
  }

  const nextCoverage = base.topic_coverage.map((tc) => {
    const forTopic = nextEvidence.filter((e) => e.topic_id === tc.topic_id);
    if (forTopic.length === 0) return tc;
    const assessed = forTopic.filter((e) => e.status === "demonstrated").map((e) => e.objective_version_id);
    const unassessed = forTopic.filter((e) => e.status !== "demonstrated").map((e) => e.objective_version_id);
    const allDem = unassessed.length === 0 && assessed.length > 0;
    const fallbackState = tc.coverage_state ?? (assessed.length > 0 ? "partial" : "unassessed");
    const nextState = allDem ? ("demonstrated" as const) : fallbackState;
    return {
      ...tc,
      assessed_objective_version_ids: assessed,
      unassessed_objective_version_ids: unassessed,
      coverage_state: nextState,
      coverage_label: nextState,
      demonstrated_objective_count: assessed.length,
      total_objective_count: forTopic.length,
    };
  });

  return {
    ...base,
    objective_evidence: nextEvidence,
    topic_coverage: nextCoverage,
  };
}

export function buildDynamicDiagnosticSession(
  syllabusId: string,
  syllabus: Record<string, unknown>,
  proficiency: ProficiencyProfileFixture,
  controlState: "active" | "paused" | "stopped",
): DiagnosticSessionFixture {
  const rawObjectives = rawListOf(syllabus, "objectives");
  const demSet = new Set(
    proficiency.objective_evidence
      .filter((e) => e.status === "demonstrated")
      .flatMap((e) => [e.objective_id, e.objective_version_id]),
  );
  const targets = rawObjectives.map((o) =>
    typeof o["objective_version_id"] === "string" ? o["objective_version_id"] : String(o["objective_id"] ?? ""),
  ).filter(Boolean);
  const assessed = rawObjectives
    .filter((o) => demSet.has(String(o["objective_id"] ?? "")) || demSet.has(String(o["objective_version_id"] ?? "")))
    .map((o) => (typeof o["objective_version_id"] === "string" ? o["objective_version_id"] : String(o["objective_id"] ?? "")));
  const unassessed = targets.filter((t) => !assessed.includes(t));

  return {
    diagnostic_session_id: syllabusId === "syllabus-rag-python-001" ? "diagnostic-synthetic-001" : `diagnostic-${syllabusId}`,
    syllabus_id: syllabusId,
    syllabus_revision_id: typeof syllabus["revision_id"] === "string" ? syllabus["revision_id"] : "revision-v1",
    state: controlState === "stopped" ? "stopped" : unassessed.length === 0 && targets.length > 0 ? "completed" : "active",
    target_objective_version_ids: targets,
    assessed_objective_version_ids: assessed,
    unassessed_objective_version_ids: unassessed,
    proficiency_snapshot_ref: proficiency.profile_revision_id,
    stop_reason: controlState === "stopped" ? "learner_stopped" : unassessed.length === 0 && targets.length > 0 ? "completed" : null,
  };
}

export function buildDynamicAdaptationProposal(
  syllabusId: string,
  syllabus: Record<string, unknown>,
  proficiency: ProficiencyProfileFixture,
  fallbackProposal: AdaptationProposalFixture,
): AdaptationProposalFixture {
  const rawObjectives = rawListOf(syllabus, "objectives");
  const rawActivities = rawListOf(syllabus, "activities");
  if (rawObjectives.length === 0 || rawActivities.length === 0) return fallbackProposal;

  const evidenceByObj = new Map(proficiency.objective_evidence.map((e) => [e.objective_id, e]));
  const totalBefore = rawActivities.reduce(
    (sum, a) => sum + (a["requirement_level"] === "optional" ? 0 : activityMinutesOfRaw(a)),
    0,
  );

  const changes: AdaptationProposalFixture["changes"][number][] = [];
  const proposedWaivers: AdaptationProposalFixture["proposed_waivers"][number][] = [];
  let waivedMinutes = 0;
  let addedMinutes = 0;

  for (const obj of rawObjectives) {
    const objId = String(obj["objective_id"] ?? "");
    const objVerId = typeof obj["objective_version_id"] === "string" ? obj["objective_version_id"] : `${objId}-v1`;
    const ev = evidenceByObj.get(objId);
    if (ev?.status === "demonstrated") {
      const introAct = rawActivities.find(
        (a) =>
          a["type"] === "theory" &&
          a["requirement_level"] !== "optional" &&
          normalizeStringList(a["objective_ids"]).includes(objId),
      );
      if (introAct && typeof introAct["activity_id"] === "string") {
        const actId = introAct["activity_id"];
        const rawRefs = ev.evidence_refs ?? [];
        const refs: string[] = rawRefs.length > 0 ? [...rawRefs] : ["diag-verified-001"];
        const primaryRef = refs[0] ?? "diag-verified-001";
        waivedMinutes += activityMinutesOfRaw(introAct);
        changes.push({
          kind: "waive_instruction",
          node_id: actId,
          activity_ids: [actId],
          objective_version_ids: [objVerId],
          qualifying_evidence_refs: refs,
          rationale: `Verified checkpoint evidence (${primaryRef}) corroborated "${String(obj["title"] ?? objId)}"; waive introductory reading while preserving formal gate checks.`,
        });
        proposedWaivers.push({
          waiver_id: `waiver-${objId}`,
          objective_id: objId,
          objective_version_id: objVerId,
          node_id: actId,
          criterion_policy_id: `criterion-${objVerId}`,
          qualifying_evidence_refs: refs,
          rationale: `Demonstrated via verified understanding check (${primaryRef}).`,
        });
      }
    }
  }

  const unassessedObjs = rawObjectives.filter((o) => {
    const ev = evidenceByObj.get(String(o["objective_id"] ?? ""));
    return ev?.status !== "demonstrated";
  });
  const firstUnassessed = unassessedObjs[0];
  if (firstUnassessed) {
    const objId = String(firstUnassessed["objective_id"] ?? "");
    const objVerId = typeof firstUnassessed["objective_version_id"] === "string"
      ? firstUnassessed["objective_version_id"]
      : `${objId}-v1`;
    const bridgeNodeId =
      syllabusId === "syllabus-rag-python-001" && objId === "objective-attention"
        ? "activity-matrix-calculus-bridge"
        : `activity-bridge-${objId}`;
    if (!rawActivities.some((a) => a["activity_id"] === bridgeNodeId)) {
      addedMinutes += 20;
      changes.push({
        kind: "add_bridge",
        node_id: bridgeNodeId,
        activity_ids: [bridgeNodeId],
        objective_version_ids: [objVerId],
        qualifying_evidence_refs: [],
        rationale: `Objective "${String(firstUnassessed["title"] ?? objVerId)}" remains unassessed; insert a targeted 20m worked bridge before its unit gate.`,
      });
    }
  }

  const afterMinutes = Math.max(15, totalBefore - waivedMinutes + addedMinutes);
  const delta = afterMinutes - totalBefore;
  const revId = typeof syllabus["revision_id"] === "string" ? syllabus["revision_id"] : "revision-v1";
  const rawMathDepth = asRecord(syllabus["instruction_preferences_applied"])["math_depth"];
  const mathDepth: "intuitive" | "standard" | "formal" =
    rawMathDepth === "intuitive" || rawMathDepth === "standard" ? rawMathDepth : "formal";

  return {
    proposal_id: syllabusId === "syllabus-rag-python-001" ? "adaptation-synthetic-001" : `adaptation-${syllabusId}`,
    syllabus_id: syllabusId,
    base_revision_id: revId,
    candidate_revision_id: `${revId}-adapted`,
    base_schedule_revision_id: `schedule-${syllabusId}-1`,
    proficiency_snapshot_ref: proficiency.profile_revision_id,
    proposal_sha256: fallbackProposal.proposal_sha256,
    status: "pending",
    instruction_preferences_applied: { math_depth: mathDepth },
    changes,
    proposed_waivers: proposedWaivers,
    impact: {
      before_minutes: totalBefore,
      after_minutes: afterMinutes,
      constraint_status: "feasible",
      schedule_impact_summary: `${delta >= 0 ? "+" : ""}${delta} minutes net across active study sessions.`,
      inference_charge_summary: "Deterministic diff preview ($0.00 AI inference charge).",
      warnings:
        unassessedObjs.length > 0
          ? ["Untested objectives remain explicitly unassessed and are bridged rather than waived."]
          : ["All syllabus objectives have corroborated evidence; introductory theory steps can be waived."],
    },
    unassessed_objective_version_ids: unassessedObjs.map((o) =>
      typeof o["objective_version_id"] === "string" ? o["objective_version_id"] : String(o["objective_id"] ?? ""),
    ),
  };
}

export function applyAcceptedAdaptationToSyllabus(
  syllabus: Record<string, unknown>,
  proposal: AdaptationProposalFixture,
): { readonly syllabus: Record<string, unknown>; readonly waivedActivityIds: readonly string[]; readonly addedActivityIds: readonly string[] } {
  const waivedSet = new Set(
    proposal.proposed_waivers
      .map((w) => w.node_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const rawObjectives = rawListOf(syllabus, "objectives");
  let nextActivities = rawListOf(syllabus, "activities").map((act) =>
    waivedSet.has(String(act["activity_id"] ?? ""))
      ? { ...act, requirement_level: "optional" }
      : act,
  );
  let nextModules = [...rawListOf(syllabus, "modules")];
  const addedActivityIds: string[] = [];

  for (const change of proposal.changes) {
    if (change.kind !== "add_bridge") continue;
    const bridgeId = change.node_id;
    if (!bridgeId || nextActivities.some((a) => a["activity_id"] === bridgeId)) continue;
    const targetVerId = change.objective_version_ids?.[0] ?? change.objective_version_id ?? "";
    const matchedObj = rawObjectives.find(
      (o) => o["objective_version_id"] === targetVerId || o["objective_id"] === targetVerId,
    );
    const objId = typeof matchedObj?.["objective_id"] === "string" ? matchedObj["objective_id"] : targetVerId;
    const objTitle = typeof matchedObj?.["title"] === "string" ? matchedObj["title"] : humanize(bridgeId);
    const bridgeTitle =
      bridgeId === "activity-matrix-calculus-bridge"
        ? "Targeted Bridge: Matrix Calculus & Softmax Jacobians"
        : `Targeted Bridge: ${objTitle}`;

    const bridgeActivity = {
      activity_id: bridgeId,
      type: "worked_example",
      title: bridgeTitle,
      requirement_level: "required",
      objective_ids: objId ? [objId] : [],
      prerequisite_activity_ids: [],
      resource_assignments: [],
      duration_estimate: buildDurationEstimateForType("worked_example", 20),
      content: buildContentForActivityType(
        "worked_example",
        change.rationale || `Step-by-step worked bridge preparing for ${objTitle}.`,
      ),
    };
    nextActivities = [...nextActivities, bridgeActivity];
    addedActivityIds.push(bridgeId);

    const modIdx = nextModules.findIndex((m) => normalizeStringList(m["objective_ids"]).includes(objId));
    const resolvedIdx = modIdx >= 0 ? modIdx : nextModules.length - 1;
    if (resolvedIdx >= 0) {
      const targetMod = nextModules[resolvedIdx]!;
      const existingIds = normalizeStringList(targetMod["activity_ids"]);
      const gatePos = existingIds.findIndex((aid) => {
        const found = nextActivities.find((a) => a["activity_id"] === aid);
        return found?.["type"] === "quiz" || found?.["mastery_gated"] === true;
      });
      const updatedIds =
        gatePos >= 0
          ? [...existingIds.slice(0, gatePos), bridgeId, ...existingIds.slice(gatePos)]
          : [...existingIds, bridgeId];
      nextModules[resolvedIdx] = { ...targetMod, activity_ids: updatedIds };
    }
  }

  return {
    waivedActivityIds: [...waivedSet],
    addedActivityIds,
    syllabus: {
      ...syllabus,
      ...bumpSyllabusRevision(syllabus, "accepted_adaptation_proposal"),
      modules: nextModules,
      activities: nextActivities,
    },
  };
}

export interface DiagnosticCheckDialogProps {
  readonly open: boolean;
  readonly question: DiagnosticQuestion | null;
  readonly selectedChoice: string | null;
  readonly feedback: { readonly passed: boolean; readonly message: string } | null;
  readonly isDemonstrated: boolean;
  readonly assessedCount: number;
  readonly totalCount: number;
  readonly nextObjectiveId: string | null;
}

export function DiagnosticCheckDialog({
  open,
  question,
  selectedChoice,
  feedback,
  isDemonstrated,
  assessedCount,
  totalCount,
  nextObjectiveId,
}: DiagnosticCheckDialogProps): VNode {
  return (
    <dialog
      id="dialog-diagnostic-check"
      class="modal-dialog"
      closedby="any"
      aria-labelledby="dialog-diagnostic-check-title"
      data-open={String(open)}
      data-objective-id={question?.objectiveId ?? ""}
      data-opaque-surface="true"
    >
      <div class="dialog-surface">
        <header class="dialog-header">
          <div>
            <h2 id="dialog-diagnostic-check-title">Understanding check</h2>
            <p class="row-meta">
              {assessedCount} of {totalCount} capabilities verified · Unassisted checkpoint
            </p>
          </div>
          <form method="dialog">
            <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
              <SfIcon name="close" />
            </button>
          </form>
        </header>

        {question ? (
          <div class="diagnostic-dialog-body">
            <div class="diagnostic-capability-bar">
              <div>
                <p class="row-meta">Target capability</p>
                <strong class="capability-title">
                  <MathText text={question.objectiveTitle} />
                </strong>
              </div>
              <span class="badge badge-proficiency-status" data-proficiency-status={isDemonstrated ? "demonstrated" : "unassessed"}>
                {isDemonstrated ? "Demonstrated" : "Unassessed"}
              </span>
            </div>

            <div
              class="math-formula-surface"
              data-opaque-surface="true"
              dangerouslySetInnerHTML={{
                __html: renderAccessibleMathFormula(question.formula, { displayMode: "block" }).mathml,
              }}
            />

            <fieldset class="choice-group">
              <legend>
                <MathText text={question.question} />
              </legend>
              {question.choices.map(({ value, label }, idx) => (
                <label key={value} class="choice-option" for={`diagnostic-choice-${value}`}>
                  <input
                    type="radio"
                    class="st-sr"
                    id={`diagnostic-choice-${value}`}
                    name="diagnostic-choice"
                    value={value}
                    checked={value === selectedChoice}
                  />
                  <span class="choice-letter" aria-hidden="true">
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span>
                    <MathText text={label} />
                  </span>
                </label>
              ))}
            </fieldset>

            <p class="row-meta">
              No hints or worked solutions are shown during an understanding check so a correct answer independently corroborates this objective.
            </p>

            {feedback ? (
              <div class="practice-note diagnostic-feedback-box" data-passed={String(feedback.passed)} role="status">
                <p>
                  <strong>{feedback.passed ? "Capability demonstrated." : "Not yet corroborated."}</strong>{" "}
                  {feedback.message}
                </p>
                <p class="row-meta">
                  <MathText text={question.explanation} />
                </p>
              </div>
            ) : null}

            <footer class="dialog-footer">
              <button
                type="button"
                class="btn-secondary"
                data-action="open-dialog"
                data-dialog-id="dialog-adaptation-diff"
              >
                Preview plan adaptation
              </button>
              {nextObjectiveId && nextObjectiveId !== question.objectiveId ? (
                <button
                  type="button"
                  class="btn-secondary"
                  data-action="diagnostic-continue"
                  data-objective-id={nextObjectiveId}
                >
                  Next capability
                </button>
              ) : null}
              <button
                type="button"
                class="btn-primary"
                data-action="submit-diagnostic-answer"
                data-objective-id={question.objectiveId}
              >
                Verify answer
              </button>
            </footer>
          </div>
        ) : (
          <p class="prose">No objectives are configured for this syllabus yet.</p>
        )}
      </div>
    </dialog>
  );
}

export interface SyllabusStructureEditorDialogProps {
  readonly open: boolean;
  readonly mode: SyllabusEditMode;
  readonly syllabusId: string;
  readonly syllabus: Record<string, unknown>;
  readonly editingModuleId: string | null;
  readonly editingActivityId: string | null;
  readonly editorError: string | null;
  readonly editorNotice: string | null;
}

export function SyllabusStructureEditorDialog({
  open,
  mode,
  syllabusId,
  syllabus,
  editingModuleId,
  editingActivityId,
  editorError,
  editorNotice,
}: SyllabusStructureEditorDialogProps): VNode {
  const goal = asRecord(syllabus["goal"]);
  const title = goalTitleOf(syllabus);
  const summary = typeof goal["summary"] === "string" ? goal["summary"] : "";
  const rawModules = rawListOf(syllabus, "modules");
  const rawActivities = rawListOf(syllabus, "activities");
  const actById = new Map(rawActivities.map((a) => [String(a["activity_id"] ?? ""), a]));

  const activeMod =
    rawModules.find((m) => m["module_id"] === editingModuleId) ??
    rawModules[0];
  const activeModId = typeof activeMod?.["module_id"] === "string" ? activeMod["module_id"] : "";
  const activeAct = editingActivityId ? actById.get(editingActivityId) : undefined;

  return (
    <dialog
      id="dialog-syllabus-editor"
      class="modal-dialog"
      closedby="any"
      aria-labelledby="dialog-syllabus-editor-title"
      data-open={String(open)}
      data-edit-mode={mode}
      data-syllabus-id={syllabusId}
      data-opaque-surface="true"
    >
      <div class="dialog-surface">
        <header class="dialog-header">
          <div>
            <h2 id="dialog-syllabus-editor-title">Edit syllabus structure</h2>
            <p class="row-meta">{title}</p>
          </div>
          <form method="dialog">
            <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
              <SfIcon name="close" />
            </button>
          </form>
        </header>

        <div class="segmented syllabus-editor-tabs" role="group" aria-label="Structure editor view">
          <button
            type="button"
            class="seg-btn"
            data-action="open-syllabus-editor"
            data-syllabus-edit-mode="syllabus"
            aria-pressed={mode === "syllabus"}
          >
            Overview &amp; order
          </button>
          <button
            type="button"
            class="seg-btn"
            data-action="open-syllabus-editor"
            data-syllabus-edit-mode="add-module"
            aria-pressed={mode === "add-module" || mode === "edit-module"}
          >
            {mode === "edit-module" ? "Edit unit" : "+ Add unit"}
          </button>
          <button
            type="button"
            class="seg-btn"
            data-action="open-syllabus-editor"
            data-syllabus-edit-mode="add-activity"
            data-module-id={activeModId}
            aria-pressed={mode === "add-activity" || mode === "edit-activity"}
          >
            {mode === "edit-activity" ? "Edit step" : "+ Add step"}
          </button>
        </div>

        {editorError ? (
          <p class="field-error" role="alert">
            {editorError}
          </p>
        ) : null}
        {editorNotice ? (
          <p class="section-lede" role="status">
            {editorNotice}
          </p>
        ) : null}

        {mode === "syllabus" ? (
          <div class="syllabus-editor-stack">
            <form class="syllabus-editor-form" data-action="save-syllabus-meta" novalidate>
              <label class="field" for="syllabus-edit-title">
                <span>Syllabus title</span>
                <span class="field-hint">Shown in Today, Plan, and exported study schedules.</span>
                <input
                  id="syllabus-edit-title"
                  type="text"
                  name="title"
                  value={title}
                  maxLength={140}
                  required
                />
              </label>
              <label class="field" for="syllabus-edit-summary">
                <span>Goal summary</span>
                <textarea
                  id="syllabus-edit-summary"
                  name="summary"
                  rows={2}
                  value={summary}
                />
              </label>
              <div class="action-row">
                <button type="submit" class="btn-primary">
                  Save title &amp; goal
                </button>
                <button
                  type="button"
                  class="btn-danger"
                  data-action="open-dialog"
                  data-dialog-id="dialog-delete-syllabus"
                >
                  Delete syllabus
                </button>
              </div>
            </form>

            <section class="syllabus-structure-tree" aria-label="Units and steps">
              <div class="inspector-section-head">
                <h3>Units ({rawModules.length})</h3>
                <button
                  type="button"
                  class="btn-secondary"
                  data-action="open-syllabus-editor"
                  data-syllabus-edit-mode="add-module"
                >
                  + Add unit
                </button>
              </div>
              <ol class="structure-unit-list">
                {rawModules.map((mod, mIdx) => {
                  const modId = String(mod["module_id"] ?? "");
                  const modTitle = displayUnitTitle(String(mod["title"] ?? `Unit ${mIdx + 1}`));
                  const actIds = normalizeStringList(mod["activity_ids"]);
                  return (
                    <li key={modId} class="structure-unit-card" data-structure-module-id={modId}>
                      <div class="structure-unit-head">
                        <div>
                          <strong>
                            U{mIdx + 1} · {modTitle}
                          </strong>
                          <span class="row-meta"> · {actIds.length} {actIds.length === 1 ? "step" : "steps"}</span>
                        </div>
                        <div class="row-actions">
                          {mIdx > 0 ? (
                            <button
                              type="button"
                              class="source-action-btn"
                              data-action="move-syllabus-module"
                              data-module-id={modId}
                              data-direction="up"
                              aria-label={`Move ${modTitle} up`}
                            >
                              ↑
                            </button>
                          ) : null}
                          {mIdx < rawModules.length - 1 ? (
                            <button
                              type="button"
                              class="source-action-btn"
                              data-action="move-syllabus-module"
                              data-module-id={modId}
                              data-direction="down"
                              aria-label={`Move ${modTitle} down`}
                            >
                              ↓
                            </button>
                          ) : null}
                          <button
                            type="button"
                            class="source-action-btn"
                            data-action="open-syllabus-editor"
                            data-syllabus-edit-mode="edit-module"
                            data-module-id={modId}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="source-action-btn"
                            data-action="open-syllabus-editor"
                            data-syllabus-edit-mode="add-activity"
                            data-module-id={modId}
                          >
                            + Step
                          </button>
                          {rawModules.length > 1 ? (
                            <button
                              type="button"
                              class="source-action-btn source-action-danger"
                              data-action="delete-syllabus-module"
                              data-module-id={modId}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <ol class="structure-step-list">
                        {actIds.map((actId, aIdx) => {
                          const rawAct = actById.get(actId);
                          if (!rawAct) return null;
                          const actTitle = String(rawAct["title"] ?? actId);
                          const actType = String(rawAct["type"] ?? "theory");
                          const actMins = activityMinutesOfRaw(rawAct);
                          return (
                            <li key={actId} class="structure-step-row" data-structure-activity-id={actId}>
                              <span class="structure-step-label">
                                {actTitle} <span class="row-meta">({humanize(actType)} · {actMins}m)</span>
                              </span>
                              <div class="row-actions">
                                {aIdx > 0 ? (
                                  <button
                                    type="button"
                                    class="source-action-btn"
                                    data-action="move-syllabus-activity"
                                    data-module-id={modId}
                                    data-activity-id={actId}
                                    data-direction="up"
                                    aria-label={`Move ${actTitle} up`}
                                  >
                                    ↑
                                  </button>
                                ) : null}
                                {aIdx < actIds.length - 1 ? (
                                  <button
                                    type="button"
                                    class="source-action-btn"
                                    data-action="move-syllabus-activity"
                                    data-module-id={modId}
                                    data-activity-id={actId}
                                    data-direction="down"
                                    aria-label={`Move ${actTitle} down`}
                                  >
                                    ↓
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  class="source-action-btn"
                                  data-action="open-syllabus-editor"
                                  data-syllabus-edit-mode="edit-activity"
                                  data-module-id={modId}
                                  data-activity-id={actId}
                                >
                                  Edit
                                </button>
                                {actIds.length > 1 ? (
                                  <button
                                    type="button"
                                    class="source-action-btn source-action-danger"
                                    data-action="delete-syllabus-activity"
                                    data-activity-id={actId}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        ) : null}

        {mode === "add-module" || mode === "edit-module" ? (
          <form class="syllabus-editor-form" data-action="save-syllabus-module" novalidate>
            <input
              type="hidden"
              name="moduleId"
              value={mode === "edit-module" ? activeModId : ""}
            />
            <label class="field" for="syllabus-module-title">
              <span>Unit title</span>
              <span class="field-hint">Clear capability milestone for this unit.</span>
              <input
                id="syllabus-module-title"
                type="text"
                name="title"
                value={mode === "edit-module" && activeMod ? String(activeMod["title"] ?? "") : ""}
                placeholder="e.g., Retrieval Indexing & Hybrid Reranking"
                required
              />
            </label>
            <label class="field" for="syllabus-module-summary">
              <span>Unit summary</span>
              <textarea
                id="syllabus-module-summary"
                name="summary"
                rows={2}
                value={mode === "edit-module" && activeMod ? String(activeMod["summary"] ?? "") : ""}
                placeholder="What this unit covers and how mastery is verified."
              />
            </label>
            <label class="field" for="syllabus-module-req">
              <span>Requirement level</span>
              <select id="syllabus-module-req" name="requirementLevel">
                <option
                  value="required"
                  selected={mode !== "edit-module" || activeMod?.["requirement_level"] !== "optional"}
                >
                  Required core unit
                </option>
                <option
                  value="optional"
                  selected={mode === "edit-module" && activeMod?.["requirement_level"] === "optional"}
                >
                  Optional enrichment unit
                </option>
              </select>
            </label>
            <footer class="dialog-footer">
              <button
                type="button"
                class="btn-secondary"
                data-action="open-syllabus-editor"
                data-syllabus-edit-mode="syllabus"
              >
                Back to overview
              </button>
              <button type="submit" class="btn-primary">
                {mode === "edit-module" ? "Save unit" : "Add unit"}
              </button>
            </footer>
          </form>
        ) : null}

        {mode === "add-activity" || mode === "edit-activity" ? (
          <form class="syllabus-editor-form" data-action="save-syllabus-activity" novalidate>
            <input
              type="hidden"
              name="activityId"
              value={mode === "edit-activity" && activeAct ? String(activeAct["activity_id"] ?? "") : ""}
            />
            <label class="field" for="syllabus-activity-module">
              <span>Target unit</span>
              <select id="syllabus-activity-module" name="moduleId">
                {rawModules.map((mod, idx) => {
                  const mId = String(mod["module_id"] ?? "");
                  return (
                    <option key={mId} value={mId} selected={mId === activeModId}>
                      U{idx + 1} · {displayUnitTitle(String(mod["title"] ?? mId))}
                    </option>
                  );
                })}
              </select>
            </label>
            <label class="field" for="syllabus-activity-title">
              <span>Step title</span>
              <span class="field-hint">Actionable study task, lab, or checkpoint title.</span>
              <input
                id="syllabus-activity-title"
                type="text"
                name="title"
                value={mode === "edit-activity" && activeAct ? String(activeAct["title"] ?? "") : ""}
                placeholder="e.g., Worked Example: Hybrid BM25 + Dense Reciprocal Rank Fusion"
                required
              />
            </label>
            <div class="syllabus-editor-row-grid">
              <label class="field" for="syllabus-activity-type">
                <span>Step type</span>
                <select id="syllabus-activity-type" name="activityType">
                  {EDITABLE_ACTIVITY_TYPES.map((t) => (
                    <option
                      key={t}
                      value={t}
                      selected={
                        mode === "edit-activity" && activeAct
                          ? activeAct["type"] === t
                          : t === "worked_example"
                      }
                    >
                      {ACTIVITY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field" for="syllabus-activity-minutes">
                <span>Estimated minutes</span>
                <input
                  id="syllabus-activity-minutes"
                  type="number"
                  name="durationMinutes"
                  min={5}
                  max={240}
                  value={String(mode === "edit-activity" && activeAct ? activityMinutesOfRaw(activeAct) : 25)}
                  required
                />
              </label>
              <label class="field" for="syllabus-activity-req">
                <span>Requirement</span>
                <select id="syllabus-activity-req" name="requirementLevel">
                  <option
                    value="required"
                    selected={mode !== "edit-activity" || activeAct?.["requirement_level"] !== "optional"}
                  >
                    Required
                  </option>
                  <option
                    value="optional"
                    selected={mode === "edit-activity" && activeAct?.["requirement_level"] === "optional"}
                  >
                    Optional enrichment
                  </option>
                </select>
              </label>
            </div>
            <label class="field" for="syllabus-activity-prompt">
              <span>Study focus or verification prompt</span>
              <textarea
                id="syllabus-activity-prompt"
                name="prompt"
                rows={2}
                value={mode === "edit-activity" && activeAct ? activityPromptOfRaw(activeAct) : ""}
                placeholder="What to derive, implement, or verify during this step."
              />
            </label>
            <footer class="dialog-footer">
              <button
                type="button"
                class="btn-secondary"
                data-action="open-syllabus-editor"
                data-syllabus-edit-mode="syllabus"
              >
                Back to overview
              </button>
              <button type="submit" class="btn-primary">
                {mode === "edit-activity" ? "Save step" : "Add step"}
              </button>
            </footer>
          </form>
        ) : null}
      </div>
    </dialog>
  );
}

export interface DeleteSyllabusDialogProps {
  readonly open: boolean;
  readonly syllabusId: string;
  readonly syllabusTitle: string;
}

export function DeleteSyllabusDialog({
  open,
  syllabusId,
  syllabusTitle,
}: DeleteSyllabusDialogProps): VNode {
  return (
    <dialog
      id="dialog-delete-syllabus"
      class="modal-dialog modal-dialog-sm"
      closedby="any"
      aria-labelledby="dialog-delete-syllabus-title"
      data-open={String(open)}
      data-syllabus-id={syllabusId}
      data-opaque-surface="true"
    >
      <div class="dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-delete-syllabus-title">Delete syllabus</h2>
          <form method="dialog">
            <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
              <SfIcon name="close" />
            </button>
          </form>
        </header>
        <p class="prose warning-copy">
          Remove <strong>{syllabusTitle}</strong> from your private study workspace? Your local schedule overrides and structure edits for this plan will be deleted. Shared public templates in Explore remain unchanged unless you unpublish them separately.
        </p>
        <footer class="dialog-footer">
          <form method="dialog">
            <button type="submit" class="btn-secondary" data-action="close-dialog" autofocus>
              Cancel
            </button>
          </form>
          <button
            type="button"
            class="btn-danger"
            data-action="confirm-delete-syllabus"
            data-syllabus-id={syllabusId}
          >
            Delete syllabus
          </button>
        </footer>
      </div>
    </dialog>
  );
}
