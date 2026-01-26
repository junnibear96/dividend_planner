import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import ReinvestmentTimelineLive from '../features/reinvestment/timeline/ReinvestmentTimelineLive'
import CollectionPlansPanel from '../features/reinvestment/CollectionPlansPanel'

export default function ReinvestmentPage() {
  const { user, setUser } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()

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
            <h1>{t('reinvestment.title')}</h1>
            <p className="subtitle">{t('reinvestment.subtitle')}</p>
          </div>

          <div className="headerRight">
            <div className="userBox">
              <div className="userMeta">
                <div>
                  <div className="userLabel">{t('auth.signedIn')}</div>
                  <div className="userEmail">{user?.email}</div>
                </div>
                <div className="actionsRow">
                  <button type="button" onClick={() => navigate('/planner')}>
                    {t('common.backToPlanner')}
                  </button>
                  <button type="button" onClick={logout}>
                    {t('auth.logout')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <ReinvestmentTimelineLive />

        <CollectionPlansPanel />
      </div>
    </div>
  )
}
