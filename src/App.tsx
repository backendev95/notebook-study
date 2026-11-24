import { useEffect, useState } from 'react';
import { Library } from './components/Library';
import { NotebookView } from './components/NotebookView';
import { useSession } from './lib/auth';
import { Welcome } from './components/Welcome';

// Rutas simples con el hash: #/  y  #/cuaderno/<id>
const parse = () => location.hash.match(/^#\/cuaderno\/(.+)$/)?.[1] ?? null;

export default function App() {
  const [notebookId, setNotebookId] = useState<string | null>(parse);
  const { session, enabled, ready } = useSession();
  const [skipLogin, setSkipLogin] = useState(() => localStorage.getItem('nbs-skip-login') === '1');

  useEffect(() => {
    const onHash = () => setNotebookId(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // al cerrar sesión se vuelve a mostrar la pantalla de inicio
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) setSkipLogin(localStorage.getItem('nbs-skip-login') === '1');
  }, [userId]);

  // Pantalla de inicio de sesión al abrir (se puede seguir sin cuenta)
  if (enabled && !ready) return <div className="loading">Cargando…</div>;
  if (enabled && !session && !skipLogin)
    return (
      <Welcome
        onSkip={() => {
          localStorage.setItem('nbs-skip-login', '1');
          setSkipLogin(true);
        }}
      />
    );


  if (notebookId)
    return <NotebookView key={notebookId} notebookId={notebookId} onBack={() => (location.hash = '#/')} />;
  return (
    <Library session={session} syncEnabled={enabled} onOpen={(id) => (location.hash = `#/cuaderno/${id}`)} />
  );
}
