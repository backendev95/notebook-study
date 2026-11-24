import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { search, type SearchHit } from '../lib/search';

export function SearchDialog({
  notebookId,
  onPick,
  onClose,
}: {
  notebookId?: string;
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'this' | 'all'>(notebookId ? 'this' : 'all');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = await search(q, scope === 'this' ? notebookId : undefined);
      if (alive) setHits(q.trim().length >= 2 ? r : null);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, scope, notebookId]);

  return createPortal(
    <div className="modal-backdrop top" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide search-modal" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && onClose())}>
        <input
          className="search-input"
          autoFocus
          placeholder="Buscar en tus apuntes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {notebookId && (
          <div className="seg">
            <button className={scope === 'this' ? 'active' : ''} onClick={() => setScope('this')}>
              Este cuaderno
            </button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
              Todos los cuadernos
            </button>
          </div>
        )}
        <div className="search-results">
          {hits === null && <p className="muted-text">Escribe al menos 2 letras. Busca en textos, notas, fórmulas, tarjetas y separadores.</p>}
          {hits?.length === 0 && <p className="muted-text">No encontré "{q}".</p>}
          {hits?.map((h, i) => (
            <button key={i} className="search-hit" onClick={() => onPick(h)}>
              <span className="hit-where">
                {scope === 'all' && <b>{h.notebookTitle} · </b>}
                {h.page < 0 ? 'Portada' : `Hoja ${h.page + 1}`} · {h.kind}
              </span>
              <span className="hit-snippet">
                {h.snippet.slice(0, h.start)}
                <mark>{h.snippet.slice(h.start, h.start + h.length)}</mark>
                {h.snippet.slice(h.start + h.length)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
