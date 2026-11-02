import type { VNode } from "preact";
import type { LearnSubDestination, TopLevelDestination } from "../navigationShell.ts";
import { BrandLockup } from "./HeaderBar.tsx";
import { usernameOf, type Account, type AuthStatus } from "../auth.ts";
import { SfIcon } from "./Icons.tsx";

export const AUTH_STATUSES = ["authenticated", "guest", "session_expired"] as const;
export const AUTH_MODES = ["login", "signup", "reset", "reset_confirm"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const PERSONAS = {
  learner: { accountId: "learner-default", email: "alex@syllabus.build", username: "alex", role: "Learner" },
  curator: { accountId: "curator-ada", email: "ada@syllabus.build", username: "ada", role: "Curator" },
  moderator: { accountId: "moderator-mo", email: "mo@syllabus.build", username: "mo", role: "Moderator" },
} as const satisfies Readonly<Record<string, Account>>;

export const PERSONA_CHOICES = ["learner", "curator", "moderator", "guest"] as const;
export type PersonaChoice = (typeof PERSONA_CHOICES)[number];

export interface ReturnDestination {
  readonly label: string;
  readonly topLevel: TopLevelDestination;
  readonly learnSubDestination: LearnSubDestination;
  readonly openDialogId: string | null;
  readonly adoptPublicationId: string | null;
}

export const handleOf = (account: Pick<Account, "email" | "username">): string => `@${usernameOf(account)}`;

export interface AuthDialogProps {
  readonly open: boolean;
  readonly authStatus: AuthStatus;
  readonly account: Account;
  readonly returnTo: ReturnDestination | null;
  readonly authNotice: string | null;
  readonly authMode?: AuthMode | undefined;
  readonly authPasswordVisible?: boolean | undefined;
  readonly resetEmail?: string | undefined;
}

export function GoogleMark(): VNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
      />
    </svg>
  );
}

export function GitHubMark(): VNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function MailIcon(): VNode {
  return (
    <svg class="auth-field-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2.5" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon(): VNode {
  return (
    <svg class="auth-field-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2.5" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function KeyCodeIcon(): VNode {
  return (
    <svg class="auth-field-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect width="18" height="14" x="3" y="5" rx="2.5" />
      <path d="M7 12h10" />
    </svg>
  );
}

// The eye button holds both glyphs. Its aria-pressed state picks the one that shows, so the client flips one attribute.
function EyeIcons(): VNode {
  return (
    <>
      <svg class="auth-eye-show" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <svg class="auth-eye-hide" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <path d="m1 1 22 22" />
      </svg>
    </>
  );
}

function PasskeyIcon(): VNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="4" />
      <path d="M2 21v-1.5A4.5 4.5 0 0 1 6.5 15h3" />
      <circle cx="17" cy="13" r="2.5" />
      <path d="M17 15.5V21l1.5-1.5L17 18l1.5-1.5" />
    </svg>
  );
}

export function AuthDialog({
  open,
  authStatus,
  account,
  returnTo,
  authNotice,
  authMode = "login",
  authPasswordVisible = false,
  resetEmail = "",
}: AuthDialogProps): VNode {
  const isSignup = authMode === "signup";
  const isResetRequest = authMode === "reset";
  const isResetConfirm = authMode === "reset_confirm";
  const isRecovery = isResetRequest || isResetConfirm;

  const prefilledEmail = isRecovery
    ? resetEmail
    : !isSignup && authStatus === "session_expired"
      ? account.email
      : "";

  const formAction = isSignup
    ? "submit-sign-up"
    : isResetRequest
      ? "request-password-reset"
      : isResetConfirm
        ? "confirm-password-reset"
        : "submit-sign-in";

  const dialogTitle = isSignup
    ? "Create your account"
    : isResetRequest
      ? "Reset your password"
      : isResetConfirm
        ? "Enter recovery code"
        : "Sign in with email";

  const submitLabel = isSignup
    ? "Create account"
    : isResetRequest
      ? "Send recovery code"
      : isResetConfirm
        ? "Reset password & sign in"
        : "Log in";

  const needsNewPassword = isSignup || isResetConfirm;
  const passwordAttrs = {
    name: "password",
    autocomplete: needsNewPassword ? "new-password" : "current-password",
    enterkeyhint: "done",
    minLength: needsNewPassword ? 8 : 1,
    placeholder: needsNewPassword ? "At least 8 characters" : "Password",
    "aria-describedby": needsNewPassword ? "auth-password-hint" : undefined,
    required: true,
  } as const;

  // novalidate: the product's own messages replace the browser's validation bubbles. After interaction or a failed
  // submit, each field the browser finds invalid takes the error state, and clears as soon as the field is valid.
  return (
    <dialog
      id="dialog-auth"
      closedby="any"
      aria-labelledby="dialog-auth-title"
      data-open={String(open)}
      data-auth-mode={authMode}
      data-opaque-surface="true"
    >
      <form
        method="dialog"
        class="dialog-surface auth-surface"
        data-action={formAction}
        novalidate
      >
        <div class="auth-head">
          <BrandLockup />
          <h2 id="dialog-auth-title" class="auth-title">
            {dialogTitle}
          </h2>
          {returnTo ? (
            <p class="auth-return" role="status">
              After you sign in, you return to <strong>{returnTo.label}</strong>. Nothing is voted, published, adopted, or bought on your behalf.
            </p>
          ) : null}
        </div>

        <div class="auth-fields">
          <div class="auth-field">
            <label class="auth-label" for="auth-email-input">Email</label>
            <div class="auth-input-wrap">
              <MailIcon />
              <input
                id="auth-email-input"
                type="email"
                name="email"
                autocomplete={isSignup || isRecovery ? "username" : "username webauthn"}
                spellcheck={false}
                autocapitalize="off"
                inputmode="email"
                pattern="[^\s@]+@[^\s@]+\.[^\s@]+"
                enterkeyhint={isResetRequest ? "done" : "next"}
                placeholder="you@example.com"
                value={prefilledEmail}
                autofocus={!isResetConfirm}
                required
              />
            </div>
          </div>

          {isResetConfirm ? (
            <div class="auth-field">
              <label class="auth-label" for="auth-reset-code-input">Recovery code</label>
              <p class="field-hint" id="auth-code-hint">Enter the 6-digit recovery code sent to your email.</p>
              <div class="auth-input-wrap">
                <KeyCodeIcon />
                <input
                  id="auth-reset-code-input"
                  type="text"
                  name="code"
                  autocomplete="one-time-code"
                  inputmode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  enterkeyhint="next"
                  placeholder="6-digit code"
                  aria-describedby="auth-code-hint"
                  autofocus
                  required
                />
              </div>
            </div>
          ) : null}

          {isResetRequest ? null : (
            <div class="auth-field">
              <div class="auth-label-row">
                <label class="auth-label" for="auth-password-input">
                  {isResetConfirm ? "New password" : "Password"}
                </label>
                {authMode === "login" ? (
                  <button
                    type="button"
                    class="auth-switch-btn auth-forgot-btn"
                    data-action="switch-auth-mode"
                    data-auth-mode="reset"
                  >
                    Forgot password?
                  </button>
                ) : null}
              </div>
              {needsNewPassword ? (
                <p class="field-hint" id="auth-password-hint">Use at least 8 characters.</p>
              ) : null}
              <div class="auth-password-wrap">
                <LockIcon />
                {authPasswordVisible ? (
                  <input id="auth-password-input" type="text" {...passwordAttrs} />
                ) : (
                  <input id="auth-password-input" type="password" {...passwordAttrs} />
                )}
                <button
                  type="button"
                  class="auth-password-eye"
                  data-action="toggle-auth-password"
                  aria-controls="auth-password-input"
                  aria-pressed={authPasswordVisible}
                  aria-label={authPasswordVisible ? "Hide password" : "Show password"}
                >
                  <EyeIcons />
                </button>
              </div>
            </div>
          )}
        </div>

        {authNotice ? (
          <p class="field-error" role="alert">
            {authNotice}
          </p>
        ) : null}

        <div class="auth-actions">
          <button type="submit" class="btn-primary auth-submit-btn">
            {submitLabel}
          </button>
        </div>

        {isRecovery ? null : (
          <div class="auth-alt-block">
            <p class="auth-alt-label">Or continue with</p>
            <div class="auth-alt-grid">
              <a href="/auth/oauth/google" class="auth-oauth-btn" data-oauth-provider="google">
                <GoogleMark />
                <span>Google</span>
              </a>
              <a href="/auth/oauth/github" class="auth-oauth-btn" data-oauth-provider="github">
                <GitHubMark />
                <span>GitHub</span>
              </a>
              {isSignup ? null : (
                <button type="button" class="auth-oauth-btn auth-passkey-btn" data-action="sign-in-passkey">
                  <PasskeyIcon />
                  <span>Passkey</span>
                </button>
              )}
            </div>
          </div>
        )}

        <p class="auth-switch">
          <span>
            {isRecovery
              ? "Remembered your password?"
              : isSignup
                ? "Already have an account?"
                : "Don't have an account?"}
          </span>
          <button
            type="button"
            class="auth-switch-btn"
            data-action="switch-auth-mode"
            data-auth-mode={isRecovery || isSignup ? "login" : "signup"}
          >
            {isRecovery || isSignup ? "Log in" : "Sign up"}
          </button>
        </p>

        {/* Last in tree order, so opening the dialog never puts initial focus on it and Enter submits the form. */}
        <button type="submit" class="auth-close-btn" data-action="close-dialog" aria-label="Close">
          <SfIcon name="close" />
        </button>
      </form>
    </dialog>
  );
}
