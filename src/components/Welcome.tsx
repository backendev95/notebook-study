import { InstallButton, LoginForm } from './Account';

/** Pantalla de inicio: iniciar sesión (misma cuenta de tus otras apps) o seguir sin cuenta */
export function Welcome({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome-brand">
        <img src="icon-192.png" alt="" width={84} height={84} />
        <h1>Notebook Study</h1>
        <p>Tus cuadernos cuadriculados en el computador, la tablet y el celular.</p>
      </div>
      {/* al iniciar sesión la app cambia sola a "Mis cuadernos" */}
      <LoginForm onDone={() => undefined} />
      <button className="link welcome-skip" onClick={onSkip}>
        Continuar sin cuenta (solo en este dispositivo)
      </button>
      <InstallButton />
    </div>
  );
}
