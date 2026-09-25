import { Component } from 'react'

/**
 * Catches render-time crashes below it.
 *
 * TWO SCOPES, ONE CLASS. At the app root (App.jsx) this replaces the entire
 * document, which is right for a crash that took the router with it. Wrapped
 * around a single page's content it must NOT do that — the shell, sidebar and
 * top bar are still perfectly alive, and blanking them strands the user with no
 * navigation on a phone, where the sidebar is the only way out of the page.
 *
 * So the default `h-screen` fallback is the root's, and a page passes its own
 * via `fallback` to render inside the shell instead. `reset` clears the caught
 * error and re-renders the children, which recovers the common case where the
 * crash came from one bad document in a live snapshot rather than from the page
 * itself.
 *
 * @param {(ctx: {error: Error, reset: () => void}) => React.ReactNode} [fallback]
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset })
    }

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-base-950 px-4 text-center text-text-primary">
        <p className="text-lg font-semibold">Something went wrong.</p>
        <p className="max-w-md text-sm text-text-secondary">{error.message}</p>
      </div>
    )
  }
}
