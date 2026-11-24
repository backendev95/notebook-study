import { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { deletePage, duplicatePage, insertPageAfter, movePage, updatePage } from '../db';
import { PAGE_H, PAGE_W, PAPER_LABELS, type Notebook, type Page, type PaperType } from '../types';
import { Menu, MenuItem } from './Menu';
import { PageSurface, type PenSettings } from './PageSurface';
import { PaperSample } from './PaperSample';

export const SECTION_COLORS = ['#e5534b', '#f2a33a', '#e8cf3a', '#4caf6a', '#3b8fd9', '#7b5cd6', '#d65ca8', '#8a8f98'];

const THUMB_W = 150;
const k = THUMB_W / PAGE_W;

const Thumb = memo(function Thumb({ page, n, paper, settings }: { page: Page; n: number; paper: PaperType; settings: PenSettings }) {
  return (
    <div className="thumb-page" style={{ width: THUMB_W, height: PAGE_H * k }}>
      <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${k})`, transformOrigin: '0 0', position: 'relative' }}>
        <PageSurface pageId={page.id} pageNumber={n} editable={false} settings={settings} paper={paper} />
      </div>
    </div>
  );
});

export function PagesPanel({
  notebook,
  pages,
  activePage,
  settings,
  onGo,
  onClose,
  onImportPdf,
}: {
  notebook: Notebook;
  pages: Page[];
  activePage: number;
  settings: PenSettings;
  onGo: (page: number) => void;
  onClose: () => void;
  onImportPdf: (afterIndex: number) => void;
}) {
  const [sectionEdit, setSectionEdit] = useState<{ page: Page; title: string; color: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const sections = pages.map((p, i) => ({ p, i })).filter(({ p }) => p.sectionTitle);
  const defPaper = notebook.paper ?? 'grid';

  return createPortal(
    <div className="drawer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" onKeyDown={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>Hojas</h2>
          <button className="tb-btn" onClick={onClose} title="Cerrar">
            ✕
          </button>
        </header>

        <section className="index">
          <h3>Índice</h3>
          {sections.length ? (
            <ul>
              {sections.map(({ p, i }) => (
                <li key={p.id}>
                  <button onClick={() => onGo(i)}>
                    <span className="index-dot" style={{ background: p.sectionColor ?? '#8a8f98' }} />
                    <span className="index-title">{p.sectionTitle}</span>
                    <span className="index-page">hoja {i + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-text">
              Aún no hay separadores. Usa ⋯ → <b>Separador</b> en una hoja para empezar una sección (por ejemplo
              "Unidad 1").
            </p>
          )}
        </section>

        <div className="drawer-actions">
          <button className="secondary" onClick={() => insertPageAfter(notebook.id, pages.length - 1).then(() => onGo(pages.length))}>
            + Hoja al final
          </button>
          <button className="secondary" onClick={() => onImportPdf(Math.max(-1, activePage))}>
            Importar PDF aquí
          </button>
        </div>

        <div className="thumb-grid">
          {pages.map((p, i) => {
            const paper = p.paper ?? defPaper;
            return (
              <div key={p.id} className={`thumb${i === activePage ? ' current' : ''}`}>
                {p.sectionTitle && (
                  <div className="thumb-section" style={{ background: p.sectionColor ?? '#8a8f98' }}>
                    {p.sectionTitle}
                  </div>
                )}
                <button className="thumb-go" onClick={() => onGo(i)} title={`Ir a la hoja ${i + 1}`}>
                  <Thumb page={p} n={i + 1} paper={paper} settings={settings} />
                </button>
                <div className="thumb-bar">
                  <span>Hoja {i + 1}</span>
                  <Menu button={<span className="dots">⋯</span>} title={`Opciones de la hoja ${i + 1}`}>
                    {(close) => (
                      <>
                        <MenuItem onClick={() => (onGo(i), close())}>Ir a esta hoja</MenuItem>
                        <MenuItem onClick={() => (insertPageAfter(notebook.id, i - 1), close())}>Insertar hoja antes</MenuItem>
                        <MenuItem onClick={() => (insertPageAfter(notebook.id, i), close())}>Insertar hoja después</MenuItem>
                        <MenuItem onClick={() => (duplicatePage(notebook.id, i), close())}>Duplicar</MenuItem>
                        {i > 0 && <MenuItem onClick={() => (movePage(notebook.id, i, -1), close())}>Mover antes</MenuItem>}
                        {i < pages.length - 1 && (
                          <MenuItem onClick={() => (movePage(notebook.id, i, 1), close())}>Mover después</MenuItem>
                        )}
                        <div className="menu-sep">Tipo de hoja</div>
                        <MenuItem active={!p.paper} onClick={() => (updatePage(p.id, { paper: null }), close())}>
                          Como el cuaderno ({PAPER_LABELS[defPaper].toLowerCase()})
                        </MenuItem>
                        {(Object.keys(PAPER_LABELS) as PaperType[]).map((pt) => (
                          <MenuItem
                            key={pt}
                            icon={<PaperSample paper={pt} />}
                            active={p.paper === pt}
                            onClick={() => (updatePage(p.id, { paper: pt }), close())}
                          >
                            {PAPER_LABELS[pt]}
                          </MenuItem>
                        ))}
                        <div className="menu-sep" />
                        <MenuItem
                          onClick={() => {
                            setSectionEdit({ page: p, title: p.sectionTitle ?? '', color: p.sectionColor ?? SECTION_COLORS[sections.length % SECTION_COLORS.length] });
                            close();
                          }}
                        >
                          {p.sectionTitle ? 'Editar separador' : 'Separador (empezar sección)'}
                        </MenuItem>
                        <MenuItem onClick={() => (onImportPdf(i), close())}>Importar PDF después de esta</MenuItem>
                        {pages.length > 1 && (
                          <MenuItem danger onClick={() => (setConfirmDelete(i), close())}>
                            Eliminar hoja
                          </MenuItem>
                        )}
                      </>
                    )}
                  </Menu>
                </div>
                {confirmDelete === i && (
                  <div className="thumb-confirm">
                    <span>¿Eliminar la hoja {i + 1} y todo lo que tiene?</span>
                    <button className="danger-btn" onClick={() => (deletePage(p.id), setConfirmDelete(null))}>
                      Eliminar
                    </button>
                    <button className="link" onClick={() => setConfirmDelete(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {sectionEdit && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setSectionEdit(null)}>
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              updatePage(sectionEdit.page.id, {
                sectionTitle: sectionEdit.title.trim() || null,
                sectionColor: sectionEdit.title.trim() ? sectionEdit.color : null,
              });
              setSectionEdit(null);
            }}
          >
            <h2>Separador</h2>
            <p className="modal-sub">Aparece como una pestaña de color al borde del cuaderno y en el índice.</p>
            <label>
              Nombre de la sección
              <input
                autoFocus
                value={sectionEdit.title}
                placeholder="Ej: Unidad 2 — Derivadas"
                onChange={(e) => setSectionEdit({ ...sectionEdit, title: e.target.value })}
              />
            </label>
            <div className="color-row">
              {SECTION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch${c === sectionEdit.color ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setSectionEdit({ ...sectionEdit, color: c })}
                />
              ))}
            </div>
            <div className="form-actions">
              {sectionEdit.page.sectionTitle ? (
                <button
                  type="button"
                  className="link danger-text"
                  onClick={() => {
                    updatePage(sectionEdit.page.id, { sectionTitle: null, sectionColor: null });
                    setSectionEdit(null);
                  }}
                >
                  Quitar separador
                </button>
              ) : (
                <span />
              )}
              <span className="row-gap">
                <button type="button" className="link" onClick={() => setSectionEdit(null)}>
                  Cancelar
                </button>
                <button type="submit" className="primary">
                  Guardar
                </button>
              </span>
            </div>
          </form>
        </div>
      )}
    </div>,
    document.body,
  );
}
