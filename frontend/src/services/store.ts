import { create } from 'zustand'
import type { Me } from '../types'
import { api, setToken, setUnauthorizedHandler } from './api'

const KEY = 'bv.session'
const PROFILE_KEY = 'bv.currentProfile'
const EMAIL_KEY = 'bv.rememberEmail'

function readLS<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null } catch { return null }
}
function writeLS(k: string, v: unknown) {
  try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { /* modo privado */ }
}

interface Session { token: string; user: Me; exp: number }

interface AuthState {
  user: Me | null
  ready: boolean
  login: (email: string, password: string, remember: boolean) => Promise<void>
  logout: (silent?: boolean) => void
  restore: () => Promise<void>
  can: (perm: string) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  async login(email, password, remember) {
    const r = await api<{ access_token: string; expires_in: number; user: Me }>('/auth/login', { body: { email, password } })
    setToken(r.access_token)
    writeLS(KEY, { token: r.access_token, user: r.user, exp: Date.now() + r.expires_in * 1000 } satisfies Session)
    writeLS(EMAIL_KEY, remember ? email : null)
    set({ user: r.user, ready: true })
  },
  logout(silent = false) {
    if (!silent) api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    setToken(null)
    writeLS(KEY, null)
    set({ user: null, ready: true })
  },
  async restore() {
    const s = readLS<Session>(KEY)
    if (!s || s.exp < Date.now()) { writeLS(KEY, null); set({ ready: true }); return }
    setToken(s.token)
    try {
      const me = await api<Me>('/users/me')
      writeLS(KEY, { ...s, user: me })
      set({ user: me, ready: true })
    } catch {
      setToken(null)
      writeLS(KEY, null)
      set({ user: null, ready: true })
    }
  },
  can(perm) { return !!get().user?.permissions.includes(perm) },
}))

setUnauthorizedHandler(() => {
  if (useAuth.getState().user) {
    useAuth.getState().logout(true)
    toast('La sesión expiró. Vuelve a iniciar sesión.', 'error')
  }
})

export const rememberedEmail = () => readLS<string>(EMAIL_KEY) || ''

// ---------------------------------------------------------------- expediente activo
interface CurrentProfile { id: string; code: string; name: string; sex: 'M' | 'F' }
interface ProfileState { current: CurrentProfile | null; setCurrent: (p: CurrentProfile | null) => void }
export const useCurrentProfile = create<ProfileState>((set) => ({
  current: readLS<CurrentProfile>(PROFILE_KEY),
  setCurrent(p) { writeLS(PROFILE_KEY, p); set({ current: p }) },
}))

// ---------------------------------------------------------------- toasts
export interface Toast { id: number; text: string; kind: 'info' | 'success' | 'error' }
interface ToastState { items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }
let tid = 0
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push(t) {
    const id = ++tid
    set({ items: [...get().items.slice(-3), { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 6500 : 4000)
  },
  dismiss(id) { set({ items: get().items.filter((x) => x.id !== id) }) },
}))
export function toast(text: string, kind: Toast['kind'] = 'info') { useToasts.getState().push({ text, kind }) }
