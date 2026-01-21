import { useNavigate } from 'react-router-dom'
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
      </div>
    </div>
  )
}
