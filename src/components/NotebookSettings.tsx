import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveAsset, updateNotebook } from '../db';
import { compress, useAssetUrl } from '../lib/images';
import { PAPER_LABELS, type Notebook, type PaperType } from '../types';
import { PaperSample } from './PaperSample';

import { COVER_COLORS } from './colors';
export { COVER_COLORS };

function Photo({ id }: { id: string }) {
  const url = useAssetUrl(id);
  return url ? <img src={url} alt="" /> : null;
}

/** Nombre, color, foto de portada y tipo de hoja de un cuaderno */
export function NotebookSettings({ notebook, onClose }: { notebook: Notebook; onClose: () => void }) {
  const [title, setTitle] = useState(notebook.title);
  const [color, setColor] = useState(notebook.color);
  const [paper, setPaper] = useState<PaperType>(notebook.paper ?? 'grid');
  const [cover, setCover] = useState<string | null>(notebook.coverAssetId ?? null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const save = async () => {
    setBusy(true);
    await updateNotebook(notebook.id, { title: title.trim() || notebook.title, color, paper, coverAssetId: cover });
    setBusy(false);
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" onKeyDown={(e) => e.stopPropagation()}>
        <h2>Ajustes del cuaderno</h2>
        <label>
          Nombre
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">Color de la portada</span>
          <div className="color-row">
            {COVER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${c === color ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Foto de portada</span>
          <div className="cover-pick">
            <div className="cover-thumb" style={{ background: color }}>
              {cover && <Photo id={cover} />}
            </div>
            <button type="button" className="secondary" onClick={() => file.current?.click()}>
              {cover ? 'Cambiar foto' : 'Elegir foto'}
            </button>
            {cover && (
              <button type="button" className="link" onClick={() => setCover(null)}>
                Quitar
              </button>
            )}
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setBusy(true);
                setCover(await saveAsset(await compress(f)));
                setBusy(false);
              }}
            />
          </div>
        </div>
        <div className="field">
          <span className="field-label">Tipo de hoja (para las páginas que no tengan uno propio)</span>
          <div className="paper-row">
            {(Object.keys(PAPER_LABELS) as PaperType[]).map((p) => (
              <button key={p} type="button" className={`paper-opt${paper === p ? ' active' : ''}`} onClick={() => setPaper(p)}>
                <PaperSample paper={p} />
                <span>{PAPER_LABELS[p]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="form-actions">
          <span />
          <span className="row-gap">
            <button type="button" className="link" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="primary" onClick={save} disabled={busy}>
              Guardar
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
