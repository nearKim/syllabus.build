<!-- GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md -->
<!-- Specification SHA-256: a1afc279f66cb3747704da12ed93dcb78d044d6b8de5a4ab07789f543b08f486 -->

# T14-Full: Slice 12 — Complete Screen Inventory, Automated A11y Checks & Manual WCAG 2.2 AA Evidence

- **Source of Truth:** `specs/product.md` (SHA-256: `a1afc279f66cb3747704da12ed93dcb78d044d6b8de5a4ab07789f543b08f486`)
- **Release Tier:** Tier 3: Public Beta (Separate from T09)
- **Canonical Parent Slice:** `T14` (Complete responsive UI and accessibility)
- **Mapped Requirements:** 24
- **Mapped Acceptance Scenarios:** 23 (S25, S26, S27, S69, S70, S71, S72, S73, S74, S75, S76, S77, S78, S79, S80, S81, S82, S83, S84, S85, S86, S87, S88)
- **Mapped Controls:** 0 (none)

## 1. Canonical Slice Checklist (`specs/product.md` Section 18)

Split into `T14-Core` (Private Alpha shell) and `T14-Full` (Public Beta UI/accessibility completion, separate from `T09`):

- [ ] **T14-Core (Private Alpha):** Implement section 9's semantic tokens, typography, spacing, themes, opaque study surfaces, restrained navigation glass with solid fallbacks, `Learn/Explore/Settings` navigation shell, and `SafeActivityRenderer` (failing closed on unknown major curriculum schema versions with an unsupported-version state and safe text outline).
- [ ] **T14-Full (Public Beta, separate from T09):** Complete the screen inventory across `T03–T08`/`T12`/`T13`, independent proficiency/depth/order/recap controls, adaptation diff, publication preview, owner list/history, and non-dragging pointer + keyboard Map/Outline parity.
- [ ] **T14-Full Accessibility Evidence:** Combine automated accessibility regression checks with manual WCAG 2.2 AA evaluation evidence across the 8-part manual test matrix: (1) keyboard operation, (2) focus visibility, (3) screen readers, (4) accessible math (KaTeX MathML), (5) zoom/reflow at `320 CSS px` and `200%` text scaling, (6) reduced motion, (7) forced colors, and (8) Map/Outline equivalence; bind `S69–S88` to observable application checks.

**Exit:** every launch surface meets the section 9 acceptance and accessibility requirements; the UI renders the typed product without invented progress, evidence, costs, or unsupported functionality. This slice is P0 before T09, not optional polish.

## 2. Relevant Contracts, Schemas & Components

- `Section 9 UI components and explicit supported contracts`
- `Today`
- `map and outline`
- `typed renderer`

## 3. Mapped Product Requirements

| ID | Priority | Scenarios | Contracts / Components | Verification Method | Normative Requirement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `UI-001` | P0 | `S25 S75` | typed renderer; Today; map and outline | interaction and accessibility verification | The primary curriculum view shall show modules, prerequisite relationships, current position, optional branches, and review status; every arrow meaning shall be explicit. |
| `UI-002` | P0 | `S25 S75` | typed renderer; Today; map and outline | interaction and accessibility verification | Every graph action and essential fact shall be available through a keyboard- and screen-reader-usable outline or list. Mobile shall show a focused module/path and next action rather than shrink a desktop graph. |
| `UI-003` | P0 | `S26` | typed renderer; Today; map and outline | interaction and accessibility verification | A Today view shall present the next feasible session, expected time, required access/setup, and the reason it is scheduled, with start, snooze, reschedule, and skip actions as appropriate. |
| `UI-004` | P0 | `S26 S76` | typed renderer; Today; map and outline | interaction and accessibility verification | An activity detail view shall show its objective, resource section when verified, task, expected effort range, practice/assessment conditions, and completion/evidence state. Unverified chapter or timestamp precision shall be omitted. |
| `UI-005` | P0 | `S26` | typed renderer; Today; map and outline | interaction and accessibility verification | The interface shall distinguish required/core work from optional enrichment and optional certification; hidden optional work shall not count against required completion. |
| `UI-006` | P0 | `S27 S84` | typed renderer; Today; map and outline | interaction and accessibility verification | Loading, failed generation, no eligible resources, permission denied, stale source, insufficient credit, offline, and unsynchronized states shall each have a usable next action and accessible messaging. |
| `UI-007` | P0 | `S69` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | The interface shall use the section 9 semantic tokens, typography, spacing, hierarchy, and original visual identity; visual defaults shall remain readable in light and dark themes. |
| `UI-008` | P0 | `S70` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Glass shall be limited to navigation or small tool surfaces with verified contrast; study content shall remain opaque. Soft shadows shall never be the sole control/state cue, and solid/forced-color fallbacks shall preserve all actions. |
| `UI-009` | P0 | `S71` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Learn, Explore, and Settings shall provide consistent labeled navigation. Deep links, selected revision/module, safe back navigation, and sign-in return context shall be preserved without implicit consequential actions. |
| `UI-010` | P0 | `S71` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Compact, medium, and wide layouts shall adapt to available space and text scaling. Primary work, access warnings, and actions shall remain usable at 320 CSS px without page-level horizontal scrolling or keyboard obstruction. |
| `UI-011` | P0 | `S72` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Intake shall independently expose topic self-report/evidence, mathematical depth and overrides, teaching order, familiar-material treatment, and hard constraints. Changing one dimension shall not silently rewrite another. |
| `UI-012` | P0 | `S73` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Diagnostics shall show reviewed coverage, optional participation, assistance conditions, and a sampling/effort target; stopping or reaching that target shall not fail unanswered objectives or create a hidden speed score. |
| `UI-013` | P0 | `S74` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | The generation UI shall require applicable mode/cost authorization, show only authoritative job states, preserve recoverable requests, distinguish cancellation requested from confirmed, and activate a draft only on explicit action. |
| `UI-014` | P0 | `S75` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Map and outline shall preserve selected module and filters, expose equivalent essential facts/actions, label relationship meanings, and provide non-gesture navigation without misrepresenting a multi-parent graph as a tree. Study-ahead choices shall not satisfy prerequisite evidence gates or bypass rights/authorization. |
| `UI-015` | P0 | `S76 S77` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Study and assessment surfaces shall support readable text, math and code, explicit answer submission, attributable feedback and assistance, external-resource return, and honest completion status without implying an unimplemented code runner. |
| `UI-016` | P0 | `S78` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Progress shall separate completion, objective evidence, and review timing. Adaptation shall show a readable before/after diff with reasons and effects; stale or rejected proposals shall preserve the active plan. |
| `UI-017` | P0 | `S79 S80 S81` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Discovery, publication, adoption, votes, and owner management shall expose exact revision/visibility/attribution and permissions; owner management shall survive public quarantine/withdrawal, and adoption shall never imply inference spending. |
| `UI-018` | P0 | `S82` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Provider UI shall disclose custody/billing, keep key entry transient, expose only masked saved metadata, distinguish testing/rotation/deletion, and require valid operation authorization without automatic hosted fallback. |
| `UI-019` | P0 | `S83` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Reminder/account settings shall show timezone, quiet hours, permission and privacy choices, retain learning functionality after denial, and explain export/deletion/withdrawal consequences under the actual policies. |
| `UI-020` | P0 | `S84` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Async surfaces shall distinguish empty, partial, loading, failed, unauthorized, stale, offline and unsynchronized states as applicable, preserve safe drafts, and provide recovery without duplicate charges or silent queued publication. |
| `UI-021` | P0 | `S69 S70 S85` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | All supported web processes shall target WCAG 2.2 AA with semantic controls, keyboard/screen-reader operation, contrast, reflow, text scaling, appropriate target sizes, accessible math, deliberate focus, and actual-device verification. |
| `UI-022` | P0 | `S70 S86` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Nonessential motion and translucency shall respect stricter system/product preferences. Graphs and UI effects shall have bounded, progressive rendering that preserves usable text/outline controls without decorative animation. |
| `UI-023` | P0 | `S69 S87` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Appearance settings shall remain separate from learning and billing state; authentication shall support accessible input and safe session recovery, and public/private account context shall not leak through caches or navigation. |
| `UI-024` | P0 | `S88` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Every UI surface shall render validated typed data through reviewed components and use an explicit supported contract; role-restricted/admin surfaces shall enforce authorization, and unsupported functionality shall not simulate success. |

## 4. Mapped Security, Rights & Operational Controls (`CTRL-*`)

| Control ID | Parent Requirements | Notes |
| :--- | :--- | :--- |

## 5. Relevant Acceptance Scenarios (`acceptance.feature`)

````gherkin
  @S25 @UI-001 @UI-002 @NFR-003
  Scenario: Diagram navigation has an accessible equivalent
    Given a curriculum has prerequisites, optional branches, and a due review
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
    And no invalid curriculum or invented progress is displayed as a success
    Examples:
      | state |
      | generation failed |
      | no eligible resources |
      | insufficient credit |
      | notification permission denied |
      | offline with pending progress |
      | stale source |

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
    And the active curriculum is unchanged and a refreshed proposal requires new review

  @S79 @UI-017
  Scenario: Publication confirms the exact public presentation
    Given a private curriculum and an intentionally authored publication preview
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
    When the learner chooses Use this curriculum or a vote request fails
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

````
