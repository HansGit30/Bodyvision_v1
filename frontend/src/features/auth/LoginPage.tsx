import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, ShieldCheck, ScanLine, Box, Sparkles } from 'lucide-react'
import { LogoMark } from '../../components/Logo'
import { Alert, Modal } from '../../components/ui'
import { rememberedEmail, useAuth } from '../../services/store'
import { api, errMsg } from '../../services/api'
import { HoloPreview } from '../body-viewer/HoloPreview'

export default function LoginPage() {
  const login = useAuth((s) => s.login)
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState(rememberedEmail())
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(!!rememberedEmail())
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgot, setForgot] = useState(false)
  const [register, setRegister] = useState(false)
  const [regName, setRegName] = useState('')
  const [regSex, setRegSex] = useState<'M' | 'F'>('M')
  const [demo, setDemo] = useState(false)
  useEffect(() => { api<{ demo: boolean }>('/health').then((h) => setDemo(!!h.demo)).catch(() => setDemo(false)) }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) { setError('Ingresa tu correo y contraseña'); return }
    setBusy(true)
    try {
      await login(email.trim(), password, remember)
      const to = (loc.state as { from?: string } | null)?.from || '/dashboard'
      nav(to, { replace: true })
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const registerPatient = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api('/auth/register-patient', { body: { email: email.trim(), password, full_name: regName.trim(), sex: regSex } })
      await login(email.trim(), password, remember)
      nav('/profiles', { replace: true })
    } catch (err) { setError(errMsg(err)) } finally { setBusy(false) }
  }

  return (
    <div className="login-page">
      <section className="login-hero" aria-hidden="true">
        <div className="hero-text">
          <h1>BODY<b>VISION</b> AI</h1>
          <div className="tag">Análisis · Simulación · Transformación</div>
          <p className="muted" style={{ maxWidth: 440, marginTop: 14 }}>
            Plataforma de análisis corporal con visor anatómico 3D por capas, captura con visión por computadora y simulación de escenarios.
          </p>
        </div>
        <HoloPreview interactive={false} height="100%" mode="holo" />
        <div className="bullets">
          <div><Box size={16} color="#22d3ee" /> Atlas 3D: piel, músculos, órganos, vasos, nervios y huesos</div>
          <div><ScanLine size={16} color="#22d3ee" /> Landmarks de pose con MediaPipe en tiempo real</div>
          <div><Sparkles size={16} color="#22d3ee" /> Simulaciones rotuladas, aisladas de los datos reales</div>
          <div><ShieldCheck size={16} color="#22d3ee" /> Roles, consentimiento y auditoría</div>
        </div>
      </section>
      <section className="login-side">
        <div className="card login-card" style={{ padding: 30 }}>
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <LogoMark size={54} />
            <div className="brand-text" style={{ fontSize: 24, marginTop: 6 }}>BODY<b>VISION</b> AI</div>
            <h2 style={{ fontSize: 18, marginTop: 14, fontWeight: 600 }}>Accede a tu cuenta</h2>
          </div>
          <form onSubmit={register ? registerPatient : submit} noValidate>
            {register ? <>
              <div className="field"><label htmlFor="reg-name">Nombre completo</label><input id="reg-name" className="input" required minLength={2} maxLength={160} value={regName} onChange={(e) => setRegName(e.target.value)} /></div>
              <div className="field"><label htmlFor="reg-sex">Modelo corporal de referencia</label><select id="reg-sex" className="input" value={regSex} onChange={(e) => setRegSex(e.target.value as 'M' | 'F')}><option value="M">Masculino</option><option value="F">Femenino</option></select></div>
              <p className="small muted">Tu expediente se creará vacío. Las fotografías requieren consentimiento previo y los análisis deberán ser revisados por un especialista.</p>
            </> : null}
            <div className="field">
              <label htmlFor="email">Correo electrónico</label>
              <input id="email" className="input" type="email" autoComplete="username" placeholder="usuario@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <div style={{ position: 'relative' }}>
                <input id="password" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 42 }} />
                <button type="button" className="btn ghost icon sm" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} style={{ position: 'absolute', right: 4, top: 4 }}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="row between" style={{ marginBottom: 16 }}>
              <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Recordarme</label>
              {!register ? <button type="button" className="btn ghost sm" onClick={() => setForgot(true)}>¿Olvidaste tu contraseña?</button> : null}
            </div>
            {error ? <div className="mb"><Alert kind="error">{error}</Alert></div> : null}
            <button className="btn primary" style={{ width: '100%', padding: 12 }} disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <LogIn size={17} />} {register ? "Crear cuenta de paciente" : "Iniciar sesión"}
            </button>
          </form>
          <button type="button" className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { setRegister(!register); setError(null) }}>
            {register ? 'Ya tengo cuenta · Iniciar sesión' : 'Soy paciente · Crear mi cuenta'}
          </button>
          {demo && !register ? (
            <div className="mt">
              <Alert kind="info">
                <b>Cuentas de demostración</b> (expedientes ficticios):<br />
                <button type="button" className="demo-cred" onClick={() => { setEmail('especialista@bodyvision.ai'); setPassword('Especialista2026!') }}>
                  <b>Especialista</b> <span className="mono">especialista@bodyvision.ai</span> / <span className="mono">Especialista2026!</span>
                </button>
                <button type="button" className="demo-cred" onClick={() => { setEmail('admin@bodyvision.ai'); setPassword('BodyVision2026!') }}>
                  <b>Administrador</b> <span className="mono">admin@bodyvision.ai</span> / <span className="mono">BodyVision2026!</span>
                </button>
                <div className="small dim">La clave del administrador es la definida en <span className="mono">ADMIN_PASSWORD</span>.</div>
              </Alert>
            </div>
          ) : null}
          <p className="small dim" style={{ textAlign: 'center', marginTop: 14 }}>
            Herramienta no clínica. No sustituye la evaluación de un profesional de la salud.
          </p>
        </div>
      </section>
      {forgot ? (
        <Modal title="Recuperación de contraseña" onClose={() => setForgot(false)} footer={<button className="btn primary" onClick={() => setForgot(false)}>Entendido</button>}>
          <p className="muted">Por seguridad, el restablecimiento de contraseñas lo realiza el <b>administrador de tu organización</b> desde el módulo de Administración. Contáctalo indicando tu correo registrado.</p>
        </Modal>
      ) : null}
    </div>
  )
}
