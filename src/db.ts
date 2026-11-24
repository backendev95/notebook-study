import Dexie, { type EntityTable } from 'dexie';
import type { Asset, NoteElement, Notebook, Page } from './types';

// Base de datos local (IndexedDB). Funciona sin conexión; cuando hay sesión
// se sincroniza con Supabase (ver lib/sync.ts) usando updatedAt/deleted/dirty.
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

// v2: índice `dirty` = cambios locales pendientes de subir a la nube
db.version(2)
  .stores({
    notebooks: 'id, updatedAt, dirty',
    pages: 'id, notebookId, [notebookId+order], updatedAt, dirty',
    elements: 'id, pageId, updatedAt, dirty',
    assets: 'id, dirty',
  })
  .upgrade(async (tx) => {
    for (const t of ['notebooks', 'pages', 'elements', 'assets'])
      await tx.table(t).toCollection().modify((r: { dirty?: number }) => {
        r.dirty = 1;
      });
  });

export const syncTables = () => [db.notebooks, db.pages, db.elements, db.assets];

// Todo cambio hecho en este dispositivo queda marcado como pendiente (dirty = 1),
// salvo los que escribe la sincronización (transacciones marcadas con __remote).
type Tx = { __remote?: boolean };
export const localChanges = new EventTarget();
for (const table of syncTables()) {
  table.hook('creating', (_pk, obj, tx) => {
    const o = obj as { dirty?: number };
    if ((tx as unknown as Tx).__remote) o.dirty ??= 0;
    else {
      o.dirty = 1;
      localChanges.dispatchEvent(new Event('change'));
    }
  });
  table.hook('updating', (mods, _pk, _obj, tx) => {
    if ((tx as unknown as Tx).__remote || 'dirty' in mods) return;
    localChanges.dispatchEvent(new Event('change'));
    return { dirty: 1 };
  });
}

/** Escrituras que vienen de la nube: no se marcan como pendientes */
export function remoteWrite<T>(fn: () => Promise<T>) {
  return db.transaction('rw', syncTables(), (tx) => {
    (tx as unknown as Tx).__remote = true;
    return fn();
  });
}

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

// La última hoja abierta es algo de cada dispositivo: va en localStorage, no se sincroniza
export const getLastPage = (notebookId: string) => Number(localStorage.getItem(`nbs-last-${notebookId}`) ?? -1);
export const setLastPage = (notebookId: string, page: number) =>
  localStorage.setItem(`nbs-last-${notebookId}`, String(page));

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
