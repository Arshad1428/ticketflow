ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_secret text;
ALTER TABLE users ADD COLUMN mfa_pending text;
