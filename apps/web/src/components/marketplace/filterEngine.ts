import {
  computeActivityDurationTriplet,
  renderUntrustedCatalogText,
} from "@syllabus/ui";
import { resolveTransitiveAdoptionScope, type PublicSyllabusContentBlock } from "../../billingAndSharing.ts";
import { asRecord, normalizeStringList, rawListOf } from "../../shared.ts";
import type { SfIconName } from "../Icons.tsx";
import { humanize, isOneOf } from "../StudyFlowBoard.tsx";
import {
  CATEGORY_TAGS,
  categoryOf,
  DIFFICULTY_TAGS,
  FORMAT_TAGS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_DIFFICULTIES,
  MARKETPLACE_FORMATS,
  MARKETPLACE_SUBJECTS,
  MATH_DEPTHS,
  SUBJECT_ICONS,
  tagLabelOf,
  type ActiveSyllabus,
  type Adoption,
  type CategoryTag,
  type MarketplaceFacet,
  type MarketplaceFilters,
  type MarketplaceListing,
  type MathDepth,
} from "./types.ts";

export const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

export function mathDepthFor(syllabus: Record<string, unknown>, topicIds: readonly string[]): string {
  const prefs = asRecord(syllabus["instruction_preferences_applied"]);
  const rawOverrides: unknown = prefs["topic_math_depth_overrides"];
  const overrides = (Array.isArray(rawOverrides) ? rawOverrides : []).map(asRecord);
  const depthOf = (topicId: string | null): unknown =>
    overrides.find((entry) => entry["topic_id"] === topicId)?.["math_depth"] ?? prefs["math_depth"];
  const depths = new Set(
    (topicIds.length > 0 ? topicIds : [null]).map(depthOf).filter((depth): depth is MathDepth => isOneOf(MATH_DEPTHS, depth)),
  );
  return [...depths].map(humanize).join(", ") || "Not stated";
}

export interface SyllabusTagDescriptor {
  readonly category: CategoryTag | null;
  readonly subject: string;
  readonly subjectLabel: string;
  readonly subjectIcon: SfIconName;
  readonly gateStyle: string;
  readonly difficulty: (typeof DIFFICULTY_TAGS)[number] | null;
  readonly format: (typeof FORMAT_TAGS)[number] | null;
  readonly topicTags: readonly string[];
}

// Single source of truth for syllabus tags shared by Explore and Learn.
// Reads canonical tag metadata directly from the syllabus document (with optional legacy fallbacks).
export function syllabusTagsOf(
  syllabus: Record<string, unknown>,
  fallback?: {
    readonly subject?: string | undefined;
    readonly gateStyle?: string | undefined;
    readonly topicTags?: readonly string[] | undefined;
  },
): SyllabusTagDescriptor {
  const subject = textOf(syllabus["subject"]) || fallback?.subject || "Engineering";
  const gateStyle = textOf(syllabus["gate_style"]) || fallback?.gateStyle || "Reviewed Quiz";
  const depth = mathDepthFor(syllabus, []);
  const difficulty = isOneOf(DIFFICULTY_TAGS, depth) ? depth : null;
  const format = FORMAT_TAGS.find((entry) => gateStyle.includes(entry)) ?? null;
  const fromSyllabus = normalizeStringList(syllabus["topic_tags"]);
  const fromFallback = fallback?.topicTags ? [...fallback.topicTags] : [];
  const topicTags =
    fromSyllabus.length > 0
      ? fromSyllabus
      : fromFallback.length > 0
        ? fromFallback
        : normalizeStringList(asRecord(syllabus["goal"])["included_topics"]);
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

// A plan's estimated study time at 1x speed, in minutes.
export const studyMinutesOf = (syllabus: Record<string, unknown>): number =>
  rawListOf(syllabus, "activities").reduce(
    (sum, activity) => sum + computeActivityDurationTriplet(activity["duration_estimate"], 1).point,
    0,
  );

export const goalTitleOf = (syllabus: Record<string, unknown>): string =>
  renderUntrustedCatalogText(asRecord(syllabus["goal"])["title"], { maxLength: 200 }).text || "Untitled plan";

export function publicProjectionOf(syllabus: Record<string, unknown>): PublicSyllabusContentBlock {
  const edges = rawListOf(syllabus, "prerequisite_edges").map((edge) => ({
    from_objective_id: textOf(edge["from_objective_id"]),
    to_objective_id: textOf(edge["to_objective_id"]),
  }));
  return {
    title: goalTitleOf(syllabus),
    summary: renderUntrustedCatalogText(asRecord(syllabus["goal"])["summary"], { maxLength: 600 }).text,
    objectives: rawListOf(syllabus, "objectives").map((objective) => ({
      objective_id: textOf(objective["objective_id"]),
      title: textOf(objective["title"]),
      prerequisite_objective_ids: edges
        .filter((edge) => edge.to_objective_id === objective["objective_id"])
        .map((edge) => edge.from_objective_id),
    })),
    prerequisite_edges: edges,
    modules: rawListOf(syllabus, "modules").map((mod) => ({
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
  listing ? publicProjectionOf(listing.syllabus).modules.map((mod) => mod.module_id) : [];

export const adoptionScopeOf = (listing: MarketplaceListing, requested: readonly string[]) =>
  resolveTransitiveAdoptionScope(
    {
      schema_version: "0.2.0",
      publication_id: listing.publicationId,
      publication_revision_id: listing.revisionId,
      revision_number: 1,
      published_at: listing.publishedAt,
      content_sha256: "",
      content: publicProjectionOf(listing.syllabus),
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

export function adoptedPlanOf(listing: MarketplaceListing, adoption: Adoption): ActiveSyllabus {
  const syllabusId = `adopted-${listing.publicationId}`;
  const tags = syllabusTagsOf(listing.syllabus, listing);
  const modules = rawListOf(listing.syllabus, "modules").filter((mod) =>
    adoption.moduleIds.includes(textOf(mod["module_id"])),
  );
  const activityIds = new Set(modules.flatMap((mod) => normalizeStringList(mod["activity_ids"])));
  const objectiveIds = new Set(modules.flatMap((mod) => normalizeStringList(mod["objective_ids"])));
  const revisionId = `${syllabusId}-draft-1`;
  const sessions = rawListOf(listing.schedule, "sessions")
    .map((session) => ({
      ...session,
      activity_ids: normalizeStringList(session["activity_ids"]).filter((id) => activityIds.has(id)),
    }))
    .filter((session) => session.activity_ids.length > 0);
  return {
    syllabusId,
    domain: tags.subject,
    assessmentMode: tags.gateStyle,
    publicationId: listing.publicationId,
    draft: !adoption.active,
    syllabus: {
      ...listing.syllabus,
      subject: tags.subject,
      gate_style: tags.gateStyle,
      topic_tags: tags.topicTags,
      syllabus_id: syllabusId,
      revision_id: revisionId,
      revision_number: 1,
      account_id: adoption.accountId,
      predecessor_revision_id: null,
      revision_reason: "adoption",
      modules,
      activities: rawListOf(listing.syllabus, "activities").filter((act) => activityIds.has(textOf(act["activity_id"]))),
      objectives: rawListOf(listing.syllabus, "objectives")
        .filter((objective) => objectiveIds.has(textOf(objective["objective_id"])))
        .map((objective) => ({ ...objective, prior_evidence_refs: [] })),
      prerequisite_edges: rawListOf(listing.syllabus, "prerequisite_edges").filter(
        (edge) =>
          objectiveIds.has(textOf(edge["from_objective_id"])) && objectiveIds.has(textOf(edge["to_objective_id"])),
      ),
    },
    schedule: { ...listing.schedule, syllabus_revision_id: revisionId, sessions },
  };
}

export const listingTagsOf = (listing: MarketplaceListing): SyllabusTagDescriptor =>
  syllabusTagsOf(listing.syllabus, listing);

// The difficulty is the plan's math depth.
export const difficultyTagOf = (listing: MarketplaceListing): (typeof DIFFICULTY_TAGS)[number] | null =>
  listingTagsOf(listing).difficulty;

// The format is the assessment a listing gates on, named in one or two words.
export const formatTagOf = (listing: MarketplaceListing): (typeof FORMAT_TAGS)[number] | null =>
  listingTagsOf(listing).format;

export const inTiers = (listing: MarketplaceListing, filters: MarketplaceFilters): boolean => {
  const tags = listingTagsOf(listing);
  return (
    (filters.category === "All" || tags.category === filters.category) &&
    (filters.subject === "All" || tags.subject === filters.subject)
  );
};

export const matchesFilters = (listing: MarketplaceListing, filters: MarketplaceFilters): boolean => {
  const tags = listingTagsOf(listing);
  return (
    inTiers(listing, filters) &&
    (filters.topic === "All" || tags.topicTags.includes(filters.topic)) &&
    (filters.difficulty === "All" || tags.difficulty === filters.difficulty) &&
    (filters.format === "All" || tags.format === filters.format) &&
    (!filters.query ||
      [goalTitleOf(listing.syllabus), publicProjectionOf(listing.syllabus).summary, listing.handle, tags.subject,
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
