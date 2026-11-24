import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { exportPdf } from '../lib/pdf';
import type { Notebook, Page } from '../types';
import { Cover } from './Paper';
import { PageSurface, type PenSettings } from './PageSurface';

/** Convierte "1-3, 5" en índices de hoja (base 0) */
function parseRange(text: string, max: number) {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]),
      b = Number(m[2] ?? m[1]);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

export function ExportDialog({
  notebook,
  pages,
  activePage,
  settings,
  onClose,
}: {
  notebook: Notebook;
  pages: Page[];
  activePage: number;
  settings: PenSettings;
  onClose: () => void;
}) {
  const [which, setWhich] = useState<'all' | 'current' | 'range'>('all');
  const [range, setRange] = useState(`1-${pages.length}`);
  const [withCover, setWithCover] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState('');
  const holder = useRef<HTMLDivElement>(null);

  const selected =
    which === 'all' ? pages.map((_, i) => i) : which === 'current' ? (activePage >= 0 ? [activePage] : []) : parseRange(range, pages.length);
  const count = selected.length + (withCover ? 1 : 0);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    (async () => {
      try {
        // esperar a que las hojas carguen su contenido e imágenes
        await new Promise((r) => setTimeout(r, 900));
        const imgs = [...(holder.current?.querySelectorAll('img') ?? [])];
        await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r))))));
        await document.fonts.ready;
        const nodes = [...(holder.current?.querySelectorAll<HTMLElement>('.export-page') ?? [])];
        if (cancelled) return;
        await exportPdf(nodes, notebook.title, (d, t) => setProgress([d, t]));
        onClose();
      } catch (e) {
        setError(String((e as Error).message ?? e));
        setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" onKeyDown={(e) => e.stopPropagation()}>
        <h2>Exportar a PDF</h2>
        <div className="radio-list">
          <label>
            <input type="radio" checked={which === 'all'} onChange={() => setWhich('all')} /> Todo el cuaderno ({pages.length} hojas)
          </label>
          <label>
            <input type="radio" checked={which === 'current'} onChange={() => setWhich('current')} disabled={activePage < 0} /> Solo
            la hoja actual
          </label>
          <label>
            <input type="radio" checked={which === 'range'} onChange={() => setWhich('range')} /> Hojas:
            <input className="range-input" value={range} onChange={(e) => (setRange(e.target.value), setWhich('range'))} placeholder="1-3, 5" />
          </label>
          <label>
            <input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} /> Incluir la portada
          </label>
        </div>
        {error && <div className="form-error">No se pudo exportar: {error}</div>}
        {progress && (
          <div className="progress">
            <div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
            <span>
              Hoja {progress[0]} de {progress[1]}
            </span>
          </div>
        )}
        <div className="form-actions">
          <span className="muted-text">{count} páginas en el PDF</span>
          <span className="row-gap">
            <button type="button" className="link" onClick={onClose} disabled={running}>
              Cancelar
            </button>
            <button type="button" className="primary" onClick={() => setRunning(true)} disabled={running || count === 0}>
              {running ? 'Preparando…' : 'Descargar PDF'}
            </button>
          </span>
        </div>
      </div>
      {running && (
        <div ref={holder} className="export-holder" aria-hidden>
          {withCover && (
            <div className="export-page">
              <Cover notebook={notebook} pageCount={pages.length} />
            </div>
          )}
          {selected.map((i) => (
            <div key={pages[i].id} className="export-page">
              <PageSurface pageId={pages[i].id} pageNumber={i + 1} editable={false} settings={settings} paper={pages[i].paper ?? notebook.paper ?? 'grid'} />
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
