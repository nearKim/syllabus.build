import type { ComponentChildren, VNode } from "preact";
import {
  buildPlanMapAndOutlineModel,
  renderUntrustedCatalogText,
  type CatalogResourceMetadataInput,
} from "../../../../packages/ui/src/index.ts";
import type { ProficiencyProfileFixture } from "../diagnosticsAndAdaptation.ts";
import { resolveTransitiveAdoptionScope, type PublicCurriculumContentBlock } from "../billingAndSharing.ts";
import { normalizeStringList } from "../shared.ts";
import { handleOf } from "./AuthDialog.tsx";
import type { Account, AuthStatus } from "./HeaderBar.tsx";
import { SfIcon, StatusGlyph, type SfIconName } from "./Icons.tsx";
import { displayUnitTitle, effortWords, humanize, isOneOf } from "./StudyFlowBoard.tsx";

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
    domain: listing.subject,
    assessmentMode: listing.gateStyle,
    publicationId: listing.publicationId,
    draft: !adoption.active,
    curriculum: {
      ...listing.curriculum,
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

// The difficulty is the plan's math depth.
const difficultyTagOf = (listing: MarketplaceListing): (typeof DIFFICULTY_TAGS)[number] | null => {
  const depth = mathDepthFor(listing.curriculum, []);
  return isOneOf(DIFFICULTY_TAGS, depth) ? depth : null;
};

// The format is the assessment a listing gates on, named in one or two words.
const formatTagOf = (listing: MarketplaceListing): (typeof FORMAT_TAGS)[number] | null =>
  FORMAT_TAGS.find((format) => listing.gateStyle.includes(format)) ?? null;

const inTiers = (listing: MarketplaceListing, filters: MarketplaceFilters): boolean =>
  (filters.category === "All" || categoryOf(listing.subject) === filters.category) &&
  (filters.subject === "All" || listing.subject === filters.subject);

const matchesFilters = (listing: MarketplaceListing, filters: MarketplaceFilters): boolean =>
  inTiers(listing, filters) &&
  (filters.topic === "All" || listing.topicTags.includes(filters.topic)) &&
  (filters.difficulty === "All" || difficultyTagOf(listing) === filters.difficulty) &&
  (filters.format === "All" || formatTagOf(listing) === filters.format) &&
  (!filters.query ||
    [goalTitleOf(listing.curriculum), publicProjectionOf(listing.curriculum).summary, listing.handle, listing.subject,
      categoryOf(listing.subject) ?? "", ...listing.topicTags]
      .join(" ")
      .toLowerCase()
      .includes(filters.query.toLowerCase()));

// The values a facet accepts. Topics are the tags that some listing carries.
export const facetValuesOf = (facet: MarketplaceFacet, listings: readonly MarketplaceListing[]): readonly string[] =>
  facet === "category" ? MARKETPLACE_CATEGORIES
    : facet === "subject" ? MARKETPLACE_SUBJECTS
      : facet === "difficulty" ? MARKETPLACE_DIFFICULTIES
        : facet === "format" ? MARKETPLACE_FORMATS
          : ["All", ...listings.flatMap((listing) => listing.topicTags)];

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
    scoped.topic === "All" || listings.some((listing) => inTiers(listing, scoped) && listing.topicTags.includes(scoped.topic));
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
    ...new Set(listings.filter((listing) => inTiers(listing, filters)).flatMap((listing) => listing.topicTags)),
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
            const myPlan = myPlans.find(
              (plan) => plan.publicationId === listing.publicationId || plan.curriculumId === listing.sourceCurriculumId,
            );
            const voted =
              !signedOut && votes.some((vote) => vote.revisionId === listing.revisionId && vote.accountId === account.accountId);
            const units = projection.modules.length;
            const upvotes = upvotesOf(listing);
            const difficulty = difficultyTagOf(listing);
            const format = formatTagOf(listing);
            return (
              <article
                key={id}
                class="marketplace-card public-template-card"
                data-publication-id={id}
                data-revision-id={listing.revisionId}
                data-subject={listing.subject}
                aria-labelledby={`listing-${id}-title`}
                data-opaque-surface="true"
              >
                <div class="marketplace-card-head">
                  <span class="marketplace-card-icon" aria-hidden="true">
                    <SfIcon name={SUBJECT_ICONS[listing.subject] ?? "course"} />
                  </span>
                  {isOneOf(SUBJECT_TAGS, listing.subject) ? (
                    <FilterTag facet="subject" value={listing.subject} filters={filters} />
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
                  {listing.topicTags.map((topic) => (
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
        <section class="surface-panel my-publications" data-opaque-surface="true">
          <h2>My Publications</h2>
          <p class="meta-text">Owner records load fresh on every visit and are never cached.</p>
          {ownedListings.length > 0 ? (
            <>
              <ul class="publication-list">
                {ownedListings.map((listing) => (
                  <li key={listing.publicationId} data-publication-id={listing.publicationId}>
                    <strong>{goalTitleOf(listing.curriculum)}</strong>
                    <span class="meta-text">
                      Public · Revision 1 · {upvotesOf(listing)} upvotes · {adoptionsOf(listing)} adopted
                    </span>
                  </li>
                ))}
              </ul>
              <p class="prose warning-copy">
                Unpublish makes all public revisions of this publication unavailable through app-controlled publication routes. It does not erase permitted private copies or external copies. Historical votes are not transferred.
              </p>
              <button type="button" class="btn-danger" data-action="open-dialog" data-dialog-id="dialog-unpublish">
                Unpublish
              </button>
            </>
          ) : (
            <p class="empty-state">
              <SfIcon name="resources" />
              <span>You have not published a curriculum yet.</span>
            </p>
          )}
        </section>
      )}
    </section>
  );
}

export interface AdoptCurriculumDialogProps {
  readonly open: boolean;
  readonly adoptListing: MarketplaceListing | null;
  readonly adoptScope: "full" | "units";
  readonly adoptModuleIds: readonly string[];
  readonly adoptions: readonly Adoption[];
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
}

export function AdoptCurriculumDialog({
  open,
  adoptListing,
  adoptScope,
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
          <button type="submit" class="btn-secondary" data-action="close-dialog">
            Close
          </button>
        </header>
        {!adoptListing ? (
          <p class="meta-text">Choose a curriculum in Explore to preview it.</p>
        ) : (
          (() => {
            const projection = publicProjectionOf(adoptListing.curriculum);
            const requested = adoptScope === "full" ? [] : adoptModuleIds;
            const scope = adoptScope === "units" && requested.length === 0 ? null : adoptionScopeOf(adoptListing, requested);
            const included = new Set(scope?.resolvedModuleIds ?? []);
            const autoIncluded = new Set(scope?.autoIncludedPrerequisiteModuleIds ?? []);
            const outline = buildPlanMapAndOutlineModel({
              curriculum: adoptListing.curriculum,
              proficiency,
              activityStates: {},
              catalogResources,
            }).outlineModules;
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
            return (
              <>
                <p class="marketplace-card-head">
                  <span class="marketplace-card-icon" data-subject={adoptListing.subject} aria-hidden="true">
                    <SfIcon name={SUBJECT_ICONS[adoptListing.subject] ?? "course"} />
                  </span>
                  <span class="tag">{tagLabelOf(adoptListing.subject)}</span>
                  {difficulty ? <span class="tag">{difficulty}</span> : null}
                  {format ? <span class="tag">{format}</span> : null}
                </p>
                <h3 class="adopt-title">{projection.title}</h3>
                <p class="meta-text">
                  {adoptListing.handle} · {projection.modules.length} units · {adoptionsOf(adoptListing)} adopted · CC BY 4.0
                </p>
                <div class="segmented adopt-scope" role="group" aria-label="What to adopt">
                  <button
                    type="button"
                    class="seg-btn"
                    data-action="set-adopt-scope"
                    data-scope="full"
                    aria-pressed={adoptScope === "full"}
                  >
                    Full curriculum
                  </button>
                  <button
                    type="button"
                    class="seg-btn"
                    data-action="set-adopt-scope"
                    data-scope="units"
                    aria-pressed={adoptScope === "units"}
                  >
                    Select units
                  </button>
                </div>
                <ul class="adopt-units">
                  {projection.modules.map((mod, index) => {
                    const unit = outline.find((entry) => entry.moduleId === mod.module_id);
                    const needs = (mod.prerequisite_module_ids ?? [])
                      .map((moduleId) => `U${unitNumber.get(moduleId) ?? "?"}`)
                      .join(", ");
                    const content = (
                      <>
                        <StatusGlyph type="module" tone={included.has(mod.module_id) ? "done" : "todo"} size={16} />
                        <span class="adopt-unit-text">
                          <span class="adopt-unit-title">
                            U{index + 1} · {displayUnitTitle(mod.title)}
                          </span>
                          <span class="adopt-unit-meta">
                            {unit ? `${unit.activities.length} activities · ${effortWords(unit.durationTriplet)}` : ""}
                            {needs ? ` · Requires ${needs}` : ""}
                          </span>
                          {autoIncluded.has(mod.module_id) ? (
                            <span class="auto-badge">Auto-included prerequisite</span>
                          ) : null}
                        </span>
                      </>
                    );
                    return (
                      <li key={mod.module_id}>
                        {adoptScope === "units" ? (
                          <button
                            type="button"
                            class="adopt-unit"
                            role="checkbox"
                            aria-checked={included.has(mod.module_id)}
                            data-action="toggle-adopt-module"
                            data-module-id={mod.module_id}
                          >
                            {content}
                          </button>
                        ) : (
                          <div class="adopt-unit">{content}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p class="adopt-total">
                  {scope
                    ? `${included.size} of ${projection.modules.length} units · ${effortWords(total)}`
                    : "Select at least one unit."}
                </p>
                <p class="prose meta-text">
                  Adoption creates your private draft. It copies none of the author's progress, evidence, votes, keys, or spending authority, and it costs $0.00. You review the draft on the Plan page and activate it there.
                </p>
                <div class="action-row">
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
                </div>
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
          <button type="submit" class="btn-secondary" data-action="close-dialog">
            Close
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
          <div class="action-row">
            <button type="button" class="btn-primary" data-action="confirm-publish-curriculum">
              Publish to Marketplace
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
