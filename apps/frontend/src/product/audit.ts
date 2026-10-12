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
  started: '実行開始',
  succeeded: '実行成功',
  failed: '実行失敗',
}
export const auditText = (entry: AuditPage['entries'][number]) => {
  const actor = `${entry.userName} が `
  if (entry.action === 'join') return `${actor}プロダクトに参加`
  if (entry.action === 'leave') return `${actor}プロダクトから退出`
  if (entry.action === 'transfer') return `${actor}${entry.summary} にオーナーを譲渡`
  if (entry.action === 'invite') {
    const match = /^(.*)（(マネージャー|メンバー)）$/.exec(entry.summary)
    if (match) return `${actor}${match[1]} を${match[2]}として招待`
  }
  return `${actor}${entry.summary} を${actions[entry.action] ?? entry.action}`
}
