import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import HomePage from './pages/HomePage'
import PlannerPage from './pages/PlannerPage'
import ReinvestmentPage from './pages/ReinvestmentPage'
import StockRoutePage from './pages/StockRoutePage'
import WatchlistPage from './pages/WatchlistPage'
import SymbolsPage from './pages/SymbolsPage'
import { HomeRedirect, ProtectedRoute } from './routes'
import TopNav from './TopNav'

export default function App() {
  return (
    <div className="appShell">
      <TopNav />
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/stock" element={<StockRoutePage />} />
        <Route path="/symbols" element={<SymbolsPage />} />
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
