import { Mail } from 'lucide-react'

import LoginSplitLayout from '@shared/auth/LoginSplitLayout'
import LoginHeroAnimation from '@shared/auth/LoginHeroAnimation'
import LoginForm from '@shared/auth/LoginForm'
import { ROUTES } from '@/config/portal'

/**
 * Guardhouse sign-in. The admin counterpart with three strings and one asset
 * changed — see apps/admin-portal/src/pages/LoginPage.jsx.
 *
 * The two screens share a shell again. They diverged for one release, while
 * only the admin console had been asked for the split layout and the guardhouse
 * still rendered the old single centred card; `LoginSplitLayout` was written
 * portal-agnostic against exactly this moment, so adopting it here was a matter
 * of importing it and handing it a different illustration. The card component
 * it replaced (`LoginLayout`) had no other caller and is gone.
 *
 * WHAT IS STILL DIFFERENT, AND DELIBERATELY SO: `accent="info"`. It reaches two
 * marks — the Remember-me checkbox and the Forgot-password link — and it is the
 * one visual cue that tells an operator which console they are looking at
 * before they read a word. Geometry, type, spacing, focus treatment and the CTA
 * are byte-identical to admin's, which is the point of the shared shell.
 */

/**
 * "Female Employee Working on Data Security" by Abdul Latif, from LottieFiles —
 * free under the Lottie Simple License (commercial use, no attribution
 * required). 994x736, pure vector: no expressions, 3D layers, text layers,
 * effects or image assets, which is what keeps `LottieLight` — the smallest of
 * the library's three engines — the correct player for it.
 *
 * It is LANDSCAPE where admin's hero is square, and nothing needed changing for
 * that: `LoginHeroAnimation` reads the aspect ratio off the animation's own
 * `w`/`h` rather than carrying a hardcoded shape.
 *
 * Served from `public/` rather than imported so it stays a separate cacheable
 * file that swaps by being overwritten. The hero pane is not rendered below
 * `lg`, so phones never request it at all.
 *
 * REPLACE THIS FILE, NOT THIS CODE, to change the illustration.
 */
const HERO_ANIMATION = '/auth/login-hero.json'

export default function LoginPage() {
  return (
    <LoginSplitLayout
      title="Welcome back, Guard"
      description="Enter your guardhouse credentials to access the security console."
      illustration={<LoginHeroAnimation src={HERO_ANIMATION} />}
    >
      <LoginForm
        variant="elevated"
        accent="info"
        emailIcon={Mail}
        emailPlaceholder="guard.test@monticellovillas.ph"
        submitLabel="Sign in"
        fallbackPath={ROUTES.home}
      />
    </LoginSplitLayout>
  )
}
