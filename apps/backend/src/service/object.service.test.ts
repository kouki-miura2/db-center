import { expect, test, vi } from 'vite-plus/test'

import type { VersionContext } from '../dao/object.interface.ts'
import { AppError } from '../error.ts'
import type { ObjectRepository, DesignObject } from '../repository/object.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import { tableDefinitionSchema } from './definition.ts'
import { createObjectService } from './object.service.ts'

const context: VersionContext = {
  productId: 'p1',
  databaseName: 'db',
  target: 'postgresql18',
  version: {
    id: 'v1',
    databaseId: 'db1',
    number: 1,
    status: 'editing',
    sourceVersionId: null,
    memo: null,
    provisionalAt: null,
    finalizedAt: null,
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    compactedRevision: 0,
    schemaCount: 1,
    tableCount: 0,
    definitionBytes: 2,
  },
}
const schema: DesignObject = {
  id: 's1',
  objectKey: 'schema',
  versionId: 'v1',
  name: 'public',
  logicalName: null,
  schemaKey: null,
  kind: 'schema',
  definition: {},
  updatedAt: 1,
  updatedBy: 'u1',
  revision: 1,
  deletedAt: null,
}
const setup = () => {
  const save = vi.fn<ObjectRepository['save']>()
  const sql: SqlValidator = {
    validateView: vi.fn(async () => ({ columns: ['id'], dependencies: ['table'] })),
    validateDdl: vi.fn(async () => {}),
    validateExpression: vi.fn(async () => {}),
    validateDataType: vi.fn(async () => {}),
  }
  const products = {
    findMembership: vi.fn(async () => ({
      product: {
        id: 'p1',
        name: 'p',
        target: 'postgresql18',
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      },
      role: 'member',
      joinedAt: 1,
    })),
  } as unknown as ProductRepository
  const objects: ObjectRepository = {
    findContext: async () => context,
    findScope: async () => ({ context, objects: [schema] }),
    save,
  }
  return { save, sql, products, service: createObjectService({ products, objects, sql }) }
}
test('draft SELECT validation authenticates membership, returns names and dependencies, and never writes', async () => {
  const f = setup()
  expect(
    await f.service.validateView({
      userId: 'u1',
      versionId: 'v1',
      schemaKey: 'schema',
      select: 'SELECT id FROM public.t',
    }),
  ).toEqual({ columns: ['id'], dependencies: ['table'] })
  expect(f.sql.validateView).toHaveBeenCalledWith(
    'postgresql18',
    'SELECT id FROM public.t',
    [schema],
    'schema',
  )
  expect(f.save).not.toHaveBeenCalled()
  await expect(
    f.service.validateView({
      userId: 'u1',
      versionId: 'v1',
      schemaKey: 'missing',
      select: 'SELECT 1',
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' })
  vi.mocked(f.products.findMembership).mockResolvedValueOnce(null)
  await expect(
    f.service.validateView({
      userId: 'outsider',
      versionId: 'v1',
      schemaKey: 'schema',
      select: 'SELECT 1',
    }),
  ).rejects.toMatchObject({ code: 'not_found' })
  vi.mocked(f.sql.validateView).mockRejectedValueOnce(
    new AppError('invalid_input', { fields: { 'definition.select': 'SELECTのみ指定できます' } }),
  )
  await expect(
    f.service.validateView({
      userId: 'u1',
      versionId: 'v1',
      schemaKey: 'schema',
      select: 'DELETE FROM t',
    }),
  ).rejects.toMatchObject({ fields: { 'definition.select': 'SELECTのみ指定できます' } })
})
test('draft table DDL is checked without exporting or writing an editing version', async () => {
  const f = setup(),
    definition = tableDefinitionSchema.parse({
      columns: [
        {
          key: crypto.randomUUID(),
          name: 'id',
          logicalName: null,
          dataType: 'bigint',
          notNull: true,
          defaultValue: null,
          comment: null,
          generation: null,
          collation: null,
        },
      ],
      constraints: [],
      indexes: [],
      size: null,
      options: {},
    })
  const result = await f.service.tableDdl({
    userId: 'u1',
    versionId: 'v1',
    input: {
      kind: 'table',
      name: 'order"items',
      schemaKey: 'schema',
      logicalName: null,
      definition,
    },
  })
  expect(result.sql).toContain('CREATE TABLE "public"."order""items"')
  expect(f.sql.validateDdl).toHaveBeenCalledWith('postgresql18', [result.sql])
  expect(f.save).not.toHaveBeenCalled()
})
