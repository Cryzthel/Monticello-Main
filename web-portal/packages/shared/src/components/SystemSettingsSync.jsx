import { useEffect } from 'react'
import { useAuth } from '@shared/auth/AuthContext'
import { watchSettings } from '@shared/lib/systemSettings'
import { resetSettings } from '@shared/lib/systemSettingsStore'

/**
 * Keeps the organisation's notification preferences live for the whole app.
 * Renders nothing.
 *
 * Mounted once per app, inside AuthProvider (the settings document is staff
 * only, so it is subscribed only while this app holds a session) and above the
 * routes (so no navigation can unmount it). Signing out drops back to the
 * defaults so nothing from the last session lingers.
 */
export default function SystemSettingsSync() {
  const { isAuthenticated } = useAuth()

  useEffect(() => {
    if (!isAuthenticated) {
      resetSettings()
      return undefined
    }
    return watchSettings()
  }, [isAuthenticated])

  return null
}
