import { formatDate, TARGETS } from 'utils'

import type { DefinitionData } from '../composables/useDefinitionExport.ts'
import { bytes, type Sequence, type View } from '../design/object.ts'

// The table definition as a list of blocks ("各論 > データベース > テーブル定義書"): headings,
// paragraphs, tables and code, in the order of the document. The PDF and the Markdown are both
// drawn from these blocks, so their content can't drift apart.

export type Block =
  | { type: 'title'; text: string; lines: string[] }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'code'; text: string }
  /** A new page before this block in the PDF (Markdown ignores it). */
  | { type: 'pageBreak' }

type Table = DefinitionData['tables'][number]
type Other = DefinitionData['otherObjects'][number]
type Change = NonNullable<DefinitionData['comparison']>['difference']['changes'][number]

const STATUS = { editing: '編集中', provisional: '仮確定', final: '確定' } as const
const MARKS = { added: '追加', changed: '変更', renamed: '変更', deleted: '削除' } as const
const KINDS = {
  view: 'ビュー',
  materialized_view: 'マテリアライズドビュー',
  sequence: 'シーケンス',
}
const CONSTRAINTS = {
  primary_key: 'PRIMARY KEY',
  unique: 'UNIQUE',
  foreign_key: 'FOREIGN KEY',
  check: 'CHECK',
  exclude: 'EXCLUDE',
} as const

const dateTime = (value: number | null) =>
  value === null ? '' : formatDate(new Date(value), 'yyyy/MM/dd HH:mm')
const qualified = (name: string, schema: { name: string } | null) =>
  schema ? `${schema.name}.${name}` : name
const titled = (name: string, logicalName: string | null) =>
  logicalName ? `${name}（${logicalName}）` : name
const list = (names: (string | null)[]) => names.map((v) => v ?? '（式）').join(', ')

/** The revision marks against the compared version, by object and by column/constraint/index. */
const revisionMarks = (changes: Change[]) => {
  const marks = new Map<string, string>()
  for (const change of changes) {
    const id = change.entity === 'object' ? change.objectKey : `${change.objectKey}:${change.key}`
    marks.set(id, MARKS[change.action])
    // A part that changed marks its object as changed, unless the object itself was added.
    if (change.entity !== 'object' && !marks.has(change.objectKey))
      marks.set(change.objectKey, MARKS.changed)
  }
  return marks
}

const constraintDefinition = (table: Table, constraint: Table['constraints'][number]) => {
  if (constraint.kind === 'foreign_key') {
    const reference = constraint.reference
      ? `${qualified(constraint.reference.name, constraint.reference.schema)}(${list(constraint.reference.columnNames)})`
      : '（参照先なし）'
    return `→ ${reference} ON DELETE ${constraint.onDelete} ON UPDATE ${constraint.onUpdate}`
  }
  if (constraint.kind === 'check') return constraint.expression
  if (constraint.kind === 'exclude')
    return `USING ${constraint.method} (${constraint.elements
      .map(
        (e) =>
          `${e.columnKey ? (table.columns.find((c) => c.key === e.columnKey)?.name ?? '') : `(${e.expression})`} WITH ${e.operator}`,
      )
      .join(', ')})${constraint.where ? ` WHERE ${constraint.where}` : ''}`
  if (constraint.kind === 'unique' && !constraint.nullsDistinct) return 'NULLS NOT DISTINCT'
  return ''
}

const tableBlocks = (table: Table, data: DefinitionData, marks: Map<string, string>): Block[] => {
  const sections = data.sections
  const marked = data.comparison !== null
  const blocks: Block[] = [
    { type: 'pageBreak' },
    {
      type: 'heading',
      level: 2,
      text: `${titled(qualified(table.name, table.schema), table.logicalName)}${marks.has(table.objectKey) ? ` ［${marks.get(table.objectKey)}］` : ''}`,
    },
  ]
  if (table.comment) blocks.push({ type: 'paragraph', text: table.comment })
  if (sections.columns && table.columns.length)
    blocks.push(
      { type: 'heading', level: 3, text: 'カラム定義' },
      {
        type: 'table',
        head: [
          '#',
          '物理名',
          '論理名',
          'データ型',
          'NN',
          'デフォルト',
          'コメント',
          ...(marked ? ['改訂'] : []),
        ],
        rows: table.columns.map((column, i) => [
          String(i + 1),
          column.name,
          column.logicalName ?? '',
          column.dataType,
          column.notNull ? '○' : '',
          column.generation?.kind === 'identity'
            ? `IDENTITY${column.generation.always ? ' ALWAYS' : ''}`
            : column.generation?.kind === 'generated'
              ? `生成列: ${column.generation.expression}`
              : (column.defaultValue ?? ''),
          column.comment ?? '',
          ...(marked ? [marks.get(`${table.objectKey}:${column.key}`) ?? ''] : []),
        ]),
      },
    )
  if (sections.constraints && table.constraints.length)
    blocks.push(
      { type: 'heading', level: 3, text: '制約' },
      {
        type: 'table',
        head: ['種別', '制約名', '対象カラム', '定義', ...(marked ? ['改訂'] : [])],
        rows: table.constraints.map((constraint) => [
          CONSTRAINTS[constraint.kind],
          constraint.name,
          list(constraint.columnNames),
          constraintDefinition(table, constraint),
          ...(marked ? [marks.get(`${table.objectKey}:${constraint.key}`) ?? ''] : []),
        ]),
      },
    )
  if (sections.indexes && table.indexes.length)
    blocks.push(
      { type: 'heading', level: 3, text: 'インデックス' },
      {
        type: 'table',
        head: [
          'インデックス名',
          '方式',
          'キー列',
          'INCLUDE',
          'UNIQUE',
          '条件',
          ...(marked ? ['改訂'] : []),
        ],
        rows: table.indexes.map((index) => [
          index.name,
          index.method,
          index.columns
            .map(
              (c, i) =>
                `${index.columnNames[i] ?? `(${c.expression})`} ${c.order}${c.nulls ? ` NULLS ${c.nulls}` : ''}`,
            )
            .join(', '),
          list(index.includeNames),
          index.unique ? '○' : '',
          index.where ?? '',
          ...(marked ? [marks.get(`${table.objectKey}:${index.key}`) ?? ''] : []),
        ]),
      },
    )
  if (sections.size && table.size) {
    blocks.push({ type: 'heading', level: 3, text: 'サイズ設計' })
    if (table.size.estimate) {
      const estimate = table.size.estimate
      blocks.push(
        {
          type: 'paragraph',
          text: `平均行サイズ ${bytes(estimate.averageRowBytes)} ・ 初期件数 ${table.size.input.initialRows.toLocaleString()} 件 ・ INSERT ${table.size.input.inserts.toLocaleString()} / UPDATE ${table.size.input.updates.toLocaleString()} / DELETE ${table.size.input.deletes.toLocaleString()} 件／${{ hour: '時間', day: '日', month: '月' }[table.size.input.unit]}`,
        },
        {
          type: 'table',
          head: ['時点', '件数', 'テーブル', 'インデックス', '合計'],
          rows: estimate.snapshots.map((s) => [
            s.years === 0 ? '初期' : `${s.years}年後`,
            s.rows.toLocaleString(),
            bytes(s.tableBytes),
            bytes(s.indexBytes),
            bytes(s.totalBytes),
          ]),
        },
      )
    } else if (table.size.error)
      blocks.push({ type: 'paragraph', text: `見積もりできません: ${table.size.error.message}` })
    if (table.size.input.memo)
      blocks.push({ type: 'paragraph', text: `根拠: ${table.size.input.memo}` })
  }
  return blocks
}

const otherBlocks = (object: Other, marks: Map<string, string>): Block[] => {
  const heading: Block = {
    type: 'heading',
    level: 2,
    text: `${KINDS[object.kind as keyof typeof KINDS] ?? ''} ${titled(qualified(object.name, object.schema), object.logicalName)}${marks.has(object.objectKey) ? ` ［${marks.get(object.objectKey)}］` : ''}`,
  }
  if (object.kind === 'sequence') {
    const sequence = object.definition as Sequence
    const owner = object.ownership
      ? `${qualified(object.ownership.tableName, object.ownership.schema)}.${object.ownership.columnName ?? ''}`
      : ''
    return [
      heading,
      {
        type: 'table',
        head: ['項目', '値'],
        rows: [
          ['データ型', sequence.dataType],
          ['開始値', sequence.start],
          ['増分', sequence.increment],
          ['最小値', sequence.min ?? '既定'],
          ['最大値', sequence.max ?? '既定'],
          ['キャッシュ', sequence.cache],
          ['循環', sequence.cycle ? 'する' : 'しない'],
          ['所有カラム', owner],
          ['コメント', sequence.comment ?? ''],
        ],
      },
    ]
  }
  const view = object.definition as View
  return [
    heading,
    ...(view.comment ? [{ type: 'paragraph', text: view.comment } as const] : []),
    { type: 'code', text: view.select },
    object.analysis
      ? { type: 'paragraph', text: `出力カラム: ${object.analysis.columns.join(', ')}` }
      : { type: 'paragraph', text: `検証できません: ${object.error?.message ?? ''}` },
  ]
}

/** The whole document, as selected in the export dialog. */
export const definitionBlocks = (data: DefinitionData, exportedAt: Date): Block[] => {
  const { metadata } = data
  const marks = revisionMarks(data.comparison?.difference.changes ?? [])
  const blocks: Block[] = []
  const versionLabel = `v${metadata.version.number}（${STATUS[metadata.version.status]}）`
  if (metadata.cover)
    blocks.push({
      type: 'title',
      text: metadata.cover.title,
      lines: [
        `バージョン ${versionLabel}`,
        `ターゲット ${TARGETS[metadata.target].label}`,
        ...(metadata.cover.memo ? [`メモ ${metadata.cover.memo}`] : []),
        `出力日時 ${formatDate(exportedAt, 'yyyy/MM/dd HH:mm')}`,
      ],
    })
  else
    blocks.push({
      type: 'heading',
      level: 1,
      text: `${metadata.database.name} テーブル定義書 ${versionLabel}`,
    })
  if (data.history.length)
    blocks.push(
      { type: 'heading', level: 2, text: '改訂履歴' },
      {
        type: 'table',
        head: ['バージョン', '状態', 'メモ', '仮確定', '確定'],
        rows: data.history.map((v) => [
          `v${v.number}`,
          STATUS[v.status],
          v.memo ?? '',
          dateTime(v.provisionalAt),
          dateTime(v.finalizedAt),
        ]),
      },
    )
  if (data.comparison) {
    const { counts } = data.comparison.difference
    blocks.push(
      {
        type: 'heading',
        level: 2,
        text: `改訂箇所（v${data.comparison.version.number} との比較）`,
      },
      {
        type: 'paragraph',
        text: `追加 ${counts.added} ・ 変更 ${counts.changed} ・ 削除 ${counts.deleted}。各表の「改訂」と見出しの［追加］［変更］で示します。`,
      },
    )
    const deleted = data.comparison.difference.changes.filter(
      (c) => c.entity === 'object' && c.action === 'deleted',
    )
    if (deleted.length)
      blocks.push({
        type: 'table',
        head: ['削除したオブジェクト'],
        rows: deleted.map((c) => [
          String((c.before as { name?: string } | null)?.name ?? c.objectKey),
        ]),
      })
  }
  if (data.tableList.length)
    blocks.push(
      { type: 'heading', level: 2, text: 'テーブル一覧' },
      {
        type: 'table',
        head: ['スキーマ', '物理名', '論理名', 'カラム数', ...(data.comparison ? ['改訂'] : [])],
        rows: data.tableList.map((t) => [
          t.schema?.name ?? '',
          t.name,
          t.logicalName ?? '',
          String(t.columnCount),
          ...(data.comparison ? [marks.get(t.objectKey) ?? ''] : []),
        ]),
      },
    )
  for (const table of data.tables) blocks.push(...tableBlocks(table, data, marks))
  if (data.otherObjects.length) {
    blocks.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: 'ビュー・シーケンス' })
    for (const object of data.otherObjects) blocks.push(...otherBlocks(object, marks))
  }
  if (data.ddl) {
    blocks.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: '付録: DDL' })
    blocks.push(
      data.ddl.status === 'success'
        ? { type: 'code', text: data.ddl.sql }
        : { type: 'paragraph', text: `DDL を生成できませんでした: ${data.ddl.error.message}` },
    )
  }
  return blocks
}
