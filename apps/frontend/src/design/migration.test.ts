import { expect, test } from 'vite-plus/test'

import type { MigrationChange } from '../composables/useScriptMutations.ts'
import { changeSummary } from './migration.ts'

const change = (fields: Partial<MigrationChange>): MigrationChange => ({
  objectKey: 'o1',
  kind: 'table',
  entity: 'object',
  key: 'o1',
  action: 'added',
  before: null,
  after: { name: 'payments' },
  fields: [],
  impact: { dataLoss: false, recreation: false, outsideTransaction: false },
  ...fields,
})

test('an object change names nothing of its own', () => {
  expect(changeSummary(change({}))).toEqual({ name: '', description: '追加' })
})

test('a column change names the column and the changed fields', () => {
  expect(
    changeSummary(
      change({
        entity: 'column',
        action: 'changed',
        before: { name: 'status' },
        after: { name: 'status' },
        fields: ['dataType', 'notNull', 'somethingNew'],
      }),
    ),
  ).toEqual({ name: 'status', description: 'カラム変更（データ型・NOT NULL・somethingNew）' })
})

test('a rename shows both names, a deletion the old one', () => {
  expect(
    changeSummary(
      change({ entity: 'index', action: 'renamed', before: { name: 'a' }, after: { name: 'b' } }),
    ),
  ).toEqual({ name: 'b', description: 'インデックス名前の変更（a → b）' })
  expect(
    changeSummary(
      change({ entity: 'constraint', action: 'deleted', before: { name: 'fk' }, after: null }),
    ),
  ).toEqual({ name: 'fk', description: '制約削除' })
})
