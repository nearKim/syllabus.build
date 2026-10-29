<!-- GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md -->
<!-- Specification SHA-256: 93d2401962b200cd101b843b690cebf4369b36348129bf7b00354ade430c39e1 -->

# T14-Core: Slice 2 — Design Tokens, Fail-Closed SafeActivityRenderer & Learn/Explore/Settings Shell

- **Source of Truth:** `specs/product.md` (SHA-256: `93d2401962b200cd101b843b690cebf4369b36348129bf7b00354ade430c39e1`)
- **Release Tier:** Tier 1: Private Alpha (Foundation Tracer Bullet)
- **Canonical Parent Slice:** `T14` (Complete responsive UI and accessibility)
- **Mapped Requirements:** 8
- **Mapped Acceptance Scenarios:** 7 (S69, S70, S71, S85, S86, S87, S88)
- **Mapped Controls:** 0 (none)

## 1. Canonical Slice Checklist (`specs/product.md` Section 18)

Split into `T14-Core` (Private Alpha shell) and `T14-Full` (Public Beta UI/accessibility completion, separate from `T09`):

- [ ] **T14-Core (Private Alpha):** Implement section 9's semantic tokens, typography, spacing, themes, opaque study surfaces, restrained navigation glass with solid fallbacks, `Learn/Explore/Settings` navigation shell, and `SafeActivityRenderer` (failing closed on unknown major curriculum schema versions with an unsupported-version state and safe text outline).
- [ ] **T14-Full (Public Beta, separate from T09):** Complete the screen inventory across `T03–T08`/`T12`/`T13`, independent proficiency/depth/order/recap controls, adaptation diff, publication preview, owner list/history, and non-dragging pointer + keyboard Map/Outline parity.
- [ ] **T14-Full Accessibility Evidence:** Combine automated accessibility regression checks with manual WCAG 2.2 AA evaluation evidence across the 8-part manual test matrix: (1) keyboard operation, (2) focus visibility, (3) screen readers, (4) accessible math (KaTeX MathML), (5) zoom/reflow at `320 CSS px` and `200%` text scaling, (6) reduced motion, (7) forced colors, and (8) Map/Outline equivalence; bind `S69–S88` to observable application checks.

**Exit:** every launch surface meets the section 9 acceptance and accessibility requirements; the UI renders the typed product without invented progress, evidence, costs, or unsupported functionality. This slice is P0 before T09, not optional polish.

## 2. Relevant Contracts, Schemas & Components

- `Section 9 UI components and explicit supported contracts`

## 3. Mapped Product Requirements

| ID | Priority | Scenarios | Contracts / Components | Verification Method | Normative Requirement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `UI-007` | P0 | `S69` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | The interface shall use the section 9 semantic tokens, typography, spacing, hierarchy, and original visual identity; visual defaults shall remain readable in light and dark themes. |
| `UI-008` | P0 | `S70` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Glass shall be limited to navigation or small tool surfaces with verified contrast; study content shall remain opaque. Soft shadows shall never be the sole control/state cue, and solid/forced-color fallbacks shall preserve all actions. |
| `UI-009` | P0 | `S71` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Learn, Explore, and Settings shall provide consistent labeled navigation. Deep links, selected revision/module, safe back navigation, and sign-in return context shall be preserved without implicit consequential actions. |
| `UI-010` | P0 | `S71` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Compact, medium, and wide layouts shall adapt to available space and text scaling. Primary work, access warnings, and actions shall remain usable at 320 CSS px without page-level horizontal scrolling or keyboard obstruction. |
| `UI-021` | P0 | `S69 S70 S85` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | All supported web processes shall target WCAG 2.2 AA with semantic controls, keyboard/screen-reader operation, contrast, reflow, text scaling, appropriate target sizes, accessible math, deliberate focus, and actual-device verification. |
| `UI-022` | P0 | `S70 S86` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Nonessential motion and translucency shall respect stricter system/product preferences. Graphs and UI effects shall have bounded, progressive rendering that preserves usable text/outline controls without decorative animation. |
| `UI-023` | P0 | `S69 S87` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Appearance settings shall remain separate from learning and billing state; authentication shall support accessible input and safe session recovery, and public/private account context shall not leak through caches or navigation. |
| `UI-024` | P0 | `S88` | Section 9 UI components and explicit supported contracts | Observable flow checks, accessibility review, and risk-focused component/integration verification | Every UI surface shall render validated typed data through reviewed components and use an explicit supported contract; role-restricted/admin surfaces shall enforce authorization, and unsupported functionality shall not simulate success. |

## 4. Mapped Security, Rights & Operational Controls (`CTRL-*`)

| Control ID | Parent Requirements | Notes |
| :--- | :--- | :--- |

## 5. Relevant Acceptance Scenarios (`acceptance.feature`)

````gherkin
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
