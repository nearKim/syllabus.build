import type { CatalogResourceMetadataInput } from "@syllabus/ui";
import { classifyResourceCategory, type ResourceCategory } from "../ResourcesView.tsx";
import { buildTfidfIndex, searchTfidf, type TfidfIndex } from "../../tfidfIndex.ts";
import type {
  IntakeFitMode,
  IntakeMaterialsChoice,
  IntakeSubject,
} from "./taxonomy.ts";

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
  readonly source?: "indexed" | "web";
  // TF-IDF cosine similarity to the goal and topics. A web result that is not indexed yet has none.
  readonly matchScore?: number;
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
  readonly syllabusId: string | null;
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
  readonly generatedSyllabusId: string;
  readonly designatedProviderId: string;
  readonly designatedModelId: string;
  // True when a live model wrote the plan. False when the deterministic fixture provider wrote it.
  readonly liveDraft: boolean;
  readonly summaryNote: string;
}

export const POLYMORPHIC_INDEX_CATALOG: Readonly<
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

// A catalog record as the index reads it. Web-discovered records also carry the topics they were found for.
export type IndexedCatalogResource = CatalogResourceMetadataInput & { readonly topics?: readonly string[] | undefined };

export function polymorphicIndexText(index: PolymorphicResourceIndex): string[] {
  switch (index.kind) {
    case "book":
      return [index.briefSummary, ...index.tocChapters.flatMap((ch) => [ch.title, ch.summary])];
    case "youtube_playlist":
      return [index.channelTitle, ...index.syllabusVideos.flatMap((video) => [video.title, video.transcriptSummary])];
    case "course":
      return [index.institution, ...index.syllabusModules.map((mod) => mod.title)];
    case "code_lab":
      return [index.runtimeLanguage, ...index.labExercises.map((lab) => lab.title)];
  }
}

// The text the index holds for one resource: title, publisher, subject, topics, summary, and section titles.
export function catalogSearchText(resourceVersionId: string, raw: IndexedCatalogResource): string {
  const meta = POLYMORPHIC_INDEX_CATALOG[resourceVersionId];
  return [
    raw.title,
    raw.provider?.display_name,
    raw.subject ?? meta?.subject,
    raw.description,
    ...(meta?.coveredTopics ?? []),
    ...(meta?.partialTopics ?? []),
    ...(raw.topics ?? []),
    ...(meta ? polymorphicIndexText(meta.polymorphicIndex) : []),
    ...(raw.segments ?? []).map((seg) => seg.title),
  ]
    .filter(Boolean)
    .join(" ");
}

// Each catalog object is immutable, so its index is built once. A catalog with new resources is a new
// object, so newly discovered resources are searchable on the next read.
const catalogIndexes = new WeakMap<object, TfidfIndex>();

export function catalogIndexOf(catalogResources: Readonly<Record<string, IndexedCatalogResource>>): TfidfIndex {
  let index = catalogIndexes.get(catalogResources);
  if (!index) {
    index = buildTfidfIndex(
      Object.fromEntries(Object.entries(catalogResources).map(([id, raw]) => [id, catalogSearchText(id, raw)])),
    );
    catalogIndexes.set(catalogResources, index);
  }
  return index;
}

// MiniSearch normalized BM25/TF-IDF floors in (0, 1), set on the seeded catalog.
export const MATCH_MIN = 0.12;
export const COVER_MIN = 0.15;

export function buildIndexedMaterialCandidates(
  catalogResources: Readonly<Record<string, IndexedCatalogResource>>,
  subject: IntakeSubject,
  requestedTopics: readonly string[],
  materialsAccess: IntakeMaterialsChoice,
  goalTitle: string,
): readonly IndexedMaterialCandidate[] {
  const normTopics = requestedTopics.map((t) => t.toLowerCase());
  const index = catalogIndexOf(catalogResources);
  const scores = new Map(searchTfidf(index, [goalTitle, ...requestedTopics].join(" ")).map((hit) => [hit.id, hit.score]));
  const topicHits = new Map(
    requestedTopics.map((topic) => [
      topic,
      new Set(searchTfidf(index, topic).filter((hit) => hit.score >= COVER_MIN).map((hit) => hit.id)),
    ]),
  );
  const candidates: IndexedMaterialCandidate[] = [];

  for (const [resourceVersionId, raw] of Object.entries(catalogResources)) {
    const accessModel = raw.access?.model ?? "free";
    if (materialsAccess === "free_only" && accessModel !== "free" && accessModel !== "library_loan") {
      continue;
    }
    const meta = POLYMORPHIC_INDEX_CATALOG[resourceVersionId];
    const category = classifyResourceCategory(
      resourceVersionId,
      raw.title ?? resourceVersionId,
      raw.provider?.display_name ?? "",
      raw.category,
    );
    const candidateSubject = (meta?.subject ?? raw.subject ?? subject) as IntakeSubject;
    // Curated topics win. Otherwise a requested topic counts as covered when MiniSearch matches it above COVER_MIN.
    const coveredTopics =
      meta?.coveredTopics ??
      raw.topics ??
      requestedTopics.filter((topic) => topicHits.get(topic)?.has(resourceVersionId));
    const partialTopics = meta?.partialTopics ?? [];
    const matchScore = scores.get(resourceVersionId) ?? 0;

    const matchesSubject = candidateSubject === subject;
    const matchesAnyTopic =
      coveredTopics.some((t) => normTopics.includes(t.toLowerCase())) ||
      partialTopics.some((t) => normTopics.includes(t.toLowerCase()));

    if (!matchesSubject && !matchesAnyTopic && matchScore < MATCH_MIN) continue;

    const curatorVerified = raw.vector_index?.discovered_by !== "AI Web Search";
    const fallbackIndex: PolymorphicResourceIndex =
      category === "YouTube"
        ? {
            kind: "youtube_playlist",
            channelTitle: raw.provider?.display_name ?? "YouTube channel",
            transcriptAvailable: curatorVerified,
            syllabusVideos: (raw.segments ?? []).map((seg, i) => ({
              timestampOrIndex: `Video ${i + 1}`,
              title: seg.title ?? `Video ${i + 1}`,
              transcriptSummary: curatorVerified ? "Verified segment transcript indexed in catalog." : "Found by web search. A curator has not verified it yet.",
            })),
          }
        : category === "Course"
          ? {
              kind: "course",
              institution: raw.provider?.display_name ?? "Course provider",
              syllabusModules: (raw.segments ?? []).map((seg, i) => ({ unit: `Unit ${i + 1}`, title: seg.title ?? `Unit ${i + 1}` })),
            }
          : {
            kind: "book",
            isbn13: "978-0-000-00000-0",
            briefSummary: curatorVerified
              ? `Curator-verified ${category.toLowerCase()} from ${raw.provider?.display_name ?? "Catalog"}.`
              : `${category} found by web search from ${raw.provider?.display_name ?? "the web"}. A curator has not verified it yet.`,
            tocChapters: (raw.segments ?? []).map((seg, i) => ({
              number: `Sec. ${i + 1}`,
              title: seg.title ?? `Section ${i + 1}`,
              summary: curatorVerified ? "Verified catalog section." : "Section title from web search.",
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
      source: resourceVersionId.startsWith("discovered-") ? "web" : "indexed",
      matchScore,
    });
  }

  // Best cosine match first. Equal scores keep catalog order.
  return candidates.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
}
