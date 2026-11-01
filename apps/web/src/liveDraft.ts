// One live model call that writes the text of a two-module syllabus and finds web resources for the
// topics the catalog does not cover. Each provider uses its own native web search tool.
// Raw fetch, not the provider SDKs: one request per provider does not justify three new dependencies.

export interface DraftActivity {
  readonly title: string;
  readonly prompt: string;
}

export interface DraftModule {
  readonly title: string;
  readonly summary: string;
  readonly objective: { readonly title: string; readonly description: string; readonly successCriterion: string };
  readonly read: DraftActivity;
  readonly practice: DraftActivity;
  readonly checkpoint: DraftActivity;
}

export const DRAFT_RESOURCE_CATEGORIES = ["Book", "Course", "YouTube", "Code Lab", "Problem Set"] as const;

export interface DraftResource {
  readonly title: string;
  readonly url: string;
  readonly publisher: string;
  readonly category: (typeof DRAFT_RESOURCE_CATEGORIES)[number];
  readonly topics: readonly string[];
  readonly sections: readonly string[];
}

export interface SyllabusDraft {
  readonly summary: string;
  readonly modules: readonly [DraftModule, DraftModule];
  readonly resources: readonly DraftResource[];
}

export type LiveDraftOutcome = { readonly draft: SyllabusDraft } | { readonly error: string };

export interface LiveDraftRequest {
  readonly providerId: string;
  readonly modelId: string;
  readonly prompt: string;
}

// The server reads each key from its own environment. Launch it with the keys loaded from Bitwarden.
export const PROVIDER_KEY_ENV: Readonly<Record<string, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google_gemini: "GEMINI_API_KEY",
};

const MAX_DRAFT_RESOURCES = 3;

export function buildLiveDraftPrompt(params: {
  readonly searchPrompt: string;
  readonly deltaTopics: readonly string[];
  readonly reusedTitles: readonly string[];
  readonly bypassedUrls: readonly string[];
}): string {
  const { searchPrompt, deltaTopics, reusedTitles, bypassedUrls } = params;
  const searchStep =
    deltaTopics.length > 0
      ? `Use web search to find at most ${MAX_DRAFT_RESOURCES} free, real study resources that cover these uncovered topics: ${deltaTopics.join(", ")}. Give each resource's canonical https URL. Do not return any URL in this list:\n${bypassedUrls.map((url) => `- ${url}`).join("\n") || "- none"}`
      : `Every requested topic is already covered. Do not search the web, and return an empty "resources" list.`;
  return `You write a two-module self-study syllabus for an adult learner.

<intake>
${searchPrompt}
</intake>

The learner keeps these catalog resources:
${reusedTitles.map((title) => `- ${title}`).join("\n") || "- none"}

${searchStep}

Module 1 builds the foundations. Module 2 applies them to the goal. Each prompt is one or two sentences that a learner can act on without more context. Write math in LaTeX between $ signs.

Reply with one JSON object and nothing else, in this shape:
{
  "summary": "one sentence",
  "modules": [
    {
      "title": "string",
      "summary": "string",
      "objective": { "title": "string", "description": "string", "successCriterion": "string" },
      "read": { "title": "string", "prompt": "string" },
      "practice": { "title": "string", "prompt": "string" },
      "checkpoint": { "title": "string", "prompt": "string" }
    },
    { "...": "module 2, same shape" }
  ],
  "resources": [
    { "title": "string", "url": "https://...", "publisher": "string", "category": "${DRAFT_RESOURCE_CATEGORIES.join(" | ")}", "topics": ["string"], "sections": ["chapter, unit, or video title"] }
  ]
}`;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`the draft has no ${field}`);
  return value.trim();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}

function activity(value: unknown, field: string): DraftActivity {
  const raw = (value ?? {}) as Record<string, unknown>;
  return { title: text(raw["title"], `${field} title`), prompt: text(raw["prompt"], `${field} prompt`) };
}

function draftModule(value: unknown, n: number): DraftModule {
  const raw = (value ?? {}) as Record<string, unknown>;
  const objective = (raw["objective"] ?? {}) as Record<string, unknown>;
  return {
    title: text(raw["title"], `module ${n} title`),
    summary: text(raw["summary"], `module ${n} summary`),
    objective: {
      title: text(objective["title"], `module ${n} objective title`),
      description: text(objective["description"], `module ${n} objective description`),
      successCriterion: text(objective["successCriterion"], `module ${n} success criterion`),
    },
    read: activity(raw["read"], `module ${n} read`),
    practice: activity(raw["practice"], `module ${n} practice`),
    checkpoint: activity(raw["checkpoint"], `module ${n} checkpoint`),
  };
}

// A resource without an http(s) URL or a known category is dropped. The modules must be complete.
function draftResource(value: unknown): DraftResource | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const category = DRAFT_RESOURCE_CATEGORIES.find((known) => known === raw["category"]);
  const title = typeof raw["title"] === "string" ? raw["title"].trim() : "";
  let url: URL | null = null;
  try {
    url = new URL(String(raw["url"]));
  } catch {
    return null;
  }
  if (!category || !title || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  return {
    title,
    url: url.href,
    publisher: typeof raw["publisher"] === "string" && raw["publisher"].trim() ? raw["publisher"].trim() : url.hostname,
    category,
    topics: strings(raw["topics"]),
    sections: strings(raw["sections"]),
  };
}

export function parseSyllabusDraft(reply: string): SyllabusDraft {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("the reply has no JSON object");
  const json = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
  const modules = json["modules"];
  if (!Array.isArray(modules) || modules.length !== 2) throw new Error("the draft does not have exactly two modules");
  return {
    summary: text(json["summary"], "summary"),
    modules: [draftModule(modules[0], 1), draftModule(modules[1], 2)],
    resources: (Array.isArray(json["resources"]) ? json["resources"] : [])
      .map(draftResource)
      .filter((resource): resource is DraftResource => resource !== null)
      .slice(0, MAX_DRAFT_RESOURCES),
  };
}

type Fetch = typeof fetch;

export type JsonObject = Readonly<Record<string, unknown>>;

export interface OpenAiContentPart {
  readonly type?: string;
  readonly text?: string;
}

export interface OpenAiOutputItem {
  readonly type?: string;
  readonly content?: readonly OpenAiContentPart[];
}

export interface OpenAiChatCompletionResponse {
  readonly output?: readonly OpenAiOutputItem[];
  readonly choices?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface AnthropicContentBlock {
  readonly type?: string;
  readonly text?: string;
}

export interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: unknown;
}

export interface AnthropicMessageResponse {
  readonly content?: readonly AnthropicContentBlock[];
  readonly stop_reason?: string;
  readonly [key: string]: unknown;
}

export interface GeminiPart {
  readonly text?: string;
}

export interface GeminiContent {
  readonly parts?: readonly GeminiPart[];
}

export interface GeminiCandidate {
  readonly content?: GeminiContent;
}

export interface GeminiGenerateContentResponse {
  readonly candidates?: readonly GeminiCandidate[];
  readonly [key: string]: unknown;
}

export function isJsonObject(val: unknown): val is JsonObject {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function isChatCompletionResponse(val: unknown): val is OpenAiChatCompletionResponse {
  return (
    isJsonObject(val) &&
    (("output" in val && Array.isArray(val.output)) ||
      ("choices" in val && Array.isArray(val.choices)))
  );
}

export function isAnthropicMessageResponse(val: unknown): val is AnthropicMessageResponse {
  return isJsonObject(val) && "content" in val && Array.isArray(val.content);
}

export function isGeminiGenerateContentResponse(val: unknown): val is GeminiGenerateContentResponse {
  return isJsonObject(val) && "candidates" in val && Array.isArray(val.candidates);
}

export function isOpenAiOutputItem(val: unknown): val is OpenAiOutputItem {
  return isJsonObject(val);
}

export function isOpenAiContentPart(val: unknown): val is OpenAiContentPart {
  return isJsonObject(val);
}

export function isAnthropicContentBlock(val: unknown): val is AnthropicContentBlock {
  return isJsonObject(val);
}

export function isGeminiCandidate(val: unknown): val is GeminiCandidate {
  return isJsonObject(val);
}

export function isGeminiPart(val: unknown): val is GeminiPart {
  return isJsonObject(val);
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (isJsonObject(payload) && "error" in payload) {
    const err = payload["error"];
    if (isJsonObject(err) && "message" in err) {
      const msg = err["message"];
      if (typeof msg === "string") return msg;
    }
  }
  return fallback;
}

async function postJson(
  fetchImpl: Fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<JsonObject> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || !isJsonObject(json)) {
    throw new Error(`${res.status} ${extractErrorMessage(json, res.statusText)}`);
  }
  return json;
}

const REPLY_TEXT: Readonly<Record<string, (request: LiveDraftRequest, apiKey: string, fetchImpl: Fetch) => Promise<string>>> = {
  // Responses API: the answer is the output_text content of the message items.
  async openai({ modelId, prompt }, apiKey, fetchImpl) {
    const raw = await postJson(fetchImpl, "https://api.openai.com/v1/responses", { authorization: `Bearer ${apiKey}` }, {
      model: modelId,
      input: prompt,
      tools: [{ type: "web_search" }],
    });
    const json: OpenAiChatCompletionResponse = isChatCompletionResponse(raw) ? raw : {};
    const output = Array.isArray(json.output) ? json.output : [];
    return output
      .filter(isOpenAiOutputItem)
      .filter((item) => item.type === "message")
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter(isOpenAiContentPart)
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("");
  },

  // Messages API. web_search_20250305 is the variant that Claude Haiku 5.5 accepts. A long search can
  // pause the turn, so the paused content goes back until the model ends the turn.
  async anthropic({ modelId, prompt }, apiKey, fetchImpl) {
    const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];
    for (let turn = 0; turn < 3; turn += 1) {
      const raw = await postJson(fetchImpl, "https://api.anthropic.com/v1/messages", { "x-api-key": apiKey, "anthropic-version": "2026-10-21" }, {
        model: modelId,
        max_tokens: 16000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_DRAFT_RESOURCES }],
        messages,
      });
      const json: AnthropicMessageResponse = isAnthropicMessageResponse(raw) ? raw : {};
      if (json.stop_reason === "refusal") throw new Error("the model declined the request");
      if (json.stop_reason !== "pause_turn") {
        const content = Array.isArray(json.content) ? json.content : [];
        return content
          .filter(isAnthropicContentBlock)
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text ?? "")
          .join("");
      }
      messages.push({ role: "assistant", content: json.content });
    }
    throw new Error("the web search did not finish in 3 turns");
  },

  // generateContent with Google Search grounding: the answer is the text parts of the first candidate.
  async google_gemini({ modelId, prompt }, apiKey, fetchImpl) {
    const raw = await postJson(
      fetchImpl,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
      { "x-goog-api-key": apiKey },
      { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }] },
    );
    const json: GeminiGenerateContentResponse = isGeminiGenerateContentResponse(raw) ? raw : {};
    const candidates = Array.isArray(json.candidates) ? json.candidates : [];
    const firstCandidate = candidates.find(isGeminiCandidate);
    const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];
    return parts
      .filter(isGeminiPart)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  },
};

export async function requestLiveDraft(request: LiveDraftRequest, apiKey: string, fetchImpl: Fetch = fetch): Promise<SyllabusDraft> {
  const replyText = REPLY_TEXT[request.providerId];
  if (!replyText) throw new Error(`no live client for provider ${request.providerId}`);
  return parseSyllabusDraft(await replyText(request, apiKey, fetchImpl));
}
