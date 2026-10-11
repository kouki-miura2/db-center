import type { DatabaseRepository } from 'backend/src/repository/database.repository.ts'
import type { ObjectRepository } from 'backend/src/repository/object.repository.ts'
import type { ProductRepository } from 'backend/src/repository/product.repository.ts'
import {
  createDefinitionExportService,
  definitionExportSchema,
} from 'backend/src/service/definition-export.service.ts'
import { type TableDefinition, viewDefinitionSchema } from 'backend/src/service/definition.ts'
import { expect, it } from 'vite-plus/test'

import { testColumn, testContext, testObject, testSqlValidator, testTable } from './test-sql.ts'

const unused = async (): Promise<never> => {
  throw new Error('Export must only read its scoped repositories')
}

it('exports scoped revisions, resolved references, view analysis and appendix errors using actual SQL validation', async () => {
  const context = testContext(),
    schema = testObject('schema', 'public', { owner: null, comment: null }),
    otherSchema = testObject('schema', 'other', { owner: null, comment: null })
  const id = testColumn('id'),
    removed = testColumn('removed'),
    parent = testTable('parent', schema.objectKey, [id, removed]),
    refId = testColumn('id'),
    ref = testColumn('parent_id')
  const child = testTable('child', otherSchema.objectKey, [refId, ref], {
    constraints: [
      { key: crypto.randomUUID(), name: 'child_pk', kind: 'primary_key', columns: [refId.key] },
      {
        key: crypto.randomUUID(),
        name: 'child_fk',
        kind: 'foreign_key',
        columns: [ref.key],
        referenceTableKey: parent.objectKey,
        referenceColumns: [id.key],
        onDelete: 'NO ACTION',
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
    'summary',
    viewDefinitionSchema.parse({ select: 'SELECT id FROM public.parent' }),
    schema.objectKey,
  )
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
      ownedBy: { tableKey: parent.objectKey, columnKey: id.key },
      comment: '採番',
    },
    schema.objectKey,
  )
  const previous = [schema, otherSchema, parent, child, view, sequence],
    current = structuredClone(previous)
  const oldContext = structuredClone(context)
  oldContext.version.id = crypto.randomUUID()
  context.version.number = 2
  context.version.status = 'editing'
  current[2]!.name = 'products'
  ;(current[2]!.definition as TableDefinition).columns.pop()
  current[4]!.definition = viewDefinitionSchema.parse({ select: 'SELECT id FROM public.products' })
  const scopes = new Map([
    [context.version.id, { context, objects: current }],
    [oldContext.version.id, { context: oldContext, objects: previous }],
  ])
  const service = createDefinitionExportService({
    products: {
      findScope: unused,
      findProductsRevision: unused,
      listForUser: unused,
      create: unused,
      rename: unused,
      delete: unused,
      findMembership: async () => ({
        role: 'member',
        joinedAt: 0,
        product: {
          id: context.productId,
          name: 'p',
          target: context.target,
          revision: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      }),
    } satisfies ProductRepository,
    objects: {
      findContext: async (key) => scopes.get(key)?.context ?? null,
      findScope: async (key) => scopes.get(key) ?? null,
      save: unused,
    } satisfies ObjectRepository,
    databases: {
      findVersion: unused,
      findById: unused,
      create: unused,
      update: unused,
      saveCommonColumns: unused,
      delete: unused,
      findScope: async () => ({
        database: {
          id: context.version.databaseId,
          productId: context.productId,
          name: 'main',
          description: '説明',
          revision: 2,
          createdAt: 0,
          updatedAt: 0,
        },
        commonColumns: [],
        versions: [context.version, oldContext.version],
      }),
    } satisfies DatabaseRepository,
    sql: testSqlValidator,
  })
  const run = (input: Record<string, unknown>) =>
    service.export({
      userId: 'u',
      versionId: context.version.id,
      ...definitionExportSchema.parse(input),
    })
  const full = await run({ compareVersionId: oldContext.version.id, sections: { ddl: true } })
  expect(full.ddl?.status).toBe('success')
  expect(full.comparison?.difference.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entity: 'object', action: 'renamed', objectKey: parent.objectKey }),
      expect.objectContaining({ entity: 'column', action: 'deleted', key: removed.key }),
    ]),
  )
  expect(full.otherObjects.find((v) => v.kind === 'view')?.analysis).toMatchObject({
    columns: ['id'],
    dependencies: [parent.objectKey],
  })
  expect(full.otherObjects.find((v) => v.kind === 'sequence')?.ownership).toMatchObject({
    tableName: 'products',
    columnName: 'id',
  })
  expect(
    full.tables
      .find((v) => v.objectKey === child.objectKey)
      ?.constraints.find((v) => v.kind === 'foreign_key')?.reference,
  ).toMatchObject({ name: 'products', columnNames: ['id'] })
  const scoped = await run({
    schemaKeys: [otherSchema.objectKey],
    compareVersionId: oldContext.version.id,
    sections: { ddl: true },
  })
  expect(scoped.tables).toHaveLength(1)
  expect(scoped.tableList[0]?.name).toBe('child')
  expect(scoped.comparison?.difference.changes).toEqual([])
  expect(scoped.ddl).toMatchObject({ status: 'error', error: { code: 'invalid_input' } })
  const omitted = await run({ schemaKeys: [otherSchema.objectKey] })
  expect(omitted.ddl).toBeNull()
  expect(omitted.tables).toHaveLength(1)
  // Invalid editing SELECTs remain printable with an analysis error; unavailable DDL is reported separately.
  current[4]!.definition = viewDefinitionSchema.parse({ select: 'SELECT FROM' })
  const invalid = await run({ sections: { ddl: true } })
  expect(invalid.otherObjects.find((v) => v.kind === 'view')?.error?.code).toBe('invalid_input')
  expect(invalid.ddl?.status).toBe('error')
})
