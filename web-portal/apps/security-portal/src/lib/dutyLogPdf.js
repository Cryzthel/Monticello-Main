import { jsPDF } from 'jspdf'

/**
 * An officer's duty history, as a PDF.
 *
 * ── A TABLE, WHERE THE REPORT EXPORT IS A DOCUMENT ──────────────────────────
 * `admin-portal/src/lib/reportPdf.js` draws one incident as prose: a masthead,
 * a facts block, then paragraphs. This draws many shifts as rows, and the two
 * jobs want different machinery — a narrative needs `splitTextToSize` and page
 * breaks mid-paragraph, a timesheet needs a repeating header and columns that
 * line up across pages.
 *
 * They deliberately share their LOOK rather than their code: the same A4
 * geometry, the same margin, the same Helvetica, the same brand rule under the
 * masthead. Two exports from one system should be recognisably the same
 * stationery. Factoring that into a shared "PDF chrome" helper would be the
 * right move at a third exporter; at two it would be an abstraction built from
 * one example of each kind.
 *
 * ── WHY NOT html2canvas ─────────────────────────────────────────────────────
 * Same reason as the report export, and it matters more here. A rasterised
 * table is an image of numbers: not selectable, not searchable, and useless to
 * the payroll clerk who wants to copy the hours out. Drawn with the text API
 * this is vector, a few kilobytes, and the figures can be lifted straight from
 * the page.
 *
 * ── AND WHY THE EXPORT IS CLIENT-SIDE ───────────────────────────────────────
 * It contains an officer's movements — when they were on duty, for how long,
 * and the handover notes they wrote. Built in this tab from data the officer
 * can already read, it never travels anywhere to be rendered. There is also no
 * server that could do it: Functions cannot deploy on the Spark plan.
 */

const PAGE = { w: 595.28, h: 841.89 } // A4 portrait, points
const M = 56
const CONTENT_W = PAGE.w - M * 2

const INK = [23, 23, 27]
const MUTED = [113, 113, 122]
const RULE = [228, 228, 231]
const BRAND = [4, 120, 87] // --color-brand-cta, the same green as the lockup

const STAMP = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
const DATE = { day: '2-digit', month: 'short', year: 'numeric' }

const stamp = (v) => (v ? new Date(v).toLocaleString('en-GB', STAMP).replace(',', '') : '—')
const day = (v) => (v ? new Date(v).toLocaleDateString('en-GB', DATE) : '—')
const clock = (v) => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—')

/** "7h 25m" — the same shape the on-screen table shows, so the two agree. */
function duration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

/**
 * Columns, as a width share of the content box.
 *
 * Shares rather than points so the table is defined once and still fits if the
 * margin is ever changed. The order mirrors the admin console's Shift history
 * table — date, shift, in, out, duration, handover — because this is the same
 * record seen from the other side, and an officer comparing their export
 * against what an administrator is looking at should not have to re-map it.
 */
const COLUMNS = [
  { key: 'date', label: 'Date', share: 0.17, align: 'left' },
  { key: 'shift', label: 'Shift', share: 0.15, align: 'left' },
  { key: 'in', label: 'Time in', share: 0.12, align: 'left' },
  { key: 'out', label: 'Time out', share: 0.12, align: 'left' },
  { key: 'hours', label: 'Duration', share: 0.14, align: 'right' },
  { key: 'handover', label: 'Handover filed', share: 0.3, align: 'left' },
]

/**
 * Build and download the duty log. Returns the filename so a caller can
 * report it, matching `exportReportPdf`.
 *
 * `shifts` are already filtered and sorted by the caller — the PDF is of what
 * is on screen, filters included, which is what makes the export predictable.
 * `filterLabel` says so in the header, so a six-row export of a thirty-shift
 * history cannot be mistaken for the whole record.
 */
export function exportDutyLogPdf({ officer, shifts = [], filterLabel = 'All time' } = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  let y = M

  const setText = (size, weight, colour) => {
    doc.setFont('helvetica', weight)
    doc.setFontSize(size)
    doc.setTextColor(...colour)
  }

  const widths = COLUMNS.map((c) => c.share * CONTENT_W)
  const xs = widths.reduce((acc, w, i) => [...acc, (acc[i - 1] ?? M) + (widths[i - 1] ?? 0)], [])

  /** The column header strip. Redrawn on every page — see the loop below. */
  function drawHead() {
    setText(7.5, 'bold', MUTED)
    COLUMNS.forEach((col, i) => {
      const x = col.align === 'right' ? xs[i] + widths[i] - 4 : xs[i]
      doc.text(col.label.toUpperCase(), x, y, { align: col.align })
    })
    y += 7
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.75)
    doc.line(M, y, PAGE.w - M, y)
    y += 14
  }

  // ── Masthead ──────────────────────────────────────────────────────────────
  setText(9, 'bold', BRAND)
  doc.text('MONTICELLO VILLAS', M, y)
  setText(9, 'normal', MUTED)
  doc.text('Duty log', PAGE.w - M, y, { align: 'right' })

  y += 10
  doc.setDrawColor(...BRAND)
  doc.setLineWidth(1.5)
  doc.line(M, y, PAGE.w - M, y)

  // ── Who, and over what window ─────────────────────────────────────────────
  y += 30
  setText(18, 'bold', INK)
  doc.text(officer?.name || 'Security officer', M, y)

  y += 16
  setText(10, 'normal', MUTED)
  const badge = officer?.badgeNumber ? `Badge ${officer.badgeNumber}` : 'No badge number'
  doc.text(`${badge}   ·   ${officer?.email || '—'}`, M, y)

  // ── Totals ────────────────────────────────────────────────────────────────
  // Summed from the SAME rows the table prints, never from a separate query.
  // A header that disagrees with the rows beneath it is the one failure a
  // timesheet cannot survive.
  const closed = shifts.filter((s) => !s.open)
  const totalMinutes = shifts.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)

  y += 26
  const facts = [
    ['Shifts', String(shifts.length)],
    ['Completed', String(closed.length)],
    ['Total on duty', duration(totalMinutes)],
    ['Range', filterLabel],
  ]
  const factW = CONTENT_W / facts.length
  facts.forEach(([label, text], i) => {
    setText(8, 'bold', MUTED)
    doc.text(label.toUpperCase(), M + i * factW, y)
    setText(11, 'normal', INK)
    doc.text(text, M + i * factW, y + 14)
  })

  y += 32
  doc.setDrawColor(...RULE)
  doc.line(M, y, PAGE.w - M, y)
  y += 20

  // ── Rows ──────────────────────────────────────────────────────────────────
  if (shifts.length === 0) {
    setText(10, 'normal', MUTED)
    doc.text('No shifts in this range.', M, y)
  } else {
    drawHead()

    for (const shift of shifts) {
      // Break BEFORE drawing rather than after overrunning, and repeat the
      // header on the new page: a continuation sheet of bare numbers with no
      // column titles is unreadable on its own, and these pages get separated.
      if (y > PAGE.h - M - 40) {
        doc.addPage()
        y = M
        drawHead()
      }

      const cells = {
        date: day(shift.timeIn),
        shift: shift.shift ? titleCase(shift.shift) : '—',
        in: clock(shift.timeIn),
        out: shift.open ? 'On duty' : clock(shift.timeOut),
        hours: duration(shift.durationMinutes),
        handover: shift.handover?.summary ? 'Yes' : shift.open ? '—' : 'No',
      }

      COLUMNS.forEach((col, i) => {
        setText(9.5, col.key === 'date' ? 'bold' : 'normal', col.key === 'date' ? INK : MUTED)
        const text = doc.splitTextToSize(String(cells[col.key]), widths[i] - 8)[0] ?? '—'
        const x = col.align === 'right' ? xs[i] + widths[i] - 4 : xs[i]
        doc.text(text, x, y, { align: col.align })
      })

      y += 13

      // The handover note itself, indented under its row. This is the half of
      // the record no query can reconstruct (see mapShiftDoc), so it travels
      // with the export rather than being flattened to the Yes/No above.
      const summary = shift.handover?.summary?.trim()
      if (summary) {
        setText(8.5, 'normal', MUTED)
        const lines = doc.splitTextToSize(summary, CONTENT_W - 16).slice(0, 3)
        doc.text(lines, M + 12, y)
        y += lines.length * 11
      }

      y += 7
      doc.setDrawColor(...RULE)
      doc.setLineWidth(0.5)
      doc.line(M, y, PAGE.w - M, y)
      y += 13
    }
  }

  // ── Footer, on every page ─────────────────────────────────────────────────
  // Page numbers are stamped at the end because the count is not known until
  // the last row is drawn.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p)
    setText(8, 'normal', MUTED)
    doc.text(`Exported ${stamp(new Date())}`, M, PAGE.h - M + 16)
    doc.text(`Page ${p} of ${pages}`, PAGE.w - M, PAGE.h - M + 16, { align: 'right' })
  }

  const who = (officer?.badgeNumber || officer?.name || 'officer')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const filename = `monticello-duty-log-${who}-${new Date().toISOString().slice(0, 10)}.pdf`
  doc.save(filename)
  return filename
}

const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—')
