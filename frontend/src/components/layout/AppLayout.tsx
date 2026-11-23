import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, Box, Camera, ChevronDown, FileText, FolderOpen, LayoutDashboard, LogOut, Menu, Ruler, Settings, Sparkles, UserRound,
} from 'lucide-react'
import { Brand } from '../Logo'
import { useAuth, useCurrentProfile } from '../../services/store'
import { ROLE_LABEL } from '../../utils/format'

interface NavItem { to: string; label: string; icon: ReactNode; perm?: string; needsProfile?: string }

export function AppLayout() {
  const { user, logout, can } = useAuth()
  const current = useCurrentProfile((s) => s.current)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  useEffect(() => { setMobileOpen(false); setMenu(false) }, [loc.pathname])

  const pid = current?.id
  const withProfile = (base: string, target: string) => (pid ? `${base}/${pid}` : `/select/${target}`)
  const items: (NavItem | string)[] = [
    'General',
    { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/profiles', label: 'Expedientes', icon: <FolderOpen size={18} /> },
    { to: pid ? `/profiles/${pid}?tab=measurements` : '/select/measurements', label: 'Mediciones', icon: <Ruler size={18} />, needsProfile: 'measurements' },
    'Análisis',
    { to: withProfile('/capture', 'capture'), label: 'Captura Corporal', icon: <Camera size={18} />, perm: 'media:upload', needsProfile: 'capture' },
    { to: '/analyses', label: 'Análisis IA', icon: <Activity size={18} /> },
    ...(user?.role === 'specialist' || user?.role === 'admin' ? [{ to: '/reviews', label: 'Revisión profesional', icon: <Activity size={18} /> }] : []),
    { to: pid ? `/viewer/${pid}` : '/viewer', label: 'Visor 3D', icon: <Box size={18} /> },
    { to: withProfile('/analytics', 'analytics'), label: 'Analítica', icon: <BarChart3 size={18} />, needsProfile: 'analytics' },
    { to: withProfile('/simulations', 'simulations'), label: 'Simulador', icon: <Sparkles size={18} />, needsProfile: 'simulations' },
    { to: '/reports', label: 'Reportes', icon: <FileText size={18} />, perm: 'reports:read' },
    'Sistema',
    { to: '/admin', label: 'Administración', icon: <Settings size={18} />, perm: 'users:manage' },
  ]
  const isActive = (to: string) => {
    const path = to.split('?')[0]
    const seg = path.split('/')[1]
    const cur = loc.pathname.split('/')[1]
    if (to.includes('tab=measurements')) return loc.pathname.startsWith('/profiles/') && loc.search.includes('tab=measurements')
    if (seg === 'select') return cur === 'select' && loc.pathname.endsWith(path.split('/')[2])
    if (seg === 'profiles') return cur === 'profiles' && !loc.search.includes('tab=measurements')
    if (seg === 'analyses') return cur === 'analyses'
    return seg === cur
  }
  const full = /^\/viewer/.test(loc.pathname)
  const title = items.find((i): i is NavItem => typeof i !== 'string' && isActive(i.to))?.label || 'BODYVISION AI'

  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <nav className="sidebar" aria-label="Navegación principal">
        <Brand />
        {items.map((it, i) =>
          typeof it === 'string' ? <div key={i} className="nav-section">{it}</div> : !it.perm || can(it.perm) ? (
            <NavLink key={it.label} to={it.to} className={() => `nav-link ${isActive(it.to) ? 'active' : ''}`} title={it.label}>
              {it.icon}<span className="nav-label">{it.label}</span>
            </NavLink>
          ) : null,
        )}
        <div className="sidebar-foot">
          <div className="sidebar-foot-text">BODYVISION AI v1.0 · uso no clínico</div>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon" aria-label="Menú" onClick={() => (window.innerWidth <= 900 ? setMobileOpen(!mobileOpen) : setCollapsed(!collapsed))}><Menu size={20} /></button>
          <div className="title">{title}</div>
          <div className="spacer" />
          {current ? (
            <button className="chip" onClick={() => nav(`/profiles/${current.id}`)} title="Expediente activo">
              <UserRound size={14} /> <span className="mono">{current.code}</span> <span className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{current.name}</span>
            </button>
          ) : null}
          <div style={{ position: 'relative' }}>
            <button className="btn ghost" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="kpi-icon" style={{ width: 30, height: 30, borderRadius: 999, fontSize: 12, fontWeight: 700 }}>{user?.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <span style={{ textAlign: 'left', lineHeight: 1.15 }} className="nav-label">
                <div style={{ fontSize: 13 }}>{user?.full_name}</div>
                <div className="small dim">{ROLE_LABEL[user?.role || 'viewer']}</div>
              </span>
              <ChevronDown size={14} />
            </button>
            {menu ? (
              <div className="hud-panel" role="menu" style={{ position: 'absolute', right: 0, top: 46, minWidth: 230, padding: 8, zIndex: 40 }}>
                <div className="small muted" style={{ padding: '6px 10px' }}>{user?.email}<br />{user?.organization_name}</div>
                <div className="divider" style={{ margin: '6px 0' }} />
                <button className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} role="menuitem" onClick={() => { logout(); nav('/login') }}>
                  <LogOut size={16} /> Cerrar sesión
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <main className={`content ${full ? 'full' : ''}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
