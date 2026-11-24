import { useEffect, useState } from 'react';
import { Library } from './components/Library';
import { NotebookView, type NavTarget } from './components/NotebookView';
import { Review } from './components/Review';
import { Welcome } from './components/Welcome';
import { useSession } from './lib/auth';

/*
  Rutas con el hash:
    #/                               biblioteca
    #/cuaderno/<id>                  un cuaderno
    #/cuaderno/<id>/hoja/<n>?el=<x>  ir a una hoja (y resaltar un elemento)
    #/repaso  ·  #/repaso/<id>       repasar tarjetas
*/
type Route =
  | { name: 'library' }
  | { name: 'notebook'; id: string; page?: number; el?: string; nonce: number }
  | { name: 'review'; id?: string };

function parse(): Route {
  const h = location.hash;
  let m = h.match(/^#\/cuaderno\/([^/?]+)(?:\/hoja\/(\d+))?(?:\?el=([^&]+))?/);
  if (m) return { name: 'notebook', id: m[1], page: m[2] ? Number(m[2]) - 1 : undefined, el: m[3], nonce: Date.now() };
  m = h.match(/^#\/repaso(?:\/([^/?]+))?/);
  if (m) return { name: 'review', id: m[1] };
  return { name: 'library' };
}

export const goNotebook = (id: string, page?: number, el?: string) => {
  location.hash = `#/cuaderno/${id}${page !== undefined && page >= 0 ? `/hoja/${page + 1}` : ''}${el ? `?el=${el}` : ''}`;
};

export default function App() {
  const [route, setRoute] = useState<Route>(parse);
  const { session, enabled, ready } = useSession();
  const [skipLogin, setSkipLogin] = useState(() => localStorage.getItem('nbs-skip-login') === '1');

  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // al cerrar sesión se vuelve a mostrar la pantalla de inicio
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) setSkipLogin(localStorage.getItem('nbs-skip-login') === '1');
  }, [userId]);

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

  if (route.name === 'review')
    return <Review notebookId={route.id} onExit={() => (route.id ? goNotebook(route.id) : (location.hash = '#/'))} />;

  if (route.name === 'notebook') {
    const nav: NavTarget | undefined =
      route.page !== undefined ? { page: route.page, el: route.el, nonce: route.nonce } : undefined;
    return (
      <NotebookView
        key={route.id}
        notebookId={route.id}
        nav={nav}
        onBack={() => (location.hash = '#/')}
        onOpenNotebook={goNotebook}
        onReview={(id) => (location.hash = id ? `#/repaso/${id}` : '#/repaso')}
      />
    );
  }

  return (
    <Library
      session={session}
      syncEnabled={enabled}
      onOpen={(id, page, el) => goNotebook(id, page, el)}
      onReview={() => (location.hash = '#/repaso')}
    />
  );
}
