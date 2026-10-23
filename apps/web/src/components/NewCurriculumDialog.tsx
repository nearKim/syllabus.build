import type { VNode } from "preact";
import type { CatalogResourceMetadataInput } from "../../../../packages/ui/src/index.ts";
import {
  goalTitleOf,
  type ActiveCurriculum,
  type MarketplaceListing,
} from "./ExploreMarketplace.tsx";
import { SfIcon, type SfIconName } from "./Icons.tsx";
import { MathText } from "./MathText.tsx";
import { categoryIcon, classifyResourceCategory, type ResourceCategory } from "./ResourcesView.tsx";

const SUBJECT_ICON_MAP: Readonly<Record<string, SfIconName>> = {
  Engineering: "engineering",
  Mathematics: "math",
  Physics: "physics",
  Literature: "literature",
  Systems: "systems",
};

function subjectIcon(subject: string): SfIconName {
  return SUBJECT_ICON_MAP[subject] ?? "learn";
}

export const INTAKE_SUBJECTS = ["Engineering", "Systems", "Mathematics", "Physics", "Literature"] as const;
export type IntakeSubject = (typeof INTAKE_SUBJECTS)[number];

export const INTAKE_DEPTH_CHOICES = ["intuitive", "applied", "formal"] as const;
export type IntakeDepthChoice = (typeof INTAKE_DEPTH_CHOICES)[number];

export const INTAKE_FLOW_CHOICES = ["theory_first", "application_first", "balanced"] as const;
export type IntakeFlowChoice = (typeof INTAKE_FLOW_CHOICES)[number];

export const INTAKE_MATERIALS_CHOICES = ["free_only", "paid_allowed"] as const;
export type IntakeMaterialsChoice = (typeof INTAKE_MATERIALS_CHOICES)[number];

export const INTAKE_FIT_MODES = ["fill_gaps", "use_selected_only"] as const;
export type IntakeFitMode = (typeof INTAKE_FIT_MODES)[number];

export const DEFAULT_SUBJECT_TOPICS: Readonly<Record<IntakeSubject, readonly string[]>> = {
  Engineering: ["Python", "RAG", "Attention", "Vector Indexing", "Linear Algebra", "Evaluation"],
  Systems: ["Rust", "Async", "Concurrency", "Wakers", "Work Stealing"],
  Mathematics: ["Linear Algebra", "Eigenvalues", "SVD", "Matrix Calculus"],
  Physics: ["Thermodynamics", "Ensembles", "Phase Transitions", "Ising Model"],
  Literature: ["Tolstoy", "Realism", "Narrative", "Comparative Close Reading"],
};

export const DEFAULT_SUBJECT_GOAL_PLACEHOLDERS: Readonly<Record<IntakeSubject, string>> = {
  Engineering: "Build and Evaluate RAG Systems in Python",
  Systems: "Build an Async Rust Runtime and Work-Stealing Executor",
  Mathematics: "Master Spectral Methods, SVD, and Matrix Calculus",
  Physics: "Statistical Mechanics, Ensembles, and Phase Transitions",
  Literature: "Comparative Close Reading of Tolstoy's Major Novels",
};

export type PolymorphicResourceIndex =
  | {
      readonly kind: "book";
      readonly isbn13: string;
      readonly briefSummary: string;
      readonly tocChapters: readonly { readonly number: string; readonly title: string; readonly summary: string }[];
    }
  | {
      readonly kind: "youtube_playlist";
      readonly channelTitle: string;
      readonly transcriptAvailable: boolean;
      readonly syllabusVideos: readonly {
        readonly timestampOrIndex: string;
        readonly title: string;
        readonly transcriptSummary: string;
      }[];
    }
  | {
      readonly kind: "course";
      readonly institution: string;
      readonly syllabusModules: readonly { readonly unit: string; readonly title: string }[];
    }
  | {
      readonly kind: "code_lab";
      readonly runtimeLanguage: string;
      readonly labExercises: readonly { readonly id: string; readonly title: string; readonly testCommand: string }[];
    };

export interface IndexedMaterialCandidate {
  readonly resourceVersionId: string;
  readonly title: string;
  readonly publisher: string;
  readonly canonicalUrl: string;
  readonly accessModel: string;
  readonly category: Exclude<ResourceCategory, "All">;
  readonly subject: IntakeSubject;
  readonly coveredTopics: readonly string[];
  readonly partialTopics: readonly string[];
  readonly polymorphicIndex: PolymorphicResourceIndex;
}

export type TopicCoverageState = "covered" | "partial" | "missing";

export interface TopicCoverageItem {
  readonly topic: string;
  readonly status: TopicCoverageState;
  readonly coveredByResourceIds: readonly string[];
}

export interface ExistingPlanFitCandidate {
  readonly id: string;
  readonly kind: "my_plan" | "marketplace";
  readonly curriculumId: string | null;
  readonly publicationId: string | null;
  readonly title: string;
  readonly subject: string;
  readonly gateStyle: string;
  readonly handle: string;
  readonly matchedTopics: readonly string[];
  readonly totalRequestedTopics: number;
}

export interface IntakeResourceFitEvaluation {
  readonly existingPlans: readonly ExistingPlanFitCandidate[];
  readonly indexedMaterials: readonly IndexedMaterialCandidate[];
  readonly selectedResourceIds: readonly string[];
  readonly skippedResourceIds: readonly string[];
  readonly topicCoverage: readonly TopicCoverageItem[];
  readonly coveredCount: number;
  readonly partialCount: number;
  readonly missingCount: number;
  readonly deltaTopicsToSearch: readonly string[];
  readonly bypassedCanonicalUrls: readonly string[];
  readonly searchPrompt: string;
  readonly costAndBypassBadge: string;
  readonly webSearchRequired: boolean;
}

export interface IntakePipelineExecutionReceipt {
  readonly searchPrompt: string;
  readonly fitMode: IntakeFitMode;
  readonly webSearchExecuted: boolean;
  readonly searchedDeltaTopics: readonly string[];
  readonly bypassedCanonicalUrls: readonly string[];
  readonly reusedResourceIds: readonly string[];
  readonly newlyIndexedResourceIds: readonly string[];
  readonly generatedCurriculumId: string;
  readonly summaryNote: string;
}

const POLYMORPHIC_INDEX_CATALOG: Readonly<
  Record<
    string,
    {
      readonly subject: IntakeSubject;
      readonly coveredTopics: readonly string[];
      readonly partialTopics: readonly string[];
      readonly polymorphicIndex: PolymorphicResourceIndex;
    }
  >
> = {
  "synthetic-resource-tokenization-v1": {
    subject: "Engineering",
    coveredTopics: ["Python", "RAG", "Attention"],
    partialTopics: ["Linear Algebra"],
    polymorphicIndex: {
      kind: "book",
      isbn13: "978-0-262-04912-2",
      briefSummary:
        "Curator-verified monograph covering BPE/Unigram subword segmentation, sequence packing, and transformer embedding pipelines.",
      tocChapters: [
        { number: "Ch. 1", title: "Byte-Pair Encoding & Unigram Likelihood", summary: "Merge tables and subword entropy." },
        { number: "Ch. 2", title: "Sequence Packing & Context Windows", summary: "Padding-free batching for RAG chunks." },
        { number: "Ch. 3", title: "Dot-Product Attention Foundations", summary: "Query-Key-Value projections in Python." },
      ],
    },
  },
  "synthetic-resource-attention-youtube-v1": {
    subject: "Engineering",
    coveredTopics: ["Attention", "Linear Algebra"],
    partialTopics: ["Matrix Calculus"],
    polymorphicIndex: {
      kind: "youtube_playlist",
      channelTitle: "AI Engineering Channel · YouTube",
      transcriptAvailable: true,
      syllabusVideos: [
        {
          timestampOrIndex: "04:15",
          title: "Why unscaled dot products grow with $d_k$",
          transcriptSummary: "Transcript derives $\\mathrm{Var}(q \\cdot k) = d_k$ and softmax saturation.",
        },
        {
          timestampOrIndex: "14:50",
          title: "Softmax Jacobian & Backward Pass Walkthrough",
          transcriptSummary: "Step-by-step matrix gradient check for multi-head attention.",
        },
      ],
    },
  },
  "synthetic-resource-rag-lab-repo-v1": {
    subject: "Engineering",
    coveredTopics: ["Python", "RAG"],
    partialTopics: ["Evaluation"],
    polymorphicIndex: {
      kind: "code_lab",
      runtimeLanguage: "Python 3.12",
      labExercises: [
        { id: "lab-bpe", title: "Reversible BPE Tokenizer & Chunk Aligner", testCommand: "pytest tests/test_tokenizer.py" },
        { id: "lab-sram", title: "FlashAttention Tiling & Latency Harness", testCommand: "pytest tests/test_attention_lab.py" },
      ],
    },
  },
  "synthetic-resource-cert-prep-v1": {
    subject: "Engineering",
    coveredTopics: ["Python"],
    partialTopics: ["RAG", "Evaluation"],
    polymorphicIndex: {
      kind: "course",
      institution: "Systems AI Institute",
      syllabusModules: [
        { unit: "Unit 1", title: "Sequence Modeling & Retrieval Foundations" },
        { unit: "Unit 2", title: "Production Evaluation & Optional Certification Track" },
      ],
    },
  },
  "synthetic-resource-rust-async-book-v1": {
    subject: "Systems",
    coveredTopics: ["Rust", "Async", "Concurrency", "Wakers"],
    partialTopics: ["Work Stealing"],
    polymorphicIndex: {
      kind: "book",
      isbn13: "978-1-718-50310-6",
      briefSummary: "Deep systems guide to Rust's Future trait, Pin, RawWaker vtables, and epoll reactors.",
      tocChapters: [
        { number: "Ch. 2", title: "Futures, Pinning, and Poll State Machines", summary: "Self-referential generator layout." },
        { number: "Ch. 3", title: "Wakers and RawWakerVTable", summary: "Zero-allocation task wakeups." },
        { number: "Ch. 5", title: "Reactors and I/O Readiness with epoll", summary: "Non-blocking event loop integration." },
      ],
    },
  },
  "synthetic-resource-rust-lab-v1": {
    subject: "Systems",
    coveredTopics: ["Rust", "Async", "Wakers", "Work Stealing"],
    partialTopics: [],
    polymorphicIndex: {
      kind: "code_lab",
      runtimeLanguage: "Rust 2024",
      labExercises: [
        { id: "lab-exec", title: "Lab 1: Single-Threaded Executor", testCommand: "cargo test -p executor_lab" },
        { id: "lab-timer", title: "Lab 2: Hashed Timer Wheel & Work Stealing", testCommand: "cargo test -p timer_wheel_lab" },
      ],
    },
  },
  "synthetic-resource-la-notes-v1": {
    subject: "Mathematics",
    coveredTopics: ["Linear Algebra", "Eigenvalues", "SVD"],
    partialTopics: ["Matrix Calculus"],
    polymorphicIndex: {
      kind: "book",
      isbn13: "978-0-980-23277-6",
      briefSummary: "Open monograph on spectral theory, orthogonal projections, and the singular value decomposition.",
      tocChapters: [
        { number: "Ch. 6", title: "Eigenvalues, Eigenvectors, and Diagonalization", summary: "Spectral theorem $A = Q\\Lambda Q^T$." },
        { number: "Ch. 7", title: "The Singular Value Decomposition", summary: "Eckart–Young low-rank approximation." },
      ],
    },
  },
  "synthetic-resource-strang-youtube-v1": {
    subject: "Mathematics",
    coveredTopics: ["Linear Algebra", "Eigenvalues"],
    partialTopics: ["SVD"],
    polymorphicIndex: {
      kind: "youtube_playlist",
      channelTitle: "MIT OpenCourseWare · YouTube",
      transcriptAvailable: true,
      syllabusVideos: [
        {
          timestampOrIndex: "12:40",
          title: "Projection Matrices and Least Squares",
          transcriptSummary: "Derives $P = A(A^T A)^{-1}A^T$ and orthogonal error vectors.",
        },
      ],
    },
  },
  "synthetic-resource-statmech-notes-v1": {
    subject: "Physics",
    coveredTopics: ["Thermodynamics", "Ensembles", "Phase Transitions", "Ising Model"],
    partialTopics: [],
    polymorphicIndex: {
      kind: "book",
      isbn13: "978-0-521-87342-0",
      briefSummary: "Open lecture notes deriving canonical partition functions, free energy, and the Ising phase transition.",
      tocChapters: [
        { number: "Ch. 2", title: "Microcanonical and Canonical Ensembles", summary: "Boltzmann factor $P_i = Z^{-1}e^{-\\beta E_i}$." },
        { number: "Ch. 5", title: "The Ising Model and Mean-Field Theory", summary: "Self-consistency $m = \\tanh(\\beta J z m)$." },
      ],
    },
  },
  "synthetic-resource-war-and-peace-v1": {
    subject: "Literature",
    coveredTopics: ["Tolstoy", "Realism", "Narrative"],
    partialTopics: ["Comparative Close Reading"],
    polymorphicIndex: {
      kind: "book",
      isbn13: "978-0-199-23276-5",
      briefSummary: "Louise and Aylmer Maude translation of War and Peace with historical philosophy essays.",
      tocChapters: [
        { number: "Book 3", title: "Austerlitz & Battlefield Consciousness", summary: "Prince Andrei's sky at Austerlitz." },
        { number: "Book 9", title: "What Causes a Historical Event", summary: "Tolstoy's critique of great-man historiography." },
      ],
    },
  },
};

export function buildIndexedMaterialCandidates(
  catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>,
  subject: IntakeSubject,
  requestedTopics: readonly string[],
  materialsAccess: IntakeMaterialsChoice,
): readonly IndexedMaterialCandidate[] {
  const normTopics = requestedTopics.map((t) => t.toLowerCase());
  const candidates: IndexedMaterialCandidate[] = [];

  for (const [resourceVersionId, raw] of Object.entries(catalogResources)) {
    const accessModel = raw.access?.model ?? "free";
    if (materialsAccess === "free_only" && accessModel !== "free" && accessModel !== "library_loan") {
      continue;
    }
    const meta = POLYMORPHIC_INDEX_CATALOG[resourceVersionId];
    if (!meta && !resourceVersionId.startsWith("discovered-")) continue;
    const category = classifyResourceCategory(
      resourceVersionId,
      raw.title ?? resourceVersionId,
      raw.provider?.display_name ?? "",
    );
    const candidateSubject: IntakeSubject = meta?.subject ?? subject;
    const coveredTopics = meta?.coveredTopics ?? [];
    const partialTopics = meta?.partialTopics ?? [];

    const matchesSubject = candidateSubject === subject;
    const matchesAnyTopic =
      coveredTopics.some((t) => normTopics.includes(t.toLowerCase())) ||
      partialTopics.some((t) => normTopics.includes(t.toLowerCase()));

    if (!matchesSubject && !matchesAnyTopic) continue;

    const fallbackIndex: PolymorphicResourceIndex =
      category === "YouTube"
        ? {
            kind: "youtube_playlist",
            channelTitle: raw.provider?.display_name ?? "Verified YouTube Channel",
            transcriptAvailable: true,
            syllabusVideos: (raw.segments ?? []).map((seg, i) => ({
              timestampOrIndex: `Video ${i + 1}`,
              title: seg.title ?? `Video ${i + 1}`,
              transcriptSummary: "Verified segment transcript indexed in catalog.",
            })),
          }
        : {
            kind: "book",
            isbn13: "978-0-000-00000-0",
            briefSummary: `Curator-verified ${category.toLowerCase()} from ${raw.provider?.display_name ?? "Catalog"}.`,
            tocChapters: (raw.segments ?? []).map((seg, i) => ({
              number: `Sec. ${i + 1}`,
              title: seg.title ?? `Section ${i + 1}`,
              summary: "Verified catalog section.",
            })),
          };

    candidates.push({
      resourceVersionId,
      title: raw.title ?? resourceVersionId,
      publisher: raw.provider?.display_name ?? "Verified Publisher",
      canonicalUrl: raw.canonical_url ?? `https://example.invalid/catalog/${resourceVersionId}`,
      accessModel,
      category,
      subject: candidateSubject,
      coveredTopics,
      partialTopics,
      polymorphicIndex: meta?.polymorphicIndex ?? fallbackIndex,
    });
  }

  return candidates;
}

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
  readonly myPlans: readonly ActiveCurriculum[];
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
    const title = goalTitleOf(plan.curriculum);
    const rawTags = Array.isArray(plan.curriculum["topic_tags"]) ? (plan.curriculum["topic_tags"] as string[]) : [];
    const matchedTopics = effectiveTopics.filter((req) =>
      rawTags.some((tag) => tag.toLowerCase() === req.toLowerCase()),
    );
    if (plan.domain === subject || matchedTopics.length > 0) {
      seenTitles.add(title.toLowerCase());
      existingPlans.push({
        id: `plan-${plan.curriculumId}`,
        kind: "my_plan",
        curriculumId: plan.curriculumId,
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
    const title = goalTitleOf(listing.curriculum);
    if (seenTitles.has(title.toLowerCase())) continue;
    const matchedTopics = effectiveTopics.filter((req) =>
      listing.topicTags.some((tag) => tag.toLowerCase() === req.toLowerCase()),
    );
    if (listing.subject === subject || matchedTopics.length > 0) {
      existingPlans.push({
        id: `pub-${listing.publicationId}`,
        kind: "marketplace",
        curriculumId: null,
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

  const indexedMaterials = buildIndexedMaterialCandidates(catalogResources, subject, effectiveTopics, materialsAccess);
  const activeSelectedIds = selectedResourceIds.filter((id) => !skippedResourceIds.includes(id));
  const selectedMaterials = indexedMaterials.filter((item) => activeSelectedIds.includes(item.resourceVersionId));

  const topicCoverage: TopicCoverageItem[] = effectiveTopics.map((topic) => {
    const lower = topic.toLowerCase();
    const coveringIds = selectedMaterials
      .filter((mat) => mat.coveredTopics.some((t) => t.toLowerCase() === lower))
      .map((mat) => mat.resourceVersionId);
    if (coveringIds.length > 0) {
      return { topic, status: "covered", coveredByResourceIds: coveringIds };
    }
    const partialIds = selectedMaterials
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

  const bypassedCanonicalUrls = Object.values(catalogResources)
    .map((r) => r.canonical_url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  const webSearchRequired = fitMode === "fill_gaps" && deltaTopicsToSearch.length > 0;
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
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
}): {
  readonly generatedPlan: ActiveCurriculum;
  readonly updatedCatalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
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
    catalogResources,
  } = params;

  const nextCatalog: Record<string, CatalogResourceMetadataInput> = { ...catalogResources };
  const newlyIndexedResourceIds: string[] = [];

  // Step 2 & Step 4: If Fill Gaps mode has uncovered topics, run delta web search (bypassing indexed URLs)
  // and index the newly discovered Book (TOC + summary) and YouTube Playlist (syllabus + transcript) into DB.
  if (fitEvaluation.webSearchRequired) {
    const bookId = "discovered-book-hnsw-vector-v1";
    const bookUrl = "https://example.invalid/catalog/hnsw-vector-indexing-book";
    if (!fitEvaluation.bypassedCanonicalUrls.includes(bookUrl) && !nextCatalog[bookId]) {
      nextCatalog[bookId] = {
        resource_version_id: bookId,
        title: `Book: Approximate Nearest Neighbor & HNSW Vector Indexing (${fitEvaluation.deltaTopicsToSearch[0] ?? subject})`,
        canonical_url: bookUrl,
        captured_at: "2026-10-23T12:00:00Z",
        provider: { provider_id: "open-ml-press", display_name: "Open ML Press · Indexed Book TOC & Summary" },
        access: { model: "free", certificate_included: false, access_verified_at: "2026-10-23T12:00:00Z" },
        ingestion_permissions: { basis: "link_and_metadata_only", permissions: { display_excerpts: "denied" } },
        segments: [
          { segment_id: "seg-hnsw-ch1", title: "Ch. 1: Navigable Small World Graphs & Recall@k Bounds", verified: true },
          { segment_id: "seg-hnsw-ch2", title: "Ch. 2: Product Quantization & Memory-Bounded Search", verified: true },
        ],
      };
      newlyIndexedResourceIds.push(bookId);
    }

    const ytId = "discovered-youtube-rag-eval-playlist-v1";
    const ytUrl = "https://example.invalid/catalog/youtube-rag-evaluation-playlist";
    if (!fitEvaluation.bypassedCanonicalUrls.includes(ytUrl) && !nextCatalog[ytId]) {
      nextCatalog[ytId] = {
        resource_version_id: ytId,
        title: "YouTube Playlist: RAG Triad Evaluation, Faithfulness & Context Recall Walkthrough",
        canonical_url: ytUrl,
        captured_at: "2026-10-23T12:00:00Z",
        provider: { provider_id: "ai-eval-youtube", display_name: "AI Evaluation Lab · YouTube Syllabus & Transcript" },
        access: { model: "free", certificate_included: false, access_verified_at: "2026-10-23T12:00:00Z" },
        ingestion_permissions: { basis: "link_and_metadata_only", permissions: { display_excerpts: "denied" } },
        segments: [
          { segment_id: "seg-yt-eval-1", title: "06:20 — Deriving Context Recall $\\mathrm{Recall}@k = \\frac{|R_k \\cap G|}{|G|}$", verified: true },
          { segment_id: "seg-yt-eval-2", title: "18:05 — Faithfulness & Groundedness Scoring Rubrics", verified: true },
        ],
      };
      newlyIndexedResourceIds.push(ytId);
    }
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
  const generatedCurriculumId = "curriculum-ai-generated-001";
  const gateStyle =
    subject === "Systems"
      ? "Code Lab Gate"
      : subject === "Mathematics" || subject === "Physics"
        ? "Problem Set Gate"
        : "Reviewed Quiz";

  const generatedCurriculum: Record<string, unknown> = {
    schema_version: "0.2.0",
    curriculum_id: generatedCurriculumId,
    revision_id: "revision-ai-generated-v1",
    revision_number: 1,
    predecessor_revision_id: null,
    account_id: accountId,
    created_at: "2026-10-23T12:00:00Z",
    revision_reason: "initial_generation",
    subject,
    gate_style: gateStyle,
    topic_tags: [...effectiveTopics],
    goal: {
      title: effectiveTitle,
      summary: `Generated via ${fitMode === "use_selected_only" ? "selected indexed materials only (0 web searches)" : "hybrid catalog reuse + delta web search"} with ${depth} mathematical depth.`,
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
    objectives: [
      {
        objective_id: "objective-ai-foundations",
        objective_version_id: "objective-ai-foundations-v1",
        topic_id: "topic-ai-foundations",
        title: `Master core ${requestedTopics[0] ?? subject} representations and scaling laws`,
        description:
          "Connect subword sequence representations to scaled dot-product attention $\\mathrm{Attention}(Q,K,V) = \\operatorname{softmax}\\!\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$.",
        success_criterion:
          "Derive variance stabilization $\\mathrm{Var}(q \\cdot k) = 1$ and verify tensor shapes on unseen inputs.",
        level: "applied",
        requirement_level: "required",
        assessment_activity_ids: ["ai-act-gate-1"],
        prior_evidence_refs: [],
      },
      {
        objective_id: "objective-ai-synthesis",
        objective_version_id: "objective-ai-synthesis-v1",
        topic_id: "topic-ai-synthesis",
        title: `Implement and evaluate ${requestedTopics.slice(1).join(" & ") || "retrieval & synthesis"}`,
        description:
          "Evaluate retrieval quality via $\\mathrm{Recall}@k = \\frac{|R_k \\cap G|}{|G|}$ and grounded generation faithfulness.",
        success_criterion:
          "Achieve deterministic recall and faithfulness thresholds across the benchmark test suite.",
        level: "advanced",
        requirement_level: "required",
        assessment_activity_ids: ["ai-act-gate-2"],
        prior_evidence_refs: [],
      },
    ],
    prerequisite_edges: [
      { from_objective_id: "objective-ai-foundations", to_objective_id: "objective-ai-synthesis" },
    ],
    modules: [
      {
        module_id: "ai-module-1",
        title: `Module 1: ${requestedTopics[0] ?? subject} & Mathematical Foundations`,
        summary: "Core representations, $\\frac{1}{\\sqrt{d_k}}$ variance scaling, and reused catalog anchors.",
        requirement_level: "required",
        prerequisite_module_ids: [],
        objective_ids: ["objective-ai-foundations"],
        activity_ids: ["ai-act-theory-1", "ai-act-example-1", "ai-act-gate-1"],
      },
      {
        module_id: "ai-module-2",
        title: `Module 2: ${fitEvaluation.deltaTopicsToSearch.join(" & ") || requestedTopics.slice(1).join(" & ") || "Synthesis & Evaluation"}`,
        summary: "Indexed book chapters, video syllabus walkthroughs, and $\\mathrm{Recall}@k$ evaluation.",
        requirement_level: "required",
        prerequisite_module_ids: ["ai-module-1"],
        objective_ids: ["objective-ai-synthesis"],
        activity_ids: ["ai-act-theory-2", "ai-act-coding-2", "ai-act-gate-2"],
      },
    ],
    activities: [
      {
        activity_id: "ai-act-theory-1",
        type: "theory",
        title: `Read: ${requestedTopics[0] ?? subject} Foundations & Scaling Laws`,
        requirement_level: "required",
        objective_ids: ["objective-ai-foundations"],
        prerequisite_activity_ids: [],
        resource_assignments: [
          {
            resource_version_id: primaryResId,
            role: "primary",
            segment_ids: [],
            selection_rationale: "Reused directly from existing indexed catalog (bypassed web search).",
          },
        ],
        duration_estimate: {
          media_minutes: 0,
          reading_minutes: 20,
          practice_minutes: 0,
          assessment_minutes: 0,
          review_minutes: 0,
          lower_bounds: { media_minutes: 0, reading_minutes: 15, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0 },
          upper_bounds: { media_minutes: 0, reading_minutes: 30, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0 },
          range_interpretation: "planning_bounds_not_confidence_interval",
        },
        content: {
          study_prompt:
            "Derive why scaling dot products by $\\frac{1}{\\sqrt{d_k}}$ preserves unit variance $\\mathrm{Var}(q \\cdot k) = 1$.",
        },
      },
      {
        activity_id: "ai-act-example-1",
        type: "worked_example",
        title: "Worked Example: Softmax Jacobian & Attention Weights",
        requirement_level: "required",
        objective_ids: ["objective-ai-foundations"],
        prerequisite_activity_ids: ["ai-act-theory-1"],
        resource_assignments: [
          {
            resource_version_id: videoResId,
            role: "primary",
            segment_ids: [],
            selection_rationale: "Indexed YouTube syllabus walkthrough with timestamped transcript.",
          },
        ],
        duration_estimate: {
          media_minutes: 15,
          reading_minutes: 5,
          practice_minutes: 10,
          assessment_minutes: 0,
          review_minutes: 0,
          lower_bounds: { media_minutes: 12, reading_minutes: 4, practice_minutes: 8, assessment_minutes: 0, review_minutes: 0 },
          upper_bounds: { media_minutes: 20, reading_minutes: 8, practice_minutes: 15, assessment_minutes: 0, review_minutes: 0 },
          range_interpretation: "planning_bounds_not_confidence_interval",
        },
        content: {
          example_prompt:
            "Compute $\\mathrm{Attention}(Q,K,V) = \\operatorname{softmax}\\!\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$ for a $2 \\times 2$ toy query-key matrix.",
        },
      },
      {
        activity_id: "ai-act-gate-1",
        type: "quiz",
        title: "Checkpoint 1: Representation & Scaling Verification",
        requirement_level: "required",
        mastery_gated: true,
        objective_ids: ["objective-ai-foundations"],
        prerequisite_activity_ids: ["ai-act-example-1"],
        resource_assignments: [
          {
            resource_version_id: primaryResId,
            role: "primary",
            segment_ids: [],
            selection_rationale: "Formative checkpoint anchored to indexed reference.",
          },
        ],
        duration_estimate: {
          media_minutes: 0,
          reading_minutes: 0,
          practice_minutes: 0,
          assessment_minutes: 15,
          review_minutes: 0,
          lower_bounds: { media_minutes: 0, reading_minutes: 0, practice_minutes: 0, assessment_minutes: 10, review_minutes: 0 },
          upper_bounds: { media_minutes: 0, reading_minutes: 0, practice_minutes: 0, assessment_minutes: 20, review_minutes: 0 },
          range_interpretation: "planning_bounds_not_confidence_interval",
        },
        content: {
          assessment_prompt: "Verify attention scaling and subword sequence bounds before unlocking Module 2.",
        },
      },
      {
        activity_id: "ai-act-theory-2",
        type: "theory",
        title: `Read: ${fitEvaluation.deltaTopicsToSearch[0] ?? "Retrieval"} & Recall Bounds`,
        requirement_level: "required",
        objective_ids: ["objective-ai-synthesis"],
        prerequisite_activity_ids: ["ai-act-gate-1"],
        resource_assignments: [
          {
            resource_version_id: secondaryResId,
            role: "primary",
            segment_ids: [],
            selection_rationale: newlyIndexedResourceIds.includes(secondaryResId)
              ? "Newly discovered via delta web search and indexed with Book TOC & summary."
              : "Reused from selected indexed catalog materials.",
          },
        ],
        duration_estimate: {
          media_minutes: 0,
          reading_minutes: 25,
          practice_minutes: 0,
          assessment_minutes: 0,
          review_minutes: 0,
          lower_bounds: { media_minutes: 0, reading_minutes: 20, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0 },
          upper_bounds: { media_minutes: 0, reading_minutes: 35, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0 },
          range_interpretation: "planning_bounds_not_confidence_interval",
        },
        content: {
          study_prompt:
            "Analyze why top-$k$ retrieval recall $\\mathrm{Recall}@k = \\frac{|R_k \\cap G|}{|G|}$ bounds downstream answer faithfulness.",
        },
      },
      {
        activity_id: "ai-act-coding-2",
        type: "coding",
        title: "Code Lab: Index Construction & Recall@k Harness",
        requirement_level: "required",
        objective_ids: ["objective-ai-synthesis"],
        prerequisite_activity_ids: ["ai-act-theory-2"],
        resource_assignments: [
          {
            resource_version_id: secondaryResId,
            role: "primary",
            segment_ids: [],
            selection_rationale: "Hands-on implementation and evaluation harness.",
          },
        ],
        duration_estimate: {
          media_minutes: 0,
          reading_minutes: 5,
          practice_minutes: 25,
          assessment_minutes: 0,
          review_minutes: 0,
          lower_bounds: { media_minutes: 0, reading_minutes: 4, practice_minutes: 20, assessment_minutes: 0, review_minutes: 0 },
          upper_bounds: { media_minutes: 0, reading_minutes: 8, practice_minutes: 35, assessment_minutes: 0, review_minutes: 0 },
          range_interpretation: "planning_bounds_not_confidence_interval",
        },
        content: {
          task_prompt: "Implement the retrieval evaluator and verify $\\mathrm{Recall}@k \\ge 0.85$ on the test split.",
          deliverable_description: "Working index builder and evaluation script passing all recall assertions.",
          assessment_ref: null,
          execution_mode: "external",
        },
      },
      {
        activity_id: "ai-act-gate-2",
        type: "quiz",
        title: "Checkpoint 2: End-to-End Evaluation & Synthesis Gate",
        requirement_level: "required",
        mastery_gated: true,
        objective_ids: ["objective-ai-synthesis"],
        prerequisite_activity_ids: ["ai-act-coding-2"],
        resource_assignments: [
          {
            resource_version_id: videoResId,
            role: "primary",
            segment_ids: [],
            selection_rationale: "Anchored to evaluation rubric.",
          },
        ],
        duration_estimate: {
          media_minutes: 0,
          reading_minutes: 0,
          practice_minutes: 0,
          assessment_minutes: 15,
          review_minutes: 0,
          lower_bounds: { media_minutes: 0, reading_minutes: 0, practice_minutes: 0, assessment_minutes: 10, review_minutes: 0 },
          upper_bounds: { media_minutes: 0, reading_minutes: 0, practice_minutes: 0, assessment_minutes: 20, review_minutes: 0 },
          range_interpretation: "planning_bounds_not_confidence_interval",
        },
        content: {
          assessment_prompt: "Compute $\\mathrm{Recall}@k$ and diagnose ungrounded synthesis spans.",
        },
      },
    ],
    certification_options: [],
  };

  const generatedSchedule: Record<string, unknown> = {
    schedule_id: "schedule-ai-generated-1",
    schedule_revision_id: "schedule-revision-ai-generated-1",
    version: 1,
    curriculum_revision_id: "revision-ai-generated-v1",
    timezone: "America/New_York",
    weekly_minutes: weeklyMinutes,
    sessions: [
      {
        session_id: "ai-session-1",
        start_at: "2026-10-27T18:00:00-04:00",
        duration_minutes: 65,
        activity_ids: ["ai-act-theory-1", "ai-act-example-1", "ai-act-gate-1"],
        reminder_enabled: true,
      },
      {
        session_id: "ai-session-2",
        start_at: "2026-10-29T18:00:00-04:00",
        duration_minutes: 70,
        activity_ids: ["ai-act-theory-2", "ai-act-coding-2", "ai-act-gate-2"],
        reminder_enabled: true,
      },
    ],
    generated_at: "2026-10-23T12:00:00Z",
  };

  const generatedPlan: ActiveCurriculum = {
    curriculumId: generatedCurriculumId,
    domain: subject,
    assessmentMode: gateStyle,
    curriculum: generatedCurriculum,
    schedule: generatedSchedule,
    publicationId: null,
    draft: true,
  };

  const summaryNote = fitEvaluation.webSearchRequired
    ? `AI pipeline complete: Reused ${reusedIds.length} indexed resource(s), ran delta web search for [${fitEvaluation.deltaTopicsToSearch.join(", ")}] (bypassing ${fitEvaluation.bypassedCanonicalUrls.length} indexed URLs), and indexed ${newlyIndexedResourceIds.length} new resource(s) (Book TOC + YouTube syllabus) into Resources.`
    : `AI pipeline complete: Synthesized draft from ${reusedIds.length} selected indexed resource(s) with 0 web search calls.`;

  return {
    generatedPlan,
    updatedCatalogResources: nextCatalog,
    receipt: {
      searchPrompt: fitEvaluation.searchPrompt,
      fitMode,
      webSearchExecuted: fitEvaluation.webSearchRequired,
      searchedDeltaTopics: fitEvaluation.deltaTopicsToSearch,
      bypassedCanonicalUrls: fitEvaluation.bypassedCanonicalUrls,
      reusedResourceIds: reusedIds,
      newlyIndexedResourceIds,
      generatedCurriculumId,
      summaryNote,
    },
  };
}

function renderPolymorphicIndexDetails(index: PolymorphicResourceIndex): VNode {
  if (index.kind === "book") {
    return (
      <details class="intake-resource-index-details">
        <summary class="intake-index-summary">
          <SfIcon name="learn" size={15} />
          <span>Chapters ({index.tocChapters.length})</span>
        </summary>
        <div class="intake-index-body">
          <p class="meta-text">
            <code>{index.isbn13}</code> · {index.briefSummary}
          </p>
          <ul class="intake-index-list">
            {index.tocChapters.map((ch) => (
              <li key={ch.number}>
                <strong>
                  {ch.number}: <MathText text={ch.title} />
                </strong>{" "}
                — <MathText text={ch.summary} />
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }
  if (index.kind === "youtube_playlist") {
    return (
      <details class="intake-resource-index-details">
        <summary class="intake-index-summary">
          <SfIcon name="video" size={15} />
          <span>Videos ({index.syllabusVideos.length})</span>
        </summary>
        <div class="intake-index-body">
          <p class="meta-text">{index.channelTitle}</p>
          <ul class="intake-index-list">
            {index.syllabusVideos.map((vid) => (
              <li key={vid.timestampOrIndex}>
                <code>{vid.timestampOrIndex}</code>{" "}
                <strong>
                  <MathText text={vid.title} />
                </strong>{" "}
                — <MathText text={vid.transcriptSummary} />
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }
  if (index.kind === "code_lab") {
    return (
      <details class="intake-resource-index-details">
        <summary class="intake-index-summary">
          <SfIcon name="code" size={15} />
          <span>Exercises ({index.labExercises.length})</span>
        </summary>
        <div class="intake-index-body">
          <ul class="intake-index-list">
            {index.labExercises.map((ex) => (
              <li key={ex.id}>
                <strong>{ex.title}</strong> · <code>{ex.testCommand}</code>
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }
  return (
    <details class="intake-resource-index-details">
      <summary class="intake-index-summary">
        <SfIcon name="course" size={15} />
        <span>Units ({index.syllabusModules.length})</span>
      </summary>
      <div class="intake-index-body">
        <ul class="intake-index-list">
          {index.syllabusModules.map((mod) => (
            <li key={mod.unit}>
              <strong>{mod.unit}:</strong> {mod.title}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export interface NewCurriculumDialogProps {
  readonly open: boolean;
  readonly goalTitle: string;
  readonly subject: IntakeSubject;
  readonly requestedTopics: readonly string[];
  readonly depth: IntakeDepthChoice;
  readonly flowOrder: IntakeFlowChoice;
  readonly materialsAccess: IntakeMaterialsChoice;
  readonly weeklyMinutes: number;
  readonly fitMode: IntakeFitMode;
  readonly depthOverrideReset: boolean;
  readonly intakeNote: string | null;
  readonly fitEvaluation: IntakeResourceFitEvaluation;
  readonly lastPipelineReceipt: IntakePipelineExecutionReceipt | null;
}

export function NewCurriculumDialog({
  open,
  goalTitle,
  subject,
  requestedTopics,
  depth,
  flowOrder,
  materialsAccess,
  weeklyMinutes,
  fitMode,
  depthOverrideReset: _depthOverrideReset,
  intakeNote,
  fitEvaluation,
  lastPipelineReceipt,
}: NewCurriculumDialogProps): VNode {
  const availableTopics = DEFAULT_SUBJECT_TOPICS[subject];
  const unselectedTopics = availableTopics.filter((t) => !requestedTopics.includes(t));

  return (
    <dialog
      id="dialog-new-curriculum"
      closedby="any"
      aria-labelledby="dialog-new-curriculum-title"
      data-open={String(open)}
      data-intake-subject={subject}
      data-intake-fit-mode={fitMode}
      data-web-search-required={String(fitEvaluation.webSearchRequired)}
      data-opaque-surface="true"
    >
      <form method="dialog" class="dialog-surface intake-dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-new-curriculum-title">New Curriculum</h2>
          <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
            <SfIcon name="close" />
          </button>
        </header>

        <section class="intake-compact-section" aria-label="Curriculum goal and preferences">
          <label class="field intake-goal-field" for="intake-goal">
            <span>Goal</span>
            <input
              id="intake-goal"
              name="goal"
              type="text"
              autocomplete="off"
              value={goalTitle}
              placeholder={`e.g., ${DEFAULT_SUBJECT_GOAL_PLACEHOLDERS[subject]}`}
              autofocus
            />
          </label>

          <div class="intake-subject-topics-grid">
            <label class="field intake-dropdown-field" for="intake-subject-select">
              <span>Subject</span>
              <select
                id="intake-subject-select"
                name="intake-subject"
                class="intake-select"
                data-action="set-intake-subject"
              >
                {INTAKE_SUBJECTS.map((subj) => (
                  <option key={subj} value={subj} selected={subj === subject}>
                    {subj}
                  </option>
                ))}
              </select>
            </label>

            <label class="field intake-dropdown-field" for="intake-topic-select">
              <span>Topics</span>
              <select
                id="intake-topic-select"
                name="intake-topic"
                class="intake-select"
                data-action="toggle-intake-topic"
                data-dependent-on-subject={subject}
              >
                <option value="" selected>
                  {requestedTopics.length === 0
                    ? `All ${subject} topics (select to filter)…`
                    : unselectedTopics.length > 0
                      ? `+ Add ${subject} topic (${unselectedTopics.length} more)…`
                      : `All ${subject} topics selected`}
                </option>
                {availableTopics.map((topic) => {
                  const active = requestedTopics.includes(topic);
                  return (
                    <option key={topic} value={topic}>
                      {active ? `✓ ${topic} (remove)` : `+ ${topic}`}
                    </option>
                  );
                })}
              </select>
            </label>

            {requestedTopics.length > 0 ? (
              <div class="intake-pill-group" role="group" aria-label="Selected topics and catalog coverage">
                {requestedTopics.map((topic) => {
                  const cov = fitEvaluation.topicCoverage.find((c) => c.topic === topic);
                  const status = cov?.status ?? "covered";
                  const prefix = status === "covered" ? "✓" : status === "partial" ? "◐" : "+";
                  return (
                    <button
                      key={topic}
                      type="button"
                      class={`filter-chip intake-topic-chip is-selected is-${status}`}
                      data-action="toggle-intake-topic"
                      data-intake-topic={topic}
                      data-topic-coverage={status}
                      data-topic-coverage-pill={topic}
                      data-coverage-state={status}
                      aria-pressed="true"
                      title={`Remove ${topic}`}
                    >
                      <span class="intake-topic-cov-mark" aria-hidden="true">
                        {prefix}
                      </span>
                      <span>{topic}</span>
                      <span class="intake-topic-remove" aria-hidden="true">
                        ×
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div class="intake-controls-grid">
            <div class="intake-control-cell">
              <span class="intake-row-label">Depth</span>
              <div class="segmented" role="group" aria-label="Mathematical depth">
                {INTAKE_DEPTH_CHOICES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    class="seg-btn"
                    data-action="set-intake-depth"
                    data-intake-depth={d}
                    aria-pressed={depth === d}
                  >
                    {d === "intuitive" ? "Intuitive" : d === "applied" ? "Applied" : "Formal"}
                  </button>
                ))}
              </div>
            </div>

            <div class="intake-control-cell">
              <span class="intake-row-label">Flow</span>
              <div class="segmented" role="group" aria-label="Study flow order">
                {INTAKE_FLOW_CHOICES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    class="seg-btn"
                    data-action="set-intake-flow"
                    data-intake-flow={f}
                    aria-pressed={flowOrder === f}
                  >
                    {f === "theory_first" ? "Theory" : f === "application_first" ? "Code first" : "Balanced"}
                  </button>
                ))}
              </div>
            </div>

            <div class="intake-control-cell">
              <span class="intake-row-label">Materials</span>
              <div class="segmented" role="group" aria-label="Materials access">
                <button
                  type="button"
                  class="seg-btn"
                  data-action="set-intake-materials"
                  data-intake-materials="free_only"
                  aria-pressed={materialsAccess === "free_only"}
                >
                  Free only
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  data-action="set-intake-materials"
                  data-intake-materials="paid_allowed"
                  aria-pressed={materialsAccess === "paid_allowed"}
                >
                  Paid allowed
                </button>
              </div>
            </div>

            <div class="intake-control-cell">
              <span class="intake-row-label">Pace</span>
              <div class="segmented" role="group" aria-label="Weekly pace presets">
                {[90, 120, 180, 240].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    class="seg-btn"
                    data-action="set-intake-pace"
                    data-weekly-minutes={String(mins)}
                    aria-pressed={weeklyMinutes === mins}
                  >
                    {mins}m/wk
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          class="intake-fit-tray"
          id="intake-suggested-fit-tray"
          aria-labelledby="intake-fit-heading"
          data-opaque-surface="true"
        >
          <div class="intake-section-head">
            <div class="intake-section-title-group">
              <h3 id="intake-fit-heading">Suggested fit</h3>
              <p
                class="intake-bypass-badge"
                role="status"
                data-search-bypass-status={fitEvaluation.costAndBypassBadge}
              >
                <SfIcon name={fitEvaluation.webSearchRequired ? "globe" : "check"} size={15} />
                <span>{fitEvaluation.costAndBypassBadge}</span>
              </p>
            </div>
            <div class="segmented" role="group" aria-label="Resource fit execution mode">
              <button
                type="button"
                class="seg-btn"
                data-action="set-intake-fit-mode"
                data-fit-mode="fill_gaps"
                aria-pressed={fitMode === "fill_gaps"}
              >
                Fill gaps
              </button>
              <button
                type="button"
                class="seg-btn"
                data-action="set-intake-fit-mode"
                data-fit-mode="use_selected_only"
                aria-pressed={fitMode === "use_selected_only"}
              >
                Selected only
              </button>
            </div>
          </div>

          {fitEvaluation.existingPlans.length > 0 ? (
            <div class="intake-fit-group">
              <h4 class="intake-fit-group-title">Existing plans ({fitEvaluation.existingPlans.length})</h4>
              <ul class="intake-fit-list">
                {fitEvaluation.existingPlans.map((plan) => (
                  <li
                    key={plan.id}
                    class="intake-fit-card intake-existing-plan-card"
                    data-fit-plan-id={plan.id}
                  >
                    <div class="intake-fit-card-main">
                      <span class="marketplace-card-icon" data-subject={plan.subject} aria-hidden="true">
                        <SfIcon name={subjectIcon(plan.subject)} size={16} />
                      </span>
                      <div>
                        <strong>{plan.title}</strong>
                        <p class="meta-text">
                          {plan.subject} · {plan.matchedTopics.length}/{plan.totalRequestedTopics} topics
                        </p>
                      </div>
                    </div>
                    <div class="intake-fit-card-actions">
                      {plan.kind === "my_plan" && plan.curriculumId ? (
                        <button
                          type="button"
                          class="btn-secondary"
                          data-action="intake-open-existing-plan"
                          data-curriculum-id={plan.curriculumId}
                        >
                          Open plan
                        </button>
                      ) : plan.publicationId ? (
                        <button
                          type="button"
                          class="btn-secondary"
                          data-action="intake-adopt-marketplace-plan"
                          data-publication-id={plan.publicationId}
                        >
                          Use plan
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div class="intake-fit-group">
            <h4 class="intake-fit-group-title">Indexed materials ({fitEvaluation.indexedMaterials.length})</h4>
            <ul class="intake-fit-list">
              {fitEvaluation.indexedMaterials.map((mat) => {
                const isUsed = fitEvaluation.selectedResourceIds.includes(mat.resourceVersionId);
                const isSkipped = fitEvaluation.skippedResourceIds.includes(mat.resourceVersionId);
                return (
                  <li
                    key={mat.resourceVersionId}
                    class={`intake-fit-card intake-material-card${isUsed ? " is-used" : ""}${isSkipped ? " is-skipped" : ""}`}
                    data-fit-resource-id={mat.resourceVersionId}
                    data-fit-resource-used={String(isUsed)}
                    data-fit-resource-skipped={String(isSkipped)}
                  >
                    <div class="intake-fit-card-top">
                      <div class="intake-fit-card-main">
                        <span class="badge resource-category-badge" data-category={mat.category}>
                          <SfIcon name={categoryIcon(mat.category)} size={15} />
                          <span>{mat.category}</span>
                        </span>
                        <div>
                          <strong>{mat.title}</strong>
                          <p class="meta-text">
                            {mat.publisher} · {mat.coveredTopics.join(", ")}
                          </p>
                        </div>
                      </div>
                      <div class="intake-fit-card-actions">
                        <button
                          type="button"
                          class={isUsed ? "btn-primary intake-use-btn" : "btn-secondary intake-use-btn"}
                          data-action="toggle-intake-resource"
                          data-resource-id={mat.resourceVersionId}
                          aria-pressed={isUsed}
                        >
                          {isUsed ? "✓ Using" : "Use"}
                        </button>
                        <button
                          type="button"
                          class={`btn-secondary intake-skip-btn${isSkipped ? " is-active" : ""}`}
                          data-action="skip-intake-resource"
                          data-resource-id={mat.resourceVersionId}
                          aria-pressed={isSkipped}
                        >
                          {isSkipped ? "Skipped" : "Skip"}
                        </button>
                      </div>
                    </div>
                    {renderPolymorphicIndexDetails(mat.polymorphicIndex)}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {intakeNote ? (
          <p class="prose intake-status-note" role="status">
            {intakeNote}
          </p>
        ) : null}

        {lastPipelineReceipt ? (
          <div class="intake-receipt-banner" role="status" data-pipeline-receipt="true">
            <strong>{lastPipelineReceipt.summaryNote}</strong>
          </div>
        ) : null}

        <footer class="dialog-footer">
          <button type="button" class="btn-primary" data-action="generate-curriculum-ai">
            <SfIcon name="sparkles" size={15} />
            <span>Generate curriculum</span>
          </button>
        </footer>
      </form>
    </dialog>
  );
}
