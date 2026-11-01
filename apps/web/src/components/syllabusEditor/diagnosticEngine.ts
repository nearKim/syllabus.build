import type {
  AdaptationProposalFixture,
  DiagnosticSessionFixture,
  ProficiencyProfileFixture,
} from "../../diagnosticsAndAdaptation.ts";
import { asRecord, normalizeStringList, rawListOf } from "../../shared.ts";
import { humanize } from "../StudyFlowBoard.tsx";
import {
  activityMinutesOfRaw,
  buildContentForActivityType,
  buildDurationEstimateForType,
  bumpSyllabusRevision,
} from "./astMutations.ts";

export interface ProficiencyOverrideEntry {
  readonly status: "demonstrated" | "in_progress" | "unverified";
  readonly evidenceRef: string;
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
