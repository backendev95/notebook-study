import { useSyncExternalStore } from 'react';

/*
  Formato del texto que se está escribiendo (viñetas, alineación, negrita…).
  La caja de texto que tiene el cursor se registra aquí, y la barra de
  herramientas muestra los botones de formato mientras haya una activa.
*/

export type Align = 'left' | 'center' | 'right' | 'justify';
export interface FormatState {
  active: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  ul: boolean;
  ol: boolean;
  check: boolean;
  title: boolean;
  align: Align;
}

const empty: FormatState = {
  active: false,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  ul: false,
  ol: false,
  check: false,
  title: false,
  align: 'left',
};

let editor: HTMLElement | null = null;
let state: FormatState = empty;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function insideEditor(n: Node | null) {
  return !!editor && !!n && editor.contains(n);
}
function selectionNode(): HTMLElement | null {
  const sel = window.getSelection();
  const n = sel?.anchorNode ?? null;
  if (!n || !insideEditor(n)) return null;
  return (n.nodeType === 1 ? n : n.parentElement) as HTMLElement | null;
}

function read(): FormatState {
  if (!editor) return empty;
  const node = selectionNode();
  const q = (c: string) => {
    try {
      return document.queryCommandState(c);
    } catch {
      return false;
    }
  };
  // El párrafo donde está el cursor. Si el cursor quedó en el borde de la caja (por ejemplo
  // al volver a editar, o con una sola línea), se mira el párrafo que tiene al lado,
  // no la caja completa (que no tiene alineación propia).
  let block = (node && node !== editor ? node.closest('li, h3, p, div') : null) as HTMLElement | null;
  if (!block || block === editor || !editor.contains(block)) {
    const sel = window.getSelection();
    const kids = editor.children;
    const off = sel?.anchorNode === editor ? sel.anchorOffset : kids.length;
    block = ((kids[off - 1] ?? kids[off] ?? editor.lastElementChild) as HTMLElement | null) ?? editor;
  }
  const alignSrc = getComputedStyle(block).textAlign;
  const align: Align =
    alignSrc === 'center' ? 'center' : alignSrc === 'right' || alignSrc === 'end' ? 'right' : alignSrc === 'justify' ? 'justify' : 'left';
  return {
    active: true,
    bold: q('bold'),
    italic: q('italic'),
    underline: q('underline'),
    strike: q('strikeThrough'),
    ul: !!node?.closest('ul:not(.checklist)'),
    ol: !!node?.closest('ol'),
    check: !!node?.closest('ul.checklist'),
    title: !!node?.closest('h3'),
    align,
  };
}

function refresh() {
  const next = read();
  if (JSON.stringify(next) !== JSON.stringify(state)) {
    state = next;
    notify();
  }
}
document.addEventListener('selectionchange', () => editor && refresh());

export function setActiveEditor(node: HTMLElement | null) {
  editor = node;
  if (!node) {
    state = empty;
    notify();
  } else refresh();
}
export function releaseEditor(node: HTMLElement | null) {
  if (editor === node) setActiveEditor(null);
}

export function useTextFormat() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Avisa a la caja de texto que su contenido cambió (para que lo guarde) */
const changed = () => editor?.dispatchEvent(new Event('input', { bubbles: true }));

function exec(cmd: string, value?: string) {
  if (!editor) return;
  if (!insideEditor(window.getSelection()?.anchorNode ?? null)) editor.focus();
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand(cmd, false, value);
  changed();
  refresh();
}

/** Aplica a toda la caja (por ejemplo la alineación) y deja el cursor donde estaba */
function onWholeBox(fn: () => void) {
  if (!editor) return;
  const sel = window.getSelection();
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const all = document.createRange();
  all.selectNodeContents(editor);
  sel?.removeAllRanges();
  sel?.addRange(all);
  fn();
  sel?.removeAllRanges();
  if (saved) sel?.addRange(saved);
  else {
    const end = document.createRange();
    end.selectNodeContents(editor);
    end.collapse(false);
    sel?.addRange(end);
  }
}

export const format = {
  bold: () => exec('bold'),
  italic: () => exec('italic'),
  underline: () => exec('underline'),
  strike: () => exec('strikeThrough'),
  highlight: () => {
    if (!editor) return;
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('hiliteColor', false, '#fff1a8');
    document.execCommand('styleWithCSS', false, 'false');
    changed();
  },
  title: () => exec('formatBlock', read().title ? '<div>' : '<h3>'),
  bullets: () => {
    // si era lista de tareas, pasa a viñetas normales
    const ul = selectionNode()?.closest('ul.checklist');
    if (ul) {
      ul.classList.remove('checklist');
      changed();
      refresh();
      return;
    }
    exec('insertUnorderedList');
  },
  numbers: () => exec('insertOrderedList'),
  checklist: () => {
    const node = selectionNode();
    const ul = node?.closest('ul');
    if (ul?.classList.contains('checklist')) {
      exec('insertUnorderedList'); // quitar la lista
      return;
    }
    if (!ul) exec('insertUnorderedList');
    const list = selectionNode()?.closest('ul');
    list?.classList.add('checklist');
    changed();
    refresh();
  },
  indent: () => exec('indent'),
  outdent: () => exec('outdent'),
  align: (a: Align) =>
    onWholeBox(() => {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(a === 'left' ? 'justifyLeft' : a === 'center' ? 'justifyCenter' : a === 'right' ? 'justifyRight' : 'justifyFull');
      document.execCommand('styleWithCSS', false, 'false');
      changed();
      refresh();
    }),
};

/**
  ¿Hay una casilla de lista de tareas en este punto de la pantalla?
  (la casilla se dibuja a la izquierda del renglón, fuera del ítem, así que se busca por posición)
*/
export function checkboxAt(root: HTMLElement, clientX: number, clientY: number) {
  const items = root.querySelectorAll<HTMLElement>('ul.checklist > li');
  for (const li of items) {
    const r = li.getBoundingClientRect();
    const k = r.width / Math.max(1, li.offsetWidth);
    if (clientY >= r.top && clientY <= r.top + 24 * k && clientX >= r.left - 32 * k && clientX <= r.left + 2 * k) return li;
  }
  return null;
}

/** Marca / desmarca el ítem n de las listas de tareas dentro de un html guardado */
export function toggleCheck(html: string, index: number) {
  const t = document.createElement('template');
  t.innerHTML = html;
  const items = t.content.querySelectorAll('ul.checklist > li');
  const li = items[index];
  if (!li) return html;
  li.classList.toggle('done');
  return t.innerHTML;
}
