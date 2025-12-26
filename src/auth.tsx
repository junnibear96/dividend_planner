import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type SessionUser = {
  id: string
  email: string
}

type AuthState = {
  user: SessionUser | null
  isAuthLoading: boolean
  setUser: (next: SessionUser | null) => void
  reloadMe: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  const reloadMe = useCallback(async () => {
    try {
      setIsAuthLoading(true)
      const res = await fetch('/api/auth/me')
      if (!res.ok) {
        setUser(null)
        return
      }
      const data = (await res.json()) as { user: SessionUser }
      setUser(data.user ?? null)
    } finally {
      setIsAuthLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadMe()
  }, [reloadMe])

  const value = useMemo<AuthState>(
    () => ({ user, isAuthLoading, setUser, reloadMe }),
    [user, isAuthLoading, reloadMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
