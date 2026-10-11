import { PGlite } from '@electric-sql/pglite'
import { inspectPostgres, type PgSession } from 'backend/src/repository/postgres.interface.ts'
import { generatePostgresDdl } from 'backend/src/service/ddl-postgres.ts'
import { ddlOptionsSchema } from 'backend/src/service/ddl.ts'
import type { Client, ClientConfig } from 'pg'
import { expect, test, vi } from 'vite-plus/test'

import { createPostgresAdapter, postgresAddress, publicAddress } from './postgres.ts'
import { applyPostgresSteps, testContext, testObject, testSqlValidator } from './test-sql.ts'

test.each([
  '127.0.0.1',
  '10.1.2.3',
  '172.16.0.1',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '0.0.0.0',
  '224.0.0.1',
  '198.18.0.1',
  '192.0.2.1',
  '::1',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
  '2001:db8::1',
  '2001:0db8::1',
  '2001::1',
  '2002:7f00:1::1',
])('rejects nonpublic address %s', (address) => {
  expect(publicAddress(address)).toBe(false)
})
test.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
  'accepts globally routable %s',
  (address) => {
    expect(publicAddress(address)).toBe(true)
  },
)
test.each([
  'postgres://user@localhost/main',
  'postgres://user@127.1/main',
  'postgres://user@2130706433/main',
  'postgres://user@db.local/main',
  'postgres://user@db.example.com/main?sslmode=disable',
  'postgres://user@db.example.com/main?sslrootcert=custom',
  'postgres://user@db.example.com/main?options=-c+password%3Dsecret',
  'postgres://user@db.example.com/main?host=localhost',
])('rejects unsafe connection configuration %s', (url) => {
  expect(() => postgresAddress(url)).toThrow()
})
test('pins DNS answers, requires TLS and closes failed connections without leaking driver errors', async () => {
  const connected = vi.fn(async () => {}),
    ended = vi.fn(async () => {}),
    query = vi.fn(async () => ({ rows: [], rowCount: 0 })),
    on = vi.fn()
  const client = vi.fn(
    (_config: ClientConfig) => ({ connect: connected, end: ended, query, on }) as unknown as Client,
  )
  const adapter = createPostgresAdapter({ resolve: async () => ['8.8.8.8'], client })
  const session = await adapter.open(
    'postgres://user@db.example.com/main?sslmode=require',
    'test-password',
  )
  expect(client.mock.calls[0]?.[0]).toMatchObject({
    host: '8.8.8.8',
    ssl: { servername: 'db.example.com' },
    password: 'test-password',
  })
  await session.query('SELECT 1')
  await session.close()
  expect(ended).toHaveBeenCalledOnce()
  connected.mockRejectedValueOnce(
    new Error('driver leaked test-password and postgres://credentials'),
  )
  const error = await adapter
    .open('postgres://user@db.example.com/main', 'test-password')
    .catch((error: unknown) => error)
  expect(error).toMatchObject({ code: 'connection_failed' })
  expect(String(error)).not.toContain('test-password')
  expect(ended).toHaveBeenCalledTimes(2)
  const mixed = createPostgresAdapter({ resolve: async () => ['8.8.8.8', '10.0.0.1'], client })
  await expect(mixed.open('postgres://user@db.example.com/main', null)).rejects.toMatchObject({
    code: 'invalid_input',
  })
  expect(client).toHaveBeenCalledTimes(2)
})
test(
  'inspects PostgreSQL 18, empty schemas and version manager safely',
  { timeout: 30_000 },
  async () => {
    const db = new PGlite()
    const session: PgSession = {
      query: async (sql, values) => {
        const result = await db.query<Record<string, unknown>>(sql, values)
        return { rows: result.rows, rowCount: result.affectedRows ?? 0 }
      },
      close: async () => db.close(),
    }
    try {
      expect(await inspectPostgres(session)).toMatchObject({
        supported: true,
        empty: true,
        managerPresent: false,
        applied: null,
      })
      await db.exec('CREATE SCHEMA application')
      expect((await inspectPostgres(session)).empty).toBe(false)
      await db.exec('DROP SCHEMA application')
      const context = testContext(),
        objects = [testObject('schema', 'public', { owner: null, comment: null })]
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
      expect(await inspectPostgres(session)).toMatchObject({
        empty: false,
        managerPresent: true,
        applied: {
          databaseId: context.version.databaseId,
          versionId: context.version.id,
          revision: null,
        },
      })
    } finally {
      await db.close()
    }
  },
)
