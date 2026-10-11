import { readdirSync, readFileSync } from 'node:fs'

import { getPlatformProxy } from 'wrangler'

const migrationsDir = `${import.meta.dirname}/../../migrations/`

// Every statement of every migration, in order. Comments are dropped first, since they may
// contain `;`.
const migrationStatements = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .flatMap((file) =>
    readFileSync(`${migrationsDir}${file}`, 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean),
  )

/**
 * For DAO tests only: a fresh in-memory local D1 (the same workerd + SQLite as `wrangler dev`)
 * with every migration applied. Call `dispose` when done.
 */
export const createTestD1 = async () => {
  const proxy = await getPlatformProxy<Env>({
    configPath: `${import.meta.dirname}/../../wrangler.jsonc`,
    persist: false,
  })
  const db = proxy.env.DB
  await db.batch(migrationStatements.map((statement) => db.prepare(statement)))
  return { db, dispose: proxy.dispose }
}
