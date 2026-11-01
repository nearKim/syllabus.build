import type { CatalogResourceMetadataInput } from "@syllabus/ui";
import {
  goalTitleOf,
  type ActiveSyllabus,
  type MarketplaceListing,
} from "../ExploreMarketplace.tsx";
import type { SyllabusDraft, DraftResource } from "../../liveDraft.ts";
import { foldAccents, TFIDF_ENGINE } from "../../tfidfIndex.ts";
import {
  DEFAULT_SUBJECT_GOAL_PLACEHOLDERS,
  DEFAULT_SUBJECT_TOPICS,
  DESIGNATED_AI_MODELS,
  type IntakeDepthChoice,
  type IntakeFitMode,
  type IntakeFlowChoice,
  type IntakeMaterialsChoice,
  type IntakeSubject,
} from "./taxonomy.ts";
import {
  buildIndexedMaterialCandidates,
  type ExistingPlanFitCandidate,
  type IndexedCatalogResource,
  type IntakePipelineExecutionReceipt,
  type IntakeResourceFitEvaluation,
  type TopicCoverageItem,
} from "./indexing.ts";

export function evaluateIntakeResourceFit(params: {
  readonly goalTitle: string;
  readonly subject: IntakeSubject;
  readonly requestedTopics: readonly string[];
  readonly depth: IntakeDepthChoice;
  readonly flowOrder: IntakeFlowChoice;
  readonly materialsAccess: IntakeMaterialsChoice;
  readonly weeklyMinutes: number;
  readonly fitMode: IntakeFitMode;
  readonly selectedResourceIds: readonly string[];
  readonly skippedResourceIds: readonly string[];
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly myPlans: readonly ActiveSyllabus[];
  readonly marketplaceListings: readonly MarketplaceListing[];
}): IntakeResourceFitEvaluation {
  const {
    goalTitle,
    subject,
    requestedTopics,
    depth,
    flowOrder,
    materialsAccess,
    weeklyMinutes,
    fitMode,
    selectedResourceIds,
    skippedResourceIds,
    catalogResources,
    myPlans,
    marketplaceListings,
  } = params;

  const effectiveTopics: readonly string[] =
    requestedTopics.length > 0 ? requestedTopics : DEFAULT_SUBJECT_TOPICS[subject].slice(0, 4);

  const existingPlans: ExistingPlanFitCandidate[] = [];
  const seenTitles = new Set<string>();

  for (const plan of myPlans) {
    const title = goalTitleOf(plan.syllabus);
    const rawTags = Array.isArray(plan.syllabus["topic_tags"]) ? (plan.syllabus["topic_tags"] as string[]) : [];
    const matchedTopics = effectiveTopics.filter((req) =>
      rawTags.some((tag) => tag.toLowerCase() === req.toLowerCase()),
    );
    if (plan.domain === subject || matchedTopics.length > 0) {
      seenTitles.add(title.toLowerCase());
      existingPlans.push({
        id: `plan-${plan.syllabusId}`,
        kind: "my_plan",
        syllabusId: plan.syllabusId,
        publicationId: plan.publicationId,
        title,
        subject: plan.domain,
        gateStyle: plan.assessmentMode,
        handle: "In your plans",
        matchedTopics,
        totalRequestedTopics: effectiveTopics.length,
      });
    }
  }

  for (const listing of marketplaceListings) {
    const title = goalTitleOf(listing.syllabus);
    if (seenTitles.has(title.toLowerCase())) continue;
    const matchedTopics = effectiveTopics.filter((req) =>
      listing.topicTags.some((tag) => tag.toLowerCase() === req.toLowerCase()),
    );
    if (listing.subject === subject || matchedTopics.length > 0) {
      existingPlans.push({
        id: `pub-${listing.publicationId}`,
        kind: "marketplace",
        syllabusId: null,
        publicationId: listing.publicationId,
        title,
        subject: listing.subject,
        gateStyle: listing.gateStyle,
        handle: listing.handle,
        matchedTopics,
        totalRequestedTopics: effectiveTopics.length,
      });
    }
  }

  const catalogCandidates = buildIndexedMaterialCandidates(catalogResources, subject, effectiveTopics, materialsAccess, goalTitle);
  const activeCatalogIds = selectedResourceIds.filter((id) => !skippedResourceIds.includes(id));
  const selectedCatalogMaterials = catalogCandidates.filter((item) =>
    activeCatalogIds.includes(item.resourceVersionId),
  );

  const topicCoverage: TopicCoverageItem[] = effectiveTopics.map((topic) => {
    const lower = topic.toLowerCase();
    const coveringIds = selectedCatalogMaterials
      .filter((mat) => mat.coveredTopics.some((t) => t.toLowerCase() === lower))
      .map((mat) => mat.resourceVersionId);
    if (coveringIds.length > 0) {
      return { topic, status: "covered", coveredByResourceIds: coveringIds };
    }
    const partialIds = selectedCatalogMaterials
      .filter((mat) => mat.partialTopics.some((t) => t.toLowerCase() === lower))
      .map((mat) => mat.resourceVersionId);
    if (partialIds.length > 0) {
      return { topic, status: "partial", coveredByResourceIds: partialIds };
    }
    return { topic, status: "missing", coveredByResourceIds: [] };
  });

  const coveredCount = topicCoverage.filter((c) => c.status === "covered").length;
  const partialCount = topicCoverage.filter((c) => c.status === "partial").length;
  const missingCount = topicCoverage.filter((c) => c.status === "missing").length;

  const deltaTopicsToSearch =
    fitMode === "use_selected_only"
      ? []
      : topicCoverage.filter((c) => c.status !== "covered").map((c) => c.topic);

  // Web results are unknown until the search runs, so the tray lists only indexed resources.
  const webSearchRequired = fitMode === "fill_gaps" && deltaTopicsToSearch.length > 0;
  const indexedMaterials = catalogCandidates;
  const activeSelectedIds = selectedCatalogMaterials.map((item) => item.resourceVersionId);
  const selectedMaterials = selectedCatalogMaterials;

  const bypassedCanonicalUrls = Object.values(catalogResources)
    .map((r) => r.canonical_url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  const costAndBypassBadge = webSearchRequired
    ? `Web search: ${deltaTopicsToSearch.join(", ")}`
    : `No web search · ${selectedMaterials.length} selected`;

  const effectiveGoalTitle = goalTitle.trim() || DEFAULT_SUBJECT_GOAL_PLACEHOLDERS[subject];
  const searchPrompt = [
    `GOAL: ${effectiveGoalTitle}`,
    `SUBJECT: ${subject} | DEPTH: ${depth} | FLOW: ${flowOrder} | PACE: ${weeklyMinutes}m/wk | ACCESS: ${materialsAccess}`,
    `REQUESTED_TOPICS: ${effectiveTopics.join(", ") || "general foundations"}`,
    `REUSED_INDEXED_RESOURCES: ${selectedMaterials.map((m) => `${m.resourceVersionId} (${m.category})`).join(", ") || "none"}`,
    `SKIPPED_RESOURCES: ${skippedResourceIds.join(", ") || "none"}`,
    `DELTA_WEB_SEARCH_TOPICS: ${webSearchRequired ? deltaTopicsToSearch.join(", ") : "NONE (web search bypassed)"}`,
    `BYPASSED_CANONICAL_URLS: ${bypassedCanonicalUrls.length} indexed URLs excluded`,
  ].join("\n");

  return {
    existingPlans: existingPlans.slice(0, 3),
    indexedMaterials,
    selectedResourceIds: activeSelectedIds,
    skippedResourceIds,
    topicCoverage,
    coveredCount,
    partialCount,
    missingCount,
    deltaTopicsToSearch,
    bypassedCanonicalUrls,
    searchPrompt,
    costAndBypassBadge,
    webSearchRequired,
  };
}

// The deterministic draft used when no live model call ran. It keeps the seeded attention and retrieval text.
export function fixtureDraft(subject: IntakeSubject, requestedTopics: readonly string[], deltaTopics: readonly string[], summary: string): SyllabusDraft {
  const first = requestedTopics[0] ?? subject;
  return {
    summary,
    modules: [
      {
        title: `Module 1: ${first} & Mathematical Foundations`,
        summary: "Core representations, $\\frac{1}{\\sqrt{d_k}}$ variance scaling, and reused catalog anchors.",
        objective: {
          title: `Master core ${first} representations and scaling laws`,
          description:
            "Connect subword sequence representations to scaled dot-product attention $\\mathrm{Attention}(Q,K,V) = \\operatorname{softmax}\\!\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$.",
          successCriterion: "Derive variance stabilization $\\mathrm{Var}(q \\cdot k) = 1$ and verify tensor shapes on unseen inputs.",
        },
        read: {
          title: `Read: ${first} Foundations & Scaling Laws`,
          prompt: "Derive why scaling dot products by $\\frac{1}{\\sqrt{d_k}}$ preserves unit variance $\\mathrm{Var}(q \\cdot k) = 1$.",
        },
        practice: {
          title: "Worked Example: Softmax Jacobian & Attention Weights",
          prompt:
            "Compute $\\mathrm{Attention}(Q,K,V) = \\operatorname{softmax}\\!\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$ for a $2 \\times 2$ toy query-key matrix.",
        },
        checkpoint: {
          title: "Checkpoint 1: Representation & Scaling Verification",
          prompt: "Verify attention scaling and subword sequence bounds before unlocking Module 2.",
        },
      },
      {
        title: `Module 2: ${deltaTopics.join(" & ") || requestedTopics.slice(1).join(" & ") || "Synthesis & Evaluation"}`,
        summary: "Indexed book chapters, video syllabus walkthroughs, and $\\mathrm{Recall}@k$ evaluation.",
        objective: {
          title: `Implement and evaluate ${requestedTopics.slice(1).join(" & ") || "retrieval & synthesis"}`,
          description:
            "Evaluate retrieval quality via $\\mathrm{Recall}@k = \\frac{|R_k \\cap G|}{|G|}$ and grounded generation faithfulness.",
          successCriterion: "Achieve deterministic recall and faithfulness thresholds across the benchmark test suite.",
        },
        read: {
          title: `Read: ${deltaTopics[0] ?? "Retrieval"} & Recall Bounds`,
          prompt:
            "Analyze why top-$k$ retrieval recall $\\mathrm{Recall}@k = \\frac{|R_k \\cap G|}{|G|}$ bounds downstream answer faithfulness.",
        },
        practice: {
          title: "Code Lab: Index Construction & Recall@k Harness",
          prompt: "Implement the retrieval evaluator and verify $\\mathrm{Recall}@k \\ge 0.85$ on the test split.",
        },
        checkpoint: {
          title: "Checkpoint 2: End-to-End Evaluation & Synthesis Gate",
          prompt: "Compute $\\mathrm{Recall}@k$ and diagnose ungrounded synthesis spans.",
        },
      },
    ],
    resources: [],
  };
}

// The fixture provider's web search: two fixed resources for the uncovered topics.
export function fixtureDiscoveries(subject: IntakeSubject, deltaTopics: readonly string[], handle: string): Record<string, IndexedCatalogResource> {
  const access = {
    model: "free",
    tier_label: "Free",
    cost_label: "$0",
    rights_label: "Link & metadata",
    certificate_included: false,
    optional_certificate_price_minor: null,
    access_verified_at: "2026-10-23T12:00:00Z",
  };
  const vectorIndex = {
    status: "indexed",
    index_type: TFIDF_ENGINE,
    discovered_by: "AI Web Search",
    discovered_by_handle: handle,
    last_indexed_at: "2026-10-23T12:00:00Z",
  };
  const shared = {
    captured_at: "2026-10-23T12:00:00Z",
    subject,
    topics: [...deltaTopics],
    access,
    ingestion_permissions: { basis: "link_and_metadata_only", permissions: { display_excerpts: "denied" } },
    vector_index: vectorIndex,
  };
  return {
    "discovered-book-hnsw-vector-v1": {
      ...shared,
      resource_version_id: "discovered-book-hnsw-vector-v1",
      title: `Book: Approximate Nearest Neighbor & HNSW Vector Indexing (${deltaTopics[0] ?? subject})`,
      canonical_url: "https://example.invalid/catalog/hnsw-vector-indexing-book",
      category: "Book",
      provider: { provider_id: "open-ml-press", display_name: "Open ML Press · Indexed Book TOC & Summary" },
      segments: [
        { segment_id: "seg-hnsw-ch1", title: "Ch. 1: Navigable Small World Graphs & Recall@k Bounds", verified: true },
        { segment_id: "seg-hnsw-ch2", title: "Ch. 2: Product Quantization & Memory-Bounded Search", verified: true },
      ],
    },
    "discovered-youtube-rag-eval-playlist-v1": {
      ...shared,
      resource_version_id: "discovered-youtube-rag-eval-playlist-v1",
      title: "YouTube Playlist: RAG Triad Evaluation, Faithfulness & Context Recall Walkthrough",
      canonical_url: "https://example.invalid/catalog/youtube-rag-evaluation-playlist",
      category: "YouTube",
      provider: { provider_id: "ai-eval-youtube", display_name: "AI Evaluation Lab · YouTube Syllabus & Transcript" },
      segments: [
        { segment_id: "seg-yt-eval-1", title: "06:20 — Deriving Context Recall $\\mathrm{Recall}@k = \\frac{|R_k \\cap G|}{|G|}$", verified: true },
        { segment_id: "seg-yt-eval-2", title: "18:05 — Faithfulness & Groundedness Scoring Rubrics", verified: true },
      ],
    },
  };
}

// A short stable id suffix for a URL (32-bit FNV-1a), so the same URL always maps to the same resource id.
export function urlHash(url: string): string {
  let hash = 0x811c9dc5;
  for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return (hash >>> 0).toString(36);
}

// A resource the live model found, as a catalog record. Its access is the model's claim until a curator verifies it.
export function discoveredCatalogEntry(
  resource: DraftResource,
  subject: IntakeSubject,
  handle: string,
  now: string,
): readonly [string, IndexedCatalogResource] {
  const slug = foldAccents(resource.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  const id = `discovered-${slug}-${urlHash(resource.url)}`;
  return [
    id,
    {
      resource_version_id: id,
      title: resource.title,
      canonical_url: resource.url,
      captured_at: now,
      category: resource.category,
      subject,
      topics: resource.topics,
      provider: { provider_id: new URL(resource.url).hostname, display_name: `${resource.publisher} · Web search` },
      access: { model: "free", tier_label: "Free", cost_label: "$0", rights_label: "Link & metadata", certificate_included: false, optional_certificate_price_minor: null },
      ingestion_permissions: { basis: "link_and_metadata_only", permissions: { display_excerpts: "denied" } },
      vector_index: { status: "indexed", index_type: TFIDF_ENGINE, discovered_by: "AI Web Search", discovered_by_handle: handle, last_indexed_at: now },
      segments: resource.sections.map((title, i) => ({ segment_id: `${id}-s${i + 1}`, title, verified: false })),
    },
  ];
}

const DURATION_ZERO = { media_minutes: 0, reading_minutes: 0, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0 };

function duration(
  minutes: Partial<typeof DURATION_ZERO>,
  lower: Partial<typeof DURATION_ZERO>,
  upper: Partial<typeof DURATION_ZERO>,
): Record<string, unknown> {
  return {
    ...DURATION_ZERO,
    ...minutes,
    lower_bounds: { ...DURATION_ZERO, ...lower },
    upper_bounds: { ...DURATION_ZERO, ...upper },
    range_interpretation: "planning_bounds_not_confidence_interval",
  };
}

function assignment(resourceVersionId: string, selectionRationale: string): Record<string, unknown> {
  return { resource_version_id: resourceVersionId, role: "primary", segment_ids: [], selection_rationale: selectionRationale };
}

export function executeIntakeGenerationPipeline(params: {
  readonly fitEvaluation: IntakeResourceFitEvaluation;
  readonly goalTitle: string;
  readonly subject: IntakeSubject;
  readonly requestedTopics: readonly string[];
  readonly depth: IntakeDepthChoice;
  readonly flowOrder: IntakeFlowChoice;
  readonly materialsAccess: IntakeMaterialsChoice;
  readonly weeklyMinutes: number;
  readonly fitMode: IntakeFitMode;
  readonly accountId: string;
  readonly handle: string;
  readonly catalogResources: Readonly<Record<string, IndexedCatalogResource>>;
  readonly designatedProviderId: string;
  readonly designatedModelId: string;
  // The plan's sequence among this learner's generated plans. It keeps plan, module, and activity ids unique.
  readonly sequence: number;
  // The live model's draft. Without one, the deterministic fixture provider writes the plan.
  readonly liveDraft: SyllabusDraft | null;
  readonly now: string;
}): {
  readonly generatedPlan: ActiveSyllabus;
  readonly updatedCatalogResources: Readonly<Record<string, IndexedCatalogResource>>;
  readonly receipt: IntakePipelineExecutionReceipt;
} {
  const {
    fitEvaluation,
    goalTitle,
    subject,
    requestedTopics,
    depth,
    flowOrder,
    weeklyMinutes,
    fitMode,
    accountId,
    handle,
    catalogResources,
    designatedProviderId,
    designatedModelId,
    sequence,
    liveDraft,
    now,
  } = params;

  const nextCatalog: Record<string, IndexedCatalogResource> = { ...catalogResources };
  const newlyIndexedResourceIds: string[] = [];
  const knownUrls = new Set(fitEvaluation.bypassedCanonicalUrls);

  // Step 2 & Step 4: Fill Gaps searches the web for the uncovered topics, skips indexed URLs, and indexes what it finds.
  // Adding a record to the catalog is the whole indexing step: the TF-IDF index rebuilds from the new catalog object.
  const discovered: readonly (readonly [string, IndexedCatalogResource])[] = liveDraft
    ? liveDraft.resources.map((resource) => discoveredCatalogEntry(resource, subject, handle, now))
    : fitEvaluation.webSearchRequired
      ? Object.entries(fixtureDiscoveries(subject, fitEvaluation.deltaTopicsToSearch, handle))
      : [];
  for (const [id, entry] of discovered) {
    if (nextCatalog[id] || knownUrls.has(entry.canonical_url ?? "")) continue;
    nextCatalog[id] = entry;
    knownUrls.add(entry.canonical_url ?? "");
    newlyIndexedResourceIds.push(id);
  }

  const reusedIds =
    fitEvaluation.selectedResourceIds.length > 0
      ? fitEvaluation.selectedResourceIds
      : ["synthetic-resource-tokenization-v1"];
  const primaryResId = reusedIds[0] ?? "synthetic-resource-tokenization-v1";
  const secondaryResId =
    newlyIndexedResourceIds[0] ?? reusedIds[1] ?? primaryResId;
  const videoResId =
    newlyIndexedResourceIds[1] ??
    reusedIds.find((id) => id.includes("youtube")) ??
    secondaryResId;

  const effectiveTopics: readonly string[] =
    requestedTopics.length > 0 ? requestedTopics : DEFAULT_SUBJECT_TOPICS[subject].slice(0, 4);
  const effectiveTitle = goalTitle.trim() || DEFAULT_SUBJECT_GOAL_PLACEHOLDERS[subject];
  const key = `ai-generated-${String(sequence).padStart(3, "0")}`;
  const generatedSyllabusId = `syllabus-${key}`;
  const revisionId = `revision-${key}-v1`;
  const gateStyle =
    subject === "Systems"
      ? "Code Lab Gate"
      : subject === "Mathematics" || subject === "Physics"
        ? "Problem Set Gate"
        : "Reviewed Quiz";
  const draft =
    liveDraft ??
    fixtureDraft(
      subject,
      requestedTopics,
      fitEvaluation.deltaTopicsToSearch,
      `Generated via ${fitMode === "use_selected_only" ? "selected indexed materials only (0 web searches)" : "hybrid catalog reuse + delta web search"} with ${depth} mathematical depth.`,
    );
  const [module1, module2] = draft.modules;
  // Engineering and Systems practise in code. Other subjects practise on a worked example.
  const codes = subject === "Engineering" || subject === "Systems";
  const id = (name: string) => `${key}-${name}`;

  const generatedSyllabus: Record<string, unknown> = {
    schema_version: "0.2.0",
    syllabus_id: generatedSyllabusId,
    revision_id: revisionId,
    revision_number: 1,
    predecessor_revision_id: null,
    account_id: accountId,
    created_at: now,
    revision_reason: "initial_generation",
    subject,
    gate_style: gateStyle,
    topic_tags: [...effectiveTopics],
    goal: {
      title: effectiveTitle,
      summary: draft.summary,
      included_topics: [...effectiveTopics],
      excluded_topics: [...fitEvaluation.skippedResourceIds],
      scope_note: fitEvaluation.costAndBypassBadge,
    },
    language: "en",
    sequence_preference_applied: flowOrder,
    instruction_preferences_applied: {
      math_depth: depth,
      topic_math_depth_overrides: [],
      known_material_review: "skip_if_demonstrated",
    },
    objectives: [module1, module2].map((mod, i) => ({
      objective_id: id(`objective-${i + 1}`),
      objective_version_id: id(`objective-${i + 1}-v1`),
      topic_id: id(`topic-${i + 1}`),
      title: mod.objective.title,
      description: mod.objective.description,
      success_criterion: mod.objective.successCriterion,
      level: i === 0 ? "applied" : "advanced",
      requirement_level: "required",
      assessment_activity_ids: [id(`act-gate-${i + 1}`)],
      prior_evidence_refs: [],
    })),
    prerequisite_edges: [{ from_objective_id: id("objective-1"), to_objective_id: id("objective-2") }],
    modules: [
      {
        module_id: id("module-1"),
        title: module1.title,
        summary: module1.summary,
        requirement_level: "required",
        prerequisite_module_ids: [],
        objective_ids: [id("objective-1")],
        activity_ids: [id("act-theory-1"), id("act-example-1"), id("act-gate-1")],
      },
      {
        module_id: id("module-2"),
        title: module2.title,
        summary: module2.summary,
        requirement_level: "required",
        prerequisite_module_ids: [id("module-1")],
        objective_ids: [id("objective-2")],
        activity_ids: [id("act-theory-2"), id("act-practice-2"), id("act-gate-2")],
      },
    ],
    activities: [
      {
        activity_id: id("act-theory-1"),
        type: "theory",
        title: module1.read.title,
        requirement_level: "required",
        objective_ids: [id("objective-1")],
        prerequisite_activity_ids: [],
        resource_assignments: [assignment(primaryResId, "Reused directly from existing indexed catalog (bypassed web search).")],
        duration_estimate: duration({ reading_minutes: 20 }, { reading_minutes: 15 }, { reading_minutes: 30 }),
        content: { study_prompt: module1.read.prompt },
      },
      {
        activity_id: id("act-example-1"),
        type: "worked_example",
        title: module1.practice.title,
        requirement_level: "required",
        objective_ids: [id("objective-1")],
        prerequisite_activity_ids: [id("act-theory-1")],
        resource_assignments: [assignment(videoResId, "Indexed YouTube syllabus walkthrough with timestamped transcript.")],
        duration_estimate: duration(
          { media_minutes: 15, reading_minutes: 5, practice_minutes: 10 },
          { media_minutes: 12, reading_minutes: 4, practice_minutes: 8 },
          { media_minutes: 20, reading_minutes: 8, practice_minutes: 15 },
        ),
        content: { example_prompt: module1.practice.prompt },
      },
      {
        activity_id: id("act-gate-1"),
        type: "quiz",
        title: module1.checkpoint.title,
        requirement_level: "required",
        mastery_gated: true,
        objective_ids: [id("objective-1")],
        prerequisite_activity_ids: [id("act-example-1")],
        resource_assignments: [assignment(primaryResId, "Formative checkpoint anchored to indexed reference.")],
        duration_estimate: duration({ assessment_minutes: 15 }, { assessment_minutes: 10 }, { assessment_minutes: 20 }),
        content: { assessment_prompt: module1.checkpoint.prompt },
      },
      {
        activity_id: id("act-theory-2"),
        type: "theory",
        title: module2.read.title,
        requirement_level: "required",
        objective_ids: [id("objective-2")],
        prerequisite_activity_ids: [id("act-gate-1")],
        resource_assignments: [
          assignment(
            secondaryResId,
            newlyIndexedResourceIds.includes(secondaryResId)
              ? "Newly discovered via delta web search and indexed into the catalog."
              : "Reused from selected indexed catalog materials.",
          ),
        ],
        duration_estimate: duration({ reading_minutes: 25 }, { reading_minutes: 20 }, { reading_minutes: 35 }),
        content: { study_prompt: module2.read.prompt },
      },
      {
        activity_id: id("act-practice-2"),
        type: codes ? "coding" : "worked_example",
        title: module2.practice.title,
        requirement_level: "required",
        objective_ids: [id("objective-2")],
        prerequisite_activity_ids: [id("act-theory-2")],
        resource_assignments: [assignment(secondaryResId, "Hands-on implementation and evaluation harness.")],
        duration_estimate: duration(
          { reading_minutes: 5, practice_minutes: 25 },
          { reading_minutes: 4, practice_minutes: 20 },
          { reading_minutes: 8, practice_minutes: 35 },
        ),
        content: codes
          ? {
              task_prompt: module2.practice.prompt,
              deliverable_description: module2.objective.successCriterion,
              assessment_ref: null,
              execution_mode: "external",
            }
          : { example_prompt: module2.practice.prompt },
      },
      {
        activity_id: id("act-gate-2"),
        type: "quiz",
        title: module2.checkpoint.title,
        requirement_level: "required",
        mastery_gated: true,
        objective_ids: [id("objective-2")],
        prerequisite_activity_ids: [id("act-practice-2")],
        resource_assignments: [assignment(videoResId, "Anchored to evaluation rubric.")],
        duration_estimate: duration({ assessment_minutes: 15 }, { assessment_minutes: 10 }, { assessment_minutes: 20 }),
        content: { assessment_prompt: module2.checkpoint.prompt },
      },
    ],
    certification_options: [],
  };

  const generatedSchedule: Record<string, unknown> = {
    schedule_id: `schedule-${key}`,
    schedule_revision_id: `schedule-revision-${key}`,
    version: 1,
    syllabus_revision_id: revisionId,
    timezone: "America/New_York",
    weekly_minutes: weeklyMinutes,
    sessions: [
      {
        session_id: id("session-1"),
        start_at: "2026-10-27T18:00:00-04:00",
        duration_minutes: 65,
        activity_ids: [id("act-theory-1"), id("act-example-1"), id("act-gate-1")],
        reminder_enabled: true,
      },
      {
        session_id: id("session-2"),
        start_at: "2026-10-29T18:00:00-04:00",
        duration_minutes: 70,
        activity_ids: [id("act-theory-2"), id("act-practice-2"), id("act-gate-2")],
        reminder_enabled: true,
      },
    ],
    generated_at: now,
  };

  const generatedPlan: ActiveSyllabus = {
    syllabusId: generatedSyllabusId,
    domain: subject,
    assessmentMode: gateStyle,
    syllabus: generatedSyllabus,
    schedule: generatedSchedule,
    publicationId: null,
    draft: true,
  };

  const matchedModelOption = DESIGNATED_AI_MODELS.find(
    (opt) => opt.providerId === designatedProviderId && opt.modelId === designatedModelId,
  );
  const modelDescriptor = matchedModelOption
    ? `${matchedModelOption.providerLabel} · ${matchedModelOption.modelLabel}`
    : `${designatedProviderId} · ${designatedModelId}`;
  const writer = liveDraft
    ? `Live draft from ${modelDescriptor}`
    : `Fixture draft, no model call: the server has no API key for ${modelDescriptor}`;
  const webSearchExecuted = fitEvaluation.webSearchRequired;

  const summaryNote = webSearchExecuted
    ? `${writer}. Reused ${reusedIds.length} indexed resource(s), searched the web for [${fitEvaluation.deltaTopicsToSearch.join(", ")}] (skipping ${fitEvaluation.bypassedCanonicalUrls.length} indexed URLs), and indexed ${newlyIndexedResourceIds.length} new resource(s) into Resources.`
    : `${writer}. Built from ${reusedIds.length} selected indexed resource(s) with 0 web searches.`;

  return {
    generatedPlan,
    updatedCatalogResources: nextCatalog,
    receipt: {
      searchPrompt: fitEvaluation.searchPrompt,
      fitMode,
      webSearchExecuted,
      searchedDeltaTopics: fitEvaluation.deltaTopicsToSearch,
      bypassedCanonicalUrls: fitEvaluation.bypassedCanonicalUrls,
      reusedResourceIds: reusedIds,
      newlyIndexedResourceIds,
      generatedSyllabusId,
      designatedProviderId,
      designatedModelId,
      liveDraft: liveDraft !== null,
      summaryNote,
    },
  };
}
