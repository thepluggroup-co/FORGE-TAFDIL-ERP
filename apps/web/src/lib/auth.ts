import { supabase } from './supabase'

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { session: data.session, user: data.user, error: error?.message ?? null }
}

export async function signOut() {
  await supabase.auth.signOut()
  window.location.href = '/login'
}

export { useAuth } from '@/context/AuthContext'
