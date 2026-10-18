import { Toaster } from 'sonner'
import { AlertTriangle, CheckCircle2, CircleAlert, Info, Loader2, X } from '@shared/icons'
import { useTheme } from '@shared/theme/ThemeProvider'

/**
 * Renders `toast` from @shared/lib/toast. Mounted once, by ToastProvider.
 *
 * sonner owns the behaviour that is easy to get subtly wrong — the stack
 * that fans out on hover, the dismiss timer (paused on hover and on a hidden
 * tab, restarted when a toast with the same id fires again), swipe to
 * dismiss, an aria-live region, and reduced-motion handling. Its LOOK is
 * switched off (`unstyled`) and drawn here.
 *
 * ── THE GLASS CARD ─────────────────────────────────────────────────────────
 *   [ ◉ ]  Announcement updated                         [×]
 *          Residents see the change immediately.
 *
 * Dark: `zinc-950/80` (= base-950) with `backdrop-blur-xl`, a `white/10`
 * ring and a long soft drop shadow, per the reference. Light: the same glass
 * in white with a slate ring, so it is not a black slab on a light console.
 * The tone lives in a 32px ringed disc around the glyph — emerald, red, amber
 * or blue — rather than in the card itself.
 *
 * ── THE SPRING ─────────────────────────────────────────────────────────────
 * The entrance curve, `cubic-bezier(0.34, 1.56, 0.64, 1)` over 500 ms, is in
 * styles/index.css (`.action-toast`), outside every @layer: sonner injects its
 * own transition unlayered, and an unlayered rule beats a layered one.
 *
 * Bottom-right: the incident cards own the top-right corner, and feedback for
 * something the operator just did belongs near where they did it.
 */
function ToneDisc({ tone, children }) {
  return (
    <span
      className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-inset ${tone}`}
    >
      {children}
    </span>
  )
}

const TONE_ICON = {
  success: (
    <ToneDisc tone="bg-success/10 ring-success/20 text-success">
      <CheckCircle2 size="sm" />
    </ToneDisc>
  ),
  error: (
    <ToneDisc tone="bg-danger/10 ring-danger/20 text-danger">
      <CircleAlert size="sm" />
    </ToneDisc>
  ),
  warning: (
    <ToneDisc tone="bg-warning/10 ring-warning/20 text-warning">
      <AlertTriangle size="sm" />
    </ToneDisc>
  ),
  info: (
    <ToneDisc tone="bg-info/10 ring-info/20 text-info">
      <Info size="sm" />
    </ToneDisc>
  ),
  close: <X size="sm" />,
  loading: (
    <ToneDisc tone="bg-tint/[0.05] ring-hairline text-text-muted">
      <Loader2 size="sm" className="animate-spin" />
    </ToneDisc>
  ),
}

export default function ActionToaster() {
  const { isDark } = useTheme()
  return (
    <Toaster
      position="bottom-right"
      theme={isDark ? 'dark' : 'light'}
      visibleToasts={4}
      gap={12}
      offset={24}
      mobileOffset={16}
      closeButton
      icons={TONE_ICON}
      containerAriaLabel="Action feedback"
      style={{ zIndex: 'var(--z-toast)' }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            'action-toast flex w-[380px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-2xl p-4 pr-12',
            'bg-white/80 ring-1 ring-slate-900/10 shadow-[0_20px_40px_-15px_rgba(15,23,42,0.18)] backdrop-blur-xl',
            'dark:bg-base-950/80 dark:ring-white/10 dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)]',
          ].join(' '),
          icon: '!m-0 flex h-8 w-8 shrink-0 items-center justify-center',
          content: 'flex min-w-0 flex-1 flex-col pt-0.5',
          title: 'text-sm font-medium tracking-tight text-text-primary',
          description: 'mt-0.5 text-[13px] leading-relaxed text-text-secondary',
          closeButton: [
            // `absolute` is ours to add: with `unstyled`, sonner drops its own
            // positioning, and the button (rendered FIRST in the toast) sat in
            // the flex row at the far left. Top-right on the title's line, as
            // in the reference; `pr-12` on the card keeps text clear of it.
            'absolute !left-auto !right-4 !top-4 !translate-x-0 !translate-y-0 !border-0 !bg-transparent',
            'flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors',
            'hover:!bg-tint/[0.08] hover:text-text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hairline',
          ].join(' '),
          actionButton: 'btn btn-compact btn-outline h-7 self-center',
        },
      }}
    />
  )
}
