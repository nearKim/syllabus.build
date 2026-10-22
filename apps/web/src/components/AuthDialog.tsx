import type { VNode } from "preact";
import type { LearnSubDestination, TopLevelDestination } from "../index.ts";
import type { Account, AuthStatus } from "./HeaderBar.tsx";

export const AUTH_STATUSES = ["authenticated", "guest", "session_expired"] as const;

export const PERSONAS = {
  learner: { accountId: "learner-default", email: "alex@curriculum.io", role: "Learner" },
  curator: { accountId: "curator-ada", email: "ada@curriculum.io", role: "Curator" },
  moderator: { accountId: "moderator-mo", email: "mo@curriculum.io", role: "Moderator" },
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

export function AuthDialog({ open, authStatus, account, returnTo, authNotice }: AuthDialogProps): VNode {
  const signedOut = authStatus === "guest";
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
          <h2 id="dialog-auth-title">{authStatus === "authenticated" ? "Account" : "Sign in"}</h2>
          <button type="submit" class="btn-secondary" data-action="close-dialog">
            Close
          </button>
        </header>
        {returnTo ? (
          <p class="auth-return" role="status">
            After you sign in, you return to <strong>{returnTo.label}</strong>. Nothing is voted, published, adopted, or bought on your behalf.
          </p>
        ) : null}
        {authStatus === "session_expired" ? (
          <p class="prose">
            Sign in as {account.email} to keep your work. Signing in as another account starts with a clean session.
          </p>
        ) : null}
        {authStatus === "authenticated" ? (
          <p class="prose">
            Signed in as <strong>{account.email}</strong> · {account.role}.
          </p>
        ) : null}
        <label class="field" for="auth-email-input">
          Email
          <input
            id="auth-email-input"
            type="email"
            name="email"
            autocomplete="username webauthn"
            spellcheck={false}
            value={account.email}
            required
          />
        </label>
        {authNotice ? (
          <p class="field-error" role="alert">
            {authNotice}
          </p>
        ) : null}
        <div class="action-row">
          <button type="submit" class="btn-primary">
            Sign in
          </button>
          <button type="button" class="btn-secondary" data-action="sign-in-passkey">
            Sign in with passkey
          </button>
        </div>
        <p class="meta-text">
          Local demo: no account provider is connected in this build, so sign-in checks no password.
        </p>
        <section class="persona-switcher" aria-labelledby="persona-switcher-title">
          <h3 id="persona-switcher-title">Demo personas</h3>
          <div class="persona-grid">
            {PERSONA_CHOICES.map((persona) => {
              const current =
                persona === "guest" ? signedOut : !signedOut && account.accountId === PERSONAS[persona].accountId;
              return (
                <button
                  key={persona}
                  type="button"
                  class="btn-secondary persona-btn"
                  data-action="switch-persona"
                  data-persona={persona}
                  aria-pressed={current}
                >
                  {persona === "guest" ? "Guest" : PERSONAS[persona].role}
                </button>
              );
            })}
            <button
              type="button"
              class="btn-secondary persona-btn"
              data-action="simulate-session-expired"
              disabled={authStatus !== "authenticated"}
            >
              Expire session
            </button>
          </div>
        </section>
      </form>
    </dialog>
  );
}
