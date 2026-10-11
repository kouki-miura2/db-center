import { Hono } from 'hono'
import { expect, test } from 'vite-plus/test'
import { z } from 'zod'

import { errorResponse } from './error.ts'
import { text, validate } from './validation.ts'

const app = new Hono()
  .onError((error, c) => errorResponse(c, error))
  .post(
    '/items',
    validate('json', z.strictObject({ name: text(3).min(1), note: text(5).optional() })),
    (c) => c.json(c.req.valid('json')),
  )

const post = (body: unknown) =>
  app.request('/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('passes valid input to the handler, trimmed', async () => {
  const res = await post({ name: ' はなこ ' })

  expect(await res.json()).toEqual({ name: 'はなこ' })
})

test('counts characters the way LIMITS does (a combined emoji is one)', async () => {
  const res = await post({ name: '👨‍👩‍👧ab' })

  expect(res.status).toBe(200)
})

test('reports each invalid field by its path', async () => {
  const res = await post({ name: 'abcd', note: 'x' })

  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({
    error: { code: 'invalid_input', fields: { name: '3文字以内で入力してください' } },
  })
})

test('rejects a required field left blank after trimming', async () => {
  const res = await post({ name: '   ' })

  expect(await res.json()).toMatchObject({
    error: { code: 'invalid_input', fields: { name: expect.any(String) } },
  })
})

test('rejects unknown fields', async () => {
  const res = await post({ name: 'a', admin: true })

  expect(await res.json()).toMatchObject({
    error: { code: 'invalid_input', fields: { admin: 'この項目は指定できません' } },
  })
})

test('rejects malformed JSON with the same error format', async () => {
  const res = await app.request('/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })

  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: { code: 'invalid_input' } })
})
