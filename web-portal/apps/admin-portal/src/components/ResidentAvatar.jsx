// Falls back to initials when a resident hasn't set a photo — the mobile
// profile screen leaves photoUrl empty by default, so that's the common case
// rather than an edge case.
export default function ResidentAvatar({ name, photoUrl, size = 'md' }) {
  const dimension = size === 'lg' ? 'h-16 w-16 text-lg' : 'h-9 w-9 text-xs'
  const initial = (name || '?').trim().charAt(0).toUpperCase()

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={`${dimension} shrink-0 rounded-full border border-tint/10 object-cover`}
      />
    )
  }

  return (
    <div
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full border border-tint/10 bg-brand-100 font-semibold text-brand-400`}
    >
      {initial}
    </div>
  )
}
