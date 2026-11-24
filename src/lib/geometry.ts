import type { InkElement, NoteElement, ShapeKind } from '../types';
import { inkBounds } from './ink';

export type Pt = [number, number];
type P3 = [number, number, number];

const dist = (a: Pt | P3, b: Pt | P3) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- Figuras: puntos de cada forma ----------
function lerp(a: Pt, b: Pt, steps: number): P3[] {
  const out: P3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.5]);
  }
  return out;
}

function polyline(pts: Pt[], closed = false): P3[] {
  const all = closed ? [...pts, pts[0]] : pts;
  const out: P3[] = [];
  for (let i = 0; i < all.length - 1; i++) {
    const seg = lerp(all[i], all[i + 1], Math.max(2, Math.round(dist(all[i], all[i + 1]) / 8)));
    out.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return out;
}

/** Puntos de una figura limpia entre dos esquinas (a = inicio, b = fin del arrastre) */
export function shapePoints(kind: ShapeKind, a: Pt, b: Pt): P3[] {
  const [x0, y0] = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
  const [x1, y1] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  switch (kind) {
    case 'line':
      return polyline([a, b]);
    case 'arrow': {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const len = Math.min(28, dist(a, b) * 0.35);
      const l: Pt = [b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)];
      const r: Pt = [b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)];
      return polyline([a, b, l, b, r]);
    }
    case 'rect':
      return polyline(
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
        true,
      );
    case 'triangle':
      return polyline(
        [
          [(x0 + x1) / 2, y0],
          [x1, y1],
          [x0, y1],
        ],
        true,
      );
    case 'ellipse': {
      const cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2,
        rx = (x1 - x0) / 2,
        ry = (y1 - y0) / 2;
      const n = Math.max(24, Math.round((rx + ry) / 3));
      const out: P3[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t), 0.5]);
      }
      return out;
    }
  }
}

// ---------- Reconocer figuras dibujadas a mano ----------
function perpDist(p: Pt, a: Pt, b: Pt) {
  const L = dist(a, b);
  if (L === 0) return dist(p, a);
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
}

/** Simplificación Douglas–Peucker */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let idx = 0,
    max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

/**
  Si el trazo parece una línea, un círculo/óvalo, un rectángulo o un triángulo,
  devuelve los puntos de la figura limpia. Si no, devuelve null.
*/
export function recognize(raw: P3[]): { kind: ShapeKind; points: P3[] } | null {
  if (raw.length < 4) return null;
  const pts: Pt[] = raw.map(([x, y]) => [x, y]);
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 20) return null;
  const first = pts[0],
    last = pts[pts.length - 1];
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);

  // Línea recta: casi todos los puntos cerca de la recta inicio-fin
  const maxDev = Math.max(...pts.map((p) => perpDist(p, first, last)));
  if (maxDev < Math.max(6, dist(first, last) * 0.06) && dist(first, last) > length * 0.85)
    return { kind: 'line', points: shapePoints('line', first, last) };

  const closed = dist(first, last) < Math.max(24, diag * 0.22);
  if (!closed) return null;

  // Óvalo: distancia normalizada al centro casi constante
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    rx = (x1 - x0) / 2 || 1,
    ry = (y1 - y0) / 2 || 1;
  const dev = pts.reduce((s, p) => s + Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1), 0) / pts.length;

  const simple = simplify([...pts, first], diag * 0.09);
  const corners = simple.length - 1; // el último repite el primero

  if (corners === 3) return { kind: 'triangle', points: polyline(simple.slice(0, 3) as Pt[], true) };
  if (corners === 4) {
    // rectángulo alineado si los lados son casi horizontales/verticales
    return { kind: 'rect', points: shapePoints('rect', [x0, y0], [x1, y1]) };
  }
  if (dev < 0.16) return { kind: 'ellipse', points: shapePoints('ellipse', [x0, y0], [x1, y1]) };
  return null;
}

// ---------- Lazo ----------
export function pointInPolygon(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** ¿El elemento quedó encerrado por el lazo? (trazos: la mayoría de sus puntos) */
export function insideLasso(el: NoteElement, poly: Pt[]) {
  if (el.type === 'ink') {
    const step = Math.max(1, Math.floor(el.points.length / 30));
    let n = 0,
      inn = 0;
    for (let i = 0; i < el.points.length; i += step) {
      n++;
      if (pointInPolygon([el.points[i][0], el.points[i][1]], poly)) inn++;
    }
    return inn / n > 0.6;
  }
  return pointInPolygon([el.x + el.w / 2, el.y + el.h / 2], poly);
}

// ---------- Mover / escalar varios elementos ----------
export interface Transform {
  ox: number; // origen de la escala
  oy: number;
  s: number; // escala
  dx: number;
  dy: number;
}
export const identity: Transform = { ox: 0, oy: 0, s: 1, dx: 0, dy: 0 };

export function transformElement<T extends NoteElement>(el: T, t: Transform): T {
  const X = (x: number) => t.ox + (x - t.ox) * t.s + t.dx;
  const Y = (y: number) => t.oy + (y - t.oy) * t.s + t.dy;
  if (el.type === 'ink') {
    const ink = el as InkElement;
    const points = ink.points.map(([x, y, p]) => [X(x), Y(y), p] as P3);
    const size = ink.size * t.s;
    return { ...el, points, size, ...inkBounds(points, size / 2) };
  }
  return { ...el, x: X(el.x), y: Y(el.y), w: el.w * t.s, h: el.h * t.s };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)),
    y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)),
    y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
