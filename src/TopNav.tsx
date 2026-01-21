import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from './auth'
import { useTranslation } from 'react-i18next'

function tabClassName(isActive: boolean) {
  return isActive ? 'navTab navTabActive' : 'navTab'
}

export default function TopNav() {
  const { user, isAuthLoading, setUser } = useAuth()
  const navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const { t, i18n } = useTranslation()

  async function logout() {
    try {
      setIsLoggingOut(true)
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      setUser(null)
      setIsLoggingOut(false)
      navigate('/login', { replace: true })
    }
  }



  return (
    <header className="topNav" role="banner">
      <div className="topNavInner">
        <Link to={user ? "/home" : "/"} className="homeButton" aria-label="Home">
          {t('nav.home')}
        </Link>

        <nav className="navTabs" aria-label="Pages">
          <NavLink to="/stock" className={({ isActive }) => tabClassName(isActive)}>
            {t('nav.stock')}
          </NavLink>

          <NavLink to="/symbols" className={({ isActive }) => tabClassName(isActive)}>
            {t('nav.symbols')}
          </NavLink>

          {isAuthLoading ? null : user ? (
            <>
              <NavLink to="/watchlist" className={({ isActive }) => tabClassName(isActive)}>
                {t('nav.watchlist')}
              </NavLink>
              <NavLink
                to="/planner"
                className={({ isActive }) => tabClassName(isActive)}
              >
                {t('nav.planner')}
              </NavLink>
              <NavLink
                to="/reinvest"
                className={({ isActive }) => tabClassName(isActive)}
              >
                {t('nav.reinvest')}
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="topNavRight">
          <div className="userTabs" style={{ marginRight: '0.5rem' }}>
            <button
              type="button"
              className={`tab ${!i18n.language.startsWith('ko') ? 'active' : ''}`}
              onClick={() => void i18n.changeLanguage('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={`tab ${i18n.language.startsWith('ko') ? 'active' : ''}`}
              onClick={() => void i18n.changeLanguage('ko')}
            >
              KO
            </button>
          </div>

          {isAuthLoading ? null : user ? (
            <button
              type="button"
              className="navTab"
              onClick={() => {
                void logout()
              }}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? '...' : t('nav.logout')}
            </button>
          ) : (
            <NavLink to="/login" className={({ isActive }) => tabClassName(isActive)}>
              {t('nav.login')}
            </NavLink>
          )}
        </div>
      </div>
    </header>
  )
}
