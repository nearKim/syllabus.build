/**
 * Zero-Dependency Local Development & SSR Server (`apps/web/src/server.mjs`).
 *
 * - Compiles/serves the interactive Section 9.3 web application at `http://127.0.0.1:3000`
 *   (configurable via `WEB_PORT` and `WEB_HOST`).
 * - Server-renders the initial HTML using `renderSyllabusWebAppHtml` and hydrates client
 *   interactivity in the browser via `/client.js`.
 * - Proxies `/v1/*` API calls to `API_BASE_URL` (default `http://127.0.0.1:8080`).
 * - Gives each visitor a session cookie and a controller of their own. Resources that any session indexes
 *   go to one shared store, saved to `.data/web-store.json`, so every session can find them at once.
 * - Generates syllabi with a live model call when the signed-in account has a provider key.
 */

import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import fs from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import {
  createSyllabusWebAppController,
  getDialogLightDismissFallbackScript,
  renderSyllabusWebAppHtml,
} from "./browserApp.ts";
import {
  openByokApiKey,
  resolveByokMasterKey,
  sealByokApiKey,
  toMaskedCredentialRecord,
} from "./byokVault.mjs";
import {
  DEFAULT_OPEN_CATALOG_DIR,
  loadOpenCatalogFromDisk,
  serializeOpenCatalogEntry,
} from "./openCatalog.mjs";
import { isAdminAccount } from "./components/AdminResourcesView.tsx";
import { PERSONAS } from "./components/AuthDialog.tsx";
import { defaultUsernameOfEmail } from "./auth.ts";
import catalogResourcesJson from "./data/catalogResources.json" with { type: "json" };
import { requestLiveDraft } from "./liveDraft.ts";
import { requestLiveConceptCheck } from "./liveTutor.ts";
import { analyzeManualResourceWithAi, isSafePublicHttpsUrl } from "./resourceAnalyzer.ts";
import {
  buildOAuthAuthorizeRedirect,
  buildOAuthCallbackUrl,
  createDevIdpCodeStore,
  exchangeLiveOAuthCode,
  generatePkcePair,
  generateRandomBase64Url,
  isLocalDevEnv,
  isOAuthProvider,
  OAUTH_PROVIDERS,
  oauthProviderLabel,
  renderDevOAuthConsentHtml,
  resolveProviderCredentials,
  signOAuthStateCookie,
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
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const FLATPICKR_DIST_DIR = path.resolve(__dirname, "../node_modules/flatpickr/dist");
const TOM_SELECT_DIST_DIR = path.resolve(__dirname, "../node_modules/tom-select/dist");
const CROPPER_DIST_DIR = path.resolve(__dirname, "../node_modules/cropperjs/dist");
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
  return `// Syllabus.build Interactive Browser Hydration Controller
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

  // Marks a sign-in control as pending until the server answers, so a second click cannot submit again.
  // The returned function clears the mark when the request fails and the dialog stays.
  function markAuthPending(control) {
    const surface = control.closest(".auth-surface");
    if (!surface || surface.dataset.pending) return null;
    surface.dataset.pending = "true";
    control.setAttribute("aria-busy", "true");
    return () => {
      delete surface.dataset.pending;
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
    const previous = openDialogScroll();
    const rail = root.querySelector(".today-syllabi-grid");
    const railLeft = rail ? rail.scrollLeft : 0;
    const settingsSection = root.querySelector('input[name="settings-section"]:checked')?.value;
    destroyDatepickers();
    destroyPlanSelects();
    destroyAvatarCropper();
    root.innerHTML = payload.html;
    const nextSettingsSection = action === "open-ai-settings" ? "ai" : settingsSection;
    const settingsChoice = Array.from(root.querySelectorAll('input[name="settings-section"]'))
      .find((input) => input.value === nextSettingsSection);
    if (settingsChoice) settingsChoice.checked = true;
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
    if (!focusKey(focusedKey) && action === "close-study-detail") focusKey(inspectorOpenerKey);
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

  function showAuthDialogError(message) {
    const dialog = root.querySelector("#dialog-auth");
    if (!dialog) return;
    let errEl = dialog.querySelector(".field-error");
    if (!errEl) {
      errEl = document.createElement("p");
      errEl.className = "field-error";
      errEl.setAttribute("role", "alert");
      const providers = dialog.querySelector(".auth-provider-list");
      if (providers && providers.parentNode) providers.parentNode.insertBefore(errEl, providers);
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
      if (!hasAuthenticator) {
        registerBtns.forEach((btn) => {
          btn.disabled = true;
          btn.title = "Passkeys require a supported platform authenticator on this device.";
        });
      }
    } catch {
      // Leave buttons enabled if capability inspection fails transiently.
    }
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

    autofillAbortController.abort();
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
      return;
    }
    if (!credential) {
      clear();
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
          return;
      }
      applyServerPayload(payload, "sign-in-passkey", null);
    } catch {
      clear();
      showAuthDialogError("Passkey verification request failed.");
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
      if (!hasAuthenticator) {
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

  // Post-interaction validation for dialog and inline verification forms (syncs aria-invalid on blur and clears immediately when valid).
  root.addEventListener(
    "blur",
    (event) => {
      const input = event.target;
      if (
        !input ||
        (input.localName !== "input" && input.localName !== "textarea") ||
        !input.closest ||
        !input.closest("#dialog-resource-editor, #dialog-syllabus-editor")
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
      !input.closest("#dialog-resource-editor, #dialog-syllabus-editor")
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
    root.querySelectorAll(".auth-surface[data-pending]").forEach((surface) => delete surface.dataset.pending);
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
      const dialog = document.getElementById(target.dataset.dialogId);
      if (dialog && !dialog.open && (signedIn || dialog.id === "dialog-auth")) dialog.showModal();
      dispatchServerRender({ action: "open-dialog", dialogId: target.dataset.dialogId });
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

    if (action === "confirm-delete-account") {
      event.preventDefault();
      const notice = root.querySelector("#account-deletion-error");
      if (notice) notice.hidden = true;
      target.disabled = true;
      target.setAttribute("aria-busy", "true");
      dispatchServerRender({ action }).then((ok) => {
        if (ok) return;
        target.disabled = false;
        target.removeAttribute("aria-busy");
        if (notice) notice.hidden = false;
      });
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
      if (action === "open-dialog" && !patch.publicationId) {
        const pubHost = target.closest("[data-publication-id]");
        if (pubHost && pubHost.dataset.publicationId) {
          patch.publicationId = pubHost.dataset.publicationId;
        }
      }
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
      if (action === "submit-diagnostic-answer") {
        const checkedDiag = root.querySelector('input[name="diagnostic-choice"]:checked');
        if (checkedDiag) patch.diagnosticChoice = checkedDiag.value;
      }
      if (action === "generate-activity-check") {
        target.disabled = true;
        target.setAttribute("aria-busy", "true");
        dispatchServerRender(patch).then((ok) => {
          if (ok) return;
          target.disabled = false;
          target.removeAttribute("aria-busy");
        });
        return;
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

  // The Marketplace search and topic finder send their fields under the form's own data-action.
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
    dispatchServerRender(patch);
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
      return;
    }
    const tzSelect = event.target && event.target.closest ? event.target.closest('select[data-action="set-reminder-timezone"]') : null;
    if (tzSelect && tzSelect.value) {
      dispatchServerRender({ action: "set-reminder-timezone", reminderTimezone: tzSelect.value });
      return;
    }
    const reminderSchedEl = event.target && event.target.closest ? event.target.closest('[data-action="set-reminder-schedule"]') : null;
    if (reminderSchedEl && reminderSchedEl.value) {
      dispatchServerRender({
        action: "set-reminder-schedule",
        reminderField: reminderSchedEl.dataset.reminderField,
        value: reminderSchedEl.value,
      });
      return;
    }
    const providerModelSelect = event.target && event.target.closest ? event.target.closest('select[data-action="set-provider-model"]') : null;
    if (providerModelSelect && providerModelSelect.value) {
      dispatchServerRender({
        action: "set-provider-model",
        providerId: providerModelSelect.dataset.providerId,
        modelId: providerModelSelect.value,
      });
      return;
    }
    const intakeModelSelect = event.target && event.target.closest ? event.target.closest('select[data-action="set-intake-ai-model"]') : null;
    if (intakeModelSelect && intakeModelSelect.value) {
      const goalInput = root.querySelector("#intake-goal");
      dispatchServerRender({
        action: "set-intake-ai-model",
        compoundModel: intakeModelSelect.value,
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

function isPublicIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function fetchPublicResourcePage(rawUrl, init = {}) {
  if (!isSafePublicHttpsUrl(rawUrl)) return Promise.reject(new Error("Resource URL is not public HTTPS."));
  return new Promise((resolve, reject) => {
    const request = https.request(rawUrl, {
      method: "GET",
      headers: init.headers,
      signal: init.signal,
      lookup(hostname, _options, callback) {
        // IPv6 answers are never selected for this request, including IPv4-mapped IPv6.
        dns.lookup(hostname, { all: true }, (err, addresses) => {
          if (err) return callback(err);
          const ipv4 = addresses.filter(({ address, family }) => family === 4 && net.isIP(address) === 4);
          if (!ipv4.length || ipv4.some(({ address }) => !isPublicIpv4(address))) {
            callback(new Error("Resource host resolves to a non-public address."));
            return;
          }
          callback(null, ipv4[0].address, 4);
        });
      },
    }, (upstream) => {
      const headers = new Headers();
      for (const key of ["content-type", "location"]) {
        if (typeof upstream.headers[key] === "string") headers.set(key, upstream.headers[key]);
      }
      resolve({
        ok: upstream.statusCode >= 200 && upstream.statusCode < 300,
        status: upstream.statusCode,
        url: rawUrl,
        headers,
        body: Readable.toWeb(upstream),
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function proxyApiRequest(req, res, apiBaseUrl, pathAndSearch) {
  const targetUrl = new URL(pathAndSearch, apiBaseUrl);
  const { "x-auth-exchange-secret": _clientExchangeSecret, ...proxyHeaders } = req.headers;
  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers: {
        ...proxyHeaders,
        host: targetUrl.host,
      },
      timeout: 1500,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("timeout", () => proxyReq.destroy(new Error("API upstream timed out.")));
  proxyReq.on("error", () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "API upstream unavailable." }));
  });

  req.pipe(proxyReq);
}

const SESSION_COOKIE = "cio_sid";
const OAUTH_STATE_COOKIE = "cio_oauth";

// The shared store separates ephemeral auth session cookies (`sessions[sid]`) from durable per-account
// workspaces (`accountWorkspaces[workspaceKey]`) and AES-256-GCM BYOK credentials (`byokVault[accountId]`).
// Signing out detaches `sessions[sid]` without ever erasing `accountWorkspaces`.
function openStore(storePath, openCatalogDir = DEFAULT_OPEN_CATALOG_DIR) {
  const saved = storePath && fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : {};
  const openCatalog = loadOpenCatalogFromDisk(openCatalogDir);
  const accountWorkspaces = { ...(saved.accountWorkspaces ?? {}) };
  const sessions = {};
  for (const [sid, rawSess] of Object.entries(saved.sessions ?? {})) {
    if (!rawSess || typeof rawSess !== "object") continue;
    const explicitAuth = Boolean(rawSess.explicitAuth);
    const authStatus = rawSess.authStatus ?? "guest";
    const account = rawSess.account ?? null;
    const accountId = rawSess.accountId ?? account?.accountId ?? null;
    if ("generatedPlans" in rawSess || "syllabusOverrides" in rawSess || "userLibraryResourceIds" in rawSess) {
      const legacyKey = explicitAuth && accountId ? accountId : `sandbox:${sid}`;
      if (!accountWorkspaces[legacyKey]) {
        const {
          authStatus: _as,
          account: _ac,
          accountId: _aid,
          explicitAuth: _ea,
          topLevel: _tl,
          learnSubDestination: _ls,
          returnTo: _rt,
          ...legacyWorkspace
        } = rawSess;
        accountWorkspaces[legacyKey] = legacyWorkspace;
      }
    }
    sessions[sid] = {
      authStatus,
      accountId,
      account,
      explicitAuth,
      topLevel: rawSess.topLevel,
      learnSubDestination: rawSess.learnSubDestination,
      returnTo: rawSess.returnTo ?? null,
    };
  }
  const data = {
    resources: {
      ...catalogResourcesJson.global_discovered_resources,
      ...openCatalog.all,
      ...Object.fromEntries(Object.entries(saved.resources ?? {}).filter(([id]) => saved.globalAdminResourceIds?.includes(id))),
    },
    globalAdminResourceIds: saved.globalAdminResourceIds ?? [],
    globalRemovedResourceIds: saved.globalRemovedResourceIds ?? [],
    accounts: saved.accounts ?? {},
    oauthIdentities: saved.oauthIdentities ?? {},
    passkeys: saved.passkeys ?? {},
    byokVault: saved.byokVault ?? {},
    accountWorkspaces,
    sessions,
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

const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        body = "";
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readBoundedResponseText(response, maxBytes = 8 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Remote response is too large.");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

function defaultAccountRole() {
  return "User";
}

async function syncBackendAuth(apiBaseUrl, endpointPath, payload, exchangeSecret, fetchImpl = globalThis.fetch) {
  if (!exchangeSecret) return null;
  try {
    const res = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, "")}${endpointPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-auth-exchange-secret": exchangeSecret },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return JSON.parse(await readBoundedResponseText(res));
  } catch {
    return null;
  }
}

export function createWebAppServer(options = {}) {
  const env = options.env ?? process.env;
  if (env.AUTH_EXCHANGE_SECRET && !/^[0-9a-fA-F]{64}$/.test(env.AUTH_EXCHANGE_SECRET)) {
    throw new Error("AUTH_EXCHANGE_SECRET must be 32 bytes encoded as 64 hex characters.");
  }
  if (!isLocalDevEnv(env)) {
    if (!OAUTH_PROVIDERS.some((provider) => resolveProviderCredentials(provider, env))) {
      throw new Error("Configure Google, Apple, or GitHub OAuth before starting the web server.");
    }
    if (!env.AUTH_EXCHANGE_SECRET) {
      throw new Error("AUTH_EXCHANGE_SECRET is required for verified sign-in.");
    }
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiBaseUrl =
    options.apiBaseUrl ?? env.API_BASE_URL ?? "http://127.0.0.1:8080";
  const oauthSecret =
    options.oauthCookieSecret ?? env.OAUTH_COOKIE_SECRET ?? crypto.randomBytes(32).toString("hex");
  const openCatalogDir = options.openCatalogDir ?? DEFAULT_OPEN_CATALOG_DIR;
  const byokMasterKey = resolveByokMasterKey({
    envKey: options.byokMasterKey ?? env.BYOK_MASTER_KEY,
    persistent: Boolean(options.storePath) || !isLocalDevEnv(env),
  });
  const store = openStore(options.storePath, openCatalogDir);
  const devIdpCodes = createDevIdpCodeStore();
  const maxActiveSessions = options.maxActiveSessions ?? (Number(env.WEB_MAX_ACTIVE_SESSIONS) || 500);
  const sessionIdleTtlMs = options.sessionIdleTtlMs ?? (Number(env.WEB_SESSION_IDLE_TTL_MS) || 24 * 60 * 60 * 1000);
  const ceremonyTtlMs = 10 * 60 * 1000;
  const rateLimitMaxRequests = options.rateLimitMaxRequests ?? (Number(env.WEB_RATE_LIMIT_MAX) || 300);
  const rateLimitWindowMs = options.rateLimitWindowMs ?? (Number(env.WEB_RATE_LIMIT_WINDOW_MS) || 60_000);
  const cookieSecureAttr = !isLocalDevEnv(env) ? "; Secure" : "";

  const controllers = new Map();
  const controllerLastSeen = new Map();
  const passkeyCeremonies = new Map();
  const sessionApiTokens = new Map();
  const rateLimitBuckets = new Map();

  function touchSessionCache(sid) {
    const now = Date.now();
    controllerLastSeen.set(sid, now);
    if (controllers.size <= maxActiveSessions) return;
    for (const [k, seenAt] of controllerLastSeen.entries()) {
      if (k !== sid && now - seenAt > sessionIdleTtlMs) {
        controllers.delete(k);
        controllerLastSeen.delete(k);
      }
    }
    while (controllers.size > maxActiveSessions) {
      let oldestKey = null;
      let oldestTs = Infinity;
      for (const [k, seenAt] of controllerLastSeen.entries()) {
        if (k !== sid && seenAt < oldestTs) {
          oldestTs = seenAt;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      controllers.delete(oldestKey);
      controllerLastSeen.delete(oldestKey);
    }
  }

  function putPasskeyCeremony(key, ceremony) {
    const now = Date.now();
    for (const [k, entry] of passkeyCeremonies.entries()) {
      if (!entry || entry.expiresAt <= now) passkeyCeremonies.delete(k);
    }
    passkeyCeremonies.set(key, { ceremony, expiresAt: now + ceremonyTtlMs });
  }

  function takePasskeyCeremony(key) {
    const entry = passkeyCeremonies.get(key);
    passkeyCeremonies.delete(key);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return entry.ceremony;
  }

  function checkRateLimit(req) {
    if (rateLimitMaxRequests <= 0) return { allowed: true, retryAfterSec: 0 };
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
    const ip = fwd || req.socket?.remoteAddress || "127.0.0.1";
    const now = Date.now();
    const cutoff = now - rateLimitWindowMs;
    const prev = rateLimitBuckets.get(ip) ?? [];
    const recent = prev.filter((ts) => ts > cutoff);
    if (recent.length >= rateLimitMaxRequests) {
      rateLimitBuckets.set(ip, recent);
      const retryAfterSec = Math.max(1, Math.ceil(((recent[0] ?? now) + rateLimitWindowMs - now) / 1000));
      return { allowed: false, retryAfterSec };
    }
    recent.push(now);
    rateLimitBuckets.set(ip, recent);
    if (rateLimitBuckets.size > 2000) {
      for (const [k, timestamps] of rateLimitBuckets.entries()) {
        if (timestamps.every((ts) => ts <= cutoff)) rateLimitBuckets.delete(k);
      }
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  function isCrossOriginMutatingRequest(req) {
    if (String(req.headers["sec-fetch-site"] ?? "").toLowerCase() === "cross-site") {
      return true;
    }
    const rawOrigin = req.headers.origin;
    if (!rawOrigin) return false;
    try {
      const originHost = new URL(String(rawOrigin)).host.toLowerCase();
      const allowedHosts = new Set();
      if (req.headers.host) allowedHosts.add(String(req.headers.host).toLowerCase());
      allowedHosts.add(new URL(publicOriginOf(req)).host.toLowerCase());
      if (isLocalDevEnv(env)) {
        for (const h of [...allowedHosts]) {
          if (h.startsWith("127.0.0.1:")) allowedHosts.add(h.replace("127.0.0.1:", "localhost:"));
          if (h.startsWith("localhost:")) allowedHosts.add(h.replace("localhost:", "127.0.0.1:"));
        }
      }
      return !allowedHosts.has(originHost);
    } catch {
      return true;
    }
  }

  async function callBackendJson(method, endpointPath, opts = {}) {
    const base = apiBaseUrl.replace(/\/+$/, "");
    try {
      const reqHeaders = { ...(opts.headers ?? {}) };
      if (opts.token) reqHeaders.Authorization = `Bearer ${opts.token}`;
      if (opts.rawBody !== undefined) {
        if (!reqHeaders["Content-Type"]) reqHeaders["Content-Type"] = "application/json";
      } else if (opts.body !== undefined) {
        reqHeaders["Content-Type"] = "application/json";
      }
      const res = await fetchImpl(`${base}${endpointPath}`, {
        method,
        headers: reqHeaders,
        ...(opts.rawBody !== undefined
          ? { body: opts.rawBody }
          : opts.body !== undefined
            ? { body: JSON.stringify(opts.body) }
            : {}),
      });
      if (res.status >= 500) {
        return { reachable: false, ok: false, status: res.status, data: null };
      }
      const text = await readBoundedResponseText(res);
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      return { reachable: true, ok: res.ok, status: res.status, data };
    } catch {
      return { reachable: false, ok: false, status: 0, data: null };
    }
  }

  function refreshOpenCatalogIntoStore() {
    const diskCatalog = loadOpenCatalogFromDisk(openCatalogDir);
    for (const [id, entry] of Object.entries(diskCatalog.all)) {
      if (!store.data.resources[id] && !store.data.globalRemovedResourceIds.includes(id)) {
        store.data.resources[id] = entry;
      }
    }
    return diskCatalog;
  }

  function resolveByokCredentialsForAccount(accountId) {
    if (options.initialState?.byokCredentials && (!accountId || !store.data.byokVault[accountId])) {
      return [...options.initialState.byokCredentials];
    }
    const vaultForAccount = (accountId && store.data.byokVault[accountId]) || {};
    return Object.values(vaultForAccount).map(toMaskedCredentialRecord);
  }

  function resolveRuntimeApiKeyForAccount(accountId, providerId) {
    if (!providerId) return undefined;
    const envlp = accountId ? store.data.byokVault[accountId]?.[providerId] : undefined;
    return envlp ? openByokApiKey({ masterKey: byokMasterKey, accountId, envelope: envlp }) : undefined;
  }

  function workspaceKeyFor(sid, sessionMeta) {
    if (!sessionMeta || sessionMeta.authStatus !== "authenticated") return null;
    if (sessionMeta.explicitAuth && sessionMeta.accountId) return sessionMeta.accountId;
    return `sandbox:${sid}`;
  }

  function extractWorkspaceSnapshot(controller, prevWorkspace = {}) {
    const s = controller.getState();
    const libraryResourcesSnapshot = Object.fromEntries(
      (s.userLibraryResourceIds ?? [])
        .map((id) => [id, s.catalogResources[id] ?? store.data.resources[id]])
        .filter(([, entry]) => Boolean(entry)),
    );
    return {
      selectedSyllabusId: s.selectedSyllabusId,
      generatedPlans: s.generatedPlans,
      syllabusOverrides: s.syllabusOverrides,
      deletedSyllabusIds: s.deletedSyllabusIds,
      scheduleOverrides: s.scheduleOverrides,
      userLibraryResourceIds: s.userLibraryResourceIds,
      libraryResourcesSnapshot,
      adminRemovedResourceIds: s.adminRemovedResourceIds,
      adminResourceOverrides: s.adminResourceOverrides,
      recordedProgressEvents: s.recordedProgressEvents,
      activityStates: s.activityStates,
      skippedActivityIds: s.skippedActivityIds,
      completedSubtaskIds: s.completedSubtaskIds,
      dynamicConceptChecks: s.dynamicConceptChecks,
      conceptCheckSeed: s.conceptCheckSeed,
      proficiencyOverrides: s.proficiencyOverrides,
      wallet: s.wallet,
      emailVerified: s.emailVerified,
      adoptions: s.adoptions,
      publishedListings: s.publishedListings,
      unpublishedPublicationIds: s.unpublishedPublicationIds,
      votes: s.votes,
      themePreference: s.themePreference,
      solidSurfaces: s.solidSurfaces,
      reduceMotion: s.reduceMotion,
      flowOrder: s.flowOrder,
      deepDive: s.deepDive,
      spacedReview: s.spacedReview,
      remindersEnabled: s.remindersEnabled,
      remindersPaused: s.remindersPaused,
      reminderTimezone: s.reminderTimezone,
      reminderWeekdayTime: s.reminderWeekdayTime,
      reminderWeekendTime: s.reminderWeekendTime,
      reminderLeadMinutes: s.reminderLeadMinutes,
      providerModels: s.providerModels,
      primaryCredentialRef: s.primaryCredentialRef,
    };
  }

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
      role: account.role ?? defaultAccountRole(),
      oauthProviders: [],
    };
    store.data.accounts[email] = record;
    store.save();
    return record;
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

  function hydrateControllerForSession(sid) {
    const savedSess = store.data.sessions[sid];
    const initialAuthStatus = savedSess?.authStatus ?? "guest";
    const initialAccount =
      savedSess?.account ??
      options.initialState?.account ??
      PERSONAS.learner;
    const explicitAuth = Boolean(savedSess?.explicitAuth);
    const meta = {
      authStatus: initialAuthStatus,
      accountId: initialAuthStatus === "authenticated" ? initialAccount.accountId : null,
      account: initialAuthStatus === "authenticated" ? initialAccount : null,
      explicitAuth,
    };
    const wsKey = workspaceKeyFor(sid, meta);
    const savedWorkspace = (wsKey && store.data.accountWorkspaces[wsKey]) || {};
    const creds =
      initialAuthStatus === "authenticated" && explicitAuth
        ? resolveByokCredentialsForAccount(initialAccount.accountId)
        : [];
    return createSyllabusWebAppController({
      ...options.initialState,
      ...savedWorkspace,
      authStatus: initialAuthStatus,
      ...(initialAccount ? { account: initialAccount } : {}),
      ...(savedSess?.topLevel ? { topLevel: savedSess.topLevel } : {}),
      ...(savedSess?.learnSubDestination ? { learnSubDestination: savedSess.learnSubDestination } : {}),
      ...(savedSess?.returnTo !== undefined ? { returnTo: savedSess.returnTo } : {}),
      byokCredentials: creds,
      ...(savedWorkspace.primaryCredentialRef ? { primaryCredentialRef: savedWorkspace.primaryCredentialRef } : {}),
    });
  }

  function authenticateSessionAsAccount(sid, prevController, resolvedAccount) {
    const prevState = prevController.getState();
    const pendingReturnTo = prevState.returnTo;
    const wasGuest = prevState.authStatus === "guest";
    const savedWorkspace = store.data.accountWorkspaces[resolvedAccount.accountId] ?? {};
    const creds = resolveByokCredentialsForAccount(resolvedAccount.accountId);
    const targetTopLevel = pendingReturnTo
      ? pendingReturnTo.topLevel
      : wasGuest
        ? "Learn"
        : prevState.topLevel;
    const targetLearnSub = pendingReturnTo
      ? pendingReturnTo.learnSubDestination
      : wasGuest
        ? "Today"
        : prevState.learnSubDestination;
    const nextController = createSyllabusWebAppController({
      ...options.initialState,
      ...savedWorkspace,
      authStatus: "authenticated",
      account: resolvedAccount,
      topLevel: targetTopLevel,
      learnSubDestination: targetLearnSub,
      openDialogId: pendingReturnTo ? pendingReturnTo.openDialogId : null,
      ...(pendingReturnTo?.adoptPublicationId ? { adoptPublicationId: pendingReturnTo.adoptPublicationId } : {}),
      returnTo: null,
      authNotice: null,
      byokCredentials: creds,
      ...(savedWorkspace.primaryCredentialRef ? { primaryCredentialRef: savedWorkspace.primaryCredentialRef } : {}),
    });
    nextController.syncCatalogResources(
      store.data.resources,
      [...store.data.globalRemovedResourceIds, ...nextController.getState().adminRemovedResourceIds],
      savedWorkspace.libraryResourcesSnapshot ?? {},
    );
    syncControllerPasskeys(nextController, null);
    controllers.set(sid, nextController);
    touchSessionCache(sid);
    store.data.sessions[sid] = {
      authStatus: "authenticated",
      accountId: resolvedAccount.accountId,
      account: resolvedAccount,
      explicitAuth: true,
      topLevel: targetTopLevel,
      learnSubDestination: targetLearnSub,
      returnTo: null,
    };
    return nextController;
  }

  async function authenticateAndHydrateFromBackend(
    sid,
    prevController,
    resolvedAccount,
    apiToken,
    backendEmailVerified = false,
    expiresAt,
  ) {
    const expiryMs = Date.parse(expiresAt ?? "");
    if (typeof apiToken !== "string" || !apiToken || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
      throw new Error("Verified backend session is unavailable.");
    }
    const accountId = resolvedAccount.accountId;
    const sessionRes = await callBackendJson("GET", "/v1/auth/session", { token: apiToken });
    const checkedExpiryMs = Date.parse(sessionRes.data?.expires_at ?? "");
    if (!sessionRes.ok || sessionRes.data?.account_id !== accountId ||
        !Number.isFinite(checkedExpiryMs) || checkedExpiryMs <= Date.now() ||
        !Array.isArray(sessionRes.data?.roles) ||
        sessionRes.data.roles.includes("admin") !== (resolvedAccount.role === "Admin")) {
      throw new Error("Verified backend session is unavailable.");
    }
    sessionApiTokens.set(sid, { token: apiToken, expiresAt: Math.min(expiryMs, checkedExpiryMs) });
    if (typeof apiToken === "string" && apiToken) {
      const [wsRes, pkRes, walletRes] = await Promise.all([
        callBackendJson("GET", "/v1/me/workspace", { token: apiToken }),
        callBackendJson("GET", "/v1/me/passkeys", { token: apiToken }),
        callBackendJson("GET", "/v1/me/wallet", { token: apiToken }),
      ]);
      if (wsRes.ok && wsRes.data?.workspace_json && typeof wsRes.data.workspace_json === "object") {
        const {
          sealedByokEnvelopes,
          libraryResourcesSnapshot,
          ...remoteWorkspace
        } = wsRes.data.workspace_json;
        if (sealedByokEnvelopes && typeof sealedByokEnvelopes === "object") {
          store.data.byokVault[accountId] = {
            ...sealedByokEnvelopes,
            ...(store.data.byokVault[accountId] ?? {}),
          };
        }
        store.data.accountWorkspaces[accountId] = {
          ...(store.data.accountWorkspaces[accountId] ?? {}),
          ...remoteWorkspace,
          ...(libraryResourcesSnapshot && typeof libraryResourcesSnapshot === "object" ? { libraryResourcesSnapshot } : {}),
        };
      }
      if (pkRes.ok && Array.isArray(pkRes.data?.items)) {
        for (const item of pkRes.data.items) {
          if (item?.credential_id && item.credential_json && typeof item.credential_json === "object") {
            store.data.passkeys[item.credential_id] = item.credential_json;
          }
        }
      }
      const remoteWallet = walletRes.ok && typeof walletRes.data?.available_minor_units === "number"
        ? {
            currency: walletRes.data.currency || "USD",
            available_minor: walletRes.data.available_minor_units,
            reserved_minor: walletRes.data.reserved_minor_units || 0,
            live_billing_enabled: false,
            updated_at: walletRes.data.updated_at || new Date().toISOString(),
          }
        : {
            currency: "USD",
            available_minor: 0,
            reserved_minor: 0,
            live_billing_enabled: false,
            updated_at: new Date().toISOString(),
          };
      store.data.accountWorkspaces[accountId] = {
        ...(store.data.accountWorkspaces[accountId] ?? {}),
        wallet: remoteWallet,
      };
    }
    if (backendEmailVerified) {
      store.data.accountWorkspaces[accountId] = {
        ...(store.data.accountWorkspaces[accountId] ?? {}),
        emailVerified: true,
      };
    }
    store.save();
    return authenticateSessionAsAccount(sid, prevController, resolvedAccount);
  }

  // Detaches `sid` to guest view without modifying or deleting `store.data.accountWorkspaces`.
  function detachSessionToGuest(sid, controller, authNotice = null) {
    const postState = controller.getState();
    sessionApiTokens.delete(sid);
    controller.setPasskeys([], null);
    controller.setByokCredentials([], "");
    store.data.sessions[sid] = {
      authStatus: "guest",
      accountId: null,
      account: null,
      explicitAuth: false,
      topLevel: postState.topLevel,
      learnSubDestination: postState.learnSubDestination,
      returnTo: postState.returnTo ?? null,
    };
    if (authNotice) {
      // Keep any explicit deletion notice already placed on the controller.
    }
    store.save();
  }

  // An unknown or missing cookie gets a new random session, so a client cannot choose its session id.
  function sessionFor(req, res, restoredSid = null) {
    let sid = restoredSid ?? cookieOf(req, SESSION_COOKIE);
    const savedSession = sid && store.data.sessions[sid];
    const tokenRecord = sid && sessionApiTokens.get(sid);
    if (savedSession?.authStatus === "authenticated" &&
        (!savedSession.explicitAuth || !tokenRecord || tokenRecord.expiresAt <= Date.now())) {
      controllers.delete(sid);
      sessionApiTokens.delete(sid);
      delete store.data.sessions[sid];
      sid = null;
    }
    if (!sid || !(controllers.has(sid) || store.data.sessions[sid])) {
      sid = crypto.randomUUID();
      appendSetCookie(res, `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax${cookieSecureAttr}`);
    } else if (restoredSid && cookieOf(req, SESSION_COOKIE) !== sid) {
      appendSetCookie(res, `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax${cookieSecureAttr}`);
    }
    refreshOpenCatalogIntoStore();
    let controller = controllers.get(sid);
    if (!controller) {
      controller = hydrateControllerForSession(sid);
      controllers.set(sid, controller);
    }
    touchSessionCache(sid);
    const accountId = store.data.sessions[sid]?.accountId;
    const localEntries = accountId ? store.data.accountWorkspaces[accountId]?.libraryResourcesSnapshot ?? {} : {};
    controller.syncCatalogResources(
      store.data.resources,
      [...store.data.globalRemovedResourceIds, ...controller.getState().adminRemovedResourceIds],
      localEntries,
    );
    syncControllerPasskeys(controller);
    return { sid, controller };
  }

  // Saves session auth metadata and the authenticated account's workspace.
  function persist(sid, controller) {
    const state = controller.getState();
    const {
      authStatus,
      account,
    } = state;

    const prevSession = store.data.sessions[sid];
    const explicitAuth = authStatus === "authenticated" ? Boolean(prevSession?.explicitAuth) : false;
    const nextSessionMeta = {
      authStatus,
      accountId: authStatus === "authenticated" ? account.accountId : null,
      account: authStatus === "authenticated" ? account : null,
      explicitAuth,
      topLevel: state.topLevel,
      learnSubDestination: state.learnSubDestination,
      returnTo: state.returnTo ?? null,
    };
    const sessionChanged = JSON.stringify(nextSessionMeta) !== JSON.stringify(prevSession);

    let workspaceChanged = false;
    const wsKey = workspaceKeyFor(sid, nextSessionMeta);
    if (wsKey) {
      const prevWs = store.data.accountWorkspaces[wsKey];
      const nextWs = extractWorkspaceSnapshot(controller, prevWs);
      if (JSON.stringify(nextWs) !== JSON.stringify(prevWs)) {
        store.data.accountWorkspaces[wsKey] = nextWs;
        workspaceChanged = true;
      }
    }

    if (!sessionChanged && !workspaceChanged) return false;
    store.data.sessions[sid] = nextSessionMeta;
    store.save();
    return true;
  }

  function requireCatalogBackendSuccess(sid, result) {
    if (result.ok) return;
    controllers.delete(sid);
    const statusCode = result.status >= 400 && result.status < 500 ? result.status : 502;
    throw Object.assign(new Error("Global catalog change was rejected by the backend."), { statusCode });
  }

  function commitGlobalResource(id, entry) {
    store.data.resources[id] = entry;
    if (!store.data.globalAdminResourceIds.includes(id)) store.data.globalAdminResourceIds.push(id);
    store.data.globalRemovedResourceIds = store.data.globalRemovedResourceIds.filter((removedId) => removedId !== id);
    store.save();
  }

  function removeGlobalResource(id) {
    delete store.data.resources[id];
    store.data.globalAdminResourceIds = store.data.globalAdminResourceIds.filter((savedId) => savedId !== id);
    if (!store.data.globalRemovedResourceIds.includes(id)) store.data.globalRemovedResourceIds.push(id);
    store.save();
  }

  function apiTokenForSession(sid, controller) {
    const record = sessionApiTokens.get(sid);
    return store.data.sessions[sid]?.explicitAuth && record?.expiresAt > Date.now() ? record.token : null;
  }

  async function persistAsync(sid, controller, forceRemote = false) {
    const changed = persist(sid, controller);
    if (!changed && !forceRemote) return;
    const sess = store.data.sessions[sid];
    const st = controller.getState();
    if (!sess?.explicitAuth || st.authStatus !== "authenticated") return;
    const apiToken = apiTokenForSession(sid, controller);
    if (!apiToken) return;
    const accountId = st.account.accountId;
    const ws = store.data.accountWorkspaces[accountId] ?? extractWorkspaceSnapshot(controller);
    await callBackendJson("PUT", "/v1/me/workspace", {
      token: apiToken,
      body: {
        workspace_json: {
          ...ws,
          sealedByokEnvelopes: store.data.byokVault[accountId] ?? {},
        },
      },
    });
  }

  async function syncBackendResourceEndpoint(sid, method, endpointPath, payload, extraHeaders = {}) {
    const token = apiTokenForSession(sid);
    if (!token) return null;
    const base = apiBaseUrl.replace(/\/+$/, "");
    try {
      const res = await fetchImpl(`${base}${endpointPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
      if (!res.ok) return null;
      const text = await readBoundedResponseText(res);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  async function runServerManualResourceAnalysis(sid, controller, data) {
    const state = controller.getState();
    const aiModel = controller.designatedAiModel();
    const apiKey =
      aiModel && store.data.sessions[sid]?.explicitAuth && state.authStatus === "authenticated"
        ? resolveRuntimeApiKeyForAccount(state.account.accountId, aiModel.providerId)
        : undefined;
    return analyzeManualResourceWithAi({
      rawText: data.rawText ?? "",
      explicitUrl: data.explicitUrl,
      providerId: aiModel?.providerId,
      modelId: aiModel?.modelId,
      apiKey,
      fetchImpl,
      pageFetchImpl: options.fetchImpl ? fetchImpl : fetchPublicResourcePage,
    });
  }

  function resolveOrCreateOAuthAccount(profile, backendAccountId, backendRoles = []) {
    const identityKey = `${profile.provider}:${profile.providerSubject}`;
    const linkedEmail = store.data.oauthIdentities[identityKey];
    const email = profile.email.trim().toLowerCase();
    const existing = (linkedEmail && store.data.accounts[linkedEmail]) || (profile.emailVerified ? store.data.accounts[email] : undefined);
    const providers = Array.from(new Set([...(existing?.oauthProviders ?? []), profile.provider]));
    const record = {
      accountId: backendAccountId,
      email,
      username: existing?.username ?? defaultUsernameOfEmail(email),
      avatarUrl: existing?.avatarUrl ?? profile.avatarUrl,
      role: backendRoles.includes("admin") ? "Admin" : "User",
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
    const localDev = isLocalDevEnv(env);

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      localDev
        ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' http://localhost:* http://127.0.0.1:* https:"
        : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https:",
    );
    if (!localDev) {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }

    if (pathname.startsWith("/v1/")) {
      proxyApiRequest(req, res, apiBaseUrl, `${pathname}${parsedUrl.search}`);
      return;
    }

    if (req.method === "POST" && pathname !== "/api/billing/webhook") {
      const appleCallback = pathname === "/auth/oauth/apple/callback";
      if (!appleCallback && isCrossOriginMutatingRequest(req)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Cross-origin request blocked." }));
        return;
      }
      if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
        const rl = checkRateLimit(req);
        if (!rl.allowed) {
          res.writeHead(429, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": String(rl.retryAfterSec),
          });
          res.end(JSON.stringify({ error: "Too many requests. Please try again shortly." }));
          return;
        }
      }
    }

    if (pathname === "/auth/providers" && req.method === "GET") {
      const origin = publicOriginOf(req);
      const providers = OAUTH_PROVIDERS.map((p) => {
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
      res.end(JSON.stringify({ providers, email_password_enabled: false, passkey_enabled: true }));
      return;
    }

    const oauthStartMatch = pathname.match(/^\/auth\/oauth\/(google|github|apple)$/);
    if (oauthStartMatch && req.method === "GET") {
      const provider = oauthStartMatch[1];
      if (isOAuthProvider(provider)) {
        const { sid, controller } = sessionFor(req, res);
        try {
          const state = generateRandomBase64Url(24);
          const { codeVerifier, codeChallenge } = generatePkcePair();
          const nonce = provider === "apple" ? generateRandomBase64Url(24) : undefined;
          const redirect = buildOAuthAuthorizeRedirect({
            provider,
            publicOrigin: publicOriginOf(req),
            state,
            codeChallenge,
            nonce,
            env,
          });
          const signedCookie = signOAuthStateCookie(
            { state, provider, codeVerifier, ...(provider === "apple" ? { nonce, sid } : {}), exp: Date.now() + 10 * 60 * 1000 },
            oauthSecret,
          );
          appendSetCookie(
            res,
            `${OAUTH_STATE_COOKIE}=${signedCookie}; Path=/; HttpOnly; Max-Age=600${provider === "apple" && redirect.mode === "live" ? "; SameSite=None; Secure" : `; SameSite=Lax${cookieSecureAttr}`}`,
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

    const devIdpMatch = pathname.match(/^\/auth\/dev-idp\/(google|github|apple)\/authorize$/);
    if (devIdpMatch && !localDev) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not found." }));
      return;
    }
    if (devIdpMatch && localDev) {
      const provider = devIdpMatch[1];
      if (isOAuthProvider(provider)) {
        if (req.method === "GET") {
          const redirectUri = parsedUrl.searchParams.get("redirect_uri") ?? buildOAuthCallbackUrl(publicOriginOf(req), provider);
          const state = parsedUrl.searchParams.get("state") ?? "";
          const codeChallenge = parsedUrl.searchParams.get("code_challenge") ?? "";
          const theme = sessionFor(req, res).controller.getState().themePreference === "dark" ? "dark" : "light";
          const html = renderDevOAuthConsentHtml({ provider, redirectUri, state, codeChallenge, theme });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(html);
          return;
        }
        if (req.method === "POST") {
          const rawBody = await readRequestBody(req).catch((err) => {
            res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: err.message }));
            return null;
          });
          if (rawBody === null) return;
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

    const oauthCallbackMatch = pathname.match(/^\/auth\/oauth\/(google|github|apple)\/callback$/);
    if (oauthCallbackMatch && (req.method === "GET" && (oauthCallbackMatch[1] !== "apple" || localDev) ||
        req.method === "POST" && oauthCallbackMatch[1] === "apple")) {
      const provider = oauthCallbackMatch[1];
      if (isOAuthProvider(provider)) {
        let callbackParams = parsedUrl.searchParams;
        if (req.method === "POST") {
          if (String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
            res.writeHead(415, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Expected an Apple form response." }));
            return;
          }
          const rawBody = await readRequestBody(req).catch((err) => {
            res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: err.message }));
            return null;
          });
          if (rawBody === null) return;
          callbackParams = new URLSearchParams(rawBody);
        }
        const oauthCookie = verifyOAuthStateCookie(cookieOf(req, OAUTH_STATE_COOKIE), oauthSecret);
        const queryState = callbackParams.get("state") ?? "";
        const queryError = callbackParams.get("error");
        const code = callbackParams.get("code") ?? "";
        const stateMatches = Boolean(oauthCookie && oauthCookie.provider === provider && oauthCookie.state === queryState && queryState);
        if (!stateMatches && provider === "apple" && req.method === "POST") {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: "Your sign-in session expired or did not match. Try again." }));
          return;
        }
        const restoredSid = provider === "apple" && req.method === "POST" && stateMatches && typeof oauthCookie.sid === "string" ? oauthCookie.sid : null;
        let { sid, controller } = sessionFor(req, res, restoredSid);

        if (!stateMatches) {
          controller.failExternalAuth("Your sign-in session expired or did not match. Try again.");
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
          return;
        }
        const clearCookiePolicy = provider === "apple" && req.method === "POST" && !localDev ? "; SameSite=None; Secure" : `; SameSite=Lax${cookieSecureAttr}`;
        appendSetCookie(res, `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Max-Age=0${clearCookiePolicy}`);
        if (queryError) {
          const msg =
            ["access_denied", "user_cancelled_authorize"].includes(queryError)
              ? `${oauthProviderLabel(provider)} sign-in was canceled.`
              : `${oauthProviderLabel(provider)} sign-in failed (${queryError}).`;
          controller.failExternalAuth(msg);
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
          return;
        }

        if (!code) {
          controller.failExternalAuth("Your sign-in session expired or did not match. Try again.");
          persist(sid, controller);
          res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          res.end();
          return;
        }

        try {
          const redirectUri = buildOAuthCallbackUrl(publicOriginOf(req), provider);
          const profile =
            code.startsWith("devcode_") && localDev
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
                  nonce: oauthCookie.nonce,
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
            env.AUTH_EXCHANGE_SECRET,
            fetchImpl,
          );
          if (!backendSession?.account_id || !backendSession?.session_token) {
            throw new Error("Verified backend session is unavailable.");
          }
          const resolvedAccount = resolveOrCreateOAuthAccount(profile, backendSession?.account_id, backendSession?.roles);
          controller = await authenticateAndHydrateFromBackend(
            sid,
            controller,
            resolvedAccount,
            backendSession.session_token,
            Boolean(profile.emailVerified || backendSession?.email_verified),
            backendSession.expires_at,
          );
          await persistAsync(sid, controller, true);
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
      if (authStatus !== "authenticated" || !store.data.sessions[sid]?.explicitAuth) {
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
        putPasskeyCeremony(`${sid}:reg`, ceremony);
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
      if (authStatus !== "authenticated" || !store.data.sessions[sid]?.explicitAuth) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Sign in before registering a passkey." }));
        return;
      }
      const ceremony = takePasskeyCeremony(`${sid}:reg`);
      try {
        const rawBody = await readRequestBody(req);
        const attestationResponse = rawBody ? JSON.parse(rawBody) : null;
        const { storedCredential } = await verifyPasskeyRegistration({
          response: attestationResponse,
          ceremony,
          account,
        });
        const apiToken = apiTokenForSession(sid, controller);
        if (!apiToken) {
          throw Object.assign(new Error("Verified backend session is unavailable."), { statusCode: 401 });
        }
        const stored = await callBackendJson("PUT", `/v1/me/passkeys/${encodeURIComponent(storedCredential.id)}`, {
          token: apiToken,
          body: { credential_json: storedCredential },
        });
        if (!stored.ok) {
          throw Object.assign(new Error("Passkey registration could not be saved."), { statusCode: 502 });
        }
        ensureStoredAccountRecord(account);
        store.data.passkeys[storedCredential.id] = storedCredential;
        store.save();
        syncControllerPasskeys(controller, `Added ${storedCredential.name} for passwordless sign-in.`);
        await persistAsync(sid, controller);
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
        res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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
        putPasskeyCeremony(`${sid}:auth`, ceremony);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ options: authOptions, rpId: rpConfig.rpID }));
      } catch (err) {
        res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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
      let { sid, controller } = sessionFor(req, res);
      const ceremony = takePasskeyCeremony(`${sid}:auth`);
      try {
        const rawBody = await readRequestBody(req);
        const assertionResponse = rawBody ? JSON.parse(rawBody) : null;
        if (assertionResponse?.id && !store.data.passkeys[assertionResponse.id]) {
          const remotePk = await callBackendJson(
            "GET",
            `/v1/auth/passkeys/${encodeURIComponent(String(assertionResponse.id))}`,
            { headers: env.AUTH_EXCHANGE_SECRET ? { "x-auth-exchange-secret": env.AUTH_EXCHANGE_SECRET } : {} },
          );
          if (remotePk.ok && remotePk.data?.credential_json && typeof remotePk.data.credential_json === "object") {
            store.data.passkeys[String(assertionResponse.id)] = remotePk.data.credential_json;
          }
        }
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

        const pkSessRes = env.AUTH_EXCHANGE_SECRET
          ? await callBackendJson("POST", "/v1/auth/passkeys/session", {
              headers: { "x-auth-exchange-secret": env.AUTH_EXCHANGE_SECRET },
              body: {
                credential_id: result.storedCredential.id,
                counter: result.authenticationInfo.newCounter,
              },
            })
          : { ok: false, data: null };
        if (!pkSessRes.ok || !pkSessRes.data?.account_id || !pkSessRes.data?.session_token) {
          throw new Error("Verified backend session is unavailable.");
        }
        const resolvedAccount = {
          accountId: pkSessRes.data.account_id,
          email: pkSessRes.data.email || result.storedCredential.email || "learner@syllabus.build",
          username:
            pkSessRes.data.display_name ||
            defaultUsernameOfEmail(pkSessRes.data.email || result.storedCredential.email || "learner@syllabus.build"),
          ...(pkSessRes.data.avatar_url ? { avatarUrl: pkSessRes.data.avatar_url } : {}),
          role: pkSessRes.data.roles?.includes("admin") ? "Admin" : "User",
        };
        controller = await authenticateAndHydrateFromBackend(
          sid,
          controller,
          resolvedAccount,
          pkSessRes.data.session_token,
          Boolean(pkSessRes.data?.email_verified),
          pkSessRes.data.expires_at,
        );
        await persistAsync(sid, controller);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(
          JSON.stringify({
            verified: true,
            state: controller.getState(),
            html: controller.renderHtml(),
          }),
        );
      } catch (err) {
        res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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

    if (pathname === "/catalog/schema/resource.schema.json" && req.method === "GET") {
      const schemaCandidate = fs.existsSync(path.join(openCatalogDir, "schema/resource.schema.json"))
        ? path.join(openCatalogDir, "schema/resource.schema.json")
        : path.join(DEFAULT_OPEN_CATALOG_DIR, "schema/resource.schema.json");
      if (!fs.existsSync(schemaCandidate)) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Catalog JSON schema not found." }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/schema+json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(fs.readFileSync(schemaCandidate, "utf8"));
      return;
    }

    if (pathname === "/catalog/resources.json" && req.method === "GET") {
      const diskCatalog = refreshOpenCatalogIntoStore();
      const merged = {
        ...catalogResourcesJson.resources,
        ...catalogResourcesJson.global_discovered_resources,
        ...diskCatalog.all,
        ...store.data.resources,
      };
      const entries = Object.values(merged)
        .filter((e) => e && typeof e === "object" && typeof e.resource_version_id === "string" &&
          !store.data.globalRemovedResourceIds.includes(e.resource_version_id))
        .sort((a, b) => a.resource_version_id.localeCompare(b.resource_version_id));
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(
        JSON.stringify(
          {
            schema_version: "1.0.0",
            contribute_directory: "catalog/resources/<subject>/<resource_version_id>.json",
            json_schema: "/catalog/schema/resource.schema.json",
            count: entries.length,
            resources: entries,
          },
          null,
          2,
        ),
      );
      return;
    }

    const singleCatalogMatch = pathname.match(/^\/catalog\/resources\/([a-zA-Z0-9._-]+)\.json$/);
    if (singleCatalogMatch && req.method === "GET") {
      const requestedId = decodeURIComponent(singleCatalogMatch[1]);
      if (store.data.globalRemovedResourceIds.includes(requestedId)) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: `Resource '${requestedId}' is not in the global catalog.` }));
        return;
      }
      const diskCatalog = refreshOpenCatalogIntoStore();
      const entry =
        store.data.resources[requestedId] ??
        diskCatalog.all[requestedId] ??
        catalogResourcesJson.global_discovered_resources[requestedId] ??
        catalogResourcesJson.resources[requestedId];
      if (!entry) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: `Resource '${requestedId}' not found in open catalog.` }));
        return;
      }
      const collection =
        diskCatalog.resources[requestedId] || catalogResourcesJson.resources[requestedId]
          ? "curated"
          : "community_discovered";
      const safeFile = requestedId.replace(/[^a-zA-Z0-9._-]+/g, "-");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Disposition": `attachment; filename="${safeFile}.json"`,
      });
      res.end(serializeOpenCatalogEntry(entry, collection));
      return;
    }

    if (pathname === "/api/account/export" && req.method === "GET") {
      const { sid, controller } = sessionFor(req, res);
      const state = controller.getState();
      if (state.authStatus !== "authenticated") {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Sign in before exporting your account archive." }));
        return;
      }
      const accountId = state.account.accountId;
      const wsKey = workspaceKeyFor(sid, store.data.sessions[sid]) ?? accountId;
      const workspace = extractWorkspaceSnapshot(controller, store.data.accountWorkspaces[wsKey]);
      const vaultEntries = Object.values(store.data.byokVault[accountId] ?? {});
      const archive = {
        schema_version: "1.0.0",
        exported_at: new Date().toISOString(),
        account: {
          account_id: accountId,
          email: state.account.email,
          username: state.account.username ?? defaultUsernameOfEmail(state.account.email),
          role: state.account.role,
        },
        included_scope: [
          "account_profile",
          "syllabi_and_overrides",
          "schedule_overrides",
          "progress_events_and_activity_states",
          "library_resources",
          "adoptions_publications_and_votes",
          "reminder_and_ui_preferences",
          "byok_masked_metadata_only",
        ],
        excluded_scope: [
          "raw_byok_api_keys",
          "encrypted_byok_ciphertexts",
          "password_hashes",
          "passkey_cose_public_keys",
        ],
        workspace: {
          selected_syllabus_id: workspace.selectedSyllabusId,
          generated_plans: workspace.generatedPlans,
          syllabus_overrides: workspace.syllabusOverrides,
          schedule_overrides: workspace.scheduleOverrides,
          recorded_progress_events: workspace.recordedProgressEvents,
          activity_states: workspace.activityStates,
          completed_subtask_ids: workspace.completedSubtaskIds,
          skipped_activity_ids: workspace.skippedActivityIds,
          user_library_resource_ids: workspace.userLibraryResourceIds,
          library_resources: Object.fromEntries(
            (workspace.userLibraryResourceIds ?? [])
              .map((id) => [id, state.catalogResources[id] ?? store.data.resources[id]])
              .filter(([, v]) => Boolean(v)),
          ),
          adoptions: workspace.adoptions,
          published_listings: workspace.publishedListings,
          unpublished_publication_ids: workspace.unpublishedPublicationIds,
          votes: workspace.votes,
          preferences: {
            theme: workspace.themePreference,
            solid_surfaces: workspace.solidSurfaces,
            reduce_motion: workspace.reduceMotion,
            flow_order: workspace.flowOrder,
            deep_dive: workspace.deepDive,
            spaced_review: workspace.spacedReview,
            reminders_enabled: workspace.remindersEnabled,
            reminders_paused: workspace.remindersPaused,
            reminder_timezone: workspace.reminderTimezone,
            reminder_weekday_time: workspace.reminderWeekdayTime,
            reminder_weekend_time: workspace.reminderWeekendTime,
            reminder_lead_minutes: workspace.reminderLeadMinutes,
            provider_models: workspace.providerModels,
          },
        },
        byok_credentials_metadata: vaultEntries.map((envlp) => ({
          credential_ref: envlp.credential_ref,
          provider_id: envlp.provider_id,
          label: envlp.label,
          version: envlp.version,
          masked_hint: `••••${envlp.masked_suffix}`,
          updated_at: envlp.updated_at,
        })),
      };
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="syllabus-account-export.json"',
      });
      res.end(`${JSON.stringify(archive, null, 2)}\n`);
      return;
    }

    if (pathname === "/api/schedule.ics" && req.method === "GET") {
      const { controller } = sessionFor(req, res);
      const state = controller.getState();
      if (state.authStatus !== "authenticated") {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Sign in before exporting your study calendar." }));
        return;
      }
      const icsText = controller.exportScheduleIcs();
      res.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="syllabus-schedule.ics"',
      });
      res.end(icsText);
      return;
    }

    if (pathname === "/api/billing/checkout" && req.method === "POST") {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Hosted checkout is unavailable." }));
      return;
    }

    if (pathname === "/api/billing/webhook" && req.method === "POST") {
      const rawBody = await readRequestBody(req).catch((err) => {
        res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
        return null;
      });
      if (rawBody === null) return;
      const sigHeader = String(
        req.headers["x-billing-signature"] ?? req.headers["stripe-signature"] ?? "",
      ).trim();
      const apiRes = await callBackendJson("POST", "/v1/billing/webhooks", {
        rawBody,
        headers: sigHeader ? { "X-Billing-Signature": sigHeader } : {},
      });
      if (apiRes.reachable) {
        res.writeHead(apiRes.status || 200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(apiRes.data ?? { received: apiRes.ok }));
        return;
      }
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Billing backend is unavailable." }));
      return;
    }

    if (pathname === "/api/resources/manual" && req.method === "POST") {
      const { sid, controller } = sessionFor(req, res);
      if (controller.getState().authStatus !== "authenticated" || !store.data.sessions[sid]?.explicitAuth) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Sign in before adding a resource." }));
        return;
      }
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
        const analyzedOutcome = await runServerManualResourceAnalysis(sid, controller, data);
        if ("error" in analyzedOutcome) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: analyzedOutcome.error }));
          return;
        }
        controller.applyUiAction("ingest-manual-resource", data, null, null, analyzedOutcome);
        const nextState = controller.getState();
        const createdEntry = nextState.catalogResources[analyzedOutcome.resourceVersionId];
        if (createdEntry && nextState.authStatus === "authenticated" && store.data.sessions[sid]?.explicitAuth && isAdminAccount(nextState.account)) {
          const result = await callBackendJson("POST", "/v1/catalog/resources/manual", {
            token: apiTokenForSession(sid),
            body: {
              resource_version_id: analyzedOutcome.resourceVersionId,
              raw_text: data.rawText,
              url: analyzedOutcome.canonicalUrl,
              title_override: analyzedOutcome.title,
            },
          });
          requireCatalogBackendSuccess(sid, result);
          commitGlobalResource(analyzedOutcome.resourceVersionId, createdEntry);
        }
        await persistAsync(sid, controller);
        res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            analyzedDraft: analyzedOutcome,
            resource: createdEntry,
            state: nextState,
          }),
        );
      } catch (err) {
        res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (pathname === "/api/ui-state" && req.method === "POST") {
      let { sid, controller } = sessionFor(req, res);
      try {
          const body = await readRequestBody(req);
          const cmd = body ? JSON.parse(body) : {};
          if (["admin-remove-resource", "admin-verify-resource", "admin-reindex-resource", "admin-reindex-all"].includes(cmd.action) &&
              !(store.data.sessions[sid]?.explicitAuth && controller.getState().authStatus === "authenticated" && isAdminAccount(controller.getState().account))) {
            res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ error: "Admin role required." }));
            return;
          }
          if (
            !localDev &&
            cmd.action === "simulate-session-expired"
          ) {
            res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ error: "Debug session actions are disabled outside local development." }));
            return;
          }
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
            controller.openDialog(cmd.dialogId, cmd.publicationId);
          } else if (cmd.action === "close-dialog") {
            controller.closeDialog();
          } else if (cmd.action === "start-hosted-checkout") {
            throw new Error("Hosted checkout is unavailable.");
          } else if (cmd.action === "sign-out") {
            const apiToken = apiTokenForSession(sid, controller);
            if (apiToken) {
              await callBackendJson("DELETE", "/v1/auth/session", { token: apiToken });
            }
            controller.applyUiAction("sign-out");
            detachSessionToGuest(sid, controller);
          } else if (cmd.action === "confirm-delete-account") {
            const { authStatus, account } = controller.getState();
            if (authStatus === "authenticated") {
              const apiToken = apiTokenForSession(sid, controller);
              if (!apiToken) throw Object.assign(new Error("A verified session is required to delete your account."), { statusCode: 401 });
              const deletion = await callBackendJson("POST", "/v1/me/deletion-requests", {
                token: apiToken,
                headers: { "Idempotency-Key": `idem-del-${account.accountId}` },
                body: { confirm_deletion: true, reason: "learner_requested_account_deletion" },
              });
              if (!deletion.ok || deletion.data?.status !== "completed") throw Object.assign(new Error("Account deletion could not be confirmed."), { statusCode: 502 });
              const deletedAccountId = account.accountId;
              const deletedEmail = account.email.trim().toLowerCase();
              delete store.data.accountWorkspaces[deletedAccountId];
              delete store.data.accountWorkspaces[`sandbox:${sid}`];
              delete store.data.byokVault[deletedAccountId];
              for (const [accKey, accRec] of Object.entries(store.data.accounts)) {
                if (accKey === deletedEmail || accRec?.accountId === deletedAccountId) {
                  delete store.data.accounts[accKey];
                }
              }
              for (const [idKey, linkedEmail] of Object.entries(store.data.oauthIdentities)) {
                if (linkedEmail === deletedEmail) {
                  delete store.data.oauthIdentities[idKey];
                }
              }
              for (const [pkId, pkRec] of Object.entries(store.data.passkeys)) {
                if (pkRec?.passkeyUserId === deletedAccountId) {
                  delete store.data.passkeys[pkId];
                }
              }
              controller.applyUiAction("confirm-delete-account");
              detachSessionToGuest(sid, controller);
            } else {
              throw Object.assign(new Error("A verified session is required to delete your account."), { statusCode: 401 });
            }
          } else if (cmd.action === "replace-key") {
            const beforeState = controller.getState();
            if (beforeState.authStatus === "authenticated" && store.data.sessions[sid]?.explicitAuth) {
              const accountId = beforeState.account.accountId;
              const providerId = String(cmd.providerId ?? beforeState.editingCredentialProviderId ?? "openai").trim();
              const rawKey = String(cmd.keyValue ?? "").trim();
              const wsKey = workspaceKeyFor(sid, store.data.sessions[sid]) ?? accountId;
              const prevWs = store.data.accountWorkspaces[wsKey] ?? extractWorkspaceSnapshot(controller);
              if (rawKey.length < 8) {
                controller.setByokCredentials(
                  resolveByokCredentialsForAccount(accountId, prevWs),
                  undefined,
                  "Enter a valid API key (at least 8 characters).",
                );
              } else {
                const prevEnvelope = store.data.byokVault[accountId]?.[providerId];
                const envelope = sealByokApiKey({
                  masterKey: byokMasterKey,
                  accountId,
                  providerId,
                  rawApiKey: rawKey,
                  credentialRef: typeof cmd.credentialRef === "string" ? cmd.credentialRef : undefined,
                  previousVersion: prevEnvelope?.version ?? 0,
                });
                if (!store.data.byokVault[accountId]) {
                  store.data.byokVault[accountId] = {};
                }
                store.data.byokVault[accountId][providerId] = envelope;
                store.save();
                const nextCreds = resolveByokCredentialsForAccount(accountId);
                const nextPrimary =
                  beforeState.primaryCredentialRef &&
                  nextCreds.some((c) => c.credential_ref === beforeState.primaryCredentialRef)
                    ? beforeState.primaryCredentialRef
                    : envelope.credential_ref;
                controller.setByokCredentials(
                  nextCreds,
                  nextPrimary,
                  `API key encrypted with AES-256-GCM and stored in server custody (••••${envelope.masked_suffix}). Queued jobs keep their active key version.`,
                );
                if (envelope.version === 1) {
                  await syncBackendResourceEndpoint(
                    sid,
                    "POST",
                    "/v1/me/credentials",
                    {
                      credential_ref: envelope.credential_ref,
                      provider_id: providerId,
                      label: envelope.label,
                      api_key: rawKey,
                    },
                  );
                } else {
                  await syncBackendResourceEndpoint(
                    sid,
                    "PATCH",
                    `/v1/me/credentials/${encodeURIComponent(envelope.credential_ref)}`,
                    {
                      api_key: rawKey,
                      label: envelope.label,
                    },
                    { "If-Match": `"cred-v${envelope.version - 1}"` },
                  );
                }
              }
            }
          } else if (cmd.action === "delete-connection") {
            const beforeState = controller.getState();
            if (beforeState.authStatus === "authenticated" && store.data.sessions[sid]?.explicitAuth) {
              const accountId = beforeState.account.accountId;
              const targetRef = typeof cmd.credentialRef === "string" ? cmd.credentialRef : "";
              const providerId =
                (typeof cmd.providerId === "string" && cmd.providerId) ||
                beforeState.byokCredentials.find((c) => c.credential_ref === targetRef)?.provider_id ||
                "";
              const prevEnvelope = providerId ? store.data.byokVault[accountId]?.[providerId] : undefined;
              if (providerId && store.data.byokVault[accountId]) {
                delete store.data.byokVault[accountId][providerId];
              }
              const wsKey = workspaceKeyFor(sid, store.data.sessions[sid]) ?? accountId;
              const prevWs = store.data.accountWorkspaces[wsKey] ?? extractWorkspaceSnapshot(controller);
              store.save();
              const nextCreds = resolveByokCredentialsForAccount(accountId);
              controller.setByokCredentials(
                nextCreds,
                undefined,
                "Removed encrypted API key from server custody. Revoke the key in your provider dashboard if it is no longer needed.",
              );
              const credRefToRevoke = prevEnvelope?.credential_ref || targetRef;
              if (credRefToRevoke && prevEnvelope) {
                await syncBackendResourceEndpoint(
                  sid,
                  "DELETE",
                  `/v1/me/credentials/${encodeURIComponent(credRefToRevoke)}`,
                  undefined,
                  { "If-Match": `"cred-v${prevEnvelope.version}"` },
                );
              }
            }
          } else if (cmd.action === "delete-passkey" && typeof cmd.credentialId === "string") {
            const { authStatus, account } = controller.getState();
            const existing = store.data.passkeys[cmd.credentialId];
            if (authStatus === "authenticated" && existing && existing.passkeyUserId === account.accountId) {
              const apiToken = apiTokenForSession(sid, controller);
              if (!apiToken) {
                throw Object.assign(new Error("Verified backend session is unavailable."), { statusCode: 401 });
              }
              const deleted = await callBackendJson("DELETE", `/v1/me/passkeys/${encodeURIComponent(cmd.credentialId)}`, {
                token: apiToken,
              });
              if (!deleted.ok) {
                throw Object.assign(new Error("Passkey deletion could not be saved."), { statusCode: 502 });
              }
              delete store.data.passkeys[cmd.credentialId];
              store.save();
              syncControllerPasskeys(controller, "Passkey removed from your account.");
            } else {
              controller.applyUiAction("delete-passkey", { credentialId: cmd.credentialId });
            }
          } else if (typeof cmd.action === "string") {
            const data = Object.fromEntries(
              Object.entries(cmd).filter(([k, value]) => k !== "keyValue" && typeof value === "string"),
            );
            let live = null;
            let analyzedOutcome = null;
            let generatedConceptCheck = null;
            if (cmd.action === "generate-syllabus-ai") {
              const request = controller.liveGenerationRequest(data);
              const beforeState = controller.getState();
              const wsKey = workspaceKeyFor(sid, store.data.sessions[sid]);
              const ws = (wsKey && store.data.accountWorkspaces[wsKey]) || {};
              const apiKey =
                request && beforeState.authStatus === "authenticated" && store.data.sessions[sid]?.explicitAuth
                  ? resolveRuntimeApiKeyForAccount(beforeState.account.accountId, request.providerId, ws)
                  : undefined;
              if (request && apiKey) {
                live = await requestLiveDraft(request, apiKey, fetchImpl).then((draft) => ({ draft }), (err) => ({ error: err.message }));
              }
            } else if (cmd.action === "generate-activity-check") {
              const tutorReq = controller.liveConceptCheckRequest(data.activityId);
              const beforeState = controller.getState();
              const wsKey = workspaceKeyFor(sid, store.data.sessions[sid]);
              const ws = (wsKey && store.data.accountWorkspaces[wsKey]) || {};
              const apiKey =
                tutorReq && beforeState.authStatus === "authenticated" && store.data.sessions[sid]?.explicitAuth
                  ? resolveRuntimeApiKeyForAccount(beforeState.account.accountId, tutorReq.providerId, ws)
                  : undefined;
              if (tutorReq && apiKey) {
                const tutorRes = await requestLiveConceptCheck(tutorReq, apiKey, fetchImpl).catch(
                  () => null,
                );
                if (tutorRes && !("error" in tutorRes)) {
                  generatedConceptCheck = tutorRes;
                }
              }
            } else if (cmd.action === "ingest-manual-resource") {
              if (store.data.sessions[sid]?.explicitAuth) {
                analyzedOutcome = await runServerManualResourceAnalysis(sid, controller, data);
              }
            }
            controller.applyUiAction(
              cmd.action,
              data,
              data.practiceChoice ?? data.diagnosticChoice ?? null,
              live,
              analyzedOutcome,
              generatedConceptCheck,
            );

            const afterState = controller.getState();
            if (afterState.authStatus === "authenticated") {
              const verifiedAdmin = store.data.sessions[sid]?.explicitAuth && isAdminAccount(afterState.account);
              if (cmd.action === "ingest-manual-resource" && verifiedAdmin && analyzedOutcome && !("error" in analyzedOutcome)) {
                const result = await callBackendJson("POST", "/v1/catalog/resources/manual", {
                  token: apiTokenForSession(sid),
                  body: {
                    resource_version_id: analyzedOutcome.resourceVersionId,
                    raw_text: data.rawText ?? "",
                    url: analyzedOutcome.canonicalUrl,
                    title_override: analyzedOutcome.title,
                  },
                });
                requireCatalogBackendSuccess(sid, result);
                const added = afterState.catalogResources[analyzedOutcome.resourceVersionId];
                if (added) commitGlobalResource(analyzedOutcome.resourceVersionId, added);
              } else if (cmd.action === "save-resource-edit" && verifiedAdmin && data.resourceVersionId && !afterState.resourceEditorError) {
                const updated = afterState.catalogResources[data.resourceVersionId];
                if (updated) {
                  const result = await callBackendJson("PATCH", `/v1/catalog/resources/${encodeURIComponent(data.resourceVersionId)}`, {
                    token: apiTokenForSession(sid),
                    body: {
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
                  });
                  requireCatalogBackendSuccess(sid, result);
                  commitGlobalResource(data.resourceVersionId, updated);
                }
              } else if ((cmd.action === "delete-library-resource" || cmd.action === "admin-remove-resource") && verifiedAdmin && data.resourceId) {
                const result = await callBackendJson("DELETE", `/v1/catalog/resources/${encodeURIComponent(data.resourceId)}`, {
                  token: apiTokenForSession(sid),
                });
                requireCatalogBackendSuccess(sid, result);
                removeGlobalResource(data.resourceId);
              } else if (cmd.action === "link-library-resource" && data.resourceVersionId && data.targetSyllabusId) {
                await syncBackendResourceEndpoint(
                  sid,
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
                  sid,
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
                const apiToken = apiTokenForSession(sid, controller);
                if (apiToken) {
                  await callBackendJson("PATCH", "/v1/me/profile", {
                    token: apiToken,
                    body: {
                      email: nextAccount.email,
                      display_name: nextAccount.username,
                      ...(nextAccount.avatarUrl ? { avatar_url: nextAccount.avatarUrl } : {}),
                    },
                  });
                }
              }
            }
          }
          const forceRemoteSync = cmd.action === "replace-key" || cmd.action === "delete-connection";
          await persistAsync(sid, controller, forceRemoteSync);

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              state: controller.getState(),
              html: controller.renderHtml(),
            })
          );
        } catch (err) {
          res.writeHead(err?.statusCode ?? 400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      return;
    }

    if (pathname.startsWith("/auth/")) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Not found." }));
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
      controller.openDialog("dialog-auth");
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
  const explicitStorePath = process.env.WEB_STORE_PATH?.trim()
    ? path.resolve(process.env.WEB_STORE_PATH.trim())
    : undefined;
  const { server } = createWebAppServer({ storePath: explicitStorePath });
  const bindHost = host === "localhost" ? "127.0.0.1" : host;
  server.listen(port, bindHost, () => {
    console.log(
      `Syllabus.build Interactive Web App listening at http://${host}:${port}`
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
