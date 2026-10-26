# UI Design & Impeccable Craft Floor — Mandatory Rules

AI-generated interfaces converge on a recognizable default aesthetic. Refrain from EVERY prohibited pattern below unless the user explicitly directs otherwise. This file outranks every design skill.

## Prohibited — Layout & Components (Strict Ban)
- **Box-in-Box (`[box-in-box]`)**: NEVER place bordered or tinted-background boxes inside an outer bordered or surface-filled container box:
  - Page sections and workspaces (`.surface-panel`, `#progress-capability-portfolio`, `.today-unified-header`, `.flow-board`, `.resources-table-wrapper`, `.marketplace-filters`, `.today-curriculum-overview`) must NEVER use 4-sided borders (`border: var(--hairline)`) or card surface fills (`background: var(--color-surface)`).
  - Unit swimlanes (`.matrix-table tbody tr.study-card > *`, `.progress-unit-row`) may use a single borderless tonal swimlane fill (`var(--color-swimlane)` / `var(--color-swimlane-selected)`) against the unboxed `#FFFFFF` canvas, but must NEVER use 4-sided borders, and child capability rows (`.progress-capability-row`) inside `.progress-unit-row` must remain completely unboxed.
  - Inline row links, actions, and metadata (`.progress-act-chip`, `.progress-check-btn`, `.resource-usage-chip`, `.unit-badge`, `.progress-unit-gate`, `.progress-status-pill`, `.learn-tag-primary`, `.learn-topic-chip`, `.domain-pill`, `.track-badge`) must NEVER be rendered as bordered/tinted pill boxes inside rows or cards, and buttons/chips must NEVER contain nested `.badge` or checkbox boxes.
- **Line-Component Abuse (`[line-abuse]`)**: NEVER replace boxes with horizontal divider spam (`border-top`, `border-bottom`, `border-block`, `<hr>`, or decorative horizontal progress bars `.progress-overview-bar`). Separate page sections, units, capabilities, and headers through **spatial proximity and generous vertical whitespace (`gap: 32px–48px`)** and structural indentation:
  - `.surface-panel`, `.today-unified-header`, `.today-curriculum-brief`, `.matrix-table tbody tr + tr > *`, `.progress-overview-strip`, `.progress-unit-row`, `.progress-capability-row`, `.today-curriculum-overview`, `.sidebar-curricula`, `.marketplace-filters`, `.facet-pair`, `.marketplace-card-foot`, `.intake-fit-tray`, `.intake-controls-grid`, and `.intake-existing-plans-block` must NEVER use horizontal divider borders.
  - Only true data-table column headers (`.flow-colhead`, `.resources-data-table thead th` bottom baseline) and the top sticky navbar may use a single baseline rule.
- **Blurred Title / Description / Contents Hierarchy (`[hierarchy-blur]`)**: Every view must maintain an unmistakable 4-tier visual distinction across size, weight, color (`#17191C` primary vs `#5B636E` secondary), and spatial indentation:
  - **Titles**: Page `h1.page-title` (`36px`, `700`, `#17191C`), selected curriculum title `.today-selected-title` (`24px`, `700`, `#17191C`), section `h2` (`20px–22px`, `700`), unit title `.progress-unit-title` (`19px`, `700`, `#17191C`), item title `.capability-title` / `.resource-row-title` (`16px`, `600`, `#17191C`).
  - **Descriptions & Prose**: `.page-description`, `.plan-goal`, `.today-curriculum-brief .plan-goal`, `.today-curriculum-brief .plan-scope-list`, `.progress-cap-description`, `.resource-row-rationale` MUST use regular weight (`font-weight: 400`, NEVER `500` or `600`) and muted secondary ink (`color: var(--color-text-secondary)`, NEVER `#17191C`), with `line-height: 1.55–1.6`.
  - **Actual Contents**: Child items must be structurally indented under their parent heading (`.progress-unit-capabilities` indented `padding-inline-start: 30px` under the unit header; `.progress-cap-description` and `.progress-cap-activities` indented `padding-inline-start: 28px` under the capability title row) so parent vs. child content is scannable at a glance without horizontal lines.
- **Thick colored left/side accent borders on cards (`[side-tab]`)**: NEVER use `border-left` or `border-right` above `1px` on cards, list items, callouts, or alerts (e.g., `border-left: 3px solid ...` on a rounded card creates tapered crescent corner artifacts and is the #1 AI-slop tell).
- **Stat-card banner rows / Hero-metric templates**: NEVER build 3- or 4-column KPI stat card banners (big number, small uppercase label, supporting caption, accent progress bar). For summaries, use quiet borderless inline summaries (`.progress-overview-strip`), never boxed stat cards or horizontal progress bars.
- **Kicker / eyebrow labels above headings**: NEVER place tracked-uppercase or muted eyebrow/kicker labels above an `<h1>` or section heading. Let the heading carry its own weight.
- **All-caps section labels as the default hierarchy device**: Do not default to `text-transform: uppercase; letter-spacing: 0.04em` for section/metric labels.
- **Sub-44px interactive touch targets**: Every interactive button, chip, or `<summary>` control must meet the `44px` minimum touch target (`var(--layout-touch-target-min)`), or use intentional hit-area padding.

## Prohibited — Color, Typography & Motion
- Blue→purple / indigo gradients anywhere; gradient-filled text; glassmorphism/frosted glow borders as decoration.
- Hairline border paired with a wide diffuse shadow on the same element.
- Global `0.01ms !important` transition/animation kills for `prefers-reduced-motion` that destroy state-change feedback instead of disabling spatial motion cleanly.

## Mandatory Pre-Delivery Check (`scripts/impeccable-gate.mjs`)
Running `impeccable detect` on raw `.ts` or `.css` files alone is insufficient because CSS variables (`var(--hairline)`) and rendered DOM nesting are not resolved. Before finishing any turn that touches CSS, HTML, or UI components (`apps/web/public/styles.css`, `apps/web/src/**/*.ts`, `apps/web/src/**/*.tsx`), you MUST run the full rendered-HTML + Box-in-Box gate:
```bash
pnpm --filter @curriculum/web exec tsx ../../scripts/impeccable-gate.mjs
```
Zero anti-patterns, zero advisories, and zero `[box-in-box]` violations must be reported before completing the turn.
