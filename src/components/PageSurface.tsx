import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addElement, db, deleteElement, nextZ, now, uid, updateElement } from '../db';
import { inkBounds, inkPath } from '../lib/ink';
import { insertImage, useAssetUrl } from '../lib/images';
import {
  GRID,
  MARGIN_LEFT,
  PAGE_H,
  PAGE_W,
  type ImageElement,
  type InkElement,
  type NoteElement,
  type TextElement,
  type Tool,
} from '../types';
import { Holes } from './Paper';

export interface PenSettings {
  tool: Tool;
  penColor: string;
  penSize: number;
  markerColor: string;
  textColor: string;
}

interface Props {
  pageId: string | undefined;
  pageNumber: number;
  editable: boolean;
  settings: PenSettings;
}

type Box = { id: string; x: number; y: number; w: number; h: number };
type Gesture = {
  kind: 'move' | 'resize';
  id: string;
  type: NoteElement['type'];
  startX: number;
  startY: number;
  orig: Box;
  moved: boolean;
};

// Si alguna vez se usó un lápiz, ignoramos el toque con la palma/dedo al dibujar
let penSeen = false;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const PageSurface = memo(function PageSurface({ pageId, pageNumber, editable, settings }: Props) {
  const { tool } = settings;
  const elements =
    useLiveQuery(
      async () =>
        pageId ? (await db.elements.where('pageId').equals(pageId).toArray()).filter((e) => !e.deleted) : [],
      [pageId],
    ) ?? [];

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [override, setOverride] = useState<Box | null>(null);
  const [live, setLive] = useState<InkElement | null>(null);
  const liveRef = useRef<InkElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const erasing = useRef(false);
  const erased = useRef(new Set<string>());
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const overrideRef = useRef(override);
  overrideRef.current = override;

  useEffect(() => {
    if (!editable) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [editable]);
  useEffect(() => {
    if (tool !== 'select') setSelectedId(null);
    if (tool !== 'select' && tool !== 'text') setEditingId(null);
  }, [tool]);

  // Quitar el trazo "en vivo" / la posición temporal cuando la base de datos ya tiene el cambio
  useEffect(() => {
    if (live && !liveRef.current && elements.some((e) => e.id === live.id)) setLive(null);
    if (override && !gesture.current) {
      const el = elements.find((e) => e.id === override.id);
      if (!el || (el.x === override.x && el.y === override.y && el.w === override.w)) setOverride(null);
    }
  }, [elements, live, override]);

  // Suprimir / Escape
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (editingId) return;
      if (selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteElement(selectedId);
        setSelectedId(null);
      } else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, selectedId, editingId]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PAGE_W, y: ((e.clientY - r.top) / r.height) * PAGE_H };
  };

  const eraseAt = (p: { x: number; y: number }) => {
    const r = 10;
    for (const el of elementsRef.current) {
      if (el.type !== 'ink' || erased.current.has(el.id)) continue;
      const reach = r + el.size / 2;
      if (p.x < el.x - reach || p.x > el.x + el.w + reach || p.y < el.y - reach || p.y > el.y + el.h + reach) continue;
      if (el.points.some(([x, y]) => (x - p.x) ** 2 + (y - p.y) ** 2 < reach * reach)) {
        erased.current.add(el.id);
        deleteElement(el.id);
      }
    }
  };

  const onPointerDown = async (e: React.PointerEvent) => {
    if (!editable || !pageId) return;
    if (e.pointerType === 'pen') penSeen = true;
    const target = e.target as HTMLElement;
    const elNode = target.closest<HTMLElement>('[data-el]');
    const onHandle = !!target.closest('[data-handle]');
    const p = toPage(e);
    // botón borrador de algunos lápices (Surface, Wacom)
    const activeTool: Tool = e.pointerType === 'pen' && e.buttons & 32 ? 'eraser' : tool;

    if (activeTool === 'pen' || activeTool === 'marker') {
      if (e.pointerType === 'touch' && penSeen) return;
      if (elNode && elNode.dataset.editing) return;
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
        points: [[p.x, p.y, e.pressure || 0.5]],
        color: marker ? settings.markerColor : settings.penColor,
        size: marker ? 20 : settings.penSize,
        opacity: marker ? 0.38 : 1,
        pen: e.pointerType === 'pen',
      };
      liveRef.current = ink;
      setLive(ink);
      return;
    }

    if (activeTool === 'eraser') {
      e.preventDefault();
      surfaceRef.current!.setPointerCapture(e.pointerId);
      erasing.current = true;
      erased.current.clear();
      eraseAt(p);
      return;
    }

    if (activeTool === 'text') {
      if (elNode) {
        const el = elementsRef.current.find((x) => x.id === elNode.dataset.el);
        if (el?.type === 'text') setEditingId(el.id);
        return;
      }
      e.preventDefault();
      const el: TextElement = {
        id: uid(),
        pageId,
        type: 'text',
        x: clamp(p.x - 6, MARGIN_LEFT + 4, PAGE_W - 160),
        y: clamp(Math.floor(p.y / GRID) * GRID, 0, PAGE_H - GRID * 2),
        w: Math.min(360, PAGE_W - clamp(p.x - 6, MARGIN_LEFT + 4, PAGE_W - 160) - 16),
        h: GRID,
        z: await nextZ(pageId),
        updatedAt: now(),
        html: '',
        color: settings.textColor,
      };
      await addElement(el);
      setEditingId(el.id);
      return;
    }

    // Seleccionar / mover / redimensionar
    if (!elNode) {
      setSelectedId(null);
      setEditingId(null);
      return;
    }
    const id = elNode.dataset.el!;
    if (editingId === id) return;
    const el = elementsRef.current.find((x) => x.id === id);
    if (!el) return;
    e.preventDefault();
    setSelectedId(id);
    setEditingId(null);
    surfaceRef.current!.setPointerCapture(e.pointerId);
    gesture.current = {
      kind: onHandle ? 'resize' : 'move',
      id,
      type: el.type,
      startX: p.x,
      startY: p.y,
      orig: { id, x: el.x, y: el.y, w: el.w, h: el.h },
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!editable) return;
    const ink = liveRef.current;
    if (ink) {
      const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of evs.length ? evs : [e.nativeEvent]) {
        const p = toPage(ev);
        ink.points.push([p.x, p.y, ev.pressure || 0.5]);
      }
      setLive({ ...ink });
      return;
    }
    if (erasing.current) {
      eraseAt(toPage(e));
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const p = toPage(e);
    const dx = p.x - g.startX;
    const dy = p.y - g.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
    if (!g.moved) return;
    const o = g.orig;
    if (g.kind === 'move') {
      setOverride({
        ...o,
        x: clamp(o.x + dx, 0, PAGE_W - 30),
        y: clamp(o.y + dy, 0, PAGE_H - 30),
      });
    } else {
      const w = clamp(o.w + dx, 60, PAGE_W - o.x);
      const h = g.type === 'image' ? (w * o.h) / o.w : o.h;
      setOverride({ ...o, w, h });
    }
  };

  const onPointerUp = async () => {
    const ink = liveRef.current;
    if (ink) {
      liveRef.current = null;
      if (ink.points.length === 1) ink.points.push([ink.points[0][0] + 0.5, ink.points[0][1] + 0.5, ink.points[0][2]]);
      Object.assign(ink, inkBounds(ink.points, ink.size / 2), { z: 0, updatedAt: now() });
      setLive({ ...ink });
      await addElement(ink);
      return;
    }
    erasing.current = false;
    const g = gesture.current;
    gesture.current = null;
    const o = overrideRef.current;
    if (g && g.moved && o) {
      await updateElement(g.id, { x: o.x, y: o.y, w: o.w, h: o.h });
    } else setOverride(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!editable) return;
    const elNode = (e.target as HTMLElement).closest<HTMLElement>('[data-el]');
    const el = elementsRef.current.find((x) => x.id === elNode?.dataset.el);
    if (el?.type === 'text') {
      setSelectedId(null);
      setEditingId(el.id);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!editable || !pageId) return;
    const p = toPage(e);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    for (const [i, f] of files.entries()) await insertImage(pageId, f, { x: p.x + i * 24, y: p.y + i * 24 });
  };

  const view = (el: NoteElement) => (override && override.id === el.id ? { ...el, ...override } : el);
  const images = useMemo(
    () => elements.filter((e): e is ImageElement => e.type === 'image').sort((a, b) => a.z - b.z),
    [elements],
  );
  const inks = useMemo(() => elements.filter((e): e is InkElement => e.type === 'ink'), [elements]);
  const texts = useMemo(() => elements.filter((e): e is TextElement => e.type === 'text'), [elements]);

  return (
    <div
      ref={surfaceRef}
      className={`paper surface tool-${editable ? tool : 'none'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Holes side="left" />
      {images.map((el) => (
        <ImageBox key={el.id} el={view(el) as ImageElement} selected={selectedId === el.id} />
      ))}
      <svg className="ink-layer" viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}>
        {inks.map((el) => (
          <InkPath key={el.id} el={el} />
        ))}
        {live && !inks.some((i) => i.id === live.id) && <InkPath el={live} live />}
      </svg>
      {texts.map((el) => (
        <TextBox
          key={el.id}
          el={view(el) as TextElement}
          editing={editingId === el.id}
          selected={selectedId === el.id}
          onDone={() => setEditingId((cur) => (cur === el.id ? null : cur))}
        />
      ))}
      <div className="page-number">{pageNumber}</div>
    </div>
  );
});

const InkPath = memo(function InkPath({ el, live }: { el: InkElement; live?: boolean }) {
  const d = inkPath(el, !live);
  return (
    <path
      d={d}
      fill={el.color}
      opacity={el.opacity}
      style={el.opacity < 1 ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
});

function ImageBox({ el, selected }: { el: ImageElement; selected: boolean }) {
  const url = useAssetUrl(el.assetId);
  return (
    <div
      data-el={el.id}
      className={`el image-el${selected ? ' selected' : ''}`}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z }}
    >
      {url && <img src={url} alt="" draggable={false} />}
      <span className="tape" />
      {selected && <div data-handle className="handle" />}
    </div>
  );
}

function TextBox({
  el,
  editing,
  selected,
  onDone,
}: {
  el: TextElement;
  editing: boolean;
  selected: boolean;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && !editing && ref.current.innerHTML !== el.html) ref.current.innerHTML = el.html;
  }, [el.html, editing]);

  useEffect(() => {
    const node = ref.current;
    if (!editing || !node) return;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const finish = async () => {
    const node = ref.current;
    if (!node) return;
    const text = node.innerText.trim();
    if (!text) await db.elements.delete(el.id);
    else if (node.innerHTML !== el.html) await updateElement(el.id, { html: node.innerHTML, h: node.offsetHeight });
    onDone();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    // las imágenes las maneja el cuaderno; aquí solo texto plano
    if ([...e.clipboardData.items].some((i) => i.type.startsWith('image/'))) return;
    e.preventDefault();
    e.stopPropagation();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };

  return (
    <div
      data-el={el.id}
      data-editing={editing || undefined}
      className={`el text-el${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      style={{ left: el.x, top: el.y, width: el.w, zIndex: 10000 + el.z, color: el.color }}
    >
      <div
        ref={ref}
        className="text-content"
        contentEditable={editing}
        suppressContentEditableWarning
        spellCheck={editing}
        onBlur={finish}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLElement).blur();
          e.stopPropagation();
        }}
      />
      {selected && <div data-handle className="handle" />}
    </div>
  );
}
