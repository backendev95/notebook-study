import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Session } from '@supabase/supabase-js';
import { createNotebook, db, now } from '../db';
import { useAssetUrl } from '../lib/images';
import { PAPER_LABELS, type Notebook, type PaperType } from '../types';
import { AccountPanel, InstallButton } from './Account';
import { Menu, MenuItem } from './Menu';
import { COVER_COLORS, NotebookSettings } from './NotebookSettings';
import { PaperSample } from './PaperSample';
import { SearchDialog } from './SearchDialog';
import { icons } from './Toolbar';

function CoverMini({ n }: { n: Notebook }) {
  const url = useAssetUrl(n.coverAssetId ?? '');
  return n.coverAssetId && url ? <img className="mini-photo" src={url} alt="" /> : null;
}

export function Library({
  onOpen,
  onReview,
  session,
  syncEnabled,
}: {
  onOpen: (id: string, page?: number, el?: string) => void;
  onReview: () => void;
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
  const dueCards = useLiveQuery(async () => {
    const t = Date.now();
    return (await db.elements.toArray()).filter((e) => e.type === 'card' && !e.deleted && e.due <= t).length;
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState(COVER_COLORS[0]);
  const [paper, setPaper] = useState<PaperType>('grid');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<Notebook | null>(null);
  const [searching, setSearching] = useState(false);

  const create = async () => {
    const id = await createNotebook(title.trim() || 'Nuevo cuaderno', color, 3, paper);
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

      <div className="library-tools">
        <button className="search-bar" onClick={() => setSearching(true)}>
          {icons.search}
          <span>Buscar en todos tus apuntes…</span>
        </button>
        <button className="review-btn" onClick={onReview}>
          {icons.card}
          <span>Repasar tarjetas</span>
          {!!dueCards && <b className="badge">{dueCards}</b>}
        </button>
      </div>

      <div className="shelf">
        {notebooks?.map((n) => (
          <div key={n.id} className="shelf-item">
            {/* con foto de portada, el nombre va encima del cuaderno para no tapar la imagen */}
            <div className={`shelf-title${n.coverAssetId ? '' : ' empty'}`} title={n.title}>
              {n.title}
            </div>
            <button
              className={`mini-notebook${n.coverAssetId ? ' has-photo' : ''}`}
              style={{ ['--cover' as string]: n.color }}
              onClick={() => onOpen(n.id)}
            >
              <CoverMini n={n} />
              <span className="mini-rings" />
              {!n.coverAssetId && <span className="mini-label">{n.title}</span>}
            </button>
            <div className="shelf-meta">
              <span>{pageCounts?.[n.id] ?? 0} hojas</span>
              {confirmDelete === n.id ? (
                <span className="confirm">
                  ¿Eliminar?{' '}
                  <button className="link danger" onClick={() => db.notebooks.update(n.id, { deleted: true, updatedAt: now() })}>
                    Sí
                  </button>{' '}
                  <button className="link" onClick={() => setConfirmDelete(null)}>
                    No
                  </button>
                </span>
              ) : (
                <Menu button={<span className="dots">⋯</span>} title={`Opciones de ${n.title}`} className="small">
                  {(close) => (
                    <>
                      <MenuItem onClick={() => (onOpen(n.id), close())}>Abrir</MenuItem>
                      <MenuItem onClick={() => (setEditing(n), close())}>Ajustes (nombre, portada, hoja)</MenuItem>
                      <MenuItem danger onClick={() => (setConfirmDelete(n.id), close())}>
                        Eliminar
                      </MenuItem>
                    </>
                  )}
                </Menu>
              )}
            </div>
          </div>
        ))}

        <div className="shelf-item">
          <div className="shelf-title empty" aria-hidden>
            ·
          </div>
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
                {COVER_COLORS.slice(0, 7).map((c) => (
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
              <div className="paper-row compact">
                {(Object.keys(PAPER_LABELS) as PaperType[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`paper-opt${paper === p ? ' active' : ''}`}
                    onClick={() => setPaper(p)}
                    title={PAPER_LABELS[p]}
                  >
                    <PaperSample paper={p} />
                    <span>{PAPER_LABELS[p]}</span>
                  </button>
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

      {editing && <NotebookSettings notebook={editing} onClose={() => setEditing(null)} />}
      {searching && (
        <SearchDialog
          onClose={() => setSearching(false)}
          onPick={(h) => {
            setSearching(false);
            onOpen(h.notebookId, h.page, h.elementId);
          }}
        />
      )}
    </div>
  );
}
