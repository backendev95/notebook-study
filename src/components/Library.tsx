import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Session } from '@supabase/supabase-js';
import { createNotebook, db, now } from '../db';
import { AccountPanel, InstallButton } from './Account';

const COVER_COLORS = ['#2f5d8a', '#b8433a', '#2f7a55', '#6b4a9e', '#d9902f', '#33363f', '#c2577f'];

export function Library({
  onOpen,
  session,
  syncEnabled,
}: {
  onOpen: (id: string) => void;
  session: Session | null;
  syncEnabled: boolean;
}) {
  const notebooks = useLiveQuery(async () =>
    (await db.notebooks.toArray()).filter((n) => !n.deleted).sort((a, b) => b.updatedAt - a.updatedAt),
  );
  const pageCounts = useLiveQuery(async () => {
    const counts: Record<string, number> = {};
    for (const p of await db.pages.toArray()) if (!p.deleted) counts[p.notebookId] = (counts[p.notebookId] ?? 0) + 1;
    return counts;
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState(COVER_COLORS[0]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const create = async () => {
    const id = await createNotebook(title.trim() || 'Nuevo cuaderno', color);
    setCreating(false);
    setTitle('');
    onOpen(id);
  };

  return (
    <div className="library">
      <header className="library-header">
        <div>
          <h1>Mis cuadernos</h1>
          <p>Toca un cuaderno para abrirlo. Escribe, dibuja y pega imágenes donde quieras.</p>
        </div>
        <div className="header-actions">
          <InstallButton />
          <AccountPanel session={session} enabled={syncEnabled} />
        </div>
      </header>

      <div className="shelf">
        {notebooks?.map((n) => (
          <div key={n.id} className="shelf-item">
            <button className="mini-notebook" style={{ ['--cover' as string]: n.color }} onClick={() => onOpen(n.id)}>
              <span className="mini-rings" />
              <span className="mini-label">{n.title}</span>
            </button>
            <div className="shelf-meta">
              <span>
                {pageCounts?.[n.id] ?? 0} hojas
              </span>
              {confirmDelete === n.id ? (
                <span className="confirm">
                  ¿Eliminar?{' '}
                  <button
                    className="link danger"
                    onClick={() => db.notebooks.update(n.id, { deleted: true, updatedAt: now() })}
                  >
                    Sí
                  </button>{' '}
                  <button className="link" onClick={() => setConfirmDelete(null)}>
                    No
                  </button>
                </span>
              ) : (
                <button className="link" onClick={() => setConfirmDelete(n.id)}>
                  Eliminar
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="shelf-item">
          {creating ? (
            <form
              className="new-form"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <label>
                Nombre
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Cálculo I" />
              </label>
              <div className="color-row">
                {COVER_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`swatch${c === color ? ' active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
              <div className="form-actions">
                <button type="button" className="link" onClick={() => setCreating(false)}>
                  Cancelar
                </button>
                <button type="submit" className="primary">
                  Crear
                </button>
              </div>
            </form>
          ) : (
            <button className="mini-notebook new" onClick={() => setCreating(true)}>
              <span className="plus">+</span>
              <span>Nuevo cuaderno</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
