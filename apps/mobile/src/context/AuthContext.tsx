import React, { createContext, useContext, useState } from 'react'

interface AuthUser {
  name: string
  email: string
  role: 'admin' | 'operator' | 'viewer'
}

interface AuthContextValue {
  user: AuthUser | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)

  const login = async (email: string, password: string): Promise<boolean> => {
    if (email === 'admin@tafdil.cm' && password === 'forge2024') {
      setUser({ name: 'Responsable TAFDIL', email, role: 'admin' })
      return true
    }
    return false
  }

  const logout = () => setUser(null)

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
