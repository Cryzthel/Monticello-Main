/**
 * An inline region that opens and closes in place (email form, password form).
 *
 * Animates `grid-template-rows: 0fr → 1fr`, which tracks the content's real
 * height — unlike a guessed `max-height`, it never clips a growing error line
 * and runs at one speed. Shut, it is `invisible` as well as zero-height, so
 * keyboard focus cannot land on fields nobody can see. Reduced motion skips
 * the animation entirely.
 */
export default function Disclosure({ id, open, children }) {
  return (
    <div
      id={id}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
