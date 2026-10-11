-- Adds the `duplicate` reason to batch_guard, for uniqueness rules a UNIQUE index can't express
-- (e.g. product names are unique among the products a user owns). SQLite can't add a CHECK to an
-- existing table; batch_guard never holds a row, so it is simply recreated.
DROP TABLE batch_guard;
CREATE TABLE batch_guard (
  reason TEXT NOT NULL,
  CONSTRAINT stale_update CHECK (reason <> 'stale_update'),
  CONSTRAINT limit_exceeded CHECK (reason <> 'limit_exceeded'),
  CONSTRAINT duplicate CHECK (reason <> 'duplicate')
);
