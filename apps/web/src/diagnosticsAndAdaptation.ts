import { buildOperationHeaders } from "../../../packages/api-client/src/index.ts";
import {
  resolveSurfaceStyle,
  type ResolvedSurfaceStyle as SurfaceStyle,
  type ThemeMode,
} from "../../../packages/ui/src/index.ts";

export type ObjectiveEvidenceState =
  | "demonstrated"
  | "in_progress"
  | "unverified"
  | "unknown";

export type TopicCoverageState = "demonstrated" | "partial" | "unassessed";

export interface ObjectiveEvidenceRecord {
  objective_id: string;
  objective_version_id: string;
  topic_id?: string;
  state: ObjectiveEvidenceState;
  status?: ObjectiveEvidenceState;
  qualifying_attempt_ids: string[];
  evidence_refs?: string[];
  UnverifiedReason?: string | null;
}

export interface TopicCoverageRecord {
  topic_id: string;
  coverage_state: TopicCoverageState;
  coverage_label?: TopicCoverageState;
  assessed_objective_version_ids?: string[];
  unassessed_objective_version_ids?: string[];
  demonstrated_objective_count: number;
  total_objective_count: number;
}

export interface ProficiencyProfileFixture {
  profile_revision_id: string;
  learner_id?: string;
  account_id?: string;
  updated_at?: string;
  computed_at?: string;
  objective_evidence: Array<{
    objective_id: string;
    objective_version_id: string;
    topic_id?: string;
    state?: ObjectiveEvidenceState;
    status?: ObjectiveEvidenceState;
    qualifying_attempt_ids?: string[];
    evidence_refs?: string[];
    UnverifiedReason?: string | null;
    [key: string]: unknown;
  }>;
  topic_coverage: Array<{
    topic_id: string;
    coverage_state?: TopicCoverageState;
    coverage_label?: TopicCoverageState;
    assessed_objective_version_ids?: string[];
    unassessed_objective_version_ids?: string[];
    demonstrated_objective_count?: number;
    total_objective_count?: number;
    [key: string]: unknown;
  }>;
}

export interface DiagnosticSessionFixture {
  diagnostic_session_id: string;
  curriculum_id?: string;
  curriculum_revision_id?: string;
  state: "active" | "completed" | "stopped" | "abandoned";
  started_at?: string;
  stopped_at?: string | null;
  stop_reason?:
    | "completed"
    | "learner_stopped"
    | "time_budget_reached"
    | "sufficient_evidence"
    | null;
  target_objective_version_ids: string[];
  assessed_objective_version_ids: string[];
  unassessed_objective_version_ids: string[];
  proficiency_snapshot_ref?: string | null;
}

export interface DiagnosticAttemptSubmissionInput {
  item_id: string;
  objective_version_id: string;
  objective_id?: string;
  topic_id?: string;
  attempt_id: string;
  selected_choice_id?: string;
  short_answer_text?: string;
  demonstrated: boolean;
}

export interface DiagnosticHttpRequest<TPayload> {
  method: "POST";
  path: string;
  headers: Record<string, string>;
  body: TPayload;
}

export interface DiagnosticSessionModel {
  diagnostic_session_id: string;
  curriculum_id: string;
  curriculum_revision_id: string;
  state: DiagnosticSessionFixture["state"];
  stop_reason: DiagnosticSessionFixture["stop_reason"];
  target_objective_version_ids: string[];
  assessed_objective_version_ids: string[];
  unassessed_objective_version_ids: string[];
  proficiency_snapshot_ref: string | null;
  objective_evidence: ObjectiveEvidenceRecord[];
  topic_coverage: TopicCoverageRecord[];
  surfaceStyle: SurfaceStyle;
}

export interface DiagnosticSessionController {
  getState(): DiagnosticSessionModel;
  buildStartDiagnosticRequest(input?: {
    target_topic_ids?: string[];
    max_duration_minutes?: number;
  }): DiagnosticHttpRequest<{
    curriculum_revision_id: string;
    target_topic_ids?: string[];
    max_duration_minutes?: number;
  }>;
  submitDiagnosticAttempt(
    input: DiagnosticAttemptSubmissionInput
  ): DiagnosticHttpRequest<{
    item_id: string;
    objective_version_id: string;
    selected_choice_id?: string;
    short_answer_text?: string;
  }>;
  stopDiagnostic(
    reason?: "learner_stopped" | "time_budget_reached" | "sufficient_evidence"
  ): DiagnosticHttpRequest<{
    stop_reason: "learner_stopped" | "time_budget_reached" | "sufficient_evidence";
  }>;
  stopEarly(
    reason?: "learner_stopped" | "time_budget_reached" | "sufficient_evidence"
  ): DiagnosticHttpRequest<{
    stop_reason: "learner_stopped" | "time_budget_reached" | "sufficient_evidence";
  }>;
}

export interface AdaptationChangeEntry {
  kind:
    | "waive_instruction"
    | "waive_node"
    | "add_bridge"
    | "add_foundation"
    | "add_node"
    | "reorder_node"
    | "reorder"
    | "adjust_depth"
    | "depth_adjusted";
  node_id?: string;
  activity_ids?: string[];
  objective_version_id?: string;
  objective_version_ids?: string[];
  rationale?: string;
  reason?: string;
  qualifying_evidence_refs?: string[];
  evidence_refs?: string[];
}

export interface ProposedWaiverEntry {
  waiver_id: string;
  objective_id?: string;
  objective_version_id: string;
  node_id?: string;
  criterion_policy_id?: string;
  qualifying_evidence_refs: string[];
  rationale?: string;
  conditions_summary?: string;
}

export interface AdaptationImpactBlock {
  before_minutes: number;
  after_minutes: number;
  constraint_status: "feasible" | "infeasible";
  schedule_impact_summary?: string;
  inference_charge_summary?: string;
  warnings?: string[];
}

export interface AdaptationProposalFixture {
  proposal_id: string;
  curriculum_id: string;
  base_revision_id: string;
  candidate_revision_id: string;
  proficiency_snapshot_ref: string;
  proposal_sha256: string;
  base_schedule_revision_id?: string | null;
  status?: "pending" | "accepted" | "rejected" | "superseded" | "expired";
  created_at?: string;
  instruction_preferences_applied?: {
    math_depth?: "intuitive" | "standard" | "formal";
    [key: string]: unknown;
  };
  changes: AdaptationChangeEntry[];
  proposed_waivers: ProposedWaiverEntry[];
  impact: AdaptationImpactBlock;
  unassessed_objective_version_ids: string[];
}

export interface AdaptationDiffBuckets {
  added: AdaptationChangeEntry[];
  waived: AdaptationChangeEntry[];
  reordered: AdaptationChangeEntry[];
  depth_adjusted: AdaptationChangeEntry[];
}

export interface ValidatedWaiverSummary {
  waiver_id: string;
  node_id: string;
  objective_version_id: string;
  qualifying_evidence_refs: string[];
  hasValidEvidence: boolean;
  rationale: string;
}

export interface AdaptationDiffModel {
  proposal_id: string;
  curriculum_id: string;
  base_revision_id: string;
  candidate_revision_id: string;
  base_schedule_revision_id: string | null;
  proficiency_snapshot_ref: string;
  proposal_sha256: string;
  status: NonNullable<AdaptationProposalFixture["status"]>;
  preserved_math_depth: "intuitive" | "standard" | "formal" | null;
  buckets: AdaptationDiffBuckets;
  waivers: ValidatedWaiverSummary[];
  allWaiversHaveEvidence: boolean;
  unassessed_objective_version_ids: string[];
  impact: AdaptationImpactBlock & {
    delta_minutes: number;
  };
  conflictBanner: string | null;
  surfaceStyle: SurfaceStyle;
}

export interface AcceptAdaptationRequestPayload {
  expected_proposal_sha256: string;
  expected_base_revision_id: string;
  expected_base_schedule_revision_id?: string | null;
  base_curriculum_revision_id: string;
  base_schedule_revision_id?: string | null;
  accepted_waiver_ids: string[];
}

export interface AcceptAdaptationOptions {
  idempotencyKey: string;
  expectedProposalSha256?: string;
  baseCurriculumRevisionId?: string;
  baseScheduleRevisionId?: string | null;
  acceptedWaiverIds?: string[];
}

export interface AdaptationDiffController {
  getDiffModel(): AdaptationDiffModel;
  buildAcceptAdaptationRequest(
    options: AcceptAdaptationOptions
  ): DiagnosticHttpRequest<AcceptAdaptationRequestPayload>;
  handleAdaptationConflict(
    statusCode: number,
    message?: string
  ): AdaptationDiffModel;
}

function inferObjectiveIdFromVersionId(objectiveVersionId: string): string {
  return objectiveVersionId.replace(/-v\d+$/, "");
}

function inferTopicIdFromObjectiveId(objectiveId: string): string {
  if (objectiveId.includes("matrix-calculus")) {
    return "topic-matrix-calculus";
  }
  if (objectiveId.includes("matrix") || objectiveId.includes("linear-algebra")) {
    return "topic-linear-algebra";
  }
  return `topic-${objectiveId.replace(/^objective-/, "")}`;
}

function buildInitialObjectiveEvidence(
  session: DiagnosticSessionFixture,
  proficiency?: ProficiencyProfileFixture
): ObjectiveEvidenceRecord[] {
  const byVersion = new Map<string, ObjectiveEvidenceRecord>();
  if (proficiency && Array.isArray(proficiency.objective_evidence)) {
    for (const record of proficiency.objective_evidence) {
      const refs = Array.isArray(record.qualifying_attempt_ids)
        ? [...record.qualifying_attempt_ids]
        : Array.isArray(record.evidence_refs)
          ? [...record.evidence_refs]
          : [];
      const resolvedState: ObjectiveEvidenceState =
        record.state ?? record.status ?? "unknown";
      byVersion.set(record.objective_version_id, {
        objective_id: record.objective_id,
        objective_version_id: record.objective_version_id,
        topic_id:
          record.topic_id ?? inferTopicIdFromObjectiveId(record.objective_id),
        state: resolvedState,
        status: resolvedState,
        qualifying_attempt_ids: refs,
        evidence_refs: [...refs],
        UnverifiedReason: record.UnverifiedReason ?? null,
      });
    }
  }

  const assessedSet = new Set(session.assessed_objective_version_ids);
  for (const versionId of session.target_objective_version_ids) {
    if (!byVersion.has(versionId)) {
      const objectiveId = inferObjectiveIdFromVersionId(versionId);
      const isAssessed = assessedSet.has(versionId);
      const refs = isAssessed ? ["diagnostic-attempt-initial"] : [];
      const resolvedState: ObjectiveEvidenceState = isAssessed
        ? "demonstrated"
        : "unknown";
      byVersion.set(versionId, {
        objective_id: objectiveId,
        objective_version_id: versionId,
        topic_id: inferTopicIdFromObjectiveId(objectiveId),
        state: resolvedState,
        status: resolvedState,
        qualifying_attempt_ids: refs,
        evidence_refs: [...refs],
        UnverifiedReason: isAssessed ? null : "unassessed_in_diagnostic",
      });
    }
  }

  return Array.from(byVersion.values());
}

function recomputeTopicCoverage(
  objectiveEvidence: ObjectiveEvidenceRecord[],
  existingTopics: ProficiencyProfileFixture["topic_coverage"] = []
): TopicCoverageRecord[] {
  const topicMeta = new Map<
    string,
    {
      demonstrated: number;
      assessedAny: boolean;
      total: number;
      assessedIds: string[];
      unassessedIds: string[];
    }
  >();

  for (const existing of existingTopics) {
    const priorAssessed = Array.isArray(existing.assessed_objective_version_ids)
      ? existing.assessed_objective_version_ids
      : [];
    const priorUnassessed = Array.isArray(
      existing.unassessed_objective_version_ids
    )
      ? existing.unassessed_objective_version_ids
      : [];
    const derivedTotal =
      typeof existing.total_objective_count === "number"
        ? existing.total_objective_count
        : Math.max(priorAssessed.length + priorUnassessed.length, 1);

    topicMeta.set(existing.topic_id, {
      demonstrated: 0,
      assessedAny: false,
      total: derivedTotal,
      assessedIds: [...priorAssessed],
      unassessedIds: [...priorUnassessed],
    });
  }

  const groupedByTopic = new Map<string, ObjectiveEvidenceRecord[]>();
  for (const record of objectiveEvidence) {
    const topicId =
      record.topic_id ?? inferTopicIdFromObjectiveId(record.objective_id);
    const list = groupedByTopic.get(topicId) ?? [];
    list.push(record);
    groupedByTopic.set(topicId, list);
  }

  for (const [topicId, records] of groupedByTopic.entries()) {
    const prior = topicMeta.get(topicId);
    const demonstratedCount = records.filter(
      (item) => item.state === "demonstrated"
    ).length;
    const assessedAny = records.some(
      (item) => item.state === "demonstrated" || item.state === "in_progress"
    );
    const totalCount = Math.max(prior?.total ?? 0, records.length, 1);
    const assessedIds = records
      .filter((r) => r.state === "demonstrated" || r.state === "in_progress")
      .map((r) => r.objective_version_id);
    const unassessedIds = records
      .filter((r) => r.state === "unknown" || r.state === "unverified")
      .map((r) => r.objective_version_id);
    for (const extraUnassessed of prior?.unassessedIds ?? []) {
      if (
        !assessedIds.includes(extraUnassessed) &&
        !unassessedIds.includes(extraUnassessed)
      ) {
        unassessedIds.push(extraUnassessed);
      }
    }
    topicMeta.set(topicId, {
      demonstrated: demonstratedCount,
      assessedAny,
      total: Math.max(totalCount, assessedIds.length + unassessedIds.length),
      assessedIds,
      unassessedIds,
    });
  }

  const result: TopicCoverageRecord[] = [];
  for (const [topicId, counts] of topicMeta.entries()) {
    let coverageState: TopicCoverageState = "unassessed";
    if (
      counts.demonstrated >= counts.total &&
      counts.total > 0 &&
      counts.unassessedIds.length === 0
    ) {
      coverageState = "demonstrated";
    } else if (counts.demonstrated > 0 || counts.assessedAny) {
      coverageState = "partial";
    } else {
      coverageState = "unassessed";
    }
    result.push({
      topic_id: topicId,
      coverage_state: coverageState,
      coverage_label: coverageState,
      assessed_objective_version_ids: counts.assessedIds,
      unassessed_objective_version_ids: counts.unassessedIds,
      demonstrated_objective_count: counts.demonstrated,
      total_objective_count: counts.total,
    });
  }

  return result;
}

/**
 * Creates a controller for diagnostic placement sessions (`T12`).
 * Enforces objective-level evidence partitioning (`@S70`) and early-exit handling (`@S19`, `@S64`)
 * so untested objectives remain `unassessed`/`unknown` rather than inferred from neighbouring topics.
 */
export function createDiagnosticFlowController(
  initialSession: DiagnosticSessionFixture,
  initialProficiency?: ProficiencyProfileFixture,
  mode: ThemeMode = "light"
): DiagnosticSessionController {
  const surfaceStyle = resolveSurfaceStyle("assessment", {
    themePreference: mode,
  });
  const curriculumId =
    initialSession.curriculum_id ?? "curriculum-formal-synthetic";
  const curriculumRevisionId =
    initialSession.curriculum_revision_id ?? "formal-plan-before";

  let state = initialSession.state;
  let stopReason: DiagnosticSessionFixture["stop_reason"] =
    initialSession.stop_reason ?? null;
  const targetIds = [...initialSession.target_objective_version_ids];
  const assessedSet = new Set(initialSession.assessed_objective_version_ids);
  const unassessedSet = new Set(
    initialSession.unassessed_objective_version_ids.length > 0
      ? initialSession.unassessed_objective_version_ids
      : targetIds.filter((id) => !assessedSet.has(id))
  );

  let objectiveEvidence = buildInitialObjectiveEvidence(
    initialSession,
    initialProficiency
  );
  let topicCoverage = recomputeTopicCoverage(
    objectiveEvidence,
    initialProficiency?.topic_coverage ?? []
  );

  function syncPartitions(): {
    assessed: string[];
    unassessed: string[];
  } {
    const assessed = targetIds.filter((id) => assessedSet.has(id));
    const unassessed = targetIds.filter((id) => !assessedSet.has(id));
    unassessedSet.clear();
    for (const id of unassessed) {
      unassessedSet.add(id);
    }
    return { assessed, unassessed };
  }

  function snapshot(): DiagnosticSessionModel {
    const partitions = syncPartitions();
    return {
      diagnostic_session_id: initialSession.diagnostic_session_id,
      curriculum_id: curriculumId,
      curriculum_revision_id: curriculumRevisionId,
      state,
      stop_reason: stopReason,
      target_objective_version_ids: [...targetIds],
      assessed_objective_version_ids: partitions.assessed,
      unassessed_objective_version_ids: partitions.unassessed,
      proficiency_snapshot_ref:
        initialSession.proficiency_snapshot_ref ??
        initialProficiency?.profile_revision_id ??
        null,
      objective_evidence: objectiveEvidence.map((entry) => ({
        ...entry,
        qualifying_attempt_ids: [...entry.qualifying_attempt_ids],
        evidence_refs: [...(entry.evidence_refs ?? entry.qualifying_attempt_ids)],
      })),
      topic_coverage: topicCoverage.map((entry) => ({ ...entry })),
      surfaceStyle,
    };
  }

  return {
    getState() {
      return snapshot();
    },

    buildStartDiagnosticRequest(input = {}) {
      return {
        method: "POST",
        path: `/v1/curricula/${encodeURIComponent(curriculumId)}/diagnostics`,
        headers: buildOperationHeaders("startDiagnostic"),
        body: {
          curriculum_revision_id: curriculumRevisionId,
          ...(input.target_topic_ids
            ? { target_topic_ids: [...input.target_topic_ids] }
            : {}),
          ...(input.max_duration_minutes !== undefined
            ? { max_duration_minutes: input.max_duration_minutes }
            : {}),
        },
      };
    },

    submitDiagnosticAttempt(input: DiagnosticAttemptSubmissionInput) {
      if (state !== "active") {
        throw new Error(
          `Cannot submit diagnostic attempt when session is in state "${state}".`
        );
      }

      assessedSet.add(input.objective_version_id);
      unassessedSet.delete(input.objective_version_id);

      const objectiveId =
        input.objective_id ??
        inferObjectiveIdFromVersionId(input.objective_version_id);
      const topicId = input.topic_id ?? inferTopicIdFromObjectiveId(objectiveId);

      // Update ONLY the tested objective — never infer neighbouring objectives (@S70)
      let found = false;
      objectiveEvidence = objectiveEvidence.map((entry) => {
        if (entry.objective_version_id !== input.objective_version_id) {
          return entry;
        }
        found = true;
        const nextAttempts = entry.qualifying_attempt_ids.includes(input.attempt_id)
          ? [...entry.qualifying_attempt_ids]
          : [...entry.qualifying_attempt_ids, input.attempt_id];
        const nextState: ObjectiveEvidenceState = input.demonstrated
          ? "demonstrated"
          : "in_progress";
        const refs = input.demonstrated ? nextAttempts : [];
        return {
          ...entry,
          topic_id: entry.topic_id ?? topicId,
          state: nextState,
          status: nextState,
          qualifying_attempt_ids: refs,
          evidence_refs: [...refs],
          UnverifiedReason: input.demonstrated ? null : "incorrect_diagnostic_attempt",
        };
      });

      if (!found) {
        const nextState: ObjectiveEvidenceState = input.demonstrated
          ? "demonstrated"
          : "in_progress";
        const refs = input.demonstrated ? [input.attempt_id] : [];
        objectiveEvidence.push({
          objective_id: objectiveId,
          objective_version_id: input.objective_version_id,
          topic_id: topicId,
          state: nextState,
          status: nextState,
          qualifying_attempt_ids: refs,
          evidence_refs: [...refs],
          UnverifiedReason: input.demonstrated ? null : "incorrect_diagnostic_attempt",
        });
      }

      topicCoverage = recomputeTopicCoverage(
        objectiveEvidence,
        initialProficiency?.topic_coverage ?? topicCoverage
      );

      if (unassessedSet.size === 0) {
        state = "completed";
        stopReason = "completed";
      }

      return {
        method: "POST",
        path: `/v1/diagnostics/${encodeURIComponent(initialSession.diagnostic_session_id)}/attempts`,
        headers: buildOperationHeaders("submitDiagnosticAttempt"),
        body: {
          item_id: input.item_id,
          objective_version_id: input.objective_version_id,
          ...(input.selected_choice_id
            ? { selected_choice_id: input.selected_choice_id }
            : {}),
          ...(input.short_answer_text
            ? { short_answer_text: input.short_answer_text }
            : {}),
        },
      };
    },

    stopDiagnostic(reason = "learner_stopped") {
      state = "stopped";
      stopReason = reason;

      // Preserve demonstrated objectives while explicitly keeping untested objectives unknown/unassessed (@S19, @S64, @S70)
      objectiveEvidence = objectiveEvidence.map((entry) => {
        if (assessedSet.has(entry.objective_version_id)) {
          return entry;
        }
        return {
          ...entry,
          state: "unknown",
          status: "unknown",
          qualifying_attempt_ids: [],
          evidence_refs: [],
          UnverifiedReason: "unassessed_in_diagnostic",
        };
      });

      topicCoverage = recomputeTopicCoverage(
        objectiveEvidence,
        initialProficiency?.topic_coverage ?? topicCoverage
      );

      return {
        method: "POST",
        path: `/v1/diagnostics/${encodeURIComponent(initialSession.diagnostic_session_id)}/stop`,
        headers: buildOperationHeaders("stopDiagnostic"),
        body: {
          stop_reason: reason,
        },
      };
    },

    stopEarly(reason = "learner_stopped") {
      return this.stopDiagnostic(reason);
    },
  };
}

/**
 * Creates a controller for inspecting and accepting an `AdaptationProposal` (`T12`).
 * Categorizes proposal changes into `added`, `waived`, `reordered`, and `depth_adjusted` buckets,
 * verifies qualifying reviewed-anchor evidence for every waiver (`@S18`, `@S51`), preserves
 * learner instruction preferences (`math_depth`, `@S03`), and enforces `Idempotency-Key` +
 * base revision & SHA-256 concurrency guards on acceptance (`@S59`).
 */
export function createAdaptationDiffController(
  proposal: AdaptationProposalFixture,
  mode: ThemeMode = "light"
): AdaptationDiffController {
  const surfaceStyle = resolveSurfaceStyle("evidence", {
    themePreference: mode,
  });
  let status: NonNullable<AdaptationProposalFixture["status"]> =
    proposal.status ?? "pending";
  let conflictBanner: string | null = null;

  function computeDiffModel(): AdaptationDiffModel {
    const buckets: AdaptationDiffBuckets = {
      added: [],
      waived: [],
      reordered: [],
      depth_adjusted: [],
    };

    for (const change of proposal.changes) {
      const refs =
        change.qualifying_evidence_refs ?? change.evidence_refs ?? [];
      const cloned: AdaptationChangeEntry = {
        ...change,
        node_id: change.node_id ?? change.activity_ids?.[0] ?? "unknown-node",
        rationale: change.rationale ?? change.reason ?? "",
        qualifying_evidence_refs: [...refs],
        evidence_refs: [...refs],
      };
      if (
        change.kind === "add_bridge" ||
        change.kind === "add_foundation" ||
        change.kind === "add_node"
      ) {
        buckets.added.push(cloned);
      } else if (
        change.kind === "waive_instruction" ||
        change.kind === "waive_node"
      ) {
        buckets.waived.push(cloned);
      } else if (change.kind === "reorder_node" || change.kind === "reorder") {
        buckets.reordered.push(cloned);
      } else if (
        change.kind === "adjust_depth" ||
        change.kind === "depth_adjusted"
      ) {
        buckets.depth_adjusted.push(cloned);
      }
    }

    const waivers: ValidatedWaiverSummary[] = proposal.proposed_waivers.map(
      (waiver) => {
        const refs = (waiver.qualifying_evidence_refs ?? []).filter(
          (ref) => typeof ref === "string" && ref.trim().length > 0
        );
        return {
          waiver_id: waiver.waiver_id,
          node_id:
            waiver.node_id ??
            waiver.objective_id ??
            waiver.objective_version_id,
          objective_version_id: waiver.objective_version_id,
          qualifying_evidence_refs: [...refs],
          hasValidEvidence: refs.length > 0,
          rationale:
            waiver.rationale ??
            waiver.conditions_summary ??
            "Demonstrated via reviewed anchor evidence.",
        };
      }
    );

    const waivedChangesHaveEvidence = buckets.waived.every(
      (change) =>
        Array.isArray(change.qualifying_evidence_refs) &&
        change.qualifying_evidence_refs.length > 0
    );
    const allWaiversHaveEvidence =
      waivers.every((waiver) => waiver.hasValidEvidence) &&
      waivedChangesHaveEvidence;

    return {
      proposal_id: proposal.proposal_id,
      curriculum_id: proposal.curriculum_id,
      base_revision_id: proposal.base_revision_id,
      candidate_revision_id: proposal.candidate_revision_id,
      base_schedule_revision_id: proposal.base_schedule_revision_id ?? null,
      proficiency_snapshot_ref: proposal.proficiency_snapshot_ref,
      proposal_sha256: proposal.proposal_sha256,
      status,
      preserved_math_depth:
        proposal.instruction_preferences_applied?.math_depth ?? null,
      buckets,
      waivers,
      allWaiversHaveEvidence,
      unassessed_objective_version_ids: [
        ...proposal.unassessed_objective_version_ids,
      ],
      impact: {
        ...proposal.impact,
        delta_minutes:
          proposal.impact.after_minutes - proposal.impact.before_minutes,
      },
      conflictBanner,
      surfaceStyle,
    };
  }

  return {
    getDiffModel() {
      return computeDiffModel();
    },

    buildAcceptAdaptationRequest(options: AcceptAdaptationOptions) {
      const diffModel = computeDiffModel();
      if (!diffModel.allWaiversHaveEvidence) {
        throw new Error(
          "Cannot accept adaptation proposal: every proposed waiver must cite at least one qualifying reviewed-anchor evidence ref."
        );
      }

      const expectedSha =
        options.expectedProposalSha256 ?? proposal.proposal_sha256;
      const expectedBaseRevision =
        options.baseCurriculumRevisionId ?? proposal.base_revision_id;
      const expectedScheduleRevision =
        options.baseScheduleRevisionId !== undefined
          ? options.baseScheduleRevisionId
          : (proposal.base_schedule_revision_id ?? null);

      if (expectedSha !== proposal.proposal_sha256) {
        status = "superseded";
        conflictBanner =
          "Adaptation proposal checksum mismatch: the proposal changed since preview.";
        throw new Error(conflictBanner);
      }

      if (expectedBaseRevision !== proposal.base_revision_id) {
        status = "superseded";
        conflictBanner =
          "Stale curriculum base revision: cannot apply adaptation against a modified plan.";
        throw new Error(conflictBanner);
      }

      if (
        proposal.base_schedule_revision_id &&
        expectedScheduleRevision !== proposal.base_schedule_revision_id
      ) {
        status = "superseded";
        conflictBanner =
          "Stale schedule base revision: cannot apply adaptation against a modified schedule.";
        throw new Error(conflictBanner);
      }

      const headers = buildOperationHeaders("acceptAdaptation", {
        idempotencyKey: options.idempotencyKey,
      });

      const acceptedWaiverIds =
        options.acceptedWaiverIds ??
        proposal.proposed_waivers.map((waiver) => waiver.waiver_id);

      status = "accepted";
      conflictBanner = null;

      return {
        method: "POST",
        path: `/v1/curricula/${encodeURIComponent(proposal.curriculum_id)}/adaptations/${encodeURIComponent(proposal.proposal_id)}/accept`,
        headers,
        body: {
          expected_proposal_sha256: expectedSha,
          expected_base_revision_id: expectedBaseRevision,
          expected_base_schedule_revision_id: expectedScheduleRevision,
          base_curriculum_revision_id: expectedBaseRevision,
          base_schedule_revision_id: expectedScheduleRevision,
          accepted_waiver_ids: [...acceptedWaiverIds],
        },
      };
    },

    handleAdaptationConflict(statusCode: number, message?: string) {
      if (statusCode !== 409 && statusCode !== 412) {
        throw new Error(
          `Expected 409 Conflict or 412 Precondition Failed, got ${statusCode}`
        );
      }
      status = "superseded";
      conflictBanner =
        message ??
        "This adaptation proposal is stale because the underlying curriculum or schedule revision changed. Please refresh the proposal preview.";
      return computeDiffModel();
    },
  };
}
