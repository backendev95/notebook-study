import { db, now } from '../db';
import type { NoteElement } from '../types';

/*
  Deshacer / rehacer por hoja.
  Cada acción guarda cómo estaban los elementos ANTES y DESPUÉS.
  Deshacer vuelve al "antes" (y rehacer al "después") escribiendo una versión
  nueva, así el cambio también se sincroniza con los otros dispositivos.
*/

export interface Change {
  id: string;
  before?: NoteElement; // undefined = no existía
  after?: NoteElement; // undefined = se borró
}
interface Entry {
  changes: Change[];
}

const LIMIT = 200;
const undoStacks = new Map<string, Entry[]>();
const redoStacks = new Map<string, Entry[]>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

export const historyStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getVersion: () => version,
};

const stack = (m: Map<string, Entry[]>, pageId: string) => {
  let s = m.get(pageId);
  if (!s) m.set(pageId, (s = []));
  return s;
};

export function record(pageId: string, changes: Change[]) {
  const useful = changes.filter((c) => c.before || c.after);
  if (!useful.length) return;
  const s = stack(undoStacks, pageId);
  s.push({ changes: useful });
  if (s.length > LIMIT) s.shift();
  redoStacks.set(pageId, []);
  notify();
}

export const canUndo = (pageId?: string) => !!pageId && (undoStacks.get(pageId)?.length ?? 0) > 0;
export const canRedo = (pageId?: string) => !!pageId && (redoStacks.get(pageId)?.length ?? 0) > 0;

async function apply(changes: Change[], to: 'before' | 'after') {
  const t = now();
  await db.transaction('rw', db.elements, async () => {
    for (const c of changes) {
      const target = c[to];
      if (target) await db.elements.put({ ...target, deleted: false, updatedAt: t } as NoteElement);
      else {
        const cur = await db.elements.get(c.id);
        if (cur && !cur.deleted) await db.elements.update(c.id, { deleted: true, updatedAt: t });
      }
    }
  });
}

export async function undo(pageId: string) {
  const e = undoStacks.get(pageId)?.pop();
  if (!e) return false;
  await apply(e.changes, 'before');
  stack(redoStacks, pageId).push(e);
  notify();
  return true;
}

export async function redo(pageId: string) {
  const e = redoStacks.get(pageId)?.pop();
  if (!e) return false;
  await apply(e.changes, 'after');
  stack(undoStacks, pageId).push(e);
  notify();
  return true;
}

// ---------- Ediciones que se pueden deshacer ----------
const strip = (e: NoteElement): NoteElement => {
  const { dirty: _d, ...rest } = e as NoteElement & { dirty?: number };
  void _d;
  return rest as NoteElement;
};

export async function addElements(els: NoteElement[], opts: { record?: boolean } = {}) {
  if (!els.length) return;
  await db.elements.bulkAdd(els);
  if (opts.record !== false) record(els[0].pageId, els.map((e) => ({ id: e.id, after: strip(e) })));
}

export async function updateElements(
  updates: { id: string; changes: Partial<NoteElement> }[],
  opts: { record?: boolean } = {},
) {
  if (!updates.length) return;
  const t = now();
  const changes: Change[] = [];
  let pageId = '';
  await db.transaction('rw', db.elements, async () => {
    for (const u of updates) {
      const before = await db.elements.get(u.id);
      if (!before) continue;
      pageId = before.pageId;
      const after = { ...before, ...u.changes, updatedAt: t } as NoteElement;
      await db.elements.put(after);
      changes.push({ id: u.id, before: strip(before), after: strip(after) });
    }
  });
  if (opts.record !== false && pageId) record(pageId, changes);
}

export async function deleteElements(ids: string[], opts: { record?: boolean } = {}) {
  if (!ids.length) return;
  const t = now();
  const changes: Change[] = [];
  let pageId = '';
  await db.transaction('rw', db.elements, async () => {
    for (const id of ids) {
      const before = await db.elements.get(id);
      if (!before || before.deleted) continue;
      pageId = before.pageId;
      await db.elements.update(id, { deleted: true, updatedAt: t });
      changes.push({ id, before: strip(before) });
    }
  });
  if (opts.record !== false && pageId) record(pageId, changes);
}
