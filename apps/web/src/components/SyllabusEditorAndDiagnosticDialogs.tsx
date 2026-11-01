export {
  SYLLABUS_EDIT_MODES,
  type SyllabusEditMode,
  EDITABLE_ACTIVITY_TYPES,
  type EditableActivityType,
  ACTIVITY_TYPE_LABELS,
  activityMinutesOfRaw,
  activityPromptOfRaw,
  bumpSyllabusRevision,
  buildDurationEstimateForType,
  buildContentForActivityType,
  mutateSyllabusMeta,
  upsertSyllabusModule,
  moveSyllabusModule,
  removeSyllabusModule,
  upsertSyllabusActivity,
  moveSyllabusActivity,
  removeSyllabusActivity,
  cascadeActivityDeletionToSchedule,
} from "./syllabusEditor/astMutations.ts";

export {
  type ProficiencyOverrideEntry,
  buildEffectiveProficiency,
  buildDynamicDiagnosticSession,
  buildDynamicAdaptationProposal,
  applyAcceptedAdaptationToSyllabus,
} from "./syllabusEditor/diagnosticEngine.ts";

export {
  type DiagnosticCheckDialogProps,
  DiagnosticCheckDialog,
} from "./syllabusEditor/DiagnosticCheckDialog.tsx";

export {
  type SyllabusStructureEditorDialogProps,
  SyllabusStructureEditorDialog,
} from "./syllabusEditor/SyllabusStructureEditorDialog.tsx";

export {
  type DeleteSyllabusDialogProps,
  DeleteSyllabusDialog,
} from "./syllabusEditor/DeleteSyllabusDialog.tsx";
