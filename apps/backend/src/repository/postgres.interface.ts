export interface PgSession {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
  close: () => Promise<void>
}
export interface PostgresAdapter {
  open: (connectionString: string, password: string | null) => Promise<PgSession>
}
export interface AppliedVersion {
  databaseId: string
  versionId: string
  versionNumber: number
  revision: number | null
  designHash: string | null
  deploymentId: string | null
  catalog: unknown
}
export const inspectPostgres = async (session: PgSession) => {
  const version = Number(
    (await session.query("SELECT current_setting('server_version_num') AS version")).rows[0]
      ?.version,
  )
  const managers = (
    await session.query(
      'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=\'_dbcenter\') AS present, to_regclass(\'"_dbcenter"."version"\')::text AS manager',
    )
  ).rows[0]!
  const objects = (
    await session.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','_dbcenter') AND c.relkind IN ('r','p','v','m','S','f')
    UNION ALL SELECT nspname,nspname,'schema' FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema','_dbcenter')
    UNION ALL SELECT n.nspname,p.proname,'function' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','_dbcenter')
    UNION ALL SELECT n.nspname,t.typname,'type' FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typrelid=0 AND t.typtype IN ('d','e') AND n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','_dbcenter') ORDER BY 1,2,3`)
  ).rows
  let applied: AppliedVersion | null = null
  if (managers.manager) {
    const records = (
      await session.query('SELECT to_jsonb(v) AS value FROM "_dbcenter"."version" v')
    ).rows
    if (records.length === 1) {
      const value = records[0]!.value as Record<string, unknown>
      if (
        typeof value.database_id === 'string' &&
        typeof value.version_id === 'string' &&
        typeof value.version_number === 'number'
      )
        applied = {
          databaseId: value.database_id,
          versionId: value.version_id,
          versionNumber: value.version_number,
          revision: typeof value.revision === 'number' ? value.revision : null,
          designHash: typeof value.design_hash === 'string' ? value.design_hash : null,
          deploymentId: typeof value.deployment_id === 'string' ? value.deployment_id : null,
          catalog: value.catalog_snapshot ?? null,
        }
    }
  }
  return {
    version,
    supported: Math.floor(version / 10000) === 18,
    managerPresent: managers.present === true,
    applied,
    objects,
    empty: managers.present !== true && objects.length === 0,
  }
}
export type PgInspection = Awaited<ReturnType<typeof inspectPostgres>>
