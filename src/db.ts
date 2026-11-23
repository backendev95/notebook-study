import Dexie, { type EntityTable } from 'dexie';
import type { Asset, NoteElement, Notebook, Page } from './types';

// Base de datos local (IndexedDB). Funciona sin conexión; en la fase 2
// se sincroniza con Supabase usando updatedAt/deleted.
export const db = new Dexie('notebook-study') as Dexie & {
  notebooks: EntityTable<Notebook, 'id'>;
  pages: EntityTable<Page, 'id'>;
  elements: EntityTable<NoteElement, 'id'>;
  assets: EntityTable<Asset, 'id'>;
};

db.version(1).stores({
  notebooks: 'id, updatedAt',
  pages: 'id, notebookId, [notebookId+order], updatedAt',
  elements: 'id, pageId, updatedAt',
  assets: 'id',
});

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

export async function createNotebook(title: string, color: string, pages = 3) {
  const id = uid();
  const t = now();
  await db.transaction('rw', db.notebooks, db.pages, async () => {
    await db.notebooks.add({ id, title, color, createdAt: t, updatedAt: t, lastPage: -1 });
    await db.pages.bulkAdd(
      Array.from({ length: pages }, (_, i) => ({ id: uid(), notebookId: id, order: i, updatedAt: t })),
    );
  });
  return id;
}

export async function getPages(notebookId: string) {
  const pages = await db.pages.where('notebookId').equals(notebookId).toArray();
  return pages.filter((p) => !p.deleted).sort((a, b) => a.order - b.order);
}

export async function addPageAtEnd(notebookId: string) {
  const pages = await getPages(notebookId);
  const order = pages.length ? pages[pages.length - 1].order + 1 : 0;
  const page: Page = { id: uid(), notebookId, order, updatedAt: now() };
  await db.pages.add(page);
  return page;
}

export async function addElement(el: NoteElement) {
  await db.elements.add(el);
}

export async function updateElement(id: string, changes: Partial<NoteElement>) {
  await db.elements.update(id, { ...changes, updatedAt: now() } as Partial<NoteElement>);
}

export async function deleteElement(id: string) {
  // borrado "suave" para que se pueda sincronizar
  await db.elements.update(id, { deleted: true, updatedAt: now() });
}

export async function saveAsset(blob: Blob) {
  const id = uid();
  await db.assets.add({ id, blob, mime: blob.type, updatedAt: now() });
  return id;
}

export async function nextZ(pageId: string) {
  const els = await db.elements.where('pageId').equals(pageId).toArray();
  return els.reduce((m, e) => Math.max(m, e.z), 0) + 1;
}

/** Lee el tamaño natural de una imagen para colocarla con la proporción correcta */
export function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ w: 300, h: 200 });
    img.src = url;
  });
}
