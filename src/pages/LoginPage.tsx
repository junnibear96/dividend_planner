import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import UserAuth from '../UserAuth'
import { useAuth } from '../auth'

export default function LoginPage() {
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
        <h1 className="loginTitle">Sign in</h1>
        <p className="loginSubtitle">to Dividend Planner</p>
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
