import test from "node:test";
import assert from "node:assert/strict";
import { createCurriculumWebAppController } from "../src/browserApp.ts";
import { buildIndexedMaterialCandidates, CHEAP_MODEL_BY_PROVIDER } from "../src/components/NewCurriculumDialog.tsx";
import { parseCurriculumDraft, requestLiveDraft } from "../src/liveDraft.ts";
import { buildTfidfIndex, searchTfidf, tokenize } from "../src/tfidfIndex.ts";

const module = (n) => ({
  title: `Module ${n}: Narrative voice`,
  summary: "Free indirect style in Tolstoy.",
  objective: { title: "Trace narrative voice", description: "Follow how the narrator enters a mind.", successCriterion: "Annotate three passages." },
  read: { title: "Read: Book 1", prompt: "Mark each shift into a character's thoughts." },
  practice: { title: "Close reading", prompt: "Compare two shifts in one chapter." },
  checkpoint: { title: "Checkpoint", prompt: "Explain one shift in your own words." },
});
const DRAFT = {
  summary: "A close reading of narrative voice in War and Peace.",
  modules: [module(1), module(2)],
  resources: [
    {
      title: "Free Indirect Discourse in the Russian Novel",
      url: "https://open.example.edu/courses/free-indirect-discourse",
      publisher: "Open Example University",
      category: "Course",
      topics: ["Narrative"],
      sections: ["Unit 1: Voice and focalization", "Unit 2: Tolstoy's narrator"],
    },
  ],
};

test("MiniSearch TF-IDF/BM25 index ranks by shared distinctive terms", () => {
  assert.deepEqual(tokenize("The Wakers of \\mathrm{Async} systems"), ["waker", "async", "system"]);
  assert.deepEqual(tokenize("Œuvres complètes"), ["œuvre", "complete"]);
  const index = buildTfidfIndex({
    rag: "Retrieval augmented generation in Python with recall evaluation",
    rust: "Async Rust executors, wakers, and work stealing",
    tolstoy: "Narrative voice in Tolstoy's War and Peace",
  });
  assert.equal(index.engine.documentCount, 3);
  assert.ok((index.termCounts.get("rust") ?? 0) >= 5);
  assert.deepEqual(searchTfidf(index, "rust async wakers").map((hit) => hit.id), ["rust"]);
  assert.deepEqual(searchTfidf(index, "unknown words only"), []);
});

test("parseCurriculumDraft keeps a complete draft and drops resources that fail validation", () => {
  const reply = `Here is the plan:\n${JSON.stringify({
    ...DRAFT,
    resources: [...DRAFT.resources, { ...DRAFT.resources[0], url: "javascript:alert(1)" }, { ...DRAFT.resources[0], category: "Podcast" }],
  })}`;
  const draft = parseCurriculumDraft(reply);
  assert.equal(draft.modules[1].objective.successCriterion, "Annotate three passages.");
  assert.deepEqual(draft.resources.map((r) => r.url), ["https://open.example.edu/courses/free-indirect-discourse"]);
  assert.throws(() => parseCurriculumDraft(JSON.stringify({ ...DRAFT, modules: [module(1)] })), /exactly two modules/);
  assert.throws(() => parseCurriculumDraft("no json here"), /no JSON object/);
});

test("requestLiveDraft sends each provider's native web search request and reads its reply", async () => {
  const reply = JSON.stringify(DRAFT);
  const replies = {
    "api.openai.com": { output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: reply }] }] },
    "api.anthropic.com": { stop_reason: "end_turn", content: [{ type: "server_tool_use" }, { type: "web_search_tool_result" }, { type: "text", text: reply }] },
    "generativelanguage.googleapis.com": { candidates: [{ content: { parts: [{ text: reply }] } }] },
  };
  const sent = [];
  const fetchStub = async (url, init) => {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(replies[new URL(url).hostname]), { status: 200 });
  };
  for (const providerId of ["openai", "anthropic", "google_gemini"]) {
    const draft = await requestLiveDraft({ providerId, modelId: CHEAP_MODEL_BY_PROVIDER[providerId], prompt: "p" }, "test-key", fetchStub);
    assert.equal(draft.resources.length, 1);
  }
  const [openai, anthropic, gemini] = sent;
  assert.deepEqual([openai.body.model, openai.body.tools, openai.headers.authorization], ["gpt-6-luna", [{ type: "web_search" }], "Bearer test-key"]);
  assert.deepEqual([anthropic.body.model, anthropic.body.tools[0].type, anthropic.headers["x-api-key"]], ["claude-haiku-5-5", "web_search_20250305", "test-key"]);
  assert.equal("temperature" in anthropic.body, false, "API version 2026-10-21 rejects sampling fields");
  assert.equal(gemini.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  assert.deepEqual([gemini.body.tools, gemini.headers["x-goog-api-key"]], [[{ google_search: {} }], "test-key"]);

  const failing = async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
  await assert.rejects(requestLiveDraft({ providerId: "anthropic", modelId: "claude-haiku-5-5", prompt: "p" }, "bad", failing), /401 invalid x-api-key/);
});

test("a live draft writes the plan, and its resources are indexed and searchable at once", () => {
  const app = createCurriculumWebAppController({});
  // Generation defaults to the cheapest model of the primary provider.
  assert.deepEqual(app.getState().providerModels, CHEAP_MODEL_BY_PROVIDER);
  app.applyUiAction("set-intake-goal", { intakeGoalTitle: "Close reading of narrative voice in Tolstoy" });
  assert.equal(app.getState().intakeSubject, "Literature");

  const request = app.liveGenerationRequest();
  assert.deepEqual([request.providerId, request.modelId], ["openai", "gpt-6-luna"]);
  assert.ok(request.prompt.includes("GOAL: Close reading of narrative voice in Tolstoy"));

  // A failed call creates nothing and says why.
  app.applyUiAction("generate-curriculum-ai", {}, null, { error: "429 rate limited" });
  assert.equal(app.getState().generatedPlans.length, 0);
  assert.equal(app.getState().intakeNote, "Live generation with gpt-6-luna failed: 429 rate limited. No curriculum was created.");

  app.applyUiAction("generate-curriculum-ai", {}, null, { draft: DRAFT });
  const state = app.getState();
  const plan = state.generatedPlans[0];
  assert.equal(plan.curriculumId, "curriculum-ai-generated-001");
  assert.equal(plan.curriculum.goal.summary, DRAFT.summary);
  assert.deepEqual(plan.curriculum.activities.map((a) => a.type), ["theory", "worked_example", "quiz", "theory", "worked_example", "quiz"], "Literature practises on worked examples, not code labs");
  assert.ok(state.lastPipelineReceipt.liveDraft);
  assert.ok(state.lastPipelineReceipt.summaryNote.startsWith("Live draft from OpenAI · GPT-6 Luna (Lightweight)."));

  const [newId] = state.lastPipelineReceipt.newlyIndexedResourceIds;
  assert.match(newId, /^discovered-free-indirect-discourse-in-the-russian-novel-[0-9a-z]+$/);
  assert.equal(state.catalogResources[newId].vector_index.index_type, "tfidf-cosine-v1");
  assert.equal(state.catalogResources[newId].access.access_verified_at, undefined, "a web result's access stays unverified");
  // The next intake finds the new resource by its section titles, with no redeploy and no embedding call.
  const hit = buildIndexedMaterialCandidates(state.catalogResources, "Literature", [], "free_only", "focalization and free indirect discourse")[0];
  assert.equal(hit.resourceVersionId, newId);
  assert.ok(hit.matchScore > 0.3);

  // A second plan gets new plan and activity ids, so it never overwrites the first.
  app.applyUiAction("generate-curriculum-ai", {}, null, { draft: DRAFT });
  const ids = app.getState().generatedPlans.map((p) => p.curriculumId);
  assert.deepEqual(ids, ["curriculum-ai-generated-001", "curriculum-ai-generated-002"]);
  assert.equal(app.getState().lastPipelineReceipt.newlyIndexedResourceIds.length, 0, "a known URL is reused, not indexed twice");
});
