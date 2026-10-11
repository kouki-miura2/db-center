import { LIMITS, TERMS_VERSION } from 'utils'

import type { SessionRecord } from '../dao/user.interface.ts'
import { AppError } from '../error.ts'
import type { GoogleIdTokenVerifier } from '../repository/google-id-token.interface.ts'
import type { User, UserRepository } from '../repository/user.repository.ts'
import { createSessionToken, hashSessionToken } from './session-token.ts'

/** The signed-in user as the API returns them. */
export interface AuthUserView {
  id: string
  name: string
  email: string
}

/** A new session: the token goes into the cookie only, never into a response body. */
export interface IssuedSession {
  token: string
  expiresAt: number
}

export type SignInResult =
  | {
      status: 'registration_required'
      /** Shown on the consent screen. */
      email: string
      /** The Google profile name, to prefill the user name. */
      suggestedName: string | null
    }
  | {
      status: 'signed_in'
      user: AuthUserView
      /** The user agreed to an older terms version and must agree again before using the app. */
      consentRequired: boolean
      session: IssuedSession
    }

export type RegisterResult = Extract<SignInResult, { status: 'signed_in' }>

export interface AuthService {
  signInWithGoogle: (idToken: string) => Promise<SignInResult>
  register: (input: {
    idToken: string
    name: string
    termsVersion: string
  }) => Promise<RegisterResult>
}

const DAY_MS = 24 * 60 * 60 * 1000

const newSession = async (userId: string, now: number) => {
  const token = createSessionToken()
  const record: SessionRecord = {
    id: await hashSessionToken(token),
    userId,
    expiresAt: now + LIMITS.sessionDays * DAY_MS,
    createdAt: now,
  }
  return { record, session: { token, expiresAt: record.expiresAt } }
}

const toView = (user: User): AuthUserView => ({ id: user.id, name: user.name, email: user.email })

const verifyOrThrow = async (verifier: GoogleIdTokenVerifier, idToken: string) => {
  const identity = await verifier.verify(idToken)
  if (!identity) {
    throw new AppError('unauthorized', {
      message: 'Google の認証に失敗しました。もう一度ログインしてください',
    })
  }
  return identity
}

const alreadyRegistered = () =>
  new AppError('invalid_state', { message: 'すでに登録されています。ログインしてください' })

/**
 * Sign-in and sign-up ("総論 > 共通ルール > 同意", "各論 > Googleでログイン"). The Google ID token
 * is verified only here; afterwards the app's own session (cookie) authenticates the user. An
 * unregistered account gets nothing stored until it consents through `register`.
 */
export const createAuthService = (deps: {
  verifier: GoogleIdTokenVerifier
  users: UserRepository
}): AuthService => ({
  signInWithGoogle: async (idToken) => {
    const identity = await verifyOrThrow(deps.verifier, idToken)
    const existing = await deps.users.findByGoogleSub(identity.sub)
    if (!existing) {
      return {
        status: 'registration_required',
        email: identity.email,
        suggestedName: identity.name,
      }
    }
    const now = Date.now()
    const { record, session } = await newSession(existing.id, now)
    const user = await deps.users.recordLogin(
      { userId: existing.id, email: identity.email, lastLoginAt: now },
      record,
    )
    return {
      status: 'signed_in',
      user: toView(user),
      consentRequired: user.termsVersion !== TERMS_VERSION,
      session,
    }
  },

  register: async ({ idToken, name, termsVersion }) => {
    const identity = await verifyOrThrow(deps.verifier, idToken)
    if (termsVersion !== TERMS_VERSION) {
      throw new AppError('invalid_state', {
        message:
          '利用規約・プライバシーポリシーが更新されました。最新の内容を確認して同意してください',
      })
    }
    if (await deps.users.findByGoogleSub(identity.sub)) throw alreadyRegistered()
    const now = Date.now()
    const userId = crypto.randomUUID()
    const { record, session } = await newSession(userId, now)
    try {
      const user = await deps.users.register(
        {
          id: userId,
          googleSub: identity.sub,
          email: identity.email,
          name,
          termsVersion,
          agreedAt: now,
          lastLoginAt: now,
          productsRevision: 1,
          createdAt: now,
          deletedAt: null,
        },
        record,
      )
      return { status: 'signed_in', user: toView(user), consentRequired: false, session }
    } catch (error) {
      // Another request registered the same Google account in between.
      if (error instanceof AppError && error.code === 'duplicate') throw alreadyRegistered()
      throw error
    }
  },
})
