import { Mail } from 'lucide-react'

import LoginSplitLayout from '@shared/auth/LoginSplitLayout'
import LoginHeroAnimation from '@shared/auth/LoginHeroAnimation'
import LoginForm from '@shared/auth/LoginForm'
import { ROUTES } from '@/config/portal'

/**
 * Admin sign-in. Still pure config — the shell, the hero and the form are all
 * shared components, and the only things this file decides are the strings,
 * the illustration and where a successful sign-in lands.
 *
 * It shares a shell with the guardhouse again. The two diverged for one
 * release, while only this console had been asked for the split layout; the
 * guardhouse now renders the same `LoginSplitLayout` with its own illustration
 * and strings, so the screens are identical in geometry, type and spacing once
 * more. The only visual difference left is the `accent`, which reaches two
 * small controls — see the guardhouse's copy of this file.
 */

/**
 * "Man with task list" by Boltbite, from LottieFiles — free under the Lottie
 * Simple License (commercial use, no attribution required).
 *
 * IT REPLACED A WATERMARKED FILE. The previous hero was an IconScout MP4 whose
 * free preview carried the author's watermark burned into its pixels, which is
 * not something markup can hide and not something to mask out of an unlicensed
 * asset. Swapping to a genuinely free animation was the fix; see
 * LoginHeroAnimation for what that let the layout drop.
 *
 * Served from `public/` rather than imported so it stays a separate cacheable
 * file that can be swapped by overwriting — which is exactly what happened
 * here, and will happen again the next time the illustration changes. The hero
 * column is not rendered below `lg`, so phones never request it at all.
 *
 * REPLACE THIS FILE, NOT THIS CODE, to change the illustration.
 */
const HERO_ANIMATION = '/auth/login-hero.json'

/**
 * Measured over a full loop of this asset — see LoginHeroAnimation for what
 * these mean, why they are written down rather than read at runtime, and the
 * console snippet that re-derives them when the illustration changes.
 */
const HERO_FIT = { fillX: 0.8085, offsetXPct: -6.56, offsetYPct: -2.21 }

export default function LoginPage() {
  return (
    <LoginSplitLayout
      title="Welcome back, Admin"
      description="Enter your administrative credentials to access the management suite."
      illustration={<LoginHeroAnimation src={HERO_ANIMATION} fit={HERO_FIT} />}
    >
      <LoginForm
        variant="elevated"
        accent="brand"
        emailIcon={Mail}
        emailPlaceholder="monticellovillas@gmail.com"
        submitLabel="Sign in"
        fallbackPath={ROUTES.home}
      />
    </LoginSplitLayout>
  )
}
