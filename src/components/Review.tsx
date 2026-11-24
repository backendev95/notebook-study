import { useEffect, useMemo, useState } from 'react';
import { db, getPages, now } from '../db';
import { renderRichHtml, useKatex } from '../lib/math';
import type { CardElement } from '../types';
import { escapeHtml } from './elements';

const DAY = 86_400_000;
const INTERVALS = [0, 1, 2, 4, 8, 16]; // días según la caja (Leitner)

interface Item {
  card: CardElement;
  notebookTitle: string;
  page: number;
}

async function loadCards(notebookId?: string): Promise<Item[]> {
  const notebooks = (await db.notebooks.toArray()).filter((n) => !n.deleted && (!notebookId || n.id === notebookId));
  const out: Item[] = [];
  for (const nb of notebooks) {
    const pages = await getPages(nb.id);
    for (const [i, p] of pages.entries()) {
      const els = await db.elements.where('pageId').equals(p.id).toArray();
      for (const e of els) if (e.type === 'card' && !e.deleted) out.push({ card: e, notebookTitle: nb.title, page: i });
    }
  }
  return out;
}

/** Repaso con tarjetas: las que "no sabías" vuelven pronto; las que sabías, cada vez más espaciadas */
export function Review({ notebookId, onExit }: { notebookId?: string; onExit: () => void }) {
  const [all, setAll] = useState<Item[] | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [stats, setStats] = useState({ ok: 0, again: 0 });

  useEffect(() => {
    loadCards(notebookId).then((items) => {
      setAll(items);
      setQueue(items.filter((i) => i.card.due <= now()).sort(() => Math.random() - 0.5));
    });
  }, [notebookId]);

  const current = queue[0];
  const katexReady = useKatex(!!current);
  const html = useMemo(
    () =>
      current
        ? { q: renderRichHtml(escapeHtml(current.card.q)), a: renderRichHtml(escapeHtml(current.card.a)) }
        : null,
    [current, katexReady],
  );

  const answer = async (grade: 'again' | 'hard' | 'good') => {
    if (!current) return;
    const c = current.card;
    const box = grade === 'again' ? 1 : grade === 'hard' ? Math.max(1, c.box) : Math.min(5, c.box + 1);
    const due = grade === 'again' ? now() + 60_000 : now() + INTERVALS[box] * DAY;
    await db.elements.update(c.id, { box, due, updatedAt: now() } as Partial<CardElement>);
    setStats((s) => (grade === 'again' ? { ...s, again: s.again + 1 } : { ...s, ok: s.ok + 1 }));
    setShowAnswer(false);
    setQueue((q) => {
      const rest = q.slice(1);
      // las que no sabías vuelven al final de esta misma sesión
      return grade === 'again' ? [...rest, { ...current, card: { ...c, box, due } }] : rest;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (!showAnswer && (e.key === ' ' || e.key === 'Enter')) (e.preventDefault(), setShowAnswer(true));
      else if (showAnswer && e.key === '1') answer('again');
      else if (showAnswer && e.key === '2') answer('hard');
      else if (showAnswer && e.key === '3') answer('good');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="review">
      <header className="review-head">
        <button className="link" onClick={onExit}>
          ← Volver
        </button>
        <span>
          {all ? `${queue.length} por repasar · ${stats.ok} bien · ${stats.again} a repetir` : 'Cargando tarjetas…'}
        </span>
      </header>

      {all && all.length === 0 && (
        <div className="review-empty">
          <h2>Aún no tienes tarjetas</h2>
          <p>
            En una hoja usa <b>Insertar → Tarjeta de repaso</b> y escribe una pregunta y su respuesta. Después vuelve aquí
            para repasar.
          </p>
        </div>
      )}

      {all && all.length > 0 && !current && (
        <div className="review-empty">
          <h2>¡Al día! 🎉</h2>
          <p>No hay tarjetas pendientes por ahora.</p>
          <button className="primary" onClick={() => setQueue([...all].sort(() => Math.random() - 0.5))}>
            Repasar todas igual ({all.length})
          </button>
        </div>
      )}

      {current && html && (
        <div className="review-stage">
          <div className="review-where">
            {current.notebookTitle} · hoja {current.page + 1}
          </div>
          <div className={`review-card${showAnswer ? ' flipped' : ''}`} onClick={() => setShowAnswer(true)}>
            <div className="review-face front">
              <span className="card-label">Pregunta</span>
              <div className="review-text" dangerouslySetInnerHTML={{ __html: html.q }} />
            </div>
            <div className="review-face back">
              <span className="card-label">Respuesta</span>
              <div className="review-text" dangerouslySetInnerHTML={{ __html: html.a }} />
            </div>
          </div>
          {!showAnswer ? (
            <button className="primary big" onClick={() => setShowAnswer(true)}>
              Mostrar respuesta
            </button>
          ) : (
            <div className="grade-row">
              <button className="grade again" onClick={() => answer('again')}>
                No la sabía
                <small>1</small>
              </button>
              <button className="grade hard" onClick={() => answer('hard')}>
                Más o menos
                <small>2</small>
              </button>
              <button className="grade good" onClick={() => answer('good')}>
                La sabía
                <small>3</small>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
