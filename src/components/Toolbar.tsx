import { useRef, type ReactNode } from 'react';
import type { ShapeKind, Tool } from '../types';
import { SyncBadge } from './Account';
import { Menu, MenuItem } from './Menu';
import { INK_COLORS, MARKER_COLORS, STICKY_COLORS, type PenSettings } from './PageSurface';
import { format, useTextFormat, type Align } from '../lib/textFormat';

const F = (d: ReactNode) => <svg viewBox="0 0 24 24">{d}</svg>;
const fmtIcons = {
  bullets: F(
    <>
      <circle cx="5" cy="7" r="1.4" fill="currentColor" />
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="5" cy="17" r="1.4" fill="currentColor" />
      <path d="M9 7h11M9 12h11M9 17h11" />
    </>,
  ),
  numbers: F(
    <>
      <path d="M4 5h1.5v4M4 9h3M4 14.5c0-1 2.8-1 2.8.4 0 1-2.8 2.1-2.8 3.1h3" />
      <path d="M10 7h10M10 12h10M10 17h10" />
    </>,
  ),
  checklist: F(
    <>
      <rect x="3" y="4.5" width="5" height="5" rx="1" />
      <path d="M4 15.5l1.5 1.5 3-3.5" />
      <path d="M11 7h9M11 16h9" />
    </>,
  ),
  indent: F(<path d="M4 6h16M10 10h10M10 14h10M4 18h16M4 9.5l3 2.5-3 2.5" />),
  outdent: F(<path d="M4 6h16M10 10h10M10 14h10M4 18h16M7 9.5L4 12l3 2.5" />),
  left: F(<path d="M4 6h16M4 10h10M4 14h16M4 18h10" />),
  center: F(<path d="M4 6h16M7 10h10M4 14h16M7 18h10" />),
  right: F(<path d="M4 6h16M10 10h10M4 14h16M10 18h10" />),
  justify: F(<path d="M4 6h16M4 10h16M4 14h16M4 18h16" />),
  highlight: F(
    <>
      <path d="M5 21h7M9 17l-3 3M8 15l7-11 5 4-8 10zM8 15l4 3" />
    </>,
  ),
};

/** Fila de formato: aparece mientras escribes en un texto o una nota adhesiva */
function FormatRow() {
  const st = useTextFormat();
  if (!st.active) return null;
  // onPointerDown evita que el botón le quite el cursor a la caja de texto
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const B = ({ on, title, run, children }: { on?: boolean; title: string; run: () => void; children: ReactNode }) => (
    <button
      className={`tb-btn small fmt${on ? ' active' : ''}`}
      title={title}
      aria-label={title}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={run}
    >
      {children}
    </button>
  );
  const aligns: [Align, string][] = [
    ['left', 'Alinear a la izquierda'],
    ['center', 'Centrar'],
    ['right', 'Alinear a la derecha'],
    ['justify', 'Justificar'],
  ];
  return (
    <>
      <div className="tb-group">
        <B on={st.ul} title="Viñetas (Ctrl+Shift+8)" run={format.bullets}>
          {fmtIcons.bullets}
        </B>
        <B on={st.ol} title="Lista numerada (Ctrl+Shift+7)" run={format.numbers}>
          {fmtIcons.numbers}
        </B>
        <B on={st.check} title="Lista de tareas (casillas para marcar)" run={format.checklist}>
          {fmtIcons.checklist}
        </B>
        <B title="Quitar sangría (Shift+Tab)" run={format.outdent}>
          {fmtIcons.outdent}
        </B>
        <B title="Sub-viñeta / sangría (Tab)" run={format.indent}>
          {fmtIcons.indent}
        </B>
      </div>
      <div className="tb-group">
        {aligns.map(([a, title]) => (
          <B key={a} on={st.align === a} title={title} run={() => format.align(a)}>
            {fmtIcons[a]}
          </B>
        ))}
      </div>
      <div className="tb-group">
        <B on={st.bold} title="Negrita (Ctrl+B)" run={format.bold}>
          <b className="fmt-letter">B</b>
        </B>
        <B on={st.italic} title="Cursiva (Ctrl+I)" run={format.italic}>
          <i className="fmt-letter">I</i>
        </B>
        <B on={st.underline} title="Subrayado (Ctrl+U)" run={format.underline}>
          <u className="fmt-letter">U</u>
        </B>
        <B on={st.strike} title="Tachado" run={format.strike}>
          <s className="fmt-letter">S</s>
        </B>
        <B title="Resaltar" run={format.highlight}>
          {fmtIcons.highlight}
        </B>
        <B on={st.title} title="Título" run={format.title}>
          <span className="fmt-letter">T</span>
        </B>
      </div>
    </>
  );
}

const SIZES = [2, 3.5, 6];

const I = (d: ReactNode) => <svg viewBox="0 0 24 24">{d}</svg>;
export const icons = {
  select: I(<path d="M5 3l14 8-6 2-2 6z" />),
  lasso: I(
    <>
      <path d="M12 4c5 0 8 2.5 8 5.5S16.5 15 12 15c-1.5 0-3-.3-4-.8" strokeDasharray="2.5 2.5" />
      <path d="M8 14.2C5.6 13.3 4 11.6 4 9.5 4 6.5 7.5 4 12 4M8 14l-1.5 4.5c-.3 1 .6 1.8 1.5 1.3L10 19" />
    </>,
  ),
  text: I(<path d="M5 5h14M12 5v14M9 19h6" />),
  pen: I(<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" />),
  marker: I(<path d="M5 21h6M9 17l-3 3M8 15l7-11 5 4-8 10zM8 15l4 3" />),
  shape: I(
    <>
      <rect x="3" y="11" width="9" height="9" rx="1" />
      <circle cx="16" cy="8" r="5" />
    </>,
  ),
  eraser: I(<path d="M8 20h12M5 15l8-9 6 6-7 8H9z M9 11l6 6" />),
  sticky: I(<path d="M5 4h14v10l-6 6H5zM13 20v-6h6" />),
  math: I(<path d="M4 7h7M7.5 4v6M4 15l5 5M9 15l-5 5M14 9h6M14 16h6M14 19h6" />),
  card: I(
    <>
      <rect x="3" y="6" width="15" height="11" rx="2" />
      <path d="M7 3h12a2 2 0 012 2v10" />
    </>,
  ),
  image: I(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </>,
  ),
  pdf: I(<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 16h6M9 10h3" />),
  plus: I(<path d="M12 5v14M5 12h14" />),
  undo: I(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />),
  redo: I(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />),
  pages: I(
    <>
      <rect x="3" y="4" width="7" height="9" rx="1" />
      <rect x="14" y="4" width="7" height="9" rx="1" />
      <rect x="3" y="15" width="7" height="5" rx="1" />
      <rect x="14" y="15" width="7" height="5" rx="1" />
    </>,
  ),
  more: I(
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>,
  ),
  search: I(
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>,
  ),
  back: I(<path d="M15 5l-7 7 7 7" />),
  prev: I(<path d="M15 5l-7 7 7 7" />),
  next: I(<path d="M9 5l7 7-7 7" />),
  zoomIn: I(<path d="M12 6v12M6 12h12" />),
  zoomOut: I(<path d="M6 12h12" />),
};

const shapeIcons: Record<ShapeKind, ReactNode> = {
  line: I(<path d="M5 19L19 5" />),
  arrow: I(<path d="M5 19L19 5M11 5h8v8" />),
  rect: I(<rect x="4" y="6" width="16" height="12" rx="1" />),
  ellipse: I(<ellipse cx="12" cy="12" rx="8" ry="6" />),
  triangle: I(<path d="M12 4l8 15H4z" />),
};
const shapeLabels: Record<ShapeKind, string> = {
  line: 'Línea',
  arrow: 'Flecha',
  rect: 'Rectángulo',
  ellipse: 'Círculo / óvalo',
  triangle: 'Triángulo',
};

const mainTools: [Tool, string][] = [
  ['select', 'Seleccionar y mover'],
  ['lasso', 'Lazo: encierra trazos para moverlos'],
  ['pen', 'Lápiz (mantén quieto al final para hacer una figura limpia)'],
  ['marker', 'Resaltador'],
  ['shape', 'Figuras'],
  ['eraser', 'Borrador'],
  ['text', 'Texto'],
];

const hints: Partial<Record<Tool, string>> = {
  sticky: 'Toca la página para pegar la nota',
  math: 'Toca la página donde va la fórmula',
  card: 'Toca la página para crear la tarjeta',
  lasso: 'Encierra lo que quieras mover',
};

export interface ToolbarProps {
  title: string;
  settings: PenSettings;
  onChange: (s: Partial<PenSettings>) => void;
  onBack: () => void;
  canWrite: boolean;
  onImages: (files: File[]) => void;
  onPdf: (file: File) => void;
  undo: { can: boolean; run: () => void };
  redo: { can: boolean; run: () => void };
  zoom: { value: number; zoomIn: () => void; zoomOut: () => void; fit: () => void };
  onPages: () => void;
  onSearch: () => void;
  onExport: () => void;
  onReview: () => void;
  onSettings: () => void;
  view: 'auto' | 'single' | 'spread';
  onView: (v: 'auto' | 'single' | 'spread') => void;
  pageLabel: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
}

export function Toolbar(p: ToolbarProps) {
  const imgRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const { settings: s } = p;
  const t = s.tool;

  const colorFor = t === 'marker' ? MARKER_COLORS : t === 'sticky' ? STICKY_COLORS : INK_COLORS;
  const currentColor =
    t === 'marker' ? s.markerColor : t === 'sticky' ? s.stickyColor : t === 'text' || t === 'math' ? s.textColor : s.penColor;
  const setColor = (c: string) =>
    p.onChange(
      t === 'marker' ? { markerColor: c } : t === 'sticky' ? { stickyColor: c } : t === 'text' || t === 'math' ? { textColor: c } : { penColor: c },
    );
  const showColors = ['pen', 'marker', 'shape', 'text', 'sticky', 'math'].includes(t);
  const insertActive = t === 'sticky' || t === 'math' || t === 'card';
  const fmt = useTextFormat();

  return (
    <header className="toolbar">
      <div className="tb-row">
        <button className="tb-btn" onClick={p.onBack} title="Mis cuadernos" aria-label="Mis cuadernos">
          {icons.back}
        </button>
        <div className="tb-title">{p.title}</div>

        <div className={`tb-group${p.canWrite ? '' : ' disabled'}`}>
          {mainTools.map(([tool, label]) =>
            tool === 'shape' ? (
              <Menu key={tool} button={shapeIcons[s.shapeKind]} title={label} active={t === 'shape'}>
                {(close) =>
                  (Object.keys(shapeLabels) as ShapeKind[]).map((k) => (
                    <MenuItem
                      key={k}
                      icon={shapeIcons[k]}
                      active={t === 'shape' && s.shapeKind === k}
                      onClick={() => (p.onChange({ tool: 'shape', shapeKind: k }), close())}
                    >
                      {shapeLabels[k]}
                    </MenuItem>
                  ))
                }
              </Menu>
            ) : (
              <button
                key={tool}
                className={`tb-btn${t === tool ? ' active' : ''}`}
                onClick={() => p.onChange({ tool })}
                title={label}
                aria-label={label}
              >
                {icons[tool]}
              </button>
            ),
          )}
          <Menu button={icons.plus} title="Insertar" active={insertActive}>
            {(close) => (
              <>
                <MenuItem icon={icons.image} onClick={() => (imgRef.current?.click(), close())} hint="Ctrl+V">
                  Imagen
                </MenuItem>
                <MenuItem icon={icons.sticky} active={t === 'sticky'} onClick={() => (p.onChange({ tool: 'sticky' }), close())}>
                  Nota adhesiva
                </MenuItem>
                <MenuItem icon={icons.math} active={t === 'math'} onClick={() => (p.onChange({ tool: 'math' }), close())}>
                  Fórmula
                </MenuItem>
                <MenuItem icon={icons.card} active={t === 'card'} onClick={() => (p.onChange({ tool: 'card' }), close())}>
                  Tarjeta de repaso
                </MenuItem>
                <MenuItem icon={icons.pdf} onClick={() => (pdfRef.current?.click(), close())}>
                  PDF como páginas
                </MenuItem>
              </>
            )}
          </Menu>
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              p.onImages([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <input
            ref={pdfRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onPdf(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="tb-group">
          <button className="tb-btn" onClick={p.undo.run} disabled={!p.undo.can} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
            {icons.undo}
          </button>
          <button className="tb-btn" onClick={p.redo.run} disabled={!p.redo.can} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
            {icons.redo}
          </button>
        </div>

        <div className="tb-spacer" />

        <div className="tb-group zoom-group">
          <button className="tb-btn" onClick={p.zoom.zoomOut} title="Alejar (Ctrl −)" aria-label="Alejar">
            {icons.zoomOut}
          </button>
          <button className="zoom-label" onClick={p.zoom.fit} title="Ajustar a la pantalla (Ctrl+0)">
            {Math.round(p.zoom.value * 100)}%
          </button>
          <button className="tb-btn" onClick={p.zoom.zoomIn} title="Acercar (Ctrl +)" aria-label="Acercar">
            {icons.zoomIn}
          </button>
        </div>

        <button className="tb-btn" onClick={p.onPages} title="Páginas e índice" aria-label="Páginas e índice">
          {icons.pages}
        </button>
        <button className="tb-btn" onClick={p.onSearch} title="Buscar (Ctrl+F)" aria-label="Buscar">
          {icons.search}
        </button>
        <Menu button={icons.more} title="Más opciones">
          {(close) => (
            <>
              <MenuItem onClick={() => (p.onReview(), close())}>Repasar tarjetas</MenuItem>
              <MenuItem onClick={() => (p.onExport(), close())}>Exportar a PDF</MenuItem>
              <MenuItem onClick={() => (p.onSettings(), close())}>Ajustes del cuaderno</MenuItem>
              <div className="menu-sep">Vista</div>
              <MenuItem active={p.view === 'auto'} onClick={() => (p.onView('auto'), close())}>
                Automática
              </MenuItem>
              <MenuItem active={p.view === 'single'} onClick={() => (p.onView('single'), close())}>
                Una página
              </MenuItem>
              <MenuItem active={p.view === 'spread'} onClick={() => (p.onView('spread'), close())}>
                Dos páginas (cuaderno abierto)
              </MenuItem>
            </>
          )}
        </Menu>
        <SyncBadge compact />
        <div className="tb-group pager">
          <button className="tb-btn" onClick={p.onPrev} disabled={!p.canPrev} title="Página anterior (←)" aria-label="Página anterior">
            {icons.prev}
          </button>
          <span className="page-label">{p.pageLabel}</span>
          <button className="tb-btn" onClick={p.onNext} title="Página siguiente (→)" aria-label="Página siguiente">
            {icons.next}
          </button>
        </div>
      </div>

      {fmt.active && (
        <div className="tb-row sub">
          <FormatRow />
          <div className="tb-group">
            {INK_COLORS.map((c) => (
              <button
                key={c}
                className="swatch"
                style={{ background: c }}
                title="Color del texto seleccionado"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  document.execCommand('foreColor', false, c);
                  document.activeElement?.dispatchEvent(new Event('input', { bubbles: true }));
                }}
              />
            ))}
          </div>
        </div>
      )}
      {!fmt.active && (showColors || hints[t]) && p.canWrite && (
        <div className="tb-row sub">
          {t === 'shape' &&
            (Object.keys(shapeLabels) as ShapeKind[]).map((k) => (
              <button
                key={k}
                className={`tb-btn small${s.shapeKind === k ? ' active' : ''}`}
                onClick={() => p.onChange({ shapeKind: k })}
                title={shapeLabels[k]}
              >
                {shapeIcons[k]}
              </button>
            ))}
          {showColors &&
            colorFor.map((c) => (
              <button
                key={c}
                className={`swatch${currentColor === c ? ' active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => setColor(c)}
              />
            ))}
          {(t === 'pen' || t === 'shape') &&
            SIZES.map((z) => (
              <button
                key={z}
                className={`size${s.penSize === z ? ' active' : ''}`}
                onClick={() => p.onChange({ penSize: z })}
                title={`Grosor ${z}`}
              >
                <span style={{ width: z * 2 + 2, height: z * 2 + 2 }} />
              </button>
            ))}
          {hints[t] && <span className="tb-hint">{hints[t]}</span>}
          {t === 'pen' && <span className="tb-hint">Mantén el lápiz quieto al final de un trazo para convertirlo en figura</span>}
          {t === 'text' && <span className="tb-hint">Escribe fórmulas entre $…$, por ejemplo $x^2$</span>}
        </div>
      )}
    </header>
  );
}
