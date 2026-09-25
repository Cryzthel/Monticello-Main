import LoginLayout from '@shared/auth/LoginLayout'
import LoginForm from '@shared/auth/LoginForm'
import { ROUTES } from '@/config/portal'

/**
 * Admin sign-in. Pure config: the shell and the form are shared, and the only
 * things this file decides are the card's title, the accent, the placeholder
 * and where a successful sign-in lands.
 *
 * Its guardhouse counterpart is deliberately the same shape with four
 * different strings — that is what keeps the two screens identical in
 * geometry when only one of them gets touched.
 */
export default function LoginPage() {
  return (
    <LoginLayout variant="admin" title="Admin login">
      <LoginForm
        accent="brand"
        emailPlaceholder="monticellovillas@gmail.com"
        submitLabel="Login"
        fallbackPath={ROUTES.home}
      />
    </LoginLayout>
  )
}
