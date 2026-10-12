import type { AuditPage } from '../composables/useAuditLogs.ts'
const actions: Record<string, string> = {
  create: '作成',
  update: '変更',
  delete: '削除',
  invite: '招待',
  join: '参加',
  remove: '除外',
  leave: '退出',
  transfer: 'オーナーを譲渡',
  role: 'ロールを変更',
  provisional: '仮確定',
  revert: '編集に戻す',
  finalize: '確定',
  build: 'ビルド',
  migration: 'マイグレーション',
  start: '実行開始',
  succeeded: '実行成功',
  failed: '実行失敗',
}
export const auditText = (entry: AuditPage['entries'][number]) =>
  `${entry.userName} が ${entry.summary} を${actions[entry.action] ?? entry.action}`
