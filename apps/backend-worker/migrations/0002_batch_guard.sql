-- Fails a D1 batch on purpose, rolling back every statement in it (see `src/dao/batch.ts`).
-- A guard statement inserts a row only when its condition fails, and every row violates one of
-- the named CHECKs, so the table always stays empty and the error names the reason.
CREATE TABLE batch_guard (
  reason TEXT NOT NULL,
  CONSTRAINT stale_update CHECK (reason <> 'stale_update'),
  CONSTRAINT limit_exceeded CHECK (reason <> 'limit_exceeded')
);
