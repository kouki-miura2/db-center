import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test } from 'vite-plus/test'

import { useAuthStore } from './auth.ts'

const user = { id: 'u1', name: '山田 太郎', email: 'taro@example.com' }

beforeEach(() => {
  setActivePinia(createPinia())
})

test('is unknown until the session is checked', () => {
  expect(useAuthStore().status).toBe('unknown')
})

test('holds the signed-in user until signed out', () => {
  const auth = useAuthStore()

  auth.setSignedIn(user, true)
  expect(auth).toMatchObject({ status: 'signedIn', user, consentRequired: true })

  auth.setSignedOut()
  expect(auth).toMatchObject({ status: 'signedOut', user: null, consentRequired: false })
})
