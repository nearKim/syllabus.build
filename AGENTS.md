# UI Design & Impeccable Craft Floor — Mandatory Rules

AI-generated interfaces converge on a recognizable default aesthetic. Refrain from EVERY prohibited pattern below unless the user explicitly directs otherwise. This file outranks every design skill.

## Prohibited — Layout & Components (Strict Ban)
- **Thick colored left/side accent borders on cards (`[side-tab]`)**: NEVER use `border-left` or `border-right` above `1px` on cards, list items, callouts, or alerts (e.g., `border-left: 3px solid ...` on a rounded card creates tapered crescent corner artifacts and is the #1 AI-slop tell).
- **Cards nested inside cards**: Cards are the lazy container; nested cards (e.g., a white rounded card inside a tinted rounded card inside a white `.surface-panel`) are always wrong. Use flat `1px` hairline row dividers (`border-top: var(--hairline)`) inside a single surface container.
- **Stat-card banner rows / Hero-metric templates**: NEVER build 3- or 4-column KPI stat card banners (big number, small uppercase label, supporting caption, accent progress bar). For summaries, use quiet inline hairline-separated summaries (`progress-summaries`), never boxed stat cards.
- **Kicker / eyebrow labels above headings**: NEVER place tracked-uppercase or muted eyebrow/kicker labels above an `<h1>` or section heading. Let the heading carry its own weight.
- **All-caps section labels as the default hierarchy device**: Do not default to `text-transform: uppercase; letter-spacing: 0.04em` for section/metric labels.
- **Sub-44px interactive touch targets**: Every interactive button, chip, or `<summary>` control must meet the `44px` minimum touch target (`var(--layout-touch-target-min)`), or use intentional hit-area padding.

## Prohibited — Color, Typography & Motion
- Blue→purple / indigo gradients anywhere; gradient-filled text; glassmorphism/frosted glow borders as decoration.
- Hairline border paired with a wide diffuse shadow on the same element.
- Global `0.01ms !important` transition/animation kills for `prefers-reduced-motion` that destroy state-change feedback instead of disabling spatial motion cleanly.

## Mandatory Pre-Delivery Check (`impeccable detect`)
Before finishing any turn that touches CSS, HTML, or UI components (`apps/web/public/styles.css`, `apps/web/src/**/*.ts`, `apps/web/src/**/*.tsx`), run:
```bash
.claude/skills/impeccable/scripts/impeccable detect --no-config apps/web/public/styles.css apps/web/src/browserApp.ts apps/web/src/components
```
Zero anti-patterns must be reported before completing the turn.
