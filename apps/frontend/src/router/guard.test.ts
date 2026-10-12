import { expect, test } from 'vite-plus/test'
import type { RouteMeta } from 'vue-router'

import { redirectFor } from './guard.ts'

const route = (name: string, meta: RouteMeta = {}, fullPath = `/${name}`) => ({
  name,
  meta,
  fullPath,
})
const signedIn = { status: 'signedIn', consentRequired: false } as const
const signedOut = { status: 'signedOut', consentRequired: false } as const
const mustConsent = { status: 'signedIn', consentRequired: true } as const

test('sends a signed-out person to sign in, remembering where they were going', () => {
  expect(redirectFor(route('product', {}, '/products/p1'), signedOut)).toEqual({
    name: 'login',
    query: { redirect: '/products/p1' },
  })
})

test('lets anyone open a public screen', () => {
  expect(redirectFor(route('login', { public: true }), signedOut)).toBeNull()
  expect(redirectFor(route('terms', { public: true }), signedIn)).toBeNull()
})

test('sends a signed-in user from the sign-in screen home', () => {
  expect(redirectFor(route('login', { public: true }), signedIn)).toEqual({ name: 'products' })
})

test('shows only the consent screen to a user who must agree to new terms', () => {
  expect(redirectFor(route('products'), mustConsent)).toEqual({ name: 'consent' })
  expect(redirectFor(route('consent', { consent: true }), mustConsent)).toBeNull()
})

test('sends a user who already agreed from the consent screen home', () => {
  expect(redirectFor(route('consent', { consent: true }), signedIn)).toEqual({ name: 'products' })
})

test('lets a signed-in user through', () => {
  expect(redirectFor(route('products'), signedIn)).toBeNull()
})
