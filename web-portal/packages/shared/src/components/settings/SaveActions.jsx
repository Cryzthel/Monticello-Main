import { Loader2, RotateCcw, Save } from '@shared/icons'

/**
 * The sticky Settings header's two actions, and nothing else: Discard
 * (secondary) and Save changes (primary). Shared by Admin › Settings and
 * Guardhouse › Settings (2026-10-19, by request: "identical to the Admin
 * layout"). Both stay put so the header never reflows; Discard is enabled only
 * with unsaved edits, and shows a spinner on Save while writing.
 *
 *   <SaveActions dirty={…} saving={…} canSave={…} onDiscard={…} onSave={…} />
 */
export default function SaveActions({ dirty, saving, canSave, onDiscard, onSave }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onDiscard}
        disabled={!dirty || saving}
        className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-tint/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:pointer-events-none disabled:opacity-40"
      >
        <RotateCcw size="sm" aria-hidden="true" />
        Discard
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        aria-busy={saving || undefined}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-[0_0_20px_-5px_color-mix(in_oklab,var(--color-brand-500)_60%,transparent)] transition-[background-color,transform,opacity] duration-150 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none"
      >
        {saving ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : <Save size="sm" aria-hidden="true" />}
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
