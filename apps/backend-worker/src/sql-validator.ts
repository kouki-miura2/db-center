import { AppError } from 'backend/src/error.ts'
import type { DesignObject } from 'backend/src/repository/object.repository.ts'
import type { SqlValidator } from 'backend/src/repository/sql-validator.interface.ts'
import { selectSql } from 'backend/src/service/ddl.ts'
import type { TableDefinition, ViewDefinition } from 'backend/src/service/definition.ts'
import { analyzePostgresSelect } from 'backend/src/service/postgres-select.ts'
import initPg, { type PgModule } from 'libpg-query/wasm/libpg-query.js'
import initSql, { type SqlDatabase } from 'sql.js/dist/sql-wasm.js'

const quote = (s: string) => `"${s.replaceAll('"', '""')}"`
const containsNode = (value: unknown, name: string): boolean => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => containsNode(v, name))
  return Object.hasOwn(value, name) || Object.values(value).some((v) => containsNode(v, name))
}
const invalid = (error: unknown): never => {
  throw error instanceof AppError
    ? error
    : new AppError('invalid_input', {
        message: error instanceof Error ? error.message : 'SQL を検証できません',
      })
}
const parsePg = (module: PgModule, sql: string): unknown => {
  const length = module.lengthBytesUTF8(sql) + 1
  const input = module._malloc(length)
  let result = 0
  try {
    module.stringToUTF8(sql, input, length)
    result = module._wasm_parse_query_raw(input)
    if (!result) throw new Error('SQL を解析できません')
    const error = module.getValue(result + 8, 'i32')
    if (error)
      throw new AppError('invalid_input', {
        message: module.UTF8ToString(module.getValue(error, 'i32')),
      })
    return JSON.parse(module.UTF8ToString(module.getValue(result, 'i32'))) as unknown
  } finally {
    if (result) module._wasm_free_parse_result(result)
    module._free(input)
  }
}
const sqliteDesign = (db: SqlDatabase, objects: DesignObject[]) => {
  for (const object of objects.filter((v) => v.kind === 'table')) {
    const columns = (object.definition as TableDefinition).columns
    if (columns.length)
      db.run(
        `CREATE TABLE ${quote(object.name)} (${columns.map((v) => `${quote(v.name)} BLOB`).join(',')})`,
      )
  }
  for (const object of objects.filter((v) => v.kind === 'view'))
    db.run(`CREATE VIEW ${quote(object.name)} AS ${(object.definition as ViewDefinition).select}`)
}
export const createSqlValidator = (wasm?: {
  pg: WebAssembly.Module
  sqlite: WebAssembly.Module
}): SqlValidator => {
  const instantiate =
    (module: WebAssembly.Module) =>
    (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => {
      const instance = new WebAssembly.Instance(module, imports)
      receive(instance)
      return instance.exports
    }
  let pg: Promise<PgModule> | undefined
  let sqlite: ReturnType<typeof initSql> | undefined
  const getPg = () => (pg ??= initPg(wasm ? { instantiateWasm: instantiate(wasm.pg) } : {}))
  const getSqlite = () =>
    (sqlite ??= initSql(wasm ? { instantiateWasm: instantiate(wasm.sqlite) } : {}))
  const withSqlite = async <T>(fn: (db: SqlDatabase) => T): Promise<T> => {
    const sql = await getSqlite()
    const db = new sql.Database()
    try {
      return fn(db)
    } finally {
      db.close()
    }
  }
  return {
    validateDdl: async (target, statements) => {
      try {
        if (target === 'postgresql18') {
          const module = await getPg()
          for (const statement of statements) {
            const parsed = parsePg(module, statement) as { stmts: unknown[] }
            if (parsed.stmts.length !== 1)
              throw new Error('生成SQLは手順ごとに一文にする必要があります')
          }
        } else
          await withSqlite((db) => {
            for (const statement of statements) {
              const parsed = db.prepare(statement)
              try {
                if (parsed.getSQL().trim() !== statement.trim())
                  throw new Error('SQL に余分な文が含まれています')
              } finally {
                parsed.free()
              }
              db.run(statement)
            }
            db.run('PRAGMA foreign_key_check;')
          })
      } catch (error) {
        invalid(error)
      }
    },
    validateView: async (target, sql, objects, schemaKey) => {
      try {
        if (target === 'postgresql18') {
          const module = await getPg()
          return analyzePostgresSelect(parsePg(module, sql), objects, schemaKey, (value) =>
            parsePg(module, value),
          )
        }
        // Wrapping the query rejects multiple statements and non-SELECT operations. Prepare resolves columns and dependencies without executing it.
        return await withSqlite((db) => {
          sqliteDesign(db, objects)
          const query = `SELECT * FROM (${selectSql(sql)}\n)`
          const statement = db.prepare(query)
          try {
            if (statement.getSQL() !== query) throw new Error('SELECT 一文だけを指定してください')
            const columns = statement.getColumnNames()
            if (columns.some((v) => /:\d+$/.test(v)))
              throw new AppError('invalid_input', { message: '出力カラム名が重複しています' })
            return {
              columns,
              dependencies: objects.filter((v) => v.kind !== 'schema').map((v) => v.objectKey),
            }
          } finally {
            statement.free()
          }
        })
      } catch (error) {
        return invalid(error)
      }
    },
    validateExpression: async (target, sql, columns) => {
      try {
        if (target === 'postgresql18') {
          const module = await getPg()
          const tree = parsePg(module, `SELECT (${sql}) FROM __expression`) as {
            stmts: { stmt: { SelectStmt?: { targetList?: unknown[] } } }[]
          }
          if (tree.stmts.length !== 1 || tree.stmts[0]?.stmt.SelectStmt?.targetList?.length !== 1)
            throw new Error('式を一つだけ指定してください')
          if (containsNode(tree, 'SubLink')) throw new Error('サブクエリは式に指定できません')
          // Semantic column checks use the same resolver as views.
          analyzePostgresSelect(
            tree,
            [
              {
                objectKey: 'expression',
                kind: 'table',
                name: '__expression',
                schemaKey: null,
                definition: { columns: columns.map((name) => ({ name })) },
              } as DesignObject,
            ],
            null,
            (v) => parsePg(module, v),
          )
        } else
          await withSqlite((db) => {
            db.run(
              `CREATE TABLE __expression (${(columns.length ? columns : ['__dummy']).map((name) => `${quote(name)} BLOB`).join(',')})`,
            )
            db.run(
              `CREATE TABLE __check (${(columns.length ? columns : ['__dummy']).map((name) => `${quote(name)} BLOB`).join(',')}, CHECK (${sql}))`,
            )
            const query = `SELECT (${sql}) FROM __expression`
            const statement = db.prepare(query)
            try {
              if (statement.getSQL() !== query) throw new Error('式を一つだけ指定してください')
            } finally {
              statement.free()
            }
          })
      } catch (error) {
        invalid(error)
      }
    },
    validateDataType: async (target, type) => {
      try {
        if (target === 'postgresql18') {
          const tree = parsePg(await getPg(), `CREATE TABLE __type (__column ${type})`) as {
            stmts: {
              stmt: { CreateStmt?: { tableElts?: { ColumnDef?: { constraints?: unknown[] } }[] } }
            }[]
          }
          const columns = tree.stmts[0]?.stmt.CreateStmt?.tableElts
          if (
            tree.stmts.length !== 1 ||
            columns?.length !== 1 ||
            !columns[0]?.ColumnDef ||
            columns[0].ColumnDef.constraints?.length
          )
            throw new Error('データ型が正しくありません')
        } else {
          if (!/^[A-Za-z_][A-Za-z0-9_ ]*(?:\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/.test(type))
            throw new Error('データ型が正しくありません')
          await withSqlite((db) => {
            const statement = `CREATE TABLE __type (__column ${type})`
            const parsed = db.prepare(statement)
            try {
              if (parsed.getSQL() !== statement)
                throw new Error('データ型に余分な文が含まれています')
            } finally {
              parsed.free()
            }
            db.run(statement)
            const rows = db.exec('PRAGMA table_info(__type)')[0]?.values
            if (
              rows?.length !== 1 ||
              String(rows[0]![2]).replace(/\s/g, '').toUpperCase() !==
                type.replace(/\s/g, '').toUpperCase() ||
              rows[0]![3] !== 0 ||
              rows[0]![4] !== null ||
              rows[0]![5] !== 0
            )
              throw new Error('データ型にカラムの設定を含めないでください')
          })
        }
      } catch (error) {
        invalid(error)
      }
    },
  }
}
