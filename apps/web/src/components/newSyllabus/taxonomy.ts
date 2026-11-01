import type { SfIconName } from "../Icons.tsx";

const SUBJECT_ICON_MAP: Readonly<Record<string, SfIconName>> = {
  Engineering: "engineering",
  Mathematics: "math",
  Physics: "physics",
  Literature: "literature",
  Systems: "systems",
};

export function subjectIcon(subject: string): SfIconName {
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

export interface DesignatedAiModelOption {
  readonly providerId: "openai" | "anthropic" | "google_gemini";
  readonly providerLabel: string;
  readonly modelId: string;
  readonly modelLabel: string;
  readonly webSearchTool: string;
}

export const DESIGNATED_AI_MODELS: readonly DesignatedAiModelOption[] = [
  {
    providerId: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-6-astra",
    modelLabel: "GPT-6 Astra",
    webSearchTool: "Responses API · Web search",
  },
  {
    providerId: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-6.1-sol",
    modelLabel: "GPT-6.1 Sol",
    webSearchTool: "Responses API · Web search",
  },
  {
    providerId: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-6.1-terra",
    modelLabel: "GPT-6.1 Terra (Fast)",
    webSearchTool: "Responses API · Web search",
  },
  {
    providerId: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-6-luna",
    modelLabel: "GPT-6 Luna (Lightweight)",
    webSearchTool: "Responses API · Web search",
  },
  {
    providerId: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-5.4",
    modelLabel: "GPT-5.4",
    webSearchTool: "Responses API · Web search",
  },
  {
    providerId: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-opus-5-5",
    modelLabel: "Claude Opus 5.5",
    webSearchTool: "Messages API · Web search",
  },
  {
    providerId: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-fable-5-1",
    modelLabel: "Claude Fable 5.1",
    webSearchTool: "Messages API · Web search",
  },
  {
    providerId: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-sonnet-5-5",
    modelLabel: "Claude Sonnet 5.5",
    webSearchTool: "Messages API · Web search",
  },
  {
    providerId: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-haiku-5-5",
    modelLabel: "Claude Haiku 5.5 (Fast)",
    webSearchTool: "Messages API · Web search",
  },
  {
    providerId: "google_gemini",
    providerLabel: "Google Gemini",
    modelId: "gemini-4-argon",
    modelLabel: "Gemini 4 Argon",
    webSearchTool: "Google Search grounding",
  },
  {
    providerId: "google_gemini",
    providerLabel: "Google Gemini",
    modelId: "gemini-3.8-flash",
    modelLabel: "Gemini 3.8 Flash",
    webSearchTool: "Google Search grounding",
  },
  {
    providerId: "google_gemini",
    providerLabel: "Google Gemini",
    modelId: "gemini-3.5-flash",
    modelLabel: "Gemini 3.5 Flash",
    webSearchTool: "Google Search grounding",
  },
  {
    providerId: "google_gemini",
    providerLabel: "Google Gemini",
    modelId: "gemini-3.5-flash-lite",
    modelLabel: "Gemini 3.5 Flash-Lite (Lightweight)",
    webSearchTool: "Google Search grounding",
  },
] as const;

// Generation and auto-indexing default to each provider's cheapest model with native web search.
// Prices per million input/output tokens, checked 2026-10-28: Luna $0.10/$0.50, Haiku 5.5 $0.10/$0.50.
export const CHEAP_MODEL_BY_PROVIDER: Readonly<Record<DesignatedAiModelOption["providerId"], string>> = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-5-5",
  google_gemini: "gemini-3.5-flash-lite",
};

export const DEFAULT_SUBJECT_TOPICS: Readonly<Record<IntakeSubject, readonly string[]>> = {
  Engineering: ["Python", "RAG", "Attention", "Vector Indexing", "Linear Algebra", "Evaluation"],
  Systems: ["Rust", "Async", "Concurrency", "Wakers", "Work Stealing"],
  Mathematics: ["Linear Algebra", "Eigenvalues", "SVD", "Matrix Calculus"],
  Physics: ["Thermodynamics", "Ensembles", "Phase Transitions", "Ising Model"],
  Literature: ["Tolstoy", "Realism", "Narrative", "Comparative Close Reading"],
};

export interface SubjectTopicTaxonomy {
  readonly coreTopics: readonly string[];
  readonly prerequisitesByTopic: Readonly<Record<string, readonly string[]>>;
  readonly subtopicsByParent: Readonly<Record<string, readonly string[]>>;
}

export const SUBJECT_TOPIC_TAXONOMY: Readonly<Record<IntakeSubject, SubjectTopicTaxonomy>> = {
  Engineering: {
    coreTopics: ["Python", "RAG", "Attention", "Linear Algebra"],
    prerequisitesByTopic: {
      RAG: ["Python"],
      Attention: ["Linear Algebra"],
      "Vector Indexing": ["RAG", "Python"],
      Evaluation: ["RAG", "Python"],
    },
    subtopicsByParent: {
      RAG: ["Vector Indexing", "Evaluation"],
      Attention: ["Vector Indexing", "Evaluation"],
    },
  },
  Systems: {
    coreTopics: ["Rust", "Async", "Concurrency"],
    prerequisitesByTopic: {
      Async: ["Rust"],
      Concurrency: ["Rust"],
      Wakers: ["Async", "Rust"],
      "Work Stealing": ["Concurrency", "Rust"],
    },
    subtopicsByParent: {
      Async: ["Wakers", "Work Stealing"],
      Concurrency: ["Work Stealing"],
    },
  },
  Mathematics: {
    coreTopics: ["Linear Algebra", "Eigenvalues", "Matrix Calculus"],
    prerequisitesByTopic: {
      Eigenvalues: ["Linear Algebra"],
      "Matrix Calculus": ["Linear Algebra"],
      SVD: ["Eigenvalues", "Linear Algebra"],
    },
    subtopicsByParent: {
      Eigenvalues: ["SVD"],
    },
  },
  Physics: {
    coreTopics: ["Thermodynamics", "Ensembles"],
    prerequisitesByTopic: {
      Ensembles: ["Thermodynamics"],
      "Phase Transitions": ["Ensembles", "Thermodynamics"],
      "Ising Model": ["Ensembles", "Thermodynamics"],
    },
    subtopicsByParent: {
      Ensembles: ["Phase Transitions", "Ising Model"],
    },
  },
  Literature: {
    coreTopics: ["Tolstoy", "Realism", "Narrative"],
    prerequisitesByTopic: {
      Realism: ["Tolstoy"],
      Narrative: ["Tolstoy"],
      "Comparative Close Reading": ["Realism", "Tolstoy"],
    },
    subtopicsByParent: {
      Realism: ["Comparative Close Reading"],
      Narrative: ["Comparative Close Reading"],
    },
  },
};

export function resolveDependentTopicToggle(
  subject: IntakeSubject,
  currentTopics: readonly string[],
  toggledTopic: string,
): string[] {
  const taxonomy = SUBJECT_TOPIC_TAXONOMY[subject];
  const allOrdered = DEFAULT_SUBJECT_TOPICS[subject];
  const currentSet = new Set(currentTopics);

  if (!currentSet.has(toggledTopic)) {
    currentSet.add(toggledTopic);
    for (const prereq of taxonomy.prerequisitesByTopic[toggledTopic] ?? []) {
      currentSet.add(prereq);
    }
    const matchingParents = Object.entries(taxonomy.subtopicsByParent)
      .filter(([, subs]) => subs.includes(toggledTopic))
      .map(([parent]) => parent);
    if (matchingParents.length > 0 && !matchingParents.some((parent) => currentSet.has(parent))) {
      const primaryParent = matchingParents[0]!;
      currentSet.add(primaryParent);
      for (const prereq of taxonomy.prerequisitesByTopic[primaryParent] ?? []) {
        currentSet.add(prereq);
      }
    }
  } else {
    currentSet.delete(toggledTopic);
    const childSubs = taxonomy.subtopicsByParent[toggledTopic] ?? [];
    for (const sub of childSubs) {
      const stillHasOtherActiveParent = Object.entries(taxonomy.subtopicsByParent).some(
        ([otherParent, otherSubs]) =>
          otherParent !== toggledTopic && currentSet.has(otherParent) && otherSubs.includes(sub),
      );
      if (!stillHasOtherActiveParent) {
        currentSet.delete(sub);
      }
    }
  }

  return allOrdered.filter((t) => currentSet.has(t));
}

export const DEFAULT_SUBJECT_GOAL_PLACEHOLDERS: Readonly<Record<IntakeSubject, string>> = {
  Engineering: "Build and Evaluate RAG Systems in Python",
  Systems: "Build an Async Rust Runtime and Work-Stealing Executor",
  Mathematics: "Master Spectral Methods, SVD, and Matrix Calculus",
  Physics: "Statistical Mechanics, Ensembles, and Phase Transitions",
  Literature: "Comparative Close Reading of Tolstoy's Major Novels",
};

export function inferIntakeSubjectFromGoal(
  goalTitle: string,
  fallbackSubject: IntakeSubject = "Engineering",
): IntakeSubject {
  const lower = goalTitle.toLowerCase();
  if (!lower.trim()) return fallbackSubject;
  if (/\b(rag|python|attention|token|vector|llm|evaluation|embedding|transformer|engineering)\b/.test(lower)) {
    return "Engineering";
  }
  if (/\b(rust|async|waker|executor|work[- ]stealing|concurrency|epoll|kernel)\b/.test(lower)) {
    return "Systems";
  }
  if (/\b(math|mathematics|linear algebra|eigen|svd|singular value|spectral|matrix|calculus)\b/.test(lower)) {
    return "Mathematics";
  }
  if (/\b(physics|thermodynamics|ensemble|phase transition|ising|statistical mechanics|boltzmann|quantum)\b/.test(lower)) {
    return "Physics";
  }
  if (/\b(literature|tolstoy|realism|narrative|novel|war and peace|karenina|close reading)\b/.test(lower)) {
    return "Literature";
  }
  return fallbackSubject;
}
