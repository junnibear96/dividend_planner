import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionUser } from './auth'

type AuthMode = 'login' | 'register'

type Props = {
  user: SessionUser | null
  onUserChange: (next: SessionUser | null) => void
  fixedMode?: AuthMode
  hideTabs?: boolean
}

async function jsonOrNull(res: Response) {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

export default function UserAuth({ user, onUserChange, fixedMode, hideTabs }: Props) {
  const { t } = useTranslation()
  const [modeInternal, setModeInternal] = useState<AuthMode>('login')
  const mode: AuthMode = fixedMode ?? modeInternal
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
        throw new Error(body?.error ?? `${t('auth.requestFailed')} (${res.status})`)
      }

      const body = (await res.json()) as { user: SessionUser }
      onUserChange(body.user)
      setPassword('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.requestFailed'))
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
          <div className="userLabel">{t('auth.signedIn')}</div>
          <div className="userEmail">{user.email}</div>
        </div>
        <button type="button" onClick={logout} disabled={isBusy}>
          {t('auth.logout')}
        </button>
      </div>
    )
  }

  return (
    <div className="userBox">
      <div className="userMeta">
        {!fixedMode && !hideTabs ? <div className="userLabel">{t('auth.account')}</div> : null}
        {!hideTabs && !fixedMode ? (
          <div className="userTabs" role="tablist" aria-label="Auth mode">
            <button
              type="button"
              className={mode === 'login' ? 'tab active' : 'tab'}
              onClick={() => setModeInternal('login')}
              disabled={isBusy}
            >
              {t('auth.login')}
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'tab active' : 'tab'}
              onClick={() => setModeInternal('register')}
              disabled={isBusy}
            >
              {t('auth.register')}
            </button>
          </div>
        ) : null}
      </div>

      <form className="userForm" onSubmit={submit}>
        <label className="field">
          <span>{t('auth.email')}</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPlaceholder')}
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'login' ? t('auth.passwordPlaceholderLogin') : t('auth.passwordPlaceholderRegister')}
          />
        </label>
        <div className="actions">
          <button type="submit" disabled={!canSubmit}>
            {mode === 'login' ? t('auth.login') : t('auth.createAccount')}
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
