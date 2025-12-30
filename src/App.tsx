import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import PlannerPage from './pages/PlannerPage'
import ReinvestmentPage from './pages/ReinvestmentPage'
import StockPage from './pages/StockPage'
import { HomeRedirect, ProtectedRoute } from './routes'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/stock" element={<StockPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/reinvest" element={<ReinvestmentPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
