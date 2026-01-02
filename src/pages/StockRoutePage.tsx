import { useAuth } from '../auth'
import PublicStockPage from './PublicStockPage'
import StockPage from './StockPage'

export default function StockRoutePage() {
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

  // Separate pages:
  // - Logged out: PublicStockPage (chart + top 5 recommendations)
  // - Logged in: StockPage (full stock page + watchlist landing)
  return user ? <StockPage /> : <PublicStockPage />
}
