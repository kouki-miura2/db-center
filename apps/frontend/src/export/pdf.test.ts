import { afterEach, expect, test, vi } from 'vite-plus/test'

import normal from '../../public/fonts/noto-sans-jp/noto-sans-jp-400.ttf?inline'
import bold from '../../public/fonts/noto-sans-jp/noto-sans-jp-700.ttf?inline'
import type { Block } from './definition.ts'
import { definitionPdf } from './pdf.ts'

// Serves the real fonts of `public/` (inlined as data URLs), so the test proves jsPDF can embed
// the Japanese TTF.
const realFetch = globalThis.fetch
const serveFonts = () =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input) =>
      realFetch(typeof input === 'string' && input.includes('-700') ? bold : normal),
    )

afterEach(() => {
  vi.restoreAllMocks()
})

const blocks: Block[] = [
  { type: 'title', text: 'ec_main テーブル定義書', lines: ['バージョン v2（仮確定）'] },
  { type: 'heading', level: 2, text: 'sales.orders（受注）' },
  {
    type: 'table',
    head: ['#', '物理名', '論理名'],
    rows: Array.from({ length: 80 }, (_, i) => [String(i + 1), `column_${i}`, '受注日時']),
  },
  { type: 'code', text: 'CREATE TABLE sales.orders (\n  order_id bigint\n);' },
]

test('makes an A4 PDF with the Japanese font, breaking long tables onto new pages', async () => {
  serveFonts()

  const pdf = await definitionPdf(blocks, { orientation: 'portrait', draft: true })

  expect(pdf.blob.type).toBe('application/pdf')
  // The cover is a page of its own; 80 rows don't fit on one more.
  expect(pdf.pages).toBeGreaterThanOrEqual(3)
  const text = new TextDecoder('latin1').decode(await pdf.blob.arrayBuffer())
  expect(text).toContain('/FontName /NotoSansJP')
}, 30_000)

test('fails when the font cannot be loaded', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))

  await expect(definitionPdf(blocks, { orientation: 'landscape', draft: false })).rejects.toThrow(
    'font 404',
  )
})
