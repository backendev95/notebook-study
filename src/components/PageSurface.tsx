import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, now, uid } from '../db';
import { addElements, deleteElements, updateElements } from '../lib/history';
import { inkBounds } from '../lib/ink';
import { insertImage } from '../lib/images';
import { cancelGestures, gestureBus, input, markPen } from '../lib/input';
import {
  identity,
  insideLasso,
  recognize,
  shapePoints,
  transformElement,
  unionBox,
  type Box,
  type Pt,
  type Transform,
} from '../lib/geometry';
import {
  GRID,
  MARGIN_LEFT,
  PAGE_H,
  PAGE_W,
  type CardElement,
  type ImageElement,
  type InkElement,
  type MathElement,
  type NoteElement,
  type PaperType,
  type ShapeKind,
  type StickyElement,
  type TextElement,
  type Tool,
} from '../types';
import {
  CardBox,
  CardEditor,
  EditableBox,
  ImageBox,
  InkPath,
  MathBox,
  MathEditor,
  SelectionOverlay,
  measureTex,
} from './elements';
import { Holes } from './Paper';

export interface PenSettings {
  tool: Tool;
  penColor: string;
  penSize: number;
  markerColor: string;
  textColor: string;
  shapeKind: ShapeKind;
  stickyColor: string;
}

export const INK_COLORS = ['#1f2430', '#2456c9', '#d23b3b', '#1f8a4c', '#7b3fc4', '#e07b00'];
export const MARKER_COLORS = ['#ffd84a', '#8be38b', '#ff9ccf', '#7fd3ff'];
export const STICKY_COLORS = ['#fff3a0', '#ffd0e0', '#c8f0c8', '#cde7ff', '#ffdcae'];

interface Props {
  pageId: string | undefined;
  pageNumber: number;
  editable: boolean;
  /** la hoja donde actúan el teclado, pegar y deshacer */
  active?: boolean;
  settings: PenSettings;
  paper: PaperType;
  /** de qué lado están los anillos */
  bind?: 'left' | 'right';
  highlightId?: string;
  onActivate?: () => void;
  /** cambiar la herramienta a "Seleccionar y mover" */
  onSelectTool?: () => void;
}

// ---------- Portapapeles interno (copiar / pegar elementos) ----------
let clip: NoteElement[] = [];
const CLIP_MARK = 'notebook-study:elementos';
export const hasClip = () => clip.length > 0;
export const isClipMarker = (text: string) => text.startsWith(CLIP_MARK);
const selectBus = new EventTarget();

function copyToClip(els: NoteElement[]) {
  clip = els.map((e) => ({ ...e }));
  navigator.clipboard?.writeText(`${CLIP_MARK} (${els.length})`).catch(() => undefined);
}

async function maxZ(pageId: string) {
  const els = await db.elements.where('pageId').equals(pageId).toArray();
  return els.reduce((m, e) => Math.max(m, e.z), 0);
}

/** Pega lo copiado en una hoja (un poco corrido para que se note) */
export async function pasteClip(pageId: string, offset = 24) {
  if (!clip.length) return;
  let z = await maxZ(pageId);
  const t = now();
  const copies = clip.map((e) => {
    const moved = transformElement(e, { ...identity, dx: e.pageId === pageId ? offset : 0, dy: e.pageId === pageId ? offset : 0 });
    return { ...moved, id: uid(), pageId, z: ++z, updatedAt: t, deleted: false } as NoteElement;
  });
  await addElements(copies);
  clip = copies.map((c) => ({ ...c }));
  selectBus.dispatchEvent(new CustomEvent('select', { detail: { pageId, ids: copies.map((c) => c.id) } }));
}

/** Crea una caja de texto con lo pegado desde otra aplicación */
export async function pasteText(pageId: string, text: string) {
  const html = text
    .split('\n')
    .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
    .join('<br>');
  const el: TextElement = {
    id: uid(),
    pageId,
    type: 'text',
    x: MARGIN_LEFT + 40,
    y: GRID * 6,
    w: 520,
    h: GRID * (text.split('\n').length + 1),
    z: (await maxZ(pageId)) + 1,
    updatedAt: now(),
    html,
    color: '#1f2430',
  };
  await addElements([el]);
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type P3 = [number, number, number];

export const PageSurface = memo(function PageSurface({
  pageId,
  pageNumber,
  editable,
  active = editable,
  settings,
  paper,
  bind = 'left',
  highlightId,
  onActivate,
  onSelectTool,
}: Props) {
  const { tool } = settings;
  const elements =
    useLiveQuery(
      async () =>
        pageId ? (await db.elements.where('pageId').equals(pageId).toArray()).filter((e) => !e.deleted) : [],
      [pageId],
    ) ?? [];

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingBoxes, setPendingBoxes] = useState<(TextElement | StickyElement)[]>([]);
  const [live, setLive] = useState<InkElement | null>(null);
  const [lasso, setLasso] = useState<Pt[] | null>(null);
  const [xf, setXf] = useState<Transform | null>(null);
  const [optimistic, setOptimistic] = useState<Map<string, NoteElement> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mathEdit, setMathEdit] = useState<{ id?: string; at: Pt; tex: string } | null>(null);
  const [cardEdit, setCardEdit] = useState<{ id?: string; at: Pt; q: string; a: string } | null>(null);

  const liveRef = useRef<InkElement | null>(null);
  const shapeStart = useRef<Pt | null>(null);
  const snapped = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lassoRef = useRef<Pt[] | null>(null);
  const erasing = useRef<Set<string> | null>(null);
  const gesture = useRef<{ kind: 'move' | 'scale'; start: Pt; box: Box; moved: boolean } | null>(null);
  const xfRef = useRef<Transform | null>(null);
  xfRef.current = xf;
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const fresh = useRef(new Set<string>()); // cajas recién creadas (aún sin guardar)

  // ---------- reinicios ----------
  useEffect(() => {
    if (!editable) {
      setSelected([]);
      setEditingId(null);
    }
  }, [editable]);
  useEffect(() => {
    if (tool !== 'select' && tool !== 'lasso') setSelected([]);
    if (tool !== 'select' && tool !== 'text' && tool !== 'sticky') setEditingId(null);
  }, [tool]);

  // cancelar el trazo si empieza un gesto de dos dedos (zoom)
  useEffect(() => {
    const cancel = () => {
      clearTimeout(holdTimer.current);
      liveRef.current = null;
      setLive(null);
      lassoRef.current = null;
      setLasso(null);
      gesture.current = null;
      setXf(null);
      if (erasing.current) {
        erasing.current = null;
        setHidden(new Set());
      }
    };
    gestureBus.addEventListener('cancel', cancel);
    return () => gestureBus.removeEventListener('cancel', cancel);
  }, []);

  // seleccionar lo que se acaba de pegar
  useEffect(() => {
    const on = (e: Event) => {
      const { pageId: p, ids } = (e as CustomEvent).detail;
      if (p === pageId) setSelected(ids);
    };
    selectBus.addEventListener('select', on);
    return () => selectBus.removeEventListener('select', on);
  }, [pageId]);

  // limpiar estados temporales cuando la base de datos ya refleja el cambio
  useEffect(() => {
    if (live && !liveRef.current && elements.some((e) => e.id === live.id)) setLive(null);
    if (pendingBoxes.some((p) => elements.some((e) => e.id === p.id)))
      setPendingBoxes((ps) => ps.filter((p) => !elements.some((e) => e.id === p.id)));
    if (optimistic) {
      const done = [...optimistic.values()].every((o) => {
        const e = elements.find((x) => x.id === o.id);
        return !e || e.updatedAt >= o.updatedAt;
      });
      if (done) setOptimistic(null);
    }
    if (hidden.size && [...hidden].every((id) => !elements.some((e) => e.id === id))) setHidden(new Set());
    if (selected.some((id) => !elements.some((e) => e.id === id) && !pendingBoxes.some((p) => p.id === id)))
      setSelected((s) => s.filter((id) => elements.some((e) => e.id === id)));
  }, [elements]); // eslint-disable-line react-hooks/exhaustive-deps

  // resaltar un elemento encontrado con la búsqueda
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => {
      const node = surfaceRef.current?.querySelector(`[data-el="${highlightId}"]`);
      node?.classList.add('flash');
      setTimeout(() => node?.classList.remove('flash'), 2600);
    }, 400);
    return () => clearTimeout(t);
  }, [highlightId, elements.length]);

  // ---------- teclado ----------
  useEffect(() => {
    if (!editable || !active) return;
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (editingId || (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) return;
      const mod = e.ctrlKey || e.metaKey;
      const sel = selectedRef.current;
      if (sel.length && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteElements(sel);
        setSelected([]);
      } else if (e.key === 'Escape') setSelected([]);
      else if (mod && e.key.toLowerCase() === 'a' && pageId) {
        e.preventDefault();
        setSelected(elementsRef.current.filter((x) => !(x.type === 'image' && x.locked)).map((x) => x.id));
      } else if (mod && sel.length && e.key.toLowerCase() === 'c') {
        copyToClip(elementsRef.current.filter((x) => sel.includes(x.id)));
      } else if (mod && sel.length && e.key.toLowerCase() === 'x') {
        copyToClip(elementsRef.current.filter((x) => sel.includes(x.id)));
        deleteElements(sel);
        setSelected([]);
      } else if (mod && sel.length && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = surfaceRef.current!.getBoundingClientRect();
    // si la hoja está volteada (página izquierda), el rectángulo sigue siendo correcto
    return [((e.clientX - r.left) / r.width) * PAGE_W, ((e.clientY - r.top) / r.height) * PAGE_H];
  };
  const marginX = (w: number): [number, number] =>
    bind === 'left' ? [MARGIN_LEFT + 4, PAGE_W - w - 8] : [8, PAGE_W - MARGIN_LEFT - w - 4];

  /**
    Ancho libre para una caja de texto nueva: desde donde tocaste hasta lo primero que
    haya a la derecha en ese renglón (imagen, nota, fórmula, tarjeta u otro texto).
    Si no hay nada, llega hasta el borde de la hoja.
  */
  const freeWidth = (x: number, y: number) => {
    const right = bind === 'left' ? PAGE_W - 20 : PAGE_W - MARGIN_LEFT - 8;
    const top = y;
    const bottom = y + GRID * 2; // el renglón donde empiezas y el siguiente
    let limit = right;
    for (const o of elementsRef.current) {
      if (o.type === 'ink' || (o.type === 'image' && o.locked)) continue; // trazos y fondos de PDF no estorban
      let h = o.h;
      if (o.type === 'text' || o.type === 'sticky') {
        const node = surfaceRef.current?.querySelector<HTMLElement>(`[data-el="${o.id}"]`);
        h = node?.offsetHeight ?? o.h;
      }
      const overlapsRow = o.y < bottom && o.y + h > top;
      if (!overlapsRow) continue;
      if (o.x > x && o.x < limit) limit = o.x - 10;
    }
    return Math.max(120, limit - x);
  };

  // ---------- borrador ----------
  const eraseAt = (p: Pt) => {
    const r = 10;
    const set = erasing.current;
    if (!set) return;
    let changed = false;
    for (const el of elementsRef.current) {
      if (el.type !== 'ink' || set.has(el.id)) continue;
      const reach = r + el.size / 2;
      if (p[0] < el.x - reach || p[0] > el.x + el.w + reach || p[1] < el.y - reach || p[1] > el.y + el.h + reach)
        continue;
      if (el.points.some(([x, y]) => (x - p[0]) ** 2 + (y - p[1]) ** 2 < reach * reach)) {
        set.add(el.id);
        changed = true;
      }
    }
    if (changed) setHidden(new Set(set));
  };

  // ---------- selección ----------
  const selectionBox = (): Box | null => {
    const els = elementsRef.current.filter((e) => selectedRef.current.includes(e.id));
    return unionBox(
      els.map((e) => {
        if (e.type === 'text' || e.type === 'sticky') {
          const node = surfaceRef.current?.querySelector<HTMLElement>(`[data-el="${e.id}"]`);
          return { x: e.x, y: e.y, w: e.w, h: node?.offsetHeight ?? e.h };
        }
        return e;
      }),
    );
  };

  const duplicate = async () => {
    const els = elementsRef.current.filter((e) => selectedRef.current.includes(e.id));
    if (!pageId || !els.length) return;
    copyToClip(els);
    await pasteClip(pageId);
  };

  // las ventanas (fórmula, tarjeta) se dibujan fuera de la hoja: sus clics no son de la hoja
  const outside = (e: { target: EventTarget }) => !surfaceRef.current?.contains(e.target as Node);

  const onPointerDown = async (e: React.PointerEvent) => {
    if (!editable || !pageId || outside(e)) return;
    onActivate?.();
    if (e.pointerType === 'pen') markPen();
    const target = e.target as HTMLElement;
    if (target.closest('[data-action]')) return;
    const elNode = target.closest<HTMLElement>('[data-el]');
    const onHandle = !!target.closest('[data-handle]');
    const inSelection = !!target.closest('.selection-box');
    const p = toPage(e);
    const activeTool: Tool = e.pointerType === 'pen' && e.buttons & 32 ? 'eraser' : tool;
    const drawing = ['pen', 'marker', 'shape', 'eraser', 'lasso'].includes(activeTool);
    // con lápiz, el dedo no dibuja: sirve para desplazar la hoja
    if (e.pointerType === 'touch' && input.penSeen && drawing) return;

    // mover / escalar lo seleccionado
    if ((activeTool === 'select' || activeTool === 'lasso') && selectedRef.current.length && (onHandle || inSelection)) {
      const box = selectionBox();
      const lockedOnly = elementsRef.current.some(
        (x) => selectedRef.current.includes(x.id) && x.type === 'image' && x.locked,
      );
      if (box && !lockedOnly) {
        e.preventDefault();
        surfaceRef.current!.setPointerCapture(e.pointerId);
        gesture.current = { kind: onHandle ? 'scale' : 'move', start: p, box, moved: false };
      }
      return;
    }

    if (activeTool === 'pen' || activeTool === 'marker') {
      if (elNode?.dataset.editing) return;
      e.preventDefault();
      surfaceRef.current!.setPointerCapture(e.pointerId);
      const marker = activeTool === 'marker';
      const ink: InkElement = {
        id: uid(),
        pageId,
        type: 'ink',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        z: 0,
        updatedAt: now(),
        points: [[p[0], p[1], e.pressure || 0.5]],
        color: marker ? settings.markerColor : settings.penColor,
        size: marker ? 20 : settings.penSize,
        opacity: marker ? 0.38 : 1,
        pen: e.pointerType === 'pen',
      };
      liveRef.current = ink;
      snapped.current = false;
      setLive(ink);
      return;
    }

    if (activeTool === 'shape') {
      e.preventDefault();
      surfaceRef.current!.setPointerCapture(e.pointerId);
      shapeStart.current = p;
      const ink: InkElement = {
        id: uid(),
        pageId,
        type: 'ink',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        z: 0,
        updatedAt: now(),
        points: shapePoints(settings.shapeKind, p, p),
        color: settings.penColor,
        size: settings.penSize,
        opacity: 1,
        pen: false,
        shape: settings.shapeKind,
      };
      liveRef.current = ink;
      setLive(ink);
      return;
    }

    if (activeTool === 'eraser') {
      e.preventDefault();
      surfaceRef.current!.setPointerCapture(e.pointerId);
      erasing.current = new Set();
      eraseAt(p);
      return;
    }

    if (activeTool === 'lasso') {
      e.preventDefault();
      surfaceRef.current!.setPointerCapture(e.pointerId);
      setSelected([]);
      lassoRef.current = [p];
      setLasso([p]);
      return;
    }

    const hit = elNode ? elementsRef.current.find((x) => x.id === elNode.dataset.el) : undefined;

    if (activeTool === 'text' || activeTool === 'sticky') {
      const kind = activeTool === 'text' ? 'text' : 'sticky';
      // Si estabas escribiendo y tocas fuera de la caja: se guarda el texto, queda
      // seleccionado y la herramienta cambia a "Seleccionar y mover" (no se crea otra caja)
      if (editingId && hit?.id !== editingId) {
        e.preventDefault();
        const id = editingId;
        (document.activeElement as HTMLElement | null)?.blur?.();
        setEditingId(null);
        setSelected([id]);
        onSelectTool?.();
        return;
      }
      if (hit?.type === kind) {
        setEditingId(hit.id);
        return;
      }
      if (elNode?.dataset.editing) return;
      e.preventDefault();
      const z = elementsRef.current.reduce((m, x) => Math.max(m, x.z), 0) + 1;
      let el: TextElement | StickyElement;
      if (kind === 'text') {
        const [mx, Mx] = marginX(160);
        const x = clamp(p[0] - 6, mx, Mx);
        const y = clamp(Math.floor(p[1] / GRID) * GRID, 0, PAGE_H - GRID * 2);
        el = {
          id: uid(),
          pageId,
          type: 'text',
          x,
          y,
          w: freeWidth(x, y),
          h: GRID,
          z,
          updatedAt: now(),
          html: '',
          color: settings.textColor,
        };
      } else {
        const [mx, Mx] = marginX(200);
        el = {
          id: uid(),
          pageId,
          type: 'sticky',
          x: clamp(p[0] - 100, mx, Mx),
          y: clamp(p[1] - 30, 8, PAGE_H - 210),
          w: 200,
          h: 200,
          z,
          updatedAt: now(),
          html: '',
          color: settings.stickyColor,
          rot: Math.round((Math.random() * 6 - 3) * 10) / 10,
        };
      }
      // se muestra al instante; se guarda en la base cuando termines de escribir
      fresh.current.add(el.id);
      setPendingBoxes((ps) => [...ps, el]);
      setEditingId(el.id);
      return;
    }

    if (activeTool === 'math') {
      e.preventDefault();
      if (hit?.type === 'math') setMathEdit({ id: hit.id, at: p, tex: hit.tex });
      else setMathEdit({ at: p, tex: '' });
      return;
    }

    if (activeTool === 'card') {
      e.preventDefault();
      if (hit?.type === 'card') setCardEdit({ id: hit.id, at: p, q: hit.q, a: hit.a });
      else setCardEdit({ at: p, q: '', a: '' });
      return;
    }

    // Seleccionar
    if (!hit) {
      setSelected([]);
      setEditingId(null);
      return;
    }
    if (editingId === hit.id) return;
    e.preventDefault();
    setSelected([hit.id]);
    setEditingId(null);
    if (hit.type === 'image' && hit.locked) return; // los fondos fijos no se mueven
    surfaceRef.current!.setPointerCapture(e.pointerId);
    gesture.current = {
      kind: 'move',
      start: p,
      box: hit,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!editable || (outside(e) && !liveRef.current && !gesture.current && !lassoRef.current && !erasing.current)) return;
    const ink = liveRef.current;
    if (ink && shapeStart.current) {
      const p = toPage(e);
      ink.points = shapePoints(ink.shape!, shapeStart.current, p);
      setLive({ ...ink });
      return;
    }
    if (ink) {
      if (snapped.current) return;
      const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of evs.length ? evs : [e.nativeEvent]) {
        const p = toPage(ev);
        ink.points.push([p[0], p[1], ev.pressure || 0.5]);
      }
      setLive({ ...ink });
      // mantener el lápiz quieto un momento al final convierte el trazo en figura limpia
      if (ink.opacity === 1) {
        clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => {
          const cur = liveRef.current;
          if (!cur || cur.id !== ink.id) return;
          const shape = recognize(cur.points as P3[]);
          if (shape) {
            snapped.current = true;
            cur.points = shape.points;
            cur.shape = shape.kind;
            setLive({ ...cur });
          }
        }, 600);
      }
      return;
    }
    if (erasing.current) {
      eraseAt(toPage(e));
      return;
    }
    if (lassoRef.current) {
      const p = toPage(e);
      const last = lassoRef.current[lassoRef.current.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 4) {
        lassoRef.current = [...lassoRef.current, p];
        setLasso(lassoRef.current);
      }
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const p = toPage(e);
    const dx = p[0] - g.start[0];
    const dy = p[1] - g.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
    if (!g.moved) return;
    if (g.kind === 'move') setXf({ ox: 0, oy: 0, s: 1, dx, dy });
    else {
      const s = Math.max(0.15, (g.box.w + dx) / g.box.w);
      setXf({ ox: g.box.x, oy: g.box.y, s, dx: 0, dy: 0 });
    }
  };

  const onPointerUp = async () => {
    clearTimeout(holdTimer.current);
    const ink = liveRef.current;
    if (ink) {
      liveRef.current = null;
      const wasShapeTool = !!shapeStart.current;
      const start = shapeStart.current;
      shapeStart.current = null;
      if (wasShapeTool && start) {
        const [a, b] = [ink.points[0], ink.points[ink.points.length - 1]];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 6 && ink.shape !== 'rect' && ink.shape !== 'ellipse') {
          setLive(null);
          return;
        }
      }
      if (ink.points.length === 1) ink.points.push([ink.points[0][0] + 0.5, ink.points[0][1] + 0.5, ink.points[0][2]]);
      Object.assign(ink, inkBounds(ink.points, ink.size / 2), { z: 0, updatedAt: now() });
      setLive({ ...ink });
      await addElements([ink]);
      return;
    }
    if (erasing.current) {
      const ids = [...erasing.current];
      erasing.current = null;
      if (ids.length) await deleteElements(ids);
      else setHidden(new Set());
      return;
    }
    if (lassoRef.current) {
      const poly = lassoRef.current;
      lassoRef.current = null;
      setLasso(null);
      if (poly.length > 3) {
        const ids = elementsRef.current
          .filter((el) => !(el.type === 'image' && el.locked) && insideLasso(el, poly))
          .map((el) => el.id);
        setSelected(ids);
      }
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    const t = xfRef.current;
    if (g && g.moved && t) {
      const els = elementsRef.current.filter((x) => selectedRef.current.includes(x.id));
      const ts = now();
      const moved = els.map((el) => ({ ...transformElement(el, t), updatedAt: ts }) as NoteElement);
      setOptimistic(new Map(moved.map((m) => [m.id, m])));
      setXf(null);
      await updateElements(
        moved.map((m) => ({
          id: m.id,
          changes:
            m.type === 'ink'
              ? { points: m.points, size: m.size, x: m.x, y: m.y, w: m.w, h: m.h }
              : { x: m.x, y: m.y, w: m.w, h: m.h },
        })),
      );
    } else setXf(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!editable || outside(e)) return;
    // buscar el elemento bajo el puntero aunque esté tapado por el recuadro de selección
    const nodes = document.elementsFromPoint(e.clientX, e.clientY);
    const node = nodes.find((n) => (n as HTMLElement).dataset?.el && surfaceRef.current?.contains(n)) as
      | HTMLElement
      | undefined;
    const el = elementsRef.current.find((x) => x.id === node?.dataset.el);
    if (!el) return;
    openEditor(el);
  };

  const openEditor = (el: NoteElement) => {
    if (el.type === 'text' || el.type === 'sticky') {
      setSelected([]);
      setEditingId(el.id);
    } else if (el.type === 'math') setMathEdit({ id: el.id, at: [el.x, el.y], tex: el.tex });
    else if (el.type === 'card') setCardEdit({ id: el.id, at: [el.x, el.y], q: el.q, a: el.a });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!editable || !pageId || outside(e)) return;
    const p = toPage(e);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    for (const [i, f] of files.entries()) await insertImage(pageId, f, { x: p[0] + i * 24, y: p[1] + i * 24 });
  };

  // guardar texto / nota al terminar de escribir
  const commitBox = (el: TextElement | StickyElement) => async (html: string, text: string, h: number) => {
    const isFresh = fresh.current.has(el.id);
    if (!text) {
      if (isFresh) {
        fresh.current.delete(el.id);
        setPendingBoxes((ps) => ps.filter((p) => p.id !== el.id));
      } else await deleteElements([el.id]);
      return;
    }
    if (isFresh) {
      fresh.current.delete(el.id);
      await addElements([{ ...el, html, h: Math.max(h, el.type === 'text' ? GRID : el.h), updatedAt: now() }]);
    } else if (html !== el.html) await updateElements([{ id: el.id, changes: { html, h } }]);
  };

  // ---------- fórmulas y tarjetas ----------
  const saveMath = async (tex: string) => {
    const m = mathEdit;
    setMathEdit(null);
    if (!m || !pageId) return;
    const nat = measureTex(tex);
    if (m.id) {
      const old = elementsRef.current.find((x) => x.id === m.id) as MathElement | undefined;
      if (!old) return;
      const k = old.w / Math.max(1, measureTex(old.tex).w);
      await updateElements([{ id: m.id, changes: { tex, w: nat.w * k, h: nat.h * k } }]);
    } else {
      const [mx, Mx] = marginX(nat.w);
      const el: MathElement = {
        id: uid(),
        pageId,
        type: 'math',
        x: clamp(m.at[0], mx, Math.max(mx, Mx)),
        y: clamp(m.at[1] - nat.h / 2, 4, PAGE_H - nat.h - 4),
        w: nat.w,
        h: nat.h,
        z: elementsRef.current.reduce((mz, x) => Math.max(mz, x.z), 0) + 1,
        updatedAt: now(),
        tex,
        color: settings.textColor,
      };
      await addElements([el]);
    }
  };

  const saveCard = async (v: { q: string; a: string }) => {
    const c = cardEdit;
    setCardEdit(null);
    if (!c || !pageId) return;
    if (c.id) await updateElements([{ id: c.id, changes: v }]);
    else {
      const [mx, Mx] = marginX(280);
      const el: CardElement = {
        id: uid(),
        pageId,
        type: 'card',
        x: clamp(c.at[0] - 140, mx, Mx),
        y: clamp(c.at[1] - 40, 8, PAGE_H - 178),
        w: 280,
        h: 170,
        z: elementsRef.current.reduce((mz, x) => Math.max(mz, x.z), 0) + 1,
        updatedAt: now(),
        ...v,
        box: 1,
        due: 0,
      };
      await addElements([el]);
    }
  };

  // ---------- qué se dibuja ----------
  const view = useMemo(() => {
    const list = elements
      .filter((e) => !hidden.has(e.id))
      .map((e) => optimistic?.get(e.id) ?? e)
      .map((e) => (xf && selected.includes(e.id) ? transformElement(e, xf) : e));
    for (const p of pendingBoxes) if (!list.some((e) => e.id === p.id)) list.push(p);
    return list;
  }, [elements, hidden, optimistic, xf, selected, pendingBoxes]);

  const papers = view.filter((e) => e.type === 'image' || e.type === 'sticky' || e.type === 'card').sort((a, b) => a.z - b.z);
  const inks = view.filter((e): e is InkElement => e.type === 'ink');
  const texts = view.filter((e) => e.type === 'text' || e.type === 'math');

  const selEls = view.filter((e) => selected.includes(e.id));
  let selBox: Box | null = null;
  if (selEls.length && editable && !editingId) {
    selBox = unionBox(
      selEls.map((e) => {
        if (e.type === 'text' || e.type === 'sticky') {
          const node = surfaceRef.current?.querySelector<HTMLElement>(`[data-el="${e.id}"]`);
          return { x: e.x, y: e.y, w: e.w, h: node?.offsetHeight ?? e.h };
        }
        return e;
      }),
    );
  }
  const single = selEls.length === 1 ? selEls[0] : null;
  const allSticky = selEls.length > 0 && selEls.every((e) => e.type === 'sticky');
  const colorable = selEls.some((e) => ['ink', 'text', 'math', 'sticky'].includes(e.type));

  const selActions: { label: string; title: string; onClick: () => void; danger?: boolean }[] = [];
  if (single && ['text', 'sticky', 'math', 'card'].includes(single.type))
    selActions.push({ label: 'Editar', title: 'Editar', onClick: () => openEditor(single) });
  if (single?.type === 'image')
    selActions.push(
      single.locked
        ? { label: 'Soltar', title: 'Permitir mover esta imagen', onClick: () => updateElements([{ id: single.id, changes: { locked: false } }]) }
        : { label: 'Fijar', title: 'Dejar la imagen fija como fondo', onClick: () => updateElements([{ id: single.id, changes: { locked: true } }]) },
    );
  if (!(single?.type === 'image' && single.locked)) {
    selActions.push({ label: 'Duplicar', title: 'Duplicar (Ctrl+D)', onClick: duplicate });
    selActions.push({
      label: 'Copiar',
      title: 'Copiar para pegar en otra página (Ctrl+C)',
      onClick: () => copyToClip(elementsRef.current.filter((x) => selected.includes(x.id))),
    });
    selActions.push({
      label: 'Al frente',
      title: 'Traer al frente',
      onClick: async () => {
        let z = elementsRef.current.reduce((m, x) => Math.max(m, x.z), 0);
        await updateElements(selected.map((id) => ({ id, changes: { z: ++z } })));
      },
    });
  }
  selActions.push({
    label: 'Eliminar',
    title: 'Eliminar (Supr)',
    danger: true,
    onClick: () => {
      deleteElements(selected);
      setSelected([]);
    },
  });

  return (
    <div
      ref={surfaceRef}
      className={`paper paper-${paper} bind-${bind} surface tool-${editable ? tool : 'none'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Holes side={bind} />
      {papers.map((el) =>
        el.type === 'image' ? (
          <ImageBox key={el.id} el={el as ImageElement} selected={false} />
        ) : el.type === 'sticky' ? (
          <EditableBox
            key={el.id}
            el={el as StickyElement}
            editing={editingId === el.id}
            selected={false}
            onCommit={commitBox(el as StickyElement)}
            onDone={() => setEditingId((cur) => (cur === el.id ? null : cur))}
          />
        ) : (
          <CardBox key={el.id} el={el as CardElement} selected={false} />
        ),
      )}
      <svg className="ink-layer" viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}>
        {inks.map((el) => (
          <g key={el.id} data-el={el.id}>
            <InkPath el={el} />
          </g>
        ))}
        {live && !inks.some((i) => i.id === live.id) && <InkPath el={live} live />}
        {lasso && <polyline className="lasso-line" points={lasso.map((p) => p.join(',')).join(' ')} />}
      </svg>
      {texts.map((el) =>
        el.type === 'text' ? (
          <EditableBox
            key={el.id}
            el={el as TextElement}
            editing={editingId === el.id}
            selected={false}
            onCommit={commitBox(el as TextElement)}
            onDone={() => setEditingId((cur) => (cur === el.id ? null : cur))}
          />
        ) : (
          <MathBox key={el.id} el={el as MathElement} selected={false} />
        ),
      )}
      {selBox && (
        <SelectionOverlay
          box={selBox}
          colors={colorable ? (allSticky ? STICKY_COLORS : INK_COLORS) : undefined}
          onColor={(c) =>
            updateElements(
              selEls
                .filter((e) => ['ink', 'text', 'math', 'sticky'].includes(e.type))
                .map((e) => ({ id: e.id, changes: { color: c } })),
            )
          }
          actions={selActions}
        />
      )}
      <div className="page-number">{pageNumber}</div>
      {mathEdit && (
        <MathEditor
          initial={mathEdit.tex}
          onSave={saveMath}
          onCancel={() => setMathEdit(null)}
          onDelete={
            mathEdit.id
              ? () => {
                  deleteElements([mathEdit.id!]);
                  setMathEdit(null);
                }
              : undefined
          }
        />
      )}
      {cardEdit && (
        <CardEditor
          initial={cardEdit}
          onSave={saveCard}
          onCancel={() => setCardEdit(null)}
          onDelete={
            cardEdit.id
              ? () => {
                  deleteElements([cardEdit.id!]);
                  setCardEdit(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
});

export { cancelGestures };
