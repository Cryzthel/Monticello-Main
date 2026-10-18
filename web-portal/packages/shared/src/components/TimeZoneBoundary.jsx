import { Fragment } from 'react'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'

/**
 * Re-renders everything inside it in the organisation's time zone.
 *
 * The formatters in shared/lib/dates.js are module-level and switched by
 * commitSettings, but a component only re-formats when it re-renders, and most
 * of them have no reason to. Keying the subtree on the zone remounts it once,
 * when an administrator changes the setting, so every timestamp on screen —
 * tables, drawers, the notification feed — is redrawn in the new zone at the
 * same moment. That is a rare, deliberate event; a remount is the price of not
 * threading the zone through every call to formatDateTime.
 */
export default function TimeZoneBoundary({ children }) {
  const zone = useSystemSettings((state) => state.values.organisation?.timeZone)
  return <Fragment key={zone}>{children}</Fragment>
}
