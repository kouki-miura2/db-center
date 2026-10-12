import type { MigrationChange } from '../composables/useScriptMutations.ts'

// How a difference between two versions reads in the migration screen's list (design 4n):
// "orders.status カラム変更（データ型）", "sales.payments テーブル追加".

const ENTITIES = {
  object: '',
  column: 'カラム',
  constraint: '制約',
  index: 'インデックス',
  column_order: 'カラムの順序',
} as const

const ACTIONS = { added: '追加', changed: '変更', deleted: '削除', renamed: '名前の変更' } as const

const FIELDS: Record<string, string> = {
  name: '名前',
  logicalName: '論理名',
  dataType: 'データ型',
  notNull: 'NOT NULL',
  defaultValue: 'デフォルト',
  generation: '値の生成',
  collation: '照合順序',
  comment: 'コメント',
  storage: 'ストレージ',
  compression: '圧縮',
  definition: '定義',
  schemaKey: 'スキーマ',
  options: 'オプション',
}

const nameIn = (value: unknown) =>
  value && typeof value === 'object' && 'name' in value && typeof value.name === 'string'
    ? value.name
    : null

/**
 * The changed part's own name (a column, constraint or index; empty for the object itself) and
 * what happened to it, with the changed fields.
 */
export const changeSummary = (change: MigrationChange) => {
  const before = nameIn(change.before)
  const after = nameIn(change.after)
  const name =
    change.entity === 'object' || change.entity === 'column_order' ? '' : (after ?? before ?? '')
  const fields =
    change.action === 'changed' && change.fields.length
      ? `（${[...new Set(change.fields.map((f) => FIELDS[f] ?? f))].join('・')}）`
      : ''
  const rename = change.action === 'renamed' && before && after ? `（${before} → ${after}）` : ''
  return {
    name,
    description: `${ENTITIES[change.entity]}${ACTIONS[change.action]}${fields}${rename}`,
  }
}
