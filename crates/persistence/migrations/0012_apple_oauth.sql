ALTER TABLE oauth_identities DROP CONSTRAINT IF EXISTS oauth_identities_provider_check;
ALTER TABLE oauth_identities DROP CONSTRAINT IF EXISTS oauth_identities_apple_provider_check;
ALTER TABLE oauth_identities ADD CONSTRAINT oauth_identities_apple_provider_check
    CHECK (provider IN ('google', 'github', 'apple'));

ALTER TABLE oauth_authorization_states DROP CONSTRAINT IF EXISTS oauth_authorization_states_provider_check;
ALTER TABLE oauth_authorization_states DROP CONSTRAINT IF EXISTS oauth_authorization_states_apple_provider_check;
ALTER TABLE oauth_authorization_states ADD CONSTRAINT oauth_authorization_states_apple_provider_check
    CHECK (provider IN ('google', 'github', 'apple'));
