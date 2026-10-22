import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCurriculumSignalStore,
  createCurriculumWebAppController,
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
// and change a select to a value.
function mountWithClicks(initialState) {
  const listeners = {};
  const fields = {};
  const root = {
    innerHTML: "",
    addEventListener: (type, listener) => { listeners[type] = listener; },
    querySelector: (selector) => fields[selector] ?? null,
  };
  const app = mountCurriculumWebApp(root, initialState);
  const click = (dataset) => listeners.click({ target: { closest: () => ({ dataset }) } });
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
  for (const subDest of ["Today", "Plan", "Progress", "Resources"]) {
    assert.ok(
      html.includes(`data-action="navigate-learn-sub" data-sub-destination="${subDest}"`),
      `Missing Learn sub-destination button for ${subDest}`
    );
  }

  // 2. Today View: session cards, idempotent complete button, spaced-review separation, two-layer summary
  assert.ok(html.includes('data-action="complete-activity"'));
  assert.ok(html.includes('data-review-separation-valid="true"'));
  assert.ok(html.includes("Honest Two-Layer Status Summary"));
  assert.ok(html.includes('data-opaque-surface="true"'));

  // 3. Accessible MathML formula rendered on opaque surface
  assert.ok(html.includes("<math"));
  assert.ok(html.includes('aria-label="Mathematical expression:'));

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

  // 8. Settings View: theme selector, BYOK providers, Hosted Wallet & 4-Bucket Cost Breakdown, Reminders, Account Deletion modal
  for (const theme of ["light", "dark", "system"]) {
    assert.ok(html.includes(`data-theme-value="${theme}"`));
  }
  for (const provider of ["openai", "anthropic", "google_gemini"]) {
    assert.ok(html.includes(`data-provider-id="${provider}"`));
  }
  for (const bucketId of [
    "app_service_access",
    "ai_inference",
    "learning_materials",
    "certification_and_compute",
  ]) {
    assert.ok(html.includes(`data-bucket-id="${bucketId}"`));
  }
  assert.ok(html.includes("Price unknown (verify externally)"));
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
  assert.ok(exploreHtml.includes("▲ Upvote Revision (15)"));

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
  for (const removed of ["Next session", "In this session", "Why this is next", 'class="macro-stage"', 'class="status-banner"']) {
    assert.equal(today.includes(removed), false, `Today still renders ${removed}`);
  }
  assert.equal(plan.includes('class="macro-stage"'), false, "Plan still renders the unit strip");

  // Today opens with the page header and active curricula cards, then the focused curriculum header directly above its Study flow board.
  assert.match(
    today,
    /^id="panel-learn-today"[^>]*>\s*<div class="section-header today-page-header">[\s\S]*?<h1 class="page-title">Today<\/h1>[\s\S]*?data-dialog-id="dialog-new-curriculum">New Curriculum<\/button>[\s\S]*?<\/div>\s*<section class="today-curricula-grid" aria-label="Active curricula">/,
  );
  const card = today.match(/<header class="today-unified-header" data-opaque-surface="true">([\s\S]*?)<\/header>\s*<section class="flow-board"/)?.[1];
  assert.ok(card, "the focused curriculum header must sit directly above its Study flow board");
  for (const part of [
    '<h2 class="today-selected-title">Build and Evaluate RAG Systems in Python</h2>',
    '<select id="selected-plan-control" name="selected-plan" data-action="select-curriculum">',
    '<p class="next-up-progress">0/5 completed · 83m left</p>',
    '<span class="next-up-label">Next:</span><span class="next-up-title">Read Subword Tokenization &amp; Sequence Packing Notes</span><span class="next-up-time">· 15m</span>',
  ]) {
    assert.ok(card.includes(part), `the header card is missing ${part}`);
  }
  const resume = card.match(/<button type="button" class="btn-primary" data-action="([^"]+)" data-activity-id="([^"]+)" data-module-id="([^"]+)">Resume<span aria-hidden="true">→<\/span><\/button>/);
  assert.ok(resume, "Resume button is missing");

  // Clicking Resume with its own data attributes opens the drawer on that activity.
  const { root, click } = mountWithClicks({ selectedActivityId: "activity-coding" });
  click({ action: resume[1], activityId: resume[2], moduleId: resume[3] });
  const drawer = drawerOf(root.innerHTML);
  assert.ok(drawer.includes('data-open="true"'));
  assert.ok(drawer.includes(">Read Subword Tokenization &amp; Sequence Packing Notes</h2>"));

  // With every scheduled activity closed, the card offers no Resume.
  const allDone = Object.fromEntries(["activity-theory", "activity-example", "activity-coding", "activity-quiz", "activity-review", "activity-reflection"].map((id) => [id, "completed"]));
  const finished = renderCurriculumWebAppHtml({ activityStates: allDone });
  const finishedStart = finished.indexOf('<header class="today-unified-header"');
  const finishedCard = finished.slice(finishedStart, finished.indexOf("</header>", finishedStart));
  assert.ok(finishedCard.includes('<p class="next-up-progress">5/5 completed</p>'));
  assert.ok(finishedCard.includes('<p class="next-up-text">Nothing is scheduled next.</p>'));
  assert.equal(finishedCard.includes(">Resume<"), false);
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
  assert.match(css, /\.node-open\s*\{[^}]*flex-direction:\s*column;\s*justify-content:\s*space-between;/s);
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
  const next = drawer().match(/<button type="button" class="btn-primary next-step" data-action="([^"]+)" data-activity-id="([^"]+)" data-module-id="([^"]+)"><span class="next-step-text">Go to next step: Worked Example: Attention Scaling Factor 1\/sqrt\(d_k\)<\/span><span aria-hidden="true">→<\/span><\/button>/);
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
  assert.ok(drawer().includes(">Worked Example: Attention Scaling Factor 1/sqrt(d_k)</h2>"));
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

test("Study flow, Review queue, and Completed work each sit in a white surface card", () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  // Every declaration block whose selector list ends with this selector.
  const rule = (selector) => [...css.matchAll(new RegExp(`\\n${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`, "g"))].map((match) => match[1]).join("");
  for (const selector of [".flow-board", ".today-bottom-grid", ".curriculum-card"]) {
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
  const bottom = html.match(/<section class="today-bottom-grid"[^>]*>([\s\S]*)<\/section>\s*<div class="action-row">/)?.[1] ?? "";
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
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]), ids);
  assert.ok(select.includes('<option value="curriculum-rag-python-001" selected>Build and Evaluate RAG Systems in Python</option>'));

  const cardsOf = (page) => [...(page.match(/<section class="today-curricula-grid"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "").matchAll(/<article class="curriculum-card" data-curriculum-id="([^"]+)"[\s\S]*?<\/article>/g)];
  const text = (card) => card.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const cards = cardsOf(html);
  assert.deepEqual(cards.map((match) => match[1]), ids);
  assert.deepEqual(cards.map(([card]) => card.match(/<p class="domain-pill">([^<]+)<\/p>/)?.[1]), ["Engineering · Reviewed Quiz", "Mathematics · Public Quiz Bank", "Literature · Self-Check Rubric"]);
  assert.equal(text(cards[0][0]), "Engineering · Reviewed Quiz Build and Evaluate RAG Systems in Python Upcoming session: 0/3 completed · 65m left Read Subword Tokenization &amp; Sequence Packing Notes 15m Lecture Resume → Open Plan →");
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
  assert.ok(root.innerHTML.includes('<option value="curriculum-linear-algebra-002" selected>Linear Algebra &amp; Spectral Methods</option>'));
  assert.ok(todayBoard(root.innerHTML).includes('<span class="unit-title">Eigenvalues &amp; Orthogonal Projections</span>'));
  assert.match(text(cardsOf(root.innerHTML)[0][0]), /1\/3 completed · 50m left/);
  assert.ok(root.innerHTML.includes('data-study-minutes="15"'));

  // Resume on a card selects that plan and opens its next activity in the drawer.
  const resume = cardsOf(root.innerHTML)[2][0].match(/data-action="(resume-curriculum)" data-curriculum-id="([^"]+)" data-activity-id="([^"]+)" data-module-id="([^"]+)"/);
  click({ action: resume[1], curriculumId: resume[2], activityId: resume[3], moduleId: resume[4] });
  assert.equal(app.getState().selectedCurriculumId, "curriculum-tolstoy-lit-003");
  assert.ok(drawerOf(root.innerHTML).includes(">Read War and Peace: Book Three and the Opening of Book Nine</h2>"));
  assert.ok(drawerOf(root.innerHTML).includes('data-open="true"'));

  // Open Plan selects that plan and shows its Plan page. An unknown plan id is rejected.
  click({ action: "open-curriculum-plan", curriculumId: "curriculum-linear-algebra-002" });
  assert.ok(root.innerHTML.includes('data-current-learn-sub="Plan"') && root.innerHTML.includes('data-selected-module-id="la-module-spectral"'));
  assert.match(root.innerHTML, /<select id="plan-curriculum-control"[^>]*>[\s\S]*?<option value="curriculum-linear-algebra-002" selected>/);
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

test("Explore lists the community Marketplace with pills, counts, filters, sorting, and per-account votes", () => {
  const titlesOf = (html) => [...html.matchAll(/class="marketplace-title">([^<]+)</g)].map((match) => match[1]);
  const cardOf = (html, id) => html.match(new RegExp(`<article class="marketplace-card public-template-card" data-publication-id="${id}"[\\s\\S]*?</article>`))?.[0] ?? "";
  const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const html = renderCurriculumWebAppHtml({ topLevel: "Explore" });
  assert.deepEqual(titlesOf(html), [
    "Rust Async Runtime Internals", "Linear Algebra &amp; Spectral Methods", "Statistical Mechanics &amp; Thermodynamics",
    "Tolstoy's Major Novels: War &amp; Peace and Anna Karenina", "Build and Evaluate RAG Systems in Python",
  ], "Top Upvoted is the default order");

  const rust = cardOf(html, "publication-rust-async-001");
  assert.match(text(rust), /^Systems · Code Lab Gate Applied Free · \$0\.00 adopt Rust Async Runtime Internals .+ @ferris_ops · 2 units · 64 adopted Inspect Study Flow U1 · Futures, Wakers, and the Poll Model 3 activities · 95 min/);
  assert.ok(rust.includes('data-action="toggle-upvote" data-publication-id="publication-rust-async-001" data-revision-id="public-revision-rust-async-001" aria-pressed="false">▲ Upvote Revision (48)</button>'));
  assert.ok(rust.includes('data-action="open-adopt-dialog" data-publication-id="publication-rust-async-001">Preview &amp; Adopt'));
  assert.match(cardOf(html, "publication-tolstoy-001"), /<span class="domain-pill">Literature · Self-Check Rubric<\/span><span class="rigor-badge">Intuitive<\/span>/);
  // The learner's own listing and the plans they already have offer Open Plan instead of adoption.
  assert.match(cardOf(html, "publication-synthetic-001"), /<span class="owned-badge">Yours<\/span><button type="button" class="btn-secondary" data-action="open-curriculum-plan" data-curriculum-id="curriculum-rag-python-001">/);
  assert.match(cardOf(html, "publication-linear-algebra-001"), /<span class="owned-badge">In your plans<\/span>/);

  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceDomain: "Humanities" })), ["Tolstoy's Major Novels: War &amp; Peace and Anna Karenina"]);
  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceRigor: "Applied" })), ["Rust Async Runtime Internals"]);
  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceSort: "most_adopted" }))[0], "Build and Evaluate RAG Systems in Python");
  assert.deepEqual(titlesOf(renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceSort: "newest" }))[0], "Build and Evaluate RAG Systems in Python");
  const none = renderCurriculumWebAppHtml({ topLevel: "Explore", marketplaceDomain: "Systems", marketplaceRigor: "Formal" });
  assert.ok(none.includes("<span>No curricula match these filters.</span>") && titlesOf(none).length === 0);

  // The controls drive the mounted app. Search runs on submit, and unknown filter values are rejected.
  const { app, root, click, submit } = mountWithClicks({ topLevel: "Explore" });
  click({ action: "set-marketplace-domain", domain: "Mathematics" });
  assert.deepEqual(titlesOf(root.innerHTML), ["Linear Algebra &amp; Spectral Methods", "Statistical Mechanics &amp; Thermodynamics"]);
  click({ action: "set-marketplace-domain", domain: "Astrology" });
  assert.equal(app.getState().marketplaceDomain, "Mathematics");
  click({ action: "set-marketplace-domain", domain: "All" });
  submit("set-marketplace-query", { "#marketplace-search": { value: "  ferris " } });
  assert.deepEqual(titlesOf(root.innerHTML), ["Rust Async Runtime Internals"]);
  assert.ok(root.innerHTML.includes('<input id="marketplace-search" type="search" name="query" value="ferris"'));

  // A vote is one per account and revision.
  click({ action: "toggle-upvote", revisionId: "public-revision-rust-async-001" });
  assert.ok(cardOf(root.innerHTML, "publication-rust-async-001").includes('aria-pressed="true">▲ Upvote Revision (49)</button>'));
  click({ action: "toggle-upvote", revisionId: "public-revision-rust-async-001" });
  assert.ok(cardOf(root.innerHTML, "publication-rust-async-001").includes('aria-pressed="false">▲ Upvote Revision (48)</button>'));
});

test("Preview & Adopt closes prerequisites, then adds a private draft that activates on the Plan page", () => {
  const { app, root, click } = mountWithClicks({ topLevel: "Explore" });
  const dialog = () => root.innerHTML.slice(root.innerHTML.indexOf('<dialog id="dialog-partial-adoption"'), root.innerHTML.indexOf("</dialog>", root.innerHTML.indexOf('<dialog id="dialog-partial-adoption"')));
  click({ action: "open-adopt-dialog", publicationId: "publication-rust-async-001" });
  assert.ok(dialog().includes('aria-labelledby="dialog-partial-adoption-title" data-open="true"'));
  assert.match(dialog(), /U2 · Reactors, Timers, and Work Stealing<\/span><span class="adopt-unit-meta">4 activities · 110 min \(87–164 min\) · Requires U1</);
  assert.ok(dialog().includes('<p class="adopt-total">2 of 2 units · 205 min (161–303 min)</p>'));

  // Choosing units: nothing is chosen at first, and adopting needs at least one unit.
  click({ action: "set-adopt-scope", scope: "units" });
  assert.ok(dialog().includes("Select at least one unit.") && /data-action="confirm-adopt-curriculum"[^>]*disabled/.test(dialog()));
  click({ action: "toggle-adopt-module", moduleId: "rs-module-futures" });
  assert.ok(dialog().includes('<p class="adopt-total">1 of 2 units · 95 min (74–139 min)</p>'));
  click({ action: "toggle-adopt-module", moduleId: "rs-module-futures" });
  click({ action: "toggle-adopt-module", moduleId: "rs-module-scheduling" });
  // Unit 2 needs unit 1, so unit 1 is checked and marked as an automatic prerequisite.
  assert.match(dialog(), /role="checkbox" aria-checked="true" data-action="toggle-adopt-module" data-module-id="rs-module-futures">[\s\S]*?<span class="auto-badge">Auto-included prerequisite<\/span>/);
  click({ action: "toggle-adopt-module", moduleId: "rs-module-unknown" });
  assert.deepEqual(app.getState().adoptModuleIds, ["rs-module-scheduling"]);

  click({ action: "confirm-adopt-curriculum", publicationId: "publication-rust-async-001" });
  const state = app.getState();
  assert.equal(state.selectedCurriculumId, "adopted-publication-rust-async-001");
  assert.deepEqual([state.topLevel, state.learnSubDestination, state.openDialogId], ["Learn", "Plan", null]);
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

test("Share to Marketplace previews the public projection, then publishes it to Explore and My Publications", () => {
  const { app, root, click } = mountWithClicks();
  const dialog = () => root.innerHTML.slice(root.innerHTML.indexOf('<dialog id="dialog-publication-preview"'), root.innerHTML.indexOf("</dialog>", root.innerHTML.indexOf('<dialog id="dialog-publication-preview"')));
  // The default plan is already the learner's listing, so it cannot be published twice.
  app.openDialog("dialog-publication-preview");
  assert.ok(dialog().includes("This plan is already in the Marketplace as revision 1.") && !dialog().includes("confirm-publish-curriculum"));

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
  assert.equal(JSON.stringify(published[0].schedule).includes("start_at"), false, "session dates stay private");
  assert.equal(JSON.stringify(published[0].curriculum).includes("learner-default"), false, "the account id stays private");
  assert.equal(app.getState().topLevel, "Explore");
  const card = root.innerHTML.match(/<article class="marketplace-card public-template-card" data-publication-id="publication-curriculum-tolstoy-lit-003-learner-default"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(card, /@alex · based on @tolstoy_seminar · 2 units · 0 adopted[\s\S]*?▲ Upvote Revision \(0\)[\s\S]*?<span class="owned-badge">Yours<\/span>/);
  const mine = root.innerHTML.slice(root.innerHTML.indexOf('<section class="surface-panel my-publications"'));
  assert.ok(mine.includes("<li data-publication-id=\"publication-curriculum-tolstoy-lit-003-learner-default\"><strong>Tolstoy's Major Novels: War &amp; Peace and Anna Karenina</strong>"));
  app.openDialog("dialog-publication-preview");
  assert.ok(dialog().includes("This plan is already in the Marketplace as revision 1."));
});

test("the header shows the account, signing out purges private state, and guests sign in to return where they were", () => {
  const { app, root, click, submit } = mountWithClicks();
  const header = () => root.innerHTML.slice(root.innerHTML.indexOf('<div class="header-status">'), root.innerHTML.indexOf("</header>"));
  assert.match(header(), /<span class="account-pill"><span class="account-email">alex@curriculum\.io<\/span><span class="role-pill">Learner<\/span><\/span>/);
  assert.ok(header().includes('data-dialog-id="dialog-auth">Account / Switch</button>') && header().includes('data-action="sign-out">Sign out</button>'));

  click({ action: "complete-activity", activityId: "activity-theory", eventId: "evt-complete-activity-theory" });
  assert.ok(root.innerHTML.includes('data-self-reported-count="1"'));
  click({ action: "sign-out" });
  const guest = app.getState();
  assert.deepEqual([guest.authStatus, guest.topLevel, guest.recordedProgressEvents.length], ["guest", "Explore", 0]);
  assert.match(header(), /<span class="account-pill" data-auth-status="guest">Guest · Exploring<\/span>\s*<button type="button" class="btn-primary header-btn" data-action="open-dialog" data-dialog-id="dialog-auth">Sign in<\/button>/);
  // No private content reaches a guest's page, not even hidden.
  for (const hidden of ['id="panel-learn"', 'id="panel-settings"', 'id="learn-detail-inspector"', 'id="dialog-new-curriculum"', "data-self-reported-count", "My Publications"]) {
    assert.equal(root.innerHTML.includes(hidden), false, `a guest page still contains ${hidden}`);
  }

  // A protected action records where to return and asks for sign-in. Nothing is voted or opened.
  click({ action: "toggle-upvote", revisionId: "public-revision-rust-async-001" });
  assert.deepEqual([app.getState().openDialogId, app.getState().votes.length], ["dialog-auth", 0]);
  click({ action: "open-adopt-dialog", publicationId: "publication-statmech-001" });
  assert.equal(app.getState().returnTo.label, "Explore › Preview & Adopt: Statistical Mechanics & Thermodynamics");
  assert.ok(root.innerHTML.includes("After you sign in, you return to <strong>Explore › Preview &amp; Adopt: Statistical Mechanics &amp; Thermodynamics</strong>. Nothing is voted, published, adopted, or bought on your behalf."));
  submit("submit-sign-in", { "#auth-email-input": { value: "not-an-email" } });
  assert.ok(root.innerHTML.includes('<p class="field-error" role="alert">Enter a valid email address.</p>'));
  assert.equal(app.getState().authStatus, "guest");

  // Signing in restores the place and its dialog, never the action.
  submit("submit-sign-in", { "#auth-email-input": { value: "Alex@Curriculum.io" } });
  const back = app.getState();
  assert.deepEqual([back.authStatus, back.topLevel, back.openDialogId, back.adoptPublicationId, back.adoptions.length, back.votes.length],
    ["authenticated", "Explore", "dialog-partial-adoption", "publication-statmech-001", 0, 0]);
  assert.ok(root.innerHTML.includes('data-self-reported-count="0"'), "the purged completion stays gone");

  // A guest who asks for Learn returns there after sign-in.
  click({ action: "switch-persona", persona: "guest" });
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
  assert.ok(root.innerHTML.includes('<span class="account-email">ada@curriculum.io</span><span class="role-pill">Curator</span>'));
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
    assert.ok(clientJs.includes(`if (!target || target.localName === "select") return;`));
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
  assert.match(css, /\.marketplace-card\s*\{[^}]*grid-row:\s*span 6;[^}]*grid-template-rows:\s*auto auto 1fr auto auto auto;[^}]*grid-template-rows:\s*subgrid;[^}]*align-items:\s*start;/s);

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

test("Today integrates Edit Plan & Pacing transition and Unit Map overview, while Plan renders 4 educational-science sections without duplicating Study Flow", () => {
  const html = renderCurriculumWebAppHtml();
  const today = html.slice(html.indexOf('id="panel-learn-today"'), html.indexOf('id="panel-learn-plan"'));
  const plan = html.slice(html.indexOf('id="panel-learn-plan"'), html.indexOf('id="panel-learn-progress"'));

  // 1. Today's Focused curriculum header integrates Edit Plan & Pacing -> and expandable Unit Map & Syllabus Overview
  assert.ok(today.includes('data-action="navigate-learn-sub" data-sub-destination="Plan">Edit Plan &amp; Pacing<span aria-hidden="true">→</span></button>'));
  assert.ok(today.includes('<details class="today-curriculum-overview">'));
  assert.ok(today.includes("Unit Map &amp; Syllabus Overview"));

  // 2. Plan does not repeat Today's Study Flow table; it renders the 4 educational-science sections
  assert.equal(plan.includes('id="flow-plan-title"'), false, "Plan must not duplicate Today's Study Flow execution matrix");
  for (const sectionId of [
    'id="plan-outcomes-prerequisites"',
    'id="plan-pacing-review"',
    'id="plan-learning-approach"',
    'id="plan-status-sharing"',
  ]) {
    assert.ok(plan.includes(sectionId), `Plan is missing section ${sectionId}`);
  }
  assert.ok(plan.includes('class="plan-architecture-outline"'));
  assert.ok(plan.includes("Check prerequisites · about 5 min"));
  assert.ok(plan.includes("Declared effort bounds (Min / Point / Max)"));
  assert.ok(plan.includes("Preview rebalanced schedule"));
  assert.ok(plan.includes('data-action="navigate-learn-sub" data-sub-destination="Today">Resume Study<span aria-hidden="true">→</span></button>'));
});
