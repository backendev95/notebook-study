import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { explainError, supabase } from '../lib/supabase';
import { sync, useSyncStatus } from '../lib/sync';
import { useInstall } from '../lib/install';

function ago(t?: number) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.round(s / 60)} min`;
}

/** Puntico de estado de la sincronización */
export function SyncBadge({ compact }: { compact?: boolean }) {
  const s = useSyncStatus();
  if (s.state === 'off') return null;
  const text =
    s.state === 'syncing'
      ? 'Sincronizando…'
      : s.state === 'offline'
        ? `Sin conexión${s.pending ? ` · ${s.pending} cambios guardados aquí` : ''}`
        : s.state === 'error'
          ? s.error ?? 'Error al sincronizar'
          : `Sincronizado ${ago(s.lastSync)}`;
  return (
    <button
      className={`sync-badge sync-${s.state}${compact ? ' compact' : ''}`}
      title={`${text} — toca para sincronizar ahora`}
      onClick={() => sync.run()}
    >
      <span className="dot" />
      {!compact && <span className="sync-text">{text}</span>}
    </button>
  );
}

export function AccountPanel({ session, enabled }: { session: Session | null; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!enabled)
    return (
      <div className="account muted" title="Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY">
        Solo en este dispositivo
      </div>
    );

  if (!session)
    return (
      <>
        <div className="account">
          <button className="primary" onClick={() => setOpen(true)}>
            Iniciar sesión para sincronizar
          </button>
        </div>
        {open && <LoginDialog onClose={() => setOpen(false)} />}
      </>
    );

  const signOut = async () => {
    setBusy(true);
    setMsg('');
    const ok = await sync.signOutAndClear();
    if (ok) localStorage.removeItem('nbs-skip-login');
    setBusy(false);
    if (!ok) setMsg('Hay cambios sin subir. Conéctate a internet e inténtalo de nuevo para no perderlos.');
  };

  return (
    <div className="account">
      <SyncBadge />
      <span className="account-email">{session.user.email}</span>
      <button className="link" onClick={signOut} disabled={busy}>
        {busy ? 'Cerrando…' : 'Cerrar sesión'}
      </button>
      {msg && <div className="account-msg">{msg}</div>}
    </div>
  );
}

export function LoginForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const redirectTo = location.origin + location.pathname;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onDone();
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        if (data.session) onDone();
        else setInfo('Te enviamos un correo para confirmar la cuenta. Después vuelve e inicia sesión.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setInfo('Si el correo existe, te llegará un enlace para cambiar la contraseña.');
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="modal" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Iniciar sesión' : mode === 'signup' ? 'Crear cuenta' : 'Recuperar contraseña'}</h2>
        <p className="modal-sub">
          Usa la misma cuenta de tus otras apps. Tus cuadernos se guardan en la nube y los abres desde cualquier
          dispositivo.
        </p>
        <label>
          Correo
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label>
            Contraseña
            <input
              type="password"
              required
              minLength={6}
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && <div className="form-error">{error}</div>}
        {info && <div className="form-info">{info}</div>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
        <div className="modal-links">
          {mode === 'login' ? (
            <>
              <button type="button" className="link" onClick={() => setMode('signup')}>
                Crear cuenta nueva
              </button>
              <button type="button" className="link" onClick={() => setMode('reset')}>
                Olvidé mi contraseña
              </button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => setMode('login')}>
              Ya tengo cuenta
            </button>
          )}
        </div>
    </form>
  );
}

function LoginDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <LoginForm onDone={onClose} />
    </div>
  );
}

/** Botón para instalar la app en el celular o el computador */
export function InstallButton() {
  const { canPrompt, installed, ios, install } = useInstall();
  const [tip, setTip] = useState(false);
  if (installed) return null;
  if (canPrompt)
    return (
      <button className="install-btn" onClick={install}>
        Instalar app
      </button>
    );
  if (ios)
    return (
      <span className="install-wrap">
        <button className="install-btn" onClick={() => setTip((t) => !t)}>
          Instalar app
        </button>
        {tip && (
          <span className="install-tip">
            En Safari toca <b>Compartir</b> (el cuadro con la flecha) y luego <b>Agregar a pantalla de inicio</b>.
          </span>
        )}
      </span>
    );
  return null;
}
