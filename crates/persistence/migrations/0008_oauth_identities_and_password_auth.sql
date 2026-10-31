-- Migration 0008: Standard OAuth 2.0 / OIDC Identity Linking & Password Credentials
-- Extends accounts with profile display metadata and hashed password credentials, and adds
-- federated OAuth 2.0 identity bindings (Google, GitHub) and transient PKCE state tracking.

ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS display_name TEXT NULL,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL,
    ADD COLUMN IF NOT EXISTS password_hash TEXT NULL;

CREATE TABLE IF NOT EXISTS oauth_identities (
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    provider_subject TEXT NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 256),
    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT NULL,
    avatar_url TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_identities_account_id
    ON oauth_identities (account_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_states (
    state_sha256 TEXT PRIMARY KEY CHECK (length(state_sha256) = 64),
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    code_verifier TEXT NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
    return_to TEXT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_states_expires_at
    ON oauth_authorization_states (expires_at);
