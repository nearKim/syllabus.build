import MiniSearch from "minisearch";

export const TFIDF_ENGINE = "tfidf-cosine-v1";

export interface TfidfIndex {
  readonly engine: MiniSearch<{ readonly id: string; readonly text: string }>;
  readonly termCounts: ReadonlyMap<string, number>;
}

export interface TfidfHit {
  readonly id: string;
  readonly score: number;
}

const STOP_WORDS = new Set(
  "a an and are as at be by for from how in into is it its of on or that the this to via what with your".split(" "),
);

// Lower-case word tokens. Accents fold away ("complètes" is "completes"), LaTeX commands drop out,
// and a plural "s" folds into the singular.
export function foldAccents(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function processTerm(term: string): string | null {
  const clean = foldAccents(term).toLowerCase();
  if (!clean || STOP_WORDS.has(clean)) return null;
  return clean.length > 3 && clean.endsWith("s") && !clean.endsWith("ss") ? clean.slice(0, -1) : clean;
}

export function tokenize(text: string): string[] {
  return (foldAccents(text).toLowerCase().replace(/\\[a-z]+/g, " ").match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(processTerm)
    .filter((token): token is string => token !== null);
}

export function buildTfidfIndex(docs: Readonly<Record<string, string>>): TfidfIndex {
  const engine = new MiniSearch<{ readonly id: string; readonly text: string }>({
    fields: ["text"],
    tokenize: (text) => text.replace(/\\[a-z]+/gi, " ").match(/[\p{L}\p{N}]+/gu) ?? [],
    processTerm,
  });
  const entries = Object.entries(docs).map(([id, text]) => ({ id, text }));
  engine.addAll(entries);
  const termCounts = new Map(entries.map(({ id, text }) => [id, new Set(tokenize(text)).size]));
  return { engine, termCounts };
}

// Every indexed id with a positive MiniSearch BM25/TF-IDF score normalized into (0, 1), best first.
export function searchTfidf(index: TfidfIndex, query: string): TfidfHit[] {
  return index.engine.search(query).map((hit) => ({ id: String(hit.id), score: hit.score / (hit.score + 8) }));
}
