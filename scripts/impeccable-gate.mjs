import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mountSyllabusWebApp } from "../apps/web/src/browserApp.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const stylesPath = path.join(repoRoot, "apps/web/public/styles.css");
const impeccableBin = path.join(repoRoot, ".claude/skills/impeccable/scripts/impeccable");

function resolveCssVariables(rawCss) {
  const rootMatch = rawCss.match(/:root(?:,\s*\[data-theme="light"\])?\s*\{([^}]*)\}/);
  const vars = {};
  if (rootMatch) {
    for (const line of rootMatch[1].split("\n")) {
      const m = line.match(/^\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
  }
  let resolved = rawCss;
  for (let pass = 0; pass < 4; pass++) {
    resolved = resolved.replace(/var\((--[a-zA-Z0-9-]+)(?:,\s*([^)]+))?\)/g, (full, name, fallback) => {
      return vars[name] ?? fallback ?? full;
    });
  }
  return resolved;
}

function extractCssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "m");
  return css.match(re)?.[1] ?? "";
}

function runBoxInBoxAudit(rawCss, views) {
  const violations = [];

  // 1. Outer section / wrapper selectors that MUST NOT be 4-sided bordered boxes wrapping inner cards/boxes
  const bannedOuterBoxSelectors = [
    ".surface-panel",
    ".settings-section",
    "#progress-capability-portfolio",
    ".progress-portfolio-section",
    ".today-unified-header",
    ".today-active-workspace > .flow-board",
    ".resources-table-wrapper",
    ".marketplace-filters",
    ".admin-resources-filters",
    ".session-reschedule-panel"
  ];

  for (const sel of bannedOuterBoxSelectors) {
    const block = extractCssBlock(rawCss, sel);
    if (!block) continue;
    const hasFourSidedBorder = /(?:^|;|\s)border\s*:\s*(?:var\(--hairline\)|1px\s+solid)/m.test(block);
    const hasCardSurface = /background(?:-color)?\s*:\s*var\(--color-surface(?:-secondary)?\)/m.test(block);
    if (hasFourSidedBorder || hasCardSurface) {
      violations.push(
        `[box-in-box] Outer container '${sel}' has a 4-sided border or card surface background (${hasFourSidedBorder ? "border" : "background"}), creating a Box-in-Box wrapper around inner controls.`
      );
    }
  }

  // 2. Row / inner item selectors that MUST remain flat hairline rows or inline text (not nested boxes)
  const bannedInnerBoxSelectors = [
    ".progress-capability-row",
    ".progress-act-chip",
    ".progress-check-btn",
    ".progress-status-pill",
    ".progress-unit-gate",
    ".resource-usage-chip",
    ".resource-category-badge",
    ".unit-badge",
    ".unit-prereq-pill",
    ".node-optional",
    ".gate-unlocks-badge",
    ".math-inline",
    ".learn-tag-primary",
    ".learn-tag-facet",
    ".learn-topic-chip"
  ];

  for (const sel of bannedInnerBoxSelectors) {
    const block = extractCssBlock(rawCss, sel);
    if (!block) continue;
    const hasFourSidedBorder = /(?:^|;|\s)border\s*:\s*(?:var\(--hairline\)|1px\s+solid)/m.test(block);
    const hasTintedBoxBg =
      /background(?:-color)?\s*:\s*(?:var\(--tint-|var\(--color-(?:surface|accent-surface|success-surface)|color-mix)/m.test(
        block
      );
    if (hasFourSidedBorder || hasTintedBoxBg) {
      violations.push(
        `[box-in-box] Inner element '${sel}' has a nested box border or tinted pill fill (${hasFourSidedBorder ? "border" : "background"}) inside its parent row/card.`
      );
    }
  }

  // 3. Unit swimlanes (.progress-unit-row, .matrix-table tbody tr.study-card > *) must be borderless tonal swimlanes, never 4-sided bordered boxes
  const unitSwimlaneBlock = extractCssBlock(rawCss, ".progress-unit-row");
  if (/(?:^|;|\s)border\s*:\s*(?:var\(--hairline\)|1px\s+solid)/m.test(unitSwimlaneBlock)) {
    violations.push(
      "[box-in-box] '.progress-unit-row' must be a borderless unit swimlane without a 4-sided border."
    );
  }

  // 4. DOM structure checks across rendered views
  if (/class="surface-panel"\s+id="progress-capability-portfolio"|id="progress-capability-portfolio"\s+class="surface-panel"/.test(views.progress)) {
    violations.push(
      "[box-in-box] '#progress-capability-portfolio' uses '.surface-panel' in Progress DOM."
    );
  }
  if (/<button[^>]*class="[^"]*progress-act-chip[^"]*"[^>]*>(?:(?!<\/button>)[\s\S])*?<svg/m.test(views.progress)) {
    violations.push(
      "[box-in-box] '.progress-act-chip' in Progress DOM contains a nested SVG checkbox glyph box."
    );
  }
  if (/<button[^>]*class="[^"]*progress-check-btn[^"]*btn-secondary/m.test(views.progress)) {
    violations.push(
      "[box-in-box] '.progress-check-btn' in Progress DOM uses bordered '.btn-secondary' box styling inside a capability row."
    );
  }
  if (/<button[^>]*class="[^"]*resource-usage-chip[^"]*"[^>]*>(?:(?!<\/button>)[\s\S])*?class="badge"/m.test(views.resources)) {
    violations.push(
      "[box-in-box] '.resource-usage-chip' in Resources DOM contains a nested '.badge' pill box."
    );
  }

  return violations;
}

function runLineAndHierarchyAudit(rawCss, views) {
  const violations = [];

  // 1. Line-Component Abuse: selectors that MUST NOT use horizontal divider borders
  const bannedHorizontalLineSelectors = [
    ".surface-panel",
    ".settings-section",
    ".sidebar-syllabi",
    ".matrix-table tbody tr + tr > *",
    ".today-unified-header",
    ".today-syllabus-brief",
    ".study-guide-prompt",
    ".today-syllabus-overview",
    ".progress-overview-strip",
    ".progress-unit-row",
    ".progress-capability-row",
    ".marketplace-filters",
    ".admin-resources-filters",
    ".facet-pair",
    ".marketplace-card-foot",
    ".intake-fit-tray",
    ".intake-controls-grid",
    ".intake-existing-plans-block"
  ];

  for (const sel of bannedHorizontalLineSelectors) {
    const block = extractCssBlock(rawCss, sel);
    if (!block) continue;
    const hasHorizontalLine =
      /border-(?:top|bottom|block|block-start|block-end)\s*:\s*(?:var\(--hairline\)|1px\s+solid)/m.test(block);
    if (hasHorizontalLine) {
      violations.push(
        `[line-abuse] '${sel}' uses a horizontal divider border instead of whitespace and spatial grouping.`
      );
    }
  }

  // Resources table header must not have a top border (only a single bottom baseline)
  const resourcesTheadBlock = extractCssBlock(rawCss, ".resources-data-table thead th");
  if (/border-block-start\s*:\s*(?:var\(--hairline\)|1px\s+solid)/m.test(resourcesTheadBlock)) {
    violations.push(
      "[line-abuse] '.resources-data-table thead th' has a top border ('border-block-start'), creating double horizontal lines."
    );
  }

  // Progress overview must not render horizontal progress bar lines
  if (/progress-overview-bar/.test(views.progress)) {
    violations.push(
      "[line-abuse] Progress DOM contains '.progress-overview-bar' horizontal bar lines."
    );
  }

  // 2. Hierarchy Distinction: Descriptions must be regular weight (400) and secondary ink, never primary ink or medium/bold weight
  const descriptionSelectors = [
    ".page-description",
    ".section-lede",
    ".plan-goal",
    ".today-syllabus-brief .plan-goal",
    ".today-syllabus-brief .plan-scope-list",
    ".progress-cap-description",
    ".resource-row-rationale"
  ];

  for (const sel of descriptionSelectors) {
    const block = extractCssBlock(rawCss, sel);
    if (!block) {
      violations.push(`[hierarchy-blur] Missing CSS rule for description selector '${sel}'.`);
      continue;
    }
    if (/color\s*:\s*var\(--color-text-primary\)/m.test(block) || !/color\s*:\s*var\(--color-text-secondary\)/m.test(block)) {
      violations.push(
        `[hierarchy-blur] Description '${sel}' must use 'color: var(--color-text-secondary)' so it does not compete with titles.`
      );
    }
    if (/font-weight\s*:\s*[567]00/m.test(block) || !/font-weight\s*:\s*400/m.test(block)) {
      violations.push(
        `[hierarchy-blur] Description '${sel}' must use 'font-weight: 400' so it is visually distinct from headings and titles.`
      );
    }
  }

  // 3. Structural indentation of Actual Contents under Unit Titles in Progress
  const unitCapBlock = extractCssBlock(rawCss, ".progress-unit-capabilities");
  if (!/padding-inline-start\s*:\s*(?:2[4-9]|3[0-9])px/m.test(unitCapBlock)) {
    violations.push(
      "[hierarchy-blur] '.progress-unit-capabilities' must use 'padding-inline-start' indentation so capabilities read as child contents of their Unit Title."
    );
  }

  if (!/class="page-description"/.test(views.progress) || !/class="[^"]*progress-cap-description/.test(views.progress)) {
    violations.push(
      "[hierarchy-blur] Progress DOM is missing explicit '.page-description' or '.progress-cap-description' elements."
    );
  }

  // 4. Zero-specificity base form resets so component inputs with leading/trailing icons never get clobbered
  if (/^input\[type="(?:text|email|search|password)"\]\s*,/m.test(rawCss)) {
    violations.push(
      "[cascade-collision] Top-level base 'input[type=\"...\"]' rules must be wrapped in ':where(...)' so zero-specificity defaults cannot override component input padding/backgrounds."
    );
  }
  const authInputBlock = extractCssBlock(rawCss, ".auth-input-wrap input");
  const authPassBlock = extractCssBlock(rawCss, ".auth-password-wrap input");
  if (!/padding-inline-start\s*:\s*(?:4[0-9]|5[0-9])px/m.test(authInputBlock)) {
    violations.push(
      "[cascade-collision] '.auth-input-wrap input' must keep >= 40px 'padding-inline-start' to clear its leading icon."
    );
  }
  if (
    !/padding-inline-start\s*:\s*(?:4[0-9]|5[0-9])px/m.test(authPassBlock) ||
    !/padding-inline-end\s*:\s*(?:4[4-9]|5[0-9])px/m.test(authPassBlock)
  ) {
    violations.push(
      "[cascade-collision] '.auth-password-wrap input' must keep >= 40px 'padding-inline-start' and >= 44px 'padding-inline-end' to clear its leading lock icon and trailing visibility button."
    );
  }

  return violations;
}

function main() {
  const rawCss = fs.readFileSync(stylesPath, "utf8");
  const resolvedCss = resolveCssVariables(rawCss);

  const root = { innerHTML: "" };
  const app = mountSyllabusWebApp(root);

  app.navigateTopLevel("Learn");
  app.navigateLearnSubDestination("Today");
  const todayHtml = app.renderHtml();

  app.navigateLearnSubDestination("Progress");
  const progressHtml = app.renderHtml();

  app.navigateLearnSubDestination("Resources");
  const resourcesHtml = app.renderHtml();

  app.navigateTopLevel("Explore");
  const exploreHtml = app.renderHtml();

  app.navigateTopLevel("Settings");
  const settingsHtml = app.renderHtml();

  app.applyUiAction("open-admin-resources");
  const adminHtml = app.renderHtml();

  const views = {
    today: todayHtml,
    progress: progressHtml,
    resources: resourcesHtml,
    explore: exploreHtml,
    settings: settingsHtml,
    admin: adminHtml
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syllabus-impeccable-gate-"));
  try {
    const htmlFiles = [];
    for (const [name, bodyHtml] of Object.entries(views)) {
      const filePath = path.join(tmpDir, `${name}.html`);
      fs.writeFileSync(
        filePath,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title><style>${resolvedCss}</style></head><body>${bodyHtml}</body></html>`
      );
      htmlFiles.push(filePath);
    }

    let detectRaw = "[]";
    try {
      detectRaw = execFileSync(
        impeccableBin,
        [
          "detect",
          "--no-config",
          "--json",
          ...htmlFiles,
          path.join(repoRoot, "apps/web/public/styles.css"),
          path.join(repoRoot, "apps/web/src/browserApp.ts"),
          path.join(repoRoot, "apps/web/src/components")
        ],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
      );
    } catch (err) {
      detectRaw = err.stdout || "[]";
    }

    const parsed = JSON.parse(detectRaw);
    const findings = Array.isArray(parsed) ? parsed : [];
    const boxViolations = runBoxInBoxAudit(rawCss, views);
    const hierarchyViolations = runLineAndHierarchyAudit(rawCss, views);
    const customViolations = [...boxViolations, ...hierarchyViolations];

    if (findings.length > 0 || customViolations.length > 0) {
      console.error("❌ Impeccable + Craft Gate Failed:");
      for (const f of findings) {
        console.error(
          `  [${f.severity}:${f.antipattern}] (${path.basename(f.file)}:${f.line}) ${f.snippet || f.name}`
        );
      }
      for (const v of customViolations) {
        console.error(`  ${v}`);
      }
      process.exit(1);
    }

    console.log(
      `✅ Impeccable + Craft Gate Passed: 6 rendered screens + source files scanned, 0 anti-patterns, 0 advisories, 0 box-in-box / line-abuse / hierarchy-blur violations.`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
