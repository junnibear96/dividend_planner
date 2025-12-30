import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import ReinvestmentPanel from '../features/reinvestment/ReinvestmentPanel'
import WeekTabs, { type WeekIndex } from '../features/reinvestment/WeekTabs'
import type { ScheduleMode } from '../features/reinvestment/reinvestmentApi'
import ReinvestmentTimelineLive from '../features/reinvestment/timeline/ReinvestmentTimelineLive'

export default function ReinvestmentPage() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()

  const [activeWeek, setActiveWeek] = useState<WeekIndex>(1)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('FIXED')

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    navigate('/login', { replace: true })
  }

  return (
    <div className="page">
      <div className="pageInner">
        <header className="header">
          <div>
            <h1>Reinvestment</h1>
            <p className="subtitle">Plan Week 1–4 reinvestment rules and review history.</p>
          </div>

          <div className="headerRight">
            <div className="userBox">
              <div className="userMeta">
                <div>
                  <div className="userLabel">Signed in</div>
                  <div className="userEmail">{user?.email}</div>
                </div>
                <div className="actionsRow">
                  <button type="button" onClick={() => navigate('/planner')}>
                    Back to Planner
                  </button>
                  <button type="button" onClick={logout}>
                    Log out
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {scheduleMode === 'WEEK_OF_MONTH' ? (
          <div className="modalTabs">
            <WeekTabs value={activeWeek} onChange={setActiveWeek} />
          </div>
        ) : null}

        <ReinvestmentPanel
          activeWeek={activeWeek}
          onActiveWeekChange={setActiveWeek}
          onScheduleModeChange={setScheduleMode}
        />

        <ReinvestmentTimelineLive />
      </div>
    </div>
  )
}
