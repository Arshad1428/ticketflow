ALTER TABLE tickets ADD COLUMN response_elapsed numeric;
ALTER TABLE tickets ADD COLUMN resolution_elapsed numeric;
ALTER TABLE tickets ADD COLUMN package_name text;
ALTER TABLE tickets ADD COLUMN response_breached boolean DEFAULT false;
ALTER TABLE tickets ADD COLUMN resolution_breached boolean DEFAULT false;
