import { buildOperationHeaders } from "../../../packages/api-client/src/index.ts";
import { resolveSurfaceStyle, type ResolvedSurfaceStyle, type ThemeMode } from "../../../packages/ui/src/index.ts";

export type CostBucketId = "app_service_access" | "ai_inference" | "learning_materials" | "certification_and_compute";

export interface MaterialResourceCostItem {
  readonly resourceId: string; readonly title: string; readonly required: boolean;
  readonly currency: string; readonly costMinor: number | null | undefined;
}

export interface CostBucketDisclosure {
  readonly bucketId: CostBucketId; readonly label: string;
  readonly billingMechanism: "platform_subscription" | "hosted_credit_wallet" | "external_byok_provider" | "external_merchant" | "none";
  readonly knownTotalMinor: number; readonly currency: string;
  readonly isNonBindingEstimate: boolean; readonly hasUnknownPrices: boolean; readonly formattedSummary: string;
  readonly lineItems: readonly { readonly id: string; readonly label: string; readonly formattedAmount: string; readonly isUnknownPrice: boolean }[];
}

export interface FourBucketCostBreakdownView {
  readonly surface: ResolvedSurfaceStyle;
  readonly buckets: { readonly [P in CostBucketId]: CostBucketDisclosure };
  readonly hasAnyUnknownPrice: boolean; readonly byokEstimateDisclaimer: string | null;
}

export interface HostedCreditWalletSnapshot {
  readonly currency: string; readonly available_minor: number; readonly reserved_minor: number;
  readonly live_billing_enabled: boolean; readonly updated_at: string;
}

export interface GenerationQuoteSnapshot {
  readonly quote_id: string; readonly mode: "hosted" | "byok"; readonly currency: string;
  readonly estimated_cost_minor: number; readonly max_charge_minor: number; readonly expires_at: string;
}

export interface BudgetReservationSnapshot {
  readonly reservation_id: string; readonly quote_id: string;
  readonly reserved_minor: number; readonly settled_minor: number; readonly released_minor: number;
  readonly status: "active" | "settled" | "released" | "expired"; readonly expires_at: string;
}

export interface LedgerEntrySnapshot {
  readonly entry_id: string; readonly occurred_at: string;
  readonly entry_type: "credit_purchase" | "reservation_hold" | "settlement_debit" | "reservation_release" | "refund";
  readonly delta_minor: number; readonly balance_after_minor: number; readonly reference_id: string; readonly summary: string;
}

export interface UsageItemSnapshot {
  readonly usage_id: string;
  readonly operation_kind: "syllabus_generation" | "plan_adaptation" | "diagnostic_generation" | "generative_adoption";
  readonly inference_mode: "hosted" | "byok"; readonly quote_id: string | null; readonly reservation_id: string | null;
  readonly reserved_minor: number; readonly settled_minor: number; readonly released_minor: number; readonly occurred_at: string;
}

export interface HostedGenerationInnerRequest {
  readonly schema_version: string; readonly goal: Record<string, unknown>; readonly learner_profile: Record<string, unknown>;
  readonly constraints: Record<string, unknown>; readonly access_policy: Record<string, unknown>;
  readonly budgets: {
    readonly materials: { readonly currency: string; readonly max_minor_units: number };
    readonly compute: { readonly currency: string; readonly max_minor_units: number };
    readonly inference: { readonly currency: string; readonly max_minor_units: number };
  };
  readonly inference: { readonly mode: "hosted"; readonly model_policy_id: string };
  readonly generation_options: Record<string, unknown>; readonly instruction_preferences: Record<string, unknown>;
  readonly template_origin: Record<string, unknown> | null;
}

export function formatMinorCurrency(amountMinor: number | null | undefined, currency = "USD"): string {
  if (amountMinor === null || amountMinor === undefined) return "Price unknown (verify externally)";
  const sign = amountMinor < 0 ? "-" : "";
  const major = (Math.abs(amountMinor) / 100).toFixed(2);
  return currency === "USD" ? `${sign}$${major}` : `${sign}${major} ${currency}`;
}

export function buildFourBucketCostBreakdown(options: {
  readonly theme?: ThemeMode; readonly appServiceAccessMinor?: number;
  readonly inferenceMode: "deterministic" | "hosted" | "byok"; readonly inferenceQuoteMinor?: number;
  readonly materials: readonly MaterialResourceCostItem[]; readonly certificationAndComputeMinor?: number; readonly currency?: string;
}): FourBucketCostBreakdownView {
  const theme = options.theme ?? "light";
  const currency = options.currency ?? "USD";
  const appMinor = options.appServiceAccessMinor ?? 0;
  const certMinor = options.certificationAndComputeMinor ?? 0;
  const inferenceMinor = options.inferenceMode === "deterministic" ? 0 : (options.inferenceQuoteMinor ?? 0);

  let materialsKnownMinor = 0;
  let materialsHasUnknown = false;
  const materialLines = options.materials.map((item) => {
    const isUnknown = item.costMinor === null || item.costMinor === undefined;
    if (isUnknown) materialsHasUnknown = true;
    else materialsKnownMinor += item.costMinor;
    return {
      id: item.resourceId, label: item.title,
      formattedAmount: formatMinorCurrency(item.costMinor, item.currency || currency), isUnknownPrice: isUnknown,
    };
  });

  return {
    surface: resolveSurfaceStyle("pricing", { themePreference: theme }),
    buckets: {
      app_service_access: {
        bucketId: "app_service_access", label: "1. App Service Access", billingMechanism: "platform_subscription",
        knownTotalMinor: appMinor, currency, isNonBindingEstimate: false, hasUnknownPrices: false,
        formattedSummary: formatMinorCurrency(appMinor, currency),
        lineItems: [{ id: "app-access", label: "Platform workspace & offline sync access", formattedAmount: formatMinorCurrency(appMinor, currency), isUnknownPrice: false }],
      },
      ai_inference: {
        bucketId: "ai_inference", label: "2. AI Inference",
        billingMechanism: options.inferenceMode === "hosted" ? "hosted_credit_wallet" : options.inferenceMode === "byok" ? "external_byok_provider" : "none",
        knownTotalMinor: inferenceMinor, currency, isNonBindingEstimate: options.inferenceMode === "byok", hasUnknownPrices: false,
        formattedSummary:
          options.inferenceMode === "deterministic"
            ? "$0.00 (Deterministic — no AI inference used)"
            : options.inferenceMode === "byok"
              ? `~${formatMinorCurrency(inferenceMinor, currency)} (External provider estimate; not billed by platform)`
              : `${formatMinorCurrency(inferenceMinor, currency)} (Hosted credit reservation cap)`,
        lineItems: [{
          id: "inference-operation",
          label: options.inferenceMode === "deterministic" ? "Deterministic execution" : options.inferenceMode === "byok" ? "BYOK external provider token estimate" : "Hosted credit budget reservation",
          formattedAmount: formatMinorCurrency(inferenceMinor, currency), isUnknownPrice: false,
        }],
      },
      learning_materials: {
        bucketId: "learning_materials", label: "3. Learning Materials", billingMechanism: "external_merchant",
        knownTotalMinor: materialsKnownMinor, currency, isNonBindingEstimate: true, hasUnknownPrices: materialsHasUnknown,
        formattedSummary: materialsHasUnknown
          ? `${formatMinorCurrency(materialsKnownMinor, currency)} known + unknown external resource prices (never assumed $0)`
          : formatMinorCurrency(materialsKnownMinor, currency),
        lineItems: materialLines,
      },
      certification_and_compute: {
        bucketId: "certification_and_compute", label: "4. Certification & Compute", billingMechanism: "external_merchant",
        knownTotalMinor: certMinor, currency, isNonBindingEstimate: true, hasUnknownPrices: false,
        formattedSummary: formatMinorCurrency(certMinor, currency),
        lineItems: [{ id: "cert-compute", label: "External certification & sandbox compute", formattedAmount: formatMinorCurrency(certMinor, currency), isUnknownPrice: false }],
      },
    },
    hasAnyUnknownPrice: materialsHasUnknown,
    byokEstimateDisclaimer:
      options.inferenceMode === "byok"
        ? "BYOK cost figures are non-binding estimates billed directly by your external AI provider. No hosted wallet credits are reserved or debited."
        : null,
  };
}

export function createHostedBillingController(initial: {
  readonly wallet: HostedCreditWalletSnapshot; readonly ledger?: readonly LedgerEntrySnapshot[];
  readonly usage?: readonly UsageItemSnapshot[]; readonly theme?: ThemeMode;
}) {
  const theme = initial.theme ?? "light";
  let wallet: HostedCreditWalletSnapshot = { ...initial.wallet };
  const quotes = new Map<string, GenerationQuoteSnapshot>();
  const reservations = new Map<string, BudgetReservationSnapshot>();
  const ledger: LedgerEntrySnapshot[] = [...(initial.ledger ?? [])];
  const usage: UsageItemSnapshot[] = [...(initial.usage ?? [])];

  const getActiveReservation = (reservationId: string): BudgetReservationSnapshot => {
    const existing = reservations.get(reservationId);
    if (!existing || existing.status !== "active") throw new Error(`Reservation '${reservationId}' is not active.`);
    return existing;
  };

  return {
    registerQuote(quote: GenerationQuoteSnapshot): GenerationQuoteSnapshot {
      if (quote.max_charge_minor < quote.estimated_cost_minor) {
        throw new Error("Quote max_charge_minor cannot be less than estimated_cost_minor.");
      }
      quotes.set(quote.quote_id, quote);
      return quote;
    },
    buildReserveInferenceBudgetRequest(options: {
      readonly quoteId: string; readonly reservationId: string; readonly idempotencyKey: string; readonly nowIso?: string;
    }) {
      const quote = quotes.get(options.quoteId);
      if (!quote) throw new Error(`Unknown generation quote '${options.quoteId}'.`);
      if (quote.mode !== "hosted") throw new Error("BYOK quotes do not reserve or debit hosted wallet credits.");
      if (Date.parse(quote.expires_at) <= Date.parse(options.nowIso ?? new Date().toISOString())) {
        throw new Error(`Generation quote '${quote.quote_id}' has expired.`);
      }
      if (quote.max_charge_minor > wallet.available_minor) {
        throw new Error(`Insufficient hosted credits: required ${quote.max_charge_minor} minor units, available ${wallet.available_minor} minor units.`);
      }

      const headers = buildOperationHeaders("reserveInferenceBudget", { idempotencyKey: options.idempotencyKey });
      const reservation: BudgetReservationSnapshot = {
        reservation_id: options.reservationId, quote_id: quote.quote_id,
        reserved_minor: quote.max_charge_minor, settled_minor: 0, released_minor: 0, status: "active", expires_at: quote.expires_at,
      };
      const occurredAt = options.nowIso ?? wallet.updated_at;
      reservations.set(reservation.reservation_id, reservation);
      wallet = {
        ...wallet,
        available_minor: wallet.available_minor - reservation.reserved_minor,
        reserved_minor: wallet.reserved_minor + reservation.reserved_minor,
        updated_at: occurredAt,
      };
      ledger.push({
        entry_id: `ledger-hold-${reservation.reservation_id}`, occurred_at: occurredAt, entry_type: "reservation_hold",
        delta_minor: -reservation.reserved_minor, balance_after_minor: wallet.available_minor, reference_id: reservation.reservation_id,
        summary: `Reserved up to ${formatMinorCurrency(reservation.reserved_minor, wallet.currency)} for quote ${quote.quote_id}`,
      });

      return {
        operationId: "reserveInferenceBudget" as const, method: "POST" as const, path: "/usage/reservations",
        headers, body: { quote_id: quote.quote_id, max_reserved_minor: quote.max_charge_minor }, reservation, wallet,
      };
    },
    settleReservation(options: {
      readonly reservationId: string; readonly actualSettledMinor: number;
      readonly operationKind?: UsageItemSnapshot["operation_kind"]; readonly occurredAt?: string;
    }) {
      const existing = getActiveReservation(options.reservationId);
      if (options.actualSettledMinor < 0 || options.actualSettledMinor > existing.reserved_minor) {
        throw new Error(`Settlement (${options.actualSettledMinor}) cannot exceed reserved budget (${existing.reserved_minor}).`);
      }
      const releasedMinor = existing.reserved_minor - options.actualSettledMinor;
      const updated: BudgetReservationSnapshot = {
        ...existing, settled_minor: options.actualSettledMinor, released_minor: releasedMinor, status: "settled",
      };
      reservations.set(updated.reservation_id, updated);
      const occurredAt = options.occurredAt ?? wallet.updated_at;
      wallet = {
        ...wallet,
        available_minor: wallet.available_minor + releasedMinor,
        reserved_minor: wallet.reserved_minor - existing.reserved_minor,
        updated_at: occurredAt,
      };
      ledger.push({
        entry_id: `ledger-settle-${updated.reservation_id}`, occurred_at: occurredAt, entry_type: "settlement_debit",
        delta_minor: -options.actualSettledMinor, balance_after_minor: wallet.available_minor, reference_id: updated.reservation_id,
        summary: `Settled ${formatMinorCurrency(options.actualSettledMinor, wallet.currency)}; released ${formatMinorCurrency(releasedMinor, wallet.currency)} unused hold`,
      });
      usage.push({
        usage_id: `usage-${updated.reservation_id}`, operation_kind: options.operationKind ?? "syllabus_generation",
        inference_mode: "hosted", quote_id: updated.quote_id, reservation_id: updated.reservation_id,
        reserved_minor: updated.reserved_minor, settled_minor: updated.settled_minor, released_minor: updated.released_minor, occurred_at: occurredAt,
      });
      return { reservation: updated, wallet };
    },
    releaseReservation(options: {
      readonly reservationId: string; readonly reason?: "cancelled" | "failed" | "expired"; readonly occurredAt?: string;
    }) {
      const existing = getActiveReservation(options.reservationId);
      const updated: BudgetReservationSnapshot = {
        ...existing, settled_minor: 0, released_minor: existing.reserved_minor, status: options.reason === "expired" ? "expired" : "released",
      };
      reservations.set(updated.reservation_id, updated);
      const occurredAt = options.occurredAt ?? wallet.updated_at;
      wallet = {
        ...wallet,
        available_minor: wallet.available_minor + existing.reserved_minor,
        reserved_minor: wallet.reserved_minor - existing.reserved_minor,
        updated_at: occurredAt,
      };
      ledger.push({
        entry_id: `ledger-release-${updated.reservation_id}`, occurred_at: occurredAt, entry_type: "reservation_release",
        delta_minor: existing.reserved_minor, balance_after_minor: wallet.available_minor, reference_id: updated.reservation_id,
        summary: `Released full hold of ${formatMinorCurrency(existing.reserved_minor, wallet.currency)} (${options.reason ?? "released"})`,
      });
      return { reservation: updated, wallet };
    },
    buildHostedGenerationRequest(options: {
      readonly request: HostedGenerationInnerRequest; readonly quoteId: string; readonly reservationId: string; readonly idempotencyKey: string;
    }) {
      if (options.request.inference.mode !== "hosted") throw new Error("Expected hosted inference mode.");
      if (!options.quoteId.trim() || !options.reservationId.trim()) {
        throw new Error("Hosted generation requires both quoteId and reservationId.");
      }
      const activeReservation = reservations.get(options.reservationId);
      if (activeReservation && (activeReservation.status !== "active" || activeReservation.quote_id !== options.quoteId)) {
        throw new Error("Hosted generation reservationId must be active and match quoteId.");
      }
      return {
        operationId: "startGeneration" as const, method: "POST" as const, path: "/generations",
        headers: buildOperationHeaders("startGeneration", { idempotencyKey: options.idempotencyKey }),
        body: { request: options.request, quote_id: options.quoteId, reservation_id: options.reservationId },
      };
    },
    buildCreateCheckoutSessionRequest(options: {
      readonly packId: string; readonly creditAmountMinor: number; readonly successUrl: string; readonly cancelUrl: string; readonly idempotencyKey: string;
    }) {
      if (!wallet.live_billing_enabled) {
        throw new Error("LIVE_BILLING_DISABLED: Live billing checkout is disabled by the D07 release gate for this environment.");
      }
      if (!options.packId.trim() || options.creditAmountMinor <= 0) {
        throw new Error("Checkout session requires a valid packId and positive integer creditAmountMinor.");
      }
      return {
        operationId: "createBillingCheckoutSession" as const, method: "POST" as const, path: "/me/billing/checkout-sessions",
        headers: buildOperationHeaders("createBillingCheckoutSession", { idempotencyKey: options.idempotencyKey }),
        body: {
          pack_id: options.packId, credit_amount_minor: options.creditAmountMinor, currency: wallet.currency,
          success_url: options.successUrl, cancel_url: options.cancelUrl,
        },
      };
    },
    getState() {
      const invariantViolations: string[] = [];
      for (const item of usage) {
        if (item.settled_minor > item.reserved_minor) {
          invariantViolations.push(`Usage '${item.usage_id}' settled (${item.settled_minor}) exceeds reserved (${item.reserved_minor}).`);
        }
        if (item.inference_mode === "hosted" && item.settled_minor + item.released_minor !== item.reserved_minor) {
          invariantViolations.push(`Usage '${item.usage_id}' settled + released does not equal reserved_minor.`);
        }
      }
      return {
        surface: resolveSurfaceStyle("pricing", { themePreference: theme }),
        wallet,
        formattedAvailableBalance: formatMinorCurrency(wallet.available_minor, wallet.currency),
        formattedReservedBalance: formatMinorCurrency(wallet.reserved_minor, wallet.currency),
        liveBillingReleaseGateStatus: wallet.live_billing_enabled ? ("enabled" as const) : ("disabled_by_d07_gate" as const),
        ledger: [...ledger], usage: [...usage], reservations: Array.from(reservations.values()), invariantViolations,
      };
    },
  };
}

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

export function resolveTransitiveAdoptionScope(
  syllabus: PublicSyllabusPayload,
  selectedModuleIds?: readonly string[],
) {
  const modules = syllabus.content.modules;
  const objectives = syllabus.content.objectives ?? [];
  const edges = syllabus.content.prerequisite_edges ?? [];

  const moduleById = new Map<string, PublicModuleNode>();
  const moduleByObjectiveId = new Map<string, string>();
  const prereqObjectivesByObjectiveId = new Map<string, string[]>();

  for (const obj of objectives) {
    prereqObjectivesByObjectiveId.set(obj.objective_id, [...(obj.prerequisite_objective_ids ?? [])]);
  }
  for (const edge of edges) {
    const existing = prereqObjectivesByObjectiveId.get(edge.to_objective_id) ?? [];
    if (!existing.includes(edge.from_objective_id)) {
      prereqObjectivesByObjectiveId.set(edge.to_objective_id, [...existing, edge.from_objective_id]);
    }
  }
  for (const mod of modules) {
    moduleById.set(mod.module_id, mod);
    for (const objId of mod.objective_ids ?? []) moduleByObjectiveId.set(objId, mod.module_id);
  }

  const initialIds = !selectedModuleIds || selectedModuleIds.length === 0 ? modules.map((m) => m.module_id) : [...selectedModuleIds];
  const requestedSet = new Set(initialIds);
  const resolvedModuleSet = new Set<string>();
  const directObjectiveSet = new Set<string>();
  const resolvedObjectiveSet = new Set<string>();

  function visitObjective(objectiveId: string) {
    if (resolvedObjectiveSet.has(objectiveId)) return;
    for (const prereqObjId of prereqObjectivesByObjectiveId.get(objectiveId) ?? []) {
      visitObjective(prereqObjId);
      const owningModId = moduleByObjectiveId.get(prereqObjId);
      if (owningModId) visitModule(owningModId);
    }
    resolvedObjectiveSet.add(objectiveId);
  }

  function visitModule(moduleId: string) {
    if (resolvedModuleSet.has(moduleId)) return;
    const mod = moduleById.get(moduleId);
    if (!mod) throw new Error(`Unknown module_id '${moduleId}' in publication.`);
    for (const prereqModId of mod.prerequisite_module_ids ?? []) visitModule(prereqModId);
    resolvedModuleSet.add(moduleId);
    for (const objId of mod.objective_ids ?? []) {
      if (requestedSet.has(moduleId)) directObjectiveSet.add(objId);
      visitObjective(objId);
    }
  }

  initialIds.forEach(visitModule);

  const resolvedModuleIds = modules.map((m) => m.module_id).filter((id) => resolvedModuleSet.has(id));
  const resolvedObjectiveIds = Array.from(resolvedObjectiveSet);

  return {
    requestedModuleIds: initialIds as readonly string[],
    resolvedModuleIds: resolvedModuleIds as readonly string[],
    autoIncludedPrerequisiteModuleIds: resolvedModuleIds.filter((id) => !requestedSet.has(id)) as readonly string[],
    resolvedObjectiveIds: resolvedObjectiveIds as readonly string[],
    autoIncludedPrerequisiteObjectiveIds: resolvedObjectiveIds.filter((id) => !directObjectiveSet.has(id)) as readonly string[],
  };
}
export type TransitivePrerequisiteResolution = ReturnType<typeof resolveTransitiveAdoptionScope>;

export function createPublicAdoptionController(syllabus: PublicSyllabusPayload) {
  function buildAdoptionRequest(options: {
    readonly idempotencyKey: string; readonly selectedModuleIds?: readonly string[];
    readonly basePlanningOrRequest: Record<string, unknown>;
    readonly execution:
      | { readonly mode: "deterministic" }
      | {
          readonly mode: "generate_hosted"; readonly model_policy_id: string;
          readonly inferenceBudget: { readonly currency: string; readonly max_minor_units: number };
          readonly quote_id: string; readonly reservation_id: string;
        }
      | {
          readonly mode: "generate_byok"; readonly provider_id: string; readonly credential_ref: string;
          readonly credential_version_ref: string; readonly model_policy_id: string; readonly allow_hosted_fallback: false;
          readonly inferenceBudget: { readonly currency: string; readonly max_minor_units: number };
        };
  }) {
    const scope = resolveTransitiveAdoptionScope(syllabus, options.selectedModuleIds);
    const headers = buildOperationHeaders("adoptSyllabus", { idempotencyKey: options.idempotencyKey });
    const templateOrigin = {
      publication_id: syllabus.publication_id, publication_revision_id: syllabus.publication_revision_id,
      expected_content_sha256: syllabus.content_sha256,
      ...(options.selectedModuleIds && options.selectedModuleIds.length > 0 ? { selected_module_ids: scope.resolvedModuleIds } : {}),
    };
    const path = `/publications/${syllabus.publication_id}/revisions/${syllabus.publication_revision_id}/adoptions`;
    const baseBudgets = (options.basePlanningOrRequest.budgets ?? {}) as Record<string, unknown>;
    const envelope = { operationId: "adoptSyllabus" as const, method: "POST" as const, path, headers, resolvedScope: scope };

    if (options.execution.mode === "deterministic") {
      return {
        ...envelope, requiresAiCredentials: false, requiresCreditReservation: false,
        body: {
          expected_content_sha256: syllabus.content_sha256, execution: "deterministic" as const,
          planning: {
            ...options.basePlanningOrRequest,
            budgets: { materials: baseBudgets.materials, compute: baseBudgets.compute },
            template_origin: templateOrigin,
          },
        },
      };
    }

    if (options.execution.mode === "generate_hosted") {
      if (!options.execution.quote_id.trim() || !options.execution.reservation_id.trim()) {
        throw new Error("Hosted generative adoption requires both quote_id and reservation_id.");
      }
      return {
        ...envelope, requiresAiCredentials: false, requiresCreditReservation: true,
        body: {
          expected_content_sha256: syllabus.content_sha256, execution: "generate" as const,
          request: {
            ...options.basePlanningOrRequest,
            budgets: { materials: baseBudgets.materials, compute: baseBudgets.compute, inference: options.execution.inferenceBudget },
            inference: { mode: "hosted" as const, model_policy_id: options.execution.model_policy_id },
            template_origin: templateOrigin,
          },
          quote_id: options.execution.quote_id, reservation_id: options.execution.reservation_id,
        },
      };
    }

    if (!options.execution.provider_id.trim() || !options.execution.credential_ref.trim() || !options.execution.credential_version_ref.trim()) {
      throw new Error("BYOK generative adoption requires provider_id, credential_ref, and credential_version_ref.");
    }

    return {
      ...envelope, requiresAiCredentials: true, requiresCreditReservation: false,
      body: {
        expected_content_sha256: syllabus.content_sha256, execution: "generate" as const,
        request: {
          ...options.basePlanningOrRequest,
          budgets: { materials: baseBudgets.materials, compute: baseBudgets.compute, inference: options.execution.inferenceBudget },
          inference: {
            mode: "byok" as const, provider_id: options.execution.provider_id, credential_ref: options.execution.credential_ref,
            model_policy_id: options.execution.model_policy_id, credential_version_ref: options.execution.credential_version_ref,
            allow_hosted_fallback: false as const,
          },
          template_origin: templateOrigin,
        },
      },
    };
  }

  return {
    resolveScope: (selectedModuleIds?: readonly string[]) => resolveTransitiveAdoptionScope(syllabus, selectedModuleIds),
    buildAdoptionRequest,
  };
}
