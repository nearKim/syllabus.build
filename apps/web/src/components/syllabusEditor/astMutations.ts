import { asRecord, normalizeStringList, rawListOf } from "../../shared.ts";

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

export const ACTIVITY_TYPE_LABELS: Readonly<Record<EditableActivityType, string>> = {
  theory: "Reading & Theory",
  worked_example: "Worked Example",
  coding: "Code Lab / Deliverable",
  quiz: "Checkpoint Quiz / Gate",
  review: "Spaced Review",
  reflection: "Synthesis Reflection",
};

export function bumpSyllabusRevision(
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

export function buildDurationEstimateForType(activityType: EditableActivityType, minutes: number) {
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

export function buildContentForActivityType(
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

export function cascadeActivityDeletionToSchedule(
  schedule: Record<string, unknown>,
  removedActivityIds: readonly string[] | ReadonlySet<string>,
): Record<string, unknown> {
  const removedSet = removedActivityIds instanceof Set ? removedActivityIds : new Set(removedActivityIds);
  const sessions = rawListOf(schedule, "sessions").map((sess) => {
    const actIds = normalizeStringList(sess["activity_ids"]).filter((id) => !removedSet.has(id));
    return {
      ...sess,
      activity_ids: actIds,
    };
  });
  return {
    ...schedule,
    sessions,
  };
}

export function removeSyllabusModule(
  syllabus: Record<string, unknown>,
  moduleId: string,
  schedule?: Record<string, unknown> | null,
): {
  readonly syllabus: Record<string, unknown>;
  readonly schedule?: Record<string, unknown>;
  readonly removedActivityIds: readonly string[];
} | { readonly error: string } {
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
  const updatedSyllabus = {
    ...syllabus,
    ...bumpSyllabusRevision(syllabus, "manual_module_removed"),
    modules: remainingModules,
    activities: remainingActivities,
  };
  return {
    syllabus: updatedSyllabus,
    removedActivityIds: Array.from(removedActIds),
    ...(schedule ? { schedule: cascadeActivityDeletionToSchedule(schedule, removedActIds) } : {}),
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
  schedule?: Record<string, unknown> | null,
): {
  readonly syllabus: Record<string, unknown>;
  readonly schedule?: Record<string, unknown>;
  readonly removedActivityIds: readonly string[];
} | { readonly error: string } {
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
  const updatedSyllabus = {
    ...syllabus,
    ...bumpSyllabusRevision(syllabus, "manual_activity_removed"),
    modules: nextModules,
    activities: nextActivities,
  };
  return {
    syllabus: updatedSyllabus,
    removedActivityIds: [activityId],
    ...(schedule ? { schedule: cascadeActivityDeletionToSchedule(schedule, [activityId]) } : {}),
  };
}
