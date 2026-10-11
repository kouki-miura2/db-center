import { generateSqliteDdl } from 'backend/src/service/ddl-sqlite.ts'
import { ddlOptionsSchema, type SqlStep } from 'backend/src/service/ddl.ts'
import { type TableDefinition, viewDefinitionSchema } from 'backend/src/service/definition.ts'
import { generateSqliteMigration } from 'backend/src/service/migration-sqlite.ts'
import { migrationOptionsSchema } from 'backend/src/service/migration.ts'
import initSqlJs, { type SqlDatabase as Database } from 'sql.js/dist/sql-wasm.js'
import { expect, it } from 'vite-plus/test'

import { testColumn, testContext, testObject, testSqlValidator, testTable } from './test-sql.ts'

const apply = (db: Database, steps: SqlStep[]) => {
  for (const step of steps.filter((v) => v.beforeTransaction)) db.run(step.sql)
  db.run('BEGIN')
  try {
    for (const step of steps.filter((v) => v.transactional && !v.beforeTransaction))
      db.run(step.sql)
    db.run('COMMIT')
  } catch (error) {
    try {
      db.run('ROLLBACK')
    } catch {
      /* OR ROLLBACK may already have rolled back. */
    }
    throw error
  } finally {
    for (const step of steps.filter((v) => !v.transactional && !v.beforeTransaction))
      db.run(step.sql)
  }
}
it('rebuilds SQLite tables with keyed copies, defaults, generated values, indexes, views and preserved AUTOINCREMENT', async () => {
  const sqlite = await initSqlJs(),
    db = new sqlite.Database(),
    expected = new sqlite.Database(),
    context = testContext('sqlite3')
  const id = testColumn('id', { dataType: 'INTEGER', autoincrement: true }),
    text = testColumn('text', { dataType: 'TEXT' }),
    table = testTable('items', null, [id, text], { options: { strict: true } })
  const childId = testColumn('id', { dataType: 'INTEGER' }),
    ref = testColumn('item', { dataType: 'INTEGER' }),
    child = testTable('child', null, [childId, ref], {
      options: { withoutRowid: true },
      constraints: [
        { key: crypto.randomUUID(), name: 'child_pk', kind: 'primary_key', columns: [childId.key] },
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
  const view = testObject(
      'view',
      'items_view',
      viewDefinitionSchema.parse({ select: 'SELECT id,text FROM items' }),
    ),
    source = [table, child, view],
    target = structuredClone(source)
  try {
    apply(
      db,
      (await generateSqliteDdl(context, source, testSqlValidator, ddlOptionsSchema.parse({})))
        .steps,
    )
    db.run(
      "INSERT INTO items VALUES (1,'keep'),(99,'deleted'); DELETE FROM items WHERE id=99; INSERT INTO child VALUES (1,1);",
    )
    target[0]!.name = 'products'
    const t = target[0]!.definition as TableDefinition
    t.columns.reverse()
    t.columns[0]!.name = 'title'
    t.columns.push(
      testColumn('extra', { dataType: 'TEXT', notNull: true, defaultValue: "'new'" }),
      testColumn('derived', {
        dataType: 'TEXT',
        generation: { kind: 'generated', stored: true, expression: 'upper(title)' },
      }),
    )
    t.indexes.push({
      key: crypto.randomUUID(),
      name: 'title_ix',
      method: 'btree',
      columns: [{ columnKey: text.key, expression: null, order: 'DESC', nulls: null }],
      include: [],
      where: 'id > 0',
      unique: false,
      fillfactor: null,
      concurrently: false,
    })
    target[2]!.definition = viewDefinitionSchema.parse({ select: 'SELECT id,title FROM products' })
    const script = await generateSqliteMigration(
      context,
      source,
      target,
      testSqlValidator,
      migrationOptionsSchema.parse({}),
    )
    expect(script.sql.indexOf('foreign_keys = OFF')).toBeLessThan(script.sql.indexOf('BEGIN;'))
    expect(script.recreatedTableKeys).toContain(child.objectKey)
    apply(db, script.steps)
    apply(
      expected,
      (await generateSqliteDdl(context, target, testSqlValidator, ddlOptionsSchema.parse({})))
        .steps,
    )
    const catalog = (engine: Database) =>
      engine.exec(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
    expect(catalog(db)).toEqual(catalog(expected))
    expect(db.exec('SELECT id,title,extra,derived FROM products')[0]!.values).toEqual([
      [1, 'keep', 'new', 'KEEP'],
    ])
    expect(db.exec('SELECT * FROM child')[0]!.values).toEqual([[1, 1]])
    db.run("INSERT INTO products(title) VALUES ('next')")
    expect(db.exec('SELECT max(id) FROM products')[0]!.values).toEqual([[100]])
    expect(db.exec('PRAGMA foreign_key_check')).toEqual([])
    expect(db.exec('PRAGMA foreign_keys')[0]!.values).toEqual([[1]])
    const excluded = await generateSqliteMigration(
      context,
      target,
      [target[0]!, target[2]!],
      testSqlValidator,
      migrationOptionsSchema.parse({ includeDrops: false }),
    )
    expect(excluded.complete).toBe(false)
    apply(db, excluded.steps)
    expect(db.exec('SELECT count(*) FROM child')[0]!.values).toEqual([[1]])
    await expect(
      generateSqliteMigration(
        context,
        source,
        target,
        testSqlValidator,
        migrationOptionsSchema.parse({ indexesConcurrently: true }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  } finally {
    db.close()
    expected.close()
  }
})
it('rolls back and retains source data when new foreign keys reject existing rows', async () => {
  const sqlite = await initSqlJs(),
    db = new sqlite.Database(),
    context = testContext('sqlite3')
  const parentId = testColumn('id'),
    parent = testTable('parent', null, [parentId]),
    childId = testColumn('id'),
    ref = testColumn('parent_id'),
    child = testTable('child', null, [childId, ref]),
    source = [parent, child],
    target = structuredClone(source)
  try {
    apply(
      db,
      (await generateSqliteDdl(context, source, testSqlValidator, ddlOptionsSchema.parse({})))
        .steps,
    )
    db.run('INSERT INTO child VALUES (1,999)')
    ;(target[1]!.definition as TableDefinition).constraints.push({
      key: crypto.randomUUID(),
      name: 'fk',
      kind: 'foreign_key',
      columns: [ref.key],
      referenceTableKey: parent.objectKey,
      referenceColumns: [parentId.key],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      match: 'SIMPLE',
      deferrable: false,
      initiallyDeferred: false,
      notValid: false,
    })
    const script = await generateSqliteMigration(
      context,
      source,
      target,
      testSqlValidator,
      migrationOptionsSchema.parse({}),
    )
    expect(() => apply(db, script.steps)).toThrow()
    expect(db.exec('SELECT * FROM child')[0]!.values).toEqual([[1, 999]])
    expect(db.exec('PRAGMA foreign_key_list(child)')).toEqual([])
    expect(db.exec('PRAGMA foreign_keys')[0]!.values).toEqual([[1]])
  } finally {
    db.close()
  }
})
