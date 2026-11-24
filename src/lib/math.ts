import katex from 'katex';
import 'katex/dist/katex.min.css';

export function renderTex(tex: string, display = false) {
  return katex.renderToString(tex || '\\square', { throwOnError: false, displayMode: display, output: 'html' });
}

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
  if (!html.includes('$')) return html;
  return html
    .replace(/\$\$([^$<]+?)\$\$/g, (_, tex) => renderTex(decode(tex), true))
    .replace(/\$([^$<\n]+?)\$/g, (_, tex) => renderTex(decode(tex)));
}
