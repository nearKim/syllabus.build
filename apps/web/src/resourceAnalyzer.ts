/**
 * Manual Learning Resource Analyzer & Syllabus Resource Mutation Engine.
 *
 * Parses free-form learner inputs combining a URL (with or without `https://`) and natural-language notes
 * (e.g. `"udemy.com/course/ckad-kubernetes this is the ckad course covering pods, deployments, helm"`),
 * safely inspects live HTML metadata/headings when reachable (SSRF-guarded), runs structured AI analysis
 * via OpenAI / Anthropic / Google Gemini when an API key is configured (with a deterministic domain-aware
 * fallback when offline or unconfigured), and builds a normalized `CatalogResourceMetadataInput` ready
 * for immediate DB persistence, MiniSearch TF-IDF indexing, and per-syllabus `add` / `edit` / `delete`.
 */

import type { CatalogResourceMetadataInput } from "../../../packages/ui/src/index.ts";
import { TFIDF_ENGINE, tokenize } from "./tfidfIndex.ts";

export type ManualResourceCategory = "Course" | "Book" | "YouTube" | "Code Lab" | "Problem Set";
export type ManualResourceSubject = "Engineering" | "Systems" | "Mathematics" | "Physics" | "Literature";
export type ManualResourceAccessModel = "free" | "freemium_optional_certificate" | "paid" | "library_loan";

export interface ParsedFreeFormResourceInput {
  readonly canonicalUrl: string;
  readonly host: string;
  readonly rawUrlToken: string;
  readonly userNotes: string;
}

export interface InspectedUrlPageInternals {
  readonly fetchedLive: boolean;
  readonly pageTitle: string | null;
  readonly siteName: string | null;
  readonly description: string | null;
  readonly headings: readonly string[];
  readonly jsonLdType: string | null;
}

export interface AnalyzedManualResourceDraft {
  readonly resourceVersionId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly publisher: string;
  readonly providerId: string;
  readonly category: ManualResourceCategory;
  readonly subject: ManualResourceSubject;
  readonly accessModel: ManualResourceAccessModel;
  readonly tierLabel: string;
  readonly costLabel: string;
  readonly priceMinorUnits: number;
  readonly selectionRationale: string;
  readonly description: string;
  readonly topics: readonly string[];
  readonly segments: readonly { readonly segment_id: string; readonly title: string; readonly verified: boolean }[];
  readonly analyzedBy: "ai" | "deterministic";
  readonly fetchedPageInternals: boolean;
}

const UPPER_ACRONYMS = new Set([
  "ckad", "cka", "cks", "k8s", "aws", "gcp", "rag", "llm", "llms", "svd", "pca",
  "sql", "api", "rest", "grpc", "gpu", "cuda", "nlp", "ml", "ai", "ebpf", "sre",
  "ci", "cd", "mit", "html", "css", "dom", "tcp", "udp", "http", "https", "tls",
]);

const GENERIC_SLUGS = new Set([
  "blah", "blahblah", "course", "courses", "learn", "watch", "playlist",
  "index", "index.html", "view", "item", "page", "home", "default",
]);

const NOTE_FILLER = new Set([
  "this", "is", "the", "a", "an", "for", "with", "and", "about", "blah", "blahblah",
  "my", "here", "link", "url", "good", "great", "nice", "covering", "covers", "that",
  "from", "into", "very", "useful", "helpful",
]);

function titleCaseToken(word: string): string {
  const lower = word.toLowerCase();
  if (UPPER_ACRONYMS.has(lower)) return lower.toUpperCase();
  if (lower === "kubernetes") return "Kubernetes";
  if (lower === "python") return "Python";
  if (lower === "rust") return "Rust";
  if (lower === "youtube") return "YouTube";
  if (lower === "github") return "GitHub";
  if (lower === "arxiv") return "arXiv";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function titleCasePhrase(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
}

/**
 * Checks whether a hostname is safe for public HTTPS egress (rejecting localhost, `.local`,
 * `.internal`, `.invalid`, IPv6 literals, and private/loopback/link-local/metadata IPv4 literals).
 */
export function isSafePublicHttpsUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;

  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes(".")) return false;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".invalid") ||
    host.includes(":")
  ) {
    return false;
  }

  const ipv4Parts = host.split(".");
  if (ipv4Parts.every((p) => /^\d+$/.test(p))) {
    // Reject all raw IPv4 literals for catalog resources (prevents 127.0.0.1, 10.*, 169.254.169.254, etc.)
    return false;
  }
  return true;
}

function looksLikeDomainToken(token: string): boolean {
  if (/^https?:\/\//i.test(token)) return true;
  if (token.includes("@") || token.startsWith("/") || token.startsWith(".")) return false;
  const hostPart = token.split(/[/?#]/)[0] ?? "";
  const labels = hostPart.split(".");
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1] ?? "";
  if (!/^[a-z]{2,12}$/i.test(tld)) return false;
  return labels.every((label) => /^[a-z0-9-]+$/i.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}

/**
 * Extracts and normalizes a URL (bare domain or `http(s)://`) and remaining free-form learner notes.
 */
export function parseFreeFormResourceInput(
  rawText: string,
  explicitUrl?: string | undefined,
): ParsedFreeFormResourceInput | { readonly error: string } {
  if (explicitUrl && explicitUrl.trim()) {
    const candidate = normalizeToHttps(explicitUrl.trim());
    if (!candidate || !isSafePublicHttpsUrl(candidate)) {
      return { error: "Enter a valid public HTTPS URL (for example https://udemy.com/course/...)." };
    }
    const parsed = new URL(candidate);
    return {
      canonicalUrl: stripTrackingParams(parsed),
      host: parsed.hostname.toLowerCase(),
      rawUrlToken: explicitUrl.trim(),
      userNotes: rawText.trim(),
    };
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return { error: "Paste a URL with optional notes (for example udemy.com/course/ckad this is the CKAD course)." };
  }

  const tokens = trimmed.split(/\s+/);
  let matchedRawToken: string | null = null;
  let cleanedUrlToken: string | null = null;

  for (const token of tokens) {
    const stripped = token.replace(/^[([<"']+|[)\]>,"';]+$/g, "").replace(/[.:!?]+$/g, "");
    if (looksLikeDomainToken(stripped)) {
      matchedRawToken = token;
      cleanedUrlToken = stripped;
      break;
    }
  }

  if (!matchedRawToken || !cleanedUrlToken) {
    return {
      error: "Include a resource URL or domain (for example udemy.com/course/... or youtube.com/watch?v=...).",
    };
  }

  const normalized = normalizeToHttps(cleanedUrlToken);
  if (!normalized || !isSafePublicHttpsUrl(normalized)) {
    return {
      error: "Only public external domains are allowed (private, local, and internal network URLs are blocked).",
    };
  }

  const parsed = new URL(normalized);
  const userNotes = trimmed
    .replace(matchedRawToken, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    canonicalUrl: stripTrackingParams(parsed),
    host: parsed.hostname.toLowerCase(),
    rawUrlToken: matchedRawToken,
    userNotes,
  };
}

function normalizeToHttps(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed)) return `https://${trimmed.slice(7)}`;
  return `https://${trimmed}`;
}

function stripTrackingParams(url: URL): string {
  const copy = new URL(url.toString());
  for (const key of [...copy.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref$|si$)/i.test(key)) {
      copy.searchParams.delete(key);
    }
  }
  copy.hash = "";
  const formatted = copy.toString();
  return formatted.endsWith("/") && copy.pathname !== "/" ? formatted.slice(0, -1) : formatted;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
}

/**
 * Safely fetches up to 128 KB of HTML metadata (`<title>`, OpenGraph tags, meta description,
 * JSON-LD learning schema, and `<h1>`–`<h3>` syllabus headings) with a 3.2s timeout.
 * Never throws: returns `{ fetchedLive: false, ... }` when offline or blocked by the remote host.
 */
export async function inspectUrlPageInternals(
  canonicalUrl: string,
  fetchImpl: typeof fetch | undefined = globalThis.fetch,
): Promise<InspectedUrlPageInternals> {
  const empty: InspectedUrlPageInternals = {
    fetchedLive: false,
    pageTitle: null,
    siteName: null,
    description: null,
    headings: [],
    jsonLdType: null,
  };
  if (!fetchImpl || !isSafePublicHttpsUrl(canonicalUrl)) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3200);
  try {
    const res = await fetchImpl(canonicalUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "user-agent": "SyllabusResourceIndexer/1.0 (+https://syllabus.study)",
      },
    });
    if (!res.ok) return empty;
    if (res.url && !isSafePublicHttpsUrl(res.url)) return empty;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return empty;

    const fullText = await res.text();
    const html = fullText.slice(0, 131_072);

    const extractMeta = (pattern: RegExp): string | null => {
      const m = pattern.exec(html);
      const val = m?.[1] ? decodeHtmlEntities(m[1]) : "";
      return val.length >= 2 ? val.slice(0, 320) : null;
    };

    const ogTitle =
      extractMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
      extractMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const rawTitleTag = extractMeta(/<title[^>]*>([^<]+)<\/title>/i);
    const siteName =
      extractMeta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ??
      extractMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
    const description =
      extractMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
      extractMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      extractMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

    let jsonLdType: string | null = null;
    let jsonLdTitle: string | null = null;
    let jsonLdDesc: string | null = null;
    const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldMatch: RegExpExecArray | null;
    while ((ldMatch = ldRegex.exec(html)) !== null) {
      try {
        const parsedLd = JSON.parse(ldMatch[1] ?? "{}") as Record<string, unknown>;
        const node = Array.isArray(parsedLd["@graph"])
          ? (parsedLd["@graph"][0] as Record<string, unknown> | undefined)
          : parsedLd;
        if (node && typeof node["@type"] === "string") {
          jsonLdType = node["@type"];
          if (typeof node["name"] === "string" && !jsonLdTitle) jsonLdTitle = decodeHtmlEntities(node["name"]);
          if (typeof node["description"] === "string" && !jsonLdDesc) {
            jsonLdDesc = decodeHtmlEntities(node["description"]).slice(0, 360);
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks on third-party pages.
      }
    }

    const headings: string[] = [];
    const headingRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 8) {
      const text = stripTags(hMatch[1] ?? "");
      if (text.length >= 4 && text.length <= 110 && !headings.includes(text)) {
        headings.push(text);
      }
    }

    const pageTitle = jsonLdTitle ?? ogTitle ?? rawTitleTag;
    return {
      fetchedLive: Boolean(pageTitle || description || headings.length > 0),
      pageTitle,
      siteName,
      description: jsonLdDesc ?? description,
      headings,
      jsonLdType,
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

interface DomainRule {
  readonly providerId: string;
  readonly publisher: string;
  readonly category: ManualResourceCategory;
  readonly accessModel: ManualResourceAccessModel;
  readonly priceMinorUnits: number;
}

function classifyDomain(host: string, urlPath: string, notesLower: string): DomainRule {
  const base = host.replace(/^www\./, "");
  if (base.endsWith("udemy.com")) {
    return { providerId: "udemy", publisher: "Udemy", category: "Course", accessModel: "paid", priceMinorUnits: 1999 };
  }
  if (base.endsWith("coursera.org")) {
    return {
      providerId: "coursera",
      publisher: "Coursera",
      category: "Course",
      accessModel: "freemium_optional_certificate",
      priceMinorUnits: 4900,
    };
  }
  if (base.endsWith("edx.org")) {
    return {
      providerId: "edx",
      publisher: "edX",
      category: "Course",
      accessModel: "freemium_optional_certificate",
      priceMinorUnits: 4900,
    };
  }
  if (base.endsWith("youtube.com") || base === "youtu.be") {
    return { providerId: "youtube", publisher: "YouTube", category: "YouTube", accessModel: "free", priceMinorUnits: 0 };
  }
  if (base.endsWith("github.com") || base.endsWith("gitlab.com")) {
    return { providerId: "github", publisher: "GitHub", category: "Code Lab", accessModel: "free", priceMinorUnits: 0 };
  }
  if (base.endsWith("arxiv.org")) {
    return { providerId: "arxiv", publisher: "arXiv", category: "Book", accessModel: "free", priceMinorUnits: 0 };
  }
  if (base.endsWith("oreilly.com")) {
    return { providerId: "oreilly", publisher: "O'Reilly", category: "Book", accessModel: "paid", priceMinorUnits: 4900 };
  }
  if (base.endsWith("ocw.mit.edu")) {
    return {
      providerId: "mit-ocw",
      publisher: "MIT OpenCourseWare",
      category: "Course",
      accessModel: "free",
      priceMinorUnits: 0,
    };
  }
  if (base.endsWith("deeplearning.ai")) {
    return {
      providerId: "deeplearning-ai",
      publisher: "DeepLearning.AI",
      category: "Course",
      accessModel: "freemium_optional_certificate",
      priceMinorUnits: 0,
    };
  }
  if (base.endsWith("kubernetes.io")) {
    return {
      providerId: "kubernetes-docs",
      publisher: "Kubernetes Documentation",
      category: "Book",
      accessModel: "free",
      priceMinorUnits: 0,
    };
  }
  if (base.endsWith("leetcode.com") || base.endsWith("exercism.org") || base.endsWith("kaggle.com")) {
    return {
      providerId: `practice-${base.split(".")[0]}`,
      publisher: titleCaseToken(base.split(".")[0] ?? "Practice"),
      category: "Problem Set",
      accessModel: "free",
      priceMinorUnits: 0,
    };
  }

  const root = base.split(".")[0] ?? "web";
  const category: ManualResourceCategory =
    /\/course|\/learn|course|bootcamp|specialization/i.test(`${urlPath} ${notesLower}`)
      ? "Course"
      : /video|youtube|lecture|playlist/i.test(`${urlPath} ${notesLower}`)
        ? "YouTube"
        : /lab|repo|sandbox|hands-on/i.test(`${urlPath} ${notesLower}`)
          ? "Code Lab"
          : /problem|exercise|drill|exam|practice/i.test(`${urlPath} ${notesLower}`)
            ? "Problem Set"
            : "Book";
  const isPaid = /\bpaid\b|\$\d+|subscription/i.test(notesLower) && !/\bfree\b/i.test(notesLower);
  return {
    providerId: `manual-${root}`,
    publisher: titleCaseToken(root),
    category,
    accessModel: isPaid ? "paid" : "free",
    priceMinorUnits: isPaid ? 1999 : 0,
  };
}

export function inferSubjectFromResourceText(text: string): ManualResourceSubject {
  const lower = text.toLowerCase();
  if (/\b(rust|async|waker|concurrency|kernel|linux|kubernetes|k8s|ckad|cka|cks|docker|helm|container|distributed|ebpf|cilium|systems)\b/.test(lower)) {
    return "Systems";
  }
  if (/\b(linear algebra|eigen|svd|singular value|spectral|matrix|calculus|proof|theorem|mathematics|math)\b/.test(lower)) {
    return "Mathematics";
  }
  if (/\b(thermodynamics|ensemble|ising|phase transition|boltzmann|quantum|physics|statistical mechanics)\b/.test(lower)) {
    return "Physics";
  }
  if (/\b(tolstoy|realism|narrative|novel|literature|close reading|karenina)\b/.test(lower)) {
    return "Literature";
  }
  return "Engineering";
}

function shortStableHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(36).slice(0, 8);
}

export function formatAccessLabels(
  accessModel: ManualResourceAccessModel,
  explicitCostLabel?: string | undefined,
  priceMinorUnits = 0,
): { readonly tierLabel: string; readonly costLabel: string } {
  const tierLabel =
    accessModel === "freemium_optional_certificate"
      ? "Freemium"
      : accessModel === "library_loan"
        ? "Library Loan"
        : accessModel === "paid"
          ? "Paid"
          : "Free";
  if (explicitCostLabel && explicitCostLabel.trim()) {
    return { tierLabel, costLabel: explicitCostLabel.trim() };
  }
  const costLabel =
    accessModel === "free"
      ? "$0"
      : accessModel === "library_loan"
        ? "Institutional / Loan"
        : accessModel === "freemium_optional_certificate"
          ? "Core $0 · Cert $49"
          : priceMinorUnits > 0
            ? `$${(priceMinorUnits / 100).toFixed(2).replace(/\.00$/, "")}`
            : "Paid";
  return { tierLabel, costLabel };
}

/**
 * Deterministic analyzer used both as a fast pre-structured baseline and as the zero-latency
 * fallback when no live LLM key is configured or offline.
 */
export function analyzeManualResourceDeterministic(params: {
  readonly parsed: ParsedFreeFormResourceInput;
  readonly pageInternals?: InspectedUrlPageInternals | undefined;
  readonly existingResourceId?: string | undefined;
}): AnalyzedManualResourceDraft {
  const { parsed, pageInternals, existingResourceId } = params;
  const parsedUrl = new URL(parsed.canonicalUrl);
  const notesLower = parsed.userNotes.toLowerCase();
  const domainRule = classifyDomain(parsed.host, parsedUrl.pathname, notesLower);

  let accessModel = domainRule.accessModel;
  let priceMinorUnits = domainRule.priceMinorUnits;
  if (/\bfree\b|\bopen access\b|\$0\b/i.test(parsed.userNotes)) {
    accessModel = "free";
    priceMinorUnits = 0;
  } else if (/\bfreemium\b|\bfree audit\b/i.test(parsed.userNotes)) {
    accessModel = "freemium_optional_certificate";
    priceMinorUnits = 4900;
  } else if (/\blibrary\b/i.test(parsed.userNotes)) {
    accessModel = "library_loan";
    priceMinorUnits = 0;
  }

  let category = domainRule.category;
  if (pageInternals?.jsonLdType) {
    if (/VideoObject/i.test(pageInternals.jsonLdType)) category = "YouTube";
    else if (/Course/i.test(pageInternals.jsonLdType)) category = "Course";
    else if (/Book/i.test(pageInternals.jsonLdType)) category = "Book";
    else if (/SoftwareSourceCode/i.test(pageInternals.jsonLdType)) category = "Code Lab";
  }

  const publisher = pageInternals?.siteName?.trim() || domainRule.publisher;

  // Synthesize clean title: prefer live page title -> meaningful URL slug -> meaningful user note tokens.
  const cleanedLiveTitle = pageInternals?.pageTitle
    ?.replace(/\s*[|\-–—]\s*(Udemy|Coursera|YouTube|GitHub|edX|O'Reilly).*$/i, "")
    .trim();

  const pathSegments = parsedUrl.pathname
    .split("/")
    .map((s) => decodeURIComponent(s).trim())
    .filter((s) => s.length > 0 && !GENERIC_SLUGS.has(s.toLowerCase()));
  const lastSlug = pathSegments[pathSegments.length - 1] ?? "";
  const slugWords = lastSlug
    .split(/[-_+]+/)
    .filter((w) => w.length > 0 && !/^\d+$/.test(w) && !GENERIC_SLUGS.has(w.toLowerCase()))
    .map(titleCaseToken);

  const noteTokens = parsed.userNotes
    .split(/[^a-zA-Z0-9+#-]+/)
    .filter((w) => w.length >= 2 && !NOTE_FILLER.has(w.toLowerCase()))
    .slice(0, 6)
    .map(titleCaseToken);

  const title =
    (cleanedLiveTitle && cleanedLiveTitle.length >= 4 ? cleanedLiveTitle : null) ??
    (slugWords.length >= 2 ? slugWords.join(" ") : null) ??
    (noteTokens.length >= 2 ? noteTokens.join(" ") : null) ??
    (slugWords.length === 1 && noteTokens.length >= 1
      ? Array.from(new Set([...slugWords, ...noteTokens])).join(" ")
      : null) ??
    (noteTokens[0] ? `${noteTokens[0]} ${category}` : `${publisher} ${category}`);

  const combinedText = [title, parsed.userNotes, pageInternals?.description ?? "", ...(pageInternals?.headings ?? [])].join(" ");
  const subject = inferSubjectFromResourceText(combinedText);

  // Extract clean topic tags for TF-IDF indexing.
  const topicSet = new Set<string>();
  if (/\bckad\b/i.test(combinedText)) {
    topicSet.add("CKAD");
    topicSet.add("Kubernetes");
  }
  if (/\bcka\b/i.test(combinedText)) {
    topicSet.add("CKA");
    topicSet.add("Kubernetes");
  }
  if (/\bk8s\b|\bkubernetes\b/i.test(combinedText)) topicSet.add("Kubernetes");
  if (/\brag\b/i.test(combinedText)) topicSet.add("RAG");
  if (/\bsvd\b/i.test(combinedText)) topicSet.add("SVD");
  if (/\brust\b/i.test(combinedText)) topicSet.add("Rust");
  if (/\bpython\b/i.test(combinedText)) topicSet.add("Python");

  const rawWords = combinedText
    .split(/[^a-zA-Z0-9+#-]+/)
    .map((w) => w.replace(/^-+|-+$/g, "").toLowerCase())
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC_SLUGS.has(w) && !NOTE_FILLER.has(w));
  for (const word of rawWords) {
    const candidate = titleCaseToken(word);
    const lowerCandidate = candidate.toLowerCase();
    const alreadyCovered = [...topicSet].some((existing) => {
      const ex = existing.toLowerCase();
      return ex === lowerCandidate || (ex.length >= 4 && lowerCandidate.length >= 4 && (ex.startsWith(lowerCandidate) || lowerCandidate.startsWith(ex)));
    });
    if (!alreadyCovered) {
      topicSet.add(candidate);
      if (topicSet.size >= 8) break;
    }
  }
  const topics = topicSet.size > 0 ? [...topicSet] : [subject];

  // Build syllabus segments from live HTML headings or comma-listed clauses in learner notes.
  const segmentTitles: string[] = [];
  if (pageInternals?.headings && pageInternals.headings.length > 0) {
    for (const h of pageInternals.headings.slice(0, 5)) {
      if (h.toLowerCase() !== title.toLowerCase()) segmentTitles.push(h);
    }
  }
  if (segmentTitles.length === 0) {
    const clauseMatch = /(?:covering|covers|topics?:|includes?|sections?:)\s+(.+)/i.exec(parsed.userNotes);
    if (clauseMatch?.[1]) {
      for (const item of clauseMatch[1].split(/[,;]+/)) {
        const clean = item.replace(/^\s*and\s+/i, "").replace(/[.!?]+$/, "").trim();
        if (clean.length >= 3 && !/\bblah/i.test(clean)) {
          segmentTitles.push(titleCasePhrase(clean));
        }
      }
    }
  }
  if (segmentTitles.length === 0) {
    segmentTitles.push(`${title} — Foundations & Core Concepts`);
    if (topics.length >= 2) {
      segmentTitles.push(`Applied ${topics.slice(0, 2).join(" & ")}`);
    }
  }

  const cleanedNotes = parsed.userNotes.replace(/\bblah(?:blah)?\b/gi, "").replace(/\s+/g, " ").trim();
  const selectionRationale =
    cleanedNotes.length >= 6
      ? cleanedNotes.charAt(0).toUpperCase() + cleanedNotes.slice(1)
      : pageInternals?.description ??
        `${category} from ${publisher} covering ${topics.slice(0, 4).join(", ")}.`;

  const description = [
    selectionRationale,
    pageInternals?.description && pageInternals.description !== selectionRationale ? pageInternals.description : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 480);

  const slugId = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 4)
    .join("-") || "resource";
  const resourceVersionId = existingResourceId ?? `manual-${slugId}-${shortStableHash(parsed.canonicalUrl.toLowerCase())}-v1`;

  const { tierLabel, costLabel } = formatAccessLabels(accessModel, undefined, priceMinorUnits);

  return {
    resourceVersionId,
    canonicalUrl: parsed.canonicalUrl,
    title,
    publisher,
    providerId: domainRule.providerId,
    category,
    subject,
    accessModel,
    tierLabel,
    costLabel,
    priceMinorUnits,
    selectionRationale,
    description,
    topics,
    segments: segmentTitles.slice(0, 6).map((segTitle, idx) => ({
      segment_id: `seg-manual-${idx + 1}`,
      title: segTitle,
      verified: Boolean(pageInternals?.fetchedLive),
    })),
    analyzedBy: "deterministic",
    fetchedPageInternals: Boolean(pageInternals?.fetchedLive),
  };
}

const AI_RESOURCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "publisher",
    "category",
    "subject",
    "accessModel",
    "costLabel",
    "selectionRationale",
    "topics",
    "segments",
  ],
  properties: {
    title: { type: "string" },
    publisher: { type: "string" },
    category: { type: "string", enum: ["Course", "Book", "YouTube", "Code Lab", "Problem Set"] },
    subject: { type: "string", enum: ["Engineering", "Systems", "Mathematics", "Physics", "Literature"] },
    accessModel: { type: "string", enum: ["free", "freemium_optional_certificate", "paid", "library_loan"] },
    costLabel: { type: "string" },
    selectionRationale: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    segments: { type: "array", items: { type: "string" } },
  },
} as const;

/**
 * Runs live AI analysis (OpenAI / Anthropic / Google Gemini) over the URL, inspected HTML page internals,
 * and free-form learner notes, seamlessly falling back to `analyzeManualResourceDeterministic` if no key
 * is configured or the provider call fails.
 */
export async function analyzeManualResourceWithAi(params: {
  readonly rawText: string;
  readonly explicitUrl?: string | undefined;
  readonly existingResourceId?: string | undefined;
  readonly providerId?: string | undefined;
  readonly modelId?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}): Promise<AnalyzedManualResourceDraft | { readonly error: string }> {
  const parsed = parseFreeFormResourceInput(params.rawText, params.explicitUrl);
  if ("error" in parsed) return parsed;

  const pageInternals = await inspectUrlPageInternals(parsed.canonicalUrl, params.fetchImpl);
  const baseline = analyzeManualResourceDeterministic({
    parsed,
    pageInternals,
    existingResourceId: params.existingResourceId,
  });

  const apiKey = params.apiKey?.trim();
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  if (!apiKey || !params.providerId || !fetchFn) {
    return baseline;
  }

  const prompt = [
    "Analyze this learning resource submitted by a self-directed learner and return a structured JSON catalog entry.",
    `CANONICAL_URL: ${parsed.canonicalUrl}`,
    `LEARNER_NOTES: ${parsed.userNotes || "(none)"}`,
    `PAGE_TITLE: ${pageInternals.pageTitle ?? "(not fetched)"}`,
    `PAGE_SITE_NAME: ${pageInternals.siteName ?? "(unknown)"}`,
    `PAGE_DESCRIPTION: ${pageInternals.description ?? "(not fetched)"}`,
    `PAGE_HEADINGS: ${pageInternals.headings.join(" | ") || "(none)"}`,
    "Rules:",
    "- Write a clean, accurate resource `title` (expand acronyms like CKAD -> Certified Kubernetes Application Developer (CKAD) when clear from URL/notes; drop filler words like 'blah').",
    "- Summarize why this resource is useful in `selectionRationale` (1-2 concise sentences grounded in the URL, page metadata, and learner notes).",
    "- Provide 3-7 concise `topics` and 2-5 syllabus `segments` (chapters, units, or lab topics).",
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    let rawJsonText: string | null = null;
    if (params.providerId === "openai") {
      const res = await fetchFn("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: params.modelId || "gpt-5.4-mini",
          input: prompt,
          text: {
            format: {
              type: "json_schema",
              name: "analyzed_learning_resource",
              strict: true,
              schema: AI_RESOURCE_JSON_SCHEMA,
            },
          },
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          output_text?: string;
          output?: readonly { content?: readonly { text?: string }[] }[];
        };
        rawJsonText =
          body.output_text ??
          body.output?.flatMap((item) => item.content ?? []).map((c) => c.text ?? "").join("") ??
          null;
      }
    } else if (params.providerId === "anthropic") {
      const res = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: params.modelId || "claude-haiku-4-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: `${prompt}\n\nRespond with a single JSON object only.` }],
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { content?: readonly { type?: string; text?: string }[] };
        rawJsonText =
          body.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? null;
      }
    } else if (params.providerId === "google_gemini") {
      const model = encodeURIComponent(params.modelId || "gemini-3-flash-preview");
      const res = await fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        },
      );
      if (res.ok) {
        const body = (await res.json()) as {
          candidates?: readonly { content?: { parts?: readonly { text?: string }[] } }[];
        };
        rawJsonText =
          body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? null;
      }
    }

    if (!rawJsonText) return baseline;
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(rawJsonText);
    const parsedAi = JSON.parse((fenced?.[1] ?? rawJsonText).trim()) as Partial<{
      title: string;
      publisher: string;
      category: ManualResourceCategory;
      subject: ManualResourceSubject;
      accessModel: ManualResourceAccessModel;
      costLabel: string;
      selectionRationale: string;
      topics: string[];
      segments: string[];
    }>;

    const validCategories = new Set<ManualResourceCategory>(["Course", "Book", "YouTube", "Code Lab", "Problem Set"]);
    const validSubjects = new Set<ManualResourceSubject>(["Engineering", "Systems", "Mathematics", "Physics", "Literature"]);
    const validAccess = new Set<ManualResourceAccessModel>(["free", "freemium_optional_certificate", "paid", "library_loan"]);

    const category = parsedAi.category && validCategories.has(parsedAi.category) ? parsedAi.category : baseline.category;
    const subject = parsedAi.subject && validSubjects.has(parsedAi.subject) ? parsedAi.subject : baseline.subject;
    const accessModel = parsedAi.accessModel && validAccess.has(parsedAi.accessModel) ? parsedAi.accessModel : baseline.accessModel;
    const title = parsedAi.title?.trim() || baseline.title;
    const publisher = parsedAi.publisher?.trim() || baseline.publisher;
    const selectionRationale = parsedAi.selectionRationale?.trim() || baseline.selectionRationale;
    const topics =
      Array.isArray(parsedAi.topics) && parsedAi.topics.filter((t) => typeof t === "string" && t.trim()).length > 0
        ? parsedAi.topics.map((t) => t.trim()).filter(Boolean).slice(0, 8)
        : baseline.topics;
    const rawSegs =
      Array.isArray(parsedAi.segments) && parsedAi.segments.filter((s) => typeof s === "string" && s.trim()).length > 0
        ? parsedAi.segments.map((s) => s.trim()).filter(Boolean).slice(0, 6)
        : baseline.segments.map((s) => s.title);
    const { tierLabel, costLabel } = formatAccessLabels(accessModel, parsedAi.costLabel, baseline.priceMinorUnits);

    return {
      ...baseline,
      title,
      publisher,
      category,
      subject,
      accessModel,
      tierLabel,
      costLabel,
      selectionRationale,
      description: [selectionRationale, pageInternals.description ?? ""].filter(Boolean).join(" ").slice(0, 480),
      topics,
      segments: rawSegs.map((segTitle, idx) => ({
        segment_id: `seg-manual-${idx + 1}`,
        title: segTitle,
        verified: pageInternals.fetchedLive,
      })),
      analyzedBy: "ai",
    };
  } catch {
    return baseline;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Converts an `AnalyzedManualResourceDraft` into a `CatalogResourceMetadataInput` record
 * compatible with `ResourcesView`, `NewSyllabusDialog` TF-IDF retrieval, `InspectorDrawer`,
 * and `AdminResourcesView`.
 */
export function buildCatalogMetadataFromDraft(
  draft: AnalyzedManualResourceDraft,
  handle = "@alex",
  nowIso = new Date().toISOString(),
): CatalogResourceMetadataInput {
  return {
    resource_version_id: draft.resourceVersionId,
    title: draft.title,
    canonical_url: draft.canonicalUrl,
    captured_at: nowIso,
    category: draft.category,
    subject: draft.subject,
    description: draft.description,
    topics: [...draft.topics],
    provider: {
      provider_id: draft.providerId,
      display_name: draft.publisher,
    },
    access: {
      model: draft.accessModel,
      tier_label: draft.tierLabel,
      cost_label: draft.costLabel,
      rights_label: "External Link · Metadata Indexed",
      certificate_included: draft.accessModel === "freemium_optional_certificate",
      optional_certificate_price_minor: draft.accessModel === "freemium_optional_certificate" ? 4900 : null,
      access_verified_at: nowIso,
    },
    ingestion_permissions: {
      basis: "link_and_metadata_only",
      permissions: { display_excerpts: "denied" },
    },
    vector_index: {
      status: "indexed",
      index_type: TFIDF_ENGINE,
      discovered_by: "Community Published",
      discovered_by_handle: handle,
      last_indexed_at: nowIso,
    },
    segments: draft.segments,
  };
}

/**
 * Mutates a syllabus JSON payload immutably to add or update a resource binding on a target unit (`moduleId`).
 * Removes any previous assignment for `resourceVersionId` first so re-assigning units or roles never duplicates.
 */
export function applyResourceBindingToSyllabus(params: {
  readonly syllabus: Record<string, unknown>;
  readonly resourceVersionId: string;
  readonly resourceEntry: CatalogResourceMetadataInput;
  readonly targetModuleId?: string | null | undefined;
  readonly targetActivityId?: string | null | undefined;
  readonly role?: "primary" | "supplemental" | undefined;
  readonly selectionRationale?: string | undefined;
}): Record<string, unknown> {
  const {
    syllabus,
    resourceVersionId,
    resourceEntry,
    targetModuleId,
    targetActivityId,
    role = "primary",
    selectionRationale,
  } = params;

  const cleaned = removeResourceBindingFromSyllabus(syllabus, resourceVersionId);
  const rawModules = Array.isArray(cleaned["modules"])
    ? (cleaned["modules"] as Record<string, unknown>[]).map((m) => ({ ...m }))
    : [];
  const rawActivities = Array.isArray(cleaned["activities"])
    ? (cleaned["activities"] as Record<string, unknown>[]).map((a) => ({ ...a }))
    : [];

  if (rawModules.length === 0) return cleaned;

  const chosenModIdx = Math.max(
    0,
    targetModuleId ? rawModules.findIndex((m) => m["module_id"] === targetModuleId) : 0,
  );
  const chosenMod = rawModules[chosenModIdx] ?? rawModules[0]!;
  const chosenModuleId = String(chosenMod["module_id"] ?? "module-1");
  const modActIds = Array.isArray(chosenMod["activity_ids"])
    ? [...(chosenMod["activity_ids"] as string[])]
    : [];
  const modObjectiveIds = Array.isArray(chosenMod["objective_ids"])
    ? [...(chosenMod["objective_ids"] as string[])]
    : [];

  const segmentIds = (resourceEntry.segments ?? [])
    .map((s) => s.segment_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const rationale =
    selectionRationale?.trim() ||
    resourceEntry.description?.trim() ||
    `Selected ${(resourceEntry.category ?? "study").toLowerCase()} material from ${resourceEntry.provider?.display_name ?? "your library"}.`;

  const assignment = {
    resource_version_id: resourceVersionId,
    role,
    segment_ids: segmentIds,
    selection_rationale: rationale,
  };

  // Prefer explicit targetActivityId if it belongs to chosenMod, otherwise attach to the unit's primary study/lab step
  // (or create a dedicated manual activity if the unit only has quiz/review steps).
  let attachedActivityId: string | null = null;
  if (targetActivityId && modActIds.includes(targetActivityId)) {
    const actIdx = rawActivities.findIndex((a) => a["activity_id"] === targetActivityId);
    if (actIdx >= 0) {
      const targetAct = rawActivities[actIdx]!;
      const existingAssigns = Array.isArray(targetAct["resource_assignments"])
        ? [...(targetAct["resource_assignments"] as Record<string, unknown>[])]
        : [];
      rawActivities[actIdx] = {
        ...targetAct,
        resource_assignments: [...existingAssigns, assignment],
      };
      attachedActivityId = targetActivityId;
    }
  }

  if (!attachedActivityId) {
    const preferredType =
      resourceEntry.category === "Code Lab"
        ? "coding"
        : resourceEntry.category === "Problem Set"
          ? "worked_example"
          : "theory";
    let candidateIdx = rawActivities.findIndex(
      (a) =>
        modActIds.includes(String(a["activity_id"] ?? "")) &&
        a["type"] === preferredType,
    );
    if (candidateIdx < 0) {
      candidateIdx = rawActivities.findIndex(
        (a) =>
          modActIds.includes(String(a["activity_id"] ?? "")) &&
          a["type"] !== "quiz" &&
          a["type"] !== "review",
      );
    }

    if (candidateIdx >= 0) {
      const targetAct = rawActivities[candidateIdx]!;
      const existingAssigns = Array.isArray(targetAct["resource_assignments"])
        ? [...(targetAct["resource_assignments"] as Record<string, unknown>[])]
        : [];
      rawActivities[candidateIdx] = {
        ...targetAct,
        resource_assignments: [...existingAssigns, assignment],
      };
      attachedActivityId = String(targetAct["activity_id"]);
    } else {
      const newActId = `manual-activity-${chosenModuleId}-${resourceVersionId}`;
      const newActType =
        resourceEntry.category === "Code Lab"
          ? "coding"
          : resourceEntry.category === "Problem Set"
            ? "worked_example"
            : "theory";
      const resourceTitle = resourceEntry.title ?? resourceVersionId;
      rawActivities.push({
        activity_id: newActId,
        type: newActType,
        title: `Study: ${resourceTitle}`,
        requirement_level: role === "supplemental" ? "optional" : "required",
        objective_ids: modObjectiveIds,
        prerequisite_activity_ids: [],
        resource_assignments: [assignment],
        duration_estimate: {
          media_minutes: resourceEntry.category === "YouTube" || resourceEntry.category === "Course" ? 25 : 0,
          reading_minutes: resourceEntry.category === "Book" ? 25 : 10,
          practice_minutes: resourceEntry.category === "Code Lab" || resourceEntry.category === "Problem Set" ? 30 : 0,
          assessment_minutes: 0,
          review_minutes: 0,
          lower_bounds: { media_minutes: 15, reading_minutes: 10, practice_minutes: 0, assessment_minutes: 0, review_minutes: 0 },
          upper_bounds: { media_minutes: 40, reading_minutes: 35, practice_minutes: 45, assessment_minutes: 0, review_minutes: 0 },
          range_interpretation: "planning_bounds_not_confidence_interval",
        },
        content:
          newActType === "coding"
            ? { deliverable_description: rationale }
            : newActType === "worked_example"
              ? { example_prompt: rationale, guidance_level: "full" }
              : { study_prompt: rationale },
      });
      rawModules[chosenModIdx] = {
        ...chosenMod,
        activity_ids: [...modActIds, newActId],
      };
    }
  }

  // Merge resource topic tags into syllabus topic_tags if relevant (up to 8 tags).
  const existingTags = Array.isArray(cleaned["topic_tags"]) ? [...(cleaned["topic_tags"] as string[])] : [];
  for (const topic of resourceEntry.topics ?? []) {
    if (existingTags.length >= 8) break;
    if (!existingTags.some((t) => t.toLowerCase() === topic.toLowerCase())) {
      existingTags.push(topic);
    }
  }

  return {
    ...cleaned,
    topic_tags: existingTags,
    modules: rawModules,
    activities: rawActivities,
  };
}

/**
 * Immutably unlinks `resourceVersionId` from all activities and certification options of `syllabus`,
 * and cleans up any `manual-activity-*` wrapper left with zero resource assignments.
 */
export function removeResourceBindingFromSyllabus(
  syllabus: Record<string, unknown>,
  resourceVersionId: string,
): Record<string, unknown> {
  const emptyManualActivityIds = new Set<string>();
  const rawActivities = Array.isArray(syllabus["activities"])
    ? (syllabus["activities"] as Record<string, unknown>[])
    : [];

  const nextActivities: Record<string, unknown>[] = rawActivities
    .map((act): Record<string, unknown> => {
      const assigns = Array.isArray(act["resource_assignments"])
        ? (act["resource_assignments"] as Record<string, unknown>[]).filter(
            (r) => r["resource_version_id"] !== resourceVersionId,
          )
        : [];
      const actId = String(act["activity_id"] ?? "");
      if (actId.startsWith("manual-activity-") && assigns.length === 0) {
        emptyManualActivityIds.add(actId);
      }
      return {
        ...act,
        resource_assignments: assigns,
      };
    })
    .filter((act) => !emptyManualActivityIds.has(String(act["activity_id"] ?? "")));

  const rawModules = Array.isArray(syllabus["modules"])
    ? (syllabus["modules"] as Record<string, unknown>[]).map((mod) => {
        if (emptyManualActivityIds.size === 0 || !Array.isArray(mod["activity_ids"])) return mod;
        return {
          ...mod,
          activity_ids: (mod["activity_ids"] as string[]).filter((id) => !emptyManualActivityIds.has(id)),
        };
      })
    : [];

  const nextCerts = Array.isArray(syllabus["certification_options"])
    ? (syllabus["certification_options"] as Record<string, unknown>[]).filter(
        (c) => c["resource_version_id"] !== resourceVersionId,
      )
    : syllabus["certification_options"];

  return {
    ...syllabus,
    modules: rawModules,
    activities: nextActivities,
    ...(nextCerts !== undefined ? { certification_options: nextCerts } : {}),
  };
}

/**
 * Inspects a syllabus to find the first existing binding (`moduleId`, `activityId`, `role`, `selectionRationale`)
 * for `resourceVersionId`, if linked.
 */
export function findResourceBindingInSyllabus(
  syllabus: Record<string, unknown>,
  resourceVersionId: string,
): {
  readonly moduleId: string;
  readonly activityId: string;
  readonly role: "primary" | "supplemental";
  readonly selectionRationale: string;
} | null {
  const rawModules = Array.isArray(syllabus["modules"])
    ? (syllabus["modules"] as Record<string, unknown>[])
    : [];
  const rawActivities = Array.isArray(syllabus["activities"])
    ? (syllabus["activities"] as Record<string, unknown>[])
    : [];

  for (const act of rawActivities) {
    const assigns = Array.isArray(act["resource_assignments"])
      ? (act["resource_assignments"] as Record<string, unknown>[])
      : [];
    const hit = assigns.find((a) => a["resource_version_id"] === resourceVersionId);
    if (hit) {
      const actId = String(act["activity_id"] ?? "");
      const ownerMod = rawModules.find(
        (m) => Array.isArray(m["activity_ids"]) && (m["activity_ids"] as string[]).includes(actId),
      );
      return {
        moduleId: String(ownerMod?.["module_id"] ?? rawModules[0]?.["module_id"] ?? ""),
        activityId: actId,
        role: hit["role"] === "supplemental" ? "supplemental" : "primary",
        selectionRationale: typeof hit["selection_rationale"] === "string" ? hit["selection_rationale"] : "",
      };
    }
  }
  return null;
}
