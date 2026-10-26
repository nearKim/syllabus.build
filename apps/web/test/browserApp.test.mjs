import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCurriculumSignalStore,
  createCurriculumWebAppController,
  curriculumTagsOf,
  getDialogLightDismissFallbackScript,
  mountCurriculumWebApp,
  renderCurriculumWebAppHtml,
} from "../src/index.ts";
import { createWebAppServer } from "../src/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");

// The Today study-flow board, from its section tag to the end of its table.
function todayBoard(html) {
  const start = html.indexOf('<section class="flow-board" aria-labelledby="flow-today-title"');
  assert.ok(start >= 0, "Today study-flow board is missing");
  return html.slice(start, html.indexOf("</table>", start));
}

function columnTitles(html) {
  const board = todayBoard(html);
  const head = board.slice(board.indexOf("<thead>"), board.indexOf("</thead>"));
  return [...head.matchAll(/<span class="colhead-title">([^<]+)<\/span>/g)].map((match) => match[1]);
}

function unitRow(html, moduleId) {
  const board = todayBoard(html);
  const start = board.search(new RegExp(`<tr class="study-card outline-module-card[^"]*" data-module-id="${moduleId}"`));
  assert.ok(start >= 0, `row for ${moduleId} is missing`);
  return board.slice(start, board.indexOf("</tr>", start));
}

// The activity drawer, from its dialog tag to its end.
function drawerOf(html) {
  const start = html.indexOf('<dialog id="learn-detail-inspector"');
  assert.ok(start >= 0, "activity drawer is missing");
  return html.slice(start, html.indexOf("</dialog>", start));
}

// A mounted app whose root records its listeners, so a test can click with a button's own data attributes
// (and the field values that click reads) and change a select to a value.
function mountWithClicks(initialState) {
  const listeners = {};
  const fields = {};
  const root = {
    innerHTML: "",
    addEventListener: (type, listener) => { listeners[type] = listener; },
    querySelector: (selector) => fields[selector] ?? null,
  };
  const app = mountCurriculumWebApp(root, initialState);
  const click = (dataset, values = {}) => {
    Object.assign(fields, values);
    listeners.click({ target: { closest: () => ({ dataset }) } });
  };
  const change = (value) => listeners.change({ target: { closest: () => ({ value }) } });
  // Submits a form by its data-action, with field values keyed by the selector the app reads them from.
  const submit = (action, values) => {
    Object.assign(fields, values);
    listeners.submit({ target: { closest: () => ({ dataset: { action } }) }, preventDefault: () => {} });
  };
  return { app, root, click, change, submit };
}

test("renderCurriculumWebAppHtml renders Section 9.3 navigation hierarchy, SVG DAG Map + Outline, MathML, opaque surfaces, and <dialog closedby='any'> modals", () => {
  const html = renderCurriculumWebAppHtml();

  // 1. Section 9.3 Top-Level Destinations & Learn Sub-Destinations
  for (const topDest of ["Learn", "Explore", "Settings"]) {
    assert.ok(
      html.includes(`data-action="navigate-top" data-destination="${topDest}"`),
      `Missing top-level destination button for ${topDest}`
    );
  }
  for (const subDest of ["Today", "Progress", "Resources"]) {
    assert.ok(
      html.includes(`data-action="navigate-learn-sub" data-sub-destination="${subDest}"`),
      `Missing Learn sub-destination button for ${subDest}`
    );
  }
  assert.equal(
    html.includes('data-action="navigate-learn-sub" data-sub-destination="Plan"'),
    false,
    "Plan tab is removed from the sidebar and consolidated into Today"
  );

  // 2. Today View: session cards, idempotent complete button, spaced-review separation
  assert.ok(html.includes('data-action="complete-activity"'));
  assert.ok(html.includes('data-review-separation-valid="true"'));
  assert.ok(html.includes('data-opaque-surface="true"'));

  // 3. Accessible MathML formula rendered on opaque surface, in the worked example's concept check
  const example = drawerOf(renderCurriculumWebAppHtml({ selectedActivityId: "activity-example", studyDetailOpen: true }));
  assert.ok(example.includes("<math"));
  assert.ok(example.includes('aria-label="Mathematical expression:'));

  // 4. Synchronized Plan Map (SVG DAG) & Outline
  assert.ok(html.includes('<svg class="plan-dag-svg"'));
  assert.ok(html.includes('<g class="map-node" tabindex="0"'));
  assert.ok(html.includes('<path class="map-edge"'));
  for (const ctrl of ["zoom_in", "zoom_out", "fit_view", "reset_focus"]) {
    assert.ok(
      html.includes(`data-map-control="${ctrl}"`),
      `Missing non-dragging map control ${ctrl}`
    );
  }
  assert.equal(html.includes("Prerequisite Bridge Warning"), false, "internal bridge jargon must not reach the UI");
  assert.ok(html.includes('data-action="activate-revision"'));
  assert.ok(html.includes('data-if-match="&quot;revision-attention-v2-etag&quot;"'));

  // 5. Progress View: 5 canonical objective proficiency statuses + Topic Diagnostic + Adaptation Diff dialog
  for (const status of [
    "unassessed",
    "self_reported",
    "in_progress",
    "needs_review",
    "demonstrated",
  ]) {
    assert.ok(
      html.includes(`data-proficiency-status="${status}"`),
      `Missing proficiency status ${status}`
    );
  }
  assert.ok(html.includes('data-diagnostic-session-id="diagnostic-synthetic-001"'));
  assert.ok(
    html.includes(
      '<dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title"'
    )
  );

  // 6. Resources View: publisher provenance, link_and_metadata_only rights badge, separate optional certification cost
  assert.ok(html.includes('data-rights-basis="link_and_metadata_only"'));
  assert.ok(html.includes('data-optional-certification="true"'));
  assert.ok(html.includes("Open ML Press (Curator Verified)"));

  // 7. Explore View: public template card, upvote button, Partial Adoption modal, Publication Preview modal
  assert.ok(html.includes('data-action="toggle-upvote"'));
  assert.ok(
    html.includes(
      '<dialog id="dialog-partial-adoption" closedby="any" aria-labelledby="dialog-partial-adoption-title"'
    )
  );
  assert.ok(
    html.includes(
      '<dialog id="dialog-publication-preview" closedby="any" aria-labelledby="dialog-publication-preview-title"'
    )
  );
  // Every dialog header closes with one icon button, not a text button.
  assert.equal(html.includes(">Close</button>"), false);
  assert.equal(
    html.match(/<button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close"><svg/g)?.length,
    html.match(/<header class="dialog-header">/g)?.length,
  );

  // 8. Navbar theme toggle + Settings View: BYOK providers table, Reminders, Account Deletion modal
  assert.ok(html.includes('class="navbar-theme-toggle" data-action="set-theme" data-theme-value="dark"'));
  for (const provider of ["openai", "anthropic", "google_gemini"]) {
    assert.ok(html.includes(`data-provider-id="${provider}"`));
  }
  assert.ok(
    html.includes(
      '<dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title"'
    )
  );

  // 9. Mandatory closedBy coordinate fallback script
  const fallbackScript = getDialogLightDismissFallbackScript();
  assert.ok(fallbackScript.includes("if (!('closedBy' in HTMLDialogElement.prototype))"));
  assert.ok(fallbackScript.includes("if (event.target !== dialog) return;"));
  assert.ok(fallbackScript.includes("dialog.getBoundingClientRect()"));
  assert.ok(fallbackScript.includes("dialog.close()"));
  assert.ok(html.includes("if (!('closedBy' in HTMLDialogElement.prototype))"));
});

test("apps/web/public/styles.css enforces dialog:modal and dialog::backdrop scroll containment without locking html/body overflow", () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");

  assert.match(css, /dialog:modal\s*\{[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(
    css,
    /dialog::backdrop\s*\{[^}]*overflow:\s*hidden;[^}]*overscroll-behavior:\s*contain;/s
  );

  // Ensure html/body are never locked with overflow: hidden or position: fixed
  assert.equal(/html\s*\{[^}]*overflow:\s*hidden/s.test(css), false);
  assert.equal(/body\s*\{[^}]*overflow:\s*hidden/s.test(css), false);
  assert.equal(/body\s*\{[^}]*position:\s*fixed/s.test(css), false);

  // Verify responsive breakpoints and accessibility media queries
  assert.ok(css.includes("@media (max-width: 767.98px)"));
  assert.ok(css.includes("@media (min-width: 768px) and (max-width: 1199.98px)"));
  assert.ok(css.includes("@media (min-width: 1200px)"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(css.includes("@media (prefers-reduced-transparency: reduce)"));
  assert.ok(css.includes("@media (forced-colors: active)"));
});

test("mountCurriculumWebApp and createCurriculumWebAppController deterministically update tabs, Plan Map/Outline selection, and idempotent Today progress", () => {
  const root = { innerHTML: "" };
  const app = mountCurriculumWebApp(root);

  assert.ok(root.innerHTML.includes('data-current-top-level="Learn"'));
  assert.ok(root.innerHTML.includes('data-current-learn-sub="Today"'));

  // 1. Switch to Plan -> Outline and select Module 2 ("module-attention")
  app.navigateLearnSubDestination("Plan");
  app.switchPlanView("Outline");
  app.selectPlanModule("module-attention", "Outline");
  const planHtml = app.renderHtml();

  assert.ok(planHtml.includes('data-current-learn-sub="Plan"'));
  assert.ok(planHtml.includes('data-current-plan-view="Outline"'));
  assert.ok(planHtml.includes('data-selected-module-id="module-attention"'));
  assert.ok(planHtml.includes('data-selected-activity-id="activity-quiz"'));

  // Both Map and Outline reflect the synchronized selection
  assert.ok(
    planHtml.includes('data-node-id="module-attention" data-node-kind="module" data-module-id="module-attention" data-selected="true"')
  );
  assert.ok(
    planHtml.includes('class="study-card outline-module-card is-selected" data-module-id="module-attention" data-selected="true"')
  );

  // 2. Record self-reported completion in Today view -> idempotent deduplication & honest two-layer status
  const receipt1 = app.recordTodayActivityCompletion("activity-theory", "evt-test-001");
  assert.equal(receipt1.deduplicated, false);
  assert.equal(receipt1.activityExecutionStatus, "self_reported_completed");
  assert.equal(receipt1.objectiveProficiencyDemonstrated, false);
  assert.equal(receipt1.selfReportedCompletedCount, 1);
  assert.equal(receipt1.totalStudyMinutes, 15);

  // Duplicate event_id does not double-count minutes or completions
  const receipt2 = app.recordTodayActivityCompletion("activity-theory", "evt-test-001");
  assert.equal(receipt2.deduplicated, true);
  assert.equal(receipt2.selfReportedCompletedCount, 1);
  assert.equal(receipt2.totalStudyMinutes, 15);

  const afterProgressHtml = app.renderHtml();
  assert.ok(afterProgressHtml.includes('data-study-minutes="15"'));
  assert.ok(afterProgressHtml.includes('data-self-reported-count="1"'));
  assert.ok(
    afterProgressHtml.includes(
      'data-activity-id="activity-theory" data-execution-status="self_reported_completed"'
    )
  );

  // 3. Switch top-level tabs to Explore and Settings
  app.navigateTopLevel("Explore");
  app.toggleUpvote();
  const exploreHtml = app.renderHtml();
  assert.ok(exploreHtml.includes('data-current-top-level="Explore"'));
  assert.ok(exploreHtml.includes('aria-pressed="true" aria-label="Upvote (15)"'));

  app.navigateTopLevel("Settings");
  app.setThemePreference("dark");
  const settingsHtml = app.renderHtml();
  assert.ok(settingsHtml.includes('data-current-top-level="Settings"'));
  assert.ok(settingsHtml.includes('data-theme="dark"'));
});

test("Study flow matrix follows the chosen flow order: theory_first vs application_first", () => {
  const theoryFirst = renderCurriculumWebAppHtml();
  assert.deepEqual(columnTitles(theoryFirst), ["Unit", "Lecture", "Deep Dive", "Code", "Review", "Gate"]);
  assert.ok(todayBoard(theoryFirst).includes('data-action="set-flow-order" data-flow-order="theory_first" aria-pressed="true"'));

  // The switches carry 1-2 word labels. The column headers already spell out the order.
  const head = todayBoard(theoryFirst).slice(0, todayBoard(theoryFirst).indexOf('<div class="matrix-stage">'));
  assert.deepEqual([...head.matchAll(/class="seg-btn"[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]), ["Theory", "Code first", "Balanced"]);
  assert.ok(head.includes('<button type="button" id="flow-today-deep-dive" class="flow-switch" role="switch" aria-checked="true" data-action="set-deep-dive" data-deep-dive="skipped">Deep Dive'));
  assert.ok(head.includes('<button type="button" id="flow-today-spaced-review" class="flow-switch" role="switch" aria-checked="true" data-action="set-spaced-review" data-spaced-review="compact">Review'));
  for (const old of ["Lecture → Deep Dive → Code → Gate", "Skipped (Time-saver)", "Balanced Flow", "Each row is one unit"]) {
    assert.equal(theoryFirst.includes(old), false, `old toolbar text is still rendered: ${old}`);
  }

  // Unit 1 reads Lecture -> Deep Dive -> Code -> Gate: three arrowheads, and the Review column is passed through.
  const unitOne = unitRow(theoryFirst, "module-foundations");
  assert.equal(unitOne.match(/data-seg="in" data-style="solid"/g)?.length, 3);
  assert.ok(unitOne.includes('<td class="flow-cell" data-track="review" data-empty="true"><svg class="matrix-svg" data-seg="through"'));
  assert.ok(unitOne.includes('class="gate-diamond" data-action="select-outline-module" data-module-id="module-foundations" data-status="passed"'));
  const order = ["activity-theory", "activity-example", "activity-coding"].map((id) => unitOne.indexOf(`data-activity-id="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  // Unit 2 connects its optional deep dive to its quiz gate with a dashed arrow and filled arrowhead.
  const unitTwo = unitRow(theoryFirst, "module-attention");
  assert.ok(unitTwo.includes('class="gate-diamond" data-action="select-outline-activity" data-activity-id="activity-quiz"'));
  assert.ok(unitTwo.includes('data-seg="in" data-style="dashed"'));
  assert.ok(unitTwo.includes('class="arrow-head"'));

  const codeFirst = renderCurriculumWebAppHtml({ flowOrder: "application_first" });
  assert.deepEqual(columnTitles(codeFirst), ["Unit", "Code", "Lecture", "Deep Dive", "Review", "Gate"]);
  const codeRow = unitRow(codeFirst, "module-foundations");
  assert.ok(codeRow.indexOf('data-activity-id="activity-coding"') < codeRow.indexOf('data-activity-id="activity-theory"'));

  assert.deepEqual(columnTitles(renderCurriculumWebAppHtml({ flowOrder: "balanced" })), ["Unit", "Lecture", "Code", "Deep Dive", "Review", "Gate"]);
});

test("Deep Dive and Review switches collapse columns without hiding required work", () => {
  const skipped = renderCurriculumWebAppHtml({ deepDive: "skipped" });
  assert.deepEqual(columnTitles(skipped), ["Unit", "Lecture", "Code", "Review", "Gate"]);
  const board = todayBoard(skipped);
  assert.equal(board.includes('data-activity-id="activity-reflection"'), false, "optional enrichment should be hidden");
  // The required worked example moves into the Lecture column after the theory reading.
  const lectureCell = unitRow(skipped, "module-foundations").match(/<td class="flow-cell" data-track="lecture".*?<\/td>/s)?.[0] ?? "";
  assert.ok(lectureCell.indexOf('data-activity-id="activity-theory"') < lectureCell.indexOf('data-activity-id="activity-example"'));
  assert.ok(board.includes("Deep Dive off hides 1 optional deep dive (15 min). Required deep dives stay in the Lecture column."));
  // An off switch offers the value that turns it back on.
  assert.ok(board.includes('role="switch" aria-checked="false" data-action="set-deep-dive" data-deep-dive="included">Deep Dive'));

  const compact = renderCurriculumWebAppHtml({ spacedReview: "compact" });
  assert.deepEqual(columnTitles(compact), ["Unit", "Lecture", "Deep Dive", "Code", "Gate"]);
  assert.ok(todayBoard(compact).includes('role="switch" aria-checked="false" data-action="set-spaced-review" data-spaced-review="included">Review'));
  const gateCell = unitRow(compact, "module-attention").match(/<td class="flow-cell" data-track="gate".*?<\/td>/s)?.[0] ?? "";
  assert.ok(gateCell.includes('data-activity-id="activity-review"'), "compact reviews stay visible under the gate");

  // The same switches drive the mounted app, and unknown values are rejected at the boundary.
  const root = { innerHTML: "" };
  const app = mountCurriculumWebApp(root);
  assert.equal(app.applyUiAction("set-flow-order", { flowOrder: "application_first" }).handled, true);
  assert.equal(app.applyUiAction("set-deep-dive", { deepDive: "skipped" }).handled, true);
  assert.deepEqual(columnTitles(root.innerHTML), ["Unit", "Code", "Lecture", "Review", "Gate"]);
  assert.equal(app.applyUiAction("set-flow-order", { flowOrder: "sideways" }).handled, false);
  assert.equal(app.getState().flowOrder, "application_first");
  app.applyUiAction("set-deep-dive", { deepDive: "included" });
  app.applyUiAction("set-flow-order", { flowOrder: "theory_first" });
  assert.deepEqual(columnTitles(root.innerHTML), ["Unit", "Lecture", "Deep Dive", "Code", "Review", "Gate"]);
});

test("Today opens with the active curricula queue, then the focused curriculum header attached directly to its Study flow", () => {
  const html = renderCurriculumWebAppHtml();
  const today = html.slice(html.indexOf('id="panel-learn-today"'), html.indexOf('id="panel-learn-plan"'));
  const plan = html.slice(html.indexOf('id="panel-learn-plan"'), html.indexOf('id="panel-learn-progress"'));
  for (const removed of ["Next session", "In this session", "Why this is next", 'class="macro-stage"', 'class="status-banner"', 'class="today-next"', '<details class="today-curriculum-overview">']) {
    assert.equal(today.includes(removed), false, `Today still renders ${removed}`);
  }
  assert.equal(plan.includes('class="macro-stage"'), false, "Plan still renders the unit strip");

  // Today opens directly with the focused curriculum Study flow workspace above the fold (no redundant Today heading in the body), with New curriculum in the sidebar and Share with Community in the curriculum header.
  assert.match(
    today,
    /^id="panel-learn-today"[^>]*>\s*<div class="today-active-workspace">[\s\S]*?<section class="today-curricula-grid" aria-label="Active curricula"[^>]*>/,
  );
  assert.equal(today.includes('<h1 class="page-title">Today</h1>'), false, "Today body should not repeat the redundant Today heading");
  assert.match(html, /class="sidebar-new-curriculum-btn"[^>]*data-dialog-id="dialog-new-curriculum"/);
  const card = today.match(/<header class="today-unified-header" data-opaque-surface="true">([\s\S]*?)<\/header>\s*<section class="flow-board"/)?.[1];
  assert.ok(card, "the focused curriculum header must sit directly above its Study flow board");
  for (const part of [
    '<h1 class="page-title today-selected-title">Build and Evaluate RAG Systems in Python</h1>',
    '<span class="today-selected-progress">0/5 completed · 83m left</span>',
    'class="btn-ghost-share" data-action="open-dialog" data-dialog-id="dialog-publication-preview"',
    '<select id="selected-plan-control" class="plan-command-select" name="selected-plan" data-action="select-curriculum" data-tom-select="plan">',
    '<option value="__new_curriculum__" data-action-option="new-curriculum"',
  ]) {
    assert.ok(card.includes(part), `the header card is missing ${part}`);
  }

  // Instead of a redundant Next/Resume bar in the header, the next-up activity node in Study flow carries data-next-up="true".
  const board = todayBoard(html);
  assert.match(board, /<article class="node-card" data-activity-id="activity-theory"[^>]*data-next-up="true">/);

  // With every scheduled activity closed, no node is marked next-up and progress shows 5/5 completed.
  const allDone = Object.fromEntries(["activity-theory", "activity-example", "activity-coding", "activity-quiz", "activity-review", "activity-reflection"].map((id) => [id, "completed"]));
  const finished = renderCurriculumWebAppHtml({ activityStates: allDone });
  const finishedStart = finished.indexOf('<header class="today-unified-header"');
  const finishedCard = finished.slice(finishedStart, finished.indexOf("</header>", finishedStart));
  assert.ok(finishedCard.includes('<span class="today-selected-progress">5/5 completed</span>'));
  assert.equal(todayBoard(finished).includes('data-next-up="true"'), false);
});

test("flowchart cards keep one shape in every order: title, duration, optional mark, and check only", () => {
  const orders = ["theory_first", "application_first", "balanced"].map((flowOrder) => renderCurriculumWebAppHtml({ flowOrder }));
  const cardOf = (html, id) => todayBoard(html).match(new RegExp(`<article class="node-card" data-activity-id="${id}"[\\s\\S]*?</article>`))?.[0];
  for (const id of ["activity-theory", "activity-example", "activity-coding", "activity-review", "activity-reflection"]) {
    const [theory, codeFirst, balanced] = orders.map((html) => cardOf(html, id));
    assert.ok(theory, `${id} card is missing`);
    assert.equal(codeFirst, theory, `${id} card changes in Code first`);
    assert.equal(balanced, theory, `${id} card changes in Balanced`);
  }
  // Switching the order adds no text: no track label, hint, or note.
  for (const html of orders) {
    assert.equal(/node-badge|node-hint|class="flow-note"|Needs [A-Za-z ]+ first|After the gate|Scheduled revisit/.test(todayBoard(html)), false);
  }

  const parts = (card) => [...card.matchAll(/class="(node-[a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(parts(cardOf(orders[0], "activity-reflection")), ["node-card", "node-open", "node-title", "node-foot", "node-duration", "node-optional", "node-check"]);
  assert.deepEqual(parts(cardOf(orders[0], "activity-theory")), ["node-card", "node-open", "node-title", "node-foot", "node-duration", "node-check"]);
  assert.ok(cardOf(orders[0], "activity-theory").includes('<span class="node-duration">15m</span></span>'));

  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  assert.match(css, /\.matrix-table\s*\{[^}]*--node-min:\s*96px;/s);
  assert.match(css, /\.node-card\s*\{[^}]*width:\s*100%;\s*height:\s*var\(--node-min,\s*96px\);\s*min-height:\s*var\(--node-min,\s*96px\);\s*max-height:\s*var\(--node-min,\s*96px\);/s);
  assert.match(css, /\.node-open\s*\{[^}]*flex-direction:\s*column;\s*justify-content:\s*space-between;[^}]*height:\s*calc\(var\(--node-min,\s*96px\)\s*-\s*2px\);/s);
  assert.match(css, /\.node-title\s*\{[^}]*-webkit-line-clamp:\s*3;/s);
  assert.equal(/\.col-gate\s*\{/.test(css), false, "the gate column must be as wide as the track columns");
});

test("the drawer leads with the material and plain guidance, without jargon or a list of neighbors", () => {
  const drawerFor = (activityId, moduleId, extra = {}) =>
    drawerOf(renderCurriculumWebAppHtml({ selectedActivityId: activityId, selectedModuleId: moduleId, studyDetailOpen: true, ...extra }));
  const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const theory = drawerFor("activity-theory", "module-foundations");
  const coding = drawerFor("activity-coding", "module-foundations");
  const quiz = drawerFor("activity-quiz", "module-attention");

  // Objective proficiency appears on the gate only, and the old controls are gone.
  for (const drawer of [theory, coding]) assert.equal(/Unassessed|Demonstrated/i.test(visible(drawer)), false);
  assert.match(quiz, /<span class="proficiency-pill" data-proficiency-status="unassessed">[\s\S]*?Unassessed<\/span>/);
  assert.equal(/Study ahead|Prerequisite Bridge|class="status-toggle"|class="dep-flow"|Why this is next/.test(theory + coding + quiz), false);

  // The source card says what the material is and where it lives, and opens it in one click.
  const source = theory.match(/<section class="source-card"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(source.includes('class="source-title">Reviewed Open Monograph: Subword Tokenization &amp; Sequence Packing</h3>'));
  assert.ok(source.includes('<p class="source-publisher">Open ML Press (Curator Verified)</p>'));
  assert.ok(source.includes('<a href="https://example.invalid/catalog/tokenization-monograph" target="_blank" rel="noopener noreferrer">catalog/tokenization-monograph</a>'));
  assert.ok(source.includes('<p class="source-section">Section 2.1: Byte-Pair Encoding Merge Tables</p>'));
  assert.deepEqual([...source.matchAll(/<li>([^<]+)<\/li>/g)].map((match) => match[1]), ["Free", "External link"]);
  assert.match(source, /<a class="btn-primary source-open" href="https:\/\/example\.invalid\/catalog\/tokenization-monograph" target="_blank" rel="noopener noreferrer">Open Study Material<span aria-hidden="true">↗<\/span>/);
  assert.equal(drawerFor("activity-review", "module-attention").includes('class="source-card"'), false, "no card without material");

  // The drawer states what the step builds. Narrow screens add previous and next buttons, hidden at 872px and up.
  assert.match(theory, /<h3 id="learn-detail-inspector-focus">What this builds<\/h3>[\s\S]*?Analyze BPE and Unigram tokenization sequence lengths[\s\S]*?Prepares for: Unit 1 Gate/);
  assert.match(quiz, /<h3 id="learn-detail-inspector-focus">What this checks<\/h3>/);
  const nav = coding.match(/<nav class="mobile-step-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.match(nav, /data-action="select-outline-activity" data-activity-id="activity-example"[^>]*>[\s\S]*?Prev: Worked Example/);
  assert.match(nav, /data-action="select-outline-activity" data-activity-id="activity-quiz"[^>]*>[\s\S]*?Next: Formative Checkpoint/);
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  assert.match(css, /@media \(min-width: 872px\)\s*\{\s*\.mobile-step-nav\s*\{\s*display:\s*none;/);

  // An earlier step that is not done is one click away. A mastery gate says required instead of recommended.
  assert.match(coding, /Recommended first:<\/p>\s*<button type="button" class="first-step" data-action="select-outline-activity" data-activity-id="activity-example"/);
  assert.equal(drawerFor("activity-coding", "module-foundations", { activityStates: { "activity-example": "self_reported_completed" } }).includes("Recommended first"), false);
  assert.match(quiz, /Required first:<\/p>\s*<button type="button" class="first-step" data-action="select-outline-activity" data-activity-id="activity-coding"/);
});

test("Today has no detached Study block, and the drawer ends worked examples, quizzes, and reviews with the plan's concept check", () => {
  const html = renderCurriculumWebAppHtml();
  const today = html.slice(html.indexOf('id="panel-learn-today"'), html.indexOf('id="panel-learn-plan"'));
  const progress = html.slice(html.indexOf('id="panel-learn-progress"'), html.indexOf('id="panel-learn-resources"'));
  assert.equal(/id="study-workspace"|<h2>Study<\/h2>|Two-Layer|data-action="submit-practice"/.test(today), false, "Today still renders the detached Study block");
  const audit = progress.match(/<details class="today-curriculum-overview evidence-technical-details">[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.ok(audit.includes("<h3>Honest Two-Layer Status Summary</h3>"), "the status summary sits in the Progress audit disclosure");

  const drawerFor = (selectedActivityId, extra = {}) => drawerOf(renderCurriculumWebAppHtml({ selectedActivityId, studyDetailOpen: true, ...extra }));
  const checkOf = (drawer) => drawer.match(/<section id="study-workspace" class="inspector-section study-workspace"[\s\S]*?<\/section>/)?.[0] ?? "";
  const legendOf = (check) => check.match(/<legend>([^<]+)<\/legend>/)?.[1];

  for (const id of ["activity-example", "activity-quiz", "activity-review"]) {
    const check = checkOf(drawerFor(id));
    assert.ok(check.includes('<h3 id="learn-detail-inspector-check">Concept check</h3>'), `${id} has no concept check`);
    assert.match(check, /<div class="math-formula-surface" data-opaque-surface="true"><math [^>]*aria-label="Mathematical expression: Attention/);
    assert.equal(legendOf(check), "Which statement matches the scaling term?");
    assert.equal(check.match(/<input type="radio"[^>]*name="practice-choice"/g)?.length, 3);
    for (const action of ["request-hint", "study-worked-solution", "submit-practice"]) assert.ok(check.includes(`data-action="${action}"`), `${id} has no ${action}`);
  }
  for (const id of ["activity-theory", "activity-coding"]) assert.equal(checkOf(drawerFor(id)), "", `${id} has a concept check`);

  // Each plan asks its own question. A plan checked by a rubric has no formula and no concept check.
  const linear = checkOf(drawerFor("la-example-projection", { selectedCurriculumId: "curriculum-linear-algebra-002" }));
  assert.equal(legendOf(linear), "Why does a real symmetric matrix A admit an orthogonal eigenbasis Q?");
  assert.ok(linear.includes("<mi>Λ</mi>"), "the spectral theorem formula renders its Lambda");
  for (const id of ["tl-close-austerlitz", "tl-gate-war-and-peace", "tl-review-war-and-peace"]) {
    assert.equal(checkOf(drawerFor(id, { selectedCurriculumId: "curriculum-tolstoy-lit-003" })), "", `${id} has a concept check`);
  }
  const adopted = (publicationId, moduleId, activityId) => checkOf(drawerFor(activityId, {
    adoptions: [{ accountId: "learner-default", publicationId, moduleIds: [moduleId], active: true }], selectedCurriculumId: `adopted-${publicationId}`,
  }));
  assert.equal(legendOf(adopted("publication-statmech-001", "sm-module-ensembles", "sm-example-two-level")), "What does the partition function Z do in the Boltzmann distribution?");
  assert.equal(legendOf(adopted("publication-rust-async-001", "rs-module-futures", "rs-example-waker")), "What must a future do before its poll returns Poll::Pending?");

  // Hint and worked solution keep the chosen answer. Submit names it. Another activity or plan starts the check fresh.
  const { app, root, click, change } = mountWithClicks({ selectedActivityId: "activity-example", studyDetailOpen: true });
  const live = () => checkOf(drawerOf(root.innerHTML));
  const practiceOf = ({ hintRequested, workedSolutionRevealed, practiceSubmitted, practiceChoice }) => ({ hintRequested, workedSolutionRevealed, practiceSubmitted, practiceChoice });
  const fresh = { hintRequested: false, workedSolutionRevealed: false, practiceSubmitted: false, practiceChoice: null };
  click({ action: "submit-practice" });
  assert.ok(live().includes("Choose an answer, then select Submit."));
  const chosen = { 'input[name="practice-choice"]:checked': { value: "variance" } };
  click({ action: "request-hint" }, chosen);
  assert.ok(live().includes('value="variance" checked'));
  assert.match(live(), /<strong>Hint\.<\/strong> Suppose the entries of q and k are independent/);
  click({ action: "study-worked-solution" }, { 'input[name="practice-choice"]:checked': null });
  assert.ok(live().includes('value="variance" checked'), "the worked solution keeps the chosen answer");
  assert.match(live(), /<strong>Worked solution\.<\/strong> The dot product q·k has variance d_k\./);
  click({ action: "submit-practice" }, chosen);
  assert.ok(live().includes("Answer submitted: It keeps the variance of each dot-product score near 1 as d_k grows."));
  assert.deepEqual(practiceOf(app.getState()), { hintRequested: true, workedSolutionRevealed: true, practiceSubmitted: true, practiceChoice: "variance" });

  click({ action: "select-outline-activity", activityId: "activity-quiz", moduleId: "module-attention" });
  assert.deepEqual(practiceOf(app.getState()), fresh);
  assert.equal(/practice-note|practice-feedback| checked/.test(live()), false);
  click({ action: "request-hint" }, chosen);
  change("curriculum-linear-algebra-002");
  assert.deepEqual(practiceOf(app.getState()), fresh);
});

test("the status control sets three states, celebrates Done, and then offers the next step", () => {
  const { root, click } = mountWithClicks({ selectedActivityId: "activity-theory", studyDetailOpen: true });
  const drawer = () => drawerOf(root.innerHTML);
  const control = () => drawer().match(/<div class="segmented status-control" role="group" aria-label="Activity status">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const pressed = () => [...control().matchAll(/aria-pressed="true">([^<]+)</g)].map((match) => match[1]);
  assert.deepEqual([...control().matchAll(/data-action="set-activity-status" data-activity-id="activity-theory" data-status="([a-z_]+)"/g)].map((match) => match[1]), ["not_started", "in_progress", "completed"]);
  assert.deepEqual(pressed(), ["Not started"]);
  assert.match(drawer(), /<button type="button" class="btn-primary" data-action="complete-activity" data-activity-id="activity-theory"[^>]*>Mark as Done<span aria-hidden="true">✓<\/span>/);
  assert.equal(drawer().includes("status-celebration"), false);

  click({ action: "set-activity-status", activityId: "activity-theory", status: "in_progress" });
  assert.deepEqual(pressed(), ["In progress"]);
  assert.ok(root.innerHTML.includes('data-activity-id="activity-theory" data-execution-status="in_progress"'));
  assert.ok(drawer().includes(">Mark as Done<"));

  click({ action: "set-activity-status", activityId: "activity-theory", status: "completed" });
  assert.deepEqual(pressed(), ["Done"]);
  assert.match(control(), /class="seg-btn status-celebration" data-action="set-activity-status" data-activity-id="activity-theory" data-status="completed" aria-pressed="true"/);
  assert.ok(root.innerHTML.includes('data-self-reported-count="1"') && root.innerHTML.includes('data-study-minutes="15"'));
  const next = drawer().match(/<button type="button" class="btn-primary next-step" data-action="([^"]+)" data-activity-id="([^"]+)" data-module-id="([^"]+)"><span class="next-step-text">Go to next step: Worked Example: Attention Scaling Factor <span class="math-inline" data-opaque-surface="true" data-latex="\\frac\{1\}\{\\sqrt\{d_k\}\}"><math [\s\S]*?<\/math><\/span><\/span><span aria-hidden="true">→<\/span><\/button>/);
  assert.ok(next, "Done turns the primary button into the next step");
  assert.equal(drawer().includes(">Mark as Done<"), false);

  // Going back to Not started removes the self-reported completion and its minutes.
  click({ action: "set-activity-status", activityId: "activity-theory", status: "not_started" });
  assert.deepEqual(pressed(), ["Not started"]);
  assert.ok(root.innerHTML.includes('data-self-reported-count="0"') && root.innerHTML.includes('data-study-minutes="0"'));
  // An unknown status is rejected at the boundary.
  click({ action: "set-activity-status", activityId: "activity-theory", status: "finished" });
  assert.deepEqual(pressed(), ["Not started"]);

  // The card checkbox still completes through complete-activity, and Go to next step opens that step.
  click({ action: "complete-activity", activityId: "activity-theory", eventId: "evt-complete-activity-theory" });
  assert.deepEqual(pressed(), ["Done"]);
  const go = drawer().match(/class="btn-primary next-step" data-action="([^"]+)" data-activity-id="([^"]+)" data-module-id="([^"]+)"/);
  click({ action: go[1], activityId: go[2], moduleId: go[3] });
  assert.match(drawer(), />Worked Example: Attention Scaling Factor <span class="math-inline" data-opaque-surface="true" data-latex="\\frac\{1\}\{\\sqrt\{d_k\}\}"><math [\s\S]*?<\/math><\/span><\/h2>/);
  assert.ok(drawer().includes('data-open="true"'));

  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.status-celebration\s*\{[^}]*animation:\s*status-ring/);
});

test("a coding activity's drawer is a lab sheet: brief, specs, checklist, then the lab specification", () => {
  const lab = drawerOf(renderCurriculumWebAppHtml({ selectedActivityId: "activity-coding", studyDetailOpen: true }));
  const section = (id) => lab.match(new RegExp(`<section class="inspector-section[^"]*" aria-labelledby="learn-detail-inspector-${id}">([\\s\\S]*?)</section>`))?.[1] ?? "";
  assert.match(section("brief"), /Deliverable brief[\s\S]*Run the external test suite to verify lossless UTF-8 round-trip encoding\.[\s\S]*<li>A reversible tokenizer and a tensor shape validator/);
  assert.deepEqual([...section("specs").matchAll(/<span>([^<]+)<\/span><\/li>/g)].map((match) => match[1]), ["25 min (19–38 min)", "Formal", "Required", "Local or external IDE"]);
  assert.ok(section("checks").includes("Accurately compare token counts and out-of-vocabulary behavior across two unseen text samples."));
  assert.match(lab, /<section class="source-card"[\s\S]*?>Open Lab Specification<span aria-hidden="true">↗<\/span>/);
  assert.ok(lab.includes("Optional certificate $49.00"), "a paid option stays visible before the learner leaves");
  const order = ["brief", "specs", "checks"].map((id) => lab.indexOf(`aria-labelledby="learn-detail-inspector-${id}"`)).concat(lab.indexOf('class="source-card"'));
  assert.ok(order.every((at) => at >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(lab.includes('<table class="meta-table">'), false, "the lab sheet shows its specs as chips");

  // A reading activity keeps the plain details table and has no lab sections.
  const reading = drawerOf(renderCurriculumWebAppHtml({ selectedActivityId: "activity-theory", studyDetailOpen: true }));
  assert.equal(/Deliverable brief|Verification checklist|Open Lab Specification/.test(reading), false);
  assert.ok(reading.includes('<table class="meta-table">'));

  // Rigor is the plan's math depth, and a topic override wins over it.
  const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../specs/001-curriculum-platform/examples/curriculum.synthetic.json"), "utf8"));
  const rigor = (curriculum) => drawerOf(renderCurriculumWebAppHtml({ curriculum })).match(/Rigor<\/span><\/th><td>([^<]+)<\/td>/)?.[1];
  assert.equal(rigor(example), "Applied");
  const overridden = { ...example, instruction_preferences_applied: { ...example.instruction_preferences_applied, topic_math_depth_overrides: [{ topic_id: "topic-tokenization", math_depth: "formal" }] } };
  assert.equal(rigor(overridden), "Formal");
});

test("Study flow is a flat unboxed workspace while curriculumswitcher cards use clean surface cards", () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  // Every declaration block whose selector list ends with this selector.
  const rule = (selector) => [...css.matchAll(new RegExp(`\\n${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`, "g"))].map((match) => match[1]).join("");
  assert.ok(rule(".flow-board").includes("border: 0;"), ".flow-board must not have an outer border box");
  assert.ok(rule(".flow-board").includes("background: transparent;"), ".flow-board must have a transparent background");
  for (const selector of [".today-bottom-grid", ".curriculum-card"]) {
    for (const declaration of ["padding: var(--space-5);", "border: var(--hairline);", "border-radius: var(--radius-surface);", "background: var(--color-surface);"]) {
      assert.ok(rule(selector).includes(declaration), `${selector} is missing ${declaration}`);
    }
  }
  assert.ok(rule(".flow-head").includes("margin: 0 0 var(--space-4);"), "the Study flow header bar is missing margin: 0 0 var(--space-4);");
  assert.equal(rule(".flow-head").includes("border-bottom"), false, "the Study flow header bar must not duplicate the column header underline");
  for (const declaration of ["padding: var(--space-4);", "border-radius: var(--radius-control);", "background: var(--color-surface-secondary);"]) {
    assert.ok(rule(".empty-state").includes(declaration), `the empty state is missing ${declaration}`);
  }

  // Both lists share one card. Each heading carries a count, and an empty list shows a quiet box with an icon.
  const html = renderCurriculumWebAppHtml();
  const bottom = html.match(/<section class="today-bottom-grid"[^>]*>([\s\S]*?)<\/section>\s*<section class="today-curricula-grid"/)?.[1] ?? "";
  assert.ok(bottom.includes('<h2 id="review-queue-title">Review queue <span class="count-badge">1</span></h2>'));
  assert.ok(bottom.includes('<h2 id="completed-history-title">Completed work <span class="count-badge">0</span></h2>'));
  assert.ok(bottom.includes('<li class="today-activity-item step-row" data-activity-id="activity-review"'));
  assert.match(bottom, /<p class="empty-state"><svg class="sf-icon"[\s\S]*?<\/svg><span>No self-reported completions yet\.<\/span><\/p>/);
  const done = renderCurriculumWebAppHtml({ activityStates: { "activity-theory": "self_reported_completed" } });
  assert.ok(done.includes('Completed work <span class="count-badge">1</span>'));
  assert.equal(done.includes("No self-reported completions yet."), false);
});

test("Today queues every active plan, and the select, Resume, and Open Plan switch to one", () => {
  const ids = ["curriculum-rag-python-001", "curriculum-linear-algebra-002", "curriculum-tolstoy-lit-003"];
  const html = renderCurriculumWebAppHtml();
  const select = html.match(/<select id="selected-plan-control"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]), [...ids, "__new_curriculum__"]);
  assert.match(select, /<option value="curriculum-rag-python-001"[^>]*selected>Build and Evaluate RAG Systems in Python<\/option>/);

  const cardsOf = (page) => [...(page.match(/<section class="today-curricula-grid"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "").matchAll(/<article class="curriculum-card" data-curriculum-id="([^"]+)"[\s\S]*?<\/article>/g)];
  const text = (card) => card.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const cards = cardsOf(html);
  assert.deepEqual(cards.map((match) => match[1]), ids);
  assert.deepEqual(cards.map(([card]) => card.match(/<p class="domain-pill">([^<]+)<\/p>/)?.[1]), ["Engineering · Reviewed Quiz", "Mathematics · Public Quiz Bank", "Literature · Self-Check Rubric"]);
  assert.equal(text(cards[0][0]), "Engineering · Reviewed Quiz Build and Evaluate RAG Systems in Python Upcoming session: 0/3 completed · 65m left Read Subword Tokenization &amp; Sequence Packing Notes 15m Lecture Resume →");
  assert.ok(cards[0][0].includes('aria-current="true"') && !cards[1][0].includes("aria-current"), "only the selected plan's card is marked");
  assert.equal(cards[0][0].includes('class="macro-bar"'), false, "curriculum cards omit the redundant progress bar rule");

  // Each plan counts only its own progress.
  const { app, root, click, change } = mountWithClicks();
  assert.equal(app.getState().selectedCurriculumId, "curriculum-rag-python-001");
  click({ action: "complete-activity", activityId: "activity-theory", eventId: "evt-complete-activity-theory" });
  assert.match(text(cardsOf(root.innerHTML)[0][0]), /1\/3 completed · 50m left Worked Example/);
  assert.match(text(cardsOf(root.innerHTML)[1][0]), /0\/3 completed · 65m left/);

  // The select switches Today's header and Study flow to that plan, and the other plan keeps its progress.
  change("curriculum-linear-algebra-002");
  assert.match(root.innerHTML, /<option value="curriculum-linear-algebra-002"[^>]*selected>Linear Algebra &amp; Spectral Methods<\/option>/);
  assert.ok(todayBoard(root.innerHTML).includes('<span class="unit-title">Eigenvalues &amp; Orthogonal Projections</span>'));
  assert.match(text(cardsOf(root.innerHTML)[0][0]), /1\/3 completed · 50m left/);
  assert.ok(root.innerHTML.includes('data-study-minutes="15"'));

  // Selecting __edit_plan__ in the consolidated picker navigates to Plan.
  change("__edit_plan__");
  assert.ok(root.innerHTML.includes('data-current-learn-sub="Plan"'));
  app.navigateLearnSubDestination("Today");

  // Resume on a card selects that plan and opens its next activity in the drawer.
  const resume = cardsOf(root.innerHTML)[2][0].match(/data-action="(resume-curriculum)" data-curriculum-id="([^"]+)" data-activity-id="([^"]+)" data-module-id="([^"]+)"/);
  click({ action: resume[1], curriculumId: resume[2], activityId: resume[3], moduleId: resume[4] });
  assert.equal(app.getState().selectedCurriculumId, "curriculum-tolstoy-lit-003");
  assert.ok(drawerOf(root.innerHTML).includes(">Read War and Peace: Book Three and the Opening of Book Nine</h2>"));
  assert.ok(drawerOf(root.innerHTML).includes('data-open="true"'));

  // Open Plan selects that plan and shows its Plan page. An unknown plan id is rejected.
  click({ action: "open-curriculum-plan", curriculumId: "curriculum-linear-algebra-002" });
  assert.ok(root.innerHTML.includes('data-current-learn-sub="Plan"') && root.innerHTML.includes('data-selected-module-id="la-module-spectral"'));
  assert.match(root.innerHTML, /class="plan-switch" data-action="select-curriculum" data-curriculum-id="curriculum-linear-algebra-002" aria-current="true"/);
  assert.ok(root.innerHTML.includes('<h1 class="page-title plan-title">Linear Algebra &amp; Spectral Methods</h1>'));
  click({ action: "select-curriculum", curriculumId: "curriculum-unknown" });
  assert.equal(app.getState().selectedCurriculumId, "curriculum-linear-algebra-002");
});

test("a plan with no public quiz bank gates on a self-check rubric in the drawer", () => {
  const { root, click, change } = mountWithClicks();
  change("curriculum-tolstoy-lit-003");
  assert.deepEqual(columnTitles(root.innerHTML), ["Unit", "Lecture", "Deep Dive", "Review", "Gate"], "a reading plan has no empty Code column");
  const gate = todayBoard(root.innerHTML).match(/class="gate-diamond" data-action="(select-outline-activity)" data-activity-id="(tl-gate-war-and-peace)" data-module-id="([^"]+)"/);
  assert.ok(gate, "the War and Peace gate is on the Study flow");
  click({ action: gate[1], activityId: gate[2], moduleId: gate[3] });

  const rubricOf = (drawer) => drawer.match(/<section class="inspector-section rubric-block"[\s\S]*?<\/section>/)?.[0] ?? "";
  const rubric = rubricOf(drawerOf(root.innerHTML));
  assert.ok(rubric.includes('<h3 id="learn-detail-inspector-rubric">Synthesis &amp; Self-Check Rubric</h3>'));
  assert.ok(rubric.includes('<p class="rubric-mode">Self-Evaluated Rubric · No public quiz bank for this topic</p>'));
  assert.match(rubric, /<p class="rubric-prompt">Compare Prince Andrei's disillusionment at Austerlitz[\s\S]*?hedgehog and fox framework applies\.<\/p>/);
  assert.equal(rubric.match(/<li>/g)?.length, 3);
  assert.ok(drawerOf(root.innerHTML).includes('<span class="proficiency-pill" data-proficiency-status="unassessed">'));

  // The review revisits the same rubric. A gate backed by a quiz bank shows none.
  const drawerFor = (selectedCurriculumId, selectedActivityId) => drawerOf(renderCurriculumWebAppHtml({ selectedCurriculumId, selectedActivityId, studyDetailOpen: true }));
  assert.ok(rubricOf(drawerFor("curriculum-tolstoy-lit-003", "tl-review-war-and-peace")).includes("Book Nine"));
  assert.ok(rubricOf(drawerFor("curriculum-tolstoy-lit-003", "tl-gate-anna-karenina")).includes("Part Seven"));
  assert.equal(rubricOf(drawerFor("curriculum-linear-algebra-002", "la-gate-spectral")), "");
  assert.equal(rubricOf(drawerFor("curriculum-rag-python-001", "activity-quiz")), "");
  // An activity in a later unit opens without its module being named.
  assert.ok(drawerFor("curriculum-rag-python-001", "activity-quiz").includes(">Formative Checkpoint: Tokenization &amp; Attention Shapes</h2>"));
});

// Explore helpers. A listing card by publication id, the card titles in order, and the buttons in a part of the page
// with their visible label and the data attributes a click sends.
const cardOf = (html, id) => html.match(new RegExp(`<article class="marketplace-card public-template-card" data-publication-id="${id}"[\\s\\S]*?</article>`))?.[0] ?? "";
const titlesOf = (html) => [...html.matchAll(/class="marketplace-title">([^<]+)</g)].map((match) => match[1]);
const decode = (text) => text.replaceAll("&amp;", "&").trim();
function buttonsIn(part) {
  return [...part.replace(/<svg[\s\S]*?<\/svg>/g, "").matchAll(/<button([^>]*)>([^<]+)(?:<span class="tag-count">(\d+)<\/span>)?/g)].map(([, attrs, label, count]) => ({
    label: decode(label),
    count,
    pressed: attrs.includes('aria-pressed="true"'),
    disabled: / disabled(?=[ >]|$)/.test(attrs),
    data: Object.fromEntries([...attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), decode(value)])),
  }));
}
// One filter row of the Explore panel, by facet.
const facetRowOf = (html, facet) => html.match(new RegExp(`<div class="facet-row"[^>]*aria-labelledby="facet-${facet}-label">[\\s\\S]*?</div></div>`))?.[0] ?? "";
// A row's options as "Label count". A pressed option is in brackets, and a disabled option is in parentheses.
const optionsOf = (html, facet) => buttonsIn(facetRowOf(html, facet)).map(({ label, count, pressed, disabled }) => {
  const text = count === undefined ? label : `${label} ${count}`;
  return pressed ? `[${text}]` : disabled ? `(${text})` : text;
});
// The active-filter trail: the chosen tiers joined by "›", then each chosen facet after "+".
function trailOf(html) {
  const trail = html.match(/<ul class="filter-trail"[\s\S]*?<\/ul>/)?.[0] ?? "";
  const path = trail.match(/<ol class="trail-tiers"[\s\S]*?<\/ol>/)?.[0] ?? "";
  const labels = (part) => buttonsIn(part).map((button) => button.label);
  return [labels(path).join(" › "), ...labels(trail.replace(path, ""))].filter(Boolean).join(" + ");
}

test("Explore lists the community Marketplace with concise tags, tag filters, sorting, and per-account votes", () => {
  const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const html = renderCurriculumWebAppHtml({ topLevel: "Explore" });
  assert.deepEqual(titlesOf(html), [
    "Rust Async Runtime Internals", "Linear Algebra &amp; Spectral Methods", "Statistical Mechanics &amp; Thermodynamics",
    "Tolstoy's Major Novels: War &amp; Peace and Anna Karenina", "Build and Evaluate RAG Systems in Python",
  ], "Top Upvoted is the default order");

  // A card face is a subject icon, one- or two-word tags, title, summary, topic tags, one meta line, then the vote and one action.
  const rust = cardOf(html, "publication-rust-async-001");
  assert.match(text(rust), /^Systems Applied Code Lab Rust Async Runtime Internals .+ Rust Async Concurrency @ferris_ops · 2 units · 64 adopted 48 Details$/);
  assert.ok(rust.includes('<span class="marketplace-card-icon" aria-hidden="true"><svg class="sf-icon"'));
  assert.ok(rust.includes('data-action="toggle-upvote" data-publication-id="publication-rust-async-001" data-revision-id="public-revision-rust-async-001" aria-pressed="false" aria-label="Upvote (48)"><svg class="sf-icon"'));
  assert.ok(rust.includes('<span class="upvote-count">48</span>'));
  assert.ok(rust.includes('data-action="open-adopt-dialog" data-publication-id="publication-rust-async-001">Details</button>'));
  const cards = [...html.matchAll(/<article class="marketplace-card[\s\S]*?<\/article>/g)].map((match) => match[0]);
  const headTagsOf = (card) => buttonsIn(card.slice(card.indexOf("marketplace-card-head"), card.indexOf("marketplace-card-body"))).map((button) => button.label);
  const topicTagsOf = (card) => buttonsIn(card.slice(card.indexOf("marketplace-topics"), card.indexOf("marketplace-meta"))).map((button) => button.label);
  assert.deepEqual(cards.map(headTagsOf), [
    ["Systems", "Applied", "Code Lab"], ["Math", "Formal", "Quiz"], ["Physics", "Formal", "Problem Set"],
    ["Literature", "Intuitive", "Rubric"], ["Engineering", "Formal", "Quiz"],
  ]);
  assert.deepEqual(cards.map(topicTagsOf), [
    ["Rust", "Async", "Concurrency"], ["Linear Algebra", "Eigenvalues", "SVD"], ["Thermodynamics", "Ensembles", "Phase Transitions"],
    ["Tolstoy", "Realism", "Narrative"], ["Python", "RAG", "Attention", "Linear Algebra"],
  ]);
  for (const clutter of ["flow-preview", "Inspect Study Flow", "Gate", "$0.00 adopt", "Upvote Revision", "Preview &amp; Adopt</button>"]) {
    assert.equal(html.slice(html.indexOf('<div class="marketplace-grid">'), html.indexOf("load-more-row")).includes(clutter), false, `a card still shows ${clutter}`);
  }
  // The learner's own listing and the plans they already have offer Open instead of Details.
  assert.match(cardOf(html, "publication-synthetic-001"), /<span class="owned-badge">Yours<\/span><button type="button" class="btn-secondary" data-action="open-curriculum-plan" data-curriculum-id="curriculum-rag-python-001">Open<\/button>/);
  assert.match(cardOf(html, "publication-linear-algebra-001"), /<span class="owned-badge">In your plans<\/span><button type="button" class="btn-secondary" data-action="open-curriculum-plan"/);

  // The panel and the cards share one tag vocabulary. The active tag is pressed in both places and clears its filter.
  const physics = renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceFilters: { category: "Math & Sciences", subject: "Physics" } });
  assert.deepEqual(titlesOf(physics), ["Statistical Mechanics &amp; Thermodynamics"]);
  assert.match(facetRowOf(physics, "subject"), /data-facet="subject" data-value="All" data-subject="Physics" aria-pressed="true"><svg class="sf-icon"[\s\S]*?<\/svg>Physics<svg class="sf-icon"/);
  assert.ok(cardOf(physics, "publication-statmech-001").includes('data-facet="subject" data-value="All" aria-pressed="true" aria-label="Filter by Physics">Physics</button>'));
  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceFilters: { category: "Humanities", subject: "Literature" } })), ["Tolstoy's Major Novels: War &amp; Peace and Anna Karenina"]);
  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceFilters: { difficulty: "Applied" } })), ["Rust Async Runtime Internals"]);
  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceSort: "most_adopted" }))[0], "Build and Evaluate RAG Systems in Python");
  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceSort: "newest" }))[0], "Build and Evaluate RAG Systems in Python");

  // The controls drive the mounted app. Search runs on submit, and unknown filter values are rejected.
  const { app, root, click, submit } = mountWithClicks({ topLevel: "Explore" });
  click({ action: "set-marketplace-filter", facet: "subject", value: "Mathematics" });
  assert.deepEqual(titlesOf(root.innerHTML), ["Linear Algebra &amp; Spectral Methods"]);
  click({ action: "set-marketplace-filter", facet: "subject", value: "Astrology" });
  click({ action: "set-marketplace-filter", facet: "color", value: "All" });
  assert.equal(app.getState().marketplaceFilters.subject, "Mathematics");
  click({ action: "clear-marketplace-filters" });
  submit("set-marketplace-query", { "#marketplace-search": { value: "  ferris " } });
  assert.deepEqual(titlesOf(root.innerHTML), ["Rust Async Runtime Internals"]);
  assert.ok(root.innerHTML.includes('<input id="marketplace-search" type="search" name="query" value="ferris"'));

  // A vote is one per account and revision.
  click({ action: "toggle-upvote", revisionId: "public-revision-rust-async-001" });
  assert.ok(cardOf(root.innerHTML, "publication-rust-async-001").includes('aria-pressed="true" aria-label="Upvote (49)"'));
  assert.ok(cardOf(root.innerHTML, "publication-rust-async-001").includes('<span class="upvote-count">49</span>'));
  click({ action: "toggle-upvote", revisionId: "public-revision-rust-async-001" });
  assert.ok(cardOf(root.innerHTML, "publication-rust-async-001").includes('aria-pressed="false" aria-label="Upvote (48)"'));
});

test("Explore filters drill from Category to Subject to Topic, cross the tiers with Difficulty and Format, and reset from the trail", () => {
  // With no filter, the panel shows every tier in taxonomy order with live counts, and there is no trail.
  const html = renderCurriculumWebAppHtml({ topLevel: "Explore" });
  assert.deepEqual([...html.matchAll(/<div class="facet-row"(?: data-tier="(\d)")? role="group" aria-labelledby="facet-([a-z]+)-label"><span class="facet-label" id="facet-\2-label">([^<]+)</g)].map((match) => `${match[3]}:${match[1] ?? "-"}`),
    ["Category:1", "Subject:2", "Topic:3", "Difficulty:-", "Format:-"]);
  assert.deepEqual(optionsOf(html, "category"), ["[All 5]", "Computer Science 2", "Math & Sciences 2", "Humanities 1"]);
  // The subjects form one flat row of tags in taxonomy order. The Category row above already names their categories.
  const subjectRow = facetRowOf(html, "subject");
  assert.match(subjectRow, /<div class="facet-options">(?:<button type="button" class="tag"[^>]*>[\s\S]*?<\/button>){5}<\/div>/);
  assert.deepEqual(optionsOf(html, "subject"), ["Engineering 1", "Systems 1", "Math 1", "Physics 1", "Literature 1"]);
  // A long topic list shows its first six topics by result count, then a finder and a toggle reach the rest.
  assert.deepEqual(optionsOf(html, "topic"), [
    "Linear Algebra 2", "Async 1", "Attention 1", "Concurrency 1", "Eigenvalues 1", "Ensembles 1", "Show 9 more",
  ]);
  assert.deepEqual(optionsOf(html, "difficulty"), ["Formal 3", "Applied 1", "Intuitive 1"]);
  assert.deepEqual(optionsOf(html, "format"), ["Quiz 2", "Code Lab 1", "Problem Set 1", "Rubric 1"]);
  assert.ok(html.includes('<p class="marketplace-count" role="status">5 curricula</p>'));
  assert.equal(trailOf(html), "");
  assert.equal(html.includes('data-action="clear-marketplace-filters"'), false, "Clear filters appears only while a filter is active");

  const { app, root, click, submit } = mountWithClicks({ topLevel: "Explore" });
  const filters = () => app.getState().marketplaceFilters;
  // Each press uses the button's own data attributes, from the panel row or from a card.
  const press = (part, label) => {
    const button = buttonsIn(part).find((entry) => entry.label === label);
    assert.ok(button, `no ${label} button`);
    click(button.data);
  };
  const pressInRow = (facet, label) => press(facetRowOf(root.innerHTML, facet), label);
  const pressOnCard = (id, label) => press(cardOf(root.innerHTML, id), label);
  const pressInTrail = (label) => press(root.innerHTML.match(/<ul class="filter-trail"[\s\S]*?<\/ul>/)?.[0] ?? "", label);

  // Tier 1 scopes tier 2 and tier 3 to its own branch.
  pressInRow("category", "Computer Science");
  assert.deepEqual(titlesOf(root.innerHTML), ["Rust Async Runtime Internals", "Build and Evaluate RAG Systems in Python"]);
  assert.deepEqual(optionsOf(root.innerHTML, "subject"), ["Engineering 1", "Systems 1"]);
  assert.deepEqual(optionsOf(root.innerHTML, "topic"), ["Async 1", "Attention 1", "Concurrency 1", "Linear Algebra 1", "Python 1", "RAG 1", "Rust 1"]);
  assert.equal(trailOf(root.innerHTML), "Computer Science");
  assert.ok(root.innerHTML.includes('<p class="marketplace-count" role="status">2 of 5 curricula</p>'));

  // Tier 2 narrows inside the category, and tier 3 follows it.
  pressInRow("subject", "Systems");
  assert.deepEqual(titlesOf(root.innerHTML), ["Rust Async Runtime Internals"]);
  assert.deepEqual(optionsOf(root.innerHTML, "topic"), ["Async 1", "Concurrency 1", "Rust 1"]);
  // A topic tag on a card narrows the same way as the panel, and the trail shows the full path.
  pressOnCard("publication-rust-async-001", "Async");
  assert.deepEqual(filters(), { category: "Computer Science", subject: "Systems", topic: "Async", difficulty: "All", format: "All", query: "" });
  assert.equal(trailOf(root.innerHTML), "Computer Science › Systems › Async");
  assert.match(cardOf(root.innerHTML, "publication-rust-async-001"), /data-facet="topic" data-value="All" aria-pressed="true" aria-label="Filter by Async">Async<\/button>/);
  // A pressed tag clears only its own tier.
  pressOnCard("publication-rust-async-001", "Async");
  assert.equal(trailOf(root.innerHTML), "Computer Science › Systems");
  pressInRow("subject", "Systems");
  assert.equal(trailOf(root.innerHTML), "Computer Science");

  // A subject sets its own category. A topic that no listing in the new branch carries is dropped.
  pressInRow("topic", "Rust");
  click({ action: "set-marketplace-filter", facet: "subject", value: "Physics" });
  assert.deepEqual(filters(), { category: "Math & Sciences", subject: "Physics", topic: "All", difficulty: "All", format: "All", query: "" });
  assert.deepEqual(titlesOf(root.innerHTML), ["Statistical Mechanics &amp; Thermodynamics"]);
  // A category drops a subject that lies outside it.
  pressInRow("category", "Humanities");
  assert.deepEqual([filters().category, filters().subject], ["Humanities", "All"]);
  assert.deepEqual(titlesOf(root.innerHTML), ["Tolstoy's Major Novels: War &amp; Peace and Anna Karenina"]);

  // A topic can span categories. Each category count is the result of choosing it, after the tier rules apply.
  pressInRow("category", "All");
  pressInRow("topic", "Linear Algebra");
  assert.deepEqual(titlesOf(root.innerHTML), ["Linear Algebra &amp; Spectral Methods", "Build and Evaluate RAG Systems in Python"]);
  assert.deepEqual(optionsOf(root.innerHTML, "category"), ["[All 2]", "Computer Science 1", "Math & Sciences 1", "Humanities 1"]);
  pressInRow("category", "Math & Sciences");
  assert.equal(trailOf(root.innerHTML), "Math & Sciences › Linear Algebra");
  assert.deepEqual(titlesOf(root.innerHTML), ["Linear Algebra &amp; Spectral Methods"]);
  pressInRow("category", "Computer Science");
  assert.equal(filters().topic, "Linear Algebra", "a topic stays while the new branch still carries it");
  assert.deepEqual(titlesOf(root.innerHTML), ["Build and Evaluate RAG Systems in Python"]);
  // Removing the category from the trail keeps the topic, so the results widen again.
  pressInTrail("Computer Science");
  assert.equal(trailOf(root.innerHTML), "Linear Algebra");
  assert.equal(titlesOf(root.innerHTML).length, 2);

  // Difficulty and Format cut across every tier. An option with no results is disabled, and the trail lists each facet.
  click({ action: "clear-marketplace-filters" });
  pressInRow("difficulty", "Formal");
  assert.deepEqual(titlesOf(root.innerHTML), [
    "Linear Algebra &amp; Spectral Methods", "Statistical Mechanics &amp; Thermodynamics", "Build and Evaluate RAG Systems in Python",
  ]);
  assert.deepEqual(optionsOf(root.innerHTML, "format"), ["Quiz 2", "(Code Lab 0)", "Problem Set 1", "(Rubric 0)"]);
  pressInRow("format", "Quiz");
  assert.deepEqual(titlesOf(root.innerHTML), ["Linear Algebra &amp; Spectral Methods", "Build and Evaluate RAG Systems in Python"]);
  assert.deepEqual(optionsOf(root.innerHTML, "category"), ["[All 2]", "Computer Science 1", "Math & Sciences 1", "(Humanities 0)"]);
  assert.deepEqual(optionsOf(root.innerHTML, "difficulty"), ["[Formal]", "(Applied 0)", "(Intuitive 0)"]);
  assert.equal(trailOf(root.innerHTML), "Formal + Quiz");
  pressInTrail("Formal");
  assert.deepEqual(filters(), { category: "All", subject: "All", topic: "All", difficulty: "All", format: "Quiz", query: "" });

  // Every tier and both facets combine into one result.
  pressInRow("subject", "Engineering");
  pressInRow("topic", "Python");
  pressOnCard("publication-synthetic-001", "Formal");
  assert.deepEqual(titlesOf(root.innerHTML), ["Build and Evaluate RAG Systems in Python"]);
  assert.equal(trailOf(root.innerHTML), "Computer Science › Engineering › Python + Formal + Quiz");

  // Search also matches topic tags and joins the trail. Clear filters resets every filter and the search, but not the sort.
  click({ action: "set-marketplace-sort", sort: "newest" });
  click({ action: "clear-marketplace-filters" });
  submit("set-marketplace-query", { "#marketplace-search": { value: "svd" } });
  assert.deepEqual(titlesOf(root.innerHTML), ["Linear Algebra &amp; Spectral Methods"]);
  assert.equal(trailOf(root.innerHTML), "“svd”");
  pressInTrail("“svd”");
  assert.equal(filters().query, "");
  pressInRow("subject", "Systems");
  submit("set-marketplace-query", { "#marketplace-search": { value: "async" } });
  click({ action: "clear-marketplace-filters" });
  assert.deepEqual(filters(), { category: "All", subject: "All", topic: "All", difficulty: "All", format: "All", query: "" });
  assert.equal(app.getState().marketplaceSort, "newest");
  assert.equal(titlesOf(root.innerHTML).length, 5);

  // Unknown facets, values, and topic tags change nothing.
  for (const data of [{ facet: "category", value: "Astrology" }, { facet: "topic", value: "Haskell" }, { facet: "difficulty", value: "Strict" }, { facet: "rigor", value: "Formal" }, { facet: "access", value: "All" }]) {
    click({ action: "set-marketplace-filter", ...data });
  }
  assert.deepEqual(filters(), { category: "All", subject: "All", topic: "All", difficulty: "All", format: "All", query: "" });

  // With no match, the empty state offers the same reset.
  const none = mountWithClicks({ topLevel: "Explore", marketplaceFilters: { category: "Computer Science", subject: "Systems", difficulty: "Formal" } });
  assert.ok(none.root.innerHTML.includes("<span>No curricula match these filters.</span>") && titlesOf(none.root.innerHTML).length === 0);
  assert.match(none.root.innerHTML, /<div class="empty-state marketplace-empty">[\s\S]*?<button type="button" class="clear-filters" data-action="clear-marketplace-filters">Clear filters<\/button><\/div>/);
  press(none.root.innerHTML.match(/<div class="empty-state marketplace-empty">[\s\S]*?<\/div>/)[0], "Clear filters");
  assert.equal(titlesOf(none.root.innerHTML).length, 0, "the first mount is unchanged");
  none.click({ action: "clear-marketplace-filters" });
  assert.equal(titlesOf(none.root.innerHTML).length, 5);
});

test("Explore keeps a long topic list short: six topics by count, a toggle for the rest, and a finder for any topic", () => {
  const { app, root, click, submit } = mountWithClicks({ topLevel: "Explore" });
  const topicRow = () => facetRowOf(root.innerHTML, "topic");
  const toggle = () => topicRow().match(/<button type="button" class="facet-more"[^>]*>[^<]+<\/button>/)?.[0];
  const allTopics = [
    "Linear Algebra", "Async", "Attention", "Concurrency", "Eigenvalues", "Ensembles", "Narrative", "Phase Transitions",
    "Python", "RAG", "Realism", "Rust", "SVD", "Thermodynamics", "Tolstoy",
  ];

  // Collapsed, the toggle names how many topics it hides, and the finder's list holds every topic in scope.
  assert.equal(toggle(), '<button type="button" class="facet-more" data-action="toggle-marketplace-topics" aria-expanded="false">Show 9 more</button>');
  assert.ok(topicRow().includes('<input id="marketplace-topic" type="search" name="value" list="marketplace-topic-list" placeholder="Find a topic" autocomplete="off"/>'));
  assert.deepEqual([...topicRow().matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]), allTopics);

  // The toggle shows every topic in the same order, and pressing it again collapses the list.
  click({ action: "toggle-marketplace-topics" });
  assert.equal(app.getState().marketplaceTopicsExpanded, true);
  assert.deepEqual(buttonsIn(topicRow()).map((button) => button.label), [...allTopics, "Show fewer"]);
  assert.ok(toggle().includes('aria-expanded="true"'));
  click({ action: "toggle-marketplace-topics" });
  assert.equal(optionsOf(root.innerHTML, "topic").length, 7);

  // The chosen topic stays in view while the list is collapsed, even when it ranks below the first six.
  click({ action: "set-marketplace-filter", facet: "topic", value: "Tolstoy" });
  assert.deepEqual(optionsOf(root.innerHTML, "topic"), [
    "Linear Algebra 2", "Async 1", "Attention 1", "Concurrency 1", "Eigenvalues 1", "Ensembles 1", "[Tolstoy]", "Show 8 more",
  ]);

  // The finder sets a topic typed in any letter case. Text that names no topic changes nothing.
  submit("set-marketplace-filter", { "#marketplace-topic": { value: "  phase transitions " } });
  assert.equal(app.getState().marketplaceFilters.topic, "Phase Transitions");
  assert.equal(trailOf(root.innerHTML), "Phase Transitions");
  submit("set-marketplace-filter", { "#marketplace-topic": { value: "Haskell" } });
  assert.equal(app.getState().marketplaceFilters.topic, "Phase Transitions");

  // A scope with seven topics or fewer shows them all, with no finder and no toggle.
  click({ action: "clear-marketplace-filters" });
  click({ action: "set-marketplace-filter", facet: "category", value: "Computer Science" });
  assert.equal(toggle(), undefined);
  assert.equal(topicRow().includes("topic-finder"), false);
  assert.equal(optionsOf(root.innerHTML, "topic").length, 7);
});

test("Details shows the whole curriculum with every unit selected, closes prerequisites, then adds a private draft that activates on the Plan page", () => {
  const { app, root, click } = mountWithClicks({ topLevel: "Explore" });
  const dialog = () => root.innerHTML.slice(root.innerHTML.indexOf('<dialog id="dialog-partial-adoption"'), root.innerHTML.indexOf("</dialog>", root.innerHTML.indexOf('<dialog id="dialog-partial-adoption"')));
  const allUnits = ["rs-module-futures", "rs-module-scheduling"];
  click({ action: "open-adopt-dialog", publicationId: "publication-rust-async-001" });
  assert.ok(dialog().includes('aria-labelledby="dialog-partial-adoption-title" data-open="true"'));

  // An icon button closes the dialog. There is no scope switch, and every unit starts selected.
  assert.ok(dialog().includes('<button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close"><svg'));
  assert.equal(dialog().includes("set-adopt-scope"), false);
  assert.deepEqual(app.getState().adoptModuleIds, allUnits);
  assert.ok(dialog().includes('data-action="select-all-adopt-modules" disabled>Select all</button>'));

  // The goal and its scope come first. Then each unit lists every activity in order, with its kind,
  // requirement, linked resources, and minutes.
  assert.ok(dialog().includes('<p class="prose adopt-summary">Build a small async executor from the Future trait up, then add a reactor, a timer wheel, and work stealing.</p>'));
  assert.ok(dialog().includes('<dt>Covers</dt><dd><span class="badge">futures and polling</span><span class="badge">wakers</span><span class="badge">reactors</span><span class="badge">work stealing</span></dd>'));
  assert.ok(dialog().includes("<dt>Not covered</dt><dd>production tuning of tokio</dd>"));
  assert.match(dialog(), /U2 · Reactors, Timers, and Work Stealing<\/span><span class="adopt-unit-meta"><span>110 min \(87–164 min\)<\/span><span class="requires-badge">Requires U1<\/span><\/span>/);
  assert.deepEqual([...dialog().matchAll(/<span class="adopt-step">([\d.]+)<\/span>/g)].map((step) => step[1]), ["1.1", "1.2", "1.3", "2.1", "2.2", "2.3", "2.4"]);
  assert.match(dialog(), /<span class="adopt-step">1\.3<\/span><div class="adopt-activity-body"><p class="adopt-activity-title">Gate Lab: Build a Single-Threaded Executor<\/p><p class="adopt-activity-meta">Code lab · <span class="adopt-requirement" data-requirement="gate">Mastery gate<\/span><\/p><ul class="adopt-resources" aria-label="Study resources"><li><svg[\s\S]*?<\/svg><span><a href="https:\/\/example\.invalid\/catalog\/executor-lab" target="_blank" rel="noopener noreferrer">Executor Lab: Test Harness and Reference Solutions<span class="st-sr"> \(opens in a new tab\)<\/span><\/a><span class="adopt-publisher">Open Systems Press \(Curator Verified\) <span class="badge">Free access<\/span><\/span><\/span><\/li><\/ul><\/div><span class="adopt-minutes">45 min<\/span>/);
  assert.ok(dialog().includes('Worked Example: Work-Stealing Task Queues</p><p class="adopt-activity-meta">Worked example · <span class="adopt-requirement" data-requirement="optional">Optional</span>'));
  // The footer holds the selection total, then the adopt action.
  assert.match(dialog(), /<footer class="dialog-footer"><p class="adopt-total">2 of 2 units · 205 min \(161–303 min\)<\/p><button type="button" class="btn-primary" data-action="confirm-adopt-curriculum" data-publication-id="publication-rust-async-001">Adopt into My Plans/);

  // Unchecking unit 1 also drops unit 2, which needs it. With nothing left, adopting waits for a unit.
  click({ action: "toggle-adopt-module", moduleId: "rs-module-futures" });
  assert.deepEqual(app.getState().adoptModuleIds, []);
  assert.ok(dialog().includes("Select at least one unit.") && /data-action="confirm-adopt-curriculum"[^>]*disabled/.test(dialog()));
  click({ action: "select-all-adopt-modules" });
  assert.deepEqual(app.getState().adoptModuleIds, allUnits);
  click({ action: "toggle-adopt-module", moduleId: "rs-module-scheduling" });
  assert.ok(dialog().includes('<p class="adopt-total">1 of 2 units · 95 min (74–139 min)</p>'));
  assert.ok(dialog().includes('data-action="select-all-adopt-modules">Select all</button>'));

  // Unit 2 alone needs unit 1, so unit 1 is checked and marked as an automatic prerequisite.
  click({ action: "toggle-adopt-module", moduleId: "rs-module-futures" });
  click({ action: "toggle-adopt-module", moduleId: "rs-module-scheduling" });
  assert.match(dialog(), /role="checkbox" aria-checked="true" data-action="toggle-adopt-module" data-module-id="rs-module-futures">[\s\S]*?<span class="auto-badge">Auto-included prerequisite<\/span>/);
  assert.ok(dialog().includes('data-action="select-all-adopt-modules" disabled>'), "the prerequisite completes the curriculum");
  // Unchecking the automatic prerequisite drops unit 2 with it. Checking unit 2 again brings both back.
  click({ action: "toggle-adopt-module", moduleId: "rs-module-futures" });
  assert.deepEqual(app.getState().adoptModuleIds, []);
  click({ action: "toggle-adopt-module", moduleId: "rs-module-scheduling" });
  click({ action: "toggle-adopt-module", moduleId: "rs-module-unknown" });
  assert.deepEqual(app.getState().adoptModuleIds, ["rs-module-scheduling"]);
  // The selection belongs to the open listing, so a confirm for another listing adopts nothing.
  click({ action: "confirm-adopt-curriculum", publicationId: "publication-statmech-001" });
  assert.equal(app.getState().adoptions.length, 0);

  click({ action: "confirm-adopt-curriculum", publicationId: "publication-rust-async-001" });
  const state = app.getState();
  assert.equal(state.selectedCurriculumId, "adopted-publication-rust-async-001");
  assert.deepEqual([state.topLevel, state.learnSubDestination, state.openDialogId], ["Learn", "Today", null]);
  assert.deepEqual(state.adoptions, [{ accountId: "learner-default", publicationId: "publication-rust-async-001", moduleIds: ["rs-module-futures", "rs-module-scheduling"], active: false }]);
  assert.ok(root.innerHTML.includes("This plan is your private draft of @ferris_ops's template."));
  assert.ok(root.innerHTML.includes('<option value="adopted-publication-rust-async-001" selected>Rust Async Runtime Internals · Draft</option>'));
  assert.ok(todayBoard(root.innerHTML).includes('<span class="unit-title">Futures, Wakers, and the Poll Model</span>'));
  const queue = () => {
    const start = root.innerHTML.indexOf('<section class="today-curricula-grid"');
    return root.innerHTML.slice(start, root.innerHTML.indexOf("</section>", start));
  };
  assert.equal(queue().includes("adopted-publication-rust-async-001"), false, "a draft stays out of Today's queue");

  // Activation is the separate, explicit step. Then the plan joins Today, and the listing counts the adoption.
  click({ action: "activate-revision" });
  assert.ok(queue().includes('data-curriculum-id="adopted-publication-rust-async-001"'));
  assert.equal(root.innerHTML.includes("This plan is your private draft"), false);
  click({ action: "confirm-adopt-curriculum", publicationId: "publication-rust-async-001" });
  assert.equal(app.getState().adoptions.length, 1, "a listing is adopted once per account");
  app.navigateTopLevel("Explore");
  assert.match(root.innerHTML, /data-publication-id="publication-rust-async-001"[\s\S]*?· 65 adopted[\s\S]*?<span class="owned-badge">In your plans<\/span>/);
});

test("Dialogs pin an icon close button and a right-aligned footer, and a re-render keeps an open dialog's scroll position", () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  assert.match(css, /\.dialog-close-btn \{[^}]*width: 36px;[^}]*height: 36px;[^}]*border-radius: 999px;/s);
  assert.match(css, /\.dialog-footer \{[^}]*position: sticky;[^}]*bottom: calc\(-1 \* var\(--space-6\)\);[^}]*justify-content: flex-end;/s);
  assert.match(css, /\.dialog-surface > \.action-row \{\s*justify-content: flex-end;/);
  assert.match(css, /#dialog-partial-adoption \{\s*max-width: min\(760px, calc\(100vw - 32px\)\);/);

  // Checking a unit renders a new dialog element. It opens at the place the learner scrolled to.
  let shown = null;
  const next = { id: "dialog-partial-adoption", open: false, scrollTop: 0, showModal() { this.open = true; } };
  const listeners = {};
  const root = {
    innerHTML: "",
    addEventListener: (type, listener) => { listeners[type] = listener; },
    querySelector: (selector) => (selector === "dialog[open]" ? shown : selector === 'dialog[data-open="true"]' ? next : null),
  };
  mountCurriculumWebApp(root, { topLevel: "Explore", openDialogId: "dialog-partial-adoption", adoptPublicationId: "publication-rust-async-001" });
  shown = { id: "dialog-partial-adoption", scrollTop: 480 };
  next.open = false;
  listeners.click({ target: { closest: () => ({ dataset: { action: "toggle-adopt-module", moduleId: "rs-module-scheduling" } }) } });
  assert.deepEqual([next.open, next.scrollTop], [true, 480]);

  // Another dialog that opens starts at its top.
  shown = { id: "dialog-auth", scrollTop: 300 };
  next.open = false;
  next.scrollTop = 0;
  listeners.click({ target: { closest: () => ({ dataset: { action: "select-all-adopt-modules" } }) } });
  assert.deepEqual([next.open, next.scrollTop], [true, 0]);
});

test("Share with Community previews the public projection, then publishes it to Explore and My Publications", () => {
  const { app, root, click } = mountWithClicks();
  const dialog = () => root.innerHTML.slice(root.innerHTML.indexOf('<dialog id="dialog-publication-preview"'), root.innerHTML.indexOf("</dialog>", root.innerHTML.indexOf('<dialog id="dialog-publication-preview"')));
  // The default plan is already the learner's listing, so it cannot be published twice.
  app.openDialog("dialog-publication-preview");
  assert.ok(dialog().includes("This plan is already shared with the Community as revision 1.") && !dialog().includes("confirm-publish-curriculum"));

  click({ action: "select-curriculum", curriculumId: "curriculum-tolstoy-lit-003" });
  app.openDialog("dialog-publication-preview");
  assert.ok(dialog().includes("<h3 id=\"publish-preview-title\">Tolstoy's Major Novels: War &amp; Peace and Anna Karenina</h3>"));
  assert.deepEqual([...dialog().matchAll(/<li><svg[\s\S]*?<\/svg><span>([^<]+)<\/span><\/li>/g)].map((match) => match[1]), [
    "Your progress and completion records", "Proficiency, evidence, and diagnostic answers", "Notes, attempts, and practice drafts",
    "BYOK keys and provider connections", "Billing, budgets, and wallet state", "Your session dates and reminder settings",
  ]);
  assert.ok(dialog().includes("Based on @tolstoy_seminar's template."));

  click({ action: "confirm-publish-curriculum" });
  const published = app.getState().publishedListings;
  assert.equal(published.length, 1);
  assert.deepEqual([published[0].handle, published[0].basedOn, published[0].ownerAccountId], ["@alex", "@tolstoy_seminar", "learner-default"]);
  assert.deepEqual(published[0].topicTags, ["Tolstoy", "Realism", "Narrative"], "a listing keeps the topic tags of the template it is based on");
  assert.equal(JSON.stringify(published[0].schedule).includes("start_at"), false, "session dates stay private");
  assert.equal(JSON.stringify(published[0].curriculum).includes("learner-default"), false, "the account id stays private");
  assert.equal(app.getState().topLevel, "Explore");
  const card = root.innerHTML.match(/<article class="marketplace-card public-template-card" data-publication-id="publication-curriculum-tolstoy-lit-003-learner-default"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(card, /@alex<\/span> · based on @tolstoy_seminar · 2 units · 0 adopted[\s\S]*?aria-label="Upvote \(0\)"[\s\S]*?<span class="owned-badge">Yours<\/span>/);
  const mine = root.innerHTML.slice(root.innerHTML.indexOf('<section class="surface-panel my-publications"'));
  assert.ok(mine.includes("<li data-publication-id=\"publication-curriculum-tolstoy-lit-003-learner-default\"><strong>Tolstoy's Major Novels: War &amp; Peace and Anna Karenina</strong>"));
  // A new publication has no adoptions yet, so its row welcomes the first learner instead of listing zeros.
  const fresh = mine.match(/<li data-publication-id="publication-curriculum-tolstoy-lit-003-learner-default">[\s\S]*?<\/li>/)?.[0] ?? "";
  assert.ok(fresh.includes('</strong><span class="publication-revision">Public · Revision 1</span>'));
  assert.match(fresh, /<p class="publication-impact"><span class="impact-pill"><svg[\s\S]*?<\/svg><span>Live in Explore and ready for its first learner<\/span><\/span><\/p>/);
  app.openDialog("dialog-publication-preview");
  assert.ok(dialog().includes("This plan is already shared with the Community as revision 1."));
});

test("My Publications thanks the author, totals what their shared plans gave, and invites a first share", () => {
  const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const sectionOf = (html) => {
    const start = html.indexOf('<section class="surface-panel my-publications"');
    return html.slice(start, html.indexOf("</section>", start));
  };
  // Each impact card reads as its tier, its term, and its headline value.
  const impactOf = (html) => [...(sectionOf(html).match(/<dl class="philanthropy-impact">[\s\S]*?<\/dl>/)?.[0] ?? "")
    .matchAll(/<div class="impact-(\w+)"><dt>([\s\S]*?)<\/dt><dd class="impact-(?:value|license)">([^<]+)<\/dd>/g)]
    .map(([, tier, term, value]) => `${tier} · ${text(term)}: ${value}`);
  const rowOf = (html, id) => sectionOf(html).match(new RegExp(`<li data-publication-id="${id}">[\\s\\S]*?</li>`))?.[0] ?? "";

  // The header thanks the author and offers the next share. Learners reached is the focal card with the emblem.
  // Study hours (98 estimated minutes × 142 adoptions ≈ 232 hours) and upvotes support it with icon badges,
  // and the seal names the free license.
  const mine = sectionOf(renderCurriculumWebAppHtml({ topLevel: "Explore" }));
  assert.ok(mine.includes("Thank you for teaching in the open."));
  assert.ok(mine.includes('<button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share another curriculum</button>'));
  assert.deepEqual(impactOf(mine), [
    "hero · Learners reached: 142",
    "support · Study hours gifted: 232",
    "support · Community upvotes: 14",
    "seal · Free for every learner: CC BY 4.0",
  ]);
  assert.match(mine, /<div class="impact-hero"><dt><svg class="philanthropy-art"[\s\S]*?<\/svg>Learners reached<\/dt>/);
  assert.equal(mine.match(/<span class="impact-icon-badge"><svg class="sf-icon"/g)?.length, 2);
  assert.ok(text(mine).includes("142 Self-learners studying your shared syllabus at no cost"));
  assert.ok(text(mine).includes("CC BY 4.0 Each adoption gives a learner your plan's structured study hours at no cost."));

  // Each row shows the subject icon, the revision, the topics, its own impact pills, Open for a plan the learner has,
  // and a quiet Unpublish.
  const row = rowOf(mine, "publication-synthetic-001");
  assert.equal(text(row), "Build and Evaluate RAG Systems in Python Public · Revision 1 Python RAG Attention Linear Algebra 142 learners 232 study hours 14 upvotes Open Unpublish");
  assert.equal(row.match(/<span class="impact-pill"><svg class="sf-icon"/g)?.length, 3);
  assert.ok(row.includes('<span class="marketplace-card-icon" data-subject="Engineering" aria-hidden="true"><svg class="sf-icon"'));
  assert.ok(row.includes('data-action="open-curriculum-plan" data-curriculum-id="curriculum-rag-python-001">Open</button>'));
  assert.ok(row.includes('<button type="button" class="unpublish-btn" data-action="open-dialog" data-dialog-id="dialog-unpublish" aria-label="Unpublish Build and Evaluate RAG Systems in Python">Unpublish</button>'));
  for (const removed of ["btn-danger", "warning-copy", "never cached"]) {
    assert.equal(mine.includes(removed), false, `My Publications still shows ${removed}`);
  }

  // The totals follow live votes, and Unpublish opens the dialog that states the full consequences.
  const { app, root, click } = mountWithClicks({ topLevel: "Explore" });
  click({ action: "toggle-upvote", revisionId: "public-revision-synthetic-001" });
  assert.equal(impactOf(root.innerHTML)[2], "support · Community upvotes: 15");
  click(buttonsIn(rowOf(root.innerHTML, "publication-synthetic-001")).find((button) => button.label === "Unpublish").data);
  assert.equal(app.getState().openDialogId, "dialog-unpublish");
  const unpublish = root.innerHTML.slice(root.innerHTML.indexOf('<dialog id="dialog-unpublish"'));
  assert.ok(unpublish.slice(0, unpublish.indexOf("</dialog>")).includes("Historical votes are not transferred."));

  // A learner with no publication sees an invitation with the emblem instead of an empty impact panel.
  const newcomer = sectionOf(renderCurriculumWebAppHtml({ topLevel: "Explore", account: { accountId: "learner-new", email: "sam@curriculum.io", role: "Learner" } }));
  assert.equal(newcomer.includes("philanthropy-impact") || newcomer.includes("Share another curriculum"), false);
  assert.ok(newcomer.includes('<div class="publish-invite"><svg class="philanthropy-art"'));
  assert.match(text(newcomer), /^My Publications Help the next learner start where you did Publishing shares your plan's structure under CC BY 4\.0, .+ stay private\. Share your first curriculum$/);
  assert.ok(newcomer.includes('<button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share your first curriculum</button>'));
});

test("the header shows the navbar avatar menu, signing out purges private state, and guests sign in to return where they were", () => {
  const { app, root, click, submit } = mountWithClicks();
  const header = () => root.innerHTML.slice(root.innerHTML.indexOf('<div class="header-status">'), root.innerHTML.indexOf("</header>"));
  assert.match(header(), /<summary class="navbar-avatar-trigger"[^>]*>[\s\S]*?<span class="user-avatar-circle"[^>]*>AR<\/span><span class="navbar-user-name">Alex Rivera<\/span>/);
  assert.ok(
    header().includes('class="navbar-theme-toggle"') &&
      header().includes('<span class="account-email">alex@curriculum.io</span>') &&
      header().includes('data-destination="Settings"') &&
      header().includes('data-action="sign-out"') &&
      !header().includes("Switch account"),
  );

  // Profile form in Profile & Settings updates display name and email live, and Profile & Settings renders Your contributions (upvotes, shared curricula status, learner comments) and BYOK AI providers with custody disclosure before #byok-key
  const settingsPanel = root.innerHTML.slice(root.innerHTML.indexOf('id="panel-settings"'), root.innerHTML.indexOf('</main>'));
  assert.equal(settingsPanel.includes('id="settings-appearance"'), false);
  assert.equal(settingsPanel.includes('id="settings-usage"'), false);
  assert.ok(settingsPanel.includes('<h2 id="settings-community-title">Your contributions</h2>'));
  assert.ok(settingsPanel.includes("Your shared plan reached <strong>142 learners</strong>"));
  assert.ok(settingsPanel.includes("<strong>14 people</strong> upvoted your work."));
  assert.ok(settingsPanel.includes('<span class="status-text" data-status="public">Public · Revision 1</span>'));
  assert.ok(settingsPanel.includes("<h3>Comments from learners</h3>"));
  assert.ok(settingsPanel.includes("<strong>@maya_dev</strong> on Build and Evaluate RAG Systems in Python"));
  assert.ok(settingsPanel.includes('class="comment-card"'));
  assert.ok(settingsPanel.includes('class="providers-data-table"'));
  assert.ok(settingsPanel.includes('class="provider-brand-tile"'));
  assert.ok(settingsPanel.includes('class="provider-logo-svg"'));
  assert.ok(settingsPanel.includes('class="ui-switch"'));
  assert.ok(settingsPanel.includes('class="btn-secondary" data-action="set-primary-key"'));
  assert.ok(settingsPanel.includes('class="btn-secondary" data-action="replace-key"'));
  assert.ok(settingsPanel.includes('class="btn-danger" data-action="delete-connection"'));
  assert.ok(settingsPanel.includes('<h2 id="settings-ai-title">AI providers (BYOK)</h2>'));
  assert.ok(settingsPanel.includes('data-primary-credential="cred-openai-1"'));
  assert.ok(
    settingsPanel.indexOf("Encrypted server-custody") < settingsPanel.indexOf('id="byok-key"'),
    "BYOK server custody disclosure must precede #byok-key input",
  );
  click({ action: "set-primary-key", credentialRef: "cred-anthropic-1" });
  assert.ok(root.innerHTML.includes('data-primary-credential="cred-anthropic-1"'));

  submit("update-profile", {
    "#profile-name-input": { value: "Alex R. Chen" },
    "#profile-email-input": { value: "alex@curriculum.io" },
  });
  assert.ok(header().includes('<span class="navbar-user-name">Alex R. Chen</span>'));

  click({ action: "complete-activity", activityId: "activity-theory", eventId: "evt-complete-activity-theory" });
  assert.ok(root.innerHTML.includes('data-self-reported-count="1"'));
  click({ action: "sign-out" });
  const guest = app.getState();
  assert.deepEqual([guest.authStatus, guest.topLevel, guest.recordedProgressEvents.length], ["guest", "Explore", 0]);
  assert.match(
    header(),
    /<div class="navbar-guest-actions" data-auth-status="guest">[\s\S]*?data-dialog-id="dialog-auth">Log in<\/button>[\s\S]*?data-dialog-id="dialog-auth">Sign in<\/button>/,
  );
  // No private content reaches a guest's page, not even hidden.
  for (const hidden of ['id="panel-learn"', 'id="panel-settings"', 'id="learn-detail-inspector"', 'id="dialog-new-curriculum"', "data-self-reported-count", "My Publications"]) {
    assert.equal(root.innerHTML.includes(hidden), false, `a guest page still contains ${hidden}`);
  }

  // A protected action records where to return and asks for sign-in. Nothing is voted or opened.
  click({ action: "toggle-upvote", revisionId: "public-revision-rust-async-001" });
  assert.deepEqual([app.getState().openDialogId, app.getState().votes.length], ["dialog-auth", 0]);
  click({ action: "open-adopt-dialog", publicationId: "publication-statmech-001" });
  assert.equal(app.getState().returnTo.label, "Explore › Details: Statistical Mechanics & Thermodynamics");
  assert.ok(root.innerHTML.includes("After you sign in, you return to <strong>Explore › Details: Statistical Mechanics &amp; Thermodynamics</strong>. Nothing is voted, published, adopted, or bought on your behalf."));
  submit("submit-sign-in", { "#auth-email-input": { value: "not-an-email" } });
  assert.ok(root.innerHTML.includes('<p class="field-error" role="alert">Enter a valid email address.</p>'));
  assert.equal(app.getState().authStatus, "guest");

  // Signing in restores the place and its dialog, never the action.
  submit("submit-sign-in", { "#auth-email-input": { value: "Alex@Curriculum.io" } });
  const back = app.getState();
  assert.deepEqual([back.authStatus, back.topLevel, back.openDialogId, back.adoptPublicationId, back.adoptions.length, back.votes.length],
    ["authenticated", "Explore", "dialog-partial-adoption", "publication-statmech-001", 0, 0]);
  assert.deepEqual(back.adoptModuleIds, ["sm-module-ensembles", "sm-module-phase"], "the restored Details starts with every unit selected");
  assert.ok(root.innerHTML.includes('data-self-reported-count="0"'), "the purged completion stays gone");

  // A guest who asks for Learn returns there after sign-in.
  click({ action: "sign-out" });
  app.navigateTopLevel("Learn");
  assert.equal(app.getState().returnTo.label, "Learn › Today");
  click({ action: "sign-in-passkey" });
  assert.deepEqual([app.getState().topLevel, app.getState().learnSubDestination], ["Learn", "Today"]);
});

test("an expired session keeps the view for the same account and starts clean for another one", () => {
  const { app, root, click } = mountWithClicks();
  click({ action: "complete-activity", activityId: "activity-theory", eventId: "evt-complete-activity-theory" });
  click({ action: "simulate-session-expired" });
  assert.equal(app.getState().authStatus, "session_expired");
  assert.ok(root.innerHTML.includes('<div class="session-banner" role="status"><p><strong>Session expired.</strong> Sign in to resume where you left off.</p>'));
  assert.ok(root.innerHTML.includes('id="panel-learn"'), "the expired view stays for its own account");
  click({ action: "set-activity-status", activityId: "activity-example", status: "in_progress" });
  assert.equal(app.getState().openDialogId, "dialog-auth", "a consequential action waits for sign-in");
  assert.notEqual(app.getState().activityStates["activity-example"], "in_progress");

  // The same account resumes with its work. Another account starts with a clean session.
  click({ action: "sign-in-passkey" });
  assert.ok(root.innerHTML.includes('data-self-reported-count="1"') && app.getState().authStatus === "authenticated");
  click({ action: "simulate-session-expired" });
  click({ action: "switch-persona", persona: "curator" });
  assert.ok(root.innerHTML.includes('<span class="account-email">ada@curriculum.io</span>'));
  assert.ok(root.innerHTML.includes('<span class="navbar-user-name">Ada Lovelace</span>'));
  assert.ok(root.innerHTML.includes('data-self-reported-count="0"'));
});

test("the activity inspector is one modal drawer that never takes width from the matrix", () => {
  const html = renderCurriculumWebAppHtml();
  assert.equal(html.split('id="learn-detail-inspector"').length - 1, 1);
  assert.ok(html.includes('<dialog id="learn-detail-inspector" class="inspector" closedby="any" aria-labelledby="learn-detail-inspector-title" data-open="false"'));
  assert.equal(/class="st-layout"|class="plan-split"/.test(html), false);

  // Only visible text counts: synthetic hrefs may point at example.invalid, labels never do.
  assert.equal(html.replace(/<[^>]+>/g, " ").includes("example.invalid"), false);

  const app = mountCurriculumWebApp({ innerHTML: "" });
  app.selectPlanActivity("activity-coding");
  const opened = app.renderHtml();
  assert.ok(opened.includes('aria-labelledby="learn-detail-inspector-title" data-open="true"'));
  assert.ok(opened.includes('<button type="button" class="inspector-close" data-action="close-study-detail" aria-label="Close details">'));
  assert.ok(opened.includes('<h2 id="learn-detail-inspector-title" tabindex="-1" autofocus>Implement Reversible Tokenizer &amp; Shape Validator</h2>'));
  app.applyUiAction("close-study-detail");
  assert.ok(app.renderHtml().includes('aria-labelledby="learn-detail-inspector-title" data-open="false"'));
  app.selectPlanActivity("activity-coding");
  app.navigateLearnSubDestination("Progress");
  assert.equal(app.getState().studyDetailOpen, false, "navigation closes the drawer");

  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  assert.match(css, /dialog\.inspector\s*\{[^}]*position:\s*fixed;[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(css, /html\s*\{[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(css, /\.node-card\s*\{[^}]*min-height:/s);
  assert.equal(/\.node-card\s*\{[^}]*[^-]height:\s*84px/s.test(css), false, "node cards must not use a fixed height");
  assert.match(css, /\.node-title\s*\{[^}]*overflow-wrap:\s*break-word;\s*word-break:\s*normal;/s);
  assert.equal(/\.curriculum-app-shell\s*\{[^}]*overflow-wrap:\s*anywhere/s.test(css), false, "the shell must not let words split mid-letter");
});

test("createWebAppServer serves SSR HTML, stylesheet, hydration script, and synthetic API fallback", async () => {
  const { server } = createWebAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const indexRes = await fetch(`${baseUrl}/?topLevel=Learn&learnSub=Plan&planView=Map`);
    assert.equal(indexRes.status, 200);
    const indexHtml = await indexRes.text();
    assert.ok(indexHtml.includes("<!doctype html>"));
    assert.ok(indexHtml.includes('data-current-learn-sub="Plan"'));
    assert.ok(indexHtml.includes('<svg class="plan-dag-svg"'));

    const cssRes = await fetch(`${baseUrl}/styles.css`);
    assert.equal(cssRes.status, 200);
    const cssText = await cssRes.text();
    assert.ok(cssText.includes("dialog:modal"));

    const fpCssRes = await fetch(`${baseUrl}/vendor/flatpickr.min.css`);
    assert.equal(fpCssRes.status, 200);
    const fpJsRes = await fetch(`${baseUrl}/vendor/flatpickr.min.js`);
    assert.equal(fpJsRes.status, 200);

    const stateRes = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete-activity",
        activityId: "activity-theory",
        eventId: "evt-http-1",
      }),
    });
    assert.equal(stateRes.status, 200);
    const stateJson = await stateRes.json();
    assert.equal(stateJson.state.selfReportedCompletedCount, 1);
    assert.ok(stateJson.html.includes('data-self-reported-count="1"'));

    // The hydration client forwards every other data-action; the server routes it through applyUiAction.
    const clientJs = await (await fetch(`${baseUrl}/client.js`)).text();
    assert.ok(clientJs.includes('dialog.id === INSPECTOR_ID ? "close-study-detail" : "close-dialog"'));
    const flowRes = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-flow-order", flowOrder: "application_first" }),
    });
    const flowJson = await flowRes.json();
    assert.equal(flowJson.state.flowOrder, "application_first");
    assert.deepEqual(columnTitles(flowJson.html), ["Unit", "Code", "Lecture", "Deep Dive", "Review", "Gate"]);

    // The drawer's status control travels the same route, and a step button inside the drawer never
    // replaces the control that opened it, so focus can return there on close.
    const statusRes = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-activity-status", activityId: "activity-example", status: "in_progress" }),
    });
    const statusJson = await statusRes.json();
    assert.equal(statusJson.state.activityStates["activity-example"], "in_progress");
    assert.ok(statusJson.html.includes('data-activity-id="activity-example" data-execution-status="in_progress"'));
    assert.ok(clientJs.includes('&& !target.closest("dialog")) {\n      inspectorOpenerKey = keyFor(target);'));

    // Plan switching travels the same route. The client sends a select's choice on change, never on click.
    const planRes = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open-curriculum-plan", curriculumId: "curriculum-tolstoy-lit-003" }),
    });
    const planJson = await planRes.json();
    assert.equal(planJson.state.selectedCurriculumId, "curriculum-tolstoy-lit-003");
    assert.equal(planJson.state.learnSubDestination, "Plan");
    // A click inside a form only focuses a field. Before the fix, a click in the search box sent an empty query.
    assert.ok(clientJs.includes(`if (!target || target.localName === "select" || target.localName === "form") return;`));
    // The topic finder sends a pick from its list at once, and refuses text that names no topic.
    assert.ok(clientJs.includes(`if (!event.inputType || event.inputType === "insertReplacementText") event.target.form.requestSubmit();`));
    assert.ok(clientJs.includes(`if (!finder.reportValidity()) return;`));
    assert.ok(clientJs.includes(`closest('select[data-action="select-curriculum"]')`));

    // Signing out goes through the same route. A guest's request for Learn opens sign-in instead.
    const post = async (body) => (await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })).json();
    const signedOut = await post({ action: "sign-out" });
    assert.deepEqual([signedOut.state.authStatus, signedOut.state.topLevel], ["guest", "Explore"]);
    assert.equal(signedOut.html.includes('id="panel-learn"'), false);
    const learn = await post({ action: "navigate-top", destination: "Learn" });
    assert.deepEqual([learn.state.openDialogId, learn.state.returnTo.label], ["dialog-auth", "Learn › Plan"]);
    const signedIn = await post({ action: "submit-sign-in", email: "alex@curriculum.io" });
    assert.deepEqual([signedIn.state.authStatus, signedIn.state.topLevel], ["authenticated", "Learn"]);
    assert.ok(clientJs.includes('root.querySelector(\'.curriculum-app-shell[data-auth-status="authenticated"]\')'));
    assert.ok(clientJs.includes("new FormData(form).forEach"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createCurriculumSignalStore provides fine-grained @preact/signals reactivity and computed views", () => {
  const store = createCurriculumSignalStore({ topLevel: "Learn", learnSubDestination: "Today" });
  assert.equal(store.topLevel.value, "Learn");
  assert.equal(store.learnSubDestination.value, "Today");
  assert.equal(store.authStatus.value, "authenticated");
  assert.equal(store.selfReportedCompletedCount.value, 0);

  store.recordTodayActivityCompletion("activity-theory", "evt-signal-test-1");
  assert.equal(store.selfReportedCompletedCount.value, 1);
  assert.equal(store.totalStudyMinutes.value, 15);
  assert.ok(store.renderedHtml.value.includes('data-self-reported-count="1"'));

  store.navigateTopLevel("Explore");
  assert.equal(store.topLevel.value, "Explore");
  assert.ok(store.renderedHtml.value.includes('data-current-top-level="Explore"'));

  store.applyUiAction("sign-out");
  assert.equal(store.authStatus.value, "guest");
  assert.equal(store.selfReportedCompletedCount.value, 0);
});

test("Curriculum and marketplace cards align CTAs via CSS subgrid and switch to a scroll-snap carousel for >3 curricula", () => {
  const stylesPath = path.join(PUBLIC_DIR, "styles.css");
  const css = fs.readFileSync(stylesPath, "utf8");

  // 1. Subgrid CTA alignment across sibling cards regardless of title/meta wrap height
  assert.match(css, /\.today-curricula-grid\s*\{[^}]*grid-template-rows:\s*repeat\(5,\s*auto\);/s);
  assert.match(css, /\.curriculum-card\s*\{[^}]*grid-row:\s*span 5;[^}]*grid-template-rows:\s*auto auto auto 1fr auto;[^}]*grid-template-rows:\s*subgrid;[^}]*align-items:\s*start;/s);
  assert.match(css, /\.marketplace-card\s*\{[^}]*grid-row:\s*span 5;[^}]*grid-template-rows:\s*auto 1fr auto auto auto;[^}]*grid-template-rows:\s*subgrid;[^}]*align-items:\s*start;/s);

  // 2. Scroll-snap carousel for >3 curricula
  assert.match(css, /\.today-curricula-grid\s*\{[^}]*grid-auto-flow:\s*column;[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-x:\s*contain;[^}]*scroll-snap-type:\s*x mandatory;/s);
  assert.match(css, /\.today-curricula-grid:has\(>\s*\.curriculum-card:nth-child\(4\)\)\s*\{[^}]*grid-auto-columns:\s*max\(16rem,\s*calc\(\(100% - 3 \* var\(--space-4\)\) \/ 3\.25\)\);/s);
  assert.match(css, /\.curriculum-card\s*\{[^}]*scroll-snap-align:\s*start;/s);

  // 3. Adopting a 4th curriculum renders 4 cards in Today and preserves rail scrollLeft across DOM updates
  const rail = { scrollLeft: 0 };
  const fakeRoot = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === ".today-curricula-grid") return rail;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };

  const mounted = mountCurriculumWebApp(fakeRoot);
  mounted.applyUiAction("open-adopt-dialog", { publicationId: "publication-rust-async-001" });
  mounted.applyUiAction("confirm-adopt-curriculum", {
    publicationId: "publication-rust-async-001",
  });
  mounted.applyUiAction("activate-revision");
  mounted.navigateTopLevel("Learn");
  mounted.navigateLearnSubDestination("Today");
  assert.equal(fakeRoot.innerHTML.match(/class="curriculum-card"/g)?.length, 4);

  rail.scrollLeft = 240;
  mounted.applyUiAction("resume-curriculum", { curriculumId: "curriculum-tolstoy-lit-003" });
  assert.equal(rail.scrollLeft, 240);
});

test("Today consolidates Edit Plan & Pacing in TomSelect and opens Unit Row Accumulation Summary when clicking a Unit cell, while Plan renders curriculum title H1, switcher cards, emphasized Goal, plain text bullets, and 4 editorial sections", () => {
  const html = renderCurriculumWebAppHtml();
  const today = html.slice(html.indexOf('id="panel-learn-today"'), html.indexOf('id="panel-learn-plan"'));
  const plan = html.slice(html.indexOf('id="panel-learn-plan"'), html.indexOf('id="panel-learn-progress"'));

  // 1. Today's Focused curriculum header consolidates Selected plan + Edit Plan & Pacing in TomSelect and omits the text-heavy Unit Map overview
  assert.ok(today.includes('data-tom-select="plan"'));
  assert.ok(today.includes('<option value="__new_curriculum__" data-action-option="new-curriculum"'));
  assert.equal(today.includes('<details class="today-curriculum-overview">'), false);

  // Clicking a Unit cell opens the InspectorDrawer in Unit mode (data-inspector-mode="unit") without verbose "Row summary" labels
  const { root, click } = mountWithClicks();
  click({ action: "select-outline-module", moduleId: "module-foundations" });
  const unitDrawer = drawerOf(root.innerHTML);
  assert.ok(unitDrawer.includes('data-open="true"'));
  assert.ok(unitDrawer.includes('data-inspector-mode="unit"'));
  assert.ok(unitDrawer.includes("Unit 1 of 2"));
  assert.equal(/Row summary|Row Accumulation Summary/i.test(root.innerHTML), false);
  assert.ok(unitDrawer.includes('<h3 id="learn-detail-inspector-unit-overview">Overview</h3>'));
  assert.ok(unitDrawer.includes('<h3 id="learn-detail-inspector-unit-activities">Activities (3)</h3>'));
  assert.ok(unitDrawer.includes('<h3 id="learn-detail-inspector-unit-objectives">Objectives (1)</h3>'));
  assert.ok(unitDrawer.includes('<h3 id="learn-detail-inspector-unit-resources">Materials (3)</h3>'));

  // 2. Plan opens with curriculum switcher cards, the curriculum title as H1, emphasized Goal, and plain text bullets
  assert.ok(plan.includes('<nav class="plan-switcher" aria-label="Your curricula">'));
  assert.ok(plan.includes('class="plan-switch" data-action="select-curriculum" data-curriculum-id="curriculum-rag-python-001" aria-current="true"'));
  assert.ok(plan.includes('<h1 class="page-title plan-title">Build and Evaluate RAG Systems in Python</h1>'));
  assert.equal(plan.includes('id="plan-curriculum-control"'), false, "Plan replaces the native <select> dropdown with curriculum switcher cards");
  assert.ok(plan.includes('<h2 id="plan-goal-label" class="plan-brief-label">Goal</h2>'));
  assert.ok(plan.includes('<p class="plan-goal">Start a Python RAG system from its model foundations: subword tokenization and scaled dot-product attention, with verified resources.</p>'));
  assert.ok(plan.includes('<h2 id="plan-covers-label" class="plan-brief-label">Covers</h2>'));
  assert.ok(plan.includes('<ul class="plan-scope-list"><li>tokenization tradeoffs</li><li>scaled dot-product attention</li><li>matrix calculus</li></ul>'));
  for (const removed of ['class="plan-scope-grid"', 'class="scope-chip"', "Out of scope", 'class="plan-metric-box"']) {
    assert.equal(plan.includes(removed), false, `Plan must not render shaded box clutter: ${removed}`);
  }

  // 3. Plan focuses on the syllabus Map/Outline (#plan-outcomes-prerequisites) without duplicating Today's sessions, flow controls, or unapplied adaptation text walls
  assert.equal(plan.includes('id="flow-plan-title"'), false, "Plan must not duplicate Today's Study Flow execution matrix");
  assert.ok(plan.includes('id="plan-outcomes-prerequisites"'), "Plan must render the outcomes & unit order section");
  for (const removedSection of [
    'id="plan-pacing-review"',
    'id="plan-learning-approach"',
    'id="plan-status-sharing"',
    "Your study sessions",
    "Tailor how this curriculum is taught",
    "Recommended syllabus adjustments",
    "Activate or share your syllabus",
  ]) {
    assert.equal(plan.includes(removedSection), false, `Plan must not render redundant text-wall section: ${removedSection}`);
  }
  assert.ok(plan.includes("What you'll learn &amp; unit order"));
  assert.ok(plan.includes('class="plan-architecture-outline"'));
  assert.ok(plan.includes('interestfor="plan-relationship-legend" popovertarget="plan-relationship-legend"'));
  assert.ok(plan.includes('<figure id="plan-relationship-legend" popover="hint" class="relationship-legend" data-opaque-surface="true">'));
  assert.ok(plan.includes('data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share with Community</button>'));
  assert.ok(plan.includes('data-action="navigate-learn-sub" data-sub-destination="Today">Resume Study<span aria-hidden="true">→</span></button>'));
  for (const jargon of ["This synthetic plan", "If-Match concurrency validation", "Backward Design", "Expertise Reversal", "Declared effort bounds", "Preview rebalanced schedule"]) {
    assert.equal(plan.includes(jargon), false, `Plan should not expose internal/academic jargon: ${jargon}`);
  }
});

test("Progress renders the Competency & Evidence Portfolio without duplicating Today's counters/Unit strip or Plan's adaptation editor", () => {
  const html = renderCurriculumWebAppHtml({ activityStates: { "activity-theory": "self_reported_completed" } });
  const progress = html.slice(html.indexOf('id="panel-learn-progress"'), html.indexOf('id="panel-learn-resources"'));

  // 1. Progress does not duplicate Today's activity/review counters, Unit strip, or Plan's adaptation review card
  assert.equal(progress.includes('class="progress-summaries"'), false, "Progress must not duplicate Today's activity/review counters");
  assert.equal(progress.includes('class="macro-stage"'), false, "Progress must not duplicate the U1/U2 Unit strip");
  assert.equal(progress.includes('class="adaptation-review"'), false, "Progress must not duplicate Plan's adaptation review card");

  // 2. Progress renders the 3 Competency & Evidence Portfolio sections
  assert.ok(progress.includes('<h1 class="page-title">Your learning evidence</h1>'));
  for (const sectionId of [
    'id="progress-capability-portfolio"',
    'id="progress-evidence-detail"',
    'id="progress-diagnostic-verification"',
  ]) {
    assert.ok(progress.includes(sectionId), `Progress is missing section ${sectionId}`);
  }

  // 3. Human-readable capability titles + plain-English evidence conclusions + Illusion-of-Competence calibration
  assert.ok(progress.includes("Analyze BPE and Unigram tokenization sequence lengths"));
  assert.ok(progress.includes("Derive scaled dot-product attention gradients and variance scaling"));
  assert.ok(progress.includes("Demonstrated under stated conditions"));
  assert.ok(progress.includes("Not assessed"));
  assert.ok(
    progress.includes("No qualifying check is recorded. Missing assessment means unknown, not low ability."),
    "Progress must clearly distinguish unassessed capability from low ability"
  );
  assert.ok(
    progress.includes("Demonstrating introductory matrix operations does not establish matrix calculus or unassessed downstream objectives."),
    "Progress must state what remains unassessed in the capability space"
  );
});

test("Resources renders a Filterable Data Table + Category Pill Bar with Synced Curriculum Switcher and All Curricula aggregation", () => {
  const { app, root, click, change } = mountWithClicks({ learnSubDestination: "Resources" });
  const resourcesOf = (html) => html.slice(html.indexOf('id="panel-learn-resources"'), html.indexOf('id="panel-explore"'));

  // 1. Default view: Current curriculum (RAG Python) with 4 resources across Course, Book, YouTube, and Code Lab
  const initialResources = resourcesOf(root.innerHTML);
  assert.ok(initialResources.includes('data-resource-scope="selected"'));
  assert.ok(initialResources.includes('data-resource-category="All"'));
  assert.ok(initialResources.includes('role="region" aria-labelledby="resources-table-caption" class="table-wrapper resources-table-wrapper"'));
  assert.ok(initialResources.includes('<table class="resources-data-table">'));
  assert.equal(initialResources.match(/class="resource-catalog-card resource-table-row"/g)?.length, 4);

  for (const cat of ["All (4)", "Course (1)", "Book (1)", "YouTube (1)", "Code Lab (1)", "Problem Set (0)"]) {
    assert.ok(initialResources.includes(`<span>${cat}</span>`), `Missing category pill count ${cat}`);
  }

  // 2. Filtering by Category ("YouTube") narrows the table to YouTube resources only
  click({ action: "set-resource-category", resourceCategory: "YouTube" });
  const youtubeResources = resourcesOf(root.innerHTML);
  assert.ok(youtubeResources.includes('data-resource-category="YouTube"'));
  assert.equal(youtubeResources.match(/class="resource-catalog-card resource-table-row"/g)?.length, 1);
  assert.ok(youtubeResources.includes("YouTube Lecture: Scaled Dot-Product Attention &amp; Softmax Variance Walkthrough"));

  // 3. Switching to "All curricula (3)" aggregates resources across RAG Python, Linear Algebra, and Tolstoy
  click({ action: "set-resource-category", resourceCategory: "All" });
  click({ action: "set-resource-scope", resourceScope: "all" });
  const allCurriculaResources = resourcesOf(root.innerHTML);
  assert.ok(allCurriculaResources.includes('data-resource-scope="all"'));
  assert.equal(allCurriculaResources.match(/class="resource-catalog-card resource-table-row"/g)?.length, 11);
  for (const cat of ["All (11)", "Course (1)", "Book (5)", "YouTube (2)", "Code Lab (2)", "Problem Set (1)"]) {
    assert.ok(allCurriculaResources.includes(`<span>${cat}</span>`), `Missing aggregated category pill count ${cat}`);
  }

  // 4. Selecting a specific curriculum in the dropdown switches back to that curriculum's resources
  change("curriculum-linear-algebra-002");
  assert.equal(app.getState().selectedCurriculumId, "curriculum-linear-algebra-002");
  assert.equal(app.getState().resourceScope, "selected");
  const laResources = resourcesOf(root.innerHTML);
  assert.equal(laResources.match(/class="resource-catalog-card resource-table-row"/g)?.length, 4);
  assert.ok(laResources.includes("Public Problem Sets with Worked Solutions: Linear Algebra"));

  // 5. Clicking a "Used in units & activities" chip opens that activity in the study inspector drawer
  click({
    action: "resume-curriculum",
    curriculumId: "curriculum-linear-algebra-002",
    activityId: "la-gate-spectral",
    moduleId: "la-module-spectral",
  });
  assert.ok(drawerOf(root.innerHTML).includes('data-open="true"'));
  assert.ok(drawerOf(root.innerHTML).includes(">Problem Set 1: Eigenvalues &amp; Projections</h2>"));

  // 6. Verify responsive-table container query and sticky header rules in styles.css
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  assert.match(css, /\.resources-table-wrapper\s*\{[^}]*container-type:\s*inline-size;/s);
  assert.match(css, /@container \(width < 600px\)\s*\{[\s\S]*?\.resources-data-table thead\s*\{\s*display:\s*none;/);
});

test("Explore and Learn share one canonical curriculum tag source data with distinct UI representations", () => {
  const { app, root, click } = mountWithClicks();
  const todayOf = (html) => html.slice(html.indexOf('id="panel-learn-today"'), html.indexOf('id="panel-learn-plan"'));
  const planOf = (html) => html.slice(html.indexOf('id="panel-learn-plan"'), html.indexOf('id="panel-learn-progress"'));

  // 1. Default curriculum (RAG Python): Today and Plan render the shared curriculum tags using Learn's metadata strip UI
  for (const panelHtml of [todayOf(root.innerHTML), planOf(root.innerHTML)]) {
    assert.ok(panelHtml.includes('class="learn-curriculum-tags" aria-label="Curriculum taxonomy and topic tags" data-category="Computer Science" data-subject="Engineering" data-difficulty="Formal" data-format="Quiz"'));
    assert.ok(panelHtml.includes('<span class="learn-tag-category">Computer Science</span><span class="learn-tag-sep" aria-hidden="true">›</span><span class="learn-tag-subject">Engineering</span>'));
    assert.equal(panelHtml.includes('data-tag-facet="difficulty"'), false);
    assert.equal(panelHtml.includes('data-tag-facet="format"'), false);
    for (const topic of ["Python", "RAG", "Attention", "Linear Algebra"]) {
      assert.ok(panelHtml.includes(`<li class="learn-topic-chip" data-tag-topic="${topic}">${topic}</li>`));
    }
  }

  // 2. Switching to Linear Algebra updates Today and Plan with Linear Algebra's shared curriculum tags (Math & Sciences › Math, Formal, Quiz, SVD)
  click({ action: "select-curriculum", curriculumId: "curriculum-linear-algebra-002" });
  for (const panelHtml of [todayOf(root.innerHTML), planOf(root.innerHTML)]) {
    assert.ok(panelHtml.includes('data-category="Math &amp; Sciences" data-subject="Mathematics" data-difficulty="Formal" data-format="Quiz"'));
    assert.ok(panelHtml.includes('<span class="learn-tag-category">Math &amp; Sciences</span><span class="learn-tag-sep" aria-hidden="true">›</span><span class="learn-tag-subject">Math</span>'));
    for (const topic of ["Linear Algebra", "Eigenvalues", "SVD"]) {
      assert.ok(panelHtml.includes(`<li class="learn-topic-chip" data-tag-topic="${topic}">${topic}</li>`));
    }
  }

  // 3. Adopting Rust Async from Explore into Learn preserves the exact same curriculum tag data across Explore and Learn
  app.navigateTopLevel("Explore");
  click({ action: "open-adopt-dialog", publicationId: "publication-rust-async-001" });
  click({ action: "confirm-adopt-curriculum", publicationId: "publication-rust-async-001" });
  for (const panelHtml of [todayOf(root.innerHTML), planOf(root.innerHTML)]) {
    assert.ok(panelHtml.includes('data-category="Computer Science" data-subject="Systems" data-difficulty="Applied" data-format="Code Lab"'));
    assert.ok(panelHtml.includes('<span class="learn-tag-category">Computer Science</span><span class="learn-tag-sep" aria-hidden="true">›</span><span class="learn-tag-subject">Systems</span>'));
    for (const topic of ["Rust", "Async", "Concurrency"]) {
      assert.ok(panelHtml.includes(`<li class="learn-topic-chip" data-tag-topic="${topic}">${topic}</li>`));
    }
  }

  // 4. curriculumTagsOf derives the canonical descriptor directly from a curriculum object
  const customTags = curriculumTagsOf({
    subject: "Physics",
    gate_style: "Problem Set Gate",
    topic_tags: ["Thermodynamics", "Ensembles"],
    instruction_preferences_applied: { math_depth: "formal", topic_math_depth_overrides: [] },
  });
  assert.deepEqual(customTags, {
    category: "Math & Sciences",
    subject: "Physics",
    subjectLabel: "Physics",
    subjectIcon: "physics",
    gateStyle: "Problem Set Gate",
    difficulty: "Formal",
    format: "Problem Set",
    topicTags: ["Thermodynamics", "Ensembles"],
  });
});

test("Study flow texts render inline LaTeX equations into accessible MathML across board cards, unit accumulation summaries, and activity inspector drawers", () => {
  const { root, click } = mountWithClicks({ selectedActivityId: "activity-example", studyDetailOpen: true });

  // 1. Study flow board card title renders inline LaTeX (\frac{1}{\sqrt{d_k}}) as MathML
  assert.match(
    root.innerHTML,
    /class="node-title"[^>]*>Worked Example: Attention Scaling Factor <span class="math-inline" data-opaque-surface="true" data-latex="\\frac\{1\}\{\\sqrt\{d_k\}\}"><math [^>]*display="inline"[\s\S]*?<mfrac>/
  );

  // 2. Activity inspector drawer renders Study focus prompt, segment title, and learning objective criterion with inline LaTeX MathML
  const activityDrawer = drawerOf(root.innerHTML);
  assert.ok(activityDrawer.includes('<h3 id="learn-detail-inspector-prompt">Study focus</h3>'));
  assert.ok(activityDrawer.includes('data-latex="QK^T"'));
  assert.ok(activityDrawer.includes('data-latex="\\mathrm{Var}(q \\cdot k) = 1"'));
  assert.ok(activityDrawer.includes("<mfrac><mrow><mn>1</mn></mrow><mrow><msqrt><mrow><msub><mi>d</mi><mi>k</mi></msub></mrow></msqrt></mrow></mfrac>"));

  // 3. Clicking the Unit 1 & Unit 2 cells opens the Unit Row Accumulation Summary with LaTeX equations across its accumulated steps
  click({ action: "select-outline-module", moduleId: "module-foundations" });
  const unit1Drawer = drawerOf(root.innerHTML);
  assert.equal(unit1Drawer.includes('data-inspector-mode="unit"'), true);
  assert.ok(unit1Drawer.includes('data-latex="\\frac{1}{\\sqrt{d_k}}"'));
  assert.ok(unit1Drawer.includes('data-latex="QK^T"'));

  click({ action: "select-outline-module", moduleId: "module-attention" });
  const unit2Drawer = drawerOf(root.innerHTML);
  assert.equal(unit2Drawer.includes('data-inspector-mode="unit"'), true);
  assert.ok(unit2Drawer.includes('data-latex="\\frac{1}{\\sqrt{d_k}}"'));

  // 4. Switching to Linear Algebra renders projection matrix P = A(A^T A)^{-1}A^T and SVD A = U\Sigma V^T in Unit and Activity Study flow texts
  click({ action: "select-curriculum", curriculumId: "curriculum-linear-algebra-002" });
  click({ action: "select-outline-module", moduleId: "la-module-spectral" });
  const laUnitDrawer = drawerOf(root.innerHTML);
  assert.ok(laUnitDrawer.includes('data-latex="P = A(A^T A)^{-1}A^T"'));
  assert.ok(laUnitDrawer.includes('data-latex="3 \\times 3"'));
});

test("New Curriculum modal runs the Step 0-4 AI pipeline with Suggested Existing Fit tray, search-bypass toggle, and polymorphic Book/YouTube indexing", () => {
  const { app, root, click } = mountWithClicks();
  app.openDialog("dialog-new-curriculum");

  const dialogOf = (html) => {
    const start = html.indexOf('<dialog id="dialog-new-curriculum"');
    return html.slice(start, html.indexOf("</dialog>", start));
  };

  // 1. First-open onboarding: #intake-goal is an empty multi-line textarea with zero mock data (no Subject, Topics, or Suggested fit until query is entered)
  const initialDialog = dialogOf(root.innerHTML);
  assert.ok(initialDialog.includes('<textarea id="intake-goal"'));
  assert.ok(initialDialog.includes('placeholder="What do you want to learn?"'));
  assert.equal(initialDialog.includes("Build and Evaluate RAG Systems in Python"), false);
  assert.equal(initialDialog.includes('id="intake-subject-select"'), false, "Subject tags are hidden before a query is entered");
  assert.equal(initialDialog.includes('id="intake-topic-select"'), false, "Topic tags are hidden before a query is entered");
  assert.equal(
    initialDialog.includes('id="intake-suggested-fit-tray"'),
    false,
    "Suggested fit tray is hidden when neither Goal nor Topics have been entered yet",
  );
  assert.equal(initialDialog.includes('class="intake-coverage-chips"'), false, "Selected topics must not be duplicated in a second chip bar");
  assert.equal(initialDialog.includes('data-action="review-generate"'), false, "Modal footer has one clear primary CTA");
  assert.equal(initialDialog.includes("Advanced &amp; billing"), false, "Internal billing jargon accordion is removed from modal");
  for (const verbose of ["Toggle [Use] to bypass", "AI Curriculum Synthesizer", "Shared tag taxonomy"]) {
    assert.equal(initialDialog.includes(verbose), false);
  }

  // 1b. Dependent tag hierarchy: Subject -> Topics -> Sub-topics with prerequisite auto-inclusion and cascading deselect
  click({ action: "toggle-intake-topic", intakeTopic: "RAG" });
  assert.deepEqual(app.getState().intakeTopics, ["Python", "RAG"], "Selecting RAG automatically includes prerequisite Python");
  const afterRagDialog = dialogOf(root.innerHTML);
  assert.ok(afterRagDialog.includes('id="intake-subject-select"'));
  assert.ok(afterRagDialog.includes('id="intake-topic-select"'));
  assert.ok(afterRagDialog.includes('data-dependent-on-subject="Engineering"'));
  assert.ok(afterRagDialog.includes('id="intake-suggested-fit-tray"'), "Selecting a topic reveals Suggested fit tray");
  assert.ok(afterRagDialog.includes("prereq"), "Auto-included prerequisite displays prereq badge");
  assert.ok(afterRagDialog.includes('id="intake-subtopics-label"'), "Selecting RAG progressively discloses Tier 3 Sub-topics");
  assert.ok(afterRagDialog.includes('data-intake-topic="Vector Indexing"'));
  assert.ok(afterRagDialog.includes('data-intake-topic="Evaluation"'));
  click({ action: "toggle-intake-topic", intakeTopic: "Vector Indexing" });
  assert.deepEqual(app.getState().intakeTopics, ["Python", "RAG", "Vector Indexing"]);
  click({ action: "toggle-intake-topic", intakeTopic: "RAG" });
  assert.deepEqual(app.getState().intakeTopics, ["Python"], "Deselecting parent RAG cascades to deselect child Vector Indexing");
  click({ action: "clear-intake-topics" });
  assert.deepEqual(app.getState().intakeTopics, []);

  // Entering a Goal also reveals Suggested fit tray with Polymorphic index previews (Book TOC + YouTube syllabus indented in .intake-material-inner)
  click({ action: "set-intake-goal", intakeGoalTitle: "Build and Evaluate RAG Systems in Python" });
  const afterGoalDialog = dialogOf(root.innerHTML);
  assert.ok(afterGoalDialog.includes('id="intake-suggested-fit-tray"'));
  assert.ok(afterGoalDialog.includes("Suggested fit"));
  assert.ok(afterGoalDialog.includes("Web search: Vector Indexing"));
  assert.ok(afterGoalDialog.includes('class="intake-material-inner"'));
  assert.ok(afterGoalDialog.includes("Chapters (3)"));
  assert.ok(afterGoalDialog.includes("978-0-262-04912-2"));
  assert.ok(afterGoalDialog.includes("Byte-Pair Encoding &amp; Unigram Likelihood"));
  assert.ok(afterGoalDialog.includes("Videos (2)"));
  assert.ok(afterGoalDialog.includes("<code>04:15</code>"));

  // 2. Switching fitMode to "use_selected_only" bypasses web search completely (0 web calls)
  click({ action: "set-intake-fit-mode", fitMode: "use_selected_only" });
  const bypassDialog = dialogOf(root.innerHTML);
  assert.ok(bypassDialog.includes('data-web-search-required="false"'));
  assert.ok(bypassDialog.includes("No web search · 3 selected"));

  // 3. Skipping an indexed resource moves it out of intakeSelectedResourceIds; clicking Use restores it
  click({ action: "skip-intake-resource", resourceId: "synthetic-resource-tokenization-v1" });
  assert.equal(app.getState().intakeSelectedResourceIds.includes("synthetic-resource-tokenization-v1"), false);
  assert.equal(app.getState().intakeSkippedResourceIds.includes("synthetic-resource-tokenization-v1"), true);
  click({ action: "toggle-intake-resource", resourceId: "synthetic-resource-tokenization-v1" });
  assert.equal(app.getState().intakeSelectedResourceIds.includes("synthetic-resource-tokenization-v1"), true);

  // 4. Switch back to "fill_gaps" and trigger Step 2-4 AI Curriculum Synthesis + Polymorphic DB Indexing
  click({ action: "set-intake-fit-mode", fitMode: "fill_gaps" });
  click({ action: "generate-curriculum-ai" });

  const afterGen = app.getState();
  assert.equal(afterGen.selectedCurriculumId, "curriculum-ai-generated-001");
  assert.equal(afterGen.learnSubDestination, "Today");
  assert.equal(afterGen.openDialogId, null);
  assert.ok(afterGen.lastPipelineReceipt);
  assert.equal(afterGen.lastPipelineReceipt.webSearchExecuted, true);
  assert.deepEqual(afterGen.lastPipelineReceipt.searchedDeltaTopics, ["Vector Indexing"]);
  assert.deepEqual(afterGen.lastPipelineReceipt.newlyIndexedResourceIds, [
    "discovered-book-hnsw-vector-v1",
    "discovered-youtube-rag-eval-playlist-v1",
  ]);
  assert.equal(afterGen.lastPipelineReceipt.bypassedCanonicalUrls.length, 15);

  // 5. Newly discovered resources are indexed into Learn › Resources with polymorphic Book and YouTube categories
  app.navigateLearnSubDestination("Resources");
  const resourcesHtml = root.innerHTML.slice(
    root.innerHTML.indexOf('id="panel-learn-resources"'),
    root.innerHTML.indexOf('id="panel-explore"')
  );
  assert.ok(resourcesHtml.includes("Book: Approximate Nearest Neighbor &amp; HNSW Vector Indexing (Vector Indexing)"));
  assert.ok(resourcesHtml.includes("YouTube Playlist: RAG Triad Evaluation, Faithfulness &amp; Context Recall Walkthrough"));

  // 6. Switching to Today shows the newly synthesized curriculum with inline LaTeX math and borderless Unit spine
  app.navigateLearnSubDestination("Today");
  assert.ok(root.innerHTML.includes('data-latex="\\mathrm{Recall}@k = \\frac{|R_k \\cap G|}{|G|}"'));
});

test("Impeccable audit guardrails: zero anti-patterns in rendered HTML detector and zero Box-in-Box, Line-Abuse, or Hierarchy-Blur violations across all views", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const gateScript = path.join(repoRoot, "scripts/impeccable-gate.mjs");
  const stylesPath = path.join(PUBLIC_DIR, "styles.css");

  // 1. Run rendered-HTML Impeccable detector + Box-in-Box + Line-Abuse + Hierarchy-Blur structural audit across all 5 views
  const gateOutput = execFileSync(
    process.execPath,
    ["--import", "tsx", gateScript],
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }
  );
  assert.ok(gateOutput.includes("0 anti-patterns, 0 advisories, 0 box-in-box / line-abuse / hierarchy-blur violations"));

  // 2. Assert no thick colored side-tab borders or nested KPI stat cards in CSS
  const css = fs.readFileSync(stylesPath, "utf8");
  assert.doesNotMatch(css, /border-(?:left|right)\s*:\s*[2-9]\d*px\s+solid/i);
  assert.equal(css.includes(".progress-kpi-card"), false);
  assert.equal(css.includes(".progress-capability-card"), false);
  assert.equal(css.includes(".progress-overview-bar"), false);

  // 3. Assert Progress panel uses borderless summary strip, explicit page-description + progress-cap-description, and indented capability contents
  const html = renderCurriculumWebAppHtml({ topLevel: "Learn", learnSubDestination: "Progress" });
  const progressPanel = html.slice(
    html.indexOf('id="panel-learn-progress"'),
    html.indexOf('id="panel-learn-resources"')
  );
  assert.ok(progressPanel.includes('class="progress-portfolio-section" id="progress-capability-portfolio"'));
  assert.equal(progressPanel.includes('class="surface-panel" id="progress-capability-portfolio"'), false);
  assert.ok(progressPanel.includes('class="page-description"'));
  assert.ok(progressPanel.includes('class="progress-overview-strip"'));
  assert.ok(progressPanel.includes('class="progress-unit-row"'));
  assert.ok(progressPanel.includes('class="progress-capability-row"'));
  assert.ok(progressPanel.includes('class="progress-cap-title-row"'));
  assert.ok(progressPanel.includes('progress-cap-description'));
  assert.equal(progressPanel.includes("progress-overview-bar"), false);
  assert.equal(progressPanel.includes("progress-kpi-card"), false);
  assert.equal(progressPanel.includes("progress-unit-group"), false);
  assert.equal(progressPanel.includes("progress-capability-card"), false);
  assert.doesNotMatch(progressPanel, /class="today-selected-eyebrow"[^>]*>[\s\S]*?<h1 class="page-title">Your learning evidence<\/h1>/);
});


