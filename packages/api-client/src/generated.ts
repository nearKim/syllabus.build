// GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md
// Canonical Specification SHA-256: b7ad9df9344dd0483a8775fa04be05470a631597c22244fe2f578bbba3627c44

export const CANONICAL_SPEC_SHA256 = "b7ad9df9344dd0483a8775fa04be05470a631597c22244fe2f578bbba3627c44" as const;

export type ContractSource = "core" | "companion";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface OperationSpec {
  readonly contract: ContractSource;
  readonly operationId: OperationId;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly requiresIdempotencyKey: boolean;
  readonly requiresIfMatch: boolean;
}

export type OperationId =
  | "applyAssessmentKeyCorrection"
  | "createAccountDeletionRequest"
  | "createAccountExportJob"
  | "createAuthSession"
  | "createBillingCheckoutSession"
  | "createGoalInterpretation"
  | "deleteCurrentAuthSession"
  | "deletePushSubscription"
  | "getCurrentAuthSession"
  | "getHostedCreditWallet"
  | "handleBillingWebhook"
  | "importExternalProviderCompletion"
  | "listApprovedResourceVersions"
  | "listCatalogProposals"
  | "listCurriculumResourceAlerts"
  | "listModerationReports"
  | "listMyCurricula"
  | "recordAssessmentAssistanceEvent"
  | "registerPushSubscription"
  | "reportDefectiveAssessmentItem"
  | "snoozeReminderOccurrence"
  | "acceptAdaptation"
  | "activateCurriculumRevision"
  | "adoptCurriculum"
  | "appendProgressEvent"
  | "cancelGeneration"
  | "createCredential"
  | "createGenerationQuote"
  | "discoverCurricula"
  | "getAdaptationProposal"
  | "getAssessment"
  | "getAssessmentAttempt"
  | "getCredentialMetadata"
  | "getCurriculumOverview"
  | "getCurriculumRevision"
  | "getDiagnostic"
  | "getGeneration"
  | "getLedger"
  | "getMyProficiency"
  | "getMyVote"
  | "getNotificationPreferences"
  | "getOwnedPublicationManagement"
  | "getProgress"
  | "getPublication"
  | "getPublishedRevision"
  | "getSchedule"
  | "getUsage"
  | "listCredentialMetadata"
  | "listOwnedPublicationRevisions"
  | "listOwnedPublications"
  | "moderatePublication"
  | "patchSchedule"
  | "previewAdaptation"
  | "previewPublication"
  | "publishCurriculum"
  | "publishRevision"
  | "regenerateCurriculum"
  | "removeMyUpvote"
  | "reportPublication"
  | "reserveInferenceBudget"
  | "reviewCatalogResource"
  | "revokeCredential"
  | "rotateCredential"
  | "setMyUpvote"
  | "startDiagnostic"
  | "startGeneration"
  | "stopDiagnostic"
  | "submitAssessmentAttempt"
  | "submitDiagnosticAttempt"
  | "unpublishCurriculum"
  | "updateNotificationPreferences";

export type CoreComponentSchemaName =
  | "ActivationRequest"
  | "AdaptationAcceptRequest"
  | "AdaptationPreviewRequest"
  | "AdaptationProposal"
  | "AdoptionRequest"
  | "AssessmentAnswer"
  | "AssessmentAttemptRequest"
  | "AssessmentAttemptResult"
  | "AssessmentDelivery"
  | "AssessmentQuestion"
  | "CatalogReviewRequest"
  | "CredentialCreate"
  | "CredentialMetadata"
  | "CredentialRotate"
  | "Curriculum"
  | "CurriculumOverview"
  | "DiagnosticAttemptRequest"
  | "DiagnosticSession"
  | "DiagnosticStartRequest"
  | "Error"
  | "GenerationJob"
  | "GenerationRequest"
  | "GenerationStartRequest"
  | "Identifier"
  | "LedgerEntry"
  | "LedgerPage"
  | "ModerationReceipt"
  | "ModerationRequest"
  | "Money"
  | "NotificationPreferences"
  | "NotificationPreferencesUpdate"
  | "OwnedPublicationPage"
  | "OwnedPublicationRevisionPage"
  | "OwnedPublicationRevisionSummary"
  | "OwnedPublicationSummary"
  | "Proficiency"
  | "ProgressEventReceipt"
  | "ProgressEventRequest"
  | "ProgressProjection"
  | "PublicCurriculum"
  | "PublicationConfirmRequest"
  | "PublicationManagement"
  | "PublicationPage"
  | "PublicationPreview"
  | "PublicationPreviewRequest"
  | "PublicationReportReceipt"
  | "PublicationReportRequest"
  | "PublicationView"
  | "RegenerationRequest"
  | "Reservation"
  | "ReservationRequest"
  | "Resource"
  | "ReviewScheduleItem"
  | "Schedule"
  | "SchedulePatch"
  | "UsagePage"
  | "UsageQuote"
  | "UsageRecord"
  | "VoteState";

export type CompanionComponentSchemaName =
  | "AccountDeletionRequest"
  | "AccountJobStatus"
  | "AssessmentAssistanceRequest"
  | "AssessmentAssistanceResponse"
  | "AssessmentIssueReportRequest"
  | "AssessmentKeyCorrectionRequest"
  | "AssessmentKeyCorrectionResponse"
  | "BillingWebhookPayload"
  | "CatalogProposalQueueResponse"
  | "CheckoutSessionResponse"
  | "CreateCheckoutSessionRequest"
  | "CreateSessionRequest"
  | "CurriculumListResponse"
  | "ExternalCompletionImportRequest"
  | "GoalInterpretationRequest"
  | "GoalInterpretationResponse"
  | "HostedWalletResponse"
  | "ModerationReportQueueResponse"
  | "PushSubscriptionRequest"
  | "PushSubscriptionResponse"
  | "ReminderSnoozeRequest"
  | "ResourceAlertListResponse"
  | "ResourceVersionListResponse"
  | "SessionResponse";

export const OPENAPI_OPERATIONS: Readonly<Record<OperationId, OperationSpec>> = {
  applyAssessmentKeyCorrection: {
    contract: "companion",
    operationId: "applyAssessmentKeyCorrection",
    method: "POST",
    path: "/admin/assessments/{assessment_id}/key-corrections",
    summary: "Append an attributable answer-key/rubric correction and recompute dependent proficiency and waivers (PED-005, ADAPT-008)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  createAccountDeletionRequest: {
    contract: "companion",
    operationId: "createAccountDeletionRequest",
    method: "POST",
    path: "/me/deletion-requests",
    summary: "Request account deletion, cancelling queued jobs/reminders and revoking credentials (OPS-004)",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  createAccountExportJob: {
    contract: "companion",
    operationId: "createAccountExportJob",
    method: "POST",
    path: "/me/exports",
    summary: "Request an export of private curricula, schedules, and learning evidence without secrets or restricted content (PROG-005, OPS-004)",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  createAuthSession: {
    contract: "companion",
    operationId: "createAuthSession",
    method: "POST",
    path: "/auth/sessions",
    summary: "Authenticate learner, curator, moderator, or operator session",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  createBillingCheckoutSession: {
    contract: "companion",
    operationId: "createBillingCheckoutSession",
    method: "POST",
    path: "/me/billing/checkout-sessions",
    summary: "Create a hosted-credit top-up checkout session (gated by D07/D11 in production) (BILL-003)",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  createGoalInterpretation: {
    contract: "companion",
    operationId: "createGoalInterpretation",
    method: "POST",
    path: "/curricula/goal-interpretations",
    summary: "Propose editable target capabilities, prerequisites, depth, and exclusions before generation (GOAL-001, GOAL-004)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  deleteCurrentAuthSession: {
    contract: "companion",
    operationId: "deleteCurrentAuthSession",
    method: "DELETE",
    path: "/auth/sessions/current",
    summary: "Sign out and revoke current session token",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  deletePushSubscription: {
    contract: "companion",
    operationId: "deletePushSubscription",
    method: "DELETE",
    path: "/me/push-subscriptions",
    summary: "Remove a Web Push subscription (NOT-001)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getCurrentAuthSession: {
    contract: "companion",
    operationId: "getCurrentAuthSession",
    method: "GET",
    path: "/auth/sessions/current",
    summary: "Inspect current authenticated session and role claims",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getHostedCreditWallet: {
    contract: "companion",
    operationId: "getHostedCreditWallet",
    method: "GET",
    path: "/me/billing/wallet",
    summary: "Read hosted AI credit balance, active reservations, and settlement policy summary (BILL-003, BILL-004)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  handleBillingWebhook: {
    contract: "companion",
    operationId: "handleBillingWebhook",
    method: "POST",
    path: "/webhooks/billing",
    summary: "Receive signed idempotent payment-provider webhook events (BILL-003)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  importExternalProviderCompletion: {
    contract: "companion",
    operationId: "importExternalProviderCompletion",
    method: "POST",
    path: "/me/integrations/completions",
    summary: "Import external provider completion with provenance without granting demonstrated competence (PROG-006)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listApprovedResourceVersions: {
    contract: "companion",
    operationId: "listApprovedResourceVersions",
    method: "GET",
    path: "/resources/versions",
    summary: "List or search approved catalog resource versions and credibility metadata (CAT-001, CAT-008)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listCatalogProposals: {
    contract: "companion",
    operationId: "listCatalogProposals",
    method: "GET",
    path: "/admin/catalog/proposals",
    summary: "List proposed, approved, quarantined, or stale catalog resources for curator review (CAT-002, CAT-006, OPS-001)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listCurriculumResourceAlerts: {
    contract: "companion",
    operationId: "listCurriculumResourceAlerts",
    method: "GET",
    path: "/curricula/{curriculum_id}/resource-alerts",
    summary: "List stale, quarantined, or revoked resource alerts and replacement paths for a curriculum (CAT-007)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listModerationReports: {
    contract: "companion",
    operationId: "listModerationReports",
    method: "GET",
    path: "/admin/moderation/reports",
    summary: "List private content/vote abuse reports for moderator resolution without exposing private learner evidence (SHARE-008, OPS-001)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listMyCurricula: {
    contract: "companion",
    operationId: "listMyCurricula",
    method: "GET",
    path: "/me/curricula",
    summary: "List private curricula owned by the authenticated learner",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  recordAssessmentAssistanceEvent: {
    contract: "companion",
    operationId: "recordAssessmentAssistanceEvent",
    method: "POST",
    path: "/assessments/{assessment_id}/assistance-events",
    summary: "Record staged hint request or explicit worked-solution study without a fake independent attempt (PED-002)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  registerPushSubscription: {
    contract: "companion",
    operationId: "registerPushSubscription",
    method: "POST",
    path: "/me/push-subscriptions",
    summary: "Register or update a Web Push subscription for opt-in study reminders (NOT-001, NOT-004)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  reportDefectiveAssessmentItem: {
    contract: "companion",
    operationId: "reportDefectiveAssessmentItem",
    method: "POST",
    path: "/assessments/{assessment_id}/reports",
    summary: "Report an ambiguous or defective assessment question or rubric (PED-005)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  snoozeReminderOccurrence: {
    contract: "companion",
    operationId: "snoozeReminderOccurrence",
    method: "POST",
    path: "/me/reminders/{occurrence_id}/snooze",
    summary: "Snooze or pause a scheduled reminder occurrence respecting quiet hours (NOT-001, NOT-002)",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  acceptAdaptation: {
    contract: "core",
    operationId: "acceptAdaptation",
    method: "POST",
    path: "/curricula/{curriculum_id}/adaptation-proposals/{proposal_id}/accept",
    summary: "Activate an accepted adaptation",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  activateCurriculumRevision: {
    contract: "core",
    operationId: "activateCurriculumRevision",
    method: "PUT",
    path: "/curricula/{curriculum_id}/active-revision",
    summary: "Activate an existing revision",
    requiresIdempotencyKey: false,
    requiresIfMatch: true,
  },
  adoptCurriculum: {
    contract: "core",
    operationId: "adoptCurriculum",
    method: "POST",
    path: "/publications/{publication_id}/revisions/{publication_revision_id}/adoptions",
    summary: "Create a private adapted draft",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  appendProgressEvent: {
    contract: "core",
    operationId: "appendProgressEvent",
    method: "POST",
    path: "/curricula/{curriculum_id}/progress-events",
    summary: "Append learner-authored progress evidence",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  cancelGeneration: {
    contract: "core",
    operationId: "cancelGeneration",
    method: "POST",
    path: "/generations/{generation_job_id}/cancel",
    summary: "Request cancellation",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  createCredential: {
    contract: "core",
    operationId: "createCredential",
    method: "POST",
    path: "/me/credentials",
    summary: "Store a write-only provider credential",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  createGenerationQuote: {
    contract: "core",
    operationId: "createGenerationQuote",
    method: "POST",
    path: "/generation-quotes",
    summary: "Estimate and bound inference cost",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  discoverCurricula: {
    contract: "core",
    operationId: "discoverCurricula",
    method: "GET",
    path: "/publications",
    summary: "Discover public curriculum versions",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getAdaptationProposal: {
    contract: "core",
    operationId: "getAdaptationProposal",
    method: "GET",
    path: "/curricula/{curriculum_id}/adaptation-proposals/{proposal_id}",
    summary: "Read a private adaptation proposal",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getAssessment: {
    contract: "core",
    operationId: "getAssessment",
    method: "GET",
    path: "/assessments/{assessment_id}",
    summary: "Read authorized formative assessment questions",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getAssessmentAttempt: {
    contract: "core",
    operationId: "getAssessmentAttempt",
    method: "GET",
    path: "/assessment-attempts/{attempt_id}",
    summary: "Read attempt scoring status and released feedback",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getCredentialMetadata: {
    contract: "core",
    operationId: "getCredentialMetadata",
    method: "GET",
    path: "/me/credentials/{credential_ref}",
    summary: "Read safe credential metadata and its concurrency token",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getCurriculumOverview: {
    contract: "core",
    operationId: "getCurriculumOverview",
    method: "GET",
    path: "/curricula/{curriculum_id}",
    summary: "Read current revision pointers",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getCurriculumRevision: {
    contract: "core",
    operationId: "getCurriculumRevision",
    method: "GET",
    path: "/curricula/{curriculum_id}/revisions/{revision_id}",
    summary: "Read an immutable curriculum revision",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getDiagnostic: {
    contract: "core",
    operationId: "getDiagnostic",
    method: "GET",
    path: "/diagnostic-sessions/{diagnostic_session_id}",
    summary: "Read diagnostic state and next assessment",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getGeneration: {
    contract: "core",
    operationId: "getGeneration",
    method: "GET",
    path: "/generations/{generation_job_id}",
    summary: "Read generation state",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getLedger: {
    contract: "core",
    operationId: "getLedger",
    method: "GET",
    path: "/me/ledger",
    summary: "Read the hosted inference ledger",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getMyProficiency: {
    contract: "core",
    operationId: "getMyProficiency",
    method: "GET",
    path: "/me/proficiency",
    summary: "Read private objective-level evidence",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getMyVote: {
    contract: "core",
    operationId: "getMyVote",
    method: "GET",
    path: "/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
    summary: "Read the authenticated user vote state",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getNotificationPreferences: {
    contract: "core",
    operationId: "getNotificationPreferences",
    method: "GET",
    path: "/me/notification-preferences",
    summary: "Read notification preferences",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getOwnedPublicationManagement: {
    contract: "core",
    operationId: "getOwnedPublicationManagement",
    method: "GET",
    path: "/me/publications/{publication_id}",
    summary: "Read owner publication state even when public access is blocked",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getProgress: {
    contract: "core",
    operationId: "getProgress",
    method: "GET",
    path: "/curricula/{curriculum_id}/progress",
    summary: "Read derived completion and evidence state",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getPublication: {
    contract: "core",
    operationId: "getPublication",
    method: "GET",
    path: "/publications/{publication_id}",
    summary: "Read the current accessible public snapshot",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getPublishedRevision: {
    contract: "core",
    operationId: "getPublishedRevision",
    method: "GET",
    path: "/publications/{publication_id}/revisions/{publication_revision_id}",
    summary: "Read an accessible historical public revision",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getSchedule: {
    contract: "core",
    operationId: "getSchedule",
    method: "GET",
    path: "/curricula/{curriculum_id}/schedule",
    summary: "Read the current schedule revision",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  getUsage: {
    contract: "core",
    operationId: "getUsage",
    method: "GET",
    path: "/me/usage",
    summary: "Read account-scoped inference usage",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listCredentialMetadata: {
    contract: "core",
    operationId: "listCredentialMetadata",
    method: "GET",
    path: "/me/credentials",
    summary: "List credential metadata only",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listOwnedPublicationRevisions: {
    contract: "core",
    operationId: "listOwnedPublicationRevisions",
    method: "GET",
    path: "/me/publications/{publication_id}/revisions",
    summary: "List revision metadata for an owned publication even while its public content is unavailable",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  listOwnedPublications: {
    contract: "core",
    operationId: "listOwnedPublications",
    method: "GET",
    path: "/me/publications",
    summary: "List the authenticated owner's publications across active, quarantined and withdrawn lifecycle states",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  moderatePublication: {
    contract: "core",
    operationId: "moderatePublication",
    method: "POST",
    path: "/admin/publications/{publication_id}/moderation",
    summary: "Apply an attributable publication moderation action",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  patchSchedule: {
    contract: "core",
    operationId: "patchSchedule",
    method: "PATCH",
    path: "/curricula/{curriculum_id}/schedule",
    summary: "Request schedule changes with optimistic concurrency",
    requiresIdempotencyKey: false,
    requiresIfMatch: true,
  },
  previewAdaptation: {
    contract: "core",
    operationId: "previewAdaptation",
    method: "POST",
    path: "/curricula/{curriculum_id}/adaptation-proposals",
    summary: "Preview evidence-based curriculum changes",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  previewPublication: {
    contract: "core",
    operationId: "previewPublication",
    method: "POST",
    path: "/publication-previews",
    summary: "Build the exact sanitized public preview",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  publishCurriculum: {
    contract: "core",
    operationId: "publishCurriculum",
    method: "POST",
    path: "/publications",
    summary: "Publish a new curriculum template",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  publishRevision: {
    contract: "core",
    operationId: "publishRevision",
    method: "POST",
    path: "/me/publications/{publication_id}/revisions",
    summary: "Publish an explicitly confirmed edited version",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  regenerateCurriculum: {
    contract: "core",
    operationId: "regenerateCurriculum",
    method: "POST",
    path: "/curricula/{curriculum_id}/regenerations",
    summary: "Generate a successor curriculum revision",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  removeMyUpvote: {
    contract: "core",
    operationId: "removeMyUpvote",
    method: "DELETE",
    path: "/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
    summary: "Remove the current account upvote",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  reportPublication: {
    contract: "core",
    operationId: "reportPublication",
    method: "POST",
    path: "/publications/{publication_id}/reports",
    summary: "Report a public revision",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  reserveInferenceBudget: {
    contract: "core",
    operationId: "reserveInferenceBudget",
    method: "POST",
    path: "/usage/reservations",
    summary: "Reserve hosted inference authorization",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  reviewCatalogResource: {
    contract: "core",
    operationId: "reviewCatalogResource",
    method: "POST",
    path: "/admin/resources/{resource_id}/reviews",
    summary: "Record an authorized catalog review",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  revokeCredential: {
    contract: "core",
    operationId: "revokeCredential",
    method: "DELETE",
    path: "/me/credentials/{credential_ref}",
    summary: "Revoke and delete a stored credential",
    requiresIdempotencyKey: false,
    requiresIfMatch: true,
  },
  rotateCredential: {
    contract: "core",
    operationId: "rotateCredential",
    method: "PATCH",
    path: "/me/credentials/{credential_ref}",
    summary: "Replace a provider key with a new pinned version",
    requiresIdempotencyKey: false,
    requiresIfMatch: true,
  },
  setMyUpvote: {
    contract: "core",
    operationId: "setMyUpvote",
    method: "PUT",
    path: "/publications/{publication_id}/revisions/{publication_revision_id}/my-vote",
    summary: "Set one upvote on this version",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  startDiagnostic: {
    contract: "core",
    operationId: "startDiagnostic",
    method: "POST",
    path: "/diagnostic-sessions",
    summary: "Start a bounded reviewed diagnostic",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  startGeneration: {
    contract: "core",
    operationId: "startGeneration",
    method: "POST",
    path: "/generations",
    summary: "Start asynchronous curriculum generation",
    requiresIdempotencyKey: true,
    requiresIfMatch: false,
  },
  stopDiagnostic: {
    contract: "core",
    operationId: "stopDiagnostic",
    method: "POST",
    path: "/diagnostic-sessions/{diagnostic_session_id}/stop",
    summary: "Stop without inventing unassessed ability",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  submitAssessmentAttempt: {
    contract: "core",
    operationId: "submitAssessmentAttempt",
    method: "POST",
    path: "/assessments/{assessment_id}/attempts",
    summary: "Record and score a formative attempt",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  submitDiagnosticAttempt: {
    contract: "core",
    operationId: "submitDiagnosticAttempt",
    method: "POST",
    path: "/diagnostic-sessions/{diagnostic_session_id}/attempts",
    summary: "Submit a diagnostic response",
    requiresIdempotencyKey: false,
    requiresIfMatch: false,
  },
  unpublishCurriculum: {
    contract: "core",
    operationId: "unpublishCurriculum",
    method: "DELETE",
    path: "/me/publications/{publication_id}",
    summary: "Withdraw every revision from app-controlled public access",
    requiresIdempotencyKey: false,
    requiresIfMatch: true,
  },
  updateNotificationPreferences: {
    contract: "core",
    operationId: "updateNotificationPreferences",
    method: "PUT",
    path: "/me/notification-preferences",
    summary: "Update notification preferences",
    requiresIdempotencyKey: false,
    requiresIfMatch: true,
  },
} as const;
