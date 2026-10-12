import { expect, test } from 'vite-plus/test'

import { currentStep, failureText, logRows, seconds } from './log.ts'

const log = {
  groups: {
    before: { statements: 1, rows: 0, durationMs: 300 },
    begin: { statements: 1, rows: 0, durationMs: 0 },
    'transaction:table': { statements: 42, rows: 0, durationMs: 1900 },
    'transaction:version': { statements: 1, rows: 1, durationMs: 100 },
    commit: { statements: 1, rows: 0, durationMs: 0 },
    'outside:index': { statements: 2, rows: 0, durationMs: 12600 },
  },
  lastStep: {
    index: 48,
    objectKey: 'o1',
    phase: 'outside',
    kind: 'index',
    status: 'running' as const,
  },
  committed: true,
}

test('lists the step groups in the order they ran', () => {
  expect(logRows(log)).toEqual([
    { label: '事前処理', statements: 1, durationMs: 300 },
    { label: 'BEGIN', statements: 1, durationMs: 0 },
    { label: 'テーブル', statements: 42, durationMs: 1900 },
    { label: '適用バージョンを記録', statements: 1, durationMs: 100 },
    { label: 'COMMIT', statements: 1, durationMs: 0 },
    { label: 'インデックス（トランザクション外）', statements: 2, durationMs: 12600 },
  ])
  expect(logRows(null)).toEqual([])
})

test('names the running step, none once it succeeded', () => {
  expect(currentStep(log)).toBe('インデックス（トランザクション外）')
  expect(currentStep({ ...log, lastStep: { ...log.lastStep, status: 'succeeded' } })).toBeNull()
})

test('explains a failure, falling back to its code', () => {
  expect(failureText({ code: 'execution_failed' })).toBe('DDL の実行に失敗しました')
  expect(failureText({ code: 'something_new' })).toBe('実行に失敗しました（something_new）')
  expect(failureText(log)).toBeNull()
})

test('shows durations in seconds', () => {
  expect(seconds(1234)).toBe('1.2 s')
})
