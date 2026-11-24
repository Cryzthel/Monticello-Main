/**
 * Y-axis sizing for the dashboard's count charts.
 *
 * ── THE BUG THIS REPLACES ──────────────────────────────────────────────────
 * Every numeric chart carried the same pair:
 *
 *   margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
 *   <YAxis ... width={28} />
 *
 * `width` reserves the gutter; the negative `left` margin then pulls the plot
 * area back over it. Net usable space for a tick label: 12px. A single digit is
 * about 7px and fits, so this looked correct for as long as no chart went into
 * double figures — and then every label above 9 lost its leading digit and the
 * axis read "2, ), 5, 3" instead of "12, 9, 6, 3, 0".
 *
 * That is the worst shape a layout bug can take: it does not break, it silently
 * misreports. A clipped "12" reads as a plausible "2".
 *
 * ── WHY COMPUTED AND NOT JUST WIDER ────────────────────────────────────────
 * A fixed 36px gutter would also never clip, but it spends the same space on a
 * chart whose axis tops out at 4 as on one topping out at 400 — which is what
 * the negative margin was clawing back in the first place, and why it was
 * added. Sizing from the data gives the space back when the numbers are small
 * and keeps it when they are not, so neither failure recurs.
 */

/** Shared plot margin. `left: 0` — the axis gutter is [yAxisWidth]'s job. */
export const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }

/**
 * Gutter width, in px, for an axis whose largest value is [maxValue].
 *
 * The 1.2 multiplier is headroom for the tick Recharts actually draws. With no
 * explicit `domain` it rounds the top of the scale UP to a round number, so a
 * series peaking at 96 gets a 100 tick — three digits where the data only has
 * two. Padding the estimate is cheaper than reading Recharts' tick generator,
 * and being one digit generous costs ~8px while being one digit short costs a
 * wrong number on screen.
 *
 * 8px per digit at the 12px tick size these charts use, plus 12px for the gap
 * between the label and the plot area.
 */
export function yAxisWidth(maxValue) {
  const peak = Number.isFinite(maxValue) ? Math.abs(maxValue) : 0
  const digits = String(Math.max(1, Math.round(peak * 1.2))).length
  return digits * 8 + 12
}
