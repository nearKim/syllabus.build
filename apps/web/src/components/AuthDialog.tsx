import type { VNode } from "preact";
import type { LearnSubDestination, TopLevelDestination } from "../navigationShell.ts";
import { BrandMark } from "./HeaderBar.tsx";
import { usernameOf, type Account, type AuthStatus } from "../auth.ts";
import { SfIcon } from "./Icons.tsx";

export const AUTH_STATUSES = ["authenticated", "guest", "session_expired"] as const;
export const PERSONAS = {
  learner: { accountId: "learner-default", email: "alex@syllabus.build", username: "alex", role: "User" },
  curator: { accountId: "curator-ada", email: "ada@syllabus.build", username: "ada", role: "User" },
  moderator: { accountId: "moderator-mo", email: "mo@syllabus.build", username: "mo", role: "User" },
} as const satisfies Readonly<Record<string, Account>>;

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

export function AuthDialog({ open, returnTo, authNotice }: AuthDialogProps): VNode {
  return (
    <dialog
      id="dialog-auth"
      closedby="any"
      aria-labelledby="dialog-auth-title"
      aria-describedby="dialog-auth-description"
      data-open={String(open)}
      data-auth-mode="login"
      data-opaque-surface="true"
    >
      <div class="dialog-surface auth-surface">
        <div class="auth-head">
          <BrandMark className="brand-mark auth-brand-mark" />
          <div class="auth-heading">
            <h2 id="dialog-auth-title" class="auth-title" tabIndex={-1} autofocus>Sign in</h2>
            <p id="dialog-auth-description" class="auth-description">or create an account</p>
          </div>
        </div>

        {returnTo ? (
          <p class="auth-return" role="status">
            After you sign in, you return to <strong>{returnTo.label}</strong>. Nothing is voted, published, adopted, or bought on your behalf.
          </p>
        ) : null}

        {authNotice ? <p class="field-error" role="alert">{authNotice}</p> : null}

        <div class="auth-provider-list">
          <a href="/auth/oauth/google" class="auth-provider-btn" data-oauth-provider="google">
            <GoogleMark />
            <span>Continue with Google</span>
          </a>
          <a href="/auth/oauth/github" class="auth-provider-btn" data-oauth-provider="github">
            <GitHubMark />
            <span>Continue with GitHub</span>
          </a>
        </div>
        <button type="button" class="auth-passkey-action" data-action="sign-in-passkey">
          <PasskeyIcon />
          <span>Sign in with a passkey</span>
        </button>

        <button type="button" class="auth-close-btn" data-action="close-dialog" aria-label="Close">
          <SfIcon name="close" />
        </button>
      </div>
    </dialog>
  );
}
