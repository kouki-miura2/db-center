import { expect, test } from 'vite-plus/test'
import { createMemoryHistory, createRouter } from 'vue-router'

import { routes } from './routes.ts'

const resolve = (path: string) =>
  createRouter({ history: createMemoryHistory(), routes }).resolve(path)

test.each([
  ['/login', 'login'],
  ['/terms', 'terms'],
  ['/privacy', 'privacy'],
  ['/consent', 'consent'],
  ['/products', 'products'],
])('resolves %s to %s', (path, name) => {
  expect(resolve(path).name).toBe(name)
})

test('marks the sign-in, terms and privacy screens public and the consent screen as the consent screen', () => {
  expect(resolve('/login').meta.public).toBe(true)
  expect(resolve('/terms').meta.public).toBe(true)
  expect(resolve('/privacy').meta.public).toBe(true)
  expect(resolve('/consent').meta.consent).toBe(true)
  expect(resolve('/products').meta.public).toBeUndefined()
})

test('redirects the root and unknown paths to the product list', () => {
  const router = createRouter({ history: createMemoryHistory(), routes })

  for (const path of ['/', '/does-not-exist']) {
    const [record] = router.resolve(path).matched
    expect(record?.redirect).toEqual({ name: 'products' })
  }
})
