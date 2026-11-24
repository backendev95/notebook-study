import { useEffect, useState } from 'react';

/*
  KaTeX (las fórmulas) pesa bastante: solo se descarga la primera vez que una hoja
  tiene una fórmula o abres el editor de fórmulas. Mientras carga se ve el texto tal cual.
*/
type Katex = typeof import('katex').default;
let katex: Katex | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadKatex() {
  if (katex) return Promise.resolve();
  if (!loading)
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
      katex = m.default;
      listeners.forEach((l) => l());
    });
  return loading;
}

/** Vuelve a dibujar el componente cuando KaTeX termina de cargar */
export function useKatex(needed = true) {
  const [ready, setReady] = useState(!!katex);
  useEffect(() => {
    if (ready || !needed) return;
    const on = () => setReady(true);
    listeners.add(on);
    loadKatex();
    return () => {
      listeners.delete(on);
    };
  }, [ready, needed]);
  return ready;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function renderTex(tex: string, display = false) {
  if (!katex) {
    loadKatex();
    return `<code class="tex-loading">${escape(tex)}</code>`;
  }
  return katex.renderToString(tex || '\\square', { throwOnError: false, displayMode: display, output: 'html' });
}

export const hasMath = (s: string) => s.includes('$');

const decode = (s: string) => {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
};

/**
  En los textos y notas, lo que esté entre $…$ (o $$…$$) se muestra como fórmula.
  Solo se aplica al mostrar; al editar se ve el texto original.
*/
export function renderRichHtml(html: string) {
  if (!hasMath(html)) return html;
  return html
    .replace(/\$\$([^$<]+?)\$\$/g, (_, tex) => renderTex(decode(tex), true))
    .replace(/\$([^$<\n]+?)\$/g, (_, tex) => renderTex(decode(tex)));
}
