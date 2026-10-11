import { mkdir, writeFile, unlink } from 'node:fs/promises'

import { expect, test } from 'vite-plus/test'
import { getPlatformProxy } from 'wrangler'

import { createDeploymentStorage, createDeploymentWorkflow } from './deployment-runtime.ts'

// A Workflow binding whose one instance (if any) reports `status`.
const workflowWith = (status: InstanceStatus['status'] | null) =>
  ({
    get: async () => {
      if (status === null) throw new Error('instance.not_found')
      return { status: async () => ({ status }) }
    },
  }) as unknown as Workflow<{ deploymentId: string }>

test.each([
  [null, 'missing'],
  ['queued', 'active'],
  ['running', 'active'],
  ['waiting', 'active'],
  ['unknown', 'active'],
  ['complete', 'finished'],
  ['errored', 'finished'],
  ['terminated', 'finished'],
] as const)('a Workflow instance that is %s counts as %s', async (status, expected) => {
  expect(await createDeploymentWorkflow(workflowWith(status)).status('x1')).toBe(expected)
})

test(
  'real R2 storage never overwrites an execution SQL artifact, and deletes any number of keys',
  { timeout: 30_000 },
  async () => {
    const directory = `${import.meta.dirname}/../.local`
    await mkdir(directory, { recursive: true })
    const path = `${directory}/r2-test-${crypto.randomUUID()}.jsonc`
    await writeFile(
      path,
      JSON.stringify({
        compatibility_date: '2026-09-11',
        r2_buckets: [{ binding: 'SQL', bucket_name: crypto.randomUUID() }],
      }),
    )
    let dispose: (() => Promise<void>) | undefined
    try {
      const proxy = await getPlatformProxy<{ SQL: R2Bucket }>({ configPath: path, persist: false })
      dispose = proxy.dispose
      const storage = createDeploymentStorage(proxy.env.SQL)
      expect(await storage.get('deployments/test.sql')).toBeNull()
      await storage.putOnce('deployments/test.sql', 'SELECT 1;')
      await expect(storage.putOnce('deployments/test.sql', 'SELECT 2;')).rejects.toMatchObject({
        code: 'invalid_state',
      })
      expect(await storage.get('deployments/test.sql')).toBe('SELECT 1;')

      // More keys than one R2 call takes, most of them missing: all present ones go.
      await storage.putOnce('deployments/last.json', '{}')
      const missing = Array.from({ length: 1000 }, (_, i) => `deployments/missing-${i}.sql`)
      await storage.deleteAll(['deployments/test.sql', ...missing, 'deployments/last.json'])
      expect(await storage.get('deployments/test.sql')).toBeNull()
      expect(await storage.get('deployments/last.json')).toBeNull()
    } finally {
      await dispose?.()
      await unlink(path)
    }
  },
)
