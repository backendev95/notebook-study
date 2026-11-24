import { db, getPages } from '../db';
import type { NoteElement } from '../types';

export interface SearchHit {
  notebookId: string;
  notebookTitle: string;
  page: number; // índice de la hoja (-1 = portada)
  elementId?: string;
  kind: string;
  snippet: string;
  start: number; // posición de la coincidencia dentro del snippet
  length: number;
}

const strip = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n');
  return d.textContent ?? '';
};
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function textOf(e: NoteElement): [string, string] | null {
  switch (e.type) {
    case 'text':
      return ['Texto', strip(e.html)];
    case 'sticky':
      return ['Nota', strip(e.html)];
    case 'math':
      return ['Fórmula', e.tex];
    case 'card':
      return ['Tarjeta', `${e.q} — ${e.a}`];
    default:
      return null;
  }
}

function snippetAround(text: string, idx: number, len: number) {
  const from = Math.max(0, idx - 40);
  const to = Math.min(text.length, idx + len + 60);
  const pre = from > 0 ? '…' : '';
  const s = pre + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
  const start = pre.length + text.slice(from, idx).replace(/\s+/g, ' ').length;
  return { snippet: s, start };
}

/** Busca en títulos, separadores, textos, notas, fórmulas y tarjetas (sin importar tildes) */
export async function search(query: string, notebookId?: string, limit = 80): Promise<SearchHit[]> {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const notebooks = (await db.notebooks.toArray()).filter((n) => !n.deleted && (!notebookId || n.id === notebookId));
  const hits: SearchHit[] = [];
  for (const nb of notebooks) {
    if (norm(nb.title).includes(q))
      hits.push({ notebookId: nb.id, notebookTitle: nb.title, page: -1, kind: 'Cuaderno', snippet: nb.title, start: norm(nb.title).indexOf(q), length: q.length });
    const pages = await getPages(nb.id);
    for (const [i, p] of pages.entries()) {
      if (p.sectionTitle && norm(p.sectionTitle).includes(q))
        hits.push({ notebookId: nb.id, notebookTitle: nb.title, page: i, kind: 'Separador', snippet: p.sectionTitle, start: norm(p.sectionTitle).indexOf(q), length: q.length });
      const els = (await db.elements.where('pageId').equals(p.id).toArray()).filter((e) => !e.deleted);
      for (const e of els.sort((a, b) => a.y - b.y)) {
        const t = textOf(e);
        if (!t) continue;
        const idx = norm(t[1]).indexOf(q);
        if (idx < 0) continue;
        const { snippet, start } = snippetAround(t[1], idx, q.length);
        hits.push({ notebookId: nb.id, notebookTitle: nb.title, page: i, elementId: e.id, kind: t[0], snippet, start, length: q.length });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
