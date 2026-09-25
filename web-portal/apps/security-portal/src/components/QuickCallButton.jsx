import { useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { Phone, PhoneOff, Loader2 } from 'lucide-react'
import { db } from '@shared/lib/firebase'

// Looks up users/{reporterUid}.phone on demand (not prefetched for every
// visible row — most triage sessions never call most reporters) and hands
// off to the OS dialer via tel:. No phone on file is a real, expected state
// for older reports, not an error.
export default function QuickCallButton({ reporterUid }) {
  const [state, setState] = useState('idle') // idle | loading | unavailable

  async function handleClick(event) {
    event.stopPropagation()
    if (!reporterUid || state === 'loading') return

    setState('loading')
    try {
      const snap = await getDoc(doc(db, 'users', reporterUid))
      const phone = snap.exists() ? snap.data()?.phone : null
      if (phone) {
        window.location.href = `tel:${phone}`
        setState('idle')
      } else {
        setState('unavailable')
      }
    } catch (err) {
      console.error('Failed to look up resident phone', err)
      setState('unavailable')
    }
  }

  if (!reporterUid) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      title={state === 'unavailable' ? 'No phone number on file' : 'Call resident'}
      className={`btn btn-icon-md border ${
        state === 'unavailable'
          ? 'border-tint/5 text-text-muted'
          : 'border-tint/10 bg-tint/[0.03] text-brand-400 hover:bg-tint/10'
      }`}
    >
      {state === 'loading' ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === 'unavailable' ? (
        <PhoneOff className="h-4 w-4" />
      ) : (
        <Phone className="h-4 w-4" />
      )}
    </button>
  )
}
