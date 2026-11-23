import { PAGE_H } from '../types';
import type { Notebook } from '../types';

export const HOLE_SPACING = 40;
export const HOLE_START = 26;
export const holePositions = Array.from(
  { length: Math.floor((PAGE_H - HOLE_START * 2) / HOLE_SPACING) + 1 },
  (_, i) => HOLE_START + i * HOLE_SPACING,
);

/** Perforaciones de la hoja (donde pasan los anillos) */
export function Holes({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`holes holes-${side}`} aria-hidden>
      {holePositions.map((y) => (
        <span key={y} className="hole" style={{ top: y }} />
      ))}
    </div>
  );
}

/** Reverso de una hoja (se ve mientras la estás pasando) */
export function BackPaper() {
  return (
    <div className="paper back-paper">
      <Holes side="right" />
    </div>
  );
}

/** Espiral metálica sobre el lomo */
export function Rings() {
  return (
    <div className="rings" aria-hidden>
      {holePositions.map((y) => (
        <span key={y} className="ring" style={{ top: y - 9 }} />
      ))}
    </div>
  );
}

export function Cover({ notebook, pageCount }: { notebook: Notebook; pageCount: number }) {
  return (
    <div className="cover" style={{ ['--cover' as string]: notebook.color }}>
      <Holes side="left" />
      <div className="cover-label">
        <div className="cover-brand">Notebook Study</div>
        <div className="cover-title">{notebook.title}</div>
        <div className="cover-meta">
          {pageCount} {pageCount === 1 ? 'hoja' : 'hojas'} · cuadriculado
        </div>
      </div>
      <div className="cover-hint">Arrastra la esquina para abrir →</div>
    </div>
  );
}

export function CoverInside({ color }: { color: string }) {
  return (
    <div className="cover cover-inside" style={{ ['--cover' as string]: color }}>
      <Holes side="right" />
    </div>
  );
}
