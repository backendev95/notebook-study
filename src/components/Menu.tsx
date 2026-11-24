import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Botón con menú desplegable (se dibuja sobre todo, aunque la barra tenga scroll) */
export function Menu({
  button,
  title,
  active,
  children,
  className = '',
}: {
  button: ReactNode;
  title: string;
  active?: boolean;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = pop.current?.offsetWidth ?? 220;
    const h = pop.current?.offsetHeight ?? 200;
    // abrir hacia abajo; si no cabe, hacia arriba; si tampoco, pegado arriba con scroll
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = r.top - 6 - h >= 8 ? r.top - 6 - h : Math.max(8, window.innerHeight - h - 8);
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left)), top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        className={`tb-btn ${className}${active || open ? ' active' : ''}`}
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="menu-pop" style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}>
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  active,
  danger,
  hint,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <button className={`menu-item${active ? ' active' : ''}${danger ? ' danger' : ''}`} onClick={onClick}>
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="menu-label">{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}
