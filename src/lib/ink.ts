import { getStroke } from 'perfect-freehand';
import type { InkElement } from '../types';

function svgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
      return acc;
    },
    ['M', ...stroke[0].map((n) => n.toFixed(2)), 'Q'],
  );
  d.push('Z');
  return d.join(' ');
}

/** Convierte los puntos capturados en un contorno suave (con presión si viene de un lápiz) */
export function inkPath(el: Pick<InkElement, 'points' | 'size' | 'pen' | 'opacity' | 'shape'>, complete = true) {
  const marker = el.opacity < 1;
  const uniform = marker || !!el.shape;
  const stroke = getStroke(el.points, {
    size: el.size,
    thinning: uniform ? 0 : el.pen ? 0.65 : 0.5,
    smoothing: el.shape ? 0.2 : 0.55,
    streamline: el.shape ? 0.1 : 0.45,
    simulatePressure: !el.pen && !uniform,
    last: complete,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  });
  return svgPathFromStroke(stroke);
}

export function inkBounds(points: [number, number, number][], pad: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}
