-- The database scope reads its deployments as a delta ("参照 > データの取得とキャッシュ"): each row
-- records the database revision of its last change, like objects.revision for a version.
ALTER TABLE deployments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
UPDATE deployments SET revision = (SELECT revision FROM databases WHERE id = deployments.database_id);
CREATE INDEX deployments_database_id_revision ON deployments (database_id, revision);
