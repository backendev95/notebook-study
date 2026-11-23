import { useEffect, useState } from 'react';
import { Library } from './components/Library';
import { NotebookView } from './components/NotebookView';

// Rutas simples con el hash: #/  y  #/cuaderno/<id>
const parse = () => location.hash.match(/^#\/cuaderno\/(.+)$/)?.[1] ?? null;

export default function App() {
  const [notebookId, setNotebookId] = useState<string | null>(parse);

  useEffect(() => {
    const onHash = () => setNotebookId(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (notebookId)
    return <NotebookView key={notebookId} notebookId={notebookId} onBack={() => (location.hash = '#/')} />;
  return <Library onOpen={(id) => (location.hash = `#/cuaderno/${id}`)} />;
}
