import BrandMark from '@shared/components/BrandMark'
import DirectDownloadCard from '@shared/components/DirectDownloadCard'

/**
 * The public /download page in both portals: the Android app for residents
 * and staff, no sign-in needed. Mounted outside RequireAuth in AppRoutes.
 */
export default function DownloadAppPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-base-950 px-4 py-10">
      <div className="flex items-center gap-2.5">
        <BrandMark className="h-6 w-auto text-brand-logo" />
        <span className="text-base font-semibold tracking-tight text-text-primary">Monticello Villas</span>
      </div>
      <DirectDownloadCard />
      <a href="/login" className="text-sm text-text-muted underline-offset-4 hover:text-text-primary hover:underline">
        Staff sign-in
      </a>
    </main>
  )
}
