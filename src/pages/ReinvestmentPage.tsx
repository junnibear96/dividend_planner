import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import ReinvestmentTimelineLive from '../features/reinvestment/timeline/ReinvestmentTimelineLive'
import CollectionPlansPanel from '../features/reinvestment/CollectionPlansPanel'

import FutureProjection from '../features/reinvestment/future/FutureProjection'
import { useState } from 'react'

export default function ReinvestmentPage() {
  const { user, setUser } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'timeline' | 'future'>('timeline')

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

        {/* Tab Navigation */}
        <div className="tabs" style={{ display: 'flex', gap: '2rem', borderBottom: '1px solid var(--border-color)', marginBottom: '2rem' }}>
          <button
            onClick={() => setActiveTab('timeline')}
            style={{
              padding: '1rem 0',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'timeline' ? '2px solid var(--primary-color)' : '2px solid transparent',
              color: activeTab === 'timeline' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: activeTab === 'timeline' ? 600 : 400,
              cursor: 'pointer',
              fontSize: '1.1rem'
            }}
          >
            {t('reinvestment.tabs.timeline')}
          </button>
          <button
            onClick={() => setActiveTab('future')}
            style={{
              padding: '1rem 0',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'future' ? '2px solid var(--primary-color)' : '2px solid transparent',
              color: activeTab === 'future' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: activeTab === 'future' ? 600 : 400,
              cursor: 'pointer',
              fontSize: '1.1rem'
            }}
          >
            {t('reinvestment.tabs.future')}
          </button>
        </div>

        {activeTab === 'timeline' ? (
          <>
            <ReinvestmentTimelineLive />
            <CollectionPlansPanel />
          </>
        ) : (
          <FutureProjection />
        )}
      </div>
    </div>
  )
}
