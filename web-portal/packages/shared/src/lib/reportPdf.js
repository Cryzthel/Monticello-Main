import { jsPDF } from 'jspdf'
import { formatDateTime } from '@shared/lib/dates'

/**
 * One officer-filed report, as a PDF.
 *
 * ── WHY jsPDF'S TEXT API AND NOT html2canvas ────────────────────────────────
 * The brief names either. They produce very different artefacts and only one
 * of them is a document.
 *
 * html2canvas rasterises the DOM: the output is a screenshot of a dark-mode
 * modal, at whatever the viewport happened to be, with no selectable text, no
 * search, and a file size measured in megabytes because every pixel of the UI
 * chrome is in there. Printed, it is grey. A report that may end up in an
 * incident file, forwarded to a barangay office, or read on a phone needs to
 * be text.
 *
 * Drawing it with the text API instead means the PDF is vector: sharp at any
 * zoom, selectable and searchable, a few kilobytes, and laid out for A4 rather
 * than for whatever window it was exported from. It also means this file owns
 * the layout rather than inheriting it, which is why none of the screen's
 * styling leaks in.
 *
 * ── NO EXTERNAL FONT ────────────────────────────────────────────────────────
 * Helvetica is one of the 14 PDF base fonts: every reader has it and nothing
 * is embedded. Groote is the brand face, but embedding a licensed demo cut
 * into a document that gets emailed is exactly the redistribution its licence
 * forbids — see apps/<app>/public/fonts/README.md.
 */

const PAGE = { w: 595.28, h: 841.89 } // A4 portrait, points
const M = 56 // margin
const CONTENT_W = PAGE.w - M * 2

const INK = [23, 23, 27]
const MUTED = [113, 113, 122]
const RULE = [228, 228, 231]
const BRAND = [4, 120, 87] // --color-brand-cta, the same green as the lockup

const stamp = (v) => formatDateTime(v)
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : 'MV-UNKNOWN')
const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—')

/**
 * Build and download the PDF. Returns the filename so a caller can report it.
 *
 * `doc.save()` triggers the browser's own download — no network, no reload,
 * nothing server-side. That matters here beyond convenience: the report may
 * contain a resident's address and a narrative about their household, and a
 * client-side export means that content never leaves the admin's machine to
 * be rendered somewhere else.
 */
export function exportReportPdf(report, { attachmentCount = 0 } = {}) {
  if (!report) return null

  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  let y = M

  /** Move down, starting a new page first if `need` points would overrun. */
  const advance = (dy, need = 0) => {
    y += dy
    if (y + need > PAGE.h - M - 28) {
      doc.addPage()
      y = M
    }
  }

  const setText = (size, weight, colour) => {
    doc.setFont('helvetica', weight)
    doc.setFontSize(size)
    doc.setTextColor(...colour)
  }

  // ── Masthead ──────────────────────────────────────────────────────────────
  setText(9, 'bold', BRAND)
  doc.text('MONTICELLO VILLAS', M, y)
  setText(9, 'normal', MUTED)
  doc.text('Security report', PAGE.w - M, y, { align: 'right' })

  advance(10)
  doc.setDrawColor(...BRAND)
  doc.setLineWidth(1.5)
  doc.line(M, y, PAGE.w - M, y)

  // ── Title block ───────────────────────────────────────────────────────────
  advance(30)
  setText(18, 'bold', INK)
  const heading = report.title || `${titleCase(report.category)} report`
  const headingLines = doc.splitTextToSize(heading, CONTENT_W)
  doc.text(headingLines, M, y)
  advance(headingLines.length * 22)

  setText(10, 'normal', MUTED)
  doc.text(`${ticketCode(report.id)}   ·   Filed ${stamp(report.reportedAt)}`, M, y)

  // ── Facts ─────────────────────────────────────────────────────────────────
  advance(26)
  const facts = [
    ['Category', titleCase(report.category)],
    ['Severity', titleCase(report.severity)],
    ['Filed by', report.reportedByName || 'An officer'],
    ['Status', report.reviewedAt ? 'Reviewed' : 'Awaiting review'],
    ['Reviewed by', report.reviewedAt ? report.reviewedByName || 'An admin' : '—'],
    ['Reviewed at', stamp(report.reviewedAt)],
    ['Archived', report.archivedAt ? stamp(report.archivedAt) : 'No'],
    ['Attachments', attachmentCount ? `${attachmentCount} file${attachmentCount === 1 ? '' : 's'}` : 'None'],
  ]

  // Two columns, so the facts block stays short enough that the narrative —
  // the thing anyone actually reads — starts on the first page.
  const colW = CONTENT_W / 2
  const rows = Math.ceil(facts.length / 2)
  facts.forEach(([label, value], i) => {
    const col = Math.floor(i / rows)
    const row = i % rows
    const x = M + col * colW
    const ly = y + row * 30
    setText(8, 'bold', MUTED)
    doc.text(String(label).toUpperCase(), x, ly)
    setText(10.5, 'normal', INK)
    doc.text(doc.splitTextToSize(String(value), colW - 16)[0] ?? '—', x, ly + 13)
  })
  advance(rows * 30 + 4)

  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.75)
  doc.line(M, y, PAGE.w - M, y)

  // ── Narrative ─────────────────────────────────────────────────────────────
  const sections = [
    ['Report narrative', report.description],
    ['Admin notes', report.notes],
  ].filter(([, body]) => String(body || '').trim())

  if (!sections.length) {
    advance(26)
    setText(10.5, 'italic', MUTED)
    doc.text('No narrative was recorded on this report.', M, y)
  }

  sections.forEach(([label, body]) => {
    advance(26, 60)
    setText(8, 'bold', MUTED)
    doc.text(label.toUpperCase(), M, y)

    advance(16)
    setText(11, 'normal', INK)
    // Paragraph by paragraph so a page break lands between them where it can.
    String(body)
      .split(/\n{2,}/)
      .forEach((para, i) => {
        if (i) advance(10)
        doc.splitTextToSize(para.replace(/\n/g, ' ').trim(), CONTENT_W).forEach((line) => {
          doc.text(line, M, y)
          advance(15, 15)
          setText(11, 'normal', INK) // a page break resets the graphics state
        })
      })
  })

  // ── Footer on every page, numbered once the total is known ────────────────
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p)
    setText(8, 'normal', MUTED)
    doc.text(`Generated ${stamp(Date.now())}`, M, PAGE.h - M + 12)
    doc.text(`Page ${p} of ${pages}`, PAGE.w - M, PAGE.h - M + 12, { align: 'right' })
  }

  const filename = `${ticketCode(report.id)}.pdf`
  doc.save(filename)
  return filename
}
