import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Spinner, Toasts } from './components/ui'
import { useAuth } from './services/store'

const LoginPage = lazy(() => import('./features/auth/LoginPage'))
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'))
const ProfilesPage = lazy(() => import('./features/profiles/ProfilesPage'))
const SelectProfilePage = lazy(() => import('./features/profiles/ProfilesPage').then((m) => ({ default: m.SelectProfilePage })))
const ProfileDetailPage = lazy(() => import('./features/profiles/ProfileDetailPage'))
const CapturePage = lazy(() => import('./features/capture/CapturePage'))
const AnalysisPage = lazy(() => import('./features/pose-analysis/AnalysisPage'))
const AnalysesListPage = lazy(() => import('./features/pose-analysis/AnalysisPage').then((m) => ({ default: m.AnalysesListPage })))
const ViewerPage = lazy(() => import('./features/body-viewer/ViewerPage'))
const AnalyticsPage = lazy(() => import('./features/analytics/AnalyticsPage'))
const SimulationPage = lazy(() => import('./features/simulations/SimulationPage'))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
const AdminPage = lazy(() => import('./features/admin/AdminPage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <Spinner lg label="Verificando sesión…" />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const can = useAuth((s) => s.can)
  if (!can(perm)) return <div className="card"><h2>Acceso restringido</h2><p className="muted">Tu rol no tiene el permiso <span className="mono">{perm}</span>.</p></div>
  return <>{children}</>
}

function NotFound() {
  return <div className="card"><h2>Página no encontrada</h2><p className="muted">La ruta solicitada no existe.</p><a className="btn" href="/dashboard">Ir al dashboard</a></div>
}

export default function App() {
  const restore = useAuth((s) => s.restore)
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  useEffect(() => { restore() }, [restore])
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner lg label="Cargando módulo…" />}>
        <Routes>
          <Route path="/login" element={ready && user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/profiles/:id" element={<ProfileDetailPage />} />
            <Route path="/profiles/:id/measurements" element={<NavigateMeasurements />} />
            <Route path="/select/:target" element={<SelectProfilePage />} />
            <Route path="/capture/:profileId" element={<RequirePerm perm="media:upload"><CapturePage /></RequirePerm>} />
            <Route path="/analyses" element={<AnalysesListPage />} />
            <Route path="/reviews" element={<RequirePerm perm="reports:generate"><AnalysesListPage /></RequirePerm>} />
            <Route path="/analyses/:id" element={<AnalysisPage />} />
            <Route path="/viewer" element={<ViewerPage />} />
            <Route path="/viewer/:profileId" element={<ViewerPage />} />
            <Route path="/analytics/:profileId" element={<AnalyticsPage />} />
            <Route path="/simulations/:profileId" element={<SimulationPage />} />
            <Route path="/reports" element={<RequirePerm perm="reports:read"><ReportsPage /></RequirePerm>} />
            <Route path="/admin" element={<RequirePerm perm="users:manage"><AdminPage /></RequirePerm>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
      <Toasts />
    </BrowserRouter>
  )
}

function NavigateMeasurements() {
  const loc = useLocation()
  const id = loc.pathname.split('/')[2]
  return <Navigate to={`/profiles/${id}?tab=measurements`} replace />
}
