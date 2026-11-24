import { httpsCallable } from 'firebase/functions'
import { functions } from '@shared/lib/firebase'
import { APPROVED_STATUS } from '@shared/auth/roles'

/**
 * Security guard account provisioning — vocabulary, mapping, and the four
 * privileged writes.
 *
 * ── WHY EVERY WRITE IN HERE IS A CALLABLE ───────────────────────────────────
 * `staff_accounts` is `allow create, update: if false` in firestore.rules, on
 * purpose: a document in that collection is what every role check in the
 * system reads, so a client that could write one could grant itself any role.
 * The rule is not an obstacle to work around — it is the reason this file has
 * no `setDoc` in it. Provisioning, credential resets, status changes and
 * re-assignments all go through Admin-SDK callables in functions/index.js,
 * which re-check `super_admin` server-side before touching anything.
 *
 * Deleting is the one exception (`allow delete: if isAdminStaff()`), and
 * OnDutyHistoryTable already uses it. It stays a client write because cutting
 * off a departed guard must not wait on a function deploy.
 */

// ── STATUS ──────────────────────────────────────────────────────────────────
//
// THE LOAD-BEARING LINE IN THIS FILE IS `active: APPROVED_STATUS`.
//
// Three places independently gate on `status == 'approved'` — firestore.rules
// (isStaff/isAdminStaff/isSecurityStaff), functions/index.js#requireStaff, and
// AuthContext#resolvePortalRole. Introducing a separate `active` value would
// have meant editing all three in lockstep, and any one of them missed is a
// silent authorisation hole in whichever direction the mismatch fell.
//
// So Active IS `approved` — the same string those three already accept — and
// the two new states are values none of them accept. Suspending or revoking an
// account therefore takes effect through machinery that already exists and was
// already deployed, with no rules change and no window where a half-applied
// policy is in force. `!== 'approved'` is a closed set: anything that is not
// the one permitted value is denied, including values invented later.
// What every security account is created as, and what an edit falls back to
// when an older account has none recorded. Shared by the create and edit
// modals so the two can never send different defaults.
export const PATROL_ACCESS_ROLE = 'roving_patrol'
export const DEFAULT_POST = 'perimeter_patrol'
export const ROSTER_SHIFT = 'morning'

export const ACCOUNT_STATUS = {
  active: APPROVED_STATUS,
  suspended: 'suspended',
  revoked: 'revoked',
}

export const STATUS_LABELS = {
  [ACCOUNT_STATUS.active]: 'Active',
  [ACCOUNT_STATUS.suspended]: 'Suspended',
  [ACCOUNT_STATUS.revoked]: 'Revoked',
}

// Tone per state, resolved here rather than at each call site so the directory
// table, the KPI strip and the modal cannot disagree about what amber means.
export const STATUS_TONES = {
  [ACCOUNT_STATUS.active]: 'success',
  [ACCOUNT_STATUS.suspended]: 'warning',
  [ACCOUNT_STATUS.revoked]: 'danger',
}

/** Anything unrecognised reads as revoked — the safe direction to guess. */
export function normalizeStatus(raw) {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === ACCOUNT_STATUS.active) return ACCOUNT_STATUS.active
  if (value === ACCOUNT_STATUS.suspended) return ACCOUNT_STATUS.suspended
  return ACCOUNT_STATUS.revoked
}

// ── ACCESS ROLE ─────────────────────────────────────────────────────────────
//
// The form offers ONE role selector, with the three job titles a guardhouse
// roster actually uses. Each carries the RBAC role the credential is created
// with, and that mapping is the load-bearing part of this file.
//
// ── WHY THE SELECTED VALUE IS NOT WHAT GETS STORED AS `role` ────────────────
// `staff_accounts.role` is not a label — it is the value three separate
// enforcement points compare against: firestore.rules (isStaff /
// isSecurityStaff), functions/index.js#requireStaff, and the guardhouse app's
// own AuthContext allowlist. All three accept exactly `security_officer` and
// `security_head` for guard credentials.
//
// Writing `role: 'gate_guard'` would therefore create an account that is
// visible in this directory and CANNOT SIGN IN: AuthProvider resolves the role
// against its allowlist, finds no match, and signs the session straight back
// out — the officer sees "This account is not authorized", with nothing on the
// admin side indicating why. So the job title is what the operator picks and
// what the directory displays; `rbacRole` is what the credential is minted
// with.
//
// `duty` is retained per option because the roster still records what the
// officer is doing, and because `security_users` ↔ `security_duties` in
// ../../../../db is modelled on it. It is now DERIVED from this one choice
// rather than a second control the operator has to keep consistent with it.
//
// `super_admin` is unreachable from here, mirroring INVITE_ROLES in
// functions/index.js: minting top-level access stays a Console action, so one
// careless admin session cannot self-replicate it from a form.
export const ACCESS_ROLES = [
  {
    value: 'gate_guard',
    label: 'Gate guard',
    rbacRole: 'security_officer',
    duty: 'gate_guard',
    hint: 'Fixed entry post — visitor logging and vehicle checks',
  },
  {
    value: 'roving_patrol',
    label: 'Roving patrol',
    rbacRole: 'security_officer',
    duty: 'roving_patrol',
    hint: 'Perimeter and interior circuit on foot or by vehicle',
  },
  {
    value: 'lead_dispatcher',
    label: 'Lead dispatcher',
    rbacRole: 'security_officer',
    duty: 'lead_dispatcher',
    hint: 'Owns the radio and triages panic alerts to responders',
  },
  {
    // The only option that mints a `security_head`. Dispatcher and Supervisor
    // are separate rows precisely because one is a POST and the other is a
    // RANK: a Lead Dispatcher runs the radio for a shift and holds ordinary
    // officer permissions, while a Supervisor outranks the roster. Folding
    // them together — which is what this list did while Dispatcher was only a
    // duty — meant every dispatcher was silently provisioned as a head.
    value: 'security_supervisor',
    label: 'Security supervisor',
    rbacRole: 'security_head',
    duty: 'supervisor',
    hint: 'Oversees the officer roster; the only role that outranks an officer',
  },
]

export const ACCESS_ROLE_BY_VALUE = Object.fromEntries(ACCESS_ROLES.map((r) => [r.value, r]))

export const ACCESS_ROLE_LABELS = Object.fromEntries(
  ACCESS_ROLES.map((r) => [r.value, r.label]),
)

/**
 * The access role a stored account displays as.
 *
 * Reads `accessRole` when the account was provisioned through this form, and
 * otherwise infers it from the pair the older shape stored — the RBAC role plus
 * the first duty. Accounts predating this form have neither field, so the RBAC
 * role alone decides, and a Security Head with no duty recorded still reads as
 * a Supervisor rather than as a blank cell.
 */
export function resolveAccessRole(account) {
  if (account?.accessRole && ACCESS_ROLE_BY_VALUE[account.accessRole]) {
    return account.accessRole
  }
  const fromDuty = ACCESS_ROLES.find(
    (r) => r.rbacRole === account?.role && account?.duties?.includes(r.duty),
  )
  if (fromDuty) return fromDuty.value
  if (account?.role === 'security_head') return 'security_supervisor'
  if (account?.role === 'security_officer') return 'gate_guard'
  return ''
}

// ── ROSTER ──────────────────────────────────────────────────────────────────
//
// Re-exported, not re-declared. A shift is no longer something assigned here —
// a guard picks one at clock-in — so the list lives in @shared where BOTH
// portals can reach it. Every existing `from '@/lib/securityAccounts'` import
// keeps resolving.
// Imported as well as re-exported: `export … from` creates no local binding,
// so shiftLabel below threw a ReferenceError the first time it ran.
import { SHIFT_BY_VALUE } from '@shared/lib/shiftTypes'
export { SHIFTS, SHIFT_BY_VALUE, shiftForTime } from '@shared/lib/shiftTypes'

export const POSTS = [
  { value: 'main_gate', label: 'Main gate' },
  { value: 'secondary_gate', label: 'Secondary gate' },
  { value: 'clubhouse', label: 'Clubhouse' },
  { value: 'perimeter_patrol', label: 'Perimeter patrol' },
]

export const POST_LABELS = Object.fromEntries(POSTS.map((p) => [p.value, p.label]))

/**
 * A post/shift key as a label, falling back to the RAW KEY rather than to
 * "unassigned".
 *
 * A value this build does not know about is far more likely to be a record
 * written by an earlier vocabulary than a genuinely empty assignment, and
 * those are opposite things to an operator: one needs re-rostering, the other
 * is already correct and merely renamed. Showing `back_gate` is ugly and
 * truthful; showing "Unassigned post" is neither.
 */
export function postLabel(value) {
  // DEFAULT_POST ("Perimeter patrol") is the placeholder every account is
  // created with — no screen picks a post — so it says nothing the role
  // ("Patrol guard") does not, and showing it beside the role read as the post
  // twice (2026-10-19, by request). It stays stored, because the server's
  // assignment validation requires a post; it is simply never displayed.
  if (!value || value === DEFAULT_POST) return ''
  return POST_LABELS[value] ?? value
}

export function shiftLabel(value) {
  if (!value) return ''
  return SHIFT_BY_VALUE[value]?.label ?? value
}

/** The one-line assignment string used in the table and the audit log. */
export function assignmentLabel(account) {
  const post = postLabel(account?.assignedPost)
  const shift = shiftLabel(account?.shift)
  if (!post && !shift) return '—'
  if (!post) return shift
  if (!shift) return post
  return `${post} · ${shift}`
}

// ── TEMPORARY PASSWORDS ─────────────────────────────────────────────────────

// Ambiguous glyphs are excluded from the alphabet, not merely discouraged.
// A temporary password's entire job is to survive being read off one screen
// and typed into another — often from a printed handover slip — and `l`/`I`/`1`
// and `O`/`0` are where that goes wrong. The cost is about 0.4 bits per
// character against a 14-character length; the benefit is that "it says my
// password is wrong" stops being the first thing a new hire reports.
const ALPHABET = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digit: '23456789',
  symbol: '!@#$%^&*?-_=+',
}

const TEMP_PASSWORD_LENGTH = 14

/**
 * One character, uniformly, from the CSPRNG.
 *
 * `crypto.getRandomValues`, never `Math.random`. `Math.random` is not a CSPRNG
 * in any engine — V8 seeds an xorshift128+ whose state is recoverable from a
 * handful of outputs — and a guessable temporary password is a guessable
 * guardhouse account, handed out over a channel (spoken, printed, chat) that
 * already leaks enough.
 *
 * Rejection sampling rather than `% length`: the modulo of a 32-bit value by an
 * alphabet size that does not divide 2^32 biases the first few characters of
 * the alphabet — exactly the sort of defect nobody catches in review and nobody
 * can detect from the output.
 */
function randomIndex(bound) {
  const limit = Math.floor(0x100000000 / bound) * bound
  const buffer = new Uint32Array(1)
  let value
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= limit)
  return value % bound
}

function pick(alphabet) {
  return alphabet[randomIndex(alphabet.length)]
}

/**
 * A temporary password guaranteed to satisfy a mixed-class policy.
 *
 * One character is drawn from each class first, so the result cannot fail a
 * complexity check by chance — a generator that emits an all-lowercase string
 * one time in a few thousand produces a support ticket nobody can reproduce.
 * The remainder is drawn from the union, then the whole string is shuffled with
 * Fisher–Yates on the same CSPRNG so the guaranteed characters do not always
 * sit in positions 0–3. (`sort(() => Math.random() - 0.5)` is both biased and
 * non-uniform and would undo the care above.)
 */
export function generateTempPassword() {
  const pool = ALPHABET.upper + ALPHABET.lower + ALPHABET.digit + ALPHABET.symbol
  const chars = [
    pick(ALPHABET.upper),
    pick(ALPHABET.lower),
    pick(ALPHABET.digit),
    pick(ALPHABET.symbol),
  ]
  while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(pool))

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1)
    const swap = chars[i]
    chars[i] = chars[j]
    chars[j] = swap
  }
  return chars.join('')
}

/**
 * Copies text and reports whether it landed.
 *
 * The `execCommand` fallback is not legacy cruft: `navigator.clipboard` is
 * gated on a secure context, so it is `undefined` on any `http://` origin that
 * is not localhost — which is precisely how this portal is reached on a LAN
 * staging box. Without the fallback, "Copy" on that box fails silently and the
 * admin pastes whatever was in the clipboard before onto the handover slip.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* not permitted here — fall through to the legacy path */
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

// ── VALIDATION ──────────────────────────────────────────────────────────────
//
// Mirrored, not duplicated for its own sake: functions/index.js re-validates
// every one of these server-side and is the enforcement. This copy exists so a
// typo is answered beside the field that caused it instead of by a round trip
// that returns one error at a time.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BADGE_RE = /^[A-Za-z0-9-]{2,16}$/
// Mirrors PHONE_RE in functions/securityProvisioning.js — keep the two in step.
const PHONE_RE = /^\+?[0-9(][0-9 ()-]{6,19}$/

export function validateAccountForm(form, { requireCredentials = true } = {}) {
  const errors = {}

  // Wording note: these are read beside the field that caused them, so they say
  // what to do rather than restating the rule. "A badge number is required" is
  // a schema constraint read aloud; "Enter their badge ID" is an instruction.
  if (!form.fullName?.trim()) errors.fullName = 'Enter the guard’s name.'
  else if (form.fullName.trim().length < 2) errors.fullName = 'Enter their full name.'

  if (!form.email?.trim()) errors.email = 'Enter a login email.'
  else if (!EMAIL_RE.test(form.email.trim())) errors.email = 'That is not a valid email address.'

  if (!form.badgeNumber?.trim()) errors.badgeNumber = 'Enter their badge ID.'
  else if (!BADGE_RE.test(form.badgeNumber.trim())) {
    errors.badgeNumber = 'Letters, numbers and dashes only (2–16 characters).'
  }

  // Official contact number. Required for a NEW account; optional on an edit,
  // because accounts made before the field existed have none and an admin
  // fixing a name should not be blocked on a number they may not have.
  const phone = form.phone?.trim() ?? ''
  if (!phone) {
    if (requireCredentials) errors.phone = 'Enter their contact number.'
  } else if (!PHONE_RE.test(phone)) {
    errors.phone = 'Use 7–20 digits; spaces, +, - and () are allowed.'
  }

  // No role, post or shift checks. The form no longer asks for any of them —
  // every credential is a Security Officer unless the supervisor toggle is on,
  // and the shift is chosen per-shift at clock-in. ProvisionAccountModal still
  // SENDS all three as constants because the callable requires them on create;
  // see the note beside EMPTY_FORM there.

  if (requireCredentials) {
    // The form no longer lets anyone type here — the value is generated on the
    // device — so this can only fire if the generator itself failed. It is kept
    // as the last line of defence rather than deleted with the input, because
    // the server validates the same rule and a silent empty password would be
    // rejected there with a far less legible message.
    const password = form.password ?? ''
    if (!password) errors.password = 'No password was generated. Press “New password”.'
    else if (password.length < 8) errors.password = 'Must be at least 8 characters.'
  }

  return errors
}

// ── DOCUMENT MAPPING ────────────────────────────────────────────────────────

const toDate = (value) => (value?.toDate ? value.toDate() : value ? new Date(value) : null)

/**
 * A `staff_accounts` document as the directory needs it.
 *
 * Every provisioning field is optional and defaulted, because this collection
 * predates the provisioning form: accounts seeded by hand in the Console, or
 * created by the older `createStaffAccount` callable, have a role and a status
 * and nothing else. Those rows must still render — an account that is invisible
 * because it lacks a badge number is an account nobody can revoke.
 */
export function mapSecurityAccount(d) {
  return {
    id: d.id,
    uid: d.id,
    name: d.name || d.fullName || '',
    email: d.email ?? '',
    // The RBAC role — what the portal gates on. `accessRole` below is the job
    // title an operator picked; they are not interchangeable. See ACCESS_ROLES.
    role: d.role ?? '',
    accessRole: d.accessRole ?? '',
    status: normalizeStatus(d.status),
    badgeNumber: d.badgeNumber ?? '',
    phone: d.phone ?? '',
    assignedPost: d.assignedPost ?? '',
    shift: d.shift ?? '',
    duties: Array.isArray(d.duties) ? d.duties : [],
    mustChangePassword: Boolean(d.mustChangePassword),
    onDuty: Boolean(d.onDuty),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
    lastLoginAt: toDate(d.lastLoginAt),
    statusReason: d.statusReason ?? '',
    provisionedByName: d.provisionedByName ?? '',
  }
}

/** The roles this page is responsible for. Admin accounts are not shown here. */
// The RBAC roles, deduplicated — `gate_guard` and `roving_patrol` both mint a
// `security_officer`, so mapping the options straight through would produce a
// list with a repeat in it, and this value feeds a Firestore `in` filter where
// a duplicate is a wasted slot against the 30-value cap.
export const SECURITY_ROLE_VALUES = [...new Set(ACCESS_ROLES.map((r) => r.rbacRole))]

export function isSecurityAccount(account) {
  return SECURITY_ROLE_VALUES.includes(account?.role)
}

// ── PRIVILEGED WRITES ───────────────────────────────────────────────────────

const callCreate = httpsCallable(functions, 'createSecurityAccount')
const callReset = httpsCallable(functions, 'resetSecurityCredential')
const callStatus = httpsCallable(functions, 'setSecurityAccountStatus')
const callAssign = httpsCallable(functions, 'updateSecurityAssignment')
const callDelete = httpsCallable(functions, 'deleteSecurityAccount')

/**
 * Turns an `HttpsError` into a sentence an operator can act on.
 *
 * Two codes are worth naming because neither is about the form. An
 * un-deployed function surfaces as `not-found` or `internal` from the SDK,
 * which an admin will otherwise report as "the Create button is broken";
 * `permission-denied` means the signed-in account is an hoa_admin rather than a
 * super_admin, which is a policy answer, not a fault.
 */
export function describeCallableError(err, action = 'complete that') {
  const code = String(err?.code ?? '').replace(/^functions\//, '')
  if (code === 'permission-denied') {
    return 'Only a Super Admin can provision or modify security accounts.'
  }
  if (code === 'unauthenticated') {
    return 'Your session has expired. Sign in again and retry.'
  }
  if (code === 'already-exists') {
    return err?.message ?? 'That email or badge number is already in use.'
  }
  if (code === 'invalid-argument') {
    return err?.message ?? 'Some details were rejected. Check the form and retry.'
  }
  if (code === 'not-found' || code === 'internal' || code === 'unavailable') {
    /*
     * `err.message` is deliberately NOT preferred here, and that is a fix
     * rather than a style choice.
     *
     * A callable that could not RUN — as opposed to one that ran and threw —
     * comes back with its message set to the bare code, so `err.message` is the
     * string "internal". That is truthy, so `err?.message || '…'` returned
     * "internal" to the administrator and the written sentence below never
     * appeared. A useless-but-truthy SDK string shadowing real copy is the same
     * bug that put "Firebase: Error (auth/missing-password)." on the sign-in
     * screen; it is worth recognising the shape.
     *
     * The wording covers both reasons the function might not run, because from
     * here they are indistinguishable: never deployed, or deployed and unable
     * to start. The second is what a project with billing disabled looks like,
     * and it is the more confusing of the two precisely because the function
     * IS listed in the console.
     */
    const bare = String(err?.message ?? '')
      .trim()
      .toLowerCase()
      .replace(/^functions\//, '')
    const informative = bare && bare !== code ? err.message : ''
    return (
      informative ||
      'Could not reach the provisioning function. It is deployed, but the project ' +
        'cannot start it — Cloud Functions need billing (Blaze) enabled. Until it ' +
        'is, create accounts with scripts/provision-guard.js, which writes exactly ' +
        'what this function would.'
    )
  }
  return err?.message || `Could not ${action}. Please try again.`
}

/**
 * Creates the account and returns the credentials ONCE.
 *
 * The temporary password is in the RESPONSE and nowhere else — never written to
 * Firestore, never logged, and not recoverable after this promise settles. That
 * is why the handoff panel exists and why it cannot be reopened: the only copy
 * is the one on screen, and the alternative (storing it so an admin can look it
 * up later) is a collection of plaintext guardhouse passwords sitting behind
 * whatever the next rules edit does.
 */
export async function createSecurityAccount(input) {
  const { data } = await callCreate(input)
  return data
}

export async function resetSecurityCredential(input) {
  const { data } = await callReset(input)
  return data
}

export async function setSecurityAccountStatus(input) {
  const { data } = await callStatus(input)
  return data
}

export async function updateSecurityAssignment(input) {
  const { data } = await callAssign(input)
  return data
}

/**
 * Removes the directory row and disables the sign-in.
 *
 * ── A CALLABLE, EVEN THOUGH THE CLIENT IS ALLOWED TO DELETE ─────────────────
 * `staff_accounts` is `allow delete: if isAdminStaff()`, so a one-line
 * `deleteDoc` would work — and OnDutyHistoryTable does exactly that today.
 * Routing it through a function buys two things that one line cannot:
 *
 *   1. AN AUDIT ENTRY. `provisioning_logs` is append-only: admins may read and
 *      create, never update or delete. A client-side `deleteDoc` writes no
 *      entry at all — the staff document is the only evidence the account ever
 *      existed, so deleting it destroys the evidence along with the access.
 *      Removal is the single action most worth recording and was the only one
 *      that could not be.
 *   2. THE AUTH SIDE. Deleting the Firestore document ends the account's
 *      AUTHORISATION but not its AUTHENTICATION — the Firebase Auth user
 *      survives, still holding a valid password. The function disables that
 *      user in the same call.
 *
 * The Auth user is DISABLED, never deleted. Its uid is stamped on every
 * `guard_shifts` row and every incident the officer filed; deleting it would
 * turn a signed timesheet into an orphan reference, which is the record an
 * incident response gets judged against.
 */
export async function deleteSecurityAccount(input) {
  const { data } = await callDelete(input)
  return data
}
