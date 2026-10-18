import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BadgeCheck, Check, Copy, KeyRound } from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import { copyText } from '@/lib/securityAccounts'

/**
 * The one screen where a temporary password exists in readable form.
 *
 * Shared by provisioning and by credential resets rather than written twice,
 * because the rule it enforces has to be identical in both: the password is in
 * the callable's RESPONSE and nowhere else — not in Firestore, not in the audit
 * log, not in the console — so this panel is the only copy and closing it
 * destroys it. Two implementations of that would eventually be one
 * implementation and one leak.
 *
 * ── NO PORTAL URL ON THE SLIP ───────────────────────────────────────────────
 * The obvious next line under "here are their credentials" is "and here is
 * where they sign in". It is absent on purpose: the admin bundle names no
 * origin, login path or role list belonging to the guardhouse app (see
 * web-portal/README.md#how-the-two-portals-stay-isolated, and this app's own
 * config/portal.js, which says nothing about the other portal). One hardcoded
 * URL here would be the first thread of the coupling the split removed — and it
 * would be wrong in every deployment but one.
 */

/**
 * A value with a copy button that confirms in place.
 *
 * The confirmation is on the button and lasts 1.6s. A toast would be right
 * anywhere else in this portal, but the panel already carries a "shown once"
 * warning, and floating a transient card over a credential somebody is midway
 * through transcribing is the wrong place to put motion.
 */
export function CopyRow({ label, value, mono = true }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function handleCopy() {
    const ok = await copyText(value)
    if (!ok) return
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-base-900 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-normal text-text-muted">{label}</p>
        <p className={`mt-0.5 truncate text-sm text-text-primary ${mono ? 'font-mono' : 'font-medium'}`}>
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label.toLowerCase()}`}
        className={`btn btn-compact shrink-0 ${copied ? 'btn-success' : 'btn-outline'}`}
      >
        {copied ? <Check size="sm" /> : <Copy size="sm" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/**
 * @param {object} props
 * @param {'created'|'reset'} props.mode  Only changes the wording. The rules
 *   about the password are identical, so the panel is not forked.
 */
export default function CredentialHandoff({ mode = 'created', credentials, onDone }) {
  const [copiedAll, setCopiedAll] = useState(false)
  const timer = useRef(null)
  const doneRef = useRef(null)

  useEffect(() => {
    doneRef.current?.focus()
    return () => clearTimeout(timer.current)
  }, [])

  const isReset = mode === 'reset'

  // One block for a chat message or a printed handover slip.
  const block = [
    'Monticello Villas — Guardhouse Portal access',
    `Name:     ${credentials.fullName}`,
    credentials.badgeNumber ? `Badge:    ${credentials.badgeNumber}` : '',
    `Email:    ${credentials.email}`,
    `Password: ${credentials.password}`,
    credentials.forcePasswordReset
      ? 'You will be asked to set your own password on first sign-in.'
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  async function copyAll() {
    const ok = await copyText(block)
    if (!ok) return
    setCopiedAll(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiedAll(false), 1600)
  }

  return (
    <div className="p-6">
      <div className="flex items-start gap-4">
        <span className="icon-tile icon-tile-lg bg-success/10 text-success">
          {isReset ? <KeyRound size="lg" /> : <BadgeCheck size="lg" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight text-text-primary">
            {isReset ? 'New password issued' : 'Account created'}
          </h2>
          {/* Reset only: "X can now sign in…" under "Account created" said
              the heading twice and was removed (2026-10-18). */}
          {isReset ? (
            <p className="mt-1 text-sm leading-snug text-text-secondary">
              {`${credentials.fullName}'s previous password no longer works. Hand over the new one below.`}
            </p>
          ) : null}
        </div>
      </div>

      {/* The warning sits ABOVE the values, not below them. Below, it is read
          after the panel has already been dismissed by someone who got what
          they came for. */}
      <p className="mt-5 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
        <AlertTriangle size="sm" className="mt-0.5 shrink-0" />
        <span>
          <strong className="font-semibold">This password is shown once.</strong> It was made on
          your device and is saved nowhere — not in the database, not in the audit log. Copy it
          before closing; if it is lost, issue another with{' '}
          <span className="whitespace-nowrap">Reset password</span> in the directory.
        </span>
      </p>

      <div className="mt-4 space-y-2.5">
        <CopyRow label="Login email" value={credentials.email} />
        <CopyRow label="Temporary password" value={credentials.password} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Both credential paths now always force a change, so this is a
            statement of fact rather than a readout of a setting — see the note
            in ProvisionAccountModal on why that stopped being a switch. The
            flag is still read rather than hardcoded, because it is the
            callable's answer and not this panel's assumption. */}
        <StatusBadge tone={credentials.forcePasswordReset ? 'brand' : 'neutral'} size="sm">
          {credentials.forcePasswordReset ? 'They must set their own on first sign-in' : 'No change required'}
        </StatusBadge>
        {credentials.badgeNumber ? (
          <StatusBadge tone="neutral" size="sm">
            Badge {credentials.badgeNumber}
          </StatusBadge>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={copyAll} className="btn btn-sm btn-outline">
          {copiedAll ? <Check size="sm" /> : <Copy size="sm" />}
          {copiedAll ? 'Copied handover slip' : 'Copy all details'}
        </button>
        <button ref={doneRef} type="button" onClick={onDone} className="btn btn-sm btn-brand">
          Done
        </button>
      </div>
    </div>
  )
}
