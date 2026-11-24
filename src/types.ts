// Modelo de datos del cuaderno.
// Todas las entidades llevan `id` (uuid), `updatedAt` y `deleted` para que
// la sincronización con la nube (fase 2) pueda resolver cambios entre dispositivos.

export interface Notebook {
  id: string;
  title: string;
  color: string; // color de la portada
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
}

export interface InkElement extends BaseElement {
  type: 'ink';
  points: [number, number, number][]; // x, y, presión
  color: string;
  size: number;
  opacity: number; // < 1 para el resaltador
  pen: boolean; // true si se dibujó con lápiz (presión real)
}

export type NoteElement = TextElement | ImageElement | InkElement;

export interface Asset {
  id: string;
  blob: Blob;
  mime: string;
  updatedAt: number;
  dirty?: number;
}

export type Tool = 'select' | 'text' | 'pen' | 'marker' | 'eraser';

// Tamaño lógico de una hoja (proporción carta) y tamaño del cuadro de la cuadrícula
export const PAGE_W = 816;
export const PAGE_H = 1056;
export const GRID = 24;
export const MARGIN_LEFT = 56; // zona de perforaciones para los anillos
