import { AppError } from '../error.ts'
import type { DesignObject } from '../repository/object.repository.ts'
import type { ViewAnalysis } from '../repository/sql-validator.interface.ts'
import type { TableDefinition, ViewDefinition } from './definition.ts'

type Ast = { [key: string]: unknown }
const record = (v: unknown): Ast => (v && typeof v === 'object' ? (v as Ast) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const stringValue = (v: unknown): string => str(record(record(v).String).sval)
const invalid: (message: string) => never = (message) => {
  throw new AppError('invalid_input', { message })
}

/** Resolve references against this design only; never connects to a database. */
export const analyzePostgresSelect = (
  tree: unknown,
  objects: DesignObject[],
  schemaKey: string | null,
  parse: (sql: string) => unknown,
): ViewAnalysis => {
  const dependencies = new Set<string>()
  const resolving = new Set<string>()
  const resolveSelect = (
    value: unknown,
    inherited = new Map<string, string[]>(),
    outer = new Map<string, string[]>(),
    activeSchema = schemaKey,
  ): string[] => {
    const select = record(value)
    if (Object.keys(select).length === 0 || select.intoClause || select.lockingClause)
      invalid('読み取り専用の SELECT を指定してください')
    const ctes = new Map(inherited)
    const withClause = record(select.withClause)
    if (withClause.recursive) invalid('再帰 CTE の参照検証には未対応です')
    for (const node of list(withClause.ctes)) {
      const cte = record(record(node).CommonTableExpr)
      const query = record(cte.ctequery).SelectStmt
      if (!query) invalid('更新を含む CTE は指定できません')
      const output = resolveSelect(query, ctes, outer)
      const aliases = list(cte.aliascolnames).map(stringValue)
      if (aliases.length && aliases.length !== output.length) invalid('CTE の列名数が一致しません')
      ctes.set(str(cte.ctename), aliases.length ? aliases : output)
    }
    if (select.larg || select.rarg) {
      const left = resolveSelect(record(select.larg).SelectStmt ?? select.larg, ctes, outer)
      const right = resolveSelect(record(select.rarg).SelectStmt ?? select.rarg, ctes, outer)
      if (left.length !== right.length) invalid('集合演算の列数が一致しません')
      return left
    }
    const relations = new Map<string, string[]>()
    const expressions: unknown[] = []
    const add = (name: string, columns: string[], aliasNode: unknown) => {
      const alias = record(aliasNode)
      const aliases = list(alias.colnames).map(stringValue)
      if (aliases.length > columns.length) invalid('別名のカラム数が正しくありません')
      const key = str(alias.aliasname ?? name)
      if (relations.has(key)) invalid('テーブルの別名が重複しています')
      relations.set(
        key,
        columns.map((v, i) => aliases[i] ?? v),
      )
    }
    const from = (node: unknown): void => {
      const n = record(node)
      if (n.RangeVar) {
        const range = record(n.RangeVar)
        const name = str(range.relname)
        if (range.catalogname) invalid('別データベースは参照できません')
        if (!range.schemaname && ctes.has(name)) {
          add(name, ctes.get(name)!, range.alias)
          return
        }
        const schemas = new Map(
          objects.filter((v) => v.kind === 'schema').map((v) => [v.objectKey, v.name]),
        )
        const found = objects.find(
          (v) =>
            ['table', 'view', 'materialized_view'].includes(v.kind) &&
            v.name === name &&
            (range.schemaname
              ? schemas.get(v.schemaKey ?? '') === range.schemaname
              : v.schemaKey === activeSchema || schemas.get(v.schemaKey ?? '') === 'public'),
        )
        if (!found) invalid(`参照先 ${name} がありません`)
        dependencies.add(found.objectKey)
        let columns: string[]
        if (found.kind === 'table')
          columns = (found.definition as TableDefinition).columns.map((v) => v.name)
        else {
          if (resolving.has(found.objectKey)) invalid('ビューの依存関係が循環しています')
          resolving.add(found.objectKey)
          const parsed = record(parse((found.definition as ViewDefinition).select))
          const statement = record(record(list(parsed.stmts)[0]).stmt).SelectStmt
          columns = resolveSelect(statement, new Map(), new Map(), found.schemaKey)
          resolving.delete(found.objectKey)
        }
        add(name, columns, range.alias)
      } else if (n.RangeSubselect) {
        const r = record(n.RangeSubselect)
        const alias = record(r.alias)
        if (!alias.aliasname) invalid('サブクエリには別名が必要です')
        add(
          str(alias.aliasname),
          resolveSelect(
            record(r.subquery).SelectStmt,
            ctes,
            r.lateral ? new Map([...outer, ...relations]) : outer,
          ),
          alias,
        )
      } else if (n.JoinExpr) {
        const join = record(n.JoinExpr)
        from(join.larg)
        from(join.rarg)
        expressions.push(join.quals)
        for (const col of list(join.usingClause).map(stringValue))
          if ([...relations.values()].filter((v) => v.includes(col)).length < 2)
            invalid(`USING のカラム ${col} がありません`)
        if (join.alias || join.isNatural)
          invalid('JOIN 全体の別名・NATURAL JOIN の参照検証には未対応です')
      } else invalid('この FROM の構文の参照検証には未対応です')
    }
    list(select.fromClause).forEach(from)
    const fields = (v: unknown) =>
      list(record(v).fields).map((f) => (record(f).A_Star ? '*' : stringValue(f)))
    const checkColumn = (node: unknown, outputNames: string[] = []) => {
      const names = fields(node)
      if (names.includes('*')) return
      if (names.length === 1) {
        const name = names[0]!
        const local = [...relations.values()].filter((v) => v.includes(name)).length
        if (local > 1) invalid(`カラム ${name} が曖昧です`)
        if (
          local === 0 &&
          !outputNames.includes(name) &&
          ![...outer.values()].some((v) => v.includes(name))
        )
          invalid(`カラム ${name} がありません`)
      } else {
        const qualifier = names.at(-2)!
        const name = names.at(-1)!
        if (!(relations.get(qualifier) ?? outer.get(qualifier))?.includes(name))
          invalid(`カラム ${qualifier}.${name} がありません`)
      }
    }
    const walk = (node: unknown, outputNames: string[] = []): void => {
      if (Array.isArray(node)) {
        node.forEach((v) => walk(v, outputNames))
        return
      }
      const n = record(node)
      if (n.ColumnRef) {
        checkColumn(n.ColumnRef, outputNames)
        return
      }
      if (n.SelectStmt) {
        resolveSelect(n.SelectStmt, ctes, new Map([...outer, ...relations]))
        return
      }
      Object.values(n).forEach((v) => {
        if (v && typeof v === 'object') walk(v, outputNames)
      })
    }
    const output: string[] = []
    for (const item of list(select.targetList)) {
      const target = record(record(item).ResTarget)
      const val = record(target.val)
      const names = fields(val.ColumnRef)
      if (names.at(-1) === '*') {
        const cols =
          names.length > 1 ? relations.get(names.at(-2)!) : [...relations.values()].flat()
        if (!cols?.length) invalid('展開するカラムがありません')
        output.push(...cols)
      } else {
        walk(target.val)
        output.push(
          str(
            target.name ??
              (names.length
                ? names.at(-1)
                : record(val.FuncCall).funcname
                  ? list(record(val.FuncCall).funcname).map(stringValue).at(-1)
                  : '?column?'),
          ),
        )
      }
    }
    expressions.forEach((v) => walk(v))
    for (const key of ['whereClause', 'havingClause', 'windowClause', 'limitCount', 'limitOffset'])
      walk(select[key])
    for (const key of ['sortClause', 'groupClause', 'distinctClause']) walk(select[key], output)
    if (new Set(output).size !== output.length)
      invalid('ビューの出力カラム名が重複しています。別名を指定してください')
    return output
  }
  const stmts = list(record(tree).stmts)
  if (stmts.length !== 1 || !record(record(stmts[0]).stmt).SelectStmt)
    invalid('SELECT を一文だけ指定してください')
  return {
    columns: resolveSelect(record(record(stmts[0]).stmt).SelectStmt),
    dependencies: [...dependencies],
  }
}
