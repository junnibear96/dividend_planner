import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import PlannerPage from './pages/PlannerPage'
import ReinvestmentPage from './pages/ReinvestmentPage'
import StockPage from './pages/StockPage'
import WatchlistPage from './pages/WatchlistPage'
import { HomeRedirect, ProtectedRoute } from './routes'
import TopNav from './TopNav'

export default function App() {
  return (
    <div className="appShell">
      <TopNav />
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/reinvest" element={<ReinvestmentPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
