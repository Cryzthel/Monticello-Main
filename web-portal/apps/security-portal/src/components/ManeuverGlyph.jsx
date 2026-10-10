import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Navigation,
  RotateCcw,
  RotateCw,
} from '@shared/icons'

/**
 * The turn arrow for one maneuver.
 *
 * ── WHY IT IS ITS OWN MODULE ───────────────────────────────────────────────
 * It lived inside `RouteSteps`, which was the only thing that drew turn
 * arrows until the guidance banner started drawing one too. That list has
 * since been removed from the route panel — the banner renders the active
 * instruction and a second copy underneath it was the same sentence twice —
 * and the glyph would otherwise have been the sole reason to keep a deleted
 * component's file alive.
 *
 * ── SHARP AND ORDINARY TURNS SHARE A GLYPH, ON PURPOSE ─────────────────────
 * No icon set the portals have used ships a sharp-turn arrow — Lucide did
 * not, Hugeicons did not, Material Symbols does not and Phosphor does not —
 * and inventing a rotated one would produce a symbol an officer has to learn.
 * The instruction already says "sharp", which is the part that matters.
 */
const GLYPHS = {
  depart: Navigation,
  arrive: Flag,
  left: CornerUpLeft,
  right: CornerUpRight,
  'sharp-left': CornerUpLeft,
  'sharp-right': CornerUpRight,
  'slight-left': ArrowUpLeft,
  'slight-right': ArrowUpRight,
  straight: ArrowUp,
  uturn: RotateCcw,
  roundabout: RotateCw,
}

/** The turn arrow for a maneuver key, defaulting to "carry on". */
export default function ManeuverGlyph({ icon, size = 'sm', className = '' }) {
  const Glyph = GLYPHS[icon] ?? ArrowUp
  return <Glyph size={size} className={className} />
}
