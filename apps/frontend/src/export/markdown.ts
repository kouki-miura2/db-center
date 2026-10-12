import type { Block } from './definition.ts'

// The table definition as Markdown ("テーブル定義書": UTF-8 `.md`, headings and tables, DDL in an
// SQL code block). A draft says so at the top.

/** A table cell on one line, with `|` escaped. */
const cell = (value: string) => value.replaceAll('|', '\\|').replace(/\r?\n/g, '<br>')

/** A code fence longer than any run of backticks inside `text`. */
const fence = (text: string) =>
  '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))

export const definitionMarkdown = (blocks: Block[], draft: boolean): string => {
  const out: string[] = draft
    ? ['> **ドラフト**: 編集中のバージョンです。内容は確定していません。', '']
    : []
  for (const block of blocks) {
    if (block.type === 'pageBreak') continue
    if (block.type === 'title') out.push(`# ${block.text}`, '', ...block.lines.map((l) => `- ${l}`))
    else if (block.type === 'heading') out.push(`${'#'.repeat(block.level)} ${block.text}`)
    else if (block.type === 'paragraph') out.push(block.text)
    else if (block.type === 'code') {
      const marks = fence(block.text)
      out.push(`${marks}sql`, block.text, marks)
    } else
      out.push(
        `| ${block.head.map(cell).join(' | ')} |`,
        `| ${block.head.map(() => '---').join(' | ')} |`,
        ...block.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      )
    out.push('')
  }
  return out.join('\n')
}
