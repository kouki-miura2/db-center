import { expect, test } from 'vite-plus/test'

import { validateConnectionString } from './connection-string.ts'

test.each([
  'postgresql://app@db.example.com:5432/ec_main',
  'postgres://app@db.example.com/ec_main?sslmode=verify-full',
  '  postgresql://app@db.example.com/ec_main  ',
])('accepts %s', (value) => {
  expect(validateConnectionString(value)).toBe(value.trim())
})

test.each([
  ['a password in the userinfo', 'postgresql://app:secret@db.example.com/ec_main'],
  ['a password parameter', 'postgresql://app@db.example.com/ec_main?password=secret'],
  ['another scheme', 'mysql://app@db.example.com/ec_main'],
  ['no host', 'postgresql:///ec_main'],
  ['not a URI', 'host=db.example.com dbname=ec_main'],
])('rejects %s', (_, value) => {
  expect(() => validateConnectionString(value)).toThrow(
    expect.objectContaining({
      code: 'invalid_input',
      fields: { connectionString: expect.any(String) },
    }),
  )
})
