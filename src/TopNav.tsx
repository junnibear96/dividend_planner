import { Link, NavLink } from 'react-router-dom'
import { useAuth } from './auth'

function tabClassName(isActive: boolean) {
  return isActive ? 'navTab navTabActive' : 'navTab'
}

export default function TopNav() {
  const { user, isAuthLoading } = useAuth()

  return (
    <header className="topNav" role="banner">
      <div className="topNavInner">
        <Link to="/" className="homeButton" aria-label="Home">
          홈
        </Link>

        <nav className="navTabs" aria-label="Pages">
          <NavLink to="/stock" className={({ isActive }) => tabClassName(isActive)}>
            Stock
          </NavLink>

          {isAuthLoading ? null : user ? (
            <>
              <NavLink to="/home" className={({ isActive }) => tabClassName(isActive)}>
                Home
              </NavLink>
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
          ) : (
            <NavLink to="/login" className={({ isActive }) => tabClassName(isActive)}>
              Login
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  )
}
