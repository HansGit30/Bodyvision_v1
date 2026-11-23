import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Pencil, ShieldCheck, UserPlus, Users, ScrollText } from 'lucide-react'
import { api, errMsg } from '../../services/api'
import { toast, useAuth } from '../../services/store'
import type { AuditRow, Page, UserRow } from '../../types'
import { Alert, Card, Empty, Field, Modal, Spinner, StatusBadge, Tabs } from '../../components/ui'
import { ROLE_LABEL, fmtDateTime } from '../../utils/format'

type Tab = 'users' | 'roles' | 'audit'

export default function AdminPage() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'users'
  return (
    <>
      <div className="page-head"><div><h1>Administración</h1><p>Usuarios, roles, permisos y auditoría de la organización.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp(t === 'users' ? {} : { tab: t }, { replace: true })} items={[
        { id: 'users', label: <><Users size={14} /> Usuarios</> },
        { id: 'roles', label: <><ShieldCheck size={14} /> Roles y permisos</> },
        { id: 'audit', label: <><ScrollText size={14} /> Auditoría</> },
      ]} />
      {tab === 'users' ? <UsersTab /> : tab === 'roles' ? <RolesTab /> : <AuditTab />}
    </>
  )
}

function UsersTab() {
  const me = useAuth((s) => s.user)
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { api<UserRow[]>('/users').then(setRows).catch((e) => setErr(errMsg(e))) }, [tick])
  return (
    <Card title="Usuarios" actions={<button className="btn primary sm" onClick={() => setEdit('new')}><UserPlus size={14} /> Nuevo usuario</button>}>
      {err ? <Alert kind="error">{err}</Alert> : !rows ? <Spinner /> : (
        <table className="table">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Creado</th><th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id}>
              <td><b>{u.full_name}</b> {u.id === me?.id ? <span className="badge cyan">tú</span> : null}</td><td className="muted">{u.email}</td>
              <td>{ROLE_LABEL[u.role]}</td><td><StatusBadge status={u.status} /></td>
              <td className="nowrap small">{fmtDateTime(u.last_login_at)}</td><td className="nowrap small dim">{fmtDateTime(u.created_at)}</td>
              <td><button className="btn sm ghost" onClick={() => setEdit(u)} aria-label={`Editar ${u.full_name}`}><Pencil size={14} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {edit ? <UserForm user={edit === 'new' ? null : edit} self={edit !== 'new' && edit.id === me?.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setTick((t) => t + 1) }} /> : null}
    </Card>
  )
}

function UserForm({ user, self, onClose, onSaved }: { user: UserRow | null; self: boolean; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(user?.email || '')
  const [name, setName] = useState(user?.full_name || '')
  const [role, setRole] = useState(user?.role || 'specialist')
  const [status, setStatus] = useState(user?.status || 'active')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!user && password.length < 8) { setErr('La contraseña debe tener al menos 8 caracteres'); return }
    if (user && password && password.length < 8) { setErr('La nueva contraseña debe tener al menos 8 caracteres'); return }
    setBusy(true)
    try {
      if (user) await api(`/users/${user.id}`, { method: 'PATCH', body: { full_name: name, role, status, ...(password ? { password } : {}) } })
      else await api('/users', { body: { email, full_name: name, role, password } })
      toast(user ? 'Usuario actualizado' : 'Usuario creado', 'success')
      onSaved()
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title={user ? `Editar ${user.full_name}` : 'Nuevo usuario'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Correo" htmlFor="u-email"><input id="u-email" type="email" className="input" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Nombre completo" htmlFor="u-name"><input id="u-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></Field>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field label="Rol" htmlFor="u-role">
            <select id="u-role" className="select" value={role} disabled={self} onChange={(e) => setRole(e.target.value as UserRow['role'])}>
              <option value="admin">Administrador</option><option value="specialist">Especialista</option><option value="viewer">Usuario final</option>
            </select>
          </Field>
          {user ? (
            <Field label="Estado" htmlFor="u-status">
              <select id="u-status" className="select" value={status} disabled={self} onChange={(e) => setStatus(e.target.value as UserRow['status'])}>
                <option value="active">Activo</option><option value="disabled">Deshabilitado</option>
              </select>
            </Field>
          ) : <div />}
        </div>
        <Field label={user ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'} htmlFor="u-pass" hint="Mínimo 8 caracteres. Comunícala por un canal seguro.">
          <input id="u-pass" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        {err ? <Alert kind="error">{err}</Alert> : null}
        <div className="btn-row mt" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

function RolesTab() {
  const [data, setData] = useState<{ roles: { code: string; name: string; description: string; permissions: string[] }[]; permissions: { code: string; label: string }[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api('/roles').then(setData).catch((e) => setErr(errMsg(e))) }, [])
  if (err) return <Alert kind="error">{err}</Alert>
  if (!data) return <Spinner />
  return (
    <Card title="Matriz RBAC" sub="Permisos por rol. El acceso a cada expediente además requiere una concesión explícita (excepto administradores).">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Permiso</th>{data.roles.map((r) => <th key={r.code} style={{ textAlign: 'center' }}>{r.name}</th>)}</tr></thead>
          <tbody>{data.permissions.map((p) => (
            <tr key={p.code}>
              <td>{p.label} <span className="mono dim small">{p.code}</span></td>
              {data.roles.map((r) => <td key={r.code} style={{ textAlign: 'center' }}>{r.permissions.includes(p.code) ? <Check size={16} color="#4ade80" /> : <span className="dim">—</span>}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="grid g-3 mt">
        {data.roles.map((r) => <div key={r.code} className="card tight"><b>{r.name}</b><div className="small muted">{r.description}</div></div>)}
      </div>
    </Card>
  )
}

function AuditTab() {
  const [rows, setRows] = useState<Page<AuditRow> | null>(null)
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [offset, setOffset] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const LIMIT = 25
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
      if (action) q.set('action', action)
      if (actor) q.set('actor', actor)
      api<Page<AuditRow>>(`/audit-events?${q}`).then(setRows).catch((e) => setErr(errMsg(e)))
    }, 250)
    return () => clearTimeout(t)
  }, [action, actor, offset])
  return (
    <Card title="Eventos de auditoría" sub="Accesos, descargas, cambios y tareas administrativas con correlation_id.">
      <div className="row wrap mb">
        <select className="select" style={{ width: 220 }} value={action} onChange={(e) => { setAction(e.target.value); setOffset(0) }} aria-label="Filtrar acción">
          <option value="">Todas las acciones</option>
          {['auth', 'profile', 'measurement', 'consent', 'media', 'pose', 'simulation', 'report', 'user'].map((a) => <option key={a} value={a}>{a}.*</option>)}
        </select>
        <input className="input" style={{ width: 260 }} placeholder="Filtrar por correo del actor" value={actor} onChange={(e) => { setActor(e.target.value); setOffset(0) }} aria-label="Filtrar actor" />
      </div>
      {err ? <Alert kind="error">{err}</Alert> : !rows ? <Spinner /> : rows.items.length === 0 ? <Empty title="Sin eventos" /> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Recurso</th><th>Resultado</th><th>IP</th><th>Detalle</th><th>Correlation</th></tr></thead>
              <tbody>{rows.items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap small">{fmtDateTime(e.created_at)}</td><td className="small">{e.actor_email || '—'}</td>
                  <td className="mono small">{e.action}</td><td className="small muted">{e.resource_type}{e.resource_id ? `:${e.resource_id.slice(0, 8)}` : ''}</td>
                  <td><span className={`badge ${e.outcome === 'success' ? 'green' : 'red'}`}>{e.outcome}</span></td>
                  <td className="mono small dim">{e.ip}</td>
                  <td className="small dim" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(e.details)}>{Object.keys(e.details || {}).length ? JSON.stringify(e.details) : ''}</td>
                  <td className="mono small dim">{e.correlation_id}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row between mt small muted">
            <span>{rows.total} eventos</span>
            <div className="btn-row">
              <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} aria-label="Anterior"><ChevronLeft size={14} /></button>
              <span>{Math.floor(offset / LIMIT) + 1} / {Math.max(1, Math.ceil(rows.total / LIMIT))}</span>
              <button className="btn sm" disabled={offset + LIMIT >= rows.total} onClick={() => setOffset(offset + LIMIT)} aria-label="Siguiente"><ChevronRight size={14} /></button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
