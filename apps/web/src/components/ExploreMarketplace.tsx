import type { ComponentChildren, VNode } from "preact";
import {
  buildPlanMapAndOutlineModel,
  computeActivityDurationTriplet,
  renderUntrustedCatalogText,
  type CatalogResourceMetadataInput,
} from "../../../../packages/ui/src/index.ts";
import type { ProficiencyProfileFixture } from "../diagnosticsAndAdaptation.ts";
import { resolveTransitiveAdoptionScope, type PublicCurriculumContentBlock } from "../billingAndSharing.ts";
import { normalizeStringList } from "../shared.ts";
import { handleOf } from "./AuthDialog.tsx";
import type { Account, AuthStatus } from "./HeaderBar.tsx";
import { OpenKnowledgeArt, SfIcon, StatusGlyph, type SfIconName } from "./Icons.tsx";
import { displayUnitTitle, effortWords, humanize, isOneOf, type StudyActivity } from "./StudyFlowBoard.tsx";

// The taxonomy has three tiers. A category holds subjects, a listing's subject decides its category,
// and each listing carries its own topic tags. Difficulty and format are facets that cut across all tiers.
const SUBJECTS_BY_CATEGORY = {
  "Computer Science": ["Engineering", "Systems"],
  "Math & Sciences": ["Mathematics", "Physics"],
  Humanities: ["Literature"],
} as const;
type CategoryTag = keyof typeof SUBJECTS_BY_CATEGORY;
const CATEGORY_TAGS = Object.keys(SUBJECTS_BY_CATEGORY) as CategoryTag[];
const SUBJECT_TAGS = CATEGORY_TAGS.flatMap((category) => SUBJECTS_BY_CATEGORY[category]);
const DIFFICULTY_TAGS = ["Formal", "Applied", "Intuitive"] as const;
const FORMAT_TAGS = ["Quiz", "Code Lab", "Problem Set", "Rubric"] as const;
// The Topic row shows this many topics until the learner asks for all of them.
const TOPIC_PREVIEW = 6;

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

const SUBJECT_ICONS: Readonly<Record<string, SfIconName>> = {
  Engineering: "engineering",
  Mathematics: "math",
  Physics: "physics",
  Literature: "literature",
  Systems: "systems",
};

const FACET_LABELS: Readonly<Record<MarketplaceFacet, string>> = {
  category: "Category",
  subject: "Subject",
  topic: "Topic",
  difficulty: "Difficulty",
  format: "Format",
};

const tagLabelOf = (value: string): string => (value === "Mathematics" ? "Math" : value);

// A metric pill with an icon, a count, and its noun, such as "1 learner" or "142 learners". The number is bold.
const impactPill = (icon: SfIconName, count: number, noun: string): VNode => (
  <span class="impact-pill">
    <SfIcon name={icon} />
    <span>
      <b>{count}</b> {count === 1 ? noun : `${noun}s`}
    </span>
  </span>
);

const categoryOf = (subject: string): CategoryTag | undefined =>
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
  readonly sourceCurriculumId: string | null;
  readonly basedOn: string | null;
  readonly curriculum: Record<string, unknown>;
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

export interface ActiveCurriculum {
  readonly curriculumId: string;
  readonly domain: string;
  readonly assessmentMode: string;
  readonly curriculum: Record<string, unknown>;
  readonly schedule: Record<string, unknown>;
  readonly publicationId: string | null;
  readonly draft: boolean;
}

const MATH_DEPTHS = ["intuitive", "applied", "formal"] as const;
type MathDepth = (typeof MATH_DEPTHS)[number];

export const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

export const rawListOf = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly Readonly<Record<string, unknown>>[] => {
  const list: unknown = record[key];
  return (Array.isArray(list) ? list : []).map(asRecord);
};

export const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

export function mathDepthFor(curriculum: Record<string, unknown>, topicIds: readonly string[]): string {
  const prefs = asRecord(curriculum["instruction_preferences_applied"]);
  const rawOverrides: unknown = prefs["topic_math_depth_overrides"];
  const overrides = (Array.isArray(rawOverrides) ? rawOverrides : []).map(asRecord);
  const depthOf = (topicId: string | null): unknown =>
    overrides.find((entry) => entry["topic_id"] === topicId)?.["math_depth"] ?? prefs["math_depth"];
  const depths = new Set(
    (topicIds.length > 0 ? topicIds : [null]).map(depthOf).filter((depth): depth is MathDepth => isOneOf(MATH_DEPTHS, depth)),
  );
  return [...depths].map(humanize).join(", ") || "Not stated";
}

export interface CurriculumTagDescriptor {
  readonly category: CategoryTag | null;
  readonly subject: string;
  readonly subjectLabel: string;
  readonly subjectIcon: SfIconName;
  readonly gateStyle: string;
  readonly difficulty: (typeof DIFFICULTY_TAGS)[number] | null;
  readonly format: (typeof FORMAT_TAGS)[number] | null;
  readonly topicTags: readonly string[];
}

// Single source of truth for curriculum tags shared by Explore and Learn.
// Reads canonical tag metadata directly from the curriculum document (with optional legacy fallbacks).
export function curriculumTagsOf(
  curriculum: Record<string, unknown>,
  fallback?: {
    readonly subject?: string | undefined;
    readonly gateStyle?: string | undefined;
    readonly topicTags?: readonly string[] | undefined;
  },
): CurriculumTagDescriptor {
  const subject = textOf(curriculum["subject"]) || fallback?.subject || "Engineering";
  const gateStyle = textOf(curriculum["gate_style"]) || fallback?.gateStyle || "Reviewed Quiz";
  const depth = mathDepthFor(curriculum, []);
  const difficulty = isOneOf(DIFFICULTY_TAGS, depth) ? depth : null;
  const format = FORMAT_TAGS.find((entry) => gateStyle.includes(entry)) ?? null;
  const fromCurriculum = normalizeStringList(curriculum["topic_tags"]);
  const fromFallback = fallback?.topicTags ? [...fallback.topicTags] : [];
  const topicTags =
    fromCurriculum.length > 0
      ? fromCurriculum
      : fromFallback.length > 0
        ? fromFallback
        : normalizeStringList(asRecord(curriculum["goal"])["included_topics"]);
  return {
    category: categoryOf(subject) ?? null,
    subject,
    subjectLabel: tagLabelOf(subject),
    subjectIcon: SUBJECT_ICONS[subject] ?? "course",
    gateStyle,
    difficulty,
    format,
    topicTags,
  };
}

export interface CurriculumTagStripProps {
  readonly curriculum: Record<string, unknown>;
  readonly fallbackSubject?: string;
  readonly fallbackGateStyle?: string;
}

// Learn tab UI representation of the shared curriculum tag data.
// While Explore renders these tags as interactive filter buttons, Learn renders the same underlying
// curriculum taxonomy, difficulty, format, and topic tags as an editorial metadata strip.
export function CurriculumTagStrip({
  curriculum,
  fallbackSubject,
  fallbackGateStyle,
}: CurriculumTagStripProps): VNode {
  const tags = curriculumTagsOf(curriculum, { subject: fallbackSubject, gateStyle: fallbackGateStyle });
  return (
    <div
      class="learn-curriculum-tags"
      aria-label="Curriculum taxonomy and topic tags"
      data-category={tags.category ?? undefined}
      data-subject={tags.subject}
      data-difficulty={tags.difficulty ?? undefined}
      data-format={tags.format ?? undefined}
    >
      <span class="learn-tag-primary" data-tag-facet="subject">
        <span class="learn-tag-icon" aria-hidden="true">
          <SfIcon name={tags.subjectIcon} size={15} />
        </span>
        {tags.category ? (
          <>
            <span class="learn-tag-category">{tags.category}</span>
            <span class="learn-tag-sep" aria-hidden="true">
              ›
            </span>
          </>
        ) : null}
        <span class="learn-tag-subject">{tags.subjectLabel}</span>
      </span>
      {tags.difficulty ? (
        <span class="learn-tag-facet" data-tag-facet="difficulty">
          {tags.difficulty}
        </span>
      ) : null}
      {tags.format ? (
        <span class="learn-tag-facet" data-tag-facet="format">
          {tags.format}
        </span>
      ) : null}
      {tags.topicTags.length > 0 ? (
        <ul class="learn-topic-tags" aria-label="Topics">
          {tags.topicTags.map((topic) => (
            <li key={topic} class="learn-topic-chip" data-tag-topic={topic}>
              {topic}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// A plan's estimated study time at 1x speed, in minutes.
const studyMinutesOf = (curriculum: Record<string, unknown>): number =>
  rawListOf(curriculum, "activities").reduce(
    (sum, activity) => sum + computeActivityDurationTriplet(activity["duration_estimate"], 1).point,
    0,
  );

export const goalTitleOf = (curriculum: Record<string, unknown>): string =>
  renderUntrustedCatalogText(asRecord(curriculum["goal"])["title"], { maxLength: 200 }).text || "Untitled plan";

export function publicProjectionOf(curriculum: Record<string, unknown>): PublicCurriculumContentBlock {
  const edges = rawListOf(curriculum, "prerequisite_edges").map((edge) => ({
    from_objective_id: textOf(edge["from_objective_id"]),
    to_objective_id: textOf(edge["to_objective_id"]),
  }));
  return {
    title: goalTitleOf(curriculum),
    summary: renderUntrustedCatalogText(asRecord(curriculum["goal"])["summary"], { maxLength: 600 }).text,
    objectives: rawListOf(curriculum, "objectives").map((objective) => ({
      objective_id: textOf(objective["objective_id"]),
      title: textOf(objective["title"]),
      prerequisite_objective_ids: edges
        .filter((edge) => edge.to_objective_id === objective["objective_id"])
        .map((edge) => edge.from_objective_id),
    })),
    prerequisite_edges: edges,
    modules: rawListOf(curriculum, "modules").map((mod) => ({
      module_id: textOf(mod["module_id"]),
      title: textOf(mod["title"]),
      summary: textOf(mod["summary"]),
      objective_ids: normalizeStringList(mod["objective_ids"]),
      activity_ids: normalizeStringList(mod["activity_ids"]),
      prerequisite_module_ids: normalizeStringList(mod["prerequisite_module_ids"]),
    })),
  };
}

// A listing's units in the author's order. Details opens with all of them selected.
export const unitIdsOf = (listing: MarketplaceListing | undefined): string[] =>
  listing ? publicProjectionOf(listing.curriculum).modules.map((mod) => mod.module_id) : [];

export const adoptionScopeOf = (listing: MarketplaceListing, requested: readonly string[]) =>
  resolveTransitiveAdoptionScope(
    {
      schema_version: "0.2.0",
      publication_id: listing.publicationId,
      publication_revision_id: listing.revisionId,
      revision_number: 1,
      published_at: listing.publishedAt,
      content_sha256: "",
      content: publicProjectionOf(listing.curriculum),
      publisher: { public_author_id: listing.handle, display_name: listing.handle },
      publication_terms: {
        policy_id: "publication-terms-v1",
        content_license_id: "CC-BY-4.0",
        rights_scope: "structure_and_author_prompts_only",
        attribution: listing.handle,
        third_party_materials_excluded: true,
      },
    },
    requested,
  );

export function adoptedPlanOf(listing: MarketplaceListing, adoption: Adoption): ActiveCurriculum {
  const curriculumId = `adopted-${listing.publicationId}`;
  const tags = curriculumTagsOf(listing.curriculum, listing);
  const modules = rawListOf(listing.curriculum, "modules").filter((mod) =>
    adoption.moduleIds.includes(textOf(mod["module_id"])),
  );
  const activityIds = new Set(modules.flatMap((mod) => normalizeStringList(mod["activity_ids"])));
  const objectiveIds = new Set(modules.flatMap((mod) => normalizeStringList(mod["objective_ids"])));
  const revisionId = `${curriculumId}-draft-1`;
  const sessions = rawListOf(listing.schedule, "sessions")
    .map((session) => ({
      ...session,
      activity_ids: normalizeStringList(session["activity_ids"]).filter((id) => activityIds.has(id)),
    }))
    .filter((session) => session.activity_ids.length > 0);
  return {
    curriculumId,
    domain: tags.subject,
    assessmentMode: tags.gateStyle,
    publicationId: listing.publicationId,
    draft: !adoption.active,
    curriculum: {
      ...listing.curriculum,
      subject: tags.subject,
      gate_style: tags.gateStyle,
      topic_tags: tags.topicTags,
      curriculum_id: curriculumId,
      revision_id: revisionId,
      revision_number: 1,
      account_id: adoption.accountId,
      predecessor_revision_id: null,
      revision_reason: "adoption",
      modules,
      activities: rawListOf(listing.curriculum, "activities").filter((act) => activityIds.has(textOf(act["activity_id"]))),
      objectives: rawListOf(listing.curriculum, "objectives")
        .filter((objective) => objectiveIds.has(textOf(objective["objective_id"])))
        .map((objective) => ({ ...objective, prior_evidence_refs: [] })),
      prerequisite_edges: rawListOf(listing.curriculum, "prerequisite_edges").filter(
        (edge) =>
          objectiveIds.has(textOf(edge["from_objective_id"])) && objectiveIds.has(textOf(edge["to_objective_id"])),
      ),
    },
    schedule: { ...listing.schedule, curriculum_revision_id: revisionId, sessions },
  };
}

const listingTagsOf = (listing: MarketplaceListing): CurriculumTagDescriptor =>
  curriculumTagsOf(listing.curriculum, listing);

// The difficulty is the plan's math depth.
const difficultyTagOf = (listing: MarketplaceListing): (typeof DIFFICULTY_TAGS)[number] | null =>
  listingTagsOf(listing).difficulty;

// The format is the assessment a listing gates on, named in one or two words.
const formatTagOf = (listing: MarketplaceListing): (typeof FORMAT_TAGS)[number] | null =>
  listingTagsOf(listing).format;

const inTiers = (listing: MarketplaceListing, filters: MarketplaceFilters): boolean => {
  const tags = listingTagsOf(listing);
  return (
    (filters.category === "All" || tags.category === filters.category) &&
    (filters.subject === "All" || tags.subject === filters.subject)
  );
};

const matchesFilters = (listing: MarketplaceListing, filters: MarketplaceFilters): boolean => {
  const tags = listingTagsOf(listing);
  return (
    inTiers(listing, filters) &&
    (filters.topic === "All" || tags.topicTags.includes(filters.topic)) &&
    (filters.difficulty === "All" || tags.difficulty === filters.difficulty) &&
    (filters.format === "All" || tags.format === filters.format) &&
    (!filters.query ||
      [goalTitleOf(listing.curriculum), publicProjectionOf(listing.curriculum).summary, listing.handle, tags.subject,
        tags.category ?? "", ...tags.topicTags]
        .join(" ")
        .toLowerCase()
        .includes(filters.query.toLowerCase()))
  );
};

// The values a facet accepts. Topics are the tags that some listing carries.
export const facetValuesOf = (facet: MarketplaceFacet, listings: readonly MarketplaceListing[]): readonly string[] =>
  facet === "category" ? MARKETPLACE_CATEGORIES
    : facet === "subject" ? MARKETPLACE_SUBJECTS
      : facet === "difficulty" ? MARKETPLACE_DIFFICULTIES
        : facet === "format" ? MARKETPLACE_FORMATS
          : ["All", ...listings.flatMap((listing) => listingTagsOf(listing).topicTags)];

// Setting one filter keeps the tiers on one branch of the taxonomy. A category drops a subject outside it,
// a subject sets its own category, and a topic stays only while a listing in the new scope still carries it.
export function withMarketplaceFilter(
  filters: MarketplaceFilters,
  facet: MarketplaceFacet,
  value: string,
  listings: readonly MarketplaceListing[],
): MarketplaceFilters {
  const set = { ...filters, [facet]: value } as MarketplaceFilters;
  const subject = facet === "category" && categoryOf(set.subject) !== set.category ? "All" : set.subject;
  const scoped = { ...set, subject, category: categoryOf(subject) ?? set.category };
  const topicFits =
    scoped.topic === "All" || listings.some((listing) => inTiers(listing, scoped) && listingTagsOf(listing).topicTags.includes(scoped.topic));
  return topicFits ? scoped : { ...scoped, topic: "All" };
}

interface FilterTagProps {
  readonly facet: Exclude<MarketplaceFacet, "category">;
  readonly value: string;
  readonly filters: MarketplaceFilters;
  readonly count?: number;
}

// A tag sets its filter. Pressing the tag that is already active clears that filter.
// In the filter panel a tag shows its result count. On a card it has no count.
function FilterTag({ facet, value, filters, count }: FilterTagProps): VNode {
  const pressed = filters[facet] === value;
  const label = tagLabelOf(value);
  const onCard = count === undefined;
  return (
    <button
      type="button"
      class="tag"
      data-action="set-marketplace-filter"
      data-facet={facet}
      data-value={pressed ? "All" : value}
      data-subject={facet === "subject" && !onCard ? value : undefined}
      aria-pressed={pressed}
      aria-label={onCard ? `Filter by ${label}` : undefined}
      disabled={count === 0 && !pressed}
    >
      {facet === "subject" && !onCard ? <SfIcon name={SUBJECT_ICONS[value] ?? "course"} size={15} /> : null}
      {label}
      {onCard ? null : pressed ? <SfIcon name="close" size={15} /> : <span class="tag-count">{count}</span>}
    </button>
  );
}

interface FacetRowProps {
  readonly facet: MarketplaceFacet;
  readonly tier?: 1 | 2 | 3;
  readonly children: ComponentChildren;
}

function FacetRow({ facet, tier, children }: FacetRowProps): VNode {
  return (
    <div class="facet-row" data-tier={tier} role="group" aria-labelledby={`facet-${facet}-label`}>
      <span class="facet-label" id={`facet-${facet}-label`}>
        {FACET_LABELS[facet]}
      </span>
      <div class="facet-options">{children}</div>
    </div>
  );
}

export interface ExploreMarketplaceProps {
  readonly active: boolean;
  readonly signedOut: boolean;
  readonly account: Account;
  readonly listings: readonly MarketplaceListing[];
  readonly myPlans: readonly ActiveCurriculum[];
  readonly votes: readonly Vote[];
  readonly adoptions: readonly Adoption[];
  readonly marketplaceFilters: MarketplaceFilters;
  readonly marketplaceSort: MarketplaceSort;
  readonly topicsExpanded: boolean;
  readonly loadMoreNote: string | null;
}

export function ExploreMarketplace({
  active,
  signedOut,
  account,
  listings,
  myPlans,
  votes,
  adoptions,
  marketplaceFilters: filters,
  marketplaceSort,
  topicsExpanded,
  loadMoreNote,
}: ExploreMarketplaceProps): VNode {
  const upvotesOf = (listing: MarketplaceListing): number =>
    listing.upvotes + votes.filter((vote) => vote.revisionId === listing.revisionId).length;
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;
  // Study hours count a plan's estimated study time once for each learner who adopted it.
  const studyHoursOf = (listing: MarketplaceListing): number =>
    Math.round((studyMinutesOf(listing.curriculum) * adoptionsOf(listing)) / 60);
  const planOf = (listing: MarketplaceListing): ActiveCurriculum | undefined =>
    myPlans.find((plan) => plan.publicationId === listing.publicationId || plan.curriculumId === listing.sourceCurriculumId);
  const rank = (listing: MarketplaceListing): number =>
    marketplaceSort === "top_upvoted"
      ? upvotesOf(listing)
      : marketplaceSort === "most_adopted"
        ? adoptionsOf(listing)
        : Date.parse(listing.publishedAt);
  const shownListings = listings
    .filter((listing) => matchesFilters(listing, filters))
    .sort((a, b) => rank(b) - rank(a) || goalTitleOf(a.curriculum).localeCompare(goalTitleOf(b.curriculum)));
  // A count is the number of results that choosing the value gives, after the tier rules apply.
  const countIf = (facet: MarketplaceFacet, value: string): number => {
    const next = withMarketplaceFilter(filters, facet, value, listings);
    return listings.filter((listing) => matchesFilters(listing, next)).length;
  };
  const shownCategories = filters.category === "All" ? CATEGORY_TAGS : [filters.category];
  // Topics rank by result count, then by name. A long list shows only its first topics until the learner asks
  // for all of them, and the chosen topic always stays in view. A "1 more" button would only replace one tag.
  const topics = [
    ...new Set(listings.filter((listing) => inTiers(listing, filters)).flatMap((listing) => listingTagsOf(listing).topicTags)),
  ]
    .map((topic) => ({ topic, count: countIf("topic", topic) }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  const topicsOverflow = topics.length > TOPIC_PREVIEW + 1;
  const shownTopics =
    topicsOverflow && !topicsExpanded
      ? topics.filter(({ topic }, index) => index < TOPIC_PREVIEW || topic === filters.topic)
      : topics;
  // The trail lists the chosen tiers in taxonomy order, then the chosen facets.
  const chosenTiers = (["category", "subject", "topic"] as const).filter((facet) => filters[facet] !== "All");
  const chosenFacets = (["difficulty", "format"] as const).filter((facet) => filters[facet] !== "All");
  const filtered = chosenTiers.length + chosenFacets.length > 0 || filters.query !== "";
  const clearButton = (
    <button type="button" class="clear-filters" data-action="clear-marketplace-filters">
      Clear filters
    </button>
  );
  const trailStep = (facet: MarketplaceFacet): VNode => (
    <li key={facet} class="trail-step" data-facet={facet}>
      <button
        type="button"
        class="trail-chip"
        data-action="set-marketplace-filter"
        data-facet={facet}
        data-value="All"
        aria-label={`Remove ${FACET_LABELS[facet]}: ${tagLabelOf(filters[facet])}`}
      >
        {tagLabelOf(filters[facet])}
        <SfIcon name="close" size={15} />
      </button>
    </li>
  );

  const ownedListings = signedOut ? [] : listings.filter((listing) => listing.ownerAccountId === account.accountId);
  const published = ownedListings.length > 0;
  const ownedTotal = (countOf: (listing: MarketplaceListing) => number): number =>
    ownedListings.reduce((sum, listing) => sum + countOf(listing), 0);
  const supportingImpact: readonly (readonly [SfIconName, string, number, string?])[] = [
    ["clock", "Study hours gifted", ownedTotal(studyHoursOf), "Each plan's study time, multiplied by its adoptions"],
    ["upvote", "Community upvotes", ownedTotal(upvotesOf)],
  ];
  const shareButton = (label: string, kind: "btn-primary" | "btn-secondary"): VNode => (
    <button type="button" class={kind} data-action="open-dialog" data-dialog-id="dialog-publication-preview">
      {label}
    </button>
  );

  return (
    <section
      class="top-level-panel"
      id="panel-explore"
      data-top-panel="Explore"
      data-active={String(active)}
      hidden={!active}
    >
      <div class="section-header">
        <h1 class="page-title">Explore</h1>
        <div class="plan-toolbar">
          <button
            type="button"
            class="btn-secondary"
            data-action="open-dialog"
            data-dialog-id="dialog-publication-preview"
          >
            Share to Marketplace
          </button>
        </div>
      </div>
      <form class="marketplace-search" role="search" data-action="set-marketplace-query">
        <label class="st-sr" for="marketplace-search">
          Search the Marketplace
        </label>
        <input
          id="marketplace-search"
          type="search"
          name="query"
          value={filters.query}
          placeholder="Search titles, topics, and curators"
          autocomplete="off"
        />
        <button type="submit" class="btn-secondary">
          Search
        </button>
      </form>
      <div class="marketplace-filters" role="group" aria-label="Filters">
        <FacetRow facet="category" tier={1}>
          {MARKETPLACE_CATEGORIES.map((category) => {
            const count = countIf("category", category);
            return (
              <button
                key={category}
                type="button"
                class="category-btn"
                data-action="set-marketplace-filter"
                data-facet="category"
                data-value={category}
                aria-pressed={filters.category === category}
                disabled={count === 0 && filters.category !== category}
              >
                {category}
                <span class="tag-count">{count}</span>
              </button>
            );
          })}
        </FacetRow>
        <FacetRow facet="subject" tier={2}>
          {shownCategories.flatMap((category) => SUBJECTS_BY_CATEGORY[category]).map((subject) => (
            <FilterTag key={subject} facet="subject" value={subject} filters={filters} count={countIf("subject", subject)} />
          ))}
        </FacetRow>
        <FacetRow facet="topic" tier={3}>
          {topicsOverflow ? (
            <form class="topic-finder" data-action="set-marketplace-filter">
              <label class="st-sr" for="marketplace-topic">
                Find a topic
              </label>
              <input type="hidden" name="facet" value="topic" />
              <input
                id="marketplace-topic"
                type="search"
                name="value"
                list="marketplace-topic-list"
                placeholder="Find a topic"
                autocomplete="off"
              />
              <datalist id="marketplace-topic-list">
                {topics.map(({ topic }) => (
                  <option key={topic} value={topic} />
                ))}
              </datalist>
            </form>
          ) : null}
          {shownTopics.map(({ topic, count }) => (
            <FilterTag key={topic} facet="topic" value={topic} filters={filters} count={count} />
          ))}
          {topicsOverflow ? (
            <button type="button" class="facet-more" data-action="toggle-marketplace-topics" aria-expanded={topicsExpanded}>
              {topicsExpanded ? "Show fewer" : `Show ${topics.length - shownTopics.length} more`}
            </button>
          ) : null}
        </FacetRow>
        <div class="facet-pair">
          <FacetRow facet="difficulty">
            {DIFFICULTY_TAGS.map((difficulty) => (
              <FilterTag
                key={difficulty}
                facet="difficulty"
                value={difficulty}
                filters={filters}
                count={countIf("difficulty", difficulty)}
              />
            ))}
          </FacetRow>
          <FacetRow facet="format">
            {FORMAT_TAGS.map((format) => (
              <FilterTag key={format} facet="format" value={format} filters={filters} count={countIf("format", format)} />
            ))}
          </FacetRow>
        </div>
      </div>
      <div class="marketplace-results-bar">
        <div class="marketplace-trail">
          <p class="marketplace-count" role="status">
            {filtered
              ? `${shownListings.length} of ${listings.length} curricula`
              : `${listings.length} curricul${listings.length === 1 ? "um" : "a"}`}
          </p>
          {filtered ? (
            <>
              <ul class="filter-trail" aria-label="Active filters">
                {chosenTiers.length > 0 ? (
                  <li class="trail-path">
                    <ol class="trail-tiers" aria-label="Category path">
                      {chosenTiers.map(trailStep)}
                    </ol>
                  </li>
                ) : null}
                {chosenFacets.map(trailStep)}
                {filters.query ? (
                  <li class="trail-step" data-facet="query">
                    <button
                      type="button"
                      class="trail-chip"
                      data-action="set-marketplace-query"
                      data-query=""
                      aria-label={`Remove search: ${filters.query}`}
                    >
                      “{filters.query}”
                      <SfIcon name="close" size={15} />
                    </button>
                  </li>
                ) : null}
              </ul>
              {clearButton}
            </>
          ) : null}
        </div>
        <div class="marketplace-sort" role="group" aria-label="Sort">
          {MARKETPLACE_SORTS.map((sort) => (
            <button
              key={sort}
              type="button"
              class="sort-btn"
              data-action="set-marketplace-sort"
              data-sort={sort}
              aria-pressed={sort === marketplaceSort}
            >
              {SORT_LABELS[sort]}
            </button>
          ))}
        </div>
      </div>
      {shownListings.length > 0 ? (
        <div class="marketplace-grid">
          {shownListings.map((listing) => {
            const id = listing.publicationId;
            const projection = publicProjectionOf(listing.curriculum);
            const yours = !signedOut && listing.ownerAccountId === account.accountId;
            const myPlan = planOf(listing);
            const voted =
              !signedOut && votes.some((vote) => vote.revisionId === listing.revisionId && vote.accountId === account.accountId);
            const units = projection.modules.length;
            const upvotes = upvotesOf(listing);
            const tags = listingTagsOf(listing);
            const { difficulty, format } = tags;
            return (
              <article
                key={id}
                class="marketplace-card public-template-card"
                data-publication-id={id}
                data-revision-id={listing.revisionId}
                data-subject={tags.subject}
                aria-labelledby={`listing-${id}-title`}
                data-opaque-surface="true"
              >
                <div class="marketplace-card-head">
                  <span class="marketplace-card-icon" aria-hidden="true">
                    <SfIcon name={tags.subjectIcon} />
                  </span>
                  {isOneOf(SUBJECT_TAGS, tags.subject) ? (
                    <FilterTag facet="subject" value={tags.subject} filters={filters} />
                  ) : null}
                  {difficulty ? <FilterTag facet="difficulty" value={difficulty} filters={filters} /> : null}
                  {format ? <FilterTag facet="format" value={format} filters={filters} /> : null}
                </div>
                <div class="marketplace-card-body">
                  <h2 id={`listing-${id}-title`} class="marketplace-title">
                    {projection.title}
                  </h2>
                  <p class="marketplace-summary">{projection.summary}</p>
                </div>
                <div class="marketplace-topics">
                  {tags.topicTags.map((topic) => (
                    <FilterTag key={topic} facet="topic" value={topic} filters={filters} />
                  ))}
                </div>
                <p class="marketplace-meta">
                  <span class="marketplace-handle">{listing.handle}</span>
                  {listing.basedOn ? ` · based on ${listing.basedOn}` : ""} · {units} unit{units === 1 ? "" : "s"} · {adoptionsOf(listing)} adopted
                </p>
                <div class="marketplace-card-foot">
                  <button
                    type="button"
                    class="upvote-btn"
                    data-action="toggle-upvote"
                    data-publication-id={id}
                    data-revision-id={listing.revisionId}
                    aria-pressed={voted}
                    aria-label={`Upvote (${upvotes})`}
                  >
                    <SfIcon name="upvote" />
                    <span class="upvote-count">{upvotes}</span>
                  </button>
                  {yours || myPlan ? <span class="owned-badge">{yours ? "Yours" : "In your plans"}</span> : null}
                  {myPlan ? (
                    <button
                      type="button"
                      class="btn-secondary"
                      data-action="open-curriculum-plan"
                      data-curriculum-id={myPlan.curriculumId}
                    >
                      Open
                    </button>
                  ) : yours ? null : (
                    <button type="button" class="btn-primary" data-action="open-adopt-dialog" data-publication-id={id}>
                      Details
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div class="empty-state marketplace-empty">
          <SfIcon name="explore" />
          <span>No curricula match these filters.</span>
          {clearButton}
        </div>
      )}
      <p class="meta-text marketplace-note">
        Community publications have not automatically passed educational review.
      </p>
      <div class="action-row load-more-row">
        <button type="button" class="btn-secondary" data-action="load-more">
          Load more
        </button>
      </div>
      {loadMoreNote ? (
        <p class="prose" role="status">
          {loadMoreNote}
        </p>
      ) : null}
      {signedOut ? null : (
        <section class="surface-panel my-publications" aria-labelledby="my-publications-title" data-opaque-surface="true">
          <div class="my-publications-head">
            <div>
              <h2 id="my-publications-title">My Publications</h2>
              {published ? (
                <p class="meta-text">
                  Thank you for teaching in the open. Every adoption is a learner who studies your syllabus for free.
                </p>
              ) : null}
            </div>
            {published ? shareButton("Share another curriculum", "btn-secondary") : null}
          </div>
          {published ? (
            <>
              <dl class="philanthropy-impact">
                <div class="impact-hero">
                  <dt>
                    <OpenKnowledgeArt />
                    Learners reached
                  </dt>
                  <dd class="impact-value">{ownedTotal(adoptionsOf)}</dd>
                  <dd class="impact-caption">
                    Self-learners studying your shared {ownedListings.length === 1 ? "syllabus" : "syllabi"} at no cost
                  </dd>
                </div>
                {supportingImpact.map(([icon, label, value, caption]) => (
                  <div key={label} class="impact-support">
                    <dt>
                      <span class="impact-icon-badge">
                        <SfIcon name={icon} />
                      </span>
                      {label}
                    </dt>
                    <dd class="impact-value">{value}</dd>
                    {caption ? <dd class="impact-caption">{caption}</dd> : null}
                  </div>
                ))}
                <div class="impact-seal">
                  <dt>
                    <span class="impact-seal-emblem">
                      <SfIcon name="globe" />
                    </span>
                    Free for every learner
                  </dt>
                  <dd class="impact-license">CC BY 4.0</dd>
                  <dd class="impact-caption">
                    Each adoption gives a learner your plan's structured study hours at no cost. Anyone may reuse and adapt it with credit to you.
                  </dd>
                </div>
              </dl>
              <ul class="publication-list">
                {ownedListings.map((listing) => {
                  const title = goalTitleOf(listing.curriculum);
                  const myPlan = planOf(listing);
                  const tags = listingTagsOf(listing);
                  return (
                    <li key={listing.publicationId} data-publication-id={listing.publicationId}>
                      <strong>{title}</strong>
                      <span class="publication-revision">Public · Revision 1</span>
                      <span class="marketplace-card-icon" data-subject={tags.subject} aria-hidden="true">
                        <SfIcon name={tags.subjectIcon} />
                      </span>
                      {tags.topicTags.length > 0 ? (
                        <span class="publication-topics">
                          {tags.topicTags.map((topic) => (
                            <span key={topic} class="tag">
                              {topic}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      <p class="publication-impact">
                        {adoptionsOf(listing) > 0 ? (
                          <>
                            {impactPill("course", adoptionsOf(listing), "learner")}
                            {impactPill("clock", studyHoursOf(listing), "study hour")}
                            {impactPill("upvote", upvotesOf(listing), "upvote")}
                          </>
                        ) : (
                          <span class="impact-pill">
                            <SfIcon name="globe" />
                            <span>Live in Explore and ready for its first learner</span>
                          </span>
                        )}
                      </p>
                      <span class="publication-actions">
                        {myPlan ? (
                          <button
                            type="button"
                            class="btn-secondary"
                            data-action="open-curriculum-plan"
                            data-curriculum-id={myPlan.curriculumId}
                          >
                            Open
                          </button>
                        ) : null}
                        <button
                          type="button"
                          class="unpublish-btn"
                          data-action="open-dialog"
                          data-dialog-id="dialog-unpublish"
                          aria-label={`Unpublish ${title}`}
                        >
                          Unpublish
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div class="publish-invite">
              <OpenKnowledgeArt />
              <div>
                <h3>Help the next learner start where you did</h3>
                <p class="prose meta-text">
                  Publishing shares your plan's structure under CC BY 4.0, so any self-learner can adopt it for free. Your progress, notes, evidence, keys, billing, and session dates stay private.
                </p>
                {shareButton("Share your first curriculum", "btn-primary")}
              </div>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

export interface AdoptCurriculumDialogProps {
  readonly open: boolean;
  readonly adoptListing: MarketplaceListing | null;
  readonly adoptModuleIds: readonly string[];
  readonly adoptions: readonly Adoption[];
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
}

// An activity's kind in a learner's words. A coding activity is a code lab.
const activityKindOf = (activity: StudyActivity): string =>
  activity.type === "coding" ? "Code lab" : humanize(activity.type);

const requirementOf = (activity: StudyActivity): "gate" | "required" | "optional" =>
  activity.masteryGated ? "gate" : activity.required ? "required" : "optional";

const REQUIREMENT_LABELS = { gate: "Mastery gate", required: "Required", optional: "Optional" } as const;

export function AdoptCurriculumDialog({
  open,
  adoptListing,
  adoptModuleIds,
  adoptions,
  proficiency,
  catalogResources,
}: AdoptCurriculumDialogProps): VNode {
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;

  return (
    <dialog
      id="dialog-partial-adoption"
      closedby="any"
      aria-labelledby="dialog-partial-adoption-title"
      data-open={String(open)}
      data-opaque-surface="true"
    >
      <form method="dialog" class="dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-partial-adoption-title">Details</h2>
          <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
            <SfIcon name="close" />
          </button>
        </header>
        {!adoptListing ? (
          <p class="meta-text">Choose a curriculum in Explore to preview it.</p>
        ) : (
          (() => {
            const projection = publicProjectionOf(adoptListing.curriculum);
            // The resolver reads an empty selection as the whole curriculum, so an empty selection adopts nothing here.
            const scope = adoptModuleIds.length > 0 ? adoptionScopeOf(adoptListing, adoptModuleIds) : null;
            const included = new Set(scope?.resolvedModuleIds ?? []);
            const autoIncluded = new Set(scope?.autoIncludedPrerequisiteModuleIds ?? []);
            const model = buildPlanMapAndOutlineModel({
              curriculum: adoptListing.curriculum,
              proficiency,
              activityStates: {},
              catalogResources,
            });
            const { goal, outlineModules: outline } = model;
            const unitNumber = new Map(projection.modules.map((mod, index) => [mod.module_id, index + 1]));
            const chosen = outline.filter((mod) => included.has(mod.moduleId));
            const total = { min: 0, point: 0, max: 0 };
            for (const mod of chosen) {
              total.min += mod.durationTriplet.min;
              total.point += mod.durationTriplet.point;
              total.max += mod.durationTriplet.max;
            }
            const difficulty = difficultyTagOf(adoptListing);
            const format = formatTagOf(adoptListing);
            const units = projection.modules.length;
            return (
              <>
                <section class="adopt-overview" aria-labelledby="adopt-title">
                  <p class="marketplace-card-head">
                    <span class="marketplace-card-icon" data-subject={adoptListing.subject} aria-hidden="true">
                      <SfIcon name={SUBJECT_ICONS[adoptListing.subject] ?? "course"} />
                    </span>
                    <span class="tag">{tagLabelOf(adoptListing.subject)}</span>
                    {difficulty ? <span class="tag">{difficulty}</span> : null}
                    {format ? <span class="tag">{format}</span> : null}
                  </p>
                  <h3 id="adopt-title" class="adopt-title">
                    {projection.title}
                  </h3>
                  <p class="meta-text">
                    {adoptListing.handle} · {units} unit{units === 1 ? "" : "s"} · {effortWords(model.totalDurationTriplet)} · {adoptionsOf(adoptListing)} adopted · CC BY 4.0
                  </p>
                  {projection.summary ? <p class="prose adopt-summary">{projection.summary}</p> : null}
                  {goal.includedTopics.length + goal.excludedTopics.length > 0 ? (
                    <dl class="adopt-coverage">
                      {goal.includedTopics.length > 0 ? (
                        <div>
                          <dt>Covers</dt>
                          <dd>
                            {goal.includedTopics.map((topic) => (
                              <span key={topic} class="badge">
                                {topic}
                              </span>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                      {goal.excludedTopics.length > 0 ? (
                        <div>
                          <dt>Not covered</dt>
                          <dd>{goal.excludedTopics.join(", ")}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  {goal.scopeNote ? <p class="meta-text">{goal.scopeNote}</p> : null}
                </section>
                <section aria-labelledby="adopt-units-title">
                  <div class="adopt-units-head">
                    <h3 id="adopt-units-title">Units</h3>
                    <button
                      type="button"
                      class="select-all-btn"
                      data-action="select-all-adopt-modules"
                      disabled={included.size === units}
                    >
                      Select all
                    </button>
                  </div>
                  <ol class="adopt-units">
                    {projection.modules.map((mod, index) => {
                      const number = index + 1;
                      const unit = outline.find((entry) => entry.moduleId === mod.module_id);
                      const needs = (mod.prerequisite_module_ids ?? [])
                        .map((moduleId) => `U${unitNumber.get(moduleId) ?? "?"}`)
                        .join(", ");
                      return (
                        <li key={mod.module_id} class="adopt-unit" data-included={String(included.has(mod.module_id))}>
                          <button
                            type="button"
                            class="adopt-unit-toggle"
                            role="checkbox"
                            aria-checked={included.has(mod.module_id)}
                            data-action="toggle-adopt-module"
                            data-module-id={mod.module_id}
                          >
                            <span class="adopt-check" aria-hidden="true">
                              <SfIcon name="check" size={15} />
                            </span>
                            <span class="adopt-unit-text">
                              <span class="adopt-unit-title">
                                U{number} · {displayUnitTitle(mod.title)}
                              </span>
                              <span class="adopt-unit-meta">
                                {unit ? <span>{effortWords(unit.durationTriplet)}</span> : null}
                                {needs ? <span class="requires-badge">Requires {needs}</span> : null}
                                {autoIncluded.has(mod.module_id) ? (
                                  <span class="auto-badge">Auto-included prerequisite</span>
                                ) : null}
                              </span>
                            </span>
                          </button>
                          {unit?.summary ? <p class="adopt-unit-summary">{unit.summary}</p> : null}
                          {unit && unit.activities.length > 0 ? (
                            <ol class="adopt-activities" aria-label={`Unit ${number} activities`}>
                              {unit.activities.map((activity, step) => {
                                const requirement = requirementOf(activity);
                                return (
                                  <li key={activity.activityId} class="adopt-activity">
                                    <span class="adopt-step">
                                      {number}.{step + 1}
                                    </span>
                                    <div class="adopt-activity-body">
                                      <p class="adopt-activity-title">{activity.title}</p>
                                      <p class="adopt-activity-meta">
                                        {activityKindOf(activity)} ·{" "}
                                        <span class="adopt-requirement" data-requirement={requirement}>
                                          {REQUIREMENT_LABELS[requirement]}
                                        </span>
                                      </p>
                                      {activity.resourceProvenanceCards.length > 0 ? (
                                        <ul class="adopt-resources" aria-label="Study resources">
                                          {activity.resourceProvenanceCards.map((card, cardIndex) => (
                                            <li key={`${card.resourceVersionId}-${cardIndex}`}>
                                              <SfIcon name="resources" size={15} />
                                              <span>
                                                {card.canonicalUrl ? (
                                                  <a href={card.canonicalUrl} target="_blank" rel="noopener noreferrer">
                                                    {card.title}
                                                    <span class="st-sr"> (opens in a new tab)</span>
                                                  </a>
                                                ) : (
                                                  card.title
                                                )}
                                                <span class="adopt-publisher">
                                                  {card.verifiedPublisher} <span class="badge">{humanize(card.accessModel)} access</span>
                                                </span>
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      ) : null}
                                    </div>
                                    <span class="adopt-minutes">{activity.durationTriplet.point} min</span>
                                  </li>
                                );
                              })}
                            </ol>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </section>
                <p class="prose meta-text adopt-terms">
                  Adoption creates your private draft. It copies none of the author's progress, evidence, votes, keys, or spending authority, and it costs $0.00. You review the draft on the Plan page and activate it there.
                </p>
                <footer class="dialog-footer">
                  <p class="adopt-total">
                    {scope ? `${included.size} of ${units} units · ${effortWords(total)}` : "Select at least one unit."}
                  </p>
                  <button
                    type="button"
                    class="btn-primary"
                    data-action="confirm-adopt-curriculum"
                    data-publication-id={adoptListing.publicationId}
                    disabled={!scope}
                  >
                    Adopt into My Plans
                    <span aria-hidden="true">→</span>
                  </button>
                </footer>
              </>
            );
          })()
        )}
      </form>
    </dialog>
  );
}

export interface PublicationPreviewDialogProps {
  readonly open: boolean;
  readonly account: Account;
  readonly selectedPlan: ActiveCurriculum;
  readonly publishedFromHere: boolean;
  readonly originListing: MarketplaceListing | undefined;
}

export function PublicationPreviewDialog({
  open,
  account,
  selectedPlan,
  publishedFromHere,
  originListing,
}: PublicationPreviewDialogProps): VNode {
  const publicProjection = publicProjectionOf(selectedPlan.curriculum);
  return (
    <dialog
      id="dialog-publication-preview"
      closedby="any"
      aria-labelledby="dialog-publication-preview-title"
      data-open={String(open)}
      data-opaque-surface="true"
    >
      <form method="dialog" class="dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-publication-preview-title">Share to Marketplace</h2>
          <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
            <SfIcon name="close" />
          </button>
        </header>
        <p class="meta-text">This preview is exactly what becomes public.</p>
        <section class="publish-preview" aria-labelledby="publish-preview-title">
          <h3 id="publish-preview-title">{publicProjection.title}</h3>
          <p class="prose">{publicProjection.summary}</p>
          <p class="meta-text">
            {handleOf(account)} · {publicProjection.modules.length} units · {`${selectedPlan.domain} · ${selectedPlan.assessmentMode}`} · CC BY 4.0
          </p>
          <ol class="publish-units">
            {publicProjection.modules.map((mod) => (
              <li key={mod.module_id}>{displayUnitTitle(mod.title)}</li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="publish-private-title">
          <h3 id="publish-private-title">Removed before publishing</h3>
          <ul class="lab-checklist privacy-checklist">
            {PRIVATE_FIELDS_REMOVED.map((item) => (
              <li key={item}>
                <StatusGlyph type="module" tone="done" size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <p class="prose meta-text">
          Visibility: Public. The listing appears in Explore, and anyone can read it. Linked materials stay links, and their content is not relicensed.
        </p>
        {originListing ? (
          <p class="prose meta-text">
            Based on {originListing.handle}'s template. Their attribution stays on your listing.
          </p>
        ) : null}
        {publishedFromHere ? (
          <p class="prose" role="status">
            This plan is already in the Marketplace as revision 1.
          </p>
        ) : (
          <footer class="dialog-footer">
            <button type="button" class="btn-primary" data-action="confirm-publish-curriculum">
              Publish to Marketplace
              <span aria-hidden="true">→</span>
            </button>
          </footer>
        )}
      </form>
    </dialog>
  );
}
