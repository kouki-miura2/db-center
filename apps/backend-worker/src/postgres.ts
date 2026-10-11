import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

import { AppError } from 'backend/src/error.ts'
import type { PostgresAdapter } from 'backend/src/repository/postgres.interface.ts'
import { validateConnectionString } from 'backend/src/service/connection-string.ts'
import { Client, type ClientConfig } from 'pg'
import { LIMITS } from 'utils'

export const publicAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a! < 224 &&
      !(a === 100 && b! >= 64 && b! <= 127) &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b! >= 16 && b! <= 31) &&
      !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
      !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113)
    )
  }
  if (family !== 6) return false
  const parts = address.toLowerCase().split(':'),
    first = parseInt(parts[0]!, 16),
    second = parts[1] ? parseInt(parts[1], 16) : 0
  // Global unicast only; exclude mapped/translation, documentation and transition ranges.
  return (
    first >= 0x2000 &&
    first < 0x4000 &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    first !== 0x3fff
  )
}
export const postgresAddress = (connectionString: string) => {
  const value = validateConnectionString(connectionString)
  const url = new URL(value),
    invalid = () => {
      throw new AppError('invalid_input', {
        message: '公開ホスト・ユーザー名・DB名と、証明書を検証するTLS接続を指定してください',
      })
    }
  let host: string, user: string, database: string
  try {
    host = new URL(`http://${url.host}`).hostname
      .replace(/^\[|\]$/g, '')
      .toLowerCase()
      .replace(/\.$/, '')
    user = decodeURIComponent(url.username)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    return invalid()
  }
  if (!user || !database || /[\0]/.test(user + database) || url.hash || url.password)
    return invalid()
  const port = url.port ? Number(url.port) : 5432
  if (!Number.isInteger(port) || port < 1 || port > 65535) return invalid()
  if (isIP(host)) {
    if (!publicAddress(host)) return invalid()
  } else if (
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|home\.arpa)$/.test(host)
  )
    return invalid()
  for (const [key, value] of url.searchParams)
    if (key !== 'sslmode' || !['require', 'verify-full', 'verify-ca'].includes(value))
      return invalid()
  return { host, port, user, database }
}
const resolveAddresses = async (host: string) => {
  if (isIP(host)) return [host]
  const results = await Promise.allSettled([resolve4(host), resolve6(host)])
  const addresses: string[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') addresses.push(...result.value)
    else if (!['ENODATA', 'ENOTFOUND'].includes((result.reason as { code?: string }).code ?? ''))
      throw new AppError('connection_failed')
  }
  return addresses
}
type Driver = Pick<Client, 'connect' | 'query' | 'end' | 'on'>
export const createPostgresAdapter = (
  deps: {
    resolve?: (host: string) => Promise<string[]>
    client?: (config: ClientConfig) => Driver
  } = {},
): PostgresAdapter => ({
  open: async (connectionString, password) => {
    const address = postgresAddress(connectionString)
    let driver: Driver | null = null,
      disconnected = false
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const addresses = await Promise.race([
        (deps.resolve ?? resolveAddresses)(address.host),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new AppError('connection_failed')),
            LIMITS.postgresConnectTimeoutSeconds * 1000,
          )
        }),
      ]).finally(() => clearTimeout(timer))
      if (!addresses.length || addresses.some((v) => !publicAddress(v)))
        throw new AppError('invalid_input', {
          message: 'ローカル・プライベート・予約済みアドレスには接続できません',
        })
      // Pin the checked IP. Keep the original DNS name for SNI and certificate validation.
      driver = (deps.client ?? ((config) => new Client(config)))({
        host: addresses[0],
        port: address.port,
        user: address.user,
        database: address.database,
        password: password ?? '',
        ssl: { servername: isIP(address.host) ? undefined : address.host },
        connectionTimeoutMillis: LIMITS.postgresConnectTimeoutSeconds * 1000,
        query_timeout: LIMITS.postgresStatementTimeoutSeconds * 1000,
        statement_timeout: LIMITS.postgresStatementTimeoutSeconds * 1000,
        application_name: 'db-center',
      })
      driver.on('error', () => {
        disconnected = true
      })
      await driver.connect()
      const client = driver
      return {
        query: async (statement, values = []) => {
          try {
            if (disconnected) throw new AppError('connection_failed')
            const result = await client.query(statement, values)
            return {
              rows: result.rows as Record<string, unknown>[],
              rowCount: result.rowCount ?? 0,
            }
          } catch {
            throw new AppError('connection_failed')
          }
        },
        close: async () => {
          try {
            await client.end()
          } catch {
            /* Never expose driver errors, which may contain credentials or SQL. */
          }
        },
      }
    } catch (error) {
      if (driver)
        try {
          await driver.end()
        } catch {
          /* Preserve the safe error. */
        }
      if (error instanceof AppError) throw error
      throw new AppError('connection_failed')
    }
  },
})
