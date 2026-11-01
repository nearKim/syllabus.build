import { buildOperationHeaders } from "@syllabus/api-client";
import { resolveSurfaceStyle, type ResolvedSurfaceStyle as SurfaceStyle, type ThemeMode } from "@syllabus/ui";
import { normalizeStringList } from "./shared.ts";

export type ObjectiveEvidenceState = "demonstrated" | "in_progress" | "unverified" | "unknown";
export type TopicCoverageState = "demonstrated" | "partial" | "unassessed";

export interface ObjectiveEvidenceRecord {
  objective_id: string; objective_version_id: string; topic_id?: string;
  state: ObjectiveEvidenceState; status?: ObjectiveEvidenceState;
  qualifying_attempt_ids: string[]; evidence_refs?: string[]; UnverifiedReason?: string | null;
}

export interface TopicCoverageRecord {
  topic_id: string; coverage_state: TopicCoverageState; coverage_label?: TopicCoverageState;
  assessed_objective_version_ids?: string[]; unassessed_objective_version_ids?: string[];
  demonstrated_objective_count: number; total_objective_count: number;
}

export interface ProficiencyProfileFixture {
  profile_revision_id: string; learner_id?: string; account_id?: string;
  updated_at?: string; computed_at?: string;
  objective_evidence: Array<Partial<ObjectiveEvidenceRecord> & { objective_id: string; objective_version_id: string; [k: string]: unknown }>;
  topic_coverage: Array<Partial<TopicCoverageRecord> & { topic_id: string; [k: string]: unknown }>;
}

export interface DiagnosticSessionFixture {
  diagnostic_session_id: string; syllabus_id?: string; syllabus_revision_id?: string;
  state: "active" | "completed" | "stopped" | "abandoned";
  started_at?: string; stopped_at?: string | null;
  stop_reason?: "completed" | "learner_stopped" | "time_budget_reached" | "sufficient_evidence" | null;
  target_objective_version_ids: string[]; assessed_objective_version_ids: string[]; unassessed_objective_version_ids: string[];
  proficiency_snapshot_ref?: string | null;
}

export interface DiagnosticAttemptSubmissionInput {
  item_id: string; objective_version_id: string; objective_id?: string; topic_id?: string;
  attempt_id: string; selected_choice_id?: string; short_answer_text?: string; demonstrated: boolean;
}

export interface DiagnosticHttpRequest<TPayload> {
  method: "POST"; path: string; headers: Record<string, string>; body: TPayload;
}

export interface AdaptationChangeEntry {
  kind:
    | "waive_instruction" | "waive_node" | "add_bridge" | "add_foundation"
    | "add_node" | "reorder_node" | "reorder" | "adjust_depth" | "depth_adjusted";
  node_id?: string; activity_ids?: string[]; objective_version_id?: string; objective_version_ids?: string[];
  rationale?: string; reason?: string; qualifying_evidence_refs?: string[]; evidence_refs?: string[];
}

export interface ProposedWaiverEntry {
  waiver_id: string; objective_id?: string; objective_version_id: string; node_id?: string;
  criterion_policy_id?: string; qualifying_evidence_refs: string[]; rationale?: string; conditions_summary?: string;
}

export interface AdaptationImpactBlock {
  before_minutes: number; after_minutes: number; constraint_status: "feasible" | "infeasible";
  schedule_impact_summary?: string; inference_charge_summary?: string; warnings?: string[];
}

export interface AdaptationProposalFixture {
  proposal_id: string; syllabus_id: string; base_revision_id: string; candidate_revision_id: string;
  proficiency_snapshot_ref: string; proposal_sha256: string; base_schedule_revision_id?: string | null;
  status?: "pending" | "accepted" | "rejected" | "superseded" | "expired"; created_at?: string;
  instruction_preferences_applied?: { math_depth?: "intuitive" | "standard" | "formal"; [k: string]: unknown };
  changes: AdaptationChangeEntry[]; proposed_waivers: ProposedWaiverEntry[];
  impact: AdaptationImpactBlock; unassessed_objective_version_ids: string[];
}

export interface AdaptationDiffBuckets {
  added: AdaptationChangeEntry[]; waived: AdaptationChangeEntry[];
  reordered: AdaptationChangeEntry[]; depth_adjusted: AdaptationChangeEntry[];
}

export interface AcceptAdaptationRequestPayload {
  expected_proposal_sha256: string; expected_base_revision_id: string;
  expected_base_schedule_revision_id?: string | null; base_syllabus_revision_id: string;
  base_schedule_revision_id?: string | null; accepted_waiver_ids: string[];
}

export interface AcceptAdaptationOptions {
  idempotencyKey: string; expectedProposalSha256?: string; baseSyllabusRevisionId?: string;
  baseScheduleRevisionId?: string | null; acceptedWaiverIds?: string[];
}

export type { SurfaceStyle };

const inferObjectiveId = (versionId: string): string => versionId.replace(/-v\d+$/, "");
const inferTopicId = (objectiveId: string): string =>
  objectiveId.includes("matrix-calculus") ? "topic-matrix-calculus"
  : objectiveId.includes("matrix") || objectiveId.includes("linear-algebra") ? "topic-linear-algebra"
  : `topic-${objectiveId.replace(/^objective-/, "")}`;

function buildInitialObjectiveEvidence(
  session: DiagnosticSessionFixture,
  proficiency?: ProficiencyProfileFixture,
): ObjectiveEvidenceRecord[] {
  const byVersion = new Map<string, ObjectiveEvidenceRecord>();
  for (const record of proficiency?.objective_evidence ?? []) {
    const refs = normalizeStringList(record.qualifying_attempt_ids ?? record.evidence_refs);
    const resolvedState: ObjectiveEvidenceState = record.state ?? record.status ?? "unknown";
    byVersion.set(record.objective_version_id, {
      objective_id: record.objective_id, objective_version_id: record.objective_version_id,
      topic_id: record.topic_id ?? inferTopicId(record.objective_id),
      state: resolvedState, status: resolvedState,
      qualifying_attempt_ids: refs, evidence_refs: [...refs], UnverifiedReason: record.UnverifiedReason ?? null,
    });
  }

  const assessedSet = new Set(session.assessed_objective_version_ids);
  for (const versionId of session.target_objective_version_ids) {
    if (!byVersion.has(versionId)) {
      const objectiveId = inferObjectiveId(versionId);
      const isAssessed = assessedSet.has(versionId);
      const refs = isAssessed ? ["diagnostic-attempt-initial"] : [];
      const resolvedState: ObjectiveEvidenceState = isAssessed ? "demonstrated" : "unknown";
      byVersion.set(versionId, {
        objective_id: objectiveId, objective_version_id: versionId, topic_id: inferTopicId(objectiveId),
        state: resolvedState, status: resolvedState,
        qualifying_attempt_ids: refs, evidence_refs: [...refs],
        UnverifiedReason: isAssessed ? null : "unassessed_in_diagnostic",
      });
    }
  }
  return Array.from(byVersion.values());
}

type TopicCoverageSeed = Partial<TopicCoverageRecord> & { topic_id: string };

function recomputeTopicCoverage(
  objectiveEvidence: ObjectiveEvidenceRecord[],
  existingTopics: readonly TopicCoverageSeed[] = [],
): TopicCoverageRecord[] {
  const topicMeta = new Map<
    string,
    { demonstrated: number; assessedAny: boolean; total: number; assessedIds: string[]; unassessedIds: string[] }
  >();

  for (const existing of existingTopics) {
    const priorAssessed = normalizeStringList(existing.assessed_objective_version_ids);
    const priorUnassessed = normalizeStringList(existing.unassessed_objective_version_ids);
    const derivedTotal =
      typeof existing.total_objective_count === "number"
        ? existing.total_objective_count
        : Math.max(priorAssessed.length + priorUnassessed.length, 1);
    topicMeta.set(existing.topic_id, {
      demonstrated: 0, assessedAny: false, total: derivedTotal, assessedIds: priorAssessed, unassessedIds: priorUnassessed,
    });
  }

  const groupedByTopic = new Map<string, ObjectiveEvidenceRecord[]>();
  for (const record of objectiveEvidence) {
    const topicId = record.topic_id ?? inferTopicId(record.objective_id);
    const list = groupedByTopic.get(topicId) ?? [];
    list.push(record);
    groupedByTopic.set(topicId, list);
  }

  for (const [topicId, records] of groupedByTopic.entries()) {
    const prior = topicMeta.get(topicId);
    const demonstrated = records.filter((item) => item.state === "demonstrated").length;
    const assessedAny = records.some((item) => item.state === "demonstrated" || item.state === "in_progress");
    const totalCount = Math.max(prior?.total ?? 0, records.length, 1);
    const assessedIds = records.filter((r) => r.state === "demonstrated" || r.state === "in_progress").map((r) => r.objective_version_id);
    const unassessedIds = records.filter((r) => r.state === "unknown" || r.state === "unverified").map((r) => r.objective_version_id);
    for (const extra of prior?.unassessedIds ?? []) {
      if (!assessedIds.includes(extra) && !unassessedIds.includes(extra)) unassessedIds.push(extra);
    }
    topicMeta.set(topicId, {
      demonstrated, assessedAny, total: Math.max(totalCount, assessedIds.length + unassessedIds.length), assessedIds, unassessedIds,
    });
  }

  return Array.from(topicMeta.entries()).map(([topicId, counts]) => {
    const coverageState: TopicCoverageState =
      counts.demonstrated >= counts.total && counts.total > 0 && counts.unassessedIds.length === 0
        ? "demonstrated"
        : counts.demonstrated > 0 || counts.assessedAny ? "partial" : "unassessed";
    return {
      topic_id: topicId, coverage_state: coverageState, coverage_label: coverageState,
      assessed_objective_version_ids: counts.assessedIds, unassessed_objective_version_ids: counts.unassessedIds,
      demonstrated_objective_count: counts.demonstrated, total_objective_count: counts.total,
    };
  });
}

export function createDiagnosticFlowController(
  initialSession: DiagnosticSessionFixture,
  initialProficiency?: ProficiencyProfileFixture,
  mode: ThemeMode = "light",
) {
  const surfaceStyle = resolveSurfaceStyle("assessment", { themePreference: mode });
  const syllabusId = initialSession.syllabus_id ?? "syllabus-formal-synthetic";
  const syllabusRevisionId = initialSession.syllabus_revision_id ?? "formal-plan-before";

  let state = initialSession.state;
  let stopReason: DiagnosticSessionFixture["stop_reason"] = initialSession.stop_reason ?? null;
  const targetIds = [...initialSession.target_objective_version_ids];
  const assessedSet = new Set(initialSession.assessed_objective_version_ids);
  const unassessedSet = new Set(
    initialSession.unassessed_objective_version_ids.length > 0
      ? initialSession.unassessed_objective_version_ids
      : targetIds.filter((id) => !assessedSet.has(id)),
  );

  let objectiveEvidence = buildInitialObjectiveEvidence(initialSession, initialProficiency);
  let topicCoverage = recomputeTopicCoverage(objectiveEvidence, initialProficiency?.topic_coverage ?? []);

  const snapshot = () => {
    const assessed = targetIds.filter((id) => assessedSet.has(id));
    const unassessed = targetIds.filter((id) => !assessedSet.has(id));
    unassessedSet.clear();
    unassessed.forEach((id) => unassessedSet.add(id));

    return {
      diagnostic_session_id: initialSession.diagnostic_session_id,
      syllabus_id: syllabusId, syllabus_revision_id: syllabusRevisionId,
      state, stop_reason: stopReason,
      target_objective_version_ids: [...targetIds],
      assessed_objective_version_ids: assessed, unassessed_objective_version_ids: unassessed,
      proficiency_snapshot_ref: initialSession.proficiency_snapshot_ref ?? initialProficiency?.profile_revision_id ?? null,
      objective_evidence: objectiveEvidence.map((entry) => ({
        ...entry,
        qualifying_attempt_ids: [...entry.qualifying_attempt_ids],
        evidence_refs: [...(entry.evidence_refs ?? entry.qualifying_attempt_ids)],
      })),
      topic_coverage: topicCoverage.map((entry) => ({ ...entry })),
      surfaceStyle,
    };
  };

  function stopDiagnostic(
    reason: "learner_stopped" | "time_budget_reached" | "sufficient_evidence" = "learner_stopped",
  ): DiagnosticHttpRequest<{ stop_reason: "learner_stopped" | "time_budget_reached" | "sufficient_evidence" }> {
    state = "stopped";
    stopReason = reason;
    objectiveEvidence = objectiveEvidence.map((entry) =>
      assessedSet.has(entry.objective_version_id)
        ? entry
        : {
            ...entry, state: "unknown", status: "unknown",
            qualifying_attempt_ids: [], evidence_refs: [], UnverifiedReason: "unassessed_in_diagnostic",
          },
    );
    topicCoverage = recomputeTopicCoverage(objectiveEvidence, initialProficiency?.topic_coverage ?? topicCoverage);
    return {
      method: "POST",
      path: `/v1/diagnostics/${encodeURIComponent(initialSession.diagnostic_session_id)}/stop`,
      headers: buildOperationHeaders("stopDiagnostic"),
      body: { stop_reason: reason },
    };
  }

  return {
    getState: snapshot,
    buildStartDiagnosticRequest: (
      input: { target_topic_ids?: string[]; max_duration_minutes?: number } = {},
    ): DiagnosticHttpRequest<{ syllabus_revision_id: string; target_topic_ids?: string[]; max_duration_minutes?: number }> => ({
      method: "POST",
      path: `/v1/syllabi/${encodeURIComponent(syllabusId)}/diagnostics`,
      headers: buildOperationHeaders("startDiagnostic"),
      body: {
        syllabus_revision_id: syllabusRevisionId,
        ...(input.target_topic_ids ? { target_topic_ids: [...input.target_topic_ids] } : {}),
        ...(input.max_duration_minutes !== undefined ? { max_duration_minutes: input.max_duration_minutes } : {}),
      },
    }),
    submitDiagnosticAttempt(input: DiagnosticAttemptSubmissionInput): DiagnosticHttpRequest<{
      item_id: string; objective_version_id: string; selected_choice_id?: string; short_answer_text?: string;
    }> {
      if (state !== "active") throw new Error(`Cannot submit diagnostic attempt when session is in state "${state}".`);
      assessedSet.add(input.objective_version_id);
      unassessedSet.delete(input.objective_version_id);

      const objectiveId = input.objective_id ?? inferObjectiveId(input.objective_version_id);
      const topicId = input.topic_id ?? inferTopicId(objectiveId);
      const nextState: ObjectiveEvidenceState = input.demonstrated ? "demonstrated" : "in_progress";

      let found = false;
      objectiveEvidence = objectiveEvidence.map((entry) => {
        if (entry.objective_version_id !== input.objective_version_id) return entry;
        found = true;
        const nextAttempts = entry.qualifying_attempt_ids.includes(input.attempt_id)
          ? [...entry.qualifying_attempt_ids]
          : [...entry.qualifying_attempt_ids, input.attempt_id];
        const refs = input.demonstrated ? nextAttempts : [];
        return {
          ...entry, topic_id: entry.topic_id ?? topicId, state: nextState, status: nextState,
          qualifying_attempt_ids: refs, evidence_refs: [...refs],
          UnverifiedReason: input.demonstrated ? null : "incorrect_diagnostic_attempt",
        };
      });

      if (!found) {
        const refs = input.demonstrated ? [input.attempt_id] : [];
        objectiveEvidence.push({
          objective_id: objectiveId, objective_version_id: input.objective_version_id, topic_id: topicId,
          state: nextState, status: nextState, qualifying_attempt_ids: refs, evidence_refs: [...refs],
          UnverifiedReason: input.demonstrated ? null : "incorrect_diagnostic_attempt",
        });
      }

      topicCoverage = recomputeTopicCoverage(objectiveEvidence, initialProficiency?.topic_coverage ?? topicCoverage);
      if (unassessedSet.size === 0) {
        state = "completed";
        stopReason = "completed";
      }

      return {
        method: "POST",
        path: `/v1/diagnostics/${encodeURIComponent(initialSession.diagnostic_session_id)}/attempts`,
        headers: buildOperationHeaders("submitDiagnosticAttempt"),
        body: {
          item_id: input.item_id, objective_version_id: input.objective_version_id,
          ...(input.selected_choice_id ? { selected_choice_id: input.selected_choice_id } : {}),
          ...(input.short_answer_text ? { short_answer_text: input.short_answer_text } : {}),
        },
      };
    },
    stopDiagnostic,
    stopEarly: stopDiagnostic,
  };
}
export type DiagnosticSessionController = ReturnType<typeof createDiagnosticFlowController>;
export type DiagnosticSessionModel = ReturnType<DiagnosticSessionController["getState"]>;

export function createAdaptationDiffController(proposal: AdaptationProposalFixture, mode: ThemeMode = "light") {
  const surfaceStyle = resolveSurfaceStyle("evidence", { themePreference: mode });
  let status: NonNullable<AdaptationProposalFixture["status"]> = proposal.status ?? "pending";
  let conflictBanner: string | null = null;

  const computeDiffModel = () => {
    const buckets: AdaptationDiffBuckets = { added: [], waived: [], reordered: [], depth_adjusted: [] };
    for (const change of proposal.changes) {
      const refs = change.qualifying_evidence_refs ?? change.evidence_refs ?? [];
      const cloned: AdaptationChangeEntry = {
        ...change,
        node_id: change.node_id ?? change.activity_ids?.[0] ?? "unknown-node",
        rationale: change.rationale ?? change.reason ?? "",
        qualifying_evidence_refs: [...refs], evidence_refs: [...refs],
      };
      if (change.kind === "add_bridge" || change.kind === "add_foundation" || change.kind === "add_node") buckets.added.push(cloned);
      else if (change.kind === "waive_instruction" || change.kind === "waive_node") buckets.waived.push(cloned);
      else if (change.kind === "reorder_node" || change.kind === "reorder") buckets.reordered.push(cloned);
      else if (change.kind === "adjust_depth" || change.kind === "depth_adjusted") buckets.depth_adjusted.push(cloned);
    }

    const waivers = proposal.proposed_waivers.map((waiver) => {
      const refs = normalizeStringList(waiver.qualifying_evidence_refs);
      return {
        waiver_id: waiver.waiver_id,
        node_id: waiver.node_id ?? waiver.objective_id ?? waiver.objective_version_id,
        objective_version_id: waiver.objective_version_id,
        qualifying_evidence_refs: refs,
        hasValidEvidence: refs.length > 0,
        rationale: waiver.rationale ?? waiver.conditions_summary ?? "Demonstrated via reviewed anchor evidence.",
      };
    });

    const waivedChangesHaveEvidence = buckets.waived.every(
      (change) => Array.isArray(change.qualifying_evidence_refs) && change.qualifying_evidence_refs.length > 0,
    );

    return {
      proposal_id: proposal.proposal_id, syllabus_id: proposal.syllabus_id,
      base_revision_id: proposal.base_revision_id, candidate_revision_id: proposal.candidate_revision_id,
      base_schedule_revision_id: proposal.base_schedule_revision_id ?? null,
      proficiency_snapshot_ref: proposal.proficiency_snapshot_ref,
      proposal_sha256: proposal.proposal_sha256, status,
      preserved_math_depth: proposal.instruction_preferences_applied?.math_depth ?? null,
      buckets, waivers,
      allWaiversHaveEvidence: waivers.every((w) => w.hasValidEvidence) && waivedChangesHaveEvidence,
      unassessed_objective_version_ids: [...proposal.unassessed_objective_version_ids],
      impact: { ...proposal.impact, delta_minutes: proposal.impact.after_minutes - proposal.impact.before_minutes },
      conflictBanner, surfaceStyle,
    };
  };

  const failConflict = (msg: string): never => {
    status = "superseded";
    conflictBanner = msg;
    throw new Error(msg);
  };

  return {
    getDiffModel: computeDiffModel,
    buildAcceptAdaptationRequest(options: AcceptAdaptationOptions): DiagnosticHttpRequest<AcceptAdaptationRequestPayload> {
      const diffModel = computeDiffModel();
      if (!diffModel.allWaiversHaveEvidence) {
        throw new Error(
          "Cannot accept adaptation proposal: every proposed waiver must cite at least one qualifying reviewed-anchor evidence ref.",
        );
      }

      const expectedSha = options.expectedProposalSha256 ?? proposal.proposal_sha256;
      const expectedBaseRevision = options.baseSyllabusRevisionId ?? proposal.base_revision_id;
      const expectedScheduleRevision =
        options.baseScheduleRevisionId !== undefined ? options.baseScheduleRevisionId : (proposal.base_schedule_revision_id ?? null);

      if (expectedSha !== proposal.proposal_sha256) {
        failConflict("Adaptation proposal checksum mismatch: the proposal changed since preview.");
      }
      if (expectedBaseRevision !== proposal.base_revision_id) {
        failConflict("Stale syllabus base revision: cannot apply adaptation against a modified plan.");
      }
      if (proposal.base_schedule_revision_id && expectedScheduleRevision !== proposal.base_schedule_revision_id) {
        failConflict("Stale schedule base revision: cannot apply adaptation against a modified schedule.");
      }

      const headers = buildOperationHeaders("acceptAdaptation", { idempotencyKey: options.idempotencyKey });
      const acceptedWaiverIds = options.acceptedWaiverIds ?? proposal.proposed_waivers.map((w) => w.waiver_id);

      status = "accepted";
      conflictBanner = null;

      return {
        method: "POST",
        path: `/v1/syllabi/${encodeURIComponent(proposal.syllabus_id)}/adaptations/${encodeURIComponent(proposal.proposal_id)}/accept`,
        headers,
        body: {
          expected_proposal_sha256: expectedSha,
          expected_base_revision_id: expectedBaseRevision,
          expected_base_schedule_revision_id: expectedScheduleRevision,
          base_syllabus_revision_id: expectedBaseRevision,
          base_schedule_revision_id: expectedScheduleRevision,
          accepted_waiver_ids: [...acceptedWaiverIds],
        },
      };
    },
    handleAdaptationConflict(statusCode: number, message?: string) {
      if (statusCode !== 409 && statusCode !== 412) {
        throw new Error(`Expected 409 Conflict or 412 Precondition Failed, got ${statusCode}`);
      }
      status = "superseded";
      conflictBanner =
        message ??
        "This adaptation proposal is stale because the underlying syllabus or schedule revision changed. Please refresh the proposal preview.";
      return computeDiffModel();
    },
  };
}
export type AdaptationDiffController = ReturnType<typeof createAdaptationDiffController>;
export type AdaptationDiffModel = ReturnType<AdaptationDiffController["getDiffModel"]>;
export type ValidatedWaiverSummary = AdaptationDiffModel["waivers"][number];
