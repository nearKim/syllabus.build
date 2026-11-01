import type { SfIconName } from "../Icons.tsx";

// The taxonomy has three tiers. A category holds subjects, a listing's subject decides its category,
// and each listing carries its own topic tags. Difficulty and format are facets that cut across all tiers.
export const SUBJECTS_BY_CATEGORY = {
  "Computer Science": ["Engineering", "Systems"],
  "Math & Sciences": ["Mathematics", "Physics"],
  Humanities: ["Literature"],
} as const;
export type CategoryTag = keyof typeof SUBJECTS_BY_CATEGORY;
export const CATEGORY_TAGS = Object.keys(SUBJECTS_BY_CATEGORY) as CategoryTag[];
export const SUBJECT_TAGS = CATEGORY_TAGS.flatMap((category) => SUBJECTS_BY_CATEGORY[category]);
export const DIFFICULTY_TAGS = ["Formal", "Applied", "Intuitive"] as const;
export const FORMAT_TAGS = ["Quiz", "Code Lab", "Problem Set", "Rubric"] as const;
// The Topic row shows this many topics until the learner asks for all of them.
export const TOPIC_PREVIEW = 6;

// "All" means that no value is chosen for that filter.
export const MARKETPLACE_CATEGORIES = ["All", ...CATEGORY_TAGS] as const;
export const MARKETPLACE_SUBJECTS = ["All", ...SUBJECT_TAGS] as const;
export const MARKETPLACE_DIFFICULTIES = ["All", ...DIFFICULTY_TAGS] as const;
export const MARKETPLACE_FORMATS = ["All", ...FORMAT_TAGS] as const;
export const MARKETPLACE_FACETS = ["category", "subject", "topic", "difficulty", "format"] as const;
export const MARKETPLACE_SORTS = ["top_upvoted", "most_adopted", "newest"] as const;
export type MarketplaceFacet = (typeof MARKETPLACE_FACETS)[number];
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];

export interface MarketplaceFilters {
  readonly category: (typeof MARKETPLACE_CATEGORIES)[number];
  readonly subject: (typeof MARKETPLACE_SUBJECTS)[number];
  readonly topic: string;
  readonly difficulty: (typeof MARKETPLACE_DIFFICULTIES)[number];
  readonly format: (typeof MARKETPLACE_FORMATS)[number];
  readonly query: string;
}

export const NO_MARKETPLACE_FILTERS: MarketplaceFilters = {
  category: "All", subject: "All", topic: "All", difficulty: "All", format: "All", query: "",
};

export const SORT_LABELS: Readonly<Record<MarketplaceSort, string>> = {
  top_upvoted: "Top",
  most_adopted: "Most adopted",
  newest: "Newest",
};

export const SUBJECT_ICONS: Readonly<Record<string, SfIconName>> = {
  Engineering: "engineering",
  Mathematics: "math",
  Physics: "physics",
  Literature: "literature",
  Systems: "systems",
};

export const FACET_LABELS: Readonly<Record<MarketplaceFacet, string>> = {
  category: "Category",
  subject: "Subject",
  topic: "Topic",
  difficulty: "Difficulty",
  format: "Format",
};

export const tagLabelOf = (value: string): string => (value === "Mathematics" ? "Math" : value);

export const categoryOf = (subject: string): CategoryTag | undefined =>
  CATEGORY_TAGS.find((category) => (SUBJECTS_BY_CATEGORY[category] as readonly string[]).includes(subject));

export const PRIVATE_FIELDS_REMOVED = [
  "Your progress and completion records",
  "Proficiency, evidence, and diagnostic answers",
  "Notes, attempts, and practice drafts",
  "BYOK keys and provider connections",
  "Billing, budgets, and wallet state",
  "Your session dates and reminder settings",
] as const;

export interface MarketplaceListing {
  readonly publicationId: string;
  readonly revisionId: string;
  readonly subject: string;
  readonly gateStyle: string;
  readonly topicTags: readonly string[];
  readonly handle: string;
  readonly upvotes: number;
  readonly adoptions: number;
  readonly publishedAt: string;
  readonly ownerAccountId: string | null;
  readonly sourceSyllabusId: string | null;
  readonly basedOn: string | null;
  readonly syllabus: Record<string, unknown>;
  readonly schedule: Record<string, unknown>;
}

export interface Adoption {
  readonly accountId: string;
  readonly publicationId: string;
  readonly moduleIds: readonly string[];
  readonly active: boolean;
}

export interface Vote {
  readonly accountId: string;
  readonly revisionId: string;
}

export interface ActiveSyllabus {
  readonly syllabusId: string;
  readonly domain: string;
  readonly assessmentMode: string;
  readonly syllabus: Record<string, unknown>;
  readonly schedule: Record<string, unknown>;
  readonly publicationId: string | null;
  readonly draft: boolean;
}

export const MATH_DEPTHS = ["intuitive", "applied", "formal"] as const;
export type MathDepth = (typeof MATH_DEPTHS)[number];
