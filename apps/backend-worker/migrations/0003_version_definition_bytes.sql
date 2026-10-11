-- Total size of a version's design (UTF-8 bytes of every non-deleted object's definition), kept
-- up to date on each object write so the LIMITS.versionDefinitionBytes check reads one row.
ALTER TABLE versions ADD COLUMN definition_bytes INTEGER NOT NULL DEFAULT 0;
