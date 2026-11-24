import { PAGE_H } from '../types';
import type { Notebook, PaperType } from '../types';
import { useAssetUrl } from '../lib/images';

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

/** Reverso en blanco de una hoja (vista de una página, mientras la pasas) */
export function BackPaper({ paper }: { paper: PaperType }) {
  return (
    <div className={`paper paper-${paper} bind-right back-paper`}>
      <Holes side="right" />
    </div>
  );
}

/** Espiral metálica sobre el lomo */
export function Rings({ left }: { left: number }) {
  return (
    <div className="rings" aria-hidden style={{ left }}>
      {holePositions.map((y) => (
        <span key={y} className="ring" style={{ top: y - 9 }} />
      ))}
    </div>
  );
}

function CoverPhoto({ assetId }: { assetId: string }) {
  const url = useAssetUrl(assetId);
  return url ? <img className="cover-photo" src={url} alt="" draggable={false} /> : null;
}

export function Cover({ notebook, pageCount }: { notebook: Notebook; pageCount: number }) {
  return (
    <div className={`cover${notebook.coverAssetId ? ' has-photo' : ''}`} style={{ ['--cover' as string]: notebook.color }}>
      {notebook.coverAssetId && <CoverPhoto assetId={notebook.coverAssetId} />}
      <Holes side="left" />
      {/* con foto, la portada se ve limpia y completa (el nombre está en la barra de arriba) */}
      {!notebook.coverAssetId && (
        <>
          <div className="cover-label">
            <div className="cover-brand">Notebook Study</div>
            <div className="cover-title">{notebook.title}</div>
            <div className="cover-meta">
              {pageCount} {pageCount === 1 ? 'hoja' : 'hojas'}
            </div>
          </div>
          <div className="cover-hint">Arrastra la esquina para abrir →</div>
        </>
      )}
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
