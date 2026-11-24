import type React from 'react';
import { MARGIN_LEFT, PAGE_H, PAGE_W } from '../types';
import { Rings } from './Paper';

/*
  Cada hoja física ("sheet") tiene dos caras: frente y reverso.
  - Vista de una página: la hoja s muestra la página s al frente; el reverso va en blanco.
  - Vista de dos páginas: la hoja s tiene la página 2s al frente y la 2s+1 al reverso,
    así que abierto se ve el reverso de la hoja anterior (izquierda) y el frente de la actual (derecha).
  La hoja -1 es la portada (frente) y su interior (reverso).
  Cada cara se dibuja por separado y gira alrededor del lomo con rotateY.
*/

export type Mode = 'single' | 'spread';
export interface Flip {
  dir: 'next' | 'prev';
  p: number; // 0..1
  target: number; // hoja a la que se llega
}
type Side = 'front' | 'back';

interface FaceSpec {
  sheet: number;
  side: Side;
  angle: number;
  z: number;
  editable: boolean;
  hidden: boolean;
  shade: number;
}

export interface Section {
  title: string;
  color: string;
  page: number;
}

interface Props {
  mode: Mode;
  sheet: number;
  flip: Flip | null;
  scale: number;
  renderFace: (sheet: number, side: Side, editable: boolean) => React.ReactNode;
  canPrev: boolean;
  sections: Section[];
  currentPage: number;
  onJump: (page: number) => void;
  zone: {
    down: (dir: 'next' | 'prev') => (e: React.PointerEvent) => void;
    move: (e: React.PointerEvent) => void;
    up: () => void;
  };
  bookRef: React.RefObject<HTMLDivElement | null>;
  dragging: boolean;
}

export const TABS_W = 60;

export function bookWidth(mode: Mode) {
  return mode === 'spread' ? PAGE_W * 2 : PAGE_W;
}

export function Book({ mode, sheet: s, flip, scale, renderFace, canPrev, sections, currentPage, onJump, zone, bookRef, dragging }: Props) {
  const W = PAGE_W;
  const spine = mode === 'spread' ? W : 0;
  const specs = new Map<string, FaceSpec>();
  const put = (sheet: number, side: Side, f: Partial<FaceSpec>) => {
    if (sheet < -1) return;
    const key = `${sheet}:${side}`;
    const prev = specs.get(key);
    const spec: FaceSpec = { sheet, side, angle: 0, z: 1, editable: false, hidden: false, shade: 0, ...f };
    if (prev && !prev.hidden && spec.hidden) return; // lo visible gana a lo precargado
    specs.set(key, spec);
  };
  const both = (sheet: number, angle: number, z: number, shade = 0) => {
    put(sheet, 'front', { angle, z, shade });
    put(sheet, 'back', { angle, z, shade });
  };

  // precargar vecinos (ocultos) para que pasar la hoja sea instantáneo
  const pre = (sheet: number, side: Side, angle: number) => put(sheet, side, { angle, hidden: true });
  pre(s + 1, 'front', 0);
  pre(s - 1, 'front', 0);
  if (mode === 'spread') {
    pre(s, 'back', -180);
    pre(s - 2, 'back', -180);
  }

  if (!flip) {
    put(s, 'front', { angle: 0, z: 10, editable: true });
    if (mode === 'spread' && s - 1 >= -1) put(s - 1, 'back', { angle: -180, z: 10, editable: true });
  } else {
    const rad = Math.PI * flip.p;
    const shade = Math.sin(rad) * 0.45;
    if (flip.dir === 'next') {
      both(s, -180 * flip.p, 30, shade);
      put(flip.target, 'front', { angle: 0, z: 10 });
      if (mode === 'spread' && s - 1 >= -1) put(s - 1, 'back', { angle: -180, z: 10 });
    } else {
      both(flip.target, -180 * (1 - flip.p), 30, shade);
      put(s, 'front', { angle: 0, z: 10 });
      if (mode === 'spread' && flip.target - 1 >= -1) put(flip.target - 1, 'back', { angle: -180, z: 10 });
    }
  }

  const flipAngle = flip ? (flip.dir === 'next' ? -180 * flip.p : -180 * (1 - flip.p)) : 0;
  const shadowOnRight = flipAngle > -90;
  const shadowOpacity = flip ? Math.sin(Math.PI * flip.p) * 0.5 : 0;
  const hasLeft = mode === 'spread' && s - 1 >= -1;
  const tabsShown = sections.length > 0;
  const currentSection = [...sections].reverse().find((t) => t.page <= currentPage);

  return (
    <div
      className={`book book-${mode}`}
      ref={bookRef}
      style={{
        width: bookWidth(mode),
        height: PAGE_H,
        transform: `scale(${scale})`,
        ['--px' as string]: `${Math.max(1, 1 / scale)}px`,
      }}
    >
      <div className="page-stack" style={{ left: spine, width: W }} />
      {hasLeft && <div className="page-stack left" style={{ left: 0, width: W }} />}
      {[...specs.values()].map((f) => {
        const transform =
          f.side === 'front'
            ? `rotateY(${f.angle}deg)`
            : `rotateY(${f.angle}deg) translateX(${W / 2}px) rotateY(180deg) translateX(${-W / 2}px)`;
        return (
          <div
            key={`${f.sheet}:${f.side}`}
            className={`face face-${f.side}${f.hidden ? ' face-hidden' : ''}`}
            style={{ left: spine, width: W, height: PAGE_H, transform, zIndex: f.z }}
          >
            {renderFace(f.sheet, f.side, f.editable && !flip)}
            {f.shade > 0 && <div className={`shade shade-${f.side}`} style={{ opacity: f.shade }} />}
          </div>
        );
      })}
      {flip && (
        <div
          className={`cast-shadow ${shadowOnRight ? 'right' : 'left'}`}
          style={{ left: shadowOnRight ? spine : spine - W, width: W, opacity: shadowOpacity }}
        />
      )}
      <Rings left={spine - 30} />
      {(!flip || dragging) && (
        <>
          <div
            className="turn-zone next"
            style={{ left: spine + W - 34, width: 34 }}
            onPointerDown={zone.down('next')}
            onPointerMove={zone.move}
            onPointerUp={zone.up}
            onPointerCancel={zone.up}
            title="Arrastra para pasar la hoja"
          >
            <span className="dog-ear" />
          </div>
          {canPrev && (
            <div
              className="turn-zone prev"
              style={mode === 'spread' ? { left: 0, width: 34 } : { left: 0, width: MARGIN_LEFT - 8 }}
              onPointerDown={zone.down('prev')}
              onPointerMove={zone.move}
              onPointerUp={zone.up}
              onPointerCancel={zone.up}
              title="Arrastra para volver"
            >
              {mode === 'spread' && <span className="dog-ear left" />}
            </div>
          )}
        </>
      )}
      {tabsShown && (
        <div className="section-tabs" style={{ left: bookWidth(mode) }}>
          {sections.map((t, i) => (
            <button
              key={t.page}
              className={`section-tab${currentSection?.page === t.page ? ' current' : ''}`}
              style={{ top: 30 + i * 150, background: t.color }}
              onClick={() => onJump(t.page)}
              title={`Ir a ${t.title}`}
            >
              <span>{t.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
