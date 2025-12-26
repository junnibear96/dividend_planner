import { useMemo, useState } from 'react'
import type { SessionUser } from './auth'

type Props = {
  user: SessionUser | null
  onUserChange: (next: SessionUser | null) => void
}

async function jsonOrNull(res: Response) {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

export default function UserAuth({ user, onUserChange }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const canSubmit = useMemo(() => {
    return Boolean(email.trim() && password && !isBusy)
  }, [email, password, isBusy])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'

    try {
      setIsBusy(true)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      })

      if (!res.ok) {
        const body = (await jsonOrNull(res)) as { error?: string } | null
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }

      const body = (await res.json()) as { user: SessionUser }
      onUserChange(body.user)
      setPassword('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setIsBusy(false)
    }
  }

  async function logout() {
    try {
      setIsBusy(true)
      await fetch('/api/auth/logout', { method: 'POST' })
      onUserChange(null)
    } finally {
      setIsBusy(false)
    }
  }

  if (user) {
    return (
      <div className="userBox">
        <div className="userMeta">
          <div className="userLabel">Signed in</div>
          <div className="userEmail">{user.email}</div>
        </div>
        <button type="button" onClick={logout} disabled={isBusy}>
          Log out
        </button>
      </div>
    )
  }

  return (
    <div className="userBox">
      <div className="userMeta">
        <div className="userLabel">Account</div>
        <div className="userTabs" role="tablist" aria-label="Auth mode">
          <button
            type="button"
            className={mode === 'login' ? 'tab active' : 'tab'}
            onClick={() => setMode('login')}
            disabled={isBusy}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'tab active' : 'tab'}
            onClick={() => setMode('register')}
            disabled={isBusy}
          >
            Register
          </button>
        </div>
      </div>

      <form className="userForm" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
          />
        </label>
        <div className="actions">
          <button type="submit" disabled={!canSubmit}>
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </div>
      </form>

      {error ? (
        <p className="error" role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  )
}
