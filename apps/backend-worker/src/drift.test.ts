import { PGlite } from '@electric-sql/pglite'
import { readPostgresCatalog } from 'backend/src/repository/postgres-catalog.ts'
import { inspectPostgres, type PgSession } from 'backend/src/repository/postgres.interface.ts'
import { generatePostgresDdl } from 'backend/src/service/ddl-postgres.ts'
import { ddlOptionsSchema } from 'backend/src/service/ddl.ts'
import { compareCatalogs, designHash, matchesAppliedDesign } from 'backend/src/service/drift.ts'
import { expect, test } from 'vite-plus/test'

import {
  applyPostgresSteps,
  testColumn,
  testContext,
  testObject,
  testTable,
  testSqlValidator,
} from './test-sql.ts'

test(
  'PostgreSQL catalog detects external structural changes, excludes manager and counters',
  { timeout: 30_000 },
  async () => {
    const db = new PGlite()
    const session: PgSession = {
      query: async (sql, values) => {
        const r = await db.query<Record<string, unknown>>(sql, values)
        return { rows: r.rows, rowCount: r.affectedRows ?? 0 }
      },
      close: async () => db.close(),
    }
    try {
      const context = testContext(),
        schema = testObject('schema', 'public', { owner: null, comment: null })
      const objects = [
        schema,
        testTable('items', schema.objectKey, [
          testColumn('id', { generation: { kind: 'identity', always: true } }),
        ]),
      ]
      await applyPostgresSteps(
        db,
        (
          await generatePostgresDdl(
            context,
            objects,
            testSqlValidator,
            ddlOptionsSchema.parse({ versionTable: true }),
          )
        ).steps,
      )
      const inspection = await inspectPostgres(session),
        applied = inspection.applied!
      expect(
        matchesAppliedDesign(applied, {
          databaseId: context.version.databaseId,
          versionId: context.version.id,
          revision: context.version.revision,
          designHash: await designHash(objects),
        }),
      ).toBe(true)
      expect(compareCatalogs(applied.catalog, await readPostgresCatalog(session)).count).toBe(0)
      await db.exec(
        "INSERT INTO items DEFAULT VALUES; UPDATE _dbcenter.version SET deployment_id='test';",
      )
      expect(compareCatalogs(applied.catalog, await readPostgresCatalog(session)).count).toBe(0)
      for (const sql of [
        'ALTER TABLE items ADD COLUMN extra text',
        "COMMENT ON COLUMN items.id IS 'external'",
        'CREATE VIEW extra_view AS SELECT * FROM items',
        "CREATE FUNCTION external_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
      ]) {
        const before = await readPostgresCatalog(session)
        await db.exec(sql)
        expect(compareCatalogs(before, await readPostgresCatalog(session)).count).toBeGreaterThan(0)
      }
      expect(compareCatalogs(null, await readPostgresCatalog(session)).verifiable).toBe(false)
      expect(
        matchesAppliedDesign(applied, {
          databaseId: context.version.databaseId,
          versionId: context.version.id,
          revision: context.version.revision + 1,
          designHash: await designHash(objects),
        }),
      ).toBe(false)
    } finally {
      await db.close()
    }
  },
)
