import type { DeploymentLog } from '../composables/useDeployments.ts'

// The execution log as the progress screen shows it (design 4m 4o): one row per step group
// ("テーブル 42 1.9 s"), in the order they ran, and what went wrong.

const PHASES: Record<string, string> = {
  before: '事前処理',
  begin: 'BEGIN',
  transaction: 'トランザクション内',
  constraint: '制約の検証',
  commit: 'COMMIT',
  outside: 'トランザクション外',
}
const KINDS: Record<string, string> = {
  schema: 'スキーマ',
  sequence: 'シーケンス',
  table: 'テーブル',
  view: 'ビュー',
  materialized_view: 'マテリアライズドビュー',
  index: 'インデックス',
  column: 'カラム',
  constraint: '制約',
  version: '適用バージョンを記録',
}
const CODES: Record<string, string> = {
  stale_update: '受付後に接続情報または設計が変わったため、実行しませんでした',
  invalid_state: '実行直前のチェックに合格しなかったため、実行しませんでした',
  connection_failed: '接続先に接続できませんでした',
  execution_failed: 'DDL の実行に失敗しました',
  preparation_failed: '実行の準備に失敗しました（DDL は実行していません）',
  workflow_failed: '実行が開始されませんでした（DDL は実行していません）',
}

export interface LogRow {
  label: string
  statements: number
  durationMs: number
}

/** "transaction:table" → "テーブル"; "outside:index" → "インデックス（トランザクション外）". */
const groupLabel = (key: string) => {
  const [phase = '', kind] = key.split(':')
  if (!kind) return PHASES[phase] ?? phase
  const name = KINDS[kind] ?? kind
  return phase === 'transaction' ? name : `${name}（${PHASES[phase] ?? phase}）`
}

export const logRows = (log: DeploymentLog | null): LogRow[] =>
  Object.entries(log?.groups ?? {}).map(([key, group]) => ({
    label: groupLabel(key),
    statements: group.statements,
    durationMs: group.durationMs,
  }))

/** The step running now (or where a failed run stopped), as a label. */
export const currentStep = (log: DeploymentLog | null) =>
  log?.lastStep?.status === 'running'
    ? groupLabel(
        log.lastStep.kind === log.lastStep.phase
          ? log.lastStep.phase
          : `${log.lastStep.phase}:${log.lastStep.kind}`,
      )
    : null

export const failureText = (log: DeploymentLog | null) =>
  log?.code ? (CODES[log.code] ?? `実行に失敗しました（${log.code}）`) : null

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
