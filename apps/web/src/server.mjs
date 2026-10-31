/**
 * Zero-Dependency Local Development & SSR Server (`apps/web/src/server.mjs`).
 *
 * - Compiles/serves the interactive Section 9.3 web application at `http://127.0.0.1:3000`
 *   (configurable via `WEB_PORT` and `WEB_HOST`).
 * - Server-renders the initial HTML using `renderSyllabusWebAppHtml` and hydrates client
 *   interactivity in the browser via `/client.js`.
 * - Proxies `/v1/*` API calls to `API_BASE_URL` (default `http://127.0.0.1:8080`) when available,
 *   or serves deterministic synthetic state for instant local inspection.
 * - Gives each visitor a session cookie and a controller of their own. Resources that any session indexes
 *   go to one shared store, saved to `.data/web-store.json`, so every session can find them at once.
 * - Generates syllabi with a live model call when the server environment holds the provider's key
 *   (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`). Without a key the fixture provider runs.
 */

import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import {
  createSyllabusWebAppController,
  getDialogLightDismissFallbackScript,
  renderSyllabusWebAppHtml,
} from "./browserApp.ts";
import { isAdminAccount } from "./components/AdminResourcesView.tsx";
import { PERSONAS } from "./components/AuthDialog.tsx";
import { defaultUsernameOfEmail } from "./components/HeaderBar.tsx";
import catalogResourcesJson from "./data/catalogResources.json" with { type: "json" };
import { PROVIDER_KEY_ENV, requestLiveDraft } from "./liveDraft.ts";
import { analyzeManualResourceWithAi } from "./resourceAnalyzer.ts";
import {
  buildOAuthAuthorizeRedirect,
  buildOAuthCallbackUrl,
  createDevIdpCodeStore,
  exchangeLiveOAuthCode,
  generatePkcePair,
  generateRandomBase64Url,
  hashAccountPassword,
  isLocalDevEnv,
  isOAuthProvider,
  loadDotEnvIfPresent,
  oauthProviderLabel,
  renderDevOAuthConsentHtml,
  resolveProviderCredentials,
  signOAuthStateCookie,
  verifyAccountPassword,
  verifyOAuthStateCookie,
} from "./oauth.mjs";
import {
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  resolveWebAuthnRpConfig,
  toPublicPasskeySummary,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "./passkey.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnvIfPresent(path.resolve(__dirname, "../../../.env"));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const FLATPICKR_DIST_DIR = path.resolve(__dirname, "../node_modules/flatpickr/dist");
const TOM_SELECT_DIST_DIR = path.resolve(__dirname, "../node_modules/tom-select/dist");
const CROPPER_DIST_DIR = path.resolve(__dirname, "../node_modules/cropperjs/dist");
const EXAMPLES_DIR = path.resolve(
  __dirname,
  "../../../specs/001-syllabus-platform/examples"
);
const WEBAUTHN_POLYFILLS_ENTRY = path.resolve(__dirname, "../node_modules/webauthn-polyfills/esm/index.js");

let cachedWebAuthnPolyfillJs = null;
function getWebAuthnPolyfillJs() {
  if (cachedWebAuthnPolyfillJs === null) {
    const out = buildSync({
      entryPoints: [WEBAUTHN_POLYFILLS_ENTRY],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      minify: true,
    });
    cachedWebAuthnPolyfillJs = out.outputFiles[0].text;
  }
  return cachedWebAuthnPolyfillJs;
}

function buildBrowserHydrationClientJs() {
  const fallbackScript = getDialogLightDismissFallbackScript();
  return `// Syllabus.io Interactive Browser Hydration Controller
import "/vendor/webauthn-polyfills.js";
${fallbackScript}

(function hydrateSyllabusWebApp() {
  const root = document.getElementById("app");
  if (!root) return;
  const INSPECTOR_ID = "learn-detail-inspector";
  const supportsClosedBy = "closedBy" in HTMLDialogElement.prototype;
  let inspectorOpenerKey = null;

  // A selector that finds the same control again after the server re-renders the app,
  // scoped to the dialog that held it so a match behind a modal is never chosen.
  function keyFor(el) {
    if (!el || !el.attributes || !root.contains(el)) return null;
    const dialog = el.closest("dialog");
    if (el.id) return { selector: "#" + CSS.escape(el.id), dialogId: dialog ? dialog.id : null };
    const parts = Array.from(el.attributes)
      .filter((attr) => attr.name.startsWith("data-"))
      .map((attr) => "[" + attr.name + '="' + CSS.escape(attr.value) + '"]');
    if (parts.length === 0) return null;
    const kind = el.classList.length > 0 ? "." + CSS.escape(el.classList[0]) : el.localName;
    return { selector: kind + parts.join(""), dialogId: dialog ? dialog.id : null };
  }

  function focusKey(key) {
    if (!key) return false;
    const scope = key.dialogId ? document.getElementById(key.dialogId) : root;
    const match = scope && Array.from(scope.querySelectorAll(key.selector)).find((el) => el.getClientRects().length > 0);
    if (match) match.focus({ preventScroll: true });
    return Boolean(match);
  }

  // Every way a dialog closes (button, Esc, backdrop) fires "close"; tell the server once, from here.
  function bindDialogs() {
    root.querySelectorAll("dialog").forEach((dialog) => {
      if (dialog.dataset.closeBound === "true") return;
      dialog.dataset.closeBound = "true";
      dialog.addEventListener("close", () => {
        dispatchServerRender({ action: dialog.id === INSPECTOR_ID ? "close-study-detail" : "close-dialog" });
      });
      if (supportsClosedBy || dialog.getAttribute("closedby") !== "any" || dialog.dataset.lightDismissBound === "true") return;
      dialog.dataset.lightDismissBound = "true";
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside = rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
        if (!inside) dialog.close();
      });
    });
  }

  // The drawer records which activity it shows, so moving to another step starts at the top.
  function openDialogScroll() {
    const open = new Map();
    root.querySelectorAll("dialog[open]").forEach((dialog) => {
      open.set(dialog.id, { top: (dialog.querySelector("[data-scroll-region]") || dialog).scrollTop, activityId: dialog.dataset.activityId });
    });
    return open;
  }

  // The server marks the dialog to show; open it as a real modal. A dialog that was already open skips its entry slide.
  function openMarkedDialogs(previous) {
    root.querySelectorAll('dialog[data-open="true"]').forEach((dialog) => {
      if (dialog.open) return;
      const before = previous.get(dialog.id);
      if (before) dialog.setAttribute("data-instant", "");
      dialog.showModal();
      (dialog.querySelector("[data-scroll-region]") || dialog).scrollTop = before && before.activityId === dialog.dataset.activityId ? before.top : 0;
    });
  }

  function destroyDatepickers() {
    root.querySelectorAll("[data-datepicker]").forEach((el) => {
      if (el._flatpickr && typeof el._flatpickr.destroy === "function") {
        el._flatpickr.destroy();
      }
    });
  }

  function initDatepickers() {
    if (typeof window.flatpickr !== "function") return;
    root.querySelectorAll("[data-datepicker]").forEach((el) => {
      if (el._flatpickr) return;
      window.flatpickr(el, {
        enableTime: true,
        dateFormat: "Y-m-d\\TH:i",
        altInput: true,
        altFormat: "D, M j · h:i K",
        minuteIncrement: 15,
        allowInput: true,
      });
    });
  }

  function destroyPlanSelects() {
    root.querySelectorAll('[data-tom-select="plan"]').forEach((el) => {
      if (el.tomselect && typeof el.tomselect.destroy === "function") {
        el.tomselect.destroy();
      }
    });
  }

  function initPlanSelects() {
    if (typeof window.TomSelect !== "function") return;
    root.querySelectorAll('[data-tom-select="plan"]').forEach((el) => {
      if (el.tomselect || el.closest("[hidden]")) return;
      const metaByVal = {};
      Array.from(el.options).forEach((opt) => {
        metaByVal[opt.value] = {
          domain: opt.getAttribute("data-domain") || "",
          units: opt.getAttribute("data-units") || "",
          progress: opt.getAttribute("data-progress") || "",
          actionOption: opt.getAttribute("data-action-option") || "",
        };
      });
      new window.TomSelect(el, {
        controlInput: null,
        allowEmptyOption: false,
        render: {
          item: function () {
            return '<div class="ts-plan-item">' +
              '<span class="ts-plan-item-label">Switch syllabus</span>' +
              '<svg class="ts-plan-chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
            '</div>';
          },
          option: function (data, escape) {
            const m = metaByVal[data.value] || {};
            if (m.actionOption === "new-syllabus" || data.value === "__new_syllabus__") {
              return '<div class="ts-plan-option ts-plan-action-option">' +
                '<span class="ts-plan-action-title">+ New Syllabus</span>' +
              '</div>';
            }
            const metaParts = [m.domain, m.units, m.progress].filter(Boolean).join(" · ");
            return '<div class="ts-plan-option">' +
              '<span class="ts-plan-option-title">' + escape(data.text) + '</span>' +
              (metaParts ? '<span class="ts-plan-option-meta">' + escape(metaParts) + '</span>' : '') +
            '</div>';
          },
        },
        onChange: function (value) {
          if (!value) return;
          dispatchServerRender({ action: "select-syllabus", syllabusId: value });
        },
      });
    });
  }

  function destroyAvatarCropper() {
    const img = root.querySelector("#avatar-cropper-source");
    if (img && img._cropper && typeof img._cropper.destroy === "function") {
      img._cropper.destroy();
      img._cropper = null;
    }
  }

  function initAvatarCropper() {
    if (typeof window.Cropper !== "function") return;
    const dialog = root.querySelector("#dialog-avatar-cropper");
    if (!dialog || (!dialog.open && dialog.dataset.open !== "true")) return;
    const img = dialog.querySelector("#avatar-cropper-source");
    if (!img || img._cropper) return;
    const cropper = new window.Cropper(img, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: "move",
      autoCropArea: 0.85,
      guides: false,
      center: true,
      highlight: false,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
    });
    img._cropper = cropper;
    const fileInput = dialog.querySelector("#avatar-file-input");
    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = "true";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file || file.size > 5 * 1024 * 1024) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string" && img._cropper) {
            img._cropper.replace(reader.result);
          }
        };
        reader.readAsDataURL(file);
      });
    }
    const zoomRange = dialog.querySelector("#avatar-zoom-range");
    if (zoomRange && !zoomRange.dataset.bound) {
      zoomRange.dataset.bound = "true";
      zoomRange.addEventListener("input", () => {
        if (img._cropper) img._cropper.zoomTo(Number(zoomRange.value) || 1);
      });
    }
  }

  function showAuthPassword(show) {
    const input = root.querySelector("#auth-password-input");
    const eye = root.querySelector('[data-action="toggle-auth-password"]');
    if (!input || !eye) return;
    input.type = show ? "text" : "password";
    eye.setAttribute("aria-pressed", String(show));
    eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }

  // What the learner typed in the open sign-in dialog. A re-render (a mode switch or a failed submit) puts it back.
  function authDraft() {
    const dialog = root.querySelector("#dialog-auth[open]");
    if (!dialog) return null;
    const values = {};
    dialog.querySelectorAll("input[id]").forEach((input) => {
      values[input.id] = input.value;
    });
    const password = dialog.querySelector("#auth-password-input");
    return { values, passwordShown: Boolean(password && password.type === "text") };
  }

  // Restores the draft, then focuses the first field that still needs input. With every field valid after a
  // failed sign-in, the password takes focus with its text selected, ready to type again.
  // After a failed submit the form is marked, so its invalid fields show the error state. A provider error does not mark them.
  function restoreAuthDraft(draft, action) {
    const dialog = root.querySelector('#dialog-auth[data-open="true"]');
    if (!draft || !dialog) return;
    if (action === "submit-sign-in" || action === "submit-sign-up") dialog.querySelector("form").dataset.submitted = "true";
    const inputs = Array.from(dialog.querySelectorAll("input[id]"));
    inputs.forEach((input) => {
      if (draft.values[input.id] !== undefined) input.value = draft.values[input.id];
    });
    showAuthPassword(draft.passwordShown);
    const password = dialog.querySelector("#auth-password-input");
    const next = inputs.find((input) => !input.validity.valid) || password;
    if (!next) return;
    next.focus({ preventScroll: true });
    if (next === password && dialog.querySelector(".field-error")) password.select();
  }

  // Marks a sign-in control as pending until the server answers, so a second click cannot submit again.
  // The returned function clears the mark when the request fails and the dialog stays.
  function markAuthPending(control) {
    const form = control.closest("form");
    if (!form || form.dataset.pending) return null;
    form.dataset.pending = "true";
    control.setAttribute("aria-busy", "true");
    return () => {
      delete form.dataset.pending;
      control.removeAttribute("aria-busy");
    };
  }

  function applyServerPayload(payload, action, goalSnapshot) {
    if (!payload || typeof payload.html !== "string") return false;
    const activeEl = document.activeElement;
    const isGoalFocused = goalSnapshot ? goalSnapshot.isGoalFocused : Boolean(activeEl && activeEl.id === "intake-goal");
    const goalLiveValue = goalSnapshot ? goalSnapshot.goalLiveValue : (isGoalFocused ? activeEl.value : null);
    const goalSelStart = goalSnapshot ? goalSnapshot.goalSelStart : (isGoalFocused && typeof activeEl.selectionStart === "number" ? activeEl.selectionStart : null);
    const goalSelEnd = goalSnapshot ? goalSnapshot.goalSelEnd : (isGoalFocused && typeof activeEl.selectionEnd === "number" ? activeEl.selectionEnd : null);
    const focusedKey = goalSnapshot ? goalSnapshot.focusedKey : keyFor(activeEl);
    const draft = goalSnapshot ? goalSnapshot.draft : authDraft();
    const previous = openDialogScroll();
    const rail = root.querySelector(".today-syllabi-grid");
    const railLeft = rail ? rail.scrollLeft : 0;
    destroyDatepickers();
    destroyPlanSelects();
    destroyAvatarCropper();
    root.innerHTML = payload.html;
    const nextRail = root.querySelector(".today-syllabi-grid");
    if (nextRail) nextRail.scrollLeft = railLeft;
    if (payload.state && payload.state.themePreference) {
      const resolved = payload.state.themePreference === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", resolved);
    }
    bindDialogs();
    openMarkedDialogs(previous);
    initDatepickers();
    initPlanSelects();
    initAvatarCropper();
    syncPasskeyCapabilityButtons();
    maybeArmConditionalAutofill();
    if (!focusKey(focusedKey) && action === "close-study-detail") focusKey(inspectorOpenerKey);
    restoreAuthDraft(draft, action);
    if (isGoalFocused) {
      const nextGoal = root.querySelector("#intake-goal");
      if (nextGoal) {
        if (goalLiveValue !== null) nextGoal.value = goalLiveValue;
        if (goalSelStart !== null && goalSelEnd !== null && typeof nextGoal.setSelectionRange === "function") {
          nextGoal.setSelectionRange(goalSelStart, goalSelEnd);
        }
      }
    }
    return true;
  }

  async function dispatchServerRender(patch) {
    const activeEl = document.activeElement;
    const isGoalFocused = Boolean(activeEl && activeEl.id === "intake-goal");
    const goalSnapshot = {
      isGoalFocused,
      goalLiveValue: isGoalFocused ? activeEl.value : null,
      goalSelStart: isGoalFocused && typeof activeEl.selectionStart === "number" ? activeEl.selectionStart : null,
      goalSelEnd: isGoalFocused && typeof activeEl.selectionEnd === "number" ? activeEl.selectionEnd : null,
      focusedKey: keyFor(activeEl),
      draft: authDraft(),
    };
    let payload;
    try {
      const response = await fetch("/api/ui-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) return false;
      payload = await response.json();
    } catch {
      // Keep the current DOM when the local server endpoint is unreachable.
      return false;
    }
    return applyServerPayload(payload, patch.action, goalSnapshot);
  }

  // WebAuthn Passkeys: native browser APIs for registration, explicit sign-in, and Conditional UI autofill.
  let autofillAbortController = new AbortController();
  let conditionalAutofillActive = false;

  function showAuthDialogError(message) {
    const dialog = root.querySelector("#dialog-auth");
    if (!dialog) return;
    let errEl = dialog.querySelector(".field-error");
    if (!errEl) {
      errEl = document.createElement("p");
      errEl.className = "field-error";
      errEl.setAttribute("role", "alert");
      const actions = dialog.querySelector(".auth-actions");
      if (actions && actions.parentNode) actions.parentNode.insertBefore(errEl, actions);
    }
    errEl.textContent = message;
  }

  function showSettingsPasskeyNotice(message) {
    const section = root.querySelector("#settings-passkeys");
    if (!section) return;
    let noteEl = section.querySelector("#settings-passkey-notice");
    if (!noteEl) {
      noteEl = document.createElement("p");
      noteEl.id = "settings-passkey-notice";
      noteEl.className = "section-lede";
      noteEl.setAttribute("role", "status");
      const head = section.querySelector(".settings-section-head");
      if (head && head.nextSibling) section.insertBefore(noteEl, head.nextSibling);
      else section.appendChild(noteEl);
    }
    noteEl.textContent = message;
  }

  async function syncPasskeyCapabilityButtons() {
    const registerBtns = root.querySelectorAll('[data-action="register-passkey"]');
    if (registerBtns.length === 0) return;
    if (typeof window.PublicKeyCredential === "undefined" || typeof PublicKeyCredential.getClientCapabilities !== "function") {
      registerBtns.forEach((btn) => {
        btn.disabled = true;
        btn.title = "Passkeys are not supported in this browser.";
      });
      return;
    }
    try {
      const capabilities = await PublicKeyCredential.getClientCapabilities();
      const hasAuthenticator = Boolean(capabilities.passkeyPlatformAuthenticator ?? capabilities.userVerifyingPlatformAuthenticator);
      if (!hasAuthenticator || !capabilities.conditionalGet) {
        registerBtns.forEach((btn) => {
          btn.disabled = true;
          btn.title = "Passkeys require a supported platform authenticator on this device.";
        });
      }
    } catch {
      // Leave buttons enabled if capability inspection fails transiently.
    }
  }

  async function initializeConditionalAutofill() {
    if (conditionalAutofillActive) return;
    if (typeof window.PublicKeyCredential === "undefined" || typeof PublicKeyCredential.getClientCapabilities !== "function") return;
    if (window.location.hostname === "127.0.0.1") return;
    const signedIn = Boolean(root.querySelector('.syllabus-app-shell[data-auth-status="authenticated"]'));
    const authEmailInput = root.querySelector('#dialog-auth[data-auth-mode="login"] #auth-email-input');
    if (signedIn || !authEmailInput) return;

    let capabilities;
    try {
      capabilities = await PublicKeyCredential.getClientCapabilities();
    } catch {
      return;
    }
    if (capabilities.conditionalGet !== true) return;

    conditionalAutofillActive = true;
    autofillAbortController = new AbortController();
    let rpId = window.location.hostname;
    let publicKey;
    try {
      const optRes = await fetch("/auth/passkey/login/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!optRes.ok) {
        conditionalAutofillActive = false;
        return;
      }
      const optPayload = await optRes.json();
      rpId = optPayload.rpId || rpId;
      publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(optPayload.options);
    } catch {
      conditionalAutofillActive = false;
      return;
    }

    let credential;
    try {
      credential = await navigator.credentials.get({
        publicKey,
        signal: autofillAbortController.signal,
        mediation: "conditional",
      });
    } catch (err) {
      conditionalAutofillActive = false;
      if (err && ["NotAllowedError", "AbortError"].includes(err.name)) return;
      return;
    }
    conditionalAutofillActive = false;
    if (!credential) return;

    const encoded = credential.toJSON();
    try {
      const verifyRes = await fetch("/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encoded),
      });
      if (!verifyRes.ok) {
        if (verifyRes.status === 404 && PublicKeyCredential.signalUnknownCredential) {
          await PublicKeyCredential.signalUnknownCredential({
            rpId,
            credentialId: encoded.id,
          });
        }
        const errJson = await verifyRes.json().catch(() => ({}));
        showAuthDialogError(errJson.error || "Passkey sign-in could not be verified.");
        return;
      }
      const payload = await verifyRes.json();
      applyServerPayload(payload, "sign-in-passkey", null);
    } catch {
      showAuthDialogError("Passkey verification request failed.");
    }
  }

  function maybeArmConditionalAutofill() {
    const dialog = root.querySelector('#dialog-auth[data-open="true"][data-auth-mode="login"]');
    const signedIn = Boolean(root.querySelector('.syllabus-app-shell[data-auth-status="authenticated"]'));
    if (signedIn || !dialog) {
      if (conditionalAutofillActive) {
        autofillAbortController.abort();
        conditionalAutofillActive = false;
      }
      return;
    }
    initializeConditionalAutofill();
  }

  async function triggerPasskeyButtonSignIn(buttonEl) {
    if (window.location.hostname === "127.0.0.1") {
      const portPart = window.location.port ? ":" + window.location.port : "";
      window.location.assign(window.location.protocol + "//localhost" + portPart + "/?openDialog=dialog-auth");
      return;
    }
    if (typeof window.PublicKeyCredential === "undefined") {
      showAuthDialogError("Passkeys are not supported in this browser.");
      return;
    }

    // Abort any pending Conditional Get call before triggering an explicit WebAuthn prompt.
    autofillAbortController.abort();
    conditionalAutofillActive = false;
    autofillAbortController = new AbortController();

    const clear = markAuthPending(buttonEl);
    if (!clear) return;

    let rpId = window.location.hostname;
    let publicKey;
    try {
      const optRes = await fetch("/auth/passkey/login/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const optPayload = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        clear();
        showAuthDialogError(optPayload.error || "Could not start passkey sign-in.");
        return;
      }
      rpId = optPayload.rpId || rpId;
      publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(optPayload.options);
    } catch {
      clear();
      showAuthDialogError("Could not reach passkey sign-in service.");
      return;
    }

    let credential;
    try {
      credential = await navigator.credentials.get({
        publicKey,
        signal: autofillAbortController.signal,
      });
    } catch (err) {
      clear();
      if (err && err.name === "SecurityError") {
        showAuthDialogError("Passkeys require http://localhost or HTTPS.");
      } else if (!err || !["NotAllowedError", "AbortError"].includes(err.name)) {
        showAuthDialogError("No passkey was selected or available on this device.");
      }
      initializeConditionalAutofill();
      return;
    }
    if (!credential) {
      clear();
      initializeConditionalAutofill();
      return;
    }

    const encoded = credential.toJSON();
    try {
      const verifyRes = await fetch("/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encoded),
      });
      const payload = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        if (verifyRes.status === 404 && PublicKeyCredential.signalUnknownCredential) {
          await PublicKeyCredential.signalUnknownCredential({
            rpId,
            credentialId: encoded.id,
          });
        }
        clear();
        showAuthDialogError(payload.error || "Passkey could not be verified.");
        initializeConditionalAutofill();
        return;
      }
      applyServerPayload(payload, "sign-in-passkey", null);
    } catch {
      clear();
      showAuthDialogError("Passkey verification request failed.");
      initializeConditionalAutofill();
    }
  }

  async function triggerPasskeyRegistration(buttonEl, isPromotion = false) {
    if (window.location.hostname === "127.0.0.1") {
      const portPart = window.location.port ? ":" + window.location.port : "";
      window.location.assign(window.location.protocol + "//localhost" + portPart + "/?topLevel=Settings");
      return;
    }
    if (typeof window.PublicKeyCredential === "undefined" || typeof PublicKeyCredential.getClientCapabilities !== "function") {
      showSettingsPasskeyNotice("Passkeys are not supported in this browser.");
      return;
    }
    try {
      const capabilities = await PublicKeyCredential.getClientCapabilities();
      const hasAuthenticator = Boolean(capabilities.passkeyPlatformAuthenticator ?? capabilities.userVerifyingPlatformAuthenticator);
      if (!hasAuthenticator || !capabilities.conditionalGet) {
        buttonEl.disabled = true;
        showSettingsPasskeyNotice("This browser or device does not support passkey registration.");
        return;
      }
    } catch {
      // Proceed to creation prompt if capability probe fails unexpectedly.
    }

    buttonEl.disabled = true;
    buttonEl.setAttribute("aria-busy", "true");
    const resetBtn = () => {
      buttonEl.disabled = false;
      buttonEl.removeAttribute("aria-busy");
    };

    let rpId = window.location.hostname;
    let publicKey;
    try {
      const optRes = await fetch("/auth/passkey/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promotion: isPromotion }),
      });
      const optPayload = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        resetBtn();
        showSettingsPasskeyNotice(optPayload.error || "Could not start passkey registration.");
        return;
      }
      rpId = optPayload.rpId || rpId;
      publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(optPayload.options);
    } catch {
      resetBtn();
      showSettingsPasskeyNotice("Could not reach passkey registration service.");
      return;
    }

    let credential;
    try {
      credential = await navigator.credentials.create({ publicKey });
    } catch (err) {
      resetBtn();
      if (err && err.name === "InvalidStateError") {
        showSettingsPasskeyNotice("A passkey on this authenticator is already registered for your account.");
      } else if (err && err.name === "SecurityError") {
        showSettingsPasskeyNotice("Passkeys require http://localhost or HTTPS.");
      }
      return;
    }
    if (!credential) {
      resetBtn();
      return;
    }

    const encodedResponse = credential.toJSON();
    try {
      const verifyRes = await fetch("/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodedResponse),
      });
      const payload = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        if (PublicKeyCredential.signalUnknownCredential) {
          await PublicKeyCredential.signalUnknownCredential({
            rpId,
            credentialId: encodedResponse.id,
          });
        }
        resetBtn();
        showSettingsPasskeyNotice(payload.error || "Passkey registration could not be verified.");
        return;
      }
      applyServerPayload(payload, "register-passkey", null);
    } catch {
      if (PublicKeyCredential.signalUnknownCredential) {
        await PublicKeyCredential.signalUnknownCredential({
          rpId,
          credentialId: encodedResponse.id,
        }).catch(() => {});
      }
      resetBtn();
      showSettingsPasskeyNotice("Passkey verification network failure.");
    }
  }

  bindDialogs();
  openMarkedDialogs(new Map());
  initDatepickers();
  initPlanSelects();
  initAvatarCropper();
  syncPasskeyCapabilityButtons();
  maybeArmConditionalAutofill();

  document.addEventListener("click", (event) => {
    const openMenu = root.querySelector("details.navbar-user-menu[open]");
    if (openMenu && event.target && !openMenu.contains(event.target)) {
      openMenu.removeAttribute("open");
    }
  });

  // The eye button keeps focus and the caret in the password field.
  root.addEventListener("mousedown", (event) => {
    if (event.target && event.target.closest && event.target.closest('[data-action="toggle-auth-password"]')) event.preventDefault();
  });

  // Post-interaction validation for #dialog-auth and #dialog-resource-editor fields (syncs aria-invalid on blur and clears immediately when valid).
  root.addEventListener(
    "blur",
    (event) => {
      const input = event.target;
      if (
        !input ||
        (input.localName !== "input" && input.localName !== "textarea") ||
        !input.closest ||
        !input.closest("#dialog-auth, #dialog-resource-editor")
      ) {
        return;
      }
      input.dataset.interacted = "true";
      if (!input.validity.valid) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    },
    true,
  );
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (
      !input ||
      (input.localName !== "input" && input.localName !== "textarea") ||
      !input.closest ||
      !input.closest("#dialog-auth, #dialog-resource-editor")
    ) {
      return;
    }
    if (input.validity.valid) input.removeAttribute("aria-invalid");
    else if (input.dataset.interacted === "true" || input.closest("form[data-submitted]")) {
      input.setAttribute("aria-invalid", "true");
    }
  });

  // A page restored from the back-forward cache drops the pending mark of a provider link it left through.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    root.querySelectorAll("form[data-pending]").forEach((form) => delete form.dataset.pending);
    root.querySelectorAll('#dialog-auth [aria-busy="true"]').forEach((el) => el.removeAttribute("aria-busy"));
  });

  root.addEventListener("click", (event) => {
    // A provider link leaves the page for the provider. It shows as pending, and the dialog waits.
    const providerLink = event.target && event.target.closest ? event.target.closest("a[data-oauth-provider]") : null;
    if (providerLink) {
      if (!markAuthPending(providerLink)) event.preventDefault();
      return;
    }
    const target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    // A click on a select only opens its list, and a click inside a form only focuses a field.
    // The change and submit handlers below send the choice.
    if (!target || target.localName === "select" || target.localName === "form") return;
    const action = target.dataset.action;

    if (action === "open-dialog" && target.dataset.dialogId) {
      // Without a session the server answers with the sign-in dialog instead, so only open other dialogs when signed in.
      const signedIn = Boolean(root.querySelector('.syllabus-app-shell[data-auth-status="authenticated"]'));
      // The sign-in dialog opens at once only when it already shows the requested mode. Otherwise the server's render
      // opens it, so Log in never flashes the Sign up form.
      const dialog = document.getElementById(target.dataset.dialogId);
      const sameMode = !target.dataset.authMode || dialog?.dataset.authMode === target.dataset.authMode;
      if (dialog && !dialog.open && (signedIn || dialog.id === "dialog-auth") && sameMode) dialog.showModal();
      dispatchServerRender({ action: "open-dialog", dialogId: target.dataset.dialogId, authMode: target.dataset.authMode });
      return;
    }

    if (action === "toggle-auth-password") {
      event.preventDefault();
      const pwInput = root.querySelector("#auth-password-input");
      if (pwInput) showAuthPassword(pwInput.type === "password");
      return;
    }

    if (action === "sign-in-passkey") {
      event.preventDefault();
      triggerPasskeyButtonSignIn(target);
      return;
    }

    if (action === "register-passkey") {
      event.preventDefault();
      triggerPasskeyRegistration(target, target.dataset.promotion === "true");
      return;
    }

    if (action === "close-dialog" || action === "close-study-detail") {
      event.preventDefault();
      const dialog = target.closest("dialog");
      if (dialog && dialog.open) dialog.close();
      else dispatchServerRender({ action });
      return;
    }

    // Only a control outside the drawer opens it. A step button inside the drawer must not replace
    // that control, or closing the drawer would have nowhere to return focus.
    const opensDrawer = action === "select-map-node" || action === "select-outline-module" || action === "select-outline-activity" || action === "resume-syllabus";
    if (opensDrawer && !target.closest("dialog")) {
      inspectorOpenerKey = keyFor(target);
    }

    if (action === "navigate-top" && target.dataset.destination) {
      dispatchServerRender({ action: "navigate-top", destination: target.dataset.destination });
    } else if (action === "navigate-learn-sub" && target.dataset.subDestination) {
      dispatchServerRender({ action: "navigate-learn-sub", subDestination: target.dataset.subDestination });
    } else if (action === "switch-plan-view" && target.dataset.planView) {
      dispatchServerRender({ action: "switch-plan-view", planView: target.dataset.planView });
    } else if (action === "select-map-node") {
      dispatchServerRender({
        action: "select-plan-module",
        moduleId: target.dataset.moduleId || target.dataset.nodeId,
      });
    } else if (action === "select-outline-module" && target.dataset.moduleId) {
      dispatchServerRender({ action: "select-plan-module", moduleId: target.dataset.moduleId });
    } else if (action === "select-outline-activity" && target.dataset.activityId) {
      dispatchServerRender({
        action: "select-plan-activity",
        activityId: target.dataset.activityId,
        moduleId: target.dataset.moduleId,
      });
    } else if (action === "map-control" && target.dataset.mapControl) {
      dispatchServerRender({ action: "map-control", mapControl: target.dataset.mapControl });
    } else if (action === "complete-activity" && target.dataset.activityId) {
      dispatchServerRender({
        action: "complete-activity",
        activityId: target.dataset.activityId,
        eventId: target.dataset.eventId,
      });
    } else if (action === "set-theme" && target.dataset.themeValue) {
      dispatchServerRender({ action: "set-theme", themeValue: target.dataset.themeValue });
    } else if (action === "toggle-upvote") {
      dispatchServerRender({ action: "toggle-upvote", revisionId: target.dataset.revisionId });
    } else {
      const patch = Object.assign({}, target.dataset);
      if (target.closest("#dialog-new-syllabus")) {
        const goalInput = root.querySelector("#intake-goal");
        if (goalInput) patch.intakeGoalTitle = goalInput.value;
      }
      if (action === "set-resource-editor-mode") {
        const rawInput = root.querySelector("#resource-raw-input");
        if (rawInput) patch.rawText = rawInput.value;
      }
      if (action === "request-hint" || action === "study-worked-solution" || action === "submit-practice") {
        const checked = root.querySelector('input[name="practice-choice"]:checked');
        if (checked) patch.practiceChoice = checked.value;
      }
      if (action === "reschedule-session" && target.dataset.sessionId) {
        const row = target.closest(".schedule-row") || root;
        const input = row.querySelector('[data-reschedule-for="' + CSS.escape(target.dataset.sessionId) + '"]');
        patch.rescheduleValue = input ? input.value : "";
      }
      if (action === "save-avatar-crop") {
        const img = root.querySelector("#avatar-cropper-source");
        if (img && img._cropper && typeof img._cropper.getCroppedCanvas === "function") {
          const canvas = img._cropper.getCroppedCanvas({ width: 256, height: 256, imageSmoothingQuality: "high" });
          if (canvas) patch.avatarUrl = canvas.toDataURL("image/png");
        }
      }
      if (action === "generate-syllabus-ai") {
        // A live model call takes seconds. Show that it runs, and allow a retry if the request fails.
        target.disabled = true;
        target.setAttribute("aria-busy", "true");
        const label = target.querySelector("span");
        if (label) label.textContent = "Generating\u2026";
        dispatchServerRender(patch).then((ok) => {
          if (ok) return;
          target.disabled = false;
          target.removeAttribute("aria-busy");
          if (label) label.textContent = "Generate syllabus";
        });
        return;
      }
      if (action === "replace-key") {
        const providerId = target.dataset.providerId || "openai";
        const keySelector = providerId === "openai" ? "#byok-key" : "#byok-key-" + CSS.escape(providerId);
        const keyInput = root.querySelector(keySelector);
        if (keyInput) patch.keyValue = keyInput.value;
      }
      dispatchServerRender(patch);
    }
  });

  // The sign-in form, the Marketplace search, and the topic finder send their fields under the form's own data-action.
  root.addEventListener("submit", (event) => {
    const form = event.target && event.target.closest ? event.target.closest("form[data-action]") : null;
    if (!form) return;
    event.preventDefault();
    // The finder sends only a topic that its list holds. Other text gets the browser's own error message,
    // and an empty field sends nothing.
    const finder = form.querySelector("#marketplace-topic");
    if (finder) {
      const typed = finder.value.trim().toLowerCase();
      if (!typed) return;
      const known = Array.from(finder.list.options).some((option) => option.value.toLowerCase() === typed);
      finder.setCustomValidity(known ? "" : "No topic is named \u201c" + finder.value.trim() + "\u201d. Choose one from the list.");
      if (!finder.reportValidity()) return;
    }
    const patch = { action: form.dataset.action };
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") patch[key] = value;
    });
    if (form.dataset.action === "ingest-manual-resource") {
      const ingestBtn = form.querySelector("#resource-ingest-submit");
      if (ingestBtn && !ingestBtn.disabled) {
        ingestBtn.disabled = true;
        ingestBtn.setAttribute("aria-busy", "true");
        const label = ingestBtn.querySelector("span");
        if (label) label.textContent = "Analyzing & indexing\u2026";
        dispatchServerRender(patch).then((ok) => {
          if (ok) return;
          ingestBtn.disabled = false;
          ingestBtn.removeAttribute("aria-busy");
          if (label) label.textContent = "Analyze & add resource";
        });
        return;
      }
    }
    const submitButton = form.closest("#dialog-auth") ? form.querySelector('button[type="submit"]:not([data-action])') : null;
    if (!submitButton) {
      dispatchServerRender(patch);
      return;
    }
    const clear = markAuthPending(submitButton);
    if (clear) dispatchServerRender(patch).then((ok) => ok || clear());
  });

  // A topic picked from the finder's list applies at once. A pick fires an input event with no inputType or with
  // insertReplacementText. Typed text fires insertText and waits for Enter.
  let goalInputTimer = null;
  root.addEventListener("input", (event) => {
    if (event.target && event.target.id === "intake-goal") {
      if (goalInputTimer) clearTimeout(goalInputTimer);
      const val = event.target.value;
      goalInputTimer = setTimeout(() => {
        dispatchServerRender({ action: "set-intake-goal", intakeGoalTitle: val });
      }, 150);
      return;
    }
    if (event.target.id !== "marketplace-topic") return;
    event.target.setCustomValidity("");
    if (!event.inputType || event.inputType === "insertReplacementText") event.target.form.requestSubmit();
  });

  root.addEventListener("change", (event) => {
    const select = event.target && event.target.closest ? event.target.closest('select[data-action="select-syllabus"]') : null;
    if (select) {
      dispatchServerRender({ action: "select-syllabus", syllabusId: select.value });
      return;
    }
    const resourceCurrSelect = event.target && event.target.closest ? event.target.closest('select[data-action="set-resource-editor-syllabus"]') : null;
    if (resourceCurrSelect) {
      const rawInput = root.querySelector("#resource-raw-input");
      dispatchServerRender({
        action: "set-resource-editor-syllabus",
        targetSyllabusId: resourceCurrSelect.value,
        rawText: rawInput ? rawInput.value : undefined,
      });
      return;
    }
    const subjectSelect = event.target && event.target.closest ? event.target.closest('select[data-action="set-intake-subject"]') : null;
    if (subjectSelect && subjectSelect.value) {
      const goalInput = root.querySelector("#intake-goal");
      dispatchServerRender({
        action: "set-intake-subject",
        intakeSubject: subjectSelect.value,
        intakeGoalTitle: goalInput ? goalInput.value : undefined,
      });
      return;
    }
    const topicSelect = event.target && event.target.closest ? event.target.closest('select[data-action="toggle-intake-topic"]') : null;
    if (topicSelect && topicSelect.value) {
      const goalInput = root.querySelector("#intake-goal");
      dispatchServerRender({
        action: "toggle-intake-topic",
        intakeTopic: topicSelect.value,
        intakeGoalTitle: goalInput ? goalInput.value : undefined,
      });
    }
  });

  root.addEventListener("keydown", (event) => {
    const inMapNode = event.target && event.target.closest ? event.target.closest(".map-node") : null;
    if (!inMapNode) return;
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      dispatchServerRender({ action: "map-keyboard", key: event.key });
    }
  });
})();
`;
}

function readSyntheticExampleOrFallback(fileName, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(EXAMPLES_DIR, fileName), "utf8")
    );
  } catch {
    return fallback;
  }
}

function proxyOrFallbackApiRequest(req, res, apiBaseUrl) {
  const targetUrl = new URL(req.url ?? "/v1/health", apiBaseUrl);
  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
      timeout: 1500,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", () => {
    // Fallback deterministic synthetic state when local Rust API is not running
    const urlPath = (req.url ?? "").split("?")[0];
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Syllabus-Synthetic-Fallback", "true");

    if (urlPath.includes("/schedule")) {
      res.writeHead(200);
      res.end(
        JSON.stringify(
          readSyntheticExampleOrFallback("schedule.synthetic.json", {
            status: "ok",
          })
        )
      );
      return;
    }
    if (urlPath.includes("/proficiency")) {
      res.writeHead(200);
      res.end(
        JSON.stringify(
          readSyntheticExampleOrFallback("proficiency.synthetic.json", {
            status: "ok",
          })
        )
      );
      return;
    }
    if (urlPath.includes("/syllabi")) {
      res.writeHead(200);
      res.end(
        JSON.stringify(
          readSyntheticExampleOrFallback("syllabus.synthetic.json", {
            status: "ok",
          })
        )
      );
      return;
    }
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: "synthetic_fallback_ready",
        path: urlPath,
      })
    );
  });

  req.pipe(proxyReq);
}

const SESSION_COOKIE = "cio_sid";
const OAUTH_STATE_COOKIE = "cio_oauth";

// The shared store: resources indexed by any session, registered user accounts, linked OAuth identities, and each session's state.
// With a storePath it is one JSON file that survives a restart. Without one it lives in memory.
function openStore(storePath) {
  const saved = storePath && fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : {};
  const data = {
    resources: { ...catalogResourcesJson.global_discovered_resources, ...saved.resources },
    accounts: saved.accounts ?? {},
    oauthIdentities: saved.oauthIdentities ?? {},
    passkeys: saved.passkeys ?? {},
    sessions: saved.sessions ?? {},
  };
  return {
    data,
    save() {
      if (!storePath) return;
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(data));
    },
  };
}

function cookieOf(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === name) return value;
  }
  return undefined;
}

function appendSetCookie(res, cookieHeaderValue) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", [cookieHeaderValue]);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev.map(String), cookieHeaderValue]);
  } else {
    res.setHeader("Set-Cookie", [String(prev), cookieHeaderValue]);
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function defaultRoleForEmail(email) {
  if (email === "ada@syllabus.io" || email === "curator@example.test") return "Curator";
  if (email === "mo@syllabus.io" || email === "moderator@example.test") return "Moderator";
  return "Learner";
}

async function syncBackendAuth(apiBaseUrl, endpointPath, payload, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, "")}${endpointPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function createWebAppServer(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiBaseUrl =
    options.apiBaseUrl ?? env.API_BASE_URL ?? "http://127.0.0.1:8080";
  const oauthSecret =
    options.oauthCookieSecret ?? env.OAUTH_COOKIE_SECRET ?? crypto.randomBytes(32).toString("hex");
  const store = openStore(options.storePath);
  const devIdpCodes = createDevIdpCodeStore();
  // ponytail: sessions live until the process exits. Add an idle timeout if the server ever faces real traffic.
  const controllers = new Map();
  const passkeyCeremonies = new Map();

  function passkeysForAccount(accountId) {
    return Object.values(store.data.passkeys)
      .filter((pk) => pk && pk.passkeyUserId === accountId)
      .sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
  }

  function syncControllerPasskeys(controller, notice = undefined) {
    const { authStatus, account } = controller.getState();
    if (authStatus !== "authenticated") {
      controller.setPasskeys([], null);
      return;
    }
    controller.setPasskeys(passkeysForAccount(account.accountId).map(toPublicPasskeySummary), notice);
  }

  function ensureStoredAccountRecord(account) {
    const email = account.email.trim().toLowerCase();
    const existing = store.data.accounts[email];
    if (existing) {
      if (!existing.username) existing.username = account.username ?? defaultUsernameOfEmail(email);
      return existing;
    }
    const record = {
      accountId: account.accountId,
      email,
      username: account.username ?? defaultUsernameOfEmail(email),
      ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
      role: account.role ?? defaultRoleForEmail(email),
      oauthProviders: [],
    };
    store.data.accounts[email] = record;
    store.save();
    return record;
  }

  function resolveAccountForPasskey(storedCred) {
    const byId = Object.values(store.data.accounts).find((a) => a && a.accountId === storedCred.passkeyUserId);
    if (byId) {
      return {
        accountId: byId.accountId,
        email: byId.email,
        username: byId.username ?? defaultUsernameOfEmail(byId.email),
        ...(byId.avatarUrl ? { avatarUrl: byId.avatarUrl } : {}),
        role: byId.role ?? defaultRoleForEmail(byId.email),
      };
    }
    const persona = Object.values(PERSONAS).find((p) => p.accountId === storedCred.passkeyUserId || p.email === storedCred.email);
    if (persona) return persona;
    const email = (storedCred.email || "learner@syllabus.io").trim().toLowerCase();
    return {
      accountId: storedCred.passkeyUserId,
      email,
      username: defaultUsernameOfEmail(email),
      role: defaultRoleForEmail(email),
    };
  }

  function publicOriginOf(req) {
    if (options.publicOrigin) return options.publicOrigin;
    const hostHeader = req.headers.host;
    if (hostHeader && isLocalDevEnv(env)) {
      const hostOnly = hostHeader.split(":")[0]?.toLowerCase();
      if (hostOnly === "localhost" || hostOnly === "127.0.0.1" || hostOnly === "[::1]") {
        return `http://${hostHeader}`;
      }
    }
    if (env.PUBLIC_WEB_ORIGIN?.trim()) return env.PUBLIC_WEB_ORIGIN.trim();
    return `http://${hostHeader || "localhost:3000"}`;
  }

  // An unknown or missing cookie gets a new random session, so a client cannot choose its session id.
  function sessionFor(req, res) {
    let sid = cookieOf(req, SESSION_COOKIE);
    if (!sid || !(controllers.has(sid) || store.data.sessions[sid])) {
      sid = crypto.randomUUID();
      appendSetCookie(res, `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
    }
    let controller = controllers.get(sid);
    if (!controller) {
      controller = createSyllabusWebAppController({ ...options.initialState, ...store.data.sessions[sid] });
      controllers.set(sid, controller);
    }
    controller.syncCatalogResources(
      store.data.resources,
      controller.getState().adminRemovedResourceIds,
    );
    syncControllerPasskeys(controller);
    return { sid, controller };
  }

  // Saves the resources this session indexed/edited/deleted, its auth identity, and its syllabi mutations when changed.
  function persist(sid, controller) {
    const {
      catalogResources,
      generatedPlans,
      syllabusOverrides,
      userLibraryResourceIds,
      adminRemovedResourceIds,
      authStatus,
      account,
    } = controller.getState();
    const userLibSet = new Set(userLibraryResourceIds);
    let resourcesChanged = false;
    for (const [id, entry] of Object.entries(catalogResources)) {
      if (id.startsWith("discovered-") || id.startsWith("manual-") || userLibSet.has(id)) {
        if (JSON.stringify(store.data.resources[id]) !== JSON.stringify(entry)) {
          store.data.resources[id] = entry;
          resourcesChanged = true;
        }
      }
    }
    for (const removedId of adminRemovedResourceIds) {
      if (removedId in store.data.resources) {
        delete store.data.resources[removedId];
        resourcesChanged = true;
      }
    }
    const nextSessionSnapshot = {
      generatedPlans,
      syllabusOverrides,
      userLibraryResourceIds,
      adminRemovedResourceIds,
      authStatus,
      account,
    };
    const prevSnapshot = store.data.sessions[sid];
    const sessionChanged = JSON.stringify(nextSessionSnapshot) !== JSON.stringify(prevSnapshot);
    if (!resourcesChanged && !sessionChanged) return;
    store.data.sessions[sid] = nextSessionSnapshot;
    store.save();
  }

  const backendTokenByEmail = new Map();
  async function syncBackendResourceEndpoint(email, method, endpointPath, payload) {
    if (!email) return null;
    const base = apiBaseUrl.replace(/\/+$/, "");
    try {
      let token = backendTokenByEmail.get(email);
      if (!token) {
        const sessRes = await fetchImpl(`${base}/v1/auth/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, authentication_code: "123456" }),
        });
        if (!sessRes.ok) return null;
        const sessJson = await sessRes.json();
        token = sessJson?.session_token;
        if (typeof token === "string" && token) backendTokenByEmail.set(email, token);
      }
      if (!token) return null;
      const res = await fetchImpl(`${base}${endpointPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
      if (!res.ok) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  async function runServerManualResourceAnalysis(controller, data) {
    const aiModel = controller.designatedAiModel();
    const apiKey = aiModel ? env[PROVIDER_KEY_ENV[aiModel.providerId]] : undefined;
    return analyzeManualResourceWithAi({
      rawText: data.rawText ?? "",
      explicitUrl: data.explicitUrl,
      providerId: aiModel?.providerId,
      modelId: aiModel?.modelId,
      apiKey,
      fetchImpl,
    });
  }

  function resolveOrCreateOAuthAccount(profile, backendAccountId) {
    const identityKey = `${profile.provider}:${profile.providerSubject}`;
    const linkedEmail = store.data.oauthIdentities[identityKey];
    const email = profile.email.trim().toLowerCase();
    const existing = (linkedEmail && store.data.accounts[linkedEmail]) || (profile.emailVerified ? store.data.accounts[email] : undefined);
    const persona = Object.values(PERSONAS).find((p) => p.email === email);

    const providers = Array.from(new Set([...(existing?.oauthProviders ?? []), profile.provider]));
    const record = {
      accountId: existing?.accountId ?? backendAccountId ?? persona?.accountId ?? `usr-${crypto.randomUUID().slice(0, 12)}`,
      email,
      username: existing?.username ?? persona?.username ?? defaultUsernameOfEmail(email),
      avatarUrl: existing?.avatarUrl ?? profile.avatarUrl,
      role: existing?.role ?? persona?.role ?? defaultRoleForEmail(email),
      passwordHash: existing?.passwordHash,
      oauthProviders: providers,
    };
    store.data.accounts[email] = record;
    store.data.oauthIdentities[identityKey] = email;
    store.save();
    return {
      accountId: record.accountId,
      email: record.email,
      username: record.username,
      ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
      role: record.role,
    };
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith("/v1/")) {
      proxyOrFallbackApiRequest(req, res, apiBaseUrl);
      return;
    }

    if (pathname === "/auth/providers" && req.method === "GET") {
      const origin = publicOriginOf(req);
      const localDev = isLocalDevEnv(env);
      const providers = ["google", "github"].map((p) => {
        const live = Boolean(resolveProviderCredentials(p, env));
        return {
          provider: p,
          display_name: oauthProviderLabel(p),
          configured_live: live,
          dev_sandbox_enabled: !live && localDev,
          start_path: `/auth/oauth/${p}`,
          callback_url: buildOAuthCallbackUrl(origin, p),
        };
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ providers, email_password_enabled: true, passkey_enabled: true }));
      return;
    }

    const oauthStartMatch = pathname.match(/^\/auth\/oauth\/(google|github)$/);
    if (oauthStartMatch && req.method === "GET") {
      const provider = oauthStartMatch[1];
      if (isOAuthProvider(provider)) {
        const { sid, controller } = sessionFor(req, res);
        try {
          const state = generateRandomBase64Url(24);
          const { codeVerifier, codeChallenge } = generatePkcePair();
          const redirect = buildOAuthAuthorizeRedirect({
            provider,
            publicOrigin: publicOriginOf(req),
            state,
            codeChallenge,
            env,
          });
          const signedCookie = signOAuthStateCookie(
            { state, provider, codeVerifier, exp: Date.now() + 10 * 60 * 1000 },
            oauthSecret,
          );
          appendSetCookie(
            res,
            `${OAUTH_STATE_COOKIE}=${signedCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
          );
          persist(sid, controller);
          res.writeHead(302, { Location: redirect.url, "Cache-Control": "no-store" });
          res.end();
        } catch (err) {
          controller.failExternalAuth(err instanceof Error ? err.message : String(err));
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
        }
        return;
      }
    }

    const devIdpMatch = pathname.match(/^\/auth\/dev-idp\/(google|github)\/authorize$/);
    if (devIdpMatch && isLocalDevEnv(env)) {
      const provider = devIdpMatch[1];
      if (isOAuthProvider(provider)) {
        if (req.method === "GET") {
          const redirectUri = parsedUrl.searchParams.get("redirect_uri") ?? buildOAuthCallbackUrl(publicOriginOf(req), provider);
          const state = parsedUrl.searchParams.get("state") ?? "";
          const codeChallenge = parsedUrl.searchParams.get("code_challenge") ?? "";
          // The chooser follows the session's theme, so leaving the app for it keeps the same light or dark surface.
          const theme = sessionFor(req, res).controller.getState().themePreference === "dark" ? "dark" : "light";
          const html = renderDevOAuthConsentHtml({ provider, redirectUri, state, codeChallenge, theme });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(html);
          return;
        }
        if (req.method === "POST") {
          const rawBody = await readRequestBody(req);
          const form = new URLSearchParams(rawBody);
          const redirectUri = form.get("redirect_uri") ?? buildOAuthCallbackUrl(publicOriginOf(req), provider);
          const state = form.get("state") ?? "";
          const codeChallenge = form.get("code_challenge") ?? "";
          const email = (form.get("email") ?? "").trim().toLowerCase();
          const displayName = (form.get("display_name") ?? "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !codeChallenge) {
            const errUrl = new URL(redirectUri);
            errUrl.searchParams.set("error", "invalid_request");
            if (state) errUrl.searchParams.set("state", state);
            res.writeHead(302, { Location: errUrl.toString(), "Cache-Control": "no-store" });
            res.end();
            return;
          }
          const subjectHash = crypto.createHash("sha256").update(`${provider}:${email}`).digest("hex").slice(0, 24);
          const code = devIdpCodes.issueCode({
            provider,
            codeChallenge,
            redirectUri,
            profile: {
              provider,
              providerSubject: `dev-${provider}-${subjectHash}`,
              email,
              emailVerified: true,
              displayName: displayName || undefined,
            },
          });
          const cbUrl = new URL(redirectUri);
          cbUrl.searchParams.set("code", code);
          cbUrl.searchParams.set("state", state);
          res.writeHead(302, { Location: cbUrl.toString(), "Cache-Control": "no-store" });
          res.end();
          return;
        }
      }
    }

    const oauthCallbackMatch = pathname.match(/^\/auth\/oauth\/(google|github)\/callback$/);
    if (oauthCallbackMatch && req.method === "GET") {
      const provider = oauthCallbackMatch[1];
      if (isOAuthProvider(provider)) {
        const { sid, controller } = sessionFor(req, res);
        appendSetCookie(res, `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

        const oauthCookie = verifyOAuthStateCookie(cookieOf(req, OAUTH_STATE_COOKIE), oauthSecret);
        const queryState = parsedUrl.searchParams.get("state") ?? "";
        const queryError = parsedUrl.searchParams.get("error");
        const code = parsedUrl.searchParams.get("code") ?? "";

        if (queryError) {
          const msg =
            queryError === "access_denied"
              ? `${oauthProviderLabel(provider)} sign-in was canceled.`
              : `${oauthProviderLabel(provider)} sign-in failed (${queryError}).`;
          controller.failExternalAuth(msg);
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
          return;
        }

        if (!oauthCookie || oauthCookie.provider !== provider || oauthCookie.state !== queryState || !code) {
          controller.failExternalAuth("Your sign-in session expired or did not match. Try again.");
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
          return;
        }

        try {
          const redirectUri = buildOAuthCallbackUrl(publicOriginOf(req), provider);
          const profile =
            code.startsWith("devcode_") && isLocalDevEnv(env)
              ? devIdpCodes.exchangeCode({
                  provider,
                  code,
                  codeVerifier: oauthCookie.codeVerifier,
                  redirectUri,
                })
              : await exchangeLiveOAuthCode({
                  provider,
                  code,
                  codeVerifier: oauthCookie.codeVerifier,
                  redirectUri,
                  env,
                  fetchImpl,
                });

          const backendSession = await syncBackendAuth(
            apiBaseUrl,
            `/v1/auth/oauth/${provider}/callback`,
            {
              provider_subject: profile.providerSubject,
              email: profile.email,
              email_verified: profile.emailVerified,
              display_name: profile.displayName ?? null,
              avatar_url: profile.avatarUrl ?? null,
            },
            fetchImpl,
          );
          const resolvedAccount = resolveOrCreateOAuthAccount(profile, backendSession?.account_id);
          controller.completeExternalAuth(resolvedAccount);
          syncControllerPasskeys(controller, null);
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
        } catch (err) {
          controller.failExternalAuth(
            `${oauthProviderLabel(provider)} sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
        }
        return;
      }
    }

    if (pathname === "/auth/passkey/register/options" && req.method === "POST") {
      const { sid, controller } = sessionFor(req, res);
      const { authStatus, account } = controller.getState();
      if (authStatus !== "authenticated") {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Sign in before registering a passkey." }));
        return;
      }
      try {
        const rawBody = await readRequestBody(req);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const rpConfig = resolveWebAuthnRpConfig(req, env, options.publicOrigin);
        ensureStoredAccountRecord(account);
        const existingCredentials = passkeysForAccount(account.accountId);
        const { options: regOptions, ceremony } = await createPasskeyRegistrationOptions({
          ...rpConfig,
          account,
          existingCredentials,
          promotion: Boolean(body.promotion),
        });
        passkeyCeremonies.set(`${sid}:reg`, ceremony);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ options: regOptions, rpId: rpConfig.rpID }));
      } catch (err) {
        const status = err && err.code === "WEBAUTHN_IP_ORIGIN" ? 400 : 400;
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            ...(err && err.localhostOrigin ? { localhostOrigin: err.localhostOrigin } : {}),
          }),
        );
      }
      return;
    }

    if (pathname === "/auth/passkey/register/verify" && req.method === "POST") {
      const { sid, controller } = sessionFor(req, res);
      const { authStatus, account } = controller.getState();
      if (authStatus !== "authenticated") {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Sign in before registering a passkey." }));
        return;
      }
      const ceremony = passkeyCeremonies.get(`${sid}:reg`);
      passkeyCeremonies.delete(`${sid}:reg`);
      try {
        const rawBody = await readRequestBody(req);
        const attestationResponse = rawBody ? JSON.parse(rawBody) : null;
        const { storedCredential } = await verifyPasskeyRegistration({
          response: attestationResponse,
          ceremony,
          account,
        });
        ensureStoredAccountRecord(account);
        store.data.passkeys[storedCredential.id] = storedCredential;
        store.save();
        syncControllerPasskeys(controller, `Added ${storedCredential.name} for passwordless sign-in.`);
        persist(sid, controller);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(
          JSON.stringify({
            verified: true,
            credential: toPublicPasskeySummary(storedCredential),
            state: controller.getState(),
            html: controller.renderHtml(),
          }),
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (pathname === "/auth/passkey/login/options" && req.method === "POST") {
      const { sid } = sessionFor(req, res);
      try {
        await readRequestBody(req);
        const rpConfig = resolveWebAuthnRpConfig(req, env, options.publicOrigin);
        const { options: authOptions, ceremony } = await createPasskeyAuthenticationOptions(rpConfig);
        passkeyCeremonies.set(`${sid}:auth`, ceremony);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ options: authOptions, rpId: rpConfig.rpID }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            ...(err && err.localhostOrigin ? { localhostOrigin: err.localhostOrigin } : {}),
          }),
        );
      }
      return;
    }

    if (pathname === "/auth/passkey/login/verify" && req.method === "POST") {
      const { sid, controller } = sessionFor(req, res);
      const ceremony = passkeyCeremonies.get(`${sid}:auth`);
      passkeyCeremonies.delete(`${sid}:auth`);
      try {
        const rawBody = await readRequestBody(req);
        const assertionResponse = rawBody ? JSON.parse(rawBody) : null;
        const result = await verifyPasskeyAuthentication({
          response: assertionResponse,
          ceremony,
          lookupCredentialById: (id) => store.data.passkeys[id],
        });
        if (!result.verified) {
          res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        result.storedCredential.counter = result.authenticationInfo.newCounter;
        result.storedCredential.credentialBackedUp = Boolean(result.authenticationInfo.credentialBackedUp);
        result.storedCredential.lastUsedAt = Date.now();
        store.save();

        const resolvedAccount = resolveAccountForPasskey(result.storedCredential);
        controller.completeExternalAuth(resolvedAccount);
        syncControllerPasskeys(controller, null);
        persist(sid, controller);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(
          JSON.stringify({
            verified: true,
            state: controller.getState(),
            html: controller.renderHtml(),
          }),
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (pathname === "/favicon.svg" || pathname === "/favicon.ico") {
      const svg = fs.readFileSync(path.join(PUBLIC_DIR, "favicon.svg"), "utf8");
      res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(svg);
      return;
    }

    if (pathname === "/apple-touch-icon.png") {
      const png = fs.readFileSync(path.join(PUBLIC_DIR, "apple-touch-icon.png"));
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(png);
      return;
    }

    if (pathname === "/vendor/webauthn-polyfills.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(getWebAuthnPolyfillJs());
      return;
    }

    if (pathname === "/vendor/flatpickr.min.css") {
      const css = fs.readFileSync(path.join(FLATPICKR_DIST_DIR, "flatpickr.min.css"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(css);
      return;
    }

    if (pathname === "/vendor/flatpickr.min.js") {
      const js = fs.readFileSync(path.join(FLATPICKR_DIST_DIR, "flatpickr.min.js"), "utf8");
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(js);
      return;
    }

    if (pathname === "/vendor/tom-select.min.css") {
      const css = fs.readFileSync(path.join(TOM_SELECT_DIST_DIR, "css/tom-select.min.css"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(css);
      return;
    }

    if (pathname === "/vendor/tom-select.complete.min.js") {
      const js = fs.readFileSync(path.join(TOM_SELECT_DIST_DIR, "js/tom-select.complete.min.js"), "utf8");
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(js);
      return;
    }

    if (pathname === "/vendor/cropper.min.css") {
      const css = fs.readFileSync(path.join(CROPPER_DIST_DIR, "cropper.min.css"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(css);
      return;
    }

    if (pathname === "/vendor/cropper.min.js") {
      const js = fs.readFileSync(path.join(CROPPER_DIST_DIR, "cropper.min.js"), "utf8");
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(js);
      return;
    }

    if (pathname === "/styles.css") {
      const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(css);
      return;
    }

    if (pathname === "/client.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(buildBrowserHydrationClientJs());
      return;
    }

    if (pathname === "/api/resources/manual" && req.method === "POST") {
      const { sid, controller } = sessionFor(req, res);
      try {
        const rawBody = await readRequestBody(req);
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const data = {
          rawText: typeof payload.rawText === "string" ? payload.rawText : (typeof payload.raw_text === "string" ? payload.raw_text : ""),
          explicitUrl: typeof payload.explicitUrl === "string" ? payload.explicitUrl : (typeof payload.url === "string" ? payload.url : undefined),
          targetSyllabusId:
            typeof payload.targetSyllabusId === "string"
              ? payload.targetSyllabusId
              : "__library_only__",
          targetModuleId: typeof payload.targetModuleId === "string" ? payload.targetModuleId : undefined,
          role: typeof payload.role === "string" ? payload.role : "primary",
        };
        const analyzedOutcome = await runServerManualResourceAnalysis(controller, data);
        if ("error" in analyzedOutcome) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: analyzedOutcome.error }));
          return;
        }
        controller.applyUiAction("ingest-manual-resource", data, null, null, analyzedOutcome);
        const nextState = controller.getState();
        if (nextState.authStatus === "authenticated") {
          await syncBackendResourceEndpoint(nextState.account.email, "POST", "/v1/catalog/resources/manual", {
            raw_text: data.rawText,
            url: analyzedOutcome.canonicalUrl,
            title_override: analyzedOutcome.title,
          });
        }
        persist(sid, controller);
        res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            analyzedDraft: analyzedOutcome,
            resource: nextState.catalogResources[analyzedOutcome.resourceVersionId],
            state: nextState,
          }),
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (pathname === "/api/ui-state" && req.method === "POST") {
      const { sid, controller } = sessionFor(req, res);
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const cmd = body ? JSON.parse(body) : {};
          if (cmd.action === "navigate-top" && cmd.destination) {
            controller.navigateTopLevel(cmd.destination);
          } else if (cmd.action === "navigate-learn-sub" && cmd.subDestination) {
            controller.navigateLearnSubDestination(cmd.subDestination);
          } else if (cmd.action === "switch-plan-view" && cmd.planView) {
            controller.switchPlanView(cmd.planView);
          } else if (cmd.action === "select-plan-module" && cmd.moduleId) {
            controller.selectPlanModule(cmd.moduleId);
          } else if (cmd.action === "select-plan-activity" && cmd.activityId) {
            controller.selectPlanActivity(cmd.activityId, cmd.moduleId);
          } else if (cmd.action === "map-control" && cmd.mapControl) {
            controller.applyMapControl(cmd.mapControl);
          } else if (cmd.action === "map-keyboard" && cmd.key) {
            controller.navigateMapKeyboard(cmd.key);
          } else if (cmd.action === "complete-activity" && cmd.activityId) {
            controller.recordTodayActivityCompletion(cmd.activityId, cmd.eventId);
          } else if (cmd.action === "set-theme" && cmd.themeValue) {
            controller.setThemePreference(cmd.themeValue);
          } else if (cmd.action === "toggle-upvote") {
            controller.toggleUpvote(cmd.revisionId);
          } else if (cmd.action === "open-dialog" && cmd.dialogId) {
            controller.openDialog(cmd.dialogId, cmd.authMode);
          } else if (cmd.action === "close-dialog") {
            controller.closeDialog();
          } else if (cmd.action === "submit-sign-up") {
            const email = String(cmd.email ?? "").trim().toLowerCase();
            const password = String(cmd.password ?? "");
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              controller.failExternalAuth("Enter a valid email address.", "signup");
            } else if (password.length < 8) {
              controller.failExternalAuth("Use a password with at least 8 characters.", "signup");
            } else if (store.data.accounts[email]?.passwordHash) {
              controller.failExternalAuth("An account with that email already exists. Log in instead.", "signup");
            } else {
              const username = defaultUsernameOfEmail(email);
              const backend = await syncBackendAuth(
                apiBaseUrl,
                "/v1/auth/signup",
                { email, password },
                fetchImpl,
              );
              const existing = store.data.accounts[email];
              const record = {
                accountId: existing?.accountId ?? backend?.account_id ?? `usr-${crypto.randomUUID().slice(0, 12)}`,
                email,
                username: existing?.username ?? username,
                avatarUrl: existing?.avatarUrl,
                role: existing?.role ?? defaultRoleForEmail(email),
                passwordHash: hashAccountPassword(password),
                oauthProviders: existing?.oauthProviders ?? [],
              };
              store.data.accounts[email] = record;
              store.save();
              controller.completeExternalAuth({
                accountId: record.accountId,
                email: record.email,
                username: record.username,
                ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
                role: record.role,
              });
              syncControllerPasskeys(controller, null);
            }
          } else if (cmd.action === "submit-sign-in") {
            const email = String(cmd.email ?? "").trim().toLowerCase();
            const password = String(cmd.password ?? "");
            const stored = store.data.accounts[email];
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              controller.failExternalAuth("Enter a valid email address.", "login");
            } else if (stored?.passwordHash) {
              if (!verifyAccountPassword(password, stored.passwordHash)) {
                controller.failExternalAuth("Incorrect email or password.", "login");
              } else {
                await syncBackendAuth(apiBaseUrl, "/v1/auth/login", { email, password }, fetchImpl);
                controller.completeExternalAuth({
                  accountId: stored.accountId,
                  email: stored.email,
                  username: stored.username ?? defaultUsernameOfEmail(stored.email),
                  ...(stored.avatarUrl ? { avatarUrl: stored.avatarUrl } : {}),
                  role: stored.role,
                });
                syncControllerPasskeys(controller, null);
              }
            } else if (stored && !stored.passwordHash) {
              const hasPasskey = passkeysForAccount(stored.accountId).length > 0;
              const linked = (stored.oauthProviders ?? []).map(oauthProviderLabel).join(" or ");
              if (hasPasskey && !linked) {
                controller.failExternalAuth("This account signs in with a passkey. Click Passkey below.", "login");
              } else {
                const providerText = linked || "OAuth";
                controller.failExternalAuth(`This account signs in with ${providerText}. Continue with ${providerText} below.`, "login");
              }
            } else {
              controller.applyUiAction("submit-sign-in", { email, password });
              syncControllerPasskeys(controller, null);
            }
          } else if (cmd.action === "delete-passkey" && typeof cmd.credentialId === "string") {
            const { authStatus, account } = controller.getState();
            const existing = store.data.passkeys[cmd.credentialId];
            if (authStatus === "authenticated" && existing && existing.passkeyUserId === account.accountId) {
              delete store.data.passkeys[cmd.credentialId];
              store.save();
              syncControllerPasskeys(controller, "Passkey removed from your account.");
            } else {
              controller.applyUiAction("delete-passkey", { credentialId: cmd.credentialId });
            }
          } else if (typeof cmd.action === "string") {
            const data = Object.fromEntries(Object.entries(cmd).filter(([, value]) => typeof value === "string"));
            let live = null;
            let analyzedOutcome = null;
            if (cmd.action === "generate-syllabus-ai") {
              const request = controller.liveGenerationRequest(data);
              const apiKey = request ? env[PROVIDER_KEY_ENV[request.providerId]] : undefined;
              if (apiKey) {
                live = await requestLiveDraft(request, apiKey).then((draft) => ({ draft }), (err) => ({ error: err.message }));
              }
            } else if (cmd.action === "ingest-manual-resource") {
              analyzedOutcome = await runServerManualResourceAnalysis(controller, data);
            }
            controller.applyUiAction(cmd.action, data, data.practiceChoice ?? null, live, analyzedOutcome);

            const afterState = controller.getState();
            if (afterState.authStatus === "authenticated") {
              if (cmd.action === "ingest-manual-resource" && analyzedOutcome && !("error" in analyzedOutcome)) {
                await syncBackendResourceEndpoint(afterState.account.email, "POST", "/v1/catalog/resources/manual", {
                  raw_text: data.rawText ?? "",
                  url: analyzedOutcome.canonicalUrl,
                  title_override: analyzedOutcome.title,
                });
              } else if (cmd.action === "save-resource-edit" && data.resourceVersionId && !afterState.resourceEditorError) {
                const updated = afterState.catalogResources[data.resourceVersionId];
                if (updated) {
                  await syncBackendResourceEndpoint(
                    afterState.account.email,
                    "PATCH",
                    `/v1/catalog/resources/${encodeURIComponent(data.resourceVersionId)}`,
                    {
                      title: updated.title,
                      canonical_url: updated.canonical_url,
                      provider_display_name: updated.provider?.display_name,
                      category: updated.category,
                      subject: updated.subject,
                      access_model: updated.access?.model,
                      summary: updated.description,
                      topics: updated.topics,
                      segment_titles: (updated.segments ?? []).map((s) => s.title).filter(Boolean),
                    },
                  );
                }
              } else if (cmd.action === "delete-library-resource" && data.resourceId) {
                await syncBackendResourceEndpoint(
                  afterState.account.email,
                  "DELETE",
                  `/v1/catalog/resources/${encodeURIComponent(data.resourceId)}`,
                );
              } else if (cmd.action === "link-library-resource" && data.resourceVersionId && data.targetSyllabusId) {
                await syncBackendResourceEndpoint(
                  afterState.account.email,
                  "POST",
                  `/v1/syllabi/${encodeURIComponent(data.targetSyllabusId)}/resources`,
                  {
                    resource_version_id: data.resourceVersionId,
                    module_id: data.targetModuleId,
                    role: data.role ?? "primary",
                    selection_rationale: data.selectionRationale,
                  },
                );
              } else if (cmd.action === "unlink-syllabus-resource" && data.resourceId && data.syllabusId) {
                await syncBackendResourceEndpoint(
                  afterState.account.email,
                  "DELETE",
                  `/v1/syllabi/${encodeURIComponent(data.syllabusId)}/resources/${encodeURIComponent(data.resourceId)}`,
                );
              }
            }
            if (cmd.action === "update-profile" || cmd.action === "save-avatar-crop") {
              const { authStatus: nextStatus, account: nextAccount } = controller.getState();
              if (nextStatus === "authenticated") {
                const byId = Object.entries(store.data.accounts).find(([, a]) => a && a.accountId === nextAccount.accountId);
                if (byId) {
                  const [oldKey, rec] = byId;
                  const newKey = nextAccount.email.trim().toLowerCase();
                  rec.email = newKey;
                  if (nextAccount.username) rec.username = nextAccount.username;
                  if (nextAccount.avatarUrl) rec.avatarUrl = nextAccount.avatarUrl;
                  if (oldKey !== newKey) {
                    delete store.data.accounts[oldKey];
                    store.data.accounts[newKey] = rec;
                  }
                  store.save();
                }
              }
            }
            if (cmd.action === "sign-out" || cmd.action === "switch-persona") {
              syncControllerPasskeys(controller, null);
            }
          }
          persist(sid, controller);

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              state: controller.getState(),
              html: controller.renderHtml(),
            })
          );
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    // Default HTML entry route ("/" and deep links)
    const { controller } = sessionFor(req, res);
    const templateHtml = fs.readFileSync(
      path.join(PUBLIC_DIR, "index.html"),
      "utf8"
    );

    const topParam = parsedUrl.searchParams.get("topLevel");
    const subParam = parsedUrl.searchParams.get("learnSub");
    const planViewParam = parsedUrl.searchParams.get("planView");
    const openDialogParam = parsedUrl.searchParams.get("openDialog");
    // Admin has no link anywhere. Only /admin or ?topLevel=Admin opens it, and anyone but a signed-in admin gets 403.
    const wantsAdmin = pathname === "/admin" || topParam === "Admin";
    if (wantsAdmin) {
      controller.applyUiAction("open-admin-resources");
    } else if (topParam === "Learn" || topParam === "Explore" || topParam === "Settings") {
      controller.navigateTopLevel(topParam);
    }
    if (openDialogParam === "dialog-auth") {
      controller.openDialog("dialog-auth", "login");
    }
    if (
      subParam === "Today" ||
      subParam === "Plan" ||
      subParam === "Progress" ||
      subParam === "Resources"
    ) {
      controller.navigateLearnSubDestination(subParam);
    }
    if (planViewParam === "Map" || planViewParam === "Outline") {
      controller.switchPlanView(planViewParam);
    }

    const ssrAppHtml =
      parsedUrl.searchParams.size > 0
        ? controller.renderHtml()
        : renderSyllabusWebAppHtml(controller.getState());
    const fullPage = templateHtml.replace("<!--__SSR_APP_HTML__-->", ssrAppHtml);

    const { authStatus, account } = controller.getState();
    const forbidden = wantsAdmin && !(authStatus === "authenticated" && isAdminAccount(account));
    res.writeHead(forbidden ? 403 : 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(fullPage);
  });

  return { server };
}

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const port = Number(process.env.WEB_PORT ?? 3000);
  const host = process.env.WEB_HOST ?? "localhost";
  const { server } = createWebAppServer({ storePath: path.resolve(__dirname, "../.data/web-store.json") });
  const bindHost = host === "localhost" ? "127.0.0.1" : host;
  server.listen(port, bindHost, () => {
    console.log(
      `Syllabus.io Interactive Web App listening at http://${host}:${port}`
    );
  });
  if (host === "localhost") {
    const requestHandler = server.listeners("request")[0];
    if (typeof requestHandler === "function") {
      const ipv6Loopback = http.createServer(requestHandler);
      ipv6Loopback.on("error", () => {
        // Ignore if IPv6 loopback (::1) is unavailable on the host OS.
      });
      ipv6Loopback.listen(port, "::1");
    }
  }
}
