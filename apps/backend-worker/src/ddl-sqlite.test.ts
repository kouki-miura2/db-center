import { generateSqliteDdl } from 'backend/src/service/ddl-sqlite.ts'
import { ddlOptionsSchema } from 'backend/src/service/ddl.ts'
import type { TableDefinition } from 'backend/src/service/definition.ts'
import initSql from 'sql.js/dist/sql-wasm.js'
import { expect, test } from 'vite-plus/test'

import {
  testColumn,
  testContext,
  testObject,
  testSqlValidator as validator,
  testTable,
} from './test-sql.ts'

test('SQLite applies strict, generated columns, autoincrement, indexes, views and circular FKs', async () => {
  const sql = await initSql(),
    db = new sql.Database()
  try {
    const context = testContext('sqlite3'),
      id = testColumn('id', { dataType: 'INTEGER', notNull: true, autoincrement: true }),
      parent = testColumn('parent', { dataType: 'INTEGER' })
    const text = testColumn('label', {
      dataType: 'TEXT',
      defaultValue: "'a;b''c'",
      collation: 'NOCASE',
    })
    const generated = testColumn('doubled', {
      dataType: 'INTEGER',
      generation: { kind: 'generated', expression: 'id * 2', stored: true },
    })
    const a = testTable('a', null, [id, parent, text, generated], { options: { strict: true } }),
      b = testTable(
        'b',
        null,
        [
          testColumn('id', { dataType: 'INTEGER', notNull: true }),
          testColumn('parent', { dataType: 'INTEGER' }),
        ],
        { options: { strict: true, withoutRowid: true } },
      )
    const ad = a.definition as TableDefinition,
      bd = b.definition as TableDefinition
    ad.constraints.push({
      key: crypto.randomUUID(),
      name: 'a_fk',
      kind: 'foreign_key',
      columns: [parent.key],
      referenceTableKey: b.objectKey,
      referenceColumns: [bd.columns[0]!.key],
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      match: 'SIMPLE',
      deferrable: true,
      initiallyDeferred: true,
      notValid: false,
    })
    bd.constraints.push({
      key: crypto.randomUUID(),
      name: 'b_fk',
      kind: 'foreign_key',
      columns: [bd.columns[1]!.key],
      referenceTableKey: a.objectKey,
      referenceColumns: [id.key],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      match: 'SIMPLE',
      deferrable: true,
      initiallyDeferred: true,
      notValid: false,
    })
    ad.indexes.push({
      key: crypto.randomUUID(),
      name: 'partial',
      method: 'btree',
      columns: [{ columnKey: null, expression: 'lower(label)', order: 'DESC', nulls: null }],
      include: [],
      where: 'parent IS NOT NULL',
      unique: false,
      fillfactor: null,
      concurrently: false,
    })
    const view = testObject('view', 'report', {
      select: 'SELECT id, label AS [a;b] FROM a; -- end',
      options: {},
      comment: null,
    })
    const objects = [view, b, a]
    const result = await generateSqliteDdl(context, objects, validator, ddlOptionsSchema.parse({}))
    expect(result.sql.indexOf('PRAGMA foreign_keys = ON')).toBeLessThan(
      result.sql.indexOf('BEGIN;'),
    )
    db.run(result.sql)
    expect(db.exec('PRAGMA foreign_keys')[0]!.values).toEqual([[1]])
    expect(
      db.exec('PRAGMA table_xinfo(a)')[0]!.values.map((v) => [v[1], v[2], v[5], v[6]]),
    ).toEqual([
      ['id', 'INTEGER', 1, 0],
      ['parent', 'INTEGER', 0, 0],
      ['label', 'TEXT', 0, 0],
      ['doubled', 'INTEGER', 0, 3],
    ])
    expect(
      db
        .exec('PRAGMA table_list')[0]!
        .values.find((v) => v[1] === 'b')
        ?.slice(4),
    ).toEqual([1, 1])
    expect(db.exec('PRAGMA foreign_key_list(a)')[0]!.values[0]?.slice(2, 7)).toEqual([
      'b',
      'parent',
      'id',
      'CASCADE',
      'SET NULL',
    ])
    db.run('INSERT INTO a DEFAULT VALUES')
    expect(db.exec('SELECT id,doubled FROM a')[0]!.values).toEqual([[1, 2]])
    expect(db.exec('SELECT * FROM report')[0]!.columns).toEqual(['id', 'a;b'])
    const again = await generateSqliteDdl(
      context,
      objects,
      validator,
      ddlOptionsSchema.parse({ ifNotExists: true }),
    )
    db.run(again.sql)
    expect(db.exec('SELECT count(*) FROM a')[0]!.values).toEqual([[1]])
    const rebuilt = await generateSqliteDdl(
      context,
      objects,
      validator,
      ddlOptionsSchema.parse({ dropExisting: true }),
    )
    db.run(rebuilt.sql)
    expect(db.exec('SELECT count(*) FROM a')[0]!.values).toEqual([[0]])
  } finally {
    db.close()
  }
})

test('SQLite rejects invalid generated/default combinations and SQL inserted into expressions or types', async () => {
  const context = testContext('sqlite3'),
    table = testTable('t', null, [testColumn('id', { dataType: 'INTEGER' })])
  const def = table.definition as TableDefinition
  def.columns[0]!.defaultValue = '1); CREATE TABLE hacked (id INT); --'
  await expect(
    generateSqliteDdl(context, [table], validator, ddlOptionsSchema.parse({})),
  ).rejects.toMatchObject({ code: 'invalid_input' })
  await expect(validator.validateDataType('sqlite3', 'TEXT CHECK(1)')).rejects.toThrow()
  await expect(validator.validateDataType('sqlite3', 'TEXT, extra TEXT')).rejects.toThrow()
  await expect(
    validator.validateExpression('sqlite3', '1)); CREATE TABLE hacked(id INTEGER); --', []),
  ).rejects.toThrow()
  def.columns[0]!.defaultValue = null
  def.columns[0]!.dataType = 'INTEGER'
  def.columns.push(
    testColumn('bad', {
      dataType: 'INTEGER',
      generation: { kind: 'generated', expression: 'random()', stored: true },
    }),
  )
  await expect(
    generateSqliteDdl(context, [table], validator, ddlOptionsSchema.parse({})),
  ).rejects.toMatchObject({ code: 'invalid_input' })
  await expect(
    generateSqliteDdl(context, [table], validator, ddlOptionsSchema.parse({ versionTable: true })),
  ).rejects.toThrow()
})
