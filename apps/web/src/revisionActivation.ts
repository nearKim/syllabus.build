import { buildOperationHeaders } from "@syllabus/api-client";
import { requireNonEmpty } from "./shared.ts";

export interface RevisionActivationOptions {
  readonly syllabusId?: string; readonly syllabus_id?: string;
  readonly revisionId?: string; readonly revision_id?: string;
  readonly ifMatch?: string; readonly etag?: string;
  readonly confirmed?: boolean; readonly confirmedByLearner?: boolean; readonly learnerConfirmed?: boolean;
  readonly acknowledgeScheduleChanges?: boolean; readonly acknowledge_schedule_changes?: boolean;
}

export function buildRevisionActivationRequest(options: RevisionActivationOptions) {
  if (!(options.confirmedByLearner === true || options.confirmed === true || options.learnerConfirmed === true)) {
    throw new Error(
      "Explicit learner confirmation (confirmedByLearner: true) is required before activating a syllabus revision; unreviewed revisions are never auto-activated.",
    );
  }
  const syllabusId = requireNonEmpty(
    options.syllabusId ?? options.syllabus_id,
    "Both syllabusId and revisionId are required to activate a revision.",
  );
  const revisionId = requireNonEmpty(
    options.revisionId ?? options.revision_id,
    "Both syllabusId and revisionId are required to activate a revision.",
  );
  const ifMatch = options.ifMatch ?? options.etag;
  return {
    operationId: "activateSyllabusRevision" as const, method: "PUT" as const,
    path: `/syllabi/${syllabusId}/active-revision`,
    syllabusId, revisionId,
    headers: buildOperationHeaders("activateSyllabusRevision", ifMatch !== undefined ? { ifMatch } : {}),
    body: {
      revision_id: revisionId,
      acknowledge_schedule_changes: Boolean(options.acknowledgeScheduleChanges ?? options.acknowledge_schedule_changes ?? true),
    },
    confirmedByLearner: true as const, autoActivated: false as const,
  };
}
export type RevisionActivationRequestDescriptor = ReturnType<typeof buildRevisionActivationRequest>;
