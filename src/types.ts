// Modelo de datos del cuaderno.
// Todas las entidades llevan `id` (uuid), `updatedAt` y `deleted` para que
// la sincronización con la nube pueda resolver cambios entre dispositivos.

export type PaperType = 'grid' | 'lined' | 'dotted' | 'blank';

export interface Notebook {
  id: string;
  title: string;
  color: string; // color de la portada
  paper?: PaperType; // tipo de hoja por defecto (cuadriculada si no se indica)
  coverAssetId?: string | null; // foto de portada opcional
  createdAt: number;
  updatedAt: number;
  lastPage?: number; // obsoleto: ahora se guarda en localStorage
  deleted?: boolean;
  dirty?: number;
}

export interface Page {
  id: string;
  notebookId: string;
  order: number; // posición de la hoja dentro del cuaderno
  paper?: PaperType | null; // null = la del cuaderno
  sectionTitle?: string | null; // si tiene título, aquí empieza una sección (separador)
  sectionColor?: string | null;
  updatedAt: number;
  deleted?: boolean;
  dirty?: number;
}

interface BaseElement {
  id: string;
  pageId: string;
  x: number; // coordenadas en unidades de página (ver PAGE_W / PAGE_H)
  y: number;
  w: number;
  h: number;
  z: number;
  updatedAt: number;
  deleted?: boolean;
  dirty?: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  html: string;
  color: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  assetId: string;
  locked?: boolean; // fondo fijo (por ejemplo, una página de PDF importada)
}

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle';

export interface InkElement extends BaseElement {
  type: 'ink';
  points: [number, number, number][]; // x, y, presión
  color: string;
  size: number;
  opacity: number; // < 1 para el resaltador
  pen: boolean; // true si se dibujó con lápiz (presión real)
  shape?: ShapeKind; // si es una figura limpia (trazo de grosor uniforme)
}

/** Nota adhesiva (post-it) */
export interface StickyElement extends BaseElement {
  type: 'sticky';
  html: string;
  color: string; // color del papel
  rot: number; // leve inclinación en grados
}

/** Fórmula matemática en LaTeX */
export interface MathElement extends BaseElement {
  type: 'math';
  tex: string;
  color: string;
}

/** Tarjeta de repaso: pregunta al frente, respuesta atrás */
export interface CardElement extends BaseElement {
  type: 'card';
  q: string;
  a: string;
  box: number; // caja Leitner (1 = repasar seguido … 5 = dominada)
  due: number; // cuándo toca repasarla (ms)
}

export type NoteElement = TextElement | ImageElement | InkElement | StickyElement | MathElement | CardElement;
export type ElementType = NoteElement['type'];

export interface Asset {
  id: string;
  blob: Blob;
  mime: string;
  updatedAt: number;
  dirty?: number;
}

export type Tool =
  | 'select'
  | 'lasso'
  | 'text'
  | 'pen'
  | 'marker'
  | 'shape'
  | 'eraser'
  | 'sticky'
  | 'math'
  | 'card';

// Tamaño lógico de una hoja (proporción carta) y tamaño del cuadro de la cuadrícula
export const PAGE_W = 816;
export const PAGE_H = 1056;
export const GRID = 24;
export const MARGIN_LEFT = 56; // zona de perforaciones para los anillos

export const PAPER_LABELS: Record<PaperType, string> = {
  grid: 'Cuadriculada',
  lined: 'Rayada',
  dotted: 'Punteada',
  blank: 'Blanca',
};
