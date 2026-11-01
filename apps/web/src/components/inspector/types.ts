import type {
  StudyActivity,
  StudyModule,
} from "../StudyFlowBoard.tsx";

declare module "preact" {
  namespace JSX {
    interface HTMLAttributes<RefType extends EventTarget = EventTarget> {
      closedby?: "any" | "closerequest" | "none";
      autofocus?: boolean;
    }
  }
}

export const INSPECTOR_ID = "learn-detail-inspector";

export const SETTABLE_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];
export const STATUS_LABELS: Readonly<Record<SettableStatus, string>> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Done",
};

export interface SelfCheckRubric {
  readonly prompt: string;
  readonly criteria: readonly string[];
}

// One practice question per syllabus or activity, with its formula in TeX. A choice value is what Submit records.
export interface ConceptCheck {
  readonly formula: string;
  readonly question: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly correctValue?: string | undefined;
  readonly hint: string;
  readonly solution: string;
  readonly generatedBy?: "curated" | "ai" | "deterministic" | undefined;
}

export interface PracticeState {
  readonly hintRequested: boolean;
  readonly workedSolutionRevealed: boolean;
  readonly submitted: boolean;
  readonly choice: string | null;
}

// A worked example, quiz, or review ends with the syllabus's concept check, unless a rubric checks it instead.
export const CONCEPT_CHECK_TYPES: ReadonlySet<string> = new Set(["worked_example", "quiz", "review"]);

export type SourceCardView = StudyActivity["resourceProvenanceCards"][number];

export function activityConceptCheck(
  activity: StudyActivity,
  rubric: SelfCheckRubric | null,
  conceptCheck: ConceptCheck | null,
): ConceptCheck | null {
  return conceptCheck && !rubric && CONCEPT_CHECK_TYPES.has(activity.type) ? conceptCheck : null;
}

// One checkable row under the activity: a material, the concept check, or a lab or rubric criterion.
export type SubtaskSpec =
  | { readonly kind: "material"; readonly subtaskId: string; readonly card: SourceCardView }
  | { readonly kind: "concept-check"; readonly subtaskId: string }
  | { readonly kind: "criterion"; readonly subtaskId: string; readonly text: string };

// A valid Submit answer checks this subtask off, so the controller builds the same id.
export function conceptCheckSubtaskId(activityId: string): string {
  return `${activityId}:concept-check`;
}

// The activity's subtasks in working order: each material, the concept check, then each lab or rubric criterion.
// The drawer renders this list and the controller counts it to set the activity status.
export function activitySubtasks(
  modules: readonly StudyModule[],
  activity: StudyActivity,
  rubric: SelfCheckRubric | null,
  conceptCheck: ConceptCheck | null,
): readonly SubtaskSpec[] {
  const id = activity.activityId;
  const isLab = activity.type === "coding" || activity.type === "project";
  const objectives = new Map(modules.flatMap((unit) => unit.objectives).map((objective) => [objective.objectiveId, objective]));
  const labCriteria = isLab
    ? activity.objectiveIds.flatMap((objectiveId) => {
        const criterion = objectives.get(objectiveId)?.successCriterion;
        return criterion ? [{ kind: "criterion" as const, subtaskId: `${id}:verify:${objectiveId}`, text: criterion }] : [];
      })
    : [];
  return [
    ...activity.resourceProvenanceCards.map((card) => ({
      kind: "material" as const,
      subtaskId: `${id}:material:${card.resourceVersionId}`,
      card,
    })),
    ...(activityConceptCheck(activity, rubric, conceptCheck) ? [{ kind: "concept-check" as const, subtaskId: conceptCheckSubtaskId(id) }] : []),
    ...labCriteria,
    ...(rubric?.criteria ?? []).map((text, idx) => ({ kind: "criterion" as const, subtaskId: `${id}:rubric:${idx}`, text })),
  ];
}

export function displayLocation(url: string): string {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/\/+$/, "");
  return hostname.endsWith(".invalid") ? path.replace(/^\/+/, "") || "catalog" : `${hostname.replace(/^www\./, "")}${path}`;
}

export type InspectorMode = "unit" | "activity";
