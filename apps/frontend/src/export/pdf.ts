import type { Block } from './definition.ts'

// The table definition as a PDF, made in the browser ("テーブル定義書": A4 landscape or portrait,
// a "ドラフト" watermark on an editing version). jsPDF, jspdf-autotable and the Japanese font
// (Noto Sans JP as TTF, which jsPDF needs) are loaded only when a PDF is made.

const FONT = 'NotoSansJP'
const FONT_FILES = {
  normal: '/fonts/noto-sans-jp/noto-sans-jp-400.ttf',
  bold: '/fonts/noto-sans-jp/noto-sans-jp-700.ttf',
} as const
const MARGIN = 14
const INK: [number, number, number] = [22, 25, 31]
const MUTED: [number, number, number] = [91, 98, 112]

/** The font file as base64, read in chunks (`btoa` takes a string of bytes). */
const loadFont = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`font ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export const definitionPdf = async (
  blocks: Block[],
  options: { orientation: 'landscape' | 'portrait'; draft: boolean },
): Promise<{ blob: Blob; pages: number }> => {
  const [{ jsPDF, GState }, { autoTable }, normal, bold] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadFont(FONT_FILES.normal),
    loadFont(FONT_FILES.bold),
  ])
  const doc = new jsPDF({ orientation: options.orientation, unit: 'mm', format: 'a4' })
  doc.addFileToVFS('noto-sans-jp-400.ttf', normal)
  doc.addFont('noto-sans-jp-400.ttf', FONT, 'normal')
  doc.addFileToVFS('noto-sans-jp-700.ttf', bold)
  doc.addFont('noto-sans-jp-700.ttf', FONT, 'bold')
  doc.setFont(FONT, 'normal')

  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const usable = width - MARGIN * 2
  let y = MARGIN
  let pageEmpty = true

  const ensure = (needed: number) => {
    if (y + needed <= height - MARGIN) return
    doc.addPage()
    y = MARGIN
    pageEmpty = true
  }
  const write = (text: string, size: number, style: 'normal' | 'bold', color = INK, gap = 2) => {
    doc.setFont(FONT, style)
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lineHeight = size * 0.45
    for (const line of doc.splitTextToSize(text, usable) as string[]) {
      ensure(lineHeight)
      doc.text(line, MARGIN, y + lineHeight * 0.8)
      y += lineHeight
    }
    y += gap
    pageEmpty = false
  }

  for (const block of blocks) {
    if (block.type === 'pageBreak') {
      if (!pageEmpty) {
        doc.addPage()
        y = MARGIN
        pageEmpty = true
      }
    } else if (block.type === 'title') {
      y = height * 0.3
      write(block.text, 24, 'bold', INK, 8)
      for (const line of block.lines) write(line, 11, 'normal', MUTED, 1)
      doc.addPage()
      y = MARGIN
      pageEmpty = true
    } else if (block.type === 'heading')
      write(
        block.text,
        { 1: 16, 2: 13, 3: 10.5 }[block.level],
        'bold',
        INK,
        block.level === 3 ? 1 : 3,
      )
    else if (block.type === 'paragraph') write(block.text, 9, 'normal', MUTED, 3)
    else if (block.type === 'code') {
      doc.setFont(FONT, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...INK)
      const lineHeight = 3.6
      for (const line of block.text.split('\n'))
        for (const part of doc.splitTextToSize(line || ' ', usable - 4) as string[]) {
          ensure(lineHeight)
          doc.text(part, MARGIN + 2, y + lineHeight * 0.8)
          y += lineHeight
        }
      y += 3
      pageEmpty = false
    } else {
      autoTable(doc, {
        head: [block.head],
        body: block.rows,
        startY: y,
        margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
        theme: 'grid',
        styles: {
          font: FONT,
          fontSize: 8,
          cellPadding: 1.5,
          textColor: INK,
          lineColor: [227, 229, 234],
        },
        headStyles: { font: FONT, fontStyle: 'bold', fillColor: [238, 240, 243], textColor: INK },
      })
      y = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5
      pageEmpty = false
    }
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFont(FONT, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`${page} / ${pages}`, width - MARGIN, height - MARGIN / 2, { align: 'right' })
    if (options.draft) {
      doc.saveGraphicsState()
      doc.setGState(new GState({ opacity: 0.12 }))
      doc.setFont(FONT, 'bold')
      doc.setFontSize(72)
      doc.setTextColor(...INK)
      doc.text('ドラフト', width / 2, height / 2, { align: 'center', angle: 30 })
      doc.restoreGraphicsState()
    }
  }
  return { blob: doc.output('blob'), pages }
}
