import { expect, test } from 'vite-plus/test'

import type { DefinitionData } from '../composables/useDefinitionExport.ts'
import { type Block, definitionBlocks } from './definition.ts'
import { definitionMarkdown } from './markdown.ts'

const version = {
  id: 'v2',
  number: 2,
  status: 'provisional',
  memo: '受注状態の桁拡張',
  provisionalAt: Date.UTC(2026, 9, 10, 1, 40),
  finalizedAt: null,
}
const sales = { key: 's1', name: 'sales' }

/** A small export of one table and one view, compared with v1. */
const data = (overrides: Partial<DefinitionData> = {}) =>
  ({
    metadata: {
      database: { name: 'ec_main' },
      target: 'postgresql18',
      version,
      draft: false,
      cover: { title: 'ec_main テーブル定義書', versionNumber: 2, memo: version.memo },
    },
    sections: {
      cover: true,
      history: true,
      tableList: true,
      columns: true,
      constraints: true,
      indexes: true,
      size: false,
      viewsSequences: true,
      ddl: true,
      revisions: true,
    },
    history: [version, { ...version, id: 'v1', number: 1, status: 'final', memo: '初版' }],
    tableList: [
      { objectKey: 't1', name: 'orders', logicalName: '受注', schema: sales, columnCount: 2 },
    ],
    tables: [
      {
        objectKey: 't1',
        name: 'orders',
        logicalName: '受注',
        schema: sales,
        comment: null,
        options: {},
        columns: [
          {
            key: 'c1',
            name: 'order_id',
            logicalName: '受注ID',
            dataType: 'bigint',
            notNull: true,
            defaultValue: null,
            comment: null,
            generation: { kind: 'identity', always: true },
            collation: null,
          },
          {
            key: 'c2',
            name: 'status',
            logicalName: '受注状態',
            dataType: 'varchar(20)',
            notNull: true,
            defaultValue: "'pending'",
            comment: 'a|b',
            generation: null,
            collation: null,
          },
        ],
        constraints: [
          {
            key: 'k1',
            kind: 'primary_key',
            name: 'orders_pkey',
            columns: ['c1'],
            columnNames: ['order_id'],
            reference: null,
          },
        ],
        indexes: [],
        size: null,
      },
    ],
    otherObjects: [
      {
        objectKey: 'v1o',
        kind: 'view',
        name: 'v_orders',
        logicalName: null,
        schema: sales,
        definition: { select: 'SELECT order_id FROM sales.orders', comment: null, options: {} },
        analysis: { columns: ['order_id'], dependencies: [] },
        error: null,
        ownership: null,
      },
    ],
    comparison: {
      version: { number: 1 },
      difference: {
        counts: { added: 0, changed: 1, deleted: 1 },
        changes: [
          {
            objectKey: 't1',
            entity: 'column',
            key: 'c2',
            action: 'changed',
            before: { name: 'status' },
            after: { name: 'status' },
            fields: ['dataType'],
          },
          {
            objectKey: 'old',
            entity: 'object',
            key: 'old',
            action: 'deleted',
            before: { name: 'legacy_codes' },
            after: null,
            fields: [],
          },
        ],
      },
    },
    ddl: { status: 'error', error: { code: 'invalid_ddl', message: '参照先がありません' } },
    ...overrides,
  }) as unknown as DefinitionData

const texts = (blocks: Block[]) => blocks.flatMap((b) => ('text' in b ? [b.text] : []))

test('lays out the document in the order of the export', () => {
  const blocks = definitionBlocks(data(), new Date(Date.UTC(2026, 9, 12, 3, 0)))

  expect(blocks[0]).toMatchObject({ type: 'title', text: 'ec_main テーブル定義書' })
  expect(blocks[0]).toMatchObject({ lines: expect.arrayContaining(['出力日時 2026/10/12 12:00']) })
  expect(texts(blocks)).toEqual([
    'ec_main テーブル定義書',
    '改訂履歴',
    '改訂箇所（v1 との比較）',
    '追加 0 ・ 変更 1 ・ 削除 1。各表の「改訂」と見出しの［追加］［変更］で示します。',
    'テーブル一覧',
    'sales.orders（受注） ［変更］',
    'カラム定義',
    '制約',
    'ビュー・シーケンス',
    'ビュー sales.v_orders',
    'SELECT order_id FROM sales.orders',
    '出力カラム: order_id',
    '付録: DDL',
    'DDL を生成できませんでした: 参照先がありません',
  ])
})

test('marks the changed column and lists the deleted objects', () => {
  const blocks = definitionBlocks(data(), new Date())
  const columns = blocks.find((b) => b.type === 'table' && b.head.includes('データ型'))
  const deleted = blocks.find((b) => b.type === 'table' && b.head[0] === '削除したオブジェクト')

  expect(columns).toMatchObject({
    head: ['#', '物理名', '論理名', 'データ型', 'NN', 'デフォルト', 'コメント', '改訂'],
    rows: [
      ['1', 'order_id', '受注ID', 'bigint', '○', 'IDENTITY ALWAYS', '', ''],
      ['2', 'status', '受注状態', 'varchar(20)', '○', "'pending'", 'a|b', '変更'],
    ],
  })
  expect(deleted).toMatchObject({ rows: [['legacy_codes']] })
})

test('leaves the revision column out without a comparison', () => {
  const blocks = definitionBlocks(data({ comparison: null }), new Date())

  expect(blocks.some((b) => b.type === 'table' && b.head.includes('改訂'))).toBe(false)
})

test('writes Markdown with escaped cells, SQL code and the draft notice', () => {
  const markdown = definitionMarkdown(definitionBlocks(data(), new Date()), true)

  expect(markdown.startsWith('> **ドラフト**')).toBe(true)
  expect(markdown).toContain('# ec_main テーブル定義書')
  expect(markdown).toContain(
    "| 2 | status | 受注状態 | varchar(20) | ○ | 'pending' | a\\|b | 変更 |",
  )
  expect(markdown).toContain('```sql\nSELECT order_id FROM sales.orders\n```')
})

test('fences code containing backticks with a longer fence', () => {
  const markdown = definitionMarkdown([{ type: 'code', text: 'SELECT "```"' }], false)

  expect(markdown).toContain('````sql\nSELECT "```"\n````')
})
