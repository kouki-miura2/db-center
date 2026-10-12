import { expect, test } from 'vite-plus/test'

import { ApiError, call, isNetworkError } from './call.ts'

const response = (status: number, body?: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError()) : Promise.resolve(body)),
  })

test('returns the JSON body of a successful response', async () => {
  expect(await call(response(200, { id: 'p1' }))).toEqual({ id: 'p1' })
})

test('returns undefined for 204 without reading a body', async () => {
  expect(await call(response(204))).toBeUndefined()
})

test('throws the API error with its code, message, status and fields', async () => {
  const error = await call(
    response(400, {
      error: {
        code: 'invalid_input',
        message: '入力内容に誤りがあります',
        fields: { name: '必須' },
      },
    }),
  ).catch((e: unknown) => e)

  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({
    code: 'invalid_input',
    message: '入力内容に誤りがあります',
    status: 400,
    fields: { name: '必須' },
  })
})

test('throws internal when an error response has no JSON body', async () => {
  await expect(call(response(502))).rejects.toMatchObject({ code: 'internal', status: 502 })
})

test('throws network when no response arrives', async () => {
  const error = await call(Promise.reject(new TypeError('Failed to fetch'))).catch(
    (e: unknown) => e,
  )

  expect(isNetworkError(error)).toBe(true)
  expect(error).toMatchObject({ status: null })
})

test('says so when the request timed out', async () => {
  await expect(
    call(Promise.reject(new DOMException('timeout', 'TimeoutError'))),
  ).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('タイムアウト') })
})
