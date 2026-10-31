# GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md
Feature: Credible, feasible, evidence-informed syllabi across web and mobile
  These are acceptance specifications. Step bindings and application assertions
  must be implemented before any scenario is described as an executed test.
  Synthetic sources are fixtures, never production catalog approvals.

  @S01 @GOAL-001 @GOAL-002 @GOAL-003
  Scenario: Turn a broad request into a reviewable scope
    Given a learner requests "everything about LLMs"
    And the learner has not completed a diagnostic
    When the app prepares the goal interpretation
    Then it shows editable target capabilities, prerequisites, depth, and exclusions
    And it records available time, timezone, language, sequencing, access, and separate budgets
    And it marks prior knowledge as uncertain instead of assuming expertise

  @S02 @GOAL-004 @PROG-003
  Scenario: A fixed deadline cannot fit the required work
    Given required activities and reviews exceed the learner's declared capacity
    And the deadline is fixed
    When the app constructs the schedule
    Then it reports infeasibility with the estimated excess
    And it offers reduced scope, extended time, or increased availability
    And it does not silently remove required practice or overbook future sessions

  @S03 @GOAL-005 @GEN-008 @NFR-007
  Scenario: Regeneration preserves meaningful history
    Given a learner has an accepted revision and recorded independent attempts
    When a new revision changes selected resources and objectives
    Then the app shows a diff before activation
    And permitted old structure and learning evidence remain inspectable
    And unchanged evidence transfers only through an explicit equivalence mapping
    And any required content redaction is recorded without inventing new learning results

  @S04 @CAT-001 @CAT-002 @CAT-008
  Scenario: Prestige or ratings alone cannot approve a resource
    Given a proposed resource has a famous platform name and a high rating
    But creator identity or sampled technical accuracy is unverified
    When a curator attempts to approve it
    Then the app requires the missing review evidence
    And only an approved record can explain its objective fit, access, and review provenance

  @S05 @CAT-003
  Scenario: A recommendable book lacks permission for full-text RAG
    Given a book is approved for link-only recommendation
    And its permission record does not allow full-text storage or model transmission
    When an ingestion job attempts to embed the book text
    Then that operation is rejected with an auditable reason
    And the independently permitted link-only recommendation remains available

  @S06 @CAT-004 @CAT-005 @BILL-004
  Scenario: Strict free-only filtering respects actual access conditions
    Given a learner requires free learning materials and has no paid subscriptions
    And candidate resources include free, purchase-required, trial-only, and unknown-price entries
    When retrieval and final validation select mandatory resources
    Then only verified free access meeting the required content needs is accepted
    And paid exams and required paid labs are disclosed separately or excluded
    And unknown cost is never treated as zero
    And AI and compute budgets remain distinct from learning-material cost

  @S07 @CAT-006 @CAT-007 @OPS-001 @OPS-002
  Scenario: A quarantined resource stays excluded after index rollback
    Given a published resource version is now quarantined or its reuse permission revoked
    When an older search index is restored
    Then current eligibility and permission checks still exclude prohibited use
    And affected learners see the assignment issue and an eligible replacement proposal
    And permitted completion evidence is preserved
    And a failed refresh does not update the last-verified timestamp

  @S08 @GEN-001
  Scenario: Generation submission is asynchronous and idempotent
    Given a valid generation request and a unique idempotency key
    When the client retries the same submission
    Then both responses identify the same logical generation job
    And status and cancellation remain available
    And reuse of the key with a different body produces a conflict

  @S09 @GEN-002 @NFR-007
  Scenario: A saved plan has investigation provenance
    Given a valid generated candidate
    When the backend commits a draft revision
    Then it stamps the request, catalog, provider/model, retrieval, prompt, and pedagogy versions
    And server-owned provenance is not copied from a model claim
    And changing the schedule alone does not change the meaning of the syllabus revision

  @S10 @GEN-003
  Scenario: The model invents a resource
    Given the request uses a known approved catalog snapshot
    And the candidate names a resource version outside that snapshot
    When the backend validates the candidate
    Then no plan containing the invented reference is published
    And bounded repair or an actionable coverage failure is returned
    And the frontend never receives an invented canonical source URL as approved fact

  @S11 @GEN-004 @GEN-007 @NFR-002
  Scenario: Structurally invalid or executable output is rejected
    Given a candidate includes an unknown activity type, script field, raw secret, or oversized graph
    When backend validation runs
    Then the invalid candidate is not published
    And the renderer accepts only supported typed components and safe text
    And unknown required schema versions produce a compatibility state

  @S12 @GEN-004
  Scenario: Cyclic prerequisites cannot become a published syllabus
    Given objective A requires B and objective B requires A
    When semantic validation traverses the prerequisite graph
    Then the candidate fails with the conflicting dependencies identified
    And repeated scheduled reviews are not misclassified as prerequisite edges

  @S13 @GEN-005 @GEN-006 @PED-001
  Scenario: An objective has no credible instruction or assessment path
    Given the approved catalog cannot cover a required objective
    When generation proposes a plan
    Then the app explicitly identifies the gap or refuses a complete plan
    And it does not invent a course, chapter, outcome, or assessment
    And the uncovered objective cannot be counted as demonstrated
    And any demonstration gate depending on that gap remains visibly unsatisfied

  @S14 @PED-002 @PED-005
  Scenario: Practice requires an attempt and gives attributable feedback
    Given a valid practice item with a private reviewed answer or rubric
    When the learner opens it
    Then the unrevealed solution is absent from the learner payload
    When the learner attempts it and requests a hint
    Then help use is recorded
    And feedback explains the error and a useful next action

  @S15 @PED-005 @PED-006
  Scenario: An unreviewed AI assessment or formative practice cannot silently become a trusted gate
    Given an AI-generated assessment has no validated answer or rubric
    When the app considers its use for a mastery_gated activity or progress gate
    Then it remains a draft or labeled formative practice item
    And formative practice or an advisory AI grade does not alone establish demonstrated competence
    And when no reviewed anchor exists for a mastery_gated prerequisite the app requires explicit acknowledgement and displays "Prerequisite unverified — no reviewed anchor available"
    And the acknowledgement is recorded as an auditable learner decision
    And the item's objective, version, provenance, and validation state remain available

  @S45 @PED-002 @PED-006
  Scenario: Explicit solution study is permitted without a fake attempt
    Given a learner wants to study a worked solution
    When the learner explicitly selects solution study instead of independent practice
    Then the solution may be revealed
    And the activity records solution assistance rather than a successful independent attempt

  @S46 @PED-005 @PED-006
  Scenario: A defective answer key can invalidate an earlier learning inference
    Given an assessment supported a demonstrated objective
    And a review finds the answer key or grading rubric incorrect
    When the correction is applied
    Then the original attempt and evaluation remain historically inspectable
    And a reasoned correction or invalidation is appended
    And affected evidence and prerequisite eligibility are recomputed and explained

  @S16 @PED-006 @PROG-001
  Scenario: Completing a resource does not prove learning
    Given a learner checks a video activity complete
    When the progress projection updates
    Then activity completion increases with self-report provenance
    And independent, delayed, and transfer performance remain unchanged
    And the same state is visible from the learner's other authenticated device

  @S17 @PED-003 @PROG-002
  Scenario: Reviews consume real study capacity
    Given a syllabus contains due review activities
    When the scheduler assigns the next week's study sessions
    Then reviews occupy declared available time in distinct sessions
    And their interval policy and version are recorded as a configurable heuristic
    And the workload does not hide review time inside a media-speed adjustment

  @S18 @PED-004 @GOAL-003
  Scenario: Guidance responds to prerequisite evidence
    Given a learner has weak or absent evidence for a prerequisite
    When a dependent activity is proposed
    Then relevant instruction or a scaffold is available
    And a skipped diagnostic does not imply prerequisite competence
    And independent evidence can support skipping redundant introductory work

  @S19 @PED-007 @GOAL-005
  Scenario: Switching sequence preference retains educational obligations
    Given a valid theory-first syllabus
    When the learner requests application-first or balanced ordering
    Then required objectives and genuine prerequisites remain intact
    And meaningful practice, feedback, consolidation, and review remain present
    And the app previews changed ordering and dates without diagnosing a learning style

  @S20 @PROG-002
  Scenario: Playback speed changes only media time
    Given a session contains 60 minutes of media, 40 of reading, 80 of coding, and 20 of assessment
    When playback speed changes from 1 to 2
    Then the estimated total changes from 200 to 170 minutes
    And reading, coding, setup, and assessment are not divided by playback speed

  @S21 @PROG-001 @PROG-004
  Scenario: Offline progress retries do not duplicate completion
    Given one device records a completion event while offline
    When reconnection sends that event more than once
    Then the server retains one logical event for that event ID
    And both devices eventually show one completed activity
    And pending synchronization is visible until acknowledgement

  @S22 @PROG-004
  Scenario: A stale schedule edit produces a recoverable conflict
    Given two devices observed the same schedule revision
    And one device has committed a new revision
    When the other submits an edit against the old revision
    Then the server returns a conflict and the current revision
    And no newer schedule is silently overwritten

  @S23 @PROG-005 @OPS-004
  Scenario: The learner controls progress and exports
    Given an authenticated learner owns a syllabus and attempts
    When the learner marks an activity skipped, reports study time, and requests export
    Then those actions retain their intended evidence meaning
    And the export includes the plan and permitted learning history
    And it excludes credentials, other learners' records, and restricted source material

  @S24 @PROG-006
  Scenario: Provider completion import retains its limited meaning
    Given an authorized supported integration returns external course completion
    When the app imports it
    Then the provider and import time are recorded
    And the imported completion does not become independent assessment evidence

  @S25 @UI-001 @UI-002 @NFR-003
  Scenario: Diagram navigation has an accessible equivalent
    Given a syllabus has prerequisites, optional branches, and a due review
    When a learner uses keyboard navigation, a screen reader, or a narrow mobile viewport
    Then essential facts and actions are available in a usable outline or focused path
    And prerequisite edges and states have text meanings rather than color alone
    And focus, contrast, motion, and touch interactions meet the stated accessibility checks

  @S26 @UI-003 @UI-004 @UI-005
  Scenario: The learner can identify and begin the next useful activity
    Given an active plan and a feasible upcoming session
    When the learner opens Today and then activity details
    Then the app shows its time, prerequisites, objective, required access, and next action
    And only verified chapter or section details are presented as precise assignments
    And optional enrichment and certification are clearly distinct from required work

  @S27 @UI-006
  Scenario Outline: An unavailable operation has a useful next action
    Given the app enters the <state> state
    When the relevant screen is displayed
    Then its message is accessible and explains a useful recovery or alternative
    And no invalid syllabus or invented progress is displayed as a success
    Examples:
      | state |
      | generation failed |
      | no eligible resources |
      | insufficient credit |
      | notification permission denied |
      | offline with pending progress |
      | stale source |

  @S28 @BILL-001 @BILL-005
  Scenario: BYOK failure never causes an undisclosed hosted charge
    Given the learner selected BYOK
    And the provider rejects the credential or quota
    When generation fails
    Then the app reports the selected mode and an actionable provider failure
    And no paid hosted request or app credit charge is created as an automatic fallback
    And any repair remains within the original authorized mode and limits

  @S29 @BILL-002 @NFR-001
  Scenario: Credentials cannot leak through normal application data
    Given a learner saved a test provider key under disclosed server custody
    When account data, job status, prompts, logs, analytics, and exports are inspected
    Then the raw key is absent outside the authorized secret resolution path
    And another tenant cannot read, resolve, or use the key
    And the normal account view exposes only safe connection metadata

  @S30 @BILL-003
  Scenario: Concurrent usage and retried settlement respect the budget
    Given a learner has a finite hosted credit balance
    When concurrent generation jobs reserve usage and a settlement is retried
    Then the total authorized reservations never exceed the usable balance
    And each usage operation has one effective settlement
    And unused reservations are released under the documented policy
    And an ambiguous provider timeout is reconciled before blind paid retry

  @S31 @BILL-006 @NFR-002
  Scenario: User input cannot redirect provider traffic to internal services
    Given a learner or retrieved page supplies an arbitrary provider base URL
    When a hosted generation or ingestion operation is constructed
    Then unsupported endpoints are rejected
    And approved egress checks reject unsafe redirects and internal-address resolution
    And retrieved instructions cannot request credentials or authorize tools or spending

  @S32 @NOT-001
  Scenario: Notifications remain optional
    Given a learner denies push permission
    When the learner studies or changes reminder settings
    Then syllabus, practice, and progress remain usable
    And no notification channel is enabled without opt-in
    And quiet hours, pause, and snooze choices are respected

  @S33 @NOT-002 @NOT-003
  Scenario: Completed or rescheduled work does not generate stale reminders
    Given a reminder is queued for a session revision
    And the learner completes or reschedules that session
    When the worker retries dispatch
    Then it rechecks the current revision and suppresses the obsolete occurrence
    And duplicate attempts do not create duplicate application dispatch records
    And provider acceptance is not described as confirmed viewing by the learner

  @S34 @NOT-003 @NOT-004
  Scenario: Daylight-saving and reconnect behavior is deterministic
    Given a study time falls in a missing or repeated local time
    When the scheduler resolves that occurrence and a device later reconnects
    Then the documented timezone policy yields one intended reminder occurrence
    And expired reminder backlogs are suppressed
    And the UI describes delivery as best effort

  @S35 @NOT-004 @NOT-005
  Scenario: Mobile alarm promises match implemented capabilities
    Given a learner uses the PWA on a supported mobile device
    When configuring study reminders
    Then installation and permission prerequisites are explained where applicable
    And no precise audible alarm guarantee is presented
    And a future native alarm feature is enabled only for its tested OS and permission matrix

  @S36 @OPS-001 @NFR-001
  Scenario: Curator privileges do not grant learner credential access
    Given a curator may approve catalog records but is not another learner
    When the curator or a forged account ID requests that learner's progress, export, or credential
    Then the server rejects the unauthorized object access
    And privileged catalog changes retain actor, reason, and safe diff history

  @S37 @OPS-003
  Scenario: Operators can investigate quality and reliability failures safely
    Given generation, validation, refresh, reminder, and sync operations have outcomes
    When operational dashboards and traces are inspected
    Then they expose rates, causes, timing, coverage, and usage suitable for diagnosis
    And they omit raw credentials and unnecessary learner answers or private text

  @S38 @OPS-004 @BILL-002
  Scenario: Account and credential deletion stop new authorized work
    Given an account has stored credentials, devices, and queued jobs
    When its deletion request or credential-removal transaction commits
    Then new applicable job authorization and secret resolution are disabled
    And affected queued reminders and jobs are canceled or invalidated
    And the user is told about in-flight requests, issuer revocation, and retained backup/financial policy

  @S39 @OPS-005
  Scenario: Certification recommendations do not invent issuer facts
    Given the learner requests certification preparation
    When the app proposes a credential
    Then it identifies the credential type and verified official issuer source
    And uncertain exam version, dates, fees, and career signaling remain explicitly uncertain
    And a course-completion certificate is not labeled an accredited qualification or verified skill guarantee

  @S40 @OPS-006
  Scenario: Open-source distribution preserves Apache-2.0 software terms and separate LEGAL.md boundaries
    Given a release is prepared for public distribution
    When its code, seed catalog, fixtures, and documentation are reviewed
    Then public release includes the adopted Apache-2.0 software license in LICENSE and the 4-part legal boundary in LEGAL.md
    And software source code and inbound contributions follow Apache-2.0 including Section 5 contributor licensing
    And BYOK inference requests execute strictly under the learner's direct AI provider terms without hosted fallback
    And published community syllabus structures and original annotations are licensed under CC BY 4.0 without private learner state
    And dependency, catalog, public-syllabus, and third-party content terms retain their separate scope
    And third-party educational resources are referenced via bibliographic metadata and canonical links only without redistributing copyrighted full text
    And self-host setup, migrations, secrets, backups, and extension boundaries are documented

  @S41 @NFR-004
  Scenario: Ordinary API responsiveness is measured separately from inference
    Given the documented representative dataset and acceptance load
    When ordinary reads and generation submission are measured
    Then p95 reads and acknowledgement satisfy the adopted service targets
    And external model duration and outages are reported separately
    And configured generation timeout and progress states are observable

  @S42 @NFR-005
  Scenario: Release checks include hard constraints and educational quality
    Given seeded normal, adversarial, and infeasible syllabus fixtures
    When the release gate runs
    Then all required hard-constraint, security, and billing assertions pass
    And independent review checks factual accuracy and objective/practice/assessment alignment
    And schema success alone is not reported as educational validity

  @S43 @NFR-006
  Scenario: Backup restoration preserves state without restoring revoked access
    Given a backup and later credential revocations and source withdrawals
    When the service performs a recovery exercise
    Then references, progress, and ledger consistency are verified
    And revocation and deletion state is reapplied before service resumes
    And observed recovery time and data loss are compared with the adopted objectives

  @S44 @NFR-008
  Scenario: Learning evaluation is separate from engagement analytics
    Given a pilot or controlled evaluation is configured
    When outcomes are reported
    Then independent delayed performance and transfer are distinguished from clicks and completion
    And assistance, attrition, timing, versions, and uncertainty are reported
    And optional research participation is not inferred from ordinary product use

  @S47 @ADAPT-001 @ADAPT-007 @ADAPT-010 @PED-007
  Scenario: Strong linear algebra evidence and formal mathematics remain compatible
    Given reviewed evidence demonstrates matrix dimensions and projections for their stated objectives
    And matrix calculus, probability, and optimization have not been assessed
    And the learner selects formal mathematical depth, an intuitive override for serving, and application_first sequencing
    And a legacy global profile label says beginner
    When the app proposes an LLM syllabus
    Then proposed condensation is limited to demonstrated introductory work with an available recap
    And attention retains formal derivations, mathematical reasoning, assumptions, and aligned exercises
    And serving resolves to the explicit intuitive override without changing other topics' depth
    And application_first changes the order without removing mathematical outcomes
    And the global label does not override objective-specific evidence
    And unassessed prerequisites remain unknown and the linear algebra rollup shows its limited coverage

  @S48 @ADAPT-002 @ADAPT-003 @ADAPT-004
  Scenario Outline: An optional diagnostic can end with incomplete evidence
    Given a learner self-reports strong linear algebra knowledge
    And the optional diagnostic targets several distinct prerequisite objectives
    When the learner <ending>
    Then any recorded attempts retain their item versions, assistance, and evaluation provenance
    And independent proficiency for unassessed objectives remains unknown rather than failed or demonstrated
    And the self-report remains distinguishable from independent evidence
    And the result explains assessed coverage, the stopping reason, and unresolved coverage
    And the learner can continue planning with disclosed uncertainty and available prerequisite support
    Examples:
      | ending |
      | declines the diagnostic before starting |
      | stops after answering only the matrix-dimensions item |
      | reaches the visible session effort target with other objectives unanswered |

  @S49 @ADAPT-003 @ADAPT-005 @ADAPT-009 @PED-005
  Scenario: Diagnostic branching preserves item eligibility and assistance conditions
    Given a bank contains reviewed anchors, a previously exposed anchor, and an unreviewed AI variant
    And the intended prerequisite criterion requires independent performance
    When the diagnostic selects items and evaluates responses
    Then each gate-eligible item matches the objective, reviewed version, and required conditions
    And selection reasons, policy version, allowed tools, actual assistance, and prior exposure are recorded
    And viewing a worked solution creates an assisted study record rather than an independent pass
    And an unreviewed AI variant cannot independently grant a prerequisite waiver
    And the visible assessment budget and stopping rules are inspectable product policies
    And no fixed item count or policy threshold is presented as universally scientifically sufficient

  @S50 @ADAPT-004 @ADAPT-008 @ADAPT-009 @NFR-008
  Scenario: Proficiency projections expose evidence without invented measurement precision
    Given a projection combines attributable attempts under a reviewed decision policy
    When a new independently assessed attempt targets one objective
    Then only inferences supported by that attempt and the policy are recomputed
    And unrelated objective evidence and prior observations remain unchanged
    When a learner opens the topic evidence view
    Then each inference identifies the objective and version, evidence references, conditions, recency, and policy version
    And categorical support is distinguished from an observed item score
    And missing or mixed evidence remains visible
    And an uncalibrated mastery percentage, percentile, or probability is not displayed as measured ability
    And expert review alone is not labeled psychometric validation or certification
    And stronger measurement claims require evaluation for the intended population and use

  @S51 @ADAPT-005 @ADAPT-010 @PED-006
  Scenario Outline: A learner can study ahead without manufacturing a prerequisite waiver
    Given the only support for a prerequisite is <nonqualifying_support>
    And no sufficient valid independent evidence satisfies its reviewed criterion
    When the learner studies ahead on an ordinary activity or requests an override on a mastery_gated activity
    Then ordinary content is not hard-locked and displays a visible missing-prerequisite warning with recommended bridging work
    And if the activity is mastery_gated with an active reviewed anchor the learner must either demonstrate the prerequisite or record an explicit auditable override
    And it does not create a verified waiver or mark the skipped activity completed
    And accessing or completing the dependent activity does not create prerequisite evidence
    And the prerequisite objective remains in the graph with its demonstration gate unsatisfied
    And neither the dependent objective nor the broader syllabus becomes demonstrated
    Examples:
      | nonqualifying_support |
      | a high self-rating |
      | completion of an external course |
      | elapsed study time |
      | upvotes on a published syllabus |
      | an assisted answer or advisory AI grade |
      | an assessment gap with no valid assessment path |

  @S52 @ADAPT-005 @ADAPT-010 @GEN-008
  Scenario: Valid evidence waives only the equivalent capability under compatible conditions
    Given valid reviewed evidence satisfies a matrix-calculation prerequisite under the required conditions
    And a new objective version has an explicit reviewed equivalence mapping for that same capability
    And a new proof objective has neither qualifying evidence nor an equivalence mapping
    When the backend evaluates an adaptation proposal
    Then the proposal identifies the mapped prerequisite as waiver-eligible using the referenced evidence and policy version
    And its redundant instruction may be waived without being falsely recorded as completed
    And its objective and prerequisite edges remain inspectable
    And the proof objective and unrelated mathematics objectives remain unassessed
    And a similar title, embedding match, or incompatible assessment condition cannot transfer credit

  @S53 @ADAPT-001 @ADAPT-006 @ADAPT-007 @PROG-003
  Scenario: A mathematical-depth change produces a learner-controlled revision
    Given an active applied-depth syllabus with valid evidence and limited weekly availability
    When the learner requests formal depth and a full prerequisite recap
    Then the proposal shows changed objectives, retained evidence, resources, workload, access, and budget impact
    And the existing proficiency evidence and sequencing choice remain unchanged
    And required bridging work is included or the resulting time conflict is explicitly disclosed
    And a time conflict does not silently reduce formal depth or remove required mathematical outcomes
    And the requested recap remains available despite prior evidence that could support a shortcut
    When the learner rejects the proposed revision or leaves the preview
    Then the prior syllabus and schedule remain active
    When the learner accepts a feasible current proposal
    Then a new syllabus revision commits with eligible evidence preserved and any necessary schedule revision
    And reminder changes follow the committed schedule rather than an unaccepted preview

  @S54 @ADAPT-006 @ADAPT-008 @GEN-008
  Scenario Outline: A stale adaptation preview cannot overwrite newer facts
    Given a learner has an unaccepted adaptation preview bound to its source revisions and evidence
    And <change> occurs before acceptance
    When the learner accepts the old preview
    Then the server rejects the stale proposal with an actionable conflict
    And the prior active syllabus remains active without partial revision or schedule changes
    And a refreshed proposal recomputes affected waivers, eligibility, and time or cost effects
    Examples:
      | change |
      | another device commits a different syllabus revision |
      | supporting assessment evidence is invalidated |
      | a selected resource loses required display or reuse permission |

  @S55 @ADAPT-008 @PED-005 @PED-006 @PROG-001
  Scenario: Due review and invalidated assessment evidence have different effects
    Given valid evidence supports a demonstrated objective and an accepted prerequisite waiver
    And a pending adaptation also depends on that evidence
    When its next review becomes due
    Then the review state becomes due without erasing the dated demonstration or automatically invalidating the waiver
    When a reviewed answer-key correction invalidates the supporting evaluation
    Then the original attempt and evaluation remain inspectable and a reasoned correction is appended
    And only dependent proficiency inferences, waivers, and proposals are recomputed or invalidated
    And the affected gate no longer claims satisfaction from the invalid evidence
    And unrelated objectives retain their supported status
    And the learner sees an explanation and a reassessment or remediation proposal without silent replacement of the active plan

  @S56 @SHARE-001 @SHARE-002 @SHARE-009 @SHARE-010
  Scenario: Publication requires owner authorization and consent to an exact public projection
    Given a newly created syllabus is private and has no public snapshot
    When another account attempts to publish it or references its private identifier
    Then the server rejects the operation without exposing the private syllabus
    When its owner prepares an intentional public title and summary and a validated template preview
    Then the preview shows exactly the proposed public or unlisted projection and its applicable publication terms
    And neither preview creation nor ordinary syllabus acceptance publishes it
    When the owner confirms that exact current preview and terms
    Then the app creates a separately identified immutable public revision in the chosen visibility mode
    And it records the terms version, consent, attribution, and rights scope for original structure and annotations
    And changing the projection before commit requires renewed review and confirmation

  @S57 @SHARE-002 @SHARE-009 @SHARE-010 @NFR-001 @NFR-002
  Scenario: The public snapshot schema and caches cannot disclose private learner state
    Given a private plan contains a sensitive goal, account identifiers, attempts, proficiency, progress, dates, notes, subscriptions, budgets, and credential references
    And its assessments contain private solutions and generation provenance
    And an approved paid resource has only link-display permission
    When a client submits those private fields or nonredistributable material in a publication payload
    Then validation rejects the prohibited payload and no snapshot is published
    When the owner publishes an eligible allowlisted projection
    Then public title and summary contain only intentionally provided public text rather than copied private text
    And public responses, search documents, and caches exclude all private fields and protected answers
    And paid material remains a labeled permitted link with third-party content excluded from the publication license
    And a public cache hit after the owner visits cannot expose owner-only fields to another viewer
    And public identifiers do not authorize access to private syllabi, attempts, or account APIs

  @S58 @SHARE-003 @NFR-003
  Scenario: Unlisted access is distinct from public discovery and confidentiality
    Given one available template is public and another is unlisted
    When a visitor uses app search, filters, lists, diagrams, or app-controlled indexing surfaces
    Then only the public template is discoverable there
    And its essential content and actions have accessible list and keyboard equivalents
    When a visitor opens the unlisted template's valid link
    Then the permitted snapshot is readable without discovery eligibility
    And publication settings explain that anyone with that link can access it and that unlisted is not confidential
    And possession of the link grants no access to the author's private learning state

  @S59 @SHARE-004 @ADAPT-005 @CAT-004 @CAT-007
  Scenario: Adopting a popular template rechecks the new learner's constraints and handles partial coverage
    Given a public template assumes paid access, demonstrated mathematics prerequisites, and more weekly time than the adopter has
    And the adopter requires free materials, requests formal mathematics, and has no qualifying prerequisite evidence
    And a referenced resource has since lost required usage permission
    When the adopter creates a deterministic or generated copy
    Then a new private draft belongs to the adopter and retains permitted origin attribution
    And it contains none of the author's progress, evidence, waivers, schedule, votes, credentials, or spending authorization
    And current rights, access, depth, prerequisite coverage, time, and cost constraints are checked before activation
    And an approved semantically suitable replacement satisfying the adopter's access policy is used when available
    And when no eligible replacement exists the ineligible resource is omitted with coverage_status set to partial, explicit coverage_limitations, and required learner review before activation
    And paid, quarantined, unavailable, or ineligible material is never silently included and a useful partial syllabus is not rejected outright
    And popularity cannot activate the draft or supply missing gate evidence

  @S60 @SHARE-005 @SHARE-010
  Scenario: Upvote sets and removals remain unique under retries and concurrent writes
    Given an available published revision and an authenticated verified account other than its author
    When that account sends repeated and concurrent requests to set its upvote
    Then a unique account-and-revision constraint permits exactly one active vote
    And the count increases once rather than toggling with retries
    When the account repeatedly and concurrently removes its upvote
    Then no active vote remains and the count returns once without underflow
    When an anonymous account, an unverified account, or the author attempts to upvote
    Then the server rejects each ineligible request without changing the count
    And client-supplied aggregate counts cannot change the server-derived total

  @S61 @SHARE-005 @SHARE-007
  Scenario: Published revisions and forks never inherit another revision's votes
    Given revision one has eligible upvotes and the declared duplicate policy rejects identical republication
    When its owner publishes a meaningful edit as revision two while another learner votes on revision one
    Then revision two has a distinct immutable identity and starts with zero votes
    And the concurrent vote and existing link remain associated with revision one while it is available
    And a moving latest link resolves to an explicit revision before voting
    When another learner publishes a permitted attributed fork
    Then the fork has its own identity and zero inherited votes
    When the original owner resubmits identical public content as another revision
    Then the declared duplicate policy rejects it without creating another vote target

  @S62 @SHARE-006 @CAT-001 @CAT-006 @NFR-008
  Scenario: Community preference cannot override educational review or current eligibility
    Given one template has many upvotes but contains a currently quarantined or rights-restricted resource
    And another eligible template has fewer upvotes
    When discovery ranking and recommendations are computed
    Then current eligibility and moderation or rights overlays are applied before popularity ranking
    And the ineligible template or resource is withheld as required by the active restriction
    And upvotes are labeled community preference rather than factual verification, educational approval, or proven efficacy
    And votes neither approve catalog entries nor change any learner's proficiency or gate evidence

  @S63 @SHARE-008 @SHARE-009 @CAT-007
  Scenario: Unpublishing affects app-controlled access while current rights still govern existing copies
    Given a publication has public links, indexed results, cached responses, and a previously adopted private copy
    When its authorized owner unpublishes it
    Then direct app reads, discovery, search results, and app-controlled caches stop serving the withdrawn snapshot
    And retries or an older index cannot restore availability against the current withdrawal overlay
    And the private copy retains only what its applicable license, privacy, and current resource-rights policies permit
    And a later source-rights restriction applies to current use even when an older snapshot allowed it
    And permitted learning history remains attributable
    And the UI explains the treatment of existing copies without promising recall of externally saved copies

  @S64 @SHARE-008 @SHARE-010 @NFR-001 @NFR-002
  Scenario: Public reports and moderation do not widen access or permit executable content
    Given a report identifies a public revision with unsafe link or markup content
    When the report is processed and an authorized moderator quarantines that revision
    Then the report outcome and quarantine retain an attributable actor and reason
    And active reads, discovery, cached views, and vote mutations honor the quarantine
    And any permitted displayed text is safely rendered without executing the reported payload
    And reporting and moderation do not disclose reporter or voter identities publicly
    And moderator privileges for public reports do not grant access to private attempts, schedules, or credentials
    And an ordinary viewer cannot unpublish or change another owner's publication through forged identifiers

  @S65 @SHARE-010 @NOT-001
  Scenario: Sharing release controls and notifications stay within the initial scope
    Given publication and voting are enabled in a release candidate
    When the release gate checks report handling, publication authorization, safe rendering, cache isolation, and configured spam or vote-abuse controls
    Then each required control must pass before public sharing is released
    And repeated abusive publication or voting requests are constrained by the declared policy without multiplying votes
    When a syllabus is published, forked, reported, or upvoted
    Then no social push notification is queued
    And initial sharing exposes no comments or direct-message feature
    And separately opted-in study reminders continue to follow the learner's study schedule and quiet-hour settings

  @S66 @BILL-002 @BILL-006 @BILL-007 @NFR-001
  Scenario: Server-mediated BYOK pins an encrypted tenant-owned connection
    Given a learner saves a credential for an approved provider after the custody disclosure
    When the backend creates the connection and authorizes a learner-specific AI job
    Then credential material is stored in the approved encrypted secret store with tenant-scoped access
    And the job pins the learner, connection version, mode, approved provider and model, and usage ceiling
    And ordinary responses and queue payloads contain nonsecret references rather than the raw key
    When another account submits that connection identifier or an unapproved provider-model combination
    Then authorization rejects the request before secret resolution or provider dispatch
    And the original learner incurs no usage or charge from that rejected operation

  @S67 @BILL-001 @BILL-005 @BILL-007
  Scenario Outline: Downstream retries cannot escape the authorized BYOK route
    Given <operation> is authorized for one learner's BYOK connection, provider, model, and request ceiling
    And a downstream gateway or SDK defaults to system-credential fallback on a provider error
    When an authentication failure, quota failure, timeout, or repair retry occurs
    Then every permitted attempt retains the authorized credential mode and routing restrictions
    And no hosted credential, different learner's key, provider, or model is selected implicitly
    And an adapter unable to guarantee that behavior is unavailable for BYOK before dispatch
    And recoverable failures offer an explicit new choice without creating an unauthorized hosted charge
    Examples:
      | operation |
      | syllabus generation |
      | invalid-output repair |
      | adaptation proposal generation |
      | AI-assisted practice feedback |
      | a learner-specific embedding request required by an enabled workflow |

  @S68 @BILL-004 @BILL-005 @BILL-008
  Scenario: BYOK ceilings bound app requests without claiming control of external account spending
    Given parallel BYOK jobs share a local authorization limit and retry ceiling
    And the provider account is also used outside the app and its exact contracted tariff is unavailable
    When app jobs reserve capacity, dispatch attempts, and report usage
    Then atomic authorization prevents the app's concurrent requests and retries from bypassing its configured limits
    And provider-reported token usage, estimated provider charges, confirmed app service charges, and externally billed inference remain distinct
    And estimated provider charges are not debited again as hosted inference
    And cost uncertainty and the estimate basis remain visible rather than reporting an exact external bill
    And the app does not claim to cap unrelated provider-account usage or enforce an unavailable provider-side spending limit
    And ambiguous timeouts retain an unresolved outcome for reconciliation instead of silently releasing capacity and duplicating dispatch


  @S69 @UI-007 @UI-021 @UI-023 @NFR-003
  Scenario: Theme tokens preserve readable information
    Given light and dark versions of the same long-content study view
    When normal and large text, controls, warnings, and selected states are inspected
    Then applicable text and non-text contrast requirements are met on their actual backgrounds
    And the same content, actions, and evidence meanings remain available in both themes

  @S70 @UI-008 @UI-021 @UI-022
  Scenario: Effects are optional and content surfaces remain opaque
    Given glass navigation and softly shaded decorative panels
    When solid surfaces, forced colors, or unavailable backdrop blur is applied
    Then navigation remains operable and selected states and focus remain explicit
    And reading, math, code, quizzes, evidence, prices, and consent use opaque surfaces

  @S71 @UI-009 @UI-010
  Scenario: Compact navigation preserves the intended task
    Given a selected public revision or private module and a 320 CSS pixel viewport
    When the learner signs in if needed, navigates back, enlarges text, or opens the keyboard
    Then the intended permitted context and primary action remain usable
    And no vote, publication, activation, or payment occurs from navigation alone

  @S72 @UI-011
  Scenario: Background and desired rigor remain independent
    Given introductory linear algebra evidence and unknown matrix calculus
    And Formal global depth with an Applied deployment override and Application first order
    When the learner changes the global depth and then restores it to Formal
    Then the explicit deployment override and assessed evidence remain unchanged
    And familiar-material treatment remains a separate labeled choice

  @S73 @UI-012
  Scenario: Diagnostic effort target is not a speed-based score
    Given a reviewed diagnostic with partial submitted work and an effort target
    When that target is reached or the learner pauses or stops
    Then unanswered objectives remain unknown and submitted evidence is retained
    And no response is failed or locked merely because the target was reached

  @S74 @UI-013 @BILL-001 @BILL-005
  Scenario: Generation has honest authorization and recovery
    Given an authorized generation job and its server state
    When a transient network failure occurs and the learner returns or retries the HTTP request
    Then the interface observes the same job without another chargeable submission
    And it shows only authoritative status rather than a fabricated percentage
    And cancellation requested remains distinct from confirmed cancellation and refund terms

  @S75 @UI-014 @UI-001 @UI-002
  Scenario: Map and outline expose equivalent facts and actions
    Given modules with multiple prerequisites, optional enrichment, and due reviews
    When the learner selects a module and switches between map and outline
    Then selection and filters are preserved and essential facts and actions are equivalent
    And keyboard and non-dragging pointer controls can reach all required information
    And Study ahead leaves unmet prerequisite activity states and evidence unchanged
    And study-ahead or skip actions cannot bypass source rights or paid-use authorization

  @S76 @UI-015 @UI-004
  Scenario: Study content stays readable and externally opened work stays incomplete
    Given a formal math activity with a verified source and code task
    When the learner enlarges text and opens and returns from the external material
    Then readable math/code and the same task remain available
    And external navigation alone does not record completion or demonstration

  @S77 @UI-015
  Scenario: Answer selection and feedback preserve deliberate assessment conditions
    Given a reviewed question with optional permitted help
    When the learner selects an answer or requests a worked solution
    Then selection alone does not submit or advance the question
    And help is recorded according to the assessment conditions
    And feedback preserves the question, response, assurance, and any uncertainty

  @S78 @UI-016
  Scenario: Progress and adaptation do not conflate evidence with activity
    Given completed activities, demonstrated objectives, and due reviews
    When the learner inspects progress and rejects or encounters a stale adaptation proposal
    Then those progress dimensions remain separately labeled
    And the active syllabus is unchanged and a refreshed proposal requires new review

  @S79 @UI-017
  Scenario: Publication confirms the exact public presentation
    Given a private syllabus and an intentionally authored publication preview
    When identity, content, attribution, terms, origin, or visibility changes
    Then the prior preview confirmation is invalidated
    And the user reviews the refreshed public snapshot before it is published
    And an unlisted link is described as readable by anyone who possesses it

  @S80 @UI-017 @SHARE-008
  Scenario: Owner navigation remains available while public content is quarantined
    Given a publication owned by the learner that is quarantined or withdrawn
    When the learner opens My publications and its revision history
    Then owner-scoped no-store metadata is available without fetching the prohibited public body
    And null titles or counts are shown as unavailable rather than invented values
    And a current management read supplies the withdrawal precondition token
    And another account cannot access that metadata

  @S81 @UI-017
  Scenario: Adoption and votes retain their revision and spending boundaries
    Given a displayed public revision and a deterministic compatible adoption
    When the learner chooses Use this syllabus or a vote request fails
    Then deterministic adoption creates a private draft without an AI key or inference budget
    And a failed vote reconciles to the authoritative state for that same revision
    And generated adaptation requires a separate authorized inference flow

  @S82 @UI-018 @BILL-002 @BILL-007
  Scenario: Key management does not silently authorize or reroute usage
    Given a disclosed approved provider connection form
    When the learner saves, rotates, deletes, or tests a key
    Then raw key input never enters general draft storage or logs and saved UI shows only masked metadata
    And any chargeable test requires disclosed bounded authorization
    And affected queued jobs never silently switch credential version or hosted mode

  @S83 @UI-019 @NOT-001 @NOT-004
  Scenario: Reminder denial and privacy preserve study access
    Given a learner viewing the reminder controls with timezone and quiet hours
    When permission is declined or unsupported
    Then Today and the schedule remain usable and delivery limitations are clear
    And enabled reminders use the selected privacy-preserving content policy

  @S84 @UI-020 @UI-006
  Scenario: Offline and stale operations have safe recovery
    Given retained nonsecret work and a failed or unsynchronized operation
    When the network returns or a conflicting revision is detected
    Then the interface explains retained work and the available retry or refresh action
    And it does not silently queue publication, voting, key changes, or paid authorization
    And pending completion does not claim server-confirmed proficiency

  @S85 @UI-021 @NFR-003
  Scenario: Complete processes remain usable with assistive input
    Given core learning, publication, billing-authorization, and settings flows
    When tested with keyboard, supported screen readers, text scaling, reflow, and modal dialogs
    Then labels, errors, status changes, focus order, dismissal, and focus return are usable
    And sticky surfaces and the software keyboard do not hide the focused control

  @S86 @UI-022 @NFR-003
  Scenario: Reduced effects preserve information and usable navigation
    Given a large plan and loading or transition states
    When reduced motion or solid surfaces is requested
    Then decorative movement, shimmer, parallax, and animated graph rearrangement stop
    And a usable outline and explicit static status remain available

  @S87 @UI-023 @NFR-001
  Scenario: Appearance and session recovery preserve privacy and authority
    Given a private study view and nonsecret draft
    When theme changes or the session expires and another account signs in
    Then appearance changes do not alter learning or spending state
    And private caches and draft content are isolated or cleared according to policy
    And restored consequential actions require the current account's valid authorization

  @S88 @UI-024 @NFR-002
  Scenario: Rendering and administrative controls require supported contracts
    Given an unknown required schema or an unavailable administrative integration
    When the interface attempts to display or operate the surface
    Then it presents a deliberate unsupported or unauthorized state with a useful next action
    And no model-authored executable layout or simulated success is rendered
