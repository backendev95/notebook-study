import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensurePages, getLastPage, getPages, setLastPage } from '../db';
import { canRedo, canUndo, historyStore, redo, undo } from '../lib/history';
import { insertImage } from '../lib/images';
import { cancelGestures, input } from '../lib/input';
import { importPdf } from '../lib/pdf';
import { useSyncStatus } from '../lib/sync';
import { PAGE_H, PAGE_W, type Page } from '../types';
import { Book, bookWidth, TABS_W, type Flip, type Mode, type Section } from './Book';
import { BackPaper, Cover, CoverInside } from './Paper';
import { hasClip, isClipMarker, PageSurface, pasteClip, pasteText, type PenSettings } from './PageSurface';
import { Toolbar } from './Toolbar';
import type { SearchHit } from '../lib/search';

// paneles que se cargan solo cuando se abren (la app arranca más rápido en el celular)
const PagesPanel = lazy(() => import('./PagesPanel').then((m) => ({ default: m.PagesPanel })));
const SearchDialog = lazy(() => import('./SearchDialog').then((m) => ({ default: m.SearchDialog })));
const ExportDialog = lazy(() => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })));
const NotebookSettings = lazy(() => import('./NotebookSettings').then((m) => ({ default: m.NotebookSettings })));

const SETTINGS_KEY = 'nbs-pen-settings';
const VIEW_KEY = 'nbs-view';
const RING_PAD = 34; // espacio a la izquierda para la espiral
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

const defaultSettings: PenSettings = {
  tool: 'pen',
  penColor: '#2456c9',
  penSize: 3.5,
  markerColor: '#ffd84a',
  textColor: '#1f2430',
  shapeKind: 'rect',
  stickyColor: '#fff3a0',
};

function loadSettings(): PenSettings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaultSettings;
  }
}

const isTyping = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Hoja física que hay que mostrar para ver la página `p` */
const pageToSheet = (p: number, m: Mode) => (m === 'single' ? p : p < 0 ? -1 : Math.floor((p + 1) / 2));
/** Página de la derecha de una hoja física */
const rightPage = (s: number, m: Mode) => (m === 'single' ? s : s < 0 ? -1 : 2 * s);

export interface NavTarget {
  page?: number;
  el?: string;
  nonce: number;
}

export function NotebookView({
  notebookId,
  nav,
  onBack,
  onOpenNotebook,
  onReview,
}: {
  notebookId: string;
  nav?: NavTarget;
  onBack: () => void;
  onOpenNotebook: (id: string, page?: number, el?: string) => void;
  onReview: (notebookId?: string) => void;
}) {
  const notebook = useLiveQuery(async () => (await db.notebooks.get(notebookId)) ?? null, [notebookId]);
  const pages = useLiveQuery(() => getPages(notebookId), [notebookId]);
  useSyncExternalStore(historyStore.subscribe, historyStore.getVersion);

  const [settings, setSettings] = useState<PenSettings>(loadSettings);
  const [viewPref, setViewPref] = useState<'auto' | 'single' | 'spread'>(
    () => (localStorage.getItem(VIEW_KEY) as 'auto' | 'single' | 'spread') || 'auto',
  );
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [sheet, setSheet] = useState<number | null>(null);
  const [activePage, setActivePage] = useState(-1);
  const [flip, setFlipState] = useState<Flip | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<null | 'pages' | 'search' | 'export' | 'settings'>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [highlight, setHighlight] = useState<{ page: number; el?: string } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<(Flip & { p: number }) | null>(null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const activeRef = useRef(activePage);
  activeRef.current = activePage;
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages ?? [];
  const drag = useRef<{ dir: 'next' | 'prev'; startX: number; moved: boolean } | null>(null);
  const pendingActive = useRef<number | null>(null);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const pdfAfter = useRef(0);

  /** Escribe el avance del giro directo en el libro (sin redibujar con React) */
  const applyFlip = (f: (Flip & { p: number }) | null) => {
    const el = bookRef.current;
    if (!el || !f) return;
    const angle = f.dir === 'next' ? -180 * f.p : -180 * (1 - f.p);
    const wave = Math.sin(Math.PI * f.p);
    // se escribe solo en los elementos que se mueven (no en todo el libro): el navegador
    // no tiene que revisar el resto de la hoja en cada cuadro
    for (const face of el.querySelectorAll<HTMLElement>(':scope > .face-flipping')) {
      face.style.transform = face.classList.contains('face-back')
        ? `rotateY(${angle}deg) translateX(${PAGE_W / 2}px) rotateY(180deg) translateX(${-PAGE_W / 2}px)`
        : `rotateY(${angle}deg)`;
      const shade = face.lastElementChild as HTMLElement | null;
      if (shade?.classList.contains('shade')) shade.style.opacity = String(wave * 0.45);
    }
    const castR = el.querySelector<HTMLElement>(':scope > .cast-shadow.right');
    const castL = el.querySelector<HTMLElement>(':scope > .cast-shadow.left');
    if (castR) castR.style.opacity = String(angle > -90 ? wave * 0.5 : 0);
    if (castL) castL.style.opacity = String(angle <= -90 ? wave * 0.5 : 0);
  };
  /** Empezar / terminar un giro: esto sí pasa por React (cambia qué caras se dibujan) */
  const setFlip = (f: (Flip & { p: number }) | null) => {
    flipRef.current = f;
    applyFlip(f);
    setFlipState(f ? { dir: f.dir, target: f.target } : null);
  };
  /** Mover el giro: solo variables CSS */
  const moveFlip = (p: number) => {
    const f = flipRef.current;
    if (!f) return;
    f.p = p;
    applyFlip(f);
  };
  // las caras nuevas del giro se montan con el ángulo correcto desde el primer cuadro
  useLayoutEffect(() => applyFlip(flipRef.current), [flip]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem(VIEW_KEY, viewPref), [viewPref]);

  // ---------- tamaño de pantalla, vista y zoom ----------
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [notebook === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections: Section[] = useMemo(
    () =>
      (pages ?? [])
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.sectionTitle)
        .map(({ p, i }) => ({ title: p.sectionTitle!, color: p.sectionColor ?? '#8a8f98', page: i })),
    [pages],
  );
  // espacio para las pestañas de los separadores a ambos lados (pasadas a la izquierda, pendientes a la derecha)
  const tabsPad = sections.length ? TABS_W : 0;
  const extraW = RING_PAD + tabsPad * 2;
  const fitFor = useCallback(
    (m: Mode) => {
      const pad = stage.w < 640 ? 12 : 36;
      return Math.max(0.12, Math.min((stage.w - pad) / (bookWidth(m) + extraW), (stage.h - pad) / PAGE_H));
    },
    [stage, extraW],
  );
  const mode: Mode =
    viewPref === 'single'
      ? 'single'
      : viewPref === 'spread'
        ? 'spread'
        : stage.w >= 900 && fitFor('spread') >= fitFor('single') * 0.7
          ? 'spread'
          : 'single';
  const fit = fitFor(mode);
  const scale = fit * zoom;
  const wrapW = (bookWidth(mode) + extraW) * scale;
  const wrapH = PAGE_H * scale;

  // ---------- hoja inicial ----------
  useEffect(() => {
    if (!notebook || !pages || sheet !== null || !stage.w) return;
    const page = clamp(nav?.page ?? getLastPage(notebookId), -1, pages.length - 1);
    setActivePage(page);
    setSheet(pageToSheet(page, mode));
    if (nav?.el) setHighlight({ page, el: nav.el });
  }, [notebook, pages, sheet, stage.w]); // eslint-disable-line react-hooks/exhaustive-deps

  // al cambiar entre una y dos hojas, seguir mostrando la misma página
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current !== mode && sheetRef.current !== null) setSheet(pageToSheet(activeRef.current, mode));
    prevMode.current = mode;
  }, [mode]);

  useEffect(() => {
    if (sheet !== null) setLastPage(notebookId, activePage);
  }, [activePage, sheet, notebookId]);

  // ---------- pasar hojas ----------
  const finish = useCallback(
    async (to: 0 | 1, f: Flip) => {
      if (to === 1) {
        const need = mode === 'single' ? f.target + 1 : 2 * f.target + 1;
        if (pagesRef.current.length < need) await ensurePages(notebookId, need);
        setSheet(f.target);
        setActivePage(pendingActive.current ?? rightPage(f.target, mode));
      }
      pendingActive.current = null;
      setFlip(null);
    },
    [mode, notebookId],
  );

  const animateTo = useCallback(
    (to: 0 | 1) => {
      const f = flipRef.current;
      if (!f) return;
      const start = f.p;
      const { dir, target } = f;
      const t0 = performance.now();
      const dur = 220 + 480 * Math.abs(to - start);
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        const ease = 1 - Math.pow(1 - k, 3);
        moveFlip(start + (to - start) * ease);
        if (k < 1) requestAnimationFrame(step);
        else finish(to, { dir, target });
      };
      requestAnimationFrame(step);
    },
    [finish],
  );

  const turn = useCallback(
    (dir: Flip['dir']) => {
      const s = sheetRef.current;
      if (flipRef.current || s === null) return;
      if (dir === 'prev' && s <= -1) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      setFlip({ dir, p: 0, target: s + (dir === 'next' ? 1 : -1) });
      animateTo(1);
    },
    [animateTo],
  );

  const jumpToPage = useCallback(
    (page: number) => {
      const s = sheetRef.current;
      if (s === null || flipRef.current) return;
      const target = pageToSheet(page, mode);
      if (target === s) {
        setActivePage(page);
        return;
      }
      pendingActive.current = page;
      (document.activeElement as HTMLElement | null)?.blur?.();
      setFlip({ dir: target > s ? 'next' : 'prev', p: 0, target });
      animateTo(1);
    },
    [mode, animateTo],
  );

  // navegar desde la búsqueda (mismo cuaderno)
  useEffect(() => {
    if (!nav || sheetRef.current === null || nav.page === undefined) return;
    jumpToPage(nav.page);
    if (nav.el) setHighlight({ page: nav.page, el: nav.el });
  }, [nav?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // arrastrar la esquina
  const zone = {
    down: (dir: Flip['dir']) => (e: React.PointerEvent) => {
      const s = sheetRef.current;
      if (flipRef.current || s === null || (dir === 'prev' && s <= -1)) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      (document.activeElement as HTMLElement | null)?.blur?.();
      drag.current = { dir, startX: e.clientX, moved: false };
      setFlip({ dir, p: 0, target: s + (dir === 'next' ? 1 : -1) });
    },
    move: (e: React.PointerEvent) => {
      const d = drag.current;
      const rect = bookRef.current?.getBoundingClientRect();
      const f = flipRef.current;
      if (!d || !rect || !f) return;
      if (Math.abs(e.clientX - d.startX) > 4) d.moved = true;
      const pw = PAGE_W * scale;
      const spineX = rect.left + (mode === 'spread' ? pw : 0);
      const rel = clamp((e.clientX - spineX) / pw, -1, 1);
      let p: number;
      if (d.dir === 'next') p = Math.acos(rel) / Math.PI;
      else if (mode === 'spread') p = 1 - Math.acos(rel) / Math.PI;
      else p = clamp((e.clientX - d.startX) / (pw * 0.85), 0, 1);
      moveFlip(p);
    },
    up: () => {
      const d = drag.current;
      drag.current = null;
      if (!d || !flipRef.current) return;
      animateTo(!d.moved || flipRef.current.p > 0.28 ? 1 : 0);
    },
  };

  // ---------- zoom y desplazamiento ----------
  const wrapOffset = (s: number) => ({
    x: Math.max(0, (stage.w - (bookWidth(mode) + extraW) * s) / 2),
    y: Math.max(0, (stage.h - PAGE_H * s) / 2),
  });
  const zoomAt = useCallback(
    (next: number, clientX?: number, clientY?: number, pan = { x: 0, y: 0 }) => {
      const el = stageRef.current;
      if (!el) return;
      const z = clamp(next, ZOOM_MIN, ZOOM_MAX);
      const r = el.getBoundingClientRect();
      const fx = (clientX ?? r.left + r.width / 2) - r.left;
      const fy = (clientY ?? r.top + r.height / 2) - r.top;
      const s0 = fit * zoom;
      const s1 = fit * z;
      const o0 = wrapOffset(s0);
      const o1 = wrapOffset(s1);
      const cx = (el.scrollLeft + fx - o0.x) / s0;
      const cy = (el.scrollTop + fy - o0.y) / s0;
      pendingScroll.current = { left: cx * s1 + o1.x - fx - pan.x, top: cy * s1 + o1.y - fy - pan.y };
      if (z === zoom) {
        el.scrollLeft = pendingScroll.current.left;
        el.scrollTop = pendingScroll.current.top;
        pendingScroll.current = null;
      } else setZoom(z);
    },
    [fit, zoom, stage, mode, extraW], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useLayoutEffect(() => {
    const el = stageRef.current;
    const p = pendingScroll.current;
    if (!el || !p) return;
    el.scrollLeft = p.left;
    el.scrollTop = p.top;
    pendingScroll.current = null;
  }, [zoom]);

  // Ctrl + rueda (y pellizco en el touchpad)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, zoom]);

  // Dos dedos: pellizcar para zoom y arrastrar para mover. Con lápiz, un dedo también desplaza.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  // Durante el pellizco solo se escala la imagen ya dibujada (rápido); al soltar se dibuja una vez al nuevo tamaño
  const wrapRef = useRef<HTMLDivElement>(null);
  const pinch = useRef<{
    d0: number;
    z0: number;
    mid0: { x: number; y: number };
    z: number;
    pan: { x: number; y: number };
  } | null>(null);
  const endPinch = () => {
    const pc = pinch.current;
    pinch.current = null;
    const w = wrapRef.current;
    if (!pc || !w) return;
    w.style.transform = '';
    w.style.transformOrigin = '';
    zoomAt(pc.z, pc.mid0.x, pc.mid0.y, pc.pan);
  };
  const pan = useRef<{ x: number; y: number } | null>(null);
  const onTouchDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      cancelGestures();
      const [a, b] = [...touches.current.values()];
      const mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoom, mid0, z: zoom, pan: { x: 0, y: 0 } };
      pan.current = null;
      const w = wrapRef.current;
      if (w) {
        const r = w.getBoundingClientRect();
        w.style.transformOrigin = `${mid0.x - r.left}px ${mid0.y - r.top}px`;
      }
    } else if (touches.current.size === 1 && input.penSeen && !flipRef.current) {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-el], .selection-box, .turn-zone, button, .section-tabs')) pan.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onTouchMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = stageRef.current;
    if (!el) return;
    const pc = pinch.current;
    if (pc && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      pc.z = clamp((pc.z0 * d) / Math.max(1, pc.d0), ZOOM_MIN, ZOOM_MAX);
      pc.pan = { x: mid.x - pc.mid0.x, y: mid.y - pc.mid0.y };
      const w = wrapRef.current;
      if (w) w.style.transform = `translate(${pc.pan.x}px, ${pc.pan.y}px) scale(${pc.z / pc.z0})`;
    } else if (pan.current) {
      el.scrollLeft -= e.clientX - pan.current.x;
      el.scrollTop -= e.clientY - pan.current.y;
      pan.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onTouchUp = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2 && pinch.current) endPinch();
    if (touches.current.size === 0) pan.current = null;
  };

  // ---------- teclado ----------
  const activePageId = activePage >= 0 ? pages?.[activePage]?.id : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panel) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setPanel('search');
        return;
      }
      if (isTyping()) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (activePageId) undo(activePageId);
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (activePageId) redo(activePageId);
      } else if (mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomAt(zoom * 1.25);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        zoomAt(zoom / 1.25);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        setZoom(1);
      } else if (!mod && (e.key === 'ArrowRight' || e.key === 'PageDown')) turn('next');
      else if (!mod && (e.key === 'ArrowLeft' || e.key === 'PageUp')) turn('prev');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, activePageId, zoom, zoomAt, panel]);

  // ---------- pegar ----------
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!activePageId || flipRef.current || panel) return;
      const items = [...(e.clipboardData?.items ?? [])];
      const files = items.filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (files.length) {
        e.preventDefault();
        files.forEach((f, i) => insertImage(activePageId, f, i ? { x: PAGE_W / 2 + i * 24, y: PAGE_H / 2 + i * 24 } : undefined));
        return;
      }
      if (isTyping()) return; // el texto lo pega la caja que se está editando
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (isClipMarker(text)) {
        e.preventDefault();
        if (hasClip()) pasteClip(activePageId);
      } else if (hasClip() && !text) {
        e.preventDefault();
        pasteClip(activePageId);
      } else if (text.trim()) {
        e.preventDefault();
        pasteText(activePageId, text);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [activePageId, panel]);

  // ---------- PDF ----------
  const startPdfImport = (afterIndex: number) => {
    pdfAfter.current = afterIndex;
    pdfInput.current?.click();
  };
  const runPdfImport = async (file: File) => {
    setPanel(null);
    setImporting({ done: 0, total: 1 });
    try {
      const r = await importPdf(notebookId, pdfAfter.current, file, (done, total) => setImporting({ done, total }));
      setImporting(null);
      setTimeout(() => jumpToPage(r.first), 100);
    } catch (err) {
      setImporting(null);
      alertMsg(`No se pudo importar el PDF: ${(err as Error).message}`);
    }
  };
  const [msg, setMsg] = useState('');
  const alertMsg = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 5000);
  };

  const selectTool = useCallback(() => setSettings((o) => ({ ...o, tool: 'select' })), []);

  // callbacks estables para que las hojas no se redibujen en cada cuadro de la animación
  const activators = useRef(new Map<number, () => void>());
  const activator = (i: number) => {
    let f = activators.current.get(i);
    if (!f) activators.current.set(i, (f = () => setActivePage(i)));
    return f;
  };

  // ---------- render ----------
  if (notebook === null || notebook?.deleted) return <NotFound onBack={onBack} />;

  const ready = notebook && pages && sheet !== null && stage.w > 0;
  const defPaper = notebook?.paper ?? 'grid';

  const renderFace = (s: number, side: 'front' | 'back', editable: boolean) => {
    if (!notebook || !pages) return null;
    if (s === -1) return side === 'front' ? <Cover notebook={notebook} pageCount={pages.length} /> : <CoverInside color={notebook.color} />;
    if (mode === 'single' && side === 'back') return <BackPaper paper={pages[s]?.paper ?? defPaper} />;
    const idx = mode === 'single' ? s : side === 'front' ? 2 * s : 2 * s + 1;
    const p = pages[idx];
    return (
      <PageSurface
        pageId={p?.id}
        pageNumber={idx + 1}
        editable={editable && !!p}
        active={editable && activePage === idx}
        settings={settings}
        paper={p?.paper ?? defPaper}
        bind={side === 'front' ? 'left' : 'right'}
        highlightId={highlight?.page === idx ? highlight.el : undefined}
        onActivate={activator(idx)}
        onSelectTool={selectTool}
      />
    );
  };

  const n = pages?.length ?? 0;
  const s = sheet ?? -1;
  const pageLabel =
    s === -1
      ? 'Portada'
      : mode === 'single' || s === 0
        ? `Hoja ${rightPage(s, mode) + 1} de ${n}`
        : `Hojas ${2 * s}–${Math.min(n, 2 * s + 1)} de ${n}`;

  return (
    <div className="notebook-view">
      <Toolbar
        title={notebook?.title ?? ''}
        settings={settings}
        onChange={(c) => setSettings((o) => ({ ...o, ...c }))}
        onBack={onBack}
        canWrite={activePage >= 0}
        onImages={(files) => activePageId && files.forEach((f) => insertImage(activePageId, f))}
        onPdf={(f) => {
          pdfAfter.current = Math.max(-1, activePage);
          runPdfImport(f);
        }}
        undo={{ can: canUndo(activePageId), run: () => activePageId && undo(activePageId) }}
        redo={{ can: canRedo(activePageId), run: () => activePageId && redo(activePageId) }}
        zoom={{ value: zoom, zoomIn: () => zoomAt(zoom * 1.25), zoomOut: () => zoomAt(zoom / 1.25), fit: () => setZoom(1) }}
        onPages={() => setPanel('pages')}
        onSearch={() => setPanel('search')}
        onExport={() => setPanel('export')}
        onReview={() => onReview(notebookId)}
        onSettings={() => setPanel('settings')}
        view={viewPref}
        onView={setViewPref}
        pageLabel={pageLabel}
        onPrev={() => turn('prev')}
        onNext={() => turn('next')}
        canPrev={s > -1}
      />
      <div
        className={`stage${zoom > 1 ? ' zoomed' : ''}`}
        ref={stageRef}
        onPointerDownCapture={onTouchDown}
        onPointerMoveCapture={onTouchMove}
        onPointerUpCapture={onTouchUp}
        onPointerCancelCapture={onTouchUp}
      >
        {ready ? (
          <div className="book-wrap" ref={wrapRef} style={{ width: wrapW, height: wrapH }}>
            <div className="book-pos" style={{ left: (RING_PAD + tabsPad) * scale }}>
              <Book
                mode={mode}
                sheet={s}
                flip={flip}
                scale={scale}
                renderFace={renderFace}
                canPrev={s > -1}
                sections={sections}
                currentPage={activePage}
                onJump={jumpToPage}
                zone={zone}
                bookRef={bookRef}
                dragging={!!drag.current}
              />
            </div>
          </div>
        ) : (
          <div className="loading">Abriendo cuaderno…</div>
        )}
      </div>

      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) runPdfImport(f);
        }}
      />

      {importing && (
        <div className="toast">
          Importando PDF… página {importing.done} de {importing.total}
        </div>
      )}
      {msg && <div className="toast error">{msg}</div>}

      <Suspense fallback={null}>
      {panel === 'pages' && notebook && pages && (
        <PagesPanel
          notebook={notebook}
          pages={pages}
          activePage={activePage}
          settings={settings}
          onGo={(i) => {
            setPanel(null);
            setTimeout(() => jumpToPage(i), 50);
          }}
          onClose={() => setPanel(null)}
          onImportPdf={startPdfImport}
        />
      )}
      {panel === 'search' && (
        <SearchDialog
          notebookId={notebookId}
          onClose={() => setPanel(null)}
          onPick={(h: SearchHit) => {
            setPanel(null);
            if (h.notebookId === notebookId) {
              jumpToPage(h.page);
              setHighlight({ page: h.page, el: h.elementId });
            } else onOpenNotebook(h.notebookId, h.page, h.elementId);
          }}
        />
      )}
      {panel === 'export' && notebook && pages && (
        <ExportDialog notebook={notebook} pages={pages} activePage={activePage} settings={settings} onClose={() => setPanel(null)} />
      )}
      {panel === 'settings' && notebook && <NotebookSettings notebook={notebook} onClose={() => setPanel(null)} />}
      </Suspense>
    </div>
  );
}

/** Cuaderno que no está en este dispositivo (quizá todavía viene de la nube) */
function NotFound({ onBack }: { onBack: () => void }) {
  const syncStatus = useSyncStatus();
  const searching = syncStatus.state === 'syncing' || (syncStatus.state !== 'off' && !syncStatus.lastSync);
  return (
    <div className="loading">
      {searching ? (
        'Buscando el cuaderno en la nube…'
      ) : (
        <div>
          No encontré este cuaderno.{' '}
          <button className="link" onClick={onBack}>
            Volver a mis cuadernos
          </button>
        </div>
      )}
    </div>
  );
}
