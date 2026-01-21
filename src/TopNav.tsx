import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from './auth'

function tabClassName(isActive: boolean) {
  return isActive ? 'navTab navTabActive' : 'navTab'
}

export default function TopNav() {
  const { user, isAuthLoading, setUser } = useAuth()
  const navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

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
          홈
        </Link>

        <nav className="navTabs" aria-label="Pages">
          <NavLink to="/stock" className={({ isActive }) => tabClassName(isActive)}>
            Stock
          </NavLink>

          <NavLink to="/symbols" className={({ isActive }) => tabClassName(isActive)}>
            Symbols
          </NavLink>

          {isAuthLoading ? null : user ? (
            <>
              <NavLink to="/watchlist" className={({ isActive }) => tabClassName(isActive)}>
                Watchlist
              </NavLink>
              <NavLink
                to="/planner"
                className={({ isActive }) => tabClassName(isActive)}
              >
                Planner
              </NavLink>
              <NavLink
                to="/reinvest"
                className={({ isActive }) => tabClassName(isActive)}
              >
                Reinvest
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="topNavRight">
          {isAuthLoading ? null : user ? (
            <button
              type="button"
              className="navTab"
              onClick={() => {
                void logout()
              }}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? 'Logging out…' : 'Logout'}
            </button>
          ) : (
            <NavLink to="/login" className={({ isActive }) => tabClassName(isActive)}>
              Login
            </NavLink>
          )}
        </div>
      </div>
    </header>
  )
}
