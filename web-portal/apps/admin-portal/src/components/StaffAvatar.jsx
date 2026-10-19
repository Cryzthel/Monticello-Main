import ResidentAvatar from '@/components/ResidentAvatar'
import { useStaffAvatar } from '@shared/lib/staffAvatar'

/**
 * A staff member's photo, live from `users/{uid}.photoUrl` — the field a guard
 * sets in Guardhouse › Settings (lib/staffAvatar). A new photo replaces the
 * initial in the Security Accounts directory the moment it is saved, with no
 * refresh (2026-10-19, by request). Initials until there is one.
 */
export default function StaffAvatar({ uid, name, size = 'md' }) {
  const photoUrl = useStaffAvatar(uid ?? null)
  return <ResidentAvatar name={name} photoUrl={photoUrl} size={size} />
}
