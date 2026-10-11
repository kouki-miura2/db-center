import { PGlite } from '@electric-sql/pglite'
import { generatePostgresDdl } from 'backend/src/service/ddl-postgres.ts'
import { ddlOptionsSchema } from 'backend/src/service/ddl.ts'
import { type TableDefinition, viewDefinitionSchema } from 'backend/src/service/definition.ts'
import { generatePostgresMigration } from 'backend/src/service/migration-postgres.ts'
import { migrationOptionsSchema } from 'backend/src/service/migration.ts'
import { expect, it } from 'vite-plus/test'

import {
  applyPostgresSteps,
  testColumn,
  testContext,
  testObject,
  testSqlValidator,
  testTable,
} from './test-sql.ts'

const catalog = async (db: PGlite) =>
  (
    await db.query(
      `SELECT c.relname, a.attname, a.attnum, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull, a.attgenerated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
    )
  ).rows
it(
  'applies PostgreSQL migration to the target catalog, preserving keyed data, identities and sequences',
  { timeout: 30_000 },
  async () => {
    const db = new PGlite(),
      expected = new PGlite(),
      context = testContext()
    try {
      const schema = testObject('schema', 'public', { owner: null, comment: null }),
        id = testColumn('id', { generation: { kind: 'identity', always: true } }),
        value = testColumn('value', { dataType: 'text', defaultValue: "'old'" })
      const table = testTable('items', schema.objectKey, [id, value])
      const fkId = testColumn('id'),
        ref = testColumn('item_id')
      const child = testTable('child', schema.objectKey, [fkId, ref], {
        constraints: [
          { key: crypto.randomUUID(), name: 'child_pk', kind: 'primary_key', columns: [fkId.key] },
          {
            key: crypto.randomUUID(),
            name: 'child_fk',
            kind: 'foreign_key',
            columns: [ref.key],
            referenceTableKey: table.objectKey,
            referenceColumns: [id.key],
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
            match: 'SIMPLE',
            deferrable: false,
            initiallyDeferred: false,
            notValid: false,
          },
        ],
      })
      const sequence = testObject(
        'sequence',
        'counter',
        {
          dataType: 'bigint',
          start: '1',
          increment: '1',
          min: null,
          max: null,
          cache: '1',
          cycle: false,
          ownedBy: { tableKey: table.objectKey, columnKey: value.key },
          comment: null,
        },
        schema.objectKey,
      )
      const view = testObject(
        'view',
        'items_view',
        viewDefinitionSchema.parse({ select: 'SELECT id, value FROM public.items' }),
        schema.objectKey,
      )
      const source = [schema, table, child, sequence, view]
      await applyPostgresSteps(
        db,
        (
          await generatePostgresDdl(
            context,
            source,
            testSqlValidator,
            ddlOptionsSchema.parse({ versionTable: true }),
          )
        ).steps,
      )
      await db.exec(
        `INSERT INTO items DEFAULT VALUES; INSERT INTO items DEFAULT VALUES; DELETE FROM items WHERE id=2; INSERT INTO child VALUES (1,1); SELECT nextval('counter');`,
      )
      const target = structuredClone(source),
        nextTable = target[1]!,
        t = nextTable.definition as TableDefinition
      nextTable.name = 'products'
      t.columns.reverse()
      t.columns.find((v) => v.key === value.key)!.name = 'title'
      t.columns.find((v) => v.key === id.key)!.dataType = 'bigint'
      t.columns.push(
        testColumn('extra', { dataType: 'text', notNull: true, defaultValue: "'new'" }),
      )
      t.constraints.push({
        key: crypto.randomUUID(),
        name: 'positive',
        kind: 'check',
        expression: 'id > 0',
        notValid: false,
      })
      t.indexes.push({
        key: crypto.randomUUID(),
        name: 'title_ix',
        method: 'btree',
        columns: [{ columnKey: value.key, expression: null, order: 'ASC', nulls: null }],
        include: [],
        where: null,
        unique: false,
        fillfactor: null,
        concurrently: false,
      })
      target[3]!.name = 'counter_next'
      target[4]!.definition = viewDefinitionSchema.parse({
        select: 'SELECT id, title FROM public.products',
      })
      context.version.number = 2
      const script = await generatePostgresMigration(
        context,
        source,
        target,
        testSqlValidator,
        migrationOptionsSchema.parse({
          indexesConcurrently: true,
          constraintsNotValid: true,
          lockTimeoutMs: 1000,
        }),
      )
      expect(script.sql.indexOf('COMMIT;')).toBeLessThan(
        script.sql.indexOf('CREATE INDEX CONCURRENTLY'),
      )
      expect(script.sql).toContain('NOT VALID')
      expect(script.sql).toContain('VALIDATE CONSTRAINT')
      await applyPostgresSteps(db, script.steps)
      await applyPostgresSteps(
        expected,
        (await generatePostgresDdl(context, target, testSqlValidator, ddlOptionsSchema.parse({})))
          .steps,
      )
      expect(await catalog(db)).toEqual(await catalog(expected))
      const constraints = async (engine: PGlite) =>
        (
          await engine.query(
            `SELECT c.relname, con.conname, con.convalidated, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname`,
          )
        ).rows
      const indexes = async (engine: PGlite) =>
        (
          await engine.query(
            `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`,
          )
        ).rows
      expect(await constraints(db)).toEqual(await constraints(expected))
      expect(await indexes(db)).toEqual(await indexes(expected))
      expect((await db.query('SELECT id,title,extra FROM products')).rows).toEqual([
        { id: 1, title: 'old', extra: 'new' },
      ])
      expect((await db.query("SELECT nextval('counter_next') AS id")).rows).toEqual([{ id: 2 }])
      expect((await db.query('INSERT INTO products DEFAULT VALUES RETURNING id')).rows).toEqual([
        { id: 3 },
      ])
      expect((await db.query('SELECT * FROM child')).rows).toEqual([{ id: 1, item_id: 1 }])
      expect((await db.query('SELECT version_number FROM _dbcenter.version')).rows).toEqual([
        { version_number: 2 },
      ])
      expect(
        (
          await db.query(
            "SELECT conname FROM pg_constraint WHERE conrelid='child'::regclass AND contype='f'",
          )
        ).rows,
      ).toHaveLength(1)
    } finally {
      await db.close()
      await expected.close()
    }
  },
)
it(
  'uses RENAME for name-only changes and explicitly excludes logical drops',
  { timeout: 30_000 },
  async () => {
    const db = new PGlite(),
      context = testContext(),
      schema = testObject('schema', 'public', { owner: null, comment: null }),
      id = testColumn('id'),
      value = testColumn('value')
    const table = testTable('old', schema.objectKey, [id, value]),
      source = [schema, table]
    try {
      await applyPostgresSteps(
        db,
        (await generatePostgresDdl(context, source, testSqlValidator, ddlOptionsSchema.parse({})))
          .steps,
      )
      await db.exec('INSERT INTO old VALUES (1,42)')
      const target = structuredClone(source)
      target[1]!.name = 'next'
      ;(target[1]!.definition as TableDefinition).columns[1]!.name = 'renamed'
      const script = await generatePostgresMigration(
        context,
        source,
        target,
        testSqlValidator,
        migrationOptionsSchema.parse({}),
      )
      expect(script.recreatedTableKeys).toEqual([])
      expect(script.sql).toContain('RENAME COLUMN')
      expect(script.sql).not.toContain('DROP TABLE "public"."old"')
      await applyPostgresSteps(db, script.steps)
      expect((await db.query('SELECT * FROM next')).rows).toEqual([{ id: 1, renamed: 42 }])
      const deletion = await generatePostgresMigration(
        context,
        target,
        [schema],
        testSqlValidator,
        migrationOptionsSchema.parse({ includeDrops: false }),
      )
      expect(deletion.complete).toBe(false)
      expect(deletion.warnings).not.toEqual([])
      await applyPostgresSteps(db, deletion.steps)
      expect((await db.query('SELECT * FROM next')).rows).toHaveLength(1)
    } finally {
      await db.close()
    }
  },
)
