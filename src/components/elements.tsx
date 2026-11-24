import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { inkPath } from '../lib/ink';
import { useAssetUrl } from '../lib/images';
import { hasMath, renderRichHtml, renderTex, useKatex } from '../lib/math';
import type { CardElement, ImageElement, InkElement, MathElement, StickyElement, TextElement } from '../types';

// ---------- Trazo ----------
export const InkPath = memo(function InkPath({ el, live }: { el: InkElement; live?: boolean }) {
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

// ---------- Imagen ----------
export function ImageBox({ el, selected }: { el: ImageElement; selected: boolean }) {
  const url = useAssetUrl(el.assetId);
  return (
    <div
      data-el={el.id}
      className={`el image-el${selected ? ' selected' : ''}${el.locked ? ' locked' : ''}`}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z }}
    >
      {url && <img src={url} alt="" draggable={false} decoding="async" />}
      {!el.locked && <span className="tape" />}
    </div>
  );
}

// ---------- Texto y nota adhesiva (editables) ----------
export function EditableBox({
  el,
  editing,
  selected,
  onCommit,
  onDone,
}: {
  el: TextElement | StickyElement;
  editing: boolean;
  selected: boolean;
  onCommit: (html: string, text: string, h: number) => Promise<void>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const unsaved = useRef(false); // hay texto escrito que todavía no se guardó
  const wasEditing = useRef(editing);
  const sticky = el.type === 'sticky';
  const katexReady = useKatex(hasMath(el.html));

  // Mostrar el contenido guardado (con fórmulas $…$ renderizadas), nunca encima de algo sin guardar
  useEffect(() => {
    if (!ref.current || editing || unsaved.current) return;
    const shown = renderRichHtml(el.html);
    if (ref.current.innerHTML !== shown) ref.current.innerHTML = shown;
  }, [el.html, editing, katexReady]);

  useEffect(() => {
    const node = ref.current;
    if (!editing || !node) return;
    if (!unsaved.current) node.innerHTML = el.html; // al editar se ve el texto original
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const saving = useRef(false);
  const finish = async () => {
    // al salir de la caja puede llegar el aviso dos veces (perder el foco y dejar de editar): guardar una sola
    if (saving.current) return;
    const node = ref.current;
    if (!node || !unsaved.current) {
      // sin cambios: si nunca se escribió nada, igual avisar (para borrar cajas vacías nuevas)
      if (node && !node.innerText.trim() && !el.html) await onCommit('', '', 0);
      onDone();
      return;
    }
    const html = node.innerHTML;
    const text = node.innerText.trim();
    const h = node.offsetHeight;
    saving.current = true;
    try {
      await onCommit(html, text, h);
      unsaved.current = false;
    } finally {
      saving.current = false;
    }
    onDone();
  };

  // Si se deja de editar sin perder el foco (por ejemplo, al crear otra caja), guardar igual
  useEffect(() => {
    if (wasEditing.current && !editing) finish();
    wasEditing.current = editing;
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const onPaste = (e: React.ClipboardEvent) => {
    if ([...e.clipboardData.items].some((i) => i.type.startsWith('image/'))) return;
    e.preventDefault();
    e.stopPropagation();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };

  const style: React.CSSProperties = sticky
    ? {
        left: el.x,
        top: el.y,
        width: el.w,
        minHeight: el.h,
        zIndex: el.z,
        background: el.color,
        transform: `rotate(${(el as StickyElement).rot}deg)`,
      }
    : { left: el.x, top: el.y, width: el.w, zIndex: 10000 + el.z, color: el.color };

  return (
    <div
      data-el={el.id}
      data-editing={editing || undefined}
      className={`el ${sticky ? 'sticky-el' : 'text-el'}${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      style={style}
    >
      <div
        ref={ref}
        className="text-content"
        contentEditable={editing}
        suppressContentEditableWarning
        spellCheck={editing}
        onBlur={finish}
        onInput={() => (unsaved.current = true)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLElement).blur();
          e.stopPropagation();
        }}
      />
    </div>
  );
}

// ---------- Fórmula ----------
export function measureTex(tex: string) {
  const div = document.createElement('div');
  div.className = 'math-inner';
  div.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;';
  div.innerHTML = renderTex(tex, true);
  document.body.appendChild(div);
  const r = { w: Math.max(30, div.offsetWidth), h: Math.max(24, div.offsetHeight) };
  div.remove();
  return r;
}

export function MathBox({ el, selected }: { el: MathElement; selected: boolean }) {
  const inner = useRef<HTMLDivElement>(null);
  const ready = useKatex();
  const html = useMemo(() => renderTex(el.tex, true), [el.tex, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const n = inner.current;
    if (n) setNat({ w: Math.max(30, n.offsetWidth), h: Math.max(24, n.offsetHeight) });
  }, [html]);
  const k = nat ? el.w / nat.w : 1;
  return (
    <div
      data-el={el.id}
      className={`el math-el${selected ? ' selected' : ''}`}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: 10000 + el.z, color: el.color }}
    >
      <div
        ref={inner}
        className="math-inner"
        style={{ transform: `scale(${k})`, transformOrigin: '0 0' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ---------- Tarjeta de repaso ----------
export function CardBox({ el, selected }: { el: CardElement; selected: boolean }) {
  const [flipped, setFlipped] = useState(false);
  useKatex(hasMath(el.q + el.a));
  const due = el.due <= Date.now();
  return (
    <div
      data-el={el.id}
      className={`el card-el${selected ? ' selected' : ''}${flipped ? ' flipped' : ''}`}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z }}
    >
      <div className="card-inner">
        <div className="card-face card-front">
          <div className="card-label">Pregunta{due && <span className="card-due">toca repasar</span>}</div>
          <div className="card-text" dangerouslySetInnerHTML={{ __html: renderRichHtml(escapeHtml(el.q)) }} />
        </div>
        <div className="card-face card-back">
          <div className="card-label">Respuesta</div>
          <div className="card-text" dangerouslySetInnerHTML={{ __html: renderRichHtml(escapeHtml(el.a)) }} />
        </div>
      </div>
      <button data-action className="card-flip" onClick={() => setFlipped((f) => !f)} title="Voltear tarjeta">
        ↻
      </button>
    </div>
  );
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

// ---------- Recuadro de selección ----------
export function SelectionOverlay({
  box,
  colors,
  onColor,
  actions,
}: {
  box: { x: number; y: number; w: number; h: number };
  colors?: string[];
  onColor?: (c: string) => void;
  actions: { label: string; title: string; onClick: () => void; danger?: boolean }[];
}) {
  const pad = 8;
  const above = box.y > 70;
  return (
    <div
      className="selection-box"
      style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2 }}
    >
      <div data-handle className="handle" />
      <div className={`selection-bar ${above ? 'above' : 'below'}`} data-action>
        {colors?.map((c) => (
          <button key={c} className="swatch small" style={{ background: c }} onClick={() => onColor?.(c)} title="Color" />
        ))}
        {actions.map((a) => (
          <button key={a.label} className={`sel-btn${a.danger ? ' danger' : ''}`} onClick={a.onClick} title={a.title}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Editores (ventanas) ----------
const MATH_SNIPPETS: [string, string][] = [
  ['a/b', '\\frac{a}{b}'],
  ['√', '\\sqrt{x}'],
  ['xⁿ', 'x^{n}'],
  ['xᵢ', 'x_{i}'],
  ['Σ', '\\sum_{i=1}^{n}'],
  ['∫', '\\int_{a}^{b}'],
  ['lím', '\\lim_{x \\to 0}'],
  ['π', '\\pi'],
  ['α', '\\alpha'],
  ['β', '\\beta'],
  ['θ', '\\theta'],
  ['Δ', '\\Delta'],
  ['∞', '\\infty'],
  ['≤', '\\leq'],
  ['≥', '\\geq'],
  ['≠', '\\neq'],
  ['±', '\\pm'],
  ['·', '\\cdot'],
  ['→', '\\rightarrow'],
];

export function MathEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: string;
  onSave: (tex: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [tex, setTex] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useKatex();
  const insert = (s: string) => {
    const a = area.current;
    if (!a) return setTex((t) => t + s);
    const { selectionStart: i, selectionEnd: j } = a;
    const next = tex.slice(0, i) + s + tex.slice(j);
    setTex(next);
    requestAnimationFrame(() => {
      a.focus();
      a.selectionStart = a.selectionEnd = i + s.length;
    });
  };
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal wide" onKeyDown={(e) => e.stopPropagation()}>
        <h2>Fórmula</h2>
        <div className="math-preview" dangerouslySetInnerHTML={{ __html: renderTex(tex, true) }} />
        <div className="snippets">
          {MATH_SNIPPETS.map(([l, s]) => (
            <button key={l} type="button" onClick={() => insert(s)}>
              {l}
            </button>
          ))}
        </div>
        <label>
          LaTeX
          <textarea
            ref={area}
            autoFocus
            rows={3}
            value={tex}
            placeholder="Ej: \frac{dy}{dx} = 2x"
            onChange={(e) => setTex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(tex);
            }}
          />
        </label>
        <p className="modal-sub">
          Consejo: en cualquier texto o nota también puedes escribir entre signos de pesos, por ejemplo $x^2$.
        </p>
        <div className="form-actions">
          {onDelete ? (
            <button type="button" className="link danger-text" onClick={onDelete}>
              Eliminar
            </button>
          ) : (
            <span />
          )}
          <span className="row-gap">
            <button type="button" className="link" onClick={onCancel}>
              Cancelar
            </button>
            <button type="button" className="primary" onClick={() => onSave(tex)} disabled={!tex.trim()}>
              Listo
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CardEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: { q: string; a: string };
  onSave: (v: { q: string; a: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [q, setQ] = useState(initial.q);
  const [a, setA] = useState(initial.a);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" onKeyDown={(e) => e.stopPropagation()}>
        <h2>Tarjeta de repaso</h2>
        <label>
          Pregunta
          <textarea autoFocus rows={3} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          Respuesta
          <textarea rows={3} value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        <p className="modal-sub">Puedes usar fórmulas entre $…$. Repasa tus tarjetas desde el menú ⋯ → Repasar.</p>
        <div className="form-actions">
          {onDelete ? (
            <button type="button" className="link danger-text" onClick={onDelete}>
              Eliminar
            </button>
          ) : (
            <span />
          )}
          <span className="row-gap">
            <button type="button" className="link" onClick={onCancel}>
              Cancelar
            </button>
            <button type="button" className="primary" onClick={() => onSave({ q, a })} disabled={!q.trim()}>
              Listo
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
