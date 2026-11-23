# Notebook Study 📓

Plataforma de cuadernos virtuales para estudiar. Cada cuaderno se ve y se usa como un **cuaderno cuadriculado anillado**: escribes con teclado o a mano con lápiz, pegas imágenes donde quieras y pasas las hojas como en uno de verdad.

## Qué hace hoy (v0.1)

- **Biblioteca de cuadernos** con portada de color y nombre.
- **Hoja cuadriculada** con perforaciones y espiral metálica.
- **Pasar hojas en 3D**: arrastras la esquina inferior derecha (o el margen izquierdo para volver), o usas las flechas ← → o los botones. Al pasar la última hoja se agrega una nueva.
- **Escritura mixta**:
  - **Texto**: haz clic donde quieras y escribe; las líneas caen sobre la cuadrícula.
  - **Lápiz**: trazo suave con presión real si usas stylus (iPad, Surface, Wacom…).
  - **Resaltador** y **borrador** (también el botón borrador del lápiz).
  - Si se detecta un lápiz, se ignora el toque de la palma al dibujar.
- **Imágenes**: Ctrl+V, arrastrar y soltar, o botón de imagen. Se pueden mover y redimensionar con la herramienta de selección. Las fotos grandes se comprimen automáticamente.
- **Guardado automático y sin conexión** en el navegador (IndexedDB). Al volver, el cuaderno se abre en la última hoja.

## Tecnologías

| Capa | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript | Tipos para un modelo de datos que va a crecer |
| UI | React 19 + Vite | Ecosistema amplio, build rápido |
| Trazos | perfect-freehand | Trazos naturales con presión |
| Datos locales | Dexie (IndexedDB) | Funciona sin conexión, guarda imágenes como Blob |
| Sincronización (fase 2) | Supabase | Login, Postgres, almacenamiento de imágenes y tiempo real |
| Distribución | PWA (fase 2), Tauri opcional | Un solo código para PC, tablet y celular |

## Cómo ejecutarlo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # versión de producción en dist/
```

## Estructura

```
src/
  types.ts                 Modelo de datos (Cuaderno → Hojas → Elementos)
  db.ts                    Base de datos local (Dexie) y operaciones
  lib/ink.ts               Conversión de trazos a SVG
  lib/images.ts            Pegar/comprimir imágenes
  components/
    Library.tsx            Lista de cuadernos
    NotebookView.tsx       Cuaderno: paso de hojas 3D, teclado, pegar
    PageSurface.tsx        Una hoja: texto, lápiz, borrador, imágenes
    Paper.tsx              Papel, perforaciones, espiral y portada
    Toolbar.tsx            Barra de herramientas
```

### Modelo de datos

```
Notebook { id, title, color, lastPage, updatedAt, deleted }
Page     { id, notebookId, order, updatedAt, deleted }
Element  { id, pageId, type: text | image | ink, x, y, w, h, z, updatedAt, deleted, ... }
Asset    { id, blob, mime }   ← las imágenes
```

Las coordenadas son de página (816 × 1056, proporción carta), así que el contenido se ve igual en cualquier pantalla. Todo lleva `updatedAt` y borrado suave (`deleted`) para que la sincronización pueda fusionar cambios de varios dispositivos.

## Hoja de ruta

1. **Sincronización entre dispositivos**: cuentas con Supabase Auth, tablas espejo en Postgres, imágenes en Supabase Storage y sincronización "último cambio gana" por elemento, más Realtime para ver cambios al instante.
2. **PWA instalable**: manifest, service worker y uso completo sin conexión.
3. **Zoom y desplazamiento** con pellizco (clave en celular) y vista de dos páginas en pantallas anchas.
4. Formato de texto (negrita, listas, títulos), herramienta lazo para mover trazos y deshacer/rehacer.
5. Tipos de hoja (rayada, punteada, blanca), separadores, índice y búsqueda.
6. Exportar un cuaderno a PDF.
