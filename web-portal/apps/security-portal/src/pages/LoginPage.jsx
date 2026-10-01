import { Mail } from '@shared/icons'

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
 * NOTHING VISUAL DIFFERS ANY MORE. The accent used to: this console painted
 * the recovery link and the Remember-me tick sky blue while admin painted them
 * emerald. Two screens identical in every other dimension, disagreeing on one
 * link, read as an oversight rather than as a signal — and the heading already
 * says which console you are on. Both are emerald now, and the prop that
 * expressed the difference is deleted rather than defaulted.
 *
 * What is left that differs: the strings and the illustration.
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

/**
 * Measured over a full loop of this asset — see LoginHeroAnimation for what
 * these mean, why they are written down rather than read at runtime, and the
 * console snippet that re-derives them when the illustration changes.
 */
const HERO_FIT = { fillX: 0.9254, offsetXPct: -0.2, offsetYPct: 0.54 }

/**
 * The hero, as its own export so the reset-password route can show the same
 * illustration without repeating the asset path and its measured `fit`.
 */
export function LoginHero() {
  return <LoginHeroAnimation src={HERO_ANIMATION} fit={HERO_FIT} />
}

export default function LoginPage() {
  return (
    <LoginSplitLayout
      title="Welcome back, Guard"
      description="Enter your guardhouse credentials to access the security console."
      illustration={<LoginHero />}
    >
      <LoginForm
        emailIcon={Mail}
        emailPlaceholder="guard.test@monticellovillas.ph"
        submitLabel="Sign in"
        fallbackPath={ROUTES.home}
      />
    </LoginSplitLayout>
  )
}
