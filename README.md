# Notebook Study 📓

Plataforma de cuadernos virtuales para estudiar. Cada cuaderno se ve y se usa como un **cuaderno cuadriculado anillado**: escribes con teclado o a mano con lápiz, pegas imágenes donde quieras y pasas las hojas como en uno de verdad.

## Qué hace hoy (v0.4)

**El cuaderno**
- Biblioteca con portadas de color o **con foto**, búsqueda en todos los apuntes y acceso al repaso.
- **Vista de dos páginas** (cuaderno abierto) en pantallas anchas y de una página en el celular; se cambia en ⋯ → Vista.
- **Pasar hojas en 3D** arrastrando la esquina, con flechas ← → o con los botones.
- **Tipos de hoja:** cuadriculada, rayada, punteada o blanca, para todo el cuaderno o por hoja.
- **Separadores** con pestañas de color al borde del cuaderno y un **índice**.
- **Panel de hojas** con miniaturas: insertar, duplicar, mover, eliminar, cambiar tipo de hoja.
- **Zoom:** pellizco con dos dedos, Ctrl + rueda o botones. Con lápiz, el dedo desplaza la hoja.

**Herramientas**
- Lápiz con presión, resaltador, borrador (también el botón borrador del lápiz) y **figuras** (línea, flecha, rectángulo, óvalo, triángulo).
- **Figuras automáticas:** dibuja a mano y mantén el lápiz quieto un momento al final; se convierte en figura limpia.
- **Texto** sobre los renglones, con **fórmulas** entre `$…$`.
- **Fórmulas** (LaTeX) con botones de ayuda, **notas adhesivas**, **imágenes** (Ctrl+V, arrastrar o botón).
- **Lazo** para encerrar trazos y moverlos, escalarlos, cambiarles el color, duplicarlos o copiarlos a otra hoja.
- **Deshacer / rehacer** (Ctrl+Z / Ctrl+Y) por hoja.

**Para estudiar**
- **Tarjetas de repaso** en la hoja (pregunta al frente, respuesta atrás) y **modo repaso** con repetición espaciada.
- **Buscar** (Ctrl+F) en textos, notas, fórmulas, tarjetas y separadores, sin importar tildes.
- **Importar un PDF** como hojas (las diapositivas de clase) para escribir encima.
- **Exportar a PDF** el cuaderno completo, la hoja actual o un rango.

**En todos tus dispositivos**
- App instalable (PWA) que funciona sin internet.
- Inicio de sesión con la misma cuenta de tus otras apps y **sincronización en tiempo real** con Supabase.

## Tecnologías

| Capa | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript | Tipos para un modelo de datos que va a crecer |
| UI | React 19 + Vite | Ecosistema amplio, build rápido |
| Trazos | perfect-freehand | Trazos naturales con presión |
| Datos locales | Dexie (IndexedDB) | Funciona sin conexión, guarda imágenes como Blob |
| Sincronización | Supabase (proyecto compartido, esquema `notebook`) | Mismo login que tus otras apps, Postgres con RLS e imágenes en Storage |
| Distribución | PWA (fase 2), Tauri opcional | Un solo código para PC, tablet y celular |

## Cómo ejecutarlo

```bash
npm install
cp .env.example .env   # pon la URL y la publishable key de Supabase
npm run dev            # http://localhost:5173
npm run build          # versión de producción en dist/
```

Sin `.env` la app funciona igual, pero solo guarda en el dispositivo.

## Configurar Supabase (proyecto compartido con tus otras apps)

Esta app usa **el mismo proyecto** de Supabase que tus otras apps, pero sus tablas viven aparte en el esquema `notebook`. Las tablas de las otras apps no se tocan. El login (`auth.users`) es el mismo, así que entras con el mismo correo y contraseña.

> **¿Ya lo habías configurado antes de la v0.4?** Solo ejecuta `supabase/migrations/002_mejoras.sql` en el SQL Editor. Agrega los campos nuevos (tipos de hoja, separadores, foto de portada, notas, fórmulas y tarjetas) y activa el tiempo real. Si no lo ejecutas, la app avisa "Falta actualizar la base".

1. **Crear tablas y permisos**: Supabase → **SQL Editor** → pega `supabase/schema.sql` → **Run**. Crea:
   - el esquema `notebook` con las tablas `notebooks`, `pages`, `elements` y `assets`;
   - reglas para que cada usuario solo vea lo suyo (RLS);
   - un trigger para que gane el cambio más reciente si editas lo mismo en dos dispositivos;
   - el bucket privado `notebook-assets` para las imágenes.
2. **Exponer el esquema**: **Project Settings → Data API → Exposed schemas** → agrega `notebook` → **Save**. Sin esto la app muestra el aviso "Falta exponer el esquema".
3. **Permitir la URL de la app**: **Authentication → URL Configuration → Redirect URLs** → agrega `https://backendev95.github.io/notebook-study/`. Así funcionan los correos de confirmación y de recuperar contraseña. No cambies el *Site URL* si lo usa tu otra app.
4. **Variables para el despliegue**: en GitHub → **Settings → Secrets and variables → Actions → Variables** crea:
   - `VITE_SUPABASE_URL`: la URL del proyecto (Supabase → Project Settings → API).
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: la *publishable key* (o la *anon public* en proyectos antiguos).

   Nunca uses la `service_role` en la app.
5. Haz push a `main` (o vuelve a ejecutar el workflow) para publicar con la sincronización activa.

### Cómo funciona la sincronización

- Todo se guarda primero en el dispositivo; los cambios pendientes quedan marcados y se suben a los ~1.5 s, cada 20 s, al volver la conexión o al regresar a la pestaña.
- Cada dispositivo baja solo lo que cambió desde la última vez (`server_updated_at`).
- Si dos dispositivos editan el mismo elemento, gana el cambio más reciente; el servidor también lo hace cumplir.
- Las imágenes se suben a Storage en `notebook-assets/<tu-usuario>/<id>` y se descargan en los otros dispositivos cuando se necesitan.
- Al cerrar sesión se sube lo pendiente y se borran los datos del dispositivo (siguen en la nube). Si hay cambios sin subir por falta de conexión, no te deja cerrar sesión para que no los pierdas.

Si tu otra app usa login con Google u otro proveedor en lugar de correo y contraseña, hay que agregar ese botón aquí; el proveedor ya queda configurado en el proyecto compartido.

## Estructura

```
supabase/schema.sql              Tablas, seguridad y bucket (instalación nueva)
supabase/migrations/002_*.sql    Actualización para quienes ya tenían la v0.3
src/
  types.ts                 Modelo de datos (Cuaderno → Hojas → Elementos)
  db.ts                    Base local (Dexie), operaciones de cuadernos y hojas
  lib/history.ts           Deshacer / rehacer
  lib/geometry.ts          Figuras, reconocimiento de trazos, lazo y transformaciones
  lib/math.ts              Fórmulas con KaTeX
  lib/pdf.ts               Importar y exportar PDF
  lib/search.ts            Búsqueda
  lib/sync.ts              Sincronización (local primero + tiempo real)
  lib/supabase.ts, auth.ts Cliente y sesión
  components/
    Library.tsx            Lista de cuadernos
    NotebookView.tsx       Cuaderno: vistas, zoom, pasar hojas, teclado, pegar
    Book.tsx               Las caras de las hojas en 3D y las pestañas
    PageSurface.tsx        Una hoja con todas las herramientas
    elements.tsx           Texto, notas, fórmulas, tarjetas, imágenes, selección
    PagesPanel.tsx         Miniaturas, índice y separadores
    Toolbar.tsx, Menu.tsx  Barra de herramientas y menús
    SearchDialog, ExportDialog, NotebookSettings, Review, Account, Welcome
```

### Modelo de datos

```
Notebook { id, title, color, paper, coverAssetId, updatedAt, deleted }
Page     { id, notebookId, order, paper, sectionTitle, sectionColor, updatedAt, deleted }
Element  { id, pageId, type: text | image | ink | sticky | math | card, x, y, w, h, z, updatedAt, deleted, ... }
Asset    { id, blob, mime }   ← las imágenes
```

Las coordenadas son de página (816 × 1056, proporción carta), así que el contenido se ve igual en cualquier pantalla. Todo lleva `updatedAt` y borrado suave (`deleted`) para que la sincronización pueda fusionar cambios de varios dispositivos.

## Hoja de ruta

- Reconocimiento de escritura a mano para buscar también en lo escrito con lápiz.
- Compartir un cuaderno (solo lectura) con un enlace.
- Grabar audio de la clase sincronizado con las notas.
- Más plantillas de hoja (Cornell, partituras, gráficos).
