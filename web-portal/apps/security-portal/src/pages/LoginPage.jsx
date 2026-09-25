import LoginLayout from '@shared/auth/LoginLayout'
import LoginForm from '@shared/auth/LoginForm'
import { ROUTES } from '@/config/portal'

/**
 * Guardhouse sign-in. The admin counterpart with four strings changed — see
 * apps/admin-portal/src/pages/LoginPage.jsx. Same card, same geometry; the
 * `info` accent is the only visual difference, and it is confined to the
 * header bloom, the header rule and the two small controls above the CTA.
 */
export default function LoginPage() {
  return (
    <LoginLayout variant="security" title="Security login">
      <LoginForm
        accent="info"
        emailPlaceholder="guard.test@monticellovillas.ph"
        submitLabel="Login"
        fallbackPath={ROUTES.home}
      />
    </LoginLayout>
  )
}
