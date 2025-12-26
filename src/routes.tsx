import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './auth'

export function ProtectedRoute() {
  const { user, isAuthLoading } = useAuth()

  if (isAuthLoading) {
    return (
      <div className="page">
        <div className="pageInner">
          <p className="empty">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

export function HomeRedirect() {
  const { user, isAuthLoading } = useAuth()
  if (isAuthLoading) return null
  return <Navigate to={user ? '/planner' : '/login'} replace />
}
