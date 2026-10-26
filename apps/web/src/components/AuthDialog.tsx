import type { VNode } from "preact";
import type { LearnSubDestination, TopLevelDestination } from "../index.ts";
import type { Account, AuthStatus } from "./HeaderBar.tsx";
import { SfIcon } from "./Icons.tsx";

export const AUTH_STATUSES = ["authenticated", "guest", "session_expired"] as const;

export const PERSONAS = {
  learner: { accountId: "learner-default", email: "alex@curriculum.io", displayName: "Alex Rivera", role: "Learner" },
  curator: { accountId: "curator-ada", email: "ada@curriculum.io", displayName: "Ada Lovelace", role: "Curator" },
  moderator: { accountId: "moderator-mo", email: "mo@curriculum.io", displayName: "Mo Chen", role: "Moderator" },
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

export const handleOf = (account: Account): string => `@${account.email.split("@")[0] ?? "learner"}`;

export interface AuthDialogProps {
  readonly open: boolean;
  readonly authStatus: AuthStatus;
  readonly account: Account;
  readonly returnTo: ReturnDestination | null;
  readonly authNotice: string | null;
}

export function AuthDialog({ open, account, returnTo, authNotice }: AuthDialogProps): VNode {
  return (
    <dialog
      id="dialog-auth"
      closedby="any"
      aria-labelledby="dialog-auth-title"
      data-open={String(open)}
      data-opaque-surface="true"
    >
      <form method="dialog" class="dialog-surface auth-surface" data-action="submit-sign-in">
        <header class="dialog-header">
          <div class="auth-funnel-title-group">
            <h2 id="dialog-auth-title">Sign in to Curriculum.io</h2>
            <p class="auth-funnel-subtitle">
              Save your progress, build custom curricula, and track verified mastery.
            </p>
          </div>
          <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
            <SfIcon name="close" />
          </button>
        </header>

        {returnTo ? (
          <p class="auth-return" role="status">
            After you sign in, you return to <strong>{returnTo.label}</strong>. Nothing is voted, published, adopted, or bought on your behalf.
          </p>
        ) : null}

        <div class="auth-funnel-stack">
          <button type="button" class="btn-secondary auth-passkey-btn" data-action="sign-in-passkey">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="7.5" cy="15.5" r="5.5" />
              <path d="m21 2-9.6 9.6" />
              <path d="m15.5 7.5 3 3L22 7l-3-3" />
            </svg>
            <span>Continue with passkey</span>
          </button>

          <p class="auth-funnel-divider-label">or continue with email</p>

          <label class="field" for="auth-email-input">
            Email address
            <input
              id="auth-email-input"
              type="email"
              name="email"
              autocomplete="username webauthn"
              spellcheck={false}
              placeholder="alex@curriculum.io"
              value={account.email}
              required
            />
          </label>

          <label class="field" for="auth-password-input">
            Password
            <input
              id="auth-password-input"
              type="password"
              name="password"
              autocomplete="current-password"
              placeholder="••••••••"
              value="demo-session-pass"
            />
          </label>

          {authNotice ? (
            <p class="field-error" role="alert">
              {authNotice}
            </p>
          ) : null}

          <button type="submit" class="btn-primary auth-submit-btn">
            Sign in
          </button>
        </div>
      </form>
    </dialog>
  );
}
