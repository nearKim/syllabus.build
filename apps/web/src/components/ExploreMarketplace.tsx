import type { VNode } from "preact";
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
import { SfIcon, StatusGlyph } from "./Icons.tsx";
import { displayUnitTitle, effortWords, humanize, isOneOf, type StudyModule } from "./StudyFlowBoard.tsx";

export const MARKETPLACE_DOMAINS = ["All", "Engineering", "Mathematics", "Humanities", "Systems"] as const;
export const MARKETPLACE_RIGORS = ["All", "Formal", "Applied", "Intuitive"] as const;
export const MARKETPLACE_SORTS = ["top_upvoted", "most_adopted", "newest"] as const;
export type MarketplaceDomain = (typeof MARKETPLACE_DOMAINS)[number];
export type MarketplaceRigor = (typeof MARKETPLACE_RIGORS)[number];
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];

export const SORT_LABELS: Readonly<Record<MarketplaceSort, string>> = {
  top_upvoted: "Top Upvoted",
  most_adopted: "Most Adopted",
  newest: "Newest",
};

export const FILTER_DOMAIN_OF: Readonly<Record<string, Exclude<MarketplaceDomain, "All">>> = {
  Engineering: "Engineering",
  Mathematics: "Mathematics",
  Literature: "Humanities",
  Systems: "Systems",
  Physics: "Mathematics",
};

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

function MarketplacePills({ listing, rigor }: { readonly listing: MarketplaceListing; readonly rigor: string }): VNode {
  return (
    <p class="marketplace-pills">
      <span class="domain-pill">{`${listing.subject} · ${listing.gateStyle}`}</span>
      <span class="rigor-badge">{rigor}</span>
      <span class="price-badge">Free · $0.00 adopt</span>
    </p>
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
  readonly marketplaceDomain: MarketplaceDomain;
  readonly marketplaceRigor: MarketplaceRigor;
  readonly marketplaceSort: MarketplaceSort;
  readonly marketplaceQuery: string;
  readonly loadMoreNote: string | null;
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
}

export function ExploreMarketplace({
  active,
  signedOut,
  account,
  listings,
  myPlans,
  votes,
  adoptions,
  marketplaceDomain,
  marketplaceRigor,
  marketplaceSort,
  marketplaceQuery,
  loadMoreNote,
  proficiency,
  catalogResources,
}: ExploreMarketplaceProps): VNode {
  const upvotesOf = (listing: MarketplaceListing): number =>
    listing.upvotes + votes.filter((vote) => vote.revisionId === listing.revisionId).length;
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;
  const rigorOf = (listing: MarketplaceListing): string => mathDepthFor(listing.curriculum, []);
  const rank = (listing: MarketplaceListing): number =>
    marketplaceSort === "top_upvoted"
      ? upvotesOf(listing)
      : marketplaceSort === "most_adopted"
        ? adoptionsOf(listing)
        : Date.parse(listing.publishedAt);
  const queryText = marketplaceQuery.toLowerCase();
  const shownListings = listings
    .filter((listing) => marketplaceDomain === "All" || FILTER_DOMAIN_OF[listing.subject] === marketplaceDomain)
    .filter((listing) => marketplaceRigor === "All" || rigorOf(listing) === marketplaceRigor)
    .filter(
      (listing) =>
        !queryText ||
        [goalTitleOf(listing.curriculum), publicProjectionOf(listing.curriculum).summary, listing.handle, listing.subject]
          .join(" ")
          .toLowerCase()
          .includes(queryText),
    )
    .sort((a, b) => rank(b) - rank(a) || goalTitleOf(a.curriculum).localeCompare(goalTitleOf(b.curriculum)));

  const outlineOf = (listing: MarketplaceListing): readonly StudyModule[] =>
    buildPlanMapAndOutlineModel({ curriculum: listing.curriculum, proficiency, activityStates: {}, catalogResources })
      .outlineModules;

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
          value={marketplaceQuery}
          placeholder="Search titles, curators, and subjects"
          autocomplete="off"
        />
        <button type="submit" class="btn-secondary">
          Search
        </button>
      </form>
      <div class="marketplace-controls">
        <div class="segmented" role="group" aria-label="Domain">
          {MARKETPLACE_DOMAINS.map((domain) => (
            <button
              key={domain}
              type="button"
              class="seg-btn"
              data-action="set-marketplace-domain"
              data-domain={domain}
              aria-pressed={domain === marketplaceDomain}
            >
              {domain}
            </button>
          ))}
        </div>
        <div class="segmented" role="group" aria-label="Rigor">
          {MARKETPLACE_RIGORS.map((rigor) => (
            <button
              key={rigor}
              type="button"
              class="seg-btn"
              data-action="set-marketplace-rigor"
              data-rigor={rigor}
              aria-pressed={rigor === marketplaceRigor}
            >
              {rigor === "All" ? "Any rigor" : rigor}
            </button>
          ))}
        </div>
        <div class="segmented" role="group" aria-label="Sort">
          {MARKETPLACE_SORTS.map((sort) => (
            <button
              key={sort}
              type="button"
              class="seg-btn"
              data-action="set-marketplace-sort"
              data-sort={sort}
              aria-pressed={sort === marketplaceSort}
            >
              {SORT_LABELS[sort]}
            </button>
          ))}
        </div>
      </div>
      <p class="marketplace-count" role="status">
        {shownListings.length} curricul{shownListings.length === 1 ? "um" : "a"}. Community publications have not automatically passed educational review.
      </p>
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
            return (
              <article
                key={id}
                class="marketplace-card public-template-card"
                data-publication-id={id}
                data-revision-id={listing.revisionId}
                aria-labelledby={`listing-${id}-title`}
                data-opaque-surface="true"
              >
                <MarketplacePills listing={listing} rigor={rigorOf(listing)} />
                <h2 id={`listing-${id}-title`} class="marketplace-title">
                  {projection.title}
                </h2>
                <p class="marketplace-summary">{projection.summary}</p>
                <p class="marketplace-meta">
                  {listing.handle}
                  {listing.basedOn ? ` · based on ${listing.basedOn}` : ""} · {units} unit{units === 1 ? "" : "s"} · {adoptionsOf(listing)} adopted
                </p>
                <details class="flow-preview">
                  <summary>Inspect Study Flow</summary>
                  <ol>
                    {outlineOf(listing).map((mod, index) => (
                      <li key={mod.moduleId}>
                        <span class="flow-preview-unit">
                          U{index + 1} · {displayUnitTitle(mod.title)}
                        </span>
                        <span class="meta-text">
                          {mod.activities.length} activities · {effortWords(mod.durationTriplet)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
                <div class="marketplace-actions">
                  <button
                    type="button"
                    class="btn-secondary upvote-btn"
                    data-action="toggle-upvote"
                    data-publication-id={id}
                    data-revision-id={listing.revisionId}
                    aria-pressed={voted}
                  >
                    ▲ Upvote Revision ({upvotesOf(listing)})
                  </button>
                  {yours || myPlan ? (
                    <>
                      <span class="owned-badge">{yours ? "Yours" : "In your plans"}</span>
                      {myPlan ? (
                        <button
                          type="button"
                          class="btn-secondary"
                          data-action="open-curriculum-plan"
                          data-curriculum-id={myPlan.curriculumId}
                        >
                          Open Plan
                          <span aria-hidden="true">→</span>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button type="button" class="btn-primary" data-action="open-adopt-dialog" data-publication-id={id}>
                      Preview &amp; Adopt
                      <span aria-hidden="true">→</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p class="empty-state">
          <SfIcon name="explore" />
          <span>No curricula match these filters.</span>
        </p>
      )}
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
          <h2 id="dialog-partial-adoption-title">Preview &amp; Adopt</h2>
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
            return (
              <>
                <MarketplacePills listing={adoptListing} rigor={mathDepthFor(adoptListing.curriculum, [])} />
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
