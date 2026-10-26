# UI Design — AI-Slop Characteristics to Refrain From

AI-generated interfaces converge on a recognizable default aesthetic. Each trait below may be harmless in isolation, but ubiquity has turned them into instant clichés: together they read as machine output and signal "didn't spend the time." Refrain from EVERY pattern below unless the user explicitly directs otherwise. When an existing project's design system already uses one (consistency wins), match the project but flag the conflict — never silently restyle.

This file outranks every design skill. When a skill's rule conflicts with this file, follow this file and name the conflict in your reply.

## Prohibited — color

- Blue→purple / indigo gradients anywhere (buttons, text, backgrounds, orbs) — the single loudest AI tell; it's Tailwind's indigo-500 heritage, not a choice
- Lavender-purple accents and cyan-on-dark palettes
- Warm cream/beige as the default "tasteful" page ground
- Default dark mode with colored glow box-shadows or saturated radial halos
- Gradient-filled text as decoration
- Low-contrast gray body text (fails WCAG; gray on colored grounds looks washed out) — 4.5:1 minimum for body, 3:1 for large text

## Prohibited — typography

- Inter / Geist / Space Grotesk / Instrument Serif as the reflex pick, or one family for the whole page
- Oversized italic-serif hero headlines, or a single italic-serif accent word inside a sans headline
- Tracked-uppercase eyebrow/kicker labels or pill badges directly above the H1
- All-caps section labels as the default hierarchy device
- Flat size hierarchy (steps under ~1.25 ratio) and full-sentence headlines at display size

## Prohibited — layout & components

- The conveyor: centered hero → three icon-topped cards → testimonials → pricing → footer
- Identical icon + heading + text card grids; cards nested inside cards
- Thick colored left/side accent borders on cards — as reliable a tell as em-dashes in text
- Stat banner rows (big number, small label, × three or four, gradient accent)
- Tiny numbered "1 / 2 / 3" labels beside section headings
- One border-radius token everywhere; 24px+ rounding on small cards (12–16px for cards; full-pill only for tags/buttons)
- The same spacing value between everything — no tight grouping vs. generous separation
- Body text lines over ~75ch; decorative background grids on surfaces that measure nothing

## Prohibited — effects & motion

- Glassmorphism (frosted cards, glow borders) as decoration rather than a real layering need
- Hairline border paired with a wide diffuse shadow on the same element
- Pulsing status dots on static data; decorative blinking terminal cursors
- Bounce/elastic easing; auto-scrolling marquees; scale-or-rotate image hover effects
- Scroll-triggered fade-up applied uniformly to every section

## Prohibited — imagery & icons

- Interchangeable thin-line icon sets sitting in small rounded accent-colored tiles atop cards or headings
- Hand-coded SVG mascots or scene illustrations; hero art assembled from generic shapes — ship nothing rather than a sketchy fallback
- Emoji as navigation or bullet iconography

## Prohibited — copy inside the UI

- Em-dash-riddled interface copy
- "Not X . . . but Y" constructions
- Weightless paired imperatives ("Build faster. Ship smarter.") and value props that could describe any company
- Buzzword filler: streamline, empower, supercharge, seamless, world-class, enterprise-grade
- The feature-card formula: [adjective] + [noun] + "that helps you" + [verb]

## Prohibited — tooling tells

- Shipping unthemed shadcn/Radix component defaults; the stock shadcn + Radix (+ Drizzle) look is itself a tell. The libraries are fine — the unmodified default styling is not. Theme deliberately until the origin is unrecognizable.

## Required instead

- Never adopt a reference verbatim. Before benchmarking one, reason about fit against the existing design system — palette, radius ladder, type roles, materials — and state WHY each borrowed element fits or is rejected. Then re-express what survives in the system's own tokens so the result is coherent with the current product, not a transplant.
- Positive, specific art direction per project: a concrete reference point (era, movement, material, culture), explicit palette values, and a deliberate type pairing — all derived from what the product actually is
- Process over button-press: gather references/mood-board material, sketch or iterate on drafts, and feed specific direction into generation — aim for texture and specificity that could pass as handmade
- Shadows: soft, layered, surface-tinted (tight contact shadow + broader ambient) — never a single heavy or far-offset black blur; keep an inset top rim-light on glass surfaces
- Never write an in-flight, unapproved design direction into a project's convention/doctrine docs (CLAUDE.md, conventions.md, AGENTS.md). Doctrine is recorded only after the user has seen and accepted the direction.
- Final self-check before delivery: would a designer glance at this and say "AI made that"? If yes, redo it.

