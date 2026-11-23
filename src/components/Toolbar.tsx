import { useRef, type ReactNode } from 'react';
import type { Tool } from '../types';
import type { PenSettings } from './PageSurface';

const INK_COLORS = ['#1f2430', '#2456c9', '#d23b3b', '#1f8a4c', '#7b3fc4'];
const MARKER_COLORS = ['#ffd84a', '#8be38b', '#ff9ccf', '#7fd3ff'];
const SIZES = [2, 3.5, 6];

const icons: Record<Tool, ReactNode> = {
  select: <path d="M5 3l14 8-6 2-2 6z" />,
  text: <path d="M5 5h14M12 5v14M9 19h6" />,
  pen: <path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" />,
  marker: <path d="M5 21h6M9 17l-3 3M8 15l7-11 5 4-8 10zM8 15l4 3" />,
  eraser: <path d="M8 20h12M5 15l8-9 6 6-7 8H9z M9 11l6 6" />,
};
const labels: Record<Tool, string> = {
  select: 'Seleccionar y mover',
  text: 'Texto',
  pen: 'Lápiz',
  marker: 'Resaltador',
  eraser: 'Borrador',
};

interface Props {
  title: string;
  settings: PenSettings;
  onChange: (s: Partial<PenSettings>) => void;
  onBack: () => void;
  onImages: (files: File[]) => void;
  pageLabel: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canWrite: boolean;
}

export function Toolbar(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { settings: s } = p;
  const colors = s.tool === 'marker' ? MARKER_COLORS : INK_COLORS;
  const current = s.tool === 'marker' ? s.markerColor : s.tool === 'text' ? s.textColor : s.penColor;

  return (
    <header className="toolbar">
      <button className="tb-btn back" onClick={p.onBack} title="Mis cuadernos">
        <svg viewBox="0 0 24 24">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <div className="tb-title">{p.title}</div>

      <div className={`tb-group${p.canWrite ? '' : ' disabled'}`}>
        {(Object.keys(icons) as Tool[]).map((t) => (
          <button
            key={t}
            className={`tb-btn${s.tool === t ? ' active' : ''}`}
            onClick={() => p.onChange({ tool: t })}
            title={labels[t]}
            aria-label={labels[t]}
          >
            <svg viewBox="0 0 24 24">{icons[t]}</svg>
          </button>
        ))}
        <button className="tb-btn" title="Pegar imagen (también puedes usar Ctrl+V o arrastrarla)" onClick={() => fileRef.current?.click()}>
          <svg viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 16l5-5 4 4 3-3 6 6" />
            <circle cx="16" cy="9" r="1.5" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            p.onImages([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      {(s.tool === 'pen' || s.tool === 'marker' || s.tool === 'text') && (
        <div className={`tb-group${p.canWrite ? '' : ' disabled'}`}>
          {colors.map((c) => (
            <button
              key={c}
              className={`swatch${current === c ? ' active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() =>
                p.onChange(
                  s.tool === 'marker' ? { markerColor: c } : s.tool === 'text' ? { textColor: c } : { penColor: c },
                )
              }
            />
          ))}
          {s.tool === 'pen' &&
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
        </div>
      )}

      <div className="tb-spacer" />
      <div className="tb-group pager">
        <button className="tb-btn" onClick={p.onPrev} disabled={!p.canPrev} title="Hoja anterior (←)">
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="page-label">{p.pageLabel}</span>
        <button className="tb-btn" onClick={p.onNext} title="Hoja siguiente (→)">
          <svg viewBox="0 0 24 24">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </header>
  );
}
