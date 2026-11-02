-- Keep normalized account and session role columns aligned with the runtime roles.
ALTER TABLE accounts ALTER COLUMN roles SET DEFAULT ARRAY['user']::TEXT[];
ALTER TABLE auth_sessions ALTER COLUMN roles SET DEFAULT ARRAY['user']::TEXT[];

UPDATE accounts SET roles = CASE
    WHEN roles && ARRAY['user', 'admin']::TEXT[] THEN
        ARRAY(SELECT DISTINCT role FROM unnest(roles) AS role WHERE role IN ('user', 'admin'))
    ELSE ARRAY['user']::TEXT[]
END;
UPDATE auth_sessions SET roles = CASE
    WHEN roles && ARRAY['user', 'admin']::TEXT[] THEN
        ARRAY(SELECT DISTINCT role FROM unnest(roles) AS role WHERE role IN ('user', 'admin'))
    ELSE ARRAY['user']::TEXT[]
END;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_roles_only;
ALTER TABLE accounts ADD CONSTRAINT accounts_roles_only
    CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['user', 'admin']::TEXT[]);
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_roles_only;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_roles_only
    CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['user', 'admin']::TEXT[]);
