import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addPageAtEnd, db, getLastPage, getPages, setLastPage } from '../db';
import { insertImage } from '../lib/images';
import { MARGIN_LEFT, PAGE_H, PAGE_W, type Page } from '../types';
import { BackPaper, Cover, CoverInside, Rings } from './Paper';
import { PageSurface, type PenSettings } from './PageSurface';
import { Toolbar } from './Toolbar';

type Flip = { dir: 'next' | 'prev'; p: number };

const SETTINGS_KEY = 'nbs-pen-settings';
const defaultSettings: PenSettings = {
  tool: 'pen',
  penColor: '#2456c9',
  penSize: 3.5,
  markerColor: '#ffd84a',
  textColor: '#1f2430',
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

export function NotebookView({ notebookId, onBack }: { notebookId: string; onBack: () => void }) {
  // undefined = cargando, null = no existe en este dispositivo
  const notebook = useLiveQuery(
    async () => (await db.notebooks.get(notebookId)) ?? null,
    [notebookId],
  );
  const pages = useLiveQuery(() => getPages(notebookId), [notebookId]);
  const [cur, setCur] = useState<number | null>(null);
  const [flip, setFlipState] = useState<Flip | null>(null);
  const [settings, setSettings] = useState<PenSettings>(loadSettings);
  const [scale, setScale] = useState(0.6);

  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<Flip | null>(null);
  const curRef = useRef(cur);
  curRef.current = cur;
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages ?? [];
  const drag = useRef<{ dir: 'next' | 'prev'; startX: number; moved: boolean } | null>(null);

  const setFlip = (f: Flip | null) => {
    flipRef.current = f;
    setFlipState(f);
  };

  // Hoja inicial: donde lo dejaste la última vez
  useEffect(() => {
    if (notebook && pages && cur === null) setCur(Math.min(getLastPage(notebookId), pages.length - 1));
  }, [notebook, pages, cur, notebookId]);
  useEffect(() => {
    if (cur !== null) setLastPage(notebookId, cur);
  }, [cur, notebookId]);
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Ajustar la hoja al tamaño de la pantalla
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      const pad = width < 640 ? 16 : 48;
      setScale(Math.max(0.2, Math.min((width - pad - 30) / PAGE_W, (height - pad) / PAGE_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [notebook]);

  // ---------- Pasar hojas ----------
  const finish = useCallback(
    async (target: 0 | 1, dir: Flip['dir']) => {
      if (target === 1) {
        const c = curRef.current ?? -1;
        if (dir === 'next') {
          if (c + 1 >= pagesRef.current.length) await addPageAtEnd(notebookId);
          setCur(c + 1);
        } else setCur(c - 1);
      }
      setFlip(null);
    },
    [notebookId],
  );

  const animateTo = useCallback(
    (target: 0 | 1) => {
      const f = flipRef.current;
      if (!f) return;
      const start = f.p;
      const t0 = performance.now();
      const dur = 220 + 480 * Math.abs(target - start);
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        const ease = 1 - Math.pow(1 - k, 3);
        setFlip({ dir: f.dir, p: start + (target - start) * ease });
        if (k < 1) requestAnimationFrame(step);
        else finish(target, f.dir);
      };
      requestAnimationFrame(step);
    },
    [finish],
  );

  const turn = useCallback(
    (dir: Flip['dir']) => {
      if (flipRef.current || curRef.current === null) return;
      if (dir === 'prev' && curRef.current <= -1) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      setFlip({ dir, p: 0 });
      animateTo(1);
    },
    [animateTo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') turn('next');
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn('prev');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);

  // Arrastrar la esquina de la hoja
  const onZoneDown = (dir: Flip['dir']) => (e: React.PointerEvent) => {
    if (flipRef.current || curRef.current === null) return;
    if (dir === 'prev' && curRef.current <= -1) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    (document.activeElement as HTMLElement | null)?.blur?.();
    drag.current = { dir, startX: e.clientX, moved: false };
    setFlip({ dir, p: 0 });
  };
  const onZoneMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const rect = bookRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    if (Math.abs(e.clientX - d.startX) > 4) d.moved = true;
    let p: number;
    if (d.dir === 'next') {
      // el borde de la hoja sigue al dedo
      const rel = Math.max(-1, Math.min(1, (e.clientX - rect.left) / rect.width));
      p = Math.acos(rel) / Math.PI;
    } else {
      p = Math.max(0, Math.min(1, (e.clientX - d.startX) / (rect.width * 0.85)));
    }
    setFlip({ dir: d.dir, p });
  };
  const onZoneUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !flipRef.current) return;
    animateTo(!d.moved || flipRef.current.p > 0.28 ? 1 : 0);
  };

  // ---------- Pegar imágenes con Ctrl+V ----------
  const currentPageId = cur !== null && cur >= 0 ? pages?.[cur]?.id : undefined;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!currentPageId || flipRef.current) return;
      const files = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (!files.length) return;
      e.preventDefault();
      files.forEach((f, i) => insertImage(currentPageId, f, i ? { x: PAGE_W / 2 + i * 24, y: PAGE_H / 2 + i * 24 } : undefined));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [currentPageId]);

  if (notebook === null || notebook?.deleted)
    return (
      <div className="loading">
        <div>
          No encontré este cuaderno.{' '}
          <button className="link" onClick={onBack}>
            Volver a mis cuadernos
          </button>
        </div>
      </div>
    );
  if (!notebook || !pages || cur === null) return <div className="loading">Abriendo cuaderno…</div>;

  // ---------- Qué hojas se ven ----------
  // Se montan la anterior, la actual y la siguiente para que pasar hoja sea instantáneo.
  const angle = flip ? (flip.dir === 'next' ? -180 * flip.p : -180 * (1 - flip.p)) : 0;
  const flippingIdx = flip ? (flip.dir === 'next' ? cur : cur - 1) : null;
  const baseIdx = flip ? (flip.dir === 'next' ? cur + 1 : cur) : cur;
  const rad = (Math.abs(angle) * Math.PI) / 180;

  const sheet = (idx: number, editable: boolean) =>
    idx === -1 ? (
      <Cover notebook={notebook} pageCount={pages.length} />
    ) : (
      <PageSurface pageId={pages[idx]?.id} pageNumber={idx + 1} editable={editable} settings={settings} />
    );

  const mounted = [cur - 1, cur, cur + 1].filter((i) => i >= -1 && i <= pages.length);

  return (
    <div className="notebook-view">
      <Toolbar
        title={notebook.title}
        settings={settings}
        onChange={(s) => setSettings((o) => ({ ...o, ...s }))}
        onBack={onBack}
        onImages={(files) => currentPageId && files.forEach((f) => insertImage(currentPageId, f))}
        pageLabel={cur === -1 ? 'Portada' : `Hoja ${cur + 1} de ${pages.length}`}
        onPrev={() => turn('prev')}
        onNext={() => turn('next')}
        canPrev={cur > -1}
        canWrite={cur >= 0}
      />
      <div className="stage" ref={stageRef}>
        <div className="book-wrap" style={{ width: PAGE_W * scale, height: PAGE_H * scale }}>
          <div className="book" ref={bookRef} style={{ transform: `scale(${scale})`, ['--px' as string]: `${Math.max(1, 1 / scale)}px` }}>
            <div className="page-stack" />
            {mounted.map((idx) => {
              const role = idx === flippingIdx ? 'flip' : idx === baseIdx ? 'base' : 'hidden';
              return (
                <div
                  key={idx}
                  className={`sheet sheet-${role}`}
                  style={role === 'flip' ? { transform: `rotateY(${angle}deg)` } : undefined}
                >
                  <div className="face front">
                    {sheet(idx, role === 'base' && !flip)}
                    {role === 'flip' && <div className="shade" style={{ opacity: Math.sin(rad) * 0.45 }} />}
                  </div>
                  {role === 'flip' && (
                    <div className="face back">
                      {idx === -1 ? <CoverInside color={notebook.color} /> : <BackPaper />}
                      <div className="shade back-shade" style={{ opacity: Math.sin(rad) * 0.35 }} />
                    </div>
                  )}
                </div>
              );
            })}
            {flip && <div className="cast-shadow" style={{ opacity: Math.sin(rad) * 0.55 }} />}
            <Rings />
            {!flip || drag.current ? (
              <>
                <div
                  className="turn-zone next"
                  onPointerDown={onZoneDown('next')}
                  onPointerMove={onZoneMove}
                  onPointerUp={onZoneUp}
                  onPointerCancel={onZoneUp}
                  title="Arrastra para pasar la hoja"
                >
                  <span className="dog-ear" />
                </div>
                {cur > -1 && (
                  <div
                    className="turn-zone prev"
                    style={{ width: MARGIN_LEFT - 8 }}
                    onPointerDown={onZoneDown('prev')}
                    onPointerMove={onZoneMove}
                    onPointerUp={onZoneUp}
                    onPointerCancel={onZoneUp}
                    title="Arrastra hacia la derecha para volver"
                  />
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
