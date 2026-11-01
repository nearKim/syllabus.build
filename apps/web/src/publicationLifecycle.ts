import { buildOperationHeaders } from "@syllabus/api-client";
import { resolveSurfaceStyle, type ThemeMode } from "@syllabus/ui";

export interface PublicObjectiveNode {
  readonly objective_id: string; readonly title: string; readonly prerequisite_objective_ids?: readonly string[];
}

export interface PublicPrerequisiteEdge {
  readonly from_objective_id: string; readonly to_objective_id: string;
}

export interface PublicModuleNode {
  readonly module_id: string; readonly title: string; readonly summary?: string;
  readonly objective_ids?: readonly string[]; readonly activity_ids?: readonly string[]; readonly prerequisite_module_ids?: readonly string[];
}

export interface PublicSyllabusContentBlock {
  readonly title: string; readonly summary: string; readonly objectives?: readonly PublicObjectiveNode[];
  readonly prerequisite_edges?: readonly PublicPrerequisiteEdge[]; readonly modules: readonly PublicModuleNode[];
  readonly [key: string]: unknown;
}

export interface PublicSyllabusPayload {
  readonly schema_version: string; readonly publication_id: string; readonly publication_revision_id: string;
  readonly revision_number: number; readonly supersedes_publication_revision_id?: string | null;
  readonly visibility?: "public" | "unlisted"; readonly published_at: string; readonly content_sha256: string;
  readonly content: PublicSyllabusContentBlock; readonly upvote_count?: number | null; readonly viewer_has_upvoted?: boolean;
  readonly publisher: { readonly public_author_id: string; readonly display_name: string };
  readonly publication_terms: {
    readonly policy_id: string; readonly content_license_id: string; readonly rights_scope: string;
    readonly attribution: string; readonly third_party_materials_excluded: boolean;
  };
  readonly origin?: Record<string, unknown> | null;
}

export interface PublicationPreviewPayload {
  readonly preview_id: string; readonly source_plan_id?: string; readonly source_plan_version_id?: string;
  readonly visibility: "public" | "unlisted"; readonly content_sha256: string; readonly preview_sha256: string;
  readonly expires_at: string; readonly publication_terms_policy_id: string;
  readonly excluded_private_fields?: readonly string[]; readonly warnings?: readonly string[];
  readonly public_content: PublicSyllabusContentBlock;
  readonly publisher: { readonly public_author_id: string; readonly display_name: string };
  readonly publication_terms: {
    readonly policy_id: string; readonly content_license_id: string; readonly rights_scope: string;
    readonly attribution: string; readonly third_party_materials_excluded: boolean;
  };
}

export interface OwnedPublicationItem {
  readonly publication_id: string; readonly source_plan_id: string; readonly visibility: "public" | "unlisted";
  readonly state: "active" | "quarantined" | "unpublished"; readonly display_title: string | null;
  readonly published_revision_id: string | null; readonly current_revision_upvote_count: number | null;
  readonly created_at: string; readonly updated_at: string; readonly management_version_id: string;
}

export interface OwnedPublicationRevisionItem {
  readonly publication_id: string; readonly publication_revision_id: string; readonly revision_number: number;
  readonly source_plan_version_id: string; readonly visibility: "public" | "unlisted";
  readonly state: "active" | "quarantined" | "withdrawn"; readonly public_readable: boolean;
  readonly upvote_count: number | null; readonly published_at: string; readonly content_sha256: string;
}

const DEFAULT_EXCLUDED_PRIVATE_FIELDS = ["learner_notes", "attempt_history", "diagnostic_transcripts", "byok_credentials", "billing_ledger"] as const;

export function createPublicationLifecycleController(initial: {
  readonly preview?: PublicationPreviewPayload | null; readonly ownedPublications?: readonly OwnedPublicationItem[];
  readonly ownedRevisions?: readonly OwnedPublicationRevisionItem[]; readonly theme?: ThemeMode;
}) {
  const theme = initial.theme ?? "light";
  let currentPreview: PublicationPreviewPayload | null = initial.preview ?? null;
  let termsAccepted = false;
  let isPreviewStale = false;
  let ownedPublications: OwnedPublicationItem[] = [...(initial.ownedPublications ?? [])];
  let ownedRevisions: OwnedPublicationRevisionItem[] = [...(initial.ownedRevisions ?? [])];

  const voteMap = new Map<
    string,
    { publicationId: string; publicationRevisionId: string; viewerHasUpvoted: boolean; upvoteCount: number | null }
  >();

  const getState = () => ({
    previewSurface: resolveSurfaceStyle("consent", { themePreference: theme }),
    destructiveSurface: resolveSurfaceStyle("destructive_confirmation", { themePreference: theme }),
    cachePolicy: "private, no-store" as const,
    currentPreview,
    excludedPrivateFields: currentPreview ? (currentPreview.excluded_private_fields ?? DEFAULT_EXCLUDED_PRIVATE_FIELDS) : [],
    isPreviewStale,
    termsAccepted,
    ownedPublicationCards: ownedPublications.map((item) => ({
      publicationId: item.publication_id, state: item.state, visibility: item.visibility,
      displayTitleText: item.display_title ?? "Withheld pending moderation",
      isTitleWithheld: item.display_title === null,
      upvoteDisplayText: item.current_revision_upvote_count === null ? "Withheld pending moderation" : `${item.current_revision_upvote_count} upvotes`,
      isUpvoteCountWithheld: item.current_revision_upvote_count === null,
      managementVersionId: item.management_version_id,
      canPublishNewRevision: item.state === "active",
      canUnpublish: item.state !== "unpublished",
    })),
    ownedRevisions: [...ownedRevisions],
    revisionVotes: Array.from(voteMap.values()),
  });

  function buildPublishSyllabusRequest(options: {
    readonly idempotencyKey: string; readonly sourcePlanId?: string; readonly sourcePlanVersionId?: string; readonly nowIso?: string;
  }) {
    if (!currentPreview) throw new Error("A publication preview must be generated before publishing.");
    if (isPreviewStale) {
      throw new Error("PREVIEW_STALE: Publication metadata changed after preview generation. Request a new preview before publishing.");
    }
    if (!termsAccepted) {
      throw new Error("TERMS_REQUIRED: Explicit publication terms acceptance (accept_publication_terms: true) is required.");
    }
    if (options.nowIso && Date.parse(currentPreview.expires_at) <= Date.parse(options.nowIso)) {
      throw new Error("PREVIEW_EXPIRED: Publication preview has expired.");
    }
    return {
      operationId: "publishSyllabus" as const, method: "POST" as const, path: "/publications",
      headers: buildOperationHeaders("publishSyllabus", { idempotencyKey: options.idempotencyKey }),
      body: {
        preview_id: currentPreview.preview_id,
        source_plan_id: options.sourcePlanId ?? currentPreview.source_plan_id ?? "plan-synthetic-001",
        source_plan_version_id: options.sourcePlanVersionId ?? currentPreview.source_plan_version_id ?? "plan-version-synthetic-001",
        visibility: currentPreview.visibility,
        expected_preview_sha256: currentPreview.preview_sha256,
        expected_content_sha256: currentPreview.content_sha256,
        publication_terms_policy_id: currentPreview.publication_terms_policy_id,
        accept_publication_terms: true as const,
      },
    };
  }

  return {
    loadPreview(preview: PublicationPreviewPayload) {
      currentPreview = preview;
      isPreviewStale = false;
      termsAccepted = false;
      return getState();
    },
    mutateDraftMetadata(mutation: {
      readonly title?: string; readonly summary?: string; readonly attribution?: string;
      readonly visibility?: "public" | "unlisted"; readonly publicationTermsPolicyId?: string;
    }) {
      if (!currentPreview) throw new Error("No publication preview loaded.");
      const changed =
        (mutation.title !== undefined && mutation.title !== currentPreview.public_content.title) ||
        (mutation.summary !== undefined && mutation.summary !== currentPreview.public_content.summary) ||
        (mutation.attribution !== undefined && mutation.attribution !== currentPreview.publication_terms.attribution) ||
        (mutation.visibility !== undefined && mutation.visibility !== currentPreview.visibility) ||
        (mutation.publicationTermsPolicyId !== undefined && mutation.publicationTermsPolicyId !== currentPreview.publication_terms_policy_id);
      if (changed) {
        isPreviewStale = true;
        termsAccepted = false;
      }
      return { isPreviewStale, termsAccepted };
    },
    setPublicationTermsAccepted(accepted: boolean) {
      if (isPreviewStale) throw new Error("Cannot accept terms on a stale publication preview; generate a fresh preview first.");
      termsAccepted = accepted;
    },
    buildPublishSyllabusRequest,
    buildPublishRevisionRequest(options: { readonly publicationId: string; readonly idempotencyKey: string }) {
      const base = buildPublishSyllabusRequest({ idempotencyKey: options.idempotencyKey });
      return {
        operationId: "publishRevision" as const, method: "POST" as const,
        path: `/me/publications/${options.publicationId}/revisions`,
        headers: buildOperationHeaders("publishRevision", { idempotencyKey: options.idempotencyKey }),
        body: base.body,
      };
    },
    buildUnpublishSyllabusRequest(options: { readonly publicationId: string; readonly confirmUnpublish: boolean }) {
      if (!options.confirmUnpublish) {
        throw new Error("Unpublishing requires explicit destructive confirmation (confirmUnpublish: true).");
      }
      const owned = ownedPublications.find((item) => item.publication_id === options.publicationId);
      if (!owned) throw new Error(`Owned publication '${options.publicationId}' not found.`);
      return {
        operationId: "unpublishSyllabus" as const, method: "DELETE" as const,
        path: `/me/publications/${options.publicationId}`,
        headers: buildOperationHeaders("unpublishSyllabus", { ifMatch: owned.management_version_id }),
        adopterImpactDisclosure:
          "Withdrawing this publication removes all revisions from app-controlled public discovery immediately. Previously adopted private learner plans remain intact.",
      };
    },
    registerPublicRevisionVoteState(options: {
      readonly publicationId: string; readonly publicationRevisionId: string;
      readonly upvoteCount: number | null; readonly viewerHasUpvoted: boolean;
    }) {
      voteMap.set(`${options.publicationId}:${options.publicationRevisionId}`, {
        publicationId: options.publicationId, publicationRevisionId: options.publicationRevisionId,
        upvoteCount: options.upvoteCount, viewerHasUpvoted: options.viewerHasUpvoted,
      });
    },
    toggleRevisionUpvoteOptimistically(options: { readonly publicationId: string; readonly publicationRevisionId: string }) {
      const key = `${options.publicationId}:${options.publicationRevisionId}`;
      const current = voteMap.get(key);
      if (!current) throw new Error(`Unregistered revision vote state for '${key}'.`);
      const previous = { ...current };
      const nextUpvoted = !current.viewerHasUpvoted;
      const nextCount = current.upvoteCount === null ? null : Math.max(0, current.upvoteCount + (nextUpvoted ? 1 : -1));
      const updated = { ...current, viewerHasUpvoted: nextUpvoted, upvoteCount: nextCount };
      voteMap.set(key, updated);

      const operationId = nextUpvoted ? "setMyUpvote" : "removeMyUpvote";
      return {
        operationId, method: nextUpvoted ? "PUT" : "DELETE",
        path: `/publications/${options.publicationId}/revisions/${options.publicationRevisionId}/my-vote`,
        headers: buildOperationHeaders(operationId), optimisticState: updated,
        rollback: () => {
          voteMap.set(key, previous);
          return previous;
        },
      };
    },
    clearOnSignOutOrAccountSwitch() {
      currentPreview = null; termsAccepted = false; isPreviewStale = false;
      ownedPublications = []; ownedRevisions = []; voteMap.clear();
    },
    getState,
  };
}
export type OwnedPublicationViewCard = ReturnType<ReturnType<typeof createPublicationLifecycleController>["getState"]>["ownedPublicationCards"][number];
