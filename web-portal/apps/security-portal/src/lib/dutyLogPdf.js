import { jsPDF } from 'jspdf'
import {
  drawBrandHeader,
  drawOfficialFooter,
  INK,
  MARGIN as M,
  MUTED,
  PAGE,
  RULE,
} from '@shared/lib/pdfBrand'
import { formatDate, formatDateTime, formatInZone } from '@shared/lib/dates'

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

const CONTENT_W = PAGE.w - M * 2

/**
 * ── THE GEOMETRY AND THE PALETTE MOVED TO `@shared/lib/pdfBrand` ───────
 * They were local constants here, including a `BRAND` of #047857 — the
 * console's emerald, described in the comment it carried as "the same green as
 * the lockup". It is not: the official lockup is maroon type with a green
 * LEAF, and nothing in it is the product's emerald. The letterhead now comes
 * from one module that reads its colours off the supplied artwork, so there is
 * nowhere left for a second opinion about the brand to live.
 */


const stamp = (v) => formatDateTime(v)
const day = (v) => formatDate(v)
const clock = (v) => (v ? formatInZone(v, { hour: '2-digit', minute: '2-digit' }, 'en-GB') : '—')

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
  { key: 'date', label: 'Date', share: 0.16, align: 'left' },
  { key: 'shift', label: 'Shift', share: 0.14, align: 'left' },
  { key: 'in', label: 'Time in', share: 0.11, align: 'left' },
  { key: 'out', label: 'Time out', share: 0.11, align: 'left' },
  { key: 'hours', label: 'Duration', share: 0.14, align: 'right' },
  { key: 'handover', label: 'Handover filed', share: 0.34, align: 'left' },
]

/**
 * Gutter, in points, between a right-aligned cell and the column after it.
 *
 * It was 4, which is the inset a right-aligned column needs from its OWN
 * edge and not the gap it needs from its neighbour — so “DURATION” ended
 * four points before “HANDOVER FILED” began and the two headers read as one
 * word. The only right-aligned column is Duration, and the one to its right
 * is the widest, so the space comes out of the column that can spare it.
 */
const RIGHT_GUTTER = 16

/**
 * Build and download the duty log. Returns the filename so a caller can
 * report it, matching `exportReportPdf`.
 *
 * `shifts` are already filtered and sorted by the caller — the PDF is of what
 * is on screen, filters included, which is what makes the export predictable.
 * `filterLabel` says so in the header, so a six-row export of a thirty-shift
 * history cannot be mistaken for the whole record.
 */
export function exportDutyLogPdf({
  officer,
  shifts = [],
  filterLabel = 'All time',
  incidentsHandled = null,
} = {}) {
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
      const x = col.align === 'right' ? xs[i] + widths[i] - RIGHT_GUTTER : xs[i]
      doc.text(col.label.toUpperCase(), x, y, { align: col.align })
    })
    y += 7
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.75)
    doc.line(M, y, PAGE.w - M, y)
    y += 14
  }

  // ── The letterhead ───────────────────────────────────────
  y = drawBrandHeader(doc, 'Community Security & Dispatch Log')

  // ── Who, and over what window ─────────────────────────────────
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
  /**
   * ── FIVE FACTS, AND ONE OF THEM IS NOT A SHIFT FIGURE ─────────────
   * `incidentsHandled` is counted from the incident collection, not from
   * these rows, so it is the one number here the table below does not also
   * prove. It is passed in rather than derived precisely so that stays
   * visible: a caller that cannot count them passes nothing and the row
   * reads — rather than silently printing 0, which is a claim.
   *
   * Everything else is summed from the SAME rows the table prints, never
   * from a separate query. A header that disagrees with the rows beneath it
   * is the one failure a timesheet cannot survive.
   */
  const facts = [
    ['Shifts', String(shifts.length)],
    ['Completed', String(closed.length)],
    ['Total on duty', duration(totalMinutes)],
    ['Incidents handled', incidentsHandled == null ? '—' : String(incidentsHandled)],
    ['Range', filterLabel],
  ]
  const factW = CONTENT_W / facts.length
  facts.forEach(([label, text], i) => {
    setText(7.5, 'bold', MUTED)
    doc.text(label.toUpperCase(), M + i * factW, y, { maxWidth: factW - 6 })
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
        const x = col.align === 'right' ? xs[i] + widths[i] - RIGHT_GUTTER : xs[i]
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

  // ── The official footer, on every page ────────────────────────
  drawOfficialFooter(doc, {
    disclaimer:
      `Generated ${stamp(new Date())} by the Monticello Villas security console from the ` +
      'guard_shifts record. Times are as clocked by the officer\u2019s own device. This document ' +
      'is a copy of a live record and is not valid as proof of hours without the signature above.',
  })

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
