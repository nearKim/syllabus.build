/**
 * Dynamic BYOK AI Concept Checks, Hints, Worked Solutions & Unassisted Diagnostic Questions.
 *
 * - Calls OpenAI (`/v1/responses`), Anthropic (`/v1/messages`), or Google Gemini (`generateContent`)
 *   when the learner has configured an active BYOK API key.
 * - Falls back deterministically to objective-aware checks with TeX formulas, hints, and worked
 *   solutions when no API key is configured or in offline test environments.
 */

import type { ConceptCheck } from "./components/InspectorDrawer.tsx";

export interface LiveConceptCheckParams {
  readonly syllabusTitle: string;
  readonly subject?: string | undefined;
  readonly moduleTitle: string;
  readonly activityId: string;
  readonly activityTitle: string;
  readonly activityType?: string | undefined;
  readonly activityPrompt?: string | undefined;
  readonly objectiveId?: string | undefined;
  readonly objectiveTitle?: string | undefined;
  readonly successCriterion?: string | undefined;
  readonly variantSeed?: number | undefined;
}

export interface LiveTutorModelRequest extends LiveConceptCheckParams {
  readonly providerId: string;
  readonly modelId: string;
}

export interface GeneratedConceptCheck extends ConceptCheck {
  readonly correctValue: string;
  readonly generatedBy: "ai" | "deterministic";
}

export interface DiagnosticQuestion {
  readonly objectiveId: string;
  readonly objectiveVersionId: string;
  readonly objectiveTitle: string;
  readonly formula: string;
  readonly question: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly correctValue: string;
  readonly explanation: string;
}

const CURATED_DIAGNOSTIC_QUESTIONS: Readonly<Record<string, Omit<DiagnosticQuestion, "objectiveId" | "objectiveVersionId" | "objectiveTitle">>> = {
  "objective-tokenization": {
    formula: "L_{\\text{tokens}}(x; \\mathcal{V}) \\propto \\frac{|x|}{\\bar{\\ell}(\\mathcal{V})}",
    question: "When vocabulary size |V| increases in a BPE tokenizer, how do sequence length and embedding table memory typically trade off?",
    choices: [
      { value: "shorter_seq_larger_embed", label: "Average token sequence length decreases while embedding matrix parameters grow linearly with |V|" },
      { value: "longer_seq_smaller_embed", label: "Average token sequence length increases while attention memory drops quadratically" },
      { value: "unchanged_seq", label: "Sequence length stays fixed because BPE merges only alter character-level UTF-8 byte counts" },
    ],
    correctValue: "shorter_seq_larger_embed",
    explanation: "More subword merges pack common multi-character spans into single token IDs, shortening sequence length T (reducing O(T^2) attention cost) at the expense of |V| × d_model embedding parameters.",
  },
  "objective-attention": {
    formula: "\\mathrm{Var}\\!\\left(\\frac{q \\cdot k}{\\sqrt{d_k}}\\right) = \\frac{1}{d_k} \\sum_{i=1}^{d_k} \\mathrm{Var}(q_i k_i) = 1",
    question: "What happens to backward softmax gradients in scaled dot-product attention if the 1/sqrt(d_k) factor is omitted for large d_k?",
    choices: [
      { value: "vanish_saturation", label: "Logit magnitudes grow as O(sqrt(d_k)), pushing softmax toward one-hot outputs with near-zero Jacobian entries" },
      { value: "explode_linearly", label: "Softmax outputs exceed 1 and cause unbounded gradient explosion in V" },
      { value: "orthogonal_cancel", label: "Query and key projections become orthogonal, zeroing out the value matrix V" },
    ],
    correctValue: "vanish_saturation",
    explanation: "Without 1/sqrt(d_k), dot-product variance scales as d_k, concentrating softmax mass on the largest logit so diag(p) - p p^T approaches zero.",
  },
  "objective-la-spectral": {
    formula: "P_{\\mathcal{C}(A)} = Q Q^T, \\quad Q^T Q = I",
    question: "If columns of Q form an orthonormal basis for subspace S, which property characterizes the orthogonal projector P = Q Q^T?",
    choices: [
      { value: "symmetric_idempotent", label: "P is both symmetric (P^T = P) and idempotent (P^2 = P), so residual y - Py is orthogonal to S" },
      { value: "full_rank_invertible", label: "P is always invertible with determinant 1 regardless of the dimension of S" },
      { value: "skew_symmetric", label: "P has purely imaginary eigenvalues whenever S is a proper subspace" },
    ],
    correctValue: "symmetric_idempotent",
    explanation: "P^T = (Q Q^T)^T = Q Q^T = P and P^2 = Q (Q^T Q) Q^T = Q Q^T = P, ensuring Q^T(y - Q Q^T y) = 0.",
  },
  "objective-la-svd": {
    formula: "\\min_{\\mathrm{rank}(B) \\le k} \\|A - B\\|_2 = \\sigma_{k+1}",
    question: "By the Eckart–Young theorem, what is the spectral-norm error ||A - A_k||_2 of the truncated rank-k SVD approximation A_k?",
    choices: [
      { value: "sigma_k_plus_1", label: "The (k + 1)-th singular value sigma_{k+1} of A" },
      { value: "sum_all_sigmas", label: "The trace sum sigma_1 + ... + sigma_k of retained singular values" },
      { value: "det_ratio", label: "The determinant of A divided by sigma_k" },
    ],
    correctValue: "sigma_k_plus_1",
    explanation: "Subtracting the top k singular dyads leaves diag(0, ..., 0, sigma_{k+1}, ...), whose operator 2-norm is the largest remaining singular value sigma_{k+1}.",
  },
  "objective-sm-ensembles": {
    formula: "\\langle E \\rangle = -\\frac{\\partial \\ln Z}{\\partial \\beta}, \\quad C_V = k_B \\beta^2 \\langle (E - \\langle E \\rangle)^2 \\rangle",
    question: "Why does the heat capacity C_V of a finite two-level system vanish in both the T -> 0 and T -> infinity limits (the Schottky anomaly)?",
    choices: [
      { value: "frozen_or_saturated", label: "At low T excitations are exponentially rare; at high T populations saturate at 1/2 so d<E>/dT -> 0" },
      { value: "partition_diverges", label: "The two-level partition function Z diverges above the gap temperature Delta / k_B" },
      { value: "entropy_negative", label: "Canonical entropy becomes negative when k_B T exceeds the energy splitting" },
    ],
    correctValue: "frozen_or_saturated",
    explanation: "Energy variance peaks when k_B T is comparable to the level splitting and vanishes when the ground state dominates (T -> 0) or both levels populate equally (T -> infinity).",
  },
  "objective-sm-phase": {
    formula: "m = \\tanh(\\beta J z m)",
    question: "In the mean-field Ising equation m = tanh(beta J z m), when do spontaneous nonzero magnetization solutions m != 0 appear?",
    choices: [
      { value: "slope_exceeds_one", label: "When beta J z > 1 (T < T_c = J z / k_B), where the initial slope of tanh(beta J z m) at m = 0 exceeds 1" },
      { value: "high_temp_limit", label: "Only when beta J z < 1 so thermal fluctuations align neighboring spins" },
      { value: "all_positive_temp", label: "At every finite temperature T > 0 regardless of coordination number z" },
    ],
    correctValue: "slope_exceeds_one",
    explanation: "At m = 0, d/dm tanh(beta J z m) = beta J z. When beta J z > 1, m = 0 loses stability and two symmetric free-energy minima +-m_0 emerge.",
  },
  "objective-rs-poll": {
    formula: "\\mathrm{Pin}\\langle P \\rangle \\implies \\text{pointee address invariant until } \\mathrm{Drop}",
    question: "Why must an async block's generated Future be pinned in memory before Future::poll is called?",
    choices: [
      { value: "self_referential", label: "Local borrows held across .await points create self-referential pointers inside the state machine struct" },
      { value: "heap_only", label: "Rust forbids polling any Future that is not allocated inside Box::pin on the heap" },
      { value: "send_bound", label: "Pinning automatically implements Send + Sync for raw pointers across OS threads" },
    ],
    correctValue: "self_referential",
    explanation: "Across an .await suspension, one variant field of the compiler-generated state machine may borrow another field; moving the struct would invalidate that internal pointer.",
  },
  "objective-rs-scheduling": {
    formula: "\\text{epoll\\_wait} \\to \\mathrm{Waker::wake}() \\to \\text{run queue}",
    question: "In a work-stealing async executor with a hashed timer wheel, how do sleeping tasks avoid blocking worker threads?",
    choices: [
      { value: "park_on_reactor", label: "Tasks register their Waker in the timer wheel slot and yield Pending; the reactor wakes expired slots on tick/timeout" },
      { value: "thread_sleep_poll", label: "Each worker calls std::thread::sleep inside Future::poll until the deadline passes" },
      { value: "busy_spin_queue", label: "Idle workers continuously re-poll every task in the global queue without waker notifications" },
    ],
    correctValue: "park_on_reactor",
    explanation: "Returning Poll::Pending frees the worker to steal runnable tasks; when no tasks remain, the reactor sleeps until the next timer wheel deadline or I/O readiness event.",
  },
  "objective-tl-agency": {
    formula: "\\mathrm{Event} = \\int_{\\text{actors}} \\delta w_i \\quad (\\text{Tolstoy, Book Nine})",
    question: "How does Prince Andrei's view of the lofty sky at Austerlitz connect to Tolstoy's philosophy of history in Book Nine?",
    choices: [
      { value: "limits_of_great_men", label: "It exposes the vanity of Napoleon's 'great man' command claim against the vast differential of small human wills" },
      { value: "heroic_command", label: "It proves that a single decisive general determines battle outcomes whenever orders are clear" },
      { value: "pure_chance", label: "It argues that moral reflection has no place in realist narrative fiction" },
    ],
    correctValue: "limits_of_great_men",
    explanation: "Andrei's disillusionment with Napoleon anticipates Book Nine's thesis that historical events integrate countless infinitesimal actions rather than obeying one commander's will.",
  },
  "objective-tl-interiority": {
    formula: "\\text{Narrator} \\leftrightarrow \\text{Character Focalization (Free Indirect Discourse)}",
    question: "What narrative effect does Tolstoy achieve through free indirect discourse during Anna's carriage ride in Part Seven?",
    choices: [
      { value: "interior_focalization", label: "Third-person prose absorbs Anna's fragmented perceptions, holding the reader inside her distress while preserving tragic distance" },
      { value: "epistolary_break", label: "The novel switches permanently into signed first-person diary entries written by Levin" },
      { value: "omniscient_verdict", label: "The narrator halts focalization to deliver a legalistic condemnation without psychological interiority" },
    ],
    correctValue: "interior_focalization",
    explanation: "By blending third-person grammar with Anna's immediate sensory distortions, Tolstoy deepens moral empathy while contrasting her narrowing horizon with Levin's open inquiry in Part Eight.",
  },
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function defaultFormulaForSubject(subject: string, seed: number): string {
  const s = subject.toLowerCase();
  if (s.includes("math") || s.includes("algebra")) {
    return seed % 2 === 0 ? "\\|Ax - b\\|_2^2 = \\min_{x \\in \\mathbb{R}^n} \\sum_i (a_i^T x - b_i)^2" : "A = U \\Sigma V^T";
  }
  if (s.includes("physics") || s.includes("mech")) {
    return seed % 2 === 0 ? "F = -k_B T \\ln Z" : "\\Delta S = \\int \\frac{\\delta Q_{\\text{rev}}}{T} \\ge 0";
  }
  if (s.includes("system") || s.includes("rust")) {
    return seed % 2 === 0 ? "T_{\\text{p99}} \\le T_{\\text{service}} + T_{\\text{queue}}" : "\\mathrm{poll}(cx) \\to \\{\\mathrm{Pending}, \\mathrm{Ready}(T)\\}";
  }
  return seed % 2 === 0
    ? "\\mathcal{J}(\\theta) = \\mathbb{E}_{(x,y) \\sim \\mathcal{D}}\\big[\\ell(f_\\theta(x), y)\\big]"
    : "\\mathrm{Score}(q, d) = \\frac{q \\cdot d}{\\|q\\|_2 \\|d\\|_2}";
}

export function buildDeterministicConceptCheck(params: LiveConceptCheckParams): GeneratedConceptCheck {
  const variant = params.variantSeed ?? 0;
  const seed = hashSeed(`${params.activityId}:${params.objectiveId ?? ""}:${variant}`);
  const focus = (params.objectiveTitle || params.activityTitle || params.moduleTitle || "this concept").trim();
  const criterion = (
    params.successCriterion ||
    params.activityPrompt ||
    `Verify the core invariant of ${focus} on an unseen input before advancing.`
  ).trim();
  const formula = defaultFormulaForSubject(params.subject ?? params.syllabusTitle, seed);

  const questionVariants = [
    `Which verification step best demonstrates mastery of "${focus}"?`,
    `When checking "${focus}" independently, which criterion confirms your reasoning holds?`,
    `Before passing the unit gate for "${focus}", what invariant should your solution satisfy?`,
  ];
  const question = questionVariants[seed % questionVariants.length]!;

  const baseChoices = [
    {
      value: "verified_criterion",
      label: criterion.length > 165 ? `${criterion.slice(0, 162)}...` : criterion,
    },
    {
      value: "memorized_summary",
      label: `Rely on a memorized definition of ${focus} without testing edge cases or assumptions`,
    },
    {
      value: "unverified_shortcut",
      label: `Skip assumption checks and extrapolate ${focus} to untested downstream modules directly`,
    },
  ];

  const rotation = seed % 3;
  const choices = [
    baseChoices[rotation]!,
    baseChoices[(rotation + 1) % 3]!,
    baseChoices[(rotation + 2) % 3]!,
  ];

  return {
    formula,
    question,
    choices,
    correctValue: "verified_criterion",
    hint: `Focus on the stated verification target for ${focus}: ask which option tests an observable invariant on an unseen case rather than repeating definitions.`,
    solution: `Mastery of "${focus}" requires meeting the concrete verification criterion (${criterion}). Memorizing prose definitions or skipping boundary assumptions leaves downstream prerequisites uncorroborated.`,
    generatedBy: "deterministic",
  };
}

export function buildDiagnosticQuestionForObjective(params: {
  readonly syllabusTitle: string;
  readonly subject?: string | undefined;
  readonly objectiveId: string;
  readonly objectiveVersionId?: string | undefined;
  readonly objectiveTitle: string;
  readonly description?: string | undefined;
  readonly successCriterion?: string | undefined;
}): DiagnosticQuestion {
  const curated = CURATED_DIAGNOSTIC_QUESTIONS[params.objectiveId];
  const versionId = params.objectiveVersionId || `${params.objectiveId}-v1`;
  if (curated) {
    return {
      objectiveId: params.objectiveId,
      objectiveVersionId: versionId,
      objectiveTitle: params.objectiveTitle,
      ...curated,
    };
  }
  const fallback = buildDeterministicConceptCheck({
    syllabusTitle: params.syllabusTitle,
    subject: params.subject,
    moduleTitle: params.syllabusTitle,
    activityId: `diag-${params.objectiveId}`,
    activityTitle: params.objectiveTitle,
    activityPrompt: params.description,
    objectiveId: params.objectiveId,
    objectiveTitle: params.objectiveTitle,
    successCriterion: params.successCriterion,
    variantSeed: 1,
  });
  return {
    objectiveId: params.objectiveId,
    objectiveVersionId: versionId,
    objectiveTitle: params.objectiveTitle,
    formula: fallback.formula,
    question: fallback.question,
    choices: fallback.choices,
    correctValue: fallback.correctValue,
    explanation: fallback.solution,
  };
}

function buildTutorPrompt(req: LiveTutorModelRequest): string {
  return [
    `Create ONE rigorous 3-choice concept check question for a self-learner studying "${req.syllabusTitle}".`,
    `Unit: ${req.moduleTitle}`,
    `Activity: ${req.activityTitle}${req.activityPrompt ? ` (${req.activityPrompt})` : ""}`,
    req.objectiveTitle ? `Target Objective: ${req.objectiveTitle}` : "",
    req.successCriterion ? `Success Criterion: ${req.successCriterion}` : "",
    req.variantSeed ? `Variant number: ${req.variantSeed} (ask a fresh angle distinct from standard textbook boilerplate)` : "",
    "",
    "Return ONLY a JSON object with this exact shape (no markdown fences):",
    "{",
    '  "formula": "compact valid LaTeX expression illustrating the core relationship",',
    '  "question": "concise conceptual or diagnostic question",',
    '  "choices": [',
    '    { "value": "opt_a", "label": "first option" },',
    '    { "value": "opt_b", "label": "second option" },',
    '    { "value": "opt_c", "label": "third option" }',
    "  ],",
    '  "correctValue": "opt_a | opt_b | opt_c (must match the exact correct choice value)",',
    '  "hint": "1-2 sentence Socratic hint guiding the learner without giving away the letter",',
    '  "solution": "2-3 sentence worked explanation proving why the correct option holds and why the distractors fail"',
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseGeneratedCheckJson(rawText: string): GeneratedConceptCheck {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model response did not contain a JSON object.");
  }
  const parsed = JSON.parse(rawText.slice(start, end + 1)) as Record<string, unknown>;
  const formula = typeof parsed["formula"] === "string" && parsed["formula"].trim() ? parsed["formula"].trim() : "f(x) = y";
  const question = typeof parsed["question"] === "string" ? parsed["question"].trim() : "";
  const hint = typeof parsed["hint"] === "string" ? parsed["hint"].trim() : "";
  const solution = typeof parsed["solution"] === "string" ? parsed["solution"].trim() : "";
  const rawChoices = Array.isArray(parsed["choices"]) ? parsed["choices"] : [];
  const choices = rawChoices
    .slice(0, 3)
    .map((entry, idx) => {
      const obj = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const value =
        typeof obj["value"] === "string" && obj["value"].trim()
          ? obj["value"].trim().replace(/[^a-zA-Z0-9_-]/g, "_")
          : `choice_${idx + 1}`;
      const label = typeof obj["label"] === "string" ? obj["label"].trim() : "";
      return { value, label };
    })
    .filter((c) => c.label.length > 0);

  if (!question || choices.length !== 3 || !hint || !solution) {
    throw new Error("Model returned an incomplete concept check payload.");
  }
  const requestedCorrect = typeof parsed["correctValue"] === "string" ? parsed["correctValue"].trim() : "";
  const correctValue = choices.some((c) => c.value === requestedCorrect) ? requestedCorrect : choices[0]!.value;

  return {
    formula,
    question,
    choices,
    correctValue,
    hint,
    solution,
    generatedBy: "ai",
  };
}

export async function requestLiveConceptCheck(
  req: LiveTutorModelRequest,
  apiKey: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<GeneratedConceptCheck> {
  const prompt = buildTutorPrompt(req);
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  if (req.providerId === "openai") {
    url = "https://api.openai.com/v1/responses";
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    body = {
      model: req.modelId,
      input: prompt,
    };
  } else if (req.providerId === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    body = {
      model: req.modelId,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    };
  } else if (req.providerId === "google_gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.modelId)}:generateContent`;
    headers = {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };
    body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
  } else {
    throw new Error(`Unsupported AI provider '${req.providerId}'.`);
  }

  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = payload["error"] && typeof payload["error"] === "object" ? (payload["error"] as Record<string, unknown>) : null;
    throw new Error(typeof errObj?.["message"] === "string" ? errObj["message"] : `${req.providerId} HTTP ${res.status}`);
  }

  let text = "";
  if (req.providerId === "openai") {
    if (typeof payload["output_text"] === "string") {
      text = payload["output_text"];
    } else if (Array.isArray(payload["output"])) {
      text = payload["output"]
        .flatMap((item) => (item && typeof item === "object" && Array.isArray((item as Record<string, unknown>)["content"]) ? ((item as Record<string, unknown>)["content"] as unknown[]) : []))
        .map((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>)["text"] === "string" ? ((part as Record<string, unknown>)["text"] as string) : ""))
        .join("");
    }
  } else if (req.providerId === "anthropic") {
    text = Array.isArray(payload["content"])
      ? payload["content"]
          .map((block) => (block && typeof block === "object" && typeof (block as Record<string, unknown>)["text"] === "string" ? ((block as Record<string, unknown>)["text"] as string) : ""))
          .join("")
      : "";
  } else {
    const candidates = Array.isArray(payload["candidates"]) ? payload["candidates"] : [];
    const first = candidates[0] && typeof candidates[0] === "object" ? (candidates[0] as Record<string, unknown>) : {};
    const content = first["content"] && typeof first["content"] === "object" ? (first["content"] as Record<string, unknown>) : {};
    const parts = Array.isArray(content["parts"]) ? content["parts"] : [];
    text = parts
      .map((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>)["text"] === "string" ? ((part as Record<string, unknown>)["text"] as string) : ""))
      .join("");
  }

  return parseGeneratedCheckJson(text);
}
