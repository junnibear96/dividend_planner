import { useNavigate, Link } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import UserAuth from '../UserAuth'
import { useAuth } from '../auth'

export default function LoginPage() {
  const { t } = useTranslation()
  const { user, isAuthLoading, setUser } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthLoading && user) {
      navigate('/home', { replace: true })
    }
  }, [isAuthLoading, user, navigate])

  return (
    <div className="page loginPageCentered">
      <div className="loginCardSimplified">
        <h1 className="loginTitle">{t('auth.signInTitle')}</h1>
        <p className="loginSubtitle">{t('auth.toApp')}</p>
        <UserAuth
          user={user}
          fixedMode="login"
          hideTabs
          onUserChange={(next) => {
            setUser(next)
            if (next) navigate('/home', { replace: true })
          }}
        />

        <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f8f9fa', borderRadius: '8px', fontSize: '0.85rem', color: '#495057', border: '1px solid #e9ecef' }}>
          <p style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#212529' }}>{t('auth.demoAccount')}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', alignItems: 'center' }}>
            <span>Email</span>
            <code style={{ background: '#fff', border: '1px solid #dee2e6', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }} onClick={() => { navigator.clipboard.writeText('test@gmail.com') }} title="Click to copy">test@gmail.com</code>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Password</span>
            <code style={{ background: '#fff', border: '1px solid #dee2e6', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }} onClick={() => { navigator.clipboard.writeText('password123') }} title="Click to copy">password123</code>
          </div>
        </div>
        <p style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.9rem' }}>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="linkButton">
            {t('auth.registerHere')}
          </Link>
        </p>
      </div>
    </div>
  )
}
