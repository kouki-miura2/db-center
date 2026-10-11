import { PGlite } from '@electric-sql/pglite'
import { generatePostgresDdl } from 'backend/src/service/ddl-postgres.ts'
import { ddlOptionsSchema } from 'backend/src/service/ddl.ts'
import type { TableDefinition } from 'backend/src/service/definition.ts'
import { expect, test } from 'vite-plus/test'

import {
  applyPostgresSteps,
  testColumn,
  testContext,
  testObject,
  testSqlValidator as validator,
  testTable,
} from './test-sql.ts'

test('PostgreSQL 18 applies quoted names, all object kinds, cyclic FKs and column options', async () => {
  const db = new PGlite()
  try {
    expect((await db.query<{ version: string }>('SELECT version()')).rows[0]!.version).toMatch(
      /^PostgreSQL 18\./,
    )
    const context = testContext(),
      schema = testObject('schema', 'app"sql', { owner: null, comment: "O'Reilly\\\n注釈" })
    const aId = testColumn('id', { notNull: true, generation: { kind: 'identity', always: true } }),
      bId = testColumn('id', { notNull: true })
    const aParent = testColumn('parent'),
      bParent = testColumn('parent'),
      text = testColumn('text"value', {
        dataType: 'text',
        storage: 'extended',
        compression: 'pglz',
        collation: 'pg_catalog."C"',
        comment: "a'b\\c\n",
      })
    const generated = testColumn('twice', {
      generation: { kind: 'generated', expression: 'id * 2', stored: false },
    })
    const a = testTable('a', schema.objectKey, [aId, aParent, text, generated], {
        options: { fillfactor: 80 },
      }),
      b = testTable('b', schema.objectKey, [bId, bParent])
    const aDef = a.definition as TableDefinition,
      bDef = b.definition as TableDefinition
    aDef.constraints.push({
      key: crypto.randomUUID(),
      kind: 'foreign_key',
      name: 'a_fk',
      columns: [aParent.key],
      referenceTableKey: b.objectKey,
      referenceColumns: [bId.key],
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      match: 'SIMPLE',
      deferrable: true,
      initiallyDeferred: true,
      notValid: false,
    })
    bDef.constraints.push({
      key: crypto.randomUUID(),
      kind: 'foreign_key',
      name: 'b_fk',
      columns: [bParent.key],
      referenceTableKey: a.objectKey,
      referenceColumns: [aId.key],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      match: 'SIMPLE',
      deferrable: false,
      initiallyDeferred: false,
      notValid: false,
    })
    aDef.constraints.push({
      key: crypto.randomUUID(),
      kind: 'check',
      name: 'positive',
      expression: 'id > 0',
      notValid: true,
    })
    aDef.constraints.push({
      key: crypto.randomUUID(),
      kind: 'unique',
      name: 'text_unique',
      columns: [text.key],
      nullsDistinct: false,
      deferrable: false,
      initiallyDeferred: false,
    })
    aDef.indexes.push({
      key: crypto.randomUUID(),
      name: 'a_parent_idx',
      method: 'btree',
      columns: [{ columnKey: aParent.key, expression: null, order: 'DESC', nulls: 'LAST' }],
      include: [text.key],
      where: 'parent IS NOT NULL',
      unique: false,
      fillfactor: 70,
      concurrently: false,
    })
    const sequence = testObject(
      'sequence',
      'seq',
      {
        dataType: 'bigint',
        start: '9223372036854775806',
        increment: '1',
        min: '1',
        max: '9223372036854775807',
        cache: '1',
        cycle: false,
        ownedBy: { tableKey: b.objectKey, columnKey: bId.key },
        comment: null,
      },
      schema.objectKey,
    )
    const view = testObject(
      'view',
      'z_view',
      {
        select: 'SELECT id FROM a; -- terminator',
        comment: 'view',
        options: { securityInvoker: true, securityBarrier: true },
      },
      schema.objectKey,
    )
    const dependent = testObject(
      'view',
      'a_view',
      { select: 'SELECT id FROM z_view', comment: null, options: {} },
      schema.objectKey,
    )
    const materialized = testObject(
      'materialized_view',
      'snapshot',
      { select: 'SELECT id FROM a', comment: null, options: { withData: false } },
      schema.objectKey,
    )
    const objects = [dependent, b, materialized, a, sequence, view, schema]
    const result = await generatePostgresDdl(
      context,
      objects,
      validator,
      ddlOptionsSchema.parse({ versionTable: true }),
    )
    await applyPostgresSteps(db, result.steps)
    const ns = `'app"sql'`
    expect(
      (
        await db.query<{ name: string; kind: string }>(
          `SELECT c.relname name,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${ns} AND c.relkind IN ('r','v','m') ORDER BY c.relname`,
        )
      ).rows,
    ).toEqual([
      { name: 'a', kind: 'r' },
      { name: 'a_view', kind: 'v' },
      { name: 'b', kind: 'r' },
      { name: 'snapshot', kind: 'm' },
      { name: 'z_view', kind: 'v' },
    ])
    expect(
      (
        await db.query<{ name: string; generated: string; identity: string }>(
          `SELECT attname name,attgenerated generated,attidentity identity FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${ns} AND c.relname='a' AND a.attnum>0 ORDER BY a.attnum`,
        )
      ).rows,
    ).toEqual([
      { name: 'id', generated: '', identity: 'a' },
      { name: 'parent', generated: '', identity: '' },
      { name: 'text"value', generated: '', identity: '' },
      { name: 'twice', generated: 'v', identity: '' },
    ])
    expect(
      (
        await db.query<{ count: number }>(
          `SELECT count(*)::integer count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${ns} AND c.contype='f'`,
        )
      ).rows[0]!.count,
    ).toBe(2)
    expect(
      (
        await db.query<{ validated: boolean }>(
          "SELECT convalidated validated FROM pg_constraint WHERE conname='positive'",
        )
      ).rows[0]!.validated,
    ).toBe(false)
    expect(
      (await db.query<{ version_id: string }>('SELECT version_id FROM "_dbcenter"."version"'))
        .rows[0]!.version_id,
    ).toBe(context.version.id)
    expect(result.sql.indexOf('"z_view" AS')).toBeLessThan(result.sql.indexOf('"a_view" AS'))
  } finally {
    await db.close()
  }
})

test('DDL options preserve existing objects, rebuild explicitly and put concurrent indexes after COMMIT', async () => {
  const db = new PGlite()
  try {
    const context = testContext(),
      schema = testObject('schema', 'test', { owner: null, comment: null }),
      table = testTable('items', schema.objectKey, [testColumn('id', { notNull: true })])
    const definition = table.definition as TableDefinition
    definition.indexes.push({
      key: crypto.randomUUID(),
      name: 'idx',
      columns: [
        { columnKey: definition.columns[0]!.key, expression: null, order: 'ASC', nulls: null },
      ],
      method: 'btree',
      include: [],
      where: null,
      unique: false,
      fillfactor: null,
      concurrently: true,
    })
    const view = testObject(
      'view',
      'items_view',
      { select: 'SELECT id FROM items', options: {}, comment: null },
      schema.objectKey,
    )
    const objects = [table, view, schema]
    const result = await generatePostgresDdl(
      context,
      objects,
      validator,
      ddlOptionsSchema.parse({ ifNotExists: true }),
    )
    expect(result.sql.indexOf('COMMIT;')).toBeLessThan(result.sql.indexOf('INDEX CONCURRENTLY'))
    await applyPostgresSteps(db, result.steps)
    await db.exec('INSERT INTO test.items VALUES (1);')
    await applyPostgresSteps(db, result.steps)
    expect((await db.query('SELECT id FROM test.items')).rows).toEqual([{ id: 1 }])
    const rebuild = await generatePostgresDdl(
      context,
      objects,
      validator,
      ddlOptionsSchema.parse({ dropExisting: true, ifNotExists: true, includeComments: false }),
    )
    expect(rebuild.sql).not.toContain('COMMENT ON')
    await applyPostgresSteps(db, rebuild.steps)
    expect((await db.query('SELECT id FROM test.items')).rows).toEqual([])
    const noSchemas = await generatePostgresDdl(
      context,
      objects,
      validator,
      ddlOptionsSchema.parse({ includeSchemas: false, transaction: false, ifNotExists: true }),
    )
    expect(noSchemas.sql).not.toContain('CREATE SCHEMA')
    expect(noSchemas.sql).not.toContain('BEGIN;')
    await applyPostgresSteps(db, noSchemas.steps, false)
  } finally {
    await db.close()
  }
})
