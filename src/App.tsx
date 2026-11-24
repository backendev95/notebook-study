import { useEffect, useState } from 'react';
import { Library } from './components/Library';
import { NotebookView } from './components/NotebookView';
import { useSession } from './lib/auth';

// Rutas simples con el hash: #/  y  #/cuaderno/<id>
const parse = () => location.hash.match(/^#\/cuaderno\/(.+)$/)?.[1] ?? null;

export default function App() {
  const [notebookId, setNotebookId] = useState<string | null>(parse);
  const { session, enabled } = useSession();

  useEffect(() => {
    const onHash = () => setNotebookId(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (notebookId)
    return <NotebookView key={notebookId} notebookId={notebookId} onBack={() => (location.hash = '#/')} />;
  return (
    <Library session={session} syncEnabled={enabled} onOpen={(id) => (location.hash = `#/cuaderno/${id}`)} />
  );
}
